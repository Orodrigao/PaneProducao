-- Cobertura da transferência entre contas.
--
-- Transferência é o único lançamento com duas pernas. O teste prova que elas
-- nascem e morrem juntas (meia transferência faria dinheiro sumir), que o
-- banco barra quem não tem a permissão nova, e que repetir a ação não duplica.

begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

-- Estrutura e privilégios ----------------------------------------------------

select is((select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_finance_transfer', 'reverse_finance_transfer')
      and p.prosecdef), 2,
  'as duas acoes da transferencia sao SECURITY DEFINER');

select is((select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_finance_transfer', 'reverse_finance_transfer')
      and coalesce(array_to_string(p.proconfig, ','), '') ilike '%search_path=%'), 2,
  'as acoes da transferencia usam search_path seguro');

select ok(exists(select 1 from public.app_permissions where key = 'financeiro.transferir'),
  'a permissao propria de transferir existe');

select ok((select relrowsecurity and relforcerowsecurity
    from pg_class where oid = 'public.finance_transfers'::regclass),
  'finance_transfers tem RLS ligada e forcada');

select is((select count(*)::int
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'finance_transfers'
      and grantee in ('anon', 'authenticated')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')), 0,
  'ninguem escreve direto em finance_transfers: so pelas funcoes');

-- Cenário --------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  (
    '93000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'financeiro-transf-test@example.com',
    '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
  ),
  (
    '93000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'vendas-sem-transf-test@example.com',
    '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
  ),
  (
    '93000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'financeiro-sem-transferir-test@example.com',
    '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
  );

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('93000000-0000-4000-8000-000000000001', 'Teste Financeiro Transf', 'financeiro', 'jc', true, '["/financeiro"]'::jsonb),
  ('93000000-0000-4000-8000-000000000002', 'Teste Vendas Sem Transf', 'vendas', 'ja', true, '["/romaneio"]'::jsonb),
  ('93000000-0000-4000-8000-000000000003', 'Teste Financeiro Sem Transferir', 'financeiro', 'jc', true, '["/financeiro"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values
  ('93000000-0000-4000-8000-000000000001', 'financeiro.acessar', '*', null),
  ('93000000-0000-4000-8000-000000000001', 'financeiro.lancar', '*', null),
  ('93000000-0000-4000-8000-000000000001', 'financeiro.estornar', '*', null),
  ('93000000-0000-4000-8000-000000000001', 'financeiro.transferir', '*', null),
  -- Vê e lança, mas não move dinheiro entre contas: prova que a permissão
  -- nova é realmente independente.
  ('93000000-0000-4000-8000-000000000003', 'financeiro.acessar', '*', null),
  ('93000000-0000-4000-8000-000000000003', 'financeiro.lancar', '*', null);

-- Financeiro autorizado --------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$ select public.create_finance_transfer(
    '93000000-0000-4000-8000-0000000000a1'::uuid,
    'caixa_fisico_jc', 'banco_sicredi_jc',
    800, private.data_na_padaria(), 'sangria do turno da tarde'
  ) $$,
  'financeiro autorizado registra a sangria do caixa da JC para o banco'
);

select is((select count(*)::int from public.finance_entries entry
    join public.finance_transfers transfer on transfer.id = entry.transfer_id
    where transfer.request_id = '93000000-0000-4000-8000-0000000000a1'::uuid), 2,
  'a transferencia nasce com as duas pernas');

select is((select count(*)::int from public.finance_entries entry
    join public.finance_transfers transfer on transfer.id = entry.transfer_id
    where transfer.request_id = '93000000-0000-4000-8000-0000000000a1'::uuid
      and entry.transfer_leg = 'saida'
      and entry.account_id = (select id from public.finance_accounts where key = 'caixa_fisico_jc')), 1,
  'a perna de saida aponta para a conta de origem');

select is((select count(*)::int from public.finance_entries entry
    join public.finance_transfers transfer on transfer.id = entry.transfer_id
    where transfer.request_id = '93000000-0000-4000-8000-0000000000a1'::uuid
      and entry.transfer_leg = 'entrada'
      and entry.account_id = (select id from public.finance_accounts where key = 'banco_sicredi_jc')), 1,
  'a perna de entrada aponta para a conta de destino');

-- Idempotência: o toque duplo devolve a mesma transferência.
select is(
  (select public.create_finance_transfer(
    '93000000-0000-4000-8000-0000000000a1'::uuid,
    'caixa_fisico_jc', 'banco_sicredi_jc',
    800, private.data_na_padaria(), 'sangria do turno da tarde'
  )),
  (select id from public.finance_transfers where request_id = '93000000-0000-4000-8000-0000000000a1'::uuid),
  'repetir o mesmo pedido devolve a transferencia existente'
);

select is((select count(*)::int from public.finance_transfers
    where request_id = '93000000-0000-4000-8000-0000000000a1'::uuid), 1,
  'o toque duplo nao cria uma segunda transferencia');

-- Validações -------------------------------------------------------------------

select throws_ok(
  $$ select public.create_finance_transfer(
    '93000000-0000-4000-8000-0000000000a2'::uuid,
    'caixa_fisico_jc', 'caixa_fisico_jc',
    100, private.data_na_padaria(), null
  ) $$,
  '22023',
  'A conta de origem e a de destino precisam ser diferentes.',
  'origem igual ao destino e recusada no banco, nao so na tela'
);

select throws_ok(
  $$ select public.create_finance_transfer(
    '93000000-0000-4000-8000-0000000000a3'::uuid,
    'caixa_fisico_jc', 'banco_sicredi_jc',
    2000000, private.data_na_padaria(), null
  ) $$,
  '22023',
  'Valor acima do limite permitido. Confira o que foi digitado.',
  'valor acima do teto e recusado'
);

select throws_ok(
  $$ select public.create_finance_transfer(
    '93000000-0000-4000-8000-0000000000a4'::uuid,
    'caixa_fisico_jc', 'banco_sicredi_jc',
    100, private.data_na_padaria() + 30, null
  ) $$,
  '22023',
  'A data da transferência não pode ser no futuro.',
  'data no futuro e recusada'
);

-- A perna solta não pode ser estornada: quebraria o par.
select throws_ok(
  $$ select public.reverse_finance_entry(
    '93000000-0000-4000-8000-0000000000c9'::uuid,
    (select entry.id from public.finance_entries entry
      join public.finance_transfers transfer on transfer.id = entry.transfer_id
      where transfer.request_id = '93000000-0000-4000-8000-0000000000a1'::uuid
        and entry.transfer_leg = 'saida'),
    'quero estornar so um lado'
  ) $$,
  '22023',
  'Este lançamento faz parte de uma transferência. Estorne a transferência inteira.',
  'estornar uma perna sozinha e proibido'
);

-- Estorno da transferência inteira ---------------------------------------------

select lives_ok(
  $$ select public.reverse_finance_transfer(
    '93000000-0000-4000-8000-0000000000d1'::uuid,
    (select id from public.finance_transfers where request_id = '93000000-0000-4000-8000-0000000000a1'::uuid),
    'a sangria foi para o banco errado'
  ) $$,
  'financeiro autorizado estorna a transferencia inteira'
);

select is((select count(*)::int from public.finance_entries entry
    join public.finance_transfers transfer on transfer.id = entry.transfer_id
    where transfer.request_id = '93000000-0000-4000-8000-0000000000a1'::uuid
      and entry.entry_type = 'estorno'), 2,
  'o estorno devolve as duas pernas, nunca uma so');

select ok((select reversed_at is not null from public.finance_transfers
    where request_id = '93000000-0000-4000-8000-0000000000a1'::uuid),
  'a transferencia fica marcada como estornada');

select throws_ok(
  $$ select public.reverse_finance_transfer(
    '93000000-0000-4000-8000-0000000000d2'::uuid,
    (select id from public.finance_transfers where request_id = '93000000-0000-4000-8000-0000000000a1'::uuid),
    'estornar de novo'
  ) $$,
  '22023',
  'Esta transferência já foi estornada.',
  'estornar duas vezes e recusado'
);

-- Perfil sem a permissão nova --------------------------------------------------

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000003', true);

select throws_ok(
  $$ select public.create_finance_transfer(
    '93000000-0000-4000-8000-0000000000e1'::uuid,
    'caixa_fisico_jc', 'banco_sicredi_jc',
    100, private.data_na_padaria(), null
  ) $$,
  '42501',
  'Sem permissão para transferir a partir desta conta.',
  'quem lanca no livro mas nao tem financeiro.transferir e barrado'
);

-- Vendas de outra loja ---------------------------------------------------------

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000002', true);

select throws_ok(
  $$ select public.create_finance_transfer(
    '93000000-0000-4000-8000-0000000000e2'::uuid,
    'caixa_fisico_jc', 'banco_sicredi_jc',
    100, private.data_na_padaria(), null
  ) $$,
  '42501',
  'Sem permissão para transferir a partir desta conta.',
  'vendas nao move dinheiro entre contas'
);

select is((select count(*)::int from public.finance_transfers), 0,
  'vendas nao enxerga transferencia nenhuma pela RLS');

select * from finish();
rollback;
