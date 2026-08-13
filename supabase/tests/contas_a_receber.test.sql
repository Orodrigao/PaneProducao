-- Fase 2 do Contas a Receber: cobrança, baixa, estorno e a ponte com o livro.
--
-- O que este teste protege:
--   * quem não tem permissão é barrado pelo banco, não só pela tela;
--   * a baixa faz a receita aparecer no livro, no mês do faturamento;
--   * o estorno tira a receita do livro sem apagar história;
--   * repetir a ação não duplica nada;
--   * cobrança recebida não some por cancelamento.

begin;
create extension if not exists pgtap with schema extensions;

select plan(41);

-- Estrutura ----------------------------------------------------------------

select ok(not has_table_privilege('authenticated', 'public.receivables', 'insert'),
  'ninguem escreve cobranca direto na tabela');
select ok(not has_table_privilege('authenticated', 'public.receivables', 'update'),
  'ninguem altera cobranca direto na tabela');
select ok(not has_table_privilege('authenticated', 'public.receivables', 'delete'),
  'ninguem apaga cobranca direto na tabela');
select ok(not has_table_privilege('authenticated', 'public.receivable_events', 'insert'),
  'ninguem escreve evento direto na tabela');
select ok(not has_table_privilege('anon', 'public.receivables', 'select'),
  'visitante deslogado nao le cobranca');

select ok((select relrowsecurity and relforcerowsecurity
    from pg_class where oid = 'public.receivables'::regclass),
  'RLS ligada e forcada na tabela de cobrancas');
select ok((select relrowsecurity and relforcerowsecurity
    from pg_class where oid = 'public.receivable_events'::regclass),
  'RLS ligada e forcada na tabela de eventos');

-- A tabela filha tem policy propria, sem depender da cobranca (gate item 9).
select ok(exists(select 1 from pg_policies
    where schemaname = 'public' and tablename = 'receivable_events'
      and policyname = 'receivable_events_select_financeiro'),
  'a tabela de eventos tem policy propria');

-- Cenário ------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  (
    '94000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'financeiro-receber-test@example.com',
    '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
  ),
  (
    '94000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'vendas-receber-test@example.com',
    '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
  );

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('94000000-0000-4000-8000-000000000001', 'Teste Financeiro Receber', 'financeiro', 'jc', true, '["/contas-receber"]'::jsonb),
  ('94000000-0000-4000-8000-000000000002', 'Teste Vendas Receber', 'vendas', 'ja', true, '["/romaneio"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values
  ('94000000-0000-4000-8000-000000000001', 'contas_receber.acessar', 'jc', null),
  ('94000000-0000-4000-8000-000000000001', 'contas_receber.lancar', 'jc', null),
  ('94000000-0000-4000-8000-000000000001', 'contas_receber.baixar', 'jc', null),
  ('94000000-0000-4000-8000-000000000001', 'contas_receber.estornar', 'jc', null),
  ('94000000-0000-4000-8000-000000000001', 'contas_receber.cancelar', 'jc', null),
  ('94000000-0000-4000-8000-000000000001', 'contas_receber.corrigir_vencimento', 'jc', null);

-- Um cliente com 30 dias de prazo e outro sem prazo combinado.
insert into public.customers (id, name, doc, payment_term_days, active)
values
  ('94000000-0000-4000-8000-0000000000c1', '[TESTE] Restaurante Prazo 30', '11222333000181', 30, true),
  ('94000000-0000-4000-8000-0000000000c2', '[TESTE] Restaurante Sem Prazo', '11222333000262', null, true);

-- Perfil sem permissão -----------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000002', true);

select throws_ok(
  $$ select public.create_manual_receivable(
    '94000000-0000-4000-8000-00000000a001'::uuid,
    '94000000-0000-4000-8000-0000000000c1'::uuid,
    date '2026-07-20', 500.00, 'Tentativa sem permissao'
  ) $$,
  '42501',
  'Sem permissão para lançar cobranças.',
  'perfil de vendas nao lanca cobranca'
);

reset role;

-- Lançamento ---------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$ select public.create_manual_receivable(
    '94000000-0000-4000-8000-00000000a002'::uuid,
    '94000000-0000-4000-8000-0000000000c2'::uuid,
    date '2026-07-20', 500.00, 'Cliente sem prazo combinado'
  ) $$,
  '22023',
  'Este cliente ainda não tem prazo de pagamento cadastrado. Defina o prazo na tela de Clientes antes de cobrar.',
  'cliente sem prazo nao vira cobranca'
);

select throws_ok(
  $$ select public.create_manual_receivable(
    '94000000-0000-4000-8000-00000000a003'::uuid,
    '94000000-0000-4000-8000-0000000000c1'::uuid,
    current_date + 1, 500.00, 'Faturamento no futuro'
  ) $$,
  '22023',
  'A data do faturamento não pode ser no futuro.',
  'faturamento no futuro e recusado'
);

-- Faturado em 20/07, prazo de 30 dias: vence em 19/08.
select lives_ok(
  $$ select public.create_manual_receivable(
    '94000000-0000-4000-8000-00000000a004'::uuid,
    '94000000-0000-4000-8000-0000000000c1'::uuid,
    date '2026-07-20', 1200.00, 'Paes da semana'
  ) $$,
  'financeiro lanca a cobranca avulsa'
);

select is((select due_date from public.receivables
    where request_id = '94000000-0000-4000-8000-00000000a004'::uuid), date '2026-08-19',
  'o vencimento sai do prazo cadastrado no cliente');

select is((select status from public.receivables
    where request_id = '94000000-0000-4000-8000-00000000a004'::uuid), 'aberta',
  'a cobranca nasce em aberto');

-- Repetir a mesma requisição devolve a mesma cobrança.
select is(
  (select public.create_manual_receivable(
    '94000000-0000-4000-8000-00000000a004'::uuid,
    '94000000-0000-4000-8000-0000000000c1'::uuid,
    date '2026-07-20', 1200.00, 'Paes da semana')),
  (select id from public.receivables where request_id = '94000000-0000-4000-8000-00000000a004'::uuid),
  'repetir o lancamento devolve a mesma cobranca'
);

select is((select count(*)::int from public.receivables), 1,
  'o toque duplo nao criou uma segunda cobranca');

-- A cobrança existe, mas quem não tem permissão não a enxerga --------------

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000002', true);

select is((select count(*)::int from public.receivables), 0,
  'perfil de vendas nao enxerga a cobranca que existe');
select is((select count(*)::int from public.receivable_events), 0,
  'perfil de vendas nao enxerga a trilha da cobranca');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);

-- Baixa --------------------------------------------------------------------

select throws_ok(
  $$ select public.record_receivable_payment(
    '94000000-0000-4000-8000-00000000b001'::uuid,
    (select id from public.receivables where request_id = '94000000-0000-4000-8000-00000000a004'::uuid),
    date '2026-07-10', 1200.00, 'pix', 'banco_sicredi_jc'
  ) $$,
  '22023',
  'O recebimento não pode ser anterior ao faturamento.',
  'recebimento antes do faturamento e recusado'
);

select throws_ok(
  $$ select public.record_receivable_payment(
    '94000000-0000-4000-8000-00000000b002'::uuid,
    (select id from public.receivables where request_id = '94000000-0000-4000-8000-00000000a004'::uuid),
    date '2026-08-18', 1200.00, 'cartao', 'cartao_sicredi_jc'
  ) $$,
  '22023',
  'Cartão de crédito é conta de pagamento, não de recebimento.',
  'cartao de credito nao recebe dinheiro'
);

-- Recebeu 1.190 (10 a menos: desconto) em 18/08, no Sicredi.
select lives_ok(
  $$ select public.record_receivable_payment(
    '94000000-0000-4000-8000-00000000b003'::uuid,
    (select id from public.receivables where request_id = '94000000-0000-4000-8000-00000000a004'::uuid),
    date '2026-08-18', 1190.00, 'pix', 'banco_sicredi_jc'
  ) $$,
  'financeiro baixa a cobranca'
);

select is((select status from public.receivables
    where request_id = '94000000-0000-4000-8000-00000000a004'::uuid), 'recebida',
  'a cobranca fica marcada como recebida');

-- A ponte com o livro ------------------------------------------------------

select is((select count(*)::int from public.finance_entries
    where source = 'contas_receber' and entry_type = 'lancamento' and reversed_at is null), 1,
  'a baixa gerou um lancamento no livro');

select is((select amount from public.finance_entries
    where source = 'contas_receber' and entry_type = 'lancamento' and reversed_at is null), 1190.00,
  'o valor no livro e o que entrou de verdade');

select is((select planned_amount from public.finance_entries
    where source = 'contas_receber' and entry_type = 'lancamento' and reversed_at is null), 1200.00,
  'o previsto no livro e o valor cobrado: a diferenca e o desconto');

select is((select competence_month from public.finance_entries
    where source = 'contas_receber' and entry_type = 'lancamento' and reversed_at is null), date '2026-07-01',
  'a venda de julho recebida em agosto pesa em julho');

select is((select paid_date from public.finance_entries
    where source = 'contas_receber' and entry_type = 'lancamento' and reversed_at is null), date '2026-08-18',
  'a data real do lancamento e o dia em que o dinheiro entrou');

select is((select category.key from public.finance_entries entry
    join public.finance_categories category on category.id = entry.category_id
    where entry.source = 'contas_receber' and entry.entry_type = 'lancamento' and entry.reversed_at is null),
  'clientes_pj',
  'a receita cai na categoria de clientes PJ');

select is((select account.key from public.finance_entries entry
    join public.finance_accounts account on account.id = entry.account_id
    where entry.source = 'contas_receber' and entry.entry_type = 'lancamento' and entry.reversed_at is null),
  'banco_sicredi_jc',
  'o livro sabe em qual conta o dinheiro entrou');

-- Repetir a baixa não duplica nada.
select lives_ok(
  $$ select public.record_receivable_payment(
    '94000000-0000-4000-8000-00000000b003'::uuid,
    (select id from public.receivables where request_id = '94000000-0000-4000-8000-00000000a004'::uuid),
    date '2026-08-18', 1190.00, 'pix', 'banco_sicredi_jc'
  ) $$,
  'repetir a baixa nao estoura erro'
);

select is((select count(*)::int from public.finance_entries where source = 'contas_receber'), 1,
  'o toque duplo na baixa nao gerou um segundo lancamento');

-- Cancelar cobrança recebida é proibido -------------------------------------

select throws_ok(
  $$ select public.cancel_receivable(
    '94000000-0000-4000-8000-00000000d001'::uuid,
    (select id from public.receivables where request_id = '94000000-0000-4000-8000-00000000a004'::uuid),
    'Cliente desistiu'
  ) $$,
  '22023',
  'Cobrança já recebida não pode ser cancelada. Estorne a baixa antes.',
  'dinheiro que entrou nao some por cancelamento'
);

-- Estorno ------------------------------------------------------------------

select throws_ok(
  $$ select public.reverse_receivable_payment(
    '94000000-0000-4000-8000-00000000e001'::uuid,
    (select id from public.receivables where request_id = '94000000-0000-4000-8000-00000000a004'::uuid),
    ''
  ) $$,
  '22023',
  'Informe o motivo do estorno.',
  'estorno sem motivo e recusado'
);

select lives_ok(
  $$ select public.reverse_receivable_payment(
    '94000000-0000-4000-8000-00000000e002'::uuid,
    (select id from public.receivables where request_id = '94000000-0000-4000-8000-00000000a004'::uuid),
    'Pix caiu na conta errada'
  ) $$,
  'financeiro estorna a baixa'
);

select is((select status from public.receivables
    where request_id = '94000000-0000-4000-8000-00000000a004'::uuid), 'aberta',
  'a cobranca volta para aberta');

select is((select received_amount from public.receivables
    where request_id = '94000000-0000-4000-8000-00000000a004'::uuid), null,
  'a cobranca nao guarda resquicio do recebimento estornado');

select is((select count(*)::int from public.finance_entries
    where source = 'contas_receber' and entry_type = 'lancamento' and reversed_at is null), 0,
  'o livro nao tem mais receita ativa desta cobranca');

select is((select count(*)::int from public.finance_entries
    where source = 'contas_receber' and entry_type = 'estorno'), 1,
  'o estorno nasceu como contra-lancamento em vez de apagar o original');

select is((select count(*)::int from public.finance_entries where source = 'contas_receber'), 2,
  'a historia inteira continua no livro: o lancamento e o estorno dele');

-- Depois do estorno, cancelar volta a ser possível.
select lives_ok(
  $$ select public.cancel_receivable(
    '94000000-0000-4000-8000-00000000d002'::uuid,
    (select id from public.receivables where request_id = '94000000-0000-4000-8000-00000000a004'::uuid),
    'Cobranca lancada em duplicidade'
  ) $$,
  'cobranca em aberto pode ser cancelada com motivo'
);

select is((select count(*)::int from public.receivable_events
    where receivable_id = (select id from public.receivables
      where request_id = '94000000-0000-4000-8000-00000000a004'::uuid)), 4,
  'a trilha guarda os quatro fatos: lancada, baixada, estornada e cancelada');

reset role;

select * from finish();
rollback;
