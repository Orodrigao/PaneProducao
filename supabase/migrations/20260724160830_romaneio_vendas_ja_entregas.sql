do $$
declare
  target_count integer;
  missing_permissions text[];
begin
  select count(*) into target_count
  from public.app_profiles profile
  where profile.active
    and profile.role = 'vendas'
    and lower(profile.store) = 'ja';

  if target_count <> 1 then
    raise exception 'Esperado exatamente 1 perfil ativo Vendas JA; encontrado %.', target_count;
  end if;

  with requested_permissions(permission_key) as (
    values
      ('caixa.acessar'),
      ('sobras.acessar'),
      ('encomendas.acessar'),
      ('congelado.acessar'),
      ('romaneio.acessar'),
      ('romaneio.visualizar'),
      ('romaneio.confirmar_saida')
  )
  select array_agg(requested.permission_key order by requested.permission_key)
    into missing_permissions
  from requested_permissions requested
  left join public.app_permissions permission on permission.key = requested.permission_key
  where permission.key is null;

  if coalesce(array_length(missing_permissions, 1), 0) > 0 then
    raise exception 'Catalogo sem permissoes esperadas para Vendas JA: %.', missing_permissions;
  end if;
end
$$;

with target_profiles as (
  select profile.user_id
  from public.app_profiles profile
  where profile.active
    and profile.role = 'vendas'
    and lower(profile.store) = 'ja'
)
update public.app_profiles profile
set allowed_routes = '[
  "/romaneio",
  "/fechamento-caixa",
  "/sobras",
  "/encomendas",
  "/estoque-congelado"
]'::jsonb
from target_profiles target
where profile.user_id = target.user_id;

with target_profiles as (
  select profile.user_id
  from public.app_profiles profile
  where profile.active
    and profile.role = 'vendas'
    and lower(profile.store) = 'ja'
)
delete from public.app_user_permissions assignment
using target_profiles target
where assignment.user_id = target.user_id;

with target_profiles as (
  select profile.user_id
  from public.app_profiles profile
  where profile.active
    and profile.role = 'vendas'
    and lower(profile.store) = 'ja'
), requested_permissions(permission_key, scope) as (
  values
    ('caixa.acessar', '*'),
    ('sobras.acessar', '*'),
    ('encomendas.acessar', '*'),
    ('congelado.acessar', '*'),
    ('romaneio.acessar', '*'),
    ('romaneio.visualizar', '*'),
    ('romaneio.confirmar_saida', '*')
)
insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
select target.user_id, requested.permission_key, requested.scope, null::uuid
from target_profiles target
join requested_permissions requested on true
join public.app_permissions permission on permission.key = requested.permission_key
on conflict (user_id, permission_key, scope) do nothing;
