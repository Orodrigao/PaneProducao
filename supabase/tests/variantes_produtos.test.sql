-- Fundação de variantes de produtos (fase 1 do saneamento do catálogo).
-- Cobre: produto simples legado sem variante, quatro variantes de uma mesma
-- receita (Brioche), un/kg por variante sem duplicidade, peso/rendimento
-- distinto por variante, pacote de 12 para PJ, variante de outro produto
-- recusada, duplicidade recusada, e RLS/grants (perfil permitido, bloqueado
-- e anônimo).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 0. RLS habilitada e forçada nas tabelas novas; nenhuma delas concede acesso
-- a anon.
select ok((select relrowsecurity and relforcerowsecurity
  from pg_class class
  join pg_namespace namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'public' and class.relname = 'product_variants'),
  'product_variants tem RLS habilitada e forçada');
select ok((select relrowsecurity and relforcerowsecurity
  from pg_class class
  join pg_namespace namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'public' and class.relname = 'product_pj_pack_rules'),
  'product_pj_pack_rules tem RLS habilitada e forçada');
select ok(not has_table_privilege('anon', 'public.product_variants', 'select')
  and not has_table_privilege('anon', 'public.product_variants', 'insert')
  and not has_table_privilege('anon', 'public.product_variants', 'update'),
  'anônimo não tem privilégio algum em product_variants');
select ok(not has_table_privilege('anon', 'public.product_pj_pack_rules', 'select')
  and not has_table_privilege('anon', 'public.product_pj_pack_rules', 'insert')
  and not has_table_privilege('anon', 'public.product_pj_pack_rules', 'update'),
  'anônimo não tem privilégio algum em product_pj_pack_rules');
select ok(not has_table_privilege('authenticated', 'public.product_variants', 'delete')
  and not has_table_privilege('authenticated', 'public.product_pj_pack_rules', 'delete'),
  'nenhum perfil autenticado apaga variante ou regra de pacote; correção é por update');

-- 1. Fixture: produto simples legado (sem variante) e a família Brioche com
-- suas quatro variantes.
insert into public.products (id, name, kind, is_fabricacao_propria)
values ('c9000000-0000-4000-8000-000000000002', '[TESTE] Baguete Legada', 'final', true);

insert into public.products (id, name, kind, is_fabricacao_propria)
values ('c9000000-0000-4000-8000-000000000001', '[TESTE] Brioche', 'final', true);

insert into public.product_variants (id, product_id, name, sort_order)
values
  ('c9000000-0000-4000-8000-000000000011', 'c9000000-0000-4000-8000-000000000001', 'Forma', 1),
  ('c9000000-0000-4000-8000-000000000012', 'c9000000-0000-4000-8000-000000000001', 'Hamburguer', 2),
  ('c9000000-0000-4000-8000-000000000013', 'c9000000-0000-4000-8000-000000000001', 'Mini', 3),
  ('c9000000-0000-4000-8000-000000000014', 'c9000000-0000-4000-8000-000000000001', 'Flor', 4);

select is((select count(*)::int from public.product_variants
  where product_id = 'c9000000-0000-4000-8000-000000000001'),
  4, 'a receita Brioche tem suas quatro variantes cadastradas');

-- 2. Produto simples legado continua funcionando sem variante (o site antigo
-- nunca informa product_variant_id).
insert into public.product_sale_options (product_id, name, sale_unit, reference_quantity, is_default, active)
values ('c9000000-0000-4000-8000-000000000002', 'Unidade', 'un', 1, true, true);

select is((select product_variant_id from public.product_sale_options
  where product_id = 'c9000000-0000-4000-8000-000000000002' and sale_unit = 'un'),
  null, 'opção de venda do produto legado fica sem variante, como antes da fundação');

select throws_ok(
  $$insert into public.product_sale_options (product_id, name, sale_unit, reference_quantity, is_default, active)
    values ('c9000000-0000-4000-8000-000000000002', 'Unidade duplicada', 'un', 1, false, true)$$,
  '23505', null,
  'a regra antiga de unicidade (produto, unidade de venda) continua valendo para linhas sem variante');

insert into public.product_recipe_yields (product_id, basis, finished_weight_kg, yield_units)
values ('c9000000-0000-4000-8000-000000000002', 'baked', 10, 20);

select throws_ok(
  $$insert into public.product_recipe_yields (product_id, basis, finished_weight_kg, yield_units)
    values ('c9000000-0000-4000-8000-000000000002', 'baked', 5, 10)$$,
  '23505', null,
  'a regra antiga de um rendimento por produto continua valendo para linhas sem variante');

-- 3. Cada variante do Brioche vende por un e por kg, sem duplicar a
-- combinação (produto, variante, unidade de venda).
insert into public.product_sale_options (product_id, product_variant_id, name, sale_unit, reference_quantity, unit_weight_kg, is_default, active)
values
  ('c9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000011', 'Forma - Unidade', 'un', 1, 0.5, true, true),
  ('c9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000011', 'Forma - Quilo', 'kg', 1, null, false, true),
  ('c9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000012', 'Hamburguer - Unidade', 'un', 1, 0.08, true, true),
  ('c9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000012', 'Hamburguer - Quilo', 'kg', 1, null, false, true),
  ('c9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000013', 'Mini - Unidade', 'un', 1, 0.03, true, true),
  ('c9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000013', 'Mini - Quilo', 'kg', 1, null, false, true),
  ('c9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000014', 'Flor - Unidade', 'un', 1, 0.12, true, true),
  ('c9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000014', 'Flor - Quilo', 'kg', 1, null, false, true);

select is((select count(*)::int from public.product_sale_options
  where product_id = 'c9000000-0000-4000-8000-000000000001'),
  8, 'as quatro variantes do Brioche vendem por un e por kg, oito opções ao todo');

select throws_ok(
  $$insert into public.product_sale_options (product_id, product_variant_id, name, sale_unit, reference_quantity, is_default, active)
    values ('c9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000012', 'Hamburguer - Unidade duplicada', 'un', 1, false, true)$$,
  '23505', null,
  'a mesma variante não pode repetir a mesma unidade de venda');

-- 4. Peso/rendimento distinto por variante, sem duplicar a receita comum.
-- Hamburguer: 12 unidades, 0,96 kg assado -> 80 g por unidade (decisão 41/51).
insert into public.product_recipe_yields (product_id, product_variant_id, basis, finished_weight_kg, yield_units)
values
  ('c9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000011', 'baked', 5.0, 5),
  ('c9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000012', 'baked', 0.96, 12);

select is((select average_unit_weight_kg from public.product_recipe_yields
  where product_variant_id = 'c9000000-0000-4000-8000-000000000012'),
  0.08, 'a variante Hamburguer pesa 80 g por unidade, calculado pelo rendimento da própria variante');
select is((select average_unit_weight_kg from public.product_recipe_yields
  where product_variant_id = 'c9000000-0000-4000-8000-000000000011'),
  1.0, 'a variante Forma tem peso próprio, diferente do Hamburguer, sem duplicar a receita');

select throws_ok(
  $$insert into public.product_recipe_yields (product_id, product_variant_id, basis, finished_weight_kg, yield_units)
    values ('c9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000012', 'baked', 1, 10)$$,
  '23505', null,
  'só um rendimento por variante, mesma regra do produto sem variante');

-- 5. Pacote fechado de PJ para a variante Hamburguer: 12 unidades por
-- pacote, mínimo e múltiplo de 1 pacote (decisão 51), sem misturar com a
-- unidade de cobrança de product_sale_options.
insert into public.product_pj_pack_rules (product_id, product_variant_id, pack_size_units, min_order_packs, order_multiple_packs)
values ('c9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000012', 12, 1, 1);

select is((select pack_size_units from public.product_pj_pack_rules
  where product_variant_id = 'c9000000-0000-4000-8000-000000000012'),
  12::numeric, 'o pacote PJ do Hamburguer fecha em 12 unidades');

-- Pacote fechado é sempre número inteiro de unidades/pacotes: meia unidade ou
-- meio pacote não existe fisicamente. A coluna é numeric (não integer) de
-- propósito, para que o valor fracionado chegue inteiro ao CHECK em vez de
-- ser silenciosamente arredondado no cast de entrada.
select throws_ok(
  $$insert into public.product_pj_pack_rules (product_id, product_variant_id, pack_size_units)
    values ('c9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000013', 6.5)$$,
  '23514', null,
  'pacote fracionado é recusado: pack_size_units é sempre número inteiro de unidades');

select throws_ok(
  $$insert into public.product_pj_pack_rules (product_id, product_variant_id, pack_size_units, min_order_packs)
    values ('c9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000013', 6, 1.5)$$,
  '23514', null,
  'pedido mínimo fracionado em pacotes também é recusado');

select throws_ok(
  $$insert into public.product_pj_pack_rules (product_id, product_variant_id, pack_size_units)
    values ('c9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000012', 6)$$,
  '23505', null,
  'só uma regra de pacote PJ por variante');

-- Decisão 10: só o Hamburguer do Brioche vende em múltiplo de 12; os demais
-- produtos não herdam essa regra. Um produto simples legado, sem variante,
-- pode ter sua própria regra de pacote (histórico por produto), separada da
-- regra por variante acima.
insert into public.product_pj_pack_rules (product_id, pack_size_units)
values ('c9000000-0000-4000-8000-000000000002', 4);

select is((select pack_size_units from public.product_pj_pack_rules
  where product_id = 'c9000000-0000-4000-8000-000000000002' and product_variant_id is null),
  4::numeric, 'a Baguete Legada tem sua própria regra de pacote, sem herdar o pacote de 12 do Brioche');

select throws_ok(
  $$insert into public.product_pj_pack_rules (product_id, pack_size_units)
    values ('c9000000-0000-4000-8000-000000000002', 6)$$,
  '23505', null,
  'só uma regra de pacote PJ por produto sem variante, mesma reprodução do comportamento legado');

-- 6. Variante de outro produto é recusada nas três tabelas que referenciam
-- product_variant_id: o banco garante que a variante pertence ao mesmo
-- produto da linha, não confiando só no product_id informado.
insert into public.product_variants (id, product_id, name)
values ('c9000000-0000-4000-8000-000000000031', 'c9000000-0000-4000-8000-000000000002', 'Variante de outro produto');

select throws_ok(
  $$insert into public.product_sale_options (product_id, product_variant_id, name, sale_unit, reference_quantity, is_default, active)
    values ('c9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000031', 'Cruzada', 'un', 1, false, true)$$,
  '23503', null,
  'opção de venda do Brioche não aceita variante da Baguete Legada');

select throws_ok(
  $$insert into public.product_recipe_yields (product_id, product_variant_id, basis, finished_weight_kg, yield_units)
    values ('c9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000031', 'baked', 1, 1)$$,
  '23503', null,
  'rendimento do Brioche não aceita variante da Baguete Legada');

select throws_ok(
  $$insert into public.product_pj_pack_rules (product_id, product_variant_id, pack_size_units)
    values ('c9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000031', 6)$$,
  '23503', null,
  'regra de pacote PJ do Brioche não aceita variante da Baguete Legada');

-- 7. Nome de variante duplicado dentro do mesmo produto é recusado, inclusive
-- variando maiúscula/minúscula ou espaço nas pontas: é a mesma variante.
select throws_ok(
  $$insert into public.product_variants (product_id, name) values
    ('c9000000-0000-4000-8000-000000000001', 'Hamburguer')$$,
  '23505', null,
  'o mesmo produto não pode ter duas variantes com o mesmo nome');

select throws_ok(
  $$insert into public.product_variants (product_id, name) values
    ('c9000000-0000-4000-8000-000000000001', ' hamburguer ')$$,
  '23505', null,
  'nome de variante duplicado por maiúscula ou espaço nas pontas também é recusado');

-- 8. RLS: perfil permitido grava, perfil bloqueado não, leitura é ampla para
-- qualquer perfil ativo, e o site antigo (papel autenticado sem perfil, ou
-- anônimo) continua sem acesso direto.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin)
values
 ('9c000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','variantes-fase1-admin@example.com','',now(),now(),now(),
  '{"provider":"email","providers":["email"]}','{}',false),
 ('9c000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','variantes-fase1-vendas@example.com','',now(),now(),now(),
  '{"provider":"email","providers":["email"]}','{}',false),
 ('9c000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','variantes-fase1-admin-sem-rota@example.com','',now(),now(),now(),
  '{"provider":"email","providers":["email"]}','{}',false);

insert into public.app_profiles(user_id,display_name,role,store,active,allowed_routes)
values
 ('9c000000-0000-4000-8000-000000000001','[TESTE] Admin Catalogo','admin','jc',true,'["/produtos"]'),
 ('9c000000-0000-4000-8000-000000000002','[TESTE] Vendas','vendas','jc',true,'["/pedidos-pj"]'),
 ('9c000000-0000-4000-8000-000000000003','[TESTE] Admin sem rota produtos','admin','jc',true,'["/pedidos-pj"]');

set local role authenticated;
select set_config('request.jwt.claim.sub','9c000000-0000-4000-8000-000000000001',true);
select lives_ok(
  $$insert into public.product_variants (product_id, name) values
    ('c9000000-0000-4000-8000-000000000001', 'Baguete')$$,
  'perfil admin com a rota /produtos liberada cria variante');
select lives_ok(
  $$select count(*) from public.product_variants$$,
  'perfil admin lê a lista de variantes');
select lives_ok(
  $$update public.product_variants set sort_order = 9 where name = 'Baguete'$$,
  'perfil admin atualiza variante');
select is((select sort_order from public.product_variants where name = 'Baguete'),
  9, 'a atualização do perfil admin realmente gravou');

select lives_ok(
  $$insert into public.product_pj_pack_rules (product_id, product_variant_id, pack_size_units) values
    ('c9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000014', 6)$$,
  'perfil admin com a rota /produtos liberada também cria regra de pacote PJ');
select lives_ok(
  $$select count(*) from public.product_pj_pack_rules$$,
  'perfil admin lê a lista de regras de pacote PJ');

select set_config('request.jwt.claim.sub','9c000000-0000-4000-8000-000000000002',true);
select throws_ok(
  $$insert into public.product_variants (product_id, name) values
    ('c9000000-0000-4000-8000-000000000001', 'Tentativa Vendas')$$,
  '42501', null,
  'perfil vendas não cria variante');
-- Sem policy de UPDATE para vendas, a linha some do USING antes de ser
-- alterada: o update roda sem erro e sem afetar nada, em vez de lançar
-- 42501. É o comportamento padrão de RLS, não uma falha de grant.
select lives_ok(
  $$update public.product_variants set sort_order = 1 where name = 'Baguete'$$,
  'update do perfil vendas não lança erro, mas também não altera nada (RLS filtra a linha)');
select is((select sort_order from public.product_variants where name = 'Baguete'),
  9, 'perfil vendas não conseguiu atualizar a variante: valor gravado pelo admin permanece');
select lives_ok(
  $$select count(*) from public.product_variants$$,
  'perfil vendas ainda assim lê o catálogo de variantes');
select lives_ok(
  $$select count(*) from public.product_pj_pack_rules$$,
  'perfil vendas ainda assim lê as regras de pacote PJ');

select set_config('request.jwt.claim.sub','9c000000-0000-4000-8000-000000000003',true);
select throws_ok(
  $$insert into public.product_variants (product_id, name) values
    ('c9000000-0000-4000-8000-000000000001', 'Tentativa Sem Rota')$$,
  '42501', null,
  'perfil admin sem a rota /produtos liberada também não cria variante');
select throws_ok(
  $$insert into public.product_pj_pack_rules (product_id, pack_size_units) values
    ('c9000000-0000-4000-8000-000000000001', 6)$$,
  '42501', null,
  'perfil sem a rota /produtos também não cria regra de pacote PJ');

reset role;

set local role anon;
select throws_ok(
  $$select count(*) from public.product_variants$$,
  '42501', null,
  'visitante anônimo não lê variantes');
select throws_ok(
  $$insert into public.product_variants (product_id, name) values
    ('c9000000-0000-4000-8000-000000000001', 'Tentativa Anonima')$$,
  '42501', null,
  'visitante anônimo não cria variante');
reset role;

select * from finish();
rollback;
