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
  v_reuse_capacity numeric;
  v_available numeric;
  v_reserved numeric;
  v_plan_item record;
  v_plan_item_found boolean;
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

    select coalesce(sum(quantity), 0) into v_order_quantity
    from public.orders
    where order_date = p_target_production_date
      and store = p_store
      and bread_id = v_bread_id
      and order_type = 'producao';

    select item.planned_quantity, item.frozen_quantity
    into v_plan_item
    from public.production_plan_items item
    join public.production_plans plan on plan.id = item.plan_id
    where plan.production_date = p_target_production_date
      and item.store = p_store
      and item.bread_id = v_bread_id
    for update;
    v_plan_item_found := found;

    if v_plan_item_found then
      v_reuse_capacity := greatest(0, v_plan_item.planned_quantity - v_plan_item.frozen_quantity);
    else
      v_reuse_capacity := v_order_quantity;
    end if;

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

    if v_quantity > v_reuse_capacity then
      raise exception using errcode = '23514', message = 'A sobra proposta nao pode superar a demanda apos congelados.';
    end if;

    if v_existing_found and v_existing.status = 'confirmed' then
      if coalesce(v_existing.confirmed_quantity, 0) > v_reuse_capacity then
        raise exception using
          errcode = '23514',
          message = 'O planejamento nao pode ficar abaixo da sobra que ja voltou para a vitrine.';
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

create or replace function public.confirm_bread_reuse_plan(
  p_plan_id uuid,
  p_confirmed_quantity integer
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile_name text;
  v_profile_role text;
  v_plan public.bread_reuse_plans%rowtype;
  v_plan_item record;
  v_plan_item_found boolean;
  v_allocation record;
  v_sobra record;
  v_available numeric;
  v_order_quantity numeric;
  v_reuse_capacity numeric;
  v_new_quantity integer;
  v_remaining integer;
  v_take integer;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Entre com e-mail para confirmar o reaproveitamento.';
  end if;

  select display_name, role into v_profile_name, v_profile_role
  from public.app_profiles
  where user_id = v_user_id and active;

  if not found or v_profile_role not in ('admin', 'producao') then
    raise exception using errcode = '42501', message = 'Usuario sem permissao para conferir reaproveitamento.';
  end if;

  if p_confirmed_quantity is null or p_confirmed_quantity < 0 then
    raise exception using errcode = '22023', message = 'Quantidade confirmada invalida.';
  end if;

  select * into v_plan
  from public.bread_reuse_plans
  where id = p_plan_id
  for update;

  if not found or v_plan.status = 'cancelled' then
    raise exception using errcode = 'P0002', message = 'Proposta de reaproveitamento nao encontrada.';
  end if;

  if p_confirmed_quantity > v_plan.proposed_quantity then
    raise exception using errcode = '23514', message = 'A confirmacao nao pode superar o que foi proposto.';
  end if;

  select item.id, item.planned_quantity, item.frozen_quantity
  into v_plan_item
  from public.production_plan_items item
  join public.production_plans plan on plan.id = item.plan_id
  where plan.production_date = v_plan.target_production_date
    and item.store = v_plan.store
    and item.bread_id = v_plan.bread_id
  for update;
  v_plan_item_found := found;

  select coalesce(sum(quantity), 0) into v_order_quantity
  from public.orders
  where order_date = v_plan.target_production_date
    and store = v_plan.store
    and bread_id = v_plan.bread_id
    and order_type = 'producao';

  if v_plan_item_found then
    v_reuse_capacity := greatest(0, v_plan_item.planned_quantity - v_plan_item.frozen_quantity);
  else
    v_reuse_capacity := v_order_quantity;
  end if;

  perform 1
  from public.sobras
  where store = v_plan.store
    and product_source = 'bread'
    and product_id = v_plan.bread_id
    and record_date < v_plan.target_production_date
  order by record_date, id
  for update;

  for v_allocation in
    select allocation.sobra_id, allocation.quantity
    from public.bread_reuse_plan_allocations as allocation
    where allocation.plan_id = v_plan.id
    order by allocation.sobra_id
  loop
    update public.sobras
    set pending_quantity = pending_quantity + v_allocation.quantity,
        status = 'pending',
        updated_at = now()
    where id = v_allocation.sobra_id;

    insert into public.bread_leftover_events (
      sobra_id, reuse_plan_id, action, quantity, actor_id, actor_name, obs
    ) values (
      v_allocation.sobra_id, v_plan.id, 'reuse_reversed', v_allocation.quantity,
      v_user_id, v_profile_name, 'Alocacao anterior devolvida antes da correcao.'
    );
  end loop;

  delete from public.bread_reuse_plan_allocations where plan_id = v_plan.id;

  select coalesce(sum(floor(pending_quantity)), 0) into v_available
  from public.sobras
  where store = v_plan.store
    and product_source = 'bread'
    and product_id = v_plan.bread_id
    and record_date < v_plan.target_production_date
    and pending_quantity > 0;

  if p_confirmed_quantity > v_available or p_confirmed_quantity > v_reuse_capacity then
    raise exception using
      errcode = '23514',
      message = 'Quantidade confirmada supera a sobra disponivel ou a demanda apos congelados.';
  end if;

  v_remaining := p_confirmed_quantity;
  for v_sobra in
    select id, pending_quantity, physical_location
    from public.sobras
    where store = v_plan.store
      and product_source = 'bread'
      and product_id = v_plan.bread_id
      and record_date < v_plan.target_production_date
      and pending_quantity > 0
    order by record_date, created_at, id
  loop
    exit when v_remaining = 0;
    v_take := least(v_remaining, floor(v_sobra.pending_quantity)::integer);
    if v_take <= 0 then continue; end if;

    update public.sobras
    set pending_quantity = pending_quantity - v_take,
        status = case when pending_quantity - v_take = 0 then 'resolved' else 'pending' end,
        updated_at = now()
    where id = v_sobra.id;

    insert into public.bread_reuse_plan_allocations(plan_id, sobra_id, quantity)
    values (v_plan.id, v_sobra.id, v_take);

    insert into public.bread_leftover_events (
      sobra_id, reuse_plan_id, action, quantity, from_location, to_location,
      actor_id, actor_name, obs
    ) values (
      v_sobra.id, v_plan.id, 'reuse_confirmed', v_take,
      v_sobra.physical_location, 'vitrine', v_user_id, v_profile_name,
      'Reaproveitamento confirmado para reduzir a producao nova.'
    );

    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining > 0 then
    raise exception using errcode = '23514', message = 'Nao foi possivel alocar toda a quantidade confirmada.';
  end if;

  update public.bread_reuse_plans
  set confirmed_quantity = p_confirmed_quantity,
      status = 'confirmed',
      confirmed_by = v_user_id,
      confirmed_by_name = v_profile_name,
      confirmed_at = now(),
      updated_at = now()
  where id = v_plan.id;

  if v_plan_item_found then
    v_new_quantity := greatest(
      0,
      v_plan_item.planned_quantity
        - v_plan_item.frozen_quantity
        - p_confirmed_quantity
    );

    update public.production_plan_items
    set leftover_confirmed_quantity = p_confirmed_quantity
    where id = v_plan_item.id;

    if v_new_quantity > 0 then
      update public.orders
      set quantity = v_new_quantity,
          obs = 'Gerado pelo Planejamento',
          cancelled_at = null,
          cancelled_by = null,
          cancel_reason = null,
          updated_at = now()
      where store = v_plan.store
        and order_date = v_plan.target_production_date
        and bread_id = v_plan.bread_id
        and order_type = 'producao'
        and cancelled_at is null;

      if not found then
        delete from public.orders
        where store = v_plan.store
          and order_date = v_plan.target_production_date
          and bread_id = v_plan.bread_id
          and order_type = 'producao';

        insert into public.orders (
          store, bread_id, quantity, order_date, order_type, obs
        ) values (
          v_plan.store, v_plan.bread_id, v_new_quantity,
          v_plan.target_production_date, 'producao', 'Gerado pelo Planejamento'
        );
      end if;
    else
      delete from public.orders
      where store = v_plan.store
        and order_date = v_plan.target_production_date
        and bread_id = v_plan.bread_id
        and order_type = 'producao';
    end if;
  end if;

  return jsonb_build_object(
    'plan_id', v_plan.id,
    'confirmed_quantity', p_confirmed_quantity,
    'bread_id', v_plan.bread_id,
    'store', v_plan.store,
    'new_production_quantity', case when v_plan_item_found then v_new_quantity else null end
  );
end;
$$;

create or replace function public.import_production_plan_order(
  p_plan_id uuid,
  p_store text,
  p_actor_name text
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile_name text;
  v_profile_role text;
  v_plan public.production_plans%rowtype;
  v_item record;
  v_actor_name text;
  v_proposals jsonb := '[]'::jsonb;
  v_new_quantity integer;
  v_order_count integer := 0;
  v_proposal_count integer := 0;
  v_imported_at timestamptz := now();
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Entre com e-mail para transformar o planejamento em pedido.';
  end if;

  select display_name, role into v_profile_name, v_profile_role
  from public.app_profiles
  where user_id = v_user_id and active;

  if not found or v_profile_role <> 'admin' then
    raise exception using errcode = '42501', message = 'Somente administradores podem transformar o planejamento em pedido.';
  end if;

  if p_plan_id is null or p_store not in ('jc', 'ja') then
    raise exception using errcode = '22023', message = 'Planejamento ou loja invalidos.';
  end if;

  select * into v_plan
  from public.production_plans
  where id = p_plan_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Planejamento nao encontrado.';
  end if;

  if v_plan.status = 'fechado' then
    raise exception using errcode = '23514', message = 'Esse planejamento ja foi fechado.';
  end if;

  perform 1
  from public.production_plan_items
  where plan_id = p_plan_id and store = p_store
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'A loja nao possui itens neste planejamento.';
  end if;

  delete from public.orders
  where store = p_store
    and order_date = v_plan.production_date
    and order_type = 'producao';

  for v_item in
    select *
    from public.production_plan_items
    where plan_id = p_plan_id and store = p_store
    order by bread_id
  loop
    v_new_quantity := greatest(
      0,
      v_item.planned_quantity
        - v_item.frozen_quantity
        - coalesce(v_item.leftover_confirmed_quantity, v_item.leftover_proposed_quantity, 0)
    );

    v_proposals := v_proposals || jsonb_build_array(jsonb_build_object(
      'bread_id', v_item.bread_id,
      'quantity', v_item.leftover_proposed_quantity
    ));

    if v_item.leftover_proposed_quantity > 0 then
      v_proposal_count := v_proposal_count + 1;
    end if;

    if v_new_quantity > 0 then
      insert into public.orders (
        store, bread_id, quantity, order_date, order_type, obs
      ) values (
        p_store, v_item.bread_id, v_new_quantity,
        v_plan.production_date, 'producao', 'Gerado pelo Planejamento'
      );
      v_order_count := v_order_count + 1;
    end if;
  end loop;

  perform public.save_bread_reuse_proposals(
    v_plan.production_date,
    p_store,
    v_proposals
  );

  v_actor_name := coalesce(nullif(btrim(p_actor_name), ''), v_profile_name, 'Usuario');

  update public.production_plan_items
  set order_created_at = v_imported_at,
      order_created_by_name = v_actor_name
  where plan_id = p_plan_id
    and store = p_store;

  if not exists (
    select 1
    from public.production_plan_items item
    where item.plan_id = p_plan_id
      and item.order_created_at is null
      and greatest(
        0,
        item.planned_quantity
          - item.frozen_quantity
          - coalesce(item.leftover_confirmed_quantity, item.leftover_proposed_quantity, 0)
      ) > 0
  ) then
    update public.production_plans
    set status = 'fechado'
    where id = p_plan_id;
  end if;

  return jsonb_build_object(
    'plan_id', p_plan_id,
    'store', p_store,
    'order_count', v_order_count,
    'proposal_count', v_proposal_count
  );
end;
$$;

revoke all on function public.import_production_plan_order(uuid, text, text) from public, anon;
grant execute on function public.import_production_plan_order(uuid, text, text) to authenticated;
