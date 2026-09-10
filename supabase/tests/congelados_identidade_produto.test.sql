-- A identidade nova de congelado participa da reserva sem duplicar o cadastro
-- antigo. PJ e planejamento da loja disputam o mesmo saldo.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('97200000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'producao-congelado-produto@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW', now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97200000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'vendas-congelado-produto@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW', now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('97200000-0000-4000-8000-000000000001', 'Producao Congelado Teste', 'producao', 'jc', true, '["/", "/forno"]'::jsonb),
  ('97200000-0000-4000-8000-000000000002', 'Vendas Congelado Teste', 'vendas', 'jc', true, '["/pedidos-pj"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope)
values ('97200000-0000-4000-8000-000000000001', 'producao_pj.programar', 'jc');

insert into public.breads (id, name, days, active, unit, is_special, is_shelf)
values
  ('teste-congelado-identidade', '[TESTE] Congelado Identidade', '{0,1,2,3,4,5,6}', true, 'un', false, false),
  ('teste-congelado-produto', '[TESTE] Congelado Produto', '{0,1,2,3,4,5,6}', true, 'un', false, false),
  ('teste-congelado-produto-ja', '[TESTE] Congelado Produto JA', '{0,1,2,3,4,5,6}', true, 'un', false, false),
  ('teste-congelado-unidade', '[TESTE] Congelado Unidade', '{0,1,2,3,4,5,6}', true, 'un', false, false),
  ('teste-congelado-inativo', '[TESTE] Congelado Inativo', '{0,1,2,3,4,5,6}', true, 'un', false, false);

insert into public.products (
  id, name, category, active, unit, kind, is_fabricacao_propria,
  is_pj, production_area, legacy_bread_id
) values
  ('97200000-0000-4000-8000-0000000000d1', '[TESTE] Congelado Identidade', 'Paes', true, 'un', 'final', true, true, 'padaria', 'teste-congelado-identidade'),
  ('97200000-0000-4000-8000-0000000000d2', '[TESTE] Congelado Identidade', 'Paes', true, 'un', 'final', true, true, 'padaria', null),
  ('97200000-0000-4000-8000-0000000000d3', '[TESTE] Congelado Produto', 'Paes', true, 'un', 'final', true, true, 'padaria', 'teste-congelado-produto'),
  ('97200000-0000-4000-8000-0000000000d4', '[TESTE] Congelado Unidade', 'Paes', true, 'kg', 'final', true, true, 'padaria', 'teste-congelado-unidade'),
  ('97200000-0000-4000-8000-0000000000d5', '[TESTE] Congelado Inativo', 'Paes', false, 'un', 'final', true, true, 'padaria', 'teste-congelado-inativo'),
  ('97200000-0000-4000-8000-0000000000d6', '[TESTE] Congelado Produto JA', 'Paes', true, 'un', 'final', true, true, 'padaria', 'teste-congelado-produto-ja');

insert into public.frozen_products (
  id, product_id, product_source, product_name, unit, active, store, visible_stores
) values
  ('97200000-0000-4000-8000-0000000000f1', 'teste-congelado-identidade', 'bread', '[TESTE] Antigo', 'un', true, 'jc', array['jc']::text[]),
  ('97200000-0000-4000-8000-0000000000f2', '97200000-0000-4000-8000-0000000000d1', 'product', '[TESTE] Novo Duplicado', 'un', true, 'jc', array['jc']::text[]),
  ('97200000-0000-4000-8000-0000000000f3', '97200000-0000-4000-8000-0000000000d2', 'product', '[TESTE] Mesmo Nome Sem Ligacao', 'un', true, 'jc', array['jc']::text[]),
  ('97200000-0000-4000-8000-0000000000f4', '97200000-0000-4000-8000-0000000000d3', 'product', '[TESTE] Novo JC', 'un', true, 'jc', array['jc']::text[]),
  ('97200000-0000-4000-8000-0000000000f5', '97200000-0000-4000-8000-0000000000d6', 'product', '[TESTE] Novo JA', 'un', true, 'ja', array['ja']::text[]),
  ('97200000-0000-4000-8000-0000000000f6', '97200000-0000-4000-8000-0000000000d4', 'product', '[TESTE] Unidade Incompativel', 'kg', true, 'jc', array['jc']::text[]),
  ('97200000-0000-4000-8000-0000000000f7', 'id-inexistente', 'product', '[TESTE] Produto Inexistente', 'un', true, 'jc', array['jc']::text[]),
  ('97200000-0000-4000-8000-0000000000f8', '97200000-0000-4000-8000-0000000000d5', 'product', '[TESTE] Produto Inativo', 'un', true, 'jc', array['jc']::text[]),
  ('97200000-0000-4000-8000-0000000000f9', '97200000-0000-4000-8000-0000000000d3', 'product', '[TESTE] Congelado Inativo', 'un', false, 'jc', array['jc']::text[]),
  ('97200000-0000-4000-8000-0000000000fa', null, 'bread', '[TESTE] Pao Sem Identificador', 'un', true, 'jc', array['jc']::text[]);

insert into public.frozen_stock (id, frozen_product_id, location, quantity)
values
  ('97200000-0000-4000-8000-0000000000e1', '97200000-0000-4000-8000-0000000000f1', 'jc-freezer', 4),
  ('97200000-0000-4000-8000-0000000000e2', '97200000-0000-4000-8000-0000000000f2', 'jc-freezer', 6),
  ('97200000-0000-4000-8000-0000000000e3', '97200000-0000-4000-8000-0000000000f3', 'jc-freezer', 7),
  ('97200000-0000-4000-8000-0000000000e4', '97200000-0000-4000-8000-0000000000f4', 'jc-freezer', 6),
  ('97200000-0000-4000-8000-0000000000e5', '97200000-0000-4000-8000-0000000000f5', 'ja-freezer', 3),
  ('97200000-0000-4000-8000-0000000000e6', '97200000-0000-4000-8000-0000000000f6', 'jc-freezer', 8),
  ('97200000-0000-4000-8000-0000000000e7', '97200000-0000-4000-8000-0000000000f7', 'jc-freezer', 9),
  ('97200000-0000-4000-8000-0000000000e8', '97200000-0000-4000-8000-0000000000f8', 'jc-freezer', 10),
  ('97200000-0000-4000-8000-0000000000e9', '97200000-0000-4000-8000-0000000000f9', 'jc-freezer', 11),
  ('97200000-0000-4000-8000-0000000000ea', '97200000-0000-4000-8000-0000000000fa', 'jc-freezer', 12);

select is(private.frozen_stock_for_bread_store('teste-congelado-identidade', 'jc'), 4::numeric,
  'cadastro bread tem precedencia e evita contagem dupla');
select is(private.frozen_stock_for_bread_store('teste-congelado-produto', 'jc'), 6::numeric,
  'produto ligado assume quando nao existe cadastro bread ativo');
select is(private.frozen_stock_for_bread_store('teste-congelado-produto-ja', 'ja'), 3::numeric,
  'saldo do produto ligado respeita a loja');
select is(private.frozen_stock_for_bread_store('97200000-0000-4000-8000-0000000000d2', 'jc'), 0::numeric,
  'mesmo nome sem equivalencia nao cria vinculo');
select is(private.frozen_stock_for_bread_store('teste-congelado-unidade', 'jc'), 0::numeric,
  'unidade incompativel falha fechado');
select is(private.frozen_stock_for_bread_store('teste-congelado-inativo', 'jc'), 0::numeric,
  'produto inativo nao oferece congelado');
select lives_ok($$ select private.frozen_stock_for_bread_store('id-inexistente', 'jc') $$,
  'identificador malformado nao quebra a consulta');
select ok(not has_function_privilege('authenticated', 'private.frozen_stock_for_bread_store(text,text)', 'execute'),
  'funcao interna continua fechada ao cliente');
select ok(not has_function_privilege('anon', 'public.list_frozen_production_availability(date)', 'execute'),
  'visitante anonimo nao consulta disponibilidade');

insert into public.customers (id, name, doc, active)
values ('97200000-0000-4000-8000-0000000000a1', '[TESTE] Cliente Congelado', '00111222000133', true);
insert into public.orders (
  id, store, order_type, order_group_id, bread_id, product_source, product_name,
  quantity, pricing_unit, customer_id, pj_client, order_date, delivery_date, pj_delivery_date
) values (
  '97200000-0000-4000-8000-000000000101', 'pj', 'pj',
  '97200000-0000-4000-8000-0000000000a2', '97200000-0000-4000-8000-0000000000d3',
  'product', '[TESTE] Congelado Produto', 6, 'un',
  '97200000-0000-4000-8000-0000000000a1', '[TESTE] Cliente Congelado',
  private.data_na_padaria(), private.data_na_padaria() + 2, private.data_na_padaria() + 2
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '97200000-0000-4000-8000-000000000002', true);
select throws_ok($$ select * from public.list_frozen_production_availability(null) $$,
  '42501', 'Usuario sem permissao para planejar a producao.',
  'vendas nao consulta disponibilidade da producao');

select set_config('request.jwt.claim.sub', '97200000-0000-4000-8000-000000000001', true);
select is((select available_quantity from public.list_frozen_production_availability(null)
  where store = 'jc' and bread_id = 'teste-congelado-produto'), 6::numeric,
  'producao enxerga o congelado cadastrado pelo produto');
select is((select available_quantity from public.list_frozen_production_availability(null)
  where store = 'ja' and bread_id = 'teste-congelado-produto-ja'), 3::numeric,
  'lista publica tambem preserva o isolamento da JA');
select ok(not exists (
  select 1 from public.list_frozen_production_availability(null) where bread_id is null
), 'cadastro bread sem identificador nao cria linha fantasma');
select lives_ok($$ select public.schedule_pj_production(
  private.data_na_padaria(),
  '[{"order_id":"97200000-0000-4000-8000-000000000101","quantity":5,"frozen_quantity":5}]'::jsonb,
  '97200000-0000-4000-8000-000000000201'::uuid) $$,
  'programacao PJ reserva o congelado do produto');
select is((select available_quantity from public.list_frozen_production_availability(null)
  where store = 'jc' and bread_id = 'teste-congelado-produto'), 1::numeric,
  'lista desconta a reserva PJ do saldo do produto');
reset role;

insert into public.production_plans (id, production_date, status, created_by, created_by_name)
values
  ('97200000-0000-4000-8000-0000000000b1', private.data_na_padaria() + 61, 'rascunho',
   '97200000-0000-4000-8000-000000000001', 'Producao Congelado Teste'),
  ('97200000-0000-4000-8000-0000000000b2', private.data_na_padaria() + 62, 'rascunho',
   '97200000-0000-4000-8000-000000000001', 'Producao Congelado Teste');
insert into public.production_plan_items (
  id, plan_id, store, bread_id, planned_quantity, frozen_quantity, leftover_proposed_quantity
) values (
  '97200000-0000-4000-8000-0000000000c1', '97200000-0000-4000-8000-0000000000b1',
  'jc', 'teste-congelado-produto', 1, 1, 0
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '97200000-0000-4000-8000-000000000001', true);
select is((select available_quantity from public.list_frozen_production_availability(private.data_na_padaria() + 61)
  where store = 'jc' and bread_id = 'teste-congelado-produto'), 1::numeric,
  'edicao da propria data nao desconta duas vezes a reserva da loja');
reset role;

select throws_ok($$ insert into public.production_plan_items (
  id, plan_id, store, bread_id, planned_quantity, frozen_quantity, leftover_proposed_quantity
) values (
  '97200000-0000-4000-8000-0000000000c2', '97200000-0000-4000-8000-0000000000b2',
  'jc', 'teste-congelado-produto', 1, 1, 0
) $$, '22023', 'O congelado disponivel ja esta reservado por outro planejamento.',
  'outra data nao promete o saldo ja reservado por PJ e loja');

select * from finish();
rollback;
