begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

select ok(exists(
  select 1
  from pg_extension
  where extname = 'pg_cron'
), 'o agendador pg_cron foi habilitado');
select ok(exists(
  select 1
  from pg_extension
  where extname = 'pg_net'
), 'a chamada HTTP assíncrona pg_net foi habilitada');
select ok((select relrowsecurity and relforcerowsecurity
  from pg_class class
  join pg_namespace namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'private' and class.relname = 'payable_due_report_runs'),
  'o histórico de relatórios tem RLS habilitada e forçada');
select ok(not has_table_privilege('authenticated', 'private.payable_due_report_runs', 'select'),
  'usuário autenticado não lê o histórico diretamente');
select ok(not has_function_privilege('anon',
  'public.claim_payable_due_report_for_delivery(text, timestamp with time zone)', 'execute'),
  'anon não aciona o relatório diário');
select ok(has_function_privilege('service_role',
  'public.claim_payable_due_report_for_delivery(text, timestamp with time zone)', 'execute'),
  'somente o serviço interno pode acionar o relatório diário');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('98000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'suelen-relatorio-test@example.com', '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('98000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'financeiro-relatorio-test@example.com', '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('98000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'vendas-relatorio-test@example.com', '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('98000000-0000-4000-8000-000000000001', 'Suélen', 'admin', null, true, '["/financeiro"]'::jsonb),
  ('98000000-0000-4000-8000-000000000002', 'Financeiro relatório', 'financeiro', 'jc', true, '["/financeiro"]'::jsonb),
  ('98000000-0000-4000-8000-000000000003', 'Vendas relatório', 'vendas', 'ja', true, '["/"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values ('98000000-0000-4000-8000-000000000002', 'financeiro.acessar', 'jc', null);

insert into public.payable_purchases (
  request_id, store, purchase_date, origin, document_type, payment_method,
  status, total_value, created_by
) values (
  '98000000-0000-4000-8000-0000000000a1', 'jc', current_date, 'manual',
  'sem_nota', 'boleto', 'aberta', 125.50, '98000000-0000-4000-8000-000000000001'
);

insert into public.payable_installments (
  purchase_id, installment_number, due_date, current_due_date, amount, status
) values (
  (select id from public.payable_purchases where request_id = '98000000-0000-4000-8000-0000000000a1'),
  1,
  (now() at time zone 'America/Sao_Paulo')::date + 1,
  (now() at time zone 'America/Sao_Paulo')::date + 2,
  125.50,
  'pendente'
);

select set_config(
  'test.payable_due_report_secret',
  (select decrypted_secret from vault.decrypted_secrets where name = 'payable_due_report_cron_secret'),
  true
);

set local role service_role;
select lives_ok(
  $$ select public.claim_payable_due_report_for_delivery(
    current_setting('test.payable_due_report_secret'),
    (date_trunc('day', now() at time zone 'America/Sao_Paulo') + time '06:00') at time zone 'America/Sao_Paulo'
  ) $$,
  'o serviço interno cria a fotografia às seis da manhã'
);
reset role;
select is(
  (select report_date from private.payable_due_report_runs),
  (now() at time zone 'America/Sao_Paulo')::date,
  'a fotografia pertence ao dia de São Paulo'
);
select is(
  (select snapshot -> 0 ->> 'due_date' from private.payable_due_report_runs),
  ((now() at time zone 'America/Sao_Paulo')::date + 2)::text,
  'a fotografia usa o vencimento renegociado'
);
select is(
  (select (snapshot -> 0 ->> 'amount')::numeric from private.payable_due_report_runs),
  125.50::numeric,
  'a fotografia conserva o valor da parcela'
);
select is(
  (select count(*)::integer from private.payable_due_report_runs), 1,
  'a primeira tentativa cria um único relatório diário'
);
set local role service_role;
select lives_ok(
  $$ select public.mark_payable_due_report_sent(
    current_setting('test.payable_due_report_secret'),
    (select id from private.payable_due_report_runs),
    (select attempt_token from private.payable_due_report_runs),
    'resend-test-message'
  ) $$,
  'o serviço marca como enviado somente a tentativa que ele mesmo reservou'
);
reset role;
select ok((select status = 'enviado' and sent_at is not null and provider_message_id = 'resend-test-message'
  from private.payable_due_report_runs),
  'o aceite do provedor fica registrado');

set local role authenticated;
select set_config('request.jwt.claim.sub', '98000000-0000-4000-8000-000000000002', true);
select is((select status from public.get_payable_due_report_status()), 'enviado',
  'financeiro autorizado vê que o relatório do dia foi enviado');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '98000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$ select * from public.get_payable_due_report_status() $$,
  '42501', 'Sem permissão para consultar o relatório diário.',
  'vendas não vê o estado financeiro do relatório'
);
reset role;

select ok(exists(
  select 1 from cron.job where jobname = 'daily-payable-due-report' and schedule = '*/15 * * * *'
), 'o cron tenta entregar o relatório a cada quinze minutos');

select * from finish();
rollback;
