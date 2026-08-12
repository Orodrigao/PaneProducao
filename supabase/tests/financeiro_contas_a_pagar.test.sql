-- Fase 1 do Financeiro: a baixa de uma conta a pagar alimenta o livro-caixa.
--
-- O que este teste protege: o valor lançado tem de bater exatamente com o
-- valor pago, a despesa tem de pesar no mês da compra (não no do pagamento),
-- e corrigir uma baixa não pode apagar história.

begin;
create extension if not exists pgtap with schema extensions;

select plan(21);

-- Estrutura --------------------------------------------------------------

select ok(exists(select 1 from public.finance_categories where key = 'nao_classificado'),
  'existe gaveta visivel para o que ainda nao foi classificado');
select ok(exists(select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'finance_entries' and column_name = 'source_ref'),
  'o lancamento guarda a origem que o gerou');
select ok(exists(select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'finance_entries_origem_ativa_idx'),
  'um lancamento ativo por origem e categoria');
select ok(not has_table_privilege('authenticated', 'public.payable_purchase_categories', 'insert'),
  'ninguem escreve o rateio direto na tabela');

-- Cenário ------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  (
    '93000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'financeiro-fase1-test@example.com',
    '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
  ),
  (
    '93000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'vendas-fase1-test@example.com',
    '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
  );

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('93000000-0000-4000-8000-000000000001', 'Teste Financeiro Fase 1', 'financeiro', 'jc', true, '["/financeiro"]'::jsonb),
  ('93000000-0000-4000-8000-000000000002', 'Teste Vendas Fase 1', 'vendas', 'ja', true, '["/romaneio"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values
  ('93000000-0000-4000-8000-000000000001', 'contas_pagar.acessar', 'jc', null),
  ('93000000-0000-4000-8000-000000000001', 'contas_pagar.baixar', 'jc', null),
  ('93000000-0000-4000-8000-000000000001', 'financeiro.acessar', '*', null),
  ('93000000-0000-4000-8000-000000000001', 'financeiro.lancar', '*', null),
  ('93000000-0000-4000-8000-000000000001', 'financeiro.estornar', '*', null);

insert into public.suppliers (id, name, active)
values ('93000000-0000-4000-8000-0000000000f1', '[TESTE] Moinho Fase 1', true);

-- Compra de 28/07 (competência julho), paga em agosto, uma parcela.
insert into public.payable_purchases (
  id, request_id, store, supplier_id, purchase_date, origin, document_type,
  payment_method, status, total_value, created_by
) values (
  '93000000-0000-4000-8000-0000000000c1',
  '93000000-0000-4000-8000-0000000000a1',
  'jc', '93000000-0000-4000-8000-0000000000f1', date '2026-07-28', 'manual', 'sem_nota',
  'boleto', 'aberta', 1000.00, '93000000-0000-4000-8000-000000000001'
);

insert into public.payable_installments (
  id, purchase_id, installment_number, due_date, amount, status
) values (
  '93000000-0000-4000-8000-0000000000e1',
  '93000000-0000-4000-8000-0000000000c1',
  1, date '2026-08-10', 1000.00, 'pendente'
);

-- Perfil sem permissão -----------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000002', true);

select throws_ok(
  $$ select public.set_payable_finance_classification(
    '93000000-0000-4000-8000-0000000000c1'::uuid, 'banco_sicredi_jc',
    '[{"category_key":"cmv_materia_prima","amount":1000}]'::jsonb
  ) $$,
  '42501',
  'Sem permissão para classificar contas da JC.',
  'perfil sem permissao nao classifica conta'
);

reset role;

-- Classificação e baixa ----------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$ select public.set_payable_finance_classification(
    '93000000-0000-4000-8000-0000000000c1'::uuid, 'banco_sicredi_jc',
    '[{"category_key":"cmv_materia_prima","amount":700}]'::jsonb
  ) $$,
  '22023',
  'A soma do rateio precisa ser igual ao total da conta.',
  'rateio que nao fecha com o total e recusado'
);

select throws_ok(
  $$ select public.set_payable_finance_classification(
    '93000000-0000-4000-8000-0000000000c1'::uuid, 'banco_sicredi_jc',
    '[{"category_key":"cmv_materia_prima","amount":250},
      {"category_key":"cmv_embalagem","amount":250},
      {"category_key":"cmv_revenda","amount":250},
      {"category_key":"manutencao","amount":250}]'::jsonb
  ) $$,
  '22023',
  'No máximo três categorias por conta.',
  'rateio em quatro categorias e recusado'
);

select lives_ok(
  $$ select public.set_payable_finance_classification(
    '93000000-0000-4000-8000-0000000000c1'::uuid, 'banco_sicredi_jc',
    '[{"category_key":"cmv_materia_prima","amount":700},
      {"category_key":"cmv_embalagem","amount":300}]'::jsonb
  ) $$,
  'rateio 700/300 que fecha com o total e aceito'
);

-- Pagou 1.020 (20 de juros) em 12/08.
select lives_ok(
  $$ select public.record_payable_installment_payment(
    '93000000-0000-4000-8000-0000000000e1'::uuid,
    date '2026-08-12', 1020.00, 'boleto', null
  ) $$,
  'financeiro baixa a parcela'
);

select is((select count(*)::int from public.finance_entries
    where source = 'contas_pagar' and source_ref = '93000000-0000-4000-8000-0000000000e1'::uuid
      and entry_type = 'lancamento' and reversed_at is null), 2,
  'o rateio em duas categorias gera dois lancamentos');

select is((select sum(amount) from public.finance_entries
    where source = 'contas_pagar' and source_ref = '93000000-0000-4000-8000-0000000000e1'::uuid
      and entry_type = 'lancamento' and reversed_at is null), 1020.00,
  'a soma dos lancamentos bate exatamente com o valor pago');

select is((select distinct competence_month from public.finance_entries
    where source = 'contas_pagar' and source_ref = '93000000-0000-4000-8000-0000000000e1'::uuid
      and entry_type = 'lancamento' and reversed_at is null), date '2026-07-01',
  'a compra de julho paga em agosto pesa em julho');

select is((select distinct paid_date from public.finance_entries
    where source = 'contas_pagar' and source_ref = '93000000-0000-4000-8000-0000000000e1'::uuid
      and entry_type = 'lancamento' and reversed_at is null), date '2026-08-12',
  'a data real do lancamento e o dia em que o dinheiro saiu');

select ok((select sum(planned_amount) < sum(amount) from public.finance_entries
    where source = 'contas_pagar' and source_ref = '93000000-0000-4000-8000-0000000000e1'::uuid
      and entry_type = 'lancamento' and reversed_at is null),
  'o previsto fica abaixo do realizado: a diferenca e o juro pago');

select is((select count(distinct account_id)::int from public.finance_entries
    where source = 'contas_pagar' and source_ref = '93000000-0000-4000-8000-0000000000e1'::uuid
      and entry_type = 'lancamento' and reversed_at is null and account_id is not null), 1,
  'os lancamentos sabem de qual conta o dinheiro saiu');

-- Correção da baixa --------------------------------------------------------

select lives_ok(
  $$ select public.correct_payable_installment_payment(
    '93000000-0000-4000-8000-0000000000e1'::uuid,
    date '2026-08-12', 1000.00, 'pix', null
  ) $$,
  'financeiro corrige a baixa'
);

select is((select count(*)::int from public.finance_entries
    where source_ref = '93000000-0000-4000-8000-0000000000e1'::uuid and entry_type = 'estorno'), 2,
  'a correcao estorna os lancamentos antigos em vez de apaga-los');

select is((select count(*)::int from public.finance_entries
    where source_ref = '93000000-0000-4000-8000-0000000000e1'::uuid
      and entry_type = 'lancamento' and reversed_at is null), 2,
  'a correcao deixa dois lancamentos ativos');

select is((select sum(amount) from public.finance_entries
    where source_ref = '93000000-0000-4000-8000-0000000000e1'::uuid
      and entry_type = 'lancamento' and reversed_at is null), 1000.00,
  'os lancamentos ativos somam o valor corrigido');

-- Efeito liquido no caixa: 1020 - 1020 (estorno) + 1000 = 1000.
select is((select sum(case when entry_type = 'estorno' then -amount else amount end)
    from public.finance_entries
    where source_ref = '93000000-0000-4000-8000-0000000000e1'::uuid), 1000.00,
  'somando estornos e lancamentos, a conta liquida e o valor corrigido');

-- Conta sem classificação ---------------------------------------------------

insert into public.payable_purchases (
  id, request_id, store, supplier_id, purchase_date, origin, document_type,
  payment_method, status, total_value, created_by
) values (
  '93000000-0000-4000-8000-0000000000c2',
  '93000000-0000-4000-8000-0000000000a2',
  'jc', '93000000-0000-4000-8000-0000000000f1', date '2026-08-01', 'manual', 'sem_nota',
  'dinheiro', 'aberta', 80.00, '93000000-0000-4000-8000-000000000001'
);
insert into public.payable_installments (
  id, purchase_id, installment_number, due_date, amount, status
) values (
  '93000000-0000-4000-8000-0000000000e2',
  '93000000-0000-4000-8000-0000000000c2',
  1, date '2026-08-01', 80.00, 'pendente'
);

select lives_ok(
  $$ select public.record_payable_installment_payment(
    '93000000-0000-4000-8000-0000000000e2'::uuid,
    date '2026-08-01', 80.00, 'dinheiro', null
  ) $$,
  'conta sem classificacao tambem pode ser baixada'
);

select is((select category.key from public.finance_entries entry
    join public.finance_categories category on category.id = entry.category_id
    where entry.source_ref = '93000000-0000-4000-8000-0000000000e2'::uuid
      and entry.entry_type = 'lancamento'), 'nao_classificado',
  'sem classificacao a despesa entra visivel como nao classificada, nunca fora do DRE');

-- Reclassificação -----------------------------------------------------------

select lives_ok(
  $$ select public.reclassify_payable_finance_entries(
    '93000000-0000-4000-8000-0000000000c2'::uuid, 'caixa_fisico_jc',
    '[{"category_key":"manutencao","amount":80}]'::jsonb,
    'era conserto do forno, nao mercadoria'
  ) $$,
  'financeiro reclassifica uma conta ja paga'
);

select is((select category.key from public.finance_entries entry
    join public.finance_categories category on category.id = entry.category_id
    where entry.source_ref = '93000000-0000-4000-8000-0000000000e2'::uuid
      and entry.entry_type = 'lancamento' and entry.reversed_at is null), 'manutencao',
  'depois da reclassificacao o lancamento ativo esta na categoria certa');

select is((select sum(case when entry_type = 'estorno' then -amount else amount end)
    from public.finance_entries
    where source_ref = '93000000-0000-4000-8000-0000000000e2'::uuid), 80.00,
  'reclassificar nao muda o total do mes, so a gaveta');

reset role;

select * from finish();
rollback;
