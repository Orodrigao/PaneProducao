begin;
create extension if not exists pgtap with schema extensions;

select plan(29);

select ok(exists(
  select 1
  from pg_extension
  where extname = 'pg_cron'
), 'o agendador pg_cron foi habilitado');
select ok(exists(
  select 1
  from pg_extension
  where extname = 'pg_net'
), 'a chamada HTTP assincrona pg_net foi habilitada');
select ok((select relrowsecurity and relforcerowsecurity
  from pg_class class
  join pg_namespace namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'private' and class.relname = 'payable_due_report_runs'),
  'o historico de relatorios tem RLS habilitada e forcada');
select ok(not has_table_privilege('authenticated', 'private.payable_due_report_runs', 'select'),
  'usuario autenticado nao le o historico diretamente');
select ok(not has_function_privilege('anon',
  'public.claim_payable_due_report_for_delivery(text, timestamp with time zone)', 'execute'),
  'anon nao aciona o relatorio diario');
select ok(has_function_privilege('service_role',
  'public.claim_payable_due_report_for_delivery(text, timestamp with time zone)', 'execute'),
  'somente o servico interno pode acionar o relatorio diario');

-- Bordas de calendario da janela de dias uteis (2024-01-01 foi segunda).
select is(private.payable_report_third_business_day('2024-01-01'::date), '2024-01-03'::date,
  'segunda-feira: a janela fecha na quarta');
select is(private.payable_report_third_business_day('2024-01-05'::date), '2024-01-09'::date,
  'sexta-feira: a janela pula o fim de semana e fecha na terca');
select is(private.payable_report_third_business_day('2024-01-06'::date), '2024-01-10'::date,
  'sabado: a janela comeca na segunda e fecha na quarta');

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

-- Compra com parcela a vencer (vencimento renegociado para depois de amanha).
insert into public.payable_purchases (
  request_id, store, purchase_date, origin, document_type, payment_method,
  status, total_value, created_by
) values (
  '98000000-0000-4000-8000-0000000000a1', 'jc', private.data_na_padaria(), 'manual',
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

-- Compra com parcela vencida (renegociada para ontem) e uma parcela ja paga,
-- que nao pode entrar na fotografia de vencidas.
insert into public.payable_purchases (
  request_id, store, purchase_date, origin, document_type, payment_method,
  status, total_value, created_by
) values (
  '98000000-0000-4000-8000-0000000000a2', 'jc', private.data_na_padaria() - 10, 'manual',
  'sem_nota', 'boleto', 'aberta', 160.00, '98000000-0000-4000-8000-000000000001'
);

insert into public.payable_installments (
  purchase_id, installment_number, due_date, current_due_date, amount, status
) values
  (
    (select id from public.payable_purchases where request_id = '98000000-0000-4000-8000-0000000000a2'),
    1,
    (now() at time zone 'America/Sao_Paulo')::date - 3,
    (now() at time zone 'America/Sao_Paulo')::date - 1,
    80.00,
    'pendente'
  ),
  (
    (select id from public.payable_purchases where request_id = '98000000-0000-4000-8000-0000000000a2'),
    2,
    (now() at time zone 'America/Sao_Paulo')::date - 5,
    null,
    80.00,
    'paga'
  );

select set_config(
  'test.payable_due_report_secret',
  (select decrypted_secret from vault.decrypted_secrets where name = 'payable_due_report_cron_secret'),
  true
);

set local role service_role;
select lives_ok(
  $$ select set_config('test.claim1', public.claim_payable_due_report_for_delivery(
    current_setting('test.payable_due_report_secret'),
    (date_trunc('day', now() at time zone 'America/Sao_Paulo') + time '06:00') at time zone 'America/Sao_Paulo'
  )::text, true) $$,
  'o servico interno cria as fotografias as seis da manha'
);
reset role;

select is(
  (current_setting('test.claim1')::jsonb ->> 'state'),
  'pronto_para_enviar',
  'a primeira reserva sai pronta para enviar'
);
select is(
  (current_setting('test.claim1')::jsonb ->> 'report_kind'),
  'a_vencer',
  'a fila entrega primeiro o relatorio de contas a vencer'
);
select is(
  (select count(*)::integer from private.payable_due_report_runs), 2,
  'as duas fotografias do dia nascem na mesma transacao'
);
select is(
  (select snapshot -> 0 ->> 'due_date' from private.payable_due_report_runs where report_kind = 'a_vencer'),
  ((now() at time zone 'America/Sao_Paulo')::date + 2)::text,
  'a fotografia de a vencer usa o vencimento renegociado'
);
select is(
  (select window_end_date from private.payable_due_report_runs where report_kind = 'a_vencer'),
  private.payable_report_third_business_day((now() at time zone 'America/Sao_Paulo')::date),
  'a janela de a vencer fecha no terceiro dia util'
);
-- A fotografia cobre o banco inteiro, e o seed do Preview tem uma vencida de
-- proposito (semaforo de fornecedores). As assercoes miram as parcelas da
-- compra deste teste, nao a foto toda.
select is(
  (select count(*)::integer
   from private.payable_due_report_runs run
   cross join lateral pg_catalog.jsonb_array_elements(run.snapshot) item
   where run.report_kind = 'vencida'
     and item ->> 'purchase_id' = (
       select id::text from public.payable_purchases
       where request_id = '98000000-0000-4000-8000-0000000000a2')),
  1,
  'parcela paga nao entra na fotografia de vencidas'
);
select is(
  (select item ->> 'due_date'
   from private.payable_due_report_runs run
   cross join lateral pg_catalog.jsonb_array_elements(run.snapshot) item
   where run.report_kind = 'vencida'
     and item ->> 'purchase_id' = (
       select id::text from public.payable_purchases
       where request_id = '98000000-0000-4000-8000-0000000000a2')),
  ((now() at time zone 'America/Sao_Paulo')::date - 1)::text,
  'a vencida usa o vencimento renegociado como data efetiva'
);
select is(
  (select (item ->> 'days_overdue')::integer
   from private.payable_due_report_runs run
   cross join lateral pg_catalog.jsonb_array_elements(run.snapshot) item
   where run.report_kind = 'vencida'
     and item ->> 'purchase_id' = (
       select id::text from public.payable_purchases
       where request_id = '98000000-0000-4000-8000-0000000000a2')),
  1,
  'o atraso fica congelado na fotografia do dia'
);

set local role service_role;
select lives_ok(
  $$ select public.mark_payable_due_report_sent(
    current_setting('test.payable_due_report_secret'),
    (current_setting('test.claim1')::jsonb ->> 'report_id')::uuid,
    (current_setting('test.claim1')::jsonb ->> 'attempt_token')::uuid,
    'resend-test-a-vencer'
  ) $$,
  'o servico marca como enviado somente a tentativa que ele mesmo reservou'
);

select lives_ok(
  $$ select set_config('test.claim2', public.claim_payable_due_report_for_delivery(
    current_setting('test.payable_due_report_secret'),
    (date_trunc('day', now() at time zone 'America/Sao_Paulo') + time '06:15') at time zone 'America/Sao_Paulo'
  )::text, true) $$,
  'a segunda reserva acontece na sequencia'
);
reset role;

select is(
  (current_setting('test.claim2')::jsonb ->> 'state'),
  'pronto_para_enviar',
  'o relatorio de vencidas nao fica bloqueado pelo envio do primeiro'
);
select is(
  (current_setting('test.claim2')::jsonb ->> 'report_kind'),
  'vencida',
  'a segunda reserva e o relatorio de vencidas'
);

set local role service_role;
select lives_ok(
  $$ select public.mark_payable_due_report_sent(
    current_setting('test.payable_due_report_secret'),
    (current_setting('test.claim2')::jsonb ->> 'report_id')::uuid,
    (current_setting('test.claim2')::jsonb ->> 'attempt_token')::uuid,
    'resend-test-vencidas'
  ) $$,
  'o envio de vencidas tambem fica registrado'
);

select is(
  (public.claim_payable_due_report_for_delivery(
    current_setting('test.payable_due_report_secret'),
    (date_trunc('day', now() at time zone 'America/Sao_Paulo') + time '06:30') at time zone 'America/Sao_Paulo'
  ) ->> 'state'),
  'ja_enviado',
  'com os dois enviados nao nasce nem se reserva nova tentativa no dia'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '98000000-0000-4000-8000-000000000002', true);
select is(
  (select count(*)::integer from public.get_payable_due_report_status()), 2,
  'o financeiro ve o estado dos dois relatorios do dia'
);
select is(
  (select status from public.get_payable_due_report_status() where report_kind = 'a_vencer'),
  'enviado',
  'financeiro autorizado ve o relatorio de a vencer enviado'
);
select is(
  (select status from public.get_payable_due_report_status() where report_kind = 'vencida'),
  'enviado',
  'financeiro autorizado ve o relatorio de vencidas enviado'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '98000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$ select * from public.get_payable_due_report_status() $$,
  '42501', 'Sem permissão para consultar o relatório diário.',
  'vendas nao ve o estado financeiro do relatorio'
);
reset role;

select ok(exists(
  select 1 from cron.job where jobname = 'daily-payable-due-report' and schedule = '*/15 * * * *'
), 'o cron tenta entregar o relatorio a cada quinze minutos');

select * from finish();
rollback;
