alter table public.production_plan_items
add column if not exists order_created_at timestamp with time zone,
add column if not exists order_created_by_name text;

comment on column public.production_plan_items.order_created_at is
  'Quando preenchido, indica que a loja deste item ja teve pedido gerado a partir do planejamento.';
comment on column public.production_plan_items.order_created_by_name is
  'Nome operacional de quem gerou o pedido a partir do planejamento.';

update public.production_plan_items as item
set order_created_at = coalesce(
      item.order_created_at,
      (
        select max(ord.updated_at)
        from public.orders as ord
        where ord.cancelled_at is null
          and ord.order_date = plan.production_date
          and ord.store = item.store
          and ord.bread_id = item.bread_id
          and ord.quantity = (
            item.planned_quantity
            + item.frozen_quantity
            + coalesce(item.leftover_confirmed_quantity, item.leftover_proposed_quantity)
          )
      ),
      now()
    ),
    order_created_by_name = coalesce(item.order_created_by_name, 'Sistema')
from public.production_plans as plan
where item.plan_id = plan.id
  and item.order_created_at is null
  and (
    item.planned_quantity
    + item.frozen_quantity
    + coalesce(item.leftover_confirmed_quantity, item.leftover_proposed_quantity)
  ) > 0;

update public.production_plans as plan
set status = 'fechado'
where plan.status <> 'fechado'
  and exists (
    select 1
    from public.production_plan_items as item
    where item.plan_id = plan.id
      and (
        item.planned_quantity
    + item.frozen_quantity
    + coalesce(item.leftover_confirmed_quantity, item.leftover_proposed_quantity)
  ) > 0
  and exists (
    select 1
    from public.orders as ord
    where ord.cancelled_at is null
      and ord.order_date = plan.production_date
      and ord.store = item.store
      and ord.bread_id = item.bread_id
      and ord.quantity = (
        item.planned_quantity
        + item.frozen_quantity
        + coalesce(item.leftover_confirmed_quantity, item.leftover_proposed_quantity)
      )
  );
  )
  and not exists (
    select 1
    from public.production_plan_items as item
    where item.plan_id = plan.id
      and item.order_created_at is null
      and (
        item.planned_quantity
        + item.frozen_quantity
        + coalesce(item.leftover_confirmed_quantity, item.leftover_proposed_quantity)
      ) > 0
  );

create or replace function public.save_bread_reuse_proposals(
  p_target_production_date date,
  p_store text,
  p_proposals jsonb
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile_name text;
  v_profile_role text;
  v_item jsonb;
  v_bread_id text;
  v_quantity integer;
  v_order_quantity numeric;
  v_available numeric;
  v_reserved numeric;
  v_existing public.bread_reuse_plans%rowtype;
  v_existing_found boolean;
  v_count integer := 0;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Entre com e-mail para planejar o reaproveitamento.';
  end if;

  select display_name, role into v_profile_name, v_profile_role
  from public.app_profiles
  where user_id = v_user_id and active;

  if not found or v_profile_role <> 'admin' then
    raise exception using errcode = '42501', message = 'Somente administradores podem propor reaproveitamento.';
  end if;

  if p_target_production_date is null or p_store not in ('jc', 'ja')
    or jsonb_typeof(p_proposals) <> 'array' or jsonb_array_length(p_proposals) > 200 then
    raise exception using errcode = '22023', message = 'Planejamento de reaproveitamento invalido.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('reuse-plan:' || p_store || ':' || p_target_production_date::text, 0)
  );

  for v_item in select value from jsonb_array_elements(p_proposals)
  loop
    v_bread_id := nullif(btrim(v_item ->> 'bread_id'), '');
    if v_bread_id is null or coalesce(v_item ->> 'quantity', '') !~ '^[0-9]+$' then
      raise exception using errcode = '22023', message = 'Proposta de reaproveitamento invalida.';
    end if;
    v_quantity := (v_item ->> 'quantity')::integer;

    select * into v_existing
    from public.bread_reuse_plans
    where target_production_date = p_target_production_date
      and store = p_store
      and bread_id = v_bread_id
    for update;
    v_existing_found := found;

    if not v_existing_found and v_quantity = 0 then
      continue;
    end if;

    select coalesce(sum(quantity), 0) into v_order_quantity
    from public.orders
    where order_date = p_target_production_date
      and store = p_store
      and bread_id = v_bread_id;

    select coalesce(sum(floor(pending_quantity)), 0) into v_available
    from public.sobras
    where store = p_store
      and product_source = 'bread'
      and product_id = v_bread_id
      and record_date < p_target_production_date
      and pending_quantity > 0;

    select coalesce(sum(proposed_quantity), 0) into v_reserved
    from public.bread_reuse_plans
    where store = p_store
      and bread_id = v_bread_id
      and status = 'proposed'
      and target_production_date <> p_target_production_date;

    v_available := greatest(0, v_available - v_reserved);

    if v_quantity > v_order_quantity then
      raise exception using errcode = '23514', message = 'A sobra proposta nao pode superar o pedido da loja.';
    end if;

    if v_existing_found and v_existing.status = 'confirmed' then
      if coalesce(v_existing.confirmed_quantity, 0) > v_order_quantity then
        raise exception using
          errcode = '23514',
          message = 'O pedido nao pode ficar abaixo da sobra que ja voltou para a vitrine.';
      end if;
      if v_quantity <> v_existing.proposed_quantity then
        raise exception using
          errcode = '23514',
          message = 'O reaproveitamento deste pao ja foi conferido. Corrija na Central de Pendencias.';
      end if;
      continue;
    end if;

    if v_quantity > v_available then
      raise exception using errcode = '23514', message = 'A sobra proposta nao pode superar o saldo pendente.';
    end if;

    insert into public.bread_reuse_plans (
      target_production_date, store, bread_id, proposed_quantity,
      confirmed_quantity, status, proposed_by, proposed_by_name,
      proposed_at, confirmed_by, confirmed_by_name, confirmed_at, updated_at
    ) values (
      p_target_production_date, p_store, v_bread_id, v_quantity,
      null, case when v_quantity > 0 then 'proposed' else 'cancelled' end,
      v_user_id, v_profile_name, now(), null, null, null, now()
    )
    on conflict (target_production_date, store, bread_id)
    do update set
      proposed_quantity = excluded.proposed_quantity,
      confirmed_quantity = null,
      status = excluded.status,
      proposed_by = excluded.proposed_by,
      proposed_by_name = excluded.proposed_by_name,
      proposed_at = excluded.proposed_at,
      confirmed_by = null,
      confirmed_by_name = null,
      confirmed_at = null,
      updated_at = excluded.updated_at;

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('saved_proposals', v_count, 'store', p_store);
end;
$$;
