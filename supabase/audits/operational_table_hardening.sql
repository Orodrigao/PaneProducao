-- Auditoria somente leitura. Resultado esperado após o hardening:
-- public_tables = 50 (ou o total vigente), rls_enabled = public_tables,
-- tables_with_anon_write_policy = 0 e tables_with_anon_write_grant = 0.

select
  count(*) filter (where table_type = 'BASE TABLE') as public_tables,
  count(*) filter (
    where table_type = 'BASE TABLE'
      and relation.relrowsecurity
  ) as rls_enabled
from information_schema.tables table_info
join pg_class relation on relation.relname = table_info.table_name
join pg_namespace namespace
  on namespace.oid = relation.relnamespace
 and namespace.nspname = table_info.table_schema
where table_info.table_schema = 'public';

select
  count(distinct policy.tablename) as tables_with_anon_write_policy,
  count(*) as anon_write_policies
from pg_policies policy
where policy.schemaname = 'public'
  and policy.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  and (
    'anon' = any(policy.roles)
    or 'public' = any(policy.roles)
  );

select
  policy.tablename,
  policy.policyname,
  policy.roles,
  policy.cmd,
  policy.qual,
  policy.with_check
from pg_policies policy
where policy.schemaname = 'public'
  and policy.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  and (
    'anon' = any(policy.roles)
    or 'public' = any(policy.roles)
  )
order by policy.tablename, policy.policyname;

select
  count(distinct grant_entry.table_name) as tables_with_anon_write_grant,
  count(*) as anon_write_grants
from information_schema.role_table_grants grant_entry
where grant_entry.table_schema = 'public'
  and lower(grant_entry.grantee) in ('anon', 'public')
  and grant_entry.privilege_type in (
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'REFERENCES',
    'TRIGGER'
  );

select
  grant_entry.table_name,
  string_agg(grant_entry.privilege_type, ', ' order by grant_entry.privilege_type) as privileges
from information_schema.role_table_grants grant_entry
where grant_entry.table_schema = 'public'
  and lower(grant_entry.grantee) in ('anon', 'public')
  and grant_entry.privilege_type in (
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'REFERENCES',
    'TRIGGER'
  )
group by grant_entry.table_name
order by grant_entry.table_name;

select
  owner_role.rolname as owner,
  default_acl.defaclobjtype as object_type,
  default_acl.defaclacl::text as default_acl
from pg_default_acl default_acl
join pg_roles owner_role on owner_role.oid = default_acl.defaclrole
join pg_namespace namespace on namespace.oid = default_acl.defaclnamespace
where namespace.nspname = 'public'
  and owner_role.rolname in ('postgres', 'supabase_admin')
order by owner_role.rolname, default_acl.defaclobjtype;

with route_permissions(route, permission_key, uses_store_scope) as (
  values
    ('/sobras'::text, 'sobras.acessar'::text, true),
    ('/estoque-congelado', 'congelado.acessar', true),
    ('/relatorios', 'relatorios.acessar', true),
    ('/compras', 'compras.acessar', false),
    ('/cotacoes', 'cotacoes.acessar', false),
    ('/fornecedores', 'fornecedores.acessar', false)
),
coverage as (
  select
    mapping.route,
    exists (
      select 1
      from public.app_user_permissions permission
      where permission.user_id = profile.user_id
        and permission.permission_key = mapping.permission_key
        and (
          permission.scope = '*'
          or (
            mapping.uses_store_scope
            and permission.scope = lower(coalesce(profile.store, '*'))
          )
        )
    ) as covered
  from public.app_profiles profile
  cross join route_permissions mapping
  where profile.active
    and coalesce(profile.allowed_routes, '[]'::jsonb) ? mapping.route
)
select
  route,
  count(*) as active_profiles_with_route,
  count(*) filter (where not covered) as missing_permission
from coverage
group by route
order by route;
