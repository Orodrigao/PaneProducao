-- Programacao PJ e confirmacao do Forno pela identidade operacional do produto.
--
-- Registros antigos sao explicitamente marcados como source=bread. Produtos
-- novos sem ponte legada usam source=product.
-- A ponte antiga continua sendo o destino de confirmacao quando existe, para
-- nao dividir o mesmo estoque fisico durante a migracao gradual.
begin;

alter table public.pj_production_schedules
  add column product_source text,
  add column product_id text,
  add column production_process text,
  add column production_area text,
  add column product_name text,
  add column production_unit text;

update public.pj_production_schedules schedule
set product_source = 'bread',
    product_id = schedule.bread_id,
    production_process = 'forno',
    production_area = 'padaria',
    product_name = coalesce(bread.name, schedule.bread_id),
    production_unit = coalesce(bread.unit, 'un')
from public.breads bread
where bread.id = schedule.bread_id;

alter table public.pj_production_schedules
  alter column bread_id drop not null,
  drop constraint pj_production_schedules_one_line_per_day,
  alter column product_source set default 'bread',
  alter column product_source set not null,
  alter column product_id set not null,
  alter column production_process set not null,
  alter column product_name set not null,
  alter column production_unit set not null,
  add constraint pj_production_schedules_product_source_valid
    check (product_source = any (array['bread'::text, 'product'::text])),
  add constraint pj_production_schedules_product_identity_valid
    check (
      btrim(product_id) <> ''
      and (
        product_source = 'product'
        or (product_source = 'bread' and bread_id is not null and bread_id = product_id)
      )
    ),
  add constraint pj_production_schedules_process_valid
    check (production_process = any (array['forno'::text, 'montagem'::text, 'preparo'::text]));

create index pj_production_schedules_date_product_idx
  on public.pj_production_schedules (production_date, product_source, product_id);

comment on column public.pj_production_schedules.product_source is
  'Origem da identidade programada: bread para historico ou product para o catalogo unificado.';
comment on column public.pj_production_schedules.product_id is
  'Identidade imutavel do item no momento da programacao.';
comment on column public.pj_production_schedules.production_process is
  'Destino de confirmacao congelado no momento da programacao.';

create or replace function private.sync_legacy_pj_schedule_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Compatibilidade com a versao anterior do site durante o deploy.
  if new.product_id is null then
    new.product_source := 'bread';
    new.product_id := new.bread_id;
    new.production_process := 'forno';
    new.production_area := coalesce(new.production_area, 'padaria');
    select coalesce(bread.name, new.bread_id), coalesce(bread.unit, 'un')
      into new.product_name, new.production_unit
    from public.breads bread
    where bread.id = new.bread_id;
  end if;
  return new;
end;
$$;

revoke all on function private.sync_legacy_pj_schedule_identity()
  from public, anon, authenticated;
grant execute on function private.sync_legacy_pj_schedule_identity() to service_role;

create trigger sync_legacy_pj_schedule_identity
before insert on public.pj_production_schedules
for each row execute function private.sync_legacy_pj_schedule_identity();

-- O realizado e seus eventos passam a registrar a mesma identidade. As
-- colunas bread_id antigas permanecem para leituras historicas e ficam nulas
-- apenas em produtos que nunca tiveram cadastro em breads.
alter table public.production_actuals
  add column product_source text,
  add column product_id text,
  add column product_name text,
  add column production_unit text;

update public.production_actuals actual
set product_source = 'bread',
    product_id = actual.bread_id,
    product_name = coalesce(bread.name, actual.bread_id),
    production_unit = coalesce(bread.unit, 'un')
from public.breads bread
where bread.id = actual.bread_id;

alter table public.production_actuals
  alter column bread_id drop not null,
  alter column product_source set default 'bread',
  alter column product_source set not null,
  alter column product_id set not null,
  alter column product_name set not null,
  alter column production_unit set not null,
  add constraint production_actuals_product_source_valid
    check (product_source = any (array['bread'::text, 'product'::text])),
  add constraint production_actuals_product_identity_valid check (
    btrim(product_id) <> ''
    and (
      (product_source = 'bread' and bread_id is not null and bread_id = product_id)
      or (product_source = 'product' and bread_id is null)
    )
  );

alter table public.production_actuals
  add constraint production_actuals_product_date_key
  unique (product_source, product_id, record_date);

alter table public.production_actual_events
  add column product_source text,
  add column product_id text,
  add column product_name text,
  add column production_unit text;

update public.production_actual_events event
set product_source = 'bread',
    product_id = event.bread_id,
    product_name = coalesce(bread.name, event.bread_id),
    production_unit = coalesce(bread.unit, 'un')
from public.breads bread
where bread.id = event.bread_id;

alter table public.production_actual_events
  alter column bread_id drop not null,
  alter column product_source set default 'bread',
  alter column product_source set not null,
  alter column product_id set not null,
  alter column product_name set not null,
  alter column production_unit set not null,
  add constraint production_actual_events_product_source_valid
    check (product_source = any (array['bread'::text, 'product'::text])),
  add constraint production_actual_events_product_identity_valid check (
    btrim(product_id) <> ''
    and (
      (product_source = 'bread' and bread_id is not null and bread_id = product_id)
      or (product_source = 'product' and bread_id is null)
    )
  );

alter table public.bread_movements
  add column product_source text,
  add column product_id text;

update public.bread_movements
set product_source = 'bread', product_id = bread_id;

alter table public.bread_movements
  alter column bread_id drop not null,
  alter column product_source set default 'bread',
  alter column product_source set not null,
  alter column product_id set not null,
  add constraint bread_movements_product_source_valid
    check (product_source = any (array['bread'::text, 'product'::text])),
  add constraint bread_movements_product_identity_valid check (
    btrim(product_id) <> ''
    and (
      (product_source = 'bread' and bread_id is not null and bread_id = product_id)
      or (product_source = 'product' and bread_id is null)
    )
  );

create index bread_movements_location_product_idx
  on public.bread_movements (location, product_source, product_id);

create or replace function private.sync_legacy_oven_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.product_id is null then
    new.product_source := 'bread';
    new.product_id := new.bread_id;
  end if;
  if tg_table_name in ('production_actuals', 'production_actual_events') then
    if new.product_name is null then
      select coalesce(bread.name, new.bread_id), coalesce(bread.unit, 'un')
        into new.product_name, new.production_unit
      from public.breads bread
      where bread.id = new.bread_id;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.sync_legacy_oven_identity()
  from public, anon, authenticated;
grant execute on function private.sync_legacy_oven_identity() to service_role;

create trigger sync_legacy_production_actual_identity
before insert on public.production_actuals
for each row execute function private.sync_legacy_oven_identity();
create trigger sync_legacy_production_event_identity
before insert on public.production_actual_events
for each row execute function private.sync_legacy_oven_identity();
create trigger sync_legacy_bread_movement_identity
before insert on public.bread_movements
for each row execute function private.sync_legacy_oven_identity();

-- A fila conserva o contrato antigo de colunas para que a versao anterior do
-- navegador continue abrindo enquanto o deploy troca. canonical_bread_id passa
-- a significar apenas a ponte opcional usada por congelados.
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
      coalesce(order_row.product_source, 'bread') as effective_source,
      product.id as catalog_product_id,
      product.name as catalog_name,
      product.unit as catalog_unit,
      product.active as catalog_active,
      product.is_fabricacao_propria,
      product.production_process,
      product.production_area,
      product.allows_planned_production,
      product.legacy_bread_id as resolved_bread_id
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
    select schedule.order_id,
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
    coalesce(resolved.product_name, resolved.catalog_name, bread.name, resolved.bread_id),
    case when resolved.effective_source = 'bread' then resolved.bread_id else resolved.resolved_bread_id end,
    coalesce(resolved.pricing_unit, resolved.catalog_unit, bread.unit, 'un'),
    resolved.quantity,
    coalesce(scheduled.quantity, 0),
    greatest(0, resolved.quantity - coalesce(scheduled.quantity, 0)),
    case
      when coalesce(resolved.resolved_bread_id,
        case when resolved.effective_source = 'bread' then resolved.bread_id end) is null then 0
      else greatest(
        0,
        private.frozen_stock_for_bread_store(
          coalesce(resolved.resolved_bread_id, resolved.bread_id), 'jc'
        ) - private.reserved_frozen_for_bread_store(
          coalesce(resolved.resolved_bread_id, resolved.bread_id), 'jc', null
        )
      )
    end,
    scheduled.last_production_date,
    case
      when coalesce(resolved.delivery_date, resolved.pj_delivery_date) is null then 'Pedido sem data de entrega.'
      when resolved.effective_source = 'bread' and bread.id is null then 'Pao antigo nao encontrado.'
      when resolved.effective_source = 'product' and resolved.catalog_product_id is null then 'Produto nao encontrado no cadastro.'
      when resolved.effective_source = 'product' and not coalesce(resolved.catalog_active, false) then 'Produto inativo no cadastro.'
      when resolved.effective_source = 'product' and not coalesce(resolved.is_fabricacao_propria, false) then 'Produto nao marcado como fabricacao propria.'
      when resolved.effective_source = 'product' and resolved.resolved_bread_id is not null and bread.id is null
        then 'Pao antigo vinculado nao encontrado.'
      when resolved.effective_source = 'product'
        and resolved.resolved_bread_id is null
        and (resolved.production_process is null or resolved.production_area is null
          or resolved.allows_planned_production is null)
        then 'Produto sem classificacao operacional para producao.'
      when resolved.effective_source = 'product'
        and not coalesce(resolved.allows_planned_production, resolved.resolved_bread_id is not null)
        then 'Produto nao aceita producao planejada.'
      when resolved.effective_source = 'product'
        and coalesce(resolved.production_process,
          case when resolved.resolved_bread_id is not null then 'forno' end) <> 'forno'
        then 'Pedidos PJ desta area ainda nao recebem programacao. Registre a producao na area responsavel.'
      else null
    end
  from resolved
  left join scheduled on scheduled.order_id = resolved.id
  left join public.customers customer on customer.id = resolved.customer_id
  left join public.breads bread on bread.id = case
    when resolved.effective_source = 'bread' then resolved.bread_id
    else resolved.resolved_bread_id
  end
  where resolved.quantity - coalesce(scheduled.quantity, 0) > 0
  order by
    coalesce(resolved.delivery_date, resolved.pj_delivery_date) asc nulls first,
    coalesce(customer.name, resolved.pj_client, 'Cliente PJ'),
    resolved.order_group_id,
    coalesce(resolved.product_name, resolved.catalog_name, bread.name, resolved.bread_id);
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
  v_product public.products%rowtype;
  v_order_id uuid;
  v_quantity numeric;
  v_frozen numeric;
  v_scheduled numeric;
  v_source text;
  v_product_id text;
  v_bread_id text;
  v_product_name text;
  v_process text;
  v_area text;
  v_pricing_unit text;
  v_stock numeric;
  v_reserved numeric;
  v_existing_count integer;
  v_requested_count integer;
begin
  if not private.current_user_can_plan_pj_production() then
    raise exception using errcode = '42501', message = 'Usuario sem permissao para organizar a producao PJ.';
  end if;

  select profile.display_name into v_user_name
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
  if (select count(distinct item->>'order_id') from jsonb_array_elements(p_items) item) <> v_requested_count then
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
    return jsonb_build_object('scheduled_count', v_existing_count, 'idempotent', true,
      'production_date', p_production_date);
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

    select order_row.* into v_order
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

    v_source := coalesce(v_order.product_source, 'bread');
    if v_source = 'bread' then
      select bread.id, bread.name, coalesce(v_order.pricing_unit, bread.unit, 'un')
        into v_product_id, v_product_name, v_pricing_unit
      from public.breads bread where bread.id = v_order.bread_id;
      if not found then
        raise exception using errcode = '23503', message = 'Pao antigo nao encontrado.';
      end if;
      v_bread_id := v_product_id;
      v_process := 'forno';
      v_area := 'padaria';
    elsif v_source = 'product' then
      select product.* into v_product
      from public.products product where product.id::text = v_order.bread_id;
      if not found then
        raise exception using errcode = '23503', message = 'Produto nao encontrado no cadastro.';
      end if;
      if not v_product.active then
        raise exception using errcode = '22023', message = 'Produto inativo nao pode ser programado.';
      end if;
      if not v_product.is_fabricacao_propria then
        raise exception using errcode = '22023', message = 'Produto nao marcado como fabricacao propria.';
      end if;
      if v_product.legacy_bread_id is null
        and (v_product.production_process is null or v_product.production_area is null
        or v_product.allows_planned_production is null
        ) then
        raise exception using errcode = '22023', message = 'Produto sem classificacao operacional para producao.';
      end if;
      if not coalesce(v_product.allows_planned_production, v_product.legacy_bread_id is not null) then
        raise exception using errcode = '22023', message = 'Produto nao aceita producao planejada.';
      end if;
      if coalesce(v_product.production_process,
        case when v_product.legacy_bread_id is not null then 'forno' end) <> 'forno'
      then
        raise exception using errcode = '22023',
          message = 'Pedidos PJ desta area ainda nao recebem programacao.';
      end if;
      v_product_id := v_product.id::text;
      v_bread_id := v_product.legacy_bread_id;
      v_product_name := coalesce(v_order.product_name, v_product.name);
      v_pricing_unit := coalesce(v_order.pricing_unit, v_product.unit, 'un');
      v_process := coalesce(v_product.production_process, 'forno');
      v_area := coalesce(v_product.production_area, 'padaria');
    else
      raise exception using errcode = '22023', message = 'Origem do produto invalida.';
    end if;

    if v_pricing_unit = 'un' and v_quantity <> trunc(v_quantity) then
      raise exception using errcode = '22023', message = 'Produto vendido por unidade nao aceita fracao.';
    end if;
    select coalesce(sum(schedule.scheduled_quantity), 0) into v_scheduled
    from public.pj_production_schedules schedule where schedule.order_id = v_order_id;
    if v_scheduled + v_quantity > v_order.quantity then
      raise exception using errcode = '22023', message = 'A quantidade escolhida passa do que ainda falta produzir.';
    end if;

    if v_frozen > 0 then
      if v_bread_id is null then
        raise exception using errcode = '22023', message = 'Este produto nao possui congelado compativel.';
      end if;
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('frozen:jc:' || v_bread_id, 0));
      v_stock := private.frozen_stock_for_bread_store(v_bread_id, 'jc');
      v_reserved := private.reserved_frozen_for_bread_store(v_bread_id, 'jc', null);
      if v_reserved + v_frozen > v_stock then
        raise exception using errcode = '22023',
          message = 'O congelado disponivel ja esta reservado por outro planejamento.';
      end if;
    end if;

    update public.orders set production_date = coalesce(production_date, p_production_date), updated_at = now()
    where id = v_order_id;

    insert into public.pj_production_schedules (
      order_id, production_date, bread_id, product_source, product_id,
      production_process, production_area, product_name, production_unit,
      scheduled_quantity, frozen_quantity, request_id, created_by, created_by_name
    ) values (
      v_order_id, p_production_date, v_bread_id, v_source, v_product_id,
      v_process, v_area, v_product_name, v_pricing_unit,
      v_quantity, v_frozen, p_request_id, v_user_id, v_user_name
    );
  end loop;

  return jsonb_build_object('scheduled_count', v_requested_count, 'idempotent', false,
    'production_date', p_production_date);
end;
$$;

revoke all on function public.schedule_pj_production(date, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.schedule_pj_production(date, jsonb, uuid)
  to authenticated, service_role;

create function public.list_pj_production_for_oven_v2(p_production_date date)
returns table (
  product_source text,
  product_id text,
  product_name text,
  production_unit text,
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
    case when schedule.bread_id is not null then 'bread' else schedule.product_source end,
    coalesce(schedule.bread_id, schedule.product_id),
    coalesce(bread.name, schedule.product_name),
    coalesce(bread.unit, schedule.production_unit, 'un'),
    sum(schedule.scheduled_quantity - schedule.frozen_quantity)::numeric
  from public.pj_production_schedules schedule
  join public.orders order_row on order_row.id = schedule.order_id
  left join public.breads bread on bread.id = schedule.bread_id
  where schedule.production_date = p_production_date
    and order_row.cancelled_at is null
    and schedule.production_process = 'forno'
    and schedule.scheduled_quantity > schedule.frozen_quantity
  group by 1, 2, 3, 4
  order by 3, 2;
end;
$$;

revoke all on function public.list_pj_production_for_oven_v2(date)
  from public, anon, authenticated;
grant execute on function public.list_pj_production_for_oven_v2(date)
  to authenticated, service_role;

create function public.confirm_oven_product_output(
  p_record_date date,
  p_product_source text,
  p_product_id text,
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
  v_product public.products%rowtype;
  v_product_found boolean := false;
  v_existing_actual public.production_actuals%rowtype;
  v_schedule_name text;
  v_schedule_unit text;
  v_has_schedule boolean := false;
  v_name text;
  v_unit text;
  v_lot_code text;
  v_loss_reason text;
  v_actual_id uuid;
  v_previous_good numeric;
  v_previous_loss numeric;
  v_confirmed_at timestamptz := now();
begin
  if p_product_source = 'bread' then
    return query select * from public.confirm_oven_output(
      p_record_date, p_product_id, p_quantity_good, p_quantity_loss, p_loss_reason, p_obs
    );
    return;
  end if;

  if v_user_id is null then
    raise exception using errcode = '42501', message = 'E necessario entrar com e-mail para confirmar o forno.';
  end if;
  select profile.display_name, profile.role into v_profile_name, v_profile_role
  from public.app_profiles profile where profile.user_id = v_user_id and profile.active;
  if not found or v_profile_role not in ('admin', 'producao') then
    raise exception using errcode = '42501', message = 'Usuario sem permissao para confirmar o forno.';
  end if;
  if p_record_date is null then
    raise exception using errcode = '22004', message = 'Informe a data de producao.';
  end if;
  if p_product_source <> 'product' then
    raise exception using errcode = '22023', message = 'Origem do produto invalida.';
  end if;
  select product.* into v_product from public.products product
  where product.id::text = p_product_id;
  v_product_found := found;

  -- Enquanto houver ponte legada, toda confirmacao converge para o mesmo lote
  -- antigo. Isso impede dois saldos para o mesmo produto por chamada direta.
  if v_product_found and v_product.legacy_bread_id is not null then
    return query select * from public.confirm_oven_output(
      p_record_date, v_product.legacy_bread_id, p_quantity_good, p_quantity_loss,
      p_loss_reason, p_obs
    );
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('product:' || p_product_id || ':' || p_record_date::text, 0)
  );
  select actual.* into v_existing_actual
  from public.production_actuals actual
  where actual.product_source = 'product' and actual.product_id = p_product_id
    and actual.record_date = p_record_date
  for update;
  v_previous_good := v_existing_actual.quantity_baked;
  v_previous_loss := v_existing_actual.quantity_loss;

  select schedule.product_name, schedule.production_unit, true
    into v_schedule_name, v_schedule_unit, v_has_schedule
  from public.pj_production_schedules schedule
  where schedule.production_date = p_record_date
    and schedule.product_source = 'product'
    and schedule.product_id = p_product_id
    and schedule.production_process = 'forno'
  order by schedule.created_at
  limit 1;
  v_has_schedule := coalesce(v_has_schedule, false);

  if not v_product_found and v_existing_actual.id is null and not v_has_schedule then
    raise exception using errcode = '23503', message = 'Produto nao encontrado para este lote do Forno.';
  end if;
  if v_existing_actual.id is null and not v_has_schedule and (
    not v_product_found or not v_product.active or not v_product.is_fabricacao_propria
    or v_product.production_process <> 'forno'
  ) then
    raise exception using errcode = '22023', message = 'Produto nao pertence a confirmacao do Forno.';
  end if;
  if p_quantity_good is null or p_quantity_good < 0
    or p_quantity_loss is null or p_quantity_loss < 0
    or p_quantity_good > 1000000 or p_quantity_loss > 1000000
    or scale(p_quantity_good) > 3 or scale(p_quantity_loss) > 3
  then
    raise exception using errcode = '22023', message = 'Informe quantidades validas para o Forno.';
  end if;
  v_name := coalesce(v_existing_actual.product_name, v_schedule_name, v_product.name);
  v_unit := coalesce(v_existing_actual.production_unit, v_schedule_unit, v_product.unit, 'un');
  if v_unit <> 'kg'
    and (p_quantity_good <> trunc(p_quantity_good) or p_quantity_loss <> trunc(p_quantity_loss))
  then
    raise exception using errcode = '22023', message = 'Produto vendido por unidade nao aceita fracao.';
  end if;
  v_loss_reason := nullif(btrim(p_loss_reason), '');
  if p_quantity_loss > 0 and (v_loss_reason is null
    or v_loss_reason not in ('Queimou', 'Fora do padrão', 'Caiu ou contaminou', 'Outro'))
  then
    raise exception using errcode = '22023', message = 'Informe um motivo valido para a perda.';
  end if;
  if p_quantity_loss = 0 then v_loss_reason := null; end if;
  if length(coalesce(p_obs, '')) > 500 then
    raise exception using errcode = '22023', message = 'A observacao deve ter no maximo 500 caracteres.';
  end if;

  v_lot_code := 'L' || to_char(p_record_date, 'MMDD');

  insert into public.production_actuals (
    record_date, bread_id, product_source, product_id, product_name, production_unit,
    lot_code, quantity_baked, quantity_loss, loss_reason, recorded_by, obs, updated_at
  ) values (
    p_record_date, null, 'product', p_product_id, v_name, v_unit,
    v_lot_code, p_quantity_good, p_quantity_loss, v_loss_reason, v_profile_name,
    nullif(btrim(p_obs), ''), v_confirmed_at
  )
  on conflict (product_source, product_id, record_date) do update set
    product_name = excluded.product_name,
    production_unit = excluded.production_unit,
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
      movement_type, bread_id, product_source, product_id, location, quantity,
      reference_id, reference_type, recorded_by, lot_id
    ) values (
      'forno_entrada', null, 'product', p_product_id, 'central', p_quantity_good,
      v_actual_id::text, 'production_actual', v_profile_name, v_actual_id
    );
  end if;

  insert into public.production_actual_events (
    production_actual_id, bread_id, product_source, product_id, product_name, production_unit,
    record_date, lot_code, previous_quantity_baked, previous_quantity_loss,
    quantity_baked, quantity_loss, loss_reason, changed_by, changed_by_name, created_at
  ) values (
    v_actual_id, null, 'product', p_product_id, v_name, v_unit,
    p_record_date, v_lot_code, v_previous_good, v_previous_loss,
    p_quantity_good, p_quantity_loss, v_loss_reason, v_user_id, v_profile_name, v_confirmed_at
  );

  return query select v_actual_id, v_lot_code, p_quantity_good, p_quantity_loss,
    v_loss_reason, v_confirmed_at;
end;
$$;

comment on function public.confirm_oven_product_output(date, text, text, numeric, numeric, text, text) is
  'Confirma ou corrige uma identidade do Forno. Bread usa o fluxo historico; product grava o catalogo unificado.';
revoke all on function public.confirm_oven_product_output(date, text, text, numeric, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.confirm_oven_product_output(date, text, text, numeric, numeric, text, text)
  to authenticated, service_role;

commit;
