-- Compatibilidade para o rollout em duas fases:
-- 1. criar a operação estreita;
-- 2. publicar o frontend que a usa;
-- 3. revogar o UPDATE anônimo amplo na migration de hardening.

-- Perfis criados ou alterados depois do backfill inicial podem ter a rota
-- operacional aprovada, mas ainda não possuir a permissão equivalente.
-- A reconciliação usa somente a matriz já vigente, sem nomes ou UUIDs fixos.
with route_permissions(route, permission_key, uses_store_scope) as (
  values
    ('/sobras'::text, 'sobras.acessar'::text, true),
    ('/estoque-congelado', 'congelado.acessar', true),
    ('/relatorios', 'relatorios.acessar', true),
    ('/compras', 'compras.acessar', false),
    ('/cotacoes', 'cotacoes.acessar', false),
    ('/fornecedores', 'fornecedores.acessar', false)
)
insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
select
  profile.user_id,
  mapping.permission_key,
  case
    when mapping.uses_store_scope then coalesce(lower(profile.store), '*')
    else '*'
  end,
  null::uuid
from public.app_profiles profile
cross join route_permissions mapping
where profile.active
  and coalesce(profile.allowed_routes, '[]'::jsonb) ? mapping.route
  and not exists (
    select 1
    from public.app_user_permissions existing
    where existing.user_id = profile.user_id
      and existing.permission_key = mapping.permission_key
      and (
        existing.scope = '*'
        or (
          mapping.uses_store_scope
          and existing.scope = lower(coalesce(profile.store, '*'))
        )
      )
  )
on conflict do nothing;

create or replace function public.mark_bread_for_shelf(p_bread_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope text;
begin
  if nullif(trim(p_bread_id), '') is null then
    raise exception using errcode = '22023', message = 'Pao obrigatorio.';
  end if;

  select coalesce(lower(profile.store), '*')
  into v_scope
  from public.app_profiles profile
  where profile.user_id = (select auth.uid())
    and profile.active;

  if v_scope is null
     or not (select private.current_user_has_permission('sobras.acessar', v_scope)) then
    raise exception using errcode = '42501', message = 'Sem permissao para incluir pao na Prateleira.';
  end if;

  update public.breads
  set is_shelf = true
  where id = p_bread_id
    and active is true;

  if not found then
    raise exception using errcode = 'P0002', message = 'Pao ativo nao encontrado.';
  end if;
end;
$$;

revoke all on function public.mark_bread_for_shelf(text) from public, anon, authenticated;
grant execute on function public.mark_bread_for_shelf(text) to authenticated;
