begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

select ok(exists(select 1 from information_schema.tables where table_schema = 'public' and table_name = 'payable_purchases'),
  'tabela principal de contas a pagar existe');
select ok(exists(select 1 from information_schema.tables where table_schema = 'public' and table_name = 'payable_purchase_items'),
  'itens das compras existem');
select ok(exists(select 1 from information_schema.tables where table_schema = 'public' and table_name = 'payable_installments'),
  'parcelas existem');
select ok(exists(select 1 from information_schema.tables where table_schema = 'public' and table_name = 'payable_events'),
  'auditoria das contas existe');

select is((select count(*)::int from public.app_permissions where key like 'contas_pagar.%'), 5,
  'as cinco permissoes de contas a pagar existem');
select ok((select relrowsecurity and relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'payable_purchases'),
  'contas a pagar tem RLS forcada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'payable_purchase_items'),
  'itens da conta tem RLS forcada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'payable_installments'),
  'parcelas tem RLS forcada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'payable_events'),
  'auditoria tem RLS forcada');

select ok(not has_table_privilege('anon', 'public.payable_purchases', 'select'),
  'anon nao le contas a pagar');
select ok(has_table_privilege('authenticated', 'public.payable_purchases', 'select'),
  'authenticated pode consultar contas mediante RLS');
select ok(not has_table_privilege('authenticated', 'public.payable_purchases', 'insert'),
  'authenticated nao insere conta fora da RPC');
select ok(not has_function_privilege('anon', 'public.create_manual_payable(uuid, uuid, date, text, text, text, boolean, jsonb, jsonb)', 'execute'),
  'anon nao executa lancamento financeiro');
select ok(has_function_privilege('authenticated', 'public.create_manual_payable(uuid, uuid, date, text, text, text, boolean, jsonb, jsonb)', 'execute'),
  'authenticated executa lancamento mediante validacao interna');
select ok((select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_manual_payable') ilike all(array['%current_user_can_payables%', '%p_request_id%', '%p_installments%']),
  'lancamento valida permissao, idempotencia e parcelas');
select ok((select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'cancel_manual_payable') ilike '%cancelada%',
  'cancelamento preserva o estado cancelado');

select * from finish();
rollback;
