-- Tabela Buck com data de validade, fase 2 (migration 20261019122339).
--
-- O que o teste protege:
--   * so admin e financeiro trocam preco da Buck, e a troca e conferida no
--     banco: valor, casas, teto, unidade, motivo, data futura e data minima;
--   * a data minima e por pao: este pao numa cobranca confirmada trava, outro
--     pao na mesma semana nao (semana parada por pao sem preco destrava);
--   * a troca grava a linha e um registro so no historico, com a data, o
--     motivo e o autor; a conta da semana usa o preco novo so desde a data;
--   * a previa mostra o efeito pela conta de verdade e nao grava nada;
--   * corrigir a data ou o valor de uma troca cobre o que veio depois;
--   * nenhuma gravacao direta pela API muda preco da Buck, nem troca qual
--     tabela e a Buck; remover, zerar, mudar o pacote, incluir pao novo e
--     copiar produto seguem funcionando; migration grava direto como antes.
--
-- Semanas usadas: 14/09 a 20/09/2026 (cobrada aqui) e 21/09 a 27/09/2026
-- (aberta), longe das datas relativas a "hoje" e das cobrancas do seed.

begin;
create extension if not exists pgtap with schema extensions;

select plan(73);

-- Cenario ------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('98200000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'financeiro-troca-buck-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('98200000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin-troca-buck-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('98200000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'vendas-ex-troca-buck-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('98200000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'expedicao-ex-troca-buck-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('98200000-0000-4000-8000-000000000001', 'Teste Financeiro Troca Buck', 'financeiro', 'jc', true, '["/contas-receber", "/tabelas-preco", "/relatorios"]'::jsonb),
  ('98200000-0000-4000-8000-000000000002', 'Teste Admin Troca Buck', 'admin', null, true, '["*"]'::jsonb),
  -- Como a Marselle: le o Fechamento EX, sem ser do financeiro.
  ('98200000-0000-4000-8000-000000000003', 'Teste Vendas EX Troca Buck', 'vendas', 'ex', true, '["/relatorios", "/relatorios/romaneios"]'::jsonb),
  ('98200000-0000-4000-8000-000000000004', 'Teste Expedicao EX Troca Buck', 'expedicao', 'ex', true, '["/romaneio"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values
  ('98200000-0000-4000-8000-000000000001', 'contas_receber.acessar', 'jc', null),
  ('98200000-0000-4000-8000-000000000001', 'contas_receber.lancar', 'jc', null),
  ('98200000-0000-4000-8000-000000000003', 'relatorios.acessar', '*', null),
  ('98200000-0000-4000-8000-000000000003', 'romaneio.visualizar', 'ex', null),
  ('98200000-0000-4000-8000-000000000004', 'romaneio.acessar', 'ex', null),
  ('98200000-0000-4000-8000-000000000004', 'romaneio.visualizar', 'ex', null);

insert into public.customers (id, name, payment_term_days, active)
select '98200000-0000-4000-8000-0000000000c1', 'Buck', 15, true
where not exists (select 1 from public.customers c where lower(trim(c.name)) = 'buck');

update public.customers set payment_term_days = 15
where lower(trim(name)) = 'buck' and payment_term_days is null;

insert into public.destinations (id, name, code, type, requires_conferencia, active)
select '98200000-0000-4000-8000-0000000000e1', '[TESTE] Exposicao', 'EX', 'loja', true, true
where not exists (select 1 from public.destinations d where upper(d.code) = 'EX' and d.active);

-- O seed traz a sua tabela BUCK. Este cenario monta a propria (como
-- migration: sem papel da API, a trava nao age); tudo volta no rollback.
delete from public.price_tier_items
where tier_id in (select id from public.price_tiers where lower(trim(name)) = 'buck');
delete from public.price_tiers where lower(trim(name)) = 'buck';

insert into public.price_tiers (id, name, description, active)
values
  ('98200000-0000-4000-8000-0000000000a0', 'BUCK', 'Tabela de teste da troca com data', true),
  ('98200000-0000-4000-8000-0000000000b0', '[TESTE] Outra tabela troca', 'Tabela que nao e a Buck', true);

insert into public.breads (id, name, days, active, unit, is_special, is_shelf)
values
  ('teste-troca-a', '[TESTE] Pao A Troca', '{0,1,2,3,4,5,6}', true, 'un', false, false),
  ('teste-troca-b', '[TESTE] Pao B Troca', '{0,1,2,3,4,5,6}', true, 'un', false, false),
  ('teste-troca-c', '[TESTE] Pao C Troca', '{0,1,2,3,4,5,6}', true, 'un', false, false),
  ('teste-troca-novo', '[TESTE] Pao Novo Troca', '{0,1,2,3,4,5,6}', true, 'un', false, false)
on conflict (id) do nothing;

insert into public.price_tier_items (
  id, tier_id, product_id, product_source, product_name, unit_price, pricing_unit, pack_size, active
) values
  ('98200000-0000-4000-8000-0000000000a1', '98200000-0000-4000-8000-0000000000a0',
   'teste-troca-a', 'bread', '[TESTE] Pao A Troca', 4.50, 'un', 1, true),
  ('98200000-0000-4000-8000-0000000000a2', '98200000-0000-4000-8000-0000000000a0',
   'teste-troca-b', 'bread', '[TESTE] Pao B Troca', 6.00, 'un', 1, true),
  ('98200000-0000-4000-8000-0000000000a3', '98200000-0000-4000-8000-0000000000a0',
   'teste-troca-c', 'bread', '[TESTE] Pao C Troca', 3.00, 'un', 1, true),
  ('98200000-0000-4000-8000-0000000000b1', '98200000-0000-4000-8000-0000000000b0',
   'teste-troca-a', 'bread', '[TESTE] Pao A Troca', 9.00, 'un', 1, true);

-- Romaneios: A na semana que sera cobrada e na aberta; B so na aberta.
insert into public.romaneios (id, destination_id, record_date, trip_number, status, created_by)
select romaneio.id, d.id, romaneio.record_date, 1, 'enviado', 'Teste'
from (values
  ('98200000-0000-4000-8000-0000000000f1'::uuid, date '2026-09-15'),
  ('98200000-0000-4000-8000-0000000000f2'::uuid, date '2026-09-22'),
  ('98200000-0000-4000-8000-0000000000f3'::uuid, date '2026-09-26')
) as romaneio(id, record_date)
cross join lateral (
  select id from public.destinations where upper(code) = 'EX' and active order by id limit 1
) d;

insert into public.romaneio_items (id, romaneio_id, product_id, product_source, product_name, qty_sent, qty_accepted)
values
  ('98200000-0000-4000-8000-0000000000d1', '98200000-0000-4000-8000-0000000000f1',
   'teste-troca-a', 'bread', '[TESTE] Pao A Troca', 10, null),
  ('98200000-0000-4000-8000-0000000000d2', '98200000-0000-4000-8000-0000000000f2',
   'teste-troca-a', 'bread', '[TESTE] Pao A Troca', 4, null),
  ('98200000-0000-4000-8000-0000000000d3', '98200000-0000-4000-8000-0000000000f2',
   'teste-troca-b', 'bread', '[TESTE] Pao B Troca', 10, null),
  ('98200000-0000-4000-8000-0000000000d4', '98200000-0000-4000-8000-0000000000f3',
   'teste-troca-b', 'bread', '[TESTE] Pao B Troca', 5, null);

create function pg_temp.como(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_user::text, true);
$$;

create function pg_temp.preco(p_item uuid, p_dia date) returns numeric language sql as $$
  select unit_price from private.buck_preco_na_data(p_item, p_dia);
$$;

create function pg_temp.registros(p_item uuid) returns int language sql as $$
  select count(*)::int from public.buck_price_history where price_tier_item_id = p_item;
$$;

-- 0. Quem chama ---------------------------------------------------------------

select ok(
  not has_function_privilege('anon', 'public.trocar_preco_buck(uuid, numeric, text, date, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.trocar_preco_buck(uuid, numeric, text, date, text, text)', 'execute'),
  'anonimo nao troca preco; logado chama e a funcao decide'
);
select ok(
  not has_function_privilege('anon', 'public.previa_troca_preco_buck(uuid, numeric, text, date)', 'execute')
  and has_function_privilege('authenticated', 'public.previa_troca_preco_buck(uuid, numeric, text, date)', 'execute'),
  'anonimo nao ve a previa; logado chama e a funcao decide'
);

set local role authenticated;

select pg_temp.como('98200000-0000-4000-8000-000000000003');
select throws_ok(
  $$ select public.trocar_preco_buck('98200000-0000-4000-8000-0000000000a1', 5, 'un', date '2026-09-21', 'reajuste_combinado', null) $$,
  '42501', 'Sem permissão para trocar preço da Tabela Buck.',
  'Vendas da EX le o Fechamento EX, mas nao troca preco'
);
select throws_ok(
  $$ select public.previa_troca_preco_buck('98200000-0000-4000-8000-0000000000a1') $$,
  '42501', 'Sem permissão para trocar preço da Tabela Buck.',
  'nem ve a previa'
);

select pg_temp.como('98200000-0000-4000-8000-000000000004');
select throws_ok(
  $$ select public.trocar_preco_buck('98200000-0000-4000-8000-0000000000a1', 5, 'un', date '2026-09-21', 'reajuste_combinado', null) $$,
  '42501', 'Sem permissão para trocar preço da Tabela Buck.',
  'Expedicao da EX tambem nao'
);

-- 1. Conferencias -------------------------------------------------------------

select pg_temp.como('98200000-0000-4000-8000-000000000001');

select throws_ok(
  $$ select public.trocar_preco_buck('98200000-0000-4000-8000-0000000000a1', 0, 'un', date '2026-09-21', 'reajuste_combinado', null) $$,
  '22023', 'Informe um preço maior que zero.', 'preco zero e recusado');
select throws_ok(
  $$ select public.trocar_preco_buck('98200000-0000-4000-8000-0000000000a1', 4.555, 'un', date '2026-09-21', 'reajuste_combinado', null) $$,
  '22023', 'Use no máximo duas casas depois da vírgula.', 'tres casas e recusado');
select throws_ok(
  $$ select public.trocar_preco_buck('98200000-0000-4000-8000-0000000000a1', 10000.01, 'un', date '2026-09-21', 'reajuste_combinado', null) $$,
  '22023', 'Preço acima de R$ 10.000,00. Confira o valor.', 'acima do teto e recusado');
select throws_ok(
  $$ select public.trocar_preco_buck('98200000-0000-4000-8000-0000000000a1', 5, 'cx', date '2026-09-21', 'reajuste_combinado', null) $$,
  '22023', 'Escolha a unidade: un ou kg.', 'unidade desconhecida e recusada');
select throws_ok(
  $$ select public.trocar_preco_buck('98200000-0000-4000-8000-0000000000a1', 5, 'un', date '2026-09-21', 'porque sim', null) $$,
  '22023', 'Escolha o motivo da troca.', 'motivo fora da lista e recusado');
select throws_ok(
  $$ select public.trocar_preco_buck('98200000-0000-4000-8000-0000000000a1', 5, 'un', date '2026-09-21', 'outro', '  ') $$,
  '22023', 'Escreva o motivo da troca.', 'motivo "outro" sem texto e recusado');
select throws_ok(
  format($$ select public.trocar_preco_buck('98200000-0000-4000-8000-0000000000a1', 5, 'un', date '2026-09-21', 'outro', %L) $$, repeat('x', 151)),
  '22023', 'Escreva o motivo em até 150 caracteres.', 'motivo comprido demais e recusado');
select throws_ok(
  $$ select public.trocar_preco_buck('98200000-0000-4000-8000-0000000000a1', 5, 'un', private.data_na_padaria() + 1, 'reajuste_combinado', null) $$,
  '22023', 'O preço novo não pode valer a partir de uma data futura.', 'data futura e recusada');
select throws_ok(
  $$ select public.trocar_preco_buck('98200000-0000-4000-8000-0000000000a1', 5, 'un', date '2026-09-06', 'reajuste_combinado', null) $$,
  '22023', 'Escolha 07/09/2026 ou depois: antes disso a Buck foi acertada fora do Contas a receber.',
  'antes de 07/09/2026 e recusado: a Buck foi acertada fora do Contas a receber');
select throws_ok(
  $$ select public.trocar_preco_buck('98200000-0000-4000-8000-0000000000a1', 4.50, 'un', private.data_na_padaria(), 'reajuste_combinado', null) $$,
  '22023', 'Nada muda: R$ 4,50/un já é o preço em vigor nessa data.', 'troca que nao muda nada e recusada');

-- 2. Semana cobrada trava so o pao que estava nela ----------------------------

select lives_ok(
  format(
    $$ select public.create_buck_weekly_receivable(
         '98200000-0000-4000-8000-0000000000c9', date '2026-09-14', date '2026-09-20',
         %s, %L, '[]'::jsonb) $$,
    (select amount from public.list_buck_weeks_to_bill() where period_start = '2026-09-14'),
    (select composicao from public.list_buck_weeks_to_bill() where period_start = '2026-09-14')
  ),
  'o financeiro confirma a semana de 14/09 (10 do pao A a 4,50)'
);

select throws_ok(
  $$ select public.trocar_preco_buck('98200000-0000-4000-8000-0000000000a1', 5, 'un', date '2026-09-16', 'reajuste_combinado', null) $$,
  '22023',
  'Escolha 21/09/2026 ou depois: antes disso este pão já entrou numa cobrança da Buck confirmada. Diferença de semana cobrada vai como acerto na próxima cobrança.',
  'o pao A ja cobrado na semana de 14/09 nao volta para dentro dela'
);
select is(
  (select previa ->> 'data_minima' || '/' || (previa ->> 'motivo_data_minima')
     from (select public.previa_troca_preco_buck('98200000-0000-4000-8000-0000000000a1') as previa) p),
  '2026-09-21/semana_cobrada', 'a previa diz a data minima do pao A e o porque'
);

select lives_ok(
  $$ select public.trocar_preco_buck('98200000-0000-4000-8000-0000000000a2', 6.50, 'un', date '2026-09-16', 'reajuste_combinado', null) $$,
  'o pao B, que nao estava na semana cobrada, aceita data dentro dela'
);

-- 3. Previa: efeito pela conta, sem gravar ------------------------------------

select is(
  (select (previa -> 'semanas' -> 0 ->> 'de') || ' ' ||
          ((previa -> 'semanas' -> 0 ->> 'depois')::numeric - (previa -> 'semanas' -> 0 ->> 'antes')::numeric)::text || ' ' ||
          jsonb_array_length(previa -> 'semanas')
     from (select public.previa_troca_preco_buck('98200000-0000-4000-8000-0000000000a1', 5.00, 'un', date '2026-09-21') as previa) p),
  '2026-09-21 2.00 1', 'a previa mostra +R$ 2,00 so na semana de 21/09 (4 pães x 0,50)'
);
select is(
  (select previa ->> 'problema'
     from (select public.previa_troca_preco_buck('98200000-0000-4000-8000-0000000000a1', 5.00, 'un', date '2026-09-21') as previa) p),
  null, 'sem problema para gravar'
);

reset role;

select is(pg_temp.registros('98200000-0000-4000-8000-0000000000a1'), 1, 'a previa nao deixou registro no historico');
select is((select unit_price from public.price_tier_items where id = '98200000-0000-4000-8000-0000000000a1'),
  4.50::numeric, 'nem mudou o preco da linha');

set local role authenticated;
select pg_temp.como('98200000-0000-4000-8000-000000000001');

-- 4. A troca com data ---------------------------------------------------------

select lives_ok(
  $$ select public.trocar_preco_buck('98200000-0000-4000-8000-0000000000a1', 5.00, 'un', date '2026-09-21', 'reajuste_combinado', 'combinado por telefone') $$,
  'o financeiro troca o pao A para 5,00 a partir de 21/09'
);
select is(current_setting('pane.buck_troca_item', true), '', 'o sinal da troca nao sobra na transacao');
select throws_ok(
  $$ update public.price_tier_items set unit_price = 5.10 where id = '98200000-0000-4000-8000-0000000000a1' $$,
  '22023', 'O preço da Tabela Buck só muda pelo botão "Trocar preço", com data e motivo.',
  'e a gravacao direta logo depois continua barrada'
);

reset role;

select is(
  (select event || '|' || origin || '|' || valid_from || '|' || unit_price || '|' || previous_unit_price || '|' || reason || '|' || created_by || '|' || created_by_name
     from public.buck_price_history where price_tier_item_id = '98200000-0000-4000-8000-0000000000a1' order by seq desc limit 1),
  'troca_de_preco|troca_com_data|2026-09-21|5.00|4.50|Reajuste combinado com a Buck: combinado por telefone|98200000-0000-4000-8000-000000000001|Teste Financeiro Troca Buck',
  'o historico guarda a data escolhida, o motivo e quem trocou'
);
select is(pg_temp.registros('98200000-0000-4000-8000-0000000000a1'), 2, 'um registro so: o gatilho nao grava outro por cima');
select is((select unit_price from public.price_tier_items where id = '98200000-0000-4000-8000-0000000000a1'),
  5.00::numeric, 'a linha da tabela fica com o preco novo');
select is(pg_temp.preco('98200000-0000-4000-8000-0000000000a1', date '2026-09-20'), 4.50::numeric, 'ate 20/09 continua 4,50');
select is(pg_temp.preco('98200000-0000-4000-8000-0000000000a1', date '2026-09-21'), 5.00::numeric, 'de 21/09 em diante vale 5,00');
select is(
  (select total from private.calcular_cobranca_buck_detalhada(date '2026-09-21', date '2026-09-27') where product_id = 'teste-troca-a'),
  20.00::numeric, 'a semana aberta de 21/09 sai com o preco novo: 4 x 5,00'
);
select is(
  (select linha.total from public.receivable_romaneio_lines linha
     join public.receivables cobranca on cobranca.id = linha.receivable_id
    where cobranca.request_id = '98200000-0000-4000-8000-0000000000c9' and linha.product_id = 'teste-troca-a'),
  45.00::numeric, 'e a semana cobrada de 14/09 continua 10 x 4,50'
);
select is(pg_temp.preco('98200000-0000-4000-8000-0000000000a2', date '2026-09-15'), 6.00::numeric, 'pao B: ate 15/09 continua 6,00');
select is(pg_temp.preco('98200000-0000-4000-8000-0000000000a2', date '2026-09-16'), 6.50::numeric, 'pao B: 6,50 desde 16/09');

-- 5. Corrigir valor ou data cobre o que veio depois ---------------------------

set local role authenticated;
select pg_temp.como('98200000-0000-4000-8000-000000000001');

select is(
  (select previa ->> 'problema'
     from (select public.previa_troca_preco_buck('98200000-0000-4000-8000-0000000000a1', 5.00, 'un', date '2026-09-21') as previa) p),
  'Nada muda: R$ 5,00/un já é o preço em vigor nessa data.', 'repetir a mesma troca nao muda nada'
);
select is(
  (select previa -> 'deixam_de_valer'
     from (select public.previa_troca_preco_buck('98200000-0000-4000-8000-0000000000a1', 5.20, 'un', date '2026-09-21') as previa) p),
  '[{"unit_price": 5.00, "valid_from": "2026-09-21", "pricing_unit": "un"}]'::jsonb,
  'corrigir o valor na mesma data avisa que o 5,00 de 21/09 deixa de valer'
);
select lives_ok(
  $$ select public.trocar_preco_buck('98200000-0000-4000-8000-0000000000a1', 5.20, 'un', date '2026-09-21', 'correcao_digitacao', null) $$,
  'corrigir a digitacao na mesma data'
);
reset role;
select is(pg_temp.preco('98200000-0000-4000-8000-0000000000a1', date '2026-09-22'), 5.20::numeric, 'a correcao vale desde 21/09');

-- O pao B ganhou 7,00 a partir de 25/09; descobre-se que valia desde 22/09 a 6,80.
set local role authenticated;
select pg_temp.como('98200000-0000-4000-8000-000000000001');
select lives_ok(
  $$ select public.trocar_preco_buck('98200000-0000-4000-8000-0000000000a2', 7.00, 'un', date '2026-09-25', 'reajuste_combinado', null) $$,
  'pao B a 7,00 a partir de 25/09'
);
select is(
  (select previa -> 'deixam_de_valer'
     from (select public.previa_troca_preco_buck('98200000-0000-4000-8000-0000000000a2', 6.80, 'un', date '2026-09-22') as previa) p),
  '[{"unit_price": 7.00, "valid_from": "2026-09-25", "pricing_unit": "un"}]'::jsonb,
  'voltar a data avisa que a troca de 25/09 deixa de valer'
);
select lives_ok(
  $$ select public.trocar_preco_buck('98200000-0000-4000-8000-0000000000a2', 6.80, 'un', date '2026-09-22', 'outro', 'data errada na primeira troca') $$,
  'corrigir a data para 22/09'
);
reset role;
select is(pg_temp.preco('98200000-0000-4000-8000-0000000000a2', date '2026-09-26'), 6.80::numeric, 'em 26/09 vale a correcao, nao o 7,00');
select is(pg_temp.preco('98200000-0000-4000-8000-0000000000a2', date '2026-09-21'), 6.50::numeric, 'e antes de 22/09 fica o 6,50');
select is(
  (select previous_unit_price from public.buck_price_history
    where price_tier_item_id = '98200000-0000-4000-8000-0000000000a2' order by seq desc limit 1),
  6.50::numeric, 'o "antes" da correcao e o que valia em 22/09 (6,50), nao o ultimo gravado (7,00)'
);

-- 6. Trava: gravacao direta pela API ------------------------------------------

set local role authenticated;
select pg_temp.como('98200000-0000-4000-8000-000000000001');

select throws_ok(
  $$ update public.price_tier_items set pricing_unit = 'kg' where id = '98200000-0000-4000-8000-0000000000a1' $$,
  '22023', 'O preço da Tabela Buck só muda pelo botão "Trocar preço", com data e motivo.',
  'trocar a unidade de linha com preco tambem passa pelo botao'
);
select lives_ok(
  $$ update public.price_tier_items set pack_size = 2 where id = '98200000-0000-4000-8000-0000000000a1' $$,
  'mudar o pacote segue livre'
);
select lives_ok(
  $$ update public.price_tier_items set active = false where id = '98200000-0000-4000-8000-0000000000a3' $$,
  'remover da tabela segue livre (sem preco de hoje em diante)'
);
select throws_ok(
  $$ update public.price_tier_items set active = true where id = '98200000-0000-4000-8000-0000000000a3' $$,
  '22023', 'O preço da Tabela Buck só muda pelo botão "Trocar preço", com data e motivo.',
  'reativar com o preco antigo e troca sem data: barrado'
);
select lives_ok(
  $$ update public.price_tier_items set active = true, unit_price = 0 where id = '98200000-0000-4000-8000-0000000000a3' $$,
  'reativar sem preco funciona (o preco vem pelo botao)'
);
select lives_ok(
  $$ insert into public.price_tier_items (tier_id, product_id, product_source, product_name, unit_price, pricing_unit, pack_size, active)
     values ('98200000-0000-4000-8000-0000000000a0', 'teste-troca-novo', 'bread', '[TESTE] Pao Novo Troca', 8, 'un', 1, true),
            ('98200000-0000-4000-8000-0000000000a0', 'teste-troca-g', 'bread', '[TESTE] Pao G Troca', 9, 'un', 1, true) $$,
  'incluir paes na Buck segue livre, inclusive varios num comando so'
);
select is(
  (select string_agg(product_id || ' ' || unit_price, ' | ' order by product_id) from public.price_tier_items
    where tier_id = '98200000-0000-4000-8000-0000000000a0' and product_id in ('teste-troca-novo', 'teste-troca-g')),
  'teste-troca-g 0 | teste-troca-novo 0', 'mas entram sem preco: o preco vem pelo botao, com data'
);
select lives_ok(
  $$ update public.price_tier_items set unit_price = 9.50 where id = '98200000-0000-4000-8000-0000000000b1' $$,
  'as outras tabelas seguem gravando direto'
);
select throws_ok(
  $$ update public.price_tiers set name = 'BUCK antiga' where id = '98200000-0000-4000-8000-0000000000a0' $$,
  '22023', 'A Tabela Buck não pode ser renomeada, desativada nem trocada por outra pela tela: isso mudaria o preço cobrado da Buck sem data nem motivo.',
  'renomear a Tabela Buck e barrado'
);
select throws_ok(
  $$ update public.price_tiers set active = false where id = '98200000-0000-4000-8000-0000000000a0' $$,
  '22023', 'A Tabela Buck não pode ser renomeada, desativada nem trocada por outra pela tela: isso mudaria o preço cobrado da Buck sem data nem motivo.',
  'desativar a Tabela Buck e barrado'
);
select lives_ok(
  $$ update public.price_tiers set description = 'Descricao nova' where id = '98200000-0000-4000-8000-0000000000a0' $$,
  'mudar a descricao da Tabela Buck segue livre'
);
select throws_ok(
  $$ insert into public.price_tiers (name, description, active) values ('Buck ', 'outra Buck', true) $$,
  '22023', 'A Tabela Buck não pode ser renomeada, desativada nem trocada por outra pela tela: isso mudaria o preço cobrado da Buck sem data nem motivo.',
  'criar outra tabela ativa chamada Buck e barrado'
);
select throws_ok(
  $$ delete from public.price_tiers where id = '98200000-0000-4000-8000-0000000000a0' $$,
  '42501', 'permission denied for table price_tiers',
  'apagar a Tabela Buck pela API e negado: ninguem logado apaga tabela de preco'
);
reset role;
select is(
  (select count(*)::int from public.price_tiers where id = '98200000-0000-4000-8000-0000000000a0' and active),
  1, 'e a Tabela Buck continua la'
);
set local role authenticated;
select pg_temp.como('98200000-0000-4000-8000-000000000001');

-- Pao C: a linha antiga foi excluida e a atual nasceu hoje (o pao ja tinha
-- preco), entao a data minima e hoje.
reset role;
delete from public.price_tier_items where id = '98200000-0000-4000-8000-0000000000a3';
insert into public.price_tier_items (
  id, tier_id, product_id, product_source, product_name, unit_price, pricing_unit, pack_size, active
) values (
  '98200000-0000-4000-8000-0000000000c3', '98200000-0000-4000-8000-0000000000a0',
  'teste-troca-c', 'bread', '[TESTE] Pao C Troca', 0, 'kg', 1, true
);
set local role authenticated;
select pg_temp.como('98200000-0000-4000-8000-000000000001');

select throws_ok(
  $$ select public.trocar_preco_buck('98200000-0000-4000-8000-0000000000c3', 30, 'kg', private.data_na_padaria() - 1, 'reajuste_combinado', null) $$,
  '22023',
  format('Escolha %s ou depois: antes disso o preço deste pão estava em outra linha da Tabela Buck.', to_char(private.data_na_padaria(), 'DD/MM/YYYY')),
  'linha nova de pao que ja tinha preco em outra linha nao volta para antes de existir'
);

set local role service_role;
select throws_ok(
  $$ update public.price_tier_items set unit_price = 5.30 where id = '98200000-0000-4000-8000-0000000000a1' $$,
  '22023', 'O preço da Tabela Buck só muda pelo botão "Trocar preço", com data e motivo.',
  'a chave de servico tambem nao troca preco sem data'
);

reset role;

select lives_ok(
  $$ update public.price_tier_items set unit_price = 5.40 where id = '98200000-0000-4000-8000-0000000000a1' $$,
  'migration (sem papel da API) grava direto como antes'
);
select is(
  (select event || '|' || origin || '|' || (valid_from = private.data_na_padaria())
     from public.buck_price_history where price_tier_item_id = '98200000-0000-4000-8000-0000000000a1' order by seq desc limit 1),
  'troca_de_preco|tabela|true', 'e o gatilho da fase 1 registra a troca valendo de hoje'
);

-- 7. Admin troca; copiar produto com preco na Buck continua funcionando --------

insert into public.product_categories (id, name, catalog_type, active, sort_order)
values ('98200000-0000-4000-8000-0000000000e8', '[TESTE] Categoria Troca Buck', 'produto_fabricado', true, 999);
insert into public.products (id, name, category, active, unit, kind, is_pj, catalog_type, category_id)
values ('98200000-0000-4000-8000-0000000000e9', '[TESTE] Produto Copia Troca', '[TESTE] Categoria Troca Buck',
        true, 'un', 'final', false, 'produto_fabricado', '98200000-0000-4000-8000-0000000000e8');
insert into public.price_tier_items (
  id, tier_id, product_id, product_source, product_name, unit_price, pricing_unit, pack_size, active
) values (
  '98200000-0000-4000-8000-0000000000a9', '98200000-0000-4000-8000-0000000000a0',
  '98200000-0000-4000-8000-0000000000e9', 'product', '[TESTE] Produto Copia Troca', 12.00, 'un', 1, true
);

set local role authenticated;
select pg_temp.como('98200000-0000-4000-8000-000000000002');

select lives_ok(
  $$ select public.trocar_preco_buck('98200000-0000-4000-8000-0000000000a9', 12.50, 'un', private.data_na_padaria(), 'reajuste_combinado', null) $$,
  'o admin tambem troca preco'
);
select lives_ok(
  $$ select public.duplicate_product_complete('98200000-0000-4000-8000-0000000000e9', '[TESTE] Produto Copia Troca 2') $$,
  'copiar produto que tem preco na Buck funciona com a trava ligada'
);

reset role;

select is(
  (select linha.unit_price || '|' || historico.event || '|' || historico.valid_from
     from public.price_tier_items linha
     join public.products produto on produto.id::text = linha.product_id and produto.name = '[TESTE] Produto Copia Troca 2'
     join public.buck_price_history historico on historico.price_tier_item_id = linha.id
    where linha.tier_id = '98200000-0000-4000-8000-0000000000a0'),
  '0|cadastro|2000-01-01', 'a copia entra na Buck sem preco (o preco vem pelo botao, com data)'
);

-- 8. Cobranca sem foto tambem trava a data ------------------------------------

-- A funcao antiga create_receivable_from_romaneio cria cobranca da EX sem as
-- linhas da foto. A troca nao pode voltar para dentro dela.
insert into public.breads (id, name, days, active, unit, is_special, is_shelf)
values
  ('teste-troca-d', '[TESTE] Pao D Troca', '{0,1,2,3,4,5,6}', true, 'un', false, false),
  ('teste-troca-e', '[TESTE] Pao E Troca', '{0,1,2,3,4,5,6}', true, 'un', false, false),
  ('teste-troca-f', '[TESTE] Pao F Troca', '{0,1,2,3,4,5,6}', true, 'un', false, false),
  ('teste-troca-h', '[TESTE] Pao H Troca', '{0,1,2,3,4,5,6}', true, 'un', false, false)
on conflict (id) do nothing;

insert into public.price_tier_items (
  id, tier_id, product_id, product_source, product_name, unit_price, pricing_unit, pack_size, active
) values
  ('98200000-0000-4000-8000-0000000000a4', '98200000-0000-4000-8000-0000000000a0',
   'teste-troca-d', 'bread', '[TESTE] Pao D Troca', 5.00, 'un', 1, true),
  ('98200000-0000-4000-8000-0000000000a5', '98200000-0000-4000-8000-0000000000a0',
   'teste-troca-e', 'bread', '[TESTE] Pao E Troca', 3.00, 'un', 1, true),
  ('98200000-0000-4000-8000-0000000000a6', '98200000-0000-4000-8000-0000000000a0',
   'teste-troca-f', 'bread', '[TESTE] Pao F Troca', 2.00, 'un', 1, true),
  ('98200000-0000-4000-8000-0000000000a7', '98200000-0000-4000-8000-0000000000a0',
   'teste-troca-h', 'bread', '[TESTE] Pao H Troca', 2.00, 'un', 1, true);

insert into public.romaneios (id, destination_id, record_date, trip_number, status, created_by)
select romaneio.id, d.id, romaneio.record_date, 1, 'enviado', 'Teste'
from (values
  ('98200000-0000-4000-8000-0000000000f4'::uuid, date '2026-10-06'),
  ('98200000-0000-4000-8000-0000000000f5'::uuid, date '2026-10-13')
) as romaneio(id, record_date)
cross join lateral (
  select id from public.destinations where upper(code) = 'EX' and active order by id limit 1
) d;

insert into public.romaneio_items (id, romaneio_id, product_id, product_source, product_name, qty_sent, qty_accepted)
values
  ('98200000-0000-4000-8000-0000000000d5', '98200000-0000-4000-8000-0000000000f4',
   'teste-troca-d', 'bread', '[TESTE] Pao D Troca', 3, null),
  ('98200000-0000-4000-8000-0000000000d6', '98200000-0000-4000-8000-0000000000f5',
   'teste-troca-h', 'bread', '[TESTE] Pao H Troca', 7, null);

insert into public.receivables (
  id, request_id, customer_id, origin, finance_category_id, description,
  invoice_date, original_due_date, due_date, amount, created_by, period_start, period_end
)
select '98200000-0000-4000-8000-0000000000ca', '98200000-0000-4000-8000-0000000000cb', cliente.id, 'romaneio_ex',
       categoria.id, '[TESTE] Buck sem foto', date '2026-10-11', date '2026-10-26', date '2026-10-26', 15.00,
       '98200000-0000-4000-8000-000000000001', date '2026-10-05', date '2026-10-11'
from (select id from public.customers where lower(trim(name)) = 'buck' order by id limit 1) cliente
cross join (select id from public.finance_categories where key = 'buck_ex') categoria;

set local role authenticated;
select pg_temp.como('98200000-0000-4000-8000-000000000001');

select throws_ok(
  $$ select public.trocar_preco_buck('98200000-0000-4000-8000-0000000000a4', 6, 'un', date '2026-10-06', 'reajuste_combinado', null) $$,
  '22023',
  'Escolha 12/10/2026 ou depois: antes disso este pão já entrou numa cobrança da Buck confirmada. Diferença de semana cobrada vai como acerto na próxima cobrança.',
  'cobranca sem foto, com romaneio deste pao no periodo, tambem trava a data'
);

-- 9. Duas linhas com preco para o mesmo pao (pao legado e produto) -------------

reset role;
insert into public.products (id, name, category, active, unit, kind, is_pj, legacy_bread_id)
values ('98200000-0000-4000-8000-0000000000ea', '[TESTE] Produto E Troca', 'PAES', true, 'un', 'final', false, 'teste-troca-e');
insert into public.price_tier_items (
  id, tier_id, product_id, product_source, product_name, unit_price, pricing_unit, pack_size, active
) values (
  '98200000-0000-4000-8000-0000000000a8', '98200000-0000-4000-8000-0000000000a0',
  '98200000-0000-4000-8000-0000000000ea', 'product', '[TESTE] Produto E Troca', 4.00, 'un', 1, true
);
set local role authenticated;
select pg_temp.como('98200000-0000-4000-8000-000000000001');

select throws_ok(
  $$ select public.trocar_preco_buck('98200000-0000-4000-8000-0000000000a5', 3.50, 'un', private.data_na_padaria(), 'reajuste_combinado', null) $$,
  '22023',
  'Este pão tem outra linha com preço na Tabela Buck ([TESTE] Produto E Troca, R$ 4,00/un). A cobrança não separa as duas, porque o romaneio não diz a opção de venda. Remova da Tabela Buck a linha que a Buck não compra e troque o preço na que ficar.',
  'troca recusada quando o mesmo pao tem outra linha com preco na mesma unidade'
);

-- 10. So a unidade; previa com problema na conta deste pao ---------------------

select lives_ok(
  $$ select public.trocar_preco_buck('98200000-0000-4000-8000-0000000000a6', 2.00, 'kg', private.data_na_padaria(), 'correcao_digitacao', 'era por quilo') $$,
  'trocar so a unidade pela funcao'
);
reset role;
select is(
  (select event || '|' || pricing_unit from public.buck_price_history
    where price_tier_item_id = '98200000-0000-4000-8000-0000000000a6' order by seq desc limit 1),
  'troca_de_unidade|kg', 'fica registrada como troca de unidade'
);
set local role authenticated;
select pg_temp.como('98200000-0000-4000-8000-000000000001');

-- Pao H saiu em 13/10 em unidades; trocar a linha para kg deixa a conta dele
-- com unidade incompativel. A previa diz isso, so para este pao.
select is(
  (select (previa -> 'semanas' -> 0 ->> 'de') || ' ' || (previa -> 'semanas' -> 0 ->> 'quantidade') || ' '
          || (previa -> 'semanas' -> 0 ->> 'antes') || ' ' || (previa -> 'semanas' -> 0 ->> 'problema_antes') || ' '
          || (previa -> 'semanas' -> 0 ->> 'problema_depois') || ' ' || jsonb_array_length(previa -> 'semanas')
     from (select public.previa_troca_preco_buck('98200000-0000-4000-8000-0000000000a7', 3, 'kg', date '2026-10-13') as previa) p),
  '2026-10-12 7 14.00 false true 1', 'a previa mostra a semana do pao H: 7 un, 14,00 antes, e o problema que a troca cria'
);
select is(
  (select jsonb_array_length(previa -> 'semanas')
     from (select public.previa_troca_preco_buck('98200000-0000-4000-8000-0000000000a7', 3, 'un', private.data_na_padaria()) as previa) p),
  0, 'sem romaneio deste pao entre a data e hoje, a previa nao lista semana'
);

reset role;

select ok(
  (select count(*) = 0 from public.buck_price_history where reason = 'Prévia da troca'),
  'nenhuma previa ficou gravada'
);

select * from finish();
rollback;
