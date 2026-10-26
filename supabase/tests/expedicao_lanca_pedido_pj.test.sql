-- Expedição lança Pedido PJ sem ver preço (fase 1).
--
-- Caso guia: o cliente tem tabela com 10% de desconto e um preço especial.
-- A Expedição JC pede 3 Pão A, 2 Pão B e 2 pacotes de Brioche Hamburguer
-- (12 unidades de 80 g, preço por kg). O banco grava 9,00 (10 com 10%),
-- 7,77 (preço especial, sem desconto) e 1,92 kg a 54,00/kg, sem que nenhum
-- valor volte para a Expedição.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin)
select id::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',email,'',
  now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false
from (values
  ('9e100000-0000-4000-8000-000000000001','lanca-pj-expedicao@example.com'),
  ('9e100000-0000-4000-8000-000000000002','lanca-pj-expedicao-sem-lancar@example.com'),
  ('9e100000-0000-4000-8000-000000000003','lanca-pj-vendas@example.com'),
  ('9e100000-0000-4000-8000-000000000004','lanca-pj-financeiro@example.com'),
  ('9e100000-0000-4000-8000-000000000005','lanca-pj-expedicao-ja@example.com'),
  ('9e100000-0000-4000-8000-000000000006','lanca-pj-expedicao-inativa@example.com'),
  ('9e100000-0000-4000-8000-000000000007','lanca-pj-expedicao-colega@example.com'),
  ('9e100000-0000-4000-8000-000000000008','lanca-pj-expedicao-sem-conferir@example.com')
) as u(id, email);

insert into public.app_profiles(user_id,display_name,role,store,active,allowed_routes)
values
 ('9e100000-0000-4000-8000-000000000001','[TESTE] Expedicao lanca','expedicao','jc',true,'["/pedidos-pj"]'),
 ('9e100000-0000-4000-8000-000000000002','[TESTE] Expedicao sem lancar','expedicao','jc',true,'["/pedidos-pj"]'),
 ('9e100000-0000-4000-8000-000000000003','[TESTE] Vendas com lancar','vendas','jc',true,'["/pedidos-pj"]'),
 ('9e100000-0000-4000-8000-000000000004','[TESTE] Financeiro lanca','financeiro','jc',true,'["/pedidos-pj"]'),
 ('9e100000-0000-4000-8000-000000000005','[TESTE] Expedicao JA','expedicao','ja',true,'["/pedidos-pj"]'),
 ('9e100000-0000-4000-8000-000000000006','[TESTE] Expedicao inativa','expedicao','jc',false,'["/pedidos-pj"]'),
 ('9e100000-0000-4000-8000-000000000007','[TESTE] Expedicao colega','expedicao','jc',true,'["/pedidos-pj"]'),
 ('9e100000-0000-4000-8000-000000000008','[TESTE] Expedicao sem conferir','expedicao','jc',true,'["/pedidos-pj"]');

insert into public.app_user_permissions(user_id,permission_key,scope)
select user_id::uuid, permission_key, scope
from (values
  ('9e100000-0000-4000-8000-000000000001','pedidos_pj.acessar','jc'),
  ('9e100000-0000-4000-8000-000000000001','pedidos_pj.confirmar_envio','jc'),
  ('9e100000-0000-4000-8000-000000000001','pedidos_pj.lancar','*'),
  ('9e100000-0000-4000-8000-000000000002','pedidos_pj.acessar','jc'),
  ('9e100000-0000-4000-8000-000000000002','pedidos_pj.confirmar_envio','jc'),
  ('9e100000-0000-4000-8000-000000000003','pedidos_pj.acessar','*'),
  ('9e100000-0000-4000-8000-000000000003','pedidos_pj.lancar','*'),
  ('9e100000-0000-4000-8000-000000000004','pedidos_pj.acessar','jc'),
  ('9e100000-0000-4000-8000-000000000004','contas_receber.acessar','jc'),
  ('9e100000-0000-4000-8000-000000000004','pedidos_pj.lancar','*'),
  ('9e100000-0000-4000-8000-000000000005','pedidos_pj.acessar','*'),
  ('9e100000-0000-4000-8000-000000000005','pedidos_pj.lancar','*'),
  ('9e100000-0000-4000-8000-000000000006','pedidos_pj.acessar','jc'),
  ('9e100000-0000-4000-8000-000000000006','pedidos_pj.lancar','*'),
  ('9e100000-0000-4000-8000-000000000007','pedidos_pj.acessar','jc'),
  ('9e100000-0000-4000-8000-000000000007','pedidos_pj.confirmar_envio','jc'),
  ('9e100000-0000-4000-8000-000000000007','pedidos_pj.lancar','jc'),
  ('9e100000-0000-4000-8000-000000000008','pedidos_pj.acessar','jc'),
  ('9e100000-0000-4000-8000-000000000008','pedidos_pj.lancar','*')
) as p(user_id, permission_key, scope);

insert into public.price_tiers(id,name) values ('9e100000-0000-4000-8000-0000000000f1','[TESTE] Tabela lanca PJ');
insert into public.customers(id,name,doc,payment_term_days,default_tier_id,discount_pct,active)
values
 ('9e100000-0000-4000-8000-0000000000c1','[TESTE] Cliente lanca PJ','00000000000101',7,'9e100000-0000-4000-8000-0000000000f1',10,true),
 ('9e100000-0000-4000-8000-0000000000c2','[TESTE] Cliente sem prazo','00000000000102',null,'9e100000-0000-4000-8000-0000000000f1',0,true),
 ('9e100000-0000-4000-8000-0000000000c3','[TESTE] Cliente sem tabela','00000000000103',7,null,0,true),
 ('9e100000-0000-4000-8000-0000000000c4','[TESTE] Cliente inativo','00000000000104',7,'9e100000-0000-4000-8000-0000000000f1',0,false);

insert into public.breads(id,name,days,active,unit,is_special,is_shelf)
values
 ('teste-lanca-pj-a','[TESTE] Pao lanca A','{0,1,2,3,4,5,6}',true,'un',false,false),
 ('teste-lanca-pj-b','[TESTE] Pao lanca B','{0,1,2,3,4,5,6}',true,'un',false,false),
 ('teste-lanca-pj-inativo','[TESTE] Pao lanca inativo','{0,1,2,3,4,5,6}',false,'un',false,false);

insert into public.products(id,name,kind,is_fabricacao_propria,production_process,production_area,
  allows_planned_production,allows_unplanned_production,unit,active)
values
 ('9e100000-0000-4000-8000-00000000a0a1','[TESTE] Brioche lanca PJ','final',true,'forno','padaria',true,false,'un',true),
 ('9e100000-0000-4000-8000-00000000a0a2','[TESTE] Bisnaga lanca PJ','final',true,'forno','padaria',true,false,'un',true);
insert into public.product_variants(id,product_id,name,sort_order)
values
 ('9e100000-0000-4000-8000-00000000d0d1','9e100000-0000-4000-8000-00000000a0a1','Forma',1),
 ('9e100000-0000-4000-8000-00000000d0d2','9e100000-0000-4000-8000-00000000a0a1','Hamburguer',2);
insert into public.product_sale_options(id,product_id,product_variant_id,name,sale_unit,reference_quantity,unit_weight_kg,is_default,active)
values
 ('9e100000-0000-4000-8000-00000000b0b1','9e100000-0000-4000-8000-00000000a0a1','9e100000-0000-4000-8000-00000000d0d1','Forma un','un',1,null,true,true),
 ('9e100000-0000-4000-8000-00000000b0b2','9e100000-0000-4000-8000-00000000a0a1','9e100000-0000-4000-8000-00000000d0d2','Hamburguer un','un',1,0.08,false,true),
 ('9e100000-0000-4000-8000-00000000b0b3','9e100000-0000-4000-8000-00000000a0a1','9e100000-0000-4000-8000-00000000d0d2','Hamburguer kg','kg',1,null,false,true),
 ('9e100000-0000-4000-8000-00000000b0b4','9e100000-0000-4000-8000-00000000a0a2',null,'Unidade','un',1,null,true,true);
insert into public.product_pj_pack_rules(product_id,product_variant_id,pack_size_units,min_order_packs,order_multiple_packs)
values
 ('9e100000-0000-4000-8000-00000000a0a1','9e100000-0000-4000-8000-00000000d0d2',12,1,1),
 ('9e100000-0000-4000-8000-00000000a0a2',null,12,1,1);

insert into public.price_tier_items(tier_id,product_id,product_source,product_name,unit_price,pricing_unit,pack_size,sale_option_id,active)
values
 ('9e100000-0000-4000-8000-0000000000f1','teste-lanca-pj-a','bread','[TESTE] Pao lanca A',10,'un',1,null,true),
 ('9e100000-0000-4000-8000-0000000000f1','teste-lanca-pj-b','bread','[TESTE] Pao lanca B',20,'un',1,null,true),
 ('9e100000-0000-4000-8000-0000000000f1','teste-lanca-pj-inativo','bread','[TESTE] Pao lanca inativo',5,'un',1,null,true),
 ('9e100000-0000-4000-8000-0000000000f1','9e100000-0000-4000-8000-00000000a0a1','product','[TESTE] Brioche Forma',8,'un',1,'9e100000-0000-4000-8000-00000000b0b1',true),
 ('9e100000-0000-4000-8000-0000000000f1','9e100000-0000-4000-8000-00000000a0a1','product','[TESTE] Brioche Hamburguer',60,'kg',1,'9e100000-0000-4000-8000-00000000b0b3',true),
 -- Pacote da tabela (6) diferente do pacote fechado (12): fica visível, mas bloqueado com motivo.
 ('9e100000-0000-4000-8000-0000000000f1','9e100000-0000-4000-8000-00000000a0a2','product','[TESTE] Bisnaga',3,'un',6,'9e100000-0000-4000-8000-00000000b0b4',true);
insert into public.customer_price_overrides(customer_id,product_id,product_source,product_name,unit_price,pricing_unit,pack_size,sale_option_id,active)
values ('9e100000-0000-4000-8000-0000000000c1','teste-lanca-pj-b','bread','[TESTE] Pao lanca B',7.77,'un',1,null,true);

create function pg_temp.linhas() returns jsonb
language sql immutable as $$
  select '[
    {"product_source":"bread","product_id":"teste-lanca-pj-a","packs":3,"quantity":3,"unit":"un"},
    {"product_source":"bread","product_id":"teste-lanca-pj-b","packs":2,"quantity":2,"unit":"un"},
    {"product_source":"product","product_id":"9e100000-0000-4000-8000-00000000a0a1",
     "sale_option_id":"9e100000-0000-4000-8000-00000000b0b3","packs":2,"quantity":1.92,"unit":"kg","pack_units":12}
  ]'::jsonb;
$$;

create function pg_temp.lancar(p_request uuid, p_group uuid, p_lines jsonb,
  p_customer uuid default '9e100000-0000-4000-8000-0000000000c1', p_days integer default 2) returns jsonb
language sql volatile as $$
  select public.create_pj_order_by_expedition(p_request, p_group, p_customer,
    private.data_na_padaria() + p_days, 'Entregar pela manha', p_lines);
$$;

create function pg_temp.como(p_user text) returns void
language sql volatile as $$
  select set_config('request.jwt.claim.sub', p_user, true);
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- -------------------------------------------------------------------------
-- Contrato publicado
-- -------------------------------------------------------------------------
select is(private.pj_flow_rollout_state(), 'standard', 'a jornada padrao continua ativa');
select is((select module from public.app_permissions where key = 'pedidos_pj.lancar'), 'Comercial',
  'permissao nova entra no catalogo, no modulo dos Pedidos PJ');
select is((select count(*)::int from public.app_user_permissions a
  join public.app_profiles p on p.user_id = a.user_id
  where a.permission_key = 'pedidos_pj.lancar' and p.display_name not like '[TESTE]%'), 0,
  'a migration nao concede a permissao nova a ninguem');
select ok(not has_function_privilege('anon','public.list_pj_launch_catalog()','execute'),
  'anonimo nao le o catalogo da Expedicao');
select ok(not has_function_privilege('anon','public.create_pj_order_by_expedition(uuid,uuid,uuid,date,text,jsonb)','execute'),
  'anonimo nao lanca pedido');
select ok(not has_function_privilege('anon','public.list_pj_order_launch_origins(uuid[])','execute'),
  'anonimo nao consulta origem');
select ok(has_function_privilege('authenticated','public.create_pj_order_by_expedition(uuid,uuid,uuid,date,text,jsonb)','execute'),
  'navegador autenticado chama o lancamento, que confere o perfil por dentro');
select ok(not has_function_privilege('authenticated','private.pj_launch_items(uuid)','execute'),
  'navegador nao le os itens com preco');
select ok(not has_function_privilege('authenticated','private.pj_expedition_can_launch()','execute'),
  'navegador nao chama a guarda interna');

-- -------------------------------------------------------------------------
-- Paridade: todo item liberado pelo catalogo passa pela mesma conferencia
-- de preco, pacote e unidade do contrato do Financeiro.
-- -------------------------------------------------------------------------
create function pg_temp.paridade() returns integer
language plpgsql volatile as $$
declare
  v_item record;
  v_quantity numeric;
  v_count integer := 0;
begin
  for v_item in select * from private.pj_launch_items('9e100000-0000-4000-8000-0000000000c1')
    where item_blocked_reason is null
  loop
    v_quantity := case
      when v_item.item_pack_rule_size is null then v_item.item_pack_size
      when v_item.item_pricing_unit = 'un' then v_item.item_pack_rule_size
      else round(v_item.item_pack_rule_size * v_item.item_unit_weight_kg, 3) end;
    perform private.assert_pj_order_payload(gen_random_uuid(), jsonb_build_array(jsonb_build_object(
      'bread_id', v_item.item_product_id, 'product_source', v_item.item_product_source,
      'product_name', v_item.item_product_name, 'quantity', v_quantity,
      'unit_price', v_item.item_unit_price, 'pack_size', v_item.item_pack_size,
      'pricing_unit', v_item.item_pricing_unit, 'sale_option_id', v_item.item_sale_option_id,
      'customer_id', '9e100000-0000-4000-8000-0000000000c1', 'pj_client', '[TESTE] Cliente lanca PJ',
      'order_date', private.data_na_padaria(), 'delivery_date', private.data_na_padaria() + 2)), true);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
select is(pg_temp.paridade(), 4, 'os 4 itens liberados passam pela conferencia de preco do contrato existente');

-- -------------------------------------------------------------------------
-- Catalogo sem preco
-- -------------------------------------------------------------------------
set local role authenticated;
select pg_temp.como('9e100000-0000-4000-8000-000000000001');
create temp table catalogo as select public.list_pj_launch_catalog() as body;
reset role;
select is((select count(*)::int from catalogo, jsonb_array_elements(body->'items') item
  where item->>'customer_id' = '9e100000-0000-4000-8000-0000000000c1'), 5,
  'cliente com tabela mostra os 5 itens ativos (o pao inativo fica fora)');
select ok((select not (body::text ~* 'unit_price|discount|7\.77|54\.00|\m9\.00') from catalogo),
  'catalogo nao carrega preco, desconto nem valor calculado');
select is((select item->>'blocked_reason' from catalogo, jsonb_array_elements(body->'items') item
  where item->>'product_id' = '9e100000-0000-4000-8000-00000000a0a2'
    and item->>'customer_id' = '9e100000-0000-4000-8000-0000000000c1'),
  'O pacote da tabela não confere com o pacote fechado. Avise o Financeiro.',
  'pacote da tabela diferente do pacote fechado aparece bloqueado com o motivo');
select is((select (item->>'unit_weight_kg')::numeric from catalogo, jsonb_array_elements(body->'items') item
  where item->>'sale_option_id' = '9e100000-0000-4000-8000-00000000b0b3'
    and item->>'customer_id' = '9e100000-0000-4000-8000-0000000000c1'), 0.08::numeric,
  'pacote fechado por kg traz o peso da unidade para a tela mostrar unidades e kg');
select is((select customer->>'blocked_reason' from catalogo, jsonb_array_elements(body->'customers') customer
  where customer->>'id' = '9e100000-0000-4000-8000-0000000000c2'),
  'Cliente sem prazo de pagamento. Avise o Financeiro.', 'cliente sem prazo aparece com o motivo');
select is((select customer->>'blocked_reason' from catalogo, jsonb_array_elements(body->'customers') customer
  where customer->>'id' = '9e100000-0000-4000-8000-0000000000c3'),
  'Cliente sem produto disponível na tabela. Avise o Financeiro.', 'cliente sem tabela aparece com o motivo');
select ok(not exists (select 1 from catalogo, jsonb_array_elements(body->'customers') customer
  where customer->>'id' = '9e100000-0000-4000-8000-0000000000c4'), 'cliente inativo fica fora');

set local role authenticated;
select pg_temp.como('9e100000-0000-4000-8000-000000000002');
select throws_ok('select public.list_pj_launch_catalog()', '42501', null, 'Expedicao sem a permissao nova nao le o catalogo');
select pg_temp.como('9e100000-0000-4000-8000-000000000003');
select throws_ok('select public.list_pj_launch_catalog()', '42501', null, 'Vendas com a permissao nao le o catalogo');
select pg_temp.como('9e100000-0000-4000-8000-000000000004');
select throws_ok('select public.list_pj_launch_catalog()', '42501', null, 'Financeiro usa o proprio formulario, nao este');
select pg_temp.como('9e100000-0000-4000-8000-000000000005');
select throws_ok('select public.list_pj_launch_catalog()', '42501', null, 'Expedicao de outra loja nao le o catalogo');
select pg_temp.como('9e100000-0000-4000-8000-000000000006');
select throws_ok('select public.list_pj_launch_catalog()', '42501', null, 'Expedicao inativa nao le o catalogo');
select pg_temp.como('9e100000-0000-4000-8000-000000000008');
select throws_ok('select public.list_pj_launch_catalog()', '42501', null,
  'sem Confirmar envio a Expedicao nao lanca o que nao conseguiria acompanhar na jornada');

-- -------------------------------------------------------------------------
-- Lancamento
-- -------------------------------------------------------------------------
select pg_temp.como('9e100000-0000-4000-8000-000000000001');
create temp table primeiro as select pg_temp.lancar('9e100000-0000-4000-8000-000000000101',
  '9e100000-0000-4000-8000-000000000201', pg_temp.linhas()) as body;
select is((select body->>'repeated' from primeiro), 'false', 'Expedicao lanca o pedido');
select ok((select not (body::text ~* 'price|valor') from primeiro), 'resposta do lancamento nao traz preco');
select is((select count(*)::int from public.orders where order_group_id = '9e100000-0000-4000-8000-000000000201'), 0,
  'a Expedicao continua sem ler o pedido PJ direto na tabela');
select throws_ok($q$select public.create_pj_order_atomic('9e100000-0000-4000-8000-000000000102',
  '9e100000-0000-4000-8000-000000000202', '[]'::jsonb)$q$, '42501', null,
  'o contrato do Financeiro continua fechado para a Expedicao');
reset role;

select results_eq($q$select bread_id, quantity, unit_price, pack_size, pricing_unit
  from public.orders where order_group_id = '9e100000-0000-4000-8000-000000000201' order by bread_id$q$,
  $q$values ('9e100000-0000-4000-8000-00000000a0a1'::text, 1.92::numeric, 54.00::numeric, 1::numeric, 'kg'::text),
    ('teste-lanca-pj-a', 3, 9.00, 1, 'un'),
    ('teste-lanca-pj-b', 2, 7.77, 1, 'un')$q$,
  'banco grava preco da tabela com desconto, preco especial sem desconto e 2 pacotes de 12 x 80 g = 1,92 kg');
select is((select count(distinct (order_date, delivery_date, pj_client, obs, customer_id, store, order_type))::int
  from public.orders where order_group_id = '9e100000-0000-4000-8000-000000000201'
    and order_date = private.data_na_padaria() and delivery_date = private.data_na_padaria() + 2
    and pj_client = '[TESTE] Cliente lanca PJ' and obs = 'Entregar pela manha' and store = 'pj' and order_type = 'pj'), 1,
  'todas as linhas levam o mesmo cliente, datas, observacao e tipo PJ');
select is((select product_variant_id from public.orders where order_group_id = '9e100000-0000-4000-8000-000000000201'
  and bread_id = '9e100000-0000-4000-8000-00000000a0a1'), '9e100000-0000-4000-8000-00000000d0d2'::uuid,
  'a variante vem da opcao de venda escolhida');
select results_eq($q$select activation_mode, version, checked_at is null, released_at is null
  from private.pj_flow where order_group_id = '9e100000-0000-4000-8000-000000000201'$q$,
  $q$values ('standard'::text, 0, true, true)$q$, 'o pedido entra na jornada padrao, aguardando conferencia');
select results_eq($q$select actor, action from private.pj_order_write_requests
  where request_id = '9e100000-0000-4000-8000-000000000101'$q$,
  $q$values ('9e100000-0000-4000-8000-000000000001'::uuid, 'create_expedition'::text)$q$,
  'a trilha guarda quem lancou e que foi pela Expedicao');
select ok((select not (request_payload::text ~* 'price') from private.pj_order_write_requests
  where request_id = '9e100000-0000-4000-8000-000000000101'), 'a trilha guarda o pedido como a Expedicao enviou, sem preco');

-- A tabela muda depois do envio: a repeticao reconhece o pedido pelo que
-- foi enviado e devolve o resultado original, sem reprecificar.
update public.price_tier_items set unit_price = 11
where tier_id = '9e100000-0000-4000-8000-0000000000f1' and product_id = 'teste-lanca-pj-a';
set local role authenticated;
select pg_temp.como('9e100000-0000-4000-8000-000000000001');
select is((pg_temp.lancar('9e100000-0000-4000-8000-000000000101', '9e100000-0000-4000-8000-000000000201',
  pg_temp.linhas()))->>'repeated', 'true', 'resposta perdida repete o mesmo pedido mesmo com a tabela alterada');
select throws_ok($q$select pg_temp.lancar('9e100000-0000-4000-8000-000000000101', '9e100000-0000-4000-8000-000000000201',
  jsonb_set(pg_temp.linhas(), '{0,packs}', '4'))$q$, '22023', 'Identificador ja usado para outra operacao.',
  'mesmo identificador com quantidade diferente e recusado');
reset role;
select is((select count(*)::int from public.orders where order_group_id = '9e100000-0000-4000-8000-000000000201'), 3,
  'a repeticao manteve as tres linhas');
select is((select unit_price from public.orders where order_group_id = '9e100000-0000-4000-8000-000000000201'
  and bread_id = 'teste-lanca-pj-a'), 9.00::numeric, 'a repeticao nao reprecificou o pedido');

set local role authenticated;
select pg_temp.como('9e100000-0000-4000-8000-000000000001');
select throws_ok($q$select pg_temp.lancar(gen_random_uuid(), gen_random_uuid(),
  '[{"product_source":"bread","product_id":"teste-lanca-pj-a","packs":1,"unit_price":0.01}]')$q$,
  '22023', 'O pedido contem campos desconhecidos.', 'preco enviado pelo navegador e recusado');
select throws_ok($q$select pg_temp.lancar(gen_random_uuid(), gen_random_uuid(),
  '[{"product_source":"bread","product_id":"teste-lanca-pj-inativo","packs":1}]')$q$,
  '22023', null, 'produto inativo nao entra');
select throws_ok($q$select pg_temp.lancar(gen_random_uuid(), gen_random_uuid(),
  '[{"product_source":"product","product_id":"9e100000-0000-4000-8000-00000000a0a2","sale_option_id":"9e100000-0000-4000-8000-00000000b0b4","packs":1}]')$q$,
  '22023', 'O pacote da tabela não confere com o pacote fechado. Avise o Financeiro.', 'item bloqueado recusa com o mesmo motivo da tela');
select throws_ok($q$select pg_temp.lancar(gen_random_uuid(), gen_random_uuid(),
  '[{"product_source":"product","product_id":"9e100000-0000-4000-8000-00000000a0a1","sale_option_id":"9e100000-0000-4000-8000-00000000b0b3","packs":1.5}]')$q$,
  '22023', 'Informe pacotes inteiros.', 'pacote fechado nao aceita fracao');
select throws_ok($q$select pg_temp.lancar(gen_random_uuid(), gen_random_uuid(),
  '[{"product_source":"bread","product_id":"teste-lanca-pj-a","packs":1.5}]')$q$,
  '22023', 'Informe uma quantidade inteira.', 'produto por unidade nao aceita fracao');
select throws_ok($q$select pg_temp.lancar(gen_random_uuid(), gen_random_uuid(),
  '[{"product_source":"bread","product_id":"teste-lanca-pj-a","packs":0}]')$q$,
  '22023', null, 'quantidade zero e recusada');
select throws_ok($q$select pg_temp.lancar(gen_random_uuid(), gen_random_uuid(),
  '[{"product_source":"bread","product_id":"teste-lanca-pj-a","packs":1,"quantity":1,"unit":"un"},{"product_source":"bread","product_id":"teste-lanca-pj-a","packs":2,"quantity":2,"unit":"un"}]')$q$,
  '22023', 'O mesmo produto aparece duas vezes. Some as quantidades numa linha so.', 'produto repetido e recusado');
select throws_ok($q$select pg_temp.lancar(gen_random_uuid(), gen_random_uuid(), pg_temp.linhas(),
  '9e100000-0000-4000-8000-0000000000c1', -1)$q$,
  '22023', 'A entrega de um pedido novo nao pode ficar no passado.', 'entrega no passado e recusada');
select throws_ok($q$select pg_temp.lancar(gen_random_uuid(), gen_random_uuid(),
  '[{"product_source":"bread","product_id":"teste-lanca-pj-a","packs":1,"quantity":1,"unit":"un"}]', '9e100000-0000-4000-8000-0000000000c2')$q$,
  '22023', 'Cliente sem prazo de pagamento. Avise o Financeiro.', 'cliente sem prazo de pagamento e recusado');
select throws_ok($q$select pg_temp.lancar(gen_random_uuid(), gen_random_uuid(),
  '[{"product_source":"bread","product_id":"teste-lanca-pj-a","packs":1,"quantity":1,"unit":"un"}]', '9e100000-0000-4000-8000-0000000000c3')$q$,
  '22023', null, 'cliente sem tabela e recusado');
select throws_ok($q$select pg_temp.lancar(gen_random_uuid(), gen_random_uuid(),
  '[{"product_source":"bread","product_id":"teste-lanca-pj-a","packs":1,"quantity":1,"unit":"un"}]', '9e100000-0000-4000-8000-0000000000c4')$q$,
  '22023', 'Escolha um cliente ativo.', 'cliente inativo e recusado');

select pg_temp.como('9e100000-0000-4000-8000-000000000002');
select throws_ok($q$select pg_temp.lancar(gen_random_uuid(), gen_random_uuid(), pg_temp.linhas())$q$,
  '42501', null, 'Expedicao sem a permissao nova nao lanca');
select pg_temp.como('9e100000-0000-4000-8000-000000000003');
select throws_ok($q$select pg_temp.lancar(gen_random_uuid(), gen_random_uuid(), pg_temp.linhas())$q$,
  '42501', null, 'Vendas com a permissao nao lanca');
select pg_temp.como('9e100000-0000-4000-8000-000000000004');
select throws_ok($q$select pg_temp.lancar(gen_random_uuid(), gen_random_uuid(), pg_temp.linhas())$q$,
  '42501', null, 'Financeiro com a permissao nao usa este caminho');
select pg_temp.como('9e100000-0000-4000-8000-000000000005');
select throws_ok($q$select pg_temp.lancar(gen_random_uuid(), gen_random_uuid(), pg_temp.linhas())$q$,
  '42501', null, 'Expedicao de outra loja nao lanca');
select pg_temp.como('9e100000-0000-4000-8000-000000000006');
select throws_ok($q$select pg_temp.lancar(gen_random_uuid(), gen_random_uuid(), pg_temp.linhas())$q$,
  '42501', null, 'Expedicao inativa nao lanca');
select pg_temp.como('9e100000-0000-4000-8000-000000000008');
select throws_ok($q$select pg_temp.lancar(gen_random_uuid(), gen_random_uuid(), pg_temp.linhas())$q$,
  '42501', null, 'Expedicao sem Confirmar envio nao lanca');

-- A quantidade fisica que a tela mostrou precisa bater com a do cadastro na
-- hora de gravar: 2 pacotes de 12 x 80 g = 1,92 kg. Se o peso mudar para
-- 100 g no meio do preenchimento, o banco gravaria 2,40 kg sem ela ver.
select pg_temp.como('9e100000-0000-4000-8000-000000000001');
select throws_ok($q$select pg_temp.lancar(gen_random_uuid(), gen_random_uuid(),
  '[{"product_source":"bread","product_id":"teste-lanca-pj-a","packs":2,"quantity":3,"unit":"un"}]')$q$,
  '22023', 'O pacote, o peso ou a unidade de um produto mudou no cadastro. Recarregue a lista de produtos e revise as quantidades.',
  'quantidade diferente da mostrada na tela e recusada');
select throws_ok($q$select pg_temp.lancar(gen_random_uuid(), gen_random_uuid(),
  '[{"product_source":"bread","product_id":"teste-lanca-pj-a","packs":2}]')$q$,
  '22023', null, 'linha sem a quantidade mostrada na tela e recusada');
reset role;
update public.product_sale_options set unit_weight_kg = 0.1 where id = '9e100000-0000-4000-8000-00000000b0b2';
set local role authenticated;
select pg_temp.como('9e100000-0000-4000-8000-000000000001');
select throws_ok($q$select pg_temp.lancar(gen_random_uuid(), gen_random_uuid(),
  '[{"product_source":"product","product_id":"9e100000-0000-4000-8000-00000000a0a1","sale_option_id":"9e100000-0000-4000-8000-00000000b0b3","packs":2,"quantity":1.92,"unit":"kg","pack_units":12}]')$q$,
  '22023', 'O pacote, o peso ou a unidade de um produto mudou no cadastro. Recarregue a lista de produtos e revise as quantidades.',
  'peso da unidade alterado depois da tela recusa em vez de gravar 2,40 kg');
reset role;
update public.product_sale_options set unit_weight_kg = 0.08 where id = '9e100000-0000-4000-8000-00000000b0b2';
set local role authenticated;
select pg_temp.como('9e100000-0000-4000-8000-000000000001');
select throws_ok($q$select pg_temp.lancar(gen_random_uuid(), gen_random_uuid(),
  '[{"product_source":"product","product_id":"9e100000-0000-4000-8000-00000000a0a1","sale_option_id":"9e100000-0000-4000-8000-00000000b0b3","packs":2,"quantity":1.92,"unit":"kg","pack_units":6}]')$q$,
  '22023', 'O pacote, o peso ou a unidade de um produto mudou no cadastro. Recarregue a lista de produtos e revise as quantidades.',
  'pacote fechado diferente do mostrado e recusado, mesmo com o mesmo peso total');

-- A tela mostrou 3 unidades; a tabela passa a cobrar por kg com o mesmo
-- pacote 1. Sem conferir a unidade o banco gravaria 3 kg.
reset role;
update public.price_tier_items set pricing_unit = 'kg'
where tier_id = '9e100000-0000-4000-8000-0000000000f1' and product_id = 'teste-lanca-pj-a';
set local role authenticated;
select pg_temp.como('9e100000-0000-4000-8000-000000000001');
select throws_ok($q$select pg_temp.lancar(gen_random_uuid(), gen_random_uuid(),
  '[{"product_source":"bread","product_id":"teste-lanca-pj-a","packs":3,"quantity":3,"unit":"un"}]')$q$,
  '22023', 'O pacote, o peso ou a unidade de um produto mudou no cadastro. Recarregue a lista de produtos e revise as quantidades.',
  'unidade trocada no cadastro depois da tela e recusada em vez de gravar 3 kg');
reset role;
update public.price_tier_items set pricing_unit = 'un'
where tier_id = '9e100000-0000-4000-8000-0000000000f1' and product_id = 'teste-lanca-pj-a';

-- So a recusa que prova que nada foi gravado leva a dica que libera um envio
-- novo na tela. Acesso negado e identificador ja usado ficam sem a dica.
create function pg_temp.dica(p_sql text) returns text
language plpgsql volatile as $$
declare
  v_hint text;
begin
  execute p_sql;
  return 'sem erro';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return coalesce(nullif(v_hint, ''), 'sem dica');
end;
$$;
set local role authenticated;
select pg_temp.como('9e100000-0000-4000-8000-000000000001');
select is(pg_temp.dica($q$select pg_temp.lancar(gen_random_uuid(), gen_random_uuid(),
  '[{"product_source":"bread","product_id":"teste-lanca-pj-inativo","packs":1,"quantity":1,"unit":"un"}]')$q$),
  'pj-launch-not-saved', 'recusa de cadastro depois da procura avisa que nada foi gravado');
select is(pg_temp.dica($q$select pg_temp.lancar(gen_random_uuid(), gen_random_uuid(), pg_temp.linhas(),
  '9e100000-0000-4000-8000-0000000000c1', -1)$q$),
  'pj-launch-not-saved', 'recusa da conferencia comum tambem avisa que nada foi gravado');
select is(pg_temp.dica($q$select pg_temp.lancar('9e100000-0000-4000-8000-000000000101',
  '9e100000-0000-4000-8000-000000000201', jsonb_set(pg_temp.linhas(), '{0,packs}', '4'))$q$),
  'sem dica', 'identificador ja usado com outro conteudo nao libera envio novo');
select pg_temp.como('9e100000-0000-4000-8000-000000000002');
select is(pg_temp.dica($q$select pg_temp.lancar(gen_random_uuid(), gen_random_uuid(), pg_temp.linhas())$q$),
  'sem dica', 'acesso negado nao prova nada sobre tentativa anterior');

-- O caminho do Financeiro segue igual.
select pg_temp.como('9e100000-0000-4000-8000-000000000004');
select lives_ok($q$select public.create_pj_order_atomic('9e100000-0000-4000-8000-000000000103',
  '9e100000-0000-4000-8000-000000000203', jsonb_build_array(jsonb_build_object(
    'bread_id','teste-lanca-pj-a','product_source','bread','product_name','[TESTE] Pao lanca A',
    'quantity',1,'unit_price',9.90,'pack_size',1,'pricing_unit','un',
    'customer_id','9e100000-0000-4000-8000-0000000000c1','pj_client','[TESTE] Cliente lanca PJ',
    'order_date',private.data_na_padaria(),'delivery_date',private.data_na_padaria()+2)))$q$,
  'Financeiro continua lancando pelo proprio contrato (tabela alterada para 11, com 10%)');

-- -------------------------------------------------------------------------
-- Origem na jornada
-- -------------------------------------------------------------------------
select is((public.list_pj_order_launch_origins(array['9e100000-0000-4000-8000-000000000201',
  '9e100000-0000-4000-8000-000000000203']::uuid[])) #- '{0,launched_at}',
  jsonb_build_array(jsonb_build_object('order_group_id','9e100000-0000-4000-8000-000000000201',
    'launched_by_name','[TESTE] Expedicao lanca','launched_by_me',false)),
  'Financeiro ve que o pedido veio da Expedicao, e o pedido dele fica sem marca');
select pg_temp.como('9e100000-0000-4000-8000-000000000001');
select is((public.list_pj_order_launch_origins(array['9e100000-0000-4000-8000-000000000201']::uuid[]))->0->>'launched_by_me',
  'true', 'quem lancou ve que foi ela');
select pg_temp.como('9e100000-0000-4000-8000-000000000007');
select is((public.list_pj_order_launch_origins(array['9e100000-0000-4000-8000-000000000201']::uuid[]))->0->>'launched_by_me',
  'false', 'a colega da Expedicao nao ve o pedido como seu');
select pg_temp.como('9e100000-0000-4000-8000-000000000003');
select throws_ok($q$select public.list_pj_order_launch_origins(array[]::uuid[])$q$, '42501', null,
  'Vendas nao consulta a origem');
reset role;

-- -------------------------------------------------------------------------
-- Reversao: desmarcar a permissao fecha o lancamento na hora.
-- -------------------------------------------------------------------------
delete from public.app_user_permissions
where user_id = '9e100000-0000-4000-8000-000000000001' and permission_key = 'pedidos_pj.lancar';
set local role authenticated;
select pg_temp.como('9e100000-0000-4000-8000-000000000001');
select throws_ok($q$select pg_temp.lancar(gen_random_uuid(), gen_random_uuid(), pg_temp.linhas())$q$,
  '42501', null, 'permissao retirada com a tela aberta bloqueia o proximo lancamento');
reset role;
select is((select count(*)::int from public.orders where order_group_id = '9e100000-0000-4000-8000-000000000201'), 3,
  'o pedido ja lancado continua como estava');

select * from finish();
rollback;
