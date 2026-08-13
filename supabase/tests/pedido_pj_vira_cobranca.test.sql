-- Fase 3 do Contas a Receber: o pedido PJ entregue vira cobrança.
--
-- O que este teste protege:
--   * o valor da cobrança é a soma do GRUPO, não de uma linha;
--   * confirmar o envio gera a cobrança sem dar permissão financeira à
--     Expedição, e confirmar de novo não gera uma segunda;
--   * o financeiro gera pela lista o que o envio não gerou, e os dois
--     caminhos produzem a mesma cobrança;
--   * cliente sem prazo não trava o envio — o pedido fica na lista;
--   * pedido já cobrado não pode ser editado, cancelado nem apagado.

begin;
create extension if not exists pgtap with schema extensions;

select plan(27);

-- Cenário ------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('95000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'financeiro-fase3-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('95000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'expedicao-fase3-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('95000000-0000-4000-8000-000000000001', 'Teste Financeiro Fase 3', 'financeiro', 'jc', true, '["/contas-receber"]'::jsonb),
  ('95000000-0000-4000-8000-000000000002', 'Teste Expedicao Fase 3', 'expedicao', 'jc', true, '["/pedidos-pj"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values
  ('95000000-0000-4000-8000-000000000001', 'contas_receber.acessar', 'jc', null),
  ('95000000-0000-4000-8000-000000000001', 'contas_receber.lancar', 'jc', null),
  ('95000000-0000-4000-8000-000000000001', 'contas_receber.cancelar', 'jc', null),
  ('95000000-0000-4000-8000-000000000001', 'financeiro.acessar', '*', null),
  -- A Expedição recebe SOMENTE a permissão de confirmar envio. Nenhuma
  -- permissão financeira: é o que o teste precisa provar.
  ('95000000-0000-4000-8000-000000000002', 'pedidos_pj.confirmar_envio', 'jc', null);

insert into public.customers (id, name, doc, payment_term_days, active)
values
  ('95000000-0000-4000-8000-0000000000c1', '[TESTE] Cliente Fase 3 Prazo 15', '22333444000181', 15, true),
  ('95000000-0000-4000-8000-0000000000c2', '[TESTE] Cliente Fase 3 Sem Prazo', '22333444000262', null, true);

insert into public.breads (id, name, days, active, unit, is_special, is_shelf)
values ('teste-pao-fase3', '[TESTE] Pao Fase 3', '{0,1,2,3,4,5,6}', true, 'un', false, false)
on conflict (id) do nothing;

-- Um pedido com DUAS linhas: 100,00 + 50,00 = 150,00. Entregue ontem.
insert into public.orders (
  id, store, order_type, order_group_id, bread_id, product_source, product_name,
  quantity, unit_price, pack_size, pricing_unit, customer_id, pj_client,
  order_date, delivery_date, pj_delivery_date, needs_production
) values
  ('95000000-0000-4000-8000-00000000e001', 'pj', 'pj', '95000000-0000-4000-8000-0000000000a1',
   'teste-pao-fase3', 'bread', '[TESTE] Pao Fase 3', 20, 5.00, 1, 'un',
   '95000000-0000-4000-8000-0000000000c1', '[TESTE] Cliente Fase 3 Prazo 15',
   current_date - 3, current_date - 1, current_date - 1, false),
  ('95000000-0000-4000-8000-00000000e002', 'pj', 'pj', '95000000-0000-4000-8000-0000000000a1',
   'teste-pao-fase3', 'bread', '[TESTE] Pao Fase 3', 10, 5.00, 1, 'un',
   '95000000-0000-4000-8000-0000000000c1', '[TESTE] Cliente Fase 3 Prazo 15',
   current_date - 3, current_date - 1, current_date - 1, false);

-- Pedido de cliente sem prazo, também entregue ontem.
insert into public.orders (
  id, store, order_type, order_group_id, bread_id, product_source, product_name,
  quantity, unit_price, pack_size, pricing_unit, customer_id, pj_client,
  order_date, delivery_date, pj_delivery_date, needs_production
) values
  ('95000000-0000-4000-8000-00000000e003', 'pj', 'pj', '95000000-0000-4000-8000-0000000000a2',
   'teste-pao-fase3', 'bread', '[TESTE] Pao Fase 3', 8, 5.00, 1, 'un',
   '95000000-0000-4000-8000-0000000000c2', '[TESTE] Cliente Fase 3 Sem Prazo',
   current_date - 3, current_date - 1, current_date - 1, false);

-- A lista de pedidos a faturar --------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);

select is((select amount from public.list_pj_orders_to_bill()
    where order_group_id = '95000000-0000-4000-8000-0000000000a1'::uuid), 150.00,
  'a lista soma o pedido inteiro, nao uma linha so');

select is((select items from public.list_pj_orders_to_bill()
    where order_group_id = '95000000-0000-4000-8000-0000000000a1'::uuid), 2,
  'a lista mostra quantas linhas o pedido tem');

select ok(exists(select 1 from public.list_pj_orders_to_bill()
    where order_group_id = '95000000-0000-4000-8000-0000000000a2'::uuid),
  'pedido de cliente sem prazo tambem aparece na lista');

reset role;

-- Expedição confirma o envio: a cobrança nasce por dentro ------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000002', true);

select ok(not exists(select 1 from public.app_user_permissions
    where user_id = '95000000-0000-4000-8000-000000000002'
      and permission_key like 'contas_receber.%'),
  'a expedicao nao tem nenhuma permissao de contas a receber');

select lives_ok(
  $$ select public.confirm_pj_order_dispatch('95000000-0000-4000-8000-0000000000a1'::uuid) $$,
  'expedicao confirma o envio do pedido'
);

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);

select is((select count(*)::int from public.receivables
    where origin = 'pedido_pj' and origin_ref = '95000000-0000-4000-8000-0000000000a1'::uuid), 1,
  'confirmar o envio gerou a cobranca');

select is((select amount from public.receivables
    where origin_ref = '95000000-0000-4000-8000-0000000000a1'::uuid), 150.00,
  'o valor da cobranca e a soma do pedido inteiro');

select is((select due_date from public.receivables
    where origin_ref = '95000000-0000-4000-8000-0000000000a1'::uuid), current_date + 15,
  'o vencimento sai do prazo do cliente contado do envio');

select is((select invoice_date from public.receivables
    where origin_ref = '95000000-0000-4000-8000-0000000000a1'::uuid), current_date,
  'a data do faturamento e o dia do envio confirmado');

select is((select status from public.receivables
    where origin_ref = '95000000-0000-4000-8000-0000000000a1'::uuid), 'aberta',
  'a cobranca gerada nasce em aberto');

select ok(not exists(select 1 from public.list_pj_orders_to_bill()
    where order_group_id = '95000000-0000-4000-8000-0000000000a1'::uuid),
  'pedido cobrado sai da lista de a faturar');

reset role;

-- Confirmar de novo não cria uma segunda cobrança --------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000002', true);

select lives_ok(
  $$ select public.confirm_pj_order_dispatch('95000000-0000-4000-8000-0000000000a1'::uuid) $$,
  'confirmar o envio de novo nao estoura erro'
);

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);

select is((select count(*)::int from public.receivables
    where origin_ref = '95000000-0000-4000-8000-0000000000a1'::uuid), 1,
  'o toque duplo no envio nao gerou uma segunda cobranca');

-- Pedido já cobrado fica travado -------------------------------------------

select throws_ok(
  $$ update public.orders set quantity = 999
     where id = '95000000-0000-4000-8000-00000000e001' $$,
  '22023',
  'Este pedido já virou cobrança. Cancele a cobrança em Contas a receber antes de alterá-lo.',
  'pedido cobrado nao pode ter a quantidade alterada'
);

select throws_ok(
  $$ update public.orders set cancelled_at = now()
     where id = '95000000-0000-4000-8000-00000000e001' $$,
  '22023',
  'Este pedido já virou cobrança. Cancele a cobrança em Contas a receber antes de alterá-lo.',
  'pedido cobrado nao pode ser cancelado'
);

-- A tela edita gravando as linhas novas ANTES de apagar as antigas. Travar so
-- a exclusao deixaria o pedido dobrado; por isso a entrada tambem e travada.
select throws_ok(
  $$ insert into public.orders (
       store, order_type, order_group_id, bread_id, product_source, product_name,
       quantity, unit_price, pack_size, pricing_unit, customer_id, pj_client,
       order_date, delivery_date, needs_production
     ) values (
       'pj', 'pj', '95000000-0000-4000-8000-0000000000a1', 'teste-pao-fase3', 'bread',
       '[TESTE] Pao Fase 3', 5, 5.00, 1, 'un',
       '95000000-0000-4000-8000-0000000000c1', '[TESTE] Cliente Fase 3 Prazo 15',
       current_date, current_date, false
     ) $$,
  '22023',
  'Este pedido já virou cobrança. Cancele a cobrança em Contas a receber antes de alterá-lo.',
  'pedido cobrado nao aceita linha nova: a edicao e recusada antes de escrever'
);

select throws_ok(
  $$ delete from public.orders where id = '95000000-0000-4000-8000-00000000e001' $$,
  '22023',
  'Este pedido já virou cobrança. Cancele a cobrança em Contas a receber antes de apagá-lo.',
  'pedido cobrado nao pode ser apagado'
);

-- Cancelar a cobrança destrava o pedido -----------------------------------

select lives_ok(
  $$ select public.cancel_receivable(
       '95000000-0000-4000-8000-00000000f001'::uuid,
       (select id from public.receivables where origin_ref = '95000000-0000-4000-8000-0000000000a1'::uuid),
       'Pedido precisa ser corrigido'
     ) $$,
  'financeiro cancela a cobranca do pedido'
);

select lives_ok(
  $$ update public.orders set quantity = 25
     where id = '95000000-0000-4000-8000-00000000e001' $$,
  'com a cobranca cancelada, o pedido volta a poder ser corrigido'
);

select ok(exists(select 1 from public.list_pj_orders_to_bill()
    where order_group_id = '95000000-0000-4000-8000-0000000000a1'::uuid),
  'pedido com cobranca cancelada volta para a lista de a faturar');

-- O caminho manual do financeiro -------------------------------------------

select is((select amount from public.list_pj_orders_to_bill()
    where order_group_id = '95000000-0000-4000-8000-0000000000a1'::uuid), 175.00,
  'a lista ja mostra o valor corrigido do pedido');

select lives_ok(
  $$ select public.create_receivable_from_pj_order(
       '95000000-0000-4000-8000-00000000f002'::uuid,
       '95000000-0000-4000-8000-0000000000a1'::uuid
     ) $$,
  'financeiro gera a cobranca pela lista'
);

select is((select amount from public.receivables
    where origin_ref = '95000000-0000-4000-8000-0000000000a1'::uuid and status <> 'cancelada'), 175.00,
  'a cobranca gerada pela lista usa o valor recalculado no banco');

-- Cliente sem prazo: o envio acontece, a cobrança não nasce ----------------

select throws_ok(
  $$ select public.create_receivable_from_pj_order(
       '95000000-0000-4000-8000-00000000f003'::uuid,
       '95000000-0000-4000-8000-0000000000a2'::uuid
     ) $$,
  '22023',
  'Este cliente ainda não tem prazo de pagamento cadastrado. Defina o prazo na tela de Clientes antes de cobrar.',
  'o financeiro recebe recado claro quando falta o prazo do cliente'
);

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000002', true);

-- A trava do financeiro nao pode parar a padaria: o envio acontece do mesmo
-- jeito, e o pedido continua aparecendo como a faturar.
select lives_ok(
  $$ select public.confirm_pj_order_dispatch('95000000-0000-4000-8000-0000000000a2'::uuid) $$,
  'cliente sem prazo nao impede a expedicao de confirmar o envio'
);

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);

select is((select count(*)::int from public.receivables
    where origin_ref = '95000000-0000-4000-8000-0000000000a2'::uuid), 0,
  'sem prazo cadastrado a cobranca nao nasce');

select ok(exists(select 1 from public.list_pj_orders_to_bill()
    where order_group_id = '95000000-0000-4000-8000-0000000000a2'::uuid),
  'e o pedido continua na lista de a faturar, esperando o prazo');

reset role;

select * from finish();
rollback;
