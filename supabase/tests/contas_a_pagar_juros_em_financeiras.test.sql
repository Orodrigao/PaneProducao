-- Juros e multa de boleto não podem virar CMV.
--
-- O que este teste protege: o acréscimo pago acima do valor de face sai da
-- categoria da compra e vira despesa financeira, pesando no mês do PAGAMENTO
-- (o principal continua no mês da compra). O que sai do caixa não muda.
--
-- Os cenários vieram da revisão adversarial do Sol em 2026-08-19: ida e volta
-- da correção (com juro -> sem juro -> com juro), compra já classificada como
-- financeira (que colidiria com o índice único de lançamento ativo),
-- reclassificação depois do juro e repetição da baixa.

begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

-- Estrutura ----------------------------------------------------------------

select ok(exists(select 1 from public.finance_categories where key = 'financeiras'),
  'existe categoria de despesa financeira no catalogo do DRE');

select ok(
  (select pg_get_constraintdef(oid) ilike '%>= (0)%'
   from pg_constraint
   where conrelid = 'public.finance_entries'::regclass
     and conname = 'finance_entries_planned_amount_check'),
  'previsto zero e valido: ninguem planeja pagar juro');

-- Cenário ------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values (
  '94000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'financeiro-juros-test@example.com',
  '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values ('94000000-0000-4000-8000-000000000001', 'Teste Financeiro Juros', 'financeiro', 'jc', true, '["/financeiro"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values
  ('94000000-0000-4000-8000-000000000001', 'contas_pagar.acessar', 'jc', null),
  ('94000000-0000-4000-8000-000000000001', 'contas_pagar.baixar', 'jc', null),
  ('94000000-0000-4000-8000-000000000001', 'financeiro.acessar', '*', null),
  ('94000000-0000-4000-8000-000000000001', 'financeiro.lancar', '*', null),
  ('94000000-0000-4000-8000-000000000001', 'financeiro.estornar', '*', null);

insert into public.suppliers (id, name, active)
values ('94000000-0000-4000-8000-0000000000fa', '[TESTE] Laticinio Juros', true);

-- Compra de julho, parcela de 1.000 vencida em agosto.
insert into public.payable_purchases (
  id, request_id, store, supplier_id, purchase_date, origin, document_type,
  payment_method, status, total_value, created_by
) values (
  '94000000-0000-4000-8000-0000000000ca',
  '94000000-0000-4000-8000-0000000000aa',
  'jc', '94000000-0000-4000-8000-0000000000fa', date '2026-07-20', 'manual', 'sem_nota',
  'boleto', 'aberta', 1000.00, '94000000-0000-4000-8000-000000000001'
);

insert into public.payable_installments (
  id, purchase_id, installment_number, due_date, amount, status
) values (
  '94000000-0000-4000-8000-0000000000ea',
  '94000000-0000-4000-8000-0000000000ca',
  1, date '2026-08-05', 1000.00, 'pendente'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$ select public.set_payable_finance_classification(
    '94000000-0000-4000-8000-0000000000ca'::uuid, 'banco_sicredi_jc',
    '[{"category_key":"cmv_materia_prima","amount":1000}]'::jsonb
  ) $$,
  'conta classificada como materia-prima'
);

-- Pagou atrasado: 1.045,50 em 18/08 (45,50 de juros e multa).
select lives_ok(
  $$ select public.record_payable_installment_payment(
    '94000000-0000-4000-8000-0000000000ea'::uuid,
    date '2026-08-18', 1045.50, 'boleto', null
  ) $$,
  'financeiro baixa a parcela paga com atraso'
);

select is(
  (select round(sum(entry.amount), 2) from public.finance_entries entry
     join public.finance_categories category on category.id = entry.category_id
   where entry.source_ref = '94000000-0000-4000-8000-0000000000ea'::uuid
     and entry.entry_type = 'lancamento' and entry.reversed_at is null
     and category.key = 'cmv_materia_prima'),
  1000.00,
  'o CMV recebe so o valor de face do boleto, sem o juro'
);

select is(
  (select round(sum(entry.amount), 2) from public.finance_entries entry
     join public.finance_categories category on category.id = entry.category_id
   where entry.source_ref = '94000000-0000-4000-8000-0000000000ea'::uuid
     and entry.entry_type = 'lancamento' and entry.reversed_at is null
     and category.key = 'financeiras'),
  45.50,
  'o juro vira despesa financeira em linha propria'
);

select is(
  (select round(sum(amount), 2) from public.finance_entries
   where source_ref = '94000000-0000-4000-8000-0000000000ea'::uuid
     and entry_type = 'lancamento' and reversed_at is null),
  1045.50,
  'somadas, as duas linhas continuam sendo o valor que saiu do caixa'
);

select is(
  (select entry.competence_month from public.finance_entries entry
     join public.finance_categories category on category.id = entry.category_id
   where entry.source_ref = '94000000-0000-4000-8000-0000000000ea'::uuid
     and entry.entry_type = 'lancamento' and entry.reversed_at is null
     and category.key = 'cmv_materia_prima'),
  date '2026-07-01',
  'o principal pesa no mes da compra'
);

-- Juro e despesa do atraso, nao custo da mercadoria: pesa quando foi pago.
-- Se pesasse no mes da compra, uma baixa de agosto mudaria um julho ja fechado.
select is(
  (select entry.competence_month from public.finance_entries entry
     join public.finance_categories category on category.id = entry.category_id
   where entry.source_ref = '94000000-0000-4000-8000-0000000000ea'::uuid
     and entry.entry_type = 'lancamento' and entry.reversed_at is null
     and category.key = 'financeiras'),
  date '2026-08-01',
  'o juro pesa no mes do pagamento'
);

select is(
  (select entry.planned_amount from public.finance_entries entry
     join public.finance_categories category on category.id = entry.category_id
   where entry.source_ref = '94000000-0000-4000-8000-0000000000ea'::uuid
     and entry.entry_type = 'lancamento' and entry.reversed_at is null
     and category.key = 'financeiras'),
  0.00,
  'o juro nasce com previsto zero: nao estava no orcamento'
);

select ok(
  (select entry.description like 'Juros/multa%' from public.finance_entries entry
     join public.finance_categories category on category.id = entry.category_id
   where entry.source_ref = '94000000-0000-4000-8000-0000000000ea'::uuid
     and entry.entry_type = 'lancamento' and entry.reversed_at is null
     and category.key = 'financeiras'),
  'a linha do juro se identifica na descricao, nao so pela categoria'
);

-- Repetir a baixa nao duplica lancamento (toque duplo).
select throws_ok(
  $$ select public.record_payable_installment_payment(
    '94000000-0000-4000-8000-0000000000ea'::uuid,
    date '2026-08-18', 1045.50, 'boleto', null
  ) $$,
  '22023',
  'Parcela já paga. Use a correção da baixa.',
  'repetir a baixa da mesma parcela e recusado'
);

-- Ida e volta da correcao: com juro -> sem juro -------------------------------

select lives_ok(
  $$ select public.correct_payable_installment_payment(
    '94000000-0000-4000-8000-0000000000ea'::uuid,
    date '2026-08-18', 1000.00, 'boleto', null
  ) $$,
  'financeiro corrige a baixa para o valor de face'
);

select is(
  (select count(*)::int from public.finance_entries entry
     join public.finance_categories category on category.id = entry.category_id
   where entry.source_ref = '94000000-0000-4000-8000-0000000000ea'::uuid
     and entry.entry_type = 'lancamento' and entry.reversed_at is null
     and category.key = 'financeiras'),
  0,
  'corrigido para o valor de face, o juro deixa de existir'
);

-- ... e sem juro -> com juro de novo.
select lives_ok(
  $$ select public.correct_payable_installment_payment(
    '94000000-0000-4000-8000-0000000000ea'::uuid,
    date '2026-08-18', 1012.00, 'boleto', null
  ) $$,
  'financeiro corrige a baixa de volta para um valor com juro'
);

select is(
  (select round(sum(entry.amount), 2) from public.finance_entries entry
     join public.finance_categories category on category.id = entry.category_id
   where entry.source_ref = '94000000-0000-4000-8000-0000000000ea'::uuid
     and entry.entry_type = 'lancamento' and entry.reversed_at is null
     and category.key = 'financeiras'),
  12.00,
  'o juro volta a aparecer com o valor novo'
);

-- Cada lancamento recebe um unico estorno, mesmo apos duas correcoes.
select is(
  (select count(*)::int from public.finance_entries estorno
   where estorno.source_ref = '94000000-0000-4000-8000-0000000000ea'::uuid
     and estorno.entry_type = 'estorno'
     and estorno.reversal_of is not null),
  (select count(distinct estorno.reversal_of)::int from public.finance_entries estorno
   where estorno.source_ref = '94000000-0000-4000-8000-0000000000ea'::uuid
     and estorno.entry_type = 'estorno'),
  'nenhum lancamento recebe dois estornos'
);

-- Efeito liquido no caixa depois de duas correcoes: 1.012,00.
select is(
  (select round(sum(case when entry_type = 'estorno' then -amount else amount end), 2)
   from public.finance_entries
   where source_ref = '94000000-0000-4000-8000-0000000000ea'::uuid),
  1012.00,
  'somando estornos e lancamentos, sobra exatamente o ultimo valor pago'
);

-- Compra ja classificada como financeira ------------------------------------
-- Aqui principal e juro caem na mesma categoria. Sem consolidar, o indice
-- unico (origem, parcela, categoria) recusaria a segunda linha.

reset role;

insert into public.payable_purchases (
  id, request_id, store, supplier_id, purchase_date, origin, document_type,
  payment_method, status, total_value, created_by
) values (
  '94000000-0000-4000-8000-0000000000cb',
  '94000000-0000-4000-8000-0000000000ab',
  'jc', '94000000-0000-4000-8000-0000000000fa', date '2026-08-02', 'manual', 'sem_nota',
  'boleto', 'aberta', 200.00, '94000000-0000-4000-8000-000000000001'
);

insert into public.payable_installments (
  id, purchase_id, installment_number, due_date, amount, status
) values (
  '94000000-0000-4000-8000-0000000000eb',
  '94000000-0000-4000-8000-0000000000cb',
  1, date '2026-08-10', 200.00, 'pendente'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$ select public.set_payable_finance_classification(
    '94000000-0000-4000-8000-0000000000cb'::uuid, 'banco_sicredi_jc',
    '[{"category_key":"financeiras","amount":200}]'::jsonb
  ) $$,
  'conta classificada como despesa financeira'
);

select lives_ok(
  $$ select public.record_payable_installment_payment(
    '94000000-0000-4000-8000-0000000000eb'::uuid,
    date '2026-08-15', 215.00, 'boleto', null
  ) $$,
  'baixa de conta ja financeira, paga com juro, nao esbarra no indice unico'
);

select is(
  (select count(*)::int from public.finance_entries
   where source_ref = '94000000-0000-4000-8000-0000000000eb'::uuid
     and entry_type = 'lancamento' and reversed_at is null),
  1,
  'principal e juro na mesma categoria viram uma linha so'
);

select is(
  (select entry.amount - entry.planned_amount from public.finance_entries entry
   where entry.source_ref = '94000000-0000-4000-8000-0000000000eb'::uuid
     and entry.entry_type = 'lancamento' and entry.reversed_at is null),
  15.00,
  'mesmo consolidado, o juro continua legivel na diferenca previsto/realizado'
);

reset role;

select * from finish();
rollback;
