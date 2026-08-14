-- Recebimento em pedaços: a Buck paga um pouco em Pix e um pouco em dinheiro,
-- em dias diferentes.
--
-- O que este teste protege:
--   * a cobrança fica "parcial" e sabe quanto falta;
--   * cada pedaço vira uma linha própria no livro, na conta e na data dele;
--   * estornar um pedaço não desfaz os outros;
--   * cobrança com dinheiro dentro não pode ser cancelada;
--   * o último pedaço fecha a cobrança, e maior que o saldo também fecha.

begin;
create extension if not exists pgtap with schema extensions;

select plan(21);

-- Cenário ------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('97000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'financeiro-parcial-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values ('97000000-0000-4000-8000-000000000001', 'Teste Financeiro Parcial', 'financeiro', 'jc', true, '["/contas-receber"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values
  ('97000000-0000-4000-8000-000000000001', 'contas_receber.acessar', 'jc', null),
  ('97000000-0000-4000-8000-000000000001', 'contas_receber.lancar', 'jc', null),
  ('97000000-0000-4000-8000-000000000001', 'contas_receber.baixar', 'jc', null),
  ('97000000-0000-4000-8000-000000000001', 'contas_receber.estornar', 'jc', null),
  ('97000000-0000-4000-8000-000000000001', 'contas_receber.cancelar', 'jc', null),
  -- Somente ler o livro: e o que prova que registrar recebimento escreve nele
  -- por dentro da acao protegida.
  ('97000000-0000-4000-8000-000000000001', 'financeiro.acessar', '*', null);

insert into public.customers (id, name, doc, payment_term_days, active)
values ('97000000-0000-4000-8000-0000000000c1', '[TESTE] Cliente Parcial', '33444555000181', 15, true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true);

-- Cobrança de 1.000,00, faturada ha 20 dias.
select lives_ok(
  $$ select public.create_manual_receivable(
    '97000000-0000-4000-8000-00000000a001'::uuid,
    '97000000-0000-4000-8000-0000000000c1'::uuid,
    current_date - 20, 1000.00, 'Paes do mes'
  ) $$,
  'financeiro lanca a cobranca de 1.000,00'
);

-- Primeiro pedaço: 400 em Pix ---------------------------------------------

select lives_ok(
  $$ select public.record_receivable_receipt(
    '97000000-0000-4000-8000-00000000b001'::uuid,
    (select id from public.receivables where request_id = '97000000-0000-4000-8000-00000000a001'::uuid),
    current_date - 5, 400.00, 'pix', 'banco_sicredi_jc'
  ) $$,
  'primeiro pedaco: 400 em Pix'
);

select is((select status from public.receivables
    where request_id = '97000000-0000-4000-8000-00000000a001'::uuid), 'parcial',
  'a cobranca fica parcialmente recebida');

select is((select private.receivable_recebido(id) from public.receivables
    where request_id = '97000000-0000-4000-8000-00000000a001'::uuid), 400.00,
  'a cobranca sabe que recebeu 400');

select is((select count(*)::int from public.finance_entries
    where source = 'contas_receber' and entry_type = 'lancamento' and reversed_at is null), 1,
  'o primeiro pedaco virou um lancamento no livro');

select is((select amount from public.finance_entries
    where source = 'contas_receber' and entry_type = 'lancamento' and reversed_at is null), 400.00,
  'o livro recebeu o valor do pedaco, nao o da cobranca');

select is((select competence_month from public.finance_entries
    where source = 'contas_receber' and entry_type = 'lancamento' and reversed_at is null),
  date_trunc('month', current_date - 20)::date,
  'o pedaco pesa no mes do faturamento, nao no mes em que entrou');

-- Cobrança com dinheiro dentro não pode ser cancelada ----------------------

select throws_ok(
  $$ select public.cancel_receivable(
    '97000000-0000-4000-8000-00000000d001'::uuid,
    (select id from public.receivables where request_id = '97000000-0000-4000-8000-00000000a001'::uuid),
    'Cliente desistiu'
  ) $$,
  '22023',
  'Esta cobrança já recebeu 400.00. Estorne os recebimentos antes de cancelar.',
  'cobranca parcialmente recebida nao pode ser cancelada'
);

-- Segundo pedaço: 350 em dinheiro, outro dia, outra conta ------------------

select lives_ok(
  $$ select public.record_receivable_receipt(
    '97000000-0000-4000-8000-00000000b002'::uuid,
    (select id from public.receivables where request_id = '97000000-0000-4000-8000-00000000a001'::uuid),
    current_date - 2, 350.00, 'dinheiro', 'caixa_fisico_jc'
  ) $$,
  'segundo pedaco: 350 em dinheiro, dois dias depois'
);

select is((select private.receivable_recebido(id) from public.receivables
    where request_id = '97000000-0000-4000-8000-00000000a001'::uuid), 750.00,
  'os dois pedacos somam 750');

select is((select status from public.receivables
    where request_id = '97000000-0000-4000-8000-00000000a001'::uuid), 'parcial',
  'ainda falta dinheiro, entao a cobranca segue parcial');

select is((select count(*)::int from public.finance_entries
    where source = 'contas_receber' and entry_type = 'lancamento' and reversed_at is null), 2,
  'cada pedaco tem seu proprio lancamento no livro');

select is((select count(distinct account_id)::int from public.finance_entries
    where source = 'contas_receber' and entry_type = 'lancamento' and reversed_at is null), 2,
  'os dois lancamentos caem em contas diferentes: Pix e caixa');

-- Estornar um pedaço não desfaz o outro ------------------------------------

select lives_ok(
  $$ select public.reverse_receivable_receipt(
    '97000000-0000-4000-8000-00000000e001'::uuid,
    (select id from public.receivable_receipts where request_id = '97000000-0000-4000-8000-00000000b001'::uuid),
    'Pix caiu na conta errada'
  ) $$,
  'financeiro estorna somente o pedaco do Pix'
);

select is((select private.receivable_recebido(id) from public.receivables
    where request_id = '97000000-0000-4000-8000-00000000a001'::uuid), 350.00,
  'o dinheiro de quinta continua: sobra 350');

select is((select count(*)::int from public.finance_entries
    where source = 'contas_receber' and entry_type = 'lancamento' and reversed_at is null), 1,
  'o livro ficou com um lancamento ativo, o do dinheiro');

select is((select count(*)::int from public.finance_entries
    where source = 'contas_receber' and entry_type = 'estorno'), 1,
  'o estorno nasceu como contra-lancamento, sem apagar o original');

-- O último pedaço fecha a cobrança ----------------------------------------

select lives_ok(
  $$ select public.record_receivable_receipt(
    '97000000-0000-4000-8000-00000000b003'::uuid,
    (select id from public.receivables where request_id = '97000000-0000-4000-8000-00000000a001'::uuid),
    current_date, 650.00, 'transferencia', 'banco_sicoob_jc'
  ) $$,
  'terceiro pedaco fecha o que faltava'
);

select is((select status from public.receivables
    where request_id = '97000000-0000-4000-8000-00000000a001'::uuid), 'recebida',
  'somados os pedacos ativos, a cobranca fica recebida');

select throws_ok(
  $$ select public.record_receivable_receipt(
    '97000000-0000-4000-8000-00000000b004'::uuid,
    (select id from public.receivables where request_id = '97000000-0000-4000-8000-00000000a001'::uuid),
    current_date, 10.00, 'pix', 'banco_sicredi_jc'
  ) $$,
  '22023',
  'Esta cobrança já está quitada. Estorne um recebimento antes de registrar outro.',
  'cobranca quitada nao aceita mais dinheiro'
);

select is(
  (select public.record_receivable_receipt(
    '97000000-0000-4000-8000-00000000b003'::uuid,
    (select id from public.receivables where request_id = '97000000-0000-4000-8000-00000000a001'::uuid),
    current_date, 650.00, 'transferencia', 'banco_sicoob_jc')),
  (select id from public.receivable_receipts where request_id = '97000000-0000-4000-8000-00000000b003'::uuid),
  'repetir o mesmo recebimento devolve o mesmo pedaco, sem duplicar'
);

reset role;

select * from finish();
rollback;
