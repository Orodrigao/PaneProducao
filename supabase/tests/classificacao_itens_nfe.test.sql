-- Classificação de itens da NF-e sem produto canônico e memória segura do fator.
begin;
create extension if not exists pgtap with schema extensions;

select plan(28);

select ok(exists(
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'payable_product_mappings'
    and column_name = 'factor_confirmed'),
  'memória de produto registra se o fator foi realmente confirmado');

select ok(exists(
  select 1 from information_schema.tables
  where table_schema = 'public' and table_name = 'payable_non_catalog_mappings'),
  'decisão sem produto possui memória própria por fornecedor');

select ok((
  select relrowsecurity and relforcerowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'payable_non_catalog_mappings'),
  'memória sem produto usa RLS forçada');

select ok(has_table_privilege('authenticated', 'public.payable_non_catalog_mappings', 'select'),
  'financeiro pode ler decisões sem produto mediante RLS');
select ok(not has_table_privilege('anon', 'public.payable_non_catalog_mappings', 'select'),
  'anon não lê decisões sem produto');

select ok(has_function_privilege(
  'authenticated',
  'public.classify_payable_item(uuid, uuid, text, numeric, numeric, boolean, boolean)',
  'execute'),
  'classificação posterior recebe confirmação explícita do fator');

select ok(not has_function_privilege(
  'anon',
  'public.classify_payable_item(uuid, uuid, text, numeric, numeric, boolean, boolean)',
  'execute'),
  'anon não classifica item');

select ok(has_function_privilege(
  'authenticated',
  'public.classify_payable_item_without_product(uuid, boolean)',
  'execute'),
  'financeiro pode resolver item sem produto mediante validação interna');

select ok(not has_function_privilege(
  'anon',
  'public.classify_payable_item_without_product(uuid, boolean)',
  'execute'),
  'anon não resolve item sem produto');

select ok((
  select pg_get_constraintdef(oid) ilike '%nao_aplicavel%'
  from pg_constraint
  where conname = 'payable_purchase_items_mapping_status_check'),
  'status do item distingue uso ou despesa sem produto de pendência');

select ok((select prosrc ilike '%pg_advisory_xact_lock%'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_xml_payable'),
  'memórias do mesmo fornecedor são serializadas contra importações concorrentes');

-- Cenário de comportamento -------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values (
  '96000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'financeiro-classificacao-test@example.com',
  '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
  now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values ('96000000-0000-4000-8000-00000000000a', 'Financeiro Classificação', 'financeiro', 'jc', true, '[]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope)
values
  ('96000000-0000-4000-8000-00000000000a', 'contas_pagar.importar_xml', '*'),
  ('96000000-0000-4000-8000-00000000000a', 'contas_pagar.lancar', '*'),
  ('96000000-0000-4000-8000-00000000000a', 'contas_pagar.acessar', '*');

insert into public.suppliers (id, name, active)
values ('96000000-0000-4000-8000-0000000000f1', '[TESTE] Fornecedor classificação', true);

insert into public.products (id, name, category, active, unit, kind, cost_price)
values ('96000000-0000-4000-8000-0000000000d1', '[TESTE] Gotas canônicas', 'Insumos', true, 'kg', 'insumo', 10);

set local role authenticated;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-00000000000a', true);

select lives_ok(
  $$select public.create_xml_payable(
    '96000000-0000-4000-8000-000000000001'::uuid, '35260900000000000000550010000000011000000011',
    '96000000-0000-4000-8000-0000000000f1'::uuid, '1', '1', current_date, 'boleto', 50, '',
    '[{"line_number":1,"supplier_product_code":"DET-5L","source_description":"DETERGENTE MARCA X 5L",
       "source_unit":"UN","source_quantity":1,"product_id":null,"conversion_basis":"simple",
       "conversion_factor":null,"usable_quantity":null,"line_total":50,"unit_price":50,"discount_value":0,
       "factor_confirmed":false,"remember_conversion":true,"mapping_status":"nao_aplicavel"}]'::jsonb,
    '[{"installment_number":1,"due_date":"2026-09-30","amount":50}]'::jsonb)$$,
  'uso ou despesa entra sem produto canônico');

reset role;

select is((select classification_status from public.payable_purchases where request_id = '96000000-0000-4000-8000-000000000001'),
  'completa', 'item sem produto resolve a classificação da compra');
select is((select mapping_status from public.payable_purchase_items where source_product_code = 'DET-5L'),
  'nao_aplicavel', 'item guarda a decisão sem produto');
select ok(exists(select 1 from public.payable_non_catalog_mappings where supplier_product_code = 'DET-5L' and active),
  'decisão sem produto fica lembrada para o fornecedor');
select is((select item_name from public.payable_purchase_items where source_product_code = 'DET-5L'),
  'DETERGENTE MARCA X 5L', 'nome e marca da NF-e continuam guardados');
select is((select cost_price from public.products where id = '96000000-0000-4000-8000-0000000000d1'),
  10::numeric, 'uso ou despesa não altera custo de receita');

set local role authenticated;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-00000000000a', true);

select lives_ok(
  $$select public.create_xml_payable(
    '96000000-0000-4000-8000-000000000002'::uuid, '35260900000000000000550010000000021000000021',
    '96000000-0000-4000-8000-0000000000f1'::uuid, '2', '1', current_date, 'boleto', 100, '',
    '[{"line_number":1,"supplier_product_code":"CHOC-1","source_description":"CHIPS AO LEITE",
       "source_unit":"CX","source_quantity":1,"product_id":null,"conversion_basis":"package",
       "conversion_factor":null,"usable_quantity":null,"line_total":100,"unit_price":100,"discount_value":0,
       "factor_confirmed":false,"remember_conversion":true,"mapping_status":"pendente"}]'::jsonb,
    '[{"installment_number":1,"due_date":"2026-09-30","amount":100}]'::jsonb)$$,
  'item pode entrar pendente para classificação posterior');

select throws_ok(
  $$select public.classify_payable_item(
    (select id from public.payable_purchase_items where source_product_code = 'CHOC-1'),
    '96000000-0000-4000-8000-0000000000d1'::uuid, 'package', 1, 1, true, false)$$,
  '22023', 'Confira quanto vem na embalagem: a NF-e cobra em CX e a receita usa kg.',
  'classificação posterior também bloqueia fator automático entre famílias');

select lives_ok(
  $$select public.classify_payable_item(
    (select id from public.payable_purchase_items where source_product_code = 'CHOC-1'),
    '96000000-0000-4000-8000-0000000000d1'::uuid, 'package', 1, 1, true, true)$$,
  'fator 1 explicitamente conferido pode ser correto');

reset role;

select is((select cost_price from public.products where id = '96000000-0000-4000-8000-0000000000d1'),
  100::numeric, 'produto canônico recebe o custo normalizado');
select ok(exists(select 1 from public.payable_product_mappings where supplier_product_code = 'CHOC-1' and factor_confirmed and active),
  'memória preserva a confirmação explícita do fator 1');

set local role authenticated;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-00000000000a', true);

select lives_ok(
  $$select public.create_xml_payable(
    '96000000-0000-4000-8000-000000000003'::uuid, '35260900000000000000550010000000031000000031',
    '96000000-0000-4000-8000-0000000000f1'::uuid, '3', '1', current_date, 'boleto', 30, '',
    '[{"line_number":1,"supplier_product_code":"PAPEL-1","source_description":"PAPEL TOALHA MARCA Y",
       "source_unit":"FD","source_quantity":1,"product_id":null,"conversion_basis":"package",
       "conversion_factor":null,"usable_quantity":null,"line_total":30,"unit_price":30,"discount_value":0,
       "factor_confirmed":false,"remember_conversion":true,"mapping_status":"pendente"}]'::jsonb,
    '[{"installment_number":1,"due_date":"2026-09-30","amount":30}]'::jsonb)$$,
  'item antigo pode continuar pendente até revisão');

select lives_ok(
  $$select public.classify_payable_item_without_product(
    (select id from public.payable_purchase_items where source_product_code = 'PAPEL-1'), true)$$,
  'pendência pode ser resolvida sem inventar produto');

reset role;

select is((select mapping_status from public.payable_purchase_items where source_product_code = 'PAPEL-1'),
  'nao_aplicavel', 'resolução posterior guarda o status sem produto');
select ok(exists(select 1 from public.payable_non_catalog_mappings where supplier_product_code = 'PAPEL-1' and active),
  'resolução posterior também fica lembrada');
select is((select classification_status from public.payable_purchases where request_id = '96000000-0000-4000-8000-000000000003'),
  'completa', 'última pendência resolvida fecha a classificação da compra');
select is((select cost_price from public.products where id = '96000000-0000-4000-8000-0000000000d1'),
  100::numeric, 'resolver pendência sem produto não mexe no último custo válido');

select * from finish();
rollback;
