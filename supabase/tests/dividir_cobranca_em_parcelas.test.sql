-- Dividir a fatura em 2x ou 3x, por decisão da cobrança.
--
-- O que este teste protege:
--   * o prazo do cliente é o TETO: a última parcela cai nele;
--   * a soma das parcelas bate exatamente com o valor faturado;
--   * a cobrança que nasce sozinha nasce inteira e pode ser dividida depois,
--     sem perder o vínculo com o pedido que a gerou;
--   * prazo curto demais não vira parcelas no mesmo dia;
--   * cobrança com dinheiro dentro não pode ser dividida.

begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

-- A conta dos vencimentos --------------------------------------------------

select is(private.vencimento_da_parcela(21, 1, 3), 7,
  'cliente de 21 dias em 3 vezes: a primeira vence em 7');
select is(private.vencimento_da_parcela(21, 3, 3), 21,
  'e a ultima cai exatamente no prazo combinado');
select is(private.vencimento_da_parcela(28, 1, 2), 14,
  'cliente de 28 dias em 2 vezes vence no meio');
select is(private.vencimento_da_parcela(7, 1, 1), 7,
  'fatura inteira mantem o vencimento de sempre');

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
  ('98000000-0000-4000-8000-000000000001', 'contas_receber.baixar', 'jc', null),
  ('98000000-0000-4000-8000-000000000001', 'financeiro.acessar', '*', null);

insert into public.customers (id, name, doc, payment_term_days, active)
values
  ('98000000-0000-4000-8000-0000000000c1', '[TESTE] Cliente Prazo 21', '44555666000181', 21, true),
  ('98000000-0000-4000-8000-0000000000c2', '[TESTE] Cliente Prazo Curto', '44555666000262', 2, true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '98000000-0000-4000-8000-000000000001', true);

-- A mesma fatura, inteira ou dividida --------------------------------------

select lives_ok(
  $$ select public.create_manual_receivable(
    '98000000-0000-4000-8000-00000000a001'::uuid,
    '98000000-0000-4000-8000-0000000000c1'::uuid,
    private.data_na_padaria() - 1, 300.00, 'Pedido pequeno'
  ) $$,
  'fatura pequena nasce inteira, sem escolher parcelas'
);

select is((select count(*)::int from public.receivables
    where description like 'Pedido pequeno%'), 1,
  'cliente parcelavel continua podendo pagar de uma vez');

select lives_ok(
  $$ select public.create_manual_receivable(
    '98000000-0000-4000-8000-00000000a002'::uuid,
    '98000000-0000-4000-8000-0000000000c1'::uuid,
    private.data_na_padaria() - 1, 900.00, 'Pedido grande', 3
  ) $$,
  'a mesma cliente divide a fatura alta em tres'
);

select is((select count(*)::int from public.receivables
    where description like 'Pedido grande%'), 3,
  'a fatura alta virou tres cobrancas');

select is((select sum(amount) from public.receivables
    where description like 'Pedido grande%'), 900.00,
  'a soma das parcelas bate com o valor faturado');

select results_eq(
  $$ select due_date from public.receivables
     where description like 'Pedido grande%' order by installment_number $$,
  format($$ values (date '%s'), (date '%s'), (date '%s') $$,
    private.data_na_padaria() - 1 + 7, private.data_na_padaria() - 1 + 14, private.data_na_padaria() - 1 + 21),
  'as parcelas se distribuem ate o prazo do cliente, que e o teto'
);

-- Centavos que não dividem exato -------------------------------------------

select lives_ok(
  $$ select public.create_manual_receivable(
    '98000000-0000-4000-8000-00000000a003'::uuid,
    '98000000-0000-4000-8000-0000000000c1'::uuid,
    private.data_na_padaria() - 1, 100.00, 'Valor quebrado', 3
  ) $$,
  'dividir 100,00 em tres'
);

select is((select sum(amount) from public.receivables
    where description like 'Valor quebrado%'), 100.00,
  'nenhum centavo se perde no arredondamento');

select is((select amount from public.receivables
    where description like 'Valor quebrado%' and installment_number = 1), 33.34,
  'os centavos que sobram vao na primeira parcela');

-- Prazo curto demais --------------------------------------------------------

select throws_ok(
  $$ select public.create_manual_receivable(
    '98000000-0000-4000-8000-00000000a004'::uuid,
    '98000000-0000-4000-8000-0000000000c2'::uuid,
    private.data_na_padaria() - 1, 300.00, 'Prazo curto', 3
  ) $$,
  '22023',
  'O prazo de 2 dia(s) deste cliente é curto demais para dividir em 3 vezes.',
  'prazo curto nao vira parcelas no mesmo dia'
);

-- Dividir uma cobrança que já existe ---------------------------------------

select lives_ok(
  $$ select public.create_manual_receivable(
    '98000000-0000-4000-8000-00000000a005'::uuid,
    '98000000-0000-4000-8000-0000000000c1'::uuid,
    private.data_na_padaria() - 1, 600.00, 'Nasceu inteira'
  ) $$,
  'cobranca nasce inteira, como a que vem do envio confirmado'
);

select lives_ok(
  $$ select public.split_receivable(
    '98000000-0000-4000-8000-00000000d001'::uuid,
    (select id from public.receivables where request_id = '98000000-0000-4000-8000-00000000a005'::uuid),
    2
  ) $$,
  'financeiro divide a cobranca depois'
);

select is((select count(*)::int from public.receivables
    where description like 'Nasceu inteira%'), 2,
  'a divisao gerou a segunda parcela');

select is((select sum(amount) from public.receivables
    where description like 'Nasceu inteira%'), 600.00,
  'dividir nao cria nem some dinheiro');

select is((select amount from public.receivables
    where request_id = '98000000-0000-4000-8000-00000000a005'::uuid), 300.00,
  'a cobranca original virou a parcela 1, sem ser cancelada');

select is((select installment_count from public.receivables
    where request_id = '98000000-0000-4000-8000-00000000a005'::uuid), 2,
  'e sabe que agora faz parte de um par');

select is(
  (select count(*)::int from public.receivable_events
   where receivable_id = (select id from public.receivables where request_id = '98000000-0000-4000-8000-00000000a005'::uuid)
     and event_type = 'dividida'), 1,
  'a divisao ficou registrada na trilha');

-- Não se divide o que já tem dinheiro dentro -------------------------------

select lives_ok(
  $$ select public.record_receivable_receipt(
    '98000000-0000-4000-8000-00000000b001'::uuid,
    (select id from public.receivables where request_id = '98000000-0000-4000-8000-00000000a001'::uuid),
    private.data_na_padaria(), 100.00, 'pix', 'banco_sicredi_jc'
  ) $$,
  'recebe uma parte da cobranca inteira'
);

select throws_ok(
  $$ select public.split_receivable(
    '98000000-0000-4000-8000-00000000d002'::uuid,
    (select id from public.receivables where request_id = '98000000-0000-4000-8000-00000000a001'::uuid),
    2
  ) $$,
  '22023',
  'Esta cobrança já recebeu dinheiro. Estorne os recebimentos antes de dividir.',
  'cobranca com dinheiro dentro nao pode ser dividida'
);

select throws_ok(
  $$ select public.split_receivable(
    '98000000-0000-4000-8000-00000000d003'::uuid,
    (select id from public.receivables where description like 'Pedido grande · parcela 1/3'),
    2
  ) $$,
  '22023',
  'Esta cobrança já é uma parcela. Divida a cobrança inteira, não um pedaço dela.',
  'parcela nao se divide de novo'
);

reset role;

select * from finish();
rollback;
