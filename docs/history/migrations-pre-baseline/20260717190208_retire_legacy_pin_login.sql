-- Retira a superfície Data API usada apenas pelo login legado por PIN.
-- Aplicar somente após a preview desta PR confirmar login Auth por e-mail/senha.
-- A coluna pin permanece nesta etapa para permitir rollback administrativo controlado;
-- ela será removida em uma migração posterior após período de operação estável.

drop policy if exists anon_select_for_login on public.app_users;

revoke all privileges on table public.app_users from public;
revoke all privileges on table public.app_users from anon;
revoke all privileges on table public.app_users from authenticated;
