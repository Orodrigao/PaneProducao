-- Tabela Buck com data de validade (fase 1 de 3).
--
-- O problema (medido em producao em 15/10/2026, so leitura): `price_tier_items`
-- guarda um preco so por produto, sem historico. O Fechamento EX e a cobranca
-- semanal da Buck refaziam a conta de qualquer periodo com o preco de HOJE.
-- Quando o Italiano subiu de 4,50 para 5,89 e o Pao de Azeitonas de 9,50 para
-- 12,32 (09/10, 12h28) e o Italiano de Queijo e Oregano de 7,50 para 11,00
-- (01/10, 6h12), os relatorios de setembro mudaram de valor e as semanas
-- confirmadas depois da troca sairam inteiras com o preco novo.
--
-- Decisoes do Rodrigo (15/10/2026):
--   * preco novo vale a partir de uma data; quem troca escolhe a data, ja
--     preenchida com hoje (a escolha da data chega na fase 2; aqui a troca pela
--     tela vale a partir do dia em que foi salva);
--   * sem data futura nesta versao;
--   * a carga inicial usa o dia da troca no sistema (datas acima, tiradas dos
--     registros de acesso da API, porque a tabela nao tinha data de alteracao);
--   * cobrancas ja confirmadas nao mudam: a foto em receivable_romaneio_lines
--     continua sendo o que foi cobrado.
--
-- O que esta migration faz:
--   1. `buck_price_history`: um registro por mudanca de preco da Tabela Buck,
--      so de acrescimo. O preco de um item numa data e o registro MAIS RECENTE
--      cuja data de validade e anterior ou igual a ela. Assim uma correcao "a
--      partir de D" cobre de D em diante, sem apagar a trilha.
--   2. Gatilho em `price_tier_items`: toda gravacao na Tabela Buck vira
--      registro, inclusive a da tela antiga (que salva a cada tecla).
--        - troca de um preco positivo por outro: vale de hoje;
--        - primeiro preco (cadastro, 0 -> X, reativacao): preenche o buraco
--          desde que o produto ficou sem preco, para destravar a semana que
--          estava parada por falta de preco;
--        - troca de unidade: corrige o periodo vigente (e acerto de cadastro);
--        - remocao ou exclusao: sem preco a partir de hoje.
--      Mudar a identidade de uma linha da Buck (tabela, produto, origem ou
--      opcao de venda) e recusado: o certo e incluir outra linha.
--   3. A conta da cobranca usa o preco do dia de cada romaneio e separa uma
--      linha por preco (semana com troca no meio mostra as duas).
--   4. A impressao digital da composicao passa a ordenar tambem pelo preco,
--      senao duas linhas do mesmo produto empatam e a lista e a confirmacao
--      podem discordar.
--   5. `list_romaneio_ex_billing`: o Fechamento EX passa a ler a mesma conta do
--      banco, em vez de refaze-la no navegador com o preco de hoje.
--   6. Carga inicial, presa por invariante (nome, tabela, unidade e preco
--      atual), nunca por id de producao.
--
-- Deploy aditivo: nenhuma coluna removida; as funcoes redefinidas mantem nome,
-- argumentos e colunas de retorno. O site no ar continua funcionando.

begin;

-- Nenhuma gravacao na Tabela Buck escapa entre a carga e o gatilho.
lock table public.price_tier_items in share row exclusive mode;

-- ---------------------------------------------------------------------------
-- 1. Historico de preco da Buck
-- ---------------------------------------------------------------------------
create table public.buck_price_history (
  seq bigint generated always as identity primary key,
  -- Sem chave estrangeira de proposito: migrations ja apagaram linhas da
  -- tabela de precos, e o historico precisa continuar valendo para o passado.
  price_tier_item_id uuid not null,
  tier_id uuid not null,
  product_source text not null check (product_source in ('bread', 'product')),
  product_id text not null,
  sale_option_id uuid,
  product_name text not null,
  -- Sem preco (null) = fora da tabela a partir de valid_from.
  unit_price numeric check (unit_price is null or unit_price >= 0),
  pricing_unit text check (pricing_unit is null or pricing_unit in ('un', 'kg')),
  valid_from date not null,
  previous_unit_price numeric,
  previous_pricing_unit text,
  event text not null check (event in (
    'carga_inicial', 'cadastro', 'troca_de_preco', 'primeiro_preco',
    'troca_de_unidade', 'remocao', 'exclusao'
  )),
  origin text not null check (origin in ('migracao', 'tabela', 'troca_com_data')),
  reason text check (reason is null or length(trim(reason)) between 3 and 200),
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default clock_timestamp(),
  constraint buck_price_history_preco_e_unidade check (
    (unit_price is null) = (pricing_unit is null)
  )
);

comment on table public.buck_price_history is
  'Cada mudanca de preco da Tabela Buck, com a data a partir da qual vale. O preco numa data e o registro mais recente (seq) com valid_from <= data. So acrescimo.';

create index buck_price_history_item_idx
  on public.buck_price_history (price_tier_item_id, valid_from, seq);
create index buck_price_history_identidade_idx
  on public.buck_price_history (tier_id, product_source, product_id);

-- So leitura, e so para quem cuida das tabelas de preco (admin e financeiro).
-- Quem le o Fechamento EX recebe o preco na data pela funcao, sem autor nem
-- motivo (licao leitura-operacional-sem-preco).
alter table public.buck_price_history enable row level security;
alter table public.buck_price_history force row level security;

create policy buck_price_history_select_commercial
on public.buck_price_history for select to authenticated
using (
  exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and profile.role = any (array['admin'::text, 'financeiro'::text])
  )
);

revoke all on table public.buck_price_history from public, anon, authenticated;
grant select on table public.buck_price_history to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Regras auxiliares
-- ---------------------------------------------------------------------------
-- A tabela Buck e achada pelo nome, como na conta da cobranca.
create or replace function private.buck_tier_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select tier.id
  from public.price_tiers tier
  where lower(trim(tier.name)) = 'buck' and tier.active
  order by tier.id
  limit 1;
$fn$;

revoke all on function private.buck_tier_id() from public, anon, authenticated;

-- "Desde sempre": primeiro preco de uma linha que nunca teve preco.
create or replace function private.buck_preco_desde_sempre()
returns date
language sql
immutable
set search_path = ''
as $fn$
  select date '2000-01-01';
$fn$;

revoke all on function private.buck_preco_desde_sempre() from public, anon, authenticated;

-- Preco de uma linha da Tabela Buck numa data.
create or replace function private.buck_preco_na_data(p_item_id uuid, p_data date)
returns table (unit_price numeric, pricing_unit text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select historico.unit_price, historico.pricing_unit
  from public.buck_price_history historico
  where historico.price_tier_item_id = p_item_id
    and historico.valid_from <= p_data
  order by historico.seq desc
  limit 1;
$fn$;

revoke all on function private.buck_preco_na_data(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Gatilho: toda gravacao na Tabela Buck vira historico
-- ---------------------------------------------------------------------------
create or replace function private.registrar_historico_preco_buck()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_buck uuid := private.buck_tier_id();
  v_hoje date := private.data_na_padaria();
  v_linha public.price_tier_items%rowtype;
  v_atual public.buck_price_history%rowtype;
  v_tem_atual boolean;
  v_atual_positivo boolean;
  v_preco numeric;
  v_unidade text;
  v_evento text;
  v_validade date;
  v_autor uuid := (select auth.uid());
  v_nome text;
begin
  if v_buck is null then
    return null;
  end if;

  -- A troca com data (fase 2) grava o proprio registro.
  if coalesce(current_setting('app.buck_price_writer', true), '') = 'troca_com_data' then
    return null;
  end if;

  if tg_op = 'UPDATE'
     and (old.tier_id = v_buck or new.tier_id = v_buck)
     and (old.tier_id is distinct from new.tier_id
          or old.product_id is distinct from new.product_id
          or old.product_source is distinct from new.product_source
          or old.sale_option_id is distinct from new.sale_option_id) then
    raise exception using errcode = '22023',
      message = 'Uma linha da Tabela Buck não muda de produto nem de tabela. Remova a linha e inclua o produto certo.';
  end if;

  if tg_op = 'DELETE' then
    v_linha := old;
  else
    v_linha := new;
  end if;

  if v_linha.tier_id is distinct from v_buck then
    return null;
  end if;

  select historico.* into v_atual
  from public.buck_price_history historico
  where historico.price_tier_item_id = v_linha.id
  order by historico.seq desc
  limit 1;
  v_tem_atual := found;
  v_atual_positivo := v_tem_atual and coalesce(v_atual.unit_price, 0) > 0;

  if tg_op = 'DELETE' then
    v_preco := null;
    v_unidade := null;
  elsif new.active then
    v_preco := new.unit_price;
    v_unidade := new.pricing_unit;
  else
    v_preco := null;
    v_unidade := null;
  end if;

  if tg_op = 'INSERT' or not v_tem_atual then
    v_evento := 'cadastro';
    v_validade := private.buck_preco_desde_sempre();
  elsif v_preco is not distinct from v_atual.unit_price
        and v_unidade is not distinct from v_atual.pricing_unit then
    -- Pacote, nome ou outra coluna: o preco nao mudou.
    return null;
  elsif tg_op = 'DELETE' then
    v_evento := 'exclusao';
    v_validade := case when v_atual_positivo then v_hoje else v_atual.valid_from end;
  elsif v_preco is null then
    v_evento := 'remocao';
    v_validade := case when v_atual_positivo then v_hoje else v_atual.valid_from end;
  elsif not v_atual_positivo then
    -- Primeiro preco, reativacao ou 0 -> X: preenche o buraco desde que a
    -- linha ficou sem preco. Uma semana parada por falta de preco destrava.
    v_evento := 'primeiro_preco';
    v_validade := v_atual.valid_from;
  elsif v_unidade is distinct from v_atual.pricing_unit then
    -- Unidade errada e acerto de cadastro: corrige o periodo vigente.
    v_evento := 'troca_de_unidade';
    v_validade := v_atual.valid_from;
  else
    v_evento := 'troca_de_preco';
    v_validade := v_hoje;
  end if;

  select profile.display_name into v_nome
  from public.app_profiles profile
  where profile.user_id = v_autor;

  insert into public.buck_price_history (
    price_tier_item_id, tier_id, product_source, product_id, sale_option_id,
    product_name, unit_price, pricing_unit, valid_from,
    previous_unit_price, previous_pricing_unit, event, origin,
    created_by, created_by_name
  ) values (
    v_linha.id, v_linha.tier_id, v_linha.product_source, v_linha.product_id, v_linha.sale_option_id,
    v_linha.product_name, v_preco, v_unidade, v_validade,
    case when v_tem_atual then v_atual.unit_price end,
    case when v_tem_atual then v_atual.pricing_unit end,
    v_evento, 'tabela',
    v_autor, coalesce(v_nome, case when v_autor is null then current_user::text end)
  );

  return null;
end;
$fn$;

revoke all on function private.registrar_historico_preco_buck() from public, anon, authenticated;

drop trigger if exists price_tier_items_historico_buck on public.price_tier_items;

create trigger price_tier_items_historico_buck
after insert or update or delete on public.price_tier_items
for each row execute function private.registrar_historico_preco_buck();

-- ---------------------------------------------------------------------------
-- 4. Carga inicial
-- ---------------------------------------------------------------------------
-- Toda linha da Buck sem historico recebe o estado atual "desde sempre". As
-- trocas conhecidas reescrevem o comeco com o preco antigo e acrescentam a
-- troca na data. Cada troca so se aplica se a linha ainda estiver exatamente
-- como foi medida em producao (nome, unidade, preco atual) e se o historico
-- dela for so a carga: rodar de novo nao duplica nada, e banco de teste sem
-- esses produtos fica intocado.
create or replace function private.buck_historico_carga_inicial()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_buck uuid := private.buck_tier_id();
  v_troca record;
  v_linha public.price_tier_items%rowtype;
  v_aplicadas integer := 0;
begin
  if v_buck is null then
    return 0;
  end if;

  insert into public.buck_price_history (
    price_tier_item_id, tier_id, product_source, product_id, sale_option_id,
    product_name, unit_price, pricing_unit, valid_from, event, origin, created_by_name
  )
  select linha.id, linha.tier_id, linha.product_source, linha.product_id, linha.sale_option_id,
         linha.product_name,
         case when linha.active then linha.unit_price end,
         case when linha.active then linha.pricing_unit end,
         private.buck_preco_desde_sempre(), 'carga_inicial', 'migracao', 'Carga inicial'
  from public.price_tier_items linha
  where linha.tier_id = v_buck
    and not exists (
      select 1 from public.buck_price_history historico
      where historico.price_tier_item_id = linha.id
    )
  order by linha.id;

  -- Preco antigo das cobrancas confirmadas antes da troca; data da troca nos
  -- registros de acesso (PATCH em price_tier_items, horario de Brasilia).
  for v_troca in
    select *
    from (values
      ('Italiano', 'un', 4.50::numeric, 5.89::numeric, date '2026-10-09'),
      ('Pão de Azeitonas', 'un', 9.50::numeric, 12.32::numeric, date '2026-10-09'),
      ('Italiano de Queijo e Oregano', 'un', 7.50::numeric, 11.00::numeric, date '2026-10-01'),
      ('Pão de Tapioca', 'un', 5.99::numeric, 6.00::numeric, date '2026-09-21')
    ) as troca(produto, unidade, preco_antigo, preco_novo, desde)
  loop
    for v_linha in
      select linha.*
      from public.price_tier_items linha
      where linha.tier_id = v_buck
        and linha.active
        and linha.product_name = v_troca.produto
        and linha.pricing_unit = v_troca.unidade
        and linha.unit_price = v_troca.preco_novo
        and (
          select count(*) from public.buck_price_history historico
          where historico.price_tier_item_id = linha.id
        ) = 1
        and exists (
          select 1 from public.buck_price_history historico
          where historico.price_tier_item_id = linha.id
            and historico.event = 'carga_inicial'
            and historico.unit_price = v_troca.preco_novo
        )
      order by linha.id
    loop
      insert into public.buck_price_history (
        price_tier_item_id, tier_id, product_source, product_id, sale_option_id,
        product_name, unit_price, pricing_unit, valid_from, event, origin, created_by_name
      ) values
        (v_linha.id, v_linha.tier_id, v_linha.product_source, v_linha.product_id, v_linha.sale_option_id,
         v_linha.product_name, v_troca.preco_antigo, v_troca.unidade,
         private.buck_preco_desde_sempre(), 'carga_inicial', 'migracao', 'Carga inicial'),
        (v_linha.id, v_linha.tier_id, v_linha.product_source, v_linha.product_id, v_linha.sale_option_id,
         v_linha.product_name, v_troca.preco_novo, v_troca.unidade,
         v_troca.desde, 'troca_de_preco', 'migracao', 'Carga inicial');
      -- O registro mais recente vence: o preco antigo "desde sempre" entra
      -- depois da carga com o preco atual, e a troca depois dele.

      v_aplicadas := v_aplicadas + 1;
    end loop;
  end loop;

  return v_aplicadas;
end;
$fn$;

revoke all on function private.buck_historico_carga_inicial() from public, anon, authenticated;

select private.buck_historico_carga_inicial();

-- ---------------------------------------------------------------------------
-- 5. A conta da Buck, pelo preco do dia de cada romaneio
-- ---------------------------------------------------------------------------
-- Partida da definicao vigente (20260914030000, nao redefinida depois; a
-- 20260919235223 so mexe em create_buck_weekly_receivable). Mudancas:
--   * os precos saem do historico, na data do romaneio, de todas as linhas da
--     Buck (inclusive as removidas depois), e nao mais das linhas ativas hoje;
--   * desempate deterministico: identidade direta, preco positivo, linha;
--   * agrupa tambem pelo preco: semana com troca no meio vira duas linhas.
-- Mesmo nome, argumentos e colunas: quem chama nao percebe a troca.
create or replace function private.calcular_cobranca_buck_detalhada(p_de date, p_ate date)
returns table (
  product_source text,
  product_id text,
  produto text,
  unidade text,
  quantidade numeric,
  preco_unitario numeric,
  total numeric,
  problemas text[],
  itens jsonb
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with destino as (
    select d.id from public.destinations d where upper(d.code) = 'EX' and d.active
  ),
  itens as (
    select item.id,
           item.romaneio_id,
           romaneio.record_date,
           romaneio.status as romaneio_status,
           item.product_id,
           item.product_source,
           item.product_name,
           item.qty_sent,
           item.qty_accepted,
           private.romaneio_unidade_cobranca(item.product_name) as unidade,
           private.romaneio_unidade_explicita(item.product_name) as unidade_no_nome,
           greatest(coalesce(item.qty_sent, 0), 0) as enviado,
           greatest(coalesce(item.qty_accepted, item.qty_sent, 0), 0) as cobrado
    from public.romaneio_items item
    join public.romaneios romaneio on romaneio.id = item.romaneio_id
    where romaneio.destination_id in (select id from destino)
      and romaneio.status <> 'separado'
      and romaneio.record_date between p_de and p_ate
  ),
  identidades as (
    select item.id as item_id, item.product_source as fonte, item.product_id as pid, 0 as prioridade
    from itens item
    union all
    select item.id, 'bread', produto.legacy_bread_id, 1
    from itens item
    join public.products produto on produto.id::text = item.product_id
    where item.product_source = 'product' and produto.legacy_bread_id is not null
    union all
    select item.id, 'product', produto.id::text, 1
    from itens item
    join public.products produto on produto.legacy_bread_id = item.product_id
    where item.product_source = 'bread'
  ),
  -- Linhas da Tabela Buck que ja existiram, pela identidade gravada no historico.
  linhas_buck as (
    select distinct historico.price_tier_item_id, historico.product_source, historico.product_id
    from public.buck_price_history historico
    where historico.tier_id = private.buck_tier_id()
  ),
  precos_na_data as (
    select ident.item_id,
           ident.prioridade,
           linha.price_tier_item_id,
           preco.unit_price,
           preco.pricing_unit
    from identidades ident
    join itens item on item.id = ident.item_id
    join linhas_buck linha
      on linha.product_source = ident.fonte and linha.product_id = ident.pid
    cross join lateral private.buck_preco_na_data(linha.price_tier_item_id, item.record_date) preco
    where preco.unit_price is not null
  ),
  item_com_preco as (
    select item.*,
           (select p.unit_price
              from precos_na_data p
             where p.item_id = item.id
               and p.pricing_unit = item.unidade
             order by p.prioridade, (p.unit_price > 0) desc, p.price_tier_item_id
             limit 1) as preco,
           exists (select 1
                     from precos_na_data p
                    where p.item_id = item.id
                      and p.pricing_unit in ('un', 'kg')
                      and p.pricing_unit <> item.unidade
                      and p.unit_price > 0) as tem_preco_em_outra_unidade
    from itens item
  ),
  agrupado as (
    select item.product_source,
           item.product_id,
           max(item.product_name) as produto,
           item.unidade,
           item.preco as preco_unitario,
           min(item.record_date) as primeiro_dia,
           sum(item.cobrado) as quantidade,
           bool_or(item.preco is null or item.preco <= 0) as sem_preco,
           bool_or(item.tem_preco_em_outra_unidade and (item.preco is null or item.preco <= 0)) as unidade_errada_preco,
           bool_or(item.unidade_no_nome is not null and item.unidade_no_nome <> item.unidade) as unidade_errada_nome,
           bool_or(item.unidade = 'kg' and (item.enviado > 10 or item.cobrado > 10)) as peso_suspeito,
           jsonb_agg(jsonb_build_object(
             'romaneio_id', item.romaneio_id,
             'romaneio_item_id', item.id,
             'record_date', item.record_date,
             'romaneio_status', item.romaneio_status,
             'qty_sent', item.qty_sent,
             'qty_accepted', item.qty_accepted,
             'quantidade_usada', item.cobrado,
             'origem_quantidade', case when item.qty_accepted is null then 'enviado' else 'aceito' end
           ) order by item.record_date, item.id) as itens
    from item_com_preco item
    group by item.product_source, item.product_id, item.product_name, item.unidade, item.preco
  )
  select g.product_source,
         g.product_id,
         g.produto,
         g.unidade,
         g.quantidade,
         case when g.sem_preco then null else g.preco_unitario end,
         case when g.sem_preco or g.unidade_errada_preco or g.unidade_errada_nome or g.peso_suspeito
              then null
              else round(g.quantidade * g.preco_unitario, 2) end,
         array_remove(array[
           case when g.sem_preco and not g.unidade_errada_preco then 'missing_price' end,
           case when g.unidade_errada_nome or g.unidade_errada_preco then 'unit_mismatch' end,
           case when g.peso_suspeito then 'suspicious_quantity' end
         ], null),
         g.itens
  from agrupado g
  order by g.produto, g.unidade, g.primeiro_dia, g.preco_unitario nulls first;
$fn$;

revoke all on function private.calcular_cobranca_buck_detalhada(date, date) from public, anon, authenticated;

-- A impressao digital passa a ordenar tambem pelo preco: duas linhas do mesmo
-- produto (troca no meio da semana) nao empatam mais. Mesmo conteudo de antes
-- em cada linha.
create or replace function private.buck_hash_composicao(p_detalhe jsonb)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select md5(coalesce((
    select jsonb_agg(
             jsonb_build_array(
               linha.value ->> 'product_source',
               linha.value ->> 'product_id',
               linha.value ->> 'produto',
               linha.value ->> 'unidade',
               linha.value ->> 'quantidade',
               linha.value ->> 'preco_unitario',
               linha.value ->> 'total'
             )
             order by linha.value ->> 'product_source', linha.value ->> 'product_id',
                      linha.value ->> 'produto', linha.value ->> 'unidade',
                      linha.value ->> 'preco_unitario', linha.value ->> 'quantidade',
                      linha.value ->> 'total'
           )
    from jsonb_array_elements(coalesce(p_detalhe, '[]'::jsonb)) linha
  ), '[]'::jsonb)::text);
$fn$;

revoke all on function private.buck_hash_composicao(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Leitura do Fechamento EX
-- ---------------------------------------------------------------------------
-- Quem le o Fechamento EX hoje: quem le a Tabela Buck (admin, financeiro, ou
-- relatorios.acessar + romaneio.visualizar da EX) E le os romaneios da EX
-- (romaneio.visualizar ou romaneio.administrar da EX). A funcao roda como dona
-- e passa por cima das policies, entao exige as duas leituras juntas.
create or replace function private.pode_ler_fechamento_ex()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select (
    exists (
      select 1
      from public.app_profiles profile
      where profile.user_id = (select auth.uid())
        and profile.active
        and profile.role = any (array['admin'::text, 'financeiro'::text])
    )
    or (
      private.current_user_has_permission('relatorios.acessar')
      and private.current_user_has_permission('romaneio.visualizar', 'ex')
    )
  )
  and exists (
    select 1
    from public.destinations destino
    where upper(destino.code) = 'EX'
      and destino.active
      and (
        private.current_user_has_permission('romaneio.visualizar', destino.code)
        or private.current_user_has_permission('romaneio.administrar', destino.code)
      )
  );
$fn$;

revoke all on function private.pode_ler_fechamento_ex() from public, anon, authenticated;

create or replace function public.list_romaneio_ex_billing(p_de date, p_ate date)
returns table (
  product_source text,
  product_id text,
  produto text,
  unidade text,
  quantidade numeric,
  preco_unitario numeric,
  total numeric,
  problemas text[],
  itens jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not private.pode_ler_fechamento_ex() then
    raise exception using errcode = '42501', message = 'Sem permissão para ver o Fechamento EX.';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de then
    raise exception using errcode = '22023', message = 'Informe um período válido.';
  end if;
  if p_ate - p_de > 400 then
    raise exception using errcode = '22023', message = 'Escolha um período de até 400 dias.';
  end if;

  return query
  select detalhe.product_source, detalhe.product_id, detalhe.produto, detalhe.unidade,
         detalhe.quantidade, detalhe.preco_unitario, detalhe.total, detalhe.problemas,
         detalhe.itens
  from private.calcular_cobranca_buck_detalhada(p_de, p_ate) detalhe;
end;
$fn$;

revoke all on function public.list_romaneio_ex_billing(date, date) from public, anon;
grant execute on function public.list_romaneio_ex_billing(date, date) to authenticated;

commit;
