begin;
create extension if not exists pgtap with schema extensions;

select plan(15);

select ok(exists(select 1 from public.app_permissions where key = 'contas_pagar.importar_xml'),
  'permissao de importar XML existe');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payable_purchases' and column_name = 'nfe_key'),
  'conta guarda a chave da NF-e');
select ok(exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'payable_purchases_nfe_key_unique_idx'),
  'chave da NF-e tem bloqueio de duplicidade');
select ok((select relrowsecurity and relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'payable_product_mappings'),
  'mapeamentos de fornecedor têm RLS forcada');
select ok(has_table_privilege('authenticated', 'public.payable_product_mappings', 'select'),
  'financeiro pode consultar os últimos mapeamentos mediante RLS');
select ok(not has_table_privilege('anon', 'public.payable_product_mappings', 'select'),
  'anon não consulta mapeamentos');
select ok(has_function_privilege('authenticated', 'public.create_xml_payable(uuid, text, uuid, text, text, date, text, numeric, text, jsonb, jsonb)', 'execute'),
  'authenticated chama importação XML mediante validação interna');
select ok(not has_function_privilege('anon', 'public.create_xml_payable(uuid, text, uuid, text, text, date, text, numeric, text, jsonb, jsonb)', 'execute'),
  'anon não chama importação XML');
select ok(has_function_privilege('authenticated', 'public.classify_payable_item(uuid, uuid, text, numeric, numeric, boolean)', 'execute'),
  'authenticated classifica item mediante validação interna');
select ok(not has_function_privilege('anon', 'public.classify_payable_item(uuid, uuid, text, numeric, numeric, boolean)', 'execute'),
  'anon não classifica item');
select ok(has_function_privilege('authenticated', 'public.create_payable_catalog_product(text, text, text)', 'execute'),
  'authenticated cadastra item inline mediante validação interna');
select ok(not has_function_privilege('anon', 'public.create_payable_catalog_product(text, text, text)', 'execute'),
  'anon não cadastra item inline');
select ok((select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_xml_payable') ilike all(array['%nfe_key%', '%request_id%', '%installments%', '%classification_status%']),
  'importação valida idempotência, parcelas e pendências');
select ok((select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'classify_payable_item') ilike all(array['%usable_quantity%', '%cost_price%', '%mapping_status%']),
  'classificação recalcula quantidade útil e custo');
select ok(exists(select 1 from pg_constraint where conname = 'payable_purchases_classification_status_check'),
  'status de classificação é restrito');

select * from finish();
rollback;
