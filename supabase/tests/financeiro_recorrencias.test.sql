-- Financeiro, fase 2: recorrências. Uma previsão não é dinheiro; só a
-- confirmação cria uma linha no livro, uma vez por regra e mês.

begin;
create extension if not exists pgtap with schema extensions;

select plan(28);

select ok(exists(select 1 from public.app_permissions where key = 'financeiro.recorrencias_gerenciar'),
  'permissão de gerenciar recorrências existe');
select ok(exists(select 1 from public.app_permissions where key = 'financeiro.recorrencias_confirmar'),
  'permissão de confirmar recorrências existe');
select ok((select relrowsecurity and relforcerowsecurity from pg_class class
  join pg_namespace namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'public' and class.relname = 'finance_recurring_rules'),
  'regras recorrentes têm RLS habilitada e forçada');
select ok(not has_table_privilege('authenticated', 'public.finance_recurring_rules', 'insert'),
  'ninguém grava regra recorrente direto na tabela');
select is((select count(*)::int from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname in ('create_finance_recurring_rule', 'end_finance_recurring_rule', 'confirm_finance_recurring_rule')
    and procedure.prosecdef), 3,
  'as ações de recorrência são SECURITY DEFINER');
select is((select count(*)::int from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname in ('create_finance_recurring_rule', 'end_finance_recurring_rule', 'confirm_finance_recurring_rule')
    and coalesce(array_to_string(procedure.proconfig, ','), '') ilike '%search_path=%'), 3,
  'as ações de recorrência usam search_path seguro');
select ok(not has_function_privilege('anon',
  'public.confirm_finance_recurring_rule(uuid, uuid, date, date, numeric, text, text)', 'execute'),
  'anon não confirma recorrência');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('94000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'financeiro-recorrencia-test@example.com', '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('94000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'vendas-recorrencia-test@example.com', '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('94000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'financeiro-jc-recorrencia-test@example.com', '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('94000000-0000-4000-8000-000000000001', 'Teste Financeiro Recorrência', 'financeiro', 'jc', true, '["/financeiro"]'::jsonb),
  ('94000000-0000-4000-8000-000000000002', 'Teste Vendas Recorrência', 'vendas', 'ja', true, '["/romaneio"]'::jsonb),
  ('94000000-0000-4000-8000-000000000003', 'Teste Financeiro JC Recorrência', 'financeiro', 'jc', true, '["/financeiro"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values
  ('94000000-0000-4000-8000-000000000001', 'financeiro.acessar', '*', null),
  ('94000000-0000-4000-8000-000000000001', 'financeiro.recorrencias_gerenciar', '*', null),
  ('94000000-0000-4000-8000-000000000001', 'financeiro.recorrencias_confirmar', '*', null),
  ('94000000-0000-4000-8000-000000000001', 'financeiro.estornar', '*', null),
  ('94000000-0000-4000-8000-000000000003', 'financeiro.acessar', 'jc', null),
  ('94000000-0000-4000-8000-000000000003', 'financeiro.recorrencias_gerenciar', 'jc', null);

set local role authenticated;
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$ select public.create_finance_recurring_rule(
    'Aluguel da JC', 'ocupacao', 'jc', 2000, 31,
    date_trunc('month', private.data_na_padaria())::date, null, 'banco_sicredi_jc', 'boleto'
  ) $$,
  'financeiro autorizado cria uma regra recorrente'
);

select is((select planned_amount from public.finance_recurring_rules where name = 'Aluguel da JC'), 2000::numeric,
  'a regra guarda o valor previsto');
select is((select due_day from public.finance_recurring_rules where name = 'Aluguel da JC'), 31,
  'a regra guarda o dia de vencimento');
select is((select account.key from public.finance_recurring_rules rule
  join public.finance_accounts account on account.id = rule.default_account_id
  where rule.name = 'Aluguel da JC'), 'banco_sicredi_jc',
  'a regra guarda a conta habitual');

select lives_ok(
  $$ select public.confirm_finance_recurring_rule(
    '94000000-0000-4000-8000-0000000000a1'::uuid,
    (select id from public.finance_recurring_rules where name = 'Aluguel da JC'),
    date_trunc('month', private.data_na_padaria())::date, private.data_na_padaria(), 2050, 'pix', 'banco_sicredi_jc'
  ) $$,
  'confirmar materializa o pagamento no livro'
);

select is((select count(*)::int from public.finance_entries where source = 'recorrencia'), 1,
  'a confirmação cria um lançamento recorrente');
select ok((select planned_amount = 2000 and amount = 2050 and payment_method = 'pix'
  from public.finance_entries where source = 'recorrencia'),
  'o livro preserva previsto e realizado, incluindo a forma real');
select is((select due_date from public.finance_entries where source = 'recorrencia'),
  make_date(extract(year from private.data_na_padaria())::integer, extract(month from private.data_na_padaria())::integer,
    extract(day from (date_trunc('month', private.data_na_padaria()) + interval '1 month - 1 day'))::integer),
  'dia 31 cai no último dia do mês quando necessário');

select is(
  (select public.confirm_finance_recurring_rule(
    '94000000-0000-4000-8000-0000000000a1'::uuid,
    (select id from public.finance_recurring_rules where name = 'Aluguel da JC'),
    date_trunc('month', private.data_na_padaria())::date, private.data_na_padaria(), 2050, 'pix', 'banco_sicredi_jc'
  )),
  (select id from public.finance_entries where source = 'recorrencia'),
  'repetir a mesma requisição devolve o lançamento existente'
);
select is(
  (select public.confirm_finance_recurring_rule(
    '94000000-0000-4000-8000-0000000000a2'::uuid,
    (select id from public.finance_recurring_rules where name = 'Aluguel da JC'),
    date_trunc('month', private.data_na_padaria())::date, private.data_na_padaria(), 2050, 'pix', 'banco_sicredi_jc'
  )),
  (select id from public.finance_entries where source = 'recorrencia'),
  'uma segunda confirmação da mesma regra e mês não duplica'
);
select is((select count(*)::int from public.finance_entries where source = 'recorrencia'), 1,
  'a trava regra+mês mantém um único pagamento');

select lives_ok(
  $$ select public.reverse_finance_entry(
    '94000000-0000-4000-8000-0000000000a3'::uuid,
    (select id from public.finance_entries where source = 'recorrencia' and entry_type = 'lancamento'),
    'pagamento duplicado'
  ) $$,
  'a confirmação recorrente pode ser estornada sem apagar o histórico'
);
select ok((select source_ref is not null and recurrence_month = date_trunc('month', private.data_na_padaria())::date
  from public.finance_entries where source = 'recorrencia' and entry_type = 'estorno'),
  'o estorno mantém a origem e o mês da recorrência');
select lives_ok(
  $$ select public.confirm_finance_recurring_rule(
    '94000000-0000-4000-8000-0000000000a4'::uuid,
    (select id from public.finance_recurring_rules where name = 'Aluguel da JC'),
    date_trunc('month', private.data_na_padaria())::date, private.data_na_padaria(), 2000, 'boleto', 'banco_sicredi_jc'
  ) $$,
  'depois do estorno a mesma recorrência pode ser confirmada de novo'
);

select lives_ok(
  $$ select public.end_finance_recurring_rule(
    (select id from public.finance_recurring_rules where name = 'Aluguel da JC'), date_trunc('month', private.data_na_padaria())::date
  ) $$,
  'encerrar a regra mantém o mês atual como último mês válido'
);
select is((select end_month from public.finance_recurring_rules where name = 'Aluguel da JC'), date_trunc('month', private.data_na_padaria())::date,
  'o encerramento só muda a vigência da regra, não o lançamento passado');
select is((select count(*)::int from public.finance_entries where source = 'recorrencia'), 3,
  'encerrar não apaga o pagamento já confirmado');

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$ select public.create_finance_recurring_rule(
    'Aluguel geral', 'ocupacao', 'geral', 2000, 10,
    date_trunc('month', private.data_na_padaria())::date, null, 'banco_sicredi_jc', 'boleto'
  ) $$,
  '42501', 'Sem permissão para gerenciar recorrências desta loja.',
  'escopo da JC não cria recorrência geral'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$ select public.create_finance_recurring_rule(
    'Aluguel bloqueado', 'ocupacao', 'jc', 2000, 10,
    date_trunc('month', private.data_na_padaria())::date, null, 'banco_sicredi_jc', 'boleto'
  ) $$,
  '42501', 'Sem permissão para gerenciar recorrências desta loja.',
  'vendas não cria recorrência mesmo logada'
);
select is((select count(*)::int from public.finance_recurring_rules), 0,
  'vendas não lê as regras existentes pela RLS');
select throws_ok(
  $$ insert into public.finance_recurring_rules (
    name, category_id, store, planned_amount, due_day, start_month,
    default_account_id, default_payment_method, created_by
  ) values (
    'Tentando burlar', (select id from public.finance_categories where key = 'ocupacao'), 'jc', 2000, 10,
    date_trunc('month', private.data_na_padaria())::date, (select id from public.finance_accounts where key = 'banco_sicredi_jc'),
    'boleto', '94000000-0000-4000-8000-000000000002'::uuid
  ) $$,
  '42501', null::text,
  'escrita direta de regra é recusada pelo banco'
);
reset role;

select * from finish();
rollback;
