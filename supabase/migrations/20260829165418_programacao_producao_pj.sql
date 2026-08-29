-- Programacao diaria da producao PJ.
--
-- O Comercial informa quando entrega. A Producao decide, linha por linha,
-- quanto entra na fornada de hoje. O Forno le somente esta programacao e nao
-- volta a inferir a data pela entrega.

create table public.pj_production_schedules (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  production_date date not null,
  bread_id text not null references public.breads(id) on delete restrict,
  scheduled_quantity numeric(12,3) not null,
  frozen_quantity numeric(12,3) not null default 0,
  request_id uuid not null,
  created_by uuid not null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  constraint pj_production_schedules_quantity_positive
    check (scheduled_quantity > 0 and scheduled_quantity <= 1000000),
  constraint pj_production_schedules_frozen_valid
    check (
      frozen_quantity >= 0
      and frozen_quantity <= scheduled_quantity
      and frozen_quantity = trunc(frozen_quantity)
    ),
  constraint pj_production_schedules_one_line_per_day
    unique (order_id, production_date),
  constraint pj_production_schedules_request_line_unique
    unique (request_id, order_id)
);

comment on table public.pj_production_schedules is
  'Partes de linhas PJ que a Producao decidiu atender em cada dia. E a unica fonte PJ do Forno.';
comment on column public.pj_production_schedules.scheduled_quantity is
  'Quantidade retirada da pendencia do pedido assim que Geolar programa.';
comment on column public.pj_production_schedules.frozen_quantity is
  'Parte atendida manualmente com congelado da producao central; nao entra no Forno.';
comment on column public.pj_production_schedules.request_id is
  'Chave da acao da tela para que uma repeticao de rede nao programe duas vezes.';

create index pj_production_schedules_date_bread_idx
  on public.pj_production_schedules (production_date, bread_id);

alter table public.pj_production_schedules enable row level security;
alter table public.pj_production_schedules force row level security;

revoke all on table public.pj_production_schedules from public, anon, authenticated;
grant all on table public.pj_production_schedules to service_role;

create policy pj_production_schedules_service_role
on public.pj_production_schedules
for all to service_role
using (true)
with check (true);

create or replace function private.current_user_can_plan_pj_production()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and profile.role in ('admin', 'producao')
  );
$$;

revoke all on function private.current_user_can_plan_pj_production()
  from public, anon, authenticated;
grant execute on function private.current_user_can_plan_pj_production()
  to authenticated, service_role;

create or replace function private.frozen_stock_for_bread_store(
  p_bread_id text,
  p_store text
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(stock.quantity), 0)::numeric
  from public.frozen_stock stock
  join public.frozen_products product
    on product.id = stock.frozen_product_id
   and product.active
   and product.product_source = 'bread'
   and product.product_id = p_bread_id
  where case
    when lower(stock.location) in ('freezer', 'camara', 'freezer_loja') then 'jc'
    when lower(stock.location) like 'jc-%' then 'jc'
    when lower(stock.location) like 'ja-%' then 'ja'
    else null
  end = lower(p_store)
  and (
    (product.store is null and product.visible_stores is null)
    or lower(product.store) = lower(p_store)
    or lower(p_store) = any(coalesce(product.visible_stores, '{}'::text[]))
  );
$$;

revoke all on function private.frozen_stock_for_bread_store(text, text)
  from public, anon, authenticated;
grant execute on function private.frozen_stock_for_bread_store(text, text)
  to service_role;

create or replace function private.reserved_frozen_for_bread_store(
  p_bread_id text,
  p_store text,
  p_excluded_plan_item_id uuid default null
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((
      select sum(item.frozen_quantity)::numeric
      from public.production_plan_items item
      join public.production_plans plan on plan.id = item.plan_id
      where item.bread_id = p_bread_id
        and item.store = lower(p_store)
        and plan.production_date >= private.data_na_padaria()
        and (p_excluded_plan_item_id is null or item.id <> p_excluded_plan_item_id)
    ), 0)
    + case when lower(p_store) = 'jc' then coalesce((
      select sum(schedule.frozen_quantity)
      from public.pj_production_schedules schedule
      where schedule.bread_id = p_bread_id
        and schedule.production_date >= private.data_na_padaria()
    ), 0) else 0 end;
$$;

revoke all on function private.reserved_frozen_for_bread_store(text, text, uuid)
  from public, anon, authenticated;
grant execute on function private.reserved_frozen_for_bread_store(text, text, uuid)
  to service_role;

create or replace function private.guard_production_plan_frozen_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stock numeric;
  v_reserved numeric;
begin
  if new.frozen_quantity <= 0 then return new; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('frozen:' || new.store || ':' || new.bread_id, 0)
  );

  v_stock := private.frozen_stock_for_bread_store(new.bread_id, new.store);
  v_reserved := private.reserved_frozen_for_bread_store(
    new.bread_id,
    new.store,
    case when tg_op = 'UPDATE' then old.id else null end
  );

  if v_reserved + new.frozen_quantity > v_stock then
    raise exception using
      errcode = '22023',
      message = 'O congelado disponivel ja esta reservado por outro planejamento.';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_production_plan_frozen_balance()
  from public, anon, authenticated;
grant execute on function private.guard_production_plan_frozen_balance()
  to service_role;

create trigger guard_production_plan_frozen_balance
before insert or update of plan_id, store, bread_id, frozen_quantity
on public.production_plan_items
for each row execute function private.guard_production_plan_frozen_balance();

create or replace function public.list_frozen_production_availability(
  p_target_plan_date date default null
)
returns table (
  store text,
  bread_id text,
  available_quantity numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.current_user_can_plan_pj_production() then
    raise exception using errcode = '42501', message = 'Usuario sem permissao para planejar a producao.';
  end if;

  return query
  with stock_rows as (
    select
      product.product_id as bread_id,
      case
        when lower(item.location) in ('freezer', 'camara', 'freezer_loja') then 'jc'
        when lower(item.location) like 'jc-%' then 'jc'
        when lower(item.location) like 'ja-%' then 'ja'
        else null
      end as store,
      item.quantity,
      product.store as product_store,
      product.visible_stores
    from public.frozen_stock item
    join public.frozen_products product
      on product.id = item.frozen_product_id
     and product.active
     and product.product_source = 'bread'
     and product.product_id is not null
  ), stock as (
    select
      stock_rows.bread_id,
      stock_rows.store,
      sum(stock_rows.quantity)::numeric as quantity
    from stock_rows
    where stock_rows.store in ('jc', 'ja')
      and (
        (stock_rows.product_store is null and stock_rows.visible_stores is null)
        or lower(stock_rows.product_store) = stock_rows.store
        or stock_rows.store = any(coalesce(stock_rows.visible_stores, '{}'::text[]))
      )
    group by stock_rows.bread_id, stock_rows.store
  ), store_reserved as (
    select plan_item.store, plan_item.bread_id, sum(plan_item.frozen_quantity)::numeric as quantity
    from public.production_plan_items plan_item
    join public.production_plans plan on plan.id = plan_item.plan_id
    where plan.production_date >= private.data_na_padaria()
      and (p_target_plan_date is null or plan.production_date <> p_target_plan_date)
    group by plan_item.store, plan_item.bread_id
  ), pj_reserved as (
    select schedule.bread_id, sum(schedule.frozen_quantity)::numeric as quantity
    from public.pj_production_schedules schedule
    where schedule.production_date >= private.data_na_padaria()
    group by schedule.bread_id
  )
  select
    stock.store,
    stock.bread_id,
    greatest(
      0,
      stock.quantity
        - coalesce(store_reserved.quantity, 0)
        - case when stock.store = 'jc' then coalesce(pj_reserved.quantity, 0) else 0 end
    )::numeric as available_quantity
  from stock
  left join store_reserved
    on store_reserved.store = stock.store
   and store_reserved.bread_id = stock.bread_id
  left join pj_reserved on pj_reserved.bread_id = stock.bread_id
  where stock.store in ('jc', 'ja')
  order by stock.store, stock.bread_id;
end;
$$;

revoke all on function public.list_frozen_production_availability(date)
  from public, anon, authenticated;
grant execute on function public.list_frozen_production_availability(date)
  to authenticated, service_role;

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

revoke all on function public.list_pj_production_queue()
  from public, anon, authenticated;
grant execute on function public.list_pj_production_queue()
  to authenticated, service_role;

create or replace function public.schedule_pj_production(
  p_production_date date,
  p_items jsonb,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_name text;
  v_item jsonb;
  v_order public.orders%rowtype;
  v_order_id uuid;
  v_quantity numeric;
  v_frozen numeric;
  v_scheduled numeric;
  v_bread_id text;
  v_pricing_unit text;
  v_stock numeric;
  v_reserved numeric;
  v_existing_count integer;
  v_requested_count integer;
begin
  if not private.current_user_can_plan_pj_production() then
    raise exception using errcode = '42501', message = 'Usuario sem permissao para organizar a producao PJ.';
  end if;

  select profile.display_name
  into v_user_name
  from public.app_profiles profile
  where profile.user_id = v_user_id and profile.active;

  if p_production_date is null or p_production_date <> private.data_na_padaria() then
    raise exception using errcode = '22023', message = 'A programacao PJ deve ser feita para hoje.';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22004', message = 'Identificador da programacao ausente.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = '22023', message = 'Envie uma lista de itens para programar.';
  end if;

  v_requested_count := jsonb_array_length(p_items);
  if v_requested_count < 1 or v_requested_count > 100 then
    raise exception using errcode = '22023', message = 'Escolha de 1 a 100 itens por vez.';
  end if;

  if (
    select count(distinct item->>'order_id')
    from jsonb_array_elements(p_items) item
  ) <> v_requested_count then
    raise exception using errcode = '22023', message = 'Cada linha do pedido deve aparecer uma unica vez.';
  end if;

  select count(*) into v_existing_count
  from public.pj_production_schedules schedule
  where schedule.request_id = p_request_id;

  if v_existing_count > 0 then
    if v_existing_count <> v_requested_count or exists (
      select 1
      from jsonb_array_elements(p_items) item
      left join public.pj_production_schedules schedule
        on schedule.request_id = p_request_id
       and schedule.order_id = (item->>'order_id')::uuid
       and schedule.scheduled_quantity = (item->>'quantity')::numeric
       and schedule.frozen_quantity = coalesce((item->>'frozen_quantity')::numeric, 0)
      where schedule.id is null
    ) then
      raise exception using errcode = '22023', message = 'Esta programacao repetida chegou com valores diferentes.';
    end if;

    return jsonb_build_object(
      'scheduled_count', v_existing_count,
      'idempotent', true,
      'production_date', p_production_date
    );
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_order_id := (v_item->>'order_id')::uuid;
      v_quantity := (v_item->>'quantity')::numeric;
      v_frozen := coalesce((v_item->>'frozen_quantity')::numeric, 0);
    exception when others then
      raise exception using errcode = '22023', message = 'Item da programacao PJ invalido.';
    end;

    if v_quantity <= 0 or v_quantity > 1000000 or scale(v_quantity) > 3 then
      raise exception using errcode = '22023', message = 'Informe uma quantidade valida para produzir.';
    end if;
    if v_frozen < 0 or v_frozen > v_quantity or v_frozen <> trunc(v_frozen) then
      raise exception using errcode = '22023', message = 'Informe uma quantidade inteira e valida de congelados.';
    end if;

    select order_row.*
    into v_order
    from public.orders order_row
    where order_row.id = v_order_id
    for update;

    if not found or v_order.order_type <> 'pj' then
      raise exception using errcode = 'P0002', message = 'Linha do pedido PJ nao encontrada.';
    end if;
    if v_order.cancelled_at is not null or v_order.dispatched_at is not null then
      raise exception using errcode = '22023', message = 'Pedido cancelado ou ja enviado nao pode entrar na producao.';
    end if;
    if coalesce(v_order.delivery_date, v_order.pj_delivery_date) is null then
      raise exception using errcode = '22023', message = 'Pedido PJ sem data de entrega.';
    end if;
    select case
      when coalesce(v_order.product_source, 'bread') = 'bread' then v_order.bread_id
      when v_order.product_source = 'product' then product.legacy_bread_id
      else null
    end
    into v_bread_id
    from (select 1) seed
    left join public.products product
      on v_order.product_source = 'product'
     and product.id::text = v_order.bread_id;

    if v_bread_id is null or not exists (
      select 1 from public.breads bread where bread.id = v_bread_id
    ) then
      raise exception using errcode = '23503', message = 'Produto sem vinculo com um pao do Forno.';
    end if;

    select coalesce(v_order.pricing_unit, bread.unit, 'un')
    into v_pricing_unit
    from public.breads bread
    where bread.id = v_bread_id;

    if v_pricing_unit = 'un' and v_quantity <> trunc(v_quantity) then
      raise exception using errcode = '22023', message = 'Pao vendido por unidade nao aceita fracao.';
    end if;

    select coalesce(sum(schedule.scheduled_quantity), 0)
    into v_scheduled
    from public.pj_production_schedules schedule
    where schedule.order_id = v_order_id;

    if v_scheduled + v_quantity > v_order.quantity then
      raise exception using errcode = '22023', message = 'A quantidade escolhida passa do que ainda falta produzir.';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('frozen:jc:' || v_bread_id, 0)
    );

    if v_frozen > 0 then
      v_stock := private.frozen_stock_for_bread_store(v_bread_id, 'jc');
      v_reserved := private.reserved_frozen_for_bread_store(v_bread_id, 'jc', null);
      if v_reserved + v_frozen > v_stock then
        raise exception using
          errcode = '22023',
          message = 'O congelado disponivel ja esta reservado por outro planejamento.';
      end if;
    end if;

    update public.orders order_row
    set production_date = coalesce(order_row.production_date, p_production_date),
        updated_at = now()
    where order_row.id = v_order_id;

    insert into public.pj_production_schedules (
      order_id,
      production_date,
      bread_id,
      scheduled_quantity,
      frozen_quantity,
      request_id,
      created_by,
      created_by_name
    ) values (
      v_order_id,
      p_production_date,
      v_bread_id,
      v_quantity,
      v_frozen,
      p_request_id,
      v_user_id,
      v_user_name
    );
  end loop;

  return jsonb_build_object(
    'scheduled_count', v_requested_count,
    'idempotent', false,
    'production_date', p_production_date
  );
end;
$$;

revoke all on function public.schedule_pj_production(date, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.schedule_pj_production(date, jsonb, uuid)
  to authenticated, service_role;

create or replace function public.list_pj_production_for_oven(p_production_date date)
returns table (
  bread_id text,
  quantity numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.current_user_can_plan_pj_production() then
    raise exception using errcode = '42501', message = 'Usuario sem permissao para consultar a producao PJ.';
  end if;
  if p_production_date is null then
    raise exception using errcode = '22004', message = 'Informe a data de producao.';
  end if;

  return query
  select
    schedule.bread_id,
    sum(schedule.scheduled_quantity - schedule.frozen_quantity)::numeric
  from public.pj_production_schedules schedule
  join public.orders order_row on order_row.id = schedule.order_id
  where schedule.production_date = p_production_date
    and order_row.cancelled_at is null
    and schedule.scheduled_quantity > schedule.frozen_quantity
  group by schedule.bread_id
  order by schedule.bread_id;
end;
$$;

revoke all on function public.list_pj_production_for_oven(date)
  from public, anon, authenticated;
grant execute on function public.list_pj_production_for_oven(date)
  to authenticated, service_role;

-- Datas antigas foram escolhidas pelo Comercial e nao representam uma decisao
-- da Producao. Pedidos ainda abertos voltam para a fila e serao programados
-- explicitamente por Geolar.
update public.orders
set production_date = null,
    updated_at = now()
where order_type = 'pj'
  and cancelled_at is null
  and dispatched_at is null
  and production_date is not null;

create or replace function private.guard_scheduled_pj_order_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid := case when tg_op = 'DELETE' then old.id else new.id end;
begin
  if old.order_type = 'pj'
    and exists (
      select 1 from public.pj_production_schedules schedule
      where schedule.order_id = v_order_id
    )
  then
    if tg_op = 'DELETE' then
      raise exception using errcode = '42501', message = 'Pedido que ja entrou na producao nao pode ser excluido.';
    end if;

    if new.order_type is distinct from old.order_type
      or new.order_group_id is distinct from old.order_group_id
      or new.customer_id is distinct from old.customer_id
      or new.pj_client is distinct from old.pj_client
      or new.bread_id is distinct from old.bread_id
      or new.product_source is distinct from old.product_source
      or new.product_name is distinct from old.product_name
      or new.quantity is distinct from old.quantity
      or new.delivery_date is distinct from old.delivery_date
      or new.pj_delivery_date is distinct from old.pj_delivery_date
      or new.production_date is distinct from old.production_date
      or new.cancelled_at is distinct from old.cancelled_at
      or new.cancelled_by is distinct from old.cancelled_by
      or new.cancel_reason is distinct from old.cancel_reason
    then
      raise exception using errcode = '42501', message = 'Pedido que ja entrou na producao nao pode mais ser alterado.';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.guard_scheduled_pj_order_changes()
  from public, anon, authenticated;
grant execute on function private.guard_scheduled_pj_order_changes()
  to service_role;

create trigger guard_scheduled_pj_order_changes
before update or delete on public.orders
for each row execute function private.guard_scheduled_pj_order_changes();

-- O catalogo PJ ja possui paes vendidos por quilo. O Forno precisa aceitar a
-- mesma precisao da linha comercial, sem perder a trava de quantidade positiva.
alter table public.production_actuals
drop constraint if exists production_actuals_quantities_are_whole_units;

alter table public.production_actual_events
drop constraint if exists production_actual_events_quantities_are_whole_units;

drop function if exists public.confirm_oven_output(date, text, integer, integer, text, text);

create function public.confirm_oven_output(
  p_record_date date,
  p_bread_id text,
  p_quantity_good numeric,
  p_quantity_loss numeric default 0,
  p_loss_reason text default null,
  p_obs text default null
)
returns table (
  production_actual_id uuid,
  returned_lot_code text,
  returned_quantity_good numeric,
  returned_quantity_loss numeric,
  returned_loss_reason text,
  confirmed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile_name text;
  v_profile_role text;
  v_lot_code text;
  v_loss_reason text;
  v_actual_id uuid;
  v_previous_good numeric;
  v_previous_loss numeric;
  v_confirmed_at timestamptz := now();
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'E necessario entrar com e-mail para confirmar o forno.';
  end if;

  select profile.display_name, profile.role
  into v_profile_name, v_profile_role
  from public.app_profiles profile
  where profile.user_id = v_user_id and profile.active;

  if not found or v_profile_role not in ('admin', 'producao') then
    raise exception using errcode = '42501', message = 'Usuario sem permissao para confirmar o forno.';
  end if;
  if p_record_date is null then
    raise exception using errcode = '22004', message = 'Informe a data de producao.';
  end if;
  if p_quantity_good is null or p_quantity_good < 0 or scale(p_quantity_good) > 3 then
    raise exception using errcode = '22023', message = 'A saida boa deve ser zero ou maior, com ate 3 casas decimais.';
  end if;
  if p_quantity_loss is null or p_quantity_loss < 0 or scale(p_quantity_loss) > 3 then
    raise exception using errcode = '22023', message = 'A perda deve ser zero ou maior, com ate 3 casas decimais.';
  end if;
  if not exists (select 1 from public.breads bread where bread.id = p_bread_id) then
    raise exception using errcode = '23503', message = 'Pao nao encontrado.';
  end if;

  v_loss_reason := nullif(btrim(p_loss_reason), '');
  if p_quantity_loss > 0 and (
    v_loss_reason is null
    or v_loss_reason not in ('Queimou', 'Fora do padrão', 'Caiu ou contaminou', 'Outro')
  ) then
    raise exception using errcode = '22023', message = 'Informe um motivo valido para a perda.';
  end if;
  if p_quantity_loss = 0 then v_loss_reason := null; end if;
  if length(coalesce(p_obs, '')) > 500 then
    raise exception using errcode = '22023', message = 'A observacao deve ter no maximo 500 caracteres.';
  end if;

  v_lot_code := 'L' || to_char(p_record_date, 'MMDD');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_bread_id || ':' || p_record_date::text, 0)
  );

  select actual.quantity_baked, actual.quantity_loss
  into v_previous_good, v_previous_loss
  from public.production_actuals actual
  where actual.bread_id = p_bread_id and actual.record_date = p_record_date
  for update;

  insert into public.production_actuals (
    record_date, bread_id, lot_code, quantity_baked, quantity_loss,
    loss_reason, recorded_by, obs, updated_at
  ) values (
    p_record_date, p_bread_id, v_lot_code, p_quantity_good, p_quantity_loss,
    v_loss_reason, v_profile_name, nullif(btrim(p_obs), ''), v_confirmed_at
  )
  on conflict (bread_id, record_date) do update set
    lot_code = excluded.lot_code,
    quantity_baked = excluded.quantity_baked,
    quantity_loss = excluded.quantity_loss,
    loss_reason = excluded.loss_reason,
    recorded_by = excluded.recorded_by,
    obs = excluded.obs,
    updated_at = excluded.updated_at
  returning id into v_actual_id;

  delete from public.bread_movements movement
  where movement.reference_type = 'production_actual'
    and movement.reference_id = v_actual_id::text
    and movement.movement_type in ('forno_entrada', 'forno_descarte');

  if p_quantity_good > 0 then
    insert into public.bread_movements (
      movement_type, bread_id, location, quantity, reference_id,
      reference_type, recorded_by, lot_id
    ) values (
      'forno_entrada', p_bread_id, 'central', p_quantity_good,
      v_actual_id::text, 'production_actual', v_profile_name, v_actual_id
    );
  end if;

  insert into public.production_actual_events (
    production_actual_id, bread_id, record_date, lot_code,
    previous_quantity_baked, previous_quantity_loss,
    quantity_baked, quantity_loss, loss_reason,
    changed_by, changed_by_name, created_at
  ) values (
    v_actual_id, p_bread_id, p_record_date, v_lot_code,
    v_previous_good, v_previous_loss,
    p_quantity_good, p_quantity_loss, v_loss_reason,
    v_user_id, v_profile_name, v_confirmed_at
  );

  return query select
    v_actual_id, v_lot_code, p_quantity_good, p_quantity_loss,
    v_loss_reason, v_confirmed_at;
end;
$$;

comment on function public.confirm_oven_output(date, text, numeric, numeric, text, text) is
  'Confirma ou corrige um produto/lote do Forno, inclusive paes vendidos por quilo, e sincroniza o estoque.';

revoke all on function public.confirm_oven_output(date, text, numeric, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.confirm_oven_output(date, text, numeric, numeric, text, text)
  to authenticated, service_role;
