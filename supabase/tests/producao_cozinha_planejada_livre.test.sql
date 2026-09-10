begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

select ok(exists(select 1 from public.app_permissions where key = 'producao_pj.programar'),
  'permissao explicita de programar PJ existe');
select ok(has_function_privilege('authenticated',
  'public.list_pj_production_queue_v2()', 'execute'), 'fila com destino e executavel');
select ok(has_function_privilege('authenticated',
  'public.record_kitchen_batches_v2(text,jsonb,uuid)', 'execute'), 'gravacao idempotente da cozinha e executavel');
select ok(has_function_privilege('authenticated',
  'public.correct_kitchen_batch_v2(uuid,numeric)', 'execute'), 'correcao por peso e executavel');
select ok(not has_table_privilege('authenticated', 'private.kitchen_production_write_requests', 'select'),
  'pedidos de escrita idempotente ficam fechados');

insert into auth.users(id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
values
  ('98000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','planner-area@example.com','x',now(),now(),now(),'{}','{}',false),
  ('98000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cozinha-a@example.com','x',now(),now(),now(),'{}','{}',false),
  ('98000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cozinha-b@example.com','x',now(),now(),now(),'{}','{}',false),
  ('98000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','vendas-area@example.com','x',now(),now(),now(),'{}','{}',false);
insert into public.app_profiles(user_id,display_name,role,store,active,allowed_routes) values
  ('98000000-0000-4000-8000-000000000001','Planejador','producao','jc',true,'["/"]'),
  ('98000000-0000-4000-8000-000000000002','Cozinha A','producao','jc',true,'["/producao-cozinha"]'),
  ('98000000-0000-4000-8000-000000000003','Cozinha B','producao','jc',true,'["/producao-cozinha"]'),
  ('98000000-0000-4000-8000-000000000004','Vendas','vendas','ja',true,'["/pedidos-pj"]');
insert into public.app_user_permissions(user_id,permission_key,scope) values
  ('98000000-0000-4000-8000-000000000001','producao_pj.programar','jc'),
  ('98000000-0000-4000-8000-000000000002','producao_cozinha.lancar','jc'),
  ('98000000-0000-4000-8000-000000000003','producao_cozinha.lancar','jc');

insert into public.products(id,name,category,active,unit,kind,is_fabricacao_propria,is_pj,
  production_area,production_process,allows_planned_production,allows_unplanned_production)
values
  ('98000000-0000-4000-8000-000000000011','[TESTE] Pizza kg','Pizza',true,'kg','final',true,true,'cozinha','montagem',true,true),
  ('98000000-0000-4000-8000-000000000012','[TESTE] Pastinha planejada','Pastas',true,'un','final',true,true,'cozinha','preparo',true,false),
  ('98000000-0000-4000-8000-000000000013','[TESTE] Bruschetta livre','Bruschetta',true,'un','final',true,true,'cozinha','montagem',false,true),
  ('98000000-0000-4000-8000-000000000014','[TESTE] Massa forno','Massas',true,'kg','final',true,true,'cozinha','forno',true,false),
  ('98000000-0000-4000-8000-000000000015','[TESTE] Mil folhas','Confeitaria',true,'un','final',true,true,'confeitaria','montagem',true,true),
  ('98000000-0000-4000-8000-000000000016','[TESTE] Pastinha inativa aceita','Pastas',false,'un','final',true,true,'cozinha','preparo',true,false);
insert into public.customers(id,name,doc,active)
values ('98000000-0000-4000-8000-000000000020','[TESTE] Cliente Cozinha','98000000000100',true);
insert into public.orders(id,store,order_type,order_group_id,bread_id,product_source,product_name,
  quantity,pricing_unit,customer_id,pj_client,order_date,delivery_date,pj_delivery_date)
values
  ('98000000-0000-4000-8000-000000000101','pj','pj','98000000-0000-4000-8000-000000000201','98000000-0000-4000-8000-000000000011','product','[TESTE] Pizza kg',4.125,'kg','98000000-0000-4000-8000-000000000020','[TESTE] Cliente Cozinha',private.data_na_padaria()-1,private.data_na_padaria(),private.data_na_padaria()),
  ('98000000-0000-4000-8000-000000000102','pj','pj','98000000-0000-4000-8000-000000000202','98000000-0000-4000-8000-000000000012','product','[TESTE] Pastinha planejada',30,'un','98000000-0000-4000-8000-000000000020','[TESTE] Cliente Cozinha',private.data_na_padaria(),private.data_na_padaria()+1,private.data_na_padaria()+1),
  ('98000000-0000-4000-8000-000000000103','pj','pj','98000000-0000-4000-8000-000000000203','98000000-0000-4000-8000-000000000014','product','[TESTE] Massa forno',2.5,'kg','98000000-0000-4000-8000-000000000020','[TESTE] Cliente Cozinha',private.data_na_padaria(),private.data_na_padaria()+1,private.data_na_padaria()+1),
  ('98000000-0000-4000-8000-000000000104','pj','pj','98000000-0000-4000-8000-000000000204','98000000-0000-4000-8000-000000000015','product','[TESTE] Mil folhas',10,'un','98000000-0000-4000-8000-000000000020','[TESTE] Cliente Cozinha',private.data_na_padaria(),private.data_na_padaria()+1,private.data_na_padaria()+1),
  ('98000000-0000-4000-8000-000000000105','pj','pj','98000000-0000-4000-8000-000000000205','98000000-0000-4000-8000-000000000016','product','[TESTE] Pastinha inativa aceita',6,'un','98000000-0000-4000-8000-000000000020','[TESTE] Cliente Cozinha',private.data_na_padaria()-1,private.data_na_padaria(),private.data_na_padaria()),
  ('98000000-0000-4000-8000-000000000106','pj','pj','98000000-0000-4000-8000-000000000206','98000000-0000-4000-8000-000000000011','product','[TESTE] Fantasma antigo',9,'kg','98000000-0000-4000-8000-000000000020','[TESTE] Cliente Cozinha',private.data_na_padaria()-40,private.data_na_padaria()-39,private.data_na_padaria()-39);

set local role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',true);
select is((select production_area from public.list_pj_production_queue_v2()
  where order_id='98000000-0000-4000-8000-000000000101'),'cozinha','fila encaminha montagem para cozinha');
select ok(exists(select 1 from public.list_pj_production_queue_v2()
  where order_id='98000000-0000-4000-8000-000000000101'),'pedido com entrega hoje aparece para resolucao');
select ok(not exists(select 1 from public.list_pj_production_queue_v2()
  where order_id='98000000-0000-4000-8000-000000000106'),
  'pedido legado vencido sem baixa nao volta como fantasma');
select is((select mapping_error from public.list_pj_production_queue_v2()
  where order_id='98000000-0000-4000-8000-000000000104'),
  'Area ainda sem tela de producao autorizada.','confeitaria continua bloqueada sem consumidor');
select ok((select mapping_error is null from public.list_pj_production_queue_v2()
  where order_id='98000000-0000-4000-8000-000000000105'),
  'produto inativado depois do pedido continua liberado para programacao');
select is((select catalog_warning from public.list_pj_production_queue_v2()
  where order_id='98000000-0000-4000-8000-000000000105'),
  'Produto inativo para novos pedidos. Este pedido antigo continua valido.',
  'fila explica por que o compromisso inativo permanece valido');
select lives_ok($$select public.schedule_pj_production(private.data_na_padaria(),
  '[{"order_id":"98000000-0000-4000-8000-000000000105","quantity":6,"frozen_quantity":0}]',
  '98000000-0000-4000-8000-000000000305')$$,'programa pedido aceito antes da inativacao');
select lives_ok($$select public.schedule_pj_production(private.data_na_padaria(),
  '[{"order_id":"98000000-0000-4000-8000-000000000101","quantity":4.125,"frozen_quantity":0}]',
  '98000000-0000-4000-8000-000000000301')$$,'programa peso para a Cozinha');
select lives_ok($$select public.schedule_pj_production(private.data_na_padaria(),
  '[{"order_id":"98000000-0000-4000-8000-000000000102","quantity":30,"frozen_quantity":0}]',
  '98000000-0000-4000-8000-000000000302')$$,'programa item que nao aceita producao livre');
reset role;
select is((select production_process from public.pj_production_schedules
  where order_id='98000000-0000-4000-8000-000000000101'),'montagem','programacao congela o processo');

set local role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000002',true);
select throws_ok($$select * from public.list_pj_production_queue_v2()$$,
  '42501','Usuario sem permissao para organizar a producao PJ.',
  'Cozinha nao consulta a fila geral de pedidos PJ');
select throws_ok($$select public.schedule_pj_production(private.data_na_padaria(),
  '[{"order_id":"98000000-0000-4000-8000-000000000103","quantity":1,"frozen_quantity":0}]',
  '98000000-0000-4000-8000-000000000309')$$,
  '42501','Usuario sem permissao para organizar a producao PJ.',
  'Cozinha nao programa pedidos PJ por chamada direta');
select throws_ok($$select * from public.list_kitchen_production_plan(
  'jc',private.data_na_padaria()-2)$$,
  '42501','A equipe da Cozinha consulta somente hoje e ontem.',
  'Cozinha nao amplia a janela de historico por chamada direta');
select is((select planned_quantity from public.list_kitchen_production_plan('jc',private.data_na_padaria())
  where product_id='98000000-0000-4000-8000-000000000011'),4.125::numeric,'Cozinha recebe o planejado por peso');
select lives_ok($$select public.record_kitchen_batches_v2('jc',
  '[{"product_id":"98000000-0000-4000-8000-000000000011","quantity":2.125}]',
  '98000000-0000-4000-8000-000000000401')$$,'registra peso com milésimos');
select is((select (public.record_kitchen_batches_v2('jc',
  '[{"product_id":"98000000-0000-4000-8000-000000000011","quantity":2.125}]',
  '98000000-0000-4000-8000-000000000401')->>'idempotent')::boolean),true,'repeticao confirma sem duplicar');
select is((select count(*)::int from public.kitchen_production
  where product_id='98000000-0000-4000-8000-000000000011'),1,'repeticao cria um unico lote');
select lives_ok($$select public.correct_kitchen_batch_v2(
  (select id from public.kitchen_production
    where product_id='98000000-0000-4000-8000-000000000011' limit 1),2.375)$$,
  'corrige lote vendido por peso com milésimos');
select is((select quantity from public.kitchen_production
  where product_id='98000000-0000-4000-8000-000000000011' limit 1),2.375::numeric,
  'correcao decimal persiste no lote');
select throws_ok($$select public.record_kitchen_batches_v2('jc',
  '[{"product_id":"98000000-0000-4000-8000-000000000012","quantity":1.5}]',
  '98000000-0000-4000-8000-000000000402')$$,'22023','Produto por unidade nao aceita fracao.','unidade recusa fracao');
select lives_ok($$select public.record_kitchen_batches_v2('jc',
  '[{"product_id":"98000000-0000-4000-8000-000000000012","quantity":12}]',
  '98000000-0000-4000-8000-000000000403')$$,'item planejado aceita realizado');
select lives_ok($$select public.record_kitchen_batches_v2('jc',
  '[{"product_id":"98000000-0000-4000-8000-000000000013","quantity":3}]',
  '98000000-0000-4000-8000-000000000404')$$,'produto livre nao exige ordem');

select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000003',true);
select is((select count(*)::int from public.kitchen_production
  where product_id='98000000-0000-4000-8000-000000000011'),1,'segunda pessoa ve o lote da equipe');
select lives_ok($$select public.record_kitchen_batches_v2('jc',
  '[{"product_id":"98000000-0000-4000-8000-000000000011","quantity":3}]',
  '98000000-0000-4000-8000-000000000405')$$,'producao pode ultrapassar o planejado');
select is((select produced_quantity from public.list_kitchen_production_plan('jc',private.data_na_padaria())
  where product_id='98000000-0000-4000-8000-000000000011'),5.375::numeric,'painel mostra o excedente real da equipe');

reset role;
select ok(not exists(select 1 from public.stock_movements
  where product_id='98000000-0000-4000-8000-000000000011'),
  'programar e registrar Cozinha nao inventa movimento de estoque');
select is((select count(*)::int from public.orders
  where customer_id='98000000-0000-4000-8000-000000000020'),6,
  'programacao nao cria ordens automaticas de componentes');
update public.products set active=false where id='98000000-0000-4000-8000-000000000011';
set local role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000003',true);
select lives_ok($$select public.record_kitchen_batches_v2('jc',
  '[{"product_id":"98000000-0000-4000-8000-000000000011","quantity":1}]',
  '98000000-0000-4000-8000-000000000406')$$,'inativacao posterior nao interrompe plano aceito');
select is((select product_name from public.kitchen_production
  where product_id='98000000-0000-4000-8000-000000000011' order by produced_at desc limit 1),
  '[TESTE] Pizza kg','historico conserva fotografia do produto');
select ok(not exists(select 1 from public.list_kitchen_production_plan('jc',private.data_na_padaria())
  where product_id='98000000-0000-4000-8000-000000000014'),'produto de forno nao aparece na Cozinha');

select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000004',true);
select throws_ok($$select * from public.list_kitchen_production_plan('jc',private.data_na_padaria())$$,
  '42501','Sem permissao para consultar a producao desta loja.','Vendas nao consulta producao da Cozinha');
select throws_ok($$select public.record_kitchen_batches_v2('jc',
  '[{"product_id":"98000000-0000-4000-8000-000000000013","quantity":1}]',
  '98000000-0000-4000-8000-000000000407')$$,
  '42501','Sem permissao para lancar a producao nesta loja.','Vendas nao registra producao');
select throws_ok($$select * from public.list_pj_production_queue_v2()$$,
  '42501','Usuario sem permissao para organizar a producao PJ.','Vendas nao abre fila PJ');

select * from finish();
rollback;
