alter table public.orders
  add column if not exists order_group_id uuid,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by text,
  add column if not exists cancel_reason text;

create index if not exists orders_order_group_id_idx
  on public.orders (order_group_id)
  where order_group_id is not null;

with legacy_group_keys as (
  select distinct
    o.order_type,
    case
      when o.order_type = 'pj'
        then coalesce(o.customer_id::text, o.pj_client, '')
      when o.customer_id is not null
        then 'c:' || o.customer_id::text
      else 'w:' || coalesce(o.walkin_name, '')
    end as customer_key,
    o.order_date,
    o.delivery_date
  from public.orders o
  where o.order_group_id is null
    and o.order_type in ('pj', 'encomenda')
),
legacy_groups as materialized (
  select
    k.*,
    gen_random_uuid() as order_group_id
  from legacy_group_keys k
)
update public.orders o
set order_group_id = g.order_group_id
from legacy_groups g
where o.order_group_id is null
  and o.order_type = g.order_type
  and (
    case
      when o.order_type = 'pj'
        then coalesce(o.customer_id::text, o.pj_client, '')
      when o.customer_id is not null
        then 'c:' || o.customer_id::text
      else 'w:' || coalesce(o.walkin_name, '')
    end
  ) = g.customer_key
  and o.order_date is not distinct from g.order_date
  and o.delivery_date is not distinct from g.delivery_date;

comment on column public.orders.order_group_id is
  'Identidade compartilhada pelas linhas de um mesmo pedido PJ ou encomenda.';

comment on column public.orders.cancelled_at is
  'Data e hora do cancelamento lógico do pedido.';

comment on column public.orders.cancelled_by is
  'Nome exibido do usuário que cancelou o pedido.';

comment on column public.orders.cancel_reason is
  'Motivo informado no cancelamento do pedido.';
