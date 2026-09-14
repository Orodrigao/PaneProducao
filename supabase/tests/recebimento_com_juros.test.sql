-- Recebimento acima do saldo: o que passa vira juros recebidos.
--
-- O que este teste protege:
--   * pagamento atrasado a mais abate só o saldo e separa o resto como juros;
--   * no livro, a venda pesa no mês do faturamento e os juros no mês do
--     recebimento, na categoria própria, com previsto zero;
--   * o dinheiro do livro continua sendo o que entrou no banco;
--   * pagamento a mais sem atraso exige justificativa, e a justificativa vai
--     para o pedaço e para a linha de juros;
--   * em pedaços, só o que passa do saldo vira juros, e o estorno respeita a
--     ordem: primeiro o pedaço que carrega os juros;
--   * perfil sem permissão não registra recebimento.

begin;
create extension if not exists pgtap with schema extensions;

select plan(32);

-- Cenário ------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('a2000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'financeiro-juros-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('a2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'vendas-juros-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('a2000000-0000-4000-8000-000000000001', 'Teste Financeiro Juros', 'financeiro', 'jc', true, '["/contas-receber"]'::jsonb),
  ('a2000000-0000-4000-8000-000000000002', 'Teste Vendas Juros', 'vendas', 'ja', true, '["/pedidos"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values
  ('a2000000-0000-4000-8000-000000000001', 'contas_receber.acessar', 'jc', null),
  ('a2000000-0000-4000-8000-000000000001', 'contas_receber.lancar', 'jc', null),
  ('a2000000-0000-4000-8000-000000000001', 'contas_receber.baixar', 'jc', null),
  ('a2000000-0000-4000-8000-000000000001', 'contas_receber.estornar', 'jc', null),
  ('a2000000-0000-4000-8000-000000000001', 'financeiro.acessar', '*', null);

insert into public.customers (id, name, doc, payment_term_days, active)
values ('a2000000-0000-4000-8000-0000000000c1', '[TESTE] Cliente Juros', '44555666000172', 10, true);

select is(
  (select nature || '|' || dre_group from public.finance_categories where key = 'juros_recebidos'),
  'receita|financeiras',
  'a categoria de juros recebidos existe como receita, no grupo das financeiras'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000001', true);

-- A: boleto pago com atraso e com juros ------------------------------------
-- Faturada há 40 dias, prazo de 10: venceu há 30. Pagou 523,07 há 5 dias.

select lives_ok(
  $$ select public.create_manual_receivable(
    'a2000000-0000-4000-8000-00000000a001'::uuid,
    'a2000000-0000-4000-8000-0000000000c1'::uuid,
    private.data_na_padaria() - 40, 500.00, 'Paes de agosto'
  ) $$,
  'financeiro lanca a cobranca de 500,00'
);

select lives_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b001'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a001'::uuid),
    private.data_na_padaria() - 5, 523.07, 'boleto', 'banco_sicredi_jc'
  ) $$,
  'pagamento atrasado a mais nao pede justificativa'
);

select is((select amount from public.receivable_receipts
    where request_id = 'a2000000-0000-4000-8000-00000000b001'::uuid), 500.00,
  'o pedaco abate somente o saldo');

select is((select interest_amount from public.receivable_receipts
    where request_id = 'a2000000-0000-4000-8000-00000000b001'::uuid), 23.07,
  'o que passou do saldo fica guardado como juros');

select is((select status from public.receivables
    where request_id = 'a2000000-0000-4000-8000-00000000a001'::uuid), 'recebida',
  'a cobranca fecha');

select is((select private.receivable_recebido(id) from public.receivables
    where request_id = 'a2000000-0000-4000-8000-00000000a001'::uuid), 500.00,
  'o recebido da cobranca nao inclui os juros');

select is((select count(*)::int from public.finance_entries
    where source = 'contas_receber' and entry_type = 'lancamento' and reversed_at is null
      and source_ref = (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b001'::uuid)), 2,
  'o pedaco vira duas linhas no livro');

select is((select entry.amount from public.finance_entries entry
    join public.receivables cobranca on cobranca.finance_category_id = entry.category_id
    where cobranca.request_id = 'a2000000-0000-4000-8000-00000000a001'::uuid
      and entry.source = 'contas_receber' and entry.entry_type = 'lancamento' and entry.reversed_at is null
      and entry.source_ref = (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b001'::uuid)),
  500.00,
  'a venda fica na categoria da cobranca com o valor cobrado');

select is((select entry.competence_month from public.finance_entries entry
    join public.receivables cobranca on cobranca.finance_category_id = entry.category_id
    where cobranca.request_id = 'a2000000-0000-4000-8000-00000000a001'::uuid
      and entry.source = 'contas_receber' and entry.entry_type = 'lancamento' and entry.reversed_at is null
      and entry.source_ref = (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b001'::uuid)),
  date_trunc('month', private.data_na_padaria() - 40)::date,
  'a venda pesa no mes do faturamento');

select is((select entry.amount from public.finance_entries entry
    join public.finance_categories category on category.id = entry.category_id and category.key = 'juros_recebidos'
    where entry.source = 'contas_receber' and entry.entry_type = 'lancamento' and entry.reversed_at is null
      and entry.source_ref = (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b001'::uuid)),
  23.07,
  'os juros viram linha propria em juros recebidos');

select is((select entry.competence_month from public.finance_entries entry
    join public.finance_categories category on category.id = entry.category_id and category.key = 'juros_recebidos'
    where entry.source = 'contas_receber' and entry.entry_type = 'lancamento' and entry.reversed_at is null
      and entry.source_ref = (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b001'::uuid)),
  date_trunc('month', private.data_na_padaria() - 5)::date,
  'os juros pesam no mes em que o dinheiro entrou');

select is((select entry.planned_amount from public.finance_entries entry
    join public.finance_categories category on category.id = entry.category_id and category.key = 'juros_recebidos'
    where entry.source = 'contas_receber' and entry.entry_type = 'lancamento' and entry.reversed_at is null
      and entry.source_ref = (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b001'::uuid)),
  0::numeric,
  'ninguem planeja receber juros: previsto zero');

select is((select sum(amount) from public.finance_entries
    where source = 'contas_receber' and entry_type = 'lancamento' and reversed_at is null
      and source_ref = (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b001'::uuid)),
  523.07,
  'o livro soma exatamente o dinheiro que entrou');

select is(
  (select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b001'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a001'::uuid),
    private.data_na_padaria() - 5, 523.07, 'boleto', 'banco_sicredi_jc')),
  (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b001'::uuid),
  'repetir o mesmo recebimento devolve o mesmo pedaco'
);

select is((select count(*)::int from public.finance_entries
    where source = 'contas_receber' and reversed_at is null
      and source_ref = (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b001'::uuid)), 2,
  'e nao duplica as linhas do livro');

-- B: pagamento a mais sem atraso -------------------------------------------
-- Faturada há 3 dias, vence daqui a 7. Pagou 310 numa cobrança de 300 hoje.

select lives_ok(
  $$ select public.create_manual_receivable(
    'a2000000-0000-4000-8000-00000000a002'::uuid,
    'a2000000-0000-4000-8000-0000000000c1'::uuid,
    private.data_na_padaria() - 3, 300.00, 'Paes da semana'
  ) $$,
  'financeiro lanca a cobranca de 300,00 ainda a vencer'
);

select throws_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b002'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a002'::uuid),
    private.data_na_padaria(), 310.00, 'pix', 'banco_sicredi_jc'
  ) $$,
  '22023',
  'O pagamento não está atrasado e passou R$ 10,00 do que falta. Confira o valor ou informe a justificativa.',
  'valor a mais sem atraso e sem justificativa e recusado'
);

select throws_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b003'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a002'::uuid),
    private.data_na_padaria(), 310.00, 'pix', 'banco_sicredi_jc', 'ok'
  ) $$,
  '22023',
  'Escreva a justificativa com pelo menos 3 letras.',
  'justificativa de duas letras e recusada'
);

select is((select count(*)::int from public.receivable_receipts
    where receivable_id = (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a002'::uuid)), 0,
  'as tentativas recusadas nao gravaram nada');

select lives_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b004'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a002'::uuid),
    private.data_na_padaria(), 310.00, 'pix', 'banco_sicredi_jc', '  Cliente arredondou para cima  '
  ) $$,
  'com justificativa, o valor a mais sem atraso e aceito'
);

select is((select excess_reason || '|' || interest_amount from public.receivable_receipts
    where request_id = 'a2000000-0000-4000-8000-00000000b004'::uuid),
  'Cliente arredondou para cima|10.00',
  'o pedaco guarda a justificativa limpa e os juros');

select matches((select entry.description from public.finance_entries entry
    join public.finance_categories category on category.id = entry.category_id and category.key = 'juros_recebidos'
    where entry.source = 'contas_receber' and entry.reversed_at is null
      and entry.source_ref = (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b004'::uuid)),
  'Cliente arredondou para cima$',
  'a linha de juros do livro mostra a justificativa');

-- C: pedaços e a ordem do estorno ------------------------------------------
-- Cobrança de 1.000, vencida. Pedaço de 600 e depois de 450: só 50 são juros.

select lives_ok(
  $$ select public.create_manual_receivable(
    'a2000000-0000-4000-8000-00000000a003'::uuid,
    'a2000000-0000-4000-8000-0000000000c1'::uuid,
    private.data_na_padaria() - 40, 1000.00, 'Paes de julho'
  ) $$,
  'financeiro lanca a cobranca de 1.000,00'
);

select lives_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b005'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a003'::uuid),
    private.data_na_padaria() - 20, 600.00, 'pix', 'banco_sicredi_jc'
  ) $$,
  'primeiro pedaco de 600'
);

select lives_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b006'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a003'::uuid),
    private.data_na_padaria() - 10, 450.00, 'pix', 'banco_sicredi_jc',
    'Cliente pagou com juros do boleto'
  ) $$,
  'segundo pedaco de 450 passa do saldo; com atraso a justificativa e opcional'
);

select is((select amount || '|' || interest_amount from public.receivable_receipts
    where request_id = 'a2000000-0000-4000-8000-00000000b006'::uuid),
  '400.00|50.00',
  'so o que passa do saldo vira juros');

select throws_ok(
  $$ select public.reverse_receivable_receipt(
    'a2000000-0000-4000-8000-00000000e001'::uuid,
    (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b005'::uuid),
    'Pix devolvido'
  ) $$,
  '22023',
  'O recebimento de ' || to_char(private.data_na_padaria() - 10, 'DD/MM/YYYY')
    || ' separou R$ 50,00 de juros contando com este. Estorne aquele primeiro.',
  'nao estorna o pedaco anterior enquanto o posterior carrega juros'
);

select lives_ok(
  $$ select public.reverse_receivable_receipt(
    'a2000000-0000-4000-8000-00000000e002'::uuid,
    (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b006'::uuid),
    'Valor digitado errado'
  ) $$,
  'o pedaco com juros e estornado primeiro'
);

select is((select count(*)::int || '|' || sum(amount) from public.finance_entries
    where source = 'contas_receber' and entry_type = 'estorno'
      and source_ref = (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b006'::uuid)),
  '2|450.00',
  'o estorno desfaz a linha da venda e a linha dos juros');

select lives_ok(
  $$ select public.reverse_receivable_receipt(
    'a2000000-0000-4000-8000-00000000e003'::uuid,
    (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b005'::uuid),
    'Pix devolvido'
  ) $$,
  'depois disso o pedaco anterior pode ser estornado'
);

-- D: perfil sem permissão --------------------------------------------------

select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000002', true);

select throws_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b007'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a003'::uuid),
    private.data_na_padaria(), 1050.00, 'pix', 'banco_sicredi_jc'
  ) $$,
  '42501',
  'Sem permissão para registrar recebimentos.',
  'vendas nao registra recebimento'
);

reset role;

select * from finish();
rollback;
