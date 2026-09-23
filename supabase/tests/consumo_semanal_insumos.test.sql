begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

select ok(has_function_privilege('authenticated',
  'public.inventory_consumption_periods(text)', 'execute'), 'resumo do consumo e executavel por autenticado');
select ok(has_function_privilege('authenticated',
  'public.inventory_consumption_items(text,uuid)', 'execute'), 'consumo por insumo e executavel por autenticado');
select ok(not has_function_privilege('anon',
  'public.inventory_consumption_items(text,uuid)', 'execute'), 'anonimo nunca le consumo');
select ok(not has_function_privilege('authenticated',
  'private.periodos_consumo_insumos(text)', 'execute'), 'funcao interna de periodos nao e chamavel direto');

-- Espaco de trabalho limpo -----------------------------------------------------
-- Este arquivo tambem roda no Banco Preview compartilhado (job "Verificar
-- invariantes e seed canonicos"), onde o seed ja deixou contagens fechadas e
-- notas da JC ancoradas em private.data_na_padaria(), ou seja, andando com o
-- calendario. As funcoes de consumo leem TODAS as contagens fechadas e TODAS as
-- notas da loja, entao o cenario montado abaixo so tem resultado previsivel num
-- espaco vazio: sem isto, o seed acrescenta periodos, desloca a janela e pode
-- ate colidir com a chave (loja, semana) das contagens desta fixture.
-- A transacao inteira termina em rollback: nada disso sai daqui.
delete from public.inventory_weekly_counts where store = 'jc';
delete from public.payable_purchases where store = 'jc';

insert into auth.users(id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
values
  ('96100000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-consumo@example.com','x',now(),now(),now(),'{}','{}',false),
  ('96100000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','financeiro-consumo@example.com','x',now(),now(),now(),'{}','{}',false),
  ('96100000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','expedicao-consumo@example.com','x',now(),now(),now(),'{}','{}',false),
  ('96100000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','financeiro-ja-consumo@example.com','x',now(),now(),now(),'{}','{}',false),
  ('96100000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','financeiro-inativo-consumo@example.com','x',now(),now(),now(),'{}','{}',false);
insert into public.app_profiles(user_id,display_name,role,store,active,allowed_routes) values
  ('96100000-0000-4000-8000-000000000001','Admin','admin','jc',true,'["/"]'),
  ('96100000-0000-4000-8000-000000000002','Financeiro','financeiro','jc',true,'["/estoque"]'),
  ('96100000-0000-4000-8000-000000000003','Rafaela','expedicao','jc',true,'["/estoque"]'),
  ('96100000-0000-4000-8000-000000000004','Financeiro JA','financeiro','ja',true,'["/estoque"]'),
  ('96100000-0000-4000-8000-000000000005','Financeiro inativo','financeiro','jc',false,'["/estoque"]');
insert into public.app_user_permissions(user_id,permission_key,scope) values
  ('96100000-0000-4000-8000-000000000002','contas_pagar.acessar','jc'),
  ('96100000-0000-4000-8000-000000000003','estoque.contar_semanal','jc'),
  ('96100000-0000-4000-8000-000000000004','contas_pagar.acessar','ja'),
  ('96100000-0000-4000-8000-000000000005','contas_pagar.acessar','jc')
on conflict do nothing;

insert into public.products(id,name,category,active,unit,kind,cost_price) values
  ('96100000-0000-4000-8000-000000000011','[TESTE] Farinha consumo','INSUMOS',true,'kg','insumo',2.00),
  ('96100000-0000-4000-8000-000000000012','[TESTE] Manteiga consumo','INSUMOS',true,'kg','insumo',40.00),
  ('96100000-0000-4000-8000-000000000013','[TESTE] Queijo so no inicio','INSUMOS',true,'kg','insumo',30.00),
  ('96100000-0000-4000-8000-000000000014','[TESTE] Fermento nao contado','INSUMOS',true,'kg','insumo',20.00),
  ('96100000-0000-4000-8000-000000000015','[TESTE] Azeitona que cresceu','INSUMOS',true,'kg','insumo',25.00),
  ('96100000-0000-4000-8000-000000000016','[TESTE] Embalagem fora da contagem','EMBALAGENS',true,'un','insumo',0.50),
  ('96100000-0000-4000-8000-000000000017','[TESTE] Sal sem custo','INSUMOS',true,'kg','insumo',null),
  ('96100000-0000-4000-8000-000000000018','[TESTE] Queijo nota sem conversao','INSUMOS',true,'kg','insumo',30.00),
  ('96100000-0000-4000-8000-000000000019','[TESTE] Leite lancado a mao','INSUMOS',true,'kg','insumo',4.00),
  ('96100000-0000-4000-8000-000000000020','[TESTE] Acucar duas linhas','INSUMOS',true,'kg','insumo',9.00),
  ('96100000-0000-4000-8000-000000000021','[TESTE] Cacau nota mista','INSUMOS',true,'kg','insumo',50.00);

-- Duas contagens fechadas seguidas (sabados 26/09 e 03/10) e uma aberta
-- depois, que nunca entra no calculo.
insert into public.inventory_weekly_counts(id,store,week_start,status,opened_by,opened_by_name,closed_at,closed_by,closed_by_name) values
  ('96100000-0000-4000-8000-0000000000a1','jc',date '2026-09-21','fechada','96100000-0000-4000-8000-000000000003','Rafaela',timestamptz '2026-09-26 12:00-03','96100000-0000-4000-8000-000000000003','Rafaela'),
  ('96100000-0000-4000-8000-0000000000a2','jc',date '2026-09-28','fechada','96100000-0000-4000-8000-000000000003','Rafaela',timestamptz '2026-10-03 12:00-03','96100000-0000-4000-8000-000000000003','Rafaela'),
  ('96100000-0000-4000-8000-0000000000a3','jc',date '2026-10-05','aberta','96100000-0000-4000-8000-000000000003','Rafaela',null,null,null);
insert into public.inventory_weekly_count_items(count_id,product_id,quantity,unit) values
  ('96100000-0000-4000-8000-0000000000a1','96100000-0000-4000-8000-000000000011',120,'kg'),
  ('96100000-0000-4000-8000-0000000000a1','96100000-0000-4000-8000-000000000012',10,'kg'),
  ('96100000-0000-4000-8000-0000000000a1','96100000-0000-4000-8000-000000000013',5,'kg'),
  ('96100000-0000-4000-8000-0000000000a1','96100000-0000-4000-8000-000000000014',3,'kg'),
  ('96100000-0000-4000-8000-0000000000a1','96100000-0000-4000-8000-000000000015',2,'kg'),
  ('96100000-0000-4000-8000-0000000000a1','96100000-0000-4000-8000-000000000017',4,'kg'),
  ('96100000-0000-4000-8000-0000000000a1','96100000-0000-4000-8000-000000000018',5,'kg'),
  ('96100000-0000-4000-8000-0000000000a1','96100000-0000-4000-8000-000000000019',10,'kg'),
  ('96100000-0000-4000-8000-0000000000a1','96100000-0000-4000-8000-000000000020',10,'kg'),
  ('96100000-0000-4000-8000-0000000000a1','96100000-0000-4000-8000-000000000021',2,'kg'),
  ('96100000-0000-4000-8000-0000000000a2','96100000-0000-4000-8000-000000000011',150,'kg'),
  ('96100000-0000-4000-8000-0000000000a2','96100000-0000-4000-8000-000000000012',8,'kg'),
  ('96100000-0000-4000-8000-0000000000a2','96100000-0000-4000-8000-000000000014',null,'kg'),
  ('96100000-0000-4000-8000-0000000000a2','96100000-0000-4000-8000-000000000015',6,'kg'),
  ('96100000-0000-4000-8000-0000000000a2','96100000-0000-4000-8000-000000000017',1,'kg'),
  ('96100000-0000-4000-8000-0000000000a2','96100000-0000-4000-8000-000000000018',3,'kg'),
  ('96100000-0000-4000-8000-0000000000a2','96100000-0000-4000-8000-000000000019',4,'kg'),
  ('96100000-0000-4000-8000-0000000000a2','96100000-0000-4000-8000-000000000020',10,'kg'),
  ('96100000-0000-4000-8000-0000000000a2','96100000-0000-4000-8000-000000000021',1,'kg'),
  ('96100000-0000-4000-8000-0000000000a3','96100000-0000-4000-8000-000000000011',999,'kg');

insert into public.suppliers(id,name,active)
values ('96100000-0000-4000-8000-0000000000f1','[TESTE] Fornecedor consumo',true);

-- Notas. created_at fixo: o teste nao pode mudar de resultado com o relogio.
insert into public.payable_purchases(id,request_id,store,supplier_id,purchase_date,origin,document_type,payment_method,status,total_value,created_by,created_at) values
  -- antes do periodo: nota antiga, perde para a mais recente como referencia
  ('96100000-0000-4000-8000-0000000000b1','96100000-0000-4000-8000-0000000000c1','jc','96100000-0000-4000-8000-0000000000f1',date '2026-09-20','manual','sem_nota','boleto','paga',300,'96100000-0000-4000-8000-000000000001',timestamptz '2026-09-20 10:00-03'),
  -- no proprio sabado da contagem inicial: pertence ao periodo anterior e vira
  -- o custo de referencia da farinha (3,96/kg)
  ('96100000-0000-4000-8000-0000000000b2','96100000-0000-4000-8000-0000000000c2','jc','96100000-0000-4000-8000-0000000000f1',date '2026-09-26','manual','sem_nota','boleto','paga',99,'96100000-0000-4000-8000-000000000001',timestamptz '2026-09-26 10:00-03'),
  -- dentro do periodo
  ('96100000-0000-4000-8000-0000000000b3','96100000-0000-4000-8000-0000000000c3','jc','96100000-0000-4000-8000-0000000000f1',date '2026-09-29','manual','sem_nota','boleto','aberta',1015,'96100000-0000-4000-8000-000000000001',timestamptz '2026-09-29 10:00-03'),
  -- sabado do corte final, lancada depois do fechamento
  ('96100000-0000-4000-8000-0000000000b4','96100000-0000-4000-8000-0000000000c4','jc','96100000-0000-4000-8000-0000000000f1',date '2026-10-03','manual','sem_nota','boleto','aberta',175,'96100000-0000-4000-8000-000000000001',timestamptz '2026-10-05 09:00-03'),
  -- cancelada dentro do periodo: nunca conta
  ('96100000-0000-4000-8000-0000000000b5','96100000-0000-4000-8000-0000000000c5','jc','96100000-0000-4000-8000-0000000000f1',date '2026-09-30','manual','sem_nota','boleto','cancelada',1000,'96100000-0000-4000-8000-000000000001',timestamptz '2026-09-30 10:00-03'),
  -- depois do corte final: fica para o proximo periodo
  ('96100000-0000-4000-8000-0000000000b6','96100000-0000-4000-8000-0000000000c6','jc','96100000-0000-4000-8000-0000000000f1',date '2026-10-04','manual','sem_nota','boleto','aberta',500,'96100000-0000-4000-8000-000000000001',timestamptz '2026-10-04 10:00-03'),
  -- queijo: nota antiga convertida, depois a mais recente ainda sem conversao
  ('96100000-0000-4000-8000-0000000000b8','96100000-0000-4000-8000-0000000000c8','jc','96100000-0000-4000-8000-0000000000f1',date '2026-09-10','manual','sem_nota','boleto','paga',150,'96100000-0000-4000-8000-000000000001',timestamptz '2026-09-10 10:00-03'),
  -- leite lancado a mao, mesma unidade do cadastro, dentro do periodo
  ('96100000-0000-4000-8000-0000000000ba','96100000-0000-4000-8000-0000000000ca','jc','96100000-0000-4000-8000-0000000000f1',date '2026-09-30','manual','sem_nota','boleto','aberta',100,'96100000-0000-4000-8000-000000000001',timestamptz '2026-09-30 10:00-03'),
  -- acucar: a nota de referencia traz o insumo em duas linhas de precos diferentes
  ('96100000-0000-4000-8000-0000000000bb','96100000-0000-4000-8000-0000000000cb','jc','96100000-0000-4000-8000-0000000000f1',date '2026-09-25','manual','sem_nota','boleto','paga',110,'96100000-0000-4000-8000-000000000001',timestamptz '2026-09-25 10:00-03'),
  -- cacau: nota a mao antiga, toda em kg (vale como referencia: 40/kg), e
  -- uma mais recente misturando kg e caixa (inteira pulada)
  ('96100000-0000-4000-8000-0000000000bc','96100000-0000-4000-8000-0000000000cc','jc','96100000-0000-4000-8000-0000000000f1',date '2026-09-15','manual','sem_nota','boleto','paga',80,'96100000-0000-4000-8000-000000000001',timestamptz '2026-09-15 10:00-03'),
  ('96100000-0000-4000-8000-0000000000bd','96100000-0000-4000-8000-0000000000cd','jc','96100000-0000-4000-8000-0000000000f1',date '2026-09-22','manual','sem_nota','boleto','paga',160,'96100000-0000-4000-8000-000000000001',timestamptz '2026-09-22 10:00-03');

insert into public.payable_purchases(id,request_id,store,supplier_id,purchase_date,origin,document_type,payment_method,status,total_value,created_by,created_at,
  nfe_key,nfe_number,nfe_series,nfe_issued_at,classification_status) values
  ('96100000-0000-4000-8000-0000000000b9','96100000-0000-4000-8000-0000000000c9','jc','96100000-0000-4000-8000-0000000000f1',date '2026-09-24','xml','nfe','boleto','aberta',160,'96100000-0000-4000-8000-000000000001',timestamptz '2026-09-24 10:00-03',
   '35260912345678000195550010009610011009610011','961001','1',date '2026-09-24','pendente');

insert into public.payable_purchase_items(purchase_id,product_id,item_name,unit,quantity,unit_price,usable_quantity,normalized_unit_cost,mapping_status) values
  ('96100000-0000-4000-8000-0000000000b1','96100000-0000-4000-8000-000000000011','Farinha 25kg','sc',4,75,100,3.00,'mapeado'),
  ('96100000-0000-4000-8000-0000000000b2','96100000-0000-4000-8000-000000000011','Farinha 25kg','sc',1,99,25,3.96,'mapeado'),
  ('96100000-0000-4000-8000-0000000000b3','96100000-0000-4000-8000-000000000011','Farinha 25kg','sc',8,87.5,200,3.50,'mapeado'),
  -- manteiga sem quantidade utilizavel: fator ainda nao confirmado
  ('96100000-0000-4000-8000-0000000000b3','96100000-0000-4000-8000-000000000012','Manteiga cx','cx',1,200,null,null,'mapeado'),
  ('96100000-0000-4000-8000-0000000000b3','96100000-0000-4000-8000-000000000016','Sacola','pct',1,80,100,0.80,'mapeado'),
  ('96100000-0000-4000-8000-0000000000b3',null,'Item sem classificacao','un',1,40,null,null,'pendente'),
  ('96100000-0000-4000-8000-0000000000b3',null,'Frete','un',1,15,null,null,'nao_aplicavel'),
  -- linha marcada como nao aplicavel mesmo com a farinha preenchida: nunca e estoque
  ('96100000-0000-4000-8000-0000000000b3','96100000-0000-4000-8000-000000000011','Taxa farinha','un',1,12,null,null,'nao_aplicavel'),
  ('96100000-0000-4000-8000-0000000000b4','96100000-0000-4000-8000-000000000011','Farinha 25kg','sc',2,87.5,50,3.50,'mapeado'),
  ('96100000-0000-4000-8000-0000000000b5','96100000-0000-4000-8000-000000000011','Farinha 25kg','sc',10,100,250,4.00,'mapeado'),
  ('96100000-0000-4000-8000-0000000000b6','96100000-0000-4000-8000-000000000011','Farinha 25kg','sc',5,100,125,4.00,'mapeado'),
  ('96100000-0000-4000-8000-0000000000b8','96100000-0000-4000-8000-000000000018','Queijo forma','cx',1,150,5,30.00,'mapeado'),
  ('96100000-0000-4000-8000-0000000000b9','96100000-0000-4000-8000-000000000018','Queijo forma','cx',1,160,null,null,'mapeado'),
  ('96100000-0000-4000-8000-0000000000ba','96100000-0000-4000-8000-000000000019','Leite','KG',20,5,null,null,'mapeado'),
  ('96100000-0000-4000-8000-0000000000bb','96100000-0000-4000-8000-000000000020','Acucar fardo','kg',10,2,null,null,'mapeado'),
  ('96100000-0000-4000-8000-0000000000bb','96100000-0000-4000-8000-000000000020','Acucar fardo','kg',30,3,null,null,'mapeado'),
  ('96100000-0000-4000-8000-0000000000bc','96100000-0000-4000-8000-000000000021','Cacau','kg',2,40,null,null,'mapeado'),
  ('96100000-0000-4000-8000-0000000000bd','96100000-0000-4000-8000-000000000021','Cacau','kg',1,60,null,null,'mapeado'),
  ('96100000-0000-4000-8000-0000000000bd','96100000-0000-4000-8000-000000000021','Cacau caixa','cx',1,100,null,null,'mapeado');

-- Permissoes -----------------------------------------------------------------
set local role authenticated;

select set_config('request.jwt.claim.sub','96100000-0000-4000-8000-000000000003',true);
select throws_ok($$select * from public.inventory_consumption_items('jc')$$,
  '42501','Sem permissao para ver o consumo com custos.','expedicao que conta nao ve o consumo com custos');
select throws_ok($$select * from public.inventory_consumption_periods('jc')$$,
  '42501','Sem permissao para ver o consumo com custos.','expedicao nao ve o resumo de compras');

select set_config('request.jwt.claim.sub','96100000-0000-4000-8000-000000000004',true);
select throws_ok($$select * from public.inventory_consumption_items('jc')$$,
  '42501','Sem permissao para ver o consumo com custos.','financeiro com permissao so da JA nao ve o consumo da JC');

select set_config('request.jwt.claim.sub','96100000-0000-4000-8000-000000000005',true);
select throws_ok($$select * from public.inventory_consumption_items('jc')$$,
  '42501','Sem permissao para ver o consumo com custos.','financeiro inativo nao ve o consumo');

select set_config('request.jwt.claim.sub','96100000-0000-4000-8000-000000000002',true);
select throws_ok($$select * from public.inventory_consumption_items('ja')$$,
  '22023','Consumo semanal so existe para a JC nesta fase.','outra loja e recusada');
select lives_ok($$select * from public.inventory_consumption_items('jc')$$,
  'financeiro da JC com permissao ve o consumo');

select set_config('request.jwt.claim.sub','96100000-0000-4000-8000-000000000001',true);

-- Resumo do periodo -------------------------------------------------------------
select is((select count(*)::int from public.inventory_consumption_periods('jc')),1,
  'duas contagens fechadas formam um unico periodo; a aberta fica de fora');
select is((select row(period_start_date, period_end_date, period_days)::text from public.inventory_consumption_periods('jc')),
  row(date '2026-09-26', date '2026-10-03', 7)::text,
  'o periodo vai de sabado a sabado, pelo sabado da semana e nao pela hora de fechar');
select is((select purchases_counted from public.inventory_consumption_periods('jc')),1175.00::numeric,
  'compras de insumos contados: farinha 700 + 175, manteiga 200 e leite 100 (a nota do sabado inicial, a cancelada e a posterior ficam fora)');
select is((select purchases_outside_count from public.inventory_consumption_periods('jc')),80.00::numeric,
  'compras de insumo fora da lista contada aparecem separadas');
select is((select purchases_unclassified from public.inventory_consumption_periods('jc')),40.00::numeric,
  'item sem classificacao aparece separado');
select is((select purchases_not_stock from public.inventory_consumption_periods('jc')),27.00::numeric,
  'linhas nao aplicaveis (frete e taxa) nao viram estoque, mesmo com insumo preenchido');
select is((select purchases_total from public.inventory_consumption_periods('jc')),1322.00::numeric,
  'total da janela fecha com as quatro partes');
select is((select unclassified_lines from public.inventory_consumption_periods('jc')),1,
  'conta as linhas sem classificacao para a tela avisar que o total e parcial');
select is((select late_lines from public.inventory_consumption_periods('jc')),1,
  'nota lancada depois do fechamento e contada como atrasada');

-- Consumo por insumo ------------------------------------------------------------
create temporary table resultado on commit drop as
select * from public.inventory_consumption_items('jc');

select is((select count(*)::int from resultado),10,
  'todo insumo de qualquer das duas contagens aparece, e so eles');
select ok((select qty_start = 120 and qty_in = 250 and qty_end = 150 and qty_consumed = 220 from resultado
  where product_id = '96100000-0000-4000-8000-000000000011'),
  'farinha: 120 + 250 comprados - 150 = 220 consumidos (ignora nota do sabado inicial, cancelada, posterior)');
select is((select unit_cost from resultado where product_id = '96100000-0000-4000-8000-000000000011'),3.6492::numeric,
  'custo medio da farinha: (120 x 3,96 da nota do sabado inicial + 875) / 370');
select is((select value_consumed from resultado where product_id = '96100000-0000-4000-8000-000000000011'),802.82::numeric,
  'valor consumido da farinha: 220 x custo medio');
select is((select status from resultado where product_id = '96100000-0000-4000-8000-000000000011'),'ok',
  'farinha completa fica ok');
select is((select purchase_lines from resultado where product_id = '96100000-0000-4000-8000-000000000011'),2,
  'a linha nao aplicavel com a farinha preenchida nao conta como nota do insumo');
select is((select row(purchase_lines, edge_lines, late_lines)::text from resultado
  where product_id = '96100000-0000-4000-8000-000000000011'),
  row(2, 1, 1)::text,
  'farinha: duas notas, uma no sabado do corte e lancada depois do fechamento');

select is((select status from resultado where product_id = '96100000-0000-4000-8000-000000000012'),'incompleto',
  'manteiga com nota sem quantidade utilizavel fica incompleta');
select ok((select qty_consumed is null and value_consumed is null from resultado
  where product_id = '96100000-0000-4000-8000-000000000012'),
  'insumo incompleto nunca mostra numero');
select is((select lines_without_quantity from resultado where product_id = '96100000-0000-4000-8000-000000000012'),1,
  'manteiga aponta quantas notas faltam conferir');

select is((select status from resultado where product_id = '96100000-0000-4000-8000-000000000013'),'sem_par',
  'queijo contado so no inicio fica sem par');
select ok((select qty_consumed is null from resultado where product_id = '96100000-0000-4000-8000-000000000013'),
  'sem par nao vira consumo total do estoque inicial');

select is((select status from resultado where product_id = '96100000-0000-4000-8000-000000000014'),'nao_contado',
  'fermento sem quantidade na contagem final fica nao contado');

select is((select status from resultado where product_id = '96100000-0000-4000-8000-000000000015'),'conferir',
  'azeitona que cresceu sem compra fica para conferir');
select ok((select qty_consumed = -4 and unit_cost = 25 and value_consumed = -100 from resultado
  where product_id = '96100000-0000-4000-8000-000000000015'),
  'conferir ainda mostra o numero negativo, valorizado pelo custo do cadastro');

select is((select status from resultado where product_id = '96100000-0000-4000-8000-000000000017'),'sem_custo',
  'sal sem nota nem custo de cadastro fica sem custo');
select ok((select qty_consumed = 3 and value_consumed is null from resultado
  where product_id = '96100000-0000-4000-8000-000000000017'),
  'sem custo mostra a quantidade consumida, mas nao inventa valor');

select is((select status from resultado where product_id = '96100000-0000-4000-8000-000000000018'),'sem_custo',
  'queijo: a nota mais recente antes do periodo esta sem conversao, entao o valor bloqueia em vez de usar a nota velha');
select ok((select qty_consumed = 2 and unit_cost is null and value_consumed is null from resultado
  where product_id = '96100000-0000-4000-8000-000000000018'),
  'queijo: mostra a quantidade consumida, mas nao inventa valor');

select is((select status from resultado where product_id = '96100000-0000-4000-8000-000000000019'),'ok',
  'leite lancado a mao na mesma unidade do cadastro entra como compra');
select ok((select qty_in = 20 and qty_consumed = 26 and value_consumed = 121.33 from resultado
  where product_id = '96100000-0000-4000-8000-000000000019'),
  'leite: 10 + 20 - 4 = 26, valor pelo custo medio (10 x 4 + 100) / 30');

select is((select unit_cost from resultado where product_id = '96100000-0000-4000-8000-000000000020'),2.7500::numeric,
  'acucar: custo de referencia pondera as duas linhas da mesma nota (110 / 40), sem escolher uma ao acaso');

select ok((select status = 'ok' and unit_cost = 40 and value_consumed = 40 from resultado
  where product_id = '96100000-0000-4000-8000-000000000021'),
  'cacau: nota a mao com linha sem conversao e pulada inteira; vale a anterior (40/kg)');

select is((select count(*)::int from public.inventory_consumption_items('jc','96100000-0000-4000-8000-0000000000a2')),10,
  'filtro pelo periodo devolve o mesmo periodo');
select is((select count(*)::int from public.inventory_consumption_items('jc','96100000-0000-4000-8000-0000000000a1')),0,
  'a primeira contagem nao fecha periodo: e so o ponto de partida');

-- Reabrir a contagem final tira o periodo do calculo ate fechar de novo.
reset role;
update public.inventory_weekly_counts set status = 'aberta' where id = '96100000-0000-4000-8000-0000000000a2';
set local role authenticated;
select set_config('request.jwt.claim.sub','96100000-0000-4000-8000-000000000001',true);
select is((select count(*)::int from public.inventory_consumption_periods('jc')),0,
  'contagem reaberta deixa de fechar periodo');

select * from finish();
rollback;
