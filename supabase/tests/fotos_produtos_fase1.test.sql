begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(exists (
  select 1 from public.app_permissions where key = 'catalogo.gerenciar_fotos'
), 'a permissão explícita de fotos existe sem concedê-la a um cargo');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.product_photos'::regclass),
  'foto principal usa RLS forçada');
select ok(not has_table_privilege('anon', 'public.product_photos', 'select')
  and has_table_privilege('authenticated', 'public.product_photos', 'select')
  and not has_table_privilege('authenticated', 'public.product_photos', 'insert')
  and not has_table_privilege('authenticated', 'public.product_photos', 'update')
  and not has_table_privilege('authenticated', 'public.product_photos', 'delete'),
  'o cliente só lê o vínculo; a mudança passa pelas portas protegidas');
select ok(not has_table_privilege('authenticated', 'private.product_photo_audit', 'select'),
  'o histórico de fotos não fica exposto ao cliente');
select ok(has_function_privilege('authenticated', 'public.set_product_photo(uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.clear_product_photo(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.set_product_photo(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.clear_product_photo(uuid)', 'execute'),
  'só usuário logado pode chamar as portas de foto, sujeitas à conferência interna');
select ok((select prosecdef from pg_proc where oid = 'public.set_product_photo(uuid, text)'::regprocedure),
  'a associação atômica confere arquivo, produto e permissão no banco');
select ok((select pg_get_expr(polqual, polrelid) from pg_policy
  where polname = 'product_photos_files_delete_photo_manager') ilike '%not (exists%product_photos%storage_path%',
  'a política de limpeza bloqueia arquivo que ainda é foto principal');

insert into public.product_categories (id, name, catalog_type, active, sort_order)
values ('f2400000-0000-4000-8000-000000000001', '[TESTE] Categoria fotos', 'produto_fabricado', true, 999);
insert into public.products (id, name, category, active, sort_order, cost_price, unit, is_special, kind, is_revenda,
  is_shelf, weekly_count_enabled, is_fabricacao_propria, is_pj, catalog_type, category_id, production_days)
values ('f2400000-0000-4000-8000-000000000010', '[TESTE] Produto fotos', '[TESTE] Categoria fotos', true, 0, 1, 'un', false, 'final', false,
  false, false, false, false, 'produto_fabricado', 'f2400000-0000-4000-8000-000000000001', array[]::integer[]);
insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
values
  ('f2400000-0000-4000-8000-000000000050', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fotos-gestor@example.com', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false),
  ('f2400000-0000-4000-8000-000000000051', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fotos-leitor@example.com', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false),
  ('f2400000-0000-4000-8000-000000000052', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fotos-outro-gestor@example.com', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false);
insert into public.app_profiles(user_id, display_name, role, store, active, allowed_routes)
values
  ('f2400000-0000-4000-8000-000000000050', '[TESTE] Gestor de fotos', 'admin', 'jc', true, '[]'),
  ('f2400000-0000-4000-8000-000000000051', '[TESTE] Leitor de fotos', 'vendas', 'jc', true, '[]'),
  ('f2400000-0000-4000-8000-000000000052', '[TESTE] Outro gestor de fotos', 'admin', 'jc', true, '[]');
insert into public.app_user_permissions(user_id, permission_key, scope, granted_by)
values
  ('f2400000-0000-4000-8000-000000000050', 'catalogo.gerenciar_fotos', '*', 'f2400000-0000-4000-8000-000000000050'),
  ('f2400000-0000-4000-8000-000000000052', 'catalogo.gerenciar_fotos', '*', 'f2400000-0000-4000-8000-000000000052');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f2400000-0000-4000-8000-000000000050', true);
select throws_ok(
  $$select public.set_product_photo('f2400000-0000-4000-8000-000000000010', 'products/f2400000-0000-4000-8000-000000000010/f2400000-0000-4000-8000-000000000100.webp')$$,
  '22023', 'A foto precisa ser enviada em WebP por quem fará a associação.',
  'não aponta para um arquivo ausente');

insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('product-photos', 'products/f2400000-0000-4000-8000-000000000010/f2400000-0000-4000-8000-000000000100.webp',
  'f2400000-0000-4000-8000-000000000050', '{"mimetype":"image/webp"}');
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('product-photos', 'products/f2400000-0000-4000-8000-000000000010/f2400000-0000-4000-8000-000000000101.webp',
  'f2400000-0000-4000-8000-000000000050', '{"mimetype":"image/webp"}');
select lives_ok(
  $$select public.set_product_photo('f2400000-0000-4000-8000-000000000010', 'products/f2400000-0000-4000-8000-000000000010/f2400000-0000-4000-8000-000000000100.webp')$$,
  'gestor explicitamente autorizado associa o próprio arquivo WebP');
select is((select storage_path from public.product_photos where product_id = 'f2400000-0000-4000-8000-000000000010'),
  'products/f2400000-0000-4000-8000-000000000010/f2400000-0000-4000-8000-000000000100.webp',
  'a foto fica vinculada pelo ID imutável do produto, não pelo nome');
reset role;
select ok(exists (
  select 1 from private.product_photo_audit
  where product_id = 'f2400000-0000-4000-8000-000000000010'
    and action = 'add'
), 'a inclusão gera trilha de auditoria no banco');
set local role authenticated;

select set_config('request.jwt.claim.sub', 'f2400000-0000-4000-8000-000000000052', true);
select throws_ok(
  $$select public.set_product_photo('f2400000-0000-4000-8000-000000000010', 'products/f2400000-0000-4000-8000-000000000010/f2400000-0000-4000-8000-000000000100.webp')$$,
  '22023', 'A foto precisa ser enviada em WebP por quem fará a associação.',
  'outro gestor não associa arquivo enviado por outra pessoa');

select set_config('request.jwt.claim.sub', 'f2400000-0000-4000-8000-000000000051', true);
select is((select count(*)::integer from public.product_photos where product_id = 'f2400000-0000-4000-8000-000000000010'), 1,
  'perfil ativo pode ler a foto principal');
select is((select count(*)::integer from storage.objects where bucket_id = 'product-photos'), 1,
  'leitor ativo vê somente o arquivo já associado, nunca o upload órfão');
select throws_ok(
  $$select public.clear_product_photo('f2400000-0000-4000-8000-000000000010')$$,
  '42501', 'Sem permissão para gerenciar fotos de produtos.',
  'perfil sem a permissão explícita não remove a foto');

select set_config('request.jwt.claim.sub', 'f2400000-0000-4000-8000-000000000050', true);
select is(public.clear_product_photo('f2400000-0000-4000-8000-000000000010'),
  'products/f2400000-0000-4000-8000-000000000010/f2400000-0000-4000-8000-000000000100.webp',
  'remoção devolve o caminho para a limpeza posterior pelo Storage API');
reset role;
select ok(exists (
  select 1 from private.product_photo_audit
  where product_id = 'f2400000-0000-4000-8000-000000000010'
    and action = 'remove'
), 'a remoção também fica auditável');

select * from finish();
rollback;
