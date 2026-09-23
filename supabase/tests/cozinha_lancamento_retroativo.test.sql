begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- Lançamento retroativo da Produção da Cozinha: a equipe escolhe o dia entre
-- hoje e 31 dias atrás, admin escolhe qualquer dia passado, ninguém lança no
-- futuro e o instante real do lançamento continua carimbado pelo servidor.

select ok(has_function_privilege('authenticated',
  'public.record_kitchen_batches_v3(text,jsonb,uuid,date)', 'execute'),
  'gravacao com dia escolhido e executavel por quem entrou');
select ok(not has_function_privilege('anon',
  'public.record_kitchen_batches_v3(text,jsonb,uuid,date)', 'execute'),
  'visitante sem login nao grava');
select ok(not has_function_privilege('authenticated',
  'private.record_kitchen_batches_impl(text,jsonb,uuid,date)', 'execute'),
  'a implementacao privada nao e chamada direto');
select ok(not exists(select 1 from pg_constraint where conname = 'kitchen_production_server_date'),
  'a trava antiga do dia do clique saiu');

insert into auth.users(id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
values
  ('99100000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','retro-planner@example.com','x',now(),now(),now(),'{}','{}',false),
  ('99100000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','retro-cozinha@example.com','x',now(),now(),now(),'{}','{}',false),
  ('99100000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','retro-admin@example.com','x',now(),now(),now(),'{}','{}',false),
  ('99100000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','retro-vendas@example.com','x',now(),now(),now(),'{}','{}',false);
insert into public.app_profiles(user_id,display_name,role,store,active,allowed_routes) values
  ('99100000-0000-4000-8000-000000000001','Planejador Retro','producao','jc',true,'["/"]'),
  ('99100000-0000-4000-8000-000000000002','Cozinha Retro','producao','jc',true,'["/producao-cozinha"]'),
  ('99100000-0000-4000-8000-000000000003','Admin Retro','admin','jc',true,'["/"]'),
  ('99100000-0000-4000-8000-000000000004','Vendas Retro','vendas','ja',true,'["/pedidos-pj"]');
insert into public.app_user_permissions(user_id,permission_key,scope) values
  ('99100000-0000-4000-8000-000000000001','producao_pj.programar','jc'),
  ('99100000-0000-4000-8000-000000000002','producao_cozinha.lancar','jc');

insert into public.products(id,name,category,active,unit,kind,is_fabricacao_propria,is_pj,
  production_area,production_process,allows_planned_production,allows_unplanned_production)
values
  ('99100000-0000-4000-8000-000000000011','[TESTE] Bruschetta retro','Bruschetta',true,'un','final',true,true,'cozinha','montagem',false,true),
  ('99100000-0000-4000-8000-000000000012','[TESTE] Pastinha so planejada','Pastas',true,'un','final',true,true,'cozinha','preparo',true,false);
insert into public.customers(id,name,doc,active)
values ('99100000-0000-4000-8000-000000000020','[TESTE] Cliente Retro','99100000000100',true);
insert into public.orders(id,store,order_type,order_group_id,bread_id,product_source,product_name,
  quantity,pricing_unit,customer_id,pj_client,order_date,delivery_date,pj_delivery_date)
values
  ('99100000-0000-4000-8000-000000000101','pj','pj','99100000-0000-4000-8000-000000000201','99100000-0000-4000-8000-000000000012','product','[TESTE] Pastinha so planejada',20,'un','99100000-0000-4000-8000-000000000020','[TESTE] Cliente Retro',private.data_na_padaria()-1,private.data_na_padaria(),private.data_na_padaria());

set local role authenticated;
select set_config('request.jwt.claim.sub','99100000-0000-4000-8000-000000000001',true);
select lives_ok($$select public.schedule_pj_production(private.data_na_padaria(),
  '[{"order_id":"99100000-0000-4000-8000-000000000101","quantity":20,"frozen_quantity":0}]',
  '99100000-0000-4000-8000-000000000301')$$,'planejador programa a pastinha para hoje');

-- Equipe da Cozinha.
select set_config('request.jwt.claim.sub','99100000-0000-4000-8000-000000000002',true);
select lives_ok($$select public.record_kitchen_batches_v3('jc',
  '[{"product_id":"99100000-0000-4000-8000-000000000011","quantity":4}]',
  '99100000-0000-4000-8000-000000000401', private.data_na_padaria()-1)$$,
  'equipe lanca a producao de ontem');
select is((select record_date from public.kitchen_production
  where product_id='99100000-0000-4000-8000-000000000011' and quantity=4),
  private.data_na_padaria()-1, 'o lote fica no dia escolhido');
select is((select private.data_na_padaria(produced_at) from public.kitchen_production
  where product_id='99100000-0000-4000-8000-000000000011' and quantity=4),
  private.data_na_padaria(), 'o instante do lancamento continua sendo o de agora');
select is((select (public.record_kitchen_batches_v3('jc',
  '[{"product_id":"99100000-0000-4000-8000-000000000011","quantity":4}]',
  '99100000-0000-4000-8000-000000000401', private.data_na_padaria()-1)->>'idempotent')::boolean),
  true, 'repetir o mesmo salvamento confirma sem duplicar');
select throws_ok($$select public.record_kitchen_batches_v3('jc',
  '[{"product_id":"99100000-0000-4000-8000-000000000011","quantity":4}]',
  '99100000-0000-4000-8000-000000000401', private.data_na_padaria()-2)$$,
  '22023','Este salvamento repetido chegou com valores diferentes.',
  'o mesmo salvamento nao muda de dia na repeticao');
select lives_ok($$select public.record_kitchen_batches_v3('jc',
  '[{"product_id":"99100000-0000-4000-8000-000000000011","quantity":5}]',
  '99100000-0000-4000-8000-000000000402', private.data_na_padaria()-31)$$,
  'equipe lanca ate 31 dias atras');
select throws_ok($$select public.record_kitchen_batches_v3('jc',
  '[{"product_id":"99100000-0000-4000-8000-000000000011","quantity":6}]',
  '99100000-0000-4000-8000-000000000403', private.data_na_padaria()-32)$$,
  '42501','A equipe da Cozinha lanca somente ate 31 dias atras.',
  'equipe nao lanca alem de 31 dias');
select throws_ok($$select public.record_kitchen_batches_v3('jc',
  '[{"product_id":"99100000-0000-4000-8000-000000000011","quantity":6}]',
  '99100000-0000-4000-8000-000000000404', private.data_na_padaria()+1)$$,
  '22023','Nao da para lancar producao de dia futuro.',
  'equipe nao lanca dia futuro');
select throws_ok($$select public.record_kitchen_batches_v3('jc',
  '[{"product_id":"99100000-0000-4000-8000-000000000011","quantity":6}]',
  '99100000-0000-4000-8000-000000000405', null)$$,
  '22023','Informe o dia da producao.','dia vazio e recusado');
select lives_ok($$select public.record_kitchen_batches_v3('jc',
  '[{"product_id":"99100000-0000-4000-8000-000000000012","quantity":8}]',
  '99100000-0000-4000-8000-000000000406', private.data_na_padaria())$$,
  'item so planejado aceita lancamento no dia em que foi programado');
select throws_ok($$select public.record_kitchen_batches_v3('jc',
  '[{"product_id":"99100000-0000-4000-8000-000000000012","quantity":8}]',
  '99100000-0000-4000-8000-000000000407', private.data_na_padaria()-1)$$,
  '23503','Produto nao esta liberado para producao livre na cozinha.',
  'o planejado conferido e o do dia escolhido, nao o de hoje');
select is((select produced_quantity from public.list_kitchen_production_plan('jc',private.data_na_padaria())
  where product_id='99100000-0000-4000-8000-000000000012'),8::numeric,
  'planejado x feito soma o lote no dia certo');
select lives_ok($$select * from public.list_kitchen_production_plan('jc',private.data_na_padaria()-31)$$,
  'equipe consulta o planejado de 31 dias atras');
select lives_ok($$select public.record_kitchen_batches_v2('jc',
  '[{"product_id":"99100000-0000-4000-8000-000000000011","quantity":7}]',
  '99100000-0000-4000-8000-000000000408')$$,'o site anterior continua gravando hoje');
select is((select record_date from public.kitchen_production
  where product_id='99100000-0000-4000-8000-000000000011' and quantity=7),
  private.data_na_padaria(), 'a ponte antiga grava no dia de hoje');

-- Admin lança qualquer dia passado.
select set_config('request.jwt.claim.sub','99100000-0000-4000-8000-000000000003',true);
select lives_ok($$select public.record_kitchen_batches_v3('jc',
  '[{"product_id":"99100000-0000-4000-8000-000000000011","quantity":9}]',
  '99100000-0000-4000-8000-000000000409', private.data_na_padaria()-60)$$,
  'admin lanca historico antigo');
select throws_ok($$select public.record_kitchen_batches_v3('jc',
  '[{"product_id":"99100000-0000-4000-8000-000000000011","quantity":9}]',
  '99100000-0000-4000-8000-000000000410', private.data_na_padaria()+1)$$,
  '22023','Nao da para lancar producao de dia futuro.','nem admin lanca dia futuro');
select is((select count(*)::int from public.kitchen_production
  where product_id='99100000-0000-4000-8000-000000000011'),4,'admin enxerga os quatro lotes');

-- A equipe enxerga a janela de 31 dias, sem o lote de 60 dias atrás.
select set_config('request.jwt.claim.sub','99100000-0000-4000-8000-000000000002',true);
select is((select count(*)::int from public.kitchen_production
  where product_id='99100000-0000-4000-8000-000000000011'),3,
  'equipe le os lotes dos ultimos 31 dias e nao o historico antigo');

-- Sem permissão da Cozinha continua bloqueado.
select set_config('request.jwt.claim.sub','99100000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.record_kitchen_batches_v3('jc',
  '[{"product_id":"99100000-0000-4000-8000-000000000011","quantity":1}]',
  '99100000-0000-4000-8000-000000000411', private.data_na_padaria()-1)$$,
  '42501','Sem permissao para lancar a producao nesta loja.','vendas nao lanca producao retroativa');
select is((select count(*)::int from public.kitchen_production
  where product_id='99100000-0000-4000-8000-000000000011'),0,'vendas nao le a producao da cozinha');

reset role;
select throws_ok($$insert into public.kitchen_production(store,product_id,record_date,quantity,
  recorded_by,produced_at) values ('jc','99100000-0000-4000-8000-000000000011',
  private.data_na_padaria()+1,1,'99100000-0000-4000-8000-000000000003',now())$$,
  '23514',null,'a tabela recusa dia de producao depois do lancamento');

select * from finish();
rollback;
