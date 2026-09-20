-- Fase 3 do saneamento do catálogo: baixa de componentes de kit na venda.
-- Cobre: variante como componente (Brioche Hambúrguer 80 g), 1 kit -> 4 un,
-- 2 kits -> 8 un, kit com dois componentes gera movimentos distintos,
-- reprocessar a mesma importação não duplica, substituição reverte o antigo
-- e gera o novo, restauração reverte/regenera, mudar o vínculo (remover,
-- remapear, trocar de kit, trocar pra não-kit) resincroniza, editar a
-- composição do kit NÃO mexe na baixa de vendas já confirmadas (migration
-- 20260920152945), venda não-kit não sofre efeito, composição inválida
-- falha fechada, e RLS/grants (perfil permitido e bloqueado).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 0. Schema novo existe e não vaza pra quem não deveria chamar direto.
select has_column('public', 'product_components', 'component_variant_id', 'componente pode apontar pra variante específica');
select has_column('public', 'bread_movements', 'product_variant_id', 'movimento preserva a variante debitada');
select ok(not has_function_privilege('authenticated', 'private.sync_kit_sale_movement_for_item(uuid)', 'execute'),
  'motor de sincronização não é chamável direto pelo cliente');
select ok(not has_function_privilege('anon', 'private.sync_kit_sale_movements_for_import(uuid)', 'execute'),
  'visitante não sincroniza baixa de kit');

-- 1. Fixtures: usuários (permitido e bloqueado), produto com variante, kit
-- com dois componentes (produto+variante e pão), kit alternativo e produto
-- não-kit.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
values
  ('b5000000-0000-4000-8000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','financeiro-kits-test@example.com','x',now(),now(),now(),'{}','{}',false),
  ('b5000000-0000-4000-8000-00000000000b','00000000-0000-0000-0000-000000000000','authenticated','authenticated','vendas-bloqueada-kits-test@example.com','x',now(),now(),now(),'{}','{}',false);
insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('b5000000-0000-4000-8000-00000000000a','Financeiro Kits','financeiro','jc',true,'[]'),
  ('b5000000-0000-4000-8000-00000000000b','Vendas Bloqueada','vendas','ja',true,'[]');
insert into public.app_user_permissions (user_id, permission_key, scope)
values
  ('b5000000-0000-4000-8000-00000000000a','vendas_balcao.visualizar','jc'),
  ('b5000000-0000-4000-8000-00000000000a','vendas_balcao.importar','jc');

insert into public.products (id, name, kind, unit, is_fabricacao_propria)
values ('b5000000-0000-4000-8000-000000000001', '[TESTE] Brioche', 'final', 'un', true);
insert into public.product_variants (id, product_id, name)
values ('b5000000-0000-4000-8000-000000000011', 'b5000000-0000-4000-8000-000000000001', 'Hamburguer 80g');

insert into public.breads (id, name)
values
  ('teste-saco-kit-a', '[TESTE] Saco Kit A'),
  ('teste-saco-kit-b', '[TESTE] Saco Kit B');

insert into public.products (id, name, kind, unit, is_fabricacao_propria)
values
  ('b5000000-0000-4000-8000-000000000002', '[TESTE] Kit Brioche Hamburguer', 'kit', 'un', false),
  ('b5000000-0000-4000-8000-000000000003', '[TESTE] Kit Alternativo', 'kit', 'un', false),
  ('b5000000-0000-4000-8000-000000000004', '[TESTE] Produto Comum', 'final', 'un', true);

-- Kit A: 4 un da variante Hambúrguer + 1 saco (dois componentes distintos).
insert into public.product_components (parent_product_id, component_source, component_id, component_variant_id, quantity)
values
  ('b5000000-0000-4000-8000-000000000002', 'product', 'b5000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000011', 4),
  ('b5000000-0000-4000-8000-000000000002', 'bread', 'teste-saco-kit-a', null, 1);

-- Kit alternativo: só o saco B, quantidade diferente — pra provar que trocar
-- de kit troca a composição debitada.
insert into public.product_components (parent_product_id, component_source, component_id, quantity)
values ('b5000000-0000-4000-8000-000000000003', 'bread', 'teste-saco-kit-b', 2);

-- 2. Composição inválida falha fechada, antes de qualquer venda.
select throws_ok(
  $$insert into public.product_components (parent_product_id, component_source, component_id, component_variant_id, quantity)
    values ('b5000000-0000-4000-8000-000000000003', 'product', 'b5000000-0000-4000-8000-000000000004', 'b5000000-0000-4000-8000-000000000011', 1)$$,
  '23514', null,
  'variante de um produto não pode ser usada como se fosse de outro componente');
select throws_ok(
  $$insert into public.product_components (parent_product_id, component_source, component_id, component_variant_id, quantity)
    values ('b5000000-0000-4000-8000-000000000002', 'bread', 'teste-saco-kit-b', 'b5000000-0000-4000-8000-000000000011', 1)$$,
  '23514', null,
  'componente-pão não pode carregar variante de produto');
select throws_ok(
  $$insert into public.product_components (parent_product_id, component_source, component_id, quantity)
    values ('b5000000-0000-4000-8000-000000000002', 'bread', 'teste-saco-kit-a', 0)$$,
  '23514', null,
  'quantidade zero no componente falha fechada');
select throws_ok(
  $$insert into public.product_components (parent_product_id, component_source, component_id, quantity)
    values ('b5000000-0000-4000-8000-000000000002', 'bread', 'teste-saco-kit-a', -1)$$,
  '23514', null,
  'quantidade negativa no componente falha fechada');

-- 3. Arquivos e importações confirmadas: dia 1 com 1 kit + 1 produto comum
-- (não-kit), dia 2 com 2 kits.
insert into storage.objects (id, bucket_id, name, owner)
values
  ('b5000000-0000-4000-8000-0000000000f1','sales-imports','cnm/jc/2026-02-01/'||repeat('1',64)||'.xls','b5000000-0000-4000-8000-00000000000a'),
  ('b5000000-0000-4000-8000-0000000000f2','sales-imports','cnm/jc/2026-02-02/'||repeat('2',64)||'.xls','b5000000-0000-4000-8000-00000000000a'),
  ('b5000000-0000-4000-8000-0000000000f3','sales-imports','cnm/jc/2026-02-01/'||repeat('3',64)||'.xls','b5000000-0000-4000-8000-00000000000a');

set local role authenticated;
select set_config('request.jwt.claim.sub','b5000000-0000-4000-8000-00000000000b',true);
select throws_ok($$select public.confirm_sales_import(
  'cnm','jc','sales_by_product','2026-02-01','CNM_JC_2026-02-01.xls',repeat('1',64),
  'cnm/jc/2026-02-01/'||repeat('1',64)||'.xls','cnm-sales-v1',10,null,
  '[{"line_number":1,"external_product_key":"Kit Brioche","raw_product_name":"Kit Brioche","raw_category":"Kits","quantity":1,"net_total":10,"raw_row":[]}]'::jsonb)$$,
  '42501', null, 'perfil sem vendas_balcao.importar não confirma venda (bloqueado)');

set local role authenticated;
select set_config('request.jwt.claim.sub','b5000000-0000-4000-8000-00000000000a',true);
select lives_ok($$select public.confirm_sales_import(
  'cnm','jc','sales_by_product','2026-02-01','CNM_JC_2026-02-01.xls',repeat('1',64),
  'cnm/jc/2026-02-01/'||repeat('1',64)||'.xls','cnm-sales-v1',30,null,
  '[{"line_number":1,"external_product_key":"Kit Brioche","raw_product_name":"Kit Brioche","raw_category":"Kits","quantity":1,"net_total":20,"raw_row":[]},{"line_number":2,"external_product_key":"Produto Comum","raw_product_name":"Produto Comum","raw_category":"Padaria","quantity":5,"net_total":10,"raw_row":[]}]'::jsonb)$$,
  'perfil permitido confirma a venda do dia 1 (1 kit + produto comum)');
select lives_ok($$select public.confirm_sales_import(
  'cnm','jc','sales_by_product','2026-02-02','CNM_JC_2026-02-02.xls',repeat('2',64),
  'cnm/jc/2026-02-02/'||repeat('2',64)||'.xls','cnm-sales-v1',20,null,
  '[{"line_number":1,"external_product_key":"Kit Brioche","raw_product_name":"Kit Brioche","raw_category":"Kits","quantity":2,"net_total":20,"raw_row":[]}]'::jsonb)$$,
  'perfil permitido confirma a venda do dia 2 (2 kits)');

select is((select count(*)::int from public.bread_movements where reference_type = 'venda_kit'), 0,
  'sem vínculo produto<->venda, nenhuma baixa é gerada ainda');

-- 4. Kit só pode ser vendido por unidade — falha fechada na origem do vínculo.
select throws_ok($$select public.set_sales_product_mapping('cnm','jc','Kit Brioche','mapped','b5000000-0000-4000-8000-000000000002'::uuid,'kg')$$,
  '22023', 'Kit só pode ser vendido por unidade.', 'vínculo de kit por quilo falha fechada');

-- Perfil bloqueado também não vincula.
set local role authenticated;
select set_config('request.jwt.claim.sub','b5000000-0000-4000-8000-00000000000b',true);
select throws_ok($$select public.set_sales_product_mapping('cnm','jc','Kit Brioche','mapped','b5000000-0000-4000-8000-000000000002'::uuid,'un')$$,
  '42501', null, 'perfil sem permissão não vincula produto vendido (bloqueado)');

-- 5. Vincula ao Kit A: 1 kit -> 4 un da variante + 1 saco; 2 kits -> 8 un + 2 sacos.
set local role authenticated;
select set_config('request.jwt.claim.sub','b5000000-0000-4000-8000-00000000000a',true);
select lives_ok($$select public.set_sales_product_mapping('cnm','jc','Kit Brioche','mapped','b5000000-0000-4000-8000-000000000002'::uuid,'un')$$,
  'perfil permitido vincula "Kit Brioche" ao Kit A');

select is((select count(*)::int from public.bread_movements
  where reference_type = 'venda_kit'
    and reference_id = (select item.id::text from public.sales_import_items item
      join public.sales_imports import on import.id = item.import_id
      where import.sale_date = '2026-02-01' and item.external_product_key = 'Kit Brioche')),
  2, 'kit com dois componentes gera dois movimentos distintos no dia 1');
select is((select quantity from public.bread_movements
  where reference_type = 'venda_kit' and product_source = 'product'
    and product_id = 'b5000000-0000-4000-8000-000000000001'
    and reference_id = (select item.id::text from public.sales_import_items item
      join public.sales_imports import on import.id = item.import_id
      where import.sale_date = '2026-02-01' and item.external_product_key = 'Kit Brioche')),
  -4::numeric, '1 kit debita 4 unidades da variante Hambúrguer 80 g');
select is((select product_variant_id from public.bread_movements
  where reference_type = 'venda_kit' and product_source = 'product'
    and product_id = 'b5000000-0000-4000-8000-000000000001'
    and reference_id = (select item.id::text from public.sales_import_items item
      join public.sales_imports import on import.id = item.import_id
      where import.sale_date = '2026-02-01' and item.external_product_key = 'Kit Brioche')),
  'b5000000-0000-4000-8000-000000000011'::uuid, 'a variante debitada não se perde no movimento');
select is((select quantity from public.bread_movements
  where reference_type = 'venda_kit' and bread_id = 'teste-saco-kit-a'
    and reference_id = (select item.id::text from public.sales_import_items item
      join public.sales_imports import on import.id = item.import_id
      where import.sale_date = '2026-02-01' and item.external_product_key = 'Kit Brioche')),
  -1::numeric, '1 kit debita 1 saco (segundo componente rastreado à parte)');

select is((select quantity from public.bread_movements
  where reference_type = 'venda_kit' and product_source = 'product'
    and product_id = 'b5000000-0000-4000-8000-000000000001'
    and reference_id = (select item.id::text from public.sales_import_items item
      join public.sales_imports import on import.id = item.import_id
      where import.sale_date = '2026-02-02' and item.external_product_key = 'Kit Brioche')),
  -8::numeric, '2 kits debitam 8 unidades da variante');

select is((select count(*)::int from public.bread_movements
  where reference_type = 'venda_kit'
    and reference_id = (select item.id::text from public.sales_import_items item
      join public.sales_imports import on import.id = item.import_id
      where import.sale_date = '2026-02-01' and item.external_product_key = 'Produto Comum')),
  0, 'venda de produto comum (não-kit) não sofre nenhum efeito');
select is((select count(*)::int from public.bread_movements where reference_type = 'venda_kit'), 4,
  'total esperado: 2 componentes x 2 vendas confirmadas (dia 1 e dia 2)');

-- 5.1 Editar a composição de um kit já vendido NÃO mexe na baixa das vendas
-- já confirmadas (decisão de Rodrigo, 2026-09-20, migration
-- 20260920152945): a baixa fica fixada no momento em que foi gerada e só
-- muda de novo por confirmação, substituição, restauração ou troca de
-- vínculo — nunca por edição de receita feita à parte.
update public.product_components
set quantity = 3
where parent_product_id = 'b5000000-0000-4000-8000-000000000002' and component_id = 'teste-saco-kit-a';
select is((select quantity from public.bread_movements
  where reference_type = 'venda_kit' and bread_id = 'teste-saco-kit-a'
    and reference_id = (select item.id::text from public.sales_import_items item
      join public.sales_imports import on import.id = item.import_id
      where import.sale_date = '2026-02-01' and item.external_product_key = 'Kit Brioche')),
  -1::numeric, 'corrigir a quantidade do componente NÃO mexe na baixa da venda já confirmada (dia 1)');
select is((select quantity from public.bread_movements
  where reference_type = 'venda_kit' and bread_id = 'teste-saco-kit-a'
    and reference_id = (select item.id::text from public.sales_import_items item
      join public.sales_imports import on import.id = item.import_id
      where import.sale_date = '2026-02-02' and item.external_product_key = 'Kit Brioche')),
  -2::numeric, 'a mesma correção também não alcança nenhuma outra venda confirmada (dia 2)');

-- Volta a quantidade original, pra não desalinhar o resto da suíte com uma
-- receita diferente da que foi semeada.
update public.product_components
set quantity = 1
where parent_product_id = 'b5000000-0000-4000-8000-000000000002' and component_id = 'teste-saco-kit-a';

-- Cadastrar pão é gate de /produtos (breads_insert_catalog_managers exige
-- allowed_routes ? '/produtos'), que este usuário de teste não tem — a
-- fixture não está testando essa RLS, então grava fora do papel autenticado
-- e volta pro perfil vigente do teste logo em seguida.
reset role;
insert into public.breads (id, name) values ('teste-saco-kit-a2', '[TESTE] Saco Kit A2');
set local role authenticated;
select set_config('request.jwt.claim.sub','b5000000-0000-4000-8000-00000000000a',true);

insert into public.product_components (parent_product_id, component_source, component_id, quantity)
values ('b5000000-0000-4000-8000-000000000002', 'bread', 'teste-saco-kit-a2', 5);
select is((select count(*)::int from public.bread_movements where reference_type = 'venda_kit'), 4,
  'adicionar um componente novo ao kit NÃO gera baixa nenhuma nas vendas já confirmadas');

delete from public.product_components
where parent_product_id = 'b5000000-0000-4000-8000-000000000002' and component_id = 'teste-saco-kit-a2';
select is((select count(*)::int from public.bread_movements where reference_type = 'venda_kit'), 4,
  'remover esse componente recém-criado também não mexe em venda nenhuma (ele nunca teve baixa)');

delete from public.product_components
where parent_product_id = 'b5000000-0000-4000-8000-000000000002' and component_id = 'teste-saco-kit-a';
select is((select count(*)::int from public.bread_movements where reference_type = 'venda_kit' and bread_id = 'teste-saco-kit-a'), 2,
  'remover um componente do cadastro NÃO apaga a baixa que as vendas já confirmadas já tinham gerado com ele');

-- Recadastra o componente original, deixando o kit exatamente como a
-- fixture semeou, pra não desalinhar o resto da suíte.
insert into public.product_components (parent_product_id, component_source, component_id, quantity)
values ('b5000000-0000-4000-8000-000000000002', 'bread', 'teste-saco-kit-a', 1);
select is((select count(*)::int from public.bread_movements where reference_type = 'venda_kit'), 4,
  'recadastrar o componente também não duplica nem mexe na baixa das vendas já confirmadas');

-- Confere explicitamente que o Kit A voltou a ter a composição exata da
-- fixture original, pra proteger o resto da suíte (seções 6 a 11) de uma
-- regressão silenciosa nesta seção.
select is((select count(*)::int from public.product_components where parent_product_id = 'b5000000-0000-4000-8000-000000000002'), 2,
  'Kit A volta a ter exatamente dois componentes, como a fixture semeou');
select is((select quantity from public.product_components
  where parent_product_id = 'b5000000-0000-4000-8000-000000000002' and component_source = 'product'),
  4::numeric, 'componente variante do Kit A permanece com quantidade 4, nunca alterada nesta seção');
select is((select quantity from public.product_components
  where parent_product_id = 'b5000000-0000-4000-8000-000000000002' and component_id = 'teste-saco-kit-a'),
  1::numeric, 'componente saco do Kit A volta à quantidade original 1');

-- 6. Reprocessar a mesma importação (mesmo hash) não duplica.
select is((select public.confirm_sales_import(
  'cnm','jc','sales_by_product','2026-02-01','CNM_JC_2026-02-01.xls',repeat('1',64),
  'cnm/jc/2026-02-01/'||repeat('1',64)||'.xls','cnm-sales-v1',30,null,
  '[{"line_number":1,"external_product_key":"Kit Brioche","raw_product_name":"Kit Brioche","raw_category":"Kits","quantity":1,"net_total":20,"raw_row":[]},{"line_number":2,"external_product_key":"Produto Comum","raw_product_name":"Produto Comum","raw_category":"Padaria","quantity":5,"net_total":10,"raw_row":[]}]'::jsonb) ->> 'outcome'),
  'unchanged', 'reenviar o mesmo arquivo é identificado como inalterado');
select is((select count(*)::int from public.bread_movements where reference_type = 'venda_kit'), 4,
  'reprocessar a mesma venda não duplica movimento nenhum');

-- 7. Substituição: dia 1 corrigido pra 3 kits reverte o antigo e gera o novo.
create temporary table old_day1_item as
  select item.id from public.sales_import_items item
  join public.sales_imports import on import.id = item.import_id
  where import.sale_date = '2026-02-01' and item.external_product_key = 'Kit Brioche' and import.status = 'confirmed';

select lives_ok($$select public.confirm_sales_import(
  'cnm','jc','sales_by_product','2026-02-01','CNM_JC_2026-02-01.xls',repeat('3',64),
  'cnm/jc/2026-02-01/'||repeat('3',64)||'.xls','cnm-sales-v1',40,'Correção: CNM tinha 3 kits no dia',
  '[{"line_number":1,"external_product_key":"Kit Brioche","raw_product_name":"Kit Brioche","raw_category":"Kits","quantity":3,"net_total":30,"raw_row":[]},{"line_number":2,"external_product_key":"Produto Comum","raw_product_name":"Produto Comum","raw_category":"Padaria","quantity":5,"net_total":10,"raw_row":[]}]'::jsonb)$$,
  'substituição do dia 1 com motivo é aceita');

select is((select count(*)::int from public.bread_movements
  where reference_type = 'venda_kit' and reference_id in (select id::text from old_day1_item)),
  0, 'substituição apaga a baixa da versão anterior do dia 1, sem estoque órfão');
select is((select quantity from public.bread_movements
  where reference_type = 'venda_kit' and product_source = 'product'
    and product_id = 'b5000000-0000-4000-8000-000000000001'
    and reference_id = (select item.id::text from public.sales_import_items item
      join public.sales_imports import on import.id = item.import_id
      where import.sale_date = '2026-02-01' and import.status = 'confirmed' and item.external_product_key = 'Kit Brioche')),
  -12::numeric, 'versão corrigida do dia 1 (3 kits) debita 12 unidades');

-- 8. Restauração: volta pra versão de 1 kit e reverte a de 3 kits.
select lives_ok(format($$select public.restore_sales_import(%L::uuid,'CNM original é que estava certo')$$,
  (select item.import_id from public.sales_import_items item where item.id = (select id from old_day1_item))),
  'restauração da versão original do dia 1');

select is((select count(*)::int from public.bread_movements
  where reference_type = 'venda_kit' and reference_id in (select id::text from old_day1_item)),
  2, 'restaurar regenera a baixa da versão reativada');
select is((select quantity from public.bread_movements
  where reference_type = 'venda_kit' and product_source = 'product'
    and product_id = 'b5000000-0000-4000-8000-000000000001'
    and reference_id = (select id::text from old_day1_item)),
  -4::numeric, 'versão restaurada volta a debitar exatamente 4 unidades (1 kit)');
select is((select count(*)::int from public.bread_movements mv
  join public.sales_import_items item on item.id::text = mv.reference_id
  join public.sales_imports import on import.id = item.import_id
  where mv.reference_type = 'venda_kit' and import.status = 'replaced'),
  0, 'versão substituída (agora replaced) não carrega baixa nenhuma');

-- 9. Vínculo removido apaga a baixa em todas as datas; remapear regenera.
select lives_ok($$select public.set_sales_product_mapping('cnm','jc','Kit Brioche','pending',null,null,'Katálogo trocou: não é mais kit vendido separado')$$,
  'vínculo do kit é removido');
select is((select count(*)::int from public.bread_movements where reference_type = 'venda_kit'), 0,
  'sem vínculo, nenhuma venda confirmada carrega baixa de kit');

select lives_ok($$select public.set_sales_product_mapping('cnm','jc','Kit Brioche','mapped','b5000000-0000-4000-8000-000000000002'::uuid,'un')$$,
  'remapear regenera o vínculo');
select is((select count(*)::int from public.bread_movements where reference_type = 'venda_kit'), 4,
  'remapear resincroniza as duas vendas confirmadas (dia 1 e dia 2)');

-- 10. Trocar de kit muda a composição debitada em todas as datas de uma vez.
select lives_ok($$select public.set_sales_product_mapping('cnm','jc','Kit Brioche','mapped','b5000000-0000-4000-8000-000000000003'::uuid,'un','Katálogo trocou: virou o Kit Alternativo')$$,
  'trocar o vínculo pro Kit Alternativo');
select is((select count(*)::int from public.bread_movements
  where reference_type = 'venda_kit' and (product_id = 'b5000000-0000-4000-8000-000000000001' or bread_id = 'teste-saco-kit-a')),
  0, 'trocar de kit remove toda a baixa da composição anterior');
select is((select quantity from public.bread_movements
  where reference_type = 'venda_kit' and bread_id = 'teste-saco-kit-b'
    and reference_id = (select id::text from old_day1_item)),
  -2::numeric, 'Kit Alternativo (1 kit, componente de qty 2) debita 2 sacos B');
select is((select count(*)::int from public.bread_movements where reference_type = 'venda_kit'), 2,
  'Kit Alternativo tem um componente só: um movimento por venda confirmada');

-- 11. Trocar pra produto não-kit remove a baixa por completo.
select lives_ok($$select public.set_sales_product_mapping('cnm','jc','Kit Brioche','mapped','b5000000-0000-4000-8000-000000000004'::uuid,'un','Katálogo trocou: não é kit')$$,
  'trocar o vínculo pra produto comum (não-kit)');
select is((select count(*)::int from public.bread_movements where reference_type = 'venda_kit'), 0,
  'produto não-kit não gera baixa de componente nenhuma');

reset role;
select * from finish();
rollback;
