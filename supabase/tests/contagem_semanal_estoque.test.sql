begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

select ok(exists(select 1 from public.app_permissions where key = 'estoque.contar_semanal'),
  'permissao explicita de contar estoque semanal existe');
select ok(has_function_privilege('authenticated',
  'public.open_inventory_weekly_count(text)', 'execute'), 'abrir contagem e executavel');
select ok(has_function_privilege('authenticated',
  'public.save_inventory_weekly_count_item(uuid,uuid,numeric)', 'execute'), 'salvar item e executavel');
select ok(has_function_privilege('authenticated',
  'public.close_inventory_weekly_count(uuid)', 'execute'), 'fechar contagem e executavel');
select ok(has_function_privilege('authenticated',
  'public.reopen_inventory_weekly_count(uuid)', 'execute'), 'reabrir contagem e executavel');

select ok((select relrowsecurity and relforcerowsecurity
  from pg_catalog.pg_class where oid = 'public.inventory_weekly_counts'::regclass),
  'RLS ligada e forcada em inventory_weekly_counts');
select ok((select relrowsecurity and relforcerowsecurity
  from pg_catalog.pg_class where oid = 'public.inventory_weekly_count_items'::regclass),
  'RLS ligada e forcada em inventory_weekly_count_items');

select ok(not has_table_privilege('authenticated', 'public.inventory_weekly_counts', 'insert'),
  'contagem nao aceita insert direto: so a RPC abre');
select ok(not has_table_privilege('authenticated', 'public.inventory_weekly_counts', 'update'),
  'contagem nao aceita update direto: so a RPC fecha/reabre');
select ok(not has_table_privilege('authenticated', 'public.inventory_weekly_counts', 'delete'),
  'contagem nao aceita delete direto');
select ok(not has_table_privilege('authenticated', 'public.inventory_weekly_count_items', 'insert'),
  'item de contagem nao aceita insert direto: so a RPC fotografa na abertura');
select ok(not has_table_privilege('authenticated', 'public.inventory_weekly_count_items', 'update'),
  'item de contagem nao aceita update direto: so a RPC salva');
select ok(not has_table_privilege('anon', 'public.inventory_weekly_counts', 'select'),
  'anonimo nunca le a contagem semanal');

insert into auth.users(id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
values
  ('97000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-contagem@example.com','x',now(),now(),now(),'{}','{}',false),
  ('97000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rafaela-contagem@example.com','x',now(),now(),now(),'{}','{}',false),
  ('97000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','expedicao-sem-permissao@example.com','x',now(),now(),now(),'{}','{}',false),
  ('97000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','vendas-contagem@example.com','x',now(),now(),now(),'{}','{}',false),
  ('97000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','financeiro-contagem@example.com','x',now(),now(),now(),'{}','{}',false),
  ('97000000-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000','authenticated','authenticated','expedicao-ja@example.com','x',now(),now(),now(),'{}','{}',false),
  ('97000000-0000-4000-8000-000000000007','00000000-0000-0000-0000-000000000000','authenticated','authenticated','expedicao-escopo-errado@example.com','x',now(),now(),now(),'{}','{}',false),
  ('97000000-0000-4000-8000-000000000008','00000000-0000-0000-0000-000000000000','authenticated','authenticated','expedicao-inativa@example.com','x',now(),now(),now(),'{}','{}',false);
insert into public.app_profiles(user_id,display_name,role,store,active,allowed_routes) values
  ('97000000-0000-4000-8000-000000000001','Admin','admin','jc',true,'["/"]'),
  ('97000000-0000-4000-8000-000000000002','Rafaela','expedicao','jc',true,'["/estoque"]'),
  ('97000000-0000-4000-8000-000000000003','Expedicao sem permissao','expedicao','jc',true,'["/estoque"]'),
  ('97000000-0000-4000-8000-000000000004','Vendas','vendas','jc',true,'["/"]'),
  ('97000000-0000-4000-8000-000000000005','Financeiro','financeiro','jc',true,'["/estoque"]'),
  ('97000000-0000-4000-8000-000000000006','Expedicao JA','expedicao','ja',true,'["/estoque"]'),
  ('97000000-0000-4000-8000-000000000007','Expedicao escopo errado','expedicao','jc',true,'["/estoque"]'),
  ('97000000-0000-4000-8000-000000000008','Expedicao inativa','expedicao','jc',false,'["/estoque"]');
insert into public.app_user_permissions(user_id,permission_key,scope) values
  ('97000000-0000-4000-8000-000000000002','estoque.contar_semanal','jc'),
  ('97000000-0000-4000-8000-000000000006','estoque.contar_semanal','ja'),
  ('97000000-0000-4000-8000-000000000007','estoque.contar_semanal','ex'),
  ('97000000-0000-4000-8000-000000000008','estoque.contar_semanal','jc');

insert into public.products(id,name,category,active,unit,kind) values
  ('97000000-0000-4000-8000-000000000011','[TESTE] Farinha de trigo','INSUMOS',true,'kg','insumo'),
  ('97000000-0000-4000-8000-000000000012','[TESTE] Fermento biologico','INSUMOS',true,'g','insumo'),
  ('97000000-0000-4000-8000-000000000013','[TESTE] Pao final','Paes',true,'un','final'),
  ('97000000-0000-4000-8000-000000000014','[TESTE] Insumo unidade estranha','INSUMOS',true,'saco-de-30kg','insumo'),
  ('97000000-0000-4000-8000-000000000015','[TESTE] Marcado depois de abrir','INSUMOS',true,'kg','insumo');
insert into public.products(id,name,category,active,unit,kind) values
  ('97000000-0000-4000-8000-000000000016','[TESTE] Insumo sem unidade','INSUMOS',true,null,'insumo');
update public.products set weekly_count_enabled = true
  where id in ('97000000-0000-4000-8000-000000000011','97000000-0000-4000-8000-000000000012');

select throws_ok($$update public.products set weekly_count_enabled = true
  where id = '97000000-0000-4000-8000-000000000013'$$,
  '23514', null, 'produto final nao entra na contagem semanal');
select throws_ok($$update public.products set weekly_count_enabled = true
  where id = '97000000-0000-4000-8000-000000000014'$$,
  '23514', null, 'unidade nao reconhecida nao entra na contagem semanal');
select throws_ok($$update public.products set weekly_count_enabled = true
  where id = '97000000-0000-4000-8000-000000000016'$$,
  '23514', null, 'unidade nula nao entra na contagem semanal (NULL nao dribla o CHECK)');

set local role authenticated;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.open_inventory_weekly_count('jc')$$,
  '42501','Sem permissao para abrir a contagem semanal.','vendas nao abre contagem');
select is((select count(*)::int from public.inventory_weekly_counts),0,'vendas nao le contagem alguma ainda');

select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.open_inventory_weekly_count('jc')$$,
  '42501','Sem permissao para abrir a contagem semanal.','expedicao sem a permissao granular nao abre contagem');

select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000006',true);
select throws_ok($$select public.open_inventory_weekly_count('jc')$$,
  '42501','Sem permissao para abrir a contagem semanal.','expedicao da JA nao abre contagem da JC');

select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000007',true);
select throws_ok($$select public.open_inventory_weekly_count('jc')$$,
  '42501','Sem permissao para abrir a contagem semanal.','permissao com escopo de outra loja nao abre contagem da JC');

select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000008',true);
select throws_ok($$select public.open_inventory_weekly_count('jc')$$,
  '42501','Sem permissao para abrir a contagem semanal.','perfil inativo nao abre contagem mesmo com a permissao');

select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true);
select is((select status from public.open_inventory_weekly_count('jc')),'aberta','Rafaela abre a contagem da semana');
-- Guarda o id numa variavel psql: mais adiante o vendas tenta gravar nesta
-- contagem, e RLS impede o vendas de ENXERGAR a linha para redescobrir o id
-- por subconsulta (ele so pode ser bloqueado pela RPC se souber o id certo).
select id as v_count_id from public.inventory_weekly_counts where store='jc' \gset
select is((select count(*)::int from public.inventory_weekly_counts where store='jc'),1,
  'so existe uma contagem por loja e semana');
select is((select count(*)::int from public.inventory_weekly_count_items
  where count_id=:'v_count_id'),2,
  'abrir fotografa os dois insumos marcados no momento, nem mais nem menos');
select ok((select bool_and(quantity is null) from public.inventory_weekly_count_items
  where count_id=:'v_count_id'),
  'todo item nasce sem quantidade: ainda nao contado e diferente de contado zero');
select is((select id from public.open_inventory_weekly_count('jc')),
  :'v_count_id',
  'abrir de novo na mesma semana e idempotente: devolve a mesma contagem');
select is((select count(*)::int from public.inventory_weekly_counts where store='jc'),1,
  'idempotencia nao duplica a contagem da semana');

-- Insumo marcado DEPOIS que a contagem abriu nao entra nesta rodada.
update public.products set weekly_count_enabled = true where id = '97000000-0000-4000-8000-000000000015';
select throws_ok(
  'select public.save_inventory_weekly_count_item(' || quote_literal(:'v_count_id') || ', ''97000000-0000-4000-8000-000000000015'', 10)',
  '22023','Este insumo nao faz parte da contagem desta semana.',
  'insumo marcado apos abrir so entra na proxima contagem');

select throws_ok(
  'select public.save_inventory_weekly_count_item(' || quote_literal(:'v_count_id') || ', ''97000000-0000-4000-8000-000000000013'', 10)',
  '22023','Este insumo nao faz parte da contagem desta semana.',
  'insumo nunca marcado nao aceita contagem');

select throws_ok(
  'select public.save_inventory_weekly_count_item(' || quote_literal(:'v_count_id') || ', ''97000000-0000-4000-8000-000000000011'', -1)',
  '22023','Quantidade contada nao pode ser negativa.','quantidade negativa e recusada');

select is((select quantity from public.save_inventory_weekly_count_item(
  :'v_count_id',
  '97000000-0000-4000-8000-000000000011',12.5)),12.5::numeric,'Rafaela conta a farinha');
select is((select quantity from public.save_inventory_weekly_count_item(
  :'v_count_id',
  '97000000-0000-4000-8000-000000000011',13)),13::numeric,'digitar de novo substitui o valor, nao duplica a linha');
select is((select count(*)::int from public.inventory_weekly_count_items
  where product_id='97000000-0000-4000-8000-000000000011'),1,'um unico item por produto na contagem');

select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000004',true);
select throws_ok(
  'select public.save_inventory_weekly_count_item(' || quote_literal(:'v_count_id') || ', ''97000000-0000-4000-8000-000000000012'', 5)',
  '42501','Sem permissao para contar nesta loja.','vendas nao registra contagem');

select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000005',true);
select ok(exists(select 1 from public.inventory_weekly_counts where store='jc'),
  'financeiro continua enxergando a contagem, so nao registra');

select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true);
select is((select status from public.close_inventory_weekly_count(
  :'v_count_id')),
  'fechada','Rafaela fecha a contagem da semana');
select throws_ok(
  'select public.save_inventory_weekly_count_item(' || quote_literal(:'v_count_id') || ', ''97000000-0000-4000-8000-000000000011'', 20)',
  '22023','Esta contagem ja foi fechada. Peca para o admin reabrir antes de corrigir.',
  'contagem fechada trava novos numeros');
select throws_ok(
  'select public.reopen_inventory_weekly_count(' || quote_literal(:'v_count_id') || ')',
  '42501','So o admin pode reabrir uma contagem fechada.','expedicao nao reabre contagem');
select throws_ok($$select public.open_inventory_weekly_count('jc')$$,
  '22023','A contagem desta semana ja foi fechada. Peca para o admin reabrir para corrigir.',
  'abrir nao ressuscita silenciosamente uma contagem fechada da mesma semana');

select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',true);
select is((select status from public.reopen_inventory_weekly_count(
  :'v_count_id')),
  'aberta','admin reabre a contagem fechada');
select is((select status from public.reopen_inventory_weekly_count(
  :'v_count_id')),
  'aberta','reabrir uma contagem ja aberta e idempotente');

select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true);
select is((select quantity from public.save_inventory_weekly_count_item(
  :'v_count_id',
  '97000000-0000-4000-8000-000000000012',3)),3::numeric,'depois de reaberta, Rafaela corrige normalmente');
select is((select quantity from public.inventory_weekly_count_items
  where product_id='97000000-0000-4000-8000-000000000011'),13::numeric,
  'reabrir preserva o que ja tinha sido contado antes de fechar');

select * from finish();
rollback;
