begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select ok(has_function_privilege('authenticated', 'public.create_payable_catalog_product(text,text,text,uuid)', 'execute'),
  'financeiro chama cadastro rápido com categoria controlada');
select ok(not has_function_privilege('anon', 'public.create_payable_catalog_product(text,text,text,uuid)', 'execute'),
  'anônimo não chama cadastro rápido');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""'])
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_payable_catalog_product'),
  'as duas assinaturas validam pelo dono com search_path fechado');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values (
  '98100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'financeiro-categoria-nfe-test@example.com',
  '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
  now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
);
insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values ('98100000-0000-4000-8000-000000000001', 'Financeiro Categoria NF', 'financeiro', 'jc', true, '[]'::jsonb);
insert into public.app_user_permissions (user_id, permission_key, scope)
values ('98100000-0000-4000-8000-000000000001', 'contas_pagar.lancar', '*');

set local role authenticated;
select set_config('request.jwt.claim.sub', '98100000-0000-4000-8000-000000000001', true);

select lives_ok($q$select public.create_payable_catalog_product('[TESTE] Gotas categoria NF', 'Insumos', 'kg',
  (select id from public.product_categories where name = 'Insumos'))$q$,
  'matéria-prima nasce com categoria controlada');
select results_eq($q$select category || ':' || catalog_type || ':' || kind || ':' || is_revenda::text
  from public.products where name = '[TESTE] Gotas categoria NF'$q$,
  $q$values ('Insumos:materia_prima:insumo:false')$q$,
  'insumo fica na gaveta e no tipo corretos');

select lives_ok($q$select public.create_payable_catalog_product('[TESTE] Chocolate revenda NF', 'Revenda', 'un',
  (select id from public.product_categories where name = 'Revenda'))$q$,
  'mercadoria de revenda nasce pela NF');
select results_eq($q$select category || ':' || catalog_type || ':' || kind || ':' || is_revenda::text
  from public.products where name = '[TESTE] Chocolate revenda NF'$q$,
  $q$values ('Revenda:produto_revenda:final:true')$q$,
  'revenda recebe marcação usada pelo catálogo');

select throws_ok($q$select public.create_payable_catalog_product('[TESTE] Categoria trocada NF', 'Revenda', 'kg',
  (select id from public.product_categories where name = 'Insumos'))$q$,
  '22023', 'Escolha uma categoria válida e ativa para o item da NF-e.',
  'nome e identificador de categorias divergentes são recusados');
select throws_ok($q$select public.create_payable_catalog_product('[TESTE] Gotas categoria NF', 'Insumos', 'kg',
  (select id from public.product_categories where name = 'Insumos'))$q$,
  '23505', 'Já existe um item ativo com esse nome. Selecione o cadastro existente na NF-e.',
  'nome já existente exige selecionar o cadastro correto');
select throws_ok($q$select public.create_payable_catalog_product('[TESTE] Sem categoria NF', 'Inventada', 'kg')$q$,
  '22023', 'A categoria informada não existe no cadastro controlado.',
  'assinatura antiga também não cria categoria livre');
select throws_ok($q$select public.create_payable_catalog_product('[TESTE] Serviço NF', 'Serviços', 'un',
  (select id from public.product_categories where name = 'Serviços'))$q$,
  '22023', 'Escolha uma categoria válida e ativa para o item da NF-e.',
  'cadastro de produto comprado não aceita categoria de serviço');

select set_config('request.jwt.claim.sub', '98100000-0000-4000-8000-000000000099', true);
select throws_ok($q$select public.create_payable_catalog_product('[TESTE] Sem permissão NF', 'Insumos', 'kg',
  (select id from public.product_categories where name = 'Insumos'))$q$,
  '42501', 'Sem permissão para cadastrar item nesta importação.',
  'perfil sem permissão não cria produto via função privilegiada');

select * from finish();
rollback;
