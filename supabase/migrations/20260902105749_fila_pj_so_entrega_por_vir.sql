-- A fila da Producao PJ deixa de mostrar pedido cuja entrega ja passou.
--
-- O QUE ACONTECEU. Em 02/09/2026, primeiro dia de uso real da tela, a Geolar
-- abriu a Producao PJ e encontrou 199 linhas de 78 pedidos, a mais antiga de
-- 02/06, somando 6.385 unidades. So 29 delas tinham entrega ainda por vir.
--
-- POR QUE. A fila decidia o que ainda falta produzir olhando um campo so, o de
-- expedicao. Esse campo passou a existir em 21/07/2026: tudo anterior esta vazio
-- por falta de campo, nao por falta de entrega. Sao 115 das 199. Das outras, 166
-- ja viraram cobranca, ou seja, o proprio sistema ja sabia que foram entregues e
-- faturadas, e a fila nao olhava para isso.
--
-- O RISCO REAL nao era poluicao visual: era alguem programar producao de um
-- pedido entregue em junho e assar pao que ninguem pediu.
--
-- A REGRA. Um pedido so continua pendente de producao enquanto a entrega dele
-- nao passou. Pedido SEM data de entrega continua aparecendo de proposito: ele ja
-- vem com o aviso "Pedido sem data de entrega", nao pode ser programado, e
-- esconde-lo faria a pendencia sumir sem ninguem consertar o cadastro.
--
-- POR QUE A DATA DE ENTREGA E NAO A DO PEDIDO. O Rodrigo pediu para limpar "de
-- 01/09 para tras". Medido antes de aplicar: as 29 linhas legitimas foram TODAS
-- pedidas em 31/08 e 01/09, com entrega entre 02 e 04/09. Cortar pela data do
-- pedido apagaria exatamente o que a padaria precisa produzir esta semana.
--
-- CONSEQUENCIA CONHECIDA. Pedido atrasado, cuja entrega passou sem producao,
-- some da fila. Hoje isso nao custa nada, porque todos os atrasados ja foram
-- entregues. Se a operacao mostrar que atraso real acontece, o conserto e dar
-- uma folga de um ou dois dias nesta mesma linha, nao remover a regra.
--
-- Data da padaria, nunca a do servidor: o banco conta em UTC e a padaria vive em
-- America/Sao_Paulo, entao entre 21h e meia-noite o servidor ja esta no dia
-- seguinte e a fila perderia um dia de trabalho.

create or replace function public.list_pj_production_queue()
returns table (
  order_id uuid,
  order_group_id uuid,
  customer_id uuid,
  customer_name text,
  order_date date,
  delivery_date date,
  product_name text,
  canonical_bread_id text,
  pricing_unit text,
  ordered_quantity numeric,
  scheduled_quantity numeric,
  pending_quantity numeric,
  frozen_available numeric,
  last_scheduled_date date,
  mapping_error text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.current_user_can_plan_pj_production() then
    raise exception using errcode = '42501', message = 'Usuario sem permissao para organizar a producao PJ.';
  end if;

  return query
  with resolved as (
    select
      order_row.*,
      case
        when coalesce(order_row.product_source, 'bread') = 'bread' then order_row.bread_id
        when order_row.product_source = 'product' then product.legacy_bread_id
        else null
      end as resolved_bread_id
    from public.orders order_row
    left join public.products product
      on order_row.product_source = 'product'
     and product.id::text = order_row.bread_id
    where order_row.order_type = 'pj'
      and order_row.cancelled_at is null
      and order_row.dispatched_at is null
      and order_row.quantity > 0
      and (
        coalesce(order_row.delivery_date, order_row.pj_delivery_date) is null
        or coalesce(order_row.delivery_date, order_row.pj_delivery_date) >= private.data_na_padaria()
      )
  ), scheduled as (
    select
      schedule.order_id,
      sum(schedule.scheduled_quantity)::numeric as quantity,
      max(schedule.production_date) as last_production_date
    from public.pj_production_schedules schedule
    group by schedule.order_id
  )
  select
    resolved.id,
    resolved.order_group_id,
    resolved.customer_id,
    coalesce(customer.name, resolved.pj_client, 'Cliente PJ'),
    resolved.order_date,
    coalesce(resolved.delivery_date, resolved.pj_delivery_date),
    coalesce(resolved.product_name, bread.name, resolved.bread_id),
    resolved.resolved_bread_id,
    coalesce(resolved.pricing_unit, bread.unit, 'un'),
    resolved.quantity,
    coalesce(scheduled.quantity, 0),
    greatest(0, resolved.quantity - coalesce(scheduled.quantity, 0)),
    case when resolved.resolved_bread_id is null then 0 else greatest(
      0,
      private.frozen_stock_for_bread_store(resolved.resolved_bread_id, 'jc')
        - private.reserved_frozen_for_bread_store(resolved.resolved_bread_id, 'jc', null)
    ) end,
    scheduled.last_production_date,
    case
      when resolved.resolved_bread_id is null or bread.id is null then 'Produto sem vinculo com um pao do Forno.'
      when coalesce(resolved.delivery_date, resolved.pj_delivery_date) is null then 'Pedido sem data de entrega.'
      else null
    end
  from resolved
  left join scheduled on scheduled.order_id = resolved.id
  left join public.customers customer on customer.id = resolved.customer_id
  left join public.breads bread on bread.id = resolved.resolved_bread_id
  where resolved.quantity - coalesce(scheduled.quantity, 0) > 0
  order by
    coalesce(resolved.delivery_date, resolved.pj_delivery_date) asc nulls first,
    coalesce(customer.name, resolved.pj_client, 'Cliente PJ'),
    resolved.order_group_id,
    coalesce(resolved.product_name, bread.name, resolved.bread_id);
end;
$$;

-- Grants reafirmados de proposito. CREATE OR REPLACE preserva privilegios, mas o
-- AGENTS.md manda a migration tratar grant explicitamente em vez de confiar no
-- que ja estava la.
revoke all on function public.list_pj_production_queue()
  from public, anon, authenticated;
grant execute on function public.list_pj_production_queue()
  to authenticated, service_role;
