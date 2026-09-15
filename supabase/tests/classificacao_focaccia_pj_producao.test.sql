-- Regressao da migration 20260915012306 (Fase 2 do peso medio no Forno):
-- classifica Focaccia Alecrim kg e Focaccia Azeitonas kg para producao no
-- Forno. As duas linhas reais so existem em producao (ids fixos, ligadas a
-- tabelas de preco ativas), entao o teste reproduz ao pe da letra a mesma
-- atualizacao contra fixtures locais que espelham o id e o estado auditado,
-- sem tocar supabase/seed.sql. Cobre tambem produto com o mesmo padrao de
-- estado mas id diferente (nao pode ser alcancado) e a fila/agendamento reais
-- da Producao PJ antes e depois da correcao.
begin;
create extension if not exists pgtap with schema extensions;

update private.pj_flow_rollout_settings
set state = 'preparing', cutover_at = null, updated_at = clock_timestamp()
where singleton;

select plan(11);

-- Fixtures que reproduzem o estado auditado em producao em 2026-09-15.
insert into public.products (id, name, is_fabricacao_propria, production_area,
    production_process, allows_planned_production, allows_unplanned_production, unit, is_pj, active, kind)
values
  ('95100000-0000-4000-8000-000000000001', 'Focaccia Alecrim kg', true, 'padaria', null, null, null, 'kg', true, true, 'final'),
  ('95100000-0000-4000-8000-000000000002', 'Focaccia Azeitonas kg', true, 'padaria', null, null, null, 'kg', true, true, 'final');

-- Outro produto no mesmo padrao de estado (fabricacao propria, padaria, sem
-- classificacao), id diferente: prova que a correcao mira os ids confirmados,
-- nao qualquer produto no mesmo padrao.
insert into public.products (id, name, is_fabricacao_propria, production_area,
    production_process, allows_planned_production, allows_unplanned_production, unit, is_pj, active, kind)
values
  ('95100000-0000-4000-8000-000000000003', '[TESTE] Focaccia Generica kg', true, 'padaria', null, null, null, 'kg', true, true, 'final');

-- Reproducao literal da atualizacao de
-- supabase/migrations/20260915012306_classificar_focaccia_pj_para_producao.sql.
select lives_ok(
  $$update public.products
    set production_process = 'forno',
        allows_planned_production = true,
        allows_unplanned_production = false
    where id in ('95100000-0000-4000-8000-000000000001', '95100000-0000-4000-8000-000000000002')
      and is_fabricacao_propria is true
      and production_area = 'padaria'
      and production_process is null
      and allows_planned_production is null
      and allows_unplanned_production is null$$,
  'a atualizacao da Focaccia PJ nao viola nenhuma constraint');

select is((select production_process from public.products where id = '95100000-0000-4000-8000-000000000001'),
  'forno', 'Focaccia Alecrim kg passa a apontar para o Forno');
select is((select allows_planned_production from public.products where id = '95100000-0000-4000-8000-000000000001'),
  true, 'Focaccia Alecrim kg aceita producao planejada');
select is((select allows_unplanned_production from public.products where id = '95100000-0000-4000-8000-000000000001'),
  false, 'Focaccia Alecrim kg nao aceita lancamento livre');

select is((select production_process from public.products where id = '95100000-0000-4000-8000-000000000002'),
  'forno', 'Focaccia Azeitonas kg passa a apontar para o Forno');
select is((select allows_planned_production from public.products where id = '95100000-0000-4000-8000-000000000002'),
  true, 'Focaccia Azeitonas kg aceita producao planejada');

select is((select production_process from public.products where id = '95100000-0000-4000-8000-000000000003'),
  null, 'produto com o mesmo padrao de estado e id diferente nao e alcancado');

-- Prova viva na fila e no agendamento reais da Producao PJ, como a Geolar usa.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values (
  '95100000-0000-4000-8000-00000000f001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'admin-focaccia-pj-test@example.com',
  '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
  now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values ('95100000-0000-4000-8000-00000000f001', 'Admin Focaccia PJ Teste', 'admin', null, true, '["/pedidos-pj"]'::jsonb);

insert into public.orders (
  id, store, bread_id, product_source, product_name, quantity,
  order_type, pj_client, order_date, pj_delivery_date, pricing_unit
) values (
  '95100000-0000-4000-8000-00000000a001', 'jc', '95100000-0000-4000-8000-000000000001', 'product',
  'Focaccia Alecrim kg', 1.8, 'pj', 'Cliente Teste PJ', private.data_na_padaria(), private.data_na_padaria() + 3, 'kg'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '95100000-0000-4000-8000-00000000f001', true);

select is(
  (select mapping_error from public.list_pj_production_queue_v2()
   where order_id = '95100000-0000-4000-8000-00000000a001'),
  null, 'fila PJ nao aponta erro de mapeamento para a Focaccia Alecrim kg corrigida');

select is(
  (select (public.schedule_pj_production(
     private.data_na_padaria(),
     jsonb_build_array(jsonb_build_object('order_id', '95100000-0000-4000-8000-00000000a001', 'quantity', 1.8)),
     '95100000-0000-4000-8000-00000000b001'::uuid
   )->>'scheduled_count')::int),
  1, 'Geolar programa producao planejada da Focaccia Alecrim kg corrigida');

-- Dente: revertendo a classificacao ao estado anterior (como se a migration
-- nunca tivesse rodado), a fila e o agendamento devem voltar a recusar o
-- produto com o mesmo erro do relato original.
reset role;

update public.products
set production_process = null,
    allows_planned_production = null,
    allows_unplanned_production = null
where id = '95100000-0000-4000-8000-000000000002';

insert into public.orders (
  id, store, bread_id, product_source, product_name, quantity,
  order_type, pj_client, order_date, pj_delivery_date, pricing_unit
) values (
  '95100000-0000-4000-8000-00000000a002', 'jc', '95100000-0000-4000-8000-000000000002', 'product',
  'Focaccia Azeitonas kg', 1.2, 'pj', 'Cliente Teste PJ', private.data_na_padaria(), private.data_na_padaria() + 3, 'kg'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '95100000-0000-4000-8000-00000000f001', true);

select is(
  (select mapping_error from public.list_pj_production_queue_v2()
   where order_id = '95100000-0000-4000-8000-00000000a002'),
  'Produto sem classificacao operacional para producao.',
  'sem a correcao, a fila bloqueia a Focaccia Azeitonas kg com o erro original');
select throws_ok(
  $$select public.schedule_pj_production(
      private.data_na_padaria(),
      jsonb_build_array(jsonb_build_object('order_id', '95100000-0000-4000-8000-00000000a002', 'quantity', 1.2)),
      '95100000-0000-4000-8000-00000000b002'::uuid
    )$$,
  '22023', 'Produto sem classificacao operacional para producao.',
  'sem a correcao aplicada, a programacao planejada volta a ser recusada');

select * from finish();
rollback;
