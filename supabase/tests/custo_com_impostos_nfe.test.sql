-- Fase 3A das compras por XML: custo com impostos não recuperáveis.
--
-- O que este teste protege:
--   * NF-e com ST, IPI, frete e outras despesas entra pelo XML e o custo do
--     insumo inclui o que a própria nota atribuiu ao item, sem somar o total de
--     novo (a soma do valor pago dos itens é exatamente o total da nota);
--   * o banco confere a composição campo a campo: campo ausente, caso sem
--     evidência, acréscimo só no total, valor trocado de campo, imposto contado
--     duas vezes e linha repetida são recusados com explicação;
--   * a tolerância de um centavo da SEFAZ cai num item determinado e não
--     esconde sobra;
--   * o custo do insumo é o da NF-e mais recente, com média das linhas do mesmo
--     insumo na nota, também na classificação posterior;
--   * o site anterior (sem bloco de totais) segue na regra de antes, e envio
--     fiscal pela metade é recusado;
--   * confirmar rascunho confere total e fornecedor;
--   * Financeiro JC importa pela Data API; Vendas JA é barrado.
--
-- As chamadas de comportamento rodam com a sessão identificada pelo mesmo
-- request.jwt.claim.sub que a Data API usa; a permissão efetiva do papel
-- authenticated é provada à parte, no fim, com SQL literal.

begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

-- Estrutura ------------------------------------------------------------------

select has_column('public', 'payable_purchase_items', 'fiscal_gross_value', 'o item guarda o vProd exato da NF-e');
select has_column('public', 'payable_purchase_items', 'fiscal_icms_st', 'o item guarda o ICMS-ST da NF-e');
select has_column('public', 'payable_purchase_items', 'fiscal_ipi', 'o item guarda o IPI da NF-e');
select has_column('public', 'payable_purchase_items', 'fiscal_freight', 'o item guarda o frete da NF-e');
select has_column('public', 'payable_purchase_items', 'fiscal_other_expenses', 'o item guarda as outras despesas da NF-e');
select has_column('public', 'payable_purchase_items', 'fiscal_cent_adjustment', 'o item guarda o centavo de tolerância que recebeu');
select has_column('public', 'payable_purchase_items', 'acquisition_value', 'o item tem o valor pago calculado pelo banco');
select has_column('public', 'payable_purchase_items', 'cost_applied', 'o item registra se trocou o custo do insumo');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_xml_payable'),
  1, 'uma única create_xml_payable: sem sobrecarga ambígua para a Data API');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'confirm_xml_import_draft'),
  1, 'uma única confirm_xml_import_draft: sem sobrecarga ambígua para a Data API');
select ok(not has_function_privilege('authenticated', 'private.apply_xml_purchase_cost(uuid, uuid)', 'execute'),
  'ninguém aplica custo de insumo direto, só pela importação ou classificação');
select ok(not has_function_privilege('authenticated', 'private.validate_nfe_fiscal_composition(jsonb, jsonb, numeric)', 'execute'),
  'a conferência da composição não é chamada direto');
select ok(not has_function_privilege('authenticated', 'private.nfe_cent_adjustments(jsonb, jsonb)', 'execute'),
  'o ajuste de centavos não é chamado direto');

-- Cenário --------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('99300000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'financeiro-custo-impostos-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('99300000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'vendas-custo-impostos-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('99300000-0000-4000-8000-00000000000a', 'Financeiro Custo', 'financeiro', 'jc', true, '[]'::jsonb),
  ('99300000-0000-4000-8000-00000000000b', 'Vendas Custo', 'vendas', 'ja', true, '[]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope)
values
  ('99300000-0000-4000-8000-00000000000a', 'contas_pagar.importar_xml', 'jc'),
  ('99300000-0000-4000-8000-00000000000a', 'contas_pagar.acessar', 'jc'),
  ('99300000-0000-4000-8000-00000000000a', 'contas_pagar.lancar', 'jc');

insert into public.suppliers (id, name, active)
values
  ('99300000-0000-4000-8000-0000000000f1', '[TESTE] Fornecedor custo com impostos', true),
  ('99300000-0000-4000-8000-0000000000f2', '[TESTE] Outro fornecedor custo', true);

insert into public.products (id, name, category, active, unit, kind, cost_price)
values
  ('99300000-0000-4000-8000-0000000000d1', '[TESTE] Farinha custo com impostos', 'Insumos', true, 'kg', 'insumo', 5.00),
  ('99300000-0000-4000-8000-0000000000d2', '[TESTE] Refrigerante custo com impostos', 'Insumos', true, 'kg', 'insumo', 3.00),
  ('99300000-0000-4000-8000-0000000000d3', '[TESTE] Leite site antigo', 'Insumos', true, 'kg', 'insumo', 4.00),
  ('99300000-0000-4000-8000-0000000000d4', '[TESTE] Açúcar pela Data API', 'Insumos', true, 'kg', 'insumo', 1.00),
  ('99300000-0000-4000-8000-0000000000d5', '[TESTE] Manteiga do mesmo dia', 'Insumos', true, 'kg', 'insumo', 1.00);

create function pg_temp.chave(p_numero integer) returns text
language sql immutable as $$
  select '3526099930000000000055001000000000' || lpad(p_numero::text, 10, '0')
$$;

create function pg_temp.pedido(p_numero integer) returns uuid
language sql immutable as $$
  select ('99300000-0000-4000-8000-' || lpad(p_numero::text, 12, '0'))::uuid
$$;

-- Um item como a tela manda: dados da classificação e valores fiscais da NF-e.
create function pg_temp.item(
  p_line integer, p_product uuid, p_gross numeric, p_usable numeric,
  p_st numeric default 0, p_ipi numeric default 0, p_freight numeric default 0, p_other numeric default 0
) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'line_number', p_line, 'supplier_product_code', 'CUSTO-' || p_line, 'supplier_ean', null,
    'source_description', '[TESTE] ITEM CUSTO ' || p_line, 'source_unit', 'KG', 'source_quantity', 1,
    'product_id', p_product,
    'conversion_basis', case when p_product is null then null else 'simple' end,
    'conversion_factor', case when p_product is null then null else p_usable end,
    'usable_quantity', case when p_product is null then null else p_usable end,
    'line_total', p_gross, 'unit_price', p_gross, 'discount_value', 0,
    'factor_confirmed', true, 'remember_conversion', false,
    'mapping_status', case when p_product is null then 'nao_aplicavel' else 'mapeado' end,
    'fiscal_gross_value', p_gross, 'icms_st', p_st, 'fcp_st', 0, 'ipi', p_ipi, 'ipi_returned', 0,
    'freight', p_freight, 'insurance', 0, 'other_expenses', p_other, 'import_tax', 0,
    'icms_exempt', 0, 'deducts_exemption', null, 'composes_total', '1'
  )
$$;

-- O mesmo item como o site anterior à fase 3A manda: sem nenhum valor fiscal.
create function pg_temp.item_antigo(p_line integer, p_product uuid, p_gross numeric, p_usable numeric) returns jsonb
language sql immutable as $$
  select pg_temp.item(p_line, p_product, p_gross, p_usable) - array[
    'fiscal_gross_value', 'icms_st', 'fcp_st', 'ipi', 'ipi_returned', 'freight', 'insurance',
    'other_expenses', 'import_tax', 'icms_exempt', 'deducts_exemption', 'composes_total'
  ]
$$;

create function pg_temp.totais(
  p_products numeric, p_total numeric,
  p_st numeric default 0, p_ipi numeric default 0, p_freight numeric default 0, p_other numeric default 0
) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'products', p_products, 'discounts', 0, 'icms_st', p_st, 'fcp_st', 0, 'ipi', p_ipi,
    'ipi_returned', 0, 'freight', p_freight, 'insurance', 0, 'other_expenses', p_other,
    'import_tax', 0, 'icms_exempt', 0, 'services', 0, 'total', p_total
  )
$$;

create function pg_temp.importar_sql(
  p_numero integer, p_issue date, p_total numeric, p_items jsonb, p_totals jsonb,
  p_supplier uuid default '99300000-0000-4000-8000-0000000000f1',
  p_issued_at timestamptz default null
) returns text
language sql immutable as $$
  select format(
    $q$select public.create_xml_payable(%L::uuid, %L, %L::uuid, %L, '1', %L::date, 'boleto', %s, '', %L::jsonb, %L::jsonb, %L::jsonb, %L::timestamptz)$q$,
    pg_temp.pedido(p_numero), pg_temp.chave(p_numero), p_supplier, p_numero::text, p_issue, p_total, p_items,
    jsonb_build_array(jsonb_build_object('installment_number', 1, 'due_date', '2026-10-10', 'amount', p_total)),
    p_totals, p_issued_at
  )
$$;

create function pg_temp.compra(p_numero integer) returns uuid
language sql stable as $$
  select purchase.id from public.payable_purchases purchase where purchase.request_id = pg_temp.pedido(p_numero)
$$;

create function pg_temp.custo(p_product uuid) returns numeric
language sql stable as $$
  select product.cost_price from public.products product where product.id = p_product
$$;

select set_config('request.jwt.claim.sub', '99300000-0000-4000-8000-00000000000a', true);

-- 1. Nota com ST, IPI e outras despesas entra e cada item leva o seu ---------

select lives_ok(
  pg_temp.importar_sql(1, '2026-09-01', 126.50,
    jsonb_build_array(
      pg_temp.item(1, '99300000-0000-4000-8000-0000000000d1', 30, 5, 1.50, 1.00, 0, 0.50),
      pg_temp.item(2, '99300000-0000-4000-8000-0000000000d2', 40, 10, 1.50, 1.00, 0, 0.50),
      pg_temp.item(3, null, 50, null, 0, 0, 0, 0.50)
    ),
    pg_temp.totais(120, 126.50, 3.00, 2.00, 0, 1.50)),
  'NF-e com ST, IPI e outras despesas entra pelo XML');

select is(pg_temp.custo('99300000-0000-4000-8000-0000000000d1'), 6.60::numeric,
  'custo da farinha inclui só o que a nota atribuiu a ela: (30 + 1,50 + 1 + 0,50) / 5');
select is(pg_temp.custo('99300000-0000-4000-8000-0000000000d2'), 4.30::numeric,
  'custo do refrigerante: (40 + 1,50 + 1 + 0,50) / 10');
select is((select total_value from public.payable_purchases where id = pg_temp.compra(1)), 126.50::numeric,
  'a conta a pagar nasce com o total da nota');
select is((select sum(acquisition_value) from public.payable_purchase_items where purchase_id = pg_temp.compra(1)), 126.50::numeric,
  'o valor pago de todos os itens soma exatamente o total: nenhum imposto contado duas vezes');
select is((select acquisition_value from public.payable_purchase_items where purchase_id = pg_temp.compra(1) and source_line_number = 3),
  50.50::numeric, 'item de uso ou despesa guarda o valor pago, sem custo de receita');
select is((select fiscal_gross_value from public.payable_purchase_items where purchase_id = pg_temp.compra(1) and source_line_number = 1),
  30.00::numeric, 'o valor original do produto continua guardado para conferir com a DANFE');
select is((select line_total from public.payable_purchase_items where purchase_id = pg_temp.compra(1) and source_line_number = 1),
  30.00::numeric, 'o valor do item na nota não muda por causa dos impostos');
select is((select normalized_unit_cost from public.payable_purchase_items where purchase_id = pg_temp.compra(1) and source_line_number = 1),
  6.6::numeric, 'o custo unitário do item também inclui os acréscimos');
select is((select cost_applied from public.payable_purchase_items where purchase_id = pg_temp.compra(1) and source_line_number = 1),
  true, 'o item registra que trocou o custo do insumo');
select is((select (details ->> 'fiscal_composition')::boolean from public.payable_events
  where purchase_id = pg_temp.compra(1) and event_type = 'criada'),
  true, 'o evento da conta registra que a composição fiscal foi conferida');

-- 2. Convivência com o site anterior -----------------------------------------

select lives_ok(
  pg_temp.importar_sql(2, '2026-09-01', 20,
    jsonb_build_array(pg_temp.item_antigo(1, '99300000-0000-4000-8000-0000000000d3', 20, 4)), null),
  'o site anterior, sem bloco de totais nem valores fiscais, continua importando');
select is(pg_temp.custo('99300000-0000-4000-8000-0000000000d3'), 5.00::numeric,
  'no envio antigo o custo segue a regra de antes: 20 / 4');
select is((select acquisition_value from public.payable_purchase_items where purchase_id = pg_temp.compra(2)), null::numeric,
  'compra sem valores fiscais não inventa valor pago');

select throws_ok(
  pg_temp.importar_sql(3, '2026-09-01', 21,
    jsonb_build_array(pg_temp.item_antigo(1, null, 20, null)), null),
  '22023', 'A soma dos itens da NF-e não fecha com o total informado.',
  'no envio antigo, nota com acréscimo continua recusada como antes');

select throws_ok(
  pg_temp.importar_sql(4, '2026-09-01', 21.50,
    jsonb_build_array(pg_temp.item(1, null, 20, null, 1.50)), null),
  '22023', 'A NF-e chegou com valores fiscais sem o bloco de totais. Recarregue a página e importe de novo.',
  'valores fiscais pela metade, sem o bloco de totais, são recusados');

-- 3. Conferência campo a campo -----------------------------------------------

select throws_ok(
  pg_temp.importar_sql(5, '2026-09-01', 21,
    jsonb_build_array(pg_temp.item(1, null, 20, null, 0, 1)), pg_temp.totais(20, 21, 0, 1) - 'ipi'),
  '22023', 'O bloco de totais da NF-e não informa ipi como valor. Uma NF-e autorizada sempre traz esse campo.',
  'campo ausente no bloco de totais não vira zero');

select throws_ok(
  pg_temp.importar_sql(6, '2026-09-01', 20,
    jsonb_build_array(pg_temp.item(1, null, 20, null) - 'freight'), pg_temp.totais(20, 20)),
  '22023', 'Item da NF-e sem o valor fiscal freight.',
  'campo ausente no item não vira zero');

select throws_ok(
  pg_temp.importar_sql(7, '2026-09-01', 22,
    jsonb_build_array(jsonb_set(pg_temp.item(1, null, 20, null), '{insurance}', '2')),
    jsonb_set(pg_temp.totais(20, 22), '{insurance}', '2')),
  '22023', 'A NF-e traz seguro, um caso que o ERP ainda não sabe conferir. Lance esta compra à mão.',
  'seguro, sem evidência real, continua recusado');

select throws_ok(
  pg_temp.importar_sql(8, '2026-09-01', 20,
    jsonb_build_array(jsonb_set(pg_temp.item(1, null, 20, null), '{composes_total}', '"0"')), pg_temp.totais(20, 20)),
  '22023', 'O item 1 não está marcado como parte do total da nota (indTot), um caso que o ERP ainda não sabe conferir.',
  'item fora do total da nota continua recusado');

select throws_ok(
  pg_temp.importar_sql(9, '2026-09-01', 24,
    jsonb_build_array(pg_temp.item(1, null, 20, null)), pg_temp.totais(20, 24, 0, 0, 4)),
  '22023', 'Os itens somam R$ 0,00 de frete, mas o total da nota informa R$ 4,00.',
  'frete só no total é divergência: não existe despesa comum para ratear');

select throws_ok(
  pg_temp.importar_sql(10, '2026-09-01', 23,
    jsonb_build_array(pg_temp.item(1, null, 20, null, 1.50)), pg_temp.totais(20, 23, 1.50)),
  '22023', 'R$ 1,50 da nota ficaram sem explicação. Confira o arquivo com o fornecedor; se o XML estiver correto, a leitura do ERP está falhando.',
  'total que conta o ST duas vezes é recusado, com o valor que sobrou');

select throws_ok(
  pg_temp.importar_sql(11, '2026-09-01', 22,
    jsonb_build_array(pg_temp.item(1, null, 20, null, 0, 0, 2)), pg_temp.totais(20, 22, 0, 0, 0, 2)),
  '22023', 'Os itens somam R$ 2,00 de frete, mas o total da nota informa R$ 0,00.',
  'valor que troca de campo entre frete e outras despesas é recusado mesmo com o total fechando');

select throws_ok(
  pg_temp.importar_sql(12, '2026-09-01', 40,
    jsonb_build_array(pg_temp.item(1, null, 20, null), pg_temp.item(1, null, 20, null)), pg_temp.totais(40, 40)),
  '22023', 'A NF-e tem número de linha repetido.',
  'número de linha repetido é recusado, porque decide quem recebe o centavo');

select throws_ok(
  pg_temp.importar_sql(13, '2026-09-01', 29,
    jsonb_build_array(jsonb_set(pg_temp.item(1, null, 30, null), '{line_total}', '29')), pg_temp.totais(30, 29)),
  '22023', 'O valor do item não confere com o valor do produto e o desconto da NF-e.',
  'valor do item diferente do vProd menos desconto é recusado');

select is((select count(*)::int from public.payable_purchases where request_id in (
  pg_temp.pedido(3), pg_temp.pedido(4), pg_temp.pedido(5), pg_temp.pedido(6), pg_temp.pedido(7),
  pg_temp.pedido(8), pg_temp.pedido(9), pg_temp.pedido(10), pg_temp.pedido(11), pg_temp.pedido(12), pg_temp.pedido(13))),
  0, 'nenhuma nota recusada deixou conta a pagar');

-- 4. Tolerância de um centavo ------------------------------------------------

select lives_ok(
  pg_temp.importar_sql(14, '2026-09-01', 124.01,
    jsonb_build_array(pg_temp.item(1, null, 60, null, 0, 0, 2), pg_temp.item(2, null, 60, null, 0, 0, 2)),
    pg_temp.totais(120, 124.01, 0, 0, 4.01)),
  'um centavo a mais no total, que a SEFAZ tolera, é aceito');
select is((select fiscal_cent_adjustment from public.payable_purchase_items where purchase_id = pg_temp.compra(14) and source_line_number = 1),
  0.01::numeric, 'o centavo a mais vai para o item de maior valor; no empate, a menor linha');
select is((select fiscal_cent_adjustment from public.payable_purchase_items where purchase_id = pg_temp.compra(14) and source_line_number = 2),
  0::numeric, 'o outro item não recebe centavo');
select is((select sum(acquisition_value) from public.payable_purchase_items where purchase_id = pg_temp.compra(14)),
  124.01::numeric, 'com o centavo, o valor pago dos itens fecha com o total');

select lives_ok(
  pg_temp.importar_sql(15, '2026-09-01', 153.99,
    jsonb_build_array(pg_temp.item(1, null, 100, null), pg_temp.item(2, null, 50, null, 0, 0, 4)),
    pg_temp.totais(150, 153.99, 0, 0, 3.99)),
  'um centavo a menos no total é aceito');
select is((select acquisition_value from public.payable_purchase_items where purchase_id = pg_temp.compra(15) and source_line_number = 2),
  53.99::numeric, 'o centavo a menos sai do maior item que tem frete, e não do maior item da nota');
select is((select acquisition_value from public.payable_purchase_items where purchase_id = pg_temp.compra(15) and source_line_number = 1),
  100.00::numeric, 'o item sem frete não fica com acréscimo negativo');

select throws_ok(
  pg_temp.importar_sql(16, '2026-09-01', 124.02,
    jsonb_build_array(pg_temp.item(1, null, 60, null, 0, 0, 2), pg_temp.item(2, null, 60, null, 0, 0, 2)),
    pg_temp.totais(120, 124.02, 0, 0, 4.02)),
  '22023', 'Os itens somam R$ 4,00 de frete, mas o total da nota informa R$ 4,02.',
  'dois centavos já não são tolerância');

-- 5. Custo do insumo: NF-e mais recente manda --------------------------------

select lives_ok(
  pg_temp.importar_sql(17, '2026-08-15', 20,
    jsonb_build_array(pg_temp.item(1, '99300000-0000-4000-8000-0000000000d1', 20, 5)), pg_temp.totais(20, 20)),
  'nota mais antiga, lançada depois, vira conta normalmente');
select is(pg_temp.custo('99300000-0000-4000-8000-0000000000d1'), 6.60::numeric,
  'nota de 15/08 lançada depois da de 01/09 não troca o custo da farinha');
select is((select cost_applied from public.payable_purchase_items where purchase_id = pg_temp.compra(17)),
  false, 'o item da nota antiga registra que não trocou o custo');

select lives_ok(
  pg_temp.importar_sql(18, '2026-09-05', 25,
    jsonb_build_array(pg_temp.item(1, '99300000-0000-4000-8000-0000000000d1', 25, 5)), pg_temp.totais(25, 25)),
  'nota mais recente entra');
select is(pg_temp.custo('99300000-0000-4000-8000-0000000000d1'), 5.00::numeric,
  'nota de 05/09 troca o custo da farinha');

select lives_ok(
  pg_temp.importar_sql(19, '2026-09-06', 40,
    jsonb_build_array(
      pg_temp.item(1, '99300000-0000-4000-8000-0000000000d1', 10, 2),
      pg_temp.item(2, '99300000-0000-4000-8000-0000000000d1', 30, 3)
    ), pg_temp.totais(40, 40)),
  'nota com o mesmo insumo em duas linhas entra');
select is(pg_temp.custo('99300000-0000-4000-8000-0000000000d1'), 8.00::numeric,
  'o mesmo insumo em duas linhas recebe o custo médio da nota: 40 / 5, e não o da última linha');

-- 5b. Duas notas do mesmo dia: decide a hora de emissão ----------------------

select lives_ok(
  pg_temp.importar_sql(30, '2026-09-09', 50,
    jsonb_build_array(pg_temp.item(1, '99300000-0000-4000-8000-0000000000d5', 50, 5)), pg_temp.totais(50, 50),
    '99300000-0000-4000-8000-0000000000f1', '2026-09-09 16:00:00-03'),
  'nota emitida às 16h entra');
select is(pg_temp.custo('99300000-0000-4000-8000-0000000000d5'), 10.00::numeric, 'a nota das 16h grava o custo: 50 / 5');
select is((select nfe_issued_timestamp from public.payable_purchases where id = pg_temp.compra(30)),
  '2026-09-09 16:00:00-03'::timestamptz, 'a hora de emissão fica guardada na conta');

select lives_ok(
  pg_temp.importar_sql(31, '2026-09-09', 40,
    jsonb_build_array(pg_temp.item(1, '99300000-0000-4000-8000-0000000000d5', 40, 5)), pg_temp.totais(40, 40),
    '99300000-0000-4000-8000-0000000000f2', '2026-09-09 09:00:00-03'),
  'nota emitida às 9h do mesmo dia, lançada depois, entra como conta');
select is(pg_temp.custo('99300000-0000-4000-8000-0000000000d5'), 10.00::numeric,
  'a nota das 9h não troca o custo gravado pela das 16h do mesmo dia');
select is((select cost_applied from public.payable_purchase_items where purchase_id = pg_temp.compra(31)),
  false, 'a nota das 9h registra que não trocou o custo');

select lives_ok(
  pg_temp.importar_sql(32, '2026-09-09', 45,
    jsonb_build_array(pg_temp.item(1, '99300000-0000-4000-8000-0000000000d5', 45, 5)), pg_temp.totais(45, 45),
    '99300000-0000-4000-8000-0000000000f1', '2026-09-09 18:00:00-03'),
  'nota emitida às 18h do mesmo dia entra');
select is(pg_temp.custo('99300000-0000-4000-8000-0000000000d5'), 9.00::numeric,
  'a nota das 18h, a mais recente do dia, troca o custo: 45 / 5');

select lives_ok(
  pg_temp.importar_sql(33, '2026-09-09', 35,
    jsonb_build_array(pg_temp.item_antigo(1, '99300000-0000-4000-8000-0000000000d5', 35, 5)), null),
  'nota do mesmo dia enviada pelo site anterior, sem hora de emissão, entra');
select is(pg_temp.custo('99300000-0000-4000-8000-0000000000d5'), 7.00::numeric,
  'sem hora de emissão, no mesmo dia vale a ordem de lançamento, como antes da fase 3A');

select ok((select position('payable-mapping-supplier' in prosrc) between 1 and position('apply_xml_purchase_cost' in prosrc)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'classify_payable_item' and p.pronargs = 7),
  'a classificação trava o fornecedor antes do insumo, na mesma ordem da importação: as duas não se travam');

-- 6. Classificação posterior segue a mesma regra -----------------------------

select lives_ok(
  pg_temp.importar_sql(20, '2026-09-07', 13,
    jsonb_build_array(jsonb_set(pg_temp.item(1, null, 12, null, 1), '{mapping_status}', '"pendente"')),
    pg_temp.totais(12, 13, 1)),
  'item com ST pode entrar pendente de classificação');
select lives_ok(
  format($q$select public.classify_payable_item(%L::uuid, '99300000-0000-4000-8000-0000000000d1'::uuid, 'simple', 2, 2, false, true)$q$,
    (select id from public.payable_purchase_items where purchase_id = pg_temp.compra(20))),
  'item pendente é classificado depois');
select is(pg_temp.custo('99300000-0000-4000-8000-0000000000d1'), 6.50::numeric,
  'a classificação posterior também inclui o ST no custo: (12 + 1) / 2');
select is((select normalized_unit_cost from public.payable_purchase_items where purchase_id = pg_temp.compra(20)),
  6.5::numeric, 'o custo unitário do item classificado depois inclui o ST');

select lives_ok(
  pg_temp.importar_sql(21, '2026-08-01', 30,
    jsonb_build_array(jsonb_set(pg_temp.item(1, null, 30, null), '{mapping_status}', '"pendente"')),
    pg_temp.totais(30, 30)),
  'item de nota antiga entra pendente');
select lives_ok(
  format($q$select public.classify_payable_item(%L::uuid, '99300000-0000-4000-8000-0000000000d1'::uuid, 'simple', 3, 3, false, true)$q$,
    (select id from public.payable_purchase_items where purchase_id = pg_temp.compra(21))),
  'item de nota antiga é classificado depois');
select is(pg_temp.custo('99300000-0000-4000-8000-0000000000d1'), 6.50::numeric,
  'classificar item de nota antiga não troca o custo de nota mais recente');
select is((select cost_applied from public.payable_purchase_items where purchase_id = pg_temp.compra(21)),
  false, 'o item classificado da nota antiga registra que não trocou o custo');

-- 7. Confirmar rascunho confere total e fornecedor ---------------------------

create temporary table rascunho as
select public.save_xml_import_draft(
  pg_temp.chave(22), '99300000-0000-4000-8000-0000000000f1'::uuid, '[TESTE] Fornecedor custo com impostos',
  '22', '1', '2026-09-08', 13.00, '<NFe/>', '[]'::jsonb, '[]'::jsonb) as id;

create function pg_temp.confirmar_sql(p_total numeric, p_supplier uuid) returns text
language sql stable as $$
  select format(
    $q$select public.confirm_xml_import_draft(%L::uuid, %L::timestamptz, %L::uuid, %L, %L::uuid, '22', '1', '2026-09-08', 'boleto', %s, '', %L::jsonb, %L::jsonb, %L::jsonb)$q$,
    (select id from rascunho),
    (select updated_at from public.payable_import_drafts where id = (select id from rascunho)),
    pg_temp.pedido(22), pg_temp.chave(22), p_supplier, p_total,
    jsonb_build_array(pg_temp.item(1, '99300000-0000-4000-8000-0000000000d2', 12, 4, 1)),
    jsonb_build_array(jsonb_build_object('installment_number', 1, 'due_date', '2026-10-10', 'amount', p_total)),
    pg_temp.totais(12, p_total, 1)
  )
$$;

select throws_ok(
  pg_temp.confirmar_sql(14.00, '99300000-0000-4000-8000-0000000000f1'),
  '22023', 'O total enviado não é o do rascunho aberto. Recarregue e confira de novo.',
  'a confirmação não troca o total da nota que foi salva');
select throws_ok(
  pg_temp.confirmar_sql(13.00, '99300000-0000-4000-8000-0000000000f2'),
  '22023', 'O fornecedor escolhido não é o que foi salvo no rascunho. Salve a importação de novo antes de confirmar.',
  'a confirmação não troca o fornecedor que foi salvo');
select lives_ok(
  pg_temp.confirmar_sql(13.00, '99300000-0000-4000-8000-0000000000f1'),
  'o rascunho confirmado com total e fornecedor salvos vira conta, com a composição conferida');
select is(pg_temp.custo('99300000-0000-4000-8000-0000000000d2'), 3.25::numeric,
  'o rascunho confirmado aplica o custo com o ST: (12 + 1) / 4');
select is((select status from public.payable_import_drafts where id = (select id from rascunho)),
  'confirmada', 'o rascunho fica confirmado');

-- 8. Permissão efetiva pela Data API -----------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '99300000-0000-4000-8000-00000000000b', true);

select throws_ok(
  $$select public.create_xml_payable(
      '99300000-0000-4000-8000-000000000098'::uuid, '35260999300000000000550010000000000000000098',
      '99300000-0000-4000-8000-0000000000f1'::uuid, '98', '1', '2026-09-01', 'boleto', 11, '',
      '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$$,
  '42501', 'Sem permissão para importar XML.',
  'Vendas JA não importa NF-e com composição fiscal');

select set_config('request.jwt.claim.sub', '99300000-0000-4000-8000-00000000000a', true);

select lives_ok(
  $$select public.create_xml_payable(
      '99300000-0000-4000-8000-000000000099'::uuid, '35260999300000000000550010000000000000000099',
      '99300000-0000-4000-8000-0000000000f1'::uuid, '99', '1', '2026-09-01', 'boleto', 11, '',
      '[{"line_number":1,"supplier_product_code":"CUSTO-API","supplier_ean":null,"source_description":"[TESTE] ITEM API",
         "source_unit":"KG","source_quantity":1,"product_id":"99300000-0000-4000-8000-0000000000d4",
         "conversion_basis":"simple","conversion_factor":2,"usable_quantity":2,"line_total":10,"unit_price":10,
         "discount_value":0,"factor_confirmed":true,"remember_conversion":false,"mapping_status":"mapeado",
         "fiscal_gross_value":10,"icms_st":0,"fcp_st":0,"ipi":1,"ipi_returned":0,"freight":0,"insurance":0,
         "other_expenses":0,"import_tax":0,"icms_exempt":0,"deducts_exemption":null,"composes_total":"1"}]'::jsonb,
      '[{"installment_number":1,"due_date":"2026-10-10","amount":11}]'::jsonb,
      '{"products":10,"discounts":0,"icms_st":0,"fcp_st":0,"ipi":1,"ipi_returned":0,"freight":0,"insurance":0,
        "other_expenses":0,"import_tax":0,"icms_exempt":0,"services":0,"total":11}'::jsonb)$$,
  'Financeiro JC importa NF-e com IPI pela Data API, com o papel authenticated');

reset role;

select is((select cost_price from public.products where id = '99300000-0000-4000-8000-0000000000d4'), 5.50::numeric,
  'o custo importado pela Data API inclui o IPI: (10 + 1) / 2');

select * from finish();
rollback;
