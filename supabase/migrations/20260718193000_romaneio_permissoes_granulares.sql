-- Romaneio: autorização explícita por ação e destino.
-- Loja do perfil continua sendo contexto de dados, nunca identidade operacional.

insert into public.app_permissions (key, module, label, description, sort_order)
values
  ('romaneio.visualizar', 'Romaneio', 'Visualizar', 'Consultar e imprimir romaneios.', 31),
  ('romaneio.criar', 'Romaneio', 'Criar', 'Montar um novo romaneio para a loja selecionada.', 32),
  ('romaneio.confirmar_saida', 'Romaneio', 'Confirmar saída', 'Confirmar a saída e movimentar o saldo de pães.', 33),
  ('romaneio.conferir_recebimento', 'Romaneio', 'Conferir recebimento', 'Informar quantidades recebidas e divergências.', 34),
  ('romaneio.aprovar_divergencia', 'Romaneio', 'Aprovar divergências', 'Aprovar divergências registradas no recebimento.', 35),
  ('romaneio.administrar', 'Romaneio', 'Administrar', 'Acesso completo, inclusive exclusão e fechamento.', 36)
on conflict (key) do update
set module = excluded.module,
    label = excluded.label,
    description = excluded.description,
    sort_order = excluded.sort_order;

create or replace function private.current_user_has_permission(
  p_permission_key text,
  p_scope text default '*'
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_profiles profile
    join public.app_user_permissions permission on permission.user_id = profile.user_id
    where profile.user_id = (select auth.uid())
      and profile.active
      and permission.permission_key = p_permission_key
      and (permission.scope = '*' or permission.scope = lower(p_scope))
  );
$$;

revoke all on function private.current_user_has_permission(text, text) from public;
grant execute on function private.current_user_has_permission(text, text) to authenticated;

drop function if exists public.replace_user_permissions(uuid, text[]);

create or replace function public.replace_user_permissions(
  p_user_id uuid,
  p_assignments jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'Usuario obrigatorio.';
  end if;
  if jsonb_typeof(coalesce(p_assignments, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'Lista de permissoes invalida.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_assignments, '[]'::jsonb))
      requested("permissionKey" text, scope text)
    left join public.app_permissions permission on permission.key = requested."permissionKey"
    where permission.key is null
       or requested.scope not in ('*', 'jc', 'ja', 'ex')
  ) then
    raise exception using errcode = '22023', message = 'Permissao ou loja desconhecida.';
  end if;

  delete from public.app_user_permissions where user_id = p_user_id;

  insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
  select distinct p_user_id, requested."permissionKey", requested.scope, (select auth.uid())
  from jsonb_to_recordset(coalesce(p_assignments, '[]'::jsonb))
    requested("permissionKey" text, scope text);
end;
$$;

revoke all on function public.replace_user_permissions(uuid, jsonb) from public, anon;
grant execute on function public.replace_user_permissions(uuid, jsonb) to authenticated;

-- Backfill único da matriz aprovada. Nomes são usados somente para localizar
-- os perfis existentes nesta migração; nenhuma autorização futura depende deles.
with grants(display_name, permission_key, scope) as (
  values
    ('cleo', 'romaneio.visualizar', 'ex'),
    ('cleo', 'romaneio.confirmar_saida', 'ex'),
    ('conferência ex', 'romaneio.visualizar', 'ex'),
    ('conferência ex', 'romaneio.conferir_recebimento', 'ex'),
    ('expedicao', 'romaneio.visualizar', '*'),
    ('expedicao', 'romaneio.criar', '*'),
    ('expedicao', 'romaneio.confirmar_saida', '*'),
    ('geolar', 'romaneio.visualizar', '*'),
    ('gustavo', 'romaneio.visualizar', '*'),
    ('gustavo', 'romaneio.criar', '*'),
    ('gustavo', 'romaneio.confirmar_saida', '*'),
    ('marselle', 'romaneio.visualizar', 'ex'),
    ('marselle', 'romaneio.conferir_recebimento', 'ex')
)
insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
select profile.user_id, grants.permission_key, grants.scope, null::uuid
from public.app_profiles profile
join grants on lower(profile.display_name) = grants.display_name
where profile.active
on conflict do nothing;

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
select profile.user_id, permission.key, '*', null::uuid
from public.app_profiles profile
cross join public.app_permissions permission
where profile.active
  and (
    profile.role = 'admin'
    or lower(profile.display_name) = 'elis'
  )
  and permission.key like 'romaneio.%'
on conflict do nothing;

drop policy if exists romaneios_manage_route_store on public.romaneios;
drop policy if exists romaneio_items_manage_route_store on public.romaneio_items;
drop policy if exists destinations_read_romaneio_scope on public.destinations;
drop policy if exists product_prices_read_authorized_scope on public.product_prices;

create policy destinations_read_romaneio_permission on public.destinations
for select to authenticated
using (
  (select private.current_user_has_permission('romaneio.visualizar', code))
  or (select private.current_user_has_permission('romaneio.criar', code))
  or (select private.current_user_has_permission('romaneio.confirmar_saida', code))
  or (select private.current_user_has_permission('romaneio.conferir_recebimento', code))
  or (select private.current_user_has_permission('romaneio.aprovar_divergencia', code))
  or (select private.current_user_has_permission('romaneio.administrar', code))
);

create policy product_prices_read_romaneio_permission on public.product_prices
for select to authenticated
using (
  destination_id is null
  or exists (
    select 1 from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and coalesce(profile.allowed_routes, '[]'::jsonb) ? '/tabelas-preco'
      and profile.role in ('admin', 'financeiro')
  )
  or exists (
    select 1 from public.destinations destination
    where destination.id = product_prices.destination_id
      and (
        (select private.current_user_has_permission('romaneio.visualizar', destination.code))
        or (select private.current_user_has_permission('romaneio.criar', destination.code))
        or (select private.current_user_has_permission('romaneio.administrar', destination.code))
      )
  )
);

create policy romaneios_select_permission on public.romaneios
for select to authenticated
using (
  exists (
    select 1 from public.destinations destination
    where destination.id = romaneios.destination_id
      and (
        (select private.current_user_has_permission('romaneio.visualizar', destination.code))
        or (select private.current_user_has_permission('romaneio.administrar', destination.code))
      )
  )
);

create policy romaneios_insert_permission on public.romaneios
for insert to authenticated
with check (
  status = 'separado'
  and exists (
    select 1 from public.destinations destination
    where destination.id = romaneios.destination_id
      and (select private.current_user_has_permission('romaneio.criar', destination.code))
  )
);

create policy romaneios_update_admin_permission on public.romaneios
for update to authenticated
using (
  exists (
    select 1 from public.destinations destination
    where destination.id = romaneios.destination_id
      and (select private.current_user_has_permission('romaneio.administrar', destination.code))
  )
)
with check (
  exists (
    select 1 from public.destinations destination
    where destination.id = romaneios.destination_id
      and (select private.current_user_has_permission('romaneio.administrar', destination.code))
  )
);

create policy romaneios_delete_admin_permission on public.romaneios
for delete to authenticated
using (
  exists (
    select 1 from public.destinations destination
    where destination.id = romaneios.destination_id
      and (select private.current_user_has_permission('romaneio.administrar', destination.code))
  )
);

create policy romaneio_items_select_permission on public.romaneio_items
for select to authenticated
using (
  exists (
    select 1
    from public.romaneios romaneio
    join public.destinations destination on destination.id = romaneio.destination_id
    where romaneio.id = romaneio_items.romaneio_id
      and (
        (select private.current_user_has_permission('romaneio.visualizar', destination.code))
        or (select private.current_user_has_permission('romaneio.administrar', destination.code))
      )
  )
);

create policy romaneio_items_insert_permission on public.romaneio_items
for insert to authenticated
with check (
  exists (
    select 1
    from public.romaneios romaneio
    join public.destinations destination on destination.id = romaneio.destination_id
    where romaneio.id = romaneio_items.romaneio_id
      and romaneio.status = 'separado'
      and (select private.current_user_has_permission('romaneio.criar', destination.code))
  )
);

create policy romaneio_items_update_admin_permission on public.romaneio_items
for update to authenticated
using (
  exists (
    select 1
    from public.romaneios romaneio
    join public.destinations destination on destination.id = romaneio.destination_id
    where romaneio.id = romaneio_items.romaneio_id
      and (select private.current_user_has_permission('romaneio.administrar', destination.code))
  )
);

create policy romaneio_items_delete_admin_permission on public.romaneio_items
for delete to authenticated
using (
  exists (
    select 1
    from public.romaneios romaneio
    join public.destinations destination on destination.id = romaneio.destination_id
    where romaneio.id = romaneio_items.romaneio_id
      and (select private.current_user_has_permission('romaneio.administrar', destination.code))
  )
);

create or replace function public.confirm_romaneio_departure(p_romaneio_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_destination_code text;
  v_user_name text;
  v_movements_exist boolean;
begin
  select romaneio.status, destination.code
  into v_status, v_destination_code
  from public.romaneios romaneio
  join public.destinations destination on destination.id = romaneio.destination_id
  where romaneio.id = p_romaneio_id
  for update of romaneio;

  if not found then raise exception using errcode = 'P0002', message = 'Romaneio nao encontrado.'; end if;
  if not (select private.current_user_has_permission('romaneio.confirmar_saida', v_destination_code)) then
    raise exception using errcode = '42501', message = 'Sem permissao para confirmar esta saida.';
  end if;
  if v_status <> 'separado' then
    raise exception using errcode = '22023', message = 'O romaneio nao esta separado.';
  end if;

  select profile.display_name into v_user_name
  from public.app_profiles profile
  where profile.user_id = (select auth.uid()) and profile.active;
  if v_user_name is null then raise exception using errcode = '42501', message = 'Perfil inativo.'; end if;

  select exists (
    select 1 from public.bread_movements existing
    where existing.reference_id = p_romaneio_id::text
      and existing.reference_type in ('romaneio', 'romaneio_kit')
  ) into v_movements_exist;

  insert into public.bread_movements
    (movement_type, bread_id, location, quantity, reference_id, reference_type, recorded_by)
  select 'romaneio_envio', item.product_id, movement.location, item.qty_sent * movement.factor,
    p_romaneio_id::text, 'romaneio', v_user_name
  from public.romaneio_items item
  cross join lateral (values ('central'::text, -1::numeric), (lower(v_destination_code), 1::numeric))
    movement(location, factor)
  where item.romaneio_id = p_romaneio_id
    and item.product_source = 'bread'
    and item.qty_sent > 0
    and not v_movements_exist;

  insert into public.bread_movements
    (movement_type, bread_id, location, quantity, reference_id, reference_type, recorded_by)
  select 'romaneio_envio', component.component_id, movement.location,
    item.qty_sent * component.quantity * movement.factor,
    p_romaneio_id::text, 'romaneio_kit', v_user_name
  from public.romaneio_items item
  join public.products product on product.id::text = item.product_id and product.kind = 'kit'
  join public.product_components component
    on component.parent_product_id = product.id and component.component_source = 'bread'
  cross join lateral (values ('central'::text, -1::numeric), (lower(v_destination_code), 1::numeric))
    movement(location, factor)
  where item.romaneio_id = p_romaneio_id
    and item.product_source <> 'bread'
    and item.qty_sent > 0
    and not v_movements_exist;

  update public.romaneios
  set status = 'enviado', sent_by = v_user_name, sent_at = now()
  where id = p_romaneio_id;
end;
$$;

create or replace function public.confirm_romaneio_receipt(
  p_romaneio_id uuid,
  p_items jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_destination_code text;
  v_status text;
  v_user_name text;
  v_has_divergence boolean := false;
  v_item record;
begin
  select destination.code, romaneio.status
  into v_destination_code, v_status
  from public.romaneios romaneio
  join public.destinations destination on destination.id = romaneio.destination_id
  where romaneio.id = p_romaneio_id
  for update of romaneio;

  if not found then raise exception using errcode = 'P0002', message = 'Romaneio nao encontrado.'; end if;
  if not (select private.current_user_has_permission('romaneio.conferir_recebimento', v_destination_code)) then
    raise exception using errcode = '42501', message = 'Sem permissao para conferir este recebimento.';
  end if;
  if v_status <> 'enviado' then
    raise exception using errcode = '22023', message = 'O romaneio ainda nao foi enviado ou ja foi conferido.';
  end if;

  select profile.display_name into v_user_name
  from public.app_profiles profile
  where profile.user_id = (select auth.uid()) and profile.active;
  if v_user_name is null then raise exception using errcode = '42501', message = 'Perfil inativo.'; end if;

  for v_item in
    select requested.id, requested.qty_received, requested.qty_accepted,
      requested.divergence_reason, requested.obs
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
      requested(id uuid, qty_received numeric, qty_accepted numeric, divergence_reason text, obs text)
  loop
    update public.romaneio_items item
    set qty_received = v_item.qty_received,
        qty_accepted = v_item.qty_accepted,
        divergence_reason = nullif(v_item.divergence_reason, ''),
        obs = nullif(v_item.obs, ''),
        item_status = case
          when v_item.qty_received is distinct from item.qty_sent
            or v_item.qty_accepted is distinct from v_item.qty_received
          then 'divergencia' else 'ok' end
    where item.id = v_item.id and item.romaneio_id = p_romaneio_id;
    if not found then raise exception using errcode = '22023', message = 'Item invalido para este romaneio.'; end if;
  end loop;

  select exists (
    select 1 from public.romaneio_items item
    where item.romaneio_id = p_romaneio_id and item.item_status = 'divergencia'
  ) into v_has_divergence;

  update public.romaneios
  set status = case when v_has_divergence then 'com_divergencia' else 'conferido' end,
      confirmed_by = v_user_name,
      confirmed_at = now()
  where id = p_romaneio_id;

  return case when v_has_divergence then 'com_divergencia' else 'conferido' end;
end;
$$;

create or replace function public.approve_romaneio_divergence(
  p_romaneio_id uuid default null,
  p_item_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_romaneio_id uuid;
  v_destination_code text;
begin
  if (p_romaneio_id is null) = (p_item_id is null) then
    raise exception using errcode = '22023', message = 'Informe o romaneio ou um item.';
  end if;

  if p_item_id is not null then
    select item.romaneio_id into v_romaneio_id
    from public.romaneio_items item where item.id = p_item_id;
  else
    v_romaneio_id := p_romaneio_id;
  end if;

  select destination.code into v_destination_code
  from public.romaneios romaneio
  join public.destinations destination on destination.id = romaneio.destination_id
  where romaneio.id = v_romaneio_id
  for update of romaneio;

  if not found then raise exception using errcode = 'P0002', message = 'Romaneio nao encontrado.'; end if;
  if not (select private.current_user_has_permission('romaneio.aprovar_divergencia', v_destination_code)) then
    raise exception using errcode = '42501', message = 'Sem permissao para aprovar esta divergencia.';
  end if;

  if p_item_id is null then
    update public.romaneio_items
    set item_status = 'aprovado'
    where romaneio_id = v_romaneio_id and item_status = 'divergencia';
  else
    update public.romaneio_items
    set item_status = 'aprovado'
    where id = p_item_id and romaneio_id = v_romaneio_id and item_status = 'divergencia';
    if not found then raise exception using errcode = '22023', message = 'Item sem divergencia pendente.'; end if;
  end if;

  if not exists (
    select 1 from public.romaneio_items
    where romaneio_id = v_romaneio_id and item_status = 'divergencia'
  ) then
    update public.romaneios set status = 'aprovado' where id = v_romaneio_id;
  end if;
end;
$$;

revoke all on function public.confirm_romaneio_departure(uuid) from public, anon;
revoke all on function public.confirm_romaneio_receipt(uuid, jsonb) from public, anon;
revoke all on function public.approve_romaneio_divergence(uuid, uuid) from public, anon;
grant execute on function public.confirm_romaneio_departure(uuid) to authenticated;
grant execute on function public.confirm_romaneio_receipt(uuid, jsonb) to authenticated;
grant execute on function public.approve_romaneio_divergence(uuid, uuid) to authenticated;
