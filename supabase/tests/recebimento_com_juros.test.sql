-- Recebimento acima do saldo: o que passa vira juros recebidos.
--
-- O que este teste protege:
--   * pagamento atrasado a mais abate só o saldo e separa o resto como juros;
--   * no livro, a venda pesa no mês do faturamento e os juros no mês do
--     recebimento, na categoria própria, com previsto zero;
--   * o dinheiro do livro continua sendo o que entrou no banco;
--   * pagamento a mais até o vencimento exige justificativa de verdade (espaço e
--     quebra de linha não contam), e ela vai para o pedaço e para a linha de juros;
--   * em pedaços, só o que passa do saldo vira juros, e o estorno respeita a
--     ordem: primeiro o pedaço que carrega os juros;
--   * na cobrança de pedido PJ reduzida depois de pagamento, a diferença da
--     conferência continua sendo valor do pedido e só o resto vira juros;
--   * cobrança já na categoria de juros sai numa linha só;
--   * perfil sem permissão não registra nem consulta a regra.

begin;
create extension if not exists pgtap with schema extensions;

select plan(68);

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

select is(
  public.receivable_excess_rule((select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a001'::uuid)),
  '{"modo": "juros", "sobra_do_pedido": 0}'::jsonb,
  'cobranca avulsa: toda a sobra vira juros'
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
    'a2000000-0000-4000-8000-00000000b010'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a002'::uuid),
    private.data_na_padaria(), 310.00, 'pix', 'banco_sicredi_jc', E' \n\t\r\n '
  ) $$,
  '22023',
  'O pagamento não está atrasado e passou R$ 10,00 do que falta. Confira o valor ou informe a justificativa.',
  'espaco, tabulacao e quebra de linha nao contam como justificativa'
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

select throws_ok(
  format($f$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b011'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a002'::uuid),
    private.data_na_padaria(), 310.00, 'pix', 'banco_sicredi_jc', %L
  ) $f$, repeat('x', 301)),
  '22023',
  'A justificativa passou de 300 caracteres. Resuma o motivo.',
  'justificativa acima de 300 caracteres e recusada'
);

select is((select count(*)::int from public.receivable_receipts
    where receivable_id = (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a002'::uuid)), 0,
  'as tentativas recusadas nao gravaram nada');

select lives_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b004'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a002'::uuid),
    private.data_na_padaria(), 310.00, 'pix', 'banco_sicredi_jc', E'  Cliente arredondou para cima\n'
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

-- B2: o dia do vencimento ainda não é atraso ------------------------------
-- Faturada há 10 dias com prazo de 10: vence hoje.

select lives_ok(
  $$ select public.create_manual_receivable(
    'a2000000-0000-4000-8000-00000000a005'::uuid,
    'a2000000-0000-4000-8000-0000000000c1'::uuid,
    private.data_na_padaria() - 10, 200.00, 'Paes que vencem hoje'
  ) $$,
  'financeiro lanca a cobranca que vence hoje'
);

select throws_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b012'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a005'::uuid),
    private.data_na_padaria(), 205.00, 'pix', 'banco_sicredi_jc'
  ) $$,
  '22023',
  'O pagamento não está atrasado e passou R$ 5,00 do que falta. Confira o valor ou informe a justificativa.',
  'pagar a mais no proprio dia do vencimento ainda pede justificativa'
);

select lives_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b013'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a005'::uuid),
    private.data_na_padaria(), 150.00, 'pix', 'banco_sicredi_jc', 'Motivo sem valor a mais'
  ) $$,
  'recebimento parcial com texto de justificativa e aceito'
);

select is((select coalesce(excess_reason, 'sem motivo') || '|' || interest_amount from public.receivable_receipts
    where request_id = 'a2000000-0000-4000-8000-00000000b013'::uuid),
  'sem motivo|0.00',
  'sem valor a mais, o texto de justificativa e descartado');

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
  'o estorno cria contra-lancamento da venda e dos juros');

select is((select count(*)::int from public.finance_entries
    where source = 'contas_receber' and entry_type = 'lancamento' and reversed_at is not null
      and source_ref = (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b006'::uuid)),
  2,
  'as duas linhas originais ficam marcadas como estornadas');

select lives_ok(
  $$ select public.reverse_receivable_receipt(
    'a2000000-0000-4000-8000-00000000e003'::uuid,
    (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b005'::uuid),
    'Pix devolvido'
  ) $$,
  'depois disso o pedaco anterior pode ser estornado'
);

-- D: diferença da conferência de pedido PJ ---------------------------------
-- O cliente pode ter na mão um boleto maior que a cobrança atual. Até essa
-- diferença a sobra é valor do pedido, tratado na ficha PJ; só o resto é juros.
-- Os pedidos aqui não estão na jornada: a regra olha só as cobranças do pedido
-- e seus eventos, e cada caso é montado à mão como a liberação real grava
-- (transition_pj_flow_pilot, migration 20260908164021).

select lives_ok(
  $$ select public.create_manual_receivable(
    'a2000000-0000-4000-8000-00000000a006'::uuid,
    'a2000000-0000-4000-8000-0000000000c1'::uuid,
    private.data_na_padaria() - 40, 190.00, 'Pedido corrigido e vencido'
  ) $$,
  'financeiro lanca a cobranca corrigida e vencida'
);

select lives_ok(
  $$ select public.create_manual_receivable(
    'a2000000-0000-4000-8000-00000000a009'::uuid,
    'a2000000-0000-4000-8000-0000000000c1'::uuid,
    private.data_na_padaria() - 3, 190.00, 'Pedido corrigido a vencer'
  ) $$,
  'financeiro lanca a cobranca corrigida a vencer'
);

select lives_ok(
  $$ select public.create_manual_receivable(
    'a2000000-0000-4000-8000-00000000a010'::uuid,
    'a2000000-0000-4000-8000-0000000000c1'::uuid,
    private.data_na_padaria() - 3, 190.00, 'Outro pedido corrigido a vencer'
  ) $$,
  'financeiro lanca outra cobranca corrigida a vencer'
);

select lives_ok(
  $$ select public.create_manual_receivable(
    'a2000000-0000-4000-8000-00000000a011'::uuid,
    'a2000000-0000-4000-8000-0000000000c1'::uuid,
    private.data_na_padaria() - 40, 180.00, 'Pedido corrigido duas vezes'
  ) $$,
  'financeiro lanca a cobranca corrigida duas vezes'
);

select lives_ok(
  $$ select public.create_manual_receivable(
    'a2000000-0000-4000-8000-00000000a012'::uuid,
    'a2000000-0000-4000-8000-0000000000c1'::uuid,
    private.data_na_padaria() - 40, 95.00, 'Parcela 1 do pedido dividido'
  ) $$,
  'financeiro lanca a parcela 1 do pedido dividido'
);

select lives_ok(
  $$ select public.create_manual_receivable(
    'a2000000-0000-4000-8000-00000000a013'::uuid,
    'a2000000-0000-4000-8000-0000000000c1'::uuid,
    private.data_na_padaria() - 40, 95.00, 'Parcela 2 do pedido dividido'
  ) $$,
  'financeiro lanca a parcela 2 do pedido dividido'
);

select lives_ok(
  $$ select public.create_manual_receivable(
    'a2000000-0000-4000-8000-00000000a014'::uuid,
    'a2000000-0000-4000-8000-0000000000c1'::uuid,
    private.data_na_padaria() - 40, 200.00, 'Emissao substituida'
  ) $$,
  'financeiro lanca a emissao que sera substituida'
);

select lives_ok(
  $$ select public.create_manual_receivable(
    'a2000000-0000-4000-8000-00000000a015'::uuid,
    'a2000000-0000-4000-8000-0000000000c1'::uuid,
    private.data_na_padaria() - 40, 190.00, 'Emissao nova'
  ) $$,
  'financeiro lanca a emissao nova'
);

reset role;

-- A liberação sem pagamento cancela a emissão anterior inteira. Cancelada
-- antes de entrar no grupo: só uma cobrança viva por parcela do pedido.
update public.receivables
set status = 'cancelada',
    cancelled_at = now(),
    cancelled_by = 'a2000000-0000-4000-8000-000000000001',
    cancel_reason = 'Substituida apos nova conferencia e revisao PJ.'
where request_id = 'a2000000-0000-4000-8000-00000000a014'::uuid;

-- Cada cobrança vira pedido PJ do seu grupo; a divisão e a nova emissão
-- compartilham o grupo, e as parcelas levam número e quantidade.
update public.receivables cobranca
set origin = 'pedido_pj', origin_ref = grupo.ref,
    installment_number = grupo.parcela, installment_count = grupo.parcelas
from (values
  ('a2000000-0000-4000-8000-00000000a006'::uuid, 'a2000000-0000-4000-8000-0000000000f6'::uuid, 1, 1),
  ('a2000000-0000-4000-8000-00000000a009'::uuid, 'a2000000-0000-4000-8000-0000000000f9'::uuid, 1, 1),
  ('a2000000-0000-4000-8000-00000000a010'::uuid, 'a2000000-0000-4000-8000-0000000000fa'::uuid, 1, 1),
  ('a2000000-0000-4000-8000-00000000a011'::uuid, 'a2000000-0000-4000-8000-0000000000fb'::uuid, 1, 1),
  ('a2000000-0000-4000-8000-00000000a012'::uuid, 'a2000000-0000-4000-8000-0000000000fc'::uuid, 1, 2),
  ('a2000000-0000-4000-8000-00000000a013'::uuid, 'a2000000-0000-4000-8000-0000000000fc'::uuid, 2, 2),
  ('a2000000-0000-4000-8000-00000000a014'::uuid, 'a2000000-0000-4000-8000-0000000000fd'::uuid, 1, 1),
  ('a2000000-0000-4000-8000-00000000a015'::uuid, 'a2000000-0000-4000-8000-0000000000fd'::uuid, 1, 1)
) grupo(request_id, ref, parcela, parcelas)
where cobranca.request_id = grupo.request_id;

-- A redução com dinheiro dentro grava o valor anterior no id da cobrança.
insert into public.receivable_events (receivable_id, event_type, reason, details, created_by, created_at)
select cobranca.id, 'valor_corrigido_pj', 'Nova conferencia apos pagamento', evento.details,
       'a2000000-0000-4000-8000-000000000001', evento.quando
from (values
  ('a2000000-0000-4000-8000-00000000a006'::uuid, '{"de": 200.00, "para": 190.00}'::jsonb, now() - interval '2 hours'),
  ('a2000000-0000-4000-8000-00000000a009'::uuid, '{"de": 200.00, "para": 190.00}'::jsonb, now() - interval '2 hours'),
  ('a2000000-0000-4000-8000-00000000a010'::uuid, '{"de": 200.00, "para": 190.00}'::jsonb, now() - interval '2 hours'),
  ('a2000000-0000-4000-8000-00000000a011'::uuid, '{"de": 200.00, "para": 190.00}'::jsonb, now() - interval '2 hours'),
  ('a2000000-0000-4000-8000-00000000a011'::uuid, '{"de": 190.00, "para": 180.00}'::jsonb, now() - interval '1 hour'),
  ('a2000000-0000-4000-8000-00000000a012'::uuid, '{"de": 200.00, "para": 190.00}'::jsonb, now() - interval '2 hours')
) evento(request_id, details, quando)
join public.receivables cobranca on cobranca.request_id = evento.request_id;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000001', true);

-- Redução com dinheiro dentro: 200 viraram 190.

select is(
  public.receivable_excess_rule((select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a006'::uuid)),
  '{"modo": "juros", "sobra_do_pedido": 10}'::jsonb,
  'a regra sabe que 10 da sobra sao diferenca da conferencia'
);

select lives_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b014'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a006'::uuid),
    private.data_na_padaria() - 5, 205.00, 'boleto', 'banco_sicredi_jc'
  ) $$,
  'o boleto original pago com atraso e juros e registrado'
);

select is((select amount || '|' || interest_amount from public.receivable_receipts
    where request_id = 'a2000000-0000-4000-8000-00000000b014'::uuid),
  '200.00|5.00',
  'a diferenca da conferencia fica no pedido e so o resto vira juros');

select is((select count(*)::int || '|' || sum(entry.amount) || '|' || string_agg(category.key, ',' order by category.key)
    from public.finance_entries entry
    join public.finance_categories category on category.id = entry.category_id
    where entry.source = 'contas_receber' and entry.entry_type = 'lancamento' and entry.reversed_at is null
      and entry.source_ref = (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b014'::uuid)),
  '2|205.00|clientes_pj,juros_recebidos',
  'no livro, 200 na categoria da cobranca e 5 de juros');

select lives_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b017'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a009'::uuid),
    private.data_na_padaria(), 198.00, 'pix', 'banco_sicredi_jc', 'Texto que nao deve ficar'
  ) $$,
  'sobra dentro da diferenca da conferencia, sem atraso, nao pede motivo'
);

select is((select amount || '|' || interest_amount || '|' || coalesce(excess_reason, 'sem motivo')
    from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b017'::uuid),
  '198.00|0.00|sem motivo',
  'sem juros, tudo fica no pedido como antes e o motivo e descartado');

select is((select count(*)::int || '|' || sum(entry.amount) || '|' || min(category.key) from public.finance_entries entry
    join public.finance_categories category on category.id = entry.category_id
    where entry.source = 'contas_receber' and entry.entry_type = 'lancamento' and entry.reversed_at is null
      and entry.source_ref = (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b017'::uuid)),
  '1|198.00|clientes_pj',
  'o livro recebe uma linha so, na categoria da cobranca');

select throws_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b018'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a010'::uuid),
    private.data_na_padaria(), 205.00, 'pix', 'banco_sicredi_jc'
  ) $$,
  '22023',
  'O pagamento não está atrasado e passou R$ 5,00 do que falta. Confira o valor ou informe a justificativa.',
  'sem atraso, so a parte que seria juros pede justificativa'
);

-- Reduções sucessivas: 200 para 190 e depois para 180.

select is(
  public.receivable_excess_rule((select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a011'::uuid)),
  '{"modo": "juros", "sobra_do_pedido": 20}'::jsonb,
  'com duas reducoes vale o primeiro valor anterior: 200 menos 180'
);

-- Divisão em parcelas depois da redução: a diferença é do pedido inteiro.

select is(
  public.receivable_excess_rule((select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a012'::uuid)),
  '{"modo": "juros", "sobra_do_pedido": 10}'::jsonb,
  'dividido em 95 e 95, a diferenca continua sendo 200 menos 190'
);

select lives_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b019'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a012'::uuid),
    private.data_na_padaria() - 5, 105.00, 'boleto', 'banco_sicredi_jc'
  ) $$,
  'a parcela 1 recebe 105'
);

select is((select amount || '|' || interest_amount from public.receivable_receipts
    where request_id = 'a2000000-0000-4000-8000-00000000b019'::uuid),
  '105.00|0.00',
  'os 10 a mais da parcela 1 sao a diferenca da conferencia');

select is(
  public.receivable_excess_rule((select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a013'::uuid)),
  '{"modo": "juros", "sobra_do_pedido": 0}'::jsonb,
  'a parcela 2 nao usa de novo a diferenca que a parcela 1 ja recebeu'
);

-- Nova emissão sem pagamento: a de 200 foi cancelada e a de 190 emitida.

select is(
  public.receivable_excess_rule((select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a015'::uuid)),
  '{"modo": "juros", "sobra_do_pedido": 10}'::jsonb,
  'a emissao cancelada por nova conferencia conta como boleto na mao do cliente'
);

select lives_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b020'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a015'::uuid),
    private.data_na_padaria() - 5, 200.00, 'boleto', 'banco_sicredi_jc'
  ) $$,
  'o cliente paga o boleto antigo de 200 com atraso'
);

select is((select amount || '|' || interest_amount from public.receivable_receipts
    where request_id = 'a2000000-0000-4000-8000-00000000b020'::uuid),
  '200.00|0.00',
  'os 10 do boleto antigo sao valor do pedido, nao juros');

-- F: cobrança já na categoria de juros sai numa linha só -------------------

select lives_ok(
  $$ select public.create_manual_receivable(
    'a2000000-0000-4000-8000-00000000a008'::uuid,
    'a2000000-0000-4000-8000-0000000000c1'::uuid,
    private.data_na_padaria() - 40, 80.00, 'Juros cobrados a parte'
  ) $$,
  'financeiro lanca uma cobranca de juros'
);

reset role;
update public.receivables
set finance_category_id = (select id from public.finance_categories where key = 'juros_recebidos')
where request_id = 'a2000000-0000-4000-8000-00000000a008'::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b016'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a008'::uuid),
    private.data_na_padaria() - 5, 85.00, 'pix', 'banco_sicredi_jc'
  ) $$,
  'pagamento atrasado a mais da cobranca de juros'
);

select is((select count(*)::int || '|' || sum(entry.amount) || '|' || min(category.key) from public.finance_entries entry
    join public.finance_categories category on category.id = entry.category_id
    where entry.source = 'contas_receber' and entry.entry_type = 'lancamento' and entry.reversed_at is null
      and entry.source_ref = (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b016'::uuid)),
  '1|85.00|juros_recebidos',
  'na mesma categoria, uma linha so com todo o dinheiro, sem colidir');

-- G: perfil sem permissão --------------------------------------------------

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

select throws_ok(
  $$ select public.receivable_excess_rule('a2000000-0000-4000-8000-00000000a003'::uuid) $$,
  '42501',
  'Sem permissão para registrar recebimentos.',
  'vendas nao consulta a regra do valor a mais'
);

reset role;

select * from finish();
rollback;
