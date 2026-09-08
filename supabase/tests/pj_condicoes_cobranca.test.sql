begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Isolado das fixtures do preview e dos testes da cobrança legada.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin)
select ('98000000-0000-4000-8000-00000000000'||n)::uuid,
  '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'pj-condicoes-'||n||'@example.com','',now(),now(),now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,false
from generate_series(1,5) n;
insert into public.app_profiles(user_id,display_name,role,store,active,allowed_routes)
values
 ('98000000-0000-4000-8000-000000000001','Piloto Financeiro','financeiro','jc',true,'["/pedidos-pj"]'),
 ('98000000-0000-4000-8000-000000000002','Piloto Expedição','expedicao','jc',true,'["/pedidos-pj"]'),
 ('98000000-0000-4000-8000-000000000003','Piloto Vendas','vendas','ja',true,'["/sobras"]'),
 ('98000000-0000-4000-8000-000000000004','Piloto Admin sem concessão','admin','jc',true,'["/pedidos-pj"]'),
 ('98000000-0000-4000-8000-000000000005','Piloto Expedição EX','expedicao','ex',true,'["/pedidos-pj"]');
insert into public.app_user_permissions(user_id,permission_key,scope)
select '98000000-0000-4000-8000-000000000001',key,'jc'
from unnest(array['pedidos_pj.acessar','pedidos_pj.liberar','contas_receber.acessar','contas_receber.lancar',
  'contas_receber.baixar','contas_receber.cancelar','contas_receber.corrigir_vencimento']) key;
insert into public.app_user_permissions(user_id,permission_key,scope)
select ('98000000-0000-4000-8000-00000000000'||n)::uuid,key,'jc'
from unnest(array['pedidos_pj.acessar','pedidos_pj.confirmar_envio']) key cross join (values(2),(5)) a(n);
insert into public.customers(id,name,doc,payment_term_days,active)
values ('98000000-0000-4000-8000-000000000010','[TESTE] Cliente Piloto Isolado','00000000000098',7,true);
insert into public.breads(id,name,days,active,unit,is_special,is_shelf)
values ('teste-condicoes-isolado','[TESTE] Brioche Piloto','{0,1,2,3,4,5,6}',true,'un',false,false);
insert into public.orders(id,store,order_type,order_group_id,bread_id,product_source,product_name,
 quantity,unit_price,pack_size,pricing_unit,customer_id,pj_client,order_date,delivery_date,pj_delivery_date,needs_production)
select ('98000000-0000-4000-8000-00000000010'||n)::uuid,'pj','pj',
 ('98000000-0000-4000-8000-00000000020'||n)::uuid,'teste-condicoes-isolado','bread','[TESTE] Brioche Piloto',
 40,5,1,'un','98000000-0000-4000-8000-000000000010','[TESTE] Cliente Piloto Isolado',
 private.data_na_padaria(),private.data_na_padaria()+2,private.data_na_padaria()+2,false
from generate_series(1,3) n;
insert into private.pj_flow(order_group_id) values
 ('98000000-0000-4000-8000-000000000201'),('98000000-0000-4000-8000-000000000202');

create function pg_temp.act(a text,v integer,i jsonb default '[]',r uuid default gen_random_uuid(),nf boolean default false,t integer default null)
returns jsonb language sql as $$
 select public.transition_pj_flow_pilot(r,'98000000-0000-4000-8000-000000000201',v,a,i,nf,t);
$$;


create function pg_temp.terms(a text,v integer,d date default null,n integer default null,r uuid default gen_random_uuid())
returns jsonb language sql as $$
 select public.change_pj_flow_terms(r,'98000000-0000-4000-8000-000000000201',v,a,
   (select id from public.receivables where origin_ref='98000000-0000-4000-8000-000000000201'
     and status<>'cancelada' and installment_number=1),d,n,'Acordo com cliente');
$$;
select ok(not has_function_privilege('anon','public.change_pj_flow_terms(uuid,uuid,integer,text,uuid,date,integer,text)','execute'),'anon não altera condições');
set local role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000002',true);
select lives_ok($q$select pg_temp.act('save',0,'[{"id":"98000000-0000-4000-8000-000000000101","quantity":38,"reason":"Dois indisponíveis"}]')$q$,'confere 38');
select lives_ok($q$select pg_temp.act('check',1)$q$,'conclui conferência');
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',true);
select lives_ok($q$select pg_temp.act('release',2,'[]',gen_random_uuid(),true,7)$q$,'libera 190 reais');
select lives_ok($q$select pg_temp.terms('due',3,private.data_na_padaria()+16,null,'98000000-0000-4000-8000-000000000401')$q$,'prorroga vencimento');
select lives_ok($q$select pg_temp.terms('due',3,private.data_na_padaria()+16,null,'98000000-0000-4000-8000-000000000401')$q$,'repetição da prorrogação é idempotente');
select throws_ok($q$select pg_temp.terms('due',3,private.data_na_padaria()+17,null,'98000000-0000-4000-8000-000000000401')$q$,'22023',null,'ID não aceita outro acordo');
select throws_ok($q$select pg_temp.terms('split',3,null,3)$q$,'40001',null,'versão antiga bloqueia parcela');
select throws_ok($q$select pg_temp.terms('due',4,private.data_na_padaria()+8)$q$,'22023',null,'data antes da original bloqueada');
select lives_ok($q$select pg_temp.terms('split',4,null,3,'98000000-0000-4000-8000-000000000402')$q$,'divide em três desde a entrega combinada');
select lives_ok($q$select pg_temp.terms('split',4,null,3,'98000000-0000-4000-8000-000000000402')$q$,'repetição não duplica parcelas');
select is((select sum(amount) from public.receivables where origin_ref='98000000-0000-4000-8000-000000000201' and status<>'cancelada'),190.00,'soma permanece 190');
select is((select amount from public.receivables where origin_ref='98000000-0000-4000-8000-000000000201' and status<>'cancelada' and installment_number=1),63.34,'centavos na primeira');
select is((select due_date from public.receivables where origin_ref='98000000-0000-4000-8000-000000000201' and status<>'cancelada' and installment_number=1),private.data_na_padaria()+7,'primeira data conta da entrega e usa prazo prorrogado');
select lives_ok($q$select pg_temp.terms('due',5,private.data_na_padaria()+8)$q$,'acordo individual na primeira parcela');
reset role;
select ok((select released_version=version and released_at is not null from private.pj_flow where order_group_id='98000000-0000-4000-8000-000000000201'),'vencimento e parcelas mantêm liberação');
select is((select count(*)::int from private.pj_flow_events where action in ('due','split')),3,'uma ocorrência por alteração');
create temporary table accepted as select installment_number,due_date,original_due_date from public.receivables
 where origin_ref='98000000-0000-4000-8000-000000000201' and status<>'cancelada';
set local role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000002',true);
select ok(public.read_pj_flow_pilot()::text not like '%financial_history%','Expedição não recebe acordos financeiros');
select ok(public.read_pj_flow_pilot()::text not like '%"bills"%','Expedição não recebe parcelas');
select throws_ok($q$select public.change_pj_flow_terms(gen_random_uuid(),'98000000-0000-4000-8000-000000000201',6,'due',gen_random_uuid(),current_date,null,'Novo acordo')$q$,'42501',null,'Expedição não altera vencimento');
select lives_ok($q$select pg_temp.act('save',6,'[{"id":"98000000-0000-4000-8000-000000000101","quantity":37,"reason":"Mais um indisponível"}]')$q$,'correção reabre revisão');
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',true);
select lives_ok($q$select pg_temp.terms('due',7,private.data_na_padaria()+9)$q$,'data pode ser corrigida durante pendência');
reset role;
select ok((select released_at is null and released_version is null from private.pj_flow where order_group_id='98000000-0000-4000-8000-000000000201'),'mudar data não desbloqueia quantidade pendente');
update accepted set due_date=private.data_na_padaria()+9 where installment_number=1;
set local role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000002',true);
select throws_ok($q$select pg_temp.act('depart',8)$q$,'22023',null,'saída continua bloqueada');
select lives_ok($q$select pg_temp.act('check',8)$q$,'conclui nova conferência');
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',true);
select lives_ok($q$select pg_temp.act('release',9,'[]',gen_random_uuid(),true,7)$q$,'nova revisão preserva plano aceito');
select is((select sum(amount) from public.receivables where origin_ref='98000000-0000-4000-8000-000000000201' and status<>'cancelada'),185.00,'corrige valor conferido');
reset role;
select results_eq($q$select installment_number,due_date,original_due_date from public.receivables where origin_ref='98000000-0000-4000-8000-000000000201' and status<>'cancelada' order by installment_number$q$,
 $q$select * from accepted order by installment_number$q$,'nova revisão preserva número e ambas as datas');
select ok(private.pj_flow_billing_valid('98000000-0000-4000-8000-000000000201'),'composição íntegra');
select is((select count(*)::integer from public.receivable_events e join public.receivables r on r.id=e.receivable_id
 where r.origin_ref='98000000-0000-4000-8000-000000000201' and e.event_type='lancada'
 and e.details->>'flow_version'='10' and (e.details->>'due_date')::date=r.due_date),3,'todos eventos de reemissão refletem datas efetivas');
set local role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000002',true);
select lives_ok($q$select pg_temp.act('depart',10)$q$,'saída aceita conjunto parcelado');
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',true);
select lives_ok($q$select pg_temp.terms('due',10,private.data_na_padaria()+10)$q$,'vencimento pode mudar depois da saída');
reset role;
select ok((select departed_at is not null and released_version=version from private.pj_flow where order_group_id='98000000-0000-4000-8000-000000000201'),'acordo posterior não reabre saída');
set local role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000001',true);
select lives_ok($q$select public.record_receivable_receipt(gen_random_uuid(),
 (select id from public.receivables where origin_ref='98000000-0000-4000-8000-000000000201' and status<>'cancelada' and installment_number=1),
 private.data_na_padaria(),10,'pix','banco_sicredi_jc')$q$,'registra pagamento parcial real');
select lives_ok($q$select pg_temp.terms('due',11,private.data_na_padaria()+11)$q$,'parcial pode ter novo acordo de data');
select is((select sum(rr.amount) from public.receivable_receipts rr join public.receivables r on r.id=rr.receivable_id
 where r.origin_ref='98000000-0000-4000-8000-000000000201' and rr.reversed_at is null),10.00,'pagamento não foi apagado nem duplicado');
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-000000000004',true);
select throws_ok($q$select public.change_pj_flow_terms(gen_random_uuid(),'98000000-0000-4000-8000-000000000201',12,'due',gen_random_uuid(),current_date,null,'Novo acordo')$q$,'42501',null,'admin sem concessão bloqueado');
reset role;
select * from finish();
rollback;
