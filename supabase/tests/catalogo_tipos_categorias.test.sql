-- Fundação controlada de tipos e categorias do catálogo.
begin;
create extension if not exists pgtap with schema extensions;

select plan(27);

select ok(to_regclass('public.product_categories') is not null,
  'cadastro de categorias de produto existe');
select ok(exists(select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'products' and column_name = 'catalog_type'),
  'produto possui natureza controlada');
select ok(exists(select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'products' and column_name = 'category_id'),
  'produto pode apontar para categoria controlada');
select ok((select relrowsecurity and relforcerowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'product_categories'),
  'categorias usam RLS forçada');
select ok(has_table_privilege('authenticated', 'public.product_categories', 'select'),
  'usuário autenticado pode consultar categorias mediante RLS');
select ok(not has_table_privilege('authenticated', 'public.product_categories', 'insert'),
  'usuário autenticado não grava categoria diretamente');
select ok(not has_table_privilege('anon', 'public.product_categories', 'select'),
  'anônimo não lê categorias internas');
select ok(has_function_privilege('authenticated',
  'public.manage_product_category(text, text, uuid, boolean, integer)', 'execute'),
  'usuário autenticado chama gestão mediante validação interna');
select ok(not has_function_privilege('anon',
  'public.manage_product_category(text, text, uuid, boolean, integer)', 'execute'),
  'anônimo não gerencia categorias');
select ok((select pg_get_constraintdef(oid) ilike all(array[
    '%materia_prima%', '%embalagem%', '%higiene_limpeza%', '%produto_fabricado%', '%produto_revenda%'
  ]) from pg_constraint where conname = 'product_categories_catalog_type_check'),
  'tipos operacionais previstos são restritos pelo banco');
select ok(exists(select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'product_categories'
    and column_name = 'normalized_name' and is_generated = 'ALWAYS'),
  'nome normalizado é calculado pelo banco');

-- A PR #317 caiu aqui: o Postgres concede EXECUTE a PUBLIC em toda função nova
-- e `anon` herda. A invariante geral pegou, mas a frente precisa provar o
-- próprio contrato, senão a próxima migration recria o buraco sem aviso.
select ok(not has_function_privilege('anon',
  'private.normalize_product_category_name(text)', 'execute'),
  'anônimo não executa a normalização interna');
select ok(not has_function_privilege('authenticated',
  'private.normalize_product_category_name(text)', 'execute'),
  'usuário autenticado não executa a normalização interna');
select ok((select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'manage_product_category'),
  'gestão de categorias roda como dona da estrutura');
select ok((select proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'manage_product_category')
    @> array['search_path=""'],
  'gestão de categorias roda com search_path fechado');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('93000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin-categoria-produto-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('93000000-0000-4000-8000-00000000000f', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'financeiro-categoria-produto-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('93000000-0000-4000-8000-00000000000a', 'Admin Categorias', 'admin', null, true, '["*"]'::jsonb),
  ('93000000-0000-4000-8000-00000000000f', 'Financeiro Categorias', 'financeiro', 'jc', true, '[]'::jsonb);

set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-00000000000a', true);

select lives_ok(
  $$select public.manage_product_category('Embalagens', 'embalagem', null, true, 10)$$,
  'administrador cria categoria');
select is((select normalized_name from public.product_categories where name = 'Embalagens'),
  'embalagens', 'nome normalizado é previsível');
select throws_ok(
  $$select public.manage_product_category(' EMBALÁGENS ', 'embalagem', null, true, 20)$$,
  '23505', 'Já existe uma categoria com esse nome, mesmo considerando acentos e maiúsculas.',
  'acentos, caixa e espaços não criam duplicata');

-- O mesmo nome pode chegar de duas formas no Unicode: com o acento dentro da
-- letra, ou com o acento como caractere separado, que é o que alguns aparelhos
-- mandam ao colar. `chr(769)` é esse acento solto. Com a normalização antiga,
-- por lista fixa de letras, esta linha virava a chave 'embala-gens' e o banco
-- aceitaria a categoria repetida: a asserção falha sem o conserto.
select throws_ok(
  $$select public.manage_product_category('EMBALA' || chr(769) || 'GENS', 'embalagem', null, true, 30)$$,
  '23505', 'Já existe uma categoria com esse nome, mesmo considerando acentos e maiúsculas.',
  'acento escrito como caractere separado também não cria duplicata');

reset role;
select lives_ok(
  $$insert into public.products (name, category, unit, kind, catalog_type, category_id)
    select '[TESTE] Caixa controlada', 'Embalagens', 'un', 'insumo', 'embalagem', id
    from public.product_categories where normalized_name = 'embalagens'$$,
  'produto aceita categoria do mesmo tipo');
select throws_ok(
  $$insert into public.products (name, category, unit, kind, catalog_type, category_id)
    select '[TESTE] Categoria incompatível', 'Embalagens', 'un', 'insumo', 'materia_prima', id
    from public.product_categories where normalized_name = 'embalagens'$$,
  '23503', null,
  'produto recusa categoria de outro tipo');

set local role authenticated;
select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-00000000000a', true);
select throws_ok(
  $$select public.manage_product_category(
    'Embalagens', 'materia_prima',
    (select id from public.product_categories where normalized_name = 'embalagens'), true, 10
  )$$,
  '23503', 'Não é possível trocar o tipo de uma categoria já usada por produtos.',
  'tipo de categoria usada não muda silenciosamente');

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-00000000000f', true);
select throws_ok(
  $$select public.manage_product_category('Ocupação', 'manutencao', null, true, 0)$$,
  '42501', 'Somente administradores podem gerenciar categorias de produtos.',
  'financeiro não cria categoria de produto');
select is((select count(*)::int from public.product_categories), 1,
  'perfil ativo consulta a lista controlada');
select throws_ok(
  $$insert into public.product_categories (name, catalog_type) values ('Livre', 'manutencao')$$,
  '42501', null,
  'gravação direta continua bloqueada');

select set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-00000000000a', true);
select lives_ok(
  $$select public.manage_product_category(
    'Embalagens de produção', 'embalagem',
    (select id from public.product_categories where normalized_name = 'embalagens'), false, 10
  )$$,
  'administrador renomeia e inativa categoria');
select is((select active from public.product_categories where normalized_name = 'embalagens-de-producao'),
  false, 'categoria inativada permanece no histórico');

select * from finish();
rollback;
