begin;
create extension if not exists pgtap with schema extensions;

select plan(28);

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

-- Separacao entre lancar e baixar ------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('99100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'lancar-conta-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('99100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'lancar-e-baixar-conta-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('99100000-0000-4000-8000-000000000001', 'Teste somente lancar', 'financeiro', 'jc', true, '["/contas-pagar"]'::jsonb),
  ('99100000-0000-4000-8000-000000000002', 'Teste lancar e baixar', 'financeiro', 'jc', true, '["/contas-pagar"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values
  ('99100000-0000-4000-8000-000000000001', 'contas_pagar.lancar', 'jc', null),
  ('99100000-0000-4000-8000-000000000002', 'contas_pagar.lancar', 'jc', null),
  ('99100000-0000-4000-8000-000000000002', 'contas_pagar.baixar', 'jc', null);

insert into public.suppliers (id, name, active)
values ('99100000-0000-4000-8000-0000000000f1', '[TESTE] Fornecedor permissao baixa', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '99100000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$ select public.create_manual_payable(
    '99100000-0000-4000-8000-0000000000a1'::uuid,
    '99100000-0000-4000-8000-0000000000f1'::uuid,
    date '2026-09-19', 'sem_nota', 'boleto', '[TESTE] em aberto', false,
    '[{"product_id":null,"item_name":"Farinha teste","unit":"kg","quantity":1,"unit_price":10}]'::jsonb,
    '[{"installment_number":1,"due_date":"2026-09-20","amount":10}]'::jsonb
  ) $$,
  'quem pode lancar cria conta em aberto'
);

select throws_ok(
  $$ select public.create_manual_payable(
    '99100000-0000-4000-8000-0000000000a2'::uuid,
    '99100000-0000-4000-8000-0000000000f1'::uuid,
    date '2026-09-19', 'sem_nota', 'boleto', '[TESTE] paga sem permissao', true,
    '[{"product_id":null,"item_name":"Farinha teste","unit":"kg","quantity":1,"unit_price":10}]'::jsonb,
    '[{"installment_number":1,"due_date":"2026-09-20","amount":10}]'::jsonb
  ) $$,
  '22023',
  'Conta já paga deve usar a operação completa de lançamento e baixa.',
  'a porta antiga recusa conta ja paga para quem so pode lancar'
);

select throws_ok(
  $$ select public.create_and_pay_manual_payable(
    '99100000-0000-4000-8000-0000000000a5'::uuid,
    '99100000-0000-4000-8000-0000000000f1'::uuid,
    date '2026-09-19', 'sem_nota', 'boleto', '[TESTE] baixa sem permissao',
    '[{"product_id":null,"item_name":"Farinha teste","unit":"kg","quantity":1,"unit_price":10}]'::jsonb,
    '[{"installment_number":1,"due_date":"2026-09-20","amount":10}]'::jsonb,
    date '2026-09-19', 10, 'boleto', null,
    'banco_sicredi_jc', '[{"category_key":"cmv_materia_prima","amount":10}]'::jsonb
  ) $$,
  '42501',
  'Sem permissao para lancar e baixar contas da JC.',
  'quem so pode lancar e bloqueado na operacao completa de baixa'
);

reset role;

select is((select count(*)::int from public.payable_purchases
  where request_id = '99100000-0000-4000-8000-0000000000a2'), 0,
  'tentativa recusada nao grava compra');
select is((select count(*)::int from public.payable_purchases
  where request_id = '99100000-0000-4000-8000-0000000000a5'), 0,
  'operacao completa sem permissao nao grava compra');
select is((select count(*)::int from public.finance_entries entry
  join public.payable_installments installment on installment.id = entry.source_ref
  join public.payable_purchases purchase on purchase.id = installment.purchase_id
  where purchase.request_id = '99100000-0000-4000-8000-0000000000a5'), 0,
  'operacao completa sem permissao nao grava no livro-caixa');

set local role authenticated;
select set_config('request.jwt.claim.sub', '99100000-0000-4000-8000-000000000002', true);

select throws_ok(
  $$ select public.create_manual_payable(
    '99100000-0000-4000-8000-0000000000a3'::uuid,
    '99100000-0000-4000-8000-0000000000f1'::uuid,
    date '2026-09-19', 'sem_nota', 'boleto', '[TESTE] paga autorizada', true,
    '[{"product_id":null,"item_name":"Farinha teste","unit":"kg","quantity":1,"unit_price":10}]'::jsonb,
    '[{"installment_number":1,"due_date":"2026-09-20","amount":10}]'::jsonb
  ) $$,
  '22023',
  'Conta já paga deve usar a operação completa de lançamento e baixa.',
  'a porta antiga recusa conta ja paga mesmo com permissao de baixa'
);

reset role;

select is((select count(*)::int from public.payable_purchases
  where request_id = '99100000-0000-4000-8000-0000000000a3'), 0,
  'porta antiga recusada nao grava compra mesmo para quem pode baixar');

set local role authenticated;
select set_config('request.jwt.claim.sub', '99100000-0000-4000-8000-000000000002', true);

select lives_ok(
  $$ select public.create_and_pay_manual_payable(
    '99100000-0000-4000-8000-0000000000a4'::uuid,
    '99100000-0000-4000-8000-0000000000f1'::uuid,
    date '2026-09-19', 'sem_nota', 'boleto', '[TESTE] paga completa',
    '[{"product_id":null,"item_name":"Farinha teste","unit":"kg","quantity":1,"unit_price":10}]'::jsonb,
    '[{"installment_number":1,"due_date":"2026-09-20","amount":10}]'::jsonb,
    date '2026-09-19', 10, 'boleto', null,
    'banco_sicredi_jc', '[{"category_key":"cmv_materia_prima","amount":10}]'::jsonb
  ) $$,
  'operacao completa cria, classifica e baixa para quem tem as duas permissoes'
);

reset role;

select is((select status from public.payable_purchases
  where request_id = '99100000-0000-4000-8000-0000000000a4'), 'paga',
  'operacao completa deixa a compra paga');
select is((select installment.status from public.payable_installments installment
  join public.payable_purchases purchase on purchase.id = installment.purchase_id
  where purchase.request_id = '99100000-0000-4000-8000-0000000000a4'), 'paga',
  'operacao completa deixa a parcela paga');
select is((select count(*)::int from public.finance_entries entry
  join public.payable_installments installment on installment.id = entry.source_ref
  join public.payable_purchases purchase on purchase.id = installment.purchase_id
  where purchase.request_id = '99100000-0000-4000-8000-0000000000a4'
    and entry.source = 'contas_pagar' and entry.reversed_at is null), 1,
  'operacao completa registra a baixa no livro-caixa');

select * from finish();
rollback;
