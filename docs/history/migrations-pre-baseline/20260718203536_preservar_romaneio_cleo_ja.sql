-- Preserva o acesso que Cléo já tinha ao Romaneio da JA,
-- além das novas permissões de entrega para a EX.
insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
select profile.user_id, grant_row.permission_key, 'ja', null::uuid
from public.app_profiles profile
cross join (
  values
    ('romaneio.visualizar'::text),
    ('romaneio.confirmar_saida'::text)
) grant_row(permission_key)
where profile.active
  and lower(profile.display_name) = 'cleo'
on conflict do nothing;
