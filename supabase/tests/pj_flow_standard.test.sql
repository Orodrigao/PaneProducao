begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin)
values
 ('9f000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','pj-standard-admin@example.com','',now(),now(),now(),
  '{"provider":"email","providers":["email"]}','{}',false),
 ('9f000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','pj-standard-sem-acesso@example.com','',now(),now(),now(),
  '{"provider":"email","providers":["email"]}','{}',false),
 ('9f000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','pj-standard-expedicao@example.com','',now(),now(),now(),
  '{"provider":"email","providers":["email"]}','{}',false);
insert into public.app_profiles(user_id,display_name,role,store,active,allowed_routes)
values
 ('9f000000-0000-4000-8000-000000000001','Contrato PJ Admin','admin','jc',true,'["/pedidos-pj"]'),
 ('9f000000-0000-4000-8000-000000000002','Contrato PJ sem acesso','admin','jc',true,'["/pedidos-pj"]'),
 ('9f000000-0000-4000-8000-000000000003','Contrato PJ Expedicao','expedicao','jc',true,'["/pedidos-pj"]');
insert into public.app_user_permissions(user_id,permission_key,scope)
select '9f000000-0000-4000-8000-000000000001', key, 'jc'
from unnest(array['pedidos_pj.acessar','contas_receber.acessar']) key;
insert into public.app_user_permissions(user_id,permission_key,scope)
select '9f000000-0000-4000-8000-000000000003', key, 'jc'
from unnest(array['pedidos_pj.acessar','pedidos_pj.confirmar_envio']) key;
insert into public.customers(id,name,doc,payment_term_days,active)
values ('9f000000-0000-4000-8000-000000000010','[TESTE] Cliente contrato PJ','00000000000096',7,true);
insert into public.breads(id,name,days,active,unit,is_special,is_shelf)
values
 ('teste-contrato-pj-a','[TESTE] Pao contrato A','{0,1,2,3,4,5,6}',true,'un',false,false),
 ('teste-contrato-pj-b','[TESTE] Pao contrato B','{0,1,2,3,4,5,6}',true,'un',false,false);
insert into public.customer_price_overrides(customer_id,product_id,product_source,product_name,
  unit_price,pricing_unit,pack_size,active)
values
 ('9f000000-0000-4000-8000-000000000010','teste-contrato-pj-a','bread',
  '[TESTE] Pao contrato A',10,'un',1,true),
 ('9f000000-0000-4000-8000-000000000010','teste-contrato-pj-b','bread',
  '[TESTE] Pao contrato B',20,'un',1,true);

create function pg_temp.pedido(p_quantidade numeric default 5) returns jsonb
language sql stable as $$
  select jsonb_build_array(
    jsonb_build_object('bread_id','teste-contrato-pj-a','product_source','bread',
      'product_name','[TESTE] Pao contrato A','quantity',p_quantidade,'unit_price',10,
      'pack_size',1,'pricing_unit','un','customer_id','9f000000-0000-4000-8000-000000000010',
      'pj_client','[TESTE] Cliente contrato PJ','order_date',private.data_na_padaria(),
      'delivery_date',private.data_na_padaria()+2,'pj_delivery_date',private.data_na_padaria()+2),
    jsonb_build_object('bread_id','teste-contrato-pj-b','product_source','bread',
      'product_name','[TESTE] Pao contrato B','quantity',2,'unit_price',20,
      'pack_size',1,'pricing_unit','un','customer_id','9f000000-0000-4000-8000-000000000010',
      'pj_client','[TESTE] Cliente contrato PJ','order_date',private.data_na_padaria(),
      'delivery_date',private.data_na_padaria()+2,'pj_delivery_date',private.data_na_padaria()+2)
  );
$$;

select is(private.pj_flow_rollout_state(),'preparing','migration instala contrato com virada desligada');
select ok(not has_table_privilege('authenticated','private.pj_flow_rollout_settings','select'),
  'navegador nao le nem altera a chave de ativacao');
select ok(not has_table_privilege('authenticated','private.pj_order_write_requests','select'),
  'auditoria idempotente permanece privada');
select ok(not has_function_privilege('anon','public.create_pj_order_atomic(uuid,uuid,jsonb)','execute'),
  'anonimo nao cria pedido pelo contrato');
select ok(not has_function_privilege('authenticated',
  'private.schedule_pj_production_contract_impl(date,jsonb,uuid)','execute'),
  'navegador nao chama diretamente a implementacao interna da producao');

set local role authenticated;
select set_config('request.jwt.claim.sub','9f000000-0000-4000-8000-000000000002',true);
select lives_ok($q$select public.create_pj_order_atomic(
  '9f000000-0000-4000-8000-000000000101','9f000000-0000-4000-8000-000000000201',pg_temp.pedido())$q$,
  'antes da virada o contrato preserva o acesso legado do Admin');

select set_config('request.jwt.claim.sub','9f000000-0000-4000-8000-000000000001',true);
select lives_ok($q$select public.create_pj_order_atomic(
  '9f000000-0000-4000-8000-000000000102','9f000000-0000-4000-8000-000000000202',pg_temp.pedido())$q$,
  'antes da virada o contrato cria pedido legado completo');
select lives_ok($q$select public.create_pj_order_atomic(
  '9f000000-0000-4000-8000-000000000102','9f000000-0000-4000-8000-000000000202',pg_temp.pedido())$q$,
  'resposta perdida pode repetir o mesmo pedido');
select throws_ok($q$select public.create_pj_order_atomic(
  '9f000000-0000-4000-8000-000000000102','9f000000-0000-4000-8000-000000000202',pg_temp.pedido(6))$q$,
  '22023',null,'mesmo identificador com conteudo diferente e recusado');
select throws_ok($q$select public.create_pj_order_atomic(
  '9f000000-0000-4000-8000-000000000114','9f000000-0000-4000-8000-000000000214',
  jsonb_set(pg_temp.pedido(),'{0,unit_price}','0.01'))$q$,
  '22023',null,'preco adulterado fora do catalogo e recusado pelo banco');
reset role;
select is((select count(*)::int from public.orders where order_group_id='9f000000-0000-4000-8000-000000000202'),
  2,'repeticao manteve exatamente as duas linhas');
select is((select count(*)::int from private.pj_flow where order_group_id='9f000000-0000-4000-8000-000000000202'),
  0,'pedido criado antes da virada permanece legado');

-- Simula a futura migration de ativacao sob a mesma trava usada pela criacao.
select pg_advisory_xact_lock(pg_catalog.hashtextextended('pane-pj-standard-cutover',0));
update private.pj_flow_rollout_settings
set state='standard',cutover_at=clock_timestamp(),updated_at=clock_timestamp()
where singleton;

set local role authenticated;
select set_config('request.jwt.claim.sub','9f000000-0000-4000-8000-000000000002',true);
select throws_ok($q$select public.create_pj_order_atomic(
  '9f000000-0000-4000-8000-000000000109','9f000000-0000-4000-8000-000000000209',pg_temp.pedido())$q$,
  '42501',null,'depois da virada perfil sem leitura nova nao cria pedido invisivel para si');
select set_config('request.jwt.claim.sub','9f000000-0000-4000-8000-000000000001',true);
select throws_ok($q$insert into public.orders(store,order_type,order_group_id,bread_id,product_source,
  product_name,quantity,unit_price,pack_size,pricing_unit,customer_id,pj_client,order_date,delivery_date,pj_delivery_date)
values('pj','pj','9f000000-0000-4000-8000-000000000299','teste-contrato-pj-a','bread',
  '[TESTE] Pao contrato A',1,10,1,'un','9f000000-0000-4000-8000-000000000010',
  '[TESTE] Cliente contrato PJ',current_date,current_date+2,current_date+2)$q$,
  '42501',null,'tela antiga nao grava diretamente depois da virada');
select lives_ok($q$select public.create_pj_order_atomic(
  '9f000000-0000-4000-8000-000000000103','9f000000-0000-4000-8000-000000000203',pg_temp.pedido())$q$,
  'depois da virada o contrato cria pela jornada padrao');
select lives_ok($q$select public.create_pj_order_atomic(
  '9f000000-0000-4000-8000-000000000103','9f000000-0000-4000-8000-000000000203',pg_temp.pedido())$q$,
  'repeticao depois da virada tambem e idempotente');
reset role;
select is((select count(*)::int from public.orders where order_group_id='9f000000-0000-4000-8000-000000000203'),
  2,'pedido padrao possui todas as linhas uma unica vez');
select is((select activation_mode from private.pj_flow where order_group_id='9f000000-0000-4000-8000-000000000203'),
  'standard','pedido posterior ao corte recebe identidade padrao');

create function pg_temp.falha_fluxo_padrao() returns trigger language plpgsql as $$
begin
  if new.order_group_id='9f000000-0000-4000-8000-000000000204' then
    raise exception 'falha fabricada depois das linhas';
  end if;
  return new;
end;
$$;
create trigger teste_falha_fluxo_padrao before insert on private.pj_flow
for each row execute function pg_temp.falha_fluxo_padrao();
set local role authenticated;
select set_config('request.jwt.claim.sub','9f000000-0000-4000-8000-000000000001',true);
select throws_ok($q$select public.create_pj_order_atomic(
  '9f000000-0000-4000-8000-000000000104','9f000000-0000-4000-8000-000000000204',pg_temp.pedido())$q$,
  'P0001','falha fabricada depois das linhas','falha ao inscrever desfaz a criacao inteira');
reset role;
drop trigger teste_falha_fluxo_padrao on private.pj_flow;
select is((select count(*)::int from public.orders where order_group_id='9f000000-0000-4000-8000-000000000204'),
  0,'falha de inscricao nao deixa linhas soltas');
select is((select count(*)::int from private.pj_order_write_requests where request_id='9f000000-0000-4000-8000-000000000104'),
  0,'falha de inscricao nao registra sucesso falso');

set local role authenticated;
select set_config('request.jwt.claim.sub','9f000000-0000-4000-8000-000000000001',true);
select lives_ok($q$select public.replace_pj_order_atomic(
  '9f000000-0000-4000-8000-000000000105','9f000000-0000-4000-8000-000000000202',pg_temp.pedido(8))$q$,
  'edicao atomica do legado continua permitida depois do corte');
select lives_ok($q$select public.replace_pj_order_atomic(
  '9f000000-0000-4000-8000-000000000106','9f000000-0000-4000-8000-000000000203',
  jsonb_build_array(pg_temp.pedido(9)->0))$q$,
  'pedido padrao pode ser corrigido antes da conferencia');
reset role;
select is((select count(*)::int from public.orders where order_group_id='9f000000-0000-4000-8000-000000000202'),
  2,'edicao legada substitui sem duplicar nem perder linhas');
select is((select count(*)::int from private.pj_flow where order_group_id='9f000000-0000-4000-8000-000000000202'),
  0,'edicao posterior nao converte o pedido antigo');
select is((select count(*)::int from public.orders where order_group_id='9f000000-0000-4000-8000-000000000203'),
  1,'edicao padrao remove e adiciona linhas como uma unidade');

set local role authenticated;
select set_config('request.jwt.claim.sub','9f000000-0000-4000-8000-000000000001',true);
select throws_ok($q$update public.orders set order_type='encomenda',store='jc'
  where order_group_id='9f000000-0000-4000-8000-000000000202'$q$,
  '42501',null,'tela antiga nao reclassifica um pedido PJ depois do corte');
select lives_ok($q$select public.schedule_pj_production(private.data_na_padaria(),
  (select jsonb_build_array(jsonb_build_object('order_id',id,'quantity',1,'frozen_quantity',0))
   from public.orders where order_group_id='9f000000-0000-4000-8000-000000000203' limit 1),
  '9f000000-0000-4000-8000-000000000115')$q$,
  'contrato de producao continua funcionando no pedido standard depois do corte');
select set_config('request.jwt.claim.sub','9f000000-0000-4000-8000-000000000003',true);
select lives_ok($q$select public.save_pj_order_dispatch_quantities(
  '9f000000-0000-4000-8000-000000000111','9f000000-0000-4000-8000-000000000202',
  (select jsonb_agg(jsonb_build_object('order_id',id,'quantity',quantity,'reason',null))
   from public.list_pj_orders_for_dispatch()
   where order_group_id='9f000000-0000-4000-8000-000000000202'),null)$q$,
  'contrato legado de conferencia continua funcionando depois do corte');
select lives_ok($q$select public.confirm_pj_order_dispatch('9f000000-0000-4000-8000-000000000202')$q$,
  'contrato legado de saida continua funcionando depois do corte');
select lives_ok($q$select public.transition_pj_flow_pilot(
  '9f000000-0000-4000-8000-000000000112','9f000000-0000-4000-8000-000000000203',0,'save',
  (select jsonb_agg(jsonb_build_object('id',item.value->>'id',
      'quantity',(item.value->>'ordered')::numeric,'reason',null))
   from jsonb_array_elements(public.read_pj_flow_pilot()) flow(value)
   cross join lateral jsonb_array_elements(flow.value->'items') item(value)
   where (flow.value->>'id')::uuid='9f000000-0000-4000-8000-000000000203'))$q$,
  'jornada padrao continua salvando a conferencia depois do corte');
select lives_ok($q$select public.transition_pj_flow_pilot(
  '9f000000-0000-4000-8000-000000000113','9f000000-0000-4000-8000-000000000203',1,'check')$q$,
  'jornada padrao continua concluindo a conferencia');

select set_config('request.jwt.claim.sub','9f000000-0000-4000-8000-000000000001',true);
select lives_ok($q$select public.create_pj_order_atomic(
  '9f000000-0000-4000-8000-000000000110','9f000000-0000-4000-8000-000000000205',
  jsonb_build_array(pg_temp.pedido()->0))$q$,
  'cria outro pedido padrao ainda sem conferencia para cancelar');
select lives_ok($q$select public.cancel_pj_order_atomic(
  '9f000000-0000-4000-8000-000000000107','9f000000-0000-4000-8000-000000000205','Cliente desistiu')$q$,
  'pedido padrao pode ser cancelado antes da conferencia');
select lives_ok($q$select public.cancel_pj_order_atomic(
  '9f000000-0000-4000-8000-000000000107','9f000000-0000-4000-8000-000000000205','Cliente desistiu')$q$,
  'repetir cancelamento devolve o mesmo sucesso');
reset role;
select is((select count(*)::int from public.orders where order_group_id='9f000000-0000-4000-8000-000000000205'
  and cancelled_at is not null and cancel_reason='Cliente desistiu'),1,
  'cancelamento protege todas as linhas do pedido');
select is((select count(*)::int from private.pj_flow where order_group_id='9f000000-0000-4000-8000-000000000205'),
  0,'cancelamento retira o pedido da fila da nova jornada');
select ok(private.is_pj_flow('9f000000-0000-4000-8000-000000000205'),
  'pedido standard cancelado conserva a protecao de leitura no historico');
set local role authenticated;
select set_config('request.jwt.claim.sub','9f000000-0000-4000-8000-000000000002',true);
select is((select count(*)::int from public.orders where order_group_id='9f000000-0000-4000-8000-000000000205'),
  0,'perfil legado nao passa a enxergar o pedido standard cancelado');
select set_config('request.jwt.claim.sub','9f000000-0000-4000-8000-000000000001',true);
select ok(public.read_pj_flow_pilot()::text not like '%9f000000-0000-4000-8000-000000000205%',
  'pedido cancelado nao deixa cartao fantasma na jornada');
reset role;

update private.pj_flow_rollout_settings set state='paused',updated_at=clock_timestamp() where singleton;
set local role authenticated;
select set_config('request.jwt.claim.sub','9f000000-0000-4000-8000-000000000001',true);
select throws_ok($q$select public.create_pj_order_atomic(
  '9f000000-0000-4000-8000-000000000108','9f000000-0000-4000-8000-000000000208',pg_temp.pedido())$q$,
  '55000',null,'pausa de seguranca bloqueia pedido novo sem voltar silenciosamente ao legado');
reset role;

select * from finish();
rollback;
