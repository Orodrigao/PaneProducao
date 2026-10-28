begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Decisão do Rodrigo em 28/10/2026: o administrador ativo passa na jornada PJ
-- sem concessão marcada, como já passa no Contas a receber. Este arquivo
-- percorre a jornada inteira com um admin sem nenhuma linha em
-- app_user_permissions e prova as fronteiras que não mudam: conferir e
-- registrar a saída seguem só com a Expedição JC; admin inativo, Financeiro
-- sem Contas a receber e Vendas seguem de fora.

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin)
select ('a1d00000-0000-4000-8000-00000000000'||n)::uuid,
  '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'admin-jornada-pj-'||n||'@example.com','',now(),now(),now(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,false
from generate_series(1,5) n;
insert into public.app_profiles(user_id,display_name,role,store,active,allowed_routes)
values
 ('a1d00000-0000-4000-8000-000000000001','[TESTE] Admin sem concessão','admin',null,true,'["/pedidos-pj"]'),
 ('a1d00000-0000-4000-8000-000000000002','[TESTE] Admin inativo','admin',null,false,'["/pedidos-pj"]'),
 ('a1d00000-0000-4000-8000-000000000003','[TESTE] Financeiro sem leitura nova','financeiro','jc',true,'["/pedidos-pj"]'),
 ('a1d00000-0000-4000-8000-000000000004','[TESTE] Expedição JC','expedicao','jc',true,'["/pedidos-pj"]'),
 ('a1d00000-0000-4000-8000-000000000005','[TESTE] Vendas JA','vendas','ja',true,'["/sobras"]');
insert into public.app_user_permissions(user_id,permission_key,scope)
values
 ('a1d00000-0000-4000-8000-000000000003','pedidos_pj.acessar','jc'),
 ('a1d00000-0000-4000-8000-000000000004','pedidos_pj.acessar','jc'),
 ('a1d00000-0000-4000-8000-000000000004','pedidos_pj.confirmar_envio','jc');

insert into public.customers(id,name,doc,payment_term_days,active)
values ('a1d00000-0000-4000-8000-000000000010','[TESTE] Cliente admin jornada','00000000000101',7,true);
insert into public.breads(id,name,days,active,unit,is_special,is_shelf)
values ('teste-admin-jornada-pj','[TESTE] Pão admin jornada','{0,1,2,3,4,5,6}',true,'un',false,false);
insert into public.customer_price_overrides(customer_id,product_id,product_source,product_name,
  unit_price,pricing_unit,pack_size,active)
values ('a1d00000-0000-4000-8000-000000000010','teste-admin-jornada-pj','bread',
  '[TESTE] Pão admin jornada',10,'un',1,true);

create function pg_temp.pedido() returns jsonb
language sql stable as $$
  select jsonb_build_array(jsonb_build_object('bread_id','teste-admin-jornada-pj','product_source','bread',
    'product_name','[TESTE] Pão admin jornada','quantity',4,'unit_price',10,
    'pack_size',1,'pricing_unit','un','customer_id','a1d00000-0000-4000-8000-000000000010',
    'pj_client','[TESTE] Cliente admin jornada','order_date',private.data_na_padaria(),
    'delivery_date',private.data_na_padaria()+2,'pj_delivery_date',private.data_na_padaria()+2));
$$;
create function pg_temp.act(a text,v integer,i jsonb default '[]',nf boolean default false,t integer default null)
returns jsonb language sql as $$
  select public.transition_pj_flow_pilot(gen_random_uuid(),'a1d00000-0000-4000-8000-000000000201',v,a,i,nf,t);
$$;
-- Quem não lê public.orders (a Expedição) recebe o id do item por aqui.
create function pg_temp.conferido(q integer) returns jsonb
language sql stable as $$
  select jsonb_build_array(jsonb_build_object('id',current_setting('teste.item_admin_jornada'),'quantity',q));
$$;
create function pg_temp.cartao() returns jsonb
language sql as $$
  select f from jsonb_array_elements(public.read_pj_flow_pilot()) f
  where f->>'id' = 'a1d00000-0000-4000-8000-000000000201';
$$;

select is(private.pj_flow_rollout_state(),'standard','pedido novo nasce na jornada padrão');
select ok(not has_function_privilege('authenticated','private.pj_flow_permission(text)','execute'),
  'o navegador continua sem chamar a regra de permissão diretamente');
select ok((select description like '%Administrador ativo já tem%' from public.app_permissions
  where key = 'pedidos_pj.liberar'), 'a tela de usuários avisa que o admin ativo já libera');

-- 1. Admin ativo sem nenhuma concessão cria, lê e enxerga o pedido.
set local role authenticated;
select set_config('request.jwt.claim.sub','a1d00000-0000-4000-8000-000000000001',true);
select lives_ok($q$select public.create_pj_order_atomic(gen_random_uuid(),
  'a1d00000-0000-4000-8000-000000000201',pg_temp.pedido())$q$,
  'admin ativo sem concessão cria Pedido PJ na jornada padrão');
select is((select count(*)::int from public.orders where order_group_id='a1d00000-0000-4000-8000-000000000201'),
  1,'admin ativo lê o pedido da jornada direto na tabela');
select ok(pg_temp.cartao()::text like '%"price"%','admin ativo lê a jornada com preços');
select is((pg_temp.cartao()->>'can_release')::boolean,true,'admin ativo pode revisar e liberar');
select is((pg_temp.cartao()->>'can_check')::boolean,false,'admin não confere quantidades');
select throws_ok($q$select pg_temp.act('save',0,'[]')$q$,'42501',null,
  'conferir continua só com a Expedição JC');
select throws_ok($q$select public.create_pj_order_by_expedition(gen_random_uuid(),
  'a1d00000-0000-4000-8000-000000000203','a1d00000-0000-4000-8000-000000000010',
  private.data_na_padaria()+2,null,'[]')$q$,'42501',null,
  'lançar pela tela da Expedição continua só com a Expedição JC');
reset role;
select is((select count(*)::int from private.pj_flow where order_group_id='a1d00000-0000-4000-8000-000000000201'),
  1,'o pedido do admin entrou na jornada');
select set_config('teste.item_admin_jornada',
  (select id::text from public.orders where order_group_id='a1d00000-0000-4000-8000-000000000201'),true);

-- 2. A Expedição confere; o admin não registra a saída, mas libera.
set local role authenticated;
select set_config('request.jwt.claim.sub','a1d00000-0000-4000-8000-000000000004',true);
select lives_ok($q$select pg_temp.act('save',0,pg_temp.conferido(4))$q$,'Expedição confere 4 de 4');
select lives_ok($q$select pg_temp.act('check',1)$q$,'Expedição conclui a conferência');
select set_config('request.jwt.claim.sub','a1d00000-0000-4000-8000-000000000001',true);
select throws_ok($q$select pg_temp.act('depart',2)$q$,'42501',null,
  'registrar a saída continua só com a Expedição JC');
select lives_ok($q$select pg_temp.act('release',2,'[]',true,7)$q$,
  'admin ativo sem concessão confirma cobrança e NF e libera a saída');
reset role;
select is((select count(*)::int from public.receivables
  where origin_ref='a1d00000-0000-4000-8000-000000000201' and status<>'cancelada'),
  1,'a liberação do admin gera uma única cobrança');
select is((select sum(amount) from public.receivables
  where origin_ref='a1d00000-0000-4000-8000-000000000201' and status<>'cancelada'),
  40.00::numeric,'cobrança pelas 4 unidades conferidas');
set local role authenticated;
select set_config('request.jwt.claim.sub','a1d00000-0000-4000-8000-000000000004',true);
select lives_ok($q$select pg_temp.act('depart',3)$q$,'Expedição registra a saída liberada pelo admin');

-- As policies restritivas de cobrança, recebimento e evento também deixam o
-- admin passar, lidas com o papel do navegador, não como dono do banco.
select set_config('request.jwt.claim.sub','a1d00000-0000-4000-8000-000000000001',true);
select lives_ok($q$select public.record_receivable_receipt(gen_random_uuid(),
  (select id from public.receivables where origin_ref='a1d00000-0000-4000-8000-000000000201'
     and status<>'cancelada' order by installment_number limit 1),
  private.data_na_padaria(),10,'pix','banco_sicredi_jc')$q$,'admin ativo registra um recebimento parcial');
select is((select count(*)::int from public.receivables
  where origin_ref='a1d00000-0000-4000-8000-000000000201' and status<>'cancelada'),
  1,'admin ativo lê a cobrança da jornada');
select is((select count(*)::int from public.receivable_receipts rr join public.receivables r on r.id=rr.receivable_id
  where r.origin_ref='a1d00000-0000-4000-8000-000000000201'),
  1,'admin ativo lê o recebimento da jornada');
select ok((select count(*) from public.receivable_events e join public.receivables r on r.id=e.receivable_id
  where r.origin_ref='a1d00000-0000-4000-8000-000000000201') > 0,
  'admin ativo lê o histórico da cobrança da jornada');
select set_config('request.jwt.claim.sub','a1d00000-0000-4000-8000-000000000002',true);
select is((select count(*)::int from public.receivables
  where origin_ref='a1d00000-0000-4000-8000-000000000201'),
  0,'admin inativo não lê a cobrança da jornada');

-- 3. Quem continua de fora.
select set_config('request.jwt.claim.sub','a1d00000-0000-4000-8000-000000000002',true);
select throws_ok('select public.read_pj_flow_pilot()','42501',null,'admin inativo não lê a jornada');
select is((select count(*)::int from public.orders where order_group_id='a1d00000-0000-4000-8000-000000000201'),
  0,'admin inativo não lê o pedido direto');
select throws_ok($q$select public.create_pj_order_atomic(gen_random_uuid(),
  'a1d00000-0000-4000-8000-000000000202',pg_temp.pedido())$q$,'42501',null,'admin inativo não cria pedido');
select set_config('request.jwt.claim.sub','a1d00000-0000-4000-8000-000000000003',true);
select throws_ok('select public.read_pj_flow_pilot()','42501',null,'Financeiro sem Contas a receber continua sem a jornada');
select is((select count(*)::int from public.orders where order_group_id='a1d00000-0000-4000-8000-000000000201'),
  0,'Financeiro sem Contas a receber não lê o pedido direto');
select set_config('request.jwt.claim.sub','a1d00000-0000-4000-8000-000000000005',true);
select throws_ok('select public.read_pj_flow_pilot()','42501',null,'Vendas continua sem a jornada');
reset role;

select * from finish();
rollback;
