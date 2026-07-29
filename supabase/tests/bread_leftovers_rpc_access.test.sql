-- Cobertura de acesso das RPCs privilegiadas de Sobras.
-- Estas funcoes rodam com privilegio elevado; o teste garante que visitante
-- nao executa e que o bloqueio interno por perfil/loja continua existindo.

begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

select is((select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'confirm_bread_reuse_plan',
        'register_bread_leftovers',
        'resolve_bread_leftover',
        'save_bread_reuse_proposals',
        'update_bread_leftover_location'
      )
      and p.prosecdef), 5,
  'as cinco acoes de sobras sao SECURITY DEFINER');

select is((select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'confirm_bread_reuse_plan',
        'register_bread_leftovers',
        'resolve_bread_leftover',
        'save_bread_reuse_proposals',
        'update_bread_leftover_location'
      )
      and has_function_privilege('authenticated', p.oid, 'execute')), 5,
  'authenticated executa as acoes protegidas de sobras');

select is((select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'confirm_bread_reuse_plan',
        'register_bread_leftovers',
        'resolve_bread_leftover',
        'save_bread_reuse_proposals',
        'update_bread_leftover_location'
      )
      and has_function_privilege('anon', p.oid, 'execute')), 0,
  'anon nao executa acoes de sobras');

select is((select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'confirm_bread_reuse_plan',
        'register_bread_leftovers',
        'resolve_bread_leftover',
        'save_bread_reuse_proposals',
        'update_bread_leftover_location'
      )
      and coalesce(array_to_string(p.proconfig, ','), '') ilike '%search_path=%'), 5,
  'as acoes de sobras usam search_path seguro');

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
    'sobras-vendas-ja-test@example.com',
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
    'sobras-expedicao-test@example.com',
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
    'Teste Sobras JA',
    'vendas',
    'ja',
    true,
    '["/sobras"]'::jsonb
  ),
  (
    '91000000-0000-4000-8000-000000000002',
    'Teste Sem Sobras',
    'expedicao',
    'jc',
    true,
    '["/romaneio"]'::jsonb
  );

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values (
  '91000000-0000-4000-8000-000000000001',
  'sobras.acessar',
  'ja',
  null
);

insert into public.breads (id, name, days, active, unit, is_special, is_shelf)
values (
  'teste-sobras-rpc',
  '[TESTE] Sobras RPC',
  '{0,1,2,3,4,5,6}',
  true,
  'un',
  false,
  false
);

insert into public.sobras (
  id,
  record_date,
  responsible,
  product_id,
  product_source,
  quantity,
  store,
  lot_code,
  pending_quantity,
  status,
  physical_location,
  reconciliation_status
) values (
  '91000000-0000-4000-8000-000000000010',
  ((now() at time zone 'America/Sao_Paulo')::date - 1),
  'Teste',
  'teste-sobras-rpc',
  'bread',
  3,
  'jc',
  'L' || to_char(((now() at time zone 'America/Sao_Paulo')::date - 1), 'MMDD'),
  3,
  'pending',
  'balcao_fechamento',
  'awaiting_oven'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);

select throws_ok(
  $$ select public.register_bread_leftovers(
    (now() at time zone 'America/Sao_Paulo')::date,
    'ja',
    '[{"bread_id":"teste-sobras-rpc","quantity":1}]'::jsonb,
    'balcao_fechamento'
  ) $$,
  '42501',
  'Usuario sem permissao para registrar sobras.',
  'perfil fora do fluxo nao registra sobras mesmo logado'
);

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$ select public.register_bread_leftovers(
    (now() at time zone 'America/Sao_Paulo')::date,
    'jc',
    '[{"bread_id":"teste-sobras-rpc","quantity":1}]'::jsonb,
    'balcao_fechamento'
  ) $$,
  '42501',
  'A atendente so pode registrar a propria loja.',
  'vendas nao registra fechamento de outra loja'
);

select is(
  (public.register_bread_leftovers(
    ((now() at time zone 'America/Sao_Paulo')::date - 1),
    'ja',
    '[{"bread_id":"teste-sobras-rpc","quantity":2}]'::jsonb,
    'balcao_fechamento'
  ) ->> 'saved_items')::int,
  1,
  'vendas registra sobra da propria loja'
);

select is(
  (select pending_quantity from public.sobras
    where store = 'ja' and product_id = 'teste-sobras-rpc'),
  2::numeric,
  'sobra da loja da atendente fica pendente'
);

select throws_ok(
  $$ select public.resolve_bread_leftover(
    '91000000-0000-4000-8000-000000000010',
    'display',
    1,
    null
  ) $$,
  '42501',
  'A atendente so pode movimentar a propria loja.',
  'vendas nao da destino a sobra de outra loja'
);

select is(
  (public.resolve_bread_leftover(
    (select id from public.sobras where store = 'ja' and product_id = 'teste-sobras-rpc'),
    'display',
    1,
    null
  ) ->> 'pending_quantity')::numeric,
  1::numeric,
  'vendas da destino a sobra da propria loja'
);

select throws_ok(
  $$ select public.update_bread_leftover_location(
    '91000000-0000-4000-8000-000000000010',
    'mesa_separacao'
  ) $$,
  '42501',
  'A atendente so pode movimentar a propria loja.',
  'vendas nao altera local de sobra de outra loja'
);

select is(
  public.update_bread_leftover_location(
    (select id from public.sobras where store = 'ja' and product_id = 'teste-sobras-rpc'),
    'mesa_separacao'
  ) ->> 'physical_location',
  'mesa_separacao',
  'vendas altera local de sobra da propria loja'
);

select is(
  (select physical_location from public.sobras
    where store = 'ja' and product_id = 'teste-sobras-rpc'),
  'mesa_separacao',
  'local fisico fica gravado na sobra permitida'
);

select * from finish();
rollback;
