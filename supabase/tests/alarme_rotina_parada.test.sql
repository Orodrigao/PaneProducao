begin;
create extension if not exists pgtap with schema extensions;

select plan(43);

-- Alarme de rotina parada, fase 1a. Datas fixas em novembro de 2025, antes de
-- qualquer linha do seed (que nasce com o carimbo do dia em que roda): o
-- instante de referencia so enxerga o que estas fixtures lancaram.
-- Calendario usado: 15/11 (sabado, feriado), 16 e 23/11 domingos,
-- 20/11 (quinta, feriado da Consciencia Negra).

-- Privilegio minimo: so o dono e o service_role.
select ok(not has_function_privilege('anon',
  'private.alarme_rotina_parada(timestamptz)', 'execute'),
  'visitante sem login nao executa o alarme');
select ok(not has_function_privilege('authenticated',
  'private.alarme_rotina_parada(timestamptz)', 'execute'),
  'usuario autenticado nao executa o alarme');
select ok(has_function_privilege('service_role',
  'private.alarme_rotina_parada(timestamptz)', 'execute'),
  'o servico interno tem execucao do alarme');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""']
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'alarme_rotina_parada'),
  'o alarme roda como dono e com search_path vazio');

set local role authenticated;
select throws_ok(
  $$ select * from private.alarme_rotina_parada('2025-11-25 08:00-03') $$,
  '42501', null,
  'usuario autenticado e recusado ao chamar o alarme');
reset role;

set local role anon;
select throws_ok(
  $$ select * from private.alarme_rotina_parada('2025-11-25 08:00-03') $$,
  '42501', null,
  'visitante sem login e recusado ao chamar o alarme');
reset role;

select throws_ok(
  $$ select * from private.alarme_rotina_parada(null) $$,
  '22004', 'Informe o instante de referencia do alarme de rotina parada.',
  'instante nulo e recusado em vez de responder tudo em dia');

-- Sem nenhum lancamento ate o instante, cada rotina aparece em dia e a vigia
-- espera o primeiro lancamento.
select is((select count(*)::integer from private.alarme_rotina_parada('2025-11-03 08:00-03')), 14,
  'o alarme devolve uma linha por rotina vigiada');
select is((select count(*)::integer from private.alarme_rotina_parada('2025-11-03 08:00-03')
    where estado <> 'em_dia'), 0,
  'antes do primeiro lancamento nenhuma rotina fica atrasada');

-- Contagem de prateleira da JA (prazo: ate ontem). Lancada todo dia esperado de
-- 10 a 22/11, sem 24/11. Feriado 20/11 e domingo 23/11 ficam sem lancamento.
insert into public.shelf_counts (record_date, store, product_id, product_source, quantity, counted_by, created_at)
select dia, 'ja', 'teste-alarme', 'product', 1, 'Teste alarme',
  (dia + time '20:00') at time zone 'America/Sao_Paulo'
from unnest(array['2025-11-10', '2025-11-11', '2025-11-12', '2025-11-13', '2025-11-14',
  '2025-11-17', '2025-11-18', '2025-11-19', '2025-11-21', '2025-11-22']::date[]) as dia;

select is(
  (select row(estado, faltas, datas_faltando)::text from private.alarme_rotina_parada('2025-11-25 08:00-03')
    where rotina = 'prateleira' and loja = 'ja'),
  row('em_dia', 1, array['2025-11-24']::date[])::text,
  'uma falta na janela nao dispara; feriado de 20/11 e domingo de 23/11 nao contam');
select is(
  (select row(estado, faltas, datas_faltando)::text from private.alarme_rotina_parada('2025-11-26 08:00-03')
    where rotina = 'prateleira' and loja = 'ja'),
  row('atrasada', 2, array['2025-11-24', '2025-11-25']::date[])::text,
  'duas faltas na janela disparam');
select is(
  (select ultimo_registro from private.alarme_rotina_parada('2025-11-26 08:00-03')
    where rotina = 'prateleira' and loja = 'ja'),
  '2025-11-22'::date,
  'a linha mostra o ultimo dia lancado');
select ok(
  (select detalhe from private.alarme_rotina_parada('2025-11-26 08:00-03')
    where rotina = 'prateleira' and loja = 'ja') = 'Contagem de prateleira da JA: 2 dias sem lancamento nos ultimos 7 dias esperados (24/11, 25/11).',
  'o detalhe diz em portugues quais dias faltam');
select is(
  (select row(estado, faltas, datas_faltando)::text from private.alarme_rotina_parada('2025-11-26 01:30+00')
    where rotina = 'prateleira' and loja = 'ja'),
  row('em_dia', 1, array['2025-11-24']::date[])::text,
  '01:30 UTC de 26/11 ainda e 25/11 na padaria: o dia 25 nao esta vencido');

-- Contagem de prateleira da JC: faltas nao seguidas (18 e 21/11) disparam; o
-- 13/11 sem lancamento e o 8o dia esperado e fica fora da janela; o 21/11
-- lancado depois das 08:00 de 25/11 so conta a partir de quando entrou.
insert into public.shelf_counts (record_date, store, product_id, product_source, quantity, counted_by, created_at)
select dia, 'jc', 'teste-alarme', 'product', 1, 'Teste alarme',
  (dia + time '20:00') at time zone 'America/Sao_Paulo'
from unnest(array['2025-11-12', '2025-11-14', '2025-11-17', '2025-11-19',
  '2025-11-22', '2025-11-24']::date[]) as dia;
insert into public.shelf_counts (record_date, store, product_id, product_source, quantity, counted_by, created_at)
values ('2025-11-21', 'jc', 'teste-alarme', 'product', 1, 'Teste alarme', '2025-11-25 12:00-03');

select is(
  (select row(estado, datas_faltando)::text from private.alarme_rotina_parada('2025-11-25 08:00-03')
    where rotina = 'prateleira' and loja = 'jc'),
  row('atrasada', array['2025-11-18', '2025-11-21']::date[])::text,
  'duas faltas nao seguidas disparam e o 8o dia esperado fica fora da janela');
select is(
  (select row(estado, datas_faltando)::text from private.alarme_rotina_parada('2025-11-25 13:00-03')
    where rotina = 'prateleira' and loja = 'jc'),
  row('em_dia', array['2025-11-18']::date[])::text,
  'lancamento atrasado so conta a partir do instante em que entrou');

-- Forno (prazo: ate 3 dias atras): em 24/11 o sabado 22/11 ainda esta no prazo.
insert into public.production_actuals (record_date, product_source, product_id, product_name,
  production_unit, quantity_baked, quantity_loss, recorded_by, lot_code, created_at)
select dia, 'product', 'teste-alarme', '[TESTE] Alarme', 'un', 1, 0, 'Teste alarme',
  'L' || to_char(dia, 'MMDD'), (dia + time '20:00') at time zone 'America/Sao_Paulo'
from unnest(array['2025-11-12', '2025-11-13', '2025-11-14', '2025-11-17',
  '2025-11-18', '2025-11-19']::date[]) as dia;

select is(
  (select row(estado, faltas, datas_faltando)::text from private.alarme_rotina_parada('2025-11-24 08:00-03')
    where rotina = 'forno' and loja = 'jc'),
  row('em_dia', 1, array['2025-11-21']::date[])::text,
  'o forno so cobra o dia depois do prazo de 3 dias');
select is(
  (select estado from private.alarme_rotina_parada('2025-11-25 08:00-03')
    where rotina = 'forno' and loja = 'jc'),
  'atrasada',
  'vencido o prazo do sabado, o forno dispara com duas faltas');

-- Rotina sem nenhum lancamento continua em dia, esperando o primeiro.
select is(
  (select row(estado, faltas)::text from private.alarme_rotina_parada('2025-11-26 08:00-03')
    where rotina = 'caixa' and loja = 'jc'),
  row('em_dia', 0)::text,
  'rotina que nunca foi lancada nao dispara');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values (
  '98700000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated',
  'authenticated', 'alarme-rotina-test@example.com', 'x', now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
);

-- Producao da cozinha (prazo: ate 6 dias atras). O 19/11 foi cancelado em
-- 20/11; o 17/11 so e cancelado em 26/11, entao ainda vale na manha de 25/11.
insert into public.products (id, name, category, active, unit, kind, is_fabricacao_propria, is_pj,
  production_area, production_process, allows_planned_production, allows_unplanned_production)
values ('98700000-0000-4000-8000-000000000011', '[TESTE] Alarme cozinha', 'Bruschetta', true, 'un',
  'final', true, false, 'cozinha', 'montagem', false, true);

insert into public.kitchen_production (store, product_id, record_date, quantity, recorded_by,
  recorded_by_name, produced_at, cancelled_at, cancelled_by, product_name, production_unit,
  production_process, production_area)
select 'jc', '98700000-0000-4000-8000-000000000011', dia, 1, '98700000-0000-4000-8000-000000000001',
  'Teste alarme', (dia + time '20:00') at time zone 'America/Sao_Paulo',
  case dia when '2025-11-17' then '2025-11-26 10:00-03'::timestamptz
    when '2025-11-19' then '2025-11-20 10:00-03'::timestamptz end,
  case when dia in ('2025-11-17', '2025-11-19') then '98700000-0000-4000-8000-000000000001'::uuid end,
  '[TESTE] Alarme cozinha', 'un', 'montagem', 'cozinha'
from unnest(array['2025-11-10', '2025-11-11', '2025-11-12', '2025-11-13', '2025-11-14',
  '2025-11-17', '2025-11-18', '2025-11-19']::date[]) as dia;

select is(
  (select row(estado, faltas, datas_faltando)::text from private.alarme_rotina_parada('2025-11-25 08:00-03')
    where rotina = 'cozinha' and loja = 'jc'),
  row('em_dia', 1, array['2025-11-19']::date[])::text,
  'cozinha cobra ate 6 dias atras e o lancamento cancelado antes do instante nao conta');
select is(
  (select row(estado, datas_faltando)::text from private.alarme_rotina_parada('2025-11-26 12:00-03')
    where rotina = 'cozinha' and loja = 'jc'),
  row('atrasada', array['2025-11-17', '2025-11-19']::date[])::text,
  'cancelado depois do instante valia ate ser cancelado');

-- Venda do balcao: importada ate 10/11. Defasagem de 7 dias ainda e tolerada,
-- 8 dias dispara, e o dia 17/11 explicado como loja fechada volta a cobrir.
insert into public.sales_imports (
  source_system, store, report_type, sale_date, file_name, file_hash, storage_path,
  parser_version, status, row_count, total_quantity, total_net, confirmed_by, confirmed_at
) values (
  'cnm', 'jc', 'sales_by_product', '2025-11-10', 'teste-alarme.csv', repeat('a', 64),
  'teste/alarme-rotina-parada.csv', 'teste', 'confirmed', 1, 1, 1,
  '98700000-0000-4000-8000-000000000001', '2025-11-11 09:00-03'
);
insert into public.sales_day_statuses (source_system, store, sale_date, status, reason, recorded_by, recorded_at)
values ('cnm', 'jc', '2025-11-17', 'closed', 'Teste do alarme', '98700000-0000-4000-8000-000000000001',
  '2025-11-18 20:00-03');

select is(
  (select estado from private.alarme_rotina_parada('2025-11-17 08:00-03') where rotina = 'venda_balcao'),
  'em_dia',
  'venda com 7 dias de defasagem ainda esta no prazo');
select is(
  (select row(estado, ultimo_registro)::text from private.alarme_rotina_parada('2025-11-18 08:00-03')
    where rotina = 'venda_balcao'),
  row('atrasada', '2025-11-10'::date)::text,
  'venda com mais de 7 dias de defasagem dispara');
select is(
  (select row(estado, ultimo_registro)::text from private.alarme_rotina_parada('2025-11-19 08:00-03')
    where rotina = 'venda_balcao'),
  row('em_dia', '2025-11-17'::date)::text,
  'dia explicado em sales_day_statuses cobre a venda');

-- Contagem semanal da JC: a de 27/10 foi fechada em 01/11, reaberta pelo admin
-- em 12/11 e fechada de novo em 13/11 (a tabela so guarda o ultimo fechamento);
-- 03/11 e 17/11 fechadas; a de 10/11 foi fechada no sabado 15/11, reaberta no
-- domingo 16/11 e ficou aberta.
insert into public.inventory_weekly_counts (store, week_start, status, opened_at, opened_by, opened_by_name,
  closed_at, closed_by, closed_by_name, reopened_at, reopened_by, reopened_by_name, created_at)
values
  ('jc', '2025-10-27', 'fechada', '2025-10-27 09:00-03', '98700000-0000-4000-8000-000000000001', 'Teste',
    '2025-11-13 18:00-03', '98700000-0000-4000-8000-000000000001', 'Teste', '2025-11-12 10:00-03',
    '98700000-0000-4000-8000-000000000001', 'Teste', '2025-10-27 09:00-03'),
  ('jc', '2025-11-03', 'fechada', '2025-11-03 09:00-03', '98700000-0000-4000-8000-000000000001', 'Teste',
    '2025-11-08 18:00-03', '98700000-0000-4000-8000-000000000001', 'Teste', null, null, null,
    '2025-11-03 09:00-03'),
  ('jc', '2025-11-10', 'aberta', '2025-11-10 09:00-03', '98700000-0000-4000-8000-000000000001', 'Teste',
    '2025-11-15 18:00-03', '98700000-0000-4000-8000-000000000001', 'Teste', '2025-11-16 10:00-03',
    '98700000-0000-4000-8000-000000000001', 'Teste', '2025-11-10 09:00-03'),
  ('jc', '2025-11-17', 'fechada', '2025-11-17 09:00-03', '98700000-0000-4000-8000-000000000001', 'Teste',
    '2025-11-22 18:00-03', '98700000-0000-4000-8000-000000000001', 'Teste', null, null, null,
    '2025-11-17 09:00-03');

select is(
  (select row(estado, faltas, datas_faltando)::text from private.alarme_rotina_parada('2025-11-24 08:00-03')
    where rotina = 'contagem_semanal'),
  row('atrasada', 1, array['2025-11-10']::date[])::text,
  'contagem reaberta e deixada aberta nao satisfaz a semana');
select is(
  (select estado from private.alarme_rotina_parada('2025-11-15 08:00-03') where rotina = 'contagem_semanal'),
  'em_dia',
  'semana corrente ainda nao vencida nao cobra contagem');
select is(
  (select datas_faltando from private.alarme_rotina_parada('2025-11-12 12:00-03') where rotina = 'contagem_semanal'),
  array['2025-10-27']::date[],
  'entre a reabertura e o novo fechamento a semana fica sem contagem fechada');
select is(
  (select datas_faltando from private.alarme_rotina_parada('2025-11-10 08:00-03') where rotina = 'contagem_semanal'),
  array['2025-10-27']::date[],
  'sem historico de fechamentos, semana fechada de novo depois do instante aparece aberta nele (nunca esconde atraso)');
select is(
  (select datas_faltando from private.alarme_rotina_parada('2025-11-03 08:00-03') where rotina = 'contagem_semanal'),
  array['2025-10-27']::date[],
  'so a semana da primeira contagem em diante e cobrada');

-- NF-e: tres rascunhos chegam em 17/11. Um confirmado e um descartado em 18/11;
-- o terceiro so e confirmado em 24/11.
insert into public.payable_import_drafts (
  store, nfe_key, status, supplier_name, nfe_number, nfe_issued_at, total_value, xml_content,
  item_decisions, installments, created_by, created_at, updated_by, updated_at,
  confirmed_at, discarded_at, discarded_by
) values
  ('jc', repeat('1', 44), 'confirmada', '[TESTE] Fornecedor alarme', '1', '2025-11-14', 10, '<nfe/>',
    '[]'::jsonb, '[]'::jsonb, '98700000-0000-4000-8000-000000000001', '2025-11-17 10:00-03',
    '98700000-0000-4000-8000-000000000001', '2025-11-18 10:00-03', '2025-11-18 10:00-03', null, null),
  ('jc', repeat('2', 44), 'descartada', '[TESTE] Fornecedor alarme', '2', '2025-11-14', 10, '<nfe/>',
    '[]'::jsonb, '[]'::jsonb, '98700000-0000-4000-8000-000000000001', '2025-11-17 10:00-03',
    '98700000-0000-4000-8000-000000000001', '2025-11-18 10:00-03', null, '2025-11-18 10:00-03',
    '98700000-0000-4000-8000-000000000001'),
  ('jc', repeat('3', 44), 'confirmada', '[TESTE] Fornecedor alarme', '3', '2025-11-14', 10, '<nfe/>',
    '[]'::jsonb, '[]'::jsonb, '98700000-0000-4000-8000-000000000001', '2025-11-17 10:00-03',
    '98700000-0000-4000-8000-000000000001', '2025-11-24 10:00-03', '2025-11-24 10:00-03', null, null);

select is(
  (select estado from private.alarme_rotina_parada('2025-11-19 08:00-03') where rotina = 'nfe_rascunho'),
  'em_dia',
  'rascunho com um dia util inteiro parado ainda nao dispara');
select is(
  (select row(estado, faltas, datas_faltando)::text from private.alarme_rotina_parada('2025-11-20 08:00-03')
    where rotina = 'nfe_rascunho'),
  row('atrasada', 1, array['2025-11-17']::date[])::text,
  'so o rascunho ainda pendente dispara; confirmado e descartado nao contam');
select is(
  (select estado from private.alarme_rotina_parada('2025-11-25 08:00-03') where rotina = 'nfe_rascunho'),
  'em_dia',
  'rascunho confirmado sai do alarme');
select is(
  (select ultimo_registro from private.alarme_rotina_parada('2025-11-25 08:00-03') where rotina = 'nfe_rascunho'),
  '2025-11-24'::date,
  'o rascunho mostra a ultima decisao tomada');

-- NF-e, chegada: a ultima nota chegou em 17/11. Em 21/11 sao 2 dias uteis sem
-- nota (18 e 19; 20 e feriado); em 24/11 sao 3 e dispara.
select is(
  (select row(estado, faltas)::text from private.alarme_rotina_parada('2025-11-21 08:00-03')
    where rotina = 'nfe_entrada'),
  row('em_dia', 2)::text,
  'dois dias uteis sem nota ainda sao ritmo normal');
select is(
  (select row(estado, datas_faltando)::text from private.alarme_rotina_parada('2025-11-24 08:00-03')
    where rotina = 'nfe_entrada'),
  row('atrasada', array['2025-11-18', '2025-11-19', '2025-11-21']::date[])::text,
  'tres dias uteis sem nota disparam; feriado e sabado nao contam');

-- Nota que chega em 24/11, emitida em 10/11: entra como compra de XML, volta a
-- contar como chegada e aparece no informativo de atraso desde a emissao.
insert into public.payable_purchases (
  request_id, store, purchase_date, origin, document_type, payment_method, status, total_value,
  created_by, created_at, nfe_key, nfe_number, nfe_issued_at
) values (
  '98700000-0000-4000-8000-0000000000a1', 'jc', '2025-11-24', 'xml', 'nfe', 'boleto', 'aberta', 10,
  '98700000-0000-4000-8000-000000000001', '2025-11-24 10:00-03', repeat('4', 44), '4', '2025-11-10'
);

select is(
  (select estado from private.alarme_rotina_parada('2025-11-24 08:00-03') where rotina = 'nfe_atraso_emissao'),
  'em_dia',
  'antes de a nota chegar nao ha informativo');
select is(
  (select row(estado, faltas, datas_faltando)::text from private.alarme_rotina_parada('2025-11-25 08:00-03')
    where rotina = 'nfe_atraso_emissao'),
  row('informativo', 1, array['2025-11-10']::date[])::text,
  'nota que chegou com mais de 7 dias desde a emissao vira informativo');
select is(
  (select estado from private.alarme_rotina_parada('2025-11-25 08:00-03') where rotina = 'nfe_entrada'),
  'em_dia',
  'a chegada da nota tira a entrada de NF-e do alarme');
select is(
  (select count(*)::integer from private.alarme_rotina_parada('2025-11-25 08:00-03')
    where estado = 'informativo' and rotina <> 'nfe_atraso_emissao'),
  0,
  'so o atraso desde a emissao usa o estado informativo');

-- Sobras da JA (prazo: ate anteontem): lancadas de 12 a 22/11. A de 21/11 foi
-- cancelada na mesma noite e so alterada de novo em 26/11 (a reconciliacao do
-- forno mexe no carimbo de alteracao): cancelada nao conta em instante nenhum.
select is(
  (select count(*)::integer from private.alarme_rotina_parada('2025-11-25 08:00-03')
    where rotina = 'sobras' and estado <> 'em_dia'),
  0,
  'sem nenhuma sobra lancada, a vigia de sobras ainda nao comecou');

insert into public.sobras (record_date, responsible, product_id, quantity, store, product_source,
  lot_code, pending_quantity, status, physical_location, reconciliation_status, created_at, updated_at)
select dia, 'Teste alarme', 'teste-alarme', 1, 'ja', 'bread', 'L' || to_char(dia, 'MMDD'), 0,
  case when dia = '2025-11-21' then 'cancelled' else 'resolved' end,
  'balcao_fechamento', 'not_required', (dia + time '20:00') at time zone 'America/Sao_Paulo',
  case when dia = '2025-11-21' then '2025-11-26 10:00-03'::timestamptz
    else (dia + time '21:00') at time zone 'America/Sao_Paulo' end
from unnest(array['2025-11-12', '2025-11-13', '2025-11-14', '2025-11-17', '2025-11-18',
  '2025-11-19', '2025-11-21', '2025-11-22']::date[]) as dia;

select is(
  (select row(estado, faltas, datas_faltando)::text from private.alarme_rotina_parada('2025-11-25 08:00-03')
    where rotina = 'sobras' and loja = 'ja'),
  row('em_dia', 1, array['2025-11-21']::date[])::text,
  'sobra cancelada nao conta, mesmo alterada depois do instante, e o 24/11 ainda esta no prazo de 2 dias');
select is(
  (select row(estado, datas_faltando)::text from private.alarme_rotina_parada('2025-11-26 12:00-03')
    where rotina = 'sobras' and loja = 'ja'),
  row('atrasada', array['2025-11-21', '2025-11-24']::date[])::text,
  'vencido o prazo do 24/11, as sobras disparam com duas faltas');

-- A ordem das linhas e fixa: diarias, venda, contagem e NF-e.
select is(
  (select array_agg(rotina || '/' || loja) from private.alarme_rotina_parada('2025-11-25 08:00-03')),
  array['caixa/jc', 'caixa/ja', 'sobras/jc', 'sobras/ja', 'prateleira/jc', 'prateleira/ja',
    'forno/jc', 'romaneio/jc', 'cozinha/jc', 'venda_balcao/jc', 'contagem_semanal/jc',
    'nfe_rascunho/todas', 'nfe_entrada/todas', 'nfe_atraso_emissao/todas'],
  'as linhas saem sempre na mesma ordem');

select * from finish();
rollback;
