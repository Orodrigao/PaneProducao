begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

select ok(
  has_function_privilege(
    'authenticated',
    'public.get_romaneio_production_composition(date, text)',
    'execute'
  ),
  'Expedicao autenticada pode consultar a composicao do Romaneio'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.get_romaneio_production_composition(date, text)',
    'execute'
  ),
  'Anonimo nao pode consultar a composicao do Romaneio'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  (
    '93000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'composicao-admin-test@example.com',
    '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, false
  ),
  (
    '93000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'composicao-expedicao-jc-test@example.com',
    '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, false
  ),
  (
    '93000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'composicao-romaneio-ex-test@example.com',
    '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, false
  );

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('93000000-0000-4000-8000-000000000001', 'Composicao Admin', 'admin', null, true, '["*"]'::jsonb),
  ('93000000-0000-4000-8000-000000000002', 'Composicao Expedicao JC', 'expedicao', 'jc', true, '["/romaneio"]'::jsonb),
  ('93000000-0000-4000-8000-000000000003', 'Composicao Romaneio EX', 'expedicao', 'ex', true, '["/romaneio"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values
  ('93000000-0000-4000-8000-000000000001', 'romaneio.visualizar', '*', null),
  ('93000000-0000-4000-8000-000000000001', 'romaneio.criar', '*', null),
  ('93000000-0000-4000-8000-000000000002', 'romaneio.visualizar', '*', null),
  ('93000000-0000-4000-8000-000000000002', 'romaneio.criar', '*', null),
  ('93000000-0000-4000-8000-000000000003', 'romaneio.visualizar', 'ex', null);

select set_config('test.admin_id', '93000000-0000-4000-8000-000000000001', false);
select set_config('test.expedicao_jc_id', '93000000-0000-4000-8000-000000000002', false);
select set_config('test.romaneio_ex_id', '93000000-0000-4000-8000-000000000003', false);

insert into public.production_plans (
  id, production_date, status, created_by, created_by_name
)
select
  '70000000-0000-4000-8000-000000000001',
  private.data_na_padaria() + 60,
  'aguardando_geolar',
  current_setting('test.admin_id')::uuid,
  'Teste composicao'
;

insert into public.production_plan_items (
  id, plan_id, store, bread_id, planned_quantity, frozen_quantity,
  leftover_proposed_quantity, leftover_confirmed_quantity
)
values (
  '71000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  'jc',
  'teste-baguete',
  10,
  5,
  2,
  null
);

insert into public.bread_reuse_plans (
  id, target_production_date, store, bread_id, proposed_quantity,
  confirmed_quantity, status, proposed_by, proposed_by_name
)
select
  '72000000-0000-4000-8000-000000000001',
  private.data_na_padaria() + 60,
  'jc',
  'teste-baguete',
  2,
  2,
  'confirmed',
  current_setting('test.admin_id')::uuid,
  'Teste composicao'
;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  current_setting('test.expedicao_jc_id'),
  true
);

select is(
  (select planned_quantity from public.get_romaneio_production_composition(private.data_na_padaria() + 60, 'jc') where bread_id = 'teste-baguete'),
  10::numeric,
  'Expedicao recebe o total planejado'
);
select is(
  (select frozen_quantity from public.get_romaneio_production_composition(private.data_na_padaria() + 60, 'jc') where bread_id = 'teste-baguete'),
  5::numeric,
  'Expedicao recebe a quantidade congelada'
);
select is(
  (select leftover_quantity from public.get_romaneio_production_composition(private.data_na_padaria() + 60, 'jc') where bread_id = 'teste-baguete'),
  2::numeric,
  'Expedicao recebe a sobra confirmada'
);
select is(
  (select new_quantity from public.get_romaneio_production_composition(private.data_na_padaria() + 60, 'jc') where bread_id = 'teste-baguete'),
  3::numeric,
  'Expedicao recebe a producao nova residual'
);

select set_config(
  'request.jwt.claim.sub',
  current_setting('test.romaneio_ex_id'),
  true
);
select throws_ok(
  $$ select * from public.get_romaneio_production_composition(private.data_na_padaria() + 60, 'jc') $$,
  '42501',
  'Sem permissão para consultar a composição desta loja.',
  'Expedicao EX nao consulta a composicao de JC'
);

select throws_ok(
  $$ select * from public.get_romaneio_production_composition(private.data_na_padaria() + 60, 'ex') $$,
  '22023',
  'Data ou loja inválida para a composição do Romaneio.',
  'EX nao usa o planejamento de JC e JA'
);

select set_config(
  'request.jwt.claim.sub',
  current_setting('test.admin_id'),
  true
);
select is(
  (select new_quantity from public.get_romaneio_production_composition(private.data_na_padaria() + 60, 'jc') where bread_id = 'teste-baguete'),
  3::numeric,
  'Admin tambem recebe a composicao residual'
);

select set_config(
  'request.jwt.claim.sub',
  current_setting('test.expedicao_jc_id'),
  true
);
select throws_ok(
  $$ select * from public.get_romaneio_production_composition(null::date, 'jc') $$,
  '22023',
  'Data ou loja inválida para a composição do Romaneio.',
  'Data ausente e rejeitada'
);

select * from finish();
rollback;
