-- CANARIO DA PR 469, NUNCA INTEGRAR: defeito proposital.
-- A checagem de permissao passa a liberar producao_cozinha.lancar para qualquer
-- pessoa logada. A tela continua barrando Vendas JA (rotas), so a Data API
-- denuncia. O check "Navegador no preview desta PR" precisa ficar vermelho.
create or replace function private.current_user_has_permission(p_permission_key text, p_scope text default '*')
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_permission_key = 'producao_cozinha.lancar'
    or exists(
      select 1 from public.app_profiles profile
      join public.app_user_permissions permission on permission.user_id = profile.user_id
      where profile.user_id = (select auth.uid()) and profile.active
        and permission.permission_key = p_permission_key
        and (permission.scope = '*' or permission.scope = lower(p_scope))
    );
$$;
