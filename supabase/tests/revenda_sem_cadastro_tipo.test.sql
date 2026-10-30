-- Revenda sem cadastro, fase 2: o item de NF-e fora do cadastro ganha o tipo
-- (uso ou despesa, ou revenda) no item da conta e na memória do fornecedor.
-- Importação direta e por rascunho, classificação depois, memória por tipo,
-- convivência com o site anterior (sem o tipo), gatilho, consumo semanal com a
-- revenda em linha própria e quem pode o quê.
begin;
create extension if not exists pgtap with schema extensions;

select plan(68);

-- Estrutura e grants ---------------------------------------------------------

select ok(exists(select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'payable_purchase_items' and column_name = 'non_catalog_kind'),
  'item da conta guarda o tipo do item fora do cadastro');
select is((select is_nullable || ':' || coalesce(column_default, '') from information_schema.columns
  where table_schema = 'public' and table_name = 'payable_non_catalog_mappings' and column_name = 'non_catalog_kind'),
  'NO:''uso_despesa''::text', 'memória do fornecedor sempre tem tipo; a que já existia é uso ou despesa');
select ok((select pg_get_constraintdef(oid) ilike '%revenda%' from pg_constraint
  where conname = 'payable_purchase_items_non_catalog_kind_check'),
  'o check do item aceita uso ou despesa e revenda');
select ok(exists(select 1 from pg_trigger
  where tgrelid = 'public.payable_purchase_items'::regclass and tgname = 'normalizar_tipo_fora_do_cadastro' and not tgisinternal),
  'gatilho normaliza o tipo também para os gravadores que não o conhecem');
select ok(not has_function_privilege('authenticated', 'private.normalizar_tipo_fora_do_cadastro()', 'execute'),
  'a função do gatilho fica fora da Data API');
select is((select count(*)::int from public.payable_purchase_items where mapping_status = 'nao_aplicavel' and non_catalog_kind is null),
  0, 'nenhum item fora do cadastro ficou sem tipo (os antigos viraram uso ou despesa)');
select is((select count(*)::int from public.payable_purchase_items where mapping_status <> 'nao_aplicavel' and non_catalog_kind is not null),
  0, 'item ligado a produto ou pendente nunca tem tipo');

select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'classify_payable_item_without_product'),
  1, 'uma só classificação sem produto: o PostgREST nunca vê duas candidatas');
select ok(has_function_privilege('authenticated', 'public.classify_payable_item_without_product(uuid, boolean, text)', 'execute'),
  'Financeiro classifica com o tipo, mediante validação interna');
select ok(not has_function_privilege('anon', 'public.classify_payable_item_without_product(uuid, boolean, text)', 'execute'),
  'anon não classifica');
select ok(has_function_privilege('authenticated', 'public.inventory_consumption_periods(text)', 'execute'),
  'resumo do consumo recriado continua executável por autenticado');
select ok(not has_function_privilege('anon', 'public.inventory_consumption_periods(text)', 'execute'),
  'anon não lê o resumo do consumo');
select ok(has_function_privilege('authenticated', 'public.inventory_consumption_resale_items(text, uuid)', 'execute'),
  'lista de revenda sem cadastro é executável por autenticado');
select ok(not has_function_privilege('anon', 'public.inventory_consumption_resale_items(text, uuid)', 'execute'),
  'anon não lê a revenda sem cadastro');

-- Espaço de trabalho limpo, como em consumo_semanal_insumos.test.sql: o
-- consumo lê todas as contagens fechadas e todas as notas da JC.
delete from public.payable_import_drafts
 where purchase_id in (select id from public.payable_purchases where store = 'jc');
delete from public.payable_import_drafts where nfe_key like '352610978%';
delete from public.payable_purchases where store = 'jc';
delete from public.inventory_weekly_counts where store = 'jc';

insert into auth.users(id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
values
  ('97800000-0000-4000-8000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','financeiro-revenda-test@example.com','x',now(),now(),now(),'{}','{}',false),
  ('97800000-0000-4000-8000-00000000000b','00000000-0000-0000-0000-000000000000','authenticated','authenticated','vendas-revenda-test@example.com','x',now(),now(),now(),'{}','{}',false),
  ('97800000-0000-4000-8000-00000000000c','00000000-0000-0000-0000-000000000000','authenticated','authenticated','expedicao-revenda-test@example.com','x',now(),now(),now(),'{}','{}',false);
insert into public.app_profiles(user_id, display_name, role, store, active, allowed_routes) values
  ('97800000-0000-4000-8000-00000000000a', 'Financeiro Revenda', 'financeiro', 'jc', true, '["/contas-pagar","/estoque"]'),
  ('97800000-0000-4000-8000-00000000000b', 'Vendas Revenda', 'vendas', 'ja', true, '["/contas-pagar"]'),
  ('97800000-0000-4000-8000-00000000000c', 'Expedicao Revenda', 'expedicao', 'jc', true, '["/estoque"]');
insert into public.app_user_permissions(user_id, permission_key, scope) values
  ('97800000-0000-4000-8000-00000000000a', 'contas_pagar.importar_xml', '*'),
  ('97800000-0000-4000-8000-00000000000a', 'contas_pagar.lancar', '*'),
  ('97800000-0000-4000-8000-00000000000a', 'contas_pagar.acessar', '*'),
  ('97800000-0000-4000-8000-00000000000c', 'estoque.contar_semanal', 'jc')
on conflict do nothing;

insert into public.suppliers(id, name, active)
values ('97800000-0000-4000-8000-0000000000f1', '[TESTE] Fornecedor revenda', true);

insert into public.products(id, name, category, active, unit, kind, cost_price) values
  ('97800000-0000-4000-8000-0000000000d1', '[TESTE] Farinha revenda contada', 'Insumos', true, 'kg', 'insumo', 2.00),
  -- Mesmo nome do item de revenda da nota: a revenda sem cadastro não o toca.
  ('97800000-0000-4000-8000-0000000000d2', '[TESTE] WHEY PROTEIN 900G', 'Insumos', true, 'un', 'insumo', 40.00);

-- Duas contagens fechadas seguidas: o período vai de 26/09 a 03/10.
insert into public.inventory_weekly_counts(id, store, week_start, status, opened_by, opened_by_name, closed_at, closed_by, closed_by_name) values
  ('97800000-0000-4000-8000-0000000000a1', 'jc', date '2026-09-21', 'fechada', '97800000-0000-4000-8000-00000000000c', 'Expedicao', timestamptz '2026-09-26 12:00-03', '97800000-0000-4000-8000-00000000000c', 'Expedicao'),
  ('97800000-0000-4000-8000-0000000000a2', 'jc', date '2026-09-28', 'fechada', '97800000-0000-4000-8000-00000000000c', 'Expedicao', timestamptz '2026-10-03 12:00-03', '97800000-0000-4000-8000-00000000000c', 'Expedicao');
insert into public.inventory_weekly_count_items(count_id, product_id, quantity, unit) values
  ('97800000-0000-4000-8000-0000000000a1', '97800000-0000-4000-8000-0000000000d1', 100, 'kg'),
  ('97800000-0000-4000-8000-0000000000a2', '97800000-0000-4000-8000-0000000000d1', 110, 'kg');

-- Importação direta ------------------------------------------------------------
-- NF A, dentro do período: revenda com IPI, uso ou despesa explícito, um item
-- fora do cadastro sem o tipo (como o site anterior manda) e um insumo contado.

set local role authenticated;
select set_config('request.jwt.claim.sub', '97800000-0000-4000-8000-00000000000a', true);

select lives_ok(
  $$select public.create_xml_payable(
      '97800000-0000-4000-8000-000000000001'::uuid, '35261097800000000000550010000000011000000011',
      '97800000-0000-4000-8000-0000000000f1'::uuid, '1', '1', '2026-09-30', 'boleto', 210, '',
      '[{"line_number":1,"supplier_product_code":"REV-WHEY","supplier_ean":null,"source_description":"[TESTE] WHEY PROTEIN 900G",
         "source_unit":"UN","source_quantity":2,"product_id":null,"conversion_basis":"simple","conversion_factor":null,
         "usable_quantity":null,"line_total":100,"unit_price":50,"discount_value":0,"factor_confirmed":false,
         "remember_conversion":true,"mapping_status":"nao_aplicavel","non_catalog_kind":"revenda",
         "fiscal_gross_value":100,"icms_st":0,"fcp_st":0,"ipi":5,"ipi_returned":0,"freight":0,"insurance":0,
         "other_expenses":0,"import_tax":0,"icms_exempt":0,"deducts_exemption":null,"composes_total":"1"},
        {"line_number":2,"supplier_product_code":"TROCA-1","supplier_ean":null,"source_description":"[TESTE] Item que muda de tipo",
         "source_unit":"UN","source_quantity":1,"product_id":null,"conversion_basis":"simple","conversion_factor":null,
         "usable_quantity":null,"line_total":20,"unit_price":20,"discount_value":0,"factor_confirmed":false,
         "remember_conversion":true,"mapping_status":"nao_aplicavel","non_catalog_kind":"uso_despesa",
         "fiscal_gross_value":20,"icms_st":0,"fcp_st":0,"ipi":0,"ipi_returned":0,"freight":0,"insurance":0,
         "other_expenses":0,"import_tax":0,"icms_exempt":0,"deducts_exemption":null,"composes_total":"1"},
        {"line_number":3,"supplier_product_code":"FRETE-1","supplier_ean":null,"source_description":"[TESTE] Taxa de entrega",
         "source_unit":"UN","source_quantity":1,"product_id":null,"conversion_basis":"simple","conversion_factor":null,
         "usable_quantity":null,"line_total":10,"unit_price":10,"discount_value":0,"factor_confirmed":false,
         "remember_conversion":false,"mapping_status":"nao_aplicavel",
         "fiscal_gross_value":10,"icms_st":0,"fcp_st":0,"ipi":0,"ipi_returned":0,"freight":0,"insurance":0,
         "other_expenses":0,"import_tax":0,"icms_exempt":0,"deducts_exemption":null,"composes_total":"1"},
        {"line_number":4,"supplier_product_code":"FAR-1","supplier_ean":null,"source_description":"[TESTE] FARINHA 25KG",
         "source_unit":"SC","source_quantity":1,"product_id":"97800000-0000-4000-8000-0000000000d1","conversion_basis":"package",
         "conversion_factor":25,"usable_quantity":25,"line_total":75,"unit_price":75,"discount_value":0,"factor_confirmed":true,
         "remember_conversion":false,"mapping_status":"mapeado",
         "fiscal_gross_value":75,"icms_st":0,"fcp_st":0,"ipi":0,"ipi_returned":0,"freight":0,"insurance":0,
         "other_expenses":0,"import_tax":0,"icms_exempt":0,"deducts_exemption":null,"composes_total":"1"}]'::jsonb,
      '[{"installment_number":1,"due_date":"2026-10-30","amount":210}]'::jsonb,
      '{"products":205,"discounts":0,"icms_st":0,"fcp_st":0,"ipi":5,"ipi_returned":0,"freight":0,"insurance":0,
        "other_expenses":0,"import_tax":0,"icms_exempt":0,"services":0,"total":210}'::jsonb)$$,
  'Financeiro importa NF-e com revenda sem cadastro, uso ou despesa e insumo');

select throws_ok(
  $$select public.create_xml_payable(
      '97800000-0000-4000-8000-000000000002'::uuid, '35261097800000000000550010000000021000000021',
      '97800000-0000-4000-8000-0000000000f1'::uuid, '2', '1', '2026-10-10', 'boleto', 30, '',
      '[{"line_number":1,"supplier_product_code":"X-1","source_description":"[TESTE] Item pendente","source_unit":"UN",
         "source_quantity":1,"product_id":null,"conversion_basis":"simple","conversion_factor":null,"usable_quantity":null,
         "line_total":30,"unit_price":30,"discount_value":0,"factor_confirmed":false,"remember_conversion":false,
         "mapping_status":"pendente","non_catalog_kind":"revenda"}]'::jsonb,
      '[{"installment_number":1,"due_date":"2026-10-30","amount":30}]'::jsonb)$$,
  '22023', 'Tipo do item fora do cadastro inválido.', 'item pendente não leva tipo');

select throws_ok(
  $$select public.create_xml_payable(
      '97800000-0000-4000-8000-000000000002'::uuid, '35261097800000000000550010000000021000000021',
      '97800000-0000-4000-8000-0000000000f1'::uuid, '2', '1', '2026-10-10', 'boleto', 30, '',
      '[{"line_number":1,"supplier_product_code":"X-1","source_description":"[TESTE] Item fora","source_unit":"UN",
         "source_quantity":1,"product_id":null,"conversion_basis":"simple","conversion_factor":null,"usable_quantity":null,
         "line_total":30,"unit_price":30,"discount_value":0,"factor_confirmed":false,"remember_conversion":false,
         "mapping_status":"nao_aplicavel","non_catalog_kind":"mercadoria"}]'::jsonb,
      '[{"installment_number":1,"due_date":"2026-10-30","amount":30}]'::jsonb)$$,
  '22023', 'Tipo do item fora do cadastro inválido.', 'tipo fora da lista é recusado');

reset role;

select is((select classification_status from public.payable_purchases where request_id = '97800000-0000-4000-8000-000000000001'),
  'completa', 'revenda sem cadastro resolve a classificação da compra');
select is((select row(mapping_status, non_catalog_kind, product_id, usable_quantity, normalized_unit_cost, category_snapshot)::text
  from public.payable_purchase_items where source_product_code = 'REV-WHEY'),
  row('nao_aplicavel', 'revenda', null::uuid, null::numeric, null::numeric, null::text)::text,
  'revenda sem cadastro: sem produto, sem quantidade útil, sem custo e sem categoria');
select is((select acquisition_value from public.payable_purchase_items where source_product_code = 'REV-WHEY'),
  105.00::numeric, 'o valor de aquisição da revenda continua inteiro, com o IPI da nota');
select is((select non_catalog_kind from public.payable_purchase_items where source_product_code = 'TROCA-1'),
  'uso_despesa', 'uso ou despesa explícito');
select is((select non_catalog_kind from public.payable_purchase_items where source_product_code = 'FRETE-1'),
  'uso_despesa', 'item fora do cadastro sem tipo (site anterior) é uso ou despesa');
select is((select non_catalog_kind from public.payable_purchase_items where source_product_code = 'FAR-1'),
  null, 'item ligado a produto não tem tipo');
select is((select sum(acquisition_value) from public.payable_purchase_items item
  join public.payable_purchases purchase on purchase.id = item.purchase_id
  where purchase.request_id = '97800000-0000-4000-8000-000000000001'),
  210.00::numeric, 'os itens fecham com o total da nota, sem omissão nem duplicidade');
select is((select cost_price from public.products where id = '97800000-0000-4000-8000-0000000000d2'),
  40.00::numeric, 'cadastro de mesmo nome não muda de custo com a revenda sem cadastro');
select is((select cost_price from public.products where id = '97800000-0000-4000-8000-0000000000d1'),
  3.00::numeric, 'o insumo da mesma nota recebe o custo normalmente (75 / 25 kg)');
select is((select non_catalog_kind || ':' || active::text from public.payable_non_catalog_mappings
  where supplier_id = '97800000-0000-4000-8000-0000000000f1' and supplier_product_code = 'REV-WHEY'),
  'revenda:true', 'a memória do fornecedor guarda que o item é revenda');
select is((select non_catalog_kind from public.payable_non_catalog_mappings
  where supplier_id = '97800000-0000-4000-8000-0000000000f1' and supplier_product_code = 'TROCA-1'),
  'uso_despesa', 'a memória de uso ou despesa continua uso ou despesa');
select is((select count(*)::int from public.payable_non_catalog_mappings
  where supplier_id = '97800000-0000-4000-8000-0000000000f1' and supplier_product_code = 'FRETE-1'),
  0, 'sem pedir para lembrar, nada é memorizado');

-- Rascunho ---------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '97800000-0000-4000-8000-00000000000a', true);

select throws_ok(
  $$select public.save_xml_import_draft('35261097800000000000550010000000031000000031',
      '97800000-0000-4000-8000-0000000000f1'::uuid, '[TESTE] Fornecedor revenda', '3', '1', '2026-10-10', 50, '<nfe/>',
      '[{"line_number":1,"product_id":null,"conversion_basis":null,"conversion_factor":null,
         "mapping_status":"pendente","factor_confirmed":false,"remember_conversion":true,"non_catalog_kind":"revenda"}]'::jsonb,
      '[]'::jsonb)$$,
  '22023', 'Tipo do item fora do cadastro inválido no rascunho.', 'rascunho não guarda tipo em item pendente');
select throws_ok(
  $$select public.save_xml_import_draft('35261097800000000000550010000000031000000031',
      '97800000-0000-4000-8000-0000000000f1'::uuid, '[TESTE] Fornecedor revenda', '3', '1', '2026-10-10', 50, '<nfe/>',
      '[{"line_number":1,"product_id":null,"conversion_basis":null,"conversion_factor":null,
         "mapping_status":"nao_aplicavel","factor_confirmed":false,"remember_conversion":true,"non_catalog_kind":"brinde"}]'::jsonb,
      '[]'::jsonb)$$,
  '22023', 'Tipo do item fora do cadastro inválido no rascunho.', 'rascunho recusa tipo fora da lista');
select lives_ok(
  $$select public.save_xml_import_draft('35261097800000000000550010000000031000000031',
      '97800000-0000-4000-8000-0000000000f1'::uuid, '[TESTE] Fornecedor revenda', '3', '1', '2026-10-10', 50, '<nfe/>',
      '[{"line_number":1,"product_id":null,"conversion_basis":null,"conversion_factor":null,
         "mapping_status":"nao_aplicavel","factor_confirmed":false,"remember_conversion":true,"non_catalog_kind":"revenda"}]'::jsonb,
      '[]'::jsonb)$$,
  'rascunho guarda o item como revenda sem cadastro');
select is((select item_decisions -> 0 ->> 'non_catalog_kind' from public.payable_import_drafts
  where nfe_key = '35261097800000000000550010000000031000000031' and status = 'pendente'),
  'revenda', 'o tipo fica no rascunho para a retomada');
select lives_ok(
  $$select public.confirm_xml_import_draft(
      (select id from public.payable_import_drafts where nfe_key = '35261097800000000000550010000000031000000031' and status = 'pendente'),
      (select updated_at from public.payable_import_drafts where nfe_key = '35261097800000000000550010000000031000000031' and status = 'pendente'),
      '97800000-0000-4000-8000-000000000003'::uuid, '35261097800000000000550010000000031000000031',
      '97800000-0000-4000-8000-0000000000f1'::uuid, '3', '1', '2026-10-10', 'boleto', 50, '',
      '[{"line_number":1,"supplier_product_code":"REV-BCAA","source_description":"[TESTE] BCAA 120 CAPS","source_unit":"UN",
         "source_quantity":1,"product_id":null,"conversion_basis":"simple","conversion_factor":null,"usable_quantity":null,
         "line_total":50,"unit_price":50,"discount_value":0,"factor_confirmed":false,"remember_conversion":true,
         "mapping_status":"nao_aplicavel","non_catalog_kind":"revenda"}]'::jsonb,
      '[{"installment_number":1,"due_date":"2026-11-10","amount":50}]'::jsonb)$$,
  'confirmar o rascunho retomado grava a revenda sem cadastro');

reset role;

select is((select non_catalog_kind from public.payable_purchase_items where source_product_code = 'REV-BCAA'),
  'revenda', 'o item confirmado pelo rascunho é revenda sem cadastro');
select is((select status from public.payable_import_drafts where nfe_key = '35261097800000000000550010000000031000000031'),
  'confirmada', 'o rascunho fecha na confirmação');

-- Classificação depois da importação --------------------------------------------
-- NF D, fora do período: três itens pendentes.

set local role authenticated;
select set_config('request.jwt.claim.sub', '97800000-0000-4000-8000-00000000000a', true);

select lives_ok(
  $$select public.create_xml_payable(
      '97800000-0000-4000-8000-000000000004'::uuid, '35261097800000000000550010000000041000000041',
      '97800000-0000-4000-8000-0000000000f1'::uuid, '4', '1', '2026-10-10', 'boleto', 60, '',
      '[{"line_number":1,"supplier_product_code":"REV-CREA","source_description":"[TESTE] CREATINA 300G","source_unit":"UN",
         "source_quantity":1,"product_id":null,"conversion_basis":"simple","conversion_factor":null,"usable_quantity":null,
         "line_total":30,"unit_price":30,"discount_value":0,"factor_confirmed":false,"remember_conversion":true,
         "mapping_status":"pendente"},
        {"line_number":2,"supplier_product_code":"TROCA-1","source_description":"[TESTE] Item que muda de tipo","source_unit":"UN",
         "source_quantity":1,"product_id":null,"conversion_basis":"simple","conversion_factor":null,"usable_quantity":null,
         "line_total":20,"unit_price":20,"discount_value":0,"factor_confirmed":false,"remember_conversion":true,
         "mapping_status":"pendente"},
        {"line_number":3,"supplier_product_code":"PAPEL-2","source_description":"[TESTE] Papel toalha","source_unit":"FD",
         "source_quantity":1,"product_id":null,"conversion_basis":"simple","conversion_factor":null,"usable_quantity":null,
         "line_total":10,"unit_price":10,"discount_value":0,"factor_confirmed":false,"remember_conversion":true,
         "mapping_status":"pendente"}]'::jsonb,
      '[{"installment_number":1,"due_date":"2026-11-10","amount":60}]'::jsonb)$$,
  'nota com itens pendentes para classificar depois');

select throws_ok(
  $$select public.classify_payable_item_without_product(
      (select id from public.payable_purchase_items where source_product_code = 'PAPEL-2'), false, 'mercadoria')$$,
  '22023', 'Tipo do item fora do cadastro inválido.', 'classificação recusa tipo fora da lista');
select lives_ok(
  $$select public.classify_payable_item_without_product(
      (select id from public.payable_purchase_items where source_product_code = 'REV-CREA'), true, 'revenda')$$,
  'pendente vira revenda sem cadastro');
select lives_ok(
  $$select public.classify_payable_item_without_product(
      (select id from public.payable_purchase_items where source_product_code = 'REV-CREA'), true, 'revenda')$$,
  'repetir a mesma escolha (duplo toque) não é erro');
select throws_ok(
  $$select public.classify_payable_item_without_product(
      (select id from public.payable_purchase_items where source_product_code = 'REV-CREA'), true)$$,
  '22023', 'Este item já foi classificado como revenda sem cadastro. Recarregue os itens pendentes.',
  'o site anterior não transforma revenda em uso ou despesa');
select lives_ok(
  $$select public.classify_payable_item_without_product(
      (select id from public.payable_purchase_items where source_product_code = 'TROCA-1' and mapping_status = 'pendente'), true, 'revenda')$$,
  'item que era lembrado como uso ou despesa é classificado como revenda');
-- Chamada do site anterior: só os dois parâmetros, pelo nome, como o PostgREST.
select lives_ok(
  $$select public.classify_payable_item_without_product(
      p_item_id := (select id from public.payable_purchase_items where source_product_code = 'PAPEL-2'),
      p_remember_decision := true)$$,
  'o site anterior continua classificando como uso ou despesa');

reset role;

select is((select row(mapping_status, non_catalog_kind, product_id)::text
  from public.payable_purchase_items where source_product_code = 'REV-CREA'),
  row('nao_aplicavel', 'revenda', null::uuid)::text, 'o item classificado depois é revenda sem cadastro');
select is((select non_catalog_kind from public.payable_purchase_items where source_product_code = 'PAPEL-2'),
  'uso_despesa', 'a classificação de dois parâmetros grava uso ou despesa');
select is((select classification_status from public.payable_purchases where request_id = '97800000-0000-4000-8000-000000000004'),
  'completa', 'sem pendência, a compra fica completa');
select is((select details ->> 'non_catalog_kind' from public.payable_events event
  join public.payable_purchase_items item on item.purchase_id = event.purchase_id and (event.details ->> 'item_id')::uuid = item.id
  where item.source_product_code = 'REV-CREA' and event.event_type = 'corrigida'),
  'revenda', 'o histórico da conta registra o tipo escolhido');
select is((select non_catalog_kind || ':' || active::text from public.payable_non_catalog_mappings
  where supplier_id = '97800000-0000-4000-8000-0000000000f1' and supplier_product_code = 'REV-CREA'),
  'revenda:true', 'a classificação depois também lembra a revenda');
select is((select string_agg(non_catalog_kind, ',') from public.payable_non_catalog_mappings
  where supplier_id = '97800000-0000-4000-8000-0000000000f1' and supplier_product_code = 'TROCA-1'),
  'revenda', 'a memória do item troca de tipo na mesma linha, sem duas respostas');
select is((select non_catalog_kind from public.payable_non_catalog_mappings
  where supplier_id = '97800000-0000-4000-8000-0000000000f1' and supplier_product_code = 'PAPEL-2'),
  'uso_despesa', 'a memória gravada pelo site anterior é uso ou despesa');

-- Foto das memórias da correção de notas ---------------------------------------
select is((select private.memorias_do_item_nfe(id) -> 0 ->> 'kind' from public.payable_purchase_items
  where source_product_code = 'REV-CREA'),
  'revenda', 'a foto da memória diz que a próxima nota sugere revenda');
select is((select private.memorias_do_item_nfe(id) -> 0 ->> 'kind' from public.payable_purchase_items
  where source_product_code = 'PAPEL-2'),
  'uso_despesa', 'a foto da memória de uso ou despesa não muda');

-- Gatilho: gravadores que não conhecem o tipo -----------------------------------
-- Como a correção de notas (fase 3) e os gravadores antigos: só a situação.
update public.payable_purchase_items
set mapping_status = 'mapeado', product_id = '97800000-0000-4000-8000-0000000000d2'
where source_product_code = 'REV-CREA';
select is((select non_catalog_kind from public.payable_purchase_items where source_product_code = 'REV-CREA'),
  null, 'item que sai de fora do cadastro perde o tipo');
update public.payable_purchase_items
set mapping_status = 'nao_aplicavel', product_id = null
where source_product_code = 'REV-CREA';
select is((select non_catalog_kind from public.payable_purchase_items where source_product_code = 'REV-CREA'),
  'uso_despesa', 'item que volta para fora do cadastro sem tipo é uso ou despesa, como sempre foi');
select throws_ok(
  $$update public.payable_purchase_items set non_catalog_kind = 'revenda' where source_product_code = 'FAR-1'$$,
  '23514', null, 'tipo escrito de propósito em item ligado a produto é recusado, não apagado');
select throws_ok(
  $$update public.payable_purchase_items set non_catalog_kind = 'brinde' where source_product_code = 'FRETE-1'$$,
  '23514', null, 'tipo fora da lista é recusado pelo banco');

-- Consumo semanal -----------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '97800000-0000-4000-8000-00000000000a', true);

select is((select count(*)::int from public.inventory_consumption_periods('jc')), 1,
  'duas contagens fechadas formam um período');
select is((select purchases_total from public.inventory_consumption_periods('jc')), 210.00::numeric,
  'compras do período: só a NF A');
select is((select purchases_counted from public.inventory_consumption_periods('jc')), 75.00::numeric,
  'insumo contado');
select is((select purchases_not_stock from public.inventory_consumption_periods('jc')), 135.00::numeric,
  'fora do cadastro continua somando revenda e uso ou despesa, como o site anterior espera');
select is((select purchases_resale_no_catalog from public.inventory_consumption_periods('jc')), 105.00::numeric,
  'a parte de revenda sem cadastro aparece separada, com o IPI');
select is((select purchases_counted + purchases_outside_count + purchases_unclassified + purchases_not_stock
  from public.inventory_consumption_periods('jc')), 210.00::numeric,
  'as partes fecham com o total');
select is((select row(supplier_name, item_description, item_unit, purchases_count, quantity_purchased, value_purchased)::text
  from public.inventory_consumption_resale_items('jc', '97800000-0000-4000-8000-0000000000a2')),
  row('[TESTE] Fornecedor revenda', '[TESTE] WHEY PROTEIN 900G', 'UN', 1, 2.000::numeric, 105.00::numeric)::text,
  'a lista de revenda sem cadastro mostra o item pela descrição da nota');
select is((select count(*)::int from public.inventory_consumption_resale_items('jc', null)), 1,
  'revenda fora de qualquer período não entra na lista');
select is((select count(*)::int from public.inventory_consumption_outside_items('jc', null)), 0,
  'revenda sem cadastro não aparece entre os itens fora da contagem, que têm produto');

-- Quem não pode ------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '97800000-0000-4000-8000-00000000000b', true);
select throws_ok(
  $$select public.classify_payable_item_without_product(
      (select id from public.payable_purchase_items limit 1), true, 'revenda')$$,
  '42501', 'Sem permissão para classificar item da NF-e.', 'Vendas JA não classifica item da NF-e');
select throws_ok(
  $$select * from public.inventory_consumption_resale_items('jc', null)$$,
  '42501', 'Sem permissao para ver o consumo com custos.', 'Vendas JA não vê a revenda sem cadastro');

select set_config('request.jwt.claim.sub', '97800000-0000-4000-8000-00000000000c', true);
select throws_ok(
  $$select * from public.inventory_consumption_resale_items('jc', null)$$,
  '42501', 'Sem permissao para ver o consumo com custos.', 'Expedição que conta não vê a revenda sem cadastro');

reset role;

select * from finish();
rollback;
