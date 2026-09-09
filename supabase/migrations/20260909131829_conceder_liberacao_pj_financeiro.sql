-- A conta ficticia do Financeiro ja recebia esta concessao no seed, mas a
-- migration que criou a jornada nao alinhou os perfis reais existentes. O
-- recorte abaixo concede somente a quem ja exerce a operacao financeira PJ.
begin;

create function private.backfill_pj_flow_release_for_finance() returns integer
language plpgsql set search_path = '' as $$
declare
  v_inserted integer;
begin
  insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
  select profile.user_id, 'pedidos_pj.liberar', 'jc', null::uuid
  from public.app_profiles profile
  where profile.active
    and profile.role = 'financeiro'
    and exists (
      select 1
      from public.app_user_permissions permission
      where permission.user_id = profile.user_id
        and permission.permission_key = 'pedidos_pj.acessar'
        and permission.scope in ('*', 'jc')
    )
    and exists (
      select 1
      from public.app_user_permissions permission
      where permission.user_id = profile.user_id
        and permission.permission_key = 'contas_receber.acessar'
        and permission.scope in ('*', 'jc')
    )
    and exists (
      select 1
      from public.app_user_permissions permission
      where permission.user_id = profile.user_id
        and permission.permission_key = 'contas_receber.lancar'
        and permission.scope in ('*', 'jc')
    )
  on conflict (user_id, permission_key, scope) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;
revoke all on function private.backfill_pj_flow_release_for_finance()
  from public, anon, authenticated;

select private.backfill_pj_flow_release_for_finance();

commit;
