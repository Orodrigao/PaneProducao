-- Tabela Buck com data de validade (migration 20261016131454).
--
-- O que o teste protege:
--   * toda gravacao na Tabela Buck vira historico, com a data certa:
--     troca de preco vale de hoje, primeiro preco preenche o buraco,
--     unidade corrige o periodo vigente, remocao e exclusao tiram o preco de
--     hoje em diante, e mudar a identidade da linha e recusado;
--   * a carga inicial reescreve o comeco so das linhas que estao exatamente
--     como foram medidas, e rodar de novo nao duplica nada;
--   * a conta da cobranca usa o preco do dia de cada romaneio e separa uma
--     linha por preco; a lista e a confirmacao concordam na composicao;
--   * a cobranca confirmada guarda os dois precos;
--   * o Fechamento EX le a mesma conta, e so quem ja le a Tabela Buck e os
--     romaneios da EX consegue; o historico com autor fica so para admin e
--     financeiro, e ninguem escreve nele direto.
--
-- Semana usada: 07/09 a 13/09/2026, longe das datas relativas a "hoje" que o
-- seed grava na EX.

begin;
create extension if not exists pgtap with schema extensions;

select plan(54);

-- Cenario ------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('98100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'financeiro-historico-buck-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('98100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'relatorio-ex-historico-buck-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('98100000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'expedicao-ex-historico-buck-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('98100000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'vendas-ja-historico-buck-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('98100000-0000-4000-8000-000000000001', 'Teste Financeiro Historico Buck', 'financeiro', 'jc', true, '["/contas-receber", "/relatorios"]'::jsonb),
  -- Como a Marselle: le o Fechamento EX, sem ser do financeiro.
  ('98100000-0000-4000-8000-000000000002', 'Teste Relatorio EX Historico Buck', 'vendas', 'ex', true, '["/relatorios", "/relatorios/romaneios"]'::jsonb),
  ('98100000-0000-4000-8000-000000000003', 'Teste Expedicao EX Historico Buck', 'expedicao', 'ex', true, '["/romaneio"]'::jsonb),
  ('98100000-0000-4000-8000-000000000004', 'Teste Vendas JA Historico Buck', 'vendas', 'ja', true, '["/sobras"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values
  ('98100000-0000-4000-8000-000000000001', 'contas_receber.acessar', 'jc', null),
  ('98100000-0000-4000-8000-000000000001', 'contas_receber.lancar', 'jc', null),
  ('98100000-0000-4000-8000-000000000001', 'relatorios.acessar', '*', null),
  ('98100000-0000-4000-8000-000000000001', 'romaneio.visualizar', 'ex', null),
  ('98100000-0000-4000-8000-000000000002', 'relatorios.acessar', '*', null),
  ('98100000-0000-4000-8000-000000000002', 'romaneio.acessar', '*', null),
  ('98100000-0000-4000-8000-000000000002', 'romaneio.visualizar', 'ex', null),
  ('98100000-0000-4000-8000-000000000003', 'romaneio.acessar', 'ex', null),
  ('98100000-0000-4000-8000-000000000003', 'romaneio.visualizar', 'ex', null);

insert into public.customers (id, name, payment_term_days, active)
select '98100000-0000-4000-8000-0000000000c1', 'Buck', 15, true
where not exists (select 1 from public.customers c where lower(trim(c.name)) = 'buck');

update public.customers set payment_term_days = 15
where lower(trim(name)) = 'buck' and payment_term_days is null;

insert into public.destinations (id, name, code, type, requires_conferencia, active)
select '98100000-0000-4000-8000-0000000000e1', '[TESTE] Exposicao', 'EX', 'loja', true, true
where not exists (select 1 from public.destinations d where upper(d.code) = 'EX' and d.active);

-- O seed traz a sua tabela BUCK. Este cenario monta a propria; tudo volta
-- atras no rollback do fim.
delete from public.price_tier_items
where tier_id in (select id from public.price_tiers where lower(trim(name)) = 'buck');
delete from public.price_tiers where lower(trim(name)) = 'buck';

insert into public.price_tiers (id, name, description, active)
values ('98100000-0000-4000-8000-0000000000a0', 'BUCK', 'Tabela de teste do historico', true);

insert into public.breads (id, name, days, active, unit, is_special, is_shelf)
values
  ('teste-hist-italiano', 'Italiano', '{0,1,2,3,4,5,6}', true, 'un', false, false),
  ('teste-hist-azeitonas', 'Pão de Azeitonas', '{0,1,2,3,4,5,6}', true, 'un', false, false),
  ('teste-hist-queijo', 'Italiano de Queijo e Oregano', '{0,1,2,3,4,5,6}', true, 'un', false, false),
  ('teste-hist-tapioca', 'Pão de Tapioca', '{0,1,2,3,4,5,6}', true, 'un', false, false),
  ('teste-hist-pao', '[TESTE] Pao Historico', '{0,1,2,3,4,5,6}', true, 'un', false, false),
  ('teste-hist-novo', '[TESTE] Pao Novo Historico', '{0,1,2,3,4,5,6}', true, 'un', false, false)
on conflict (id) do nothing;

-- Linhas como em producao: nome, unidade e preco atual.
insert into public.price_tier_items (
  id, tier_id, product_id, product_source, product_name, unit_price, pricing_unit, pack_size, active
) values
  ('98100000-0000-4000-8000-0000000000a1', '98100000-0000-4000-8000-0000000000a0',
   'teste-hist-italiano', 'bread', 'Italiano', 5.89, 'un', 1, true),
  ('98100000-0000-4000-8000-0000000000a2', '98100000-0000-4000-8000-0000000000a0',
   'teste-hist-azeitonas', 'bread', 'Pão de Azeitonas', 12.32, 'un', 1, true),
  ('98100000-0000-4000-8000-0000000000a3', '98100000-0000-4000-8000-0000000000a0',
   'teste-hist-queijo', 'bread', 'Italiano de Queijo e Oregano', 11.00, 'un', 1, true),
  -- Preco atual diferente do medido: a carga nao mexe nesta.
  ('98100000-0000-4000-8000-0000000000a4', '98100000-0000-4000-8000-0000000000a0',
   'teste-hist-tapioca', 'bread', 'Pão de Tapioca', 6.50, 'un', 1, true);

-- 1. Carga inicial -----------------------------------------------------------

-- O gatilho ja gravou o cadastro; a carga parte de linhas sem historico, como
-- em producao no dia da migration.
delete from public.buck_price_history
where price_tier_item_id in (
  '98100000-0000-4000-8000-0000000000a1', '98100000-0000-4000-8000-0000000000a2',
  '98100000-0000-4000-8000-0000000000a3', '98100000-0000-4000-8000-0000000000a4'
);

select is(private.buck_historico_carga_inicial(), 3,
  'a carga aplica as tres trocas cujas linhas estao como foram medidas');

select is(
  (select unit_price from private.buck_preco_na_data('98100000-0000-4000-8000-0000000000a1', date '2026-10-08')),
  4.50::numeric, 'Italiano custava 4,50 ate 08/10');
select is(
  (select unit_price from private.buck_preco_na_data('98100000-0000-4000-8000-0000000000a1', date '2026-10-09')),
  5.89::numeric, 'Italiano custa 5,89 a partir de 09/10');
select is(
  (select unit_price from private.buck_preco_na_data('98100000-0000-4000-8000-0000000000a2', date '2026-09-01')),
  9.50::numeric, 'Pao de Azeitonas custava 9,50 em setembro');
select is(
  (select unit_price from private.buck_preco_na_data('98100000-0000-4000-8000-0000000000a3', date '2026-09-30')),
  7.50::numeric, 'Italiano de Queijo e Oregano custava 7,50 ate 30/09');
select is(
  (select unit_price from private.buck_preco_na_data('98100000-0000-4000-8000-0000000000a3', date '2026-10-01')),
  11.00::numeric, 'Italiano de Queijo e Oregano custa 11,00 a partir de 01/10');
select is(
  (select unit_price from private.buck_preco_na_data('98100000-0000-4000-8000-0000000000a4', date '2026-09-01')),
  6.50::numeric, 'linha que nao bate com a medicao fica com o preco atual desde sempre');

select is(private.buck_historico_carga_inicial(), 0, 'rodar a carga de novo nao aplica nada');
select is(
  (select count(*)::int from public.buck_price_history
    where price_tier_item_id in (
      '98100000-0000-4000-8000-0000000000a1', '98100000-0000-4000-8000-0000000000a2',
      '98100000-0000-4000-8000-0000000000a3', '98100000-0000-4000-8000-0000000000a4')),
  10, 'nem duplica registros: 3 linhas com tres registros e uma com um');

-- 2. Gatilho da tabela -------------------------------------------------------

-- A tela salva a cada tecla e gravacoes da mesma pessoa em ate 10 minutos sao
-- uma edicao so. Para separar acoes, o teste empurra para tras o horario dos
-- registros da linha, como se a edicao anterior tivesse terminado ha uma hora.
create function pg_temp.encerrar_edicao(p_item uuid) returns void language sql as $$
  update public.buck_price_history set created_at = created_at - interval '1 hour'
  where price_tier_item_id = p_item;
$$;

insert into public.price_tier_items (
  id, tier_id, product_id, product_source, product_name, unit_price, pricing_unit, pack_size, active
) values
  ('98100000-0000-4000-8000-0000000000a5', '98100000-0000-4000-8000-0000000000a0',
   'teste-hist-pao', 'bread', '[TESTE] Pao Historico', 2.00, 'un', 1, true),
  -- Como a tela inclui: preco zero, preenchido depois.
  ('98100000-0000-4000-8000-0000000000a6', '98100000-0000-4000-8000-0000000000a0',
   'teste-hist-novo', 'bread', '[TESTE] Pao Novo Historico', 0, 'un', 1, true);

select is(
  (select event || '/' || valid_from from public.buck_price_history
    where price_tier_item_id = '98100000-0000-4000-8000-0000000000a5' order by seq desc limit 1),
  'cadastro/2000-01-01', 'produto que nunca teve preco na Buck vale desde sempre');

select pg_temp.encerrar_edicao('98100000-0000-4000-8000-0000000000a5');
update public.price_tier_items set unit_price = 2.50 where id = '98100000-0000-4000-8000-0000000000a5';

select is(
  (select event || '/' || (valid_from = private.data_na_padaria()) from public.buck_price_history
    where price_tier_item_id = '98100000-0000-4000-8000-0000000000a5' order by seq desc limit 1),
  'troca_de_preco/true', 'troca de um preco por outro vale de hoje');
select is(
  (select unit_price from private.buck_preco_na_data('98100000-0000-4000-8000-0000000000a5', private.data_na_padaria() - 1)),
  2.00::numeric, 'ontem continua com o preco antigo');
select is(
  (select unit_price from private.buck_preco_na_data('98100000-0000-4000-8000-0000000000a5', private.data_na_padaria())),
  2.50::numeric, 'hoje ja vale o preco novo');

update public.price_tier_items set pack_size = 2 where id = '98100000-0000-4000-8000-0000000000a5';

select is(
  (select count(*)::int from public.buck_price_history where price_tier_item_id = '98100000-0000-4000-8000-0000000000a5'),
  2, 'mudar so o pacote nao gera registro');

-- Na mesma edicao: apagar o campo grava zero antes do valor novo.
update public.price_tier_items set unit_price = 0 where id = '98100000-0000-4000-8000-0000000000a5';
update public.price_tier_items set unit_price = 3.10 where id = '98100000-0000-4000-8000-0000000000a5';

select is(
  (select unit_price from private.buck_preco_na_data('98100000-0000-4000-8000-0000000000a5', private.data_na_padaria())),
  3.10::numeric, 'apagar e digitar de novo termina no preco digitado, de hoje');
select is(
  (select unit_price from private.buck_preco_na_data('98100000-0000-4000-8000-0000000000a5', private.data_na_padaria() - 1)),
  2.00::numeric, 'e o passado nao muda');

-- Primeiro preco digitado tecla a tecla: "12,32" chega como 1, 12, 12.3, 12.32.
update public.price_tier_items set unit_price = 1 where id = '98100000-0000-4000-8000-0000000000a6';
update public.price_tier_items set unit_price = 12 where id = '98100000-0000-4000-8000-0000000000a6';
update public.price_tier_items set unit_price = 12.3 where id = '98100000-0000-4000-8000-0000000000a6';
update public.price_tier_items set unit_price = 12.32 where id = '98100000-0000-4000-8000-0000000000a6';

select is(
  (select unit_price from private.buck_preco_na_data('98100000-0000-4000-8000-0000000000a6', date '2026-09-08')),
  12.32::numeric, 'o primeiro preco digitado tecla a tecla destrava o passado com o valor inteiro, nao com o primeiro digito');
select is(
  (select unit_price from private.buck_preco_na_data('98100000-0000-4000-8000-0000000000a6', private.data_na_padaria())),
  12.32::numeric, 'e vale hoje tambem');

-- Remocao numa edicao nova tira o preco de hoje em diante.
select pg_temp.encerrar_edicao('98100000-0000-4000-8000-0000000000a6');
update public.price_tier_items set active = false where id = '98100000-0000-4000-8000-0000000000a6';

select is(
  (select unit_price from private.buck_preco_na_data('98100000-0000-4000-8000-0000000000a6', private.data_na_padaria())),
  null::numeric, 'remover tira o preco de hoje em diante');
select is(
  (select unit_price from private.buck_preco_na_data('98100000-0000-4000-8000-0000000000a6', private.data_na_padaria() - 1)),
  12.32::numeric, 'mas ontem continua com preco');

-- Remocao feita em 01/10; reativar em outro dia, com preco novo, preenche
-- desde a remocao e nao mexe no que veio antes.
update public.buck_price_history set valid_from = date '2026-10-01'
where seq = (select max(seq) from public.buck_price_history where price_tier_item_id = '98100000-0000-4000-8000-0000000000a6');
select pg_temp.encerrar_edicao('98100000-0000-4000-8000-0000000000a6');
update public.price_tier_items set active = true, unit_price = 13 where id = '98100000-0000-4000-8000-0000000000a6';

select is(
  (select event || '/' || valid_from || '/' || unit_price from public.buck_price_history
    where price_tier_item_id = '98100000-0000-4000-8000-0000000000a6' order by seq desc limit 1),
  'primeiro_preco/2026-10-01/13', 'reativar preenche desde a remocao');
select is(
  (select unit_price from private.buck_preco_na_data('98100000-0000-4000-8000-0000000000a6', date '2026-09-30')),
  12.32::numeric, 'antes da remocao continua o preco antigo');

select pg_temp.encerrar_edicao('98100000-0000-4000-8000-0000000000a6');
update public.price_tier_items set pricing_unit = 'kg' where id = '98100000-0000-4000-8000-0000000000a6';

select is(
  (select event || '/' || valid_from from public.buck_price_history
    where price_tier_item_id = '98100000-0000-4000-8000-0000000000a6' order by seq desc limit 1),
  'troca_de_unidade/2026-10-01', 'troca de unidade corrige o periodo vigente, desde o seu comeco');

select throws_ok(
  $$ update public.price_tier_items set product_id = 'teste-hist-outro' where id = '98100000-0000-4000-8000-0000000000a6' $$,
  '22023',
  'Uma linha da Tabela Buck não muda de produto nem de tabela. Remova a linha e inclua o produto certo.',
  'mudar o produto de uma linha da Buck e recusado'
);

-- Apagar a opcao de venda poe null na linha (ON DELETE SET NULL): permitido.
select lives_ok(
  $$ update public.price_tier_items set sale_option_id = null where id = '98100000-0000-4000-8000-0000000000a6' $$,
  'opcao de venda apagada nao trava a linha da Buck'
);

select pg_temp.encerrar_edicao('98100000-0000-4000-8000-0000000000a6');
delete from public.price_tier_items where id = '98100000-0000-4000-8000-0000000000a6';

select is(
  (select event || '/' || coalesce(unit_price::text, 'sem preco') from public.buck_price_history
    where price_tier_item_id = '98100000-0000-4000-8000-0000000000a6' order by seq desc limit 1),
  'exclusao/sem preco', 'excluir a linha deixa registro, e o historico fica');

insert into public.price_tier_items (
  id, tier_id, product_id, product_source, product_name, unit_price, pricing_unit, pack_size, active
) values (
  '98100000-0000-4000-8000-0000000000a6', '98100000-0000-4000-8000-0000000000a0',
  'teste-hist-novo', 'bread', '[TESTE] Pao Novo Historico', 20, 'un', 1, true
);

select is(
  (select unit_price from private.buck_preco_na_data('98100000-0000-4000-8000-0000000000a6', date '2026-09-30')),
  12.32::numeric, 'incluir de novo a mesma linha nao apaga o passado: vale de hoje');

-- Ponte pao legado <-> produto: o romaneio grava o produto unificado e a Buck
-- tinha o preco no pao legado. Incluir hoje uma linha direta do produto nao
-- muda o preco das semanas que ja passaram.
insert into public.products (id, name, category, active, unit, kind, is_pj, legacy_bread_id)
values ('98100000-0000-4000-8000-0000000000c2', '[TESTE] Pao Unificado Historico', 'PAES', true, 'un', 'final', false, 'teste-hist-legado');

insert into public.price_tier_items (
  id, tier_id, product_id, product_source, product_name, unit_price, pricing_unit, pack_size, active
) values (
  '98100000-0000-4000-8000-0000000000a7', '98100000-0000-4000-8000-0000000000a0',
  'teste-hist-legado', 'bread', '[TESTE] Pao Legado Historico', 5.00, 'un', 1, true
);

insert into public.romaneios (id, destination_id, record_date, trip_number, status, created_by)
select '98100000-0000-4000-8000-0000000000b3', d.id, date '2026-09-15', 1, 'enviado', 'Teste'
from public.destinations d where upper(d.code) = 'EX' and d.active order by d.id limit 1;

insert into public.romaneio_items (id, romaneio_id, product_id, product_source, product_name, qty_sent, qty_accepted)
values ('98100000-0000-4000-8000-0000000000d4', '98100000-0000-4000-8000-0000000000b3',
        '98100000-0000-4000-8000-0000000000c2', 'product', '[TESTE] Pao Unificado Historico', 10, null);

insert into public.price_tier_items (
  id, tier_id, product_id, product_source, product_name, unit_price, pricing_unit, pack_size, active
) values (
  '98100000-0000-4000-8000-0000000000a8', '98100000-0000-4000-8000-0000000000a0',
  '98100000-0000-4000-8000-0000000000c2', 'product', '[TESTE] Pao Unificado Historico', 0, 'un', 1, true
);
update public.price_tier_items set unit_price = 7 where id = '98100000-0000-4000-8000-0000000000a8';

select is(
  (select event || '/' || (valid_from = private.data_na_padaria()) from public.buck_price_history
    where price_tier_item_id = '98100000-0000-4000-8000-0000000000a8' order by seq limit 1),
  'cadastro/true', 'linha nova de produto que ja tinha preco pela ponte vale de hoje');
select is(
  (select total from private.calcular_cobranca_buck_detalhada(date '2026-09-14', date '2026-09-20')
    where product_id = '98100000-0000-4000-8000-0000000000c2'),
  50.00::numeric, 'a semana de 14/09 continua com o preco do pao legado: 10 x 5,00');

-- 3. A conta pelo preco do dia ----------------------------------------------

-- Troca no meio da semana de 07/09: Italiano 4,50 ate 09/09 e 5,00 depois.
insert into public.buck_price_history (
  price_tier_item_id, tier_id, product_source, product_id, product_name,
  unit_price, pricing_unit, valid_from, event, origin, created_by_name
) values (
  '98100000-0000-4000-8000-0000000000a1', '98100000-0000-4000-8000-0000000000a0',
  'bread', 'teste-hist-italiano', 'Italiano', 5.00, 'un', date '2026-09-10',
  'troca_de_preco', 'migracao', 'Teste'
);
-- E a troca de 09/10 volta a valer depois (registro mais recente).
insert into public.buck_price_history (
  price_tier_item_id, tier_id, product_source, product_id, product_name,
  unit_price, pricing_unit, valid_from, event, origin, created_by_name
) values (
  '98100000-0000-4000-8000-0000000000a1', '98100000-0000-4000-8000-0000000000a0',
  'bread', 'teste-hist-italiano', 'Italiano', 5.89, 'un', date '2026-10-09',
  'troca_de_preco', 'migracao', 'Teste'
);

insert into public.romaneios (id, destination_id, record_date, trip_number, status, created_by)
select romaneio.id, d.id, romaneio.record_date, 1, 'enviado', 'Teste'
from (values
  ('98100000-0000-4000-8000-0000000000b1'::uuid, date '2026-09-08'),
  ('98100000-0000-4000-8000-0000000000b2'::uuid, date '2026-09-11')
) as romaneio(id, record_date)
cross join lateral (
  select id from public.destinations where upper(code) = 'EX' and active order by id limit 1
) d;

insert into public.romaneio_items (id, romaneio_id, product_id, product_source, product_name, qty_sent, qty_accepted)
values
  ('98100000-0000-4000-8000-0000000000d1', '98100000-0000-4000-8000-0000000000b1',
   'teste-hist-italiano', 'bread', 'Italiano', 10, null),
  ('98100000-0000-4000-8000-0000000000d2', '98100000-0000-4000-8000-0000000000b2',
   'teste-hist-italiano', 'bread', 'Italiano', 20, null),
  ('98100000-0000-4000-8000-0000000000d3', '98100000-0000-4000-8000-0000000000b2',
   'teste-hist-azeitonas', 'bread', 'Pão de Azeitonas', 4, null);

select is(
  (select string_agg(produto || ' ' || quantidade || ' x ' || preco_unitario || ' = ' || total, ' | '
                     order by produto, preco_unitario)
     from private.calcular_cobranca_buck_detalhada(date '2026-09-07', date '2026-09-13')),
  'Italiano 10 x 4.5 = 45.00 | Italiano 20 x 5 = 100.00 | Pão de Azeitonas 4 x 9.5 = 38.00',
  'cada romaneio paga o preco do seu dia; o Italiano vira duas linhas'
);

select is(
  private.buck_hash_composicao((
    select jsonb_agg(to_jsonb(d) order by d.preco_unitario desc)
    from private.calcular_cobranca_buck_detalhada(date '2026-09-07', date '2026-09-13') d)),
  private.buck_hash_composicao((
    select jsonb_agg(to_jsonb(d) order by d.preco_unitario asc)
    from private.calcular_cobranca_buck_detalhada(date '2026-09-07', date '2026-09-13') d)),
  'a composicao nao depende da ordem das linhas que empatam no produto'
);

-- 4. Lista, confirmacao e foto -----------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '98100000-0000-4000-8000-000000000001', true);

select is(
  (select amount from public.list_buck_weeks_to_bill() where period_start = '2026-09-07'),
  183.00::numeric, 'a semana aparece com 45,00 + 100,00 + 38,00'
);
select is(
  (select linhas from public.list_buck_weeks_to_bill() where period_start = '2026-09-07'),
  3, 'com tres linhas'
);
select is(
  (select count(*)::int from public.preview_receivable_from_romaneio(date '2026-09-07', date '2026-09-13') where produto = 'Italiano'),
  2, 'a previa da tela mostra as duas linhas do Italiano'
);

select lives_ok(
  format(
    $$ select public.create_buck_weekly_receivable(
         '98100000-0000-4000-8000-0000000000f1', date '2026-09-07', date '2026-09-13',
         %s, %L, '[]'::jsonb) $$,
    (select amount from public.list_buck_weeks_to_bill() where period_start = '2026-09-07'),
    (select composicao from public.list_buck_weeks_to_bill() where period_start = '2026-09-07')
  ),
  'confirmar a semana com a composicao da lista funciona'
);

reset role;

select is(
  (select string_agg(linha.product_name || ' ' || linha.preco_unitario, ' | ' order by linha.product_name, linha.preco_unitario)
     from public.receivable_romaneio_lines linha
     join public.receivables cobranca on cobranca.id = linha.receivable_id
    where cobranca.request_id = '98100000-0000-4000-8000-0000000000f1'),
  'Italiano 4.5 | Italiano 5 | Pão de Azeitonas 9.5',
  'a foto da cobranca guarda os dois precos do Italiano'
);
select is(
  (select amount from public.receivables where request_id = '98100000-0000-4000-8000-0000000000f1'),
  183.00::numeric, 'e o valor cobrado e a soma das linhas'
);

-- Trocar o preco depois nao mexe no que foi cobrado.
update public.price_tier_items set unit_price = 7.00 where id = '98100000-0000-4000-8000-0000000000a1';

select is(
  (select sum(linha.total) from public.receivable_romaneio_lines linha
     join public.receivables cobranca on cobranca.id = linha.receivable_id
    where cobranca.request_id = '98100000-0000-4000-8000-0000000000f1'),
  183.00::numeric, 'troca de preco depois da cobranca nao muda a foto'
);
select is(
  (select sum(total) from private.calcular_cobranca_buck_detalhada(date '2026-09-07', date '2026-09-13')),
  183.00::numeric, 'nem a conta da semana passada, porque a troca vale de hoje'
);

-- 5. Fechamento EX -----------------------------------------------------------

select ok(
  not has_function_privilege('anon', 'public.list_romaneio_ex_billing(date, date)', 'execute')
  and has_function_privilege('authenticated', 'public.list_romaneio_ex_billing(date, date)', 'execute'),
  'anonimo nao chama o Fechamento EX; logado chama e a funcao decide'
);

set local role authenticated;

select set_config('request.jwt.claim.sub', '98100000-0000-4000-8000-000000000002', true);
select is(
  (select sum(total) from public.list_romaneio_ex_billing(date '2026-09-07', date '2026-09-13')),
  183.00::numeric, 'quem le o Fechamento EX (como a Marselle) ve a conta pelo preco do dia'
);
select is(
  (select count(*)::int from public.buck_price_history), 0,
  'mas nao le o historico com autor e motivo'
);

select set_config('request.jwt.claim.sub', '98100000-0000-4000-8000-000000000001', true);
select is(
  (select count(*)::int from public.list_romaneio_ex_billing(date '2026-09-07', date '2026-09-13')),
  3, 'o financeiro tambem ve as tres linhas'
);
select ok(
  (select count(*) from public.buck_price_history) > 0,
  'e le o historico'
);

select set_config('request.jwt.claim.sub', '98100000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$ select * from public.list_romaneio_ex_billing(date '2026-09-07', date '2026-09-13') $$,
  '42501', 'Sem permissão para ver o Fechamento EX.',
  'Expedicao da EX ve romaneio mas nao ve preco: bloqueada'
);

select set_config('request.jwt.claim.sub', '98100000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$ select * from public.list_romaneio_ex_billing(date '2026-09-07', date '2026-09-13') $$,
  '42501', 'Sem permissão para ver o Fechamento EX.',
  'Vendas da JA bloqueada'
);

select set_config('request.jwt.claim.sub', '98100000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$ select * from public.list_romaneio_ex_billing(date '2026-09-13', date '2026-09-07') $$,
  '22023', 'Informe um período válido.',
  'periodo invertido e recusado'
);

select set_config('request.jwt.claim.sub', '98100000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ insert into public.buck_price_history (price_tier_item_id, tier_id, product_source, product_id, product_name,
       unit_price, pricing_unit, valid_from, event, origin)
     values (gen_random_uuid(), gen_random_uuid(), 'bread', 'x', 'x', 1, 'un', current_date, 'cadastro', 'tabela') $$,
  '42501', null,
  'nem o financeiro escreve direto no historico'
);

reset role;

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.buck_price_history'::regclass),
  'historico com RLS ligada e forcada'
);
select ok(
  not has_table_privilege('authenticated', 'public.buck_price_history', 'update')
  and not has_table_privilege('authenticated', 'public.buck_price_history', 'delete')
  and not has_table_privilege('anon', 'public.buck_price_history', 'select'),
  'ninguem logado altera ou apaga o historico, e anonimo nao le'
);

-- 6. Troca da tabela BUCK por outra com o mesmo nome ------------------------

-- Copiar a tabela, renomear e desativar a antiga e renomear a copia: as linhas
-- da copia nasceram fora da Buck, sem historico. O passado continua com o
-- historico da tabela antiga; a copia vale de hoje.
insert into public.price_tiers (id, name, description, active)
values ('98100000-0000-4000-8000-0000000000b9', 'BUCK (copia)', 'Copia de teste', true);
insert into public.price_tier_items (
  id, tier_id, product_id, product_source, product_name, unit_price, pricing_unit, pack_size, active
) values (
  '98100000-0000-4000-8000-0000000000ab', '98100000-0000-4000-8000-0000000000b9',
  'teste-hist-italiano', 'bread', 'Italiano', 5.89, 'un', 1, true
);
-- O nome e unico: a antiga sai do caminho antes.
update public.price_tiers set active = false, name = 'BUCK (antiga)' where id = '98100000-0000-4000-8000-0000000000a0';
update public.price_tiers set name = 'BUCK' where id = '98100000-0000-4000-8000-0000000000b9';

select is(
  (select count(*)::int from public.price_tier_items linha
    where linha.tier_id = private.buck_tier_id()
      and not exists (select 1 from public.buck_price_history h where h.price_tier_item_id = linha.id)),
  0, 'a tabela que vira Buck ganha o historico das linhas que ainda nao tinham');
select is(
  (select sum(total) from private.calcular_cobranca_buck_detalhada(date '2026-09-07', date '2026-09-13')),
  183.00::numeric, 'a semana passada continua com os precos da epoca, da tabela antiga');
select is(
  (select unit_price from private.buck_preco_na_data('98100000-0000-4000-8000-0000000000a1', private.data_na_padaria())),
  null::numeric, 'a tabela que deixou de ser a Buck fica sem preco de hoje em diante');
select is(
  (select valid_from from public.buck_price_history where price_tier_item_id = '98100000-0000-4000-8000-0000000000ab' order by seq desc limit 1),
  private.data_na_padaria(), 'a linha da copia, de produto que ja tinha preco, vale de hoje');

select * from finish();
rollback;
