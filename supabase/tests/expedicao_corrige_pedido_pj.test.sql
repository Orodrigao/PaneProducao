-- Expedição corrige e cancela o Pedido PJ que ela lançou (fase 2).
--
-- Caso guia: a Expedição JC lança 3 Pão A e 2 pacotes de Brioche Hamburguer
-- (12 x 80 g, preço por kg) para entrega daqui a 2 dias. Antes da
-- conferência ela corrige para 5 Pão A e 1 pacote, com entrega em 3 dias, e
-- o banco reprecifica pela tabela (9,00 e 54,00/kg) sem que nenhum valor
-- volte para ela. Depois cancela com motivo. Colega da Expedição, Financeiro,
-- Vendas, outra loja e quem não tem a permissão ficam de fora; pedido que o
-- Financeiro alterou, que entrou em conferência ou que não foi lançado por
-- ela também.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin)
select id::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',email,'',
  now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false
from (values
  ('9e200000-0000-4000-8000-000000000001','corrige-pj-autora@example.com'),
  ('9e200000-0000-4000-8000-000000000002','corrige-pj-colega@example.com'),
  ('9e200000-0000-4000-8000-000000000003','corrige-pj-financeiro@example.com'),
  ('9e200000-0000-4000-8000-000000000004','corrige-pj-vendas@example.com'),
  ('9e200000-0000-4000-8000-000000000005','corrige-pj-expedicao-ja@example.com'),
  ('9e200000-0000-4000-8000-000000000006','corrige-pj-expedicao-sem-lancar@example.com')
) as u(id, email);

insert into public.app_profiles(user_id,display_name,role,store,active,allowed_routes)
values
 ('9e200000-0000-4000-8000-000000000001','[TESTE] Expedicao autora','expedicao','jc',true,'["/pedidos-pj"]'),
 ('9e200000-0000-4000-8000-000000000002','[TESTE] Expedicao colega','expedicao','jc',true,'["/pedidos-pj"]'),
 ('9e200000-0000-4000-8000-000000000003','[TESTE] Financeiro corrige','financeiro','jc',true,'["/pedidos-pj"]'),
 ('9e200000-0000-4000-8000-000000000004','[TESTE] Vendas corrige','vendas','jc',true,'["/pedidos-pj"]'),
 ('9e200000-0000-4000-8000-000000000005','[TESTE] Expedicao JA corrige','expedicao','ja',true,'["/pedidos-pj"]'),
 ('9e200000-0000-4000-8000-000000000006','[TESTE] Expedicao sem lancar','expedicao','jc',true,'["/pedidos-pj"]');

insert into public.app_user_permissions(user_id,permission_key,scope)
select user_id::uuid, permission_key, scope
from (values
  ('9e200000-0000-4000-8000-000000000001','pedidos_pj.acessar','jc'),
  ('9e200000-0000-4000-8000-000000000001','pedidos_pj.confirmar_envio','jc'),
  ('9e200000-0000-4000-8000-000000000001','pedidos_pj.lancar','jc'),
  ('9e200000-0000-4000-8000-000000000002','pedidos_pj.acessar','jc'),
  ('9e200000-0000-4000-8000-000000000002','pedidos_pj.confirmar_envio','jc'),
  ('9e200000-0000-4000-8000-000000000002','pedidos_pj.lancar','jc'),
  ('9e200000-0000-4000-8000-000000000003','pedidos_pj.acessar','jc'),
  ('9e200000-0000-4000-8000-000000000003','contas_receber.acessar','jc'),
  ('9e200000-0000-4000-8000-000000000003','pedidos_pj.lancar','*'),
  ('9e200000-0000-4000-8000-000000000004','pedidos_pj.acessar','*'),
  ('9e200000-0000-4000-8000-000000000004','pedidos_pj.lancar','*'),
  ('9e200000-0000-4000-8000-000000000005','pedidos_pj.acessar','*'),
  ('9e200000-0000-4000-8000-000000000005','pedidos_pj.confirmar_envio','*'),
  ('9e200000-0000-4000-8000-000000000005','pedidos_pj.lancar','*'),
  ('9e200000-0000-4000-8000-000000000006','pedidos_pj.acessar','jc'),
  ('9e200000-0000-4000-8000-000000000006','pedidos_pj.confirmar_envio','jc')
) as p(user_id, permission_key, scope);

insert into public.price_tiers(id,name) values ('9e200000-0000-4000-8000-0000000000f1','[TESTE] Tabela corrige PJ');
insert into public.customers(id,name,doc,payment_term_days,default_tier_id,discount_pct,active)
values ('9e200000-0000-4000-8000-0000000000c1','[TESTE] Cliente corrige PJ','00000000000201',7,
  '9e200000-0000-4000-8000-0000000000f1',10,true);
insert into public.breads(id,name,days,active,unit,is_special,is_shelf)
values ('teste-corrige-pj-a','[TESTE] Pao corrige A','{0,1,2,3,4,5,6}',true,'un',false,false);
insert into public.products(id,name,kind,is_fabricacao_propria,production_process,production_area,
  allows_planned_production,allows_unplanned_production,unit,active)
values ('9e200000-0000-4000-8000-00000000a0a1','[TESTE] Brioche corrige PJ','final',true,'forno','padaria',true,false,'un',true);
insert into public.product_variants(id,product_id,name,sort_order)
values ('9e200000-0000-4000-8000-00000000d0d2','9e200000-0000-4000-8000-00000000a0a1','Hamburguer',1);
insert into public.product_sale_options(id,product_id,product_variant_id,name,sale_unit,reference_quantity,unit_weight_kg,is_default,active)
values
 ('9e200000-0000-4000-8000-00000000b0b2','9e200000-0000-4000-8000-00000000a0a1','9e200000-0000-4000-8000-00000000d0d2','Hamburguer un','un',1,0.08,true,true),
 ('9e200000-0000-4000-8000-00000000b0b3','9e200000-0000-4000-8000-00000000a0a1','9e200000-0000-4000-8000-00000000d0d2','Hamburguer kg','kg',1,null,false,true);
insert into public.product_pj_pack_rules(product_id,product_variant_id,pack_size_units,min_order_packs,order_multiple_packs)
values ('9e200000-0000-4000-8000-00000000a0a1','9e200000-0000-4000-8000-00000000d0d2',12,1,1);
insert into public.price_tier_items(tier_id,product_id,product_source,product_name,unit_price,pricing_unit,pack_size,sale_option_id,active)
values
 ('9e200000-0000-4000-8000-0000000000f1','teste-corrige-pj-a','bread','[TESTE] Pao corrige A',10,'un',1,null,true),
 ('9e200000-0000-4000-8000-0000000000f1','9e200000-0000-4000-8000-00000000a0a1','product','[TESTE] Brioche corrige',60,'kg',1,'9e200000-0000-4000-8000-00000000b0b3',true);

create function pg_temp.linhas(p_paes integer, p_pacotes integer) returns jsonb
language sql immutable as $$
  select jsonb_build_array(
    jsonb_build_object('product_source','bread','product_id','teste-corrige-pj-a',
      'packs',p_paes,'quantity',p_paes,'unit','un'),
    jsonb_build_object('product_source','product','product_id','9e200000-0000-4000-8000-00000000a0a1',
      'sale_option_id','9e200000-0000-4000-8000-00000000b0b3','packs',p_pacotes,
      'quantity',round(p_pacotes * 0.96, 3),'unit','kg','pack_units',12));
$$;

create function pg_temp.como(p_user text) returns void
language sql volatile as $$
  select set_config('request.jwt.claim.sub', p_user, true);
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.lancar(p_group uuid) returns jsonb
language sql volatile as $$
  select public.create_pj_order_by_expedition(gen_random_uuid(), p_group,
    '9e200000-0000-4000-8000-0000000000c1', private.data_na_padaria() + 2, 'Entregar cedo', pg_temp.linhas(3, 2));
$$;

-- Versão das linhas como a leitura devolve para a tela.
create function pg_temp.versao(p_group uuid) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'updated_at', updated_at) order by id), '[]'::jsonb)
  from public.orders where order_group_id = p_group;
$$;

create function pg_temp.corrigir(p_request uuid, p_group uuid, p_lines jsonb, p_expected jsonb,
  p_days integer default 3) returns jsonb
language sql volatile as $$
  select public.replace_pj_order_by_expedition(p_request, p_group, private.data_na_padaria() + p_days,
    'Entregar a tarde', p_lines, p_expected);
$$;

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

-- -------------------------------------------------------------------------
-- Contrato publicado
-- -------------------------------------------------------------------------
select ok(not has_function_privilege('anon','public.read_pj_expedition_order(uuid)','execute'),
  'anonimo nao le o pedido para correcao');
select ok(not has_function_privilege('anon','public.replace_pj_order_by_expedition(uuid,uuid,date,text,jsonb,jsonb)','execute'),
  'anonimo nao corrige');
select ok(not has_function_privilege('anon','public.cancel_pj_order_by_expedition(uuid,uuid,text)','execute'),
  'anonimo nao cancela');
select ok(has_function_privilege('authenticated','public.replace_pj_order_by_expedition(uuid,uuid,date,text,jsonb,jsonb)','execute'),
  'navegador autenticado chama a correcao, que confere o perfil por dentro');
select ok(not has_function_privilege('authenticated','private.pj_expedition_order_rows(uuid,text,date,date,text,jsonb)','execute'),
  'navegador nao chama a conta das linhas com preco');
select ok(not has_function_privilege('authenticated','private.pj_expedition_change_blocked_reason(uuid)','execute'),
  'navegador nao chama a guarda interna');
select ok((select description from public.app_permissions where key = 'pedidos_pj.lancar') ~ 'corrige ou cancela',
  'a descricao da permissao diz que ela tambem corrige e cancela o proprio pedido');

-- -------------------------------------------------------------------------
-- Pedidos de partida: G1 e G2 lancados pela autora, G3 pela colega e G4
-- criado pelo Financeiro.
-- -------------------------------------------------------------------------
set local role authenticated;
select pg_temp.como('9e200000-0000-4000-8000-000000000001');
select pg_temp.lancar('9e200000-0000-4000-8000-000000000201');
select pg_temp.lancar('9e200000-0000-4000-8000-000000000202');
select pg_temp.lancar('9e200000-0000-4000-8000-000000000205');
select pg_temp.como('9e200000-0000-4000-8000-000000000002');
select pg_temp.lancar('9e200000-0000-4000-8000-000000000203');
select pg_temp.como('9e200000-0000-4000-8000-000000000003');
select public.create_pj_order_atomic('9e200000-0000-4000-8000-000000000104',
  '9e200000-0000-4000-8000-000000000204', jsonb_build_array(jsonb_build_object(
    'bread_id','teste-corrige-pj-a','product_source','bread','product_name','[TESTE] Pao corrige A',
    'quantity',1,'unit_price',9.00,'pack_size',1,'pricing_unit','un',
    'customer_id','9e200000-0000-4000-8000-0000000000c1','pj_client','[TESTE] Cliente corrige PJ',
    'order_date',private.data_na_padaria(),'delivery_date',private.data_na_padaria()+2)));
reset role;

-- -------------------------------------------------------------------------
-- Leitura
-- -------------------------------------------------------------------------
set local role authenticated;
select pg_temp.como('9e200000-0000-4000-8000-000000000001');
create temp table leitura as select public.read_pj_expedition_order('9e200000-0000-4000-8000-000000000201') as body;
reset role;
select is((select body->>'can_change' from leitura), 'true', 'a autora pode corrigir o proprio pedido antes da conferencia');
select is((select body->'order'->>'customer_name' from leitura), '[TESTE] Cliente corrige PJ', 'a leitura traz o cliente');
select is((select body->'order'->>'obs' from leitura), 'Entregar cedo', 'a leitura traz a observacao');
select is((select (body->'order'->>'delivery_date')::date from leitura), private.data_na_padaria() + 2, 'a leitura traz a entrega');
select is((select jsonb_array_length(body->'order'->'lines') from leitura), 2, 'a leitura traz as duas linhas');
select is((select body->'order'->'expected_rows' from leitura), pg_temp.versao('9e200000-0000-4000-8000-000000000201'),
  'a leitura traz a versao das linhas para a correcao devolver');
select ok((select not (body::text ~* 'price|valor|discount|54\.00|9\.00') from leitura),
  'a leitura nao carrega preco nem desconto');
select results_eq($q$select item->>'action', item->>'by_name', item->>'by_me' from leitura, jsonb_array_elements(body->'history') item$q$,
  $q$values ('create_expedition'::text, '[TESTE] Expedicao autora'::text, 'true'::text)$q$,
  'o historico mostra quem lancou');

set local role authenticated;
select pg_temp.como('9e200000-0000-4000-8000-000000000002');
select results_eq($q$select body->>'can_change', body->>'change_blocked_reason', body->'order' = 'null'::jsonb
  from (select public.read_pj_expedition_order('9e200000-0000-4000-8000-000000000201') as body) x$q$,
  $q$values ('false'::text, 'Este pedido foi lançado por outra pessoa da Expedição. Só quem lançou pode corrigir ou cancelar.'::text, true)$q$,
  'a colega da Expedicao ve o motivo e nao recebe o pedido para o formulario');
select pg_temp.como('9e200000-0000-4000-8000-000000000003');
select results_eq($q$select body->>'can_change', body->>'change_blocked_reason', body->'order' = 'null'::jsonb,
    body->'history'->0->>'by_name'
  from (select public.read_pj_expedition_order('9e200000-0000-4000-8000-000000000201') as body) x$q$,
  $q$values ('false'::text, null::text, true, '[TESTE] Expedicao autora'::text)$q$,
  'o Financeiro le o historico, sem formulario da Expedicao');
select pg_temp.como('9e200000-0000-4000-8000-000000000004');
select throws_ok($q$select public.read_pj_expedition_order('9e200000-0000-4000-8000-000000000201')$q$,
  '42501', null, 'Vendas nao le');
select pg_temp.como('9e200000-0000-4000-8000-000000000005');
select throws_ok($q$select public.read_pj_expedition_order('9e200000-0000-4000-8000-000000000201')$q$,
  '42501', null, 'Expedicao de outra loja nao le');
select pg_temp.como('9e200000-0000-4000-8000-000000000001');
select is((public.read_pj_expedition_order('9e200000-0000-4000-8000-000000000204'))->>'change_blocked_reason',
  'Este pedido não foi lançado pela Expedição. Peça a correção ao Financeiro.',
  'pedido criado pelo Financeiro mostra o motivo para a autora');
reset role;

-- -------------------------------------------------------------------------
-- Correcao
-- -------------------------------------------------------------------------
create temp table versao_g1 as select pg_temp.versao('9e200000-0000-4000-8000-000000000201') as body;
grant select on versao_g1 to authenticated;
set local role authenticated;
select pg_temp.como('9e200000-0000-4000-8000-000000000001');
create temp table correcao as select pg_temp.corrigir('9e200000-0000-4000-8000-000000000301',
  '9e200000-0000-4000-8000-000000000201', pg_temp.linhas(5, 1), (select body from versao_g1)) as body;
reset role;
select is((select body->>'repeated' from correcao), 'false', 'a autora corrige o pedido');
select ok((select not (body::text ~* 'price|valor') from correcao), 'a resposta da correcao nao traz preco');
select results_eq($q$select bread_id, quantity, unit_price, pricing_unit, delivery_date - private.data_na_padaria(),
    order_date = private.data_na_padaria(), obs, pj_client
  from public.orders where order_group_id = '9e200000-0000-4000-8000-000000000201' order by bread_id$q$,
  $q$values ('9e200000-0000-4000-8000-00000000a0a1'::text, 0.96::numeric, 54.00::numeric, 'kg'::text, 3, true, 'Entregar a tarde'::text, '[TESTE] Cliente corrige PJ'::text),
    ('teste-corrige-pj-a', 5, 9.00, 'un', 3, true, 'Entregar a tarde', '[TESTE] Cliente corrige PJ')$q$,
  'o banco reprecifica pela tabela: 5 x 9,00 e 1 pacote de 12 x 80 g = 0,96 kg a 54,00; cliente e data do pedido ficam');
select results_eq($q$select activation_mode, version, checked_at is null from private.pj_flow
  where order_group_id = '9e200000-0000-4000-8000-000000000201'$q$,
  $q$values ('standard'::text, 0, true)$q$, 'o pedido continua na jornada, aguardando a conferencia');
select results_eq($q$select actor, action from private.pj_order_write_requests
  where request_id = '9e200000-0000-4000-8000-000000000301'$q$,
  $q$values ('9e200000-0000-4000-8000-000000000001'::uuid, 'replace_expedition'::text)$q$,
  'a trilha guarda quem corrigiu e que foi pela Expedicao');
select ok((select not (request_payload::text ~* 'price') from private.pj_order_write_requests
  where request_id = '9e200000-0000-4000-8000-000000000301'), 'a trilha guarda a correcao como a Expedicao enviou, sem preco');

-- Resposta perdida: a mesma tentativa devolve o resultado, mesmo com a tabela
-- alterada depois; outro conteudo com o mesmo identificador e recusado.
update public.price_tier_items set unit_price = 12
where tier_id = '9e200000-0000-4000-8000-0000000000f1' and product_id = 'teste-corrige-pj-a';
set local role authenticated;
select pg_temp.como('9e200000-0000-4000-8000-000000000001');
select is((pg_temp.corrigir('9e200000-0000-4000-8000-000000000301', '9e200000-0000-4000-8000-000000000201',
  pg_temp.linhas(5, 1), (select body from versao_g1)))->>'repeated', 'true',
  'resposta perdida repete a mesma correcao sem gravar de novo');
select throws_ok($q$select pg_temp.corrigir('9e200000-0000-4000-8000-000000000301', '9e200000-0000-4000-8000-000000000201',
  pg_temp.linhas(6, 1), (select body from versao_g1))$q$, '22023', 'Identificador ja usado para outra operacao.',
  'mesmo identificador com outra quantidade e recusado');
-- A versao lida antes da correcao ficou velha.
select throws_ok($q$select pg_temp.corrigir(gen_random_uuid(), '9e200000-0000-4000-8000-000000000201',
  pg_temp.linhas(6, 1), (select body from versao_g1))$q$, 'PT409',
  'O pedido mudou depois que voce abriu a correcao. Recarregue e corrija de novo.',
  'correcao sobre versao velha e recusada sem repeticao automatica');
reset role;
select is((select unit_price from public.orders where order_group_id = '9e200000-0000-4000-8000-000000000201'
  and bread_id = 'teste-corrige-pj-a'), 9.00::numeric, 'a repeticao nao reprecificou o pedido');
update public.price_tier_items set unit_price = 10
where tier_id = '9e200000-0000-4000-8000-0000000000f1' and product_id = 'teste-corrige-pj-a';

create temp table versao_g1b as select pg_temp.versao('9e200000-0000-4000-8000-000000000201') as body;
grant select on versao_g1b to authenticated;
set local role authenticated;
select pg_temp.como('9e200000-0000-4000-8000-000000000001');
select throws_ok($q$select pg_temp.corrigir(gen_random_uuid(), '9e200000-0000-4000-8000-000000000201',
  '[{"product_source":"bread","product_id":"teste-corrige-pj-a","packs":1,"quantity":1,"unit":"un","unit_price":0.01}]',
  (select body from versao_g1b))$q$, '22023', 'O pedido contem campos desconhecidos.', 'preco enviado pelo navegador e recusado');
select throws_ok($q$select pg_temp.corrigir(gen_random_uuid(), '9e200000-0000-4000-8000-000000000201',
  '[{"product_source":"product","product_id":"9e200000-0000-4000-8000-00000000a0a1","sale_option_id":"9e200000-0000-4000-8000-00000000b0b3","packs":1,"quantity":1.2,"unit":"kg","pack_units":12}]',
  (select body from versao_g1b))$q$, '22023',
  'O pacote, o peso ou a unidade de um produto mudou no cadastro. Recarregue a lista de produtos e revise as quantidades.',
  'quantidade diferente da mostrada na tela e recusada tambem na correcao');
select throws_ok($q$select pg_temp.corrigir(gen_random_uuid(), '9e200000-0000-4000-8000-000000000201',
  pg_temp.linhas(5, 1), (select body from versao_g1b), -1)$q$, '22023',
  'A nova data de entrega nao pode ficar no passado.', 'nova entrega no passado e recusada');
select throws_ok($q$select pg_temp.corrigir(gen_random_uuid(), '9e200000-0000-4000-8000-000000000201',
  '[{"product_source":"bread","product_id":"teste-corrige-pj-a","packs":1,"quantity":1,"unit":"un"},{"product_source":"bread","product_id":"teste-corrige-pj-a","packs":2,"quantity":2,"unit":"un"}]',
  (select body from versao_g1b))$q$, '22023', 'O mesmo produto aparece duas vezes. Some as quantidades numa linha so.',
  'produto repetido e recusado na correcao');
select throws_ok($q$select public.replace_pj_order_by_expedition(gen_random_uuid(), '9e200000-0000-4000-8000-000000000201',
  private.data_na_padaria() + 3, '', pg_temp.linhas(5, 1), '[]')$q$, '22023',
  'A versao anterior do pedido e obrigatoria.', 'correcao sem a versao lida e recusada');

-- Matriz de quem nao corrige nem cancela G1.
select pg_temp.como('9e200000-0000-4000-8000-000000000002');
select throws_ok($q$select pg_temp.corrigir(gen_random_uuid(), '9e200000-0000-4000-8000-000000000201',
  pg_temp.linhas(5, 1), (select body from versao_g1b))$q$, '22023',
  'Este pedido foi lançado por outra pessoa da Expedição. Só quem lançou pode corrigir ou cancelar.',
  'colega da Expedicao nao corrige o pedido da autora');
select throws_ok($q$select public.cancel_pj_order_by_expedition(gen_random_uuid(), '9e200000-0000-4000-8000-000000000201',
  'Cliente desistiu')$q$, '22023',
  'Este pedido foi lançado por outra pessoa da Expedição. Só quem lançou pode corrigir ou cancelar.',
  'colega da Expedicao nao cancela o pedido da autora');
select pg_temp.como('9e200000-0000-4000-8000-000000000003');
select throws_ok($q$select pg_temp.corrigir(gen_random_uuid(), '9e200000-0000-4000-8000-000000000201',
  pg_temp.linhas(5, 1), (select body from versao_g1b))$q$, '42501', null,
  'Financeiro com a permissao nova nao usa a correcao da Expedicao');
select throws_ok($q$select public.cancel_pj_order_by_expedition(gen_random_uuid(), '9e200000-0000-4000-8000-000000000201',
  'Cliente desistiu')$q$, '42501', null, 'Financeiro nao usa o cancelamento da Expedicao');
select pg_temp.como('9e200000-0000-4000-8000-000000000004');
select throws_ok($q$select pg_temp.corrigir(gen_random_uuid(), '9e200000-0000-4000-8000-000000000201',
  pg_temp.linhas(5, 1), (select body from versao_g1b))$q$, '42501', null, 'Vendas com a permissao nao corrige');
select throws_ok($q$select public.cancel_pj_order_by_expedition(gen_random_uuid(), '9e200000-0000-4000-8000-000000000201',
  'Cliente desistiu')$q$, '42501', null, 'Vendas com a permissao nao cancela');
select pg_temp.como('9e200000-0000-4000-8000-000000000005');
select throws_ok($q$select pg_temp.corrigir(gen_random_uuid(), '9e200000-0000-4000-8000-000000000201',
  pg_temp.linhas(5, 1), (select body from versao_g1b))$q$, '42501', null, 'Expedicao de outra loja nao corrige');
select pg_temp.como('9e200000-0000-4000-8000-000000000006');
select throws_ok($q$select public.cancel_pj_order_by_expedition(gen_random_uuid(), '9e200000-0000-4000-8000-000000000201',
  'Cliente desistiu')$q$, '42501', null, 'Expedicao sem a permissao nova nao cancela');

-- Dica: recusa depois da procura avisa que nada foi gravado; acesso negado e
-- identificador reaproveitado nao.
select pg_temp.como('9e200000-0000-4000-8000-000000000002');
select is(pg_temp.dica($q$select pg_temp.corrigir(gen_random_uuid(), '9e200000-0000-4000-8000-000000000201',
  pg_temp.linhas(5, 1), (select body from versao_g1b))$q$), 'pj-launch-not-saved',
  'recusa por autoria avisa que nada foi gravado');
select pg_temp.como('9e200000-0000-4000-8000-000000000001');
select is(pg_temp.dica($q$select pg_temp.corrigir(gen_random_uuid(), '9e200000-0000-4000-8000-000000000201',
  pg_temp.linhas(6, 1), (select body from versao_g1))$q$), 'pj-launch-not-saved',
  'recusa por versao velha avisa que nada foi gravado');
select is(pg_temp.dica($q$select pg_temp.corrigir('9e200000-0000-4000-8000-000000000301', '9e200000-0000-4000-8000-000000000201',
  pg_temp.linhas(6, 1), (select body from versao_g1))$q$), 'sem dica',
  'identificador ja usado com outro conteudo nao libera envio novo');
select pg_temp.como('9e200000-0000-4000-8000-000000000003');
select is(pg_temp.dica($q$select public.cancel_pj_order_by_expedition(gen_random_uuid(),
  '9e200000-0000-4000-8000-000000000201', 'Cliente desistiu')$q$), 'sem dica',
  'acesso negado nao prova nada sobre tentativa anterior');

-- A autora nao mexe no pedido da colega nem no criado pelo Financeiro.
select pg_temp.como('9e200000-0000-4000-8000-000000000001');
select throws_ok($q$select public.cancel_pj_order_by_expedition(gen_random_uuid(), '9e200000-0000-4000-8000-000000000203',
  'Cliente desistiu')$q$, '22023',
  'Este pedido foi lançado por outra pessoa da Expedição. Só quem lançou pode corrigir ou cancelar.',
  'a autora nao cancela o pedido da colega');
select throws_ok($q$select public.cancel_pj_order_by_expedition(gen_random_uuid(), '9e200000-0000-4000-8000-000000000204',
  'Cliente desistiu')$q$, '22023',
  'Este pedido não foi lançado pela Expedição. Peça a correção ao Financeiro.',
  'a autora nao cancela pedido criado pelo Financeiro');
reset role;

-- -------------------------------------------------------------------------
-- G2: o Financeiro altera o pedido da Expedicao; a partir dai so ele mexe.
-- -------------------------------------------------------------------------
create temp table linhas_g2 as select
  jsonb_agg(jsonb_build_object('bread_id', bread_id, 'product_source', product_source,
    'product_name', product_name, 'quantity', quantity, 'unit_price', unit_price, 'pack_size', pack_size,
    'pricing_unit', pricing_unit, 'sale_option_id', sale_option_id, 'customer_id', customer_id,
    'pj_client', pj_client, 'order_date', order_date, 'delivery_date', delivery_date,
    'obs', 'Alterado pelo Financeiro') order by id) as rows,
  pg_temp.versao('9e200000-0000-4000-8000-000000000202') as expected
from public.orders where order_group_id = '9e200000-0000-4000-8000-000000000202';
grant select on linhas_g2 to authenticated;
set local role authenticated;
select pg_temp.como('9e200000-0000-4000-8000-000000000003');
select lives_ok($q$select public.replace_pj_order_atomic_v2(gen_random_uuid(), '9e200000-0000-4000-8000-000000000202',
  (select rows from linhas_g2), (select expected from linhas_g2))$q$, 'o Financeiro altera o pedido lancado pela Expedicao');
select pg_temp.como('9e200000-0000-4000-8000-000000000001');
select is((public.read_pj_expedition_order('9e200000-0000-4000-8000-000000000202'))->>'change_blocked_reason',
  'O Financeiro alterou este pedido depois do lançamento. Peça a correção ao Financeiro.',
  'depois da alteracao do Financeiro a autora ve o motivo');
select throws_ok($q$select public.cancel_pj_order_by_expedition(gen_random_uuid(), '9e200000-0000-4000-8000-000000000202',
  'Cliente desistiu')$q$, '22023',
  'O Financeiro alterou este pedido depois do lançamento. Peça a correção ao Financeiro.',
  'depois da alteracao do Financeiro a autora nao cancela');
select is((select jsonb_agg(item->>'action' order by item->>'at')
  from jsonb_array_elements((public.read_pj_expedition_order('9e200000-0000-4000-8000-000000000202'))->'history') item),
  '["create_expedition", "replace_v2"]'::jsonb, 'o historico mostra o lancamento e a alteracao do Financeiro');
reset role;

-- -------------------------------------------------------------------------
-- G1: a conferencia comeca; a partir dai a correcao e na conferencia.
-- -------------------------------------------------------------------------
create temp table itens_g1 as select jsonb_agg(jsonb_build_object('id', id, 'quantity', quantity, 'reason', null)) as items
from public.orders where order_group_id = '9e200000-0000-4000-8000-000000000201';
grant select on itens_g1 to authenticated;
create temp table versao_g1c as select pg_temp.versao('9e200000-0000-4000-8000-000000000201') as body;
grant select on versao_g1c to authenticated;
set local role authenticated;
select pg_temp.como('9e200000-0000-4000-8000-000000000001');
select lives_ok($q$select public.transition_pj_flow_pilot(gen_random_uuid(), '9e200000-0000-4000-8000-000000000201',
  0, 'save', (select items from itens_g1))$q$, 'a conferencia do G1 e salva');
select throws_ok($q$select pg_temp.corrigir(gen_random_uuid(), '9e200000-0000-4000-8000-000000000201',
  pg_temp.linhas(5, 1), (select body from versao_g1c))$q$, '22023',
  'A conferência deste pedido já começou. Ajuste as quantidades na conferência ou peça a correção ao Financeiro.',
  'depois que a conferencia comeca a autora nao corrige');
select throws_ok($q$select public.cancel_pj_order_by_expedition(gen_random_uuid(), '9e200000-0000-4000-8000-000000000201',
  'Cliente desistiu')$q$, '22023',
  'A conferência deste pedido já começou. Ajuste as quantidades na conferência ou peça a correção ao Financeiro.',
  'depois que a conferencia comeca a autora nao cancela');
select is((public.read_pj_expedition_order('9e200000-0000-4000-8000-000000000201'))->'order', 'null'::jsonb,
  'depois da conferencia a leitura nao devolve o formulario');
reset role;
select is((select count(*)::int from public.orders where order_group_id = '9e200000-0000-4000-8000-000000000201'
  and cancelled_at is null), 2, 'o G1 segue inteiro na conferencia');

-- -------------------------------------------------------------------------
-- G5: cancelamento pela autora.
-- -------------------------------------------------------------------------
set local role authenticated;
select pg_temp.como('9e200000-0000-4000-8000-000000000001');
select throws_ok($q$select public.cancel_pj_order_by_expedition(gen_random_uuid(), '9e200000-0000-4000-8000-000000000205',
  'ok')$q$, '22023', 'Informe o motivo do cancelamento, com 3 a 500 caracteres.', 'motivo curto e recusado');
create temp table cancelamento as select public.cancel_pj_order_by_expedition('9e200000-0000-4000-8000-000000000401',
  '9e200000-0000-4000-8000-000000000205', '  Cliente desistiu  ') as body;
select is((select body->>'repeated' from cancelamento), 'false', 'a autora cancela o proprio pedido');
select is((public.cancel_pj_order_by_expedition('9e200000-0000-4000-8000-000000000401',
  '9e200000-0000-4000-8000-000000000205', 'Cliente desistiu'))->>'repeated', 'true',
  'resposta perdida repete o mesmo cancelamento');
select throws_ok($q$select public.cancel_pj_order_by_expedition('9e200000-0000-4000-8000-000000000401',
  '9e200000-0000-4000-8000-000000000205', 'Outro motivo')$q$, '22023', 'Identificador ja usado para outra operacao.',
  'mesmo identificador com outro motivo e recusado');
select throws_ok($q$select public.cancel_pj_order_by_expedition(gen_random_uuid(), '9e200000-0000-4000-8000-000000000205',
  'Cliente desistiu')$q$, '22023', 'Este pedido não está mais na jornada dos Pedidos PJ. Recarregue a lista.',
  'pedido cancelado nao e cancelado de novo');
select is((public.read_pj_expedition_order('9e200000-0000-4000-8000-000000000205'))->>'change_blocked_reason',
  'Este pedido não está mais na jornada dos Pedidos PJ. Recarregue a lista.', 'leitura do cancelado mostra o motivo');
select is((select jsonb_agg(item->>'action' order by item->>'at')
  from jsonb_array_elements((public.read_pj_expedition_order('9e200000-0000-4000-8000-000000000205'))->'history') item),
  '["create_expedition", "cancel"]'::jsonb, 'o historico mostra o lancamento e o cancelamento');
reset role;
select results_eq($q$select count(*)::int, bool_and(cancelled_at is not null), min(cancelled_by), min(cancel_reason)
  from public.orders where order_group_id = '9e200000-0000-4000-8000-000000000205'$q$,
  $q$values (2, true, '[TESTE] Expedicao autora'::text, 'Cliente desistiu'::text)$q$,
  'as linhas ficam canceladas com quem cancelou e o motivo, como no cancelamento do Financeiro');
select ok(not exists (select 1 from private.pj_flow where order_group_id = '9e200000-0000-4000-8000-000000000205'),
  'o pedido cancelado sai da jornada');
select ok(private.is_pj_flow('9e200000-0000-4000-8000-000000000205'),
  'o pedido cancelado continua protegido como pedido da jornada');
select results_eq($q$select action, request_payload->>'origin' from private.pj_order_write_requests
  where request_id = '9e200000-0000-4000-8000-000000000401'$q$,
  $q$values ('cancel'::text, 'expedition'::text)$q$, 'a trilha guarda o cancelamento com a origem Expedicao');
set local role authenticated;
select pg_temp.como('9e200000-0000-4000-8000-000000000006');
select is((select count(*)::int from public.orders where order_group_id = '9e200000-0000-4000-8000-000000000205'), 0,
  'a Expedicao continua sem ler o pedido cancelado direto na tabela');
reset role;

-- -------------------------------------------------------------------------
-- Entrega no passado que ja era a do pedido: a correcao pode manter.
-- -------------------------------------------------------------------------
set local role authenticated;
select pg_temp.como('9e200000-0000-4000-8000-000000000001');
select pg_temp.lancar('9e200000-0000-4000-8000-000000000206');
reset role;
-- O dia passa: a entrega combinada fica para ontem.
select set_config('pane.pj_order_write', '9e200000-0000-4000-8000-000000000206', true);
update public.orders set delivery_date = private.data_na_padaria() - 1, pj_delivery_date = private.data_na_padaria() - 1
where order_group_id = '9e200000-0000-4000-8000-000000000206';
select set_config('pane.pj_order_write', '', true);
create temp table versao_g6 as select pg_temp.versao('9e200000-0000-4000-8000-000000000206') as body;
grant select on versao_g6 to authenticated;
set local role authenticated;
select pg_temp.como('9e200000-0000-4000-8000-000000000001');
select lives_ok($q$select pg_temp.corrigir(gen_random_uuid(), '9e200000-0000-4000-8000-000000000206',
  pg_temp.linhas(4, 2), (select body from versao_g6), -1)$q$, 'entrega que ja estava no passado pode ficar na correcao');

-- -------------------------------------------------------------------------
-- Permissao retirada com a tela aberta bloqueia na hora.
-- -------------------------------------------------------------------------
create temp table versao_g6b as select public.read_pj_expedition_order('9e200000-0000-4000-8000-000000000206')->'order'->'expected_rows' as body;
reset role;
delete from public.app_user_permissions
where user_id = '9e200000-0000-4000-8000-000000000001' and permission_key = 'pedidos_pj.lancar';
grant select on versao_g6b to authenticated;
set local role authenticated;
select pg_temp.como('9e200000-0000-4000-8000-000000000001');
select throws_ok($q$select pg_temp.corrigir(gen_random_uuid(), '9e200000-0000-4000-8000-000000000206',
  pg_temp.linhas(4, 2), (select body from versao_g6b))$q$, '42501', null,
  'permissao retirada bloqueia a proxima correcao');
select throws_ok($q$select public.cancel_pj_order_by_expedition(gen_random_uuid(), '9e200000-0000-4000-8000-000000000206',
  'Cliente desistiu')$q$, '42501', null, 'permissao retirada bloqueia o proximo cancelamento');
select results_eq($q$select body->>'can_change', body->'order' = 'null'::jsonb
  from (select public.read_pj_expedition_order('9e200000-0000-4000-8000-000000000206') as body) x$q$,
  $q$values ('false'::text, true)$q$, 'sem a permissao a leitura nao devolve o formulario');
reset role;
select is((select count(*)::int from public.orders where order_group_id = '9e200000-0000-4000-8000-000000000206'
  and cancelled_at is null), 2, 'o pedido continua como estava');

select * from finish();
rollback;
