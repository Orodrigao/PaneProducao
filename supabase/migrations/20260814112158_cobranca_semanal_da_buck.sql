-- Contas a receber, fase 4: a conta da semana da Buck (EX).
--
-- Plano: docs/CONTAS_A_RECEBER.md. Este é o fluxo do episódio dos R$ 190 mil:
-- a conta era feita só no navegador e um número envenenado passou direto para
-- a cobrança. Por isso o valor é somado AQUI, dos itens do romaneio e da
-- tabela BUCK, e o total que a tela mostrou é apenas conferido.
--
-- A conta reproduz `src/lib/romaneioBilling.ts` regra por regra. Manter as
-- duas em acordo é dívida assumida com o Rodrigo em 2026-08-14: qualquer
-- mudança na cobrança da Buck muda os dois lugares, e a comparação de totais
-- abaixo é o alarme que dispara no dia em que alguém esquecer.

begin;

-- Necessária para a trava de período sobreposto (igualdade + intervalo no
-- mesmo índice).
create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- A cobrança passa a aceitar a origem do romaneio, e guarda o período.
-- ---------------------------------------------------------------------------
alter table public.receivables
  drop constraint if exists receivables_origin_check;

alter table public.receivables
  add constraint receivables_origin_check
    check (origin in ('avulso', 'pedido_pj', 'romaneio_ex'));

alter table public.receivables
  add column if not exists period_start date,
  add column if not exists period_end date;

comment on column public.receivables.period_start is
  'Primeiro dia do período faturado. Só existe na origem romaneio_ex.';

alter table public.receivables
  drop constraint if exists receivables_periodo_coerente;

alter table public.receivables
  add constraint receivables_periodo_coerente check (
    (period_start is null) = (period_end is null)
    and (period_start is null or period_end >= period_start)
    and (origin = 'romaneio_ex') = (period_start is not null)
  );

-- Duas contas não podem cobrir o mesmo dia. Isto é uma trava de banco, não
-- uma conferência de tela: vale inclusive para duas pessoas gerando ao mesmo
-- tempo. Cobrar o mesmo pão duas vezes é o segundo risco desta fase.
alter table public.receivables
  drop constraint if exists receivables_periodo_sem_sobreposicao;

alter table public.receivables
  add constraint receivables_periodo_sem_sobreposicao
  exclude using gist (
    origin with =,
    daterange(period_start, period_end, '[]') with &&
  )
  where (origin = 'romaneio_ex' and status <> 'cancelada' and period_start is not null);

-- ---------------------------------------------------------------------------
-- A Buck precisa de prazo para poder ser cobrada.
-- ---------------------------------------------------------------------------
-- 15 dias, combinado com o Rodrigo em 2026-08-14. Só preenche se ainda estiver
-- vazio: se alguém já tiver ajustado na tela de Clientes, a tela vence.
update public.customers
set payment_term_days = 15
where lower(trim(name)) = 'buck'
  and active
  and payment_term_days is null;

-- ---------------------------------------------------------------------------
-- Texto normalizado: sem acento e em minúsculas, como no aplicativo.
-- ---------------------------------------------------------------------------
create or replace function private.romaneio_texto_normalizado(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select lower(translate(
    coalesce(p_texto, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
  ));
$fn$;

-- A unidade em que o produto é cobrado. Espelha
-- isWeightControlledRomaneioProduct: o sufixo explícito vence, e na falta dele
-- ciabatta, mini croissant e pizza romana são cobrados por quilo.
create or replace function private.romaneio_unidade_cobranca(p_nome text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case
    when private.romaneio_texto_normalizado(p_nome) like '%(un)%' then 'un'
    when private.romaneio_texto_normalizado(p_nome) like '%(kg)%' then 'kg'
    when private.romaneio_texto_normalizado(p_nome) like '%ciabatta%' then 'kg'
    when private.romaneio_texto_normalizado(p_nome) like '%mini%'
     and private.romaneio_texto_normalizado(p_nome) like '%croissant%' then 'kg'
    when private.romaneio_texto_normalizado(p_nome) like '%pizza romana%' then 'kg'
    else 'un'
  end;
$fn$;

-- A unidade escrita no próprio nome, quando existe. Serve para acusar
-- incompatibilidade entre o que o nome diz e o preço cadastrado.
create or replace function private.romaneio_unidade_explicita(p_nome text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case
    when private.romaneio_texto_normalizado(p_nome) ~ '\(\s*kg\s*\)' then 'kg'
    when private.romaneio_texto_normalizado(p_nome) ~ '\(\s*un\s*\)' then 'un'
    else null
  end;
$fn$;

revoke all on function private.romaneio_texto_normalizado(text) from public, anon, authenticated;
revoke all on function private.romaneio_unidade_cobranca(text) from public, anon, authenticated;
revoke all on function private.romaneio_unidade_explicita(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A conta da Buck, somada no banco.
-- ---------------------------------------------------------------------------
-- Devolve uma linha por produto+unidade, como a tela agrupa, com os problemas
-- que bloqueiam a cobrança. `qty_accepted` vence `qty_sent` quando existe: a
-- Buck paga o que recebeu, não o que saiu.
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
  with tabela as (
    select tier.id from public.price_tiers tier
    where lower(trim(tier.name)) = 'buck' and tier.active
    limit 1
  ),
  destino as (
    -- Sem depender da caixa: producao grava 'EX' e o Banco Preview grava 'ex'.
    -- Todas as lojas EX ativas, e nao uma escolhida ao acaso: se houver mais
    -- de um cadastro com o mesmo codigo, `limit 1` faria a conta ignorar em
    -- silencio os romaneios do outro.
    select d.id from public.destinations d where upper(d.code) = 'EX' and d.active
  ),
  itens as (
    select item.id,
           item.romaneio_id,
           item.product_id,
           item.product_source,
           item.product_name,
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
  -- Identidades equivalentes do produto: a direta e a do outro lado da ponte
  -- pao legado <-> produto unificado. A direta tem prioridade 0 e vence.
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
    select item.product_source || ':' || item.product_id || ':' || item.product_name || ':' || item.unidade as chave,
           max(item.product_name) as produto,
           item.unidade,
           sum(item.cobrado) as quantidade,
           max(item.preco) as preco_unitario,
           bool_or(item.preco is null or item.preco <= 0) as sem_preco,
           bool_or(item.tem_preco_em_outra_unidade and (item.preco is null or item.preco <= 0)) as unidade_errada_preco,
           bool_or(item.unidade_no_nome is not null and item.unidade_no_nome <> item.unidade) as unidade_errada_nome,
           bool_or(item.unidade = 'kg' and (item.enviado > 10 or item.cobrado > 10)) as peso_suspeito
    from item_com_preco item
    group by item.product_source, item.product_id, item.product_name, item.unidade
  )
  select g.produto,
         g.unidade,
         g.quantidade,
         case when g.sem_preco then null else g.preco_unitario end,
         -- Qualquer problema zera o total da linha, exatamente como
         -- calculateRomaneioBilling faz (issues.length => unitPrice null).
         case when g.sem_preco or g.unidade_errada_preco or g.unidade_errada_nome or g.peso_suspeito
              then null
              else round(g.quantidade * g.preco_unitario, 2) end,
         array_remove(array[
           case when g.sem_preco and not g.unidade_errada_preco then 'missing_price' end,
           case when g.unidade_errada_nome or g.unidade_errada_preco then 'unit_mismatch' end,
           case when g.peso_suspeito then 'suspicious_quantity' end
         ], null)
  from agrupado g
  order by g.produto;
$fn$;

revoke all on function private.calcular_cobranca_buck(date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Gerar a conta do período.
-- ---------------------------------------------------------------------------
-- `p_total_conferencia` é o total que a tela mostrou. Ele NUNCA vira a
-- cobrança: serve para o banco recusar quando os dois cálculos discordam, e
-- mostrar os dois números. Divergência silenciosa entre a tela e o banco é
-- exatamente o que produziu o episódio dos R$ 190 mil.
create or replace function public.create_receivable_from_romaneio(
  p_request_id uuid,
  p_de date,
  p_ate date,
  p_total_conferencia numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receivable_id uuid;
  v_customer record;
  v_category_id uuid;
  v_total numeric(12,2);
  v_problemas text[];
  v_linhas integer;
  v_user_id uuid := (select auth.uid());
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador da cobrança obrigatório.';
  end if;

  if not private.current_user_can_receivables('contas_receber.lancar') then
    raise exception using errcode = '42501', message = 'Sem permissão para lançar cobranças.';
  end if;

  select existing.id into v_receivable_id
  from public.receivables existing
  where existing.request_id = p_request_id;
  if v_receivable_id is not null then
    return v_receivable_id;
  end if;

  if p_de is null or p_ate is null or p_ate < p_de then
    raise exception using errcode = '22023', message = 'Informe um período válido.';
  end if;
  if p_ate > private.data_na_padaria() then
    raise exception using errcode = '22023', message = 'O período não pode terminar no futuro.';
  end if;

  select count(*)::int, coalesce(sum(linha.total), 0)
    into v_linhas, v_total
  from private.calcular_cobranca_buck(p_de, p_ate) linha;

  -- Os problemas vêm numa consulta própria: desdobrar o array na mesma
  -- agregação multiplicaria as linhas com mais de um problema e estragaria a
  -- contagem.
  select coalesce(array_agg(distinct problema), array[]::text[])
    into v_problemas
  from private.calcular_cobranca_buck(p_de, p_ate) linha,
       unnest(linha.problemas) as problema;

  if v_linhas = 0 then
    raise exception using errcode = '22023', message = 'Nenhum romaneio da EX neste período.';
  end if;

  -- As mesmas travas que já impedem a impressão do documento.
  if 'missing_price' = any(v_problemas) then
    raise exception using errcode = '22023',
      message = 'Há produto sem preço na tabela BUCK neste período. Cadastre o preço antes de cobrar.';
  end if;
  if 'unit_mismatch' = any(v_problemas) then
    raise exception using errcode = '22023',
      message = 'Há produto com unidade incompatível entre o nome e a tabela BUCK. Corrija antes de cobrar.';
  end if;
  if 'suspicious_quantity' = any(v_problemas) then
    raise exception using errcode = '22023',
      message = 'Há quantidade suspeita por peso neste período (acima de 10 kg num romaneio). Confira o lançamento antes de cobrar.';
  end if;

  if v_total is null or v_total <= 0 then
    raise exception using errcode = '22023', message = 'O período fechou em zero. Não há o que cobrar.';
  end if;

  -- O total da tela é conferido, nunca aceito.
  if p_total_conferencia is not null and round(p_total_conferencia, 2) <> v_total then
    raise exception using errcode = '22023',
      message = 'A tela mostrou ' || to_char(round(p_total_conferencia, 2), 'FM999999990.00')
        || ' e o banco calculou ' || to_char(v_total, 'FM999999990.00')
        || '. Nada foi cobrado. Atualize a tela e confira o período.';
  end if;

  select customer.id, customer.name, customer.payment_term_days
    into v_customer
  from public.customers customer
  where lower(trim(customer.name)) = 'buck' and customer.active
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

  -- A data do faturamento é o último dia do período: semana que atravessa a
  -- virada do mês pesa no mês em que fecha (decisão 10).
  insert into public.receivables (
    request_id, customer_id, origin, origin_ref, finance_category_id, description,
    invoice_date, original_due_date, due_date, amount, period_start, period_end, created_by
  )
  values (
    p_request_id, v_customer.id, 'romaneio_ex', null, v_category_id,
    'Romaneios de ' || to_char(p_de, 'DD/MM') || ' a ' || to_char(p_ate, 'DD/MM/YYYY'),
    p_ate, p_ate + v_customer.payment_term_days, p_ate + v_customer.payment_term_days,
    v_total, p_de, p_ate, v_user_id
  )
  returning id into v_receivable_id;

  insert into public.receivable_events (receivable_id, event_type, details, created_by)
  values (
    v_receivable_id, 'lancada',
    jsonb_build_object(
      'origin', 'romaneio_ex',
      'period_start', p_de,
      'period_end', p_ate,
      'amount', v_total,
      'linhas', v_linhas
    ),
    v_user_id
  );

  return v_receivable_id;
exception
  when exclusion_violation then
    raise exception using errcode = '22023',
      message = 'Este período encosta em outro já cobrado. Confira as cobranças da Buck antes de gerar.';
end;
$$;

revoke all on function public.create_receivable_from_romaneio(uuid, date, date, numeric) from public, anon;
grant execute on function public.create_receivable_from_romaneio(uuid, date, date, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Leitura da conta pela tela, para conferir antes de gerar.
-- ---------------------------------------------------------------------------
create or replace function public.preview_receivable_from_romaneio(p_de date, p_ate date)
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
as $$
  select linha.produto, linha.unidade, linha.quantidade,
         linha.preco_unitario, linha.total, linha.problemas
  from private.calcular_cobranca_buck(p_de, p_ate) linha
  where private.current_user_can_receivables('contas_receber.acessar');
$$;

revoke all on function public.preview_receivable_from_romaneio(date, date) from public, anon;
grant execute on function public.preview_receivable_from_romaneio(date, date) to authenticated;

commit;
