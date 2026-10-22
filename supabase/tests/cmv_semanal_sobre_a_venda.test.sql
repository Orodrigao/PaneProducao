begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

select ok(has_function_privilege('authenticated',
  'public.inventory_consumption_revenue(text)', 'execute'), 'venda da semana e executavel por autenticado');
select ok(not has_function_privilege('anon',
  'public.inventory_consumption_revenue(text)', 'execute'), 'anonimo nunca le a venda da semana');
select ok(has_function_privilege('authenticated',
  'public.inventory_consumption_outside_items(text,uuid)', 'execute'), 'itens fora da contagem sao executaveis por autenticado');
select ok(not has_function_privilege('anon',
  'public.inventory_consumption_outside_items(text,uuid)', 'execute'), 'anonimo nunca le os itens fora da contagem');

-- Espaco de trabalho limpo -----------------------------------------------------
-- As duas funcoes leem TODAS as contagens fechadas da JC (mesma regra da fase
-- 3A), entao as contagens e notas da JC saem antes, como em
-- consumo_semanal_insumos.test.sql. Caixa e cobrancas ficam em 2031, longe do
-- seed ancorado em private.data_na_padaria(): nada colide com a chave
-- (loja, data) do caixa nem com a trava de periodo da cobranca da EX.
-- A transacao inteira termina em rollback.
delete from public.payable_import_drafts
 where purchase_id in (select id from public.payable_purchases where store = 'jc');
delete from public.payable_purchases where store = 'jc';
delete from public.inventory_weekly_counts where store = 'jc';

insert into auth.users(id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
values
  ('96500000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-cmv@example.com','x',now(),now(),now(),'{}','{}',false),
  ('96500000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pagar-cmv@example.com','x',now(),now(),now(),'{}','{}',false),
  ('96500000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pagar-receber-cmv@example.com','x',now(),now(),now(),'{}','{}',false),
  ('96500000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','receber-cmv@example.com','x',now(),now(),now(),'{}','{}',false),
  ('96500000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','expedicao-cmv@example.com','x',now(),now(),now(),'{}','{}',false);
insert into public.app_profiles(user_id,display_name,role,store,active,allowed_routes) values
  ('96500000-0000-4000-8000-000000000001','Admin CMV','admin','jc',true,'["/"]'),
  ('96500000-0000-4000-8000-000000000002','Financeiro so pagar','financeiro','jc',true,'["/estoque"]'),
  ('96500000-0000-4000-8000-000000000003','Financeiro pagar e receber','financeiro','jc',true,'["/estoque"]'),
  ('96500000-0000-4000-8000-000000000004','Financeiro so receber','financeiro','jc',true,'["/estoque"]'),
  ('96500000-0000-4000-8000-000000000005','Rafaela CMV','expedicao','jc',true,'["/estoque"]');
-- Perfis financeiros podem nascer com permissoes por migration antiga; o
-- teste define exatamente o que cada um tem.
delete from public.app_user_permissions
 where user_id in ('96500000-0000-4000-8000-000000000002','96500000-0000-4000-8000-000000000003',
                   '96500000-0000-4000-8000-000000000004','96500000-0000-4000-8000-000000000005');
insert into public.app_user_permissions(user_id,permission_key,scope) values
  ('96500000-0000-4000-8000-000000000002','contas_pagar.acessar','jc'),
  ('96500000-0000-4000-8000-000000000003','contas_pagar.acessar','jc'),
  ('96500000-0000-4000-8000-000000000003','contas_receber.acessar','*'),
  ('96500000-0000-4000-8000-000000000004','contas_receber.acessar','*'),
  ('96500000-0000-4000-8000-000000000005','estoque.contar_semanal','jc');

insert into public.products(id,name,category,active,unit,kind,cost_price) values
  ('96500000-0000-4000-8000-000000000011','[TESTE] Farinha CMV','INSUMOS',true,'kg','insumo',2.00),
  ('96500000-0000-4000-8000-000000000012','[TESTE] Embalagem CMV fora','EMBALAGENS',true,'un','insumo',0.50),
  ('96500000-0000-4000-8000-000000000013','[TESTE] Chocolate CMV fora','INSUMOS',true,'kg','insumo',30.00);

-- Contagens dos sabados 01/02/2031 e 08/02/2031: periodo (01/02, 08/02].
insert into public.inventory_weekly_counts(id,store,week_start,status,opened_by,opened_by_name,closed_at,closed_by,closed_by_name) values
  ('96500000-0000-4000-8000-0000000000a1','jc',date '2031-01-27','fechada','96500000-0000-4000-8000-000000000005','Rafaela',timestamptz '2031-02-01 12:00-03','96500000-0000-4000-8000-000000000005','Rafaela'),
  ('96500000-0000-4000-8000-0000000000a2','jc',date '2031-02-03','fechada','96500000-0000-4000-8000-000000000005','Rafaela',timestamptz '2031-02-08 12:00-03','96500000-0000-4000-8000-000000000005','Rafaela');
insert into public.inventory_weekly_count_items(count_id,product_id,quantity,unit) values
  ('96500000-0000-4000-8000-0000000000a1','96500000-0000-4000-8000-000000000011',100,'kg'),
  ('96500000-0000-4000-8000-0000000000a2','96500000-0000-4000-8000-000000000011',80,'kg');

-- Notas: farinha contada, embalagem e chocolate fora da contagem (chocolate
-- em duas notas), frete nao aplicavel e uma nota cancelada.
insert into public.suppliers(id,name,active)
values ('96500000-0000-4000-8000-0000000000f1','[TESTE] Fornecedor CMV',true);
insert into public.payable_purchases(id,request_id,store,supplier_id,purchase_date,origin,document_type,payment_method,status,total_value,created_by,created_at) values
  ('96500000-0000-4000-8000-0000000000b1','96500000-0000-4000-8000-0000000000e1','jc','96500000-0000-4000-8000-0000000000f1',date '2031-02-03','manual','sem_nota','boleto','aberta',260.00,'96500000-0000-4000-8000-000000000001',timestamptz '2031-02-03 10:00-03'),
  ('96500000-0000-4000-8000-0000000000b2','96500000-0000-4000-8000-0000000000e2','jc','96500000-0000-4000-8000-0000000000f1',date '2031-02-06','manual','sem_nota','boleto','aberta',90.00,'96500000-0000-4000-8000-000000000001',timestamptz '2031-02-06 10:00-03'),
  ('96500000-0000-4000-8000-0000000000b3','96500000-0000-4000-8000-0000000000e3','jc','96500000-0000-4000-8000-0000000000f1',date '2031-02-05','manual','sem_nota','boleto','cancelada',500.00,'96500000-0000-4000-8000-000000000001',timestamptz '2031-02-05 10:00-03'),
  ('96500000-0000-4000-8000-0000000000b4','96500000-0000-4000-8000-0000000000e4','jc','96500000-0000-4000-8000-0000000000f1',date '2031-02-01','manual','sem_nota','boleto','aberta',70.00,'96500000-0000-4000-8000-000000000001',timestamptz '2031-02-01 10:00-03');
insert into public.payable_purchase_items(purchase_id,product_id,item_name,unit,quantity,unit_price,mapping_status) values
  ('96500000-0000-4000-8000-0000000000b1','96500000-0000-4000-8000-000000000011','Farinha','kg',50,2.00,'mapeado'),
  ('96500000-0000-4000-8000-0000000000b1','96500000-0000-4000-8000-000000000012','Embalagem','un',200,0.50,'mapeado'),
  ('96500000-0000-4000-8000-0000000000b1','96500000-0000-4000-8000-000000000013','Chocolate','kg',2,30.00,'mapeado'),
  ('96500000-0000-4000-8000-0000000000b2','96500000-0000-4000-8000-000000000013','Chocolate','kg',2,30.00,'mapeado'),
  ('96500000-0000-4000-8000-0000000000b2',null,'Frete','un',1,30.00,'nao_aplicavel'),
  ('96500000-0000-4000-8000-0000000000b3','96500000-0000-4000-8000-000000000012','Embalagem cancelada','un',1000,0.50,'mapeado'),
  ('96500000-0000-4000-8000-0000000000b4','96500000-0000-4000-8000-000000000012','Embalagem do sabado inicial','un',140,0.50,'mapeado');

-- Caixa: JC em dois dias do periodo e no sabado inicial (fora); JA num dia;
-- EX tem caixa proprio e nunca entra.
insert into public.cash_closings(closing_date,weekday_label,store,sales_amount,total_amount,ifood_sales_amount,created_by,created_by_name) values
  (date '2031-02-01','Sábado','jc',999.00,999.00,0,'teste','Teste'),
  (date '2031-02-03','Segunda','jc',1000.00,1000.00,300.00,'teste','Teste'),
  (date '2031-02-08','Sábado','jc',1500.00,1500.00,0,'teste','Teste'),
  (date '2031-02-04','Terça','ja',400.00,400.00,0,'teste','Teste'),
  (date '2031-02-04','Terça','ex',5000.00,5000.00,0,'teste','Teste');

-- Cobrancas: pedido PJ parcelado em duas (mesma data da nota), um pedido fora
-- do periodo e um cancelado; EX (segunda a domingo) com uma semana que entra
-- 1 de 7 dias (domingo 02/02) e outra que entra 6 de 7 (segunda 03/02 ao
-- sabado 08/02).
insert into public.customers (id, name, payment_term_days, active)
values ('96500000-0000-4000-8000-0000000000c1', '[TESTE] Cliente CMV', 15, true)
on conflict (id) do nothing;
insert into public.receivables (
  id, request_id, customer_id, origin, origin_ref, finance_category_id, description,
  invoice_date, original_due_date, due_date, amount, created_by,
  installment_number, installment_count, period_start, period_end, status, cancelled_at, cancel_reason
)
select fixture.id, fixture.request_id, '96500000-0000-4000-8000-0000000000c1', fixture.origin, fixture.origin_ref,
  category.id, fixture.description, fixture.invoice_date, fixture.invoice_date + 15, fixture.invoice_date + 15,
  fixture.amount, '96500000-0000-4000-8000-000000000001', fixture.parcela, fixture.parcelas,
  fixture.period_start, fixture.period_end, fixture.status,
  case when fixture.status = 'cancelada' then now() end,
  case when fixture.status = 'cancelada' then 'teste' end
from (values
  ('96500000-0000-4000-8000-000000000301'::uuid,'96500000-0000-4000-8000-000000000401'::uuid,'pedido_pj','96500000-0000-4000-8000-000000000501'::uuid,'[TESTE] PJ parcela 1',date '2031-02-05',150.00::numeric,1,2,null::date,null::date,'aberta','clientes_pj'),
  ('96500000-0000-4000-8000-000000000302'::uuid,'96500000-0000-4000-8000-000000000402'::uuid,'pedido_pj','96500000-0000-4000-8000-000000000501'::uuid,'[TESTE] PJ parcela 2',date '2031-02-05',150.00::numeric,2,2,null::date,null::date,'aberta','clientes_pj'),
  ('96500000-0000-4000-8000-000000000303'::uuid,'96500000-0000-4000-8000-000000000403'::uuid,'pedido_pj','96500000-0000-4000-8000-000000000502'::uuid,'[TESTE] PJ fora do periodo',date '2031-02-01',777.00::numeric,1,1,null::date,null::date,'aberta','clientes_pj'),
  ('96500000-0000-4000-8000-000000000304'::uuid,'96500000-0000-4000-8000-000000000404'::uuid,'pedido_pj','96500000-0000-4000-8000-000000000503'::uuid,'[TESTE] PJ cancelado',date '2031-02-06',888.00::numeric,1,1,null::date,null::date,'cancelada','clientes_pj'),
  ('96500000-0000-4000-8000-000000000305'::uuid,'96500000-0000-4000-8000-000000000405'::uuid,'romaneio_ex',null::uuid,'[TESTE] EX semana 1',date '2031-02-02',700.00::numeric,1,1,date '2031-01-27',date '2031-02-02','aberta','buck_ex'),
  ('96500000-0000-4000-8000-000000000306'::uuid,'96500000-0000-4000-8000-000000000406'::uuid,'romaneio_ex',null::uuid,'[TESTE] EX semana 2',date '2031-02-09',1400.00::numeric,1,1,date '2031-02-03',date '2031-02-09','aberta','buck_ex')
) fixture(id, request_id, origin, origin_ref, description, invoice_date, amount, parcela, parcelas, period_start, period_end, status, category_key)
join public.finance_categories category on category.key = fixture.category_key;

-- Permissoes -----------------------------------------------------------------
set local role authenticated;

select set_config('request.jwt.claim.sub','96500000-0000-4000-8000-000000000005',true);
select throws_ok($$select * from public.inventory_consumption_revenue('jc')$$,
  '42501','Sem permissao para ver a venda da semana.','expedicao que conta nao ve a venda');
select throws_ok($$select * from public.inventory_consumption_outside_items('jc')$$,
  '42501','Sem permissao para ver o consumo com custos.','expedicao nao ve os itens fora da contagem com valor');

select set_config('request.jwt.claim.sub','96500000-0000-4000-8000-000000000002',true);
select throws_ok($$select * from public.inventory_consumption_revenue('jc')$$,
  '42501','Sem permissao para ver a venda da semana.','so o Contas a pagar nao basta para ver o faturamento');
select lives_ok($$select * from public.inventory_consumption_outside_items('jc')$$,
  'Contas a pagar da JC ve os itens fora da contagem');

select set_config('request.jwt.claim.sub','96500000-0000-4000-8000-000000000004',true);
select throws_ok($$select * from public.inventory_consumption_revenue('jc')$$,
  '42501','Sem permissao para ver a venda da semana.','so o Contas a receber nao basta, porque a tela e de custo');

select set_config('request.jwt.claim.sub','96500000-0000-4000-8000-000000000003',true);
select throws_ok($$select * from public.inventory_consumption_revenue('ja')$$,
  '22023','Consumo semanal so existe para a JC nesta fase.','outra loja e recusada');
select lives_ok($$select * from public.inventory_consumption_revenue('jc')$$,
  'quem tem Contas a pagar e Contas a receber ve a venda');

select set_config('request.jwt.claim.sub','96500000-0000-4000-8000-000000000001',true);

-- Venda do periodo ---------------------------------------------------------------
create temporary table venda on commit drop as
select * from public.inventory_consumption_revenue('jc');

select is((select count(*)::int from venda), 1, 'duas contagens fechadas formam um periodo com a sua venda');
select is((select period_end_count_id from venda), '96500000-0000-4000-8000-0000000000a2'::uuid,
  'a venda se liga ao periodo pela contagem que o fecha');
select is((select row(cash_jc, cash_jc_days)::text from venda), row(2500.00::numeric, 2)::text,
  'caixa da JC soma o valor de vendas dos dias do periodo; o sabado inicial fica fora');
select is((select cash_ifood from venda), 300.00::numeric,
  'o iFood entra a parte, porque o fechamento nao o soma no valor de vendas');
select is((select row(cash_jc_missing_days, cash_ja_missing_days)::text from venda), row(4, 6)::text,
  'dia sem fechamento e contado: a JC fecha 2 dos 6 dias (domingo nao conta), a JA 1 dos 7');
select is((select row(cash_ja, cash_ja_days)::text from venda), row(400.00::numeric, 1)::text,
  'caixa da JA entra junto, porque a contabilidade e uma so');
select is((select row(pj_orders, pj_orders_lines)::text from venda), row(300.00::numeric, 2)::text,
  'pedido PJ entra pela data da nota, com as duas parcelas; o de fora do periodo e o cancelado nao');
select is((select ex_billed from venda), 1300.00::numeric,
  'a EX entra pelos dias da cobranca dentro do periodo: 700 x 1/7 + 1400 x 6/7');
select is((select ex_days_billed from venda), 7, 'os sete dias do periodo tem cobranca da EX');
select is((select revenue_total from venda), 4800.00::numeric,
  'venda total = caixa JC + caixa JA + iFood + PJ + EX; o caixa da EX nunca entra');

-- Itens fora da contagem -------------------------------------------------------
create temporary table fora on commit drop as
select * from public.inventory_consumption_outside_items('jc', '96500000-0000-4000-8000-0000000000a2');

select is((select count(*)::int from fora), 2,
  'so os insumos fora da contagem entram: farinha contada, frete nao aplicavel e notas fora do periodo ficam de fora');
select is((select row(purchases_count, value_purchased)::text from fora where product_id = '96500000-0000-4000-8000-000000000013'),
  row(2, 120.00::numeric)::text, 'o chocolate soma as duas notas do periodo');
select is((select value_purchased from fora where product_id = '96500000-0000-4000-8000-000000000012'),
  100.00::numeric, 'a embalagem cancelada e a do sabado inicial nao entram');
select is((select product_id from fora order by value_purchased desc, product_name limit 1),
  '96500000-0000-4000-8000-000000000013'::uuid, 'a lista vem do maior valor para o menor');
select is((select sum(value_purchased) from fora),
  (select purchases_outside_count from public.inventory_consumption_periods('jc')),
  'a soma da lista fecha com o total fora da contagem do resumo');

select * from finish();
rollback;
