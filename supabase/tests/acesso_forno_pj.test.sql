begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

select ok(has_function_privilege('authenticated',
  'public.list_pj_production_for_oven(date)', 'execute'),
  'perfil autenticado pode chamar a lista legada mediante validacao interna');
select ok(has_function_privilege('authenticated',
  'public.list_pj_production_for_oven_v2(date)', 'execute'),
  'perfil autenticado pode chamar a lista atual mediante validacao interna');
select ok(not has_function_privilege('anon',
  'public.list_pj_production_for_oven(date)', 'execute'),
  'anonimo nao chama a lista legada do forno');
select ok(not has_function_privilege('anon',
  'public.list_pj_production_for_oven_v2(date)', 'execute'),
  'anonimo nao chama a lista atual do forno');
select ok((select prosecdef from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = 'list_pj_production_for_oven_v2'),
  'lista atual valida o acesso dentro de uma funcao protegida');
select ok((select proconfig from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = 'list_pj_production_for_oven_v2') @> array['search_path=""'],
  'lista atual usa caminho de busca fechado');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('99400000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'forno-operador-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('99400000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'forno-planejador-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('99400000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'forno-bloqueado-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('99400000-0000-4000-8000-000000000001', 'Operador Forno', 'producao', 'jc', true, '["/forno"]'::jsonb),
  ('99400000-0000-4000-8000-000000000002', 'Planejador PJ', 'producao', 'jc', true, '["/"]'::jsonb),
  ('99400000-0000-4000-8000-000000000003', 'Vendas sem Forno', 'vendas', 'ja', true, '["/romaneio"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope)
values
  ('99400000-0000-4000-8000-000000000001', 'forno.acessar', 'jc'),
  ('99400000-0000-4000-8000-000000000002', 'producao_pj.programar', 'jc');

set local role authenticated;
select set_config('request.jwt.claim.sub', '99400000-0000-4000-8000-000000000001', true);

select ok(private.current_user_has_permission('forno.acessar', 'jc'),
  'operador possui a permissao especifica do forno');
select ok(not private.current_user_can_plan_pj_production(),
  'operador do forno nao ganha permissao para programar producao PJ');
select lives_ok(
  $$select * from public.list_pj_production_for_oven(current_date)$$,
  'operador consulta a lista legada do forno');
select lives_ok(
  $$select * from public.list_pj_production_for_oven_v2(current_date)$$,
  'operador consulta a lista atual do forno');

select set_config('request.jwt.claim.sub', '99400000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$select * from public.list_pj_production_for_oven_v2(current_date)$$,
  'planejador continua consultando a lista atual');

select set_config('request.jwt.claim.sub', '99400000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select * from public.list_pj_production_for_oven(current_date)$$,
  '42501', 'Usuario sem permissao para consultar a producao PJ.',
  'perfil sem forno nem planejamento continua bloqueado na lista legada');
select throws_ok(
  $$select * from public.list_pj_production_for_oven_v2(current_date)$$,
  '42501', 'Usuario sem permissao para consultar a producao PJ.',
  'perfil sem forno nem planejamento continua bloqueado na lista atual');

select * from finish();
rollback;
