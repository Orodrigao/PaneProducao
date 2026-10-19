-- Trocar a categoria de uma conta a pagar relança no livro todas as parcelas
-- já pagas, cada uma no banco de onde saiu.
--
-- O que este teste protege (defeito achado na revisão da PR 512, 19/10/2026):
-- corrigir a baixa da parcela 2 trocando a categoria da conta só relançava a
-- parcela 2; a parcela 1, já paga, ficava no livro na categoria antiga e o DRE
-- deixava de bater com o rateio da conta. Também: o banco de cada parcela paga
-- não muda numa reclassificação (em produção há contas com parcelas pagas por
-- bancos diferentes), os juros seguem em Financeiras no mês do pagamento,
-- rateio igual não estorna nada e uma recusa no meio desfaz tudo.
--
-- Quem opera aqui só tem as permissões de Contas a pagar: relançar as parcelas
-- da conta faz parte da baixa e da correção, não da reclassificação avulsa do
-- Financeiro.

begin;
create extension if not exists pgtap with schema extensions;

select plan(67);

-- Leituras do livro, do jeito que as telas do Financeiro somam: o estorno
-- desconta o lançamento original no mesmo mês, banco e categoria.
create function pg_temp.ativo(p_parcela uuid, p_categoria text)
returns numeric language sql as $$
  select coalesce(round(sum(entry.amount), 2), 0)
  from public.finance_entries entry
  join public.finance_categories category on category.id = entry.category_id
  where entry.source = 'contas_pagar' and entry.source_ref = p_parcela
    and entry.entry_type = 'lancamento' and entry.reversed_at is null
    and (p_categoria is null or category.key = p_categoria)
$$;

create function pg_temp.estornos(p_parcela uuid)
returns integer language sql as $$
  select count(*)::int from public.finance_entries entry
  where entry.source = 'contas_pagar' and entry.source_ref = p_parcela
    and entry.entry_type = 'estorno'
$$;

create function pg_temp.bancos(p_parcela uuid)
returns text language sql as $$
  select string_agg(distinct coalesce(account.key, '(nao informada)'), ',')
  from public.finance_entries entry
  left join public.finance_accounts account on account.id = entry.account_id
  where entry.source = 'contas_pagar' and entry.source_ref = p_parcela
    and entry.entry_type = 'lancamento' and entry.reversed_at is null
$$;

create function pg_temp.liquido(p_compra uuid, p_banco text, p_mes date, p_categoria text)
returns numeric language sql as $$
  select coalesce(round(sum(case when entry.entry_type = 'estorno' then -entry.amount else entry.amount end), 2), 0)
  from public.finance_entries entry
  join public.payable_installments installment on installment.id = entry.source_ref
  join public.finance_categories category on category.id = entry.category_id
  left join public.finance_accounts account on account.id = entry.account_id
  where entry.source = 'contas_pagar'
    and installment.purchase_id = p_compra
    and (p_banco is null or coalesce(account.key, '(nao informada)') = p_banco)
    and (p_mes is null or entry.competence_month = p_mes)
    and (p_categoria is null or category.key = p_categoria)
$$;

create function pg_temp.estorno_unico(p_compra uuid)
returns boolean language sql as $$
  select count(*) = count(distinct entry.reversal_of)
  from public.finance_entries entry
  join public.payable_installments installment on installment.id = entry.source_ref
  where entry.source = 'contas_pagar' and entry.entry_type = 'estorno'
    and installment.purchase_id = p_compra
$$;

-- Cenário ------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  (
    '97500000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'contas-pagar-relanca-test@example.com',
    '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
  ),
  (
    '97500000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'vendas-relanca-test@example.com',
    '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
  );

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('97500000-0000-4000-8000-000000000001', 'Teste Contas a Pagar Relanca', 'financeiro', 'jc', true, '["/contas-pagar"]'::jsonb),
  ('97500000-0000-4000-8000-000000000002', 'Teste Vendas Relanca', 'vendas', 'ja', true, '["/romaneio"]'::jsonb);

-- Só Contas a pagar: nada de financeiro.lancar nem financeiro.estornar.
insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values
  ('97500000-0000-4000-8000-000000000001', 'contas_pagar.acessar', 'jc', null),
  ('97500000-0000-4000-8000-000000000001', 'contas_pagar.baixar', 'jc', null);

insert into public.suppliers (id, name, active)
values ('97500000-0000-4000-8000-0000000000f1', '[TESTE] Moinho Tres Parcelas', true);

-- Conta A: compra de 28/07 (DRE de julho), R$ 3.000 em três boletos de 1.000.
-- Conta B: compra de 03/08 sem categoria, R$ 100 em duas parcelas de 50.
-- Conta C: compra de 05/08, R$ 400 em duas parcelas de 200.
insert into public.payable_purchases (
  id, request_id, store, supplier_id, purchase_date, origin, document_type,
  payment_method, status, total_value, created_by
) values
  ('97500000-0000-4000-8000-0000000000a0', '97500000-0000-4000-8000-0000000000b0',
   'jc', '97500000-0000-4000-8000-0000000000f1', date '2026-07-28', 'manual', 'sem_nota',
   'boleto', 'aberta', 3000.00, '97500000-0000-4000-8000-000000000001'),
  ('97500000-0000-4000-8000-0000000000a1', '97500000-0000-4000-8000-0000000000b1',
   'jc', '97500000-0000-4000-8000-0000000000f1', date '2026-08-03', 'manual', 'sem_nota',
   'dinheiro', 'aberta', 100.00, '97500000-0000-4000-8000-000000000001'),
  ('97500000-0000-4000-8000-0000000000a2', '97500000-0000-4000-8000-0000000000b2',
   'jc', '97500000-0000-4000-8000-0000000000f1', date '2026-08-05', 'manual', 'sem_nota',
   'boleto', 'aberta', 400.00, '97500000-0000-4000-8000-000000000001');

insert into public.payable_installments (id, purchase_id, installment_number, due_date, amount, status)
values
  ('97500000-0000-4000-8000-0000000000e1', '97500000-0000-4000-8000-0000000000a0', 1, date '2026-08-10', 1000.00, 'pendente'),
  ('97500000-0000-4000-8000-0000000000e2', '97500000-0000-4000-8000-0000000000a0', 2, date '2026-09-10', 1000.00, 'pendente'),
  ('97500000-0000-4000-8000-0000000000e3', '97500000-0000-4000-8000-0000000000a0', 3, date '2026-10-10', 1000.00, 'pendente'),
  ('97500000-0000-4000-8000-0000000000e4', '97500000-0000-4000-8000-0000000000a1', 1, date '2026-08-03', 50.00, 'pendente'),
  ('97500000-0000-4000-8000-0000000000e5', '97500000-0000-4000-8000-0000000000a1', 2, date '2026-08-20', 50.00, 'pendente'),
  ('97500000-0000-4000-8000-0000000000e6', '97500000-0000-4000-8000-0000000000a2', 1, date '2026-08-10', 200.00, 'pendente'),
  ('97500000-0000-4000-8000-0000000000e7', '97500000-0000-4000-8000-0000000000a2', 2, date '2026-08-15', 200.00, 'pendente');

-- Conta A: parcela 1 pela Caixa, parcela 2 pelo Sicredi --------------------
-- As duas baixas vão pelas chamadas antigas (classificar e baixar), que a
-- versão do site no ar ainda usa.

set local role authenticated;
select set_config('request.jwt.claim.sub', '97500000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$ select public.set_payable_finance_classification(
    '97500000-0000-4000-8000-0000000000a0'::uuid, 'banco_caixa_jc',
    '[{"category_key":"cmv_materia_prima","amount":3000}]'::jsonb
  ) $$,
  'conta de tres parcelas classificada como materia-prima, saindo da Caixa'
);

-- Pagou 1.030 em 12/08: 30 de juros.
select lives_ok(
  $$ select public.record_payable_installment_payment(
    '97500000-0000-4000-8000-0000000000e1'::uuid, date '2026-08-12', 1030.00, 'boleto', null
  ) $$,
  'parcela 1 paga com juros pela Caixa'
);

-- A tela reenvia o rateio salvo a cada baixa; aqui só o banco muda.
select lives_ok(
  $$ select public.set_payable_finance_classification(
    '97500000-0000-4000-8000-0000000000a0'::uuid, 'banco_sicredi_jc',
    '[{"category_key":"cmv_materia_prima","amount":3000.00}]'::jsonb
  ) $$,
  'baixa da parcela 2 reenvia o mesmo rateio, agora pelo Sicredi'
);

select lives_ok(
  $$ select public.record_payable_installment_payment(
    '97500000-0000-4000-8000-0000000000e2'::uuid, date '2026-09-10', 1000.00, 'boleto', null
  ) $$,
  'parcela 2 paga pelo Sicredi'
);

reset role;

select is(pg_temp.estornos('97500000-0000-4000-8000-0000000000e1'), 0,
  'reenviar o mesmo rateio nao estorna a parcela ja paga');
select is(pg_temp.bancos('97500000-0000-4000-8000-0000000000e1'), 'banco_caixa_jc',
  'a parcela 1 segue no banco de onde saiu');
select is(pg_temp.bancos('97500000-0000-4000-8000-0000000000e2'), 'banco_sicredi_jc',
  'a parcela 2 sai do banco escolhido na baixa dela');

-- O defeito: corrigir a baixa da parcela 2 trocando a categoria -------------

set local role authenticated;

-- 2/3 materia-prima e 1/3 embalagem; a correcao tambem informa 10 de juros.
select lives_ok(
  $$ select public.correct_payable_payment_and_classification(
    '97500000-0000-4000-8000-0000000000e2'::uuid, date '2026-09-10', 1010.00, 'boleto', null,
    'banco_sicredi_jc',
    '[{"category_key":"cmv_materia_prima","amount":2000},{"category_key":"cmv_embalagem","amount":1000}]'::jsonb
  ) $$,
  'corrigir a baixa da parcela 2 trocando a categoria da conta'
);

reset role;

select is(pg_temp.ativo('97500000-0000-4000-8000-0000000000e1', 'cmv_materia_prima'), 666.67,
  'a parcela 1, ja paga, e relancada na divisao nova: materia-prima');
select is(pg_temp.ativo('97500000-0000-4000-8000-0000000000e1', 'cmv_embalagem'), 333.33,
  'a parcela 1 tambem ganha a fatia de embalagem');
select is(pg_temp.ativo('97500000-0000-4000-8000-0000000000e1', 'financeiras'), 30.00,
  'os juros da parcela 1 continuam em Financeiras');
select is(pg_temp.ativo('97500000-0000-4000-8000-0000000000e1', null), 1030.00,
  'a parcela 1 segue somando exatamente o que foi pago');
select is(pg_temp.bancos('97500000-0000-4000-8000-0000000000e1'), 'banco_caixa_jc',
  'relancar a parcela 1 nao muda o banco de onde ela saiu');
select is(
  (select entry.competence_month from public.finance_entries entry
     join public.finance_categories category on category.id = entry.category_id
   where entry.source_ref = '97500000-0000-4000-8000-0000000000e1'::uuid
     and entry.entry_type = 'lancamento' and entry.reversed_at is null
     and category.key = 'financeiras'),
  date '2026-08-01',
  'os juros da parcela 1 seguem no mes do pagamento');
select is(
  (select string_agg(distinct entry.competence_month::text, ',') from public.finance_entries entry
     join public.finance_categories category on category.id = entry.category_id
   where entry.source_ref = '97500000-0000-4000-8000-0000000000e1'::uuid
     and entry.entry_type = 'lancamento' and entry.reversed_at is null
     and category.key <> 'financeiras'),
  '2026-07-01',
  'o principal da parcela 1 segue no mes da compra');
select is(pg_temp.estornos('97500000-0000-4000-8000-0000000000e1'), 2,
  'a parcela 1 ganha um estorno por linha antiga: principal e juros');
select ok(pg_temp.estorno_unico('97500000-0000-4000-8000-0000000000a0'),
  'nenhuma linha da conta recebe dois estornos');

select is(pg_temp.ativo('97500000-0000-4000-8000-0000000000e2', 'cmv_materia_prima'), 666.67,
  'a parcela 2 corrigida entra na divisao nova');
select is(pg_temp.ativo('97500000-0000-4000-8000-0000000000e2', 'financeiras'), 10.00,
  'o juro informado na correcao vai para Financeiras');
select is(pg_temp.ativo('97500000-0000-4000-8000-0000000000e2', null), 1010.00,
  'a parcela 2 soma o valor corrigido');
select is(pg_temp.estornos('97500000-0000-4000-8000-0000000000e2'), 1,
  'a parcela 2 tem um ciclo de estorno so, o da correcao');

select is(pg_temp.liquido('97500000-0000-4000-8000-0000000000a0', 'banco_caixa_jc', null, null), 1030.00,
  'por banco, a Caixa mostra so o que saiu dela');
select is(pg_temp.liquido('97500000-0000-4000-8000-0000000000a0', 'banco_sicredi_jc', null, null), 1010.00,
  'por banco, o Sicredi mostra so o que saiu dele');
select is(pg_temp.liquido('97500000-0000-4000-8000-0000000000a0', null, date '2026-07-01', null), 2000.00,
  'no mes da compra pesa o principal das duas parcelas');
select is(pg_temp.liquido('97500000-0000-4000-8000-0000000000a0', null, date '2026-08-01', null), 30.00,
  'em agosto pesa so o juro pago em agosto');
select is(pg_temp.liquido('97500000-0000-4000-8000-0000000000a0', null, date '2026-09-01', null), 10.00,
  'em setembro pesa so o juro pago em setembro');
select is(pg_temp.liquido('97500000-0000-4000-8000-0000000000a0', null, null, 'cmv_materia_prima'), 1333.34,
  'o DRE da conta bate com o rateio novo: materia-prima');
select is(pg_temp.liquido('97500000-0000-4000-8000-0000000000a0', null, null, 'cmv_embalagem'), 666.66,
  'o DRE da conta bate com o rateio novo: embalagem');

select ok(
  (select details -> 'parcelas_relancadas' -> 0 ->> 'installment_number' = '1'
      and jsonb_array_length(details -> 'parcelas_relancadas') = 1
      and details -> 'rateio_anterior' -> 0 ->> 'category_key' = 'cmv_materia_prima'
      and (details -> 'rateio_anterior' -> 0 ->> 'amount')::numeric = 3000
   from public.payable_events
   where purchase_id = '97500000-0000-4000-8000-0000000000a0'::uuid
     and details ? 'parcelas_relancadas'
     and jsonb_array_length(details -> 'parcelas_relancadas') > 0
   order by occurred_at desc, id desc
   limit 1),
  'o historico da conta guarda o rateio anterior e a parcela relancada');

-- Rateio igual, em outra ordem e com centavos, não relança de novo ---------

set local role authenticated;

select lives_ok(
  $$ select public.correct_payable_payment_and_classification(
    '97500000-0000-4000-8000-0000000000e2'::uuid, date '2026-09-10', 1010.00, 'boleto', null,
    'banco_sicredi_jc',
    '[{"category_key":"cmv_embalagem","amount":1000.00},{"category_key":"cmv_materia_prima","amount":2000}]'::jsonb
  ) $$,
  'repetir a correcao com o mesmo rateio em outra ordem'
);

reset role;

select is(pg_temp.estornos('97500000-0000-4000-8000-0000000000e1'), 2,
  'rateio igual nao relanca a parcela 1 de novo');

-- Recusa no fim desfaz o relançamento --------------------------------------

set local role authenticated;

select throws_ok(
  $$ select public.correct_payable_payment_and_classification(
    '97500000-0000-4000-8000-0000000000e2'::uuid, date '2026-09-10', 900.00, 'boleto', null,
    'banco_sicredi_jc',
    '[{"category_key":"cmv_revenda","amount":3000}]'::jsonb
  ) $$,
  '22023',
  'O valor pago não pode ser menor que o valor original da parcela.',
  'correcao recusada no fim: valor abaixo do boleto'
);

reset role;

select is(pg_temp.ativo('97500000-0000-4000-8000-0000000000e1', 'cmv_revenda'), 0::numeric,
  'a recusa desfaz tambem o relancamento da parcela 1');
select is(pg_temp.estornos('97500000-0000-4000-8000-0000000000e1'), 2,
  'a recusa nao deixa estorno a mais');
select is(
  (select string_agg(category.key || ':' || split.amount::text, ',' order by category.key)
   from public.payable_purchase_categories split
   join public.finance_categories category on category.id = split.category_id
   where split.purchase_id = '97500000-0000-4000-8000-0000000000a0'::uuid),
  'cmv_embalagem:1000.00,cmv_materia_prima:2000.00',
  'a recusa mantem o rateio salvo antes');

-- Baixar a parcela 3 trocando a categoria, numa chamada só -----------------

set local role authenticated;

select lives_ok(
  $$ select public.record_payable_payment_and_classification(
    '97500000-0000-4000-8000-0000000000e3'::uuid, date '2026-10-01', 1000.00, 'pix', null,
    'banco_nubank_jc',
    '[{"category_key":"cmv_revenda","amount":3000}]'::jsonb
  ) $$,
  'baixar a parcela 3 trocando a categoria da conta'
);

reset role;

select is(pg_temp.liquido('97500000-0000-4000-8000-0000000000a0', null, null, 'cmv_revenda'), 3000.00,
  'as tres parcelas ficam em revenda');
select is(
  pg_temp.liquido('97500000-0000-4000-8000-0000000000a0', null, null, 'cmv_materia_prima')
    + pg_temp.liquido('97500000-0000-4000-8000-0000000000a0', null, null, 'cmv_embalagem'),
  0.00,
  'nada sobra nas categorias antigas');
select is(
  pg_temp.bancos('97500000-0000-4000-8000-0000000000e1') || '|'
    || pg_temp.bancos('97500000-0000-4000-8000-0000000000e2') || '|'
    || pg_temp.bancos('97500000-0000-4000-8000-0000000000e3'),
  'banco_caixa_jc|banco_sicredi_jc|banco_nubank_jc',
  'cada parcela fica no banco de onde saiu');
select is(pg_temp.liquido('97500000-0000-4000-8000-0000000000a0', null, null, 'financeiras'), 40.00,
  'os juros das duas primeiras parcelas seguem em Financeiras');
select is(pg_temp.liquido('97500000-0000-4000-8000-0000000000a0', null, null, null), 3040.00,
  'a conta inteira soma o que saiu do caixa: 1.030 + 1.010 + 1.000');
select is(pg_temp.ativo('97500000-0000-4000-8000-0000000000e3', null), 1000.00,
  'a parcela 3 entra no livro pela baixa');
select ok(pg_temp.estorno_unico('97500000-0000-4000-8000-0000000000a0'),
  'depois de tudo, nenhuma linha recebe dois estornos');
select is(
  (select status from public.payable_purchases where id = '97500000-0000-4000-8000-0000000000a0'::uuid),
  'paga',
  'com as tres parcelas pagas a conta fecha');

-- Conta B: de "não classificado" para a categoria, banco não informado -----

set local role authenticated;

select lives_ok(
  $$ select public.record_payable_installment_payment(
    '97500000-0000-4000-8000-0000000000e4'::uuid, date '2026-08-03', 50.00, 'dinheiro', null
  ) $$,
  'conta sem categoria nem banco paga em dinheiro'
);

reset role;

select is(pg_temp.ativo('97500000-0000-4000-8000-0000000000e4', 'nao_classificado'), 50.00,
  'sem categoria a parcela entra como nao classificada');

set local role authenticated;

select lives_ok(
  $$ select public.record_payable_payment_and_classification(
    '97500000-0000-4000-8000-0000000000e5'::uuid, date '2026-08-20', 50.00, 'dinheiro', null,
    'caixa_fisico_jc',
    '[{"category_key":"manutencao","amount":100}]'::jsonb
  ) $$,
  'a baixa da parcela 2 escolhe categoria e caixa'
);

reset role;

select is(pg_temp.ativo('97500000-0000-4000-8000-0000000000e4', 'manutencao'), 50.00,
  'a parcela 1 sai de nao classificado para a categoria escolhida');
select is(pg_temp.ativo('97500000-0000-4000-8000-0000000000e4', 'nao_classificado'), 0::numeric,
  'nada fica em nao classificado');
select is(pg_temp.bancos('97500000-0000-4000-8000-0000000000e4'), '(nao informada)',
  'o banco da parcela 1 continua nao informado: nao herda o caixa da parcela 2');
select is(pg_temp.bancos('97500000-0000-4000-8000-0000000000e5'), 'caixa_fisico_jc',
  'a parcela 2 sai do caixa escolhido');

-- Conta C: cartão onde já houve boleto é recusado sem gravar nada ----------

set local role authenticated;

select lives_ok(
  $$ select public.set_payable_finance_classification(
    '97500000-0000-4000-8000-0000000000a2'::uuid, 'banco_caixa_jc',
    '[{"category_key":"cmv_materia_prima","amount":400}]'::jsonb
  ) $$,
  'conta C classificada'
);
select lives_ok(
  $$ select public.record_payable_installment_payment(
    '97500000-0000-4000-8000-0000000000e6'::uuid, date '2026-08-10', 200.00, 'boleto', null
  ) $$,
  'parcela 1 da conta C paga em boleto'
);
select throws_ok(
  $$ select public.record_payable_payment_and_classification(
    '97500000-0000-4000-8000-0000000000e7'::uuid, date '2026-08-15', 200.00, 'cartao', null,
    'cartao_sicredi_jc',
    '[{"category_key":"cmv_revenda","amount":400}]'::jsonb
  ) $$,
  '22023',
  'Cartao de credito aceita somente a forma Cartao.',
  'cartao na parcela 2 e recusado porque a parcela 1 saiu em boleto'
);

reset role;

select is(pg_temp.estornos('97500000-0000-4000-8000-0000000000e6'), 0,
  'a recusa nao deixa estorno pela metade');
select is(pg_temp.ativo('97500000-0000-4000-8000-0000000000e6', 'cmv_materia_prima'), 200.00,
  'a parcela 1 segue na categoria de antes');
select is(
  (select status from public.payable_installments where id = '97500000-0000-4000-8000-0000000000e7'::uuid),
  'pendente',
  'a parcela 2 continua por pagar');

-- Permissões ----------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '97500000-0000-4000-8000-000000000002', true);

select throws_ok(
  $$ select public.record_payable_payment_and_classification(
    '97500000-0000-4000-8000-0000000000e7'::uuid, date '2026-08-15', 200.00, 'boleto', null,
    'banco_caixa_jc',
    '[{"category_key":"cmv_materia_prima","amount":400}]'::jsonb
  ) $$,
  '42501',
  'Sem permissão para baixar contas da JC.',
  'perfil sem permissao nao baixa com classificacao'
);
select throws_ok(
  $$ select public.correct_payable_payment_and_classification(
    '97500000-0000-4000-8000-0000000000e2'::uuid, date '2026-09-10', 1010.00, 'boleto', null,
    'banco_sicredi_jc',
    '[{"category_key":"cmv_revenda","amount":3000}]'::jsonb
  ) $$,
  '42501',
  'Sem permissao para corrigir baixas da JC.',
  'perfil sem permissao nao corrige baixa'
);
select throws_ok(
  $$ select public.set_payable_finance_classification(
    '97500000-0000-4000-8000-0000000000a0'::uuid, 'banco_caixa_jc',
    '[{"category_key":"cmv_materia_prima","amount":3000}]'::jsonb
  ) $$,
  '42501',
  'Sem permissão para classificar contas da JC.',
  'perfil sem permissao nao reclassifica pela classificacao da conta'
);

select set_config('request.jwt.claim.sub', '97500000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$ select public.reclassify_payable_finance_entries(
    '97500000-0000-4000-8000-0000000000a0'::uuid, 'banco_caixa_jc',
    '[{"category_key":"cmv_materia_prima","amount":3000}]'::jsonb,
    'teste de permissao'
  ) $$,
  '42501',
  'Sem permissão para reclassificar lançamentos.',
  'so com Contas a pagar a reclassificacao avulsa do Financeiro continua barrada'
);

reset role;

select ok(not has_function_privilege('authenticated',
    'private.apply_payable_finance_classification(uuid, text, jsonb, text, uuid, boolean)', 'execute'),
  'quem esta logado nao chama a funcao interna da classificacao');
select ok(not has_function_privilege('anon',
    'private.apply_payable_finance_classification(uuid, text, jsonb, text, uuid, boolean)', 'execute'),
  'anonimo nao chama a funcao interna da classificacao');
select ok(not has_function_privilege('authenticated',
    'private.sync_payable_finance_entries(uuid, uuid, text, boolean)', 'execute'),
  'quem esta logado nao gera lancamento direto');
select ok(to_regprocedure('private.sync_payable_finance_entries(uuid, uuid, text)') is null,
  'so existe uma funcao que gera os lancamentos da parcela');
select ok(has_function_privilege('authenticated',
    'public.record_payable_payment_and_classification(uuid, date, numeric, text, date, text, jsonb)', 'execute'),
  'a baixa com classificacao e uma operacao protegida unica para quem esta logado');
select ok(not has_function_privilege('anon',
    'public.record_payable_payment_and_classification(uuid, date, numeric, text, date, text, jsonb)', 'execute'),
  'anonimo nao baixa conta');

select * from finish();
rollback;
