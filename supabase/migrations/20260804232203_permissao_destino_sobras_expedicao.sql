-- Expedição pode resolver sobras somente quando a ação foi concedida
-- explicitamente para a loja correspondente.

insert into public.app_permissions (key, module, label, description, sort_order)
values (
  'sobras.dar_destino',
  'Operacao',
  'Dar destino às sobras',
  'Registrar descarte, doação, consumo interno, vitrine ou congelamento.',
  51
)
on conflict (key) do update set
  module = excluded.module,
  label = excluded.label,
  description = excluded.description,
  sort_order = excluded.sort_order
where (app_permissions.module, app_permissions.label,
       app_permissions.description, app_permissions.sort_order)
  is distinct from
      (excluded.module, excluded.label,
       excluded.description, excluded.sort_order);

do $$
declare
  target_count integer;
begin
  select count(*)
  into target_count
  from public.app_profiles profile
  where profile.active
    and lower(profile.display_name) = 'gustavo'
    and profile.role = 'expedicao'
    and lower(profile.store) = 'jc';

  if target_count > 1 then
    raise exception 'Esperado no maximo 1 perfil ativo Gustavo/Expedicao JC; encontrado %.', target_count;
  end if;
end
$$;

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
select profile.user_id, 'sobras.dar_destino', 'jc', null::uuid
from public.app_profiles profile
where profile.active
  and lower(profile.display_name) = 'gustavo'
  and profile.role = 'expedicao'
  and lower(profile.store) = 'jc'
on conflict (user_id, permission_key, scope) do nothing;

create or replace function public.resolve_bread_leftover(
  p_sobra_id uuid,
  p_action text,
  p_quantity numeric,
  p_freezer_location text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile_name text;
  v_profile_role text;
  v_profile_store text;
  v_profile_found boolean;
  v_sobra public.sobras%rowtype;
  v_event_id uuid;
  v_bread_name text;
  v_bread_unit text;
  v_frozen_product_id uuid;
  v_freezer_location text;
  v_previous_frozen integer := 0;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Entre com e-mail para dar destino a sobra.';
  end if;

  select display_name, role, store
  into v_profile_name, v_profile_role, v_profile_store
  from public.app_profiles
  where user_id = v_user_id and active;
  v_profile_found := found;

  select * into v_sobra from public.sobras where id = p_sobra_id for update;
  if not found or v_sobra.store is null or v_sobra.product_source <> 'bread' then
    raise exception using errcode = 'P0002', message = 'Sobra pendente nao encontrada.';
  end if;

  if not v_profile_found or not (
    v_profile_role in ('admin', 'producao', 'vendas', 'estoque')
    or (
      v_sobra.store in ('jc', 'ja')
      and private.current_user_has_permission('sobras.dar_destino', v_sobra.store)
    )
  ) then
    raise exception using errcode = '42501', message = 'Usuario sem permissao para dar destino a sobra.';
  end if;

  if v_profile_role = 'vendas' and v_profile_store is distinct from v_sobra.store then
    raise exception using errcode = '42501', message = 'A atendente so pode movimentar a propria loja.';
  end if;

  if p_action not in ('display', 'internal_use', 'donation', 'discard', 'freeze')
    or p_quantity is null or p_quantity <= 0 or p_quantity > v_sobra.pending_quantity then
    raise exception using errcode = '22023', message = 'Destino ou quantidade invalida.';
  end if;

  if p_action = 'freeze' and p_quantity <> trunc(p_quantity) then
    raise exception using errcode = '22023', message = 'O estoque congelado aceita somente unidades inteiras.';
  end if;

  insert into public.bread_leftover_events (
    sobra_id, action, quantity, from_location, to_location,
    actor_id, actor_name
  ) values (
    v_sobra.id, p_action, p_quantity, v_sobra.physical_location,
    case p_action
      when 'display' then 'vitrine'
      when 'internal_use' then 'consumo_interno'
      when 'donation' then 'doacao'
      when 'discard' then 'descarte'
      else coalesce(p_freezer_location, case when v_sobra.store = 'jc' then 'jc-freezer' else 'ja-freezer' end)
    end,
    v_user_id, v_profile_name
  ) returning id into v_event_id;

  if p_action in ('internal_use', 'donation', 'discard', 'freeze') then
    insert into public.bread_movements (
      movement_type, bread_id, location, quantity, reference_id,
      reference_type, recorded_by, lot_id, obs
    ) values (
      case p_action
        when 'internal_use' then 'consumo_interno'
        when 'donation' then 'doacao'
        when 'discard' then 'descarte_loja'
        else 'sobra_congelada'
      end,
      v_sobra.product_id, v_sobra.store, -p_quantity, v_event_id::text,
      'bread_leftover_event', v_profile_name, v_sobra.production_actual_id,
      'Destino de sobra ' || p_action
    );
  end if;

  if p_action = 'freeze' then
    v_freezer_location := coalesce(
      p_freezer_location,
      case when v_sobra.store = 'jc' then 'jc-freezer' else 'ja-freezer' end
    );

    if (v_sobra.store = 'jc' and v_freezer_location not in ('jc-freezer', 'jc-camara', 'jc-freezer-loja'))
      or (v_sobra.store = 'ja' and v_freezer_location <> 'ja-freezer') then
      raise exception using errcode = '22023', message = 'Freezer invalido para a loja.';
    end if;

    select name, unit into v_bread_name, v_bread_unit
    from public.breads where id = v_sobra.product_id;

    insert into public.frozen_products (
      product_id, product_source, product_name, unit, min_stock,
      active, visible_stores
    ) values (
      v_sobra.product_id, 'bread', v_bread_name, coalesce(v_bread_unit, 'un'),
      0, true, array[v_sobra.store]
    )
    on conflict (product_id, product_source)
      where active = true and product_id is not null
    do update set
      visible_stores = case
        when public.frozen_products.visible_stores is null then null
        when v_sobra.store = any(public.frozen_products.visible_stores)
          then public.frozen_products.visible_stores
        else array_append(public.frozen_products.visible_stores, v_sobra.store)
      end
    returning id into v_frozen_product_id;

    insert into public.frozen_stock(frozen_product_id, location, quantity, updated_at)
    values (v_frozen_product_id, v_freezer_location, p_quantity::integer, now())
    on conflict (frozen_product_id, location)
    do update set quantity = public.frozen_stock.quantity + excluded.quantity,
                  updated_at = excluded.updated_at
    returning quantity - p_quantity::integer into v_previous_frozen;

    insert into public.frozen_movements (
      frozen_product_id, location, movement_type, quantity,
      previous_quantity, obs, responsible
    ) values (
      v_frozen_product_id, v_freezer_location, 'entrada', p_quantity::integer,
      v_previous_frozen, 'Congelado a partir da sobra ' || v_sobra.lot_code,
      v_profile_name
    );
  end if;

  update public.sobras
  set pending_quantity = pending_quantity - p_quantity,
      status = case when pending_quantity - p_quantity = 0 then 'resolved' else 'pending' end,
      updated_at = now()
  where id = v_sobra.id;

  return jsonb_build_object(
    'sobra_id', v_sobra.id,
    'action', p_action,
    'resolved_quantity', p_quantity,
    'pending_quantity', v_sobra.pending_quantity - p_quantity
  );
end;
$$;

create or replace function public.update_bread_leftover_location(
  p_sobra_id uuid,
  p_physical_location text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile_name text;
  v_profile_role text;
  v_profile_store text;
  v_profile_found boolean;
  v_sobra public.sobras%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Entre com e-mail para alterar o local.';
  end if;

  select display_name, role, store
  into v_profile_name, v_profile_role, v_profile_store
  from public.app_profiles
  where user_id = v_user_id and active;
  v_profile_found := found;

  if p_physical_location not in ('balcao_fechamento', 'mesa_separacao', 'padaria_cozinha') then
    raise exception using errcode = '22023', message = 'Local fisico invalido.';
  end if;

  select * into v_sobra from public.sobras where id = p_sobra_id for update;
  if not found or coalesce(v_sobra.pending_quantity, 0) <= 0 then
    raise exception using errcode = 'P0002', message = 'Sobra pendente nao encontrada.';
  end if;

  if not v_profile_found or not (
    v_profile_role in ('admin', 'producao', 'vendas', 'estoque')
    or (
      v_sobra.store in ('jc', 'ja')
      and private.current_user_has_permission('sobras.dar_destino', v_sobra.store)
    )
  ) then
    raise exception using errcode = '42501', message = 'Usuario sem permissao para alterar o local.';
  end if;

  if v_profile_role = 'vendas' and v_profile_store is distinct from v_sobra.store then
    raise exception using errcode = '42501', message = 'A atendente so pode movimentar a propria loja.';
  end if;

  update public.sobras
  set physical_location = p_physical_location, updated_at = now()
  where id = v_sobra.id;

  insert into public.bread_leftover_events (
    sobra_id, action, quantity, from_location, to_location,
    actor_id, actor_name
  ) values (
    v_sobra.id, 'location_changed', 0, v_sobra.physical_location,
    p_physical_location, v_user_id, v_profile_name
  );

  return jsonb_build_object('sobra_id', v_sobra.id, 'physical_location', p_physical_location);
end;
$$;
