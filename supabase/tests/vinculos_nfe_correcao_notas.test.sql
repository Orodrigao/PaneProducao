begin;
create extension if not exists pgtap with schema extensions;
select plan(74);

-- Vínculos de NF-e, fase 4: correção de itens de notas já gravadas.
-- Matriz: Administrador e Financeiro autorizado (Catálogo + Contas a pagar JC)
-- corrigem; Vendas e Financeiro sem Catálogo são barrados. Regras de custo:
-- destino pela NF mais recente; origem só recalcula se o item movido era o que
-- deu o custo; sem nota restante, o custo fica.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('97200000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-notas@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97200000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'elis-notas@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97200000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vendas-notas@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97200000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'financeiro-sem-catalogo-notas@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes) values
  ('97200000-0000-4000-8000-000000000001', 'Administrador Notas', 'admin', null, true, '["/produtos"]'::jsonb),
  ('97200000-0000-4000-8000-000000000002', 'Elis Notas', 'financeiro', 'jc', true, '["/produtos"]'::jsonb),
  ('97200000-0000-4000-8000-000000000003', 'Vendas Notas', 'vendas', 'jc', true, '["/", "/produtos"]'::jsonb),
  ('97200000-0000-4000-8000-000000000004', 'Financeiro sem Catálogo Notas', 'financeiro', 'jc', true, '["/contas-pagar"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope) values
  ('97200000-0000-4000-8000-000000000002', 'contas_pagar.acessar', 'jc'),
  ('97200000-0000-4000-8000-000000000003', 'contas_pagar.acessar', 'jc'),
  ('97200000-0000-4000-8000-000000000004', 'contas_pagar.acessar', 'jc');

insert into public.suppliers (id, name, active) values
  ('97200000-0000-4000-8000-000000000011', '[TESTE] Fornecedor das notas', true);

insert into public.products (id, name, category, active, unit, kind, cost_price, is_fabricacao_propria) values
  ('97200000-0000-4000-8000-000000000021', '[TESTE] Goiabada errada', 'Insumos', true, 'kg', 'insumo', 2.86, false),
  ('97200000-0000-4000-8000-000000000022', '[TESTE] Maionese certa', 'Insumos', true, 'kg', 'insumo', 10.00, false),
  ('97200000-0000-4000-8000-000000000023', '[TESTE] Insumo inativo', 'Insumos', false, 'kg', 'insumo', null, false),
  ('97200000-0000-4000-8000-000000000024', '[TESTE] Kit', 'Insumos', true, 'un', 'kit', null, false),
  ('97200000-0000-4000-8000-000000000025', '[TESTE] Pão da casa', 'Pães', true, 'un', 'final', null, true),
  ('97200000-0000-4000-8000-000000000026', '[TESTE] Mussarela', 'Insumos', true, 'kg', 'insumo', 33.33, false),
  ('97200000-0000-4000-8000-000000000027', '[TESTE] Fermento fresco', 'Insumos', true, 'kg', 'insumo', 6.90, false),
  ('97200000-0000-4000-8000-000000000028', '[TESTE] Insumo de uma nota só', 'Insumos', true, 'kg', 'insumo', 11.11, false),
  ('97200000-0000-4000-8000-000000000029', '[TESTE] Salame antigo', 'Insumos', true, 'kg', 'insumo', 58.20, false),
  ('97200000-0000-4000-8000-00000000002a', '[TESTE] Manteiga incompleta', 'Insumos', true, 'kg', 'insumo', 40.00, false);

insert into public.payable_purchases (
  id, request_id, store, supplier_id, purchase_date, origin, document_type,
  payment_method, status, total_value, nfe_number, nfe_issued_at, classification_status, created_by
) values
  ('97200000-0000-4000-8000-000000000040', '97200000-0000-4000-8000-000000000140', 'jc', '97200000-0000-4000-8000-000000000011', '2026-08-20', 'xml', 'nfe', 'boleto', 'paga', 250, '9720040', '2026-08-20', 'completa', '97200000-0000-4000-8000-000000000001'),
  ('97200000-0000-4000-8000-000000000041', '97200000-0000-4000-8000-000000000141', 'jc', '97200000-0000-4000-8000-000000000011', '2026-09-01', 'xml', 'nfe', 'boleto', 'aberta', 100, '9720041', '2026-09-01', 'completa', '97200000-0000-4000-8000-000000000001'),
  ('97200000-0000-4000-8000-000000000042', '97200000-0000-4000-8000-000000000142', 'jc', '97200000-0000-4000-8000-000000000011', '2026-09-10', 'xml', 'nfe', 'boleto', 'aberta', 80, '9720042', '2026-09-10', 'completa', '97200000-0000-4000-8000-000000000001'),
  ('97200000-0000-4000-8000-000000000043', '97200000-0000-4000-8000-000000000143', 'jc', '97200000-0000-4000-8000-000000000011', '2026-09-15', 'xml', 'nfe', 'boleto', 'aberta', 60, '9720043', '2026-09-15', 'completa', '97200000-0000-4000-8000-000000000001'),
  ('97200000-0000-4000-8000-000000000044', '97200000-0000-4000-8000-000000000144', 'jc', '97200000-0000-4000-8000-000000000011', '2026-09-20', 'xml', 'nfe', 'boleto', 'aberta', 32.90, '9720044', '2026-09-20', 'completa', '97200000-0000-4000-8000-000000000001'),
  ('97200000-0000-4000-8000-000000000045', '97200000-0000-4000-8000-000000000145', 'jc', '97200000-0000-4000-8000-000000000011', '2026-09-05', 'xml', 'nfe', 'boleto', 'aberta', 138, '9720045', '2026-09-05', 'completa', '97200000-0000-4000-8000-000000000001'),
  ('97200000-0000-4000-8000-000000000046', '97200000-0000-4000-8000-000000000146', 'jc', '97200000-0000-4000-8000-000000000011', '2026-09-12', 'xml', 'nfe', 'boleto', 'aberta', 9.99, '9720046', '2026-09-12', 'completa', '97200000-0000-4000-8000-000000000001'),
  ('97200000-0000-4000-8000-000000000047', '97200000-0000-4000-8000-000000000147', 'jc', '97200000-0000-4000-8000-000000000011', '2026-09-13', 'xml', 'nfe', 'boleto', 'aberta', 20, '9720047', '2026-09-13', 'pendente', '97200000-0000-4000-8000-000000000001'),
  ('97200000-0000-4000-8000-000000000049', '97200000-0000-4000-8000-000000000149', 'jc', '97200000-0000-4000-8000-000000000011', '2026-09-14', 'xml', 'nfe', 'boleto', 'cancelada', 10, '9720049', '2026-09-14', 'completa', '97200000-0000-4000-8000-000000000001'),
  ('97200000-0000-4000-8000-000000000050', '97200000-0000-4000-8000-000000000150', 'jc', '97200000-0000-4000-8000-000000000011', '2026-08-18', 'xml', 'nfe', 'boleto', 'paga', 92.53, '9720050', '2026-08-18', 'completa', '97200000-0000-4000-8000-000000000001'),
  ('97200000-0000-4000-8000-000000000051', '97200000-0000-4000-8000-000000000151', 'jc', '97200000-0000-4000-8000-000000000011', '2026-09-02', 'xml', 'nfe', 'boleto', 'aberta', 200, '9720051', '2026-09-02', 'completa', '97200000-0000-4000-8000-000000000001');

insert into public.payable_purchase_items (
  id, purchase_id, product_id, item_name, unit, quantity, unit_price, source_product_code,
  source_description, source_unit, source_quantity, conversion_basis, conversion_factor,
  usable_quantity, normalized_unit_cost, mapping_status, cost_applied, mapping_confirmed_by
) values
  -- Goiabada: nota velha que já não dá o custo, mas guarda a marca.
  ('97200000-0000-4000-8000-000000000060', '97200000-0000-4000-8000-000000000040', '97200000-0000-4000-8000-000000000021', '[TESTE] Goiabada errada', 'kg', 5, 50, 'GOI', 'GOIABADA', 'KG', 5, 'simple', 1, 5, 50, 'mapeado', true, '97200000-0000-4000-8000-000000000001'),
  ('97200000-0000-4000-8000-000000000061', '97200000-0000-4000-8000-000000000041', '97200000-0000-4000-8000-000000000022', '[TESTE] Maionese certa', 'kg', 10, 10, 'MAI-KG', 'MAIONESE KG', 'KG', 10, 'simple', 1, 10, 10, 'mapeado', true, '97200000-0000-4000-8000-000000000001'),
  -- O item errado: maionese em balde gravada na goiabada, fator 7; deu o custo de 2,86.
  ('97200000-0000-4000-8000-000000000062', '97200000-0000-4000-8000-000000000042', '97200000-0000-4000-8000-000000000021', '[TESTE] Goiabada errada', 'kg', 4, 20, 'MAI-BALDE', 'MAIONESE BALDE 3KG', 'UN', 4, 'simple', 7, 28, 2.857143, 'mapeado', true, '97200000-0000-4000-8000-000000000001'),
  -- Mussarela: item errado com a marca, mas o custo veio de nota mais nova (e foi editado à mão depois).
  ('97200000-0000-4000-8000-000000000063', '97200000-0000-4000-8000-000000000043', '97200000-0000-4000-8000-000000000026', '[TESTE] Mussarela', 'kg', 2, 30, 'AZUL', 'QUEIJO AZUL', 'KG', 2, 'simple', 1, 2, 30, 'mapeado', true, '97200000-0000-4000-8000-000000000001'),
  ('97200000-0000-4000-8000-000000000064', '97200000-0000-4000-8000-000000000044', '97200000-0000-4000-8000-000000000026', '[TESTE] Mussarela', 'kg', 1, 32.90, 'MUSS', 'MUSSARELA', 'KG', 1, 'simple', 1, 1, 32.90, 'mapeado', true, '97200000-0000-4000-8000-000000000001'),
  -- Fermento no produto certo com fator errado: 20 pacotes de 500 g gravados como 20 kg.
  ('97200000-0000-4000-8000-000000000065', '97200000-0000-4000-8000-000000000045', '97200000-0000-4000-8000-000000000027', '[TESTE] Fermento fresco', 'kg', 20, 6.90, 'FERM', 'FERMENTO FRESCO 500G', 'UN', 20, 'simple', 1, 20, 6.90, 'mapeado', true, '97200000-0000-4000-8000-000000000001'),
  ('97200000-0000-4000-8000-000000000067', '97200000-0000-4000-8000-000000000046', '97200000-0000-4000-8000-000000000028', '[TESTE] Insumo de uma nota só', 'kg', 1, 9.99, 'SOZ', 'SOZINHO', 'KG', 1, 'simple', 1, 1, 9.99, 'mapeado', true, '97200000-0000-4000-8000-000000000001'),
  ('97200000-0000-4000-8000-000000000068', '97200000-0000-4000-8000-000000000047', null, 'PENDENTE', 'KG', 1, 10, 'PEN', 'PENDENTE', 'KG', 1, 'simple', null, null, null, 'pendente', null, null),
  ('97200000-0000-4000-8000-000000000069', '97200000-0000-4000-8000-000000000047', null, 'DESPESA', 'UN', 1, 10, 'DES', 'DESPESA', 'UN', 1, null, null, null, null, 'nao_aplicavel', null, '97200000-0000-4000-8000-000000000001'),
  ('97200000-0000-4000-8000-000000000070', '97200000-0000-4000-8000-000000000049', '97200000-0000-4000-8000-000000000021', '[TESTE] Goiabada errada', 'kg', 1, 10, 'GOI', 'GOIABADA', 'KG', 1, 'simple', 1, 1, 10, 'mapeado', true, '97200000-0000-4000-8000-000000000001'),
  -- Salame anterior a 13/09: única nota do produto, sem a marca de custo (nula).
  ('97200000-0000-4000-8000-000000000071', '97200000-0000-4000-8000-000000000050', '97200000-0000-4000-8000-000000000029', '[TESTE] Salame antigo', 'kg', 1.158, 79.90, 'SAL', 'SALAME BALCAO KG', 'KG', 1.158, 'simple', 1, 1.158, 79.896373, 'mapeado', null, '97200000-0000-4000-8000-000000000001'),
  -- Item antigo incompleto: ligado ao produto, sem fator nem quantidade útil.
  ('97200000-0000-4000-8000-000000000072', '97200000-0000-4000-8000-000000000051', '97200000-0000-4000-8000-00000000002a', '[TESTE] Manteiga incompleta', 'kg', 1, 200, 'MANT', 'MANTEIGA CAIXA', 'CX', 1, 'package', null, null, null, 'mapeado', null, '97200000-0000-4000-8000-000000000001');

-- Estrutura e privilégios ------------------------------------------------------

select ok(has_function_privilege('authenticated', 'public.correct_payable_purchase_items(uuid, text, jsonb, uuid, text)', 'execute'),
  'perfil autenticado chama a função protegida');
select ok(not has_function_privilege('anon', 'public.correct_payable_purchase_items(uuid, text, jsonb, uuid, text)', 'execute'),
  'perfil anônimo não chama a correção de notas');
select ok((select prosecdef and proconfig @> array['search_path=""'] and provolatile = 'v'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'correct_payable_purchase_items'),
  'correção de notas é security definer, volátil e com search_path vazio');
select ok(not has_table_privilege('authenticated', 'public.payable_purchase_item_corrections', 'insert')
  and not has_table_privilege('authenticated', 'public.payable_purchase_item_corrections', 'update')
  and not has_table_privilege('authenticated', 'public.payable_purchase_item_corrections', 'delete'),
  'histórico de correções de notas não aceita escrita direta');
select ok((select relrowsecurity and relforcerowsecurity from pg_class
  where oid = 'public.payable_purchase_item_corrections'::regclass),
  'histórico de correções de notas tem RLS forçado');
select ok(not has_function_privilege('authenticated', 'private.foto_item_nfe(uuid, boolean)', 'execute'),
  'foto do item fica fora da Data API');

select ok((select strpos(prosrc, E'for update;') between 1 and strpos(prosrc, 'for update of item, purchase')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'classify_payable_item' and p.pronargs = 7),
  'a classificação trava a conta antes do item, na mesma ordem da correção de notas');
select ok((select strpos(prosrc, E'for update;') between 1 and strpos(prosrc, 'for update of item, purchase')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'classify_payable_item_without_product'),
  'a classificação como uso ou despesa trava a conta antes do item');

set local role authenticated;

-- Barrados ----------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '97200000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97200000-0000-4000-8000-000000000062","product_id":"97200000-0000-4000-8000-000000000022","conversion_factor":3}]')$$,
  '42501', 'Sem permissão para corrigir itens de NF-e.', 'Vendas é barrada mesmo com a rota e o Contas a pagar');
select set_config('request.jwt.claim.sub', '97200000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97200000-0000-4000-8000-000000000062","product_id":"97200000-0000-4000-8000-000000000022","conversion_factor":3}]')$$,
  '42501', 'Sem permissão para corrigir itens de NF-e.', 'Financeiro sem o Catálogo é barrado');

-- Prévia: mostra a conta e não grava nada --------------------------------------

select set_config('request.jwt.claim.sub', '97200000-0000-4000-8000-000000000002', true);
select set_config('teste.p1', public.correct_payable_purchase_items(null, 'previa',
  '[{"item_id":"97200000-0000-4000-8000-000000000062","product_id":"97200000-0000-4000-8000-000000000022","conversion_factor":3}]')::text, true);

select results_eq(
  $$select (entry ->> 'cost_before')::numeric, (entry ->> 'cost_after')::numeric
    from jsonb_array_elements(current_setting('teste.p1')::jsonb -> 'impact' -> 'products') entry
    order by entry ->> 'product_id'$$,
  $$values (2.86::numeric, 50.00::numeric), (10.00::numeric, 6.67::numeric)$$,
  'prévia: a goiabada volta ao custo da nota que sobrou (250 / 5) e a maionese ganha o da nota mais nova (80 / 12)');
select results_eq(
  $$select entry -> 'after' ->> 'product_id', (entry -> 'after' ->> 'usable_quantity')::numeric,
           (entry -> 'after' ->> 'normalized_unit_cost')::numeric, (entry -> 'before' ->> 'conversion_factor')::numeric
    from jsonb_array_elements(current_setting('teste.p1')::jsonb -> 'impact' -> 'items') entry$$,
  $$values ('97200000-0000-4000-8000-000000000022'::text, 12::numeric, 6.666667::numeric, 7::numeric)$$,
  'prévia: item vai para a maionese com 4 x 3 = 12 kg e custo de 6,666667 por kg');
select ok(
  (current_setting('teste.p1')::jsonb -> 'impact' -> 'decisions') @>
    '[{"product_id":"97200000-0000-4000-8000-000000000021","kind":"origem_recalculada","purchase_id":"97200000-0000-4000-8000-000000000040"}]'::jsonb,
  'prévia: diz de qual nota sai o custo novo da origem');
select is(length(current_setting('teste.p1')::jsonb ->> 'impact_hash'), 64, 'prévia devolve o hash do efeito');
select results_eq(
  $$select product_id::text, conversion_factor, usable_quantity, cost_applied
    from public.payable_purchase_items where id = '97200000-0000-4000-8000-000000000062'$$,
  $$values ('97200000-0000-4000-8000-000000000021'::text, 7::numeric, 28::numeric, true)$$,
  'depois da prévia o item continua como estava');
select results_eq(
  $$select cost_price from public.products
    where id in ('97200000-0000-4000-8000-000000000021', '97200000-0000-4000-8000-000000000022') order by id$$,
  $$values (2.86::numeric), (10.00::numeric)$$,
  'depois da prévia os custos continuam como estavam');
select ok(
  (select count(*) from public.payable_purchase_item_corrections) = 0
  and (select count(*) from public.payable_events where purchase_id = '97200000-0000-4000-8000-000000000042') = 0
  and (select cost_applied from public.payable_purchase_items where id = '97200000-0000-4000-8000-000000000060'),
  'prévia não grava histórico, evento nem marca de custo');

-- Aplicação -------------------------------------------------------------------

select throws_ok(
  $$select public.correct_payable_purchase_items('97200000-0000-4000-8000-0000000000a1', 'aplicar',
    '[{"item_id":"97200000-0000-4000-8000-000000000062","product_id":"97200000-0000-4000-8000-000000000022","conversion_factor":3}]',
    null, 'hash-de-outra-previa')$$,
  'PT409', 'O efeito mudou desde a prévia (outra correção, nota nova ou cadastro alterado). Veja a prévia de novo antes de confirmar.',
  'efeito diferente da prévia é recusado');
select is((select product_id::text from public.payable_purchase_items where id = '97200000-0000-4000-8000-000000000062'),
  '97200000-0000-4000-8000-000000000021', 'recusa por efeito diferente não grava nada');
select throws_ok(
  $$select public.correct_payable_purchase_items('97200000-0000-4000-8000-0000000000a1', 'aplicar',
    '[{"item_id":"97200000-0000-4000-8000-000000000062","product_id":"97200000-0000-4000-8000-000000000022","conversion_factor":3}]')$$,
  '22023', 'Confira a prévia antes de confirmar.', 'aplicar sem o hash da prévia é recusado');

select set_config('teste.a1', public.correct_payable_purchase_items('97200000-0000-4000-8000-0000000000a1', 'aplicar',
  '[{"item_id":"97200000-0000-4000-8000-000000000062","product_id":"97200000-0000-4000-8000-000000000022","conversion_factor":3}]',
  null, current_setting('teste.p1')::jsonb ->> 'impact_hash')::text, true);
select is(current_setting('teste.a1')::jsonb ->> 'replayed', 'false', 'Financeiro autorizado aplica a correção conferida');
select results_eq(
  $$select product_id::text, item_name, unit, conversion_factor, usable_quantity, normalized_unit_cost,
           factor_confirmed_by::text, mapping_confirmed_by::text, conversion_basis, cost_applied
    from public.payable_purchase_items where id = '97200000-0000-4000-8000-000000000062'$$,
  $$values ('97200000-0000-4000-8000-000000000022'::text, '[TESTE] Maionese certa'::text, 'kg'::text, 3::numeric, 12::numeric,
            6.666667::numeric, '97200000-0000-4000-8000-000000000002'::text, '97200000-0000-4000-8000-000000000002'::text, 'simple'::text, true)$$,
  'item passa para a maionese com cadastro, fator, quantidade útil, custo e autor novos');
select results_eq(
  $$select cost_price from public.products
    where id in ('97200000-0000-4000-8000-000000000021', '97200000-0000-4000-8000-000000000022') order by id$$,
  $$values (50.00::numeric), (6.67::numeric)$$,
  'custos gravados batem com a prévia');
select results_eq(
  $$select action, corrected_by::text, impact_hash = current_setting('teste.p1')::jsonb ->> 'impact_hash',
           product_ids @> array['97200000-0000-4000-8000-000000000021', '97200000-0000-4000-8000-000000000022']::uuid[]
    from public.payable_purchase_item_corrections$$,
  $$values ('corrigir'::text, '97200000-0000-4000-8000-000000000002'::text, true, true)$$,
  'histórico guarda ação, autor, o efeito conferido e os produtos envolvidos');
select ok(exists (
    select 1 from public.payable_events event
    where event.purchase_id = '97200000-0000-4000-8000-000000000042' and event.event_type = 'corrigida'
      and event.details ->> 'item_correction_id' = current_setting('teste.a1')::jsonb ->> 'correction_id'),
  'a conta da nota registra o evento da correção');
select ok(not exists (select 1 from public.payable_installments where purchase_id = '97200000-0000-4000-8000-000000000042')
  and (select total_value from public.payable_purchases where id = '97200000-0000-4000-8000-000000000042') = 80,
  'conta e parcelas não mudam');

select ok(exists (select 1 from public.list_vinculo_nfe_authors('97200000-0000-4000-8000-000000000021')
    where author_id = '97200000-0000-4000-8000-000000000002' and display_name = 'Elis Notas'),
  'quem corrigiu aparece entre os autores do produto de onde o item saiu');

-- Pedido repetido ---------------------------------------------------------------

select is(public.correct_payable_purchase_items('97200000-0000-4000-8000-0000000000a1', 'aplicar',
  '[{"item_id":"97200000-0000-4000-8000-000000000062","product_id":"97200000-0000-4000-8000-000000000022","conversion_factor":3}]',
  null, current_setting('teste.p1')::jsonb ->> 'impact_hash') ->> 'replayed', 'true',
  'mesmo pedido repetido devolve o resultado gravado, mesmo com o item já mudado');
select is((select count(*)::int from public.payable_purchase_item_corrections), 1, 'pedido repetido não grava de novo');
select throws_ok(
  $$select public.correct_payable_purchase_items('97200000-0000-4000-8000-0000000000a1', 'aplicar',
    '[{"item_id":"97200000-0000-4000-8000-000000000062","product_id":"97200000-0000-4000-8000-000000000022","conversion_factor":4}]',
    null, current_setting('teste.p1')::jsonb ->> 'impact_hash')$$,
  '22023', 'Este pedido já foi usado em outra correção.', 'identificador de pedido não serve para outro fator');

-- Recusas ----------------------------------------------------------------------

select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97200000-0000-4000-8000-000000000062","product_id":"97200000-0000-4000-8000-000000000022","conversion_factor":3}]')$$,
  '22023', 'A correção não muda nada em um dos itens.', 'correção que não muda nada é recusada');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97200000-0000-4000-8000-000000000060","product_id":"97200000-0000-4000-8000-000000000023","conversion_factor":1}]')$$,
  '22023', 'Escolha um produto ativo que se compra: insumo ou revenda, sem kit nem fabricação própria.', 'produto inativo é recusado');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97200000-0000-4000-8000-000000000060","product_id":"97200000-0000-4000-8000-000000000024","conversion_factor":1}]')$$,
  '22023', 'Escolha um produto ativo que se compra: insumo ou revenda, sem kit nem fabricação própria.', 'kit é recusado');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97200000-0000-4000-8000-000000000060","product_id":"97200000-0000-4000-8000-000000000025","conversion_factor":1}]')$$,
  '22023', 'Escolha um produto ativo que se compra: insumo ou revenda, sem kit nem fabricação própria.', 'produto de fabricação própria é recusado');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97200000-0000-4000-8000-000000000070","product_id":"97200000-0000-4000-8000-000000000022","conversion_factor":1}]')$$,
  '22023', 'Item de conta cancelada não é corrigido.', 'item de conta cancelada é recusado');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97200000-0000-4000-8000-000000000068","product_id":"97200000-0000-4000-8000-000000000022","conversion_factor":1}]')$$,
  '22023', 'Só itens ligados a um produto do catálogo são corrigidos aqui.', 'item pendente é recusado');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97200000-0000-4000-8000-000000000069","product_id":"97200000-0000-4000-8000-000000000022","conversion_factor":1}]')$$,
  '22023', 'Só itens ligados a um produto do catálogo são corrigidos aqui.', 'item de uso ou despesa fica para a fase 5');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97200000-0000-4000-8000-000000000060","product_id":"97200000-0000-4000-8000-000000000022","conversion_factor":1},
      {"item_id":"97200000-0000-4000-8000-000000000060","product_id":"97200000-0000-4000-8000-000000000022","conversion_factor":2}]')$$,
  '22023', 'O mesmo item aparece duas vezes no pedido.', 'item repetido no pedido é recusado');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97200000-0000-4000-8000-000000000060","product_id":"97200000-0000-4000-8000-000000000022","conversion_factor":0}]')$$,
  '22023', 'Informe quanto vem em cada unidade da nota: maior que zero e com até seis casas decimais.', 'fator zero é recusado');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97200000-0000-4000-8000-000000000060","product_id":"97200000-0000-4000-8000-000000000022","conversion_factor":0.1234567}]')$$,
  '22023', 'Informe quanto vem em cada unidade da nota: maior que zero e com até seis casas decimais.', 'fator com sete casas é recusado');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97200000-0000-4000-8000-000000000060","product_id":"97200000-0000-4000-8000-000000000022","conversion_factor":"3"}]')$$,
  '22023', 'Pedido de correção com item inválido.', 'fator em texto é recusado');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa', '[]')$$,
  '22023', 'Escolha de 1 a 100 itens para corrigir.', 'pedido vazio é recusado');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"97200000-0000-4000-8000-000000000060","product_id":"97200000-0000-4000-8000-000000000022","conversion_factor":1}]',
    (current_setting('teste.a1')::jsonb ->> 'correction_id')::uuid)$$,
  '22023', 'Informe os itens a corrigir ou a correção a desfazer.', 'itens e desfazer no mesmo pedido são recusados');

-- Desfazer ----------------------------------------------------------------------

select set_config('teste.p2', public.correct_payable_purchase_items(null, 'previa', null,
  (current_setting('teste.a1')::jsonb ->> 'correction_id')::uuid)::text, true);
select results_eq(
  $$select (entry ->> 'cost_after')::numeric
    from jsonb_array_elements(current_setting('teste.p2')::jsonb -> 'impact' -> 'products') entry
    order by entry ->> 'product_id'$$,
  $$values (2.86::numeric), (10.00::numeric)$$,
  'prévia do desfazer: os dois custos voltam pela regra da nota mais recente');
select set_config('teste.a2', public.correct_payable_purchase_items('97200000-0000-4000-8000-0000000000a2', 'aplicar', null,
  (current_setting('teste.a1')::jsonb ->> 'correction_id')::uuid, current_setting('teste.p2')::jsonb ->> 'impact_hash')::text, true);
select results_eq(
  $$select product_id::text, conversion_factor, usable_quantity, normalized_unit_cost
    from public.payable_purchase_items where id = '97200000-0000-4000-8000-000000000062'$$,
  $$values ('97200000-0000-4000-8000-000000000021'::text, 7::numeric, 28::numeric, 2.857143::numeric)$$,
  'desfazer volta produto, fator e quantidade útil gravados antes');
select results_eq(
  $$select cost_price from public.products
    where id in ('97200000-0000-4000-8000-000000000021', '97200000-0000-4000-8000-000000000022') order by id$$,
  $$values (2.86::numeric), (10.00::numeric)$$,
  'desfazer volta os custos');
select results_eq(
  $$select action, undoes_correction_id::text from public.payable_purchase_item_corrections
    where id = (current_setting('teste.a2')::jsonb ->> 'correction_id')::uuid$$,
  $$values ('desfazer'::text, current_setting('teste.a1')::jsonb ->> 'correction_id')$$,
  'histórico registra o desfazer ligado à correção');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa', null,
    (current_setting('teste.a1')::jsonb ->> 'correction_id')::uuid)$$,
  '22023', 'Esta correção já foi desfeita.', 'correção não é desfeita duas vezes');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa', null,
    (current_setting('teste.a2')::jsonb ->> 'correction_id')::uuid)$$,
  '22023', 'Só uma correção pode ser desfeita. Para voltar de novo, faça uma correção nova.', 'desfazer não é desfeito');

-- Origem com a marca, mas que não deu o custo -----------------------------------

select set_config('teste.p3', public.correct_payable_purchase_items(null, 'previa',
  '[{"item_id":"97200000-0000-4000-8000-000000000063","product_id":"97200000-0000-4000-8000-000000000022","conversion_factor":1}]')::text, true);
select is(public.correct_payable_purchase_items('97200000-0000-4000-8000-0000000000a3', 'aplicar',
  '[{"item_id":"97200000-0000-4000-8000-000000000063","product_id":"97200000-0000-4000-8000-000000000022","conversion_factor":1}]',
  null, current_setting('teste.p3')::jsonb ->> 'impact_hash') ->> 'replayed', 'false',
  'Financeiro autorizado move o queijo que estava na mussarela');
select results_eq(
  $$select cost_price from public.products
    where id in ('97200000-0000-4000-8000-000000000022', '97200000-0000-4000-8000-000000000026') order by id$$,
  $$values (30.00::numeric), (33.33::numeric)$$,
  'a maionese ganha o custo da nota mais nova; a mussarela, cujo custo não vinha deste item, fica como estava (nem a sonda grava)');
select ok(not ((current_setting('teste.p3')::jsonb -> 'impact' -> 'decisions') @>
    '[{"product_id":"97200000-0000-4000-8000-000000000026"}]'::jsonb),
  'a mussarela não entra como origem recalculada');

-- Só o fator, com nota nova chegando entre a prévia e a confirmação ------------

select set_config('teste.p4', public.correct_payable_purchase_items(null, 'previa',
  '[{"item_id":"97200000-0000-4000-8000-000000000065","product_id":"97200000-0000-4000-8000-000000000027","conversion_factor":0.5}]')::text, true);
select results_eq(
  $$select (entry ->> 'cost_after')::numeric
    from jsonb_array_elements(current_setting('teste.p4')::jsonb -> 'impact' -> 'products') entry$$,
  $$values (13.80::numeric)$$,
  'prévia da correção só do fator: 20 pacotes de 500 g são 10 kg, custo 13,80 por kg');

reset role;
insert into public.payable_purchases (
  id, request_id, store, supplier_id, purchase_date, origin, document_type,
  payment_method, status, total_value, nfe_number, nfe_issued_at, classification_status, created_by
) values (
  '97200000-0000-4000-8000-000000000048', '97200000-0000-4000-8000-000000000148', 'jc', '97200000-0000-4000-8000-000000000011',
  '2026-09-25', 'xml', 'nfe', 'boleto', 'aberta', 20, '9720048', '2026-09-25', 'completa', '97200000-0000-4000-8000-000000000001');
insert into public.payable_purchase_items (
  id, purchase_id, product_id, item_name, unit, quantity, unit_price, source_product_code,
  source_description, source_unit, source_quantity, conversion_basis, conversion_factor,
  usable_quantity, normalized_unit_cost, mapping_status, cost_applied
) values (
  '97200000-0000-4000-8000-000000000066', '97200000-0000-4000-8000-000000000048', '97200000-0000-4000-8000-000000000027',
  '[TESTE] Fermento fresco', 'kg', 1, 20, 'FERM-KG', 'FERMENTO FRESCO KG', 'KG', 1, 'simple', 1, 1, 20, 'mapeado', true);
update public.products set cost_price = 20 where id = '97200000-0000-4000-8000-000000000027';
set local role authenticated;
select set_config('request.jwt.claim.sub', '97200000-0000-4000-8000-000000000002', true);

select throws_ok(
  $$select public.correct_payable_purchase_items('97200000-0000-4000-8000-0000000000a4', 'aplicar',
    '[{"item_id":"97200000-0000-4000-8000-000000000065","product_id":"97200000-0000-4000-8000-000000000027","conversion_factor":0.5}]',
    null, current_setting('teste.p4')::jsonb ->> 'impact_hash')$$,
  'PT409', 'O efeito mudou desde a prévia (outra correção, nota nova ou cadastro alterado). Veja a prévia de novo antes de confirmar.',
  'nota nova entre a prévia e a confirmação recusa a confirmação');
select set_config('teste.p4', public.correct_payable_purchase_items(null, 'previa',
  '[{"item_id":"97200000-0000-4000-8000-000000000065","product_id":"97200000-0000-4000-8000-000000000027","conversion_factor":0.5}]')::text, true);
select set_config('teste.a4', public.correct_payable_purchase_items('97200000-0000-4000-8000-0000000000a4', 'aplicar',
  '[{"item_id":"97200000-0000-4000-8000-000000000065","product_id":"97200000-0000-4000-8000-000000000027","conversion_factor":0.5}]',
  null, current_setting('teste.p4')::jsonb ->> 'impact_hash')::text, true);
select results_eq(
  $$select usable_quantity, normalized_unit_cost, cost_applied
    from public.payable_purchase_items where id = '97200000-0000-4000-8000-000000000065'$$,
  $$values (10::numeric, 13.8::numeric, false)$$,
  'com a prévia nova a correção do fator entra e registra que a nota não dá mais o custo');
select is((select cost_price from public.products where id = '97200000-0000-4000-8000-000000000027'), 20.00::numeric,
  'o custo do fermento continua o da nota mais nova');

-- Desfazer depois de outra correção no mesmo item -------------------------------

-- Prévia e confirmação em fusos diferentes não mudam o efeito.
set local timezone = 'America/Sao_Paulo';
select set_config('teste.p5', public.correct_payable_purchase_items(null, 'previa',
  '[{"item_id":"97200000-0000-4000-8000-000000000065","product_id":"97200000-0000-4000-8000-000000000027","conversion_factor":0.25}]')::text, true);
select set_config('request.jwt.claim.sub', '97200000-0000-4000-8000-000000000001', true);
set local timezone = 'UTC';
select is(public.correct_payable_purchase_items('97200000-0000-4000-8000-0000000000a5', 'aplicar',
  '[{"item_id":"97200000-0000-4000-8000-000000000065","product_id":"97200000-0000-4000-8000-000000000027","conversion_factor":0.25}]',
  null, current_setting('teste.p5')::jsonb ->> 'impact_hash') ->> 'replayed', 'false',
  'Administrador também corrige, com a prévia feita por outra pessoa');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa', null,
    (current_setting('teste.a4')::jsonb ->> 'correction_id')::uuid)$$,
  '22023', 'Um item mudou depois desta correção; ela não pode mais ser desfeita.',
  'correção antiga não é desfeita por cima de outra mais nova');
select set_config('teste.p10', public.correct_payable_purchase_items(null, 'previa',
  '[{"item_id":"97200000-0000-4000-8000-000000000065","product_id":"97200000-0000-4000-8000-000000000027","conversion_factor":0.5}]')::text, true);
select is(public.correct_payable_purchase_items('97200000-0000-4000-8000-0000000000b0', 'aplicar',
  '[{"item_id":"97200000-0000-4000-8000-000000000065","product_id":"97200000-0000-4000-8000-000000000027","conversion_factor":0.5}]',
  null, current_setting('teste.p10')::jsonb ->> 'impact_hash') ->> 'replayed', 'false',
  'uma correção mais nova volta o fermento ao fator da correção antiga');
select throws_ok(
  $$select public.correct_payable_purchase_items(null, 'previa', null,
    (current_setting('teste.a4')::jsonb ->> 'correction_id')::uuid)$$,
  '22023', 'Um item foi corrigido de novo depois desta correção; desfaça a correção mais nova.',
  'mesmo com os valores iguais de novo, a correção antiga não apaga a mais nova');

-- Origem sem nota restante ------------------------------------------------------

select set_config('teste.p6', public.correct_payable_purchase_items(null, 'previa',
  '[{"item_id":"97200000-0000-4000-8000-000000000067","product_id":"97200000-0000-4000-8000-000000000022","conversion_factor":1}]')::text, true);
select is(public.correct_payable_purchase_items('97200000-0000-4000-8000-0000000000a6', 'aplicar',
  '[{"item_id":"97200000-0000-4000-8000-000000000067","product_id":"97200000-0000-4000-8000-000000000022","conversion_factor":1}]',
  null, current_setting('teste.p6')::jsonb ->> 'impact_hash') ->> 'replayed', 'false',
  'item da única nota de um insumo é movido');
select is((select cost_price from public.products where id = '97200000-0000-4000-8000-000000000028'), 11.11::numeric,
  'sem nota restante, o custo da origem fica como estava (editado à mão depois da nota; a sonda não grava o da nota)');
select ok((current_setting('teste.p6')::jsonb -> 'impact' -> 'decisions') @>
    '[{"product_id":"97200000-0000-4000-8000-000000000028","kind":"origem_sem_nota"}]'::jsonb,
  'a prévia diz que a origem ficou sem nota');

-- Item antigo sem a marca de custo, na nota mais recente do produto -----------

select set_config('teste.p7', public.correct_payable_purchase_items(null, 'previa',
  '[{"item_id":"97200000-0000-4000-8000-000000000071","product_id":"97200000-0000-4000-8000-000000000028","conversion_factor":1}]')::text, true);
select is(public.correct_payable_purchase_items('97200000-0000-4000-8000-0000000000a7', 'aplicar',
  '[{"item_id":"97200000-0000-4000-8000-000000000071","product_id":"97200000-0000-4000-8000-000000000028","conversion_factor":1}]',
  null, current_setting('teste.p7')::jsonb ->> 'impact_hash') ->> 'replayed', 'false',
  'salame anterior à marca de custo é movido');
select is((select cost_price from public.products where id = '97200000-0000-4000-8000-000000000029'), 58.20::numeric,
  'sem a marca de custo, a origem não recalcula: a sonda não deixa o custo da nota gravado');

-- Item incompleto: corrigir completa, desfazer volta a ficar sem fator -------

select set_config('teste.p8', public.correct_payable_purchase_items(null, 'previa',
  '[{"item_id":"97200000-0000-4000-8000-000000000072","product_id":"97200000-0000-4000-8000-00000000002a","conversion_factor":10}]')::text, true);
select set_config('teste.a8', public.correct_payable_purchase_items('97200000-0000-4000-8000-0000000000a8', 'aplicar',
  '[{"item_id":"97200000-0000-4000-8000-000000000072","product_id":"97200000-0000-4000-8000-00000000002a","conversion_factor":10}]',
  null, current_setting('teste.p8')::jsonb ->> 'impact_hash')::text, true);
select results_eq(
  $$select conversion_factor, usable_quantity, normalized_unit_cost
    from public.payable_purchase_items where id = '97200000-0000-4000-8000-000000000072'$$,
  $$values (10::numeric, 10::numeric, 20::numeric)$$,
  'item sem fator recebe o fator conferido: 1 caixa de 10 kg, 20 por kg');
select set_config('teste.p9', public.correct_payable_purchase_items(null, 'previa', null,
  (current_setting('teste.a8')::jsonb ->> 'correction_id')::uuid)::text, true);
select is(public.correct_payable_purchase_items('97200000-0000-4000-8000-0000000000a9', 'aplicar', null,
  (current_setting('teste.a8')::jsonb ->> 'correction_id')::uuid, current_setting('teste.p9')::jsonb ->> 'impact_hash') ->> 'replayed', 'false',
  'a correção do item incompleto é desfeita');
select results_eq(
  $$select conversion_factor, usable_quantity, normalized_unit_cost, factor_confirmed_at
    from public.payable_purchase_items where id = '97200000-0000-4000-8000-000000000072'$$,
  $$values (null::numeric, null::numeric, null::numeric, null::timestamptz)$$,
  'desfazer volta o item a ficar sem fator, sem quantidade útil e sem fator conferido');

-- Histórico: só quem corrige enxerga --------------------------------------------

select set_config('request.jwt.claim.sub', '97200000-0000-4000-8000-000000000003', true);
select is((select count(*)::int from public.payable_purchase_item_corrections), 0,
  'perfil sem permissão não enxerga o histórico de correções de notas');
select set_config('request.jwt.claim.sub', '97200000-0000-4000-8000-000000000002', true);
select is((select count(*)::int from public.payable_purchase_item_corrections), 10,
  'Financeiro autorizado enxerga as correções de notas');

-- Porta lateral fechada ---------------------------------------------------------

select set_config('request.jwt.claim.sub', '97200000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.classify_payable_item('97200000-0000-4000-8000-000000000060', '97200000-0000-4000-8000-000000000022',
    'simple', 1, 5, false, true)$$,
  '22023', 'Este item já foi classificado. Para trocar o produto ou o fator, use Catálogo > Vínculos NF-e.',
  'classificação não reaponta item já classificado');
select throws_ok(
  $$select public.classify_payable_item('97200000-0000-4000-8000-000000000060', '97200000-0000-4000-8000-000000000022',
    'simple', 1, 5, false)$$,
  '22023', 'Este item já foi classificado. Para trocar o produto ou o fator, use Catálogo > Vínculos NF-e.',
  'a versão antiga de seis parâmetros também recusa');
select throws_ok(
  $$select public.classify_payable_item('97200000-0000-4000-8000-000000000069', '97200000-0000-4000-8000-000000000022',
    'simple', 1, 1, false, true)$$,
  '22023', 'Este item foi lançado como uso ou despesa e não é reclassificado aqui.',
  'classificação não transforma uso ou despesa em insumo');
select lives_ok(
  $$select public.classify_payable_item('97200000-0000-4000-8000-000000000068', '97200000-0000-4000-8000-000000000022',
    'simple', 1, 1, false, true)$$,
  'item pendente continua sendo classificado');

reset role;
select * from finish();
rollback;
