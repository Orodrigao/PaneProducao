begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

select ok(
  has_function_privilege(
    'authenticated',
    'public.import_production_plan_order(uuid, text, text)',
    'execute'
  ),
  'Administrador autenticado pode importar o planejamento como pedido'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.import_production_plan_order(uuid, text, text)',
    'execute'
  ),
  'Anonimo nao pode importar o planejamento como pedido'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  (
    '94000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'planejamento-admin-test@example.com',
    '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, false
  ),
  (
    '94000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'planejamento-producao-test@example.com',
    '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, false
  );

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('94000000-0000-4000-8000-000000000001', 'Planejamento Admin', 'admin', null, true, '["*"]'::jsonb),
  ('94000000-0000-4000-8000-000000000002', 'Planejamento Produção', 'producao', 'jc', true, '["/"]'::jsonb);

insert into public.production_plans (
  id, production_date, status, created_by, created_by_name
)
values (
  '74000000-0000-4000-8000-000000000001',
  current_date + 61,
  'aguardando_geolar',
  '94000000-0000-4000-8000-000000000001',
  'Planejamento Admin'
);

insert into public.production_plan_items (
  id, plan_id, store, bread_id, planned_quantity, frozen_quantity,
  leftover_proposed_quantity, leftover_confirmed_quantity
)
values (
  '74100000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000001',
  'jc', 'teste-baguete', 10, 8, 2, null
);

insert into public.sobras (
  id, record_date, responsible, product_id, quantity, obs,
  product_source, store, lot_code, pending_quantity, status,
  physical_location, reconciliation_status
)
values (
  '74200000-0000-4000-8000-000000000001',
  current_date + 2,
  'Teste sobras', 'teste-baguete', 2, 'Teste reaproveitamento',
  'bread', 'jc', 'L' || to_char(current_date + 2, 'MMDD'), 2, 'pending',
  'mesa_separacao', 'not_required'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '94000000-0000-4000-8000-000000000001',
  true
);

select is(
  (select (public.import_production_plan_order(
    '74000000-0000-4000-8000-000000000001', 'jc', 'Planejamento Admin'
  )->>'order_count')::integer),
  0,
  'Importacao nao cria pedido novo quando congelado e sobra cobrem toda a demanda'
);

select ok(
  not exists (
    select 1 from public.orders
    where store = 'jc' and order_date = current_date + 61
      and bread_id = 'teste-baguete' and order_type = 'producao'
  ),
  'Importacao nao deixa pedido residual inexistente como linha fantasma'
);

select is(
  (select proposed_quantity from public.bread_reuse_plans
   where target_production_date = current_date + 61
     and store = 'jc' and bread_id = 'teste-baguete'),
  2,
  'Importacao salva a proposta mesmo sem pedido novo'
);

select ok(
  (select order_created_at is not null from public.production_plan_items
   where id = '74100000-0000-4000-8000-000000000001'),
  'Importacao marca o item como convertido na mesma operacao'
);

select is(
  (select (public.confirm_bread_reuse_plan(
    (select id from public.bread_reuse_plans
     where target_production_date = current_date + 61
       and store = 'jc' and bread_id = 'teste-baguete'),
    1
  )->>'confirmed_quantity')::integer),
  1,
  'Confirmacao parcial e aceita contra a demanda total menos congelados'
);

select is(
  (select quantity from public.orders
   where store = 'jc' and order_date = current_date + 61
     and bread_id = 'teste-baguete' and order_type = 'producao'),
  1::numeric,
  'Confirmacao parcial cria a producao nova residual'
);

select is(
  (select (public.confirm_bread_reuse_plan(
    (select id from public.bread_reuse_plans
     where target_production_date = current_date + 61
       and store = 'jc' and bread_id = 'teste-baguete'),
    2
  )->>'confirmed_quantity')::integer),
  2,
  'Correcao para a sobra total e aceita'
);

select ok(
  not exists (
    select 1 from public.orders
    where store = 'jc' and order_date = current_date + 61
      and bread_id = 'teste-baguete' and order_type = 'producao'
  ),
  'Quando a sobra cobre o restante, o pedido residual e removido'
);

select * from finish();
rollback;
