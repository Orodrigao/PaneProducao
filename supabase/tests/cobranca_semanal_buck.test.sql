-- Fase 4 do Contas a Receber: a conta da semana da Buck.
--
-- Este é o fluxo do episódio dos R$ 190 mil. O que o teste protege:
--   * o valor sai da soma no banco, não do que a tela mandou;
--   * total divergente entre tela e banco RECUSA a cobrança;
--   * produto sem preço, unidade incompatível e peso suspeito bloqueiam;
--   * período que encosta em outro já cobrado é recusado pelo banco;
--   * a receita cai em buck_ex, com competência no fim do período.

begin;
create extension if not exists pgtap with schema extensions;

select plan(19);

-- Cenário ------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('96000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'financeiro-buck-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('96000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'romaneio-ex-buck-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('96000000-0000-4000-8000-000000000001', 'Teste Financeiro Buck', 'financeiro', 'jc', true, '["/contas-receber"]'::jsonb),
  ('96000000-0000-4000-8000-000000000002', 'Teste Romaneio EX Buck', 'expedicao', 'ex', true, '["/romaneio"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values
  ('96000000-0000-4000-8000-000000000001', 'contas_receber.acessar', 'jc', null),
  ('96000000-0000-4000-8000-000000000001', 'contas_receber.lancar', 'jc', null),
  ('96000000-0000-4000-8000-000000000001', 'contas_receber.cancelar', 'jc', null),
  ('96000000-0000-4000-8000-000000000001', 'financeiro.acessar', '*', null),
  ('96000000-0000-4000-8000-000000000002', 'romaneio.acessar', 'ex', null);

-- A Buck precisa existir com prazo. A migration preenche 15 dias; num banco
-- de teste sem o cliente, cria-se aqui.
insert into public.customers (id, name, payment_term_days, active)
values ('96000000-0000-4000-8000-0000000000c1', 'Buck', 15, true)
on conflict (id) do nothing;

update public.customers set payment_term_days = 15
where lower(trim(name)) = 'buck' and payment_term_days is null;

insert into public.breads (id, name, days, active, unit, is_special, is_shelf)
values
  ('teste-buck-pao', '[TESTE] Pao Buck', '{0,1,2,3,4,5,6}', true, 'un', false, false),
  ('teste-buck-ciabatta', '[TESTE] Ciabatta Buck', '{0,1,2,3,4,5,6}', true, 'kg', false, false),
  ('teste-buck-sem-preco', '[TESTE] Pao Buck Sem Preco', '{0,1,2,3,4,5,6}', true, 'un', false, false)
on conflict (id) do nothing;

insert into public.price_tiers (id, name, description, active)
values ('96000000-0000-4000-8000-0000000000a1', 'BUCK', 'Tabela de teste da fase 4', true)
on conflict (id) do nothing;

-- Preço só para dois dos três produtos: o terceiro serve para provar a trava.
insert into public.price_tier_items (
  id, tier_id, product_id, product_source, product_name, unit_price, pricing_unit, pack_size, active
) values
  ('96000000-0000-4000-8000-0000000000a2', '96000000-0000-4000-8000-0000000000a1',
   'teste-buck-pao', 'bread', '[TESTE] Pao Buck', 2.00, 'un', 1, true),
  ('96000000-0000-4000-8000-0000000000a3', '96000000-0000-4000-8000-0000000000a1',
   'teste-buck-ciabatta', 'bread', '[TESTE] Ciabatta Buck', 40.00, 'kg', 1, true)
on conflict (id) do nothing;

-- No banco limpo do CI so as migrations rodam, entao a loja EX pode nao
-- existir. No Banco Preview ela ja vem do seed e o conflito nao faz nada.
insert into public.destinations (id, name, code, type, requires_conferencia, active)
values ('96000000-0000-4000-8000-0000000000e1', '[TESTE] Exposicao', 'EX', 'loja', true, true)
on conflict (code) do nothing;

-- Dois romaneios da EX no período: 10 + 15 unidades de pão (2,00) e 2,5 kg de
-- ciabatta (40,00). Total esperado: 50,00 + 100,00 = 150,00.
insert into public.romaneios (id, destination_id, record_date, trip_number, status, created_by)
select '96000000-0000-4000-8000-0000000000b1', d.id, current_date - 5, 1, 'enviado', 'Teste'
from public.destinations d where d.code = 'EX'
on conflict (id) do nothing;

insert into public.romaneios (id, destination_id, record_date, trip_number, status, created_by)
select '96000000-0000-4000-8000-0000000000b2', d.id, current_date - 3, 1, 'enviado', 'Teste'
from public.destinations d where d.code = 'EX'
on conflict (id) do nothing;

insert into public.romaneio_items (id, romaneio_id, product_id, product_source, product_name, qty_sent, qty_accepted)
values
  ('96000000-0000-4000-8000-0000000000d1', '96000000-0000-4000-8000-0000000000b1',
   'teste-buck-pao', 'bread', '[TESTE] Pao Buck', 10, null),
  ('96000000-0000-4000-8000-0000000000d2', '96000000-0000-4000-8000-0000000000b2',
   'teste-buck-pao', 'bread', '[TESTE] Pao Buck', 20, 15),
  ('96000000-0000-4000-8000-0000000000d3', '96000000-0000-4000-8000-0000000000b1',
   'teste-buck-ciabatta', 'bread', '[TESTE] Ciabatta Buck', 2.5, null);

-- A conta somada no banco ---------------------------------------------------
-- Pela porta publica, que e a mesma que a tela usa: a funcao interna e fechada
-- ate para o usuario logado, e este teste confirma isso ao nao conseguir
-- chama-la.

set local role authenticated;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$ select * from private.calcular_cobranca_buck(current_date - 7, current_date) $$,
  '42501',
  'permission denied for function calcular_cobranca_buck',
  'usuario logado nao alcanca a funcao interna que soma a conta'
);

select is((select sum(total) from public.preview_receivable_from_romaneio(current_date - 7, current_date)), 150.00,
  'o banco soma 150,00: pao 25 x 2,00 mais ciabatta 2,5 kg x 40,00');

select is((select quantidade from public.preview_receivable_from_romaneio(current_date - 7, current_date)
    where produto = '[TESTE] Pao Buck'), 25::numeric,
  'o mesmo produto de duas viagens vira uma linha somada');

select is((select quantidade from public.preview_receivable_from_romaneio(current_date - 7, current_date)
    where produto = '[TESTE] Pao Buck' and unidade = 'un'), 25::numeric,
  'a Buck paga o que recebeu: 10 enviados sem conferencia mais 15 aceitos de 20');

select is((select unidade from public.preview_receivable_from_romaneio(current_date - 7, current_date)
    where produto = '[TESTE] Ciabatta Buck'), 'kg',
  'ciabatta e cobrada por quilo mesmo sem sufixo no nome');

-- Divergência entre a tela e o banco ---------------------------------------

select throws_ok(
  $$ select public.create_receivable_from_romaneio(
       '96000000-0000-4000-8000-00000000f001'::uuid,
       current_date - 7, current_date, 190000.00
     ) $$,
  '22023',
  'A tela mostrou 190000.00 e o banco calculou 150.00. Nada foi cobrado. Atualize a tela e confira o período.',
  'total divergente da tela e recusado, e os dois numeros aparecem'
);

select is((select count(*)::int from public.receivables where origin = 'romaneio_ex'), 0,
  'a divergencia nao deixou cobranca nenhuma para tras');

-- Geração da cobrança -------------------------------------------------------

select lives_ok(
  $$ select public.create_receivable_from_romaneio(
       '96000000-0000-4000-8000-00000000f002'::uuid,
       current_date - 7, current_date, 150.00
     ) $$,
  'financeiro gera a conta da semana com o total conferido'
);

select is((select amount from public.receivables where origin = 'romaneio_ex'), 150.00,
  'o valor cobrado e o somado no banco');

select is((select invoice_date from public.receivables where origin = 'romaneio_ex'), current_date,
  'a data do faturamento e o ultimo dia do periodo');

select is((select due_date from public.receivables where origin = 'romaneio_ex'), current_date + 15,
  'o vencimento sai do prazo de 15 dias da Buck');

select is((select category.key from public.receivables cobranca
    join public.finance_categories category on category.id = cobranca.finance_category_id
    where cobranca.origin = 'romaneio_ex'), 'buck_ex',
  'a receita da Buck cai na categoria dela, nao em clientes PJ');

select is((select period_start from public.receivables where origin = 'romaneio_ex'), current_date - 7,
  'a cobranca guarda o periodo que a gerou');

-- Repetir e sobrepor --------------------------------------------------------

select is(
  (select public.create_receivable_from_romaneio(
     '96000000-0000-4000-8000-00000000f002'::uuid,
     current_date - 7, current_date, 150.00)),
  (select id from public.receivables where origin = 'romaneio_ex'),
  'repetir a mesma geracao devolve a mesma cobranca'
);

select throws_ok(
  $$ select public.create_receivable_from_romaneio(
       '96000000-0000-4000-8000-00000000f003'::uuid,
       -- Sem total de conferencia: e a trava de sobreposicao que precisa
       -- responder aqui, nao a comparacao de totais.
       current_date - 4, current_date - 1, null
     ) $$,
  '22023',
  'Este período encosta em outro já cobrado. Confira as cobranças da Buck antes de gerar.',
  'periodo que encosta em outro ja cobrado e recusado pelo banco'
);

-- As travas do documento impresso -------------------------------------------

-- Os itens extras entram como dono da tabela: a RLS de romaneio_items recusa
-- escrita direta de usuario logado, e e assim que deve ser.
reset role;

-- Produto sem preço na tabela BUCK.
insert into public.romaneio_items (id, romaneio_id, product_id, product_source, product_name, qty_sent, qty_accepted)
values ('96000000-0000-4000-8000-0000000000d4', '96000000-0000-4000-8000-0000000000b2',
        'teste-buck-sem-preco', 'bread', '[TESTE] Pao Buck Sem Preco', 5, null);

-- Peso suspeito: 1450 no campo de kg e o erro que custou R$ 190 mil.
insert into public.romaneio_items (id, romaneio_id, product_id, product_source, product_name, qty_sent, qty_accepted)
values ('96000000-0000-4000-8000-0000000000d5', '96000000-0000-4000-8000-0000000000b2',
        'teste-buck-ciabatta', 'bread', '[TESTE] Ciabatta Buck', 1450, null);

set local role authenticated;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$ select public.create_receivable_from_romaneio(
       '96000000-0000-4000-8000-00000000f004'::uuid,
       current_date - 30, current_date - 20, null
     ) $$,
  '22023',
  'Nenhum romaneio da EX neste período.',
  'periodo sem romaneio nao vira cobranca'
);

select ok((select 'missing_price' = any(problemas)
    from public.preview_receivable_from_romaneio(current_date - 7, current_date)
    where produto = '[TESTE] Pao Buck Sem Preco'),
  'produto sem preco na tabela BUCK e marcado como problema');

select ok((select 'suspicious_quantity' = any(problemas)
    from public.preview_receivable_from_romaneio(current_date - 7, current_date)
    where produto = '[TESTE] Ciabatta Buck'),
  'peso acima de 10 kg num romaneio e marcado como suspeito');

reset role;

-- Perfil sem permissão ------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '96000000-0000-4000-8000-000000000002', true);

select throws_ok(
  $$ select public.create_receivable_from_romaneio(
       '96000000-0000-4000-8000-00000000f005'::uuid,
       current_date - 60, current_date - 50, null
     ) $$,
  '42501',
  'Sem permissão para lançar cobranças.',
  'romaneio EX nao gera cobranca'
);

reset role;

select * from finish();
rollback;
