begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

select ok((select relrowsecurity and relforcerowsecurity
  from pg_class class
  join pg_namespace namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'public' and class.relname = 'site_bread_catalog'),
  'a vitrine pública tem RLS habilitada e forçada');
select ok(has_table_privilege('anon', 'public.site_bread_catalog', 'select'),
  'o site pode ler somente a vitrine pública');
select ok(not has_table_privilege('anon', 'public.site_bread_catalog', 'insert')
  and not has_table_privilege('anon', 'public.site_bread_catalog', 'update')
  and not has_table_privilege('anon', 'public.site_bread_catalog', 'delete'),
  'o site não altera a vitrine pública');
select ok(not has_table_privilege('anon', 'public.products', 'select'),
  'o site não lê o catálogo interno de produtos');
select ok(not has_table_privilege('authenticated', 'public.site_bread_catalog', 'select'),
  'usuário logado não ganha acesso direto extra pela vitrine pública');
select is((
  select array_agg(column_name order by ordinal_position)
  from information_schema.columns
  where table_schema = 'public' and table_name = 'site_bread_catalog'
), array['product_id', 'name', 'slug', 'production_days', 'sort_order']::text[],
  'a vitrine contém somente identificação e programação pública');
select ok(not has_function_privilege('anon', 'private.sync_site_bread_catalog()', 'execute')
  and not has_function_privilege('anon', 'private.site_bread_slug_base(text, uuid)', 'execute'),
  'o site não executa as rotinas internas de sincronização');

insert into public.products (
  id, name, category, active, sort_order, kind,
  is_fabricacao_propria, is_pj, production_days, production_area, cost_price
) values
  ('a1000000-0000-4000-8000-000000000001', '[TESTE] Pão Público', 'Pães Branco', true, 20, 'final', true, false, '{1,4}', 'padaria', 97.50),
  ('a1000000-0000-4000-8000-000000000002', '[TESTE] Pão PJ', 'Pães Branco', true, 30, 'final', true, true, '{1,4}', 'padaria', 88.00),
  ('a1000000-0000-4000-8000-000000000003', '[TESTE] Pão Cozinha', 'Pães Branco', true, 40, 'final', true, false, '{1,4}', 'cozinha', 77.00),
  ('a1000000-0000-4000-8000-000000000004', '[TESTE] Pão Inativo', 'Pães Branco', false, 50, 'final', true, false, '{1,4}', 'padaria', 66.00);

select is((select array_agg(name order by name) from public.site_bread_catalog
  where product_id in (
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'a1000000-0000-4000-8000-000000000002'::uuid,
    'a1000000-0000-4000-8000-000000000003'::uuid,
    'a1000000-0000-4000-8000-000000000004'::uuid
  )),
  array['[TESTE] Pão Público']::text[],
  'só pão ativo, próprio, final, não-PJ e da Padaria entra na vitrine');
select is((select production_days from public.site_bread_catalog
  where product_id = 'a1000000-0000-4000-8000-000000000001'::uuid), array[1,4],
  'a vitrine replica os dias de produção do cadastro');
select is((select name from public.site_bread_catalog
  where product_id = 'a1000000-0000-4000-8000-000000000001'::uuid), '[TESTE] Pão Público',
  'a vitrine recebe automaticamente um pão novo elegível');

update public.products
set name = '[TESTE] Pão Público Renomeado', production_days = '{2,5}'
where id = 'a1000000-0000-4000-8000-000000000001';

select is((select name from public.site_bread_catalog
  where product_id = 'a1000000-0000-4000-8000-000000000001'::uuid), '[TESTE] Pão Público Renomeado',
  'renomear no ERP atualiza o nome mostrado no site');
select is((select production_days from public.site_bread_catalog
  where product_id = 'a1000000-0000-4000-8000-000000000001'::uuid), array[2,5],
  'alterar os dias no ERP atualiza automaticamente a programação pública');
select is((select slug from public.site_bread_catalog
  where product_id = 'a1000000-0000-4000-8000-000000000001'::uuid), 'teste-pao-publico',
  'o endereço público continua estável após renomear o pão');

set local role anon;
select results_eq(
  $$ select name from public.site_bread_catalog
     where product_id = 'a1000000-0000-4000-8000-000000000001'::uuid $$,
  array['[TESTE] Pão Público Renomeado']::text[],
  'visitante anônimo lê a programação pública');
select throws_ok(
  $$ update public.site_bread_catalog set name = 'Ataque' $$,
  '42501', null,
  'visitante anônimo não altera a programação pública');
reset role;

update public.products set active = false
where id = 'a1000000-0000-4000-8000-000000000001';

select is((select count(*)::int from public.site_bread_catalog
  where product_id = 'a1000000-0000-4000-8000-000000000001'::uuid), 0,
  'desativar o pão no ERP o remove automaticamente da vitrine');

select * from finish();
rollback;
