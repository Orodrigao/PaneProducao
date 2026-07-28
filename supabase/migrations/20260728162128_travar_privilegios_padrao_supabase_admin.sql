-- O projeto hospedado ainda mantinha default privileges amplos para objetos
-- criados por supabase_admin. Isso nao altera permissao de tabela, sequencia
-- ou funcao ja existente; apenas impede que objetos futuros nascam expostos
-- automaticamente pela Data API.

alter default privileges for role supabase_admin in schema public
  revoke all privileges on tables from anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public
  revoke all privileges on sequences from anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public
  revoke all privileges on functions from public, anon, authenticated, service_role;

alter default privileges for role supabase_admin in schema private
  revoke all privileges on tables from anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema private
  revoke all privileges on sequences from anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema private
  revoke all privileges on functions from public, anon, authenticated, service_role;
