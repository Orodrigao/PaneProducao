-- Pedido PJ cobrado por peso (kg) de um pão vendido por unidade não pode
-- virar previsto fracionado no Forno. Este arquivo isola a conversão de
-- list_pj_production_for_oven_v2: com peso médio cadastrado ela soma peças
-- certas; sem peso, a trava fica fechada (não soma fração, avisa).
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('97100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'producao-peso-pj-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW', now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values ('97100000-0000-4000-8000-000000000001', 'Geolar Peso Teste', 'producao', 'jc', true, '["/", "/forno"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope)
values ('97100000-0000-4000-8000-000000000001', 'producao_pj.programar', 'jc');

insert into public.customers (id, name, doc, active)
values ('97100000-0000-4000-8000-0000000000c1', '[TESTE] Cliente Peso PJ', '11222333000144', true);

insert into public.breads (id, name, days, active, unit, is_special, is_shelf, avg_unit_weight_kg)
values
  ('teste-integral-peso-pj', '[TESTE] Integral Peso PJ', '{0,1,2,3,4,5,6}', true, 'un', false, false, 0.5),
  ('teste-multigraos-peso-pj', '[TESTE] Multigraos Peso PJ', '{0,1,2,3,4,5,6}', true, 'un', false, false, null),
  ('teste-baguete-peso-pj', '[TESTE] Baguete Peso PJ Kg', '{0,1,2,3,4,5,6}', true, 'kg', false, false, null);

insert into public.orders (
  id, store, order_type, order_group_id, bread_id, product_source, product_name,
  quantity, pricing_unit, customer_id, pj_client, order_date, delivery_date, pj_delivery_date, production_date
) values
  ('97100000-0000-4000-8000-000000000101', 'pj', 'pj', '97100000-0000-4000-8000-0000000000a1',
   'teste-integral-peso-pj', 'bread', '[TESTE] Integral un', 10, 'un',
   '97100000-0000-4000-8000-0000000000c1', '[TESTE] Cliente Peso PJ',
   private.data_na_padaria(), private.data_na_padaria() + 2, private.data_na_padaria() + 2, null),
  ('97100000-0000-4000-8000-000000000102', 'pj', 'pj', '97100000-0000-4000-8000-0000000000a1',
   'teste-integral-peso-pj', 'bread', '[TESTE] Integral kg', 5.0, 'kg',
   '97100000-0000-4000-8000-0000000000c1', '[TESTE] Cliente Peso PJ',
   private.data_na_padaria(), private.data_na_padaria() + 2, private.data_na_padaria() + 2, null),
  ('97100000-0000-4000-8000-000000000103', 'pj', 'pj', '97100000-0000-4000-8000-0000000000a1',
   'teste-multigraos-peso-pj', 'bread', '[TESTE] Multigraos kg sem peso', 3.5, 'kg',
   '97100000-0000-4000-8000-0000000000c1', '[TESTE] Cliente Peso PJ',
   private.data_na_padaria(), private.data_na_padaria() + 2, private.data_na_padaria() + 2, null),
  ('97100000-0000-4000-8000-000000000104', 'pj', 'pj', '97100000-0000-4000-8000-0000000000a1',
   'teste-baguete-peso-pj', 'bread', '[TESTE] Baguete ja em kg', 2.75, null,
   '97100000-0000-4000-8000-0000000000c1', '[TESTE] Cliente Peso PJ',
   private.data_na_padaria(), private.data_na_padaria() + 2, private.data_na_padaria() + 2, null);

set local role authenticated;
select set_config('request.jwt.claim.sub', '97100000-0000-4000-8000-000000000001', true);

select lives_ok($$ select public.schedule_pj_production(
  private.data_na_padaria(),
  '[{"order_id":"97100000-0000-4000-8000-000000000101","quantity":10,"frozen_quantity":0},
    {"order_id":"97100000-0000-4000-8000-000000000102","quantity":5.0,"frozen_quantity":0},
    {"order_id":"97100000-0000-4000-8000-000000000103","quantity":3.5,"frozen_quantity":0},
    {"order_id":"97100000-0000-4000-8000-000000000104","quantity":2.75,"frozen_quantity":0}]'::jsonb,
  '97100000-0000-4000-8000-00000000f101'::uuid) $$,
  'Geolar programa pedido em unidade, em peso e sem peso cadastrado no mesmo lote');

select is((select quantity from public.list_pj_production_for_oven_v2(private.data_na_padaria())
  where product_source = 'bread' and product_id = 'teste-integral-peso-pj'), 20::numeric,
  'peso convertido pelo peso médio soma junto com as unidades (10 + 5kg/0.5kg = 20)');
select is((select needs_weight_setup from public.list_pj_production_for_oven_v2(private.data_na_padaria())
  where product_source = 'bread' and product_id = 'teste-integral-peso-pj'), false,
  'com peso cadastrado não sobra aviso pendente');

select is((select quantity from public.list_pj_production_for_oven_v2(private.data_na_padaria())
  where product_source = 'bread' and product_id = 'teste-multigraos-peso-pj'), 0::numeric,
  'sem peso cadastrado o pedido em kg fica fora da soma, nunca vira fração');
select is((select needs_weight_setup from public.list_pj_production_for_oven_v2(private.data_na_padaria())
  where product_source = 'bread' and product_id = 'teste-multigraos-peso-pj'), true,
  'sem peso cadastrado o Forno recebe o aviso para não confundir com "nada previsto"');

select is((select quantity from public.list_pj_production_for_oven_v2(private.data_na_padaria())
  where product_source = 'bread' and product_id = 'teste-baguete-peso-pj'), 2.75::numeric,
  'pão já cadastrado em kg continua passando direto, sem tentar converter');
select is((select needs_weight_setup from public.list_pj_production_for_oven_v2(private.data_na_padaria())
  where product_source = 'bread' and product_id = 'teste-baguete-peso-pj'), false,
  'pão já cadastrado em kg nunca dispara o aviso de peso faltante');

reset role;

-- Peso zero ou negativo é recusado no cadastro, nunca vira divisão por zero.
select throws_ok($$ update public.breads set avg_unit_weight_kg = 0
  where id = 'teste-multigraos-peso-pj' $$,
  '23514', null,
  'peso médio não aceita zero');
select throws_ok($$ update public.breads set avg_unit_weight_kg = -0.3
  where id = 'teste-multigraos-peso-pj' $$,
  '23514', null,
  'peso médio não aceita negativo');

select * from finish();
rollback;
