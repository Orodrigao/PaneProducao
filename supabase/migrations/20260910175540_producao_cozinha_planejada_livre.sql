begin;

-- Quem organiza o dia inteiro da produção PJ não é qualquer pessoa com papel
-- "produção". A concessão nova preserva Geolar porque ela já possui a ação
-- producao.acessar; perfis que só confirmam Forno ou Cozinha não a recebem.
insert into public.app_permissions (key, module, label, description, sort_order)
values (
  'producao_pj.programar', 'Operacao', 'Programar producao PJ',
  'Escolher o que entra hoje e encaminhar cada item PJ para a area responsavel.', 95
)
on conflict (key) do update set
  module = excluded.module,
  label = excluded.label,
  description = excluded.description,
  sort_order = excluded.sort_order;

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
select distinct profile.user_id, 'producao_pj.programar', permission.scope, null::uuid
from public.app_profiles profile
join public.app_user_permissions permission
  on permission.user_id = profile.user_id
 and permission.permission_key = 'producao.acessar'
 and permission.scope in ('*', 'jc')
where profile.active and profile.role = 'producao'
on conflict (user_id, permission_key, scope) do nothing;

create or replace function private.current_user_can_plan_pj_production()
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and (
        profile.role = 'admin'
        or private.current_user_has_permission('producao_pj.programar', 'jc')
      )
  );
$$;
revoke all on function private.current_user_can_plan_pj_production()
  from public, anon, authenticated;
grant execute on function private.current_user_can_plan_pj_production()
  to authenticated, service_role;

-- Estes quatro grupos já eram os 20 itens operados pela tela antiga da
-- Cozinha. A fotografia live antes desta migration confirmou que todos ainda
-- estavam sem a classificação nova. O backfill preserva o fluxo existente e
-- aplica as decisões de negócio desta fase, sem inferir outros produtos por
-- nome ou por categoria.
update public.products
set is_fabricacao_propria = true,
    production_process = case
      when category in ('Bruschettas', 'Pizza Redonda', 'Pizza Romana') then 'montagem'
      when category = 'Pastas & Pesto' then 'preparo'
    end,
    allows_planned_production = true,
    allows_unplanned_production = true
where production_area = 'cozinha'
  and production_process is null
  and allows_planned_production is null
  and allows_unplanned_production is null
  and category in ('Bruschettas', 'Pastas & Pesto', 'Pizza Redonda', 'Pizza Romana');

-- O realizado da Cozinha passa a preservar a fotografia operacional usada no
-- dia e aceita peso com milésimos. Registros antigos continuam legíveis.
alter table public.kitchen_production
  drop constraint kitchen_production_quantity_range;
alter table public.kitchen_production
  alter column quantity type numeric(12,3) using quantity::numeric;
alter table public.kitchen_production
  add constraint kitchen_production_quantity_range
  check (quantity > 0 and quantity <= 999 and scale(quantity) <= 3),
  add column product_name text,
  add column production_unit text,
  add column production_process text,
  add column production_area text;

update public.kitchen_production record
set product_name = product.name,
    production_unit = coalesce(product.unit, 'un'),
    production_process = case when product.production_process in ('montagem', 'preparo')
      then product.production_process else null end,
    production_area = 'cozinha'
from public.products product
where product.id = record.product_id;

alter table public.kitchen_production
  add constraint kitchen_production_process_snapshot_valid
  check (production_process is null or production_process in ('montagem', 'preparo')),
  add constraint kitchen_production_area_snapshot_valid
  check (production_area is null or production_area = 'cozinha');

create table private.kitchen_production_write_requests (
  request_id uuid primary key,
  actor uuid not null references auth.users(id),
  store text not null check (store in ('jc', 'ja', 'ex')),
  batches jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table private.kitchen_production_write_requests enable row level security;
alter table private.kitchen_production_write_requests force row level security;
revoke all on private.kitchen_production_write_requests from public, anon, authenticated;

create function private.record_kitchen_batches_impl(
  p_store text,
  p_batches jsonb,
  p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_profile_name text;
  v_profile_role text;
  v_store text := pg_catalog.lower(pg_catalog.btrim(p_store));
  v_batch jsonb;
  v_product public.products%rowtype;
  v_product_id uuid;
  v_quantity numeric;
  v_unit text;
  v_name text;
  v_process text;
  v_area text;
  v_has_plan boolean;
  v_produced_at timestamptz := pg_catalog.now();
  v_result jsonb;
  v_count integer := 0;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Entre com e-mail para lancar a producao da cozinha.';
  end if;
  select profile.display_name, profile.role into v_profile_name, v_profile_role
  from public.app_profiles profile
  where profile.user_id = v_user_id and profile.active;
  if not found then
    raise exception using errcode = '42501', message = 'Usuario sem perfil ativo.';
  end if;
  if v_store is null or v_store not in ('jc', 'ja', 'ex') then
    raise exception using errcode = '22023', message = 'Loja invalida.';
  end if;
  if v_profile_role is distinct from 'admin'
    and not private.current_user_has_permission('producao_cozinha.lancar', v_store) then
    raise exception using errcode = '42501', message = 'Sem permissao para lancar a producao nesta loja.';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22004', message = 'Identificador do salvamento ausente.';
  end if;
  if p_batches is null or jsonb_typeof(p_batches) <> 'array'
    or jsonb_array_length(p_batches) < 1 or jsonb_array_length(p_batches) > 100 then
    raise exception using errcode = '22023', message = 'Informe de 1 a 100 lotes para salvar.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kitchen-production:' || p_request_id::text, 0)
  );
  select request.result into v_result
  from private.kitchen_production_write_requests request
  where request.request_id = p_request_id
    and request.actor = v_user_id
    and request.store = v_store
    and request.batches = p_batches;
  if found then return v_result || jsonb_build_object('idempotent', true); end if;
  if exists (select 1 from private.kitchen_production_write_requests request
             where request.request_id = p_request_id) then
    raise exception using errcode = '22023', message = 'Este salvamento repetido chegou com valores diferentes.';
  end if;

  for v_batch in select value from jsonb_array_elements(p_batches)
  loop
    if jsonb_typeof(v_batch) <> 'object'
      or jsonb_typeof(v_batch -> 'product_id') <> 'string'
      or jsonb_typeof(v_batch -> 'quantity') <> 'number'
      or (v_batch - array['product_id', 'quantity']) <> '{}'::jsonb then
      raise exception using errcode = '22023', message = 'Lote invalido.';
    end if;
    begin
      v_product_id := (v_batch ->> 'product_id')::uuid;
      v_quantity := (v_batch ->> 'quantity')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = '22023', message = 'Produto ou quantidade invalida.';
    end;
    if v_quantity <= 0 or v_quantity > 999 or scale(v_quantity) > 3 then
      raise exception using errcode = '22023', message = 'A quantidade deve ser positiva e ter no maximo tres casas decimais.';
    end if;

    select exists (
      select 1 from public.pj_production_schedules schedule
      join public.orders order_row on order_row.id = schedule.order_id
      where v_store = 'jc'
        and schedule.production_date = (v_produced_at at time zone 'America/Sao_Paulo')::date
        and schedule.product_source = 'product'
        and schedule.product_id = v_product_id::text
        and schedule.production_area = 'cozinha'
        and schedule.production_process in ('montagem', 'preparo')
        and order_row.cancelled_at is null
    ) into v_has_plan;

    if v_has_plan then
      select schedule.product_name, coalesce(schedule.production_unit, 'un'),
             schedule.production_process, schedule.production_area
      into v_name, v_unit, v_process, v_area
      from public.pj_production_schedules schedule
      join public.orders order_row on order_row.id = schedule.order_id
      where schedule.production_date = (v_produced_at at time zone 'America/Sao_Paulo')::date
        and schedule.product_source = 'product'
        and schedule.product_id = v_product_id::text
        and schedule.production_area = 'cozinha'
        and schedule.production_process in ('montagem', 'preparo')
        and order_row.cancelled_at is null
      order by schedule.created_at desc limit 1;
    else
      select product.* into v_product from public.products product where product.id = v_product_id;
      if not found or not v_product.active or not v_product.is_fabricacao_propria
        or v_product.production_area <> 'cozinha'
        or v_product.production_process not in ('montagem', 'preparo')
        or not coalesce(v_product.allows_unplanned_production, false) then
        raise exception using errcode = '23503',
          message = 'Produto nao esta liberado para producao livre na cozinha.';
      end if;
      v_name := v_product.name;
      v_unit := coalesce(v_product.unit, 'un');
      v_process := v_product.production_process;
      v_area := v_product.production_area;
    end if;
    if v_unit <> 'kg' and v_quantity <> trunc(v_quantity) then
      raise exception using errcode = '22023', message = 'Produto por unidade nao aceita fracao.';
    end if;

    insert into public.kitchen_production (
      store, product_id, record_date, quantity, recorded_by, recorded_by_name,
      produced_at, product_name, production_unit, production_process, production_area
    ) values (
      v_store, v_product_id, (v_produced_at at time zone 'America/Sao_Paulo')::date,
      v_quantity, v_user_id, v_profile_name, v_produced_at,
      v_name, v_unit, v_process, v_area
    );
    v_count := v_count + 1;
  end loop;

  v_result := jsonb_build_object(
    'saved_count', v_count, 'produced_at', v_produced_at, 'idempotent', false
  );
  insert into private.kitchen_production_write_requests(request_id, actor, store, batches, result)
  values (p_request_id, v_user_id, v_store, p_batches, v_result);
  return v_result;
end;
$$;
revoke all on function private.record_kitchen_batches_impl(text, jsonb, uuid)
  from public, anon, authenticated;

create function public.record_kitchen_batches_v2(
  p_store text, p_batches jsonb, p_request_id uuid
) returns jsonb
language sql security definer set search_path = '' as $$
  select private.record_kitchen_batches_impl(p_store, p_batches, p_request_id);
$$;
revoke all on function public.record_kitchen_batches_v2(text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.record_kitchen_batches_v2(text, jsonb, uuid)
  to authenticated, service_role;

create or replace function public.record_kitchen_batches(p_store text, p_batches jsonb)
returns jsonb language sql security definer set search_path = '' as $$
  select private.record_kitchen_batches_impl(p_store, p_batches, gen_random_uuid());
$$;
revoke all on function public.record_kitchen_batches(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_kitchen_batches(text, jsonb)
  to authenticated, service_role;

-- A correção acompanha a unidade fotografada no lote: peso aceita milésimos;
-- as demais unidades continuam inteiras. A assinatura antiga permanece como
-- ponte para clientes ainda não atualizados.
create function private.correct_kitchen_batch_impl(
  p_batch_id uuid,
  p_quantity numeric
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_profile_role text;
  v_batch public.kitchen_production%rowtype;
  v_now timestamptz := pg_catalog.now();
  v_unit text;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Entre com e-mail para corrigir o lote.';
  end if;
  select profile.role into v_profile_role
  from public.app_profiles profile
  where profile.user_id = v_user_id and profile.active;
  if not found then
    raise exception using errcode = '42501', message = 'Usuario sem perfil ativo.';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 999 or scale(p_quantity) > 3 then
    raise exception using errcode = '22023',
      message = 'A quantidade deve ser positiva e ter no maximo tres casas decimais.';
  end if;

  select * into v_batch from public.kitchen_production
  where id = p_batch_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Lote da cozinha nao encontrado.';
  end if;
  if v_batch.cancelled_at is not null then
    raise exception using errcode = '22023', message = 'Lote cancelado nao pode ser corrigido.';
  end if;
  v_unit := coalesce(v_batch.production_unit,
    (select product.unit from public.products product where product.id = v_batch.product_id),
    'un');
  if v_unit <> 'kg' and p_quantity <> trunc(p_quantity) then
    raise exception using errcode = '22023', message = 'Produto por unidade nao aceita fracao.';
  end if;
  if v_profile_role is distinct from 'admin'
    and (v_batch.recorded_by <> v_user_id
      or v_batch.record_date <> (v_now at time zone 'America/Sao_Paulo')::date
      or not private.current_user_has_permission('producao_cozinha.lancar', v_batch.store)) then
    raise exception using errcode = '42501', message = 'Voce so pode corrigir seus lotes de hoje.';
  end if;

  update public.kitchen_production
  set quantity = p_quantity, corrected_at = v_now, corrected_by = v_user_id
  where id = v_batch.id;
  return jsonb_build_object('batch_id', v_batch.id, 'quantity', p_quantity, 'corrected_at', v_now);
end;
$$;
revoke all on function private.correct_kitchen_batch_impl(uuid, numeric)
  from public, anon, authenticated;

create function public.correct_kitchen_batch_v2(p_batch_id uuid, p_quantity numeric)
returns jsonb language sql security definer set search_path = '' as $$
  select private.correct_kitchen_batch_impl(p_batch_id, p_quantity);
$$;
revoke all on function public.correct_kitchen_batch_v2(uuid, numeric)
  from public, anon, authenticated;
grant execute on function public.correct_kitchen_batch_v2(uuid, numeric)
  to authenticated, service_role;

create or replace function public.correct_kitchen_batch(p_batch_id uuid, p_quantity integer)
returns jsonb language sql security definer set search_path = '' as $$
  select private.correct_kitchen_batch_impl(p_batch_id, p_quantity::numeric);
$$;
revoke all on function public.correct_kitchen_batch(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.correct_kitchen_batch(uuid, integer)
  to authenticated, service_role;

drop policy if exists kitchen_production_select_permitted on public.kitchen_production;
create policy kitchen_production_select_permitted on public.kitchen_production
for select to authenticated using (
  (select private.current_user_is_access_admin())
  or (
    record_date between ((now() at time zone 'America/Sao_Paulo')::date - 1)
                        and (now() at time zone 'America/Sao_Paulo')::date
    and private.current_user_has_permission('producao_cozinha.lancar', store)
  )
);

create function public.list_kitchen_production_plan(
  p_store text,
  p_production_date date
) returns table (
  product_id uuid,
  product_name text,
  production_unit text,
  production_process text,
  planned_quantity numeric,
  produced_quantity numeric
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_store text := lower(btrim(p_store));
  v_role text;
begin
  select profile.role into v_role from public.app_profiles profile
  where profile.user_id = auth.uid() and profile.active;
  if not found then raise exception using errcode = '42501', message = 'Usuario sem perfil ativo.'; end if;
  if v_store is null or v_store not in ('jc', 'ja', 'ex') or p_production_date is null then
    raise exception using errcode = '22023', message = 'Loja ou data invalida.';
  end if;
  if v_role <> 'admin' and not private.current_user_has_permission('producao_cozinha.lancar', v_store) then
    raise exception using errcode = '42501', message = 'Sem permissao para consultar a producao desta loja.';
  end if;
  if v_role <> 'admin' and p_production_date not between (private.data_na_padaria() - 1)
      and private.data_na_padaria() then
    raise exception using errcode = '42501',
      message = 'A equipe da Cozinha consulta somente hoje e ontem.';
  end if;

  return query
  with planned as (
    select schedule.product_id::uuid as product_id,
           (array_agg(schedule.product_name order by schedule.created_at desc))[1] as product_name,
           (array_agg(coalesce(schedule.production_unit, 'un') order by schedule.created_at desc))[1] as production_unit,
           (array_agg(schedule.production_process order by schedule.created_at desc))[1] as production_process,
           sum(schedule.scheduled_quantity)::numeric as quantity
    from public.pj_production_schedules schedule
    join public.orders order_row on order_row.id = schedule.order_id
    where v_store = 'jc'
      and schedule.production_date = p_production_date
      and schedule.product_source = 'product'
      and schedule.production_area = 'cozinha'
      and schedule.production_process in ('montagem', 'preparo')
      and order_row.cancelled_at is null
    group by schedule.product_id
  ), produced as (
    select record.product_id,
           (array_agg(record.product_name order by record.produced_at desc))[1] as product_name,
           (array_agg(coalesce(record.production_unit, 'un') order by record.produced_at desc))[1] as production_unit,
           (array_agg(record.production_process order by record.produced_at desc))[1] as production_process,
           sum(record.quantity) filter (where record.cancelled_at is null)::numeric as quantity
    from public.kitchen_production record
    where record.store = v_store and record.record_date = p_production_date
    group by record.product_id
  )
  select coalesce(planned.product_id, produced.product_id),
         coalesce(planned.product_name, produced.product_name, product.name),
         coalesce(planned.production_unit, produced.production_unit, product.unit, 'un'),
         coalesce(planned.production_process, produced.production_process, product.production_process),
         coalesce(planned.quantity, 0),
         coalesce(produced.quantity, 0)
  from planned full join produced on produced.product_id = planned.product_id
  left join public.products product on product.id = coalesce(planned.product_id, produced.product_id)
  where coalesce(planned.quantity, 0) > 0
  order by coalesce(planned.product_name, produced.product_name, product.name);
end;
$$;
revoke all on function public.list_kitchen_production_plan(text, date)
  from public, anon, authenticated;
grant execute on function public.list_kitchen_production_plan(text, date)
  to authenticated, service_role;

-- A fila nova carrega o destino e conserva o corte que impede pedidos legados
-- vencidos, sem baixa histórica de envio, de voltarem como fantasmas. Inativar
-- o catálogo não cancela um compromisso atual já aceito. A função antiga fica
-- intacta durante a troca independente do site.
create function public.list_pj_production_queue_v2()
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
  mapping_error text,
  production_process text,
  production_area text,
  catalog_warning text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.current_user_can_plan_pj_production() then
    raise exception using errcode = '42501', message = 'Usuario sem permissao para organizar a producao PJ.';
  end if;

  return query
  with resolved as (
    select order_row.*,
      coalesce(order_row.product_source, 'bread') as effective_source,
      product.id as catalog_product_id,
      product.name as catalog_name,
      product.unit as catalog_unit,
      product.active as catalog_active,
      product.is_fabricacao_propria,
      coalesce(product.production_process,
        case when product.legacy_bread_id is not null then 'forno' end,
        case when coalesce(order_row.product_source, 'bread') = 'bread' then 'forno' end) as resolved_process,
      coalesce(product.production_area,
        case when product.legacy_bread_id is not null then 'padaria' end,
        case when coalesce(order_row.product_source, 'bread') = 'bread' then 'padaria' end) as resolved_area,
      product.allows_planned_production,
      product.legacy_bread_id as resolved_bread_id
    from public.orders order_row
    left join public.products product
      on order_row.product_source = 'product' and product.id::text = order_row.bread_id
    where order_row.order_type = 'pj'
      and order_row.cancelled_at is null
      and order_row.dispatched_at is null
      and order_row.quantity > 0
      and (
        coalesce(order_row.delivery_date, order_row.pj_delivery_date) is null
        or coalesce(order_row.delivery_date, order_row.pj_delivery_date) >= private.data_na_padaria()
      )
  ), scheduled as (
    select schedule.order_id, sum(schedule.scheduled_quantity)::numeric as quantity,
           max(schedule.production_date) as last_production_date
    from public.pj_production_schedules schedule group by schedule.order_id
  )
  select resolved.id, resolved.order_group_id, resolved.customer_id,
    coalesce(customer.name, resolved.pj_client, 'Cliente PJ'), resolved.order_date,
    coalesce(resolved.delivery_date, resolved.pj_delivery_date),
    coalesce(resolved.product_name, resolved.catalog_name, bread.name, resolved.bread_id),
    case when resolved.effective_source = 'bread' then resolved.bread_id else resolved.resolved_bread_id end,
    coalesce(resolved.pricing_unit, resolved.catalog_unit, bread.unit, 'un'),
    resolved.quantity, coalesce(scheduled.quantity, 0),
    greatest(0, resolved.quantity - coalesce(scheduled.quantity, 0)),
    case when resolved.resolved_process <> 'forno' then 0
      when coalesce(resolved.resolved_bread_id,
        case when resolved.effective_source = 'bread' then resolved.bread_id end) is null then 0
      else greatest(0,
        private.frozen_stock_for_bread_store(
          coalesce(resolved.resolved_bread_id, resolved.bread_id), 'jc'
        ) - private.reserved_frozen_for_bread_store(
          coalesce(resolved.resolved_bread_id, resolved.bread_id), 'jc', null
        )) end,
    scheduled.last_production_date,
    case
      when coalesce(resolved.delivery_date, resolved.pj_delivery_date) is null then 'Pedido sem data de entrega.'
      when resolved.effective_source = 'bread' and bread.id is null then 'Pao antigo nao encontrado.'
      when resolved.effective_source = 'product' and resolved.catalog_product_id is null then 'Produto nao encontrado no cadastro.'
      when resolved.effective_source = 'product' and not coalesce(resolved.is_fabricacao_propria, false)
        then 'Produto nao marcado como fabricacao propria.'
      when resolved.effective_source = 'product' and resolved.resolved_bread_id is not null and bread.id is null
        then 'Pao antigo vinculado nao encontrado.'
      when resolved.effective_source = 'product' and resolved.resolved_bread_id is null
        and (resolved.resolved_process is null or resolved.resolved_area is null
          or resolved.allows_planned_production is null)
        then 'Produto sem classificacao operacional para producao.'
      when resolved.effective_source = 'product'
        and not coalesce(resolved.allows_planned_production, resolved.resolved_bread_id is not null)
        then 'Produto nao aceita producao planejada.'
      when resolved.resolved_process = 'forno' then null
      when resolved.resolved_area = 'cozinha' and resolved.resolved_process in ('montagem', 'preparo') then null
      else 'Area ainda sem tela de producao autorizada.'
    end,
    resolved.resolved_process,
    resolved.resolved_area,
    case when resolved.effective_source = 'product' and not coalesce(resolved.catalog_active, false)
      then 'Produto inativo para novos pedidos. Este pedido antigo continua valido.' else null end
  from resolved
  left join scheduled on scheduled.order_id = resolved.id
  left join public.customers customer on customer.id = resolved.customer_id
  left join public.breads bread on bread.id = case
    when resolved.effective_source = 'bread' then resolved.bread_id else resolved.resolved_bread_id end
  where resolved.quantity - coalesce(scheduled.quantity, 0) > 0
  order by coalesce(resolved.delivery_date, resolved.pj_delivery_date) asc nulls first,
    coalesce(customer.name, resolved.pj_client, 'Cliente PJ'), resolved.order_group_id,
    coalesce(resolved.product_name, resolved.catalog_name, bread.name, resolved.bread_id);
end;
$$;
revoke all on function public.list_pj_production_queue_v2()
  from public, anon, authenticated;
grant execute on function public.list_pj_production_queue_v2()
  to authenticated, service_role;

create or replace function private.schedule_pj_production_contract_impl(
  p_production_date date,
  p_items jsonb,
  p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
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
  select profile.display_name into v_user_name from public.app_profiles profile
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

  select count(*) into v_existing_count from public.pj_production_schedules schedule
  where schedule.request_id = p_request_id;
  if v_existing_count > 0 then
    if v_existing_count <> v_requested_count or exists (
      select 1 from jsonb_array_elements(p_items) item
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

    select order_row.* into v_order from public.orders order_row
    where order_row.id = v_order_id for update;
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
      if not found then raise exception using errcode = '23503', message = 'Pao antigo nao encontrado.'; end if;
      v_bread_id := v_product_id;
      v_process := 'forno';
      v_area := 'padaria';
    elsif v_source = 'product' then
      select product.* into v_product from public.products product where product.id::text = v_order.bread_id;
      if not found then raise exception using errcode = '23503', message = 'Produto nao encontrado no cadastro.'; end if;
      if not v_product.is_fabricacao_propria then
        raise exception using errcode = '22023', message = 'Produto nao marcado como fabricacao propria.';
      end if;
      if v_product.legacy_bread_id is null
        and (v_product.production_process is null or v_product.production_area is null
          or v_product.allows_planned_production is null) then
        raise exception using errcode = '22023', message = 'Produto sem classificacao operacional para producao.';
      end if;
      if not coalesce(v_product.allows_planned_production, v_product.legacy_bread_id is not null) then
        raise exception using errcode = '22023', message = 'Produto nao aceita producao planejada.';
      end if;
      v_process := coalesce(v_product.production_process,
        case when v_product.legacy_bread_id is not null then 'forno' end);
      v_area := coalesce(v_product.production_area,
        case when v_product.legacy_bread_id is not null then 'padaria' end);
      if not (v_process = 'forno'
        or (v_area = 'cozinha' and v_process in ('montagem', 'preparo'))) then
        raise exception using errcode = '22023', message = 'Area ainda sem tela de producao autorizada.';
      end if;
      v_product_id := v_product.id::text;
      v_bread_id := v_product.legacy_bread_id;
      v_product_name := coalesce(v_order.product_name, v_product.name);
      v_pricing_unit := coalesce(v_order.pricing_unit, v_product.unit, 'un');
    else
      raise exception using errcode = '22023', message = 'Origem do produto invalida.';
    end if;

    if v_pricing_unit = 'un' and v_quantity <> trunc(v_quantity) then
      raise exception using errcode = '22023', message = 'Produto vendido por unidade nao aceita fracao.';
    end if;
    if v_process <> 'forno' and v_frozen > 0 then
      raise exception using errcode = '22023', message = 'Congelados so podem atender produtos do Forno.';
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
revoke all on function private.schedule_pj_production_contract_impl(date, jsonb, uuid)
  from public, anon, authenticated;

commit;
