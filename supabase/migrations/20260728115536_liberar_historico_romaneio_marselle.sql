do $$
declare
  target_count integer;
  target_user_id uuid;
  missing_permissions text[];
begin
  select count(*)
    into target_count
  from auth.users user_account
  join public.app_profiles profile on profile.user_id = user_account.id
  where lower(user_account.email) = 'borges@paneesalute.com.br'
    and profile.active;

  if target_count > 1 then
    raise exception 'Esperado no maximo 1 perfil ativo da Marselle; encontrado %.', target_count;
  end if;

  if target_count = 0 then
    return;
  end if;

  select user_account.id
    into target_user_id
  from auth.users user_account
  join public.app_profiles profile on profile.user_id = user_account.id
  where lower(user_account.email) = 'borges@paneesalute.com.br'
    and profile.active;

  with requested_permissions(permission_key) as (
    values
      ('relatorios.acessar'),
      ('romaneio.acessar'),
      ('romaneio.visualizar')
  )
  select array_agg(requested.permission_key order by requested.permission_key)
    into missing_permissions
  from requested_permissions requested
  left join public.app_permissions permission on permission.key = requested.permission_key
  where permission.key is null;

  if coalesce(array_length(missing_permissions, 1), 0) > 0 then
    raise exception 'Catalogo sem permissoes esperadas para liberar historico EX: %.', missing_permissions;
  end if;

  update public.app_profiles profile
  set allowed_routes = (
    select jsonb_agg(route order by first_seen)
    from (
      select route, min(first_seen) as first_seen
      from (
        select route.value as route, route.ordinality as first_seen
        from jsonb_array_elements_text(coalesce(profile.allowed_routes, '[]'::jsonb))
          with ordinality as route(value, ordinality)

        union all

        values
          ('/relatorios', 1000::bigint),
          ('/relatorios/romaneios', 1001::bigint)
      ) routes
      group by route
    ) ordered_routes
  )
  where profile.user_id = target_user_id;

  insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
  values
    (target_user_id, 'relatorios.acessar', '*', null),
    (target_user_id, 'romaneio.acessar', '*', null),
    (target_user_id, 'romaneio.visualizar', 'ex', null)
  on conflict (user_id, permission_key, scope) do nothing;
end
$$;

drop policy if exists "price_tiers_select_commercial" on public.price_tiers;
create policy "price_tiers_select_commercial"
on public.price_tiers
for select
to authenticated
using (
  exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and profile.role = any (array['admin'::text, 'financeiro'::text])
  )
  or (
    lower(btrim(name)) = 'buck'
    and private.current_user_has_permission('relatorios.acessar')
    and private.current_user_has_permission('romaneio.visualizar', 'ex')
  )
);

drop policy if exists "price_tier_items_select_commercial" on public.price_tier_items;
create policy "price_tier_items_select_commercial"
on public.price_tier_items
for select
to authenticated
using (
  exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and profile.role = any (array['admin'::text, 'financeiro'::text])
  )
  or (
    exists (
      select 1
      from public.price_tiers tier
      where tier.id = price_tier_items.tier_id
        and lower(btrim(tier.name)) = 'buck'
    )
    and private.current_user_has_permission('relatorios.acessar')
    and private.current_user_has_permission('romaneio.visualizar', 'ex')
  )
);
