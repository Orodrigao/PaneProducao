-- Fase 2 das compras por XML: importação pendente de conferência.
--
-- O que este teste protege:
--   * salvar um rascunho NUNCA cria conta a pagar, parcela nem altera cost_price;
--     só a confirmação (create_xml_payable) faz isso, e ela fecha o rascunho;
--   * o gate financeiro existe desde a criação: RLS forçada, escrita direta
--     revogada, leitura e mutação só para quem pode importar XML na JC;
--   * uma NF-e tem um único rascunho pendente: reenvio e duplo toque atualizam
--     a mesma linha, e nota já importada não vira rascunho;
--   * descartar é explícito, idempotente e recusado depois da confirmação;
--   * Vendas JA não salva, não enxerga e não descarta.

begin;
create extension if not exists pgtap with schema extensions;

select plan(55);

-- Cenário ------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('97000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'financeiro-rascunho-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'vendas-rascunho-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97000000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin-rascunho-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('97000000-0000-4000-8000-00000000000a', 'Financeiro Rascunho', 'financeiro', 'jc', true, '[]'::jsonb),
  ('97000000-0000-4000-8000-00000000000b', 'Vendas Rascunho', 'vendas', 'ja', true, '[]'::jsonb),
  -- Administrador sem a permissão granular: passa pelo gate por papel, como em
  -- todo o Contas a pagar (private.current_user_can_payables). Decisão
  -- transversal preexistente, fixada aqui para não mudar em silêncio.
  ('97000000-0000-4000-8000-00000000000c', 'Admin Rascunho', 'admin', 'ja', true, '[]'::jsonb);

-- Como o Financeiro JC real: importa e também enxerga as contas (a leitura de
-- payable_purchases exige contas_pagar.acessar pela RLS).
insert into public.app_user_permissions (user_id, permission_key, scope)
values
  ('97000000-0000-4000-8000-00000000000a', 'contas_pagar.importar_xml', 'jc'),
  ('97000000-0000-4000-8000-00000000000a', 'contas_pagar.acessar', 'jc');

insert into public.suppliers (id, name, active)
values ('97000000-0000-4000-8000-0000000000f1', '[TESTE] Fornecedor do rascunho', true);

-- Custo conhecido antes de tudo: o rascunho não pode mexer nele.
insert into public.products (id, name, category, active, unit, kind, cost_price)
values ('97000000-0000-4000-8000-0000000000d1', '[TESTE] Farinha do rascunho', 'Insumos', true, 'kg', 'insumo', 5.50);

-- Estrutura ----------------------------------------------------------------

select has_table('public', 'payable_import_drafts', 'a tabela de rascunhos de importação existe');
select ok((select relrowsecurity and relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'payable_import_drafts'),
  'rascunhos têm RLS habilitada e forçada');
select ok(has_table_privilege('authenticated', 'public.payable_import_drafts', 'select'),
  'financeiro consulta rascunhos mediante RLS');
select ok(not has_table_privilege('authenticated', 'public.payable_import_drafts', 'insert'),
  'ninguém insere rascunho direto pela Data API');
select ok(not has_table_privilege('authenticated', 'public.payable_import_drafts', 'update'),
  'ninguém altera rascunho direto pela Data API');
select ok(not has_table_privilege('authenticated', 'public.payable_import_drafts', 'delete'),
  'ninguém apaga rascunho direto pela Data API');
select ok(not has_table_privilege('anon', 'public.payable_import_drafts', 'select'),
  'anon não consulta rascunhos');
select ok((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'payable_import_drafts_pending_key_idx')
  ilike all(array['CREATE UNIQUE INDEX%', '%(nfe_key)%', '%WHERE%pendente%']),
  'uma NF-e tem no máximo um rascunho pendente: índice único parcial por chave');
select ok((select pg_get_expr(polqual, polrelid) from pg_policy where polname = 'payable_import_drafts_select_importer')
  ilike '%contas_pagar.importar_xml%',
  'a leitura de rascunhos exige a permissão de importar XML');
select ok(has_function_privilege('authenticated', 'public.save_xml_import_draft(text, uuid, text, text, text, date, numeric, text, jsonb, jsonb)', 'execute'),
  'authenticated salva rascunho mediante validação interna');
select ok(not has_function_privilege('anon', 'public.save_xml_import_draft(text, uuid, text, text, text, date, numeric, text, jsonb, jsonb)', 'execute'),
  'anon não salva rascunho');
select ok(has_function_privilege('authenticated', 'public.discard_xml_import_draft(uuid)', 'execute'),
  'authenticated descarta rascunho mediante validação interna');
select ok(not has_function_privilege('anon', 'public.discard_xml_import_draft(uuid)', 'execute'),
  'anon não descarta rascunho');
select ok(has_function_privilege('authenticated', 'public.confirm_xml_import_draft(uuid, timestamptz, uuid, text, uuid, text, text, date, text, numeric, text, jsonb, jsonb)', 'execute'),
  'authenticated confirma rascunho retomado mediante validação interna');
select ok(not has_function_privilege('anon', 'public.confirm_xml_import_draft(uuid, timestamptz, uuid, text, uuid, text, text, date, text, numeric, text, jsonb, jsonb)', 'execute'),
  'anon não confirma rascunho');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('save_xml_import_draft', 'discard_xml_import_draft', 'confirm_xml_import_draft')
      and p.prosecdef and p.proconfig @> array['search_path=""']), 3,
  'as três RPCs rodam como donas da estrutura com search_path fechado');
select ok((select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_xml_payable')
  ilike all(array['%payable_import_drafts%', '%payable-import-draft:%']),
  'a confirmação fecha o rascunho e usa a mesma trava por chave da NF-e');

-- Comportamento: Financeiro JC ---------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-00000000000a', true);

select lives_ok(
  $$select public.save_xml_import_draft(
      '35260900000000000000550010000000097000000097',
      '97000000-0000-4000-8000-0000000000f1'::uuid, '[TESTE] Fornecedor do rascunho', '97', '1', '2026-09-10',
      100.00, '<NFe><infNFe Id="NFe35260900000000000000550010000000097000000097"/></NFe>',
      '[{"line_number":1,"product_id":"97000000-0000-4000-8000-0000000000d1","conversion_basis":"package",
         "conversion_factor":2,"mapping_status":"mapeado","factor_confirmed":true,"remember_conversion":false}]'::jsonb,
      '[{"installment_number":1,"due_date":null}]'::jsonb)$$,
  'financeiro salva o rascunho da NF-e');

select is((select status from public.payable_import_drafts where nfe_key = '35260900000000000000550010000000097000000097'),
  'pendente', 'o rascunho nasce pendente e o financeiro o enxerga pela RLS');
select is((select item_decisions -> 0 ->> 'conversion_factor' from public.payable_import_drafts
    where nfe_key = '35260900000000000000550010000000097000000097' and status = 'pendente'),
  '2', 'a decisão do item (fator 2) fica guardada no rascunho');

select is(
  (select public.save_xml_import_draft(
      '35260900000000000000550010000000097000000097',
      '97000000-0000-4000-8000-0000000000f1'::uuid, '[TESTE] Fornecedor do rascunho', '97', '1', '2026-09-10',
      100.00, '<NFe><infNFe Id="NFe35260900000000000000550010000000097000000097"/></NFe>',
      '[{"line_number":1,"product_id":null,"conversion_basis":null,
         "conversion_factor":null,"mapping_status":"nao_aplicavel","factor_confirmed":false,"remember_conversion":false}]'::jsonb,
      '[{"installment_number":1,"due_date":"2026-09-30"}]'::jsonb)),
  (select id from public.payable_import_drafts where nfe_key = '35260900000000000000550010000000097000000097' and status = 'pendente'),
  'reenviar a mesma NF-e devolve o mesmo rascunho em vez de criar outro');
select is((select item_decisions -> 0 ->> 'mapping_status' from public.payable_import_drafts
    where nfe_key = '35260900000000000000550010000000097000000097' and status = 'pendente'),
  'nao_aplicavel', 'o reenvio atualiza as decisões do rascunho');
select is((select installments -> 0 ->> 'due_date' from public.payable_import_drafts
    where nfe_key = '35260900000000000000550010000000097000000097' and status = 'pendente'),
  '2026-09-30', 'o vencimento digitado à mão fica guardado no rascunho');

select throws_ok(
  $$select public.save_xml_import_draft('chave-invalida', null, 'Fornecedor', '1', '1', '2026-09-10', 10,
      '<NFe/>', '[]'::jsonb, '[]'::jsonb)$$,
  '22023', 'Chave da NF-e inválida.', 'chave fora do padrão de 44 dígitos é recusada');
select throws_ok(
  $$select public.save_xml_import_draft('35260900000000000000550010000000097000000098', null, 'Fornecedor', '1', '1', '2026-09-10', 10,
      '<NFe/>', '[{"line_number":1,"product_id":null,"mapping_status":"mapeado"}]'::jsonb, '[]'::jsonb)$$,
  '22023', 'Item-base selecionado não existe ou está inativo.', 'item marcado como mapeado precisa de produto ativo');
select throws_ok(
  $$select public.save_xml_import_draft('35260900000000000000550010000000097000000098', null, 'Fornecedor', '1', '1', '2026-09-10', 10,
      '<NFe/>', '[{"line_number":1,"product_id":"97000000-0000-4000-8000-0000000000d1","conversion_basis":"package",
      "conversion_factor":null,"mapping_status":"mapeado","factor_confirmed":true}]'::jsonb, '[]'::jsonb)$$,
  '22023', 'Item vinculado precisa de base e fator de conversão.', 'item vinculado sem fator não vira decisão guardada');
select throws_ok(
  $$select public.save_xml_import_draft('35260900000000000000550010000000097000000098', null, 'Fornecedor', '1', '1', '2026-09-10', 10,
      '<NFe/>', '[{"line_number":1,"product_id":null,"conversion_basis":"package","conversion_factor":2,
      "mapping_status":"nao_aplicavel","factor_confirmed":false}]'::jsonb, '[]'::jsonb)$$,
  '22023', 'Item pendente ou de uso/despesa não possui conversão.', 'uso/despesa não carrega fator escondido');
select throws_ok(
  $$insert into public.payable_import_drafts (nfe_key, supplier_name, nfe_issued_at, total_value, xml_content, created_by, updated_by)
    values ('35260900000000000000550010000000097000000099', 'Direto', '2026-09-10', 10, '<NFe/>',
      '97000000-0000-4000-8000-00000000000a', '97000000-0000-4000-8000-00000000000a')$$,
  '42501', null, 'inserção direta pela Data API é negada mesmo para o financeiro');

reset role;

-- O rascunho não virou dinheiro nem custo.
select is((select count(*)::int from public.payable_purchases where nfe_key = '35260900000000000000550010000000097000000097'),
  0, 'rascunho pendente não produz linha em contas a pagar');
select is((select count(*)::int from public.payable_installments installment
    join public.payable_purchases purchase on purchase.id = installment.purchase_id
    where purchase.nfe_key = '35260900000000000000550010000000097000000097'),
  0, 'rascunho pendente não produz parcela');
select is((select cost_price from public.products where id = '97000000-0000-4000-8000-0000000000d1'),
  5.50::numeric, 'rascunho pendente não altera o cost_price do insumo');
select is((select count(*)::int from public.payable_import_drafts where nfe_key = '35260900000000000000550010000000097000000097'),
  1, 'dois envios da mesma NF-e deixam um único rascunho');

-- Comportamento: Vendas JA -------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-00000000000b', true);

select throws_ok(
  $$select public.save_xml_import_draft('35260900000000000000550010000000097000000096', null, 'Fornecedor', '1', '1', '2026-09-10', 10,
      '<NFe/>', '[]'::jsonb, '[]'::jsonb)$$,
  '42501', 'Sem permissão para importar XML.', 'Vendas JA não salva rascunho');
select is((select count(*)::int from public.payable_import_drafts), 0, 'Vendas JA não enxerga rascunho algum');
select throws_ok(
  format($$select public.discard_xml_import_draft(%L::uuid)$$,
    (select id from public.payable_import_drafts where nfe_key = '35260900000000000000550010000000097000000097' and status = 'pendente')),
  '42501', 'Sem permissão para importar XML.', 'Vendas JA não descarta rascunho');

reset role;

-- Comportamento: administrador sem concessão granular ---------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-00000000000c', true);

select lives_ok(
  $$select public.save_xml_import_draft('35260900000000000000550010000000097000000095', null, 'Fornecedor do admin', '95', '1', '2026-09-10', 10,
      '<NFe/>', '[]'::jsonb, '[]'::jsonb)$$,
  'administrador ativo salva rascunho por papel, sem concessão granular (regra de todo o Contas a pagar)');
select ok((select count(*) from public.payable_import_drafts) >= 2,
  'administrador ativo enxerga os rascunhos da JC pela RLS');

reset role;

-- Descarte -----------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-00000000000a', true);

select lives_ok(
  format($$select public.discard_xml_import_draft(%L::uuid)$$,
    (select id from public.payable_import_drafts where nfe_key = '35260900000000000000550010000000097000000097' and status = 'pendente')),
  'financeiro descarta o rascunho pendente');
select is((select status from public.payable_import_drafts where nfe_key = '35260900000000000000550010000000097000000097'),
  'descartada', 'o rascunho descartado fica registrado como descartado');
select lives_ok(
  format($$select public.discard_xml_import_draft(%L::uuid)$$,
    (select id from public.payable_import_drafts where nfe_key = '35260900000000000000550010000000097000000097')),
  'descartar de novo (duplo toque) não é erro');
select throws_ok(
  $$select public.discard_xml_import_draft('97000000-0000-4000-8000-0000000000ee'::uuid)$$,
  '22023', 'Rascunho de importação não encontrado.', 'descartar rascunho inexistente é recusado');

-- Depois do descarte, a mesma NF-e pode recomeçar do zero.
select lives_ok(
  $$select public.save_xml_import_draft(
      '35260900000000000000550010000000097000000097',
      '97000000-0000-4000-8000-0000000000f1'::uuid, '[TESTE] Fornecedor do rascunho', '97', '1', '2026-09-10',
      100.00, '<NFe><infNFe Id="NFe35260900000000000000550010000000097000000097"/></NFe>',
      '[]'::jsonb, '[]'::jsonb)$$,
  'NF-e descartada pode ganhar um rascunho novo');
select is((select count(*)::int from public.payable_import_drafts where nfe_key = '35260900000000000000550010000000097000000097' and status = 'pendente'),
  1, 'o rascunho novo é o único pendente da NF-e');

-- Confirmação --------------------------------------------------------------

-- Rascunho retomado: a versão que a tela abriu precisa ser a atual.
select throws_ok(
  format($$select public.confirm_xml_import_draft(
      %L::uuid, '2020-01-01T00:00:00Z'::timestamptz,
      '97000000-0000-4000-8000-000000000001'::uuid, '35260900000000000000550010000000097000000097',
      '97000000-0000-4000-8000-0000000000f1'::uuid, '97', '1', '2026-09-10', 'boleto', 100.00, '',
      '[{"line_number":1,"source_description":"FARINHA CAIXA 2KG","source_unit":"CX","source_quantity":1,
         "product_id":"97000000-0000-4000-8000-0000000000d1","conversion_basis":"package","conversion_factor":2,
         "usable_quantity":2,"line_total":100.00,"unit_price":100.00,"discount_value":0,"factor_confirmed":true,
         "remember_conversion":false,"mapping_status":"mapeado"}]'::jsonb,
      '[{"installment_number":1,"due_date":"2026-09-30","amount":100.00}]'::jsonb)$$,
    (select id from public.payable_import_drafts where nfe_key = '35260900000000000000550010000000097000000097' and status = 'pendente')),
  'P0001', 'Esta importação foi alterada por outra pessoa depois que você a abriu. Recarregue e confira de novo.',
  'confirmar com versão antiga do rascunho é recusado');
select is((select count(*)::int from public.payable_purchases where nfe_key = '35260900000000000000550010000000097000000097'),
  0, 'a recusa por versão antiga não deixou conta a pagar');

select lives_ok(
  format($$select public.confirm_xml_import_draft(
      %L::uuid, %L::timestamptz,
      '97000000-0000-4000-8000-000000000001'::uuid, '35260900000000000000550010000000097000000097',
      '97000000-0000-4000-8000-0000000000f1'::uuid, '97', '1', '2026-09-10', 'boleto', 100.00, '',
      '[{"line_number":1,"source_description":"FARINHA CAIXA 2KG","source_unit":"CX","source_quantity":1,
         "product_id":"97000000-0000-4000-8000-0000000000d1","conversion_basis":"package","conversion_factor":2,
         "usable_quantity":2,"line_total":100.00,"unit_price":100.00,"discount_value":0,"factor_confirmed":true,
         "remember_conversion":false,"mapping_status":"mapeado"}]'::jsonb,
      '[{"installment_number":1,"due_date":"2026-09-30","amount":100.00}]'::jsonb)$$,
    (select id from public.payable_import_drafts where nfe_key = '35260900000000000000550010000000097000000097' and status = 'pendente'),
    (select updated_at from public.payable_import_drafts where nfe_key = '35260900000000000000550010000000097000000097' and status = 'pendente')),
  'a confirmação do rascunho retomado, na versão atual, cria a conta a pagar');

select throws_ok(
  format($$select public.confirm_xml_import_draft(
      %L::uuid, %L::timestamptz,
      '97000000-0000-4000-8000-000000000009'::uuid, '35260900000000000000550010000000097000000097',
      '97000000-0000-4000-8000-0000000000f1'::uuid, '97', '1', '2026-09-10', 'boleto', 100.00, '',
      '[]'::jsonb, '[]'::jsonb)$$,
    (select id from public.payable_import_drafts where nfe_key = '35260900000000000000550010000000097000000097' and status = 'confirmada'),
    (select updated_at from public.payable_import_drafts where nfe_key = '35260900000000000000550010000000097000000097' and status = 'confirmada')),
  'P0001', 'Esta importação pendente foi descartada ou confirmada por outra pessoa. Recarregue a lista.',
  'confirmar de novo um rascunho já confirmado é recusado antes de qualquer gravação');
select is(
  (select public.create_xml_payable(
      '97000000-0000-4000-8000-000000000001'::uuid, '35260900000000000000550010000000097000000097',
      '97000000-0000-4000-8000-0000000000f1'::uuid, '97', '1', '2026-09-10', 'boleto', 100.00, '',
      '[{"line_number":1,"source_description":"FARINHA CAIXA 2KG","source_unit":"CX","source_quantity":1,
         "product_id":"97000000-0000-4000-8000-0000000000d1","conversion_basis":"package","conversion_factor":2,
         "usable_quantity":2,"line_total":100.00,"unit_price":100.00,"discount_value":0,"factor_confirmed":true,
         "remember_conversion":false,"mapping_status":"mapeado"}]'::jsonb,
      '[{"installment_number":1,"due_date":"2026-09-30","amount":100.00}]'::jsonb)),
  (select id from public.payable_purchases where nfe_key = '35260900000000000000550010000000097000000097'),
  'confirmar de novo (duplo toque) devolve a mesma conta');
select is((select count(*)::int from public.payable_purchases where nfe_key = '35260900000000000000550010000000097000000097'),
  1, 'a confirmação repetida não cria segunda conta');

select throws_ok(
  $$select public.save_xml_import_draft(
      '35260900000000000000550010000000097000000097', null, '[TESTE] Fornecedor do rascunho', '97', '1', '2026-09-10',
      100.00, '<NFe/>', '[]'::jsonb, '[]'::jsonb)$$,
  '23505', 'Esta NF-e já foi importada. A chave de acesso não pode ser repetida.',
  'NF-e já importada não vira rascunho');
select throws_ok(
  format($$select public.discard_xml_import_draft(%L::uuid)$$,
    (select id from public.payable_import_drafts where nfe_key = '35260900000000000000550010000000097000000097' and status = 'confirmada')),
  '22023', 'Esta importação já foi confirmada e virou conta a pagar; não há o que descartar.',
  'rascunho confirmado não pode ser descartado');

reset role;

-- created_at é o mesmo now() da transação para todos os rascunhos: conte por estado.
select is((select count(*)::int from public.payable_import_drafts where nfe_key = '35260900000000000000550010000000097000000097' and status = 'confirmada'),
  1, 'a confirmação marca o rascunho pendente como confirmado');
select is((select count(*)::int from public.payable_import_drafts where nfe_key = '35260900000000000000550010000000097000000097' and status = 'pendente'),
  0, 'depois da confirmação não sobra rascunho pendente da NF-e');
select is(
  (select purchase_id from public.payable_import_drafts where nfe_key = '35260900000000000000550010000000097000000097' and status = 'confirmada'),
  (select id from public.payable_purchases where nfe_key = '35260900000000000000550010000000097000000097'),
  'o rascunho confirmado aponta para a conta a pagar criada');
select is((select cost_price from public.products where id = '97000000-0000-4000-8000-0000000000d1'),
  50.00::numeric, 'só a confirmação atualiza o custo do insumo');

select * from finish();
rollback;
