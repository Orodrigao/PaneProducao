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

select plan(42);

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
  ('94000000-0000-4000-8000-000000000001', 'contas_receber.corrigir_vencimento', 'jc', null),
  -- Somente LER o livro, de proposito. Sem financeiro.lancar nem
  -- financeiro.estornar: e o que prova que dar baixa escreve no livro por
  -- dentro da acao protegida, sem exigir permissao de lancamento de quem
  -- opera o contas a receber.
  ('94000000-0000-4000-8000-000000000001', 'financeiro.acessar', '*', null);

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
    private.data_na_padaria() - 40, 500.00, 'Tentativa sem permissao'
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
    private.data_na_padaria() - 40, 500.00, 'Cliente sem prazo combinado'
  ) $$,
  '22023',
  'Este cliente ainda não tem prazo de pagamento cadastrado. Defina o prazo na tela de Clientes antes de cobrar.',
  'cliente sem prazo nao vira cobranca'
);

select throws_ok(
  $$ select public.create_manual_receivable(
    '94000000-0000-4000-8000-00000000a003'::uuid,
    '94000000-0000-4000-8000-0000000000c1'::uuid,
    private.data_na_padaria() + 1, 500.00, 'Faturamento no futuro'
  ) $$,
  '22023',
  'A data do faturamento não pode ser no futuro.',
  'faturamento no futuro e recusado'
);

-- Datas relativas ao dia da execucao: data fixa vira "recebimento no futuro"
-- assim que o calendario passa dela. Faturado ha 40 dias, prazo de 30: venceu
-- ha 10 dias.
select lives_ok(
  $$ select public.create_manual_receivable(
    '94000000-0000-4000-8000-00000000a004'::uuid,
    '94000000-0000-4000-8000-0000000000c1'::uuid,
    private.data_na_padaria() - 40, 1200.00, 'Paes da semana'
  ) $$,
  'financeiro lanca a cobranca avulsa'
);

select is((select due_date from public.receivables
    where request_id = '94000000-0000-4000-8000-00000000a004'::uuid), private.data_na_padaria() - 10,
  'o vencimento sai do prazo cadastrado no cliente');

select is((select status from public.receivables
    where request_id = '94000000-0000-4000-8000-00000000a004'::uuid), 'aberta',
  'a cobranca nasce em aberto');

-- Repetir a mesma requisição devolve a mesma cobrança.
select is(
  (select public.create_manual_receivable(
    '94000000-0000-4000-8000-00000000a004'::uuid,
    '94000000-0000-4000-8000-0000000000c1'::uuid,
    private.data_na_padaria() - 40, 1200.00, 'Paes da semana')),
  (select id from public.receivables where request_id = '94000000-0000-4000-8000-00000000a004'::uuid),
  'repetir o lancamento devolve a mesma cobranca'
);

-- Escopo do cliente deste teste: no Banco Preview o seed ja deixou cobrancas
-- proprias, e contar a tabela inteira mediria o cenario alheio.
select is((select count(*)::int from public.receivables
    where customer_id = '94000000-0000-4000-8000-0000000000c1'::uuid), 1,
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
  $$ select public.record_receivable_receipt(
    '94000000-0000-4000-8000-00000000b001'::uuid,
    (select id from public.receivables where request_id = '94000000-0000-4000-8000-00000000a004'::uuid),
    private.data_na_padaria() - 45, 1200.00, 'pix', 'banco_sicredi_jc'
  ) $$,
  '22023',
  'O recebimento não pode ser anterior ao faturamento.',
  'recebimento antes do faturamento e recusado'
);

select throws_ok(
  $$ select public.record_receivable_receipt(
    '94000000-0000-4000-8000-00000000b002'::uuid,
    (select id from public.receivables where request_id = '94000000-0000-4000-8000-00000000a004'::uuid),
    private.data_na_padaria() - 2, 1200.00, 'cartao', 'cartao_sicredi_jc'
  ) $$,
  '22023',
  'Cartão de crédito é conta de pagamento, não de recebimento.',
  'cartao de credito nao recebe dinheiro'
);

-- Recebe o valor cheio de uma vez. Valor menor deixou de significar desconto:
-- agora e recebimento parcial, coberto por recebimento_em_pedacos.test.sql.
select lives_ok(
  $$ select public.record_receivable_receipt(
    '94000000-0000-4000-8000-00000000b003'::uuid,
    (select id from public.receivables where request_id = '94000000-0000-4000-8000-00000000a004'::uuid),
    private.data_na_padaria() - 2, 1200.00, 'pix', 'banco_sicredi_jc'
  ) $$,
  'financeiro baixa a cobranca'
);

select is((select status from public.receivables
    where request_id = '94000000-0000-4000-8000-00000000a004'::uuid), 'recebida',
  'a cobranca fica marcada como recebida');

-- A ponte com o livro ------------------------------------------------------

-- Quem deu a baixa nao tem financeiro.lancar: o lancamento nasceu por dentro
-- da acao protegida, e nao pela permissao de quem clicou.
select ok(not exists(select 1 from public.app_user_permissions
    where user_id = '94000000-0000-4000-8000-000000000001'
      and permission_key in ('financeiro.lancar', 'financeiro.estornar')),
  'quem baixou nao tem permissao de lancar no livro');

select is((select count(*)::int from public.finance_entries
    where source_ref in (select recibo.id from public.receivable_receipts recibo join public.receivables cobranca on cobranca.id = recibo.receivable_id where cobranca.request_id = '94000000-0000-4000-8000-00000000a004'::uuid) and source = 'contas_receber' and entry_type = 'lancamento' and reversed_at is null), 1,
  'a baixa gerou um lancamento no livro');

select is((select amount from public.finance_entries
    where source_ref in (select recibo.id from public.receivable_receipts recibo join public.receivables cobranca on cobranca.id = recibo.receivable_id where cobranca.request_id = '94000000-0000-4000-8000-00000000a004'::uuid) and source = 'contas_receber' and entry_type = 'lancamento' and reversed_at is null), 1200.00,
  'o valor no livro e o que entrou de verdade');

select is((select planned_amount from public.finance_entries
    where source_ref in (select recibo.id from public.receivable_receipts recibo join public.receivables cobranca on cobranca.id = recibo.receivable_id where cobranca.request_id = '94000000-0000-4000-8000-00000000a004'::uuid) and source = 'contas_receber' and entry_type = 'lancamento' and reversed_at is null), 1200.00,
  'previsto e realizado do pedaco sao iguais: a diferenca vive na cobranca');

select is((select competence_month from public.finance_entries
    where source_ref in (select recibo.id from public.receivable_receipts recibo join public.receivables cobranca on cobranca.id = recibo.receivable_id where cobranca.request_id = '94000000-0000-4000-8000-00000000a004'::uuid) and source = 'contas_receber' and entry_type = 'lancamento' and reversed_at is null), date_trunc('month', private.data_na_padaria() - 40)::date,
  'a venda pesa no mes do faturamento, nao no mes em que o dinheiro entrou');

select is((select paid_date from public.finance_entries
    where source_ref in (select recibo.id from public.receivable_receipts recibo join public.receivables cobranca on cobranca.id = recibo.receivable_id where cobranca.request_id = '94000000-0000-4000-8000-00000000a004'::uuid) and source = 'contas_receber' and entry_type = 'lancamento' and reversed_at is null), private.data_na_padaria() - 2,
  'a data real do lancamento e o dia em que o dinheiro entrou');

select is((select category.key from public.finance_entries entry
    join public.finance_categories category on category.id = entry.category_id
    where entry.source_ref in (select recibo.id from public.receivable_receipts recibo join public.receivables cobranca on cobranca.id = recibo.receivable_id where cobranca.request_id = '94000000-0000-4000-8000-00000000a004'::uuid) and entry.source = 'contas_receber' and entry.entry_type = 'lancamento' and entry.reversed_at is null),
  'clientes_pj',
  'a receita cai na categoria de clientes PJ');

select is((select account.key from public.finance_entries entry
    join public.finance_accounts account on account.id = entry.account_id
    where entry.source_ref in (select recibo.id from public.receivable_receipts recibo join public.receivables cobranca on cobranca.id = recibo.receivable_id where cobranca.request_id = '94000000-0000-4000-8000-00000000a004'::uuid) and entry.source = 'contas_receber' and entry.entry_type = 'lancamento' and entry.reversed_at is null),
  'banco_sicredi_jc',
  'o livro sabe em qual conta o dinheiro entrou');

-- Repetir a baixa não duplica nada.
select lives_ok(
  $$ select public.record_receivable_receipt(
    '94000000-0000-4000-8000-00000000b003'::uuid,
    (select id from public.receivables where request_id = '94000000-0000-4000-8000-00000000a004'::uuid),
    private.data_na_padaria() - 2, 1200.00, 'pix', 'banco_sicredi_jc'
  ) $$,
  'repetir a baixa nao estoura erro'
);

select is((select count(*)::int from public.finance_entries where source_ref in (select recibo.id from public.receivable_receipts recibo join public.receivables cobranca on cobranca.id = recibo.receivable_id where cobranca.request_id = '94000000-0000-4000-8000-00000000a004'::uuid)), 1,
  'o toque duplo na baixa nao gerou um segundo lancamento');

-- Cancelar cobrança recebida é proibido -------------------------------------

select throws_ok(
  $$ select public.cancel_receivable(
    '94000000-0000-4000-8000-00000000d001'::uuid,
    (select id from public.receivables where request_id = '94000000-0000-4000-8000-00000000a004'::uuid),
    'Cliente desistiu'
  ) $$,
  '22023',
  'Esta cobrança já recebeu 1200.00. Estorne os recebimentos antes de cancelar.',
  'dinheiro que entrou nao some por cancelamento'
);

-- Estorno ------------------------------------------------------------------

select throws_ok(
  $$ select public.reverse_receivable_receipt(
    '94000000-0000-4000-8000-00000000e001'::uuid,
    (select recibo.id from public.receivable_receipts recibo
       join public.receivables cobranca on cobranca.id = recibo.receivable_id
      where cobranca.request_id = '94000000-0000-4000-8000-00000000a004'::uuid),
    ''
  ) $$,
  '22023',
  'Informe o motivo do estorno.',
  'estorno sem motivo e recusado'
);

select lives_ok(
  $$ select public.reverse_receivable_receipt(
    '94000000-0000-4000-8000-00000000e002'::uuid,
    (select recibo.id from public.receivable_receipts recibo
       join public.receivables cobranca on cobranca.id = recibo.receivable_id
      where cobranca.request_id = '94000000-0000-4000-8000-00000000a004'::uuid),
    'Pix caiu na conta errada'
  ) $$,
  'financeiro estorna a baixa'
);

select is((select status from public.receivables
    where request_id = '94000000-0000-4000-8000-00000000a004'::uuid), 'aberta',
  'a cobranca volta para aberta');

select is((select private.receivable_recebido(id) from public.receivables
    where request_id = '94000000-0000-4000-8000-00000000a004'::uuid), 0::numeric,
  'a cobranca nao guarda resquicio do recebimento estornado');

select is((select count(*)::int from public.finance_entries
    where source_ref in (select recibo.id from public.receivable_receipts recibo join public.receivables cobranca on cobranca.id = recibo.receivable_id where cobranca.request_id = '94000000-0000-4000-8000-00000000a004'::uuid) and source = 'contas_receber' and entry_type = 'lancamento' and reversed_at is null), 0,
  'o livro nao tem mais receita ativa desta cobranca');

select is((select count(*)::int from public.finance_entries
    where source_ref in (select recibo.id from public.receivable_receipts recibo join public.receivables cobranca on cobranca.id = recibo.receivable_id where cobranca.request_id = '94000000-0000-4000-8000-00000000a004'::uuid) and source = 'contas_receber' and entry_type = 'estorno'), 1,
  'o estorno nasceu como contra-lancamento em vez de apagar o original');

select is((select count(*)::int from public.finance_entries where source_ref in (select recibo.id from public.receivable_receipts recibo join public.receivables cobranca on cobranca.id = recibo.receivable_id where cobranca.request_id = '94000000-0000-4000-8000-00000000a004'::uuid)), 2,
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
