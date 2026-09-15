begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
values
  ('98000000-0000-4000-8000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','financeiro-vendas-test@example.com','x',now(),now(),now(),'{}','{}',false),
  ('98000000-0000-4000-8000-00000000000b','00000000-0000-0000-0000-000000000000','authenticated','authenticated','vendas-ja-test@example.com','x',now(),now(),now(),'{}','{}',false),
  ('98000000-0000-4000-8000-00000000000c','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-vendas-test@example.com','x',now(),now(),now(),'{}','{}',false);
insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('98000000-0000-4000-8000-00000000000a','Financeiro vendas','financeiro','jc',true,'[]'),
  ('98000000-0000-4000-8000-00000000000b','Vendas JA','vendas','ja',true,'[]'),
  ('98000000-0000-4000-8000-00000000000c','Admin vendas','admin',null,true,'[]');
insert into public.app_user_permissions (user_id, permission_key, scope)
values
  ('98000000-0000-4000-8000-00000000000a','vendas_balcao.visualizar','jc'),
  ('98000000-0000-4000-8000-00000000000a','vendas_balcao.importar','jc'),
  ('98000000-0000-4000-8000-00000000000c','vendas_balcao.visualizar','jc'),
  ('98000000-0000-4000-8000-00000000000c','vendas_balcao.importar','jc');

insert into storage.objects (id, bucket_id, name, owner)
values
  ('98000000-0000-4000-8000-0000000000f1','sales-imports','cnm/jc/2026-01-12/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.xls','98000000-0000-4000-8000-00000000000a'),
  ('98000000-0000-4000-8000-0000000000f2','sales-imports','cnm/jc/2026-01-12/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.xls','98000000-0000-4000-8000-00000000000a'),
  ('98000000-0000-4000-8000-0000000000f3','sales-imports','cnm/jc/2026-01-11/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.xls','98000000-0000-4000-8000-00000000000a');

select has_table('public','sales_imports','existe o cabeçalho genérico de importações');
select has_table('public','sales_import_items','existem itens normalizados independentes do PDV');
select has_table('public','sales_day_statuses','dias fechados e sem venda têm registro próprio');
select has_table('public','sales_import_events','trocas e restaurações possuem histórico imutável');
select ok((select relrowsecurity and relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='sales_imports'),'importações têm RLS habilitada e forçada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='sales_import_items'),'itens têm RLS habilitada e forçada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='sales_day_statuses'),'situações do dia têm RLS habilitada e forçada');
select ok(has_table_privilege('authenticated','public.sales_imports','select'),'usuário autenticado consulta importações mediante RLS');
select ok(not has_table_privilege('authenticated','public.sales_imports','insert,update,delete'),'Data API não escreve importações diretamente');
select ok(not has_table_privilege('authenticated','public.sales_import_items','insert,update,delete'),'Data API não escreve itens diretamente');
select ok(not has_table_privilege('anon','public.sales_imports','select'),'visitante não vê venda');
select ok(has_function_privilege('authenticated','public.confirm_sales_import(text,text,text,date,text,text,text,text,numeric,text,jsonb)','execute'),'usuário autenticado chama a confirmação protegida');
select ok(not has_function_privilege('anon','public.confirm_sales_import(text,text,text,date,text,text,text,text,numeric,text,jsonb)','execute'),'visitante não confirma arquivo');
select ok((select not public from storage.buckets where id='sales-imports'),'arquivo original fica em bucket privado');
select is((select file_size_limit::bigint from storage.buckets where id='sales-imports'),10485760::bigint,'arquivo bruto tem limite de 10 MB');
select ok((select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='confirm_sales_import') ilike all(array['%pg_advisory_xact_lock%','%storage.objects%','%p_reported_total%']),'confirmação trava o dia, exige original e confere total');

set local role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-00000000000a',true);
select lives_ok($$select public.confirm_sales_import(
  'cnm','jc','sales_by_product','2026-01-12','CNM_JC_2026-01-12.xls',repeat('a',64),
  'cnm/jc/2026-01-12/'||repeat('a',64)||'.xls','cnm-sales-v1',38.90,null,
  '[{"line_number":5,"external_product_key":"Pão Teste","raw_product_name":"Pão Teste","raw_category":"Pães","quantity":2,"source_cmv":1.25,"take_away":false,"net_total":20,"raw_row":["Pão Teste"]},{"line_number":6,"external_product_key":"Baguete Teste","raw_product_name":"Baguete Teste","raw_category":"Pães","quantity":3,"source_cmv":1.10,"take_away":true,"net_total":18.90,"raw_row":["Baguete Teste"]}]'::jsonb)$$,'financeiro confirma lote válido');
select is((select count(*)::int from public.sales_imports where confirmed_by='98000000-0000-4000-8000-00000000000a'),1,'financeiro vê a importação criada pelo teste');
select is((select count(*)::int from public.sales_import_items where import_id in (select id from public.sales_imports where confirmed_by='98000000-0000-4000-8000-00000000000a')),2,'o arquivo do teste entra inteiro em uma confirmação');
select is((select total_net from public.sales_imports where status='confirmed' and confirmed_by='98000000-0000-4000-8000-00000000000a'),38.90::numeric,'total líquido confirmado é preservado');
select is((select public.confirm_sales_import(
  'cnm','jc','sales_by_product','2026-01-12','CNM_JC_2026-01-12.xls',repeat('a',64),
  'cnm/jc/2026-01-12/'||repeat('a',64)||'.xls','cnm-sales-v1',38.90,null,
  '[{"line_number":5,"external_product_key":"Pão Teste","raw_product_name":"Pão Teste","raw_category":"Pães","quantity":2,"source_cmv":1.25,"take_away":false,"net_total":20,"raw_row":[]},{"line_number":6,"external_product_key":"Baguete Teste","raw_product_name":"Baguete Teste","raw_category":"Pães","quantity":3,"source_cmv":1.10,"take_away":true,"net_total":18.90,"raw_row":[]}]'::jsonb) ->> 'id'),
  (select id::text from public.sales_imports where status='confirmed' and file_hash=repeat('a',64)),'mesmo hash é idempotente');
select throws_ok($$select public.confirm_sales_import(
  'cnm','jc','sales_by_product','2026-01-11','CNM_2026-01-11_JC.xls',repeat('a',64),
  'cnm/jc/2026-01-11/'||repeat('a',64)||'.xls','cnm-sales-v1',38.90,null,
  '[{"line_number":5,"external_product_key":"Pão Teste","raw_product_name":"Pão Teste","raw_category":"Pães","quantity":2,"net_total":20,"raw_row":[]},{"line_number":6,"external_product_key":"Baguete Teste","raw_product_name":"Baguete Teste","raw_category":"Pães","quantity":3,"net_total":18.90,"raw_row":[]}]'::jsonb)$$,
  '23505','Este mesmo arquivo já foi importado em 12/01/2026.','mesmos bytes não podem virar venda de outro dia por renomeação');
select throws_ok($$select public.confirm_sales_import(
  'cnm','jc','sales_by_product',private.data_na_padaria()+1,'CNM_JC_2099-01-01.xls',repeat('c',64),
  'cnm/jc/2099-01-01/'||repeat('c',64)||'.xls','cnm-sales-v1',10,null,
  '[{"line_number":1,"external_product_key":"Futuro","raw_product_name":"Futuro","raw_category":"Pães","quantity":1,"net_total":10,"raw_row":[]}]'::jsonb)$$,
  '22023','A data da venda não pode estar no futuro.','relatório futuro é recusado antes do arquivo');
select throws_ok($$select public.confirm_sales_import(
  'cnm','jc','sales_by_product','2026-01-12','CNM_JC_2026-01-12.xls',repeat('b',64),
  'cnm/jc/2026-01-12/'||repeat('b',64)||'.xls','cnm-sales-v1',10,null,
  '[{"line_number":5,"external_product_key":"Outro","raw_product_name":"Outro","raw_category":"Pães","quantity":1,"net_total":10,"raw_row":[]}]'::jsonb)$$,
  '23505','Já existe outra versão para este dia. Informe o motivo da substituição.','arquivo diferente exige motivo');
select throws_ok($$select public.confirm_sales_import(
  'cnm','jc','sales_by_product','2026-01-12','CNM_JC_2026-01-12.xls',repeat('b',64),
  'cnm/jc/2026-01-12/'||repeat('b',64)||'.xls','cnm-sales-v1',11,'Correção do fechamento',
  '[{"line_number":5,"external_product_key":"Outro","raw_product_name":"Outro","raw_category":"Pães","quantity":1,"net_total":10,"raw_row":[]}]'::jsonb)$$,
  '22023','A soma dos produtos não fecha com o total informado no arquivo.','diferença financeira bloqueia o lote inteiro');
select lives_ok($$select public.confirm_sales_import(
  'cnm','jc','sales_by_product','2026-01-12','CNM_JC_2026-01-12.xls',repeat('b',64),
  'cnm/jc/2026-01-12/'||repeat('b',64)||'.xls','cnm-sales-v1',10,'Correção do fechamento',
  '[{"line_number":5,"external_product_key":"Outro","raw_product_name":"Outro","raw_category":"Pães","quantity":1,"net_total":10,"raw_row":[]}]'::jsonb)$$,'substituição explicada é aceita');
select is((select count(*)::int from public.sales_imports where confirmed_by='98000000-0000-4000-8000-00000000000a'),2,'substituição preserva as duas versões do teste');
select is((select count(*)::int from public.sales_imports where status='confirmed' and confirmed_by='98000000-0000-4000-8000-00000000000a'),1,'só uma versão do teste fica ativa');
select is((select count(*)::int from public.sales_imports where status='replaced' and confirmed_by='98000000-0000-4000-8000-00000000000a'),1,'versão anterior do teste fica no histórico');
select is((select count(*)::int from public.sales_import_events where event_type='replaced' and import_id in (select id from public.sales_imports where confirmed_by='98000000-0000-4000-8000-00000000000a')),1,'substituição deixa evento de auditoria');
select lives_ok(format($$select public.restore_sales_import(%L::uuid,'Relatório anterior era o correto')$$,
  (select id from public.sales_imports where status='replaced' and confirmed_by='98000000-0000-4000-8000-00000000000a')),'versão anterior pode ser restaurada');
select is((select file_hash from public.sales_imports where status='confirmed' and confirmed_by='98000000-0000-4000-8000-00000000000a'),repeat('a',64),'restauração reativa exatamente o arquivo antigo');
select is((select count(*)::int from public.sales_import_events where event_type='restored' and import_id in (select id from public.sales_imports where confirmed_by='98000000-0000-4000-8000-00000000000a')),1,'restauração registra ator e motivo');
select throws_ok($$insert into public.sales_imports(source_system,store,report_type,sale_date,file_name,file_hash,storage_path,parser_version,row_count,total_quantity,total_net,confirmed_by) values('cnm','jc','sales_by_product','2026-09-11','x',repeat('c',64),'x','x',1,1,1,'98000000-0000-4000-8000-00000000000a')$$,'42501',null,'financeiro não grava direto');
select throws_ok($$select public.record_sales_day_status('cnm','jc','2026-01-12','closed','Loja fechada')$$,'23505','Este dia já possui venda importada.','dia importado não vira fechado');
select lives_ok($$select public.record_sales_day_status('cnm','jc','2026-01-13','closed','Domingo')$$,'financeiro marca dia fechado com motivo');
select is((select status from public.sales_day_statuses where source_system='cnm' and store='jc' and sale_date='2026-01-13' and recorded_by='98000000-0000-4000-8000-00000000000a'),'closed','dia fechado fica distinguível de arquivo faltante');
select throws_ok($$select public.record_sales_day_status('cnm','jc',private.data_na_padaria()+1,'closed','Data errada')$$,'22023','Situação do dia inválida.','dia futuro é recusado');

set local role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-00000000000b',true);
select is((select count(*)::int from public.sales_imports),0,'Vendas JA não vê valores');
select throws_ok($$select public.record_sales_day_status('cnm','jc',private.data_na_padaria(),'zero_sales','Sem movimento')$$,'42501','Sem permissão para registrar a situação do dia.','Vendas JA não registra situação');

set local role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-00000000000c',true);
select is((select count(*)::int from public.sales_imports where confirmed_by='98000000-0000-4000-8000-00000000000a'),2,'Rodrigo administrador vê o histórico do teste sem concessão granular');

reset role;
delete from public.app_user_permissions where user_id='98000000-0000-4000-8000-00000000000c' and permission_key='vendas_balcao.visualizar';
set local role authenticated;
select set_config('request.jwt.claim.sub','98000000-0000-4000-8000-00000000000c',true);
select is((select count(*)::int from public.sales_imports),0,'administrador sem concessão explícita não vê vendas');

reset role;
select * from finish();
rollback;
