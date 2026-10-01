begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

-- Vínculos de NF-e, fase 3: correção da memória de vínculo por fornecedor.
-- Matriz: Administrador e Financeiro autorizado (Catálogo + Contas a pagar JC)
-- corrigem; Vendas, Expedição, Financeiro sem Catálogo e Financeiro sem a
-- permissão de Contas a pagar são barrados. Tudo pela função protegida.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('97100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-correcao@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'elis-correcao@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97100000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'financeiro-sem-catalogo-correcao@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97100000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vendas-correcao@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97100000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'financeiro-sem-permissao-correcao@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97100000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'expedicao-correcao@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes) values
  ('97100000-0000-4000-8000-000000000001', 'Administrador Correção', 'admin', null, true, '["/produtos"]'::jsonb),
  ('97100000-0000-4000-8000-000000000002', 'Elis Correção', 'financeiro', 'jc', true, '["/produtos"]'::jsonb),
  ('97100000-0000-4000-8000-000000000003', 'Financeiro sem Catálogo', 'financeiro', 'jc', true, '["/contas-pagar"]'::jsonb),
  ('97100000-0000-4000-8000-000000000004', 'Vendas Correção', 'vendas', 'jc', true, '["/"]'::jsonb),
  ('97100000-0000-4000-8000-000000000005', 'Financeiro sem permissão', 'financeiro', 'jc', true, '["/produtos"]'::jsonb),
  ('97100000-0000-4000-8000-000000000006', 'Expedição Correção', 'expedicao', 'jc', true, '["/", "/produtos"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope) values
  ('97100000-0000-4000-8000-000000000002', 'contas_pagar.acessar', 'jc'),
  ('97100000-0000-4000-8000-000000000003', 'contas_pagar.acessar', 'jc'),
  ('97100000-0000-4000-8000-000000000006', 'contas_pagar.acessar', 'jc');

insert into public.suppliers (id, name, active) values
  ('97100000-0000-4000-8000-000000000011', '[TESTE] Fornecedor da correção', true);
insert into public.products (id, name, category, active, unit, kind) values
  ('97100000-0000-4000-8000-000000000021', '[TESTE] Insumo errado', 'Insumos', true, 'kg', 'insumo'),
  ('97100000-0000-4000-8000-000000000022', '[TESTE] Insumo certo', 'Insumos', true, 'kg', 'insumo'),
  ('97100000-0000-4000-8000-000000000023', '[TESTE] Insumo inativo', 'Insumos', false, 'kg', 'insumo');
insert into public.payable_product_mappings (
  id, supplier_id, supplier_product_code, supplier_description, purchase_unit,
  base_product_id, base_unit, conversion_basis, conversion_factor, last_confirmed_by
) values
  ('97100000-0000-4000-8000-000000000031', '97100000-0000-4000-8000-000000000011', 'COD-1', 'Item lembrado errado', 'CX',
   '97100000-0000-4000-8000-000000000021', 'kg', 'package', 10, '97100000-0000-4000-8000-000000000001'),
  ('97100000-0000-4000-8000-000000000032', '97100000-0000-4000-8000-000000000011', 'COD-2', 'Outro item', 'kg',
   '97100000-0000-4000-8000-000000000022', 'kg', 'simple', 1, '97100000-0000-4000-8000-000000000001');

select ok(has_function_privilege('authenticated', 'public.correct_payable_product_mapping(uuid, uuid, timestamptz, text, uuid, numeric)', 'execute'),
  'perfil autenticado chama a função protegida');
select ok(not has_function_privilege('anon', 'public.correct_payable_product_mapping(uuid, uuid, timestamptz, text, uuid, numeric)', 'execute'),
  'perfil anônimo não chama a função de correção');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""'])
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'correct_payable_product_mapping'),
  'função de correção é security definer com search_path vazio');
select ok(not has_table_privilege('authenticated', 'public.payable_product_mapping_corrections', 'insert')
  and not has_table_privilege('authenticated', 'public.payable_product_mapping_corrections', 'update')
  and not has_table_privilege('authenticated', 'public.payable_product_mapping_corrections', 'delete'),
  'histórico de correções não aceita escrita direta');
select ok(not has_table_privilege('authenticated', 'public.payable_product_mappings', 'update')
  and not has_table_privilege('authenticated', 'public.payable_product_mappings', 'insert'),
  'memória de vínculo não aceita escrita direta');
select ok((select strpos(src, 'payable-mapping-supplier:') > 0
    and strpos(src, 'payable-mapping-supplier:') < strpos(src, 'for update')
  from (select prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'correct_payable_product_mapping') f),
  'correção entra na fila da memória do fornecedor antes de travar a linha');
select ok((select relrowsecurity and relforcerowsecurity from pg_class
  where oid = 'public.payable_product_mapping_corrections'::regclass),
  'histórico de correções tem RLS forçado');

set local role authenticated;

-- Bloqueados: nenhum consegue nem ler a versão; a recusa vem antes de tudo.
select set_config('request.jwt.claim.sub', '97100000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$select public.correct_payable_product_mapping('97100000-0000-4000-8000-0000000000a1', '97100000-0000-4000-8000-000000000031', now(), 'desligar')$$,
  '42501', 'Sem permissão para corrigir vínculos de NF-e.', 'Vendas é barrada');
select set_config('request.jwt.claim.sub', '97100000-0000-4000-8000-000000000006', true);
select throws_ok(
  $$select public.correct_payable_product_mapping('97100000-0000-4000-8000-0000000000a1', '97100000-0000-4000-8000-000000000031', now(), 'desligar')$$,
  '42501', 'Sem permissão para corrigir vínculos de NF-e.', 'Expedição é barrada mesmo com a rota e o Contas a pagar');
select set_config('request.jwt.claim.sub', '97100000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.correct_payable_product_mapping('97100000-0000-4000-8000-0000000000a1', '97100000-0000-4000-8000-000000000031', now(), 'desligar')$$,
  '42501', 'Sem permissão para corrigir vínculos de NF-e.', 'Financeiro sem o Catálogo é barrado');
select set_config('request.jwt.claim.sub', '97100000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$select public.correct_payable_product_mapping('97100000-0000-4000-8000-0000000000a1', '97100000-0000-4000-8000-000000000031', now(), 'desligar')$$,
  '42501', 'Sem permissão para corrigir vínculos de NF-e.', 'Financeiro sem a permissão de Contas a pagar é barrado');
select is((select count(*)::int from public.payable_product_mapping_corrections), 0,
  'perfil sem permissão não enxerga o histórico de correções');

-- Financeiro autorizado corrige para o produto certo.
select set_config('request.jwt.claim.sub', '97100000-0000-4000-8000-000000000002', true);
select set_config('teste.versao_inicial',
  (select updated_at::text from public.payable_product_mappings where id = '97100000-0000-4000-8000-000000000031'), true);
select is(
  public.correct_payable_product_mapping('97100000-0000-4000-8000-0000000000b1', '97100000-0000-4000-8000-000000000031',
    current_setting('teste.versao_inicial')::timestamptz, 'corrigir', '97100000-0000-4000-8000-000000000022', 12) ->> 'replayed',
  'false', 'Financeiro autorizado corrige a memória');
select results_eq(
  $$select base_product_id::text, conversion_factor, factor_confirmed, active, last_confirmed_by::text, conversion_basis
    from public.payable_product_mappings where id = '97100000-0000-4000-8000-000000000031'$$,
  $$values ('97100000-0000-4000-8000-000000000022'::text, 12::numeric, true, true, '97100000-0000-4000-8000-000000000002'::text, 'package'::text)$$,
  'memória aponta para o produto certo, com o fator conferido, o autor da correção e a mesma base de conversão');
select results_eq(
  $$select action, corrected_by::text, previous ->> 'base_product_id', result ->> 'base_product_id',
      previous ->> 'base_product_name', (previous ->> 'conversion_factor')::numeric
    from public.payable_product_mapping_corrections$$,
  $$values ('corrigir'::text, '97100000-0000-4000-8000-000000000002'::text, '97100000-0000-4000-8000-000000000021'::text,
            '97100000-0000-4000-8000-000000000022'::text, '[TESTE] Insumo errado'::text, 10::numeric)$$,
  'histórico guarda autor, antes e depois');
select ok((select corrected_at is not null from public.payable_product_mapping_corrections),
  'histórico guarda a data da correção');

-- Repetir o mesmo pedido (duplo clique, rede que reenvia) não aplica de novo.
select is(
  public.correct_payable_product_mapping('97100000-0000-4000-8000-0000000000b1', '97100000-0000-4000-8000-000000000031',
    current_setting('teste.versao_inicial')::timestamptz, 'corrigir', '97100000-0000-4000-8000-000000000022', 12) ->> 'replayed',
  'true', 'mesmo pedido repetido devolve o resultado gravado');
select is((select count(*)::int from public.payable_product_mapping_corrections), 1,
  'pedido repetido não cria segunda correção');
select throws_ok(
  $$select public.correct_payable_product_mapping('97100000-0000-4000-8000-0000000000b1', '97100000-0000-4000-8000-000000000031', now(), 'desligar')$$,
  '22023', 'Este pedido já foi usado em outra correção.', 'identificador de pedido não serve para outra ação');
select throws_ok(
  $$select public.correct_payable_product_mapping('97100000-0000-4000-8000-0000000000b1', '97100000-0000-4000-8000-000000000031',
    current_setting('teste.versao_inicial')::timestamptz, 'corrigir', '97100000-0000-4000-8000-000000000022', 13)$$,
  '22023', 'Este pedido já foi usado em outra correção.', 'identificador de pedido não serve para outro fator');

-- Versão antiga: a tela aberta antes da correção não grava por cima.
select set_config('request.jwt.claim.sub', '97100000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.correct_payable_product_mapping('97100000-0000-4000-8000-0000000000c1', '97100000-0000-4000-8000-000000000031',
    current_setting('teste.versao_inicial')::timestamptz, 'desligar')$$,
  'PT409', 'Esta memória mudou desde que a tela foi aberta. Recarregue e confira de novo.',
  'versão desatualizada é recusada');

-- Entradas inválidas não gravam.
select throws_ok(
  $$select public.correct_payable_product_mapping('97100000-0000-4000-8000-0000000000c2', '97100000-0000-4000-8000-000000000031',
    (select updated_at from public.payable_product_mappings where id = '97100000-0000-4000-8000-000000000031'),
    'corrigir', '97100000-0000-4000-8000-000000000023', 1)$$,
  '22023', 'O produto escolhido não existe ou está inativo.', 'produto inativo é recusado');
select throws_ok(
  $$select public.correct_payable_product_mapping('97100000-0000-4000-8000-0000000000c3', '97100000-0000-4000-8000-000000000031',
    (select updated_at from public.payable_product_mappings where id = '97100000-0000-4000-8000-000000000031'),
    'corrigir', '97100000-0000-4000-8000-000000000022', 0)$$,
  '22023', 'Informe quanto vem em cada unidade da nota (maior que zero).', 'fator zero é recusado');
select throws_ok(
  $$select public.correct_payable_product_mapping('97100000-0000-4000-8000-0000000000c4', '97100000-0000-4000-8000-000000000031',
    (select updated_at from public.payable_product_mappings where id = '97100000-0000-4000-8000-000000000031'),
    'corrigir', '97100000-0000-4000-8000-000000000022', 12)$$,
  '22023', 'A correção não muda nada nesta memória.', 'correção sem mudança é recusada');
select is((select count(*)::int from public.payable_product_mapping_corrections), 1,
  'entradas recusadas não gravam histórico');

-- Administrador desliga; o último a confirmar continua sendo quem corrigiu.
select is(
  public.correct_payable_product_mapping('97100000-0000-4000-8000-0000000000d1', '97100000-0000-4000-8000-000000000031',
    (select updated_at from public.payable_product_mappings where id = '97100000-0000-4000-8000-000000000031'), 'desligar') ->> 'action',
  'desligar', 'Administrador desliga a memória');
select results_eq(
  $$select active, last_confirmed_by::text from public.payable_product_mappings where id = '97100000-0000-4000-8000-000000000031'$$,
  $$values (false, '97100000-0000-4000-8000-000000000002'::text)$$,
  'memória desligada sai da sugestão e mantém quem a confirmou por último');
select throws_ok(
  $$select public.correct_payable_product_mapping('97100000-0000-4000-8000-0000000000d2', '97100000-0000-4000-8000-000000000031',
    (select updated_at from public.payable_product_mappings where id = '97100000-0000-4000-8000-000000000031'), 'desligar')$$,
  '22023', 'Esta memória já está desligada.', 'desligar de novo é recusado');

-- Religar desfaz o desligamento.
select is(
  public.correct_payable_product_mapping('97100000-0000-4000-8000-0000000000d3', '97100000-0000-4000-8000-000000000031',
    (select updated_at from public.payable_product_mappings where id = '97100000-0000-4000-8000-000000000031'), 'religar') ->> 'action',
  'religar', 'Administrador religa a memória');
select is((select active from public.payable_product_mappings where id = '97100000-0000-4000-8000-000000000031'), true,
  'memória religada volta a valer');

-- Religar não cria duas respostas ligadas para o mesmo item do fornecedor.
select public.correct_payable_product_mapping('97100000-0000-4000-8000-0000000000e1', '97100000-0000-4000-8000-000000000032',
  (select updated_at from public.payable_product_mappings where id = '97100000-0000-4000-8000-000000000032'), 'desligar');
reset role;
insert into public.payable_non_catalog_mappings (supplier_id, supplier_product_code, supplier_description, purchase_unit, last_confirmed_by)
values ('97100000-0000-4000-8000-000000000011', 'COD-2', 'Outro item', 'kg', '97100000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub', '97100000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.correct_payable_product_mapping('97100000-0000-4000-8000-0000000000e2', '97100000-0000-4000-8000-000000000032',
    (select updated_at from public.payable_product_mappings where id = '97100000-0000-4000-8000-000000000032'), 'religar')$$,
  '22023', 'Este item do fornecedor tem outra memória ligada. Desligue a que estiver errada antes de corrigir ou religar esta.',
  'religar é recusado quando o item já tem outra memória ligada');

-- Corrigir memória ligada também não convive com outra memória ligada do mesmo item.
reset role;
insert into public.payable_product_mappings (
  id, supplier_id, supplier_product_code, supplier_description, purchase_unit,
  base_product_id, base_unit, conversion_basis, conversion_factor, last_confirmed_by
) values ('97100000-0000-4000-8000-000000000033', '97100000-0000-4000-8000-000000000011', 'COD-1', 'Item lembrado em dobro', 'CX',
  '97100000-0000-4000-8000-000000000021', 'kg', 'package', 10, '97100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.correct_payable_product_mapping('97100000-0000-4000-8000-0000000000f1', '97100000-0000-4000-8000-000000000031',
    (select updated_at from public.payable_product_mappings where id = '97100000-0000-4000-8000-000000000031'),
    'corrigir', '97100000-0000-4000-8000-000000000021', 10)$$,
  '22023', 'Este item do fornecedor tem outra memória ligada. Desligue a que estiver errada antes de corrigir ou religar esta.',
  'corrigir memória ligada é recusado quando o mesmo item tem outra memória ligada');

-- Quem corrigiu aparece nos autores do produto que perdeu e do que ganhou a memória.
select ok(exists (select 1 from public.list_vinculo_nfe_authors('97100000-0000-4000-8000-000000000021') where display_name = 'Elis Correção'),
  'autor da correção aparece no produto de onde a memória saiu');
select ok(exists (select 1 from public.list_vinculo_nfe_authors('97100000-0000-4000-8000-000000000022') where display_name = 'Elis Correção'),
  'autor da correção aparece no produto para onde a memória foi');
select is((select count(*)::int from public.payable_product_mapping_corrections), 4,
  'administrador enxerga o histórico inteiro das correções');

select * from finish();
rollback;
