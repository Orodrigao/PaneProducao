-- A vinculacao de um avulso a um produto cadastrado precisa ser explicita,
-- protegida pela permissao administrativa da EX e deixar trilha antes da
-- linha virar cobranca.

begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin
) values
  (
    '94000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'romaneio-correction-admin@example.com',
    '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
    now(),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    false
  ),
  (
    '94000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'romaneio-correction-viewer@example.com',
    '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
    now(),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    false
  );

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  (
    '94000000-0000-4000-8000-000000000001',
    'Admin Correcao EX',
    'admin',
    null,
    true,
    '["/relatorios", "/relatorios/romaneios"]'::jsonb
  ),
  (
    '94000000-0000-4000-8000-000000000002',
    'Visualizacao EX',
    'expedicao',
    'ex',
    true,
    '["/relatorios", "/relatorios/romaneios"]'::jsonb
  );

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values
  ('94000000-0000-4000-8000-000000000001', 'romaneio.administrar', '*', null),
  ('94000000-0000-4000-8000-000000000002', 'romaneio.visualizar', 'ex', null);

-- O seed do Banco Preview passou a trazer a tabela BUCK (fase 4 do contas a
-- receber) e o nome dela e unico. Este cenario monta a sua propria, entao
-- remove a semeada antes. Tudo roda em transacao e volta atras no fim.
delete from public.price_tier_items
where tier_id in (select id from public.price_tiers where name = 'BUCK');
delete from public.price_tiers where name = 'BUCK';

insert into public.price_tiers (id, name, description, active)
values ('94000000-0000-4000-8000-000000000010', 'BUCK', 'Tabela de teste', true);

insert into public.products (id, name, category, active, unit, kind, is_pj)
values (
  '94000000-0000-4000-8000-000000000020',
  '[TESTE] Pao Originale Cadastrado',
  'PAES',
  true,
  'un',
  'final',
  false
);

insert into public.price_tier_items (
  id, tier_id, product_id, product_source, product_name, unit_price, pricing_unit, active
) values (
  '94000000-0000-4000-8000-000000000021',
  '94000000-0000-4000-8000-000000000010',
  '94000000-0000-4000-8000-000000000020',
  'product',
  '[TESTE] Pao Originale Cadastrado',
  13,
  'un',
  true
);

insert into public.romaneios (
  id, record_date, destination_id, trip_number, status, created_by, sent_by, sent_at
) values (
  '94000000-0000-4000-8000-000000000030',
  private.data_na_padaria(),
  '20000000-0000-4000-8000-000000000003',
  940,
  'enviado',
  'Teste',
  'Teste',
  now()
);

insert into public.romaneio_items (
  id, romaneio_id, product_id, product_source, product_name, qty_sent, unit_price, item_status
) values (
  '94000000-0000-4000-8000-000000000031',
  '94000000-0000-4000-8000-000000000030',
  'extra_940',
  'extra',
  '[TESTE] Pao digitado',
  6,
  0,
  'pendente'
);

select ok(has_function_privilege(
  'authenticated',
  'public.correct_romaneio_extra_item(uuid, text, text)',
  'execute'
), 'authenticated pode chamar a funcao de correcao');

set local role authenticated;
select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true);

select is(
  public.correct_romaneio_extra_item(
    '94000000-0000-4000-8000-000000000031',
    'product',
    '94000000-0000-4000-8000-000000000020'
  )->>'product_name',
  '[TESTE] Pao Originale Cadastrado',
  'admin vincula o avulso ao nome do catalogo'
);

select is(
  (select product_source from public.romaneio_items where id = '94000000-0000-4000-8000-000000000031'),
  'product',
  'a linha passa a usar a fonte product'
);

select is(
  (select unit_price from public.romaneio_items where id = '94000000-0000-4000-8000-000000000031'),
  13::numeric,
  'a linha recebe o preco Buck ativo'
);

select is(
  (select qty_sent from public.romaneio_items where id = '94000000-0000-4000-8000-000000000031'),
  6::numeric,
  'a correcao nao altera a quantidade enviada'
);

select is(
  (select count(*)::int from public.romaneio_item_corrections
   where item_id = '94000000-0000-4000-8000-000000000031'),
  1,
  'a correcao grava uma linha de auditoria'
);

select throws_ok(
  $$ select public.correct_romaneio_extra_item(
    '94000000-0000-4000-8000-000000000031',
    'product',
    '94000000-0000-4000-8000-000000000020'
  ) $$,
  '22023',
  'Somente itens avulsos podem ser vinculados.',
  'a mesma linha nao pode ser corrigida duas vezes'
);

select set_config('request.jwt.claim.sub', '94000000-0000-4000-8000-000000000002', true);

select throws_ok(
  $$ select public.correct_romaneio_extra_item(
    '94000000-0000-4000-8000-000000000031',
    'product',
    '94000000-0000-4000-8000-000000000020'
  ) $$,
  '42501',
  'Sem permissao para corrigir este item.',
  'perfil que so visualiza nao pode corrigir'
);

reset role;

select ok(not has_function_privilege(
  'anon',
  'public.correct_romaneio_extra_item(uuid, text, text)',
  'execute'
), 'anon nao pode chamar a funcao de correcao');

select * from finish();
rollback;
