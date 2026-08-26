-- A fila da Expedicao acumulava pedido que ela nao tinha como resolver.
--
-- Em 2026-08-26 a Rafaela via 74 pedidos em "Em aberto" e o Rodrigo via 9, na
-- mesma tela. A diferenca eram 65 pedidos, o mais antigo entregue em 04/06.
--
-- A armadilha tinha tres lados, e cada trava sozinha esta certa:
--
--   1. `hasPendingCheck` (src/lib/pjOrderList.ts) segura na fila o pedido com
--      item por conferir, para que entrega de sabado conferida na segunda nao
--      vire orfa. Vale so para o perfil da Expedicao, por isso a tela do admin
--      ficava limpa.
--   2. Conferir era recusado: 64 dos 65 ja tinham virado cobranca, e
--      `save_pj_order_dispatch_quantities` protege valor ja faturado.
--   3. "Marcar como enviado" era recusado por `confirm_pj_order_dispatch`,
--      que exige tudo conferido.
--
-- Ninguem errou. O que ninguem previu foi o encontro das duas protecoes sobre
-- pedido nascido ANTES de a conferencia existir, em 2026-08-21. O comentario da
-- migration 20260820232802 chegou a declarar a hipotese errada: "Pedido
-- anterior a esta migration tem tudo em null, entao a Expedicao confere antes
-- de enviar". Ela nao consegue: a cobranca ja fechou a porta.
--
-- Esta migration faz duas coisas.
--
-- PARTE A, dado: preenche a conferencia que ficou para tras, assumindo que saiu
-- a quantidade pedida. Decisao do Rodrigo em 2026-08-26, com a ressalva dita e
-- aceita: ninguem lembra o que saiu em junho, entao o numero e ASSUMIDO, nao
-- observado. Por isso a linha nasce marcada como ajuste retroativo, sem pessoa
-- no campo de autor, para que qualquer medicao futura do vazamento entre
-- pedido e envio consiga separar o que foi visto do que foi presumido. Sem essa
-- marca, 167 acertos perfeitos que ninguem conferiu fariam o vazamento parecer
-- menor do que e, que e o erro que a fase 1 existe para nao cometer.
--
-- NENHUM VALOR MUDA. `private.build_receivable_from_pj_order` calcula a
-- cobranca por `orders.quantity`, nunca por `dispatched_quantity` (conferido no
-- banco de producao em 2026-08-26). As 64 cobrancas que ja existem ficam
-- exatamente como estao.
--
-- PARTE B, regra: a fila passa a saber se o pedido ja virou cobranca, para
-- soltar o que nao tem mais como ser conferido. Sem isso o caso volta: basta um
-- pedido faturado antes de alguem conferir.

begin;

-- ---------------------------------------------------------------------------
-- PARTE A: a conferencia que ficou para tras
-- ---------------------------------------------------------------------------
-- A porta protegida de `private.guard_dispatched_quantity`. Sem ela o gatilho
-- recusa qualquer escrita nas colunas de conferencia, inclusive esta. Vale ate
-- o fim da transacao e e fechada no fim do bloco.
select set_config('pane.pj_check_rpc', 'on', true);

with alvo as (
  select
    order_row.id,
    order_row.order_group_id,
    order_row.quantity
  from public.orders order_row
  where order_row.order_type = 'pj'
    and order_row.cancelled_at is null
    and order_row.dispatched_at is null
    and order_row.dispatched_quantity is null
    and order_row.order_group_id is not null
    and order_row.quantity > 0
    -- Corte fixo, nao `current_date`: migration precisa produzir o mesmo
    -- resultado hoje e daqui a um mes. 2026-08-21 e a data em que a
    -- conferencia subiu (PR 251). Pedido entregue ate ali nasceu sem ter como
    -- ser conferido.
    and order_row.delivery_date is not null
    and order_row.delivery_date <= date '2026-08-21'
), historico as (
  -- O registro de que este numero foi assumido, e nao observado. `created_by`
  -- fica nulo de proposito: nao houve pessoa.
  insert into public.pj_order_quantity_checks (
    request_id,
    order_id,
    order_group_id,
    estimated_quantity,
    quantity_before,
    quantity_after,
    reason,
    created_by,
    created_by_name
  )
  select
    '5f3a9c22-1d4e-4a7b-9c68-0e2b7d5a4f10'::uuid,
    alvo.id,
    alvo.order_group_id,
    alvo.quantity,
    null,
    alvo.quantity,
    'Ajuste retroativo de 2026-08-26: assumida a quantidade do pedido. Entrega anterior a existir a conferencia, nao houve observacao real.',
    null,
    'Ajuste retroativo'
  from alvo
  returning order_id
)
update public.orders order_row
set
  dispatched_quantity = alvo.quantity,
  dispatched_quantity_reason = 'Ajuste retroativo de 2026-08-26: assumida a quantidade do pedido. Entrega anterior a existir a conferencia, nao houve observacao real.',
  dispatched_quantity_at = now(),
  dispatched_quantity_by = null,
  dispatched_quantity_by_name = 'Ajuste retroativo'
from alvo
where order_row.id = alvo.id;

-- Fecha a porta antes de qualquer outra escrita nesta transacao.
select set_config('pane.pj_check_rpc', '', true);

-- ---------------------------------------------------------------------------
-- PARTE B: a fila passa a saber o que ja virou cobranca
-- ---------------------------------------------------------------------------
-- `create or replace` nao altera tipo de retorno, entao e `drop` + `create`. E
-- o `drop` PERDE os grants: reconceder explicitamente logo abaixo, porque
-- objetos novos deste projeto nascem sem privilegio nenhum
-- (licao `grants-implicitos-variam-por-ambiente`).
drop function if exists public.list_pj_orders_for_dispatch();

create function public.list_pj_orders_for_dispatch()
returns table (
  id uuid,
  order_group_id uuid,
  customer_id uuid,
  customer_name text,
  order_date date,
  delivery_date date,
  production_date date,
  bread_id text,
  product_source text,
  product_name text,
  quantity numeric,
  pack_size numeric,
  pricing_unit text,
  sale_option_id uuid,
  obs text,
  cancelled_at timestamptz,
  dispatched_at timestamptz,
  dispatched_by uuid,
  dispatched_by_name text,
  dispatched_quantity numeric,
  dispatched_quantity_reason text,
  dispatched_quantity_at timestamptz,
  dispatched_quantity_by_name text,
  ja_virou_cobranca boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and profile.role = 'expedicao'
      and profile.store = 'jc'
      and exists (
        select 1
        from public.app_user_permissions assignment
        where assignment.user_id = profile.user_id
          and assignment.permission_key = 'pedidos_pj.acessar'
          and assignment.scope in ('*', 'jc')
      )
  ) then
    raise exception using
      errcode = '42501',
      message = 'Sem permissao para consultar a fila de Pedidos PJ.';
  end if;

  return query
  select
    order_row.id,
    order_row.order_group_id,
    order_row.customer_id,
    coalesce(customer.name, order_row.pj_client, '?') as customer_name,
    order_row.order_date,
    order_row.delivery_date,
    order_row.production_date,
    order_row.bread_id,
    order_row.product_source,
    order_row.product_name,
    order_row.quantity,
    order_row.pack_size,
    order_row.pricing_unit,
    order_row.sale_option_id,
    order_row.obs,
    order_row.cancelled_at,
    order_row.dispatched_at,
    order_row.dispatched_by,
    order_row.dispatched_by_name,
    order_row.dispatched_quantity,
    order_row.dispatched_quantity_reason,
    order_row.dispatched_quantity_at,
    order_row.dispatched_quantity_by_name,
    -- A Expedicao nao le `receivables` pela Data API, e nao deve mesmo: a fila
    -- e "sem valores". O que ela precisa saber e apenas se a porta da
    -- conferencia ja fechou, e isso e um sim ou nao, sem cifra nenhuma.
    exists (
      select 1
      from public.receivables cobranca
      where cobranca.origin = 'pedido_pj'
        and cobranca.origin_ref = order_row.order_group_id
        and cobranca.status <> 'cancelada'
    ) as ja_virou_cobranca
  from public.orders order_row
  left join public.customers customer on customer.id = order_row.customer_id
  where order_row.order_type = 'pj'
  order by order_row.order_date desc, order_row.order_group_id, order_row.id;
end;
$$;

revoke all on function public.list_pj_orders_for_dispatch() from public, anon;
grant execute on function public.list_pj_orders_for_dispatch() to authenticated;

commit;
