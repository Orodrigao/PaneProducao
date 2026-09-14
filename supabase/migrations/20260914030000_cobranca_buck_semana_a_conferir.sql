-- Contas a receber: a semana da Buck nasce para conferencia.
--
-- Medido em producao em 13/09/2026 (so leitura): o botao "Gerar conta a
-- receber" do Fechamento EX nunca foi usado. A Elis imprime o fechamento,
-- AJUSTA O VALOR A MAO (pao que saiu sem romaneio, preco combinado fora da
-- Tabela BUCK, acerto de saldo) e lanca os recebimentos direto no livro-caixa.
-- Resultado: receita de agosto caiu em setembro e semana em aberto nao aparece
-- como valor a receber.
--
-- Decisao do Rodrigo (13/09/2026): a cobranca nao nasce pronta. Cada semana
-- fechada, de segunda a domingo, a partir de 31/08/2026, aparece no Contas a
-- receber; a Elis soma os ajustes com motivo e confirma. As semanas anteriores
-- ja estao no livro e nao entram (evita receita em dobro).
--
-- O que esta migration faz, e por que (revisao adversarial do Sol incorporada):
--   * uma regra so de soma: `private.calcular_cobranca_buck` vira projecao da
--     versao detalhada, que tambem devolve os itens de romaneio de cada linha;
--   * a cobranca guarda a FOTO das linhas e dos ajustes que a formaram:
--     conferencia feita depois nao muda em silencio o que foi cobrado;
--   * trava por pedido e por semana: duplo clique ou duas pessoas ao mesmo
--     tempo produzem uma cobranca so; repetir com ajustes diferentes e recusado;
--   * a receita da Buck so entra no livro vinda do Contas a receber, e a trava
--     fica na propria tabela do livro, para cobrir todas as portas (lancamento
--     avulso, recorrencia, classificacao de contas a pagar e as que vierem);
--   * cobranca da Buck nao e parcelada: a trava de periodo sobreposto recusaria
--     a segunda parcela, e a Buck paga em pedacos, nao em parcelas.
--
-- Deploy aditivo: nada aqui remove o que o site no ar usa. A funcao antiga
-- `create_receivable_from_romaneio` so e desligada numa fase posterior.

begin;

-- ---------------------------------------------------------------------------
-- 1. A conta da Buck, detalhada.
-- ---------------------------------------------------------------------------
-- Corpo copiado de `private.calcular_cobranca_buck` (20260814112158); a unica
-- diferenca e devolver a identidade do produto e os itens que formaram cada
-- linha. A funcao antiga passa a ler desta, para a regra nao existir duas vezes
-- no banco.
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
  with tabela as (
    select tier.id from public.price_tiers tier
    where lower(trim(tier.name)) = 'buck' and tier.active
    limit 1
  ),
  destino as (
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
  precos as (
    select preco.product_id, preco.product_source, preco.unit_price, preco.pricing_unit
    from public.price_tier_items preco
    cross join tabela
    where preco.tier_id = tabela.id and preco.active
  ),
  item_com_preco as (
    select item.*,
           (select p.unit_price
              from identidades ident
              join precos p on p.product_source = ident.fonte and p.product_id = ident.pid
             where ident.item_id = item.id
               and p.pricing_unit = item.unidade
             order by ident.prioridade, (p.unit_price > 0) desc
             limit 1) as preco,
           exists (select 1
                     from identidades ident
                     join precos p on p.product_source = ident.fonte and p.product_id = ident.pid
                    where ident.item_id = item.id
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
           sum(item.cobrado) as quantidade,
           max(item.preco) as preco_unitario,
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
    group by item.product_source, item.product_id, item.product_name, item.unidade
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
  order by g.produto, g.unidade;
$fn$;

revoke all on function private.calcular_cobranca_buck_detalhada(date, date) from public, anon, authenticated;

-- Mesma assinatura e mesmo retorno de antes: o site no ar e as funcoes que ja
-- chamam esta nao percebem a troca.
create or replace function private.calcular_cobranca_buck(p_de date, p_ate date)
returns table (
  produto text,
  unidade text,
  quantidade numeric,
  preco_unitario numeric,
  total numeric,
  problemas text[]
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select detalhe.produto, detalhe.unidade, detalhe.quantidade,
         detalhe.preco_unitario, detalhe.total, detalhe.problemas
  from private.calcular_cobranca_buck_detalhada(p_de, p_ate) detalhe
  order by detalhe.produto, detalhe.unidade;
$fn$;

revoke all on function private.calcular_cobranca_buck(date, date) from public, anon, authenticated;

-- A primeira semana que entra na lista. As anteriores ja foram recebidas e
-- lancadas direto no livro-caixa (decisao do Rodrigo, 13/09/2026).
create or replace function private.buck_primeira_semana_cobravel()
returns date
language sql
immutable
set search_path = ''
as $fn$
  select date '2026-08-31';
$fn$;

revoke all on function private.buck_primeira_semana_cobravel() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. A foto da cobranca: linhas dos romaneios e ajustes.
-- ---------------------------------------------------------------------------
create table public.receivable_romaneio_lines (
  id uuid primary key default gen_random_uuid(),
  receivable_id uuid not null references public.receivables(id) on delete restrict,
  product_source text not null,
  product_id text not null,
  product_name text not null,
  unidade text not null check (unidade in ('un', 'kg')),
  quantidade numeric not null check (quantidade >= 0),
  preco_unitario numeric not null check (preco_unitario > 0),
  total numeric(12,2) not null check (total >= 0),
  itens jsonb not null check (jsonb_typeof(itens) = 'array' and jsonb_array_length(itens) > 0),
  created_at timestamptz not null default now()
);

comment on table public.receivable_romaneio_lines is
  'Linhas de romaneio que formaram uma cobranca da Buck, congeladas na confirmacao. Conferencia posterior nao altera o que foi cobrado.';

create index receivable_romaneio_lines_receivable_idx
  on public.receivable_romaneio_lines (receivable_id);

create table public.receivable_adjustments (
  id uuid primary key default gen_random_uuid(),
  receivable_id uuid not null references public.receivables(id) on delete restrict,
  position smallint not null check (position between 1 and 20),
  kind text not null check (kind in ('produto_sem_romaneio', 'preco_combinado', 'acerto')),
  description text not null check (length(trim(description)) between 3 and 200),
  product_name text,
  quantity numeric,
  unit text,
  unit_price numeric,
  amount numeric(12,2) not null check (amount <> 0 and abs(amount) <= 5000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (receivable_id, position),
  -- Pao sem romaneio guarda o que saiu: produto, quantidade, unidade e preco,
  -- e o valor e a conta deles. Os outros dois tipos sao so valor com motivo.
  constraint receivable_adjustments_forma_coerente check (
    case when kind = 'produto_sem_romaneio' then
      product_name is not null
      and length(trim(product_name)) between 2 and 120
      and quantity > 0 and quantity <= 10000
      and unit in ('un', 'kg')
      and unit_price > 0 and unit_price <= 10000
      and amount > 0
      and amount = round(quantity * unit_price, 2)
    else
      product_name is null and quantity is null and unit is null and unit_price is null
    end
  )
);

comment on table public.receivable_adjustments is
  'Ajustes feitos pelo financeiro sobre o valor dos romaneios ao confirmar a cobranca da Buck, cada um com motivo.';

create index receivable_adjustments_receivable_idx
  on public.receivable_adjustments (receivable_id);

-- Leitura por permissao; escrita nenhuma. So a funcao de confirmacao grava.
-- Os privilegios padrao do schema public variam por ambiente (licao
-- grants-implicitos-variam): tudo e revogado e so a leitura volta.
alter table public.receivable_romaneio_lines enable row level security;
alter table public.receivable_romaneio_lines force row level security;
alter table public.receivable_adjustments enable row level security;
alter table public.receivable_adjustments force row level security;

create policy receivable_romaneio_lines_select_financeiro
on public.receivable_romaneio_lines for select to authenticated
using (private.current_user_can_receivables('contas_receber.acessar'));

create policy receivable_adjustments_select_financeiro
on public.receivable_adjustments for select to authenticated
using (private.current_user_can_receivables('contas_receber.acessar'));

revoke all on table public.receivable_romaneio_lines from public, anon, authenticated;
revoke all on table public.receivable_adjustments from public, anon, authenticated;
grant select on table public.receivable_romaneio_lines to authenticated;
grant select on table public.receivable_adjustments to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Receita da Buck no livro so vem do Contas a receber.
-- ---------------------------------------------------------------------------
-- A trava fica na tabela, e nao em cada funcao, porque a revisao encontrou tres
-- portas que gravam categoria no livro (lancamento avulso, confirmacao de
-- recorrencia e classificacao de contas a pagar), e a proxima funcao
-- privilegiada abriria uma quarta. Estorno continua livre: os lancamentos
-- diretos de agosto e setembro precisam poder ser desfeitos.
create or replace function private.guard_receita_buck_no_livro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.entry_type = 'estorno' or new.source = 'contas_receber' then
    return new;
  end if;

  -- Atualizacao que nao mexe em categoria, origem nem tipo (por exemplo, marcar
  -- o original como estornado) nao e lancamento novo de receita.
  if tg_op = 'UPDATE'
     and new.category_id is not distinct from old.category_id
     and new.source is not distinct from old.source
     and new.entry_type is not distinct from old.entry_type then
    return new;
  end if;

  if exists (
    select 1 from public.finance_categories category
    where category.id = new.category_id and category.key = 'buck_ex'
  ) then
    raise exception using errcode = '22023',
      message = 'A receita da Buck entra pelo Contas a receber: registre o recebimento na cobrança da semana, não direto no livro-caixa.';
  end if;

  return new;
end;
$fn$;

revoke all on function private.guard_receita_buck_no_livro() from public, anon, authenticated;

drop trigger if exists finance_entries_guard_receita_buck on public.finance_entries;

create trigger finance_entries_guard_receita_buck
before insert or update of category_id, source, entry_type on public.finance_entries
for each row execute function private.guard_receita_buck_no_livro();

-- ---------------------------------------------------------------------------
-- 4. As semanas da Buck a cobrar.
-- ---------------------------------------------------------------------------
-- Semana de segunda a domingo: domingo incluido para nenhum romaneio ficar
-- orfao. Aparece depois que o domingo passou, com ao menos um romaneio da EX
-- nao separado, e enquanto nenhuma cobranca viva cobrir o periodo.
--
-- "Semana fechada" e deducao de calendario; quem transforma em dinheiro e a
-- confirmacao da Elis (licao dinheiro-nasce-de-evento).
--
-- `romaneios_sem_conferencia` NAO bloqueia: medido em 13/09, boa parte dos
-- romaneios da EX nunca e conferida (12 de 19 na semana de 31/08). Esperar a
-- conferencia faria a semana nunca aparecer.
--
-- `lancamentos_diretos` avisa de receita da Buck lancada direto no livro depois
-- da semana, na janela entre esta decisao e a trava acima entrar no ar.
-- Lancamentos anteriores a 10/09 pertencem a semanas de agosto (conferido em
-- producao em 13/09) e ficam fora do aviso.
create or replace function public.list_buck_weeks_to_bill()
returns table (
  period_start date,
  period_end date,
  romaneios integer,
  romaneios_sem_conferencia integer,
  linhas integer,
  amount numeric,
  problemas text[],
  lancamentos_diretos integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with semanas as (
    select serie::date as de, (serie::date + 6) as ate
    from generate_series(
      private.buck_primeira_semana_cobravel()::timestamp,
      (private.data_na_padaria() - 7)::timestamp,
      interval '7 day'
    ) serie
  ),
  romaneios_da_semana as (
    select semana.de,
           semana.ate,
           count(*)::int as romaneios,
           count(*) filter (where romaneio.status = 'enviado')::int as sem_conferencia
    from semanas semana
    join public.romaneios romaneio
      on romaneio.record_date between semana.de and semana.ate
     and romaneio.status <> 'separado'
    join public.destinations destino
      on destino.id = romaneio.destination_id
     and upper(destino.code) = 'EX'
     and destino.active
    group by semana.de, semana.ate
  )
  select semana.de,
         semana.ate,
         semana.romaneios,
         semana.sem_conferencia,
         conta.linhas,
         conta.total,
         conta.problemas,
         diretos.quantidade
  from romaneios_da_semana semana
  cross join lateral (
    select count(*)::int as linhas,
           coalesce(sum(detalhe.total), 0)::numeric(12,2) as total,
           coalesce(
             (select array_agg(distinct problema order by problema)
                from private.calcular_cobranca_buck(semana.de, semana.ate) outra,
                     unnest(outra.problemas) as problema),
             array[]::text[]
           ) as problemas
    from private.calcular_cobranca_buck(semana.de, semana.ate) detalhe
  ) conta
  cross join lateral (
    select count(*)::int as quantidade
    from public.finance_entries entrada
    join public.finance_categories categoria
      on categoria.id = entrada.category_id and categoria.key = 'buck_ex'
    where entrada.entry_type = 'lancamento'
      and entrada.source <> 'contas_receber'
      and entrada.reversed_at is null
      and entrada.created_at >= timestamptz '2026-09-10 00:00:00-03'
      and entrada.paid_date > semana.ate
  ) diretos
  where private.current_user_can_receivables('contas_receber.acessar')
    and not exists (
      select 1 from public.receivables cobranca
      where cobranca.origin = 'romaneio_ex'
        and cobranca.status <> 'cancelada'
        and daterange(cobranca.period_start, cobranca.period_end, '[]')
            && daterange(semana.de, semana.ate, '[]')
    )
  order by semana.de;
$$;

revoke all on function public.list_buck_weeks_to_bill() from public, anon;
grant execute on function public.list_buck_weeks_to_bill() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Confirmar a semana: valor dos romaneios + ajustes com motivo.
-- ---------------------------------------------------------------------------
-- `p_total_romaneios_conferencia` e o valor dos romaneios que a tela mostrou.
-- E conferido, nunca aceito: o banco soma de novo e recusa se discordar.
--
-- `p_ajustes` e uma lista de objetos:
--   {"kind": "produto_sem_romaneio", "description", "product_name",
--    "quantity", "unit": "un"|"kg", "unit_price"}
--   {"kind": "preco_combinado" | "acerto", "description", "amount"}  (+ ou -)
--
-- Resto de semana anterior NAO e ajuste: continua em aberto na cobranca antiga.
create or replace function public.create_buck_weekly_receivable(
  p_request_id uuid,
  p_de date,
  p_ate date,
  p_total_romaneios_conferencia numeric,
  p_ajustes jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_receivable_id uuid;
  v_hash_existente text;
  v_hash text;
  v_ajustes_entrada jsonb := coalesce(p_ajustes, '[]'::jsonb);
  v_ajuste jsonb;
  v_ajustes jsonb := '[]'::jsonb;
  v_posicao integer := 0;
  v_tipo text;
  v_descricao text;
  v_produto text;
  v_quantidade numeric;
  v_unidade text;
  v_preco numeric;
  v_valor numeric;
  v_soma_ajustes numeric(12,2) := 0;
  v_detalhe jsonb;
  v_linhas integer;
  v_problemas text[];
  v_total_romaneios numeric(12,2);
  v_total numeric(12,2);
  v_sem_conferencia integer;
  v_customer record;
  v_category_id uuid;
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador da cobrança obrigatório.';
  end if;

  if not private.current_user_can_receivables('contas_receber.lancar') then
    raise exception using errcode = '42501', message = 'Sem permissão para lançar cobranças.';
  end if;

  if p_de is null or p_ate is null then
    raise exception using errcode = '22023', message = 'Informe a semana da cobrança.';
  end if;

  -- Os ajustes sao normalizados antes de tudo: a repeticao do mesmo pedido so
  -- devolve a cobranca existente se o conteudo for o mesmo.
  if jsonb_typeof(v_ajustes_entrada) <> 'array' then
    raise exception using errcode = '22023', message = 'Ajustes em formato inválido.';
  end if;
  if jsonb_array_length(v_ajustes_entrada) > 20 then
    raise exception using errcode = '22023', message = 'No máximo 20 ajustes por semana.';
  end if;

  for v_ajuste in select elemento.value from jsonb_array_elements(v_ajustes_entrada) elemento loop
    v_posicao := v_posicao + 1;
    if jsonb_typeof(v_ajuste) <> 'object' then
      raise exception using errcode = '22023', message = 'Ajuste ' || v_posicao || ' em formato inválido.';
    end if;

    v_tipo := v_ajuste ->> 'kind';
    v_descricao := trim(coalesce(v_ajuste ->> 'description', ''));
    if v_tipo is null or v_tipo not in ('produto_sem_romaneio', 'preco_combinado', 'acerto') then
      raise exception using errcode = '22023', message = 'Ajuste ' || v_posicao || ': tipo inválido.';
    end if;
    if length(v_descricao) < 3 or length(v_descricao) > 200 then
      raise exception using errcode = '22023',
        message = 'Ajuste ' || v_posicao || ': descreva o motivo com 3 a 200 letras.';
    end if;

    if v_tipo = 'produto_sem_romaneio' then
      v_produto := trim(coalesce(v_ajuste ->> 'product_name', ''));
      v_unidade := v_ajuste ->> 'unit';
      begin
        v_quantidade := (v_ajuste ->> 'quantity')::numeric;
        v_preco := (v_ajuste ->> 'unit_price')::numeric;
      exception when others then
        raise exception using errcode = '22023',
          message = 'Ajuste ' || v_posicao || ': quantidade ou preço inválido.';
      end;
      if length(v_produto) < 2 or length(v_produto) > 120 then
        raise exception using errcode = '22023',
          message = 'Ajuste ' || v_posicao || ': informe o produto que saiu sem romaneio.';
      end if;
      if v_quantidade is null or v_quantidade <= 0 or v_quantidade > 10000 then
        raise exception using errcode = '22023',
          message = 'Ajuste ' || v_posicao || ': quantidade precisa ser maior que zero.';
      end if;
      if v_unidade is null or v_unidade not in ('un', 'kg') then
        raise exception using errcode = '22023',
          message = 'Ajuste ' || v_posicao || ': unidade precisa ser un ou kg.';
      end if;
      if v_preco is null or v_preco <= 0 or v_preco > 10000 then
        raise exception using errcode = '22023',
          message = 'Ajuste ' || v_posicao || ': preço precisa ser maior que zero.';
      end if;
      v_valor := round(v_quantidade * v_preco, 2);
      if v_valor <= 0 or v_valor > 5000 then
        raise exception using errcode = '22023',
          message = 'Ajuste ' || v_posicao || ': cada ajuste vai até R$ 5.000,00.';
      end if;
    else
      v_produto := null;
      v_quantidade := null;
      v_unidade := null;
      v_preco := null;
      begin
        v_valor := round((v_ajuste ->> 'amount')::numeric, 2);
      exception when others then
        raise exception using errcode = '22023', message = 'Ajuste ' || v_posicao || ': valor inválido.';
      end;
      if v_valor is null or v_valor = 0 or abs(v_valor) > 5000 then
        raise exception using errcode = '22023',
          message = 'Ajuste ' || v_posicao || ': informe um valor diferente de zero, até R$ 5.000,00 para mais ou para menos.';
      end if;
    end if;

    v_soma_ajustes := v_soma_ajustes + v_valor;
    v_ajustes := v_ajustes || jsonb_build_array(jsonb_build_object(
      'position', v_posicao,
      'kind', v_tipo,
      'description', v_descricao,
      'product_name', v_produto,
      'quantity', v_quantidade,
      'unit', v_unidade,
      'unit_price', v_preco,
      'amount', v_valor
    ));
  end loop;

  v_hash := md5(jsonb_build_object('de', p_de, 'ate', p_ate, 'ajustes', v_ajustes)::text);

  -- Trava por pedido: duas chamadas com o mesmo identificador esperam uma pela
  -- outra, e a segunda encontra a cobranca pronta em vez de bater na unicidade
  -- (achado 9 da auditoria do modulo).
  perform pg_advisory_xact_lock(hashtextextended('cobranca-buck-pedido:' || p_request_id::text, 0));

  select existente.id,
         (select evento.details ->> 'payload_hash'
            from public.receivable_events evento
           where evento.receivable_id = existente.id
             and evento.event_type = 'lancada'
           order by evento.created_at
           limit 1)
    into v_receivable_id, v_hash_existente
  from public.receivables existente
  where existente.request_id = p_request_id;

  if v_receivable_id is not null then
    if v_hash_existente is distinct from v_hash then
      raise exception using errcode = '22023',
        message = 'Este pedido de cobrança já foi usado com outra semana ou outros ajustes. Atualize a tela e confira as cobranças da Buck.';
    end if;
    return v_receivable_id;
  end if;

  if extract(isodow from p_de) <> 1 or p_ate <> p_de + 6 then
    raise exception using errcode = '22023', message = 'A cobrança da Buck vai de segunda a domingo.';
  end if;
  if p_de < private.buck_primeira_semana_cobravel() then
    raise exception using errcode = '22023',
      message = 'Semanas anteriores a 31/08/2026 já foram lançadas no livro-caixa e não entram aqui.';
  end if;
  if p_ate >= private.data_na_padaria() then
    raise exception using errcode = '22023', message = 'A semana ainda não terminou. Cobre depois do domingo.';
  end if;

  -- Trava por semana: dois identificadores diferentes para a mesma semana nao
  -- geram duas cobrancas nem esbarram na trava de periodo com erro cru.
  perform pg_advisory_xact_lock(hashtextextended('cobranca-buck-semana:' || p_de::text, 0));

  if exists (
    select 1 from public.receivables cobranca
    where cobranca.origin = 'romaneio_ex'
      and cobranca.status <> 'cancelada'
      and daterange(cobranca.period_start, cobranca.period_end, '[]') && daterange(p_de, p_ate, '[]')
  ) then
    raise exception using errcode = '22023',
      message = 'Esta semana já tem cobrança da Buck. Confira a lista de cobranças.';
  end if;

  -- Uma leitura so da conta: linhas gravadas, total e travas saem do mesmo
  -- retrato, sem janela para um romaneio mudar entre uma consulta e outra.
  select coalesce(jsonb_agg(to_jsonb(detalhe) order by detalhe.produto, detalhe.unidade), '[]'::jsonb)
    into v_detalhe
  from private.calcular_cobranca_buck_detalhada(p_de, p_ate) detalhe;

  v_linhas := jsonb_array_length(v_detalhe);
  if v_linhas = 0 then
    raise exception using errcode = '22023', message = 'Nenhum romaneio da EX nesta semana.';
  end if;

  select coalesce(array_agg(distinct problema.value), array[]::text[])
    into v_problemas
  from jsonb_array_elements(v_detalhe) linha,
       jsonb_array_elements_text(linha.value -> 'problemas') problema;

  if 'missing_price' = any(v_problemas) then
    raise exception using errcode = '22023',
      message = 'Há produto sem preço na tabela BUCK nesta semana. Cadastre o preço antes de cobrar.';
  end if;
  if 'unit_mismatch' = any(v_problemas) then
    raise exception using errcode = '22023',
      message = 'Há produto com unidade incompatível entre o nome e a tabela BUCK. Corrija antes de cobrar.';
  end if;
  if 'suspicious_quantity' = any(v_problemas) then
    raise exception using errcode = '22023',
      message = 'Há quantidade suspeita por peso nesta semana (acima de 10 kg num romaneio). Confira o lançamento antes de cobrar.';
  end if;

  select coalesce(sum((linha.value ->> 'total')::numeric), 0)
    into v_total_romaneios
  from jsonb_array_elements(v_detalhe) linha;

  if v_total_romaneios <= 0 then
    raise exception using errcode = '22023', message = 'Os romaneios desta semana fecharam em zero. Não há o que cobrar.';
  end if;

  if p_total_romaneios_conferencia is null
     or round(p_total_romaneios_conferencia, 2) <> v_total_romaneios then
    raise exception using errcode = '22023',
      message = 'A tela mostrou ' || coalesce(to_char(round(p_total_romaneios_conferencia, 2), 'FM999999990.00'), 'nenhum valor')
        || ' nos romaneios e o banco calculou ' || to_char(v_total_romaneios, 'FM999999990.00')
        || '. Nada foi cobrado. Atualize a tela e confira a semana.';
  end if;

  v_total := v_total_romaneios + v_soma_ajustes;
  if v_total <= 0 then
    raise exception using errcode = '22023',
      message = 'Com os ajustes, a cobrança ficaria em zero ou negativa. Confira os valores.';
  end if;
  if v_total > 1000000 then
    raise exception using errcode = '22023', message = 'Valor acima do limite permitido. Confira o que foi digitado.';
  end if;

  select count(distinct item.value ->> 'romaneio_id')::int
    into v_sem_conferencia
  from jsonb_array_elements(v_detalhe) linha,
       jsonb_array_elements(linha.value -> 'itens') item
  where item.value ->> 'romaneio_status' = 'enviado';

  select customer.id, customer.payment_term_days
    into v_customer
  from public.customers customer
  where lower(trim(customer.name)) = 'buck' and customer.active
  order by customer.created_at nulls last, customer.id
  limit 1;
  if v_customer.id is null then
    raise exception using errcode = 'P0002', message = 'Cliente Buck não encontrado no cadastro.';
  end if;
  if v_customer.payment_term_days is null then
    raise exception using errcode = '22023',
      message = 'A Buck ainda não tem prazo de pagamento cadastrado. Defina o prazo na tela de Clientes antes de cobrar.';
  end if;

  select category.id into v_category_id
  from public.finance_categories category
  where category.key = 'buck_ex' and category.active;
  if v_category_id is null then
    raise exception using errcode = 'P0002', message = 'Categoria de receita da Buck não encontrada.';
  end if;

  -- Faturamento no ultimo dia da semana: a receita pesa no mes em que a semana
  -- fecha (decisao 10). A cobranca nasce inteira (decisao 13).
  v_receivable_id := private.emitir_cobrancas(
    p_request_id, v_customer.id, 'romaneio_ex', null, v_category_id,
    'Buck · semana de ' || to_char(p_de, 'DD/MM') || ' a ' || to_char(p_ate, 'DD/MM/YYYY'),
    p_ate, v_total, v_customer.payment_term_days, 1, v_user_id, p_de, p_ate,
    jsonb_build_object(
      'fluxo', 'semana_a_conferir',
      'period_start', p_de,
      'period_end', p_ate,
      'linhas', v_linhas,
      'total_romaneios', v_total_romaneios,
      'total_ajustes', v_soma_ajustes,
      'ajustes', jsonb_array_length(v_ajustes),
      'romaneios_sem_conferencia', v_sem_conferencia,
      'payload_hash', v_hash
    )
  );

  insert into public.receivable_romaneio_lines (
    receivable_id, product_source, product_id, product_name, unidade,
    quantidade, preco_unitario, total, itens
  )
  select v_receivable_id,
         linha.value ->> 'product_source',
         linha.value ->> 'product_id',
         linha.value ->> 'produto',
         linha.value ->> 'unidade',
         (linha.value ->> 'quantidade')::numeric,
         (linha.value ->> 'preco_unitario')::numeric,
         (linha.value ->> 'total')::numeric,
         linha.value -> 'itens'
  from jsonb_array_elements(v_detalhe) linha;

  insert into public.receivable_adjustments (
    receivable_id, position, kind, description, product_name, quantity, unit, unit_price, amount, created_by
  )
  select v_receivable_id,
         (ajuste.value ->> 'position')::smallint,
         ajuste.value ->> 'kind',
         ajuste.value ->> 'description',
         ajuste.value ->> 'product_name',
         (ajuste.value ->> 'quantity')::numeric,
         ajuste.value ->> 'unit',
         (ajuste.value ->> 'unit_price')::numeric,
         (ajuste.value ->> 'amount')::numeric,
         v_user_id
  from jsonb_array_elements(v_ajustes) ajuste;

  -- O valor cobrado e a soma do que ficou gravado, conferido aqui mesmo.
  if (select coalesce(sum(linha.total), 0) from public.receivable_romaneio_lines linha
       where linha.receivable_id = v_receivable_id)
     + (select coalesce(sum(ajuste.amount), 0) from public.receivable_adjustments ajuste
         where ajuste.receivable_id = v_receivable_id)
     <> (select cobranca.amount from public.receivables cobranca where cobranca.id = v_receivable_id) then
    raise exception using errcode = 'XX000',
      message = 'A soma das linhas não bate com o valor da cobrança. Nada foi cobrado.';
  end if;

  return v_receivable_id;
exception
  when exclusion_violation then
    raise exception using errcode = '22023',
      message = 'Esta semana encosta em outra cobrança da Buck já feita. Confira as cobranças antes de gerar.';
end;
$$;

revoke all on function public.create_buck_weekly_receivable(uuid, date, date, numeric, jsonb) from public, anon;
grant execute on function public.create_buck_weekly_receivable(uuid, date, date, numeric, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Cobranca da Buck nao e parcelada.
-- ---------------------------------------------------------------------------
-- Corpo copiado de 20260814165657_dividir_cobranca_em_parcelas.sql; a unica
-- diferenca e a recusa da origem romaneio_ex. Sem ela, a segunda parcela bate
-- na trava de periodo sobreposto com erro cru, depois de a primeira ja ter
-- sido reescrita.
create or replace function public.split_receivable(
  p_request_id uuid,
  p_receivable_id uuid,
  p_parcelas integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_prazo integer;
  v_base numeric(12,2);
  v_resto numeric(12,2);
  v_valor numeric(12,2);
  v_vencimento date;
  v_descricao_base text;
  v_user_id uuid := (select auth.uid());
  i integer;
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador da divisão obrigatório.';
  end if;

  if not private.current_user_can_receivables('contas_receber.lancar') then
    raise exception using errcode = '42501', message = 'Sem permissão para dividir cobranças.';
  end if;

  if p_parcelas is null or p_parcelas < 2 or p_parcelas > 12 then
    raise exception using errcode = '22023', message = 'Divida em 2 a 12 parcelas.';
  end if;

  select cobranca.* into v_row
  from public.receivables cobranca
  where cobranca.id = p_receivable_id
  for update;
  if v_row.id is null then
    raise exception using errcode = 'P0002', message = 'Cobrança não encontrada.';
  end if;

  if v_row.origin = 'romaneio_ex' then
    raise exception using errcode = '22023',
      message = 'A cobrança da Buck não é dividida em parcelas: registre cada pagamento como um recebimento.';
  end if;

  if exists (
    select 1 from public.receivable_events evento
    where evento.receivable_id = p_receivable_id
      and evento.event_type = 'dividida'
      and evento.details ->> 'request_id' = p_request_id::text
  ) then
    return;
  end if;

  if private.receivable_recebido(p_receivable_id) > 0 then
    raise exception using errcode = '22023',
      message = 'Esta cobrança já recebeu dinheiro. Estorne os recebimentos antes de dividir.';
  end if;
  if v_row.installment_count > 1 then
    raise exception using errcode = '22023',
      message = 'Esta cobrança já é uma parcela. Divida a cobrança inteira, não um pedaço dela.';
  end if;
  if v_row.status <> 'aberta' then
    raise exception using errcode = '22023',
      message = 'Só uma cobrança em aberto pode ser dividida.';
  end if;

  v_prazo := v_row.due_date - v_row.invoice_date;
  if v_prazo < p_parcelas then
    raise exception using errcode = '22023',
      message = 'O prazo de ' || v_prazo || ' dia(s) desta cobrança é curto demais para dividir em '
        || p_parcelas || ' vezes.';
  end if;
  if v_row.amount < p_parcelas * 0.01 then
    raise exception using errcode = '22023', message = 'Valor pequeno demais para dividir.';
  end if;

  v_descricao_base := v_row.description;
  v_base := trunc(v_row.amount / p_parcelas, 2);
  v_resto := round(v_row.amount - (v_base * p_parcelas), 2);

  for i in 1 .. p_parcelas loop
    v_valor := v_base + case when i = 1 then v_resto else 0 end;
    v_vencimento := v_row.invoice_date + private.vencimento_da_parcela(v_prazo, i, p_parcelas);

    if i = 1 then
      update public.receivables
      set amount = v_valor,
          due_date = v_vencimento,
          original_due_date = v_vencimento,
          installment_number = 1,
          installment_count = p_parcelas,
          description = v_descricao_base || ' · parcela 1/' || p_parcelas
      where id = p_receivable_id;
    else
      insert into public.receivables (
        request_id, customer_id, origin, origin_ref, finance_category_id, description,
        invoice_date, original_due_date, due_date, amount,
        installment_number, installment_count, period_start, period_end, created_by
      )
      values (
        gen_random_uuid(), v_row.customer_id, v_row.origin, v_row.origin_ref,
        v_row.finance_category_id, v_descricao_base || ' · parcela ' || i || '/' || p_parcelas,
        v_row.invoice_date, v_vencimento, v_vencimento, v_valor,
        i, p_parcelas, v_row.period_start, v_row.period_end, v_user_id
      );
    end if;
  end loop;

  insert into public.receivable_events (receivable_id, event_type, details, created_by)
  values (
    p_receivable_id, 'dividida',
    jsonb_build_object(
      'request_id', p_request_id,
      'parcelas', p_parcelas,
      'valor_original', v_row.amount,
      'vencimento_original', v_row.due_date
    ),
    v_user_id
  );
end;
$$;

revoke all on function public.split_receivable(uuid, uuid, integer) from public, anon;
grant execute on function public.split_receivable(uuid, uuid, integer) to authenticated;

commit;
