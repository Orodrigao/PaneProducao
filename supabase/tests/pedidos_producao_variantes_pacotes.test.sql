-- Fase 2, parte 2 do saneamento do catálogo: pedido PJ com variante e pacote
-- fechado chega até produção e Forno sem confundir variantes diferentes do
-- mesmo produto nem cobrança com quantidade física.
--
-- Caso guia: Brioche Hamburguer pesa 80 g/unidade e fecha sempre em pacotes
-- de 12 (0,96 kg), mesmo quando o preço é por kg. Brioche Forma é a mesma
-- receita, outra variante, sem regra de pacote.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Sem isso, create_pj_order_atomic em 'standard' exigiria prazo de pagamento
-- do cliente e permissão da jornada nova; 'preparing' testa só o contrato
-- comum de escrita, que é o que esta fase toca.
update private.pj_flow_rollout_settings
set state = 'preparing', cutover_at = null, updated_at = clock_timestamp()
where singleton;

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('9a200000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','variantes-pacotes-admin@example.com','',now(),now(),now(),
   '{"provider":"email","providers":["email"]}','{}',false),
  ('9a200000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','variantes-pacotes-expedicao@example.com','',now(),now(),now(),
   '{"provider":"email","providers":["email"]}','{}',false);

insert into public.app_profiles(user_id, display_name, role, store, active, allowed_routes)
values
  ('9a200000-0000-4000-8000-000000000001','[TESTE] Admin Pacotes PJ','admin','jc',true,'["/pedidos-pj","/forno"]'),
  ('9a200000-0000-4000-8000-000000000002','[TESTE] Expedicao Pacotes PJ','expedicao','jc',true,'["/pedidos-pj"]');

insert into public.app_user_permissions(user_id, permission_key, scope)
values ('9a200000-0000-4000-8000-000000000002','pedidos_pj.acessar','jc');

insert into public.customers(id, name, doc, payment_term_days, active)
values ('9a200000-0000-4000-8000-0000000000c1','[TESTE] Cliente Pacotes PJ','00000000000198',7,true);

-- Produto legado, sem variante: o caminho antigo continua igual.
insert into public.products(
  id, name, kind, is_fabricacao_propria, production_process, production_area,
  allows_planned_production, unit, active
) values (
  '9a200000-0000-4000-8000-0000000000p1','[TESTE] Baguete Pacotes PJ','final',true,
  'forno','padaria',true,'un',true
);
insert into public.product_sale_options(id, product_id, name, sale_unit, reference_quantity, is_default, active)
values ('9a200000-0000-4000-8000-0000000000s1','9a200000-0000-4000-8000-0000000000p1','Unidade','un',1,true,true);
insert into public.customer_price_overrides(
  customer_id, product_id, product_source, product_name, unit_price, pricing_unit, pack_size,
  sale_option_id, active
) values (
  '9a200000-0000-4000-8000-0000000000c1','9a200000-0000-4000-8000-0000000000p1','product',
  '[TESTE] Baguete Pacotes PJ',10,'un',1,'9a200000-0000-4000-8000-0000000000s1',true
);

-- Produto com duas variantes: Forma (sem regra de pacote) e Hamburguer
-- (pacote fechado de 12, 80 g/unidade).
insert into public.products(
  id, name, kind, is_fabricacao_propria, production_process, production_area,
  allows_planned_production, unit, active
) values (
  '9a200000-0000-4000-8000-0000000000p2','[TESTE] Brioche Pacotes PJ','final',true,
  'forno','padaria',true,'un',true
);
insert into public.product_variants(id, product_id, name, sort_order)
values
  ('9a200000-0000-4000-8000-0000000000v1','9a200000-0000-4000-8000-0000000000p2','Forma',1),
  ('9a200000-0000-4000-8000-0000000000v2','9a200000-0000-4000-8000-0000000000p2','Hamburguer',2);

insert into public.product_sale_options(id, product_id, product_variant_id, name, sale_unit, reference_quantity, unit_weight_kg, is_default, active)
values
  ('9a200000-0000-4000-8000-0000000000s2','9a200000-0000-4000-8000-0000000000p2','9a200000-0000-4000-8000-0000000000v1','Forma un','un',1,null,true,true),
  ('9a200000-0000-4000-8000-0000000000s3','9a200000-0000-4000-8000-0000000000p2','9a200000-0000-4000-8000-0000000000v1','Forma kg','kg',1,null,false,true),
  ('9a200000-0000-4000-8000-0000000000s4','9a200000-0000-4000-8000-0000000000p2','9a200000-0000-4000-8000-0000000000v2','Hamburguer un','un',1,0.08,true,true),
  ('9a200000-0000-4000-8000-0000000000s5','9a200000-0000-4000-8000-0000000000p2','9a200000-0000-4000-8000-0000000000v2','Hamburguer kg','kg',1,null,false,true);

insert into public.product_pj_pack_rules(product_id, product_variant_id, pack_size_units, min_order_packs, order_multiple_packs)
values ('9a200000-0000-4000-8000-0000000000p2','9a200000-0000-4000-8000-0000000000v2',12,1,1);

insert into public.customer_price_overrides(
  customer_id, product_id, product_source, product_name, unit_price, pricing_unit, pack_size,
  sale_option_id, active
) values
  ('9a200000-0000-4000-8000-0000000000c1','9a200000-0000-4000-8000-0000000000p2','product',
   '[TESTE] Brioche Pacotes PJ · Forma',8,'un',1,'9a200000-0000-4000-8000-0000000000s2',true),
  ('9a200000-0000-4000-8000-0000000000c1','9a200000-0000-4000-8000-0000000000p2','product',
   '[TESTE] Brioche Pacotes PJ · Forma',30,'kg',1,'9a200000-0000-4000-8000-0000000000s3',true),
  ('9a200000-0000-4000-8000-0000000000c1','9a200000-0000-4000-8000-0000000000p2','product',
   '[TESTE] Brioche Pacotes PJ · Hamburguer',5,'un',12,'9a200000-0000-4000-8000-0000000000s4',true),
  ('9a200000-0000-4000-8000-0000000000c1','9a200000-0000-4000-8000-0000000000p2','product',
   '[TESTE] Brioche Pacotes PJ · Hamburguer',60,'kg',1,'9a200000-0000-4000-8000-0000000000s5',true);

create function pg_temp.linha(
  p_product_id text, p_sale_option uuid, p_name text, p_quantity numeric,
  p_unit_price numeric, p_pack_size numeric, p_pricing_unit text
) returns jsonb language sql stable as $$
  select jsonb_build_array(jsonb_build_object(
    'bread_id', p_product_id, 'product_source', 'product', 'product_name', p_name,
    'quantity', p_quantity, 'unit_price', p_unit_price, 'pack_size', p_pack_size,
    'pricing_unit', p_pricing_unit, 'sale_option_id', p_sale_option,
    'customer_id', '9a200000-0000-4000-8000-0000000000c1',
    'pj_client', '[TESTE] Cliente Pacotes PJ', 'order_date', private.data_na_padaria(),
    'delivery_date', private.data_na_padaria() + 2, 'pj_delivery_date', private.data_na_padaria() + 2
  ));
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','9a200000-0000-4000-8000-000000000001',true);

-- 1. Produto legado, sem variante: continua funcionando sem exigir pacote.
select lives_ok($$
  select public.create_pj_order_atomic(
    '9a200000-0000-4000-8000-000000000101','9a200000-0000-4000-8000-000000000201',
    pg_temp.linha('9a200000-0000-4000-8000-0000000000p1','9a200000-0000-4000-8000-0000000000s1',
      '[TESTE] Baguete Pacotes PJ',5,10,1,'un')
  )
$$, 'produto legado sem variante continua criando pedido normalmente');
select is((select product_variant_id from public.orders where order_group_id='9a200000-0000-4000-8000-000000000201'),
  null::uuid, 'produto legado nao grava variante nenhuma');

-- 2. Variante em 'un' sem regra de pacote.
select lives_ok($$
  select public.create_pj_order_atomic(
    '9a200000-0000-4000-8000-000000000102','9a200000-0000-4000-8000-000000000202',
    pg_temp.linha('9a200000-0000-4000-8000-0000000000p2','9a200000-0000-4000-8000-0000000000s2',
      '[TESTE] Brioche Pacotes PJ · Forma',3,8,1,'un')
  )
$$, 'variante Forma em un, sem regra de pacote, cria pedido normalmente');
select is((select product_variant_id from public.orders where order_group_id='9a200000-0000-4000-8000-000000000202'),
  '9a200000-0000-4000-8000-0000000000v1'::uuid, 'a linha grava a variante Forma resolvida da opcao de venda');

-- 3. Variante em 'kg' sem regra de pacote.
select lives_ok($$
  select public.create_pj_order_atomic(
    '9a200000-0000-4000-8000-000000000103','9a200000-0000-4000-8000-000000000203',
    pg_temp.linha('9a200000-0000-4000-8000-0000000000p2','9a200000-0000-4000-8000-0000000000s3',
      '[TESTE] Brioche Pacotes PJ · Forma',1.5,30,1,'kg')
  )
$$, 'variante Forma em kg, sem regra de pacote, cria pedido normalmente');

-- 4. Pacote fechado de 12 unidades (Hamburguer, pricing_unit un).
select lives_ok($$
  select public.create_pj_order_atomic(
    '9a200000-0000-4000-8000-000000000104','9a200000-0000-4000-8000-000000000204',
    pg_temp.linha('9a200000-0000-4000-8000-0000000000p2','9a200000-0000-4000-8000-0000000000s4',
      '[TESTE] Brioche Pacotes PJ · Hamburguer',12,5,12,'un')
  )
$$, 'pacote inteiro de 12 unidades do Hamburguer e aceito');
select is((select product_variant_id from public.orders where order_group_id='9a200000-0000-4000-8000-000000000204'),
  '9a200000-0000-4000-8000-0000000000v2'::uuid, 'a linha grava a variante Hamburguer');

-- 5. Quantidade que nao fecha pacote inteiro (10 de 12) e recusada.
select throws_ok($$
  select public.create_pj_order_atomic(
    '9a200000-0000-4000-8000-000000000105','9a200000-0000-4000-8000-000000000205',
    pg_temp.linha('9a200000-0000-4000-8000-0000000000p2','9a200000-0000-4000-8000-0000000000s4',
      '[TESTE] Brioche Pacotes PJ · Hamburguer',10,5,12,'un')
  )
$$, '22023', 'A quantidade precisa fechar em pacotes inteiros deste produto.',
  'dez unidades nao fecham em pacotes de doze, e o pedido nao chega a existir');
select ok(not exists(select 1 from public.orders where order_group_id='9a200000-0000-4000-8000-000000000205'),
  'quantidade recusada nao grava nenhuma linha, mesmo parcial');

-- 6. Conversao 12 unidades x 80 g = 0,96 kg, cobrado por kg.
select lives_ok($$
  select public.create_pj_order_atomic(
    '9a200000-0000-4000-8000-000000000106','9a200000-0000-4000-8000-000000000206',
    pg_temp.linha('9a200000-0000-4000-8000-0000000000p2','9a200000-0000-4000-8000-0000000000s5',
      '[TESTE] Brioche Pacotes PJ · Hamburguer',0.96,60,1,'kg')
  )
$$, 'pacote fechado tambem fecha quando o preco e por kg (12 x 80g = 0,96kg)');
select is((select product_variant_id from public.orders where order_group_id='9a200000-0000-4000-8000-000000000206'),
  '9a200000-0000-4000-8000-0000000000v2'::uuid, 'pedido por kg tambem grava a variante Hamburguer');

-- 7. Peso que nao fecha pacote (0,5kg de 0,96kg) tambem e recusado.
select throws_ok($$
  select public.create_pj_order_atomic(
    '9a200000-0000-4000-8000-000000000107','9a200000-0000-4000-8000-000000000207',
    pg_temp.linha('9a200000-0000-4000-8000-0000000000p2','9a200000-0000-4000-8000-0000000000s5',
      '[TESTE] Brioche Pacotes PJ · Hamburguer',0.5,60,1,'kg')
  )
$$, '22023', 'A quantidade precisa fechar em pacotes inteiros deste produto.',
  'meio quilo nao e multiplo de 0,96kg e o pedido por peso tambem falha fechado');

-- 8. Preco fora da tabela continua recusado (regra antiga preservada).
select throws_ok($$
  select public.create_pj_order_atomic(
    '9a200000-0000-4000-8000-000000000108','9a200000-0000-4000-8000-000000000208',
    pg_temp.linha('9a200000-0000-4000-8000-0000000000p2','9a200000-0000-4000-8000-0000000000s4',
      '[TESTE] Brioche Pacotes PJ · Hamburguer',12,999,12,'un')
  )
$$, '22023', 'O preco ou a forma de venda mudou. Reabra o pedido para usar o catalogo atual.',
  'preco fora da tabela continua barrado mesmo com pacote correto');

-- 9. Persistencia/releitura do snapshot do pedido em pacote.
select results_eq($$
  select product_variant_id, quantity, pack_size, pricing_unit, unit_price
  from public.orders where order_group_id = '9a200000-0000-4000-8000-000000000204'
$$, $$
  values ('9a200000-0000-4000-8000-0000000000v2'::uuid, 12::numeric, 12::numeric, 'un'::text, 5::numeric)
$$, 'reler o pedido em pacotes devolve exatamente a variante, quantidade, pacote, unidade e preco gravados');

reset role;

-- 10. Forno distingue as duas variantes do mesmo produto e converte peso em
-- peças para a Hamburguer, sem somar com a Forma.
set local role authenticated;
select set_config('request.jwt.claim.sub','9a200000-0000-4000-8000-000000000001',true);

select lives_ok($$
  select public.schedule_pj_production(
    private.data_na_padaria(),
    jsonb_build_array(
      jsonb_build_object('order_id',
        (select id from public.orders where order_group_id='9a200000-0000-4000-8000-000000000202'),
        'quantity', 3, 'frozen_quantity', 0),
      jsonb_build_object('order_id',
        (select id from public.orders where order_group_id='9a200000-0000-4000-8000-000000000206'),
        'quantity', 0.96, 'frozen_quantity', 0)
    ),
    '9a200000-0000-4000-8000-00000000f101'::uuid
  )
$$, 'Geolar programa Forma e Hamburguer do mesmo Brioche no mesmo dia');

select is((select count(*)::int from public.list_pj_production_for_oven_v2(private.data_na_padaria())
  where product_source = 'product' and product_id = '9a200000-0000-4000-8000-0000000000p2'), 2,
  'Forno recebe duas linhas separadas para o mesmo produto, uma por variante');
select is((select quantity from public.list_pj_production_for_oven_v2(private.data_na_padaria())
  where product_source = 'product' and product_id = '9a200000-0000-4000-8000-0000000000p2'
    and product_variant_id = '9a200000-0000-4000-8000-0000000000v1'), 3::numeric,
  'previsto da Forma fica em unidades, sem conversao (vendida em un)');
select is((select quantity from public.list_pj_production_for_oven_v2(private.data_na_padaria())
  where product_source = 'product' and product_id = '9a200000-0000-4000-8000-0000000000p2'
    and product_variant_id = '9a200000-0000-4000-8000-0000000000v2'), 12::numeric,
  'previsto da Hamburguer converte 0,96kg em 12 pecas pelo peso unitario de 80g');
select is((select needs_weight_setup from public.list_pj_production_for_oven_v2(private.data_na_padaria())
  where product_source = 'product' and product_id = '9a200000-0000-4000-8000-0000000000p2'
    and product_variant_id = '9a200000-0000-4000-8000-0000000000v2'), false,
  'com peso cadastrado na opcao de venda, nenhum aviso pendente sobra para a Hamburguer');

reset role;

-- 10b. Confirmar o Forno de uma variante nao mistura nem sobrescreve o saldo
-- da outra variante do mesmo produto no mesmo dia (a funcao mais arriscada
-- tocada nesta fase: o indice unico de production_actuals mudou de
-- (product_source, product_id, record_date) para incluir product_variant_id,
-- e confirm_oven_product_output ganhou parametro novo no fim da lista).
set local role authenticated;
select set_config('request.jwt.claim.sub','9a200000-0000-4000-8000-000000000001',true);

select lives_ok($$
  select * from public.confirm_oven_product_output(
    private.data_na_padaria(), 'product', '9a200000-0000-4000-8000-0000000000p2',
    3, 0, null, null, '9a200000-0000-4000-8000-0000000000v1'
  )
$$, 'confirma o Forno da variante Forma');
select lives_ok($$
  select * from public.confirm_oven_product_output(
    private.data_na_padaria(), 'product', '9a200000-0000-4000-8000-0000000000p2',
    12, 0, null, null, '9a200000-0000-4000-8000-0000000000v2'
  )
$$, 'confirma o Forno da variante Hamburguer no mesmo dia, mesmo produto');

select is((select count(*)::int from public.production_actuals
  where product_source = 'product' and product_id = '9a200000-0000-4000-8000-0000000000p2'
    and record_date = private.data_na_padaria()), 2,
  'as duas variantes gravam duas linhas de realizado, nunca uma so');
select is((select quantity_baked from public.production_actuals
  where product_source = 'product' and product_id = '9a200000-0000-4000-8000-0000000000p2'
    and product_variant_id = '9a200000-0000-4000-8000-0000000000v1'
    and record_date = private.data_na_padaria()), 3::numeric,
  'realizado da Forma gravou 3');
select is((select quantity_baked from public.production_actuals
  where product_source = 'product' and product_id = '9a200000-0000-4000-8000-0000000000p2'
    and product_variant_id = '9a200000-0000-4000-8000-0000000000v2'
    and record_date = private.data_na_padaria()), 12::numeric,
  'realizado da Hamburguer gravou 12, sem se misturar com o da Forma');
select is((select production_unit from public.production_actuals
  where product_source = 'product' and product_id = '9a200000-0000-4000-8000-0000000000p2'
    and product_variant_id = '9a200000-0000-4000-8000-0000000000v2'
    and record_date = private.data_na_padaria()), 'un'::text,
  'confirmacao da Hamburguer grava em pecas (un), nao em kg, mesmo agendada por peso');

-- Corrigir a Hamburguer substitui só o saldo dela; a Forma continua intacta.
select lives_ok($$
  select * from public.confirm_oven_product_output(
    private.data_na_padaria(), 'product', '9a200000-0000-4000-8000-0000000000p2',
    11, 1, 'Queimou', 'Correcao', '9a200000-0000-4000-8000-0000000000v2'
  )
$$, 'corrige o realizado da Hamburguer no mesmo dia');
select is((select count(*)::int from public.production_actuals
  where product_source = 'product' and product_id = '9a200000-0000-4000-8000-0000000000p2'
    and record_date = private.data_na_padaria()), 2,
  'a correcao substitui o saldo da Hamburguer, sem duplicar linha nem criar uma terceira');
select is((select quantity_baked from public.production_actuals
  where product_source = 'product' and product_id = '9a200000-0000-4000-8000-0000000000p2'
    and product_variant_id = '9a200000-0000-4000-8000-0000000000v1'
    and record_date = private.data_na_padaria()), 3::numeric,
  'a correcao da Hamburguer nao alterou o realizado da Forma');

reset role;

-- 11. Expedicao ve a identidade da variante que a produção recebeu.
set local role authenticated;
select set_config('request.jwt.claim.sub','9a200000-0000-4000-8000-000000000002',true);
select is((select product_variant_id from public.list_pj_orders_for_dispatch()
  where order_group_id = '9a200000-0000-4000-8000-000000000206'),
  '9a200000-0000-4000-8000-0000000000v2'::uuid,
  'a fila de expedicao carrega a mesma variante gravada na criacao do pedido');
reset role;

select * from finish();
rollback;
