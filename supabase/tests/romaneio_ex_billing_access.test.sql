-- A leitura da Tabela Buck para o fechamento EX fica liberada apenas para
-- quem pode acessar relatorios e visualizar o Romaneio da EX.

begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

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
    '91000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'romaneio-ex-valores-test@example.com',
    '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
    now(),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    false
  ),
  (
    '91000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'relatorio-sem-romaneio-ex-test@example.com',
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
    '91000000-0000-4000-8000-000000000001',
    'Teste Valores EX',
    'vendas',
    'ex',
    true,
    '["/relatorios", "/relatorios/romaneios", "/romaneio"]'::jsonb
  ),
  (
    '91000000-0000-4000-8000-000000000002',
    'Teste Relatorio Sem EX',
    'vendas',
    'ja',
    true,
    '["/relatorios", "/relatorios/romaneios"]'::jsonb
  );

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values
  ('91000000-0000-4000-8000-000000000001', 'relatorios.acessar', '*', null),
  ('91000000-0000-4000-8000-000000000001', 'romaneio.visualizar', 'ex', null),
  ('91000000-0000-4000-8000-000000000002', 'relatorios.acessar', '*', null),
  ('91000000-0000-4000-8000-000000000002', 'romaneio.visualizar', 'ja', null);

-- O seed do Banco Preview passou a trazer a tabela BUCK (fase 4 do contas a
-- receber) e o nome dela e unico. Este cenario monta a sua propria, entao
-- remove a semeada antes. Tudo roda em transacao e volta atras no fim.
delete from public.price_tier_items
where tier_id in (select id from public.price_tiers where name = 'BUCK');
delete from public.price_tiers where name = 'BUCK';

insert into public.price_tiers (id, name, description, active)
values
  ('91000000-0000-4000-8000-000000000010', 'BUCK', 'Tabela EX de teste', true),
  ('91000000-0000-4000-8000-000000000011', 'OUTRA', 'Tabela bloqueada de teste', true);

insert into public.price_tier_items (
  id,
  tier_id,
  product_id,
  product_source,
  product_name,
  unit_price,
  pricing_unit,
  active
) values
  (
    '91000000-0000-4000-8000-000000000020',
    '91000000-0000-4000-8000-000000000010',
    'teste-baguete',
    'bread',
    '[TESTE] Baguete',
    3.50,
    'un',
    true
  ),
  (
    '91000000-0000-4000-8000-000000000021',
    '91000000-0000-4000-8000-000000000011',
    'teste-baguete',
    'bread',
    '[TESTE] Baguete',
    4.50,
    'un',
    true
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);

select is(
  (select count(*)::int from public.price_tiers where name = 'BUCK'),
  1,
  'perfil EX com relatorio le a Tabela Buck'
);

select is(
  (select count(*)::int from public.price_tier_items where tier_id = '91000000-0000-4000-8000-000000000010'),
  1,
  'perfil EX com relatorio le os precos da Tabela Buck'
);

select is(
  (select count(*)::int from public.price_tiers where name = 'OUTRA'),
  0,
  'perfil EX com relatorio nao le outras tabelas de preco'
);

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);

select is(
  (select count(*)::int from public.price_tiers where name = 'BUCK'),
  0,
  'perfil sem Romaneio EX nao le a Tabela Buck'
);

select * from finish();
rollback;
