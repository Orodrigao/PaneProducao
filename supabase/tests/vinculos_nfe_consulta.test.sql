begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('97000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-vinculos@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'elis-vinculos@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'financeiro-sem-catalogo@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vendas-vinculos@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'financeiro-sem-permissao@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes) values
  ('97000000-0000-4000-8000-000000000001', 'Rodrigo Administrador', 'admin', null, true, '["/produtos"]'::jsonb),
  ('97000000-0000-4000-8000-000000000002', 'Elis Financeiro', 'financeiro', 'jc', true, '["/produtos"]'::jsonb),
  ('97000000-0000-4000-8000-000000000003', 'Financeiro sem Catálogo', 'financeiro', 'jc', true, '[]'::jsonb),
  ('97000000-0000-4000-8000-000000000004', 'Vendas', 'vendas', 'jc', true, '["/"]'::jsonb),
  ('97000000-0000-4000-8000-000000000005', 'Financeiro sem permissão', 'financeiro', 'jc', true, '["/produtos"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope) values
  ('97000000-0000-4000-8000-000000000002', 'contas_pagar.acessar', 'jc'),
  ('97000000-0000-4000-8000-000000000003', 'contas_pagar.acessar', 'jc');

insert into public.suppliers (id, name, active) values
  ('97000000-0000-4000-8000-000000000011', '[TESTE] Fornecedor dos vínculos', true);
insert into public.products (id, name, category, active, unit, kind) values
  ('97000000-0000-4000-8000-000000000021', '[TESTE] Insumo consulta autores', 'Insumos', true, 'kg', 'insumo'),
  ('97000000-0000-4000-8000-000000000022', '[TESTE] Outro insumo consulta autores', 'Insumos', true, 'kg', 'insumo');
insert into public.payable_product_mappings (
  id, supplier_id, supplier_product_code, supplier_description, purchase_unit,
  base_product_id, base_unit, conversion_basis, conversion_factor, last_confirmed_by
) values
  ('97000000-0000-4000-8000-000000000031', '97000000-0000-4000-8000-000000000011', 'COD-1', 'Item do fornecedor', 'kg',
   '97000000-0000-4000-8000-000000000021', 'kg', 'simple', 1, '97000000-0000-4000-8000-000000000001'),
  ('97000000-0000-4000-8000-000000000032', '97000000-0000-4000-8000-000000000011', 'COD-2', 'Outro item', 'kg',
   '97000000-0000-4000-8000-000000000022', 'kg', 'simple', 1, '97000000-0000-4000-8000-000000000003');
-- Um item de compra manual pode apontar para o mesmo produto, mas não é histórico de NF-e.
insert into public.payable_purchases (
  id, request_id, store, supplier_id, purchase_date, origin, document_type,
  payment_method, status, total_value, created_by
) values (
  '97000000-0000-4000-8000-000000000041', '97000000-0000-4000-8000-000000000042', 'jc',
  '97000000-0000-4000-8000-000000000011', current_date, 'manual', 'sem_nota',
  'pix', 'aberta', 10, '97000000-0000-4000-8000-000000000005'
);
insert into public.payable_purchase_items (
  id, purchase_id, product_id, item_name, unit, quantity, unit_price,
  mapping_confirmed_at, mapping_confirmed_by, factor_confirmed_at, factor_confirmed_by
) values (
  '97000000-0000-4000-8000-000000000043', '97000000-0000-4000-8000-000000000041',
  '97000000-0000-4000-8000-000000000021', 'Compra manual', 'kg', 1, 10,
  now(), '97000000-0000-4000-8000-000000000005', now(), '97000000-0000-4000-8000-000000000005'
);

select ok(has_function_privilege('authenticated', 'public.list_vinculo_nfe_authors(uuid)', 'execute'),
  'perfil autenticado pode consultar autores pela função protegida');
select ok(not has_function_privilege('anon', 'public.list_vinculo_nfe_authors(uuid)', 'execute'),
  'perfil anônimo não pode consultar autores');
select ok((select bool_and(prosecdef and provolatile = 's' and proconfig @> array['search_path=""'])
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'list_vinculo_nfe_authors'),
  'função é somente leitura, estável e usa search_path vazio');

set local role authenticated;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000002', true);
select results_eq(
  $$select display_name from public.list_vinculo_nfe_authors('97000000-0000-4000-8000-000000000021') order by display_name$$,
  $$values ('Rodrigo Administrador'::text)$$,
  'Elis lê o nome do autor ligado ao produto consultado');
select is(
  (select count(*)::int from public.list_vinculo_nfe_authors('97000000-0000-4000-8000-000000000021')),
  1,
  'a função não retorna autores de outros produtos');

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true);
select is(
  (select count(*)::int from public.list_vinculo_nfe_authors('97000000-0000-4000-8000-000000000021')),
  1,
  'administrador consulta os autores do produto');

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select * from public.list_vinculo_nfe_authors('97000000-0000-4000-8000-000000000021')$$,
  '42501', 'Sem permissão para consultar autores dos vínculos.',
  'Financeiro sem acesso ao Catálogo é bloqueado');

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$select * from public.list_vinculo_nfe_authors('97000000-0000-4000-8000-000000000021')$$,
  '42501', 'Sem permissão para consultar autores dos vínculos.',
  'Financeiro sem permissão de contas a pagar é bloqueado mesmo com a rota');

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000002', true);
select is(
  (select count(*)::int from public.list_vinculo_nfe_authors('97000000-0000-4000-8000-000000000021')),
  1,
  'autores de compra manual não aparecem como autores de vínculo em NF-e');

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$select * from public.list_vinculo_nfe_authors('97000000-0000-4000-8000-000000000021')$$,
  '42501', 'Sem permissão para consultar autores dos vínculos.',
  'perfil fora de Administração e Financeiro é bloqueado');

select * from finish();
rollback;
