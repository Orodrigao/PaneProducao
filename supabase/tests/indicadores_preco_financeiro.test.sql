begin;
create extension if not exists pgtap with schema extensions;

select plan(34);

-- O banco Preview recebe o seed geral antes do pgTAP. Retire as mesmas
-- fixtures financeiras do relatório dentro desta transação; o rollback no
-- fim preserva os dados de seed para a chamada de verificação do Preview.
delete from public.finance_entries
where id::text like '96400000-0000-4000-8000-000000000%'
   or (
     source = 'contas_receber'
     and source_ref in (
       '96400000-0000-4000-8000-000000000501'::uuid,
       '96400000-0000-4000-8000-000000000502'::uuid
     )
   );

delete from public.receivable_receipts
where id in (
  '96400000-0000-4000-8000-000000000501'::uuid,
  '96400000-0000-4000-8000-000000000502'::uuid
);

delete from public.receivables
where id in (
  '96400000-0000-4000-8000-000000000301'::uuid,
  '96400000-0000-4000-8000-000000000302'::uuid
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('96300000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'indicadores-admin@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false),
  ('96300000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'indicadores-financeiro@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false),
  ('96300000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'indicadores-compras@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false),
  ('96300000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'indicadores-producao@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('96300000-0000-4000-8000-000000000001', 'Admin Indicadores Teste', 'admin', null, true, '[]'),
  ('96300000-0000-4000-8000-000000000002', 'Financeiro Indicadores Teste', 'financeiro', 'jc', true, '[]'),
  ('96300000-0000-4000-8000-000000000003', 'Compras Indicadores Teste', 'compras', 'jc', true, '[]'),
  ('96300000-0000-4000-8000-000000000004', 'Producao Indicadores Teste', 'producao', 'jc', true, '[]');

insert into public.finance_accounts (id, key, label, kind, active)
values ('96300000-0000-4000-8000-0000000000a1', 'indicadores_teste', '[TESTE] Indicadores de preço', 'banco', true)
on conflict (id) do nothing;

-- O peso vem da ficha técnica (passos 0c e 0d da formação de preço). O peso
-- médio do cadastro de pães fica preenchido com números errados de propósito:
-- se o relatório voltar a lê-lo, setembro passa de 31 kg e de 62% de cobertura.
insert into public.breads (id, name, days, active, unit, is_special, is_shelf, avg_unit_weight_kg)
values
  ('indicadores-peso', '[TESTE] Indicadores pão pesado', '{0,1,2,3,4,5,6}', true, 'un', false, false, 0.9),
  ('indicadores-sem-peso', '[TESTE] Indicadores pão sem peso', '{0,1,2,3,4,5,6}', true, 'un', false, false, 0.7),
  ('indicadores-brioche', '[TESTE] Indicadores Brioche Hamburguer', '{0,1,2,3,4,5,6}', true, 'un', false, false, 0.06)
on conflict (id) do update set avg_unit_weight_kg = excluded.avg_unit_weight_kg;

insert into public.products (id, name, category, active, unit, kind, is_fabricacao_propria, legacy_bread_id)
values
  ('96300000-0000-4000-8000-0000000007a1', '[TESTE] Indicadores pão pesado', 'Paes', true, 'un', 'final', true, 'indicadores-peso'),
  ('96300000-0000-4000-8000-0000000007a2', '[TESTE] Indicadores pão sem peso', 'Paes', true, 'un', 'final', true, 'indicadores-sem-peso'),
  ('96300000-0000-4000-8000-0000000007a3', '[TESTE] Indicadores Brioche', 'Paes', true, 'un', 'final', true, 'indicadores-brioche'),
  ('96300000-0000-4000-8000-0000000007a4', '[TESTE] Indicadores pão por quilo', 'Paes', true, 'kg', 'final', true, null),
  ('96300000-0000-4000-8000-0000000007a5', '[TESTE] Indicadores quilo sem assado', 'Paes', true, 'kg', 'final', true, null);

insert into public.product_variants (id, product_id, name, sort_order)
values
  ('96300000-0000-4000-8000-0000000007b1', '96300000-0000-4000-8000-0000000007a3', 'Hambúrguer', 1),
  ('96300000-0000-4000-8000-0000000007b2', '96300000-0000-4000-8000-0000000007a3', 'Forma', 2);

update public.breads
set product_variant_id = '96300000-0000-4000-8000-0000000007b1'
where id = 'indicadores-brioche';

-- Pão pesado: 500 g de massa crua e 450 g assado por unidade. A mão de obra é
-- por quilo de massa crua, então 62 unidades valem 31 kg, não 27,9 kg.
-- Brioche: a linha do produto (85 g) não vale para o pão, que é a variante
-- Hambúrguer (80 g). Pão por quilo: 1,1 kg de massa para 1 kg assado. Quilo
-- sem assado: a ficha só tem massa, então o quilo pronto lançado não tem como
-- virar massa crua e fica fora da cobertura.
insert into public.product_recipe_yields (product_id, product_variant_id, basis, dough_weight_kg, finished_weight_kg, yield_units)
values
  ('96300000-0000-4000-8000-0000000007a1', null, 'dough', 1.0, 0.9, 2),
  ('96300000-0000-4000-8000-0000000007a3', null, 'dough', 0.85, 0.85, 10),
  ('96300000-0000-4000-8000-0000000007a3', '96300000-0000-4000-8000-0000000007b1', 'dough', 0.8, 0.72, 10),
  ('96300000-0000-4000-8000-0000000007a3', '96300000-0000-4000-8000-0000000007b2', 'dough', 0.8, 0.8, 2),
  ('96300000-0000-4000-8000-0000000007a4', null, 'dough', 1.1, 1.0, 1),
  ('96300000-0000-4000-8000-0000000007a5', null, 'dough', 1.0, 1.0, 1);

-- Cada mês usa lançamentos fictícios próprios. Setembro representa cobertura
-- de peso parcial, um fechamento JA ausente e encargos/diárias sem equipe.
insert into public.finance_entries (
  id, request_id, entry_type, category_id, account_id, store, competence_month,
  due_date, planned_amount, paid_date, amount, payment_method, description,
  source, created_by
)
select fixture.id, fixture.request_id, 'lancamento', category.id,
  '96300000-0000-4000-8000-0000000000a1', fixture.store, fixture.month_start,
  fixture.month_start, fixture.amount, fixture.month_start, fixture.amount,
  'outro', fixture.description, 'avulso', '96300000-0000-4000-8000-000000000001'
from (values
  ('96300000-0000-4000-8000-000000000101'::uuid, '96300000-0000-4000-8000-000000000201'::uuid, date '2026-09-01', 'jc', 'clientes_pj', 2000::numeric, '[TESTE] Receita PJ setembro'),
  ('96300000-0000-4000-8000-000000000103'::uuid, '96300000-0000-4000-8000-000000000203'::uuid, date '2026-09-01', 'geral', 'ocupacao', 1000::numeric, '[TESTE] Ocupação setembro'),
  ('96300000-0000-4000-8000-000000000104'::uuid, '96300000-0000-4000-8000-000000000204'::uuid, date '2026-09-01', 'jc', 'mao_obra_balcao_jc', 200::numeric, '[TESTE] Balcão setembro'),
  ('96300000-0000-4000-8000-000000000105'::uuid, '96300000-0000-4000-8000-000000000205'::uuid, date '2026-09-01', 'geral', 'mao_obra_encargos', 100::numeric, '[TESTE] Encargos sem equipe setembro'),
  ('96300000-0000-4000-8000-000000000106'::uuid, '96300000-0000-4000-8000-000000000206'::uuid, date '2026-09-01', 'geral', 'mao_obra_diarias', 60::numeric, '[TESTE] Diárias sem equipe setembro'),
  ('96300000-0000-4000-8000-000000000107'::uuid, '96300000-0000-4000-8000-000000000207'::uuid, date '2026-09-01', 'geral', 'mao_obra_producao', 116.25::numeric, '[TESTE] Produção setembro'),
  ('96300000-0000-4000-8000-000000000108'::uuid, '96300000-0000-4000-8000-000000000208'::uuid, date '2026-09-01', 'geral', 'cmv_materia_prima', 999::numeric, '[TESTE] CMV excluído setembro'),
  ('96300000-0000-4000-8000-000000000109'::uuid, '96300000-0000-4000-8000-000000000209'::uuid, date '2026-09-01', 'geral', 'impostos', 888::numeric, '[TESTE] Imposto excluído setembro'),
  ('96300000-0000-4000-8000-00000000010a'::uuid, '96300000-0000-4000-8000-00000000020a'::uuid, date '2026-09-01', 'geral', 'taxas_cartao_apps', 777::numeric, '[TESTE] Taxa excluída setembro'),
  ('96300000-0000-4000-8000-00000000010b'::uuid, '96300000-0000-4000-8000-00000000020b'::uuid, date '2026-09-01', 'geral', 'emprestimos', 666::numeric, '[TESTE] Abaixo da linha excluído setembro'),
  ('96300000-0000-4000-8000-00000000010c'::uuid, '96300000-0000-4000-8000-00000000020c'::uuid, date '2026-09-01', 'geral', 'servicos_terceiros', 500::numeric, '[TESTE] Estorno excluído setembro'),
  ('96300000-0000-4000-8000-000000000111'::uuid, '96300000-0000-4000-8000-000000000211'::uuid, date '2026-10-01', 'jc', 'clientes_pj', 1000::numeric, '[TESTE] Receita PJ outubro'),
  ('96300000-0000-4000-8000-000000000113'::uuid, '96300000-0000-4000-8000-000000000213'::uuid, date '2026-10-01', 'geral', 'ocupacao', 2000::numeric, '[TESTE] Ocupação outubro'),
  ('96300000-0000-4000-8000-000000000114'::uuid, '96300000-0000-4000-8000-000000000214'::uuid, date '2026-10-01', 'jc', 'mao_obra_balcao_jc', 400::numeric, '[TESTE] Balcão outubro'),
  ('96300000-0000-4000-8000-000000000115'::uuid, '96300000-0000-4000-8000-000000000215'::uuid, date '2026-10-01', 'geral', 'mao_obra_producao', 178.125::numeric, '[TESTE] Produção outubro')
) fixture(id, request_id, month_start, store, category_key, amount, description)
join public.finance_categories category on category.key = fixture.category_key
on conflict (id) do update set amount = excluded.amount, planned_amount = excluded.planned_amount;

-- A Buck entra pelo fluxo de recebíveis; o helper cria o lançamento legítimo
-- no Financeiro com source=contas_receber e a competência do faturamento.
insert into public.customers (id, name, payment_term_days, active)
values ('96300000-0000-4000-8000-0000000000c1', '[TESTE] Buck Indicadores', 15, true)
on conflict (id) do nothing;

insert into public.receivables (
  id, request_id, customer_id, origin, finance_category_id, description,
  invoice_date, original_due_date, due_date, amount, created_by, period_start, period_end
)
select fixture.id, fixture.request_id, customer.id, 'romaneio_ex', category.id, fixture.description,
  fixture.invoice_date, fixture.due_date, fixture.due_date, fixture.amount,
  '96300000-0000-4000-8000-000000000001', fixture.period_start, fixture.period_end
from (values
  ('96300000-0000-4000-8000-000000000301'::uuid, '96300000-0000-4000-8000-000000000401'::uuid, date '2026-09-13', date '2026-09-27', date '2026-09-07', date '2026-09-13', 1000::numeric, '[TESTE] Buck setembro'),
  ('96300000-0000-4000-8000-000000000302'::uuid, '96300000-0000-4000-8000-000000000402'::uuid, date '2026-10-11', date '2026-10-25', date '2026-10-05', date '2026-10-11', 2000::numeric, '[TESTE] Buck outubro')
) fixture(id, request_id, invoice_date, due_date, period_start, period_end, amount, description)
join public.customers customer on customer.id = '96300000-0000-4000-8000-0000000000c1'
join public.finance_categories category on category.key = 'buck_ex'
on conflict (id) do nothing;

insert into public.receivable_receipts (
  id, request_id, receivable_id, received_date, amount, method, account_id, created_by
)
values
  ('96300000-0000-4000-8000-000000000501', '96300000-0000-4000-8000-000000000601', '96300000-0000-4000-8000-000000000301', date '2026-09-13', 1000, 'outro', '96300000-0000-4000-8000-0000000000a1', '96300000-0000-4000-8000-000000000001'),
  ('96300000-0000-4000-8000-000000000502', '96300000-0000-4000-8000-000000000602', '96300000-0000-4000-8000-000000000302', date '2026-10-11', 2000, 'outro', '96300000-0000-4000-8000-0000000000a1', '96300000-0000-4000-8000-000000000001')
on conflict (id) do nothing;

select private.lancar_recibo_no_livro('96300000-0000-4000-8000-000000000501', '96300000-0000-4000-8000-000000000001');
select private.lancar_recibo_no_livro('96300000-0000-4000-8000-000000000502', '96300000-0000-4000-8000-000000000001');
select private.atualizar_situacao_receivable('96300000-0000-4000-8000-000000000301');
select private.atualizar_situacao_receivable('96300000-0000-4000-8000-000000000302');

update public.finance_entries
set reversed_at = now(), reversed_by = '96300000-0000-4000-8000-000000000001', reversal_reason = '[TESTE] Lançamento estornado'
where id = '96300000-0000-4000-8000-00000000010c';

-- Os fechamentos do seed usam as mesmas chaves do cenário de teste; remova-os
-- pelo identificador do fixture antes de inserir as cópias do teste.
delete from public.cash_closings
where created_by_name = '[TESTE] Indicadores admin'
  and closing_date >= date '2026-09-01'
  and closing_date < date '2026-11-01';

insert into public.cash_closings (
  closing_date, weekday_label, store, sales_amount, ifood_sales_amount,
  total_amount, created_by, created_by_name
)
select day_date::date, to_char(day_date, 'FMDay'), store,
  case when store = 'jc' and day_date::date = date '2026-09-01' then 10000 else 0 end,
  case when store = 'jc' and day_date::date = date '2026-09-01' then 600 else 0 end,
  case when store = 'jc' and day_date::date = date '2026-09-01' then 10000 else 0 end,
  '96300000-0000-4000-8000-000000000001', '[TESTE] Indicadores admin'
from generate_series(date '2026-09-01', date '2026-09-30', interval '1 day') day(day_date)
cross join (values ('jc'::text), ('ja'::text)) stores(store)
where (store <> 'jc' or extract(dow from day_date) <> 0)
  and not (store = 'ja' and day_date::date = date '2026-09-15')
on conflict (store, closing_date) do nothing;

insert into public.cash_closings (
  closing_date, weekday_label, store, sales_amount, ifood_sales_amount,
  total_amount, created_by, created_by_name
)
select day_date::date, to_char(day_date, 'FMDay'), store,
  case when store = 'jc' and day_date::date = date '2026-10-01' then 20000 else 0 end,
  case when store = 'jc' and day_date::date = date '2026-10-01' then 1000 else 0 end,
  case when store = 'jc' and day_date::date = date '2026-10-01' then 20000 else 0 end,
  '96300000-0000-4000-8000-000000000001', '[TESTE] Indicadores admin'
from generate_series(date '2026-10-01', date '2026-10-31', interval '1 day') day(day_date)
cross join (values ('jc'::text), ('ja'::text)) stores(store)
where store <> 'jc' or extract(dow from day_date) <> 0
on conflict (store, closing_date) do nothing;

-- O seed geral tem produção fictícia nesses meses. O teste substitui apenas
-- essas quatro linhas, dentro da transação que termina em rollback.
delete from public.production_actuals
where product_source = 'bread'
  and product_id in ('pricing-indicators-weighted', 'pricing-indicators-no-weight')
  and record_date in (date '2026-09-01', date '2026-10-01');

insert into public.production_actuals (
  record_date, bread_id, product_source, product_id, product_variant_id,
  product_name, production_unit, lot_code, quantity_baked, quantity_loss,
  loss_reason, recorded_by
)
values
  (date '2026-09-01', 'indicadores-peso', 'bread', 'indicadores-peso', null, '[TESTE] Indicadores pão pesado', 'un', 'L0901', 62, 0, null, 'Admin Indicadores Teste'),
  (date '2026-09-01', 'indicadores-sem-peso', 'bread', 'indicadores-sem-peso', null, '[TESTE] Indicadores pão sem peso', 'un', 'L0901', 38, 0, null, 'Admin Indicadores Teste'),
  (date '2026-10-01', 'indicadores-peso', 'bread', 'indicadores-peso', null, '[TESTE] Indicadores pão pesado', 'un', 'L1001', 95, 0, null, 'Admin Indicadores Teste'),
  (date '2026-10-01', 'indicadores-sem-peso', 'bread', 'indicadores-sem-peso', null, '[TESTE] Indicadores pão sem peso', 'un', 'L1001', 5, 0, null, 'Admin Indicadores Teste'),
  (date '2026-10-01', 'indicadores-brioche', 'bread', 'indicadores-brioche', null, '[TESTE] Indicadores Brioche Hamburguer', 'un', 'L1001', 25, 0, null, 'Admin Indicadores Teste'),
  (date '2026-10-01', null, 'product', '96300000-0000-4000-8000-0000000007a4', null, '[TESTE] Indicadores pão por quilo', 'kg', 'L1001', 10, 0, null, 'Admin Indicadores Teste'),
  (date '2026-10-01', null, 'product', '96300000-0000-4000-8000-0000000007a5', null, '[TESTE] Indicadores quilo sem assado', 'kg', 'L1001', 4, 0, null, 'Admin Indicadores Teste')
on conflict (product_source, product_id, record_date, product_variant_id) do update
set quantity_baked = excluded.quantity_baked,
    production_unit = excluded.production_unit;

select ok(not has_function_privilege('anon', 'public.get_pricing_financial_indicators()', 'execute'), 'anon não pode executar a leitura');
select ok(has_function_privilege('authenticated', 'public.get_pricing_financial_indicators()', 'execute'), 'authenticated pode chamar a RPC e o banco valida admin');
select ok(not has_function_privilege('authenticated', 'private.pricing_financial_indicators_report(date)', 'execute'), 'o auxiliar de data não fica exposto ao cliente');

select set_config('request.jwt.claim.sub', '96300000-0000-4000-8000-000000000001', true);

-- Salário dos donos na Configuração (decisão de 04/11/2026). Zero definido
-- não é lacuna e não muda a conta: as asserções abaixo valem como antes.
-- O valor de verdade entra depois, para conferir a soma.
select is((public.save_pricing_settings('[{"setting_key":"retirada_donos_mensal","value":0,"previous_value":null}]') ->> 'saved')::integer, 1,
  'admin define o salário dos donos pela porta da Configuração');

select is(
  public.get_pricing_financial_indicators(),
  private.pricing_financial_indicators_report(private.data_na_padaria()),
  'RPC de admin delega ao relatório usando o calendário da padaria'
);

select is(private.pricing_financial_indicators_report(date '2026-11-01') #>> '{months,0,month}', '2026-09', 'começa em setembro e ordena o mês mais antigo primeiro');
select is((private.pricing_financial_indicators_report(date '2026-11-01') #>> '{months,0,revenue}')::numeric, 13600::numeric, 'faturamento soma balcão, iFood, PJ e Buck');
select is((private.pricing_financial_indicators_report(date '2026-11-01') #>> '{months,0,fixed_expenses}')::numeric, 1360::numeric, 'despesas fixas incluem só grupos definidos e ignoram estorno');
select is((private.pricing_financial_indicators_report(date '2026-11-01') #>> '{months,0,fixed_expense_pct}')::numeric, 0.1::numeric, 'percentual de despesa fixa usa o faturamento completo');
select is((private.pricing_financial_indicators_report(date '2026-11-01') #>> '{months,0,production_labor}')::numeric, 116.25::numeric, 'mão de obra de produção fica separada das despesas fixas');
select is((private.pricing_financial_indicators_report(date '2026-11-01') #>> '{months,0,kilograms_with_known_weight}')::numeric, 31::numeric, 'massa crua da ficha converte unidades em quilos; o peso médio do cadastro de pães fica de fora');
select is((private.pricing_financial_indicators_report(date '2026-11-01') #>> '{months,0,weight_coverage_pct}')::numeric, 62::numeric, 'cobertura considera todas as unidades produzidas');
select is((private.pricing_financial_indicators_report(date '2026-11-01') #>> '{months,0,labor_cost_per_kg}')::numeric, 3.75::numeric, 'custo de mão de obra por quilo usa apenas quilos com peso conhecido');
select is((private.pricing_financial_indicators_report(date '2026-11-01') #>> '{months,0,is_provisional}')::boolean, true, 'cobertura baixa marca o mês como provisório');
select ok((private.pricing_financial_indicators_report(date '2026-11-01') #> '{months,0,provisional_reasons}') @> '["cobertura de peso 62%", "mês sem fechamento de caixa da JA em 1 dia", "encargos e diárias sem equipe"]'::jsonb, 'provisoriedade explica peso, fechamento ausente e encargos sem equipe');
select is((private.pricing_financial_indicators_report(date '2026-11-01') #>> '{months,1,month}'), '2026-10', 'não inclui o mês que está aberto na data de referência');
select is(round((private.pricing_financial_indicators_report(date '2026-11-01') #>> '{months,1,weight_coverage_pct}')::numeric, 2), 93.53::numeric, 'cobertura de outubro: 130 de 139; o quilo sem assado na ficha fica de fora');
select is((private.pricing_financial_indicators_report(date '2026-11-01') #>> '{months,1,kilograms_with_known_weight}')::numeric, 60.5::numeric, 'outubro soma 47,5 kg do pão pesado, 2 kg do Brioche pela variante Hambúrguer e 11 kg de massa crua do pão lançado em quilo; os 4 kg sem assado não entram');
select is((select ficha_massa_crua_kg from private.ficha_peso_por_unidade('bread', 'indicadores-brioche', null)), 0.08::numeric, 'pão que é variante lê a ficha da variante, não a linha do produto');
select is((select count(*) from private.ficha_peso_por_unidade('bread', 'indicadores-sem-peso', null))::integer, 0, 'produto sem rendimento na ficha não devolve peso, mesmo com peso médio no cadastro de pães');
select ok(not has_function_privilege('authenticated', 'private.ficha_peso_por_unidade(text, text, uuid)', 'execute'), 'a leitura do peso da ficha não fica exposta ao cliente');
select is((private.pricing_financial_indicators_report(date '2026-11-01') #>> '{months,1,is_provisional}')::boolean, false, 'mês sem lacunas não é provisório');
select is((private.pricing_financial_indicators_report(date '2026-11-01') #>> '{average,fixed_expense_pct}')::numeric, 0.1::numeric, 'média de percentuais de fixos é ponderada pelo faturamento');
select is(
  round((private.pricing_financial_indicators_report(date '2026-11-01') #>> '{average,labor_cost_per_kg}')::numeric, 6),
  round((116.25::numeric(12,2) + 178.125::numeric(12,2)) / (31 + 60.5), 6),
  'média pondera mão de obra persistida em centavos pelos quilos conhecidos'
);
select is((private.pricing_financial_indicators_report(date '2026-11-01') #>> '{average,month_count}')::integer, 2, 'a média informa quantos meses entraram');

-- O salário dos donos entra nas despesas fixas de todo mês, pelo valor vigente.
select is((public.save_pricing_settings('[{"setting_key":"retirada_donos_mensal","value":1360,"previous_value":0}]') ->> 'saved')::integer, 1,
  'admin muda o salário dos donos para R$ 1.360');
select is((private.pricing_financial_indicators_report(date '2026-11-01') #>> '{months,0,fixed_expenses}')::numeric, 2720::numeric,
  'setembro: R$ 1.360 de despesas do Financeiro mais R$ 1.360 de salário dos donos');
select is((private.pricing_financial_indicators_report(date '2026-11-01') #>> '{months,0,fixed_expense_pct}')::numeric, 0.2::numeric,
  'o percentual de despesas fixas já inclui o salário dos donos');
select is((private.pricing_financial_indicators_report(date '2026-11-01') #>> '{months,1,owner_salary}')::numeric, 1360::numeric,
  'cada mês mostra quanto do fixo é salário dos donos');
select is((public.save_pricing_settings('[{"setting_key":"retirada_donos_mensal","value":null,"previous_value":1360}]') ->> 'saved')::integer, 1,
  'admin limpa o salário dos donos');
select ok((private.pricing_financial_indicators_report(date '2026-11-01') #> '{months,1,provisional_reasons}') @> '["salário dos donos não definido na Configuração"]'::jsonb
    and (private.pricing_financial_indicators_report(date '2026-11-01') #>> '{months,1,is_provisional}')::boolean,
  'sem salário definido, o mês completo fica provisório e diz por quê');

set local role authenticated;
select set_config('request.jwt.claim.sub', '96300000-0000-4000-8000-000000000002', true);
select throws_ok($$ select public.get_pricing_financial_indicators() $$, '42501', 'Apenas administradores podem consultar os indicadores de preço.', 'Financeiro recebe recusa no banco');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '96300000-0000-4000-8000-000000000003', true);
select throws_ok($$ select public.get_pricing_financial_indicators() $$, '42501', 'Apenas administradores podem consultar os indicadores de preço.', 'Compras recebe recusa no banco');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '96300000-0000-4000-8000-000000000004', true);
select throws_ok($$ select public.get_pricing_financial_indicators() $$, '42501', 'Apenas administradores podem consultar os indicadores de preço.', 'Produção recebe recusa no banco');

select * from finish();
rollback;
