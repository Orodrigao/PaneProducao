-- Regressao da correcao pontual de classificacao operacional do Baguete Rocca
-- e da Focaccia Tomate (migration 20260912185323). As duas linhas reais so
-- existem em producao, entao o teste reproduz ao pe da letra as mesmas
-- atualizacoes contra fixtures locais que espelham o nome e o estado
-- auditado, sem tocar supabase/seed.sql. Cobre tambem homonimos com estado
-- diferente (nao podem ser alcancados) e a fila/agendamento reais da
-- Producao PJ antes e depois da correcao.
begin;
create extension if not exists pgtap with schema extensions;

-- Este contrato monta pedidos manualmente para isolar a classificacao dos
-- produtos; por isso reproduz deliberadamente o caminho anterior ao corte.
update private.pj_flow_rollout_settings
set state = 'preparing', cutover_at = null, updated_at = clock_timestamp()
where singleton;

select plan(21);

-- Fixtures que reproduzem o estado auditado em producao em 2026-09-12.
insert into public.products (id, name, is_fabricacao_propria, production_area,
    production_process, allows_planned_production, allows_unplanned_production)
values
  ('95000000-0000-4000-8000-000000000001', 'Baguete Rocca', true, 'padaria', null, null, null),
  ('95000000-0000-4000-8000-000000000002', 'Focaccia Tomate', false, null, null, null, null);

-- Homonimo do Baguete Rocca que nao bate com o estado auditado (nunca foi
-- marcado como fabricacao propria): precisa continuar fora da correcao.
insert into public.products (id, name, is_fabricacao_propria, production_area,
    production_process, allows_planned_production, allows_unplanned_production)
values
  ('95000000-0000-4000-8000-000000000003', 'Baguete Rocca', false, null, null, null, null);

-- Homonimo da Focaccia Tomate ja classificado de outro jeito: a correcao nao
-- pode sobrescrever uma classificacao legitima ja existente.
insert into public.products (id, name, is_fabricacao_propria, production_area,
    production_process, allows_planned_production, allows_unplanned_production)
values
  ('95000000-0000-4000-8000-000000000004', 'Focaccia Tomate', true, 'cozinha', 'montagem', true, true);

-- Outro produto legado com o mesmo padrao de estado do Baguete Rocca
-- (fabricacao propria, padaria, sem classificacao), nome diferente: prova que
-- a correcao mira o nome confirmado, nao qualquer produto no mesmo padrao.
insert into public.products (id, name, is_fabricacao_propria, production_area,
    production_process, allows_planned_production, allows_unplanned_production)
values
  ('95000000-0000-4000-8000-000000000005', '[TESTE] Pao Legado Generico', true, 'padaria', null, null, null);

-- Homonima adversarial da Focaccia Tomate: ainda marcada como revenda
-- (is_fabricacao_propria false) e sem processo/flags, mas com area ja
-- preenchida por outra classificacao legitima. O where do update precisa
-- exigir production_area is null, senao esse homonimo seria sobrescrito
-- para Padaria junto com a Focaccia Tomate real.
insert into public.products (id, name, is_fabricacao_propria, production_area,
    production_process, allows_planned_production, allows_unplanned_production)
values
  ('95000000-0000-4000-8000-000000000006', 'Focaccia Tomate', false, 'expedicao', null, null, null);

-- Reproducao literal das duas atualizacoes de
-- supabase/migrations/20260912185323_corrigir_classificacao_baguete_focaccia_pj.sql.
select lives_ok(
  $$update public.products
    set production_process = 'forno',
        allows_planned_production = true,
        allows_unplanned_production = false
    where name = 'Baguete Rocca'
      and is_fabricacao_propria is true
      and production_area = 'padaria'
      and production_process is null
      and allows_planned_production is null
      and allows_unplanned_production is null$$,
  'a atualizacao do Baguete Rocca nao viola nenhuma constraint');

select is((select production_process from public.products where id = '95000000-0000-4000-8000-000000000001'),
  'forno', 'Baguete Rocca passa a apontar para o Forno');
select is((select production_area from public.products where id = '95000000-0000-4000-8000-000000000001'),
  'padaria', 'Baguete Rocca permanece da Padaria');
select is((select allows_planned_production from public.products where id = '95000000-0000-4000-8000-000000000001'),
  true, 'Baguete Rocca aceita producao planejada');
select is((select allows_unplanned_production from public.products where id = '95000000-0000-4000-8000-000000000001'),
  false, 'Baguete Rocca nao aceita lancamento livre');

select is((select is_fabricacao_propria from public.products where id = '95000000-0000-4000-8000-000000000003'),
  false, 'homonimo do Baguete Rocca sem fabricacao propria fica fora da correcao');
select is((select production_process from public.products where id = '95000000-0000-4000-8000-000000000005'),
  null, 'produto de nome diferente com o mesmo padrao de estado nao e alcancado');

select lives_ok(
  $$update public.products
    set is_fabricacao_propria = true,
        production_area = 'padaria',
        production_process = 'forno',
        allows_planned_production = true,
        allows_unplanned_production = false
    where name = 'Focaccia Tomate'
      and is_fabricacao_propria is false
      and production_area is null
      and production_process is null
      and allows_planned_production is null
      and allows_unplanned_production is null$$,
  'a atualizacao da Focaccia Tomate nao viola nenhuma constraint');

select is((select production_process from public.products where id = '95000000-0000-4000-8000-000000000002'),
  'forno', 'Focaccia Tomate passa a apontar para o Forno');
select is((select production_area from public.products where id = '95000000-0000-4000-8000-000000000002'),
  'padaria', 'Focaccia Tomate permanece da Padaria');
select is((select allows_planned_production from public.products where id = '95000000-0000-4000-8000-000000000002'),
  true, 'Focaccia Tomate aceita producao planejada');
select is((select allows_unplanned_production from public.products where id = '95000000-0000-4000-8000-000000000002'),
  false, 'Focaccia Tomate nao aceita lancamento livre');

select is((select production_process from public.products where id = '95000000-0000-4000-8000-000000000004'),
  'montagem', 'homonima da Focaccia Tomate ja classificada na cozinha nao e sobrescrita');
select is((select production_area from public.products where id = '95000000-0000-4000-8000-000000000004'),
  'cozinha', 'area da homonima ja classificada permanece intacta');

select is((select production_area from public.products where id = '95000000-0000-4000-8000-000000000006'),
  'expedicao', 'homonima adversarial com area ja preenchida nao e sobrescrita para Padaria');

-- Prova viva na fila e no agendamento reais da Producao PJ, como a Geolar usa.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values (
  '95000000-0000-4000-8000-00000000f001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'admin-classificacao-pj-test@example.com',
  '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
  now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values ('95000000-0000-4000-8000-00000000f001', 'Admin Producao PJ Teste', 'admin', null, true, '["/pedidos-pj"]'::jsonb);

insert into public.orders (
  id, store, bread_id, product_source, product_name, quantity,
  order_type, pj_client, pj_delivery_date, pricing_unit
) values
  ('95000000-0000-4000-8000-00000000a001', 'jc', '95000000-0000-4000-8000-000000000001', 'product',
   'Baguete Rocca', 5, 'pj', 'Cliente Teste PJ', private.data_na_padaria() + 3, 'un'),
  ('95000000-0000-4000-8000-00000000a002', 'jc', '95000000-0000-4000-8000-000000000002', 'product',
   'Focaccia Tomate', 5, 'pj', 'Cliente Teste PJ', private.data_na_padaria() + 3, 'un');

set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-00000000f001', true);

select is(
  (select mapping_error from public.list_pj_production_queue_v2()
   where order_id = '95000000-0000-4000-8000-00000000a001'),
  null, 'fila PJ nao aponta erro de mapeamento para o Baguete Rocca corrigido');
select is(
  (select mapping_error from public.list_pj_production_queue_v2()
   where order_id = '95000000-0000-4000-8000-00000000a002'),
  null, 'fila PJ nao aponta erro de mapeamento para a Focaccia Tomate corrigida');

select is(
  (select (public.schedule_pj_production(
     private.data_na_padaria(),
     jsonb_build_array(jsonb_build_object('order_id', '95000000-0000-4000-8000-00000000a001', 'quantity', 5)),
     '95000000-0000-4000-8000-00000000b001'::uuid
   )->>'scheduled_count')::int),
  1, 'Geolar programa producao planejada do Baguete Rocca corrigido');
select is(
  (select (public.schedule_pj_production(
     private.data_na_padaria(),
     jsonb_build_array(jsonb_build_object('order_id', '95000000-0000-4000-8000-00000000a002', 'quantity', 5)),
     '95000000-0000-4000-8000-00000000b002'::uuid
   )->>'scheduled_count')::int),
  1, 'Geolar programa producao planejada da Focaccia Tomate corrigida');

-- Dente: revertendo a classificacao do Baguete Rocca ao estado anterior (como
-- se a migration nunca tivesse rodado), a fila e o agendamento devem voltar a
-- recusar o produto com o mesmo erro do relato original da Geolar.
reset role;

update public.products
set production_process = null,
    allows_planned_production = null,
    allows_unplanned_production = null
where id = '95000000-0000-4000-8000-000000000001';

insert into public.orders (
  id, store, bread_id, product_source, product_name, quantity,
  order_type, pj_client, order_date, pj_delivery_date, pricing_unit
) values (
  '95000000-0000-4000-8000-00000000a003', 'jc', '95000000-0000-4000-8000-000000000001', 'product',
  'Baguete Rocca', 5, 'pj', 'Cliente Teste PJ', private.data_na_padaria() + 1, private.data_na_padaria() + 3, 'un'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-00000000f001', true);

select is(
  (select mapping_error from public.list_pj_production_queue_v2()
   where order_id = '95000000-0000-4000-8000-00000000a003'),
  'Produto sem classificacao operacional para producao.',
  'revertendo a classificacao, a fila volta a bloquear o Baguete Rocca com o erro original');
select throws_ok(
  $$select public.schedule_pj_production(
      private.data_na_padaria(),
      jsonb_build_array(jsonb_build_object('order_id', '95000000-0000-4000-8000-00000000a003', 'quantity', 5)),
      '95000000-0000-4000-8000-00000000b003'::uuid
    )$$,
  '22023', 'Produto sem classificacao operacional para producao.',
  'sem a correcao aplicada, a programacao planejada volta a ser recusada');

select * from finish();
rollback;
