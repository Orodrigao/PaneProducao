-- Memória de fornecedor com produto sem código de barras (28/09/2026).
--
-- O que este teste protege:
--   * "SEM GTIN" (ou qualquer cEAN que não seja GTIN de verdade) não é código de
--     barras: dois produtos a granel do mesmo fornecedor e da mesma unidade
--     ganham cada um a sua memória, e confirmar um não reescreve o outro;
--   * a nota seguinte não herda a memória de outro produto do fornecedor;
--   * marcar um item como uso ou despesa não desliga a memória de outro produto
--     do mesmo fornecedor, e classificar um produto não desliga a decisão de uso
--     ou despesa de outro;
--   * a memória guarda nulo no lugar de "SEM GTIN", qualquer que seja a porta de
--     entrada; GTIN válido continua guardado, sem espaços, e continua
--     reconhecendo o mesmo produto mesmo com outro código do fornecedor;
--   * o item da nota continua guardando o que a NF-e diz;
--   * a regra de GTIN e o gatilho não são chamados direto pela Data API.
--
-- Caso real: as farinhas Mora, Croissant e La Rustica da Le 5 Stagioni, todas
-- em KG e "SEM GTIN", ficaram com uma memória só, apontando para a farinha de
-- croissant.

begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

-- Estrutura ------------------------------------------------------------------

select has_function('private', 'gtin_valido', array['text'], 'existe uma regra única de código de barras válido');
select ok(not has_function_privilege('authenticated', 'private.gtin_valido(text)', 'execute'),
  'a regra de GTIN não é chamada direto pela Data API');
select ok(not has_function_privilege('authenticated', 'private.normalizar_gtin_memoria_fornecedor()', 'execute'),
  'o gatilho da memória não é chamado direto');

select is(private.gtin_valido('SEM GTIN'), null, '"SEM GTIN" não é código de barras');
select is(private.gtin_valido('0000000000000'), null, 'só zeros não é código de barras');
select is(private.gtin_valido('12345'), null, 'código curto demais não é código de barras');
select is(private.gtin_valido(null), null, 'nulo continua nulo');
select is(private.gtin_valido(' 7896021822379 '), '7896021822379', 'GTIN-13 válido é guardado sem espaços');
select is(private.gtin_valido('78960218'), '78960218', 'GTIN-8 válido é guardado');

select has_trigger('public', 'payable_product_mappings', 'normalizar_gtin_memoria_insumo',
  'a memória de insumo normaliza o código de barras na gravação');
select has_trigger('public', 'payable_non_catalog_mappings', 'normalizar_gtin_memoria_uso_despesa',
  'a memória de uso ou despesa normaliza o código de barras na gravação');

-- Cenário --------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values (
  '99310000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'financeiro-sem-gtin-test@example.com',
  '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
  now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values ('99310000-0000-4000-8000-00000000000a', 'Financeiro Sem GTIN', 'financeiro', 'jc', true, '[]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope)
values
  ('99310000-0000-4000-8000-00000000000a', 'contas_pagar.importar_xml', '*'),
  ('99310000-0000-4000-8000-00000000000a', 'contas_pagar.lancar', '*'),
  ('99310000-0000-4000-8000-00000000000a', 'contas_pagar.acessar', '*');

insert into public.suppliers (id, name, active)
values ('99310000-0000-4000-8000-0000000000f1', '[TESTE] Distribuidora de farinhas a granel', true);

insert into public.products (id, name, category, active, unit, kind, cost_price)
values
  ('99310000-0000-4000-8000-0000000000d1', '[TESTE] Farinha croissant', 'Insumos', true, 'kg', 'insumo', 10),
  ('99310000-0000-4000-8000-0000000000d2', '[TESTE] Farinha integral Mora', 'Insumos', true, 'kg', 'insumo', 10),
  ('99310000-0000-4000-8000-0000000000d3', '[TESTE] Farinha La Rustica', 'Insumos', true, 'kg', 'insumo', 10),
  ('99310000-0000-4000-8000-0000000000d4', '[TESTE] Farinha classificada depois', 'Insumos', true, 'kg', 'insumo', 10);

-- Um item a granel como a NF-e manda: 10 kg por R$ 100, cEAN "SEM GTIN" por padrão.
create function pg_temp.item(
  p_line integer, p_code text, p_product uuid, p_status text, p_ean text default 'SEM GTIN'
) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'line_number', p_line, 'supplier_product_code', p_code, 'supplier_ean', p_ean,
    'source_description', '[TESTE] FARINHA A GRANEL ' || p_code, 'source_unit', 'KG', 'source_quantity', 10,
    'product_id', p_product, 'conversion_basis', 'simple',
    'conversion_factor', case when p_product is null then null else 1 end,
    'usable_quantity', case when p_product is null then null else 10 end,
    'line_total', 100, 'unit_price', 10, 'discount_value', 0,
    'factor_confirmed', true, 'remember_conversion', true, 'mapping_status', p_status
  )
$$;

create function pg_temp.importar_sql(p_numero integer, p_items jsonb) returns text
language sql immutable as $$
  select format(
    $q$select public.create_xml_payable(%L::uuid, %L, '99310000-0000-4000-8000-0000000000f1'::uuid, %L, '1', '2026-09-11'::date, 'boleto', %s, '', %L::jsonb, %L::jsonb)$q$,
    ('99310000-0000-4000-8000-' || lpad(p_numero::text, 12, '0'))::uuid,
    '3526099931000000000055001000000000' || lpad(p_numero::text, 10, '0'),
    p_numero::text, jsonb_array_length(p_items) * 100, p_items,
    jsonb_build_array(jsonb_build_object('installment_number', 1, 'due_date', '2026-10-10',
      'amount', jsonb_array_length(p_items) * 100))
  )
$$;

create function pg_temp.memoria(p_code text) returns uuid
language sql stable as $$
  select mapping.base_product_id from public.payable_product_mappings mapping
  where mapping.supplier_id = '99310000-0000-4000-8000-0000000000f1'
    and mapping.supplier_product_code = p_code and mapping.active
$$;

create function pg_temp.memorias_ativas() returns integer
language sql stable as $$
  select count(*)::int from public.payable_product_mappings mapping
  where mapping.supplier_id = '99310000-0000-4000-8000-0000000000f1' and mapping.active
$$;

-- 1. Duas farinhas "SEM GTIN" na mesma nota ---------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '99310000-0000-4000-8000-00000000000a', true);

select lives_ok(pg_temp.importar_sql(1, jsonb_build_array(
    pg_temp.item(1, '000498', '99310000-0000-4000-8000-0000000000d2', 'mapeado'),
    pg_temp.item(2, '000989', '99310000-0000-4000-8000-0000000000d1', 'mapeado'))),
  'nota com duas farinhas "SEM GTIN" do mesmo fornecedor entra');

reset role;

select is(pg_temp.memorias_ativas(), 2, 'cada farinha ganha a sua memória');
select is(pg_temp.memoria('000498'), '99310000-0000-4000-8000-0000000000d2'::uuid,
  'a memória da Mora continua apontando para a Mora, e não para a última farinha da nota');
select is(pg_temp.memoria('000989'), '99310000-0000-4000-8000-0000000000d1'::uuid,
  'a farinha de croissant tem memória própria');
select is((select count(*)::int from public.payable_product_mappings
    where supplier_id = '99310000-0000-4000-8000-0000000000f1' and supplier_ean is not null), 0,
  'a memória guarda nulo no lugar de "SEM GTIN"');
select is((select count(*)::int from public.payable_purchase_items item
    join public.payable_purchases purchase on purchase.id = item.purchase_id
    where purchase.supplier_id = '99310000-0000-4000-8000-0000000000f1' and item.source_ean = 'SEM GTIN'), 2,
  'o item da nota continua guardando o que a NF-e diz');

-- 2. Nota seguinte com uma farinha nova -------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '99310000-0000-4000-8000-00000000000a', true);

select lives_ok(pg_temp.importar_sql(2, jsonb_build_array(
    pg_temp.item(1, '001028', '99310000-0000-4000-8000-0000000000d3', 'mapeado'))),
  'nota seguinte traz a La Rustica, que o fornecedor nunca tinha vendido');

reset role;

select is(pg_temp.memorias_ativas(), 3, 'a La Rustica ganha memória nova sem apagar as outras');
select is(pg_temp.memoria('001028'), '99310000-0000-4000-8000-0000000000d3'::uuid, 'a La Rustica aponta para ela mesma');
select is(pg_temp.memoria('000498'), '99310000-0000-4000-8000-0000000000d2'::uuid, 'a Mora não foi reescrita pela La Rustica');
select is(pg_temp.memoria('000989'), '99310000-0000-4000-8000-0000000000d1'::uuid, 'o croissant não foi reescrito pela La Rustica');

-- 3. Uso ou despesa não desliga a memória de outro produto ------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '99310000-0000-4000-8000-00000000000a', true);

select lives_ok(pg_temp.importar_sql(3, jsonb_build_array(
    pg_temp.item(1, '009999', null, 'nao_aplicavel'))),
  'item "SEM GTIN" do mesmo fornecedor marcado como uso ou despesa');

reset role;

select is(pg_temp.memorias_ativas(), 3, 'as três memórias de farinha continuam ligadas');
select ok(exists(select 1 from public.payable_non_catalog_mappings
    where supplier_id = '99310000-0000-4000-8000-0000000000f1' and supplier_product_code = '009999' and active),
  'a decisão de uso ou despesa fica lembrada só para o próprio item');

-- 4. Classificação posterior também separa ----------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '99310000-0000-4000-8000-00000000000a', true);

select lives_ok(pg_temp.importar_sql(4, jsonb_build_array(
    pg_temp.item(1, '002000', null, 'pendente'),
    pg_temp.item(2, '003000', null, 'pendente'))),
  'nota com dois itens "SEM GTIN" pendentes');

select lives_ok(
  $$select public.classify_payable_item(
    (select id from public.payable_purchase_items where source_product_code = '002000'),
    '99310000-0000-4000-8000-0000000000d4'::uuid, 'simple', 1, 10, true, true)$$,
  'classificação posterior de um item "SEM GTIN"');

select lives_ok(
  $$select public.classify_payable_item_without_product(
    (select id from public.payable_purchase_items where source_product_code = '003000'), true)$$,
  'classificação posterior de outro item "SEM GTIN" como uso ou despesa');

reset role;

select is(pg_temp.memoria('002000'), '99310000-0000-4000-8000-0000000000d4'::uuid,
  'a classificação posterior grava a memória do próprio item');
select is(pg_temp.memorias_ativas(), 4,
  'marcar outro item como uso ou despesa não desliga nenhuma memória de farinha');
select is(pg_temp.memoria('000498'), '99310000-0000-4000-8000-0000000000d2'::uuid,
  'a Mora segue intacta depois das classificações posteriores');
select ok(exists(select 1 from public.payable_non_catalog_mappings
    where supplier_id = '99310000-0000-4000-8000-0000000000f1' and supplier_product_code = '009999' and active),
  'classificar um produto não desliga a decisão de uso ou despesa de outro item');

-- 5. GTIN de verdade continua reconhecendo --------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '99310000-0000-4000-8000-00000000000a', true);

select lives_ok(pg_temp.importar_sql(5, jsonb_build_array(
    pg_temp.item(1, 'GTIN-1', '99310000-0000-4000-8000-0000000000d1', 'mapeado', '7896021822379'))),
  'produto com código de barras de verdade');

select lives_ok(pg_temp.importar_sql(6, jsonb_build_array(
    pg_temp.item(1, 'GTIN-2', '99310000-0000-4000-8000-0000000000d1', 'mapeado', '7896021822379'))),
  'o mesmo código de barras chega com outro código do fornecedor');

reset role;

select is((select count(*)::int from public.payable_product_mappings
    where supplier_id = '99310000-0000-4000-8000-0000000000f1' and supplier_ean = '7896021822379' and active), 1,
  'o código de barras válido continua reconhecendo a mesma memória, sem criar outra');

-- 6. Qualquer porta de entrada normaliza a memória --------------------------

insert into public.payable_product_mappings (
  supplier_id, supplier_product_code, supplier_ean, supplier_description, purchase_unit,
  base_product_id, base_unit, conversion_basis, conversion_factor, last_confirmed_by
) values
  ('99310000-0000-4000-8000-0000000000f1', 'DIRETO-1', 'SEM GTIN', '[TESTE] DIRETO SEM GTIN', 'UN',
   '99310000-0000-4000-8000-0000000000d1', 'kg', 'package', 5, '99310000-0000-4000-8000-00000000000a'),
  ('99310000-0000-4000-8000-0000000000f1', 'DIRETO-2', ' 78960218 ', '[TESTE] DIRETO COM GTIN', 'UN',
   '99310000-0000-4000-8000-0000000000d1', 'kg', 'package', 5, '99310000-0000-4000-8000-00000000000a');

select is((select supplier_ean from public.payable_product_mappings where supplier_product_code = 'DIRETO-1'), null,
  'gravação direta de "SEM GTIN" na memória vira nulo');
select is((select supplier_ean from public.payable_product_mappings where supplier_product_code = 'DIRETO-2'), '78960218',
  'GTIN válido gravado direto continua guardado, sem espaços');

update public.payable_product_mappings set supplier_ean = 'SEM GTIN' where supplier_product_code = 'DIRETO-2';
select is((select supplier_ean from public.payable_product_mappings where supplier_product_code = 'DIRETO-2'), null,
  'alteração direta da memória para "SEM GTIN" vira nulo');

insert into public.payable_non_catalog_mappings (
  supplier_id, supplier_product_code, supplier_ean, supplier_description, purchase_unit, last_confirmed_by
) values ('99310000-0000-4000-8000-0000000000f1', 'DIRETO-3', 'SEM GTIN', '[TESTE] DIRETO USO', 'UN',
  '99310000-0000-4000-8000-00000000000a');
select is((select supplier_ean from public.payable_non_catalog_mappings where supplier_product_code = 'DIRETO-3'), null,
  'a memória de uso ou despesa também guarda nulo no lugar de "SEM GTIN"');

select * from finish();
rollback;
