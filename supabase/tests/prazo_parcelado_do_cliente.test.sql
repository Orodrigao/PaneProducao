-- Plano de prazos do cliente: 7/14/21 vira três cobranças.
--
-- O que este teste protege:
--   * cada prazo do plano vira uma cobrança com sua parte e seu vencimento;
--   * a soma das parcelas bate exatamente com o valor faturado;
--   * cliente de prazo único continua gerando uma cobrança só;
--   * as duas colunas de prazo ficam de acordo nos dois sentidos, enquanto a
--     versão antiga do site ainda grava a coluna velha.

begin;
create extension if not exists pgtap with schema extensions;

select plan(19);

-- As duas colunas se mantêm de acordo -------------------------------------

insert into public.customers (id, name, doc, payment_terms, active)
values ('98000000-0000-4000-8000-0000000000c1', '[TESTE] Cliente Parcelado', '44555666000181', array[7,14,21], true);

select is((select payment_term_days from public.customers
    where id = '98000000-0000-4000-8000-0000000000c1'), 7,
  'gravar o plano preenche a coluna antiga com o primeiro prazo');

-- O site antigo grava a coluna velha; o plano precisa acompanhar.
update public.customers set payment_term_days = 30
where id = '98000000-0000-4000-8000-0000000000c1';

select is((select payment_terms from public.customers
    where id = '98000000-0000-4000-8000-0000000000c1'), array[30],
  'gravar a coluna antiga refaz o plano, sem deixar o cadastro mentindo');

update public.customers set payment_terms = array[7,14,21]
where id = '98000000-0000-4000-8000-0000000000c1';

select throws_ok(
  $$ update public.customers set payment_terms = array[7,7]
     where id = '98000000-0000-4000-8000-0000000000c1' $$,
  '23514',
  null,
  'prazo repetido e recusado pelo banco'
);

select throws_ok(
  $$ update public.customers set payment_terms = array[21,7]
     where id = '98000000-0000-4000-8000-0000000000c1' $$,
  '23514',
  null,
  'plano fora de ordem e recusado: parcela 1 tem de ser a que vence antes'
);

-- Cenário --------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('98000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'financeiro-parcelas-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values ('98000000-0000-4000-8000-000000000001', 'Teste Financeiro Parcelas', 'financeiro', 'jc', true, '["/contas-receber"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values
  ('98000000-0000-4000-8000-000000000001', 'contas_receber.acessar', 'jc', null),
  ('98000000-0000-4000-8000-000000000001', 'contas_receber.lancar', 'jc', null),
  ('98000000-0000-4000-8000-000000000001', 'contas_receber.baixar', 'jc', null);

insert into public.customers (id, name, doc, payment_terms, active)
values ('98000000-0000-4000-8000-0000000000c2', '[TESTE] Cliente Prazo Unico', '44555666000262', array[15], true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '98000000-0000-4000-8000-000000000001', true);

-- Plano de três: R$ 900 vira 300 / 300 / 300 -------------------------------

select lives_ok(
  $$ select public.create_manual_receivable(
    '98000000-0000-4000-8000-00000000a001'::uuid,
    '98000000-0000-4000-8000-0000000000c1'::uuid,
    current_date - 1, 900.00, 'Paes da quinzena'
  ) $$,
  'lancar cobranca para cliente 7/14/21'
);

select is((select count(*)::int from public.receivables
    where customer_id = '98000000-0000-4000-8000-0000000000c1'::uuid), 3,
  'o plano de tres prazos gerou tres cobrancas');

select is((select sum(amount) from public.receivables
    where customer_id = '98000000-0000-4000-8000-0000000000c1'::uuid), 900.00,
  'a soma das parcelas bate exatamente com o valor faturado');

select results_eq(
  $$ select amount from public.receivables
     where customer_id = '98000000-0000-4000-8000-0000000000c1'::uuid
     order by installment_number $$,
  $$ values (300.00::numeric(12,2)), (300.00::numeric(12,2)), (300.00::numeric(12,2)) $$,
  'valor dividido em partes iguais'
);

select results_eq(
  $$ select due_date from public.receivables
     where customer_id = '98000000-0000-4000-8000-0000000000c1'::uuid
     order by installment_number $$,
  format($$ values (date '%s'), (date '%s'), (date '%s') $$,
    current_date - 1 + 7, current_date - 1 + 14, current_date - 1 + 21),
  'cada parcela vence no seu prazo, contado do faturamento'
);

select is((select count(distinct installment_count)::int from public.receivables
    where customer_id = '98000000-0000-4000-8000-0000000000c1'::uuid), 1,
  'todas as parcelas sabem que sao de um plano de tres');

select ok((select bool_and(description like '%parcela%')
    from public.receivables where customer_id = '98000000-0000-4000-8000-0000000000c1'::uuid),
  'a descricao diz qual parcela e');

-- Centavos que não dividem exato ------------------------------------------

select lives_ok(
  $$ select public.create_manual_receivable(
    '98000000-0000-4000-8000-00000000a002'::uuid,
    '98000000-0000-4000-8000-0000000000c1'::uuid,
    current_date - 1, 100.00, 'Valor que nao divide exato'
  ) $$,
  'lancar 100,00 num plano de tres'
);

select is((select sum(amount) from public.receivables
    where request_id = '98000000-0000-4000-8000-00000000a002'::uuid
       or origin_ref = (select id from public.receivables where request_id = '98000000-0000-4000-8000-00000000a002'::uuid)), 100.00,
  'nenhum centavo se perde no arredondamento');

select is((select amount from public.receivables
    where description like '%Valor que nao divide exato%' and installment_number = 1), 33.34,
  'os centavos que sobram vao na primeira parcela');

select is((select amount from public.receivables
    where description like '%Valor que nao divide exato%' and installment_number = 3), 33.33,
  'as demais ficam redondas');

-- Cliente de prazo único não muda de comportamento ------------------------

select lives_ok(
  $$ select public.create_manual_receivable(
    '98000000-0000-4000-8000-00000000a003'::uuid,
    '98000000-0000-4000-8000-0000000000c2'::uuid,
    current_date - 1, 500.00, 'Cobranca de prazo unico'
  ) $$,
  'lancar cobranca para cliente de prazo unico'
);

select is((select count(*)::int from public.receivables
    where customer_id = '98000000-0000-4000-8000-0000000000c2'::uuid), 1,
  'prazo unico continua gerando uma cobranca so');

select ok((select description not like '%parcela%' from public.receivables
    where customer_id = '98000000-0000-4000-8000-0000000000c2'::uuid),
  'cobranca de parcela unica nao ganha rotulo de parcela');

select is((select installment_count from public.receivables
    where customer_id = '98000000-0000-4000-8000-0000000000c2'::uuid), 1,
  'e ela sabe que e a unica');

reset role;

select * from finish();
rollback;
