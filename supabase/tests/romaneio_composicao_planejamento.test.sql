begin;
create extension if not exists pgtap with schema extensions;

select plan(29);

select ok(
  has_function_privilege(
    'authenticated',
    'public.get_romaneio_production_composition(date, text)',
    'execute'
  ),
  'Expedicao autenticada pode consultar a composicao do Romaneio'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.get_romaneio_production_composition(date, text)',
    'execute'
  ),
  'Anonimo nao pode consultar a composicao do Romaneio'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  (
    '93000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'composicao-admin-test@example.com',
    '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, false
  ),
  (
    '93000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'composicao-expedicao-jc-test@example.com',
    '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, false
  ),
  (
    '93000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'composicao-romaneio-ex-test@example.com',
    '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, false
  );

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('93000000-0000-4000-8000-000000000001', 'Composicao Admin', 'admin', null, true, '["*"]'::jsonb),
  ('93000000-0000-4000-8000-000000000002', 'Composicao Expedicao JC', 'expedicao', 'jc', true, '["/romaneio"]'::jsonb),
  ('93000000-0000-4000-8000-000000000003', 'Composicao Romaneio EX', 'expedicao', 'ex', true, '["/romaneio"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values
  ('93000000-0000-4000-8000-000000000001', 'romaneio.visualizar', '*', null),
  ('93000000-0000-4000-8000-000000000001', 'romaneio.criar', '*', null),
  ('93000000-0000-4000-8000-000000000002', 'romaneio.visualizar', '*', null),
  ('93000000-0000-4000-8000-000000000002', 'romaneio.criar', '*', null),
  ('93000000-0000-4000-8000-000000000003', 'romaneio.visualizar', 'ex', null);

select set_config('test.admin_id', '93000000-0000-4000-8000-000000000001', false);
select set_config('test.expedicao_jc_id', '93000000-0000-4000-8000-000000000002', false);
select set_config('test.romaneio_ex_id', '93000000-0000-4000-8000-000000000003', false);

insert into public.production_plans (
  id, production_date, status, created_by, created_by_name
)
select
  '70000000-0000-4000-8000-000000000001',
  private.data_na_padaria() + 60,
  'aguardando_geolar',
  current_setting('test.admin_id')::uuid,
  'Teste composicao'
;

-- Pao, congelado e estoque exclusivos deste teste. Antes ele reservava 5
-- congeladas da baguete do seed, e a trava de saldo passou a somar as reservas
-- de TODOS os planejamentos com data a partir de hoje. O planejamento semeado ja
-- reservava as mesmas 5, entao o total estourava o estoque. A colisao so
-- aparecia no banco compartilhado, porque o planejamento do seed so nasce
-- quando existem contas no Auth, e o ensaio das PRs roda sem elas.
insert into public.breads (id, name, days, active, unit, is_special, is_shelf)
values
  ('teste-baguete-composicao', '[TESTE] Baguete Composicao',
    '{0,1,2,3,4,5,6}', true, 'un', false, false),
  ('teste-sobra-composicao', '[TESTE] Pao So Sobra Composicao',
    '{0,1,2,3,4,5,6}', true, 'un', false, false);

insert into public.frozen_products (
  id, product_id, product_source, product_name, unit, active, store, visible_stores
) values (
  '73000000-0000-4000-8000-000000000001', 'teste-baguete-composicao', 'bread',
  '[TESTE] Baguete Composicao', 'un', true, 'jc', array['jc']::text[]
);

insert into public.frozen_stock (id, frozen_product_id, location, quantity)
values (
  '73000000-0000-4000-8000-000000000002',
  '73000000-0000-4000-8000-000000000001',
  'jc-freezer-composicao-test',
  5
);

-- A JC ja virou pedido (order_created_at preenchido pela importacao); a JA
-- ficou so no Planejamento, como em 10/10/2026.
insert into public.production_plan_items (
  id, plan_id, store, bread_id, planned_quantity, frozen_quantity,
  leftover_proposed_quantity, leftover_confirmed_quantity,
  order_created_at, order_created_by_name
)
values
  (
    '71000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001',
    'jc',
    'teste-baguete-composicao',
    10,
    5,
    2,
    null,
    now(),
    'Teste composicao'
  ),
  (
    '71000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000001',
    'ja',
    'teste-baguete-composicao',
    7,
    0,
    0,
    null,
    null,
    null
  ),
  -- Pao so de sobra: nao tem pao novo, entao nunca vira pedido sozinho.
  (
    '71000000-0000-4000-8000-000000000003',
    '70000000-0000-4000-8000-000000000001',
    'ja',
    'teste-sobra-composicao',
    3,
    0,
    3,
    null,
    null,
    null
  );

insert into public.bread_reuse_plans (
  id, target_production_date, store, bread_id, proposed_quantity,
  confirmed_quantity, status, proposed_by, proposed_by_name
)
select
  '72000000-0000-4000-8000-000000000001',
  private.data_na_padaria() + 60,
  'jc',
  'teste-baguete-composicao',
  2,
  2,
  'confirmed',
  current_setting('test.admin_id')::uuid,
  'Teste composicao'
;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  current_setting('test.expedicao_jc_id'),
  true
);

select is(
  (select planned_quantity from public.get_romaneio_production_composition(private.data_na_padaria() + 60, 'jc') where bread_id = 'teste-baguete-composicao'),
  10::numeric,
  'Expedicao recebe o total planejado'
);
select is(
  (select frozen_quantity from public.get_romaneio_production_composition(private.data_na_padaria() + 60, 'jc') where bread_id = 'teste-baguete-composicao'),
  5::numeric,
  'Expedicao recebe a quantidade congelada'
);
select is(
  (select leftover_quantity from public.get_romaneio_production_composition(private.data_na_padaria() + 60, 'jc') where bread_id = 'teste-baguete-composicao'),
  2::numeric,
  'Expedicao recebe a sobra confirmada'
);
select is(
  (select new_quantity from public.get_romaneio_production_composition(private.data_na_padaria() + 60, 'jc') where bread_id = 'teste-baguete-composicao'),
  3::numeric,
  'Expedicao recebe a producao nova residual'
);

select set_config(
  'request.jwt.claim.sub',
  current_setting('test.romaneio_ex_id'),
  true
);
select throws_ok(
  $$ select * from public.get_romaneio_production_composition(private.data_na_padaria() + 60, 'jc') $$,
  '42501',
  'Sem permissão para consultar a composição desta loja.',
  'Expedicao EX nao consulta a composicao de JC'
);

select throws_ok(
  $$ select * from public.get_romaneio_production_composition(private.data_na_padaria() + 60, 'ex') $$,
  '22023',
  'Data ou loja inválida para a composição do Romaneio.',
  'EX nao usa o planejamento de JC e JA'
);

select set_config(
  'request.jwt.claim.sub',
  current_setting('test.admin_id'),
  true
);
select is(
  (select new_quantity from public.get_romaneio_production_composition(private.data_na_padaria() + 60, 'jc') where bread_id = 'teste-baguete-composicao'),
  3::numeric,
  'Admin tambem recebe a composicao residual'
);

select set_config(
  'request.jwt.claim.sub',
  current_setting('test.expedicao_jc_id'),
  true
);
select throws_ok(
  $$ select * from public.get_romaneio_production_composition(null::date, 'jc') $$,
  '22023',
  'Data ou loja inválida para a composição do Romaneio.',
  'Data ausente e rejeitada'
);

-- Pedido editado depois de gerado pelo Planejamento (08/10/2026: a JC baixou o
-- gorgonzola de 8 para 4). O Romaneio soma o pao novo do pedido com o congelado
-- e a sobra da composicao; para isso a Expedicao precisa ler o pedido editado e
-- a composicao nao pode mudar nem sumir quando o pedido muda.
select set_config('request.jwt.claim.sub', current_setting('test.admin_id'), true);
select is(
  (select (public.import_production_plan_order(
    '70000000-0000-4000-8000-000000000001', 'jc', 'Teste composicao'
  )->>'order_count')::integer),
  1,
  'Gerar o pedido da JC pelo Planejamento cria o pedido da Baguete'
);

select set_config('request.jwt.claim.sub', current_setting('test.expedicao_jc_id'), true);
select is(
  (select sum(quantity) from public.orders
   where store = 'jc' and order_date = private.data_na_padaria() + 60
     and bread_id = 'teste-baguete-composicao' and cancelled_at is null),
  3::numeric,
  'O pedido gerado leva so o pao novo: 10 planejadas menos 5 congeladas menos 2 sobras'
);

-- Edicao pela tela de Pedidos: apaga o pedido da loja no dia e grava de novo.
reset role;
delete from public.orders
where store = 'jc' and order_date = private.data_na_padaria() + 60;
insert into public.orders (store, bread_id, quantity, order_date, order_type, obs)
select 'jc', 'teste-baguete-composicao', 1, private.data_na_padaria() + 60, 'producao', 'Gerado pelo Planejamento';

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.expedicao_jc_id'), true);
select is(
  (select sum(quantity) from public.orders
   where store = 'jc' and order_date = private.data_na_padaria() + 60
     and bread_id = 'teste-baguete-composicao' and cancelled_at is null),
  1::numeric,
  'Expedicao JC le o pedido editado depois da conversao'
);
select results_eq(
  $$ select planned_quantity, frozen_quantity, leftover_quantity
     from public.get_romaneio_production_composition(private.data_na_padaria() + 60, 'jc')
     where bread_id = 'teste-baguete-composicao' $$,
  $$ values (10::numeric, 5::numeric, 2::numeric) $$,
  'Pedido editado: congelado e sobra continuam chegando ao Romaneio da JC'
);

reset role;
update public.orders
set cancelled_at = now(), cancelled_by = 'Teste composicao', cancel_reason = 'Teste composicao'
where store = 'jc' and order_date = private.data_na_padaria() + 60;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.expedicao_jc_id'), true);
select results_eq(
  $$ select frozen_quantity, leftover_quantity
     from public.get_romaneio_production_composition(private.data_na_padaria() + 60, 'jc')
     where bread_id = 'teste-baguete-composicao' $$,
  $$ values (5::numeric, 2::numeric) $$,
  'Pedido cancelado depois da conversao: o Romaneio ainda recebe congelado e sobra'
);

-- Planejamento sem pedido gerado nao vira numero no Romaneio.
select is(
  (select count(*)::int from public.get_romaneio_production_composition(private.data_na_padaria() + 60, 'ja')),
  0,
  'Planejamento da JA que nao virou pedido nao chega ao Romaneio'
);
select ok(
  public.get_romaneio_plan_without_order(private.data_na_padaria() + 60, 'ja'),
  'Expedicao fica sabendo que a JA tem planejamento sem pedido'
);
select ok(
  not public.get_romaneio_plan_without_order(private.data_na_padaria() + 60, 'jc'),
  'JC ja virou pedido: nenhum aviso de planejamento pendente'
);
select ok(
  not public.get_romaneio_plan_without_order(private.data_na_padaria() + 61, 'ja'),
  'Dia sem planejamento: nenhum aviso'
);

select set_config(
  'request.jwt.claim.sub',
  current_setting('test.romaneio_ex_id'),
  true
);
select throws_ok(
  $$ select public.get_romaneio_plan_without_order(private.data_na_padaria() + 60, 'jc') $$,
  '42501',
  'Sem permissão para consultar o Planejamento desta loja.',
  'Expedicao EX nao consulta o planejamento de JC'
);
select throws_ok(
  $$ select public.get_romaneio_plan_without_order(private.data_na_padaria() + 60, 'ex') $$,
  '22023',
  'Data ou loja inválida para o Planejamento do Romaneio.',
  'EX nao tem planejamento de JC e JA'
);

select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$ select public.get_romaneio_plan_without_order(private.data_na_padaria() + 60, 'ja') $$,
  '42501',
  'Entre com e-mail para consultar o Planejamento do Romaneio.',
  'Sem login nao consulta o planejamento'
);

-- Gerar o pedido da JA faz o Planejamento voltar ao Romaneio e o aviso sumir.
reset role;
update public.production_plan_items
set order_created_at = now(), order_created_by_name = 'Teste composicao'
where id = '71000000-0000-4000-8000-000000000002';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  current_setting('test.expedicao_jc_id'),
  true
);
select is(
  (select planned_quantity from public.get_romaneio_production_composition(private.data_na_padaria() + 60, 'ja') where bread_id = 'teste-baguete-composicao'),
  7::numeric,
  'Depois do pedido gerado, o Romaneio da JA recebe o planejado'
);
select ok(
  not public.get_romaneio_plan_without_order(private.data_na_padaria() + 60, 'ja'),
  'Depois do pedido gerado, o aviso da JA some'
);

-- Planejamento fechado nao avisa, mesmo com item sem pedido.
reset role;
update public.production_plan_items
set order_created_at = null, order_created_by_name = null
where id = '71000000-0000-4000-8000-000000000002';
update public.production_plans
set status = 'fechado'
where id = '70000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  current_setting('test.expedicao_jc_id'),
  true
);
select ok(
  not public.get_romaneio_plan_without_order(private.data_na_padaria() + 60, 'ja'),
  'Planejamento fechado nao gera aviso'
);
select is(
  (select count(*)::int from public.get_romaneio_production_composition(private.data_na_padaria() + 60, 'ja')),
  0,
  'Fechar o planejamento nao devolve ao Romaneio o pao que nao virou pedido (caso de 10/10)'
);

-- Loja so com congelado e sobra nao tem o que virar pedido: segue no Romaneio.
reset role;
update public.production_plans
set status = 'aguardando_geolar'
where id = '70000000-0000-4000-8000-000000000001';
update public.production_plan_items
set planned_quantity = 0
where id = '71000000-0000-4000-8000-000000000002';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  current_setting('test.expedicao_jc_id'),
  true
);
select is(
  (select planned_quantity from public.get_romaneio_production_composition(private.data_na_padaria() + 60, 'ja') where bread_id = 'teste-sobra-composicao'),
  3::numeric,
  'Loja so com sobra continua com a composicao no Romaneio'
);
select ok(
  not public.get_romaneio_plan_without_order(private.data_na_padaria() + 60, 'ja'),
  'Loja so com sobra nao gera aviso de pedido pendente'
);

reset role;
select ok(
  has_function_privilege('authenticated', 'public.get_romaneio_plan_without_order(date, text)', 'execute')
  and not has_function_privilege('anon', 'public.get_romaneio_plan_without_order(date, text)', 'execute'),
  'Aviso de planejamento: autenticado consulta, anonimo nao'
);

select * from finish();
rollback;
