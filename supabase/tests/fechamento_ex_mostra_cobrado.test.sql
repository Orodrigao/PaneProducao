-- Tabela Buck com data de validade, fase 3 (migration 20261023173000).
--
-- O que o teste protege:
--   * quem le o Contas a receber ve a semana cobrada com o que foi cobrado (a
--     foto das linhas e os ajustes), inteira no periodo que contem o fim dela,
--     e os dias dela saem do "a cobrar" em qualquer periodo;
--   * "a cobrar" e a conta de sempre nos dias sem cobranca: sem cobranca no
--     meio, identico ao `list_romaneio_ex_billing`; com uma no meio, o mesmo
--     produto ao mesmo preco nos dois lados vira uma linha so;
--   * o que mudou nos romaneios depois da cobranca aparece a parte, com o
--     sinal certo: conferencia que reduziu, romaneio novo, item sem preco e
--     item apagado; troca de preco sozinha nao entra e nao muda o cobrado;
--   * cobranca sem foto (funcao antiga) aparece pelo valor; cobranca
--     cancelada some e os dias dela voltam para o "a cobrar";
--   * quem nao le o Contas a receber ve o periodo inteiro pelo preco do dia,
--     sem cobranca nenhuma; quem nao le o Fechamento EX e recusado;
--   * a funcao roda em transacao so de leitura, como o PostgREST chama.
--
-- Semanas usadas: 07/09 a 13/09, 14/09 a 20/09 (cobrada aqui) e 21/09 a
-- 27/09/2026, longe das datas relativas a "hoje" e das cobrancas do seed.

begin;
create extension if not exists pgtap with schema extensions;

select plan(48);

-- Cenario ------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
)
select usuario.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       usuario.email, '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
       now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
from (values
  ('98300000-0000-4000-8000-000000000001'::uuid, 'financeiro-fechamento-ex-test@example.com'),
  ('98300000-0000-4000-8000-000000000002'::uuid, 'vendas-ex-fechamento-ex-test@example.com'),
  ('98300000-0000-4000-8000-000000000003'::uuid, 'expedicao-ex-fechamento-ex-test@example.com'),
  ('98300000-0000-4000-8000-000000000004'::uuid, 'vendas-ja-fechamento-ex-test@example.com'),
  ('98300000-0000-4000-8000-000000000005'::uuid, 'financeiro-sem-receber-fechamento-ex-test@example.com')
) usuario(id, email);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('98300000-0000-4000-8000-000000000001', 'Teste Financeiro Fechamento EX', 'financeiro', 'jc', true, '["/contas-receber", "/relatorios"]'::jsonb),
  -- Como a Marselle: le o Fechamento EX, sem o Contas a receber.
  ('98300000-0000-4000-8000-000000000002', 'Teste Vendas EX Fechamento EX', 'vendas', 'ex', true, '["/relatorios", "/relatorios/romaneios"]'::jsonb),
  ('98300000-0000-4000-8000-000000000003', 'Teste Expedicao EX Fechamento EX', 'expedicao', 'ex', true, '["/romaneio"]'::jsonb),
  ('98300000-0000-4000-8000-000000000004', 'Teste Vendas JA Fechamento EX', 'vendas', 'ja', true, '["/relatorios"]'::jsonb),
  ('98300000-0000-4000-8000-000000000005', 'Teste Financeiro Sem Receber EX', 'financeiro', 'jc', true, '["/relatorios"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values
  ('98300000-0000-4000-8000-000000000001', 'contas_receber.acessar', 'jc', null),
  ('98300000-0000-4000-8000-000000000001', 'contas_receber.lancar', 'jc', null),
  ('98300000-0000-4000-8000-000000000001', 'contas_receber.cancelar', 'jc', null),
  ('98300000-0000-4000-8000-000000000001', 'romaneio.visualizar', 'ex', null),
  ('98300000-0000-4000-8000-000000000002', 'relatorios.acessar', '*', null),
  ('98300000-0000-4000-8000-000000000002', 'romaneio.visualizar', 'ex', null),
  ('98300000-0000-4000-8000-000000000003', 'romaneio.acessar', 'ex', null),
  ('98300000-0000-4000-8000-000000000003', 'romaneio.visualizar', 'ex', null),
  ('98300000-0000-4000-8000-000000000004', 'relatorios.acessar', '*', null),
  ('98300000-0000-4000-8000-000000000004', 'romaneio.visualizar', 'ja', null),
  ('98300000-0000-4000-8000-000000000005', 'romaneio.visualizar', 'ex', null);

insert into public.customers (id, name, payment_term_days, active)
select '98300000-0000-4000-8000-0000000000c1', 'Buck', 15, true
where not exists (select 1 from public.customers c where lower(trim(c.name)) = 'buck');

update public.customers set payment_term_days = 15
where lower(trim(name)) = 'buck' and payment_term_days is null;

insert into public.destinations (id, name, code, type, requires_conferencia, active)
select '98300000-0000-4000-8000-0000000000e1', '[TESTE] Exposicao', 'EX', 'loja', true, true
where not exists (select 1 from public.destinations d where upper(d.code) = 'EX' and d.active);

-- O seed traz a sua tabela BUCK. Este cenario monta a propria (como
-- migration: sem papel da API, a trava nao age); tudo volta no rollback.
delete from public.price_tier_items
where tier_id in (select id from public.price_tiers where lower(trim(name)) = 'buck');
delete from public.price_tiers where lower(trim(name)) = 'buck';

insert into public.price_tiers (id, name, description, active)
values ('98300000-0000-4000-8000-0000000000a0', 'BUCK', 'Tabela de teste do Fechamento EX', true);

insert into public.breads (id, name, days, active, unit, is_special, is_shelf)
values
  ('teste-fech-pao', '[TESTE] Pao Fechamento', '{0,1,2,3,4,5,6}', true, 'un', false, false),
  ('teste-fech-ciabatta', '[TESTE] Ciabatta Fechamento', '{0,1,2,3,4,5,6}', true, 'kg', false, false),
  ('teste-fech-novo', '[TESTE] Pao Novo Fechamento', '{0,1,2,3,4,5,6}', true, 'un', false, false),
  ('teste-fech-sem-preco', '[TESTE] Pao Sem Preco Fechamento', '{0,1,2,3,4,5,6}', true, 'un', false, false)
on conflict (id) do nothing;

insert into public.price_tier_items (
  id, tier_id, product_id, product_source, product_name, unit_price, pricing_unit, pack_size, active
) values
  ('98300000-0000-4000-8000-0000000000a1', '98300000-0000-4000-8000-0000000000a0',
   'teste-fech-pao', 'bread', '[TESTE] Pao Fechamento', 2.00, 'un', 1, true),
  ('98300000-0000-4000-8000-0000000000a2', '98300000-0000-4000-8000-0000000000a0',
   'teste-fech-ciabatta', 'bread', '[TESTE] Ciabatta Fechamento', 40.00, 'kg', 1, true),
  ('98300000-0000-4000-8000-0000000000a3', '98300000-0000-4000-8000-0000000000a0',
   'teste-fech-novo', 'bread', '[TESTE] Pao Novo Fechamento', 3.00, 'un', 1, true);

-- Tres semanas da EX:
--   07/09 a 13/09: 08/09 pao 10 (20,00); 10/09 ciabatta 1,5 kg conferida (60,00)
--   14/09 a 20/09: 15/09 pao 20 (40,00) e ciabatta 1 kg (40,00); 17/09 novo 5 (15,00)
--   21/09 a 27/09: 22/09 pao 7 (14,00)
insert into public.romaneios (id, destination_id, record_date, trip_number, status, created_by)
select romaneio.id, destino.id, romaneio.record_date, 1, romaneio.status, 'Teste'
from (values
  ('98300000-0000-4000-8000-0000000000b1'::uuid, date '2026-09-08', 'enviado'),
  ('98300000-0000-4000-8000-0000000000b2'::uuid, date '2026-09-10', 'conferido'),
  ('98300000-0000-4000-8000-0000000000b3'::uuid, date '2026-09-15', 'enviado'),
  ('98300000-0000-4000-8000-0000000000b4'::uuid, date '2026-09-17', 'enviado'),
  ('98300000-0000-4000-8000-0000000000b5'::uuid, date '2026-09-22', 'enviado')
) romaneio(id, record_date, status)
cross join lateral (
  select d.id from public.destinations d where upper(d.code) = 'EX' and d.active order by d.id limit 1
) destino;

insert into public.romaneio_items (id, romaneio_id, product_id, product_source, product_name, qty_sent, qty_accepted)
values
  ('98300000-0000-4000-8000-0000000000d1', '98300000-0000-4000-8000-0000000000b1', 'teste-fech-pao', 'bread', '[TESTE] Pao Fechamento', 10, null),
  ('98300000-0000-4000-8000-0000000000d2', '98300000-0000-4000-8000-0000000000b2', 'teste-fech-ciabatta', 'bread', '[TESTE] Ciabatta Fechamento', 1.5, 1.5),
  ('98300000-0000-4000-8000-0000000000d3', '98300000-0000-4000-8000-0000000000b3', 'teste-fech-pao', 'bread', '[TESTE] Pao Fechamento', 20, null),
  ('98300000-0000-4000-8000-0000000000d4', '98300000-0000-4000-8000-0000000000b3', 'teste-fech-ciabatta', 'bread', '[TESTE] Ciabatta Fechamento', 1, null),
  ('98300000-0000-4000-8000-0000000000d5', '98300000-0000-4000-8000-0000000000b4', 'teste-fech-novo', 'bread', '[TESTE] Pao Novo Fechamento', 5, null),
  ('98300000-0000-4000-8000-0000000000d6', '98300000-0000-4000-8000-0000000000b5', 'teste-fech-pao', 'bread', '[TESTE] Pao Fechamento', 7, null);

-- Le o Fechamento EX como a tela le, numa variavel por consulta.
create function pg_temp.fechamento(p_de date, p_ate date) returns jsonb
language sql as $$ select public.list_romaneio_ex_fechamento(p_de, p_ate) $$;

create function pg_temp.total(p_linhas jsonb) returns numeric
language sql as $$
  select coalesce(sum((linha.value ->> 'total')::numeric), 0) from jsonb_array_elements(p_linhas) linha
$$;

create function pg_temp.linha(p_linhas jsonb, p_produto text) returns jsonb
language sql as $$
  select linha.value from jsonb_array_elements(p_linhas) linha where linha.value ->> 'produto' = p_produto
$$;

-- A conta antiga do Fechamento EX, no mesmo formato e na mesma ordem.
create function pg_temp.conta_antiga(p_de date, p_ate date) returns jsonb
language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'product_source', conta.product_source,
           'product_id', conta.product_id,
           'produto', conta.produto,
           'unidade', conta.unidade,
           'quantidade', conta.quantidade,
           'preco_unitario', conta.preco_unitario,
           'total', conta.total,
           'problemas', to_jsonb(conta.problemas),
           'itens', conta.itens
         ) order by conta.ordem), '[]'::jsonb)
  from public.list_romaneio_ex_billing(p_de, p_ate) with ordinality
       conta(product_source, product_id, produto, unidade, quantidade, preco_unitario, total, problemas, itens, ordem)
$$;

grant execute on function pg_temp.fechamento(date, date), pg_temp.total(jsonb),
  pg_temp.linha(jsonb, text), pg_temp.conta_antiga(date, date) to authenticated;

-- 1. Antes da cobranca -----------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '98300000-0000-4000-8000-000000000001', true);

select is((pg_temp.fechamento('2026-09-07', '2026-09-27') ->> 'mostra_cobrado')::boolean, true,
  'financeiro com Contas a receber ve o cobrado');
select is(pg_temp.fechamento('2026-09-07', '2026-09-27') -> 'cobrancas', '[]'::jsonb,
  'sem cobranca no periodo, nenhuma semana cobrada');
select is(pg_temp.fechamento('2026-09-07', '2026-09-27') -> 'a_cobrar', pg_temp.conta_antiga('2026-09-07', '2026-09-27'),
  'sem cobranca no meio, o a cobrar e identico a conta antiga do Fechamento EX');
select is(pg_temp.total(pg_temp.fechamento('2026-09-07', '2026-09-27') -> 'a_cobrar'), 189.00::numeric,
  'as tres semanas somam 189,00 pelo preco do dia');

-- 2. Cobranca da semana do meio, com dois ajustes --------------------------

select lives_ok(
  $$ select public.create_buck_weekly_receivable(
       '98300000-0000-4000-8000-0000000000f1', '2026-09-14', '2026-09-20',
       (select amount from public.list_buck_weeks_to_bill() where period_start = '2026-09-14'),
       (select composicao from public.list_buck_weeks_to_bill() where period_start = '2026-09-14'),
       '[{"kind": "produto_sem_romaneio", "description": "Pão que saiu sem romaneio", "product_name": "[TESTE] Pao Fechamento", "quantity": 2, "unit": "un", "unit_price": 2.00},
         {"kind": "acerto", "description": "Desconto combinado", "amount": -1.50}]'::jsonb) $$,
  'a semana de 14/09 e cobrada com dois ajustes');

select is(
  (select amount from public.receivables where request_id = '98300000-0000-4000-8000-0000000000f1'),
  97.50::numeric, 'cobrado: 95,00 dos romaneios + 4,00 - 1,50');

select is(jsonb_array_length(pg_temp.fechamento('2026-09-07', '2026-09-27') -> 'cobrancas'), 1,
  'a semana cobrada aparece no periodo que contem o domingo dela');
select is(
  (select jsonb_build_object('de', c -> 'period_start', 'ate', c -> 'period_end', 'valor', c -> 'amount',
                             'foto', c -> 'com_foto', 'id', c -> 'receivable_id')
     from jsonb_array_elements(pg_temp.fechamento('2026-09-07', '2026-09-27') -> 'cobrancas') cobranca(c)),
  jsonb_build_object('de', '2026-09-14', 'ate', '2026-09-20', 'valor', 97.50, 'foto', true,
                     'id', (select id from public.receivables where request_id = '98300000-0000-4000-8000-0000000000f1')),
  'com o periodo, o valor cobrado, a foto e a cobranca de origem');
select is(
  (select pg_temp.total(c -> 'linhas') from jsonb_array_elements(pg_temp.fechamento('2026-09-07', '2026-09-27') -> 'cobrancas') cobranca(c)),
  95.00::numeric, 'as linhas da foto somam o valor dos romaneios cobrados');
select is(
  (select jsonb_agg(jsonb_build_array(a ->> 'kind', (a ->> 'amount')::numeric) order by (a ->> 'position')::int)
     from jsonb_array_elements(pg_temp.fechamento('2026-09-07', '2026-09-27') -> 'cobrancas') cobranca(c),
          jsonb_array_elements(c -> 'ajustes') ajuste(a)),
  '[["produto_sem_romaneio", 4.00], ["acerto", -1.50]]'::jsonb,
  'os ajustes vem com o tipo e o valor, na ordem da confirmacao');
select is(
  (select c -> 'depois' from jsonb_array_elements(pg_temp.fechamento('2026-09-07', '2026-09-27') -> 'cobrancas') cobranca(c)),
  '[]'::jsonb, 'nada mudou depois da cobranca');

select is(pg_temp.total(pg_temp.fechamento('2026-09-07', '2026-09-27') -> 'a_cobrar'), 94.00::numeric,
  'a cobrar: so as duas semanas abertas (20,00 + 60,00 + 14,00)');
select is(
  (select jsonb_build_object('quantidade', (l ->> 'quantidade')::numeric, 'total', (l ->> 'total')::numeric,
                             'dias', (select jsonb_agg(i ->> 'record_date') from jsonb_array_elements(l -> 'itens') i))
     from pg_temp.linha(pg_temp.fechamento('2026-09-07', '2026-09-27') -> 'a_cobrar', '[TESTE] Pao Fechamento') l),
  '{"quantidade": 17, "total": 34.00, "dias": ["2026-09-08", "2026-09-22"]}'::jsonb,
  'o pao das duas semanas abertas vira uma linha so, sem o dia da semana cobrada');
select is(pg_temp.fechamento('2026-09-07', '2026-09-27') -> 'fora_do_periodo', '[]'::jsonb,
  'nenhuma cobranca termina depois do periodo');

-- Periodo que nao contem o domingo da semana cobrada.
select is(pg_temp.fechamento('2026-09-07', '2026-09-16') -> 'cobrancas', '[]'::jsonb,
  'sem o domingo dela no periodo, a semana cobrada nao aparece');
select is(pg_temp.fechamento('2026-09-07', '2026-09-16') -> 'fora_do_periodo',
  '[{"period_start": "2026-09-14", "period_end": "2026-09-20"}]'::jsonb,
  'e a tela fica sabendo onde ela aparece');
select is(pg_temp.total(pg_temp.fechamento('2026-09-07', '2026-09-16') -> 'a_cobrar'), 80.00::numeric,
  'os dias 14 a 16/09 nao voltam para o a cobrar');

-- Periodo que comeca no meio da semana cobrada e contem o domingo dela.
select is(
  (select c ->> 'period_start' from jsonb_array_elements(pg_temp.fechamento('2026-09-16', '2026-09-27') -> 'cobrancas') cobranca(c)),
  '2026-09-14', 'a semana cobrada aparece inteira, a partir da segunda dela');
select is(pg_temp.total(pg_temp.fechamento('2026-09-16', '2026-09-27') -> 'a_cobrar'), 14.00::numeric,
  'e o a cobrar fica so com a semana de 21/09');

-- 3. Quem nao le o Contas a receber ----------------------------------------

select set_config('request.jwt.claim.sub', '98300000-0000-4000-8000-000000000002', true);
select is((pg_temp.fechamento('2026-09-07', '2026-09-27') ->> 'mostra_cobrado')::boolean, false,
  'a vendas da EX nao ve o cobrado');
select is(pg_temp.fechamento('2026-09-07', '2026-09-27') -> 'cobrancas', '[]'::jsonb,
  'nem a cobranca da semana');
select is(pg_temp.fechamento('2026-09-07', '2026-09-16') -> 'fora_do_periodo', '[]'::jsonb,
  'nem onde ela aparece');
select is(pg_temp.fechamento('2026-09-07', '2026-09-27') -> 'a_cobrar', pg_temp.conta_antiga('2026-09-07', '2026-09-27'),
  've o periodo inteiro pelo preco do dia, como antes');

select set_config('request.jwt.claim.sub', '98300000-0000-4000-8000-000000000005', true);
select is(
  jsonb_build_object('mostra', pg_temp.fechamento('2026-09-07', '2026-09-27') -> 'mostra_cobrado',
                     'cobrancas', pg_temp.fechamento('2026-09-07', '2026-09-27') -> 'cobrancas'),
  '{"mostra": false, "cobrancas": []}'::jsonb,
  'financeiro sem o Contas a receber le o Fechamento EX sem o cobrado');

select set_config('request.jwt.claim.sub', '98300000-0000-4000-8000-000000000003', true);
select throws_ok($$ select public.list_romaneio_ex_fechamento('2026-09-07', '2026-09-27') $$,
  '42501', 'Sem permissão para ver o Fechamento EX.', 'expedicao da EX sem relatorios e recusada');

select set_config('request.jwt.claim.sub', '98300000-0000-4000-8000-000000000004', true);
select throws_ok($$ select public.list_romaneio_ex_fechamento('2026-09-07', '2026-09-27') $$,
  '42501', 'Sem permissão para ver o Fechamento EX.', 'vendas da JA, sem os romaneios da EX, e recusada');

select set_config('request.jwt.claim.sub', '98300000-0000-4000-8000-000000000001', true);
select throws_ok($$ select public.list_romaneio_ex_fechamento('2026-09-27', '2026-09-07') $$,
  '22023', 'Informe um período válido.', 'periodo invertido e recusado');
select throws_ok($$ select public.list_romaneio_ex_fechamento('2023-01-01', '2026-09-27') $$,
  '22023', 'Escolha um período de até três anos.', 'periodo acima de tres anos e recusado');

-- 4. Romaneios mudam depois da cobranca ------------------------------------

reset role;

-- A EX confere 18 dos 20 paes de 15/09; sai um romaneio novo em 19/09 com 4
-- paes novos e 3 de um pao sem preco na Buck; e uma correcao de preco (como
-- migration) alcanca a ciabatta da semana cobrada.
update public.romaneio_items set qty_accepted = 18 where id = '98300000-0000-4000-8000-0000000000d3';
update public.romaneios set status = 'conferido' where id = '98300000-0000-4000-8000-0000000000b3';

insert into public.romaneios (id, destination_id, record_date, trip_number, status, created_by)
select '98300000-0000-4000-8000-0000000000b6', d.id, date '2026-09-19', 1, 'enviado', 'Teste'
from public.destinations d where upper(d.code) = 'EX' and d.active order by d.id limit 1;
insert into public.romaneio_items (id, romaneio_id, product_id, product_source, product_name, qty_sent, qty_accepted)
values
  ('98300000-0000-4000-8000-0000000000d7', '98300000-0000-4000-8000-0000000000b6', 'teste-fech-novo', 'bread', '[TESTE] Pao Novo Fechamento', 4, null),
  ('98300000-0000-4000-8000-0000000000d8', '98300000-0000-4000-8000-0000000000b6', 'teste-fech-sem-preco', 'bread', '[TESTE] Pao Sem Preco Fechamento', 3, null);

insert into public.buck_price_history (
  price_tier_item_id, tier_id, product_source, product_id, product_name,
  unit_price, pricing_unit, valid_from, event, origin
) values (
  '98300000-0000-4000-8000-0000000000a2', '98300000-0000-4000-8000-0000000000a0', 'bread',
  'teste-fech-ciabatta', '[TESTE] Ciabatta Fechamento', 45.00, 'kg', date '2026-09-14',
  'troca_de_preco', 'migracao'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '98300000-0000-4000-8000-000000000001', true);

select is(
  (select jsonb_build_object('valor', (c ->> 'amount')::numeric, 'linhas', pg_temp.total(c -> 'linhas'),
                             'ciabatta', (pg_temp.linha(c -> 'linhas', '[TESTE] Ciabatta Fechamento') ->> 'preco_unitario')::numeric)
     from jsonb_array_elements(pg_temp.fechamento('2026-09-07', '2026-09-27') -> 'cobrancas') cobranca(c)),
  '{"valor": 97.50, "linhas": 95.00, "ciabatta": 40.00}'::jsonb,
  'o cobrado continua o da foto, com o preco da ciabatta do dia da cobranca');
select is(
  (select jsonb_agg(jsonb_build_array(d ->> 'produto', (d ->> 'quantidade')::numeric,
                                      (d ->> 'preco_unitario')::numeric, (d ->> 'total')::numeric, d -> 'problemas'))
     from jsonb_array_elements(pg_temp.fechamento('2026-09-07', '2026-09-27') -> 'cobrancas') cobranca(c),
          jsonb_array_elements(c -> 'depois') depois(d)),
  '[["[TESTE] Pao Fechamento", -2, 2.00, -4.00, []],
    ["[TESTE] Pao Novo Fechamento", 4, 3.00, 12.00, []],
    ["[TESTE] Pao Sem Preco Fechamento", 3, null, null, ["missing_price"]]]'::jsonb,
  'depois da cobranca: 2 paes a menos na conferencia, 4 novos entregues depois e 3 sem preco; a troca de preco sozinha nao entra');
select is(
  (select d -> 'itens'
     from jsonb_array_elements(pg_temp.fechamento('2026-09-07', '2026-09-27') -> 'cobrancas') cobranca(c),
          jsonb_array_elements(c -> 'depois') depois(d)
    where d ->> 'produto' = '[TESTE] Pao Fechamento'),
  '[{"romaneio_id": "98300000-0000-4000-8000-0000000000b3", "romaneio_item_id": "98300000-0000-4000-8000-0000000000d3",
     "record_date": "2026-09-15", "antes": 20, "agora": 18}]'::jsonb,
  'a conferencia aparece como um item so, com o antes e o agora');
select is(pg_temp.total(pg_temp.fechamento('2026-09-07', '2026-09-27') -> 'a_cobrar'), 94.00::numeric,
  'o que mudou na semana cobrada nao vai para o a cobrar');

-- O romaneio de 17/09, que estava na foto, perde o item.
reset role;
delete from public.romaneio_items where id = '98300000-0000-4000-8000-0000000000d5';
set local role authenticated;
select set_config('request.jwt.claim.sub', '98300000-0000-4000-8000-000000000001', true);

select is(
  (select jsonb_build_object('quantidade', (d ->> 'quantidade')::numeric, 'total', (d ->> 'total')::numeric,
                             'itens', jsonb_array_length(d -> 'itens'))
     from jsonb_array_elements(pg_temp.fechamento('2026-09-07', '2026-09-27') -> 'cobrancas') cobranca(c),
          jsonb_array_elements(c -> 'depois') depois(d)
    where d ->> 'produto' = '[TESTE] Pao Novo Fechamento'),
  '{"quantidade": -1, "total": -3.00, "itens": 2}'::jsonb,
  'item apagado depois da cobranca soma com o entregue depois: 4 - 5 = -1');

-- Mudar so a quantidade de volta ao que foi cobrado tira o pao da lista.
reset role;
update public.romaneio_items set qty_accepted = null where id = '98300000-0000-4000-8000-0000000000d3';
set local role authenticated;
select set_config('request.jwt.claim.sub', '98300000-0000-4000-8000-000000000001', true);

select is(
  (select count(*)::int
     from jsonb_array_elements(pg_temp.fechamento('2026-09-07', '2026-09-27') -> 'cobrancas') cobranca(c),
          jsonb_array_elements(c -> 'depois') depois(d)
    where d ->> 'produto' = '[TESTE] Pao Fechamento'),
  0, 'item que voltou a ser igual ao cobrado sai da lista');

-- 5. Cobranca sem foto (funcao antiga) -------------------------------------

reset role;
insert into public.receivables (
  id, request_id, customer_id, origin, finance_category_id, description,
  invoice_date, original_due_date, due_date, amount, created_by, period_start, period_end
)
select '98300000-0000-4000-8000-0000000000f3', '98300000-0000-4000-8000-0000000000f4', cliente.id,
       'romaneio_ex', categoria.id, '[TESTE] Buck pela funcao antiga',
       date '2026-09-27', date '2026-10-12', date '2026-10-12', 14.00,
       '98300000-0000-4000-8000-000000000001', date '2026-09-21', date '2026-09-27'
from public.customers cliente
join public.finance_categories categoria on categoria.key = 'buck_ex'
where lower(trim(cliente.name)) = 'buck' and cliente.active
order by cliente.created_at nulls last, cliente.id
limit 1;
set local role authenticated;
select set_config('request.jwt.claim.sub', '98300000-0000-4000-8000-000000000001', true);

select is(
  (select jsonb_build_object('foto', c -> 'com_foto', 'valor', (c ->> 'amount')::numeric,
                             'linhas', c -> 'linhas', 'depois', c -> 'depois')
     from jsonb_array_elements(pg_temp.fechamento('2026-09-07', '2026-09-27') -> 'cobrancas') cobranca(c)
    where c ->> 'period_start' = '2026-09-21'),
  '{"foto": false, "valor": 14.00, "linhas": [], "depois": []}'::jsonb,
  'cobranca sem foto aparece pelo valor, sem linhas nem comparacao');
select is(pg_temp.total(pg_temp.fechamento('2026-09-07', '2026-09-27') -> 'a_cobrar'), 80.00::numeric,
  'e os dias dela saem do a cobrar');
select is(jsonb_array_length(pg_temp.fechamento('2026-09-07', '2026-09-27') -> 'cobrancas'), 2,
  'as duas cobrancas aparecem, na ordem das semanas');

-- 6. Cobranca cancelada -----------------------------------------------------

select lives_ok(
  $$ select public.cancel_receivable('98300000-0000-4000-8000-0000000000f5',
       (select id from public.receivables where request_id = '98300000-0000-4000-8000-0000000000f1'),
       'Teste: cobranca refeita') $$,
  'a cobranca da semana de 14/09 e cancelada');
select is(
  (select jsonb_agg(c ->> 'period_start') from jsonb_array_elements(pg_temp.fechamento('2026-09-07', '2026-09-27') -> 'cobrancas') cobranca(c)),
  '["2026-09-21"]'::jsonb, 'cobranca cancelada some do Fechamento EX');
select is(
  (select (l ->> 'quantidade')::numeric
     from pg_temp.linha(pg_temp.fechamento('2026-09-07', '2026-09-27') -> 'a_cobrar', '[TESTE] Pao Fechamento') l),
  30::numeric, 'e os dias dela voltam para o a cobrar pelo preco do dia (10 de 08/09 e 20 de 15/09)');
select is(
  (select (l ->> 'preco_unitario')::numeric
     from jsonb_array_elements(pg_temp.fechamento('2026-09-07', '2026-09-27') -> 'a_cobrar') linha(l)
    where l ->> 'produto' = '[TESTE] Ciabatta Fechamento'
      and l -> 'itens' -> 0 ->> 'record_date' = '2026-09-15'),
  45.00::numeric, 'com o preco de hoje para o dia, porque deixou de haver cobranca');
select is(
  (select l -> 'problemas'
     from pg_temp.linha(pg_temp.fechamento('2026-09-07', '2026-09-27') -> 'a_cobrar', '[TESTE] Pao Sem Preco Fechamento') l),
  '["missing_price"]'::jsonb, 'e o pao sem preco volta a travar o a cobrar');

-- 7. Dois trechos abertos com o mesmo pao: um arredondamento so -----------

-- Em 07/09 a 11/10 a semana de 21/09 esta cobrada (a da funcao antiga): ficam
-- dois trechos abertos. 1,003 kg em cada um a 38,00: cada trecho daria 38,11,
-- e a linha reunida precisa dar 2,006 kg x 38,00 = 76,23, nao 76,22.
reset role;
insert into public.breads (id, name, days, active, unit, is_special, is_shelf)
values ('teste-fech-arredonda', '[TESTE] Ciabatta Arredonda Fechamento', '{0,1,2,3,4,5,6}', true, 'kg', false, false)
on conflict (id) do nothing;
insert into public.price_tier_items (
  id, tier_id, product_id, product_source, product_name, unit_price, pricing_unit, pack_size, active
) values (
  '98300000-0000-4000-8000-0000000000a4', '98300000-0000-4000-8000-0000000000a0',
  'teste-fech-arredonda', 'bread', '[TESTE] Ciabatta Arredonda Fechamento', 38.00, 'kg', 1, true
);
insert into public.romaneios (id, destination_id, record_date, trip_number, status, created_by)
select romaneio.id, destino.id, romaneio.record_date, 7, 'enviado', 'Teste'
from (values
  ('98300000-0000-4000-8000-0000000000b7'::uuid, date '2026-09-09'),
  ('98300000-0000-4000-8000-0000000000b8'::uuid, date '2026-10-06')
) romaneio(id, record_date)
cross join lateral (
  select d.id from public.destinations d where upper(d.code) = 'EX' and d.active order by d.id limit 1
) destino;
insert into public.romaneio_items (id, romaneio_id, product_id, product_source, product_name, qty_sent, qty_accepted)
values
  ('98300000-0000-4000-8000-0000000000d9', '98300000-0000-4000-8000-0000000000b7', 'teste-fech-arredonda', 'bread', '[TESTE] Ciabatta Arredonda Fechamento', 1.003, null),
  ('98300000-0000-4000-8000-0000000000da', '98300000-0000-4000-8000-0000000000b8', 'teste-fech-arredonda', 'bread', '[TESTE] Ciabatta Arredonda Fechamento', 1.003, null);
set local role authenticated;
select set_config('request.jwt.claim.sub', '98300000-0000-4000-8000-000000000001', true);

select is(
  (select jsonb_build_object('quantidade', (l ->> 'quantidade')::numeric, 'total', (l ->> 'total')::numeric)
     from pg_temp.linha(pg_temp.fechamento('2026-09-07', '2026-10-11') -> 'a_cobrar', '[TESTE] Ciabatta Arredonda Fechamento') l),
  '{"quantidade": 2.006, "total": 76.23}'::jsonb,
  'a linha reunida de dois trechos arredonda uma vez so: 2,006 kg x 38,00 = 76,23');

-- 8. Seguranca --------------------------------------------------------------

reset role;
select ok(not has_function_privilege('anon', 'public.list_romaneio_ex_fechamento(date, date)', 'execute'),
  'anon nao chama o Fechamento EX');
select ok(has_function_privilege('authenticated', 'public.list_romaneio_ex_fechamento(date, date)', 'execute'),
  'authenticated chama, e a funcao decide quem le');
select ok(not has_function_privilege('authenticated', 'private.fechamento_ex_ordem_problema(text)', 'execute'),
  'a ordem dos problemas fica fechada');
select is(
  (select jsonb_build_object('definer', proc.prosecdef, 'volatilidade', proc.provolatile::text, 'config', to_jsonb(proc.proconfig))
     from pg_proc proc
    where proc.oid = 'public.list_romaneio_ex_fechamento(date, date)'::regprocedure),
  '{"definer": true, "volatilidade": "s", "config": ["search_path=\"\""]}'::jsonb,
  'funcao de leitura, com dono e caminho de busca vazio');

-- O PostgREST chama funcao de leitura em transacao so de leitura.
set transaction read only;
set local role authenticated;
select set_config('request.jwt.claim.sub', '98300000-0000-4000-8000-000000000001', true);
select lives_ok($$ select public.list_romaneio_ex_fechamento('2026-09-07', '2026-09-27') $$,
  'roda em transacao so de leitura');

select * from finish();
rollback;
