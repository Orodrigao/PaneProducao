-- Quantidade realmente enviada em Pedidos PJ, fase 1: a conferência.
--
-- O que este teste protege:
--   * os três estados são distinguíveis: não conferido (null), não enviado
--     (zero, com motivo) e enviado (positivo);
--   * as duas travas, e a diferença entre elas: 20% pede motivo, 3x recusa;
--   * fração em item vendido por unidade é recusada;
--   * "marcar como enviado" só passa com tudo conferido;
--   * a mesma requisição repetida não grava duas vezes;
--   * tela desatualizada é recusada em vez de sobrescrever;
--   * quem não é da Expedição JC não confere;
--   * **a cobrança desta fase continua saindo pela ESTIMATIVA** — é a
--     asserção que separa a fase 1 da fase 2.

begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

-- Cenário ------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('96000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'expedicao-conferencia-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('96000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'vendas-ja-conferencia-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('96000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'financeiro-conferencia-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('96000000-0000-4000-8000-000000000001', 'Teste Expedicao JC', 'expedicao', 'jc', true, '["/pedidos-pj"]'::jsonb),
  ('96000000-0000-4000-8000-000000000002', 'Teste Vendas JA', 'vendas', 'ja', true, '["/pedidos"]'::jsonb),
  ('96000000-0000-4000-8000-000000000003', 'Teste Financeiro Conf', 'financeiro', 'jc', true, '["/contas-receber"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values
  ('96000000-0000-4000-8000-000000000001', 'pedidos_pj.acessar', 'jc', null),
  ('96000000-0000-4000-8000-000000000001', 'pedidos_pj.confirmar_envio', 'jc', null),
  ('96000000-0000-4000-8000-000000000003', 'contas_receber.acessar', 'jc', null),
  ('96000000-0000-4000-8000-000000000003', 'contas_receber.lancar', 'jc', null);

insert into public.customers (id, name, doc, payment_term_days, active)
values ('96000000-0000-4000-8000-0000000000c1', '[TESTE] Cliente Conferencia', '33444555000191', 15, true);

insert into public.breads (id, name, days, active, unit, is_special, is_shelf)
values
  ('teste-croissant-conf', '[TESTE] Mini-croissant Conf', '{0,1,2,3,4,5,6}', true, 'kg', false, false),
  ('teste-cachorro-conf', '[TESTE] Pao Cachorro Conf', '{0,1,2,3,4,5,6}', true, 'un', false, false)
on conflict (id) do nothing;

-- Um pedido com duas linhas, uma por quilo e outra por unidade.
--   * 3 kg de mini-croissant a R$ 40,00/kg  = R$ 120,00
--   * 50 paes a R$ 2,00/un                  = R$ 100,00
--   Estimativa total: R$ 220,00
insert into public.orders (
  id, store, order_type, order_group_id, bread_id, product_source, product_name,
  quantity, unit_price, pack_size, pricing_unit, customer_id, pj_client,
  order_date, delivery_date, pj_delivery_date, needs_production
) values
  ('96000000-0000-4000-8000-0000000000e1', 'jc', 'pj', '96000000-0000-4000-8000-0000000000a1',
   'teste-croissant-conf', 'bread', '[TESTE] Mini-croissant Conf',
   3, 40, 1, 'kg', '96000000-0000-4000-8000-0000000000c1', '[TESTE] Cliente Conferencia',
   current_date - 1, current_date - 1, current_date - 1, false),
  ('96000000-0000-4000-8000-0000000000e2', 'jc', 'pj', '96000000-0000-4000-8000-0000000000a1',
   'teste-cachorro-conf', 'bread', '[TESTE] Pao Cachorro Conf',
   50, 2, 1, 'un', '96000000-0000-4000-8000-0000000000c1', '[TESTE] Cliente Conferencia',
   current_date - 1, current_date - 1, current_date - 1, false);

-- Um segundo pedido, para provar que sem conferencia nao se envia.
-- `orders` tem unique em (store, bread_id, order_date), entao este pedido usa
-- outra data: mesmo pao, mesma loja e mesmo dia colidiriam com o de cima.
insert into public.orders (
  id, store, order_type, order_group_id, bread_id, product_source, product_name,
  quantity, unit_price, pack_size, pricing_unit, customer_id, pj_client,
  order_date, delivery_date, pj_delivery_date, needs_production
) values
  ('96000000-0000-4000-8000-0000000000e3', 'jc', 'pj', '96000000-0000-4000-8000-0000000000a2',
   'teste-croissant-conf', 'bread', '[TESTE] Mini-croissant Conf',
   2, 40, 1, 'kg', '96000000-0000-4000-8000-0000000000c1', '[TESTE] Cliente Conferencia',
   current_date - 3, current_date - 2, current_date - 2, false);


-- A trava, isolada -----------------------------------------------------------
-- A regra de plausibilidade vive numa função só, para que entrada e saída
-- nunca divirjam quando a fase 2 chamar a mesma função.

select is(private.veredito_quantidade_enviada(3, 3.067, 'kg'), 'ok',
  'a diferenca real do dia a dia passa sem pedir nada');
select is(private.veredito_quantidade_enviada(3, 3.7, 'kg'), 'exige_motivo',
  'acima de 20% pede motivo escrito');
select is(private.veredito_quantidade_enviada(3, 3000, 'kg'), 'recusado',
  'gramas digitadas no campo de quilo sao recusadas, nao confirmadas');
select is(private.veredito_quantidade_enviada(3, 0.5, 'kg'), 'recusado',
  'abaixo de um terco tambem e recusa: a trava vale nos dois sentidos');
select is(private.veredito_quantidade_enviada(50, 55.5, 'un'), 'recusado',
  'nao existe meio pao: item por unidade recusa fracao');
select is(private.veredito_quantidade_enviada(50, 0, 'un'), 'exige_motivo',
  'zero e decisao declarada, nao desvio: pede motivo, mas nao e recusa');


-- Quem pode conferir ---------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000002', true);

select throws_ok(
  $$ select public.save_pj_order_dispatch_quantities(
       '96000000-0000-4000-8000-00000000f001'::uuid,
       '96000000-0000-4000-8000-0000000000a1'::uuid,
       '[{"order_id":"96000000-0000-4000-8000-0000000000e1","quantity":3}]'::jsonb,
       null
     ) $$,
  '42501',
  'Sem permissão para conferir este pedido.',
  'vendas da JA nao confere pedido da expedicao JC'
);

reset role;


-- A conferência propriamente dita --------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000001', true);

-- Fora do teto: recusado mesmo com motivo escrito. E a diferenca entre a trava
-- que se vence por confirmacao e a que ninguem vence.
select throws_ok(
  $$ select public.save_pj_order_dispatch_quantities(
       '96000000-0000-4000-8000-00000000f002'::uuid,
       '96000000-0000-4000-8000-0000000000a1'::uuid,
       '[{"order_id":"96000000-0000-4000-8000-0000000000e1","quantity":3000,"reason":"tenho certeza"}]'::jsonb,
       null
     ) $$,
  '22023',
  null,
  'motivo escrito nao compra passagem para 3000 kg no lugar de 3 kg'
);

-- Acima de 20% sem motivo: recusado.
select throws_ok(
  $$ select public.save_pj_order_dispatch_quantities(
       '96000000-0000-4000-8000-00000000f003'::uuid,
       '96000000-0000-4000-8000-0000000000a1'::uuid,
       '[{"order_id":"96000000-0000-4000-8000-0000000000e1","quantity":2.0}]'::jsonb,
       null
     ) $$,
  '22023',
  null,
  'diferenca grande sem motivo nao grava'
);

-- Zero sem motivo: recusado.
select throws_ok(
  $$ select public.save_pj_order_dispatch_quantities(
       '96000000-0000-4000-8000-00000000f004'::uuid,
       '96000000-0000-4000-8000-0000000000a1'::uuid,
       '[{"order_id":"96000000-0000-4000-8000-0000000000e2","quantity":0}]'::jsonb,
       null
     ) $$,
  '22023',
  null,
  'item nao enviado sem motivo nao grava: a falta nao pode virar numero mudo'
);

-- Nada foi gravado pelas tentativas recusadas.
select is((select count(*)::int from public.pj_order_quantity_checks
    where order_group_id = '96000000-0000-4000-8000-0000000000a1'::uuid), 0,
  'tentativa recusada nao deixa historico');

-- Agora a conferencia valida: 3,067 kg (dentro da faixa) e 55 un (com motivo).
select lives_ok(
  $$ select public.save_pj_order_dispatch_quantities(
       '96000000-0000-4000-8000-00000000f005'::uuid,
       '96000000-0000-4000-8000-0000000000a1'::uuid,
       '[{"order_id":"96000000-0000-4000-8000-0000000000e1","quantity":3.067},
         {"order_id":"96000000-0000-4000-8000-0000000000e2","quantity":55,"reason":"a massa rendeu mais"}]'::jsonb,
       null
     ) $$,
  'a conferencia normal do dia a dia grava sem atrito'
);

select is((select dispatched_quantity from public.orders
    where id = '96000000-0000-4000-8000-0000000000e1'), 3.067::numeric,
  'o peso real fica gravado na linha');

select is((select count(*)::int from public.pj_order_quantity_checks
    where order_group_id = '96000000-0000-4000-8000-0000000000a1'::uuid), 2,
  'cada linha conferida gera uma entrada de historico');

-- Repetir a MESMA requisicao nao grava de novo.
select lives_ok(
  $$ select public.save_pj_order_dispatch_quantities(
       '96000000-0000-4000-8000-00000000f005'::uuid,
       '96000000-0000-4000-8000-0000000000a1'::uuid,
       '[{"order_id":"96000000-0000-4000-8000-0000000000e1","quantity":9},
         {"order_id":"96000000-0000-4000-8000-0000000000e2","quantity":10,"reason":"outro"}]'::jsonb,
       null
     ) $$,
  'repetir a mesma requisicao devolve o estado atual em vez de falhar'
);

select is((select dispatched_quantity from public.orders
    where id = '96000000-0000-4000-8000-0000000000e1'), 3.067::numeric,
  'e o toque duplo nao sobrescreve o que ja estava gravado');

select is((select count(*)::int from public.pj_order_quantity_checks
    where order_group_id = '96000000-0000-4000-8000-0000000000a1'::uuid), 2,
  'nem cria historico falso');

-- Tela desatualizada: a versao esperada nao bate mais.
select throws_ok(
  $$ select public.save_pj_order_dispatch_quantities(
       '96000000-0000-4000-8000-00000000f006'::uuid,
       '96000000-0000-4000-8000-0000000000a1'::uuid,
       '[{"order_id":"96000000-0000-4000-8000-0000000000e1","quantity":3.1}]'::jsonb,
       null
     ) $$,
  '40001',
  null,
  'quem abriu a tela antes da gravacao alheia e mandado recarregar, nao vence por chegar depois'
);


-- "Marcar como enviado" exige tudo conferido ---------------------------------

-- O segundo pedido nao tem nenhuma linha conferida.
select throws_ok(
  $$ select public.confirm_pj_order_dispatch('96000000-0000-4000-8000-0000000000a2'::uuid) $$,
  '22023',
  null,
  'pedido sem conferencia nao pode ser marcado como enviado'
);

-- E o primeiro, ja conferido inteiro, pode.
select lives_ok(
  $$ select public.confirm_pj_order_dispatch('96000000-0000-4000-8000-0000000000a1'::uuid) $$,
  'com tudo conferido o envio passa'
);

reset role;


-- A FRONTEIRA DA FASE 1 ------------------------------------------------------
-- Esta e a assercao que separa a fase 1 da fase 2. Se ela quebrar, alguem
-- ligou o dinheiro ao numero conferido antes da hora.

set local role authenticated;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000003', true);

-- Conferido: 3,067 kg x R$ 40 + 55 un x R$ 2 = R$ 232,68
-- Estimado:      3 kg x R$ 40 + 50 un x R$ 2 = R$ 220,00
select is(
  (select amount from public.receivables
   where origin = 'pedido_pj'
     and origin_ref = '96000000-0000-4000-8000-0000000000a1'::uuid
     and status <> 'cancelada'),
  220.00::numeric,
  'FRONTEIRA DA FASE 1: a cobranca sai pela ESTIMATIVA (220,00), nunca pelo conferido (232,68)'
);

select ok(
  exists(
    select 1 from public.pj_dispatch_adoption_stats(current_date - 30)
    where totalmente_conferidos >= 1 and com_diferenca >= 1
  ),
  'o contador de adocao enxerga o pedido conferido e sinaliza que houve diferenca'
);

reset role;


-- Pedido ja cobrado nao aceita mais conferencia ------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$ select public.save_pj_order_dispatch_quantities(
       '96000000-0000-4000-8000-00000000f007'::uuid,
       '96000000-0000-4000-8000-0000000000a1'::uuid,
       '[{"order_id":"96000000-0000-4000-8000-0000000000e1","quantity":3.2}]'::jsonb,
       null
     ) $$,
  '22023',
  null,
  'pedido ja enviado recusa conferencia nova, em vez de reescrever o que saiu'
);

-- A fila da expedicao devolve os dois numeros.
select ok(
  exists(
    select 1 from public.list_pj_orders_for_dispatch()
    where id = '96000000-0000-4000-8000-0000000000e1'
      and quantity = 3
      and dispatched_quantity = 3.067
  ),
  'a fila mostra o pedido e o conferido lado a lado'
);

reset role;

select * from finish();
rollback;
