-- Programacao diaria PJ: fila, divisao, congelados compartilhados e Forno.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

select ok(has_function_privilege('authenticated', 'public.list_pj_production_queue()', 'execute'),
  'Producao autenticada pode abrir a fila PJ');
select ok(has_function_privilege('authenticated', 'public.schedule_pj_production(date, jsonb, uuid)', 'execute'),
  'Producao autenticada pode usar a acao protegida');
select ok(not has_table_privilege('authenticated', 'public.pj_production_schedules', 'insert'),
  'ninguem grava a programacao direto na tabela');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('97000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'producao-pj-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW', now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'vendas-pj-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW', now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin-pj-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW', now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('97000000-0000-4000-8000-000000000001', 'Geolar Teste', 'producao', 'jc', true, '["/", "/forno"]'::jsonb),
  ('97000000-0000-4000-8000-000000000002', 'Vendas Teste', 'vendas', 'jc', true, '["/pedidos-pj"]'::jsonb),
  ('97000000-0000-4000-8000-000000000003', 'Admin Teste', 'admin', null, true, '["*"]'::jsonb);

insert into public.customers (id, name, doc, active)
values ('97000000-0000-4000-8000-0000000000c1', '[TESTE] Hamburgueria Producao', '55666777000188', true);

insert into public.breads (id, name, days, active, unit, is_special, is_shelf)
values
  ('teste-brioche-programacao', '[TESTE] Brioche Programacao', '{0,1,2,3,4,5,6}', true, 'un', false, false),
  ('teste-italiano-programacao', '[TESTE] Italiano Programacao', '{0,1,2,3,4,5,6}', true, 'un', false, false),
  ('teste-focaccia-programacao', '[TESTE] Focaccia Programacao', '{0,1,2,3,4,5,6}', true, 'kg', false, false);

insert into public.products (
  id, name, category, active, unit, kind, is_fabricacao_propria, is_pj, production_area, legacy_bread_id
) values
  ('97000000-0000-4000-8000-0000000000d1', '[TESTE] Italiano novo', 'Paes', true, 'un', 'final', true, true, 'padaria', 'teste-italiano-programacao'),
  ('97000000-0000-4000-8000-0000000000d2', '[TESTE] Sem vinculo', 'Paes', true, 'un', 'final', true, true, 'padaria', null);

insert into public.orders (
  id, store, order_type, order_group_id, bread_id, product_source, product_name,
  quantity, pricing_unit, customer_id, pj_client, order_date, delivery_date, pj_delivery_date, production_date
) values
  ('97000000-0000-4000-8000-000000000101', 'pj', 'pj', '97000000-0000-4000-8000-0000000000a1',
   'teste-brioche-programacao', 'bread', '[TESTE] Brioche', 600, 'un',
   '97000000-0000-4000-8000-0000000000c1', '[TESTE] Hamburgueria Producao',
   private.data_na_padaria(), private.data_na_padaria() + 2, private.data_na_padaria() + 2, null),
  ('97000000-0000-4000-8000-000000000102', 'pj', 'pj', '97000000-0000-4000-8000-0000000000a1',
   '97000000-0000-4000-8000-0000000000d1', 'product', '[TESTE] Italiano novo', 100, 'un',
   '97000000-0000-4000-8000-0000000000c1', '[TESTE] Hamburgueria Producao',
   private.data_na_padaria() + 1, private.data_na_padaria() + 2, private.data_na_padaria() + 2, null),
  ('97000000-0000-4000-8000-000000000103', 'pj', 'pj', '97000000-0000-4000-8000-0000000000a1',
   '97000000-0000-4000-8000-0000000000d2', 'product', '[TESTE] Sem vinculo', 10, 'un',
   '97000000-0000-4000-8000-0000000000c1', '[TESTE] Hamburgueria Producao',
   private.data_na_padaria() + 2, private.data_na_padaria() + 2, private.data_na_padaria() + 2, null),
  ('97000000-0000-4000-8000-000000000104', 'pj', 'pj', '97000000-0000-4000-8000-0000000000a2',
   'teste-focaccia-programacao', 'bread', '[TESTE] Focaccia', 4.5, null,
   '97000000-0000-4000-8000-0000000000c1', '[TESTE] Hamburgueria Producao',
   private.data_na_padaria() + 3, private.data_na_padaria() + 3, private.data_na_padaria() + 3, null);

insert into public.frozen_products (
  id, product_id, product_source, product_name, unit, active, store, visible_stores
) values ('97000000-0000-4000-8000-0000000000f1', 'teste-brioche-programacao', 'bread',
  '[TESTE] Brioche', 'un', true, 'jc', array['jc']::text[]);
insert into public.frozen_stock (id, frozen_product_id, location, quantity)
values ('97000000-0000-4000-8000-0000000000f2', '97000000-0000-4000-8000-0000000000f1', 'jc-freezer', 40);

insert into public.production_plans (id, production_date, status, created_by, created_by_name)
values ('97000000-0000-4000-8000-0000000000b1', private.data_na_padaria() + 1, 'rascunho',
  '97000000-0000-4000-8000-000000000003', 'Admin Teste');
insert into public.production_plan_items (
  id, plan_id, store, bread_id, planned_quantity, frozen_quantity, leftover_proposed_quantity
) values ('97000000-0000-4000-8000-0000000000b2', '97000000-0000-4000-8000-0000000000b1',
  'jc', 'teste-brioche-programacao', 100, 25, 0);

set local role authenticated;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000002', true);
select throws_ok($$ select * from public.list_pj_production_queue() $$,
  '42501', 'Usuario sem permissao para organizar a producao PJ.',
  'Comercial nao abre a organizacao da Producao');

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true);
select is((select count(*)::int from public.list_pj_production_queue()
  where customer_id = '97000000-0000-4000-8000-0000000000c1'), 4,
  'fila mostra todas as linhas pendentes');
select is((select canonical_bread_id from public.list_pj_production_queue()
  where order_id = '97000000-0000-4000-8000-000000000102'), 'teste-italiano-programacao',
  'produto novo chega ao Forno pelo vinculo canonico');
select ok((select mapping_error is not null from public.list_pj_production_queue()
  where order_id = '97000000-0000-4000-8000-000000000103'),
  'linha sem vinculo fica visivel e bloqueada');
select is((select frozen_available from public.list_pj_production_queue()
  where order_id = '97000000-0000-4000-8000-000000000101'), 15::numeric,
  'fila desconta congelado ja reservado para lojas');

select throws_ok($$ select public.schedule_pj_production(
  private.data_na_padaria() + 1,
  '[{"order_id":"97000000-0000-4000-8000-000000000101","quantity":300,"frozen_quantity":0}]'::jsonb,
  '97000000-0000-4000-8000-00000000f101'::uuid) $$,
  '22023', 'A programacao PJ deve ser feita para hoje.',
  'programacao PJ e sempre da fornada de hoje');

select throws_ok($$ select public.schedule_pj_production(
  private.data_na_padaria(),
  '[{"order_id":"97000000-0000-4000-8000-000000000101","quantity":300,"frozen_quantity":16}]'::jsonb,
  '97000000-0000-4000-8000-00000000f102'::uuid) $$,
  '22023', 'O congelado disponivel ja esta reservado por outro planejamento.',
  'PJ nao promete congelado reservado para loja');

select lives_ok($$ select public.schedule_pj_production(
  private.data_na_padaria(),
  '[{"order_id":"97000000-0000-4000-8000-000000000101","quantity":300,"frozen_quantity":15},
    {"order_id":"97000000-0000-4000-8000-000000000102","quantity":100,"frozen_quantity":0}]'::jsonb,
  '97000000-0000-4000-8000-00000000f103'::uuid) $$,
  'Geolar escolhe duas das tres linhas do cliente');

select is((select pending_quantity from public.list_pj_production_queue()
  where order_id = '97000000-0000-4000-8000-000000000101'), 300::numeric,
  'pedido de 600 fica com 300 pendentes');
select ok(not exists(select 1 from public.list_pj_production_queue()
  where order_id = '97000000-0000-4000-8000-000000000102'),
  'linha completa sai da pendencia');
select is((select quantity from public.list_pj_production_for_oven(private.data_na_padaria())
  where bread_id = 'teste-brioche-programacao'), 285::numeric,
  'Forno desconta congelados PJ');
select is((select quantity from public.list_pj_production_for_oven(private.data_na_padaria())
  where bread_id = 'teste-italiano-programacao'), 100::numeric,
  'Forno recebe produto mapeado');
select is((select production_date from public.orders where id = '97000000-0000-4000-8000-000000000101'),
  private.data_na_padaria(), 'pedido registra a data decidida pela Producao');

select is((select (public.schedule_pj_production(
  private.data_na_padaria(),
  '[{"order_id":"97000000-0000-4000-8000-000000000101","quantity":300,"frozen_quantity":15},
    {"order_id":"97000000-0000-4000-8000-000000000102","quantity":100,"frozen_quantity":0}]'::jsonb,
  '97000000-0000-4000-8000-00000000f103'::uuid)->>'idempotent')::boolean), true,
  'repeticao de rede nao programa duas vezes');

reset role;
select is((select count(*)::int from public.pj_production_schedules
  where request_id = '97000000-0000-4000-8000-00000000f103'), 2,
  'idempotencia preserva uma linha por item');

select throws_ok($$ update public.orders set quantity = 650
  where id = '97000000-0000-4000-8000-000000000101' $$,
  '42501', 'Pedido que ja entrou na producao nao pode mais ser alterado.',
  'Comercial nao altera pedido que entrou na producao');
select set_config('pane.pj_dispatch_rpc', 'on', true);
select lives_ok($$ update public.orders set dispatched_at = now(), dispatched_by_name = 'Expedicao Teste'
  where id = '97000000-0000-4000-8000-000000000101' $$,
  'Expedicao ainda registra a saida');
select set_config('pane.pj_dispatch_rpc', '', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true);
select is((select quantity from public.list_pj_production_for_oven(private.data_na_padaria())
  where bread_id = 'teste-brioche-programacao'), 285::numeric,
  'historico do Forno preserva previsto depois do envio');

select lives_ok($$ select public.schedule_pj_production(
  private.data_na_padaria(),
  '[{"order_id":"97000000-0000-4000-8000-000000000104","quantity":4.125,"frozen_quantity":0}]'::jsonb,
  '97000000-0000-4000-8000-00000000f104'::uuid) $$,
  'pedido legado herda kg do pao e aceita tres casas');
select is((select pending_quantity from public.list_pj_production_queue()
  where order_id = '97000000-0000-4000-8000-000000000104'), 0.375::numeric,
  'peso parcial preserva o restante');
select is((select quantity from public.list_pj_production_for_oven(private.data_na_padaria())
  where bread_id = 'teste-focaccia-programacao'), 4.125::numeric,
  'Forno recebe peso sem arredondar');
select lives_ok($$ select * from public.confirm_oven_output(
  private.data_na_padaria(), 'teste-focaccia-programacao', 4.1, 0.025, 'Queimou', null) $$,
  'Forno confirma peso fracionado');
select is((select quantity_baked from public.production_actuals
  where record_date = private.data_na_padaria() and bread_id = 'teste-focaccia-programacao'), 4.1::numeric,
  'peso confirmado chega ao estoque');

reset role;
select throws_ok($$ insert into public.production_plan_items (
  plan_id, store, bread_id, planned_quantity, frozen_quantity, leftover_proposed_quantity
) values ('97000000-0000-4000-8000-0000000000b1', 'jc', 'teste-italiano-programacao', 1, 1, 0) $$,
  '22023', 'O congelado disponivel ja esta reservado por outro planejamento.',
  'loja tambem falha fechado sem saldo fisico');
select is((select count(*)::int from public.pj_production_schedules), 3,
  'somente linhas validas ficaram registradas');

select * from finish();
rollback;
