begin;
create extension if not exists pgtap with schema extensions;
select plan(49);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
values
  ('98100000-0000-4000-8000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','financeiro-abc-test@example.com','x',now(),now(),now(),'{}','{}',false),
  ('98100000-0000-4000-8000-00000000000b','00000000-0000-0000-0000-000000000000','authenticated','authenticated','vendas-abc-test@example.com','x',now(),now(),now(),'{}','{}',false);
insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('98100000-0000-4000-8000-00000000000a','Financeiro ABC','financeiro','jc',true,'[]'),
  ('98100000-0000-4000-8000-00000000000b','Vendas ABC','vendas','ja',true,'[]');
insert into public.app_user_permissions (user_id, permission_key, scope)
values
  ('98100000-0000-4000-8000-00000000000a','vendas_balcao.visualizar','jc'),
  ('98100000-0000-4000-8000-00000000000a','vendas_balcao.importar','jc');

insert into public.products (id, name, category, unit, kind, active, is_fabricacao_propria, is_revenda)
values
  ('98100000-0000-4000-8000-000000000101','Produto ABC Um','Pães','un','final',true,true,false),
  ('98100000-0000-4000-8000-000000000102','Produto ABC Dois','Pães','un','final',true,true,false),
  ('98100000-0000-4000-8000-000000000103','Insumo que não pode ser venda','INSUMOS','kg','insumo',true,false,false),
  ('98100000-0000-4000-8000-000000000104','Produto vendido em kg','Pães','kg','final',true,true,false);

insert into public.sales_imports (
  id, source_system, store, report_type, sale_date, file_name, file_hash,
  storage_path, parser_version, status, row_count, total_quantity, total_net, confirmed_by
)
values (
  '98100000-0000-4000-8000-000000000201','cnm','jc','sales_by_product','2026-09-01',
  'CNM_JC_2026-09-01.xls',repeat('1',64),'cnm/jc/2026-09-01/'||repeat('1',64)||'.xls',
  'teste-abc','confirmed',4,10,100,'98100000-0000-4000-8000-00000000000a'
);
insert into public.sales_imports (
  id, source_system, store, report_type, sale_date, file_name, file_hash,
  storage_path, parser_version, status, row_count, total_quantity, total_net,
  confirmed_by, replaced_by, replaced_at
)
values (
  '98100000-0000-4000-8000-000000000202','cnm','jc','sales_by_product','2026-08-31',
  'CNM_JC_2026-08-31.xls',repeat('2',64),'cnm/jc/2026-08-31/'||repeat('2',64)||'.xls',
  'teste-abc','replaced',1,1,10,'98100000-0000-4000-8000-00000000000a',
  '98100000-0000-4000-8000-00000000000a',now()
);
insert into public.sales_import_items (
  import_id, line_number, external_product_key, raw_product_name, raw_category,
  quantity, source_cmv, take_away, net_total, raw_row
)
values
  ('98100000-0000-4000-8000-000000000201',1,'A1','Nome antigo A1','Pães',4,null,false,40,'["A1"]'),
  ('98100000-0000-4000-8000-000000000201',2,'A2','Nome antigo A2','Pães',2,null,false,40,'["A2"]'),
  ('98100000-0000-4000-8000-000000000201',3,'B','Produto pendente B','Bebidas',3,null,false,15,'["B"]'),
  ('98100000-0000-4000-8000-000000000201',4,'C','Taxa sem vínculo C','Outros',1,null,false,5,'["C"]'),
  ('98100000-0000-4000-8000-000000000202',1,'OLD','Item de arquivo substituído','Pães',1,null,false,10,'["OLD"]');
insert into public.sales_day_statuses (source_system, store, sale_date, status, reason, recorded_by)
values ('cnm','jc','2026-09-02','closed','Loja fechada para teste','98100000-0000-4000-8000-00000000000a');

select has_table('public','sales_product_mappings','vínculos de produtos possuem tabela própria');
select has_table('public','sales_product_mapping_events','correções de vínculo possuem histórico');
select hasnt_column('public','sales_import_items','product_id','linha original não recebe vínculo mutável');
select ok((select relrowsecurity and relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='sales_product_mappings'),'vínculos têm RLS habilitada e forçada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='sales_product_mapping_events'),'eventos têm RLS habilitada e forçada');
select ok(has_function_privilege('authenticated','public.set_sales_product_mapping(text,text,text,text,uuid,text,text)','execute'),'autenticado alcança a função protegida de vínculo');
select ok(not has_function_privilege('anon','public.set_sales_product_mapping(text,text,text,text,uuid,text,text)','execute'),'visitante não alcança a função de vínculo');
select ok(has_function_privilege('authenticated','public.get_sales_product_mapping_queue(text,text)','execute'),'autenticado alcança a fila protegida');
select ok(has_function_privilege('authenticated','public.get_sales_abc(text,text,date,date)','execute'),'autenticado alcança a curva protegida');
select ok(not has_function_privilege('anon','public.get_sales_product_mapping_queue(text,text)','execute'),'visitante não alcança a fila de produtos');
select ok(not has_function_privilege('anon','public.get_sales_abc(text,text,date,date)','execute'),'visitante não alcança a curva ABC');

set local role authenticated;
select set_config('request.jwt.claim.sub','98100000-0000-4000-8000-00000000000a',true);
select lives_ok($$select public.set_sales_product_mapping('cnm','jc','A1','mapped','98100000-0000-4000-8000-000000000101','un')$$,'liga o primeiro nome ao catálogo');
select lives_ok($$select public.set_sales_product_mapping('cnm','jc','A2','mapped','98100000-0000-4000-8000-000000000101','un')$$,'dois nomes podem apontar ao mesmo produto');
select lives_ok($$select public.set_sales_product_mapping('cnm','jc','C','ignored')$$,'item pode ficar sem vínculo nesta fase');
select is((select count(*)::integer from public.sales_product_mappings),3,'três decisões ficam memorizadas');
select is((select count(*)::integer from public.sales_product_mapping_events where event_type='created'),3,'cada decisão inicial deixa auditoria');
select is((public.set_sales_product_mapping('cnm','jc','A1','mapped','98100000-0000-4000-8000-000000000101','un')->>'outcome'),'unchanged','repetir o mesmo vínculo não produz mudança');
select is((select count(*)::integer from public.sales_product_mapping_events),3,'repetição não cria evento falso');
select throws_ok($$select public.set_sales_product_mapping('cnm','jc','A1','mapped','98100000-0000-4000-8000-000000000102','un')$$,'22023','Explique o motivo da correção do vínculo.','correção exige motivo');
select throws_ok($$select public.set_sales_product_mapping('cnm','jc','B','mapped','98100000-0000-4000-8000-000000000103','kg')$$,'22023','Escolha um produto de venda ativo.','insumo não vira produto vendido');
select throws_ok($$select public.set_sales_product_mapping('cnm','jc','B','mapped','98100000-0000-4000-8000-000000000104','un')$$,'22023','Essa forma de venda não está cadastrada para o produto.','unidade incompatível sem forma cadastrada é bloqueada');
select throws_ok($$select public.set_sales_product_mapping('cnm','jc','B',null)$$,'22023','Decisão de vínculo inválida.','decisão ausente falha fechada');
select throws_ok($$select public.set_sales_product_mapping('cnm','jc','B','mapped','98100000-0000-4000-8000-000000000102',null)$$,'22023','Escolha o produto e se a venda foi por unidade ou quilo.','forma de venda ausente falha fechada');
select throws_ok($$select public.set_sales_product_mapping('cnm','jc','OLD','mapped','98100000-0000-4000-8000-000000000102','un')$$,'22023','O item vendido não existe nas importações.','arquivo substituído não aceita novo vínculo');

select is(jsonb_array_length(public.get_sales_product_mapping_queue('cnm','jc')),4,'fila devolve todos os nomes ativos');
select ok(jsonb_path_exists(public.get_sales_product_mapping_queue('cnm','jc'),'$[*] ? (@.external_product_key == "A1" && @.mapping_status == "mapped")'),'fila mostra o produto já ligado');
select ok(jsonb_path_exists(public.get_sales_product_mapping_queue('cnm','jc'),'$[*] ? (@.external_product_key == "B" && @.mapping_status == "pending")'),'fila mantém o produto pendente');

select is((public.get_sales_abc('cnm','jc','2026-09-01','2026-09-03')->>'total_net')::numeric,100::numeric,'ABC preserva todo o faturamento');
select is(jsonb_array_length(public.get_sales_abc('cnm','jc','2026-09-01','2026-09-03')->'items'),3,'nomes ligados ao mesmo produto são agregados');
select is(public.get_sales_abc('cnm','jc','2026-09-01','2026-09-03')->'items'->0->>'abc_class','A','faixa A inclui o item que alcança 80 por cento');
select is(public.get_sales_abc('cnm','jc','2026-09-01','2026-09-03')->'items'->1->>'abc_class','B','faixa B inclui o item que alcança 95 por cento');
select is(public.get_sales_abc('cnm','jc','2026-09-01','2026-09-03')->'items'->2->>'abc_class','C','restante pertence à faixa C');
select is(public.get_sales_abc('cnm','jc','2026-09-01','2026-09-03')->'items'->0->>'display_name','Produto ABC Um','ABC volta pelo nome do catálogo');
select is((public.get_sales_abc('cnm','jc','2026-09-01','2026-09-03')->'items'->0->>'average_price')::numeric,13.33::numeric,'preço médio é ponderado pela quantidade');
select is(public.get_sales_abc('cnm','jc','2026-09-01','2026-09-03')->'items'->2->>'mapping_status','ignored','não mapear continua visível na ABC');
select is((public.get_sales_abc('cnm','jc','2026-09-01','2026-09-03')->'coverage'->>'expected_days')::integer,3,'cobertura conta dias úteis da padaria no período');
select is((public.get_sales_abc('cnm','jc','2026-09-01','2026-09-03')->'coverage'->>'imported_days')::integer,1,'cobertura separa dia importado');
select is((public.get_sales_abc('cnm','jc','2026-09-01','2026-09-03')->'coverage'->>'explained_days')::integer,1,'cobertura separa dia fechado explicado');
select is(public.get_sales_abc('cnm','jc','2026-09-01','2026-09-03')->'coverage'->'missing_dates'->>0,'2026-09-03','buraco fica explícito e não vira venda zero');

select lives_ok($$select public.set_sales_product_mapping('cnm','jc','A2','mapped','98100000-0000-4000-8000-000000000102','un','Nome estava ligado ao produto errado')$$,'vínculo pode ser corrigido com motivo');
select is(jsonb_array_length(public.get_sales_abc('cnm','jc','2026-09-01','2026-09-03')->'items'),4,'correção reorganiza o histórico analítico');
select is((select count(*)::integer from public.sales_product_mapping_events where event_type='changed'),1,'correção preserva antes e depois');
select lives_ok($$select public.set_sales_product_mapping('cnm','jc','A2','pending',null,null,'Precisa de nova conferência')$$,'vínculo pode voltar a pendente');
select is((select count(*)::integer from public.sales_product_mappings),2,'voltar a pendente remove só a decisão atual');
select is((select count(*)::integer from public.sales_product_mapping_events where event_type='cleared'),1,'retorno a pendente fica auditado');
select throws_ok($$insert into public.sales_product_mappings(source_system,store,external_product_key,decision,product_id,sale_unit,decided_by,updated_by) values('cnm','jc','direto','ignored',null,null,'98100000-0000-4000-8000-00000000000a','98100000-0000-4000-8000-00000000000a')$$,'42501',null,'cliente não grava vínculo direto');

set local role authenticated;
select set_config('request.jwt.claim.sub','98100000-0000-4000-8000-00000000000b',true);
select throws_ok($$select public.get_sales_product_mapping_queue('cnm','jc')$$,'42501','Sem permissão para ver produtos vendidos.','perfil bloqueado não vê a fila');
select throws_ok($$select public.get_sales_abc('cnm','jc','2026-09-01','2026-09-03')$$,'42501','Sem permissão para ver a curva ABC.','perfil bloqueado não vê a ABC');
select is((select count(*)::integer from public.sales_product_mappings),0,'RLS esconde vínculos do perfil bloqueado');

reset role;
select * from finish();
rollback;
