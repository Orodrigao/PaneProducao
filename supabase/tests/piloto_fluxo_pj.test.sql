begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Isolado das fixtures do preview e dos testes da cobrança legada.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin)
select ('97000000-0000-4000-8000-00000000000'||n)::uuid,
  '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'piloto-fase2-'||n||'@example.com','',now(),now(),now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,false
from generate_series(1,5) n;
insert into public.app_profiles(user_id,display_name,role,store,active,allowed_routes)
values
 ('97000000-0000-4000-8000-000000000001','Piloto Financeiro','financeiro','jc',true,'["/pedidos-pj"]'),
 ('97000000-0000-4000-8000-000000000002','Piloto Expedição','expedicao','jc',true,'["/pedidos-pj"]'),
 ('97000000-0000-4000-8000-000000000003','Piloto Vendas','vendas','ja',true,'["/sobras"]'),
 ('97000000-0000-4000-8000-000000000004','Piloto Admin sem concessão','admin','jc',true,'["/pedidos-pj"]'),
 ('97000000-0000-4000-8000-000000000005','Piloto Expedição EX','expedicao','ex',true,'["/pedidos-pj"]');
insert into public.app_user_permissions(user_id,permission_key,scope)
select '97000000-0000-4000-8000-000000000001',key,'jc'
from unnest(array['pedidos_pj.acessar','pedidos_pj.liberar','contas_receber.acessar','contas_receber.lancar',
  'contas_receber.baixar','contas_receber.cancelar','contas_receber.corrigir_vencimento']) key;
insert into public.app_user_permissions(user_id,permission_key,scope)
select ('97000000-0000-4000-8000-00000000000'||n)::uuid,key,'jc'
from unnest(array['pedidos_pj.acessar','pedidos_pj.confirmar_envio']) key cross join (values(2),(5)) a(n);
insert into public.customers(id,name,doc,payment_term_days,active)
values ('97000000-0000-4000-8000-000000000010','[TESTE] Cliente Piloto Isolado','00000000000097',7,true);
insert into public.breads(id,name,days,active,unit,is_special,is_shelf)
values ('teste-piloto-isolado','[TESTE] Brioche Piloto','{0,1,2,3,4,5,6}',true,'un',false,false);
insert into public.orders(id,store,order_type,order_group_id,bread_id,product_source,product_name,
 quantity,unit_price,pack_size,pricing_unit,customer_id,pj_client,order_date,delivery_date,pj_delivery_date,needs_production)
select ('97000000-0000-4000-8000-00000000010'||n)::uuid,'pj','pj',
 ('97000000-0000-4000-8000-00000000020'||n)::uuid,'teste-piloto-isolado','bread','[TESTE] Brioche Piloto',
 40,5,1,'un','97000000-0000-4000-8000-000000000010','[TESTE] Cliente Piloto Isolado',
 private.data_na_padaria(),private.data_na_padaria()+2,private.data_na_padaria()+2,false
from generate_series(1,3) n;
insert into private.pj_flow(order_group_id) values
 ('97000000-0000-4000-8000-000000000201'),('97000000-0000-4000-8000-000000000202');

create function pg_temp.act(a text,v integer,i jsonb default '[]',r uuid default gen_random_uuid(),nf boolean default false,t integer default null)
returns jsonb language sql as $$
 select public.transition_pj_flow_pilot(r,'97000000-0000-4000-8000-000000000201',v,a,i,nf,t);
$$;

select ok(not has_table_privilege('authenticated','private.pj_flow','insert'),'inscrição não é acessível ao navegador');
select ok(not has_table_privilege('authenticated','private.pj_flow_events','select'),'eventos internos não expõem payload');
select ok(not has_function_privilege('anon','public.read_pj_flow_pilot()','execute'),'anon não consulta piloto');
select is((select count(*)::int from private.pj_flow where order_group_id='97000000-0000-4000-8000-000000000203'),0,'legado não foi inscrito automaticamente');

set local role authenticated;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000003',true);
select throws_ok('select public.read_pj_flow_pilot()','42501',null,'Vendas não lê o piloto');
select is((select count(*)::int from public.orders where order_group_id='97000000-0000-4000-8000-000000000201'),0,'Vendas não contorna pela tabela de pedidos');
select throws_ok($q$select pg_temp.act('check',0)$q$,'42501',null,'Vendas não conclui conferência');
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000004',true);
select throws_ok('select public.read_pj_flow_pilot()','42501',null,'admin sem concessão não recebe passe livre novo');
select is((select count(*)::int from public.orders where order_group_id='97000000-0000-4000-8000-000000000201'),0,'admin sem concessão não lê preço piloto direto');
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000005',true);
select throws_ok($q$select pg_temp.act('check',0)$q$,'42501',null,'Expedição EX bloqueada mesmo com concessão JC');
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true);
select ok(public.read_pj_flow_pilot()::text not like '%"price"%','Expedição não recebe preços na resposta');
select ok(public.read_pj_flow_pilot()::text not like '%approved_amount%','Expedição não recebe valores aprovados');
select is((select count(*)::int from public.orders where order_group_id='97000000-0000-4000-8000-000000000201'),0,'Expedição não lê valores pela tabela');
select throws_ok($q$select pg_temp.act('release',0,'[]',gen_random_uuid(),true,7)$q$,'42501',null,'Expedição não libera cobrança');
select throws_ok($q$select pg_temp.act('depart',0)$q$,'22023',null,'saída bloqueada antes de Elis');
select throws_ok($q$select pg_temp.act('check',0)$q$,'22023',null,'conferência incompleta não conclui');
select lives_ok($q$select pg_temp.act('save',0,'[{"id":"97000000-0000-4000-8000-000000000101","quantity":38,"reason":"Dois não ficaram disponíveis"}]','97000000-0000-4000-8000-000000000301')$q$,'salva 38 de 40 sem gerar saldo');
select lives_ok($q$select pg_temp.act('save',0,'[{"id":"97000000-0000-4000-8000-000000000101","quantity":38,"reason":"Dois não ficaram disponíveis"}]','97000000-0000-4000-8000-000000000301')$q$,'resposta perdida: repetir mesmo pedido não duplica');
select throws_ok($q$select pg_temp.act('save',0,'[{"id":"97000000-0000-4000-8000-000000000101","quantity":37}]','97000000-0000-4000-8000-000000000301')$q$,'22023',null,'mesmo ID com conteúdo diferente é recusado');
select throws_ok($q$select pg_temp.act('check',0)$q$,'40001',null,'segundo celular com versão antiga é recusado');
select lives_ok($q$select pg_temp.act('check',1)$q$,'conclui conferência sem faturar');
select throws_ok($q$select public.confirm_pj_order_dispatch('97000000-0000-4000-8000-000000000201')$q$,'42501',null,'site antigo não marca despacho em pedido novo');
reset role;
select is((select count(*)::int from public.receivables where origin_ref='97000000-0000-4000-8000-000000000201'),0,'conferência não criou cobrança');
select is((select count(*)::int from public.orders where order_group_id='97000000-0000-4000-8000-000000000201'),1,'não criou pedido complementar');
select ok((select dispatched_at is null from public.orders where id='97000000-0000-4000-8000-000000000101'),'não inventa carimbo legado');
set local role authenticated;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',true);
select ok(public.read_pj_flow_pilot()::text like '%"price"%','Financeiro autorizado lê preços');
select throws_ok($q$select public.create_receivable_from_pj_order(gen_random_uuid(),'97000000-0000-4000-8000-000000000201')$q$,'42501',null,'geração antiga não contorna a revisão');
select throws_ok($q$update public.orders set unit_price=1 where id='97000000-0000-4000-8000-000000000101'$q$,'42501',null,'preço não muda fora do contrato');
select throws_ok($q$update public.orders set order_group_id=gen_random_uuid() where id='97000000-0000-4000-8000-000000000101'$q$,'42501',null,'não move item para escapar do piloto');
select throws_ok($q$select pg_temp.act('release',2,'[]',gen_random_uuid(),false,7)$q$,'22023',null,'NF externa precisa ser confirmada');
select throws_ok($q$select pg_temp.act('release',2,'[]',gen_random_uuid(),true,8)$q$,'40001',null,'prazo divergente do revisado exige recarga');
select lives_ok($q$select pg_temp.act('release',2,'[]','97000000-0000-4000-8000-000000000302',true,7)$q$,'Elis confirma cobrança e libera');
select lives_ok($q$select pg_temp.act('release',2,'[]','97000000-0000-4000-8000-000000000302',true,7)$q$,'duplo toque na liberação é idempotente');
reset role;
select is((select count(*)::int from public.receivables where origin_ref='97000000-0000-4000-8000-000000000201'),1,'uma única cobrança após repetição');
select is((select amount from public.receivables where origin_ref='97000000-0000-4000-8000-000000000201'),190.00,'cobra 38 unidades');
select is((select due_date from public.receivables where origin_ref='97000000-0000-4000-8000-000000000201'),private.data_na_padaria()+9,'prazo começa na entrega combinada, dois dias depois da revisão');
select ok((select departed_at is null from private.pj_flow where order_group_id='97000000-0000-4000-8000-000000000201'),'liberar não registra saída física');
set local role authenticated;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true);
select lives_ok($q$select pg_temp.act('save',3,'[{"id":"97000000-0000-4000-8000-000000000101","quantity":37,"reason":"Nova contagem"}]')$q$,'correção depois de liberar é registrada');
select throws_ok($q$select pg_temp.act('depart',4)$q$,'22023',null,'correção bloqueia novamente saída');
select lives_ok($q$select pg_temp.act('check',4)$q$,'conclui nova conferência');
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',true);
select throws_ok($q$select pg_temp.act('release',2,'[]',gen_random_uuid(),true,7)$q$,'40001',null,'revisão anterior não libera versão corrigida');
select lives_ok($q$select pg_temp.act('release',5,'[]',gen_random_uuid(),true,7)$q$,'Elis refaz cobrança e liberação');
reset role;
select is((select count(*)::int from public.receivables where origin_ref='97000000-0000-4000-8000-000000000201' and status<>'cancelada'),1,'uma cobrança viva após correção');
select is((select amount from public.receivables where origin_ref='97000000-0000-4000-8000-000000000201' and status<>'cancelada'),185.00,'valor corrigido');
select is((select count(*)::int from public.receivables where origin_ref='97000000-0000-4000-8000-000000000201' and status='cancelada'),1,'cobrança anterior preservada no histórico');
set local role authenticated;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true);
select lives_ok($q$select pg_temp.act('depart',6,'[]','97000000-0000-4000-8000-000000000303')$q$,'Expedição registra saída depois de nova liberação');
select lives_ok($q$select pg_temp.act('depart',6,'[]','97000000-0000-4000-8000-000000000303')$q$,'repetição de saída não duplica evento');
select throws_ok($q$select pg_temp.act('save',6,'[{"id":"97000000-0000-4000-8000-000000000101","quantity":36}]')$q$,'22023',null,'correção após saída não é inventada nesta fase');
reset role;
select is((select count(*)::int from private.pj_flow_events where order_group_id='97000000-0000-4000-8000-000000000201' and action='depart'),1,'um único evento físico');
select ok((select dispatched_at is null from public.orders where id='97000000-0000-4000-8000-000000000101'),'saída nova não adultera carimbo legado');

-- Zero não encerra automaticamente. Falha no segundo item desfaz o primeiro.
set local role authenticated;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true);
select throws_ok($q$select public.transition_pj_flow_pilot(gen_random_uuid(),'97000000-0000-4000-8000-000000000202',0,'save',
 '[{"id":"97000000-0000-4000-8000-000000000102","quantity":0,"reason":"Sem unidades disponíveis"},{"id":"97000000-0000-4000-8000-000000000103","quantity":20}]')$q$,'22023',null,'falha de um item desfaz toda a tentativa');
reset role;
select ok((select dispatched_quantity is null from public.orders where id='97000000-0000-4000-8000-000000000102'),'primeiro item não ficou gravado pela metade');
select is((select version from private.pj_flow where order_group_id='97000000-0000-4000-8000-000000000202'),0,'falha não avança versão');
set local role authenticated;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true);
select lives_ok($q$select public.transition_pj_flow_pilot(gen_random_uuid(),'97000000-0000-4000-8000-000000000202',0,'save',
 '[{"id":"97000000-0000-4000-8000-000000000102","quantity":0,"reason":"Sem unidades disponíveis"}]')$q$,'zero pode ser conferido');
select lives_ok($q$select public.transition_pj_flow_pilot(gen_random_uuid(),'97000000-0000-4000-8000-000000000202',1,'check')$q$,'conferência zero mantém compromisso');
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',true);
select throws_ok($q$select public.transition_pj_flow_pilot(gen_random_uuid(),'97000000-0000-4000-8000-000000000202',2,'release','[]',true,7)$q$,'22023',null,'zero não vira cobrança ou saída');
reset role;
select ok((select cancelled_at is null from public.orders where id='97000000-0000-4000-8000-000000000102'),'zero não cancela pedido');
select ok((select released_at is null from private.pj_flow where order_group_id='97000000-0000-4000-8000-000000000202'),'zero continua bloqueado e pendente');

-- Recebimento real permanece intacto quando aparece uma correção antes da saída.
set local role authenticated;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true);
select lives_ok($q$select public.transition_pj_flow_pilot(gen_random_uuid(),'97000000-0000-4000-8000-000000000202',2,'save',
 '[{"id":"97000000-0000-4000-8000-000000000102","quantity":40,"reason":null}]')$q$,'compromisso zero pode voltar à conferência');
select lives_ok($q$select public.transition_pj_flow_pilot(gen_random_uuid(),'97000000-0000-4000-8000-000000000202',3,'check')$q$,'conclui quantidades disponíveis');
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',true);
select lives_ok($q$select public.transition_pj_flow_pilot(gen_random_uuid(),'97000000-0000-4000-8000-000000000202',4,'release','[]',true,7)$q$,'libera pedido que será pago antes de sair');
select lives_ok($q$select public.record_receivable_receipt(gen_random_uuid(),
 (select id from public.receivables where origin_ref='97000000-0000-4000-8000-000000000202' and status<>'cancelada'),
 private.data_na_padaria(),200,'pix','banco_sicredi_jc')$q$,'pagamento antecipado usa o recebimento existente');
select throws_ok($q$select public.cancel_receivable(gen_random_uuid(),
 (select id from public.receivables where origin_ref='97000000-0000-4000-8000-000000000202' and status<>'cancelada'),'Teste de contorno')$q$,
 '22023',null,'cobrança paga não é cancelada');
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true);
select lives_ok($q$select public.transition_pj_flow_pilot(gen_random_uuid(),'97000000-0000-4000-8000-000000000202',5,'save',
 '[{"id":"97000000-0000-4000-8000-000000000102","quantity":38,"reason":"Correção depois do pagamento"}]')$q$,'pagamento não impede registrar a quantidade correta');
select throws_ok($q$select public.transition_pj_flow_pilot(gen_random_uuid(),'97000000-0000-4000-8000-000000000202',6,'depart')$q$,
 '22023',null,'quantidade corrigida de pedido pago também bloqueia saída');
select lives_ok($q$select public.transition_pj_flow_pilot(gen_random_uuid(),'97000000-0000-4000-8000-000000000202',6,'check')$q$,'nova conferência registrada');
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',true);
select throws_ok($q$select public.transition_pj_flow_pilot(gen_random_uuid(),'97000000-0000-4000-8000-000000000202',7,'release','[]',true,7)$q$,
 '22023',null,'sem procedimento da diferença, nova liberação fica bloqueada');
select is((select sum(rr.amount) from public.receivable_receipts rr join public.receivables r on r.id=rr.receivable_id
 where r.origin_ref='97000000-0000-4000-8000-000000000202' and rr.reversed_at is null),200.00,'Pix real não foi apagado nem estornado');
select is((select count(*)::int from public.receivables where origin_ref='97000000-0000-4000-8000-000000000202'),1,'revisão recusada não substituiu cobrança paga');
reset role;
select ok((select released_at is null from private.pj_flow where order_group_id='97000000-0000-4000-8000-000000000202'),'falha não gravou meia liberação');

-- O mesmo banco novo continua atendendo o site antigo em pedidos não inscritos.
set local role authenticated;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true);
select lives_ok($q$select public.save_pj_order_dispatch_quantities(gen_random_uuid(),
 '97000000-0000-4000-8000-000000000203','[{"order_id":"97000000-0000-4000-8000-000000000103","quantity":40,"reason":null}]',null)$q$,'site antigo confere pedido legado');
select lives_ok($q$select public.confirm_pj_order_dispatch('97000000-0000-4000-8000-000000000203')$q$,'site antigo continua confirmando legado');
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',true);
select lives_ok($q$select public.record_receivable_receipt(gen_random_uuid(),
 (select id from public.receivables where origin_ref='97000000-0000-4000-8000-000000000203'),
 private.data_na_padaria(),50,'pix','banco_sicredi_jc')$q$,'legado mantém pagamento parcial');
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true);
select lives_ok($q$select public.confirm_pj_order_dispatch('97000000-0000-4000-8000-000000000203')$q$,'repetir confirmação legada preserva cobrança');
reset role;
select is((select count(*)::int from public.receivables where origin_ref='97000000-0000-4000-8000-000000000203'),1,'legado continua com uma cobrança');
select is((select sum(rr.amount) from public.receivable_receipts rr join public.receivables r on r.id=rr.receivable_id
 where r.origin_ref='97000000-0000-4000-8000-000000000203' and rr.reversed_at is null),50.00,'pagamento legado preservado');
select ok(not exists(select 1 from private.pj_flow where order_group_id='97000000-0000-4000-8000-000000000203'),'nenhuma liberação ou saída nova inventada para legado');
select * from finish();
rollback;
