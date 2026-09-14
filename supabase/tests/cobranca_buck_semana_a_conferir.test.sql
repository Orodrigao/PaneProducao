-- Semana da Buck a conferir (migration 20260914030000).
--
-- O que o teste protege:
--   * so o financeiro ve a lista e confirma; a Expedicao da EX e bloqueada;
--   * a semana vai de segunda a domingo, comeca em 31/08/2026 e so aparece
--     depois que o domingo passou;
--   * o valor dos romaneios sai do banco; ajustes somam com motivo e limites;
--   * a confirmacao exige a composicao que a tela mostrou;
--   * a cobranca guarda a foto das linhas e dos ajustes;
--   * repetir o mesmo pedido devolve a mesma cobranca; mudar os ajustes ou
--     cobrar a semana de novo e recusado;
--   * a receita da Buck so entra no livro vinda do Contas a receber, e o
--     estorno de lancamento antigo continua possivel;
--   * cobranca da Buck nao e parcelada nem recebe mais do que falta.
--
-- As semanas usadas sao de agosto e setembro de 2026, com datas fixas: o seed
-- do Preview grava romaneios da EX em "hoje menos 3 e 5 dias", que nao caem
-- nelas. So a semana de 31/08 e usada como semana fechada: qualquer semana
-- posterior pode ainda estar aberta no dia em que o teste roda.

begin;
create extension if not exists pgtap with schema extensions;

select plan(50);

-- Cenario ------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('97000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'financeiro-semana-buck-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'expedicao-ex-semana-buck-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('97000000-0000-4000-8000-000000000001', 'Teste Financeiro Semana Buck', 'financeiro', 'jc', true, '["/contas-receber", "/financeiro"]'::jsonb),
  ('97000000-0000-4000-8000-000000000002', 'Teste Expedicao EX Semana Buck', 'expedicao', 'ex', true, '["/romaneio"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values
  ('97000000-0000-4000-8000-000000000001', 'contas_receber.acessar', 'jc', null),
  ('97000000-0000-4000-8000-000000000001', 'contas_receber.lancar', 'jc', null),
  ('97000000-0000-4000-8000-000000000001', 'contas_receber.baixar', 'jc', null),
  ('97000000-0000-4000-8000-000000000001', 'financeiro.acessar', '*', null),
  ('97000000-0000-4000-8000-000000000001', 'financeiro.lancar', '*', null),
  ('97000000-0000-4000-8000-000000000001', 'financeiro.estornar', '*', null),
  ('97000000-0000-4000-8000-000000000002', 'romaneio.acessar', 'ex', null);

-- A Buck so e criada quando nao existe: duas com o mesmo nome deixariam a
-- escolha do cliente ao acaso.
insert into public.customers (id, name, payment_term_days, active)
select '97000000-0000-4000-8000-0000000000c1', 'Buck', 15, true
where not exists (select 1 from public.customers c where lower(trim(c.name)) = 'buck');

update public.customers set payment_term_days = 15
where lower(trim(name)) = 'buck' and payment_term_days is null;

insert into public.breads (id, name, days, active, unit, is_special, is_shelf)
values
  ('teste-semana-buck-pao', '[TESTE] Pao Semana Buck', '{0,1,2,3,4,5,6}', true, 'un', false, false),
  ('teste-semana-buck-ciabatta', '[TESTE] Ciabatta Semana Buck', '{0,1,2,3,4,5,6}', true, 'kg', false, false),
  ('teste-semana-buck-sem-preco', '[TESTE] Pao Semana Buck Sem Preco', '{0,1,2,3,4,5,6}', true, 'un', false, false)
on conflict (id) do nothing;

insert into public.price_tiers (id, name, description, active)
values ('97000000-0000-4000-8000-0000000000a1', 'BUCK', 'Tabela de teste da semana a conferir', true)
on conflict (name) do nothing;

insert into public.price_tier_items (
  id, tier_id, product_id, product_source, product_name, unit_price, pricing_unit, pack_size, active
)
select preco.id, tabela.id, preco.product_id, 'bread', preco.product_name, preco.unit_price, preco.pricing_unit, 1, true
from (values
  ('97000000-0000-4000-8000-0000000000a2'::uuid, 'teste-semana-buck-pao', '[TESTE] Pao Semana Buck', 2.00, 'un'),
  ('97000000-0000-4000-8000-0000000000a3'::uuid, 'teste-semana-buck-ciabatta', '[TESTE] Ciabatta Semana Buck', 40.00, 'kg')
) as preco(id, product_id, product_name, unit_price, pricing_unit)
cross join (select id from public.price_tiers where name = 'BUCK' limit 1) tabela
on conflict (id) do nothing;

insert into public.destinations (id, name, code, type, requires_conferencia, active)
select '97000000-0000-4000-8000-0000000000e1', '[TESTE] Exposicao', 'EX', 'loja', true, true
where not exists (select 1 from public.destinations d where upper(d.code) = 'EX');

insert into public.finance_accounts (id, key, label, kind, store, active)
values ('97000000-0000-4000-8000-0000000000f1', 'teste-semana-buck-banco', '[TESTE] Banco Semana Buck', 'banco', null, true)
on conflict (key) do nothing;

-- Semana de 31/08 a 06/09: pao 90 aceitos de 100 (180,00), ciabatta 2,5 kg
-- sem conferencia (100,00) e um romaneio separado que nao conta. Total 280,00.
-- Semana de 24/08: antes do corte.
insert into public.romaneios (id, destination_id, record_date, trip_number, status, created_by)
select romaneio.id, d.id, romaneio.record_date, romaneio.trip_number, romaneio.status, 'Teste'
from (values
  ('97000000-0000-4000-8000-0000000000b1'::uuid, date '2026-09-01', 71, 'enviado'),
  ('97000000-0000-4000-8000-0000000000b2'::uuid, date '2026-09-03', 71, 'enviado'),
  ('97000000-0000-4000-8000-0000000000b3'::uuid, date '2026-09-02', 72, 'separado'),
  ('97000000-0000-4000-8000-0000000000b5'::uuid, date '2026-08-25', 71, 'enviado')
) as romaneio(id, record_date, trip_number, status)
cross join lateral (
  select id from public.destinations where upper(code) = 'EX' and active order by id limit 1
) d;

insert into public.romaneio_items (id, romaneio_id, product_id, product_source, product_name, qty_sent, qty_accepted)
values
  ('97000000-0000-4000-8000-0000000000d1', '97000000-0000-4000-8000-0000000000b1',
   'teste-semana-buck-pao', 'bread', '[TESTE] Pao Semana Buck', 100, 90),
  ('97000000-0000-4000-8000-0000000000d2', '97000000-0000-4000-8000-0000000000b2',
   'teste-semana-buck-ciabatta', 'bread', '[TESTE] Ciabatta Semana Buck', 2.5, null),
  ('97000000-0000-4000-8000-0000000000d3', '97000000-0000-4000-8000-0000000000b3',
   'teste-semana-buck-pao', 'bread', '[TESTE] Pao Semana Buck', 50, null),
  ('97000000-0000-4000-8000-0000000000d5', '97000000-0000-4000-8000-0000000000b5',
   'teste-semana-buck-pao', 'bread', '[TESTE] Pao Semana Buck', 10, null);

-- Privilegios ---------------------------------------------------------------

select has_table('public', 'receivable_adjustments', 'a tabela de ajustes existe');
select has_table('public', 'receivable_romaneio_lines', 'a tabela da foto das linhas existe');

select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
    where oid in ('public.receivable_adjustments'::regclass, 'public.receivable_romaneio_lines'::regclass)),
  'as duas tabelas novas tem RLS ligada e forcada'
);

select ok(
  not has_table_privilege('authenticated', 'public.receivable_adjustments', 'insert')
  and not has_table_privilege('authenticated', 'public.receivable_adjustments', 'update')
  and not has_table_privilege('authenticated', 'public.receivable_adjustments', 'delete')
  and not has_table_privilege('authenticated', 'public.receivable_romaneio_lines', 'insert')
  and not has_table_privilege('authenticated', 'public.receivable_romaneio_lines', 'update')
  and not has_table_privilege('authenticated', 'public.receivable_romaneio_lines', 'delete'),
  'usuario logado nao escreve direto nas tabelas novas'
);

select ok(
  not has_table_privilege('anon', 'public.receivable_adjustments', 'select')
  and not has_table_privilege('anon', 'public.receivable_romaneio_lines', 'select')
  and has_table_privilege('authenticated', 'public.receivable_adjustments', 'select')
  and has_table_privilege('authenticated', 'public.receivable_romaneio_lines', 'select'),
  'anonimo nao le as tabelas novas; logado le, filtrado pela policy'
);

select ok(
  not has_function_privilege('anon', 'public.list_buck_weeks_to_bill()', 'execute')
  and not has_function_privilege('anon', 'public.create_buck_weekly_receivable(uuid, date, date, numeric, text, jsonb)', 'execute'),
  'anonimo nao chama a lista nem a confirmacao'
);

select ok(
  has_function_privilege('authenticated', 'public.list_buck_weeks_to_bill()', 'execute')
  and has_function_privilege('authenticated', 'public.create_buck_weekly_receivable(uuid, date, date, numeric, text, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'private.calcular_cobranca_buck_detalhada(date, date)', 'execute'),
  'logado chama as portas publicas, mas nao a conta interna'
);

-- A Expedicao da EX nao ve nem cobra -----------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000002', true);

select is(
  (select count(*)::int from public.list_buck_weeks_to_bill()), 0,
  'Expedicao da EX nao ve semanas a cobrar'
);

select throws_ok(
  $$ select public.create_buck_weekly_receivable(gen_random_uuid(), '2026-08-31', '2026-09-06', 280.00, 'x', '[]'::jsonb) $$,
  '42501',
  'Sem permissão para lançar cobranças.',
  'Expedicao da EX nao confirma cobranca'
);

-- A lista do financeiro ------------------------------------------------------

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true);

select is(
  (select amount from public.list_buck_weeks_to_bill() where period_start = '2026-08-31'),
  280.00::numeric,
  'semana de 31/08 aparece com o valor dos romaneios: 90 x 2,00 + 2,5 kg x 40,00'
);

select is(
  (select romaneios || '/' || romaneios_sem_conferencia || '/' || period_end || '/' || length(composicao)
     from public.list_buck_weeks_to_bill() where period_start = '2026-08-31'),
  '2/2/2026-09-06/32',
  'o romaneio separado nao conta; os dois enviados aparecem sem conferencia; semana termina no domingo e traz a composicao'
);

select ok(
  not exists (select 1 from public.list_buck_weeks_to_bill() where period_start < '2026-08-31'),
  'semanas antes de 31/08 ja estao no livro e nunca aparecem'
);

select is(
  (select lancamentos_diretos from public.list_buck_weeks_to_bill() where period_start = '2026-08-31'),
  0,
  'sem lancamento direto no livro, a semana nao tem aviso'
);

-- A trava do livro -----------------------------------------------------------

select throws_ok(
  $$ select public.create_finance_entry(gen_random_uuid(), 'buck_ex', 'teste-semana-buck-banco', 'jc', 100, '2026-09-10', 'pix', 'Buck direto no livro') $$,
  '22023',
  'A receita da Buck entra pelo Contas a receber: registre o recebimento na cobrança da semana, não direto no livro-caixa.',
  'lancamento avulso de receita da Buck no livro e recusado'
);

select lives_ok(
  $$ select public.create_finance_entry(gen_random_uuid(), 'clientes_pj', 'teste-semana-buck-banco', 'jc', 100, '2026-09-10', 'pix', 'Cliente PJ direto no livro') $$,
  'a trava vale so para a Buck: outra receita avulsa continua entrando'
);

-- Um lancamento direto antigo, gravado como antes da trava existir, pago DENTRO
-- da propria semana: e o caso que o aviso nao pode perder.
reset role;
alter table public.finance_entries disable trigger finance_entries_guard_receita_buck;
set local role authenticated;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$ select public.create_finance_entry('97000000-0000-4000-8000-0000000000e9', 'buck_ex', 'teste-semana-buck-banco', 'jc', 50, '2026-09-05', 'dinheiro', 'Buck direto no livro antes da trava') $$,
  'cenario: lancamento direto da Buck gravado antes da trava, pago dentro da semana'
);

reset role;
alter table public.finance_entries enable trigger finance_entries_guard_receita_buck;
select set_config('teste.legado_id',
  (select id::text from public.finance_entries where request_id = '97000000-0000-4000-8000-0000000000e9'), true);
set local role authenticated;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true);

select is(
  (select lancamentos_diretos from public.list_buck_weeks_to_bill() where period_start = '2026-08-31'),
  1,
  'lancamento direto da Buck pago dentro da semana aparece como aviso na lista'
);

select lives_ok(
  $$ select public.reverse_finance_entry(gen_random_uuid(), current_setting('teste.legado_id')::uuid, 'Receita da Buck vai pelo Contas a receber') $$,
  'estorno de lancamento direto antigo da Buck continua possivel'
);

select is(
  (select lancamentos_diretos from public.list_buck_weeks_to_bill() where period_start = '2026-08-31'),
  0,
  'depois do estorno o aviso some'
);

-- Recusas da confirmacao -----------------------------------------------------

select throws_ok(
  $$ select public.create_buck_weekly_receivable(gen_random_uuid(), '2026-09-01', '2026-09-07', 280.00, 'x', '[]'::jsonb) $$,
  '22023',
  'A cobrança da Buck vai de segunda a domingo.',
  'semana que nao comeca na segunda e recusada'
);

select throws_ok(
  $$ select public.create_buck_weekly_receivable(gen_random_uuid(), '2026-08-24', '2026-08-30', 20.00, 'x', '[]'::jsonb) $$,
  '22023',
  'Semanas anteriores a 31/08/2026 já foram lançadas no livro-caixa e não entram aqui.',
  'semana antes do corte e recusada'
);

select throws_ok(
  format(
    $$ select public.create_buck_weekly_receivable(gen_random_uuid(), %L, %L, 1.00, 'x', '[]'::jsonb) $$,
    date_trunc('week', private.data_na_padaria())::date,
    date_trunc('week', private.data_na_padaria())::date + 6
  ),
  '22023',
  'A semana ainda não terminou. Cobre depois do domingo.',
  'semana em andamento e recusada'
);

-- Um produto sem preco entra na semana so para provar o bloqueio, e sai.
reset role;
insert into public.romaneio_items (id, romaneio_id, product_id, product_source, product_name, qty_sent, qty_accepted)
values ('97000000-0000-4000-8000-0000000000d4', '97000000-0000-4000-8000-0000000000b2',
        'teste-semana-buck-sem-preco', 'bread', '[TESTE] Pao Semana Buck Sem Preco', 10, null);
set local role authenticated;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true);

select ok(
  (select 'missing_price' = any(problemas) from public.list_buck_weeks_to_bill() where period_start = '2026-08-31'),
  'semana com produto sem preco continua na lista, marcada com o bloqueio'
);

select throws_ok(
  $$ select public.create_buck_weekly_receivable(gen_random_uuid(), '2026-08-31', '2026-09-06', 280.00, 'x', '[]'::jsonb) $$,
  '22023',
  'Há produto sem preço na tabela BUCK nesta semana. Cadastre o preço antes de cobrar.',
  'semana com produto sem preco e recusada'
);

reset role;
delete from public.romaneio_items where id = '97000000-0000-4000-8000-0000000000d4';
set local role authenticated;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$ select public.create_buck_weekly_receivable(gen_random_uuid(), '2026-08-31', '2026-09-06', 279.99, 'x', '[]'::jsonb) $$,
  '22023',
  'A tela mostrou 279.99 nos romaneios e o banco calculou 280.00. Nada foi cobrado. Atualize a tela e confira a semana.',
  'valor dos romaneios diferente do banco e recusado'
);

-- A composicao que a tela viu. Depois, dois produtos mudam sem mudar o total:
-- pao sobe 5 unidades (+10,00) e ciabatta desce 0,25 kg (-10,00).
select set_config('teste.composicao_vista',
  (select composicao from public.list_buck_weeks_to_bill() where period_start = '2026-08-31'), true);

reset role;
update public.romaneio_items set qty_accepted = 95 where id = '97000000-0000-4000-8000-0000000000d1';
update public.romaneio_items set qty_sent = 2.25 where id = '97000000-0000-4000-8000-0000000000d2';
set local role authenticated;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$ select public.create_buck_weekly_receivable(gen_random_uuid(), '2026-08-31', '2026-09-06', 280.00,
       current_setting('teste.composicao_vista'), '[]'::jsonb) $$,
  '22023',
  'Os romaneios desta semana mudaram depois que a tela abriu. Nada foi cobrado. Atualize a tela e confira de novo.',
  'romaneio alterado sem mudar o total exige nova conferencia'
);

reset role;
update public.romaneio_items set qty_accepted = 90 where id = '97000000-0000-4000-8000-0000000000d1';
update public.romaneio_items set qty_sent = 2.5 where id = '97000000-0000-4000-8000-0000000000d2';
set local role authenticated;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true);

select is(
  (select composicao from public.list_buck_weeks_to_bill() where period_start = '2026-08-31'),
  current_setting('teste.composicao_vista'),
  'desfeita a mudanca, a composicao volta a ser a mesma'
);

select throws_ok(
  $$ select public.create_buck_weekly_receivable(gen_random_uuid(), '2026-08-31', '2026-09-06', 280.00, 'x',
       '[{"kind": "acerto", "description": "ok", "amount": 10}]'::jsonb) $$,
  '22023',
  'Ajuste 1: descreva o motivo com 3 a 200 letras.',
  'ajuste sem motivo e recusado'
);

select throws_ok(
  $$ select public.create_buck_weekly_receivable(gen_random_uuid(), '2026-08-31', '2026-09-06', 280.00, 'x',
       '[{"kind": "preco_combinado", "description": "Preco combinado alto demais", "amount": 5000.01}]'::jsonb) $$,
  '22023',
  'Ajuste 1: informe um valor diferente de zero, até R$ 5.000,00 para mais ou para menos.',
  'ajuste acima de 5.000,00 e recusado'
);

select throws_ok(
  $$ select public.create_buck_weekly_receivable(gen_random_uuid(), '2026-08-31', '2026-09-06', 280.00, 'x',
       (select jsonb_agg(jsonb_build_object('kind', 'acerto', 'description', 'Acerto numero ' || n, 'amount', 1))
          from generate_series(1, 21) n)) $$,
  '22023',
  'No máximo 20 ajustes por semana.',
  'mais de 20 ajustes e recusado'
);

select throws_ok(
  $$ select public.create_buck_weekly_receivable(gen_random_uuid(), '2026-08-31', '2026-09-06', 280.00,
       current_setting('teste.composicao_vista'),
       '[{"kind": "acerto", "description": "Devolucao da semana inteira", "amount": -280}]'::jsonb) $$,
  '22023',
  'Com os ajustes, a cobrança ficaria em zero ou negativa. Confira os valores.',
  'ajustes que zeram a cobranca sao recusados'
);

-- Caminho feliz --------------------------------------------------------------
-- 280,00 dos romaneios + 10 un x 1,50 sem romaneio + 12,34 de preco combinado
-- - 7,34 de acerto = 300,00.

select isnt(
  set_config('teste.cobranca_id',
    public.create_buck_weekly_receivable(
      '97000000-0000-4000-8000-0000000000c9', '2026-08-31', '2026-09-06', 280.00,
      current_setting('teste.composicao_vista'),
      '[{"kind": "produto_sem_romaneio", "description": "Pao frances que saiu sem romaneio", "product_name": "Pao frances", "quantity": 10, "unit": "un", "unit_price": 1.5},
        {"kind": "preco_combinado", "description": "Brioche no preco combinado", "amount": 12.34},
        {"kind": "acerto", "description": "Arredondamento combinado", "amount": -7.34}]'::jsonb
    )::text,
    true),
  null,
  'confirmar a semana com ajustes cria a cobranca'
);

select is(
  (select amount from public.receivables where id = current_setting('teste.cobranca_id')::uuid),
  300.00::numeric,
  'valor da cobranca e romaneios mais ajustes'
);

select is(
  (select origin || '|' || period_start || '|' || period_end || '|' || invoice_date || '|' || due_date || '|' || installment_count
     from public.receivables where id = current_setting('teste.cobranca_id')::uuid),
  'romaneio_ex|2026-08-31|2026-09-06|2026-09-06|2026-09-21|1',
  'cobranca inteira, faturada no domingo, vence em 15 dias'
);

select is(
  (select category.key from public.receivables cobranca
     join public.finance_categories category on category.id = cobranca.finance_category_id
    where cobranca.id = current_setting('teste.cobranca_id')::uuid),
  'buck_ex',
  'receita da cobranca cai em buck_ex'
);

select is(
  (select count(*) || '/' || sum(total) from public.receivable_romaneio_lines
    where receivable_id = current_setting('teste.cobranca_id')::uuid),
  '2/280.00',
  'a foto guarda as duas linhas dos romaneios somando 280,00'
);

select is(
  (select quantidade || '|' || (itens -> 0 ->> 'origem_quantidade') || '|' || (itens -> 0 ->> 'romaneio_item_id')
     from public.receivable_romaneio_lines
    where receivable_id = current_setting('teste.cobranca_id')::uuid and product_id = 'teste-semana-buck-pao'),
  '90|aceito|97000000-0000-4000-8000-0000000000d1',
  'a linha do pao guarda a quantidade aceita e o item de romaneio de origem'
);

select is(
  (select string_agg(position || ':' || kind || ':' || amount, ',' order by position)
     from public.receivable_adjustments where receivable_id = current_setting('teste.cobranca_id')::uuid),
  '1:produto_sem_romaneio:15.00,2:preco_combinado:12.34,3:acerto:-7.34',
  'os tres ajustes ficam gravados na ordem, com o valor do pao sem romaneio calculado'
);

select is(
  (select (details ->> 'total_romaneios') || '|' || (details ->> 'total_ajustes') || '|' || (details ->> 'romaneios_sem_conferencia')
     from public.receivable_events
    where receivable_id = current_setting('teste.cobranca_id')::uuid and event_type = 'lancada'),
  '280.00|20.00|2',
  'o evento registra valor dos romaneios, soma dos ajustes e romaneios sem conferencia'
);

select is(
  public.create_buck_weekly_receivable(
    '97000000-0000-4000-8000-0000000000c9', '2026-08-31', '2026-09-06', 280.00,
    current_setting('teste.composicao_vista'),
    '[{"kind": "produto_sem_romaneio", "description": "Pao frances que saiu sem romaneio", "product_name": "Pao frances", "quantity": 10, "unit": "un", "unit_price": 1.5},
      {"kind": "preco_combinado", "description": "Brioche no preco combinado", "amount": 12.34},
      {"kind": "acerto", "description": "Arredondamento combinado", "amount": -7.34}]'::jsonb
  )::text,
  current_setting('teste.cobranca_id'),
  'repetir o mesmo pedido devolve a mesma cobranca'
);

select throws_ok(
  $$ select public.create_buck_weekly_receivable(
       '97000000-0000-4000-8000-0000000000c9', '2026-08-31', '2026-09-06', 280.00, 'x',
       '[{"kind": "acerto", "description": "Outro acerto", "amount": 5}]'::jsonb) $$,
  '22023',
  'Este pedido de cobrança já foi usado com outra semana ou outros ajustes. Atualize a tela e confira as cobranças da Buck.',
  'repetir o pedido com ajustes diferentes e recusado'
);

select throws_ok(
  $$ select public.create_buck_weekly_receivable(gen_random_uuid(), '2026-08-31', '2026-09-06', 280.00, 'x', '[]'::jsonb) $$,
  '22023',
  'Esta semana já tem cobrança da Buck. Confira a lista de cobranças.',
  'cobrar a mesma semana de novo e recusado'
);

select ok(
  not exists (select 1 from public.list_buck_weeks_to_bill() where period_start = '2026-08-31'),
  'semana cobrada sai da lista'
);

select throws_ok(
  format($$ select public.split_receivable(gen_random_uuid(), %L, 2) $$, current_setting('teste.cobranca_id')),
  '22023',
  'A cobrança da Buck não é dividida em parcelas: registre cada pagamento como um recebimento.',
  'cobranca da Buck nao e parcelada'
);

-- Recebimento em pedacos -----------------------------------------------------

select lives_ok(
  format($$ select public.record_receivable_receipt(gen_random_uuid(), %L, '2026-09-10', 100, 'pix', 'teste-semana-buck-banco') $$,
    current_setting('teste.cobranca_id')),
  'recebimento em pedaco da cobranca da Buck passa pela trava do livro'
);

select throws_ok(
  format($$ select public.record_receivable_receipt(gen_random_uuid(), %L, '2026-09-11', 250, 'dinheiro', 'teste-semana-buck-banco') $$,
    current_setting('teste.cobranca_id')),
  '22023',
  'Esta cobrança da Buck tem R$ 200,00 em aberto. Registre no máximo esse valor; o que passar pertence a outra semana.',
  'pedaco maior que o saldo em aberto da Buck e recusado'
);

-- Registrar e ler a situacao ficam em instrucoes separadas: na mesma
-- instrucao, a leitura enxerga a cobranca de antes do recebimento.
select lives_ok(
  format($$ select public.record_receivable_receipt(gen_random_uuid(), %L, '2026-09-11', 200, 'dinheiro', 'teste-semana-buck-banco') $$,
    current_setting('teste.cobranca_id')),
  'o pedaco exato do saldo em aberto e aceito'
);

select is(
  (select status from public.receivables where id = current_setting('teste.cobranca_id')::uuid),
  'recebida',
  'com o saldo recebido, a cobranca da Buck fica quitada'
);

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000002', true);

select is(
  (select count(*) from public.receivable_adjustments) || '/' || (select count(*) from public.receivable_romaneio_lines),
  '0/0',
  'Expedicao da EX nao le ajustes nem linhas de cobranca'
);

reset role;

select is(
  (select string_agg(entrada.source || '|' || entrada.competence_month || '|' || entrada.amount, ',' order by entrada.amount)
     from public.finance_entries entrada
     join public.finance_categories categoria on categoria.id = entrada.category_id
    where categoria.key = 'buck_ex' and entrada.source = 'contas_receber'
      and entrada.source_ref in (select id from public.receivable_receipts
                                  where receivable_id = current_setting('teste.cobranca_id')::uuid)),
  'contas_receber|2026-09-01|100.00,contas_receber|2026-09-01|200.00',
  'os dois pedacos entram no livro como receita da Buck, no mes do faturamento, somando o valor cobrado'
);

select * from finish();
rollback;
