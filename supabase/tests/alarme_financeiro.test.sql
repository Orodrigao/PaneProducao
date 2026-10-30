begin;
create extension if not exists pgtap with schema extensions;

select plan(35);

-- Alarme do financeiro (fase A1 dentro da 1b). Datas fixas em novembro de
-- 2025, antes de qualquer linha do seed (que nasce com o carimbo do dia em que
-- roda): o instante de referencia so enxerga o que estas fixtures lancaram.
-- Calendario: 01/11 sabado, 02/11 domingo (Finados), 15/11 sabado (feriado),
-- 20/11 quinta (feriado da Consciencia Negra). Dia util: segunda a sexta.

-- Privilegio minimo: so o dono e o service_role.
select ok(not has_function_privilege('anon', 'private.alarme_financeiro(timestamptz)', 'execute'),
  'visitante sem login nao executa o alarme do financeiro');
select ok(not has_function_privilege('authenticated', 'private.alarme_financeiro(timestamptz)', 'execute'),
  'usuario autenticado nao executa o alarme do financeiro');
select ok(has_function_privilege('service_role', 'private.alarme_financeiro(timestamptz)', 'execute'),
  'o servico interno tem execucao do alarme do financeiro');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""']
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'alarme_financeiro'),
  'o alarme do financeiro roda como dono e com search_path vazio');

set local role authenticated;
select throws_ok(
  $$ select * from private.alarme_financeiro('2025-11-25 08:00-03') $$,
  '42501', null,
  'usuario autenticado e recusado ao chamar o alarme do financeiro');
reset role;

select throws_ok(
  $$ select * from private.alarme_financeiro(null) $$,
  '22004', 'Informe o instante de referencia do alarme do financeiro.',
  'instante nulo e recusado em vez de responder tudo em dia');

select is(
  (select array_agg(alarme.rotina || '/' || alarme.loja order by posicao)
    from private.alarme_financeiro('2025-10-15 08:00-03') with ordinality as alarme(rotina, loja, estado,
      ultimo_registro, faltas, datas_faltando, detalhe, posicao)),
  array['pj_liberacao/jc', 'recorrencia_pendente/geral', 'recebimento_parado/geral', 'parcela_vencida/jc'],
  'o alarme do financeiro devolve as 4 linhas na ordem fixa');
select is(
  (select count(*)::integer from private.alarme_financeiro('2025-10-15 08:00-03') where estado <> 'em_dia'),
  0,
  'antes de qualquer lancamento nenhum aviso acende');

-- Fixtures comuns.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values (
  '96400000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'alarme-financeiro-test@example.com', '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
  now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
);

insert into public.customers (id, name, payment_term_days, active)
values ('96400000-0000-4000-8000-0000000000c1', '[TESTE] Cliente Alarme Financeiro', 7, true);

insert into public.breads (id, name, days, active, unit, is_special, is_shelf)
values ('teste-alarme-financeiro', '[TESTE] Pao Alarme Financeiro', '{0,1,2,3,4,5,6}', true, 'un', false, false);

-- 1. Pedido PJ conferido e sem liberacao.
-- G1 conferido 12/11 (quarta) 15h, liberado 17/11 9h; G2 conferido e liberado
-- no mesmo dia; G3 conferido 10/11 e cancelado 11/11; G4 conferido 14/11
-- (sexta) 16h e nunca liberado.
insert into public.orders (id, store, order_type, order_group_id, bread_id, product_source, product_name,
  quantity, unit_price, pack_size, pricing_unit, customer_id, pj_client, order_date, delivery_date,
  pj_delivery_date, needs_production, cancelled_at, cancelled_by, cancel_reason)
select ('96400000-0000-4000-8000-' || lpad((100 + n)::text, 12, '0'))::uuid, 'pj', 'pj',
  ('96400000-0000-4000-8000-' || lpad((200 + n)::text, 12, '0'))::uuid, 'teste-alarme-financeiro', 'bread',
  '[TESTE] Pao Alarme Financeiro', 10, 5, 1, 'un', '96400000-0000-4000-8000-0000000000c1',
  '[TESTE] Cliente Alarme Financeiro', private.data_na_padaria(), private.data_na_padaria() + 2,
  private.data_na_padaria() + 2, false,
  case when n = 3 then timestamptz '2025-11-11 10:00-03' end,
  case when n = 3 then 'Teste alarme' end,
  case when n = 3 then 'Pedido cancelado no teste do alarme' end
from generate_series(1, 4) as n;

insert into private.pj_flow (order_group_id, version, checked_at, released_version, released_at)
values
  ('96400000-0000-4000-8000-000000000201', 2, '2025-11-12 15:00-03', 2, '2025-11-17 09:00-03'),
  ('96400000-0000-4000-8000-000000000202', 2, '2025-11-12 10:00-03', 2, '2025-11-12 11:00-03'),
  ('96400000-0000-4000-8000-000000000203', 1, '2025-11-10 09:00-03', null, null),
  ('96400000-0000-4000-8000-000000000204', 1, '2025-11-14 16:00-03', null, null);

select is(
  (select estado from private.alarme_financeiro('2025-11-13 08:00-03') where rotina = 'pj_liberacao'),
  'em_dia',
  'pedido conferido ontem ainda nao acende o aviso');
select is(
  (select row(estado, faltas, datas_faltando)::text from private.alarme_financeiro('2025-11-14 08:00-03')
    where rotina = 'pj_liberacao'),
  row('atrasada', 1, array['2025-11-12']::date[])::text,
  'pedido conferido ha 1 dia util inteiro acende; o cancelado nao conta');
select is(
  (select row(estado, faltas, datas_faltando)::text from private.alarme_financeiro('2025-11-17 08:00-03')
    where rotina = 'pj_liberacao'),
  row('atrasada', 1, array['2025-11-12']::date[])::text,
  'conferido na sexta nao acende na segunda: sabado feriado e domingo nao sao dia util');
select is(
  (select row(estado, faltas, datas_faltando, ultimo_registro)::text from private.alarme_financeiro('2025-11-18 08:00-03')
    where rotina = 'pj_liberacao'),
  row('atrasada', 1, array['2025-11-14']::date[], date '2025-11-17')::text,
  'liberado sai do aviso; o de sexta acende na terca; ultimo registro e a ultima liberacao');
select is(
  (select detalhe from private.alarme_financeiro('2025-11-18 08:00-03') where rotina = 'pj_liberacao'),
  'Pedidos PJ: 1 pedido conferido pela Expedição sem liberação há 1 dia útil ou mais (o mais antigo conferido em 14/11).',
  'o detalhe do pedido PJ diz quantos e desde quando');

-- 2. Conta recorrente. Cadastrada em 20/10 com vencimento dia 5 desde outubro:
-- o 05/10, anterior ao cadastro, nao e cobrado. Novembro vence 05/11 (quarta),
-- e confirmado em 11/11 15h e estornado em 13/11 10h.
insert into public.finance_recurring_rules (
  id, name, category_id, store, planned_amount, due_day, start_month,
  default_account_id, default_payment_method, created_by, created_at
) values (
  '96400000-0000-4000-8000-000000000301', '[TESTE] Aluguel alarme',
  (select id from public.finance_categories where key = 'ocupacao'), 'geral', 1000, 5, date '2025-10-01',
  (select id from public.finance_accounts where key = 'banco_sicredi_jc'), 'pix',
  '96400000-0000-4000-8000-000000000001', '2025-10-20 10:00-03'
);

select is(
  (select detalhe from private.alarme_financeiro('2025-10-15 08:00-03') where rotina = 'recorrencia_pendente'),
  'Contas recorrentes: nenhuma conta recorrente cadastrada; a vigia começa na primeira.',
  'antes do cadastro a vigia das recorrentes espera a primeira');

insert into public.finance_entries (
  request_id, entry_type, category_id, account_id, store, competence_month, due_date, planned_amount,
  paid_date, amount, payment_method, description, source, source_ref, recurrence_month, created_by, created_at,
  reversed_at, reversed_by, reversal_reason
) values (
  '96400000-0000-4000-8000-000000000311', 'lancamento',
  (select id from public.finance_categories where key = 'ocupacao'),
  (select id from public.finance_accounts where key = 'banco_sicredi_jc'),
  'geral', date '2025-11-01', date '2025-11-05', 1000, date '2025-11-11', 1000, 'pix',
  '[TESTE] Aluguel alarme novembro', 'recorrencia', '96400000-0000-4000-8000-000000000301', date '2025-11-01',
  '96400000-0000-4000-8000-000000000001', '2025-11-11 15:00-03',
  '2025-11-13 10:00-03', '96400000-0000-4000-8000-000000000001', 'Estorno do teste do alarme'
);

select is(
  (select estado from private.alarme_financeiro('2025-11-10 08:00-03') where rotina = 'recorrencia_pendente'),
  'em_dia',
  'dois dias uteis depois do vencimento a recorrente ainda nao acende');
select is(
  (select row(estado, faltas, datas_faltando, detalhe)::text from private.alarme_financeiro('2025-11-11 08:00-03')
    where rotina = 'recorrencia_pendente'),
  row('atrasada', 1, array['2025-11-05']::date[],
    'Contas recorrentes: 1 vencida há 3 dias úteis ou mais sem confirmação ([TESTE] Aluguel alarme, venceu em 05/11).')::text,
  'tres dias uteis sem confirmacao acendem, so com o mes cadastrado');
select is(
  (select row(estado, ultimo_registro)::text from private.alarme_financeiro('2025-11-12 08:00-03')
    where rotina = 'recorrencia_pendente'),
  row('em_dia', date '2025-11-11')::text,
  'a confirmacao do mes apaga o aviso');
select is(
  (select estado from private.alarme_financeiro('2025-11-14 08:00-03') where rotina = 'recorrencia_pendente'),
  'atrasada',
  'confirmacao estornada volta a contar como pendente');

-- 3. Recebimentos. K0 (R$ 50, vence 04/11) quitada em 06/11; K1 (R$ 100,
-- vence 14/11) com R$ 40 em 07/11 e R$ 60 em 17/11 11h, estornados em 18/11 10h.
insert into public.receivables (
  id, request_id, customer_id, origin, finance_category_id, description,
  invoice_date, original_due_date, due_date, amount, created_by, created_at
)
select fixture.id, fixture.request_id, '96400000-0000-4000-8000-0000000000c1', 'avulso',
  (select id from public.finance_categories where key = 'clientes_pj'), fixture.description,
  date '2025-11-01', fixture.due_date, fixture.due_date, fixture.amount,
  '96400000-0000-4000-8000-000000000001', '2025-11-01 10:00-03'
from (values
  ('96400000-0000-4000-8000-000000000400'::uuid, '96400000-0000-4000-8000-000000000410'::uuid, date '2025-11-04', 50::numeric, '[TESTE] Cobranca alarme K0'),
  ('96400000-0000-4000-8000-000000000401'::uuid, '96400000-0000-4000-8000-000000000411'::uuid, date '2025-11-14', 100::numeric, '[TESTE] Cobranca alarme K1')
) as fixture(id, request_id, due_date, amount, description);

insert into public.receivable_receipts (
  id, request_id, receivable_id, received_date, amount, method, account_id, created_by, created_at,
  reversed_at, reversed_by, reversal_reason
)
select fixture.id, fixture.request_id, fixture.receivable_id, fixture.received_date, fixture.amount, 'pix',
  (select id from public.finance_accounts where key = 'banco_sicredi_jc'),
  '96400000-0000-4000-8000-000000000001', fixture.created_at,
  fixture.reversed_at, case when fixture.reversed_at is not null then '96400000-0000-4000-8000-000000000001'::uuid end,
  case when fixture.reversed_at is not null then 'Estorno do teste do alarme' end
from (values
  ('96400000-0000-4000-8000-000000000420'::uuid, '96400000-0000-4000-8000-000000000430'::uuid,
    '96400000-0000-4000-8000-000000000400'::uuid, date '2025-11-06', 50::numeric, timestamptz '2025-11-06 10:00-03', null::timestamptz),
  ('96400000-0000-4000-8000-000000000421'::uuid, '96400000-0000-4000-8000-000000000431'::uuid,
    '96400000-0000-4000-8000-000000000401'::uuid, date '2025-11-07', 40::numeric, timestamptz '2025-11-07 10:00-03', null::timestamptz),
  ('96400000-0000-4000-8000-000000000422'::uuid, '96400000-0000-4000-8000-000000000432'::uuid,
    '96400000-0000-4000-8000-000000000401'::uuid, date '2025-11-17', 60::numeric, timestamptz '2025-11-17 11:00-03', timestamptz '2025-11-18 10:00-03')
) as fixture(id, request_id, receivable_id, received_date, amount, created_at, reversed_at);

select is(
  (select row(estado, detalhe)::text from private.alarme_financeiro('2025-10-15 08:00-03')
    where rotina = 'recebimento_parado'),
  row('em_dia', 'Recebimentos: nenhuma cobrança nem recebimento registrado ainda; a vigia começa na primeira cobrança.')::text,
  'antes da primeira cobranca a vigia de recebimentos espera');
select is(
  (select row(estado, faltas, ultimo_registro, detalhe)::text from private.alarme_financeiro('2025-11-06 08:00-03')
    where rotina = 'recebimento_parado'),
  row('atrasada', 3, null::date,
    'Recebimentos: nenhum recebimento desde a primeira cobrança, lançada em 01/11; 3 dias úteis sem nenhum (alarme a partir de 3); 1 cobrança vencida em aberto, R$ 50,00 (a mais antiga venceu em 04/11).')::text,
  'sem nenhum recebimento ainda, a contagem parte da primeira cobranca e acende com cobranca vencida');
select is(
  (select row(estado, faltas, detalhe)::text from private.alarme_financeiro('2025-11-13 08:00-03')
    where rotina = 'recebimento_parado'),
  row('em_dia', 3,
    'Recebimentos: último registrado em 07/11, 3 dias úteis sem nenhum (alarme a partir de 3); nenhuma cobrança vencida em aberto.')::text,
  'tres dias uteis sem recebimento nao acendem quando nao ha cobranca vencida em aberto');
select is(
  (select row(estado, faltas, detalhe)::text from private.alarme_financeiro('2025-11-17 08:00-03')
    where rotina = 'recebimento_parado'),
  row('atrasada', 5,
    'Recebimentos: último registrado em 07/11, 5 dias úteis sem nenhum (alarme a partir de 3); 1 cobrança vencida em aberto, R$ 60,00 (a mais antiga venceu em 14/11).')::text,
  'dias uteis sem recebimento com cobranca vencida em aberto acendem, com o saldo que falta');
select is(
  (select row(estado, faltas, detalhe)::text from private.alarme_financeiro('2025-11-18 08:00-03')
    where rotina = 'recebimento_parado'),
  row('em_dia', 0,
    'Recebimentos: houve recebimento registrado no último dia útil; nenhuma cobrança vencida em aberto.')::text,
  'o recebimento registrado apaga o aviso e quita o saldo');
select is(
  (select row(estado, faltas, ultimo_registro)::text from private.alarme_financeiro('2025-11-19 08:00-03')
    where rotina = 'recebimento_parado'),
  row('atrasada', 7, date '2025-11-07')::text,
  'recebimento estornado deixa de contar e o aviso volta');

-- 4. Parcelas da JC. Compra aberta com I1 (vence 07/11 sexta), I2 (08/11
-- sabado, vale segunda 10/11), I3 (10/11, paga 10/11 15h), I4 (14/11
-- renegociada para 19/11) e I5 (05/11, paga 12/11 10h). I1 e I2 pagas 13/11
-- 15h. Compra cancelada em 02/11 com parcela de 03/11 (cancelada junto) que nao conta.
insert into public.payable_purchases (
  id, request_id, store, purchase_date, origin, document_type, payment_method,
  status, total_value, created_by, created_at, cancelled_at, cancelled_by, cancel_reason
) values
  ('96400000-0000-4000-8000-000000000501', '96400000-0000-4000-8000-000000000511', 'jc', date '2025-11-01',
    'manual', 'sem_nota', 'boleto', 'aberta', 1500, '96400000-0000-4000-8000-000000000001',
    '2025-11-01 10:00-03', null, null, null),
  ('96400000-0000-4000-8000-000000000502', '96400000-0000-4000-8000-000000000512', 'jc', date '2025-11-01',
    'manual', 'sem_nota', 'boleto', 'cancelada', 900, '96400000-0000-4000-8000-000000000001',
    '2025-11-01 10:00-03', '2025-11-02 10:00-03', '96400000-0000-4000-8000-000000000001', 'Compra cancelada no teste do alarme');

insert into public.payable_installments (
  purchase_id, installment_number, due_date, current_due_date, amount, status,
  paid_at, paid_by, paid_date, paid_amount, paid_method
) values
  ('96400000-0000-4000-8000-000000000501', 1, date '2025-11-07', null, 100, 'paga',
    '2025-11-13 15:00-03', '96400000-0000-4000-8000-000000000001', date '2025-11-13', 100, 'pix'),
  ('96400000-0000-4000-8000-000000000501', 2, date '2025-11-08', null, 200, 'paga',
    '2025-11-13 15:00-03', '96400000-0000-4000-8000-000000000001', date '2025-11-13', 200, 'pix'),
  ('96400000-0000-4000-8000-000000000501', 3, date '2025-11-10', null, 300, 'paga',
    '2025-11-10 15:00-03', '96400000-0000-4000-8000-000000000001', date '2025-11-10', 300, 'pix'),
  ('96400000-0000-4000-8000-000000000501', 4, date '2025-11-14', date '2025-11-19', 400, 'pendente',
    null, null, null, null, null),
  ('96400000-0000-4000-8000-000000000501', 5, date '2025-11-05', null, 500, 'paga',
    '2025-11-12 10:00-03', '96400000-0000-4000-8000-000000000001', date '2025-11-12', 500, 'pix'),
  ('96400000-0000-4000-8000-000000000502', 1, date '2025-11-03', null, 900, 'cancelada',
    null, null, null, null, null);

select is(
  (select row(estado, detalhe)::text from private.alarme_financeiro('2025-11-03 08:00-03') where rotina = 'parcela_vencida'),
  row('em_dia', 'Parcelas a pagar da JC: nenhuma vencida sem baixa; nada vence até 04/11.')::text,
  'parcela de compra cancelada nao conta nem como a pagar');
select is(
  (select row(estado, faltas, datas_faltando, detalhe)::text from private.alarme_financeiro('2025-11-07 08:00-03')
    where rotina = 'parcela_vencida'),
  row('atrasada', 1, array['2025-11-05']::date[],
    'Parcelas a pagar da JC: 1 vencida sem baixa, a mais antiga de 05/11, R$ 500,00; vencem até 10/11: 3, R$ 600,00.')::text,
  'parcela acende no primeiro dia util de atraso e a linha lista o que vence ate o proximo dia util');
select is(
  (select row(faltas, detalhe)::text from private.alarme_financeiro('2025-11-08 08:00-03') where rotina = 'parcela_vencida'),
  row(1, 'Parcelas a pagar da JC: 1 vencida sem baixa, a mais antiga de 05/11, R$ 500,00; vencem até 10/11: 3, R$ 600,00.')::text,
  'vencida na sexta ainda nao acende no sabado: aparece entre as que vencem ate segunda');
select is(
  (select row(faltas, datas_faltando, detalhe)::text from private.alarme_financeiro('2025-11-10 08:00-03')
    where rotina = 'parcela_vencida'),
  row(2, array['2025-11-05', '2025-11-07']::date[],
    'Parcelas a pagar da JC: 2 vencidas sem baixa, a mais antiga de 05/11, R$ 600,00; vencem até 11/11: 2, R$ 500,00.')::text,
  'na segunda acende a de sexta; a de sabado vale segunda e fica entre as a pagar');
select is(
  (select row(faltas, datas_faltando, detalhe)::text from private.alarme_financeiro('2025-11-11 08:00-03')
    where rotina = 'parcela_vencida'),
  row(3, array['2025-11-05', '2025-11-07', '2025-11-08']::date[],
    'Parcelas a pagar da JC: 3 vencidas sem baixa, a mais antiga de 05/11, R$ 800,00; nada vence até 12/11.')::text,
  'a de sabado acende na terca; a paga no proprio vencimento nunca acende');
select is(
  (select row(faltas, ultimo_registro)::text from private.alarme_financeiro('2025-11-12 08:00-03') where rotina = 'parcela_vencida'),
  row(3, date '2025-11-10')::text,
  'paga mais tarde no dia ainda conta como vencida as 8h; ultimo registro e a ultima baixa');
select is(
  (select row(faltas, datas_faltando)::text from private.alarme_financeiro('2025-11-13 08:00-03') where rotina = 'parcela_vencida'),
  row(2, array['2025-11-07', '2025-11-08']::date[])::text,
  'a parcela paga sai da lista de vencidas');
select is(
  (select row(estado, faltas, ultimo_registro, detalhe)::text from private.alarme_financeiro('2025-11-19 08:00-03')
    where rotina = 'parcela_vencida'),
  row('informativo', 0, date '2025-11-13',
    'Parcelas a pagar da JC: nenhuma vencida sem baixa; vencem até 21/11: 1, R$ 400,00.')::text,
  'sem vencida, a que vence hoje fica como informativo e vale o vencimento renegociado; feriado de 20/11 pula');

-- Reconstrucao do passado. P3 vence 24/11 e a compra e cancelada em 27/11
-- (a parcela vira cancelada junto, como faz cancel_manual_payable); P4 vence
-- 24/11, tem a primeira baixa registrada em 24/11 15h e a correcao da baixa
-- regravou paid_at para 27/11 10h.
insert into public.payable_purchases (
  id, request_id, store, purchase_date, origin, document_type, payment_method,
  status, total_value, created_by, created_at, cancelled_at, cancelled_by, cancel_reason
) values
  ('96400000-0000-4000-8000-000000000503', '96400000-0000-4000-8000-000000000513', 'jc', date '2025-11-01',
    'manual', 'sem_nota', 'boleto', 'cancelada', 700, '96400000-0000-4000-8000-000000000001',
    '2025-11-01 10:00-03', '2025-11-27 10:00-03', '96400000-0000-4000-8000-000000000001', 'Compra cancelada depois no teste do alarme'),
  ('96400000-0000-4000-8000-000000000504', '96400000-0000-4000-8000-000000000514', 'jc', date '2025-11-01',
    'manual', 'sem_nota', 'boleto', 'aberta', 800, '96400000-0000-4000-8000-000000000001',
    '2025-11-01 10:00-03', null, null, null);

insert into public.payable_installments (
  id, purchase_id, installment_number, due_date, current_due_date, amount, status,
  paid_at, paid_by, paid_date, paid_amount, paid_method
) values
  ('96400000-0000-4000-8000-000000000603', '96400000-0000-4000-8000-000000000503', 1, date '2025-11-24', null, 700,
    'cancelada', null, null, null, null, null),
  ('96400000-0000-4000-8000-000000000604', '96400000-0000-4000-8000-000000000504', 1, date '2025-11-24', null, 800,
    'paga', '2025-11-27 10:00-03', '96400000-0000-4000-8000-000000000001', date '2025-11-24', 800, 'pix');

insert into public.payable_events (purchase_id, event_type, details, occurred_by, occurred_at)
values ('96400000-0000-4000-8000-000000000504', 'baixada',
  '{"installment_id": "96400000-0000-4000-8000-000000000604", "paid_date": "2025-11-24", "paid_amount": 800, "paid_method": "pix"}'::jsonb,
  '96400000-0000-4000-8000-000000000001', '2025-11-24 15:00-03');

select is(
  (select row(faltas, datas_faltando, detalhe)::text from private.alarme_financeiro('2025-11-26 08:00-03')
    where rotina = 'parcela_vencida'),
  row(2, array['2025-11-19', '2025-11-24']::date[],
    'Parcelas a pagar da JC: 2 vencidas sem baixa, a mais antiga de 19/11, R$ 1.100,00; nada vence até 27/11.')::text,
  'no passado conta a parcela da compra cancelada depois e nao conta a baixa corrigida depois');
select is(
  (select row(faltas, datas_faltando)::text from private.alarme_financeiro('2025-11-28 08:00-03')
    where rotina = 'parcela_vencida'),
  row(1, array['2025-11-19']::date[])::text,
  'depois do cancelamento a parcela cancelada sai da conta');

select is(
  (select count(*)::integer from private.alarme_financeiro('2025-11-19 08:00-03')),
  4,
  'com todas as fixtures o alarme do financeiro continua com 4 linhas');

select * from finish();
rollback;
