-- Remove os quatro grants residuais sem policy de escrita e fecha o padrão
-- que concedia automaticamente privilégios amplos a anon/authenticated.

revoke all on table public.pizza_categorias from public, anon;
revoke all on table public.pizza_despesas from public, anon;
revoke all on table public.pizza_usuarios from public, anon;
revoke all on table public.pizza_vendas from public, anon;

grant all on table public.pizza_categorias to service_role;
grant all on table public.pizza_despesas to service_role;
grant all on table public.pizza_usuarios to service_role;
grant all on table public.pizza_vendas to service_role;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated;

-- A migration deve falhar inteira caso a auditoria tenha ficado obsoleta e
-- alguma exposição anônima de escrita permaneça fora da lista revisada.
do $$
begin
  if exists (
    select 1
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
  ) then
    raise exception using
      errcode = '42501',
      message = 'Hardening incompleto: ainda existe grant de escrita para anon em public.';
  end if;

  if exists (
    select 1
    from pg_policies policy
    where policy.schemaname = 'public'
      and policy.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and (
        'anon' = any(policy.roles)
        or 'public' = any(policy.roles)
      )
  ) then
    raise exception using
      errcode = '42501',
      message = 'Hardening incompleto: ainda existe policy de escrita aplicavel a anon em public.';
  end if;
end;
$$;
