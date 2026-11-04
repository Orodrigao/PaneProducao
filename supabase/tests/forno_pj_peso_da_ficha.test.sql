-- Pedido PJ cobrado por peso (kg) de um pão vendido por unidade vira peças no
-- Forno pelo peso assado da ficha técnica (formação de preço, passos 0c e 0d).
-- O peso médio do cadastro de pães não é mais lido: os pães deste arquivo têm
-- números errados nele de propósito. Sem peso assado na ficha a trava fica
-- fechada: o pedido em kg não soma fração nem vira peça pela massa crua, e o
-- Forno avisa.
begin;
create extension if not exists pgtap with schema extensions;

select plan(27);

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
  ('teste-integral-peso-pj', '[TESTE] Integral Peso PJ', '{0,1,2,3,4,5,6}', true, 'un', false, false, 0.9),
  ('teste-multigraos-peso-pj', '[TESTE] Multigraos Peso PJ', '{0,1,2,3,4,5,6}', true, 'un', false, false, 0.45),
  ('teste-baguete-peso-pj', '[TESTE] Baguete Peso PJ Kg', '{0,1,2,3,4,5,6}', true, 'kg', false, false, null),
  ('teste-brioche-peso-pj', '[TESTE] Brioche Hamburguer Peso PJ', '{0,1,2,3,4,5,6}', true, 'un', false, false, 0.9),
  ('teste-italiano-peso-pj', '[TESTE] Italiano Peso PJ', '{0,1,2,3,4,5,6}', true, 'un', false, false, 0.35);

insert into public.products (id, name, category, active, unit, kind, is_fabricacao_propria, legacy_bread_id)
values
  ('97100000-0000-4000-8000-0000000000a1', '[TESTE] Integral Peso PJ', 'Paes', true, 'un', 'final', true, 'teste-integral-peso-pj'),
  ('97100000-0000-4000-8000-0000000000a2', '[TESTE] Multigraos Peso PJ', 'Paes', true, 'un', 'final', true, 'teste-multigraos-peso-pj'),
  ('97100000-0000-4000-8000-0000000000a3', '[TESTE] Brioche Peso PJ', 'Paes', true, 'un', 'final', true, 'teste-brioche-peso-pj'),
  ('97100000-0000-4000-8000-0000000000a4', '[TESTE] Outro produto Peso PJ', 'Paes', true, 'un', 'final', true, null),
  ('97100000-0000-4000-8000-0000000000a5', '[TESTE] Italiano Peso PJ', 'Paes', true, 'un', 'final', true, 'teste-italiano-peso-pj');

insert into public.product_variants (id, product_id, name, sort_order)
values
  ('97100000-0000-4000-8000-0000000000b1', '97100000-0000-4000-8000-0000000000a3', 'Hambúrguer', 1),
  ('97100000-0000-4000-8000-0000000000b2', '97100000-0000-4000-8000-0000000000a3', 'Forma', 2),
  ('97100000-0000-4000-8000-0000000000b3', '97100000-0000-4000-8000-0000000000a3', 'Mini', 3),
  ('97100000-0000-4000-8000-0000000000b4', '97100000-0000-4000-8000-0000000000a4', 'Grande', 1);

-- Integral: 550 g de massa, 500 g assado. Multigrãos: só a massa crua (ficha
-- antiga grava assado = massa). Brioche: o produto sem variante tem 85 g; o
-- pão é a variante Hambúrguer (80 g crua, 72 g assada); a Forma tem 400 g
-- crua e 360 g assada; a Mini não tem linha na ficha.
insert into public.product_recipe_yields (product_id, product_variant_id, basis, dough_weight_kg, finished_weight_kg, yield_units)
values
  ('97100000-0000-4000-8000-0000000000a1', null, 'dough', 1.1, 1.0, 2),
  ('97100000-0000-4000-8000-0000000000a2', null, 'dough', 1.0, 1.0, 2),
  ('97100000-0000-4000-8000-0000000000a3', null, 'dough', 0.85, 0.85, 10),
  ('97100000-0000-4000-8000-0000000000a3', '97100000-0000-4000-8000-0000000000b1', 'dough', 0.8, 0.72, 10),
  ('97100000-0000-4000-8000-0000000000a3', '97100000-0000-4000-8000-0000000000b2', 'dough', 0.8, 0.72, 2),
  ('97100000-0000-4000-8000-0000000000a5', null, 'dough', 0.8, 0.7, 2),
  ('97100000-0000-4000-8000-0000000000a4', '97100000-0000-4000-8000-0000000000b4', 'baked', null, 1.2, 4);

-- Italiano: ficha com 350 g assado, mas a opção de venda em unidade ainda diz
-- 400 g (a ficha mudou e não foi salva). Pedidos PJ fecharia o pacote em kg
-- por 400 g; o Forno não pode prever outro número de peças em silêncio.
insert into public.product_sale_options (id, product_id, product_variant_id, name, sale_unit, reference_quantity, unit_weight_kg, is_default, active)
values ('97100000-0000-4000-8000-0000000000d1', '97100000-0000-4000-8000-0000000000a5', null, 'Italiano un', 'un', 1, 0.4, true, true);

-- Vínculo do pão com a variante: só aceita variante do produto ligado ao pão.
select throws_ok($$ update public.breads set product_variant_id = '97100000-0000-4000-8000-0000000000b4'
  where id = 'teste-brioche-peso-pj' $$,
  '23514', 'A variante precisa ser do produto ligado a este pão.',
  'pão não aceita variante de outro produto');
select throws_ok($$ update public.breads set product_variant_id = '97100000-0000-4000-8000-0000000000b1'
  where id = 'teste-integral-peso-pj' $$,
  '23514', 'A variante precisa ser do produto ligado a este pão.',
  'pão não aceita variante de um produto que não é o dele');
select lives_ok($$ update public.breads set product_variant_id = '97100000-0000-4000-8000-0000000000b1'
  where id = 'teste-brioche-peso-pj' $$,
  'Brioche Hamburguer fica ligado à variante Hambúrguer do Brioche');
-- A Mini não tem ficha nem opção de venda: só o vínculo novo prende a exclusão.
update public.breads set product_variant_id = '97100000-0000-4000-8000-0000000000b3'
where id = 'teste-brioche-peso-pj';
select throws_like($$ delete from public.product_variants where id = '97100000-0000-4000-8000-0000000000b3' $$,
  '%breads_product_variant_id_fkey%',
  'variante ligada a um pão não é apagada: o pão não cai em silêncio na linha do produto');
update public.breads set product_variant_id = '97100000-0000-4000-8000-0000000000b1'
where id = 'teste-brioche-peso-pj';

-- Leitura da ficha, a mesma que o indicador de mão de obra usa.
select results_eq($$ select ficha_massa_crua_kg, ficha_peso_assado_kg
  from private.ficha_peso_por_unidade('bread', 'teste-brioche-peso-pj', null) $$,
  $$ values (0.08::numeric, 0.072::numeric) $$,
  'pão ligado à variante lê a linha da variante, não a do produto (85 g)');
select results_eq($$ select ficha_massa_crua_kg, ficha_peso_assado_kg
  from private.ficha_peso_por_unidade('bread', 'teste-brioche-peso-pj', '97100000-0000-4000-8000-0000000000b2') $$,
  $$ values (0.4::numeric, 0.36::numeric) $$,
  'variante informada pelo pedido vence a variante do pão');
select is((select count(*)::integer
  from private.ficha_peso_por_unidade('bread', 'teste-brioche-peso-pj', '97100000-0000-4000-8000-0000000000b3')), 0,
  'variante sem linha própria na ficha não herda o peso do produto');
select results_eq($$ select ficha_massa_crua_kg, ficha_peso_assado_kg
  from private.ficha_peso_por_unidade('product', '97100000-0000-4000-8000-0000000000a3', null) $$,
  $$ values (0.085::numeric, null::numeric) $$,
  'produto sem variante lê a própria linha; assado igual à massa não é peso assado');
select is((select count(*)::integer
  from private.ficha_peso_por_unidade('bread', 'teste-baguete-peso-pj', null)), 0,
  'pão sem produto ligado não tem ficha para ler');
select results_eq($$ select ficha_massa_crua_kg, ficha_peso_assado_kg
  from private.ficha_peso_por_unidade('product', '97100000-0000-4000-8000-0000000000a4', '97100000-0000-4000-8000-0000000000b4') $$,
  $$ values (null::numeric, 0.3::numeric) $$,
  'ficha em produto assado tem peso assado e massa crua desconhecida');
select results_eq($$ select ficha_peso_assado_kg, ficha_peso_venda_kg
  from private.ficha_peso_por_unidade('bread', 'teste-italiano-peso-pj', null) $$,
  $$ values (0.35::numeric, 0.4::numeric) $$,
  'a leitura devolve o peso de venda em unidade ao lado do peso assado');

-- Os dois lados do vínculo pão-variante ficam travados.
select throws_ok($$ update public.products set legacy_bread_id = null
  where id = '97100000-0000-4000-8000-0000000000a3' $$,
  '23514', 'O pão ligado tem variante gravada. Tire a variante do pão antes de trocar a ligação.',
  'produto não solta o pão que tem variante gravada');
select throws_ok($$ update public.products set legacy_bread_id = 'teste-brioche-peso-pj'
  where id = '97100000-0000-4000-8000-0000000000a4' $$,
  '23514', 'O pão ligado tem variante gravada. Tire a variante do pão antes de trocar a ligação.',
  'outro produto não pega um pão que tem variante gravada');

-- Vínculo velho vindo de antes da trava (simulado com os gatilhos
-- desligados nesta transação): a leitura não cai na linha do produto.
alter table public.breads disable trigger conferir_variante_do_pao;
update public.breads set product_variant_id = '97100000-0000-4000-8000-0000000000b4'
where id = 'teste-italiano-peso-pj';
alter table public.breads enable trigger conferir_variante_do_pao;
select is((select count(*)::integer
  from private.ficha_peso_por_unidade('bread', 'teste-italiano-peso-pj', null)), 0,
  'variante gravada no pão que não é do produto ligado não lê peso nenhum');
alter table public.breads disable trigger conferir_variante_do_pao;
update public.breads set product_variant_id = null where id = 'teste-italiano-peso-pj';
alter table public.breads enable trigger conferir_variante_do_pao;

insert into public.orders (
  id, store, order_type, order_group_id, bread_id, product_source, product_variant_id, product_name,
  quantity, pricing_unit, customer_id, pj_client, order_date, delivery_date, pj_delivery_date, production_date
) values
  ('97100000-0000-4000-8000-000000000101', 'pj', 'pj', '97100000-0000-4000-8000-0000000000e1',
   'teste-integral-peso-pj', 'bread', null, '[TESTE] Integral un', 10, 'un',
   '97100000-0000-4000-8000-0000000000c1', '[TESTE] Cliente Peso PJ',
   private.data_na_padaria(), private.data_na_padaria() + 2, private.data_na_padaria() + 2, null),
  ('97100000-0000-4000-8000-000000000102', 'pj', 'pj', '97100000-0000-4000-8000-0000000000e1',
   'teste-integral-peso-pj', 'bread', null, '[TESTE] Integral kg', 5.0, 'kg',
   '97100000-0000-4000-8000-0000000000c1', '[TESTE] Cliente Peso PJ',
   private.data_na_padaria(), private.data_na_padaria() + 2, private.data_na_padaria() + 2, null),
  ('97100000-0000-4000-8000-000000000103', 'pj', 'pj', '97100000-0000-4000-8000-0000000000e1',
   'teste-multigraos-peso-pj', 'bread', null, '[TESTE] Multigraos kg sem assado', 3.5, 'kg',
   '97100000-0000-4000-8000-0000000000c1', '[TESTE] Cliente Peso PJ',
   private.data_na_padaria(), private.data_na_padaria() + 2, private.data_na_padaria() + 2, null),
  ('97100000-0000-4000-8000-000000000104', 'pj', 'pj', '97100000-0000-4000-8000-0000000000e1',
   'teste-baguete-peso-pj', 'bread', null, '[TESTE] Baguete ja em kg', 2.75, null,
   '97100000-0000-4000-8000-0000000000c1', '[TESTE] Cliente Peso PJ',
   private.data_na_padaria(), private.data_na_padaria() + 2, private.data_na_padaria() + 2, null),
  ('97100000-0000-4000-8000-000000000105', 'pj', 'pj', '97100000-0000-4000-8000-0000000000e1',
   'teste-brioche-peso-pj', 'bread', null, '[TESTE] Brioche Hamburguer kg', 1.44, 'kg',
   '97100000-0000-4000-8000-0000000000c1', '[TESTE] Cliente Peso PJ',
   private.data_na_padaria(), private.data_na_padaria() + 2, private.data_na_padaria() + 2, null),
  ('97100000-0000-4000-8000-000000000106', 'pj', 'pj', '97100000-0000-4000-8000-0000000000e1',
   '97100000-0000-4000-8000-0000000000a3', 'product', '97100000-0000-4000-8000-0000000000b2',
   '[TESTE] Brioche Peso PJ · Forma kg', 3.6, 'kg',
   '97100000-0000-4000-8000-0000000000c1', '[TESTE] Cliente Peso PJ',
   private.data_na_padaria(), private.data_na_padaria() + 2, private.data_na_padaria() + 2, null),
  ('97100000-0000-4000-8000-000000000107', 'pj', 'pj', '97100000-0000-4000-8000-0000000000e1',
   'teste-italiano-peso-pj', 'bread', null, '[TESTE] Italiano kg com peso de venda diferente', 3.5, 'kg',
   '97100000-0000-4000-8000-0000000000c1', '[TESTE] Cliente Peso PJ',
   private.data_na_padaria(), private.data_na_padaria() + 2, private.data_na_padaria() + 2, null);

set local role authenticated;
select set_config('request.jwt.claim.sub', '97100000-0000-4000-8000-000000000001', true);

select lives_ok($$ select public.schedule_pj_production(
  private.data_na_padaria(),
  '[{"order_id":"97100000-0000-4000-8000-000000000101","quantity":10,"frozen_quantity":0},
    {"order_id":"97100000-0000-4000-8000-000000000102","quantity":5.0,"frozen_quantity":0},
    {"order_id":"97100000-0000-4000-8000-000000000103","quantity":3.5,"frozen_quantity":0},
    {"order_id":"97100000-0000-4000-8000-000000000104","quantity":2.75,"frozen_quantity":0},
    {"order_id":"97100000-0000-4000-8000-000000000105","quantity":1.44,"frozen_quantity":0},
    {"order_id":"97100000-0000-4000-8000-000000000106","quantity":3.6,"frozen_quantity":0},
    {"order_id":"97100000-0000-4000-8000-000000000107","quantity":3.5,"frozen_quantity":0}]'::jsonb,
  '97100000-0000-4000-8000-00000000f101'::uuid) $$,
  'Geolar programa pedido em unidade, em peso com e sem peso assado e de variante no mesmo lote');

select is((select quantity from public.list_pj_production_for_oven_v2(private.data_na_padaria())
  where product_source = 'bread' and product_id = 'teste-integral-peso-pj'), 20::numeric,
  'peso convertido pelo peso assado da ficha soma junto com as unidades (10 + 5kg/0,5kg = 20)');
select is((select needs_weight_setup from public.list_pj_production_for_oven_v2(private.data_na_padaria())
  where product_source = 'bread' and product_id = 'teste-integral-peso-pj'), false,
  'com peso assado na ficha não sobra aviso pendente');

select is((select quantity from public.list_pj_production_for_oven_v2(private.data_na_padaria())
  where product_source = 'bread' and product_id = 'teste-multigraos-peso-pj'), 0::numeric,
  'ficha só com massa crua não converte o pedido em kg: nem fração, nem peça a menos pela massa');
select is((select needs_weight_setup from public.list_pj_production_for_oven_v2(private.data_na_padaria())
  where product_source = 'bread' and product_id = 'teste-multigraos-peso-pj'), true,
  'sem peso assado na ficha o Forno recebe o aviso, mesmo com peso médio no cadastro de pães');

select is((select quantity from public.list_pj_production_for_oven_v2(private.data_na_padaria())
  where product_source = 'bread' and product_id = 'teste-baguete-peso-pj'), 2.75::numeric,
  'pão já cadastrado em kg continua passando direto, sem tentar converter');
select is((select needs_weight_setup from public.list_pj_production_for_oven_v2(private.data_na_padaria())
  where product_source = 'bread' and product_id = 'teste-baguete-peso-pj'), false,
  'pão já cadastrado em kg nunca dispara o aviso de peso faltante');

select is((select quantity from public.list_pj_production_for_oven_v2(private.data_na_padaria())
  where product_source = 'bread' and product_id = 'teste-brioche-peso-pj'), 30::numeric,
  'cada linha converte pela própria variante: 1,44 kg ÷ 72 g = 20 Hambúrguer e 3,6 kg ÷ 360 g = 10 Forma');
select is((select needs_weight_setup from public.list_pj_production_for_oven_v2(private.data_na_padaria())
  where product_source = 'bread' and product_id = 'teste-brioche-peso-pj'), false,
  'as duas variantes têm peso assado na ficha, sem aviso');

select is((select quantity from public.list_pj_production_for_oven_v2(private.data_na_padaria())
  where product_source = 'bread' and product_id = 'teste-italiano-peso-pj'), 0::numeric,
  'peso de venda diferente do assado da ficha não converte: nem 10 peças pelo assado, nem 9 pela venda');
select is((select needs_weight_setup from public.list_pj_production_for_oven_v2(private.data_na_padaria())
  where product_source = 'bread' and product_id = 'teste-italiano-peso-pj'), true,
  'peso de venda diferente do assado acende o aviso do Forno');

reset role;

-- Peso zero ou negativo continua recusado no cadastro antigo, que só fica
-- guardado até a coluna sair.
select throws_ok($$ update public.breads set avg_unit_weight_kg = 0
  where id = 'teste-multigraos-peso-pj' $$,
  '23514', null,
  'peso médio antigo não aceita zero');
select ok(not has_function_privilege('authenticated', 'private.conferir_variante_do_pao()', 'execute'),
  'a conferência da variante não fica exposta ao cliente');

select * from finish();
rollback;
