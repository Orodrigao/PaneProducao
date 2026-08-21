-- Cobertura de acesso e regras do livro-caixa financeiro.
--
-- O livro guarda dinheiro: o teste prova que quem não tem permissão é barrado
-- pelo banco (não só pela tela), que o lançamento é imutável (estorno em vez
-- de sobrescrita) e que repetir a mesma ação não duplica.

begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

-- Estrutura e privilégios ----------------------------------------------------

select is((select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_finance_entry', 'reverse_finance_entry')
      and p.prosecdef), 2,
  'as duas acoes do livro sao SECURITY DEFINER');

select is((select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_finance_entry', 'reverse_finance_entry')
      and coalesce(array_to_string(p.proconfig, ','), '') ilike '%search_path=%'), 2,
  'as acoes do livro usam search_path seguro');

select is((select count(*)::int from public.app_permissions where key in (
  'financeiro.acessar', 'financeiro.lancar', 'financeiro.estornar'
)), 3,
  'as tres permissoes do livro existem');

select ok((select count(*) from public.finance_categories where active) >= 26,
  'plano de categorias semeado');

select ok(exists(select 1 from public.finance_accounts where key = 'caixa_fisico_jc' and kind = 'caixa'),
  'o caixa fisico da loja e uma conta como qualquer banco');

-- Cenário --------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  (
    '92000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'financeiro-livro-test@example.com',
    '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
  ),
  (
    '92000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'vendas-sem-livro-test@example.com',
    '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
  ),
  (
    '92000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'financeiro-so-jc-test@example.com',
    '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
  );

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('92000000-0000-4000-8000-000000000001', 'Teste Financeiro Livro', 'financeiro', 'jc', true, '["/financeiro"]'::jsonb),
  ('92000000-0000-4000-8000-000000000002', 'Teste Vendas Sem Livro', 'vendas', 'ja', true, '["/romaneio"]'::jsonb),
  ('92000000-0000-4000-8000-000000000003', 'Teste Financeiro So JC', 'financeiro', 'jc', true, '["/financeiro"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values
  ('92000000-0000-4000-8000-000000000001', 'financeiro.acessar', '*', null),
  ('92000000-0000-4000-8000-000000000001', 'financeiro.lancar', '*', null),
  ('92000000-0000-4000-8000-000000000001', 'financeiro.estornar', '*', null),
  -- Este só enxerga a JC: serve para provar que 'geral' exige escopo global.
  ('92000000-0000-4000-8000-000000000003', 'financeiro.acessar', 'jc', null),
  ('92000000-0000-4000-8000-000000000003', 'financeiro.lancar', 'jc', null);

-- Financeiro com escopo global -------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$ select public.create_finance_entry(
    '92000000-0000-4000-8000-0000000000b1'::uuid,
    'mao_obra_diarias', 'caixa_fisico_jc', 'jc',
    150, private.data_na_padaria(), 'dinheiro', 'diaria do Marcelo'
  ) $$,
  'financeiro autorizado lanca a diaria paga em dinheiro'
);

-- Idempotência: o mesmo pedido devolve o mesmo lançamento.
select is(
  (select public.create_finance_entry(
    '92000000-0000-4000-8000-0000000000b1'::uuid,
    'mao_obra_diarias', 'caixa_fisico_jc', 'jc',
    150, private.data_na_padaria(), 'dinheiro', 'diaria do Marcelo'
  )),
  (select id from public.finance_entries where request_id = '92000000-0000-4000-8000-0000000000b1'::uuid),
  'repetir o mesmo pedido devolve o lancamento existente, sem duplicar'
);

select is((select count(*)::int from public.finance_entries
    where request_id = '92000000-0000-4000-8000-0000000000b1'::uuid), 1,
  'o toque duplo nao cria um segundo lancamento');

-- Validações de dinheiro e data ------------------------------------------------

select throws_ok(
  $$ select public.create_finance_entry(
    '92000000-0000-4000-8000-0000000000b2'::uuid,
    'mao_obra_diarias', 'caixa_fisico_jc', 'jc',
    2000000, private.data_na_padaria(), 'dinheiro', 'valor absurdo'
  ) $$,
  '22023',
  'Valor acima do limite permitido. Confira o que foi digitado.',
  'valor acima do teto e recusado no banco, nao so na tela'
);

select throws_ok(
  $$ select public.create_finance_entry(
    '92000000-0000-4000-8000-0000000000b3'::uuid,
    'mao_obra_diarias', 'caixa_fisico_jc', 'jc',
    150, private.data_na_padaria() + 30, 'dinheiro', 'lancamento do futuro'
  ) $$,
  '22023',
  'A data do lançamento não pode ser no futuro.',
  'data no futuro e recusada'
);

select throws_ok(
  $$ select public.create_finance_entry(
    '92000000-0000-4000-8000-0000000000b4'::uuid,
    'transferencia', 'caixa_fisico_jc', 'jc',
    150, private.data_na_padaria(), 'dinheiro', 'sangria do caixa'
  ) $$,
  '22023',
  'Transferência entre contas ainda não é lançada por aqui.',
  'transferencia fica para a fase do fechamento de caixa'
);

select throws_ok(
  $$ select public.create_finance_entry(
    '92000000-0000-4000-8000-0000000000b5'::uuid,
    'mao_obra_diarias', 'caixa_fisico_ja', 'jc',
    150, private.data_na_padaria(), 'dinheiro', 'caixa da outra loja'
  ) $$,
  '22023',
  'O caixa físico escolhido é de outra loja.',
  'nao se paga da gaveta da outra loja'
);

-- Estorno ----------------------------------------------------------------------

select lives_ok(
  $$ select public.reverse_finance_entry(
    '92000000-0000-4000-8000-0000000000c1'::uuid,
    (select id from public.finance_entries where request_id = '92000000-0000-4000-8000-0000000000b1'::uuid),
    'lancei no caixa errado'
  ) $$,
  'financeiro autorizado estorna o lancamento'
);

select is((select count(*)::int from public.finance_entries
    where reversal_of = (select id from public.finance_entries
                         where request_id = '92000000-0000-4000-8000-0000000000b1'::uuid)), 1,
  'o estorno nasce como contra-lancamento ligado ao original');

select ok((select reversed_at is not null from public.finance_entries
    where request_id = '92000000-0000-4000-8000-0000000000b1'::uuid),
  'o original continua no livro, marcado como estornado');

select throws_ok(
  $$ select public.reverse_finance_entry(
    '92000000-0000-4000-8000-0000000000c2'::uuid,
    (select id from public.finance_entries where request_id = '92000000-0000-4000-8000-0000000000b1'::uuid),
    'estornando de novo'
  ) $$,
  '22023',
  'Este lançamento já foi estornado.',
  'o mesmo lancamento nao e estornado duas vezes'
);

select throws_ok(
  $$ select public.reverse_finance_entry(
    '92000000-0000-4000-8000-0000000000c3'::uuid,
    (select id from public.finance_entries where request_id = '92000000-0000-4000-8000-0000000000c1'::uuid),
    'estornando o estorno'
  ) $$,
  '22023',
  'Um estorno não pode ser estornado.',
  'estorno de estorno e recusado'
);

reset role;

-- Escopo por loja --------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000003', true);

select throws_ok(
  $$ select public.create_finance_entry(
    '92000000-0000-4000-8000-0000000000a3'::uuid,
    'ocupacao', 'banco_sicredi_jc', 'geral',
    2000, private.data_na_padaria(), 'boleto', 'aluguel da empresa'
  ) $$,
  '42501',
  'Sem permissão para lançar no financeiro desta loja.',
  'escopo de uma loja nao lanca despesa geral da empresa'
);

select lives_ok(
  $$ select public.create_finance_entry(
    '92000000-0000-4000-8000-0000000000a4'::uuid,
    'ocupacao', 'banco_sicredi_jc', 'jc',
    2000, private.data_na_padaria(), 'boleto', 'aluguel da JC'
  ) $$,
  'escopo da JC lanca despesa da JC'
);

reset role;

-- Perfil sem permissão nenhuma, com o livro já povoado -------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000002', true);

select throws_ok(
  $$ select public.create_finance_entry(
    '92000000-0000-4000-8000-0000000000a1'::uuid,
    'mao_obra_diarias', 'caixa_fisico_jc', 'jc',
    150, private.data_na_padaria(), 'dinheiro', 'diaria de teste'
  ) $$,
  '42501',
  'Sem permissão para lançar no financeiro desta loja.',
  'perfil sem permissao nao lanca no livro, mesmo logado'
);

-- Há lançamentos no livro; a RLS é que os esconde deste perfil.
select is((select count(*)::int from public.finance_entries), 0,
  'perfil sem permissao nao enxerga nenhum lancamento do livro');

select throws_ok(
  $$ insert into public.finance_entries (
    request_id, category_id, account_id, store, competence_month,
    due_date, planned_amount, paid_date, amount, payment_method, description, created_by
  ) values (
    '92000000-0000-4000-8000-0000000000a2'::uuid,
    (select id from public.finance_categories where key = 'mao_obra_diarias'),
    (select id from public.finance_accounts where key = 'caixa_fisico_jc'),
    'jc', date_trunc('month', private.data_na_padaria())::date,
    private.data_na_padaria(), 100, private.data_na_padaria(), 100, 'dinheiro', 'burlando a funcao',
    '92000000-0000-4000-8000-000000000002'::uuid
  ) $$,
  '42501',
  null::text,
  'escrita direta na tabela e recusada pelo banco'
);

reset role;

select * from finish();
rollback;
