-- Fase 2 do peso real: a cobranca PJ passa a usar a quantidade conferida.
--
-- O que este teste protege:
--   * a cobranca sai pelo que a Expedicao conferiu, para mais e para menos;
--   * item conferido como zero sai da conta e o resto do pedido e cobrado;
--   * pedido em que nada saiu nao vira cobranca, e o envio acontece do mesmo
--     jeito: travar a Expedicao por causa do financeiro e o bloqueador 4;
--   * quantidade fora da trava de saida nao vira dinheiro;
--   * legado enviado antes de 21/08 continua pela estimativa;
--   * enviado depois do marco sem conferencia nao e cobrado por adivinhacao;
--   * o motor e a lista dao o MESMO numero para o mesmo pedido (bloqueador 2);
--   * a correcao pos-envio cancela, regrava e refaz, sem mover o carimbo do
--     envio, e recusa quando o cliente ja pagou.
--
-- Fixtures proprias, com prefixo `0f`: dois testes que dividem o mesmo pao
-- ficticio estragam um ao outro em silencio (licao de 2026-09-01, PR 308).

begin;
create extension if not exists pgtap with schema extensions;

select plan(43);

-- Cenario --------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('95000000-0000-4000-8000-00000000f001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'financeiro-fase2-real@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('95000000-0000-4000-8000-00000000f002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'expedicao-fase2-real@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('95000000-0000-4000-8000-00000000f003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'vendas-fase2-real@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('95000000-0000-4000-8000-00000000f001', 'Teste Financeiro Peso Real', 'financeiro', 'jc', true, '["/contas-receber"]'::jsonb),
  ('95000000-0000-4000-8000-00000000f002', 'Teste Expedicao Peso Real', 'expedicao', 'jc', true, '["/pedidos-pj"]'::jsonb),
  ('95000000-0000-4000-8000-00000000f003', 'Teste Vendas Peso Real', 'vendas', 'ja', true, '["/sobras"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values
  ('95000000-0000-4000-8000-00000000f001', 'contas_receber.acessar', 'jc', null),
  ('95000000-0000-4000-8000-00000000f001', 'contas_receber.lancar', 'jc', null),
  ('95000000-0000-4000-8000-00000000f001', 'contas_receber.cancelar', 'jc', null),
  ('95000000-0000-4000-8000-00000000f001', 'contas_receber.baixar', 'jc', null),
  ('95000000-0000-4000-8000-00000000f001', 'contas_receber.estornar', 'jc', null),
  ('95000000-0000-4000-8000-00000000f001', 'pedidos_pj.corrigir_quantidade', 'jc', null),
  ('95000000-0000-4000-8000-00000000f002', 'pedidos_pj.confirmar_envio', 'jc', null);

insert into public.customers (id, name, doc, payment_term_days, active)
values ('95000000-0000-4000-8000-00000000fc01', '[TESTE] Cliente Peso Real', '22333444000373', 7, true);

insert into public.breads (id, name, days, active, unit, is_special, is_shelf)
values ('teste-pao-peso-real', '[TESTE] Pao Peso Real', '{0,1,2,3,4,5,6}', true, 'un', false, false)
on conflict (id) do nothing;

-- Pedido A: duas linhas, uma por quilo e outra por unidade. E o pedido de
-- 02/09 que originou esta fase: 2 kg a 32,70 e 60 un a 6,60 = 461,40 pedido.
insert into public.orders (
  id, store, order_type, order_group_id, bread_id, product_source, product_name,
  quantity, unit_price, pack_size, pricing_unit, customer_id, pj_client,
  order_date, delivery_date, pj_delivery_date, needs_production
) values
  ('95000000-0000-4000-8000-00000000e0a1', 'pj', 'pj', '95000000-0000-4000-8000-00000000a0a1',
   'teste-pao-peso-real', 'bread', '[TESTE] Baguete Peso Real', 2, 32.70, 1, 'kg',
   '95000000-0000-4000-8000-00000000fc01', '[TESTE] Cliente Peso Real',
   private.data_na_padaria() - 1, private.data_na_padaria(), private.data_na_padaria(), false),
  ('95000000-0000-4000-8000-00000000e0a2', 'pj', 'pj', '95000000-0000-4000-8000-00000000a0a1',
   'teste-pao-peso-real', 'bread', '[TESTE] Croissant Peso Real', 60, 6.60, 1, 'un',
   '95000000-0000-4000-8000-00000000fc01', '[TESTE] Cliente Peso Real',
   private.data_na_padaria() - 1, private.data_na_padaria(), private.data_na_padaria(), false);

-- A conta da linha, antes de qualquer cobranca -------------------------------

select is(private.valor_linha_pj(2, 1.7, 32.70, now()), 55.59,
  'saiu menos: a linha vale o que saiu');
select is(private.valor_linha_pj(60, 64, 6.60, now()), 422.40,
  'saiu mais: a linha tambem vale o que saiu');
select is(private.valor_linha_pj(10, 0, 5.00, now()), 0.00,
  'zero conferido vale zero, e nao vira a estimativa');
select is(private.valor_linha_pj(3, null, 10.00, timestamptz '2026-08-15 10:00:00-03'), 30.00,
  'legado enviado antes do marco continua pela estimativa');
select is(private.valor_linha_pj(3, null, 10.00, now()), null,
  'enviado depois do marco sem conferencia nao tem valor cobravel');
select is(private.valor_linha_pj(3, null, 10.00, null), null,
  'pedido ainda nao enviado nao tem valor cobravel');
select is(private.valor_linha_pj(1, 1.067, 32.70, now()), 34.89,
  'cada linha e arredondada a centavos antes de qualquer soma');

-- A trava de saida -----------------------------------------------------------

select is(private.veredito_valor_linha_pj(3, 3.067, 'kg'), 'ok',
  'a variacao normal da padaria passa');
select is(private.veredito_valor_linha_pj(3, 3000, 'kg'), 'acima_do_teto',
  'grama digitada em campo de quilo e recusada');
select is(private.veredito_valor_linha_pj(30, 3, 'kg'), 'fora_da_faixa',
  'menos de um terco do pedido e recusado');
select is(private.veredito_valor_linha_pj(10, 40, 'un'), 'fora_da_faixa',
  'mais que o triplo do pedido e recusado');
select is(private.veredito_valor_linha_pj(100, 0, 'un'), 'ok',
  'zero nunca e recusado pela trava: e falta declarada, com motivo');

-- A cobranca sai pelo que saiu ----------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-00000000f002', true);

select lives_ok(
  $$ select public.save_pj_order_dispatch_quantities(
       '95000000-0000-4000-8000-00000000fd01'::uuid,
       '95000000-0000-4000-8000-00000000a0a1'::uuid,
       '[{"order_id":"95000000-0000-4000-8000-00000000e0a1","quantity":1.7,"reason":"saiu menos"},
         {"order_id":"95000000-0000-4000-8000-00000000e0a2","quantity":64,"reason":"rendeu mais"}]'::jsonb,
       null
     ) $$,
  'a expedicao confere 1,7 kg e 64 un'
);

select lives_ok(
  $$ select public.confirm_pj_order_dispatch('95000000-0000-4000-8000-00000000a0a1'::uuid) $$,
  'e marca o pedido como enviado'
);

reset role;

-- 1,7 x 32,70 = 55,59 e 64 x 6,60 = 422,40, somando 477,99. Pela estimativa
-- seriam 461,40: a diferenca de 16,59 e o que este trabalho existe para pegar.
select is((select amount from public.receivables
    where origin_ref = '95000000-0000-4000-8000-00000000a0a1'::uuid
      and status <> 'cancelada'), 477.99,
  'a cobranca nasce pelo que saiu, e nao pelo que foi pedido');

select is((select details->>'base_do_valor' from public.receivable_events
    where receivable_id = (select id from public.receivables
      where origin_ref = '95000000-0000-4000-8000-00000000a0a1'::uuid and status <> 'cancelada')
      and event_type = 'lancada'), 'real_enviado',
  'e fica gravado de qual numero ela nasceu, para a coorte da fase 3');

-- Pedido B: um item nao saiu, o outro saiu inteiro --------------------------

insert into public.orders (
  id, store, order_type, order_group_id, bread_id, product_source, product_name,
  quantity, unit_price, pack_size, pricing_unit, customer_id, pj_client,
  order_date, delivery_date, pj_delivery_date, needs_production
) values
  ('95000000-0000-4000-8000-00000000e0b1', 'pj', 'pj', '95000000-0000-4000-8000-00000000a0b1',
   'teste-pao-peso-real', 'bread', '[TESTE] Pao B1', 10, 5.00, 1, 'un',
   '95000000-0000-4000-8000-00000000fc01', '[TESTE] Cliente Peso Real',
   private.data_na_padaria() - 1, private.data_na_padaria(), private.data_na_padaria(), false),
  ('95000000-0000-4000-8000-00000000e0b2', 'pj', 'pj', '95000000-0000-4000-8000-00000000a0b1',
   'teste-pao-peso-real', 'bread', '[TESTE] Pao B2', 4, 20.00, 1, 'un',
   '95000000-0000-4000-8000-00000000fc01', '[TESTE] Cliente Peso Real',
   private.data_na_padaria() - 1, private.data_na_padaria(), private.data_na_padaria(), false);

set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-00000000f002', true);
select public.save_pj_order_dispatch_quantities(
  '95000000-0000-4000-8000-00000000fd02'::uuid,
  '95000000-0000-4000-8000-00000000a0b1'::uuid,
  '[{"order_id":"95000000-0000-4000-8000-00000000e0b1","quantity":10},
    {"order_id":"95000000-0000-4000-8000-00000000e0b2","quantity":0,"reason":"acabou o produto"}]'::jsonb,
  null
);
select public.confirm_pj_order_dispatch('95000000-0000-4000-8000-00000000a0b1'::uuid);
reset role;

select is((select amount from public.receivables
    where origin_ref = '95000000-0000-4000-8000-00000000a0b1'::uuid
      and status <> 'cancelada'), 50.00,
  'item nao enviado sai da conta e o resto do pedido e cobrado');

-- Pedido C: nada saiu --------------------------------------------------------

insert into public.orders (
  id, store, order_type, order_group_id, bread_id, product_source, product_name,
  quantity, unit_price, pack_size, pricing_unit, customer_id, pj_client,
  order_date, delivery_date, pj_delivery_date, needs_production
) values
  ('95000000-0000-4000-8000-00000000e0c1', 'pj', 'pj', '95000000-0000-4000-8000-00000000a0c1',
   'teste-pao-peso-real', 'bread', '[TESTE] Pao C1', 6, 9.00, 1, 'un',
   '95000000-0000-4000-8000-00000000fc01', '[TESTE] Cliente Peso Real',
   private.data_na_padaria() - 1, private.data_na_padaria(), private.data_na_padaria(), false);

set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-00000000f002', true);
select public.save_pj_order_dispatch_quantities(
  '95000000-0000-4000-8000-00000000fd03'::uuid,
  '95000000-0000-4000-8000-00000000a0c1'::uuid,
  '[{"order_id":"95000000-0000-4000-8000-00000000e0c1","quantity":0,"reason":"cliente recusou na porta"}]'::jsonb,
  null
);

-- O envio precisa acontecer mesmo assim: e o bloqueador 4, a armadilha de
-- prender a Expedicao por causa de um problema do financeiro.
select lives_ok(
  $$ select public.confirm_pj_order_dispatch('95000000-0000-4000-8000-00000000a0c1'::uuid) $$,
  'pedido em que nada saiu ainda pode ser marcado como enviado'
);
reset role;

select is((select count(*)::int from public.receivables
    where origin_ref = '95000000-0000-4000-8000-00000000a0c1'::uuid
      and status <> 'cancelada'), 0,
  'e nao vira cobranca nenhuma');

set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-00000000f001', true);
select is((select motivo_bloqueio from public.list_pj_orders_to_bill()
    where order_group_id = '95000000-0000-4000-8000-00000000a0c1'::uuid), 'nada-enviado',
  'a Elis ve o pedido na lista, com o motivo escrito');
reset role;

-- Pedido D: quantidade fora da trava de saida --------------------------------

-- O INSERT ja traz `dispatched_quantity`, e `guard_dispatched_quantity` cobre
-- INSERT tambem: sem a chave da conferencia ele recusa com 42501. Foi o que
-- derrubou este arquivo no CI Banco de 03/09.
select set_config('pane.pj_check_rpc', 'on', true);

insert into public.orders (
  id, store, order_type, order_group_id, bread_id, product_source, product_name,
  quantity, unit_price, pack_size, pricing_unit, customer_id, pj_client,
  order_date, delivery_date, pj_delivery_date, needs_production, dispatched_quantity,
  dispatched_quantity_reason, dispatched_quantity_at
) values
  ('95000000-0000-4000-8000-00000000e0d1', 'pj', 'pj', '95000000-0000-4000-8000-00000000a0d1',
   'teste-pao-peso-real', 'bread', '[TESTE] Pao D1', 3, 10.00, 1, 'kg',
   '95000000-0000-4000-8000-00000000fc01', '[TESTE] Cliente Peso Real',
   private.data_na_padaria() - 1, private.data_na_padaria(), private.data_na_padaria(), false,
   3000, 'digitou gramas no campo de quilo', now());

select set_config('pane.pj_dispatch_rpc', 'on', true);
update public.orders set dispatched_at = now(), dispatched_by_name = 'teste'
where order_group_id = '95000000-0000-4000-8000-00000000a0d1'::uuid;
select set_config('pane.pj_dispatch_rpc', '', true);
select set_config('pane.pj_check_rpc', '', true);

select is(private.build_receivable_from_pj_order(
    '95000000-0000-4000-8000-00000000a0d1'::uuid,
    '95000000-0000-4000-8000-00000000f001'::uuid), null,
  'quantidade fora da trava nao vira cobranca');

set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-00000000f001', true);
select is((select motivo_bloqueio from public.list_pj_orders_to_bill()
    where order_group_id = '95000000-0000-4000-8000-00000000a0d1'::uuid), 'fora-da-trava',
  'e o motivo aparece na lista, em vez de a cobranca sair errada');
reset role;

-- Pedido E: legado, enviado antes do marco e nunca conferido -----------------

insert into public.orders (
  id, store, order_type, order_group_id, bread_id, product_source, product_name,
  quantity, unit_price, pack_size, pricing_unit, customer_id, pj_client,
  order_date, delivery_date, pj_delivery_date, needs_production
) values
  ('95000000-0000-4000-8000-00000000e0e1', 'pj', 'pj', '95000000-0000-4000-8000-00000000a0e1',
   'teste-pao-peso-real', 'bread', '[TESTE] Pao E1', 7, 4.00, 1, 'un',
   '95000000-0000-4000-8000-00000000fc01', '[TESTE] Cliente Peso Real',
   date '2026-08-10', date '2026-08-12', date '2026-08-12', false);

select set_config('pane.pj_dispatch_rpc', 'on', true);
update public.orders
set dispatched_at = timestamptz '2026-08-12 10:00:00-03', dispatched_by_name = 'legado'
where order_group_id = '95000000-0000-4000-8000-00000000a0e1'::uuid;
select set_config('pane.pj_dispatch_rpc', '', true);
select set_config('pane.pj_check_rpc', '', true);

select isnt(private.build_receivable_from_pj_order(
    '95000000-0000-4000-8000-00000000a0e1'::uuid,
    '95000000-0000-4000-8000-00000000f001'::uuid), null,
  'legado sem conferencia continua virando cobranca');

select is((select amount from public.receivables
    where origin_ref = '95000000-0000-4000-8000-00000000a0e1'::uuid
      and status <> 'cancelada'), 28.00,
  'e pelo valor da estimativa, que e o unico numero que existe para ele');

select is((select details->>'base_do_valor' from public.receivable_events
    where receivable_id = (select id from public.receivables
      where origin_ref = '95000000-0000-4000-8000-00000000a0e1'::uuid and status <> 'cancelada')
      and event_type = 'lancada'), 'estimado_legado',
  'marcado como legado, para o relatorio da fase 3 nao misturar as duas eras');

-- Pedido F: enviado depois do marco e sem conferencia ------------------------
-- E o buraco do cancelar-e-corrigir, declarado na migration de 26/08.

insert into public.orders (
  id, store, order_type, order_group_id, bread_id, product_source, product_name,
  quantity, unit_price, pack_size, pricing_unit, customer_id, pj_client,
  order_date, delivery_date, pj_delivery_date, needs_production
) values
  ('95000000-0000-4000-8000-00000000e0f1', 'pj', 'pj', '95000000-0000-4000-8000-00000000a0f1',
   'teste-pao-peso-real', 'bread', '[TESTE] Pao F1', 5, 6.00, 1, 'un',
   '95000000-0000-4000-8000-00000000fc01', '[TESTE] Cliente Peso Real',
   private.data_na_padaria() - 1, private.data_na_padaria(), private.data_na_padaria(), false);

select set_config('pane.pj_dispatch_rpc', 'on', true);
update public.orders set dispatched_at = now(), dispatched_by_name = 'teste'
where order_group_id = '95000000-0000-4000-8000-00000000a0f1'::uuid;
select set_config('pane.pj_dispatch_rpc', '', true);
select set_config('pane.pj_check_rpc', '', true);

select is(private.build_receivable_from_pj_order(
    '95000000-0000-4000-8000-00000000a0f1'::uuid,
    '95000000-0000-4000-8000-00000000f001'::uuid), null,
  'enviado depois do marco sem conferencia nao vira cobranca por adivinhacao');

-- O motor e a lista precisam concordar --------------------------------------
-- E o bloqueador 2: a mesma conta em dois lugares e a divida que o Romaneio ja
-- cobrou caro uma vez.

-- O INSERT ja traz `dispatched_quantity`, e `guard_dispatched_quantity` cobre
-- INSERT tambem: sem a chave da conferencia ele recusa com 42501. Foi o que
-- derrubou este arquivo no CI Banco de 03/09.
select set_config('pane.pj_check_rpc', 'on', true);

insert into public.orders (
  id, store, order_type, order_group_id, bread_id, product_source, product_name,
  quantity, unit_price, pack_size, pricing_unit, customer_id, pj_client,
  order_date, delivery_date, pj_delivery_date, needs_production, dispatched_quantity,
  dispatched_quantity_at
) values
  ('95000000-0000-4000-8000-00000000e0a9', 'pj', 'pj', '95000000-0000-4000-8000-00000000a0a9',
   'teste-pao-peso-real', 'bread', '[TESTE] Pao G1', 9, 3.30, 1, 'kg',
   '95000000-0000-4000-8000-00000000fc01', '[TESTE] Cliente Peso Real',
   private.data_na_padaria() - 1, private.data_na_padaria(), private.data_na_padaria(), false,
   8.4, now());

select set_config('pane.pj_dispatch_rpc', 'on', true);
update public.orders set dispatched_at = now(), dispatched_by_name = 'teste'
where order_group_id = '95000000-0000-4000-8000-00000000a0a9'::uuid;
select set_config('pane.pj_dispatch_rpc', '', true);
select set_config('pane.pj_check_rpc', '', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-00000000f001', true);
select is((select amount from public.list_pj_orders_to_bill()
    where order_group_id = '95000000-0000-4000-8000-00000000a0a9'::uuid), 27.72,
  'a lista mostra o valor pelo que saiu (8,4 x 3,30)');
reset role;

-- Se a lista mostra valor e o motor recusa, o culpado e o motivo: esta
-- assercao aponta o dedo antes da proxima falhar sem explicacao.
select is(private.motivo_bloqueio_cobranca_pj('95000000-0000-4000-8000-00000000a0a9'::uuid), null,
  'o pedido conferido e enviado nao tem motivo de bloqueio nenhum');

-- Gera num statement proprio e confere no seguinte. Chamar a funcao dentro de
-- `where id = ...` a torna volatil dentro da comparacao: o Postgres pode
-- avalia-la por linha, e o identificador comparado muda no meio da consulta.
select private.build_receivable_from_pj_order(
  '95000000-0000-4000-8000-00000000a0a9'::uuid,
  '95000000-0000-4000-8000-00000000f001'::uuid);

select is((select amount from public.receivables
    where origin_ref = '95000000-0000-4000-8000-00000000a0a9'::uuid
      and status <> 'cancelada'), 27.72,
  'e o motor gera exatamente o mesmo numero que a lista mostrou');

-- A correcao depois do envio -------------------------------------------------

-- Guarda o carimbo do envio para comparar valor a valor depois da correcao.
-- A versao anterior deste teste so contava horarios distintos, e teria passado
-- mesmo se a funcao trocasse o carimbo de TODAS as linhas pelo mesmo horario
-- novo. Prova falsa, apontada pela revisao adversarial em 2026-09-03.
create temporary table carimbo_antes as
select id, dispatched_at, dispatched_by, dispatched_by_name, dispatched_quantity_at
from public.orders
where order_group_id = '95000000-0000-4000-8000-00000000a0a1'::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-00000000f003', true);
select throws_ok(
  $$ select public.corrigir_quantidade_enviada_pj(
       '95000000-0000-4000-8000-00000000fe01'::uuid,
       '95000000-0000-4000-8000-00000000a0a1'::uuid,
       '[{"order_id":"95000000-0000-4000-8000-00000000e0a1","dispatched_quantity":2}]'::jsonb,
       'tentativa indevida') $$,
  '42501',
  'Sem permissão para corrigir a quantidade enviada.',
  'vendas nao corrige quantidade enviada'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-00000000f001', true);
select lives_ok(
  $$ select public.corrigir_quantidade_enviada_pj(
       '95000000-0000-4000-8000-00000000fe02'::uuid,
       '95000000-0000-4000-8000-00000000a0a1'::uuid,
       '[{"order_id":"95000000-0000-4000-8000-00000000e0a1","dispatched_quantity":2.0},
         {"order_id":"95000000-0000-4000-8000-00000000e0a2","dispatched_quantity":60}]'::jsonb,
       'a balanca estava com a bandeja') $$,
  'o financeiro corrige a quantidade de um pedido ja enviado'
);
reset role;

select is((select amount from public.receivables
    where origin_ref = '95000000-0000-4000-8000-00000000a0a1'::uuid
      and status <> 'cancelada'), 461.40,
  'a cobranca e refeita pelo numero corrigido');

select is((select count(*)::int from public.receivables
    where origin_ref = '95000000-0000-4000-8000-00000000a0a1'::uuid
      and status = 'cancelada'), 1,
  'e a cobranca anterior fica cancelada no historico, nao apagada');

-- O GUC usado na correcao e chave-mestra: ele tambem abre `dispatched_at`,
-- `dispatched_by` e `dispatched_by_name`. Comparacao valor a valor com o que
-- estava gravado antes, e nao contagem de distintos.
select is((select count(*)::int
    from public.orders atual
    join carimbo_antes anterior on anterior.id = atual.id
    where atual.dispatched_at is distinct from anterior.dispatched_at
       or atual.dispatched_by is distinct from anterior.dispatched_by
       or atual.dispatched_by_name is distinct from anterior.dispatched_by_name), 0,
  'a correcao nao moveu o carimbo do envio de nenhuma linha');

-- O carimbo da conferencia NAO da para provar por avanco de horario: dentro de
-- uma transacao `now()` e congelado, entao o valor gravado pela correcao e
-- identico ao da conferencia original. O que se prova e a autoria: quem
-- corrigiu assina o registro, e e isso que a contestacao de cliente precisa.
select is((select count(*)::int from public.orders
    where order_group_id = '95000000-0000-4000-8000-00000000a0a1'::uuid
      and dispatched_quantity_by = '95000000-0000-4000-8000-00000000f001'::uuid), 2,
  'a correcao assina a conferencia com quem corrigiu');

select is((select count(*)::int from public.pj_order_quantity_checks
    where request_id = '95000000-0000-4000-8000-00000000fe02'::uuid), 2,
  'as duas linhas corrigidas ficam no historico da conferencia');

-- Repetir a mesma requisicao nao pode cancelar a cobranca recem-criada.
set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-00000000f001', true);
select is((select public.corrigir_quantidade_enviada_pj(
       '95000000-0000-4000-8000-00000000fe02'::uuid,
       '95000000-0000-4000-8000-00000000a0a1'::uuid,
       '[{"order_id":"95000000-0000-4000-8000-00000000e0a1","dispatched_quantity":1}]'::jsonb,
       'repeticao')->>'ja_aplicado'), 'true',
  'repetir a mesma requisicao nao refaz nada');
reset role;

select is((select amount from public.receivables
    where origin_ref = '95000000-0000-4000-8000-00000000a0a1'::uuid
      and status <> 'cancelada'), 461.40,
  'e a cobranca continua sendo a mesma depois da repeticao');

-- Tela desatualizada nao vence quem esta certo -------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-00000000f001', true);
select throws_ok(
  $$ select public.corrigir_quantidade_enviada_pj(
       '95000000-0000-4000-8000-00000000fe03'::uuid,
       '95000000-0000-4000-8000-00000000a0a1'::uuid,
       '[{"order_id":"95000000-0000-4000-8000-00000000e0a1","dispatched_quantity":1.9}]'::jsonb,
       'com a tela velha na mao',
       timestamptz '2020-01-01 00:00:00-03') $$,
  '40001',
  'Alguém corrigiu este pedido enquanto a tela estava aberta. Recarregue e confira antes de salvar.',
  'quem chega com a tela desatualizada e recusado, em vez de sobrescrever'
);
reset role;

-- Dinheiro que entrou fecha a janela ----------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-00000000f001', true);
select public.record_receivable_receipt(
  '95000000-0000-4000-8000-00000000fe10'::uuid,
  (select id from public.receivables
     where origin_ref = '95000000-0000-4000-8000-00000000a0a1'::uuid and status <> 'cancelada'),
  private.data_na_padaria(), 100.00, 'pix', 'banco_sicredi_jc'
);

select throws_ok(
  $$ select public.corrigir_quantidade_enviada_pj(
       '95000000-0000-4000-8000-00000000fe04'::uuid,
       '95000000-0000-4000-8000-00000000a0a1'::uuid,
       '[{"order_id":"95000000-0000-4000-8000-00000000e0a1","dispatched_quantity":1.5}]'::jsonb,
       'depois do pagamento') $$,
  '22023',
  'Este pedido já recebeu pagamento. Estorne o recebimento antes de corrigir a quantidade.',
  'cliente que ja pagou fecha a janela da correcao'
);
reset role;

-- Item que saiu e nao tem preco nao pode sumir dentro da soma ---------------

-- O INSERT ja traz `dispatched_quantity`, e `guard_dispatched_quantity` cobre
-- INSERT tambem: sem a chave da conferencia ele recusa com 42501. Foi o que
-- derrubou este arquivo no CI Banco de 03/09.
select set_config('pane.pj_check_rpc', 'on', true);

insert into public.orders (
  id, store, order_type, order_group_id, bread_id, product_source, product_name,
  quantity, unit_price, pack_size, pricing_unit, customer_id, pj_client,
  order_date, delivery_date, pj_delivery_date, needs_production, dispatched_quantity,
  dispatched_quantity_at
) values
  ('95000000-0000-4000-8000-00000000e0b8', 'pj', 'pj', '95000000-0000-4000-8000-00000000a0b8',
   'teste-pao-peso-real', 'bread', '[TESTE] Pao com preco', 10, 5.00, 1, 'un',
   '95000000-0000-4000-8000-00000000fc01', '[TESTE] Cliente Peso Real',
   private.data_na_padaria() - 1, private.data_na_padaria(), private.data_na_padaria(), false,
   10, now()),
  ('95000000-0000-4000-8000-00000000e0b9', 'pj', 'pj', '95000000-0000-4000-8000-00000000a0b8',
   'teste-pao-peso-real', 'bread', '[TESTE] Pao sem preco', 4, null, 1, 'un',
   '95000000-0000-4000-8000-00000000fc01', '[TESTE] Cliente Peso Real',
   private.data_na_padaria() - 1, private.data_na_padaria(), private.data_na_padaria(), false,
   4, now());

select set_config('pane.pj_dispatch_rpc', 'on', true);
update public.orders set dispatched_at = now(), dispatched_by_name = 'teste'
where order_group_id = '95000000-0000-4000-8000-00000000a0b8'::uuid;
select set_config('pane.pj_dispatch_rpc', '', true);
select set_config('pane.pj_check_rpc', '', true);

select throws_ok(
  $$ select private.build_receivable_from_pj_order(
       '95000000-0000-4000-8000-00000000a0b8'::uuid,
       '95000000-0000-4000-8000-00000000f001'::uuid) $$,
  '22023',
  'Pedido com item sem preço não vira cobrança. Confira a tabela de preço do cliente.',
  'item entregue sem preco recusa a cobranca, em vez de sair pela metade'
);

-- Pedido sem preco nenhum nao pode ser confundido com "nada saiu" ------------

-- O INSERT ja traz `dispatched_quantity`, e `guard_dispatched_quantity` cobre
-- INSERT tambem: sem a chave da conferencia ele recusa com 42501. Foi o que
-- derrubou este arquivo no CI Banco de 03/09.
select set_config('pane.pj_check_rpc', 'on', true);

insert into public.orders (
  id, store, order_type, order_group_id, bread_id, product_source, product_name,
  quantity, unit_price, pack_size, pricing_unit, customer_id, pj_client,
  order_date, delivery_date, pj_delivery_date, needs_production, dispatched_quantity,
  dispatched_quantity_at
) values
  ('95000000-0000-4000-8000-00000000e0ba', 'pj', 'pj', '95000000-0000-4000-8000-00000000a0ba',
   'teste-pao-peso-real', 'bread', '[TESTE] Pao todo sem preco', 6, null, 1, 'un',
   '95000000-0000-4000-8000-00000000fc01', '[TESTE] Cliente Peso Real',
   private.data_na_padaria() - 1, private.data_na_padaria(), private.data_na_padaria(), false,
   6, now());

select set_config('pane.pj_dispatch_rpc', 'on', true);
update public.orders set dispatched_at = now(), dispatched_by_name = 'teste'
where order_group_id = '95000000-0000-4000-8000-00000000a0ba'::uuid;
select set_config('pane.pj_dispatch_rpc', '', true);
select set_config('pane.pj_check_rpc', '', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-00000000f001', true);
select is((select motivo_bloqueio from public.list_pj_orders_to_bill()
    where order_group_id = '95000000-0000-4000-8000-00000000a0ba'::uuid), null,
  'pedido sem preco nao e rotulado como "nada saiu": o problema dele e outro');
reset role;

-- Perfil errado com a permissao concedida continua barrado -------------------
-- A decisao 4 do plano diz financeiro/admin. Conceder a permissao a vendas na
-- tela de usuarios nao pode abrir a porta.

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values ('95000000-0000-4000-8000-00000000f003', 'pedidos_pj.corrigir_quantidade', '*', null);

set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-00000000f003', true);
select throws_ok(
  $$ select public.corrigir_quantidade_enviada_pj(
       '95000000-0000-4000-8000-00000000fe05'::uuid,
       '95000000-0000-4000-8000-00000000a0b1'::uuid,
       '[{"order_id":"95000000-0000-4000-8000-00000000e0b1","dispatched_quantity":9}]'::jsonb,
       'vendas com a permissao marcada') $$,
  '42501',
  'Sem permissão para corrigir a quantidade enviada.',
  'permissao concede, mas o perfil delimita: vendas segue barrado'
);
reset role;

select * from finish();
rollback;
