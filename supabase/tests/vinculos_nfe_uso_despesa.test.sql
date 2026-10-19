begin;
create extension if not exists pgtap with schema extensions;
select plan(77);

-- Vínculos de NF-e, fase 5: item de nota entre uso ou despesa e insumo.
-- Matriz: Administrador e Financeiro autorizado (Catálogo + Contas a pagar JC)
-- corrigem; Vendas, Financeiro sem Catálogo e perfil inativo são barrados, e a
-- permissão retirada entre a prévia e a confirmação também barra. Conta paga:
-- parcelas, rateio e livro-caixa não mudam. Memória de uso ou despesa é
-- desligada só ao corrigir para um produto; desfazer não religa.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('97300000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-uso@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97300000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'elis-uso@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97300000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vendas-uso@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97300000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'financeiro-sem-catalogo-uso@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97300000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'financeiro-inativo-uso@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes) values
  ('97300000-0000-4000-8000-000000000001', 'Administrador Uso', 'admin', null, true, '["/produtos"]'::jsonb),
  ('97300000-0000-4000-8000-000000000002', 'Elis Uso', 'financeiro', 'jc', true, '["/produtos"]'::jsonb),
  ('97300000-0000-4000-8000-000000000003', 'Vendas Uso', 'vendas', 'jc', true, '["/", "/produtos"]'::jsonb),
  ('97300000-0000-4000-8000-000000000004', 'Financeiro sem Catálogo Uso', 'financeiro', 'jc', true, '["/contas-pagar"]'::jsonb),
  ('97300000-0000-4000-8000-000000000005', 'Financeiro Inativo Uso', 'financeiro', 'jc', false, '["/produtos"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope) values
  ('97300000-0000-4000-8000-000000000002', 'contas_pagar.acessar', 'jc'),
  ('97300000-0000-4000-8000-000000000003', 'contas_pagar.acessar', 'jc'),
  ('97300000-0000-4000-8000-000000000004', 'contas_pagar.acessar', 'jc'),
  ('97300000-0000-4000-8000-000000000005', 'contas_pagar.acessar', 'jc');

insert into public.suppliers (id, name, active) values
  ('97300000-0000-4000-8000-000000000011', '[TESTE] Fornecedor uso e insumo', true);

insert into public.products (id, name, category, active, unit, kind, cost_price, is_fabricacao_propria) values
  ('97300000-0000-4000-8000-000000000021', '[TESTE] Margarina uso', 'Insumos', true, 'kg', 'insumo', 8.00, false),
  ('97300000-0000-4000-8000-000000000022', '[TESTE] Pano multiuso', 'Higiene e limpeza', true, 'un', 'insumo', 95.00, false),
  ('97300000-0000-4000-8000-000000000023', '[TESTE] Queijo ralado uso', 'Insumos', true, 'kg', 'insumo', 60.00, false),
  ('97300000-0000-4000-8000-000000000024', '[TESTE] Kit uso', 'Insumos', true, 'un', 'kit', null, false);

insert into public.payable_purchases (
  id, request_id, store, supplier_id, purchase_date, origin, document_type,
  payment_method, status, total_value, nfe_number, nfe_issued_at, classification_status, created_by
) values
  -- Margarina: nota antiga que dá o custo de referência (8,00/kg).
  ('97300000-0000-4000-8000-000000000040', '97300000-0000-4000-8000-000000000140', 'jc', '97300000-0000-4000-8000-000000000011', '2025-01-05', 'xml', 'nfe', 'boleto', 'aberta', 240, '9730040', '2025-01-05', 'completa', '97300000-0000-4000-8000-000000000001'),
  -- Conta PAGA com a margarina lançada como uso ou despesa.
  ('97300000-0000-4000-8000-000000000041', '97300000-0000-4000-8000-000000000141', 'jc', '97300000-0000-4000-8000-000000000011', '2025-01-15', 'xml', 'nfe', 'boleto', 'paga', 270, '9730041', '2025-01-15', 'completa', '97300000-0000-4000-8000-000000000001'),
  -- Pano: única nota do produto, que dá o custo.
  ('97300000-0000-4000-8000-000000000042', '97300000-0000-4000-8000-000000000142', 'jc', '97300000-0000-4000-8000-000000000011', '2025-02-10', 'xml', 'nfe', 'boleto', 'aberta', 95, '9730042', '2025-02-10', 'completa', '97300000-0000-4000-8000-000000000001'),
  -- Queijo: nota antiga (50/kg) e nota nova (60/kg, dá o custo).
  ('97300000-0000-4000-8000-000000000043', '97300000-0000-4000-8000-000000000143', 'jc', '97300000-0000-4000-8000-000000000011', '2025-02-01', 'xml', 'nfe', 'boleto', 'aberta', 50, '9730043', '2025-02-01', 'completa', '97300000-0000-4000-8000-000000000001'),
  ('97300000-0000-4000-8000-000000000044', '97300000-0000-4000-8000-000000000144', 'jc', '97300000-0000-4000-8000-000000000011', '2025-02-20', 'xml', 'nfe', 'boleto', 'aberta', 60, '9730044', '2025-02-20', 'completa', '97300000-0000-4000-8000-000000000001'),
  ('97300000-0000-4000-8000-000000000045', '97300000-0000-4000-8000-000000000145', 'jc', '97300000-0000-4000-8000-000000000011', '2025-02-21', 'xml', 'nfe', 'boleto', 'aberta', 20, '9730045', '2025-02-21', 'pendente', '97300000-0000-4000-8000-000000000001'),
  ('97300000-0000-4000-8000-000000000046', '97300000-0000-4000-8000-000000000146', 'jc', '97300000-0000-4000-8000-000000000011', '2025-02-22', 'xml', 'nfe', 'boleto', 'cancelada', 10, '9730046', '2025-02-22', 'completa', '97300000-0000-4000-8000-000000000001');

insert into public.payable_purchase_items (
  id, purchase_id, product_id, item_name, unit, quantity, unit_price, source_product_code,
  source_description, source_unit, source_quantity, conversion_basis, conversion_factor,
  usable_quantity, normalized_unit_cost, category_snapshot, mapping_status, cost_applied, mapping_confirmed_by
) values
  ('97300000-0000-4000-8000-000000000060', '97300000-0000-4000-8000-000000000040', '97300000-0000-4000-8000-000000000021', '[TESTE] Margarina uso', 'kg', 1, 240, 'MARG30', 'MARGARINA CX 30KG', 'CX', 1, 'package', 30, 30, 8, 'Insumos', 'mapeado', true, '97300000-0000-4000-8000-000000000001'),
  -- O item errado: margarina como uso ou despesa, numa conta paga.
  ('97300000-0000-4000-8000-000000000061', '97300000-0000-4000-8000-000000000041', null, 'MARGARINA CX 30KG', 'CX', 1, 270, 'MARG30', 'MARGARINA CX 30KG', 'CX', 1, null, null, null, null, null, 'nao_aplicavel', null, '97300000-0000-4000-8000-000000000001'),
  -- Nome e categoria gravados antes de o cadastro mudar: o desfazer volta a foto, não o cadastro de hoje.
  ('97300000-0000-4000-8000-000000000062', '97300000-0000-4000-8000-000000000042', '97300000-0000-4000-8000-000000000022', 'PANO NOME ANTIGO', 'un', 1, 95, 'PANO', 'PANO MULTIUSO ROLAO', 'UN', 1, 'simple', 1, 1, 95, 'Limpeza antiga', 'mapeado', true, '97300000-0000-4000-8000-000000000001'),
  ('97300000-0000-4000-8000-000000000063', '97300000-0000-4000-8000-000000000043', '97300000-0000-4000-8000-000000000023', '[TESTE] Queijo ralado uso', 'kg', 1, 50, 'QR', 'QUEIJO RALADO KG', 'KG', 1, 'simple', 1, 1, 50, 'Insumos', 'mapeado', false, '97300000-0000-4000-8000-000000000001'),
  ('97300000-0000-4000-8000-000000000064', '97300000-0000-4000-8000-000000000044', '97300000-0000-4000-8000-000000000023', '[TESTE] Queijo ralado uso', 'kg', 1, 60, 'QR', 'QUEIJO RALADO KG', 'KG', 1, 'simple', 1, 1, 60, 'Insumos', 'mapeado', true, '97300000-0000-4000-8000-000000000001'),
  ('97300000-0000-4000-8000-000000000065', '97300000-0000-4000-8000-000000000045', null, 'PENDENTE', 'KG', 1, 10, 'PEN', 'PENDENTE', 'KG', 1, null, null, null, null, null, 'pendente', null, null),
  ('97300000-0000-4000-8000-000000000066', '97300000-0000-4000-8000-000000000045', null, 'DETERGENTE', 'UN', 1, 10, 'DET', 'DETERGENTE', 'UN', 1, null, null, null, null, null, 'nao_aplicavel', null, '97300000-0000-4000-8000-000000000001'),
  ('97300000-0000-4000-8000-000000000067', '97300000-0000-4000-8000-000000000046', null, 'ESPONJA', 'UN', 1, 10, 'ESP', 'ESPONJA', 'UN', 1, null, null, null, null, null, 'nao_aplicavel', null, '97300000-0000-4000-8000-000000000001');

-- Conta paga: parcela com R$ 5 de juros, rateio em CMV e lançamentos no livro
-- gerados pela função oficial da baixa.
insert into public.payable_installments (id, purchase_id, installment_number, due_date, amount, status, paid_date, paid_amount, paid_method)
values ('97300000-0000-4000-8000-000000000071', '97300000-0000-4000-8000-000000000041', 1, '2025-01-20', 270, 'paga', '2025-01-22', 275, 'boleto');
insert into public.payable_purchase_categories (purchase_id, category_id, amount)
select '97300000-0000-4000-8000-000000000041', category.id, 270
from public.finance_categories category where category.key = 'cmv_materia_prima';
select private.sync_payable_finance_entries('97300000-0000-4000-8000-000000000071', '97300000-0000-4000-8000-000000000001', null);

-- Memórias ligadas: a margarina como uso ou despesa e o pano como insumo.
insert into public.payable_non_catalog_mappings (
  id, supplier_id, supplier_product_code, supplier_ean, supplier_description, purchase_unit, active, last_confirmed_by
) values (
  '97300000-0000-4000-8000-000000000081', '97300000-0000-4000-8000-000000000011', 'MARG30', null,
  'MARGARINA CX 30KG', 'CX', true, '97300000-0000-4000-8000-000000000001'
);
insert into public.payable_product_mappings (
  id, supplier_id, supplier_product_code, supplier_ean, supplier_description, purchase_unit,
  base_product_id, base_unit, conversion_basis, conversion_factor, factor_confirmed, active, last_confirmed_by
) values (
  '97300000-0000-4000-8000-000000000082', '97300000-0000-4000-8000-000000000011', 'PANO', null,
  'PANO MULTIUSO ROLAO', 'UN', '97300000-0000-4000-8000-000000000022', 'un', 'simple', 1, true, true,
  '97300000-0000-4000-8000-000000000001'
);

-- Duas contagens fechadas: semana de 06/01/2025 (sábado 11/01) e de 13/01/2025
-- (sábado 18/01). A margarina da conta paga (15/01) cai nesse período.
insert into public.inventory_weekly_counts (id, store, week_start, status, opened_by, opened_by_name, closed_at, closed_by, closed_by_name) values
  ('97300000-0000-4000-8000-000000000091', 'jc', '2025-01-06', 'fechada', '97300000-0000-4000-8000-000000000001', 'Administrador Uso', '2025-01-11 15:00+00', '97300000-0000-4000-8000-000000000001', 'Administrador Uso'),
  ('97300000-0000-4000-8000-000000000092', 'jc', '2025-01-13', 'fechada', '97300000-0000-4000-8000-000000000001', 'Administrador Uso', '2025-01-18 15:00+00', '97300000-0000-4000-8000-000000000001', 'Administrador Uso'),
  ('97300000-0000-4000-8000-000000000093', 'jc', '2025-01-20', 'fechada', '97300000-0000-4000-8000-000000000001', 'Administrador Uso', '2025-01-25 15:00+00', '97300000-0000-4000-8000-000000000001', 'Administrador Uso');
insert into public.inventory_weekly_count_items (count_id, product_id, quantity, unit) values
  ('97300000-0000-4000-8000-000000000091', '97300000-0000-4000-8000-000000000021', 10, 'kg'),
  ('97300000-0000-4000-8000-000000000092', '97300000-0000-4000-8000-000000000021', 25, 'kg'),
  ('97300000-0000-4000-8000-000000000093', '97300000-0000-4000-8000-000000000021', 20, 'kg');

create temporary table livro_antes on commit drop as
select entry.id, entry.category_id, entry.amount, entry.competence_month, entry.reversed_at
from public.finance_entries entry
where entry.source = 'contas_pagar' and entry.source_ref = '97300000-0000-4000-8000-000000000071';
grant select on livro_antes to authenticated;

create temporary table valores_antes on commit drop as
select item.id, item.quantity, item.line_total
from public.payable_purchase_items item
where item.purchase_id::text like '97300000-0000-4000-8000-0000000000%';

-- Estrutura -----------------------------------------------------------------

select ok(not has_function_privilege('authenticated', 'private.memorias_do_item_nfe(uuid)', 'execute'),
  'memórias do item ficam fora da Data API');
select ok(not has_function_privilege('authenticated', 'private.situacao_financeira_compra_nfe(uuid)', 'execute'),
  'situação financeira da conta fica fora da Data API');
select ok(not has_function_privilege('authenticated', 'private.consumo_semanal_dos_produtos_nfe(uuid[])', 'execute'),
  'consumo dos produtos fica fora da Data API');
select ok(not has_function_privilege('anon', 'public.correct_payable_purchase_items(uuid, text, jsonb, uuid, text)', 'execute'),
  'perfil anônimo continua sem a correção de notas');
select is((select count(*)::int from livro_antes where reversed_at is null), 2,
  'a conta paga começa com principal e juros no livro');

set local role authenticated;

-- Barrados --------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '97300000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97300000-0000-4000-8000-000000000061","product_id":"97300000-0000-4000-8000-000000000021","conversion_factor":30}]')$$,
  '42501', 'Sem permissão para corrigir itens de NF-e.', 'Vendas é barrada');
select set_config('request.jwt.claim.sub', '97300000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97300000-0000-4000-8000-000000000061","product_id":"97300000-0000-4000-8000-000000000021","conversion_factor":30}]')$$,
  '42501', 'Sem permissão para corrigir itens de NF-e.', 'Financeiro sem o Catálogo é barrado');
select set_config('request.jwt.claim.sub', '97300000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97300000-0000-4000-8000-000000000061","product_id":"97300000-0000-4000-8000-000000000021","conversion_factor":30}]')$$,
  '42501', 'Sem permissão para corrigir itens de NF-e.', 'perfil inativo é barrado');

-- Contrato do pedido ----------------------------------------------------------

select set_config('request.jwt.claim.sub', '97300000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97300000-0000-4000-8000-000000000062","conversion_factor":null}]')$$,
  '22023', 'Pedido de correção com item inválido.', 'produto ausente não vira uso ou despesa');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97300000-0000-4000-8000-000000000062","product_id":null}]')$$,
  '22023', 'Pedido de correção com item inválido.', 'fator ausente é recusado');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97300000-0000-4000-8000-000000000062","product_id":"","conversion_factor":1}]')$$,
  '22023', 'Pedido de correção com item inválido.', 'produto vazio é recusado');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97300000-0000-4000-8000-000000000062","product_id":123,"conversion_factor":1}]')$$,
  '22023', 'Pedido de correção com item inválido.', 'produto numérico é recusado');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97300000-0000-4000-8000-000000000062","product_id":null,"conversion_factor":1}]')$$,
  '22023', 'Item de uso ou despesa não tem fator: envie o fator vazio.', 'uso ou despesa com fator é recusado');

-- Recusas ---------------------------------------------------------------------

select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97300000-0000-4000-8000-000000000066","product_id":null,"conversion_factor":null}]')$$,
  '22023', 'A correção não muda nada em um dos itens.', 'uso ou despesa para uso ou despesa é recusado');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97300000-0000-4000-8000-000000000065","product_id":"97300000-0000-4000-8000-000000000021","conversion_factor":1}]')$$,
  '22023', 'Item sem classificação: classifique em Contas a pagar.', 'item pendente é recusado');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97300000-0000-4000-8000-000000000065","product_id":null,"conversion_factor":null}]')$$,
  '22023', 'Item sem classificação: classifique em Contas a pagar.', 'item pendente não vira uso ou despesa aqui');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97300000-0000-4000-8000-000000000067","product_id":"97300000-0000-4000-8000-000000000021","conversion_factor":1}]')$$,
  '22023', 'Item de conta cancelada não é corrigido.', 'item de conta cancelada é recusado');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97300000-0000-4000-8000-000000000066","product_id":"97300000-0000-4000-8000-000000000024","conversion_factor":1}]')$$,
  '22023', 'Escolha um produto ativo que se compra: insumo ou revenda, sem kit nem fabricação própria.',
  'uso ou despesa não vai para kit');

-- Uso ou despesa -> insumo, prévia: mostra tudo e não grava nada --------------

select set_config('teste.p1', public.correct_payable_purchase_items(null, 'previa',
  '[{"item_id":"97300000-0000-4000-8000-000000000061","product_id":"97300000-0000-4000-8000-000000000021","conversion_factor":30}]')::text, true);

select results_eq(
  $$select entry -> 'before' ->> 'mapping_status', entry -> 'after' ->> 'mapping_status',
           entry -> 'after' ->> 'product_id', (entry -> 'after' ->> 'usable_quantity')::numeric,
           (entry -> 'after' ->> 'normalized_unit_cost')::numeric, entry -> 'after' ->> 'conversion_basis'
    from jsonb_array_elements(current_setting('teste.p1')::jsonb -> 'impact' -> 'items') entry$$,
  $$values ('nao_aplicavel', 'mapeado', '97300000-0000-4000-8000-000000000021', 30::numeric, 9::numeric, 'package')$$,
  'prévia: margarina sai de uso ou despesa e entra no insumo com 30 kg a 9,00/kg');
select results_eq(
  $$select (entry ->> 'cost_before')::numeric, (entry ->> 'cost_after')::numeric
    from jsonb_array_elements(current_setting('teste.p1')::jsonb -> 'impact' -> 'products') entry$$,
  $$values (8.00::numeric, 9.00::numeric)$$,
  'prévia: a nota corrigida é a mais recente e passa a dar o custo');
select is(current_setting('teste.p1')::jsonb -> 'impact' -> 'memories_off',
  '["97300000-0000-4000-8000-000000000081"]'::jsonb,
  'prévia: a memória de uso ou despesa desse item seria desligada');
select is(jsonb_array_length(current_setting('teste.p1')::jsonb -> 'impact' -> 'items' -> 0 -> 'memories_after'), 0,
  'prévia: a próxima nota desse item chega sem sugestão');
select results_eq(
  $$select entry ->> 'status', (entry ->> 'installments_paid')::int, (entry ->> 'paid_total')::numeric,
           (entry ->> 'late_fees')::numeric, entry -> 'split' -> 0 ->> 'key'
    from jsonb_array_elements(current_setting('teste.p1')::jsonb -> 'impact' -> 'purchases') entry$$,
  $$values ('paga', 1, 275::numeric, 5::numeric, 'cmv_materia_prima')$$,
  'prévia financeira: conta paga, uma parcela, R$ 5 de juros, rateio em CMV');
select is(
  (select sum((entry ->> 'amount')::numeric) from jsonb_array_elements(current_setting('teste.p1')::jsonb -> 'impact' -> 'purchases' -> 0 -> 'ledger') entry),
  275::numeric, 'prévia financeira: o livro mostra o que saiu do caixa');
select results_eq(
  $$select (entry -> 'before' ->> 'qty_in')::numeric, (entry -> 'after' ->> 'qty_in')::numeric, entry -> 'after' ->> 'status'
    from jsonb_array_elements(current_setting('teste.p1')::jsonb -> 'impact' -> 'consumption' -> 'items') entry
    where entry ->> 'period_end_count_id' = '97300000-0000-4000-8000-000000000092'$$,
  $$values (0::numeric, 30::numeric, 'ok')$$,
  'prévia: o consumo da semana fechada passa a contar os 30 kg');
select results_eq(
  $$select (entry -> 'before' ->> 'unit_cost')::numeric, (entry -> 'after' ->> 'unit_cost')::numeric,
           entry ->> 'start_date', entry ->> 'end_date'
    from jsonb_array_elements(current_setting('teste.p1')::jsonb -> 'impact' -> 'consumption' -> 'items') entry
    where entry ->> 'period_end_count_id' = '97300000-0000-4000-8000-000000000093'$$,
  $$values (8::numeric, 9::numeric, '2025-01-18'::text, '2025-01-25'::text)$$,
  'prévia: a semana seguinte muda só pelo custo de referência e vem com as datas dela');
select is(
  (select count(*)::int from jsonb_array_elements(current_setting('teste.p1')::jsonb -> 'impact' -> 'consumption' -> 'periods') entry
   where entry ->> 'period_end_count_id' = '97300000-0000-4000-8000-000000000093'),
  0, 'prévia: os totais de compras dessa semana não mudam');
select results_eq(
  $$select (entry -> 'before' ->> 'not_stock')::numeric, (entry -> 'after' ->> 'not_stock')::numeric,
           (entry -> 'before' ->> 'counted')::numeric, (entry -> 'after' ->> 'counted')::numeric
    from jsonb_array_elements(current_setting('teste.p1')::jsonb -> 'impact' -> 'consumption' -> 'periods') entry
    where entry ->> 'period_end_count_id' = '97300000-0000-4000-8000-000000000092'$$,
  $$values (270::numeric, 0::numeric, 0::numeric, 270::numeric)$$,
  'prévia: os R$ 270 saem de "não é estoque" e entram nas compras contadas');
select is((select mapping_status from public.payable_purchase_items where id = '97300000-0000-4000-8000-000000000061'),
  'nao_aplicavel', 'prévia não grava o item');
select is((select active from public.payable_non_catalog_mappings where id = '97300000-0000-4000-8000-000000000081'),
  true, 'prévia não desliga a memória');
select is((select cost_price from public.products where id = '97300000-0000-4000-8000-000000000021'),
  8.00::numeric, 'prévia não grava o custo');
select is((select count(*)::int from public.payable_purchase_item_corrections), 0, 'prévia não grava histórico');

-- Mudança no financeiro entre a prévia e a confirmação: PT409 -----------------

reset role;
update public.payable_purchases set finance_account_id = (
  select account.id from public.finance_accounts account where account.kind <> 'cartao_credito' and account.active order by account.key limit 1
) where id = '97300000-0000-4000-8000-000000000041';
set local role authenticated;
select set_config('request.jwt.claim.sub', '97300000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.correct_payable_purchase_items('97300000-0000-4000-8000-0000000000a0', 'aplicar',
    '[{"item_id":"97300000-0000-4000-8000-000000000061","product_id":"97300000-0000-4000-8000-000000000021","conversion_factor":30}]',
    null, current_setting('teste.p1')::jsonb ->> 'impact_hash')$$,
  'PT409', null, 'conta de pagamento trocada depois da prévia exige prévia nova');
reset role;
update public.payable_purchases set finance_account_id = null where id = '97300000-0000-4000-8000-000000000041';
set local role authenticated;

-- Permissão retirada entre a prévia e a confirmação ---------------------------

select set_config('request.jwt.claim.sub', '97300000-0000-4000-8000-000000000002', true);
reset role;
delete from public.app_user_permissions
where user_id = '97300000-0000-4000-8000-000000000002' and permission_key = 'contas_pagar.acessar';
set local role authenticated;
select throws_ok(
  $$select public.correct_payable_purchase_items('97300000-0000-4000-8000-0000000000a0', 'aplicar',
    '[{"item_id":"97300000-0000-4000-8000-000000000061","product_id":"97300000-0000-4000-8000-000000000021","conversion_factor":30}]',
    null, current_setting('teste.p1')::jsonb ->> 'impact_hash')$$,
  '42501', 'Sem permissão para corrigir itens de NF-e.', 'permissão retirada depois da prévia barra a confirmação');
reset role;
insert into public.app_user_permissions (user_id, permission_key, scope)
values ('97300000-0000-4000-8000-000000000002', 'contas_pagar.acessar', 'jc');
set local role authenticated;

-- Uso ou despesa -> insumo, confirmação ---------------------------------------

select set_config('request.jwt.claim.sub', '97300000-0000-4000-8000-000000000002', true);
select set_config('teste.a1', public.correct_payable_purchase_items('97300000-0000-4000-8000-0000000000a1', 'aplicar',
  '[{"item_id":"97300000-0000-4000-8000-000000000061","product_id":"97300000-0000-4000-8000-000000000021","conversion_factor":30}]',
  null, current_setting('teste.p1')::jsonb ->> 'impact_hash')::text, true);

select results_eq(
  $$select mapping_status, product_id, item_name, unit, conversion_basis, conversion_factor, usable_quantity,
           normalized_unit_cost, category_snapshot, cost_applied, mapping_confirmed_by
    from public.payable_purchase_items where id = '97300000-0000-4000-8000-000000000061'$$,
  $$values ('mapeado'::text, '97300000-0000-4000-8000-000000000021'::uuid, '[TESTE] Margarina uso'::text, 'kg'::text,
            'package'::text, 30::numeric, 30::numeric, 9::numeric, 'Insumos'::text, true,
            '97300000-0000-4000-8000-000000000002'::uuid)$$,
  'confirmação: item gravado na margarina com fator, quantidade útil, custo e autor');
select is((select cost_price from public.products where id = '97300000-0000-4000-8000-000000000021'),
  9.00::numeric, 'confirmação: custo da margarina vai a 9,00');
select is((select active from public.payable_non_catalog_mappings where id = '97300000-0000-4000-8000-000000000081'),
  false, 'confirmação: memória de uso ou despesa desligada');
select is((select classification_status from public.payable_purchases where id = '97300000-0000-4000-8000-000000000041'),
  'completa', 'confirmação: a conta continua classificada');
reset role;
select set_eq(
  $$select id, category_id, amount, competence_month, reversed_at from public.finance_entries
    where source = 'contas_pagar' and source_ref = '97300000-0000-4000-8000-000000000071'$$,
  $$select id, category_id, amount, competence_month, reversed_at from livro_antes$$,
  'confirmação: o livro-caixa da conta paga não muda');
select results_eq(
  $$select status, amount, paid_amount, paid_date from public.payable_installments where id = '97300000-0000-4000-8000-000000000071'$$,
  $$values ('paga'::text, 270::numeric, 275::numeric, '2025-01-22'::date)$$,
  'confirmação: a parcela paga não muda');
select is((select sum(amount) from public.payable_purchase_categories where purchase_id = '97300000-0000-4000-8000-000000000041'),
  270::numeric, 'confirmação: o rateio da conta não muda');
select is((select total_value from public.payable_purchases where id = '97300000-0000-4000-8000-000000000041'),
  270::numeric, 'confirmação: o total da conta não muda');
select ok(exists (
    select 1 from public.payable_events event
    where event.purchase_id = '97300000-0000-4000-8000-000000000041' and event.event_type = 'corrigida'
      and event.details -> 'items' -> 0 ->> 'from_mapping_status' = 'nao_aplicavel'
      and event.details -> 'items' -> 0 ->> 'to_mapping_status' = 'mapeado'),
  'confirmação: o evento da conta registra a saída de uso ou despesa');
select is((select product_ids from public.payable_purchase_item_corrections where request_id = '97300000-0000-4000-8000-0000000000a1'),
  array['97300000-0000-4000-8000-000000000021']::uuid[], 'histórico aparece no produto de destino');
set local role authenticated;
select set_config('request.jwt.claim.sub', '97300000-0000-4000-8000-000000000002', true);

select is(
  (public.correct_payable_purchase_items('97300000-0000-4000-8000-0000000000a1', 'aplicar',
    '[{"item_id":"97300000-0000-4000-8000-000000000061","product_id":"97300000-0000-4000-8000-000000000021","conversion_factor":30}]',
    null, current_setting('teste.p1')::jsonb ->> 'impact_hash') ->> 'replayed')::boolean,
  true, 'mesmo pedido repetido devolve o resultado gravado');

-- Insumo -> uso ou despesa, item que dava o custo e sem outra nota -------------

select set_config('teste.p2', public.correct_payable_purchase_items(null, 'previa',
  '[{"item_id":"97300000-0000-4000-8000-000000000062","product_id":null,"conversion_factor":null}]')::text, true);
select results_eq(
  $$select entry ->> 'kind', entry ->> 'purchase_id'
    from jsonb_array_elements(current_setting('teste.p2')::jsonb -> 'impact' -> 'decisions') entry$$,
  $$values ('origem_sem_nota'::text, null::text)$$,
  'prévia: o pano perde a única nota e o custo fica, com o aviso');
select results_eq(
  $$select entry ->> 'kind', entry ->> 'mapping_id'
    from jsonb_array_elements(current_setting('teste.p2')::jsonb -> 'impact' -> 'items' -> 0 -> 'memories_after') entry$$,
  $$values ('insumo'::text, '97300000-0000-4000-8000-000000000082'::text)$$,
  'prévia: a memória de insumo do pano continua ligada e é mostrada');
select is(current_setting('teste.p2')::jsonb -> 'impact' -> 'memories_off', '[]'::jsonb,
  'prévia: virar uso ou despesa não desliga memória');
select set_config('teste.a2', public.correct_payable_purchase_items('97300000-0000-4000-8000-0000000000a2', 'aplicar',
  '[{"item_id":"97300000-0000-4000-8000-000000000062","product_id":null,"conversion_factor":null}]',
  null, current_setting('teste.p2')::jsonb ->> 'impact_hash')::text, true);
select results_eq(
  $$select mapping_status, product_id, item_name, unit, quantity, conversion_basis, conversion_factor,
           usable_quantity, normalized_unit_cost, category_snapshot, cost_applied, factor_confirmed_at
    from public.payable_purchase_items where id = '97300000-0000-4000-8000-000000000062'$$,
  $$values ('nao_aplicavel'::text, null::uuid, 'PANO MULTIUSO ROLAO'::text, 'UN'::text, 1::numeric, null::text,
            null::numeric, null::numeric, null::numeric, null::text, null::boolean, null::timestamptz)$$,
  'confirmação: pano gravado como uso ou despesa, com o que a nota diz');
select is((select cost_price from public.products where id = '97300000-0000-4000-8000-000000000022'),
  95.00::numeric, 'confirmação: sem outra nota, o custo do pano fica como estava');
select is((select active from public.payable_product_mappings where id = '97300000-0000-4000-8000-000000000082'),
  true, 'confirmação: a memória de insumo não é tocada');

-- Insumo -> uso ou despesa, com nota antiga que sobra ---------------------------

select set_config('teste.p3', public.correct_payable_purchase_items(null, 'previa',
  '[{"item_id":"97300000-0000-4000-8000-000000000064","product_id":null,"conversion_factor":null}]')::text, true);
select results_eq(
  $$select (entry ->> 'cost_before')::numeric, (entry ->> 'cost_after')::numeric
    from jsonb_array_elements(current_setting('teste.p3')::jsonb -> 'impact' -> 'products') entry$$,
  $$values (60.00::numeric, 50.00::numeric)$$,
  'prévia: o queijo volta ao custo da nota que sobrou');
select set_config('teste.a3', public.correct_payable_purchase_items('97300000-0000-4000-8000-0000000000a3', 'aplicar',
  '[{"item_id":"97300000-0000-4000-8000-000000000064","product_id":null,"conversion_factor":null}]',
  null, current_setting('teste.p3')::jsonb ->> 'impact_hash')::text, true);
select is((select cost_price from public.products where id = '97300000-0000-4000-8000-000000000023'),
  50.00::numeric, 'confirmação: custo do queijo recalculado pela nota que sobrou');
select is((select cost_applied from public.payable_purchase_items where id = '97300000-0000-4000-8000-000000000063'),
  true, 'confirmação: a nota que sobrou passa a dar o custo');

-- Desfazer --------------------------------------------------------------------

-- Desfazer a margarina: volta a uso ou despesa; a memória continua desligada.
select set_config('teste.u1', public.correct_payable_purchase_items(null, 'previa', null,
  (current_setting('teste.a1')::jsonb ->> 'correction_id')::uuid)::text, true);
select results_eq(
  $$select (entry ->> 'cost_before')::numeric, (entry ->> 'cost_after')::numeric
    from jsonb_array_elements(current_setting('teste.u1')::jsonb -> 'impact' -> 'products') entry$$,
  $$values (9.00::numeric, 8.00::numeric)$$,
  'prévia do desfazer: a margarina volta ao custo da nota antiga');
select is(current_setting('teste.u1')::jsonb -> 'impact' -> 'memories_off', '[]'::jsonb,
  'prévia do desfazer: memória não é religada');
select set_config('teste.d1', public.correct_payable_purchase_items('97300000-0000-4000-8000-0000000000d1', 'aplicar', null,
  (current_setting('teste.a1')::jsonb ->> 'correction_id')::uuid,
  current_setting('teste.u1')::jsonb ->> 'impact_hash')::text, true);
select results_eq(
  $$select mapping_status, product_id, item_name, unit, conversion_factor, usable_quantity, category_snapshot
    from public.payable_purchase_items where id = '97300000-0000-4000-8000-000000000061'$$,
  $$values ('nao_aplicavel'::text, null::uuid, 'MARGARINA CX 30KG'::text, 'CX'::text, null::numeric, null::numeric, null::text)$$,
  'desfazer: margarina volta a uso ou despesa');
select is((select cost_price from public.products where id = '97300000-0000-4000-8000-000000000021'),
  8.00::numeric, 'desfazer: custo da margarina volta pela nota antiga');
select is((select active from public.payable_non_catalog_mappings where id = '97300000-0000-4000-8000-000000000081'),
  false, 'desfazer: a memória continua desligada; a próxima nota pergunta');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa', null,
    (current_setting('teste.a1')::jsonb ->> 'correction_id')::uuid)$$,
  '22023', 'Esta correção já foi desfeita.', 'desfazer duas vezes é recusado');

-- Desfazer o pano: volta ao produto com fator, quantidade útil e base gravados.
select set_config('teste.u2', public.correct_payable_purchase_items(null, 'previa', null,
  (current_setting('teste.a2')::jsonb ->> 'correction_id')::uuid)::text, true);
select set_config('teste.d2', public.correct_payable_purchase_items('97300000-0000-4000-8000-0000000000d2', 'aplicar', null,
  (current_setting('teste.a2')::jsonb ->> 'correction_id')::uuid,
  current_setting('teste.u2')::jsonb ->> 'impact_hash')::text, true);
select results_eq(
  $$select mapping_status, product_id, conversion_basis, conversion_factor, usable_quantity, normalized_unit_cost, cost_applied
    from public.payable_purchase_items where id = '97300000-0000-4000-8000-000000000062'$$,
  $$values ('mapeado'::text, '97300000-0000-4000-8000-000000000022'::uuid, 'simple'::text, 1::numeric, 1::numeric, 95::numeric, true)$$,
  'desfazer: pano volta ao produto com a base de conversão gravada');
select results_eq(
  $$select item_name, unit, category_snapshot
    from public.payable_purchase_items where id = '97300000-0000-4000-8000-000000000062'$$,
  $$values ('PANO NOME ANTIGO'::text, 'un'::text, 'Limpeza antiga'::text)$$,
  'desfazer: nome, unidade e categoria voltam como estavam gravados, não como o cadastro de hoje');
select is((select cost_price from public.products where id = '97300000-0000-4000-8000-000000000022'),
  95.00::numeric, 'desfazer: o pano volta a dar o custo');

-- Desfazer recusado quando o item mudou depois.
select set_config('teste.p4', public.correct_payable_purchase_items(null, 'previa',
  '[{"item_id":"97300000-0000-4000-8000-000000000063","product_id":null,"conversion_factor":null}]')::text, true);
select set_config('teste.a4', public.correct_payable_purchase_items('97300000-0000-4000-8000-0000000000a4', 'aplicar',
  '[{"item_id":"97300000-0000-4000-8000-000000000063","product_id":null,"conversion_factor":null}]',
  null, current_setting('teste.p4')::jsonb ->> 'impact_hash')::text, true);
select is((select cost_price from public.products where id = '97300000-0000-4000-8000-000000000023'),
  50.00::numeric, 'queijo sem nenhuma nota: o custo fica como estava');

-- Uso ou despesa -> insumo com fator 1: base simples, e a nota volta a dar o custo.
select set_config('teste.p5', public.correct_payable_purchase_items(null, 'previa',
  '[{"item_id":"97300000-0000-4000-8000-000000000064","product_id":"97300000-0000-4000-8000-000000000023","conversion_factor":1}]')::text, true);
select is(current_setting('teste.p5')::jsonb -> 'impact' -> 'items' -> 0 -> 'after' ->> 'conversion_basis', 'simple',
  'fator 1 vira base simples');
select is(current_setting('teste.p5')::jsonb -> 'impact' -> 'memories_off', '[]'::jsonb,
  'sem memória de uso ou despesa ligada, nada é desligado');
select set_config('teste.a5', public.correct_payable_purchase_items('97300000-0000-4000-8000-0000000000a5', 'aplicar',
  '[{"item_id":"97300000-0000-4000-8000-000000000064","product_id":"97300000-0000-4000-8000-000000000023","conversion_factor":1}]',
  null, current_setting('teste.p5')::jsonb ->> 'impact_hash')::text, true);
select is((select cost_price from public.products where id = '97300000-0000-4000-8000-000000000023'),
  60.00::numeric, 'queijo volta a 60,00 pela nota que saiu de uso ou despesa');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa', null,
    (current_setting('teste.a3')::jsonb ->> 'correction_id')::uuid)$$,
  '22023', 'Um item mudou depois desta correção; ela não pode mais ser desfeita.',
  'desfazer correção de um item que mudou depois é recusado');

-- Administrador também corrige.
select set_config('request.jwt.claim.sub', '97300000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97300000-0000-4000-8000-000000000066","product_id":"97300000-0000-4000-8000-000000000022","conversion_factor":1}]')$$,
  'Administrador vê a prévia de uso ou despesa para insumo');

-- Histórico ------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '97300000-0000-4000-8000-000000000002', true);
select is((select count(*)::int from public.payable_purchase_item_corrections), 7,
  'Financeiro autorizado lê o histórico das correções');
select set_config('request.jwt.claim.sub', '97300000-0000-4000-8000-000000000003', true);
select is((select count(*)::int from public.payable_purchase_item_corrections), 0,
  'Vendas não lê o histórico');
select throws_ok(
  $$insert into public.payable_purchase_item_corrections (request_id, action, product_ids, requested, impact, impact_hash, corrected_by)
    values (gen_random_uuid(), 'corrigir', '{}', '[]', '{}', 'x', '97300000-0000-4000-8000-000000000003')$$,
  '42501', null, 'ninguém grava o histórico direto');

-- Classificação de pendente continua no Contas a pagar ----------------------

reset role;
select is((select mapping_status from public.payable_purchase_items where id = '97300000-0000-4000-8000-000000000065'),
  'pendente', 'o item pendente não foi tocado');
select is((select count(*)::int from public.finance_entries where source = 'contas_pagar' and source_ref = '97300000-0000-4000-8000-000000000071'),
  (select count(*)::int from livro_antes), 'nenhum lançamento novo nasceu no livro');
select is((select count(*)::int from public.payable_purchase_item_corrections where action = 'desfazer'), 2,
  'dois desfazer gravados');
select set_eq(
  $$select item.id, item.quantity, item.line_total from public.payable_purchase_items item
    where item.purchase_id::text like '97300000-0000-4000-8000-0000000000%'$$,
  $$select id, quantity, line_total from valores_antes$$,
  'nenhuma correção mudou a quantidade nem o valor de item algum');

-- Desfazer gravado na fase 4 (foto sem situação, pedido no formato antigo): o
-- mesmo pedido reenviado depois desta migration continua devolvendo o gravado.
insert into public.payable_purchase_item_corrections (
  id, request_id, action, undoes_correction_id, product_ids, requested, impact, impact_hash, corrected_by, corrected_at
) values (
  '97300000-0000-4000-8000-0000000000e1', '97300000-0000-4000-8000-0000000000e2', 'corrigir', null,
  array['97300000-0000-4000-8000-000000000021']::uuid[],
  '[{"item_id":"97300000-0000-4000-8000-000000000060","product_id":"97300000-0000-4000-8000-000000000021","conversion_factor":30.000000,"usable_quantity":null}]',
  '{"action":"corrigir","items":[{"item_id":"97300000-0000-4000-8000-000000000060","before":{"product_id":"97300000-0000-4000-8000-000000000021","conversion_factor":25,"usable_quantity":25},"after":{"product_id":"97300000-0000-4000-8000-000000000021","conversion_factor":30,"usable_quantity":30}}]}',
  'hash-antigo-corrigir', '97300000-0000-4000-8000-000000000001', '2025-06-01 12:00+00'
), (
  '97300000-0000-4000-8000-0000000000e3', '97300000-0000-4000-8000-0000000000e4', 'desfazer', '97300000-0000-4000-8000-0000000000e1',
  array['97300000-0000-4000-8000-000000000021']::uuid[],
  '[{"item_id":"97300000-0000-4000-8000-000000000060","product_id":"97300000-0000-4000-8000-000000000021","conversion_factor":25.000000,"usable_quantity":25.000000}]',
  '{"action":"desfazer"}', 'hash-antigo-desfazer', '97300000-0000-4000-8000-000000000001', '2025-06-02 12:00+00'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '97300000-0000-4000-8000-000000000002', true);
select is(
  (public.correct_payable_purchase_items('97300000-0000-4000-8000-0000000000e4', 'aplicar', null,
    '97300000-0000-4000-8000-0000000000e1', 'hash-antigo-desfazer') ->> 'replayed')::boolean,
  true, 'replay de um desfazer gravado na fase 4 devolve o resultado gravado');

select * from finish();
rollback;
