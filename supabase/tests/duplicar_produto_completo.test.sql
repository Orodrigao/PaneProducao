begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- A porta pública só é executável por perfil logado, e o corpo faz a
-- autorização do catálogo antes de tocar qualquer uma das tabelas copiadas.
select ok(has_function_privilege('authenticated', 'public.duplicate_product_complete(uuid, text)', 'execute'),
  'perfil autenticado pode pedir a duplicação, sujeita à validação interna');
select ok(not has_function_privilege('anon', 'public.duplicate_product_complete(uuid, text)', 'execute'),
  'visitante anônimo não chama a duplicação');
select ok((select prosecdef from pg_proc procedure join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public' and procedure.proname = 'duplicate_product_complete'),
  'a duplicação é atômica em função SECURITY DEFINER');

insert into public.product_categories (id, name, catalog_type, active, sort_order)
values ('d2300000-0000-4000-8000-000000000001', 'Produto duplicação teste', 'produto_fabricado', true, 999);

insert into public.products (
  id, name, category, active, sort_order, cost_price, unit, is_special, kind, is_revenda,
  is_shelf, weekly_count_enabled, is_fabricacao_propria, is_pj, catalog_type,
  category_id, production_days, production_area, production_process,
  allows_planned_production, allows_unplanned_production, legacy_bread_id
) values
  ('d2300000-0000-4000-8000-000000000010', '[TESTE] Produto origem completo',
   'Produto duplicação teste', false, 42, 13.50, 'un', true, 'final', false, true,
   false, true, true, 'produto_fabricado', 'd2300000-0000-4000-8000-000000000001',
   array[1,3,5], 'padaria', 'forno', true, false, 'pao-legado-que-nao-viaja'),
  ('d2300000-0000-4000-8000-000000000011', '[TESTE] Produto componente externo',
   'Produto duplicação teste', true, 0, 4, 'un', false, 'final', false, false,
   false, false, false, 'produto_fabricado', 'd2300000-0000-4000-8000-000000000001',
   array[]::integer[], null, null, null, null, null),
  ('d2300000-0000-4000-8000-000000000012', '[TESTE] Produto sem classificação',
   'Legado', true, 0, 1, 'un', false, 'final', false, false, false, false, false,
   null, null, array[]::integer[], null, null, null, null, null);

insert into public.product_variants (id, product_id, name, sort_order, active)
values
  ('d2300000-0000-4000-8000-000000000020', 'd2300000-0000-4000-8000-000000000010', 'Forma', 1, true),
  ('d2300000-0000-4000-8000-000000000021', 'd2300000-0000-4000-8000-000000000010', 'Mini', 2, false),
  ('d2300000-0000-4000-8000-000000000022', 'd2300000-0000-4000-8000-000000000011', 'Externa', 1, true);

insert into public.product_components (parent_product_id, component_source, component_id, component_variant_id, quantity)
values
  ('d2300000-0000-4000-8000-000000000010', 'product', 'd2300000-0000-4000-8000-000000000010', 'd2300000-0000-4000-8000-000000000020', 2),
  ('d2300000-0000-4000-8000-000000000010', 'product', 'd2300000-0000-4000-8000-000000000011', 'd2300000-0000-4000-8000-000000000022', 3);

insert into public.product_recipe_yields (product_id, product_variant_id, batch_name, basis, dough_weight_kg, finished_weight_kg, yield_units, notes)
values
  ('d2300000-0000-4000-8000-000000000010', 'd2300000-0000-4000-8000-000000000020', 'Massa forma', 'dough', 2.2, 2, 20, 'rendimento da forma'),
  ('d2300000-0000-4000-8000-000000000010', null, 'Receita base', 'baked', 3, 2.7, 27, 'rendimento geral');

insert into public.product_sale_options (id, product_id, product_variant_id, name, sale_unit, reference_quantity, unit_weight_kg, is_default, active)
values
  ('d2300000-0000-4000-8000-000000000030', 'd2300000-0000-4000-8000-000000000010', 'd2300000-0000-4000-8000-000000000020', 'Forma unidade', 'un', 1, 0.1, true, true),
  ('d2300000-0000-4000-8000-000000000031', 'd2300000-0000-4000-8000-000000000010', null, 'Quilo base', 'kg', 1, null, false, false);

insert into public.product_pj_pack_rules (product_id, product_variant_id, pack_size_units, min_order_packs, order_multiple_packs, notes)
values ('d2300000-0000-4000-8000-000000000010', 'd2300000-0000-4000-8000-000000000020', 12, 2, 3, 'pacote PJ');

insert into public.price_tiers (id, name, active)
values ('d2300000-0000-4000-8000-000000000040', '[TESTE] Tabela duplicação', true);
insert into public.customers (id, name, active)
values ('d2300000-0000-4000-8000-000000000041', '[TESTE] Cliente duplicação', true);
insert into public.product_prices (product_id, product_source, product_name, destination_id, unit_price, active)
values ('d2300000-0000-4000-8000-000000000010', 'product', '[TESTE] Produto origem completo', null, 19.90, true);
insert into public.price_tier_items (tier_id, product_id, product_source, product_name, unit_price, pricing_unit, pack_size, active, sale_option_id)
values ('d2300000-0000-4000-8000-000000000040', 'd2300000-0000-4000-8000-000000000010', 'product', '[TESTE] Produto origem completo', 22.50, 'un', 12, true, 'd2300000-0000-4000-8000-000000000030');
insert into public.customer_price_overrides (customer_id, product_id, product_source, product_name, unit_price, pricing_unit, pack_size, active, sale_option_id)
values ('d2300000-0000-4000-8000-000000000041', 'd2300000-0000-4000-8000-000000000010', 'product', '[TESTE] Produto origem completo', 21.25, 'un', 6, true, 'd2300000-0000-4000-8000-000000000030');

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
values
  ('d2300000-0000-4000-8000-000000000050', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'duplicar-admin@example.com', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false),
  ('d2300000-0000-4000-8000-000000000051', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'duplicar-vendas@example.com', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false);
insert into public.app_profiles(user_id, display_name, role, store, active, allowed_routes)
values
  ('d2300000-0000-4000-8000-000000000050', '[TESTE] Admin duplicação', 'admin', 'jc', true, '["/produtos","/tabelas-preco"]'),
  ('d2300000-0000-4000-8000-000000000051', '[TESTE] Vendas duplicação', 'vendas', 'jc', true, '["/produtos"]');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd2300000-0000-4000-8000-000000000050', true);
select lives_ok($$select set_config('teste.duplicate_product_id', public.duplicate_product_complete(
  'd2300000-0000-4000-8000-000000000010', '[TESTE] Produto duplicado completo')::text, true)$$,
  'admin com rota de produtos duplica o cadastro completo');

select is((select active from public.products where id = current_setting('teste.duplicate_product_id')::uuid), false,
  'a cópia nasce inativa até a revisão operacional');
select is((select legacy_bread_id from public.products where id = current_setting('teste.duplicate_product_id')::uuid), null,
  'a cópia não herda vínculo legado de pão');
select is((select row(category, sort_order, unit, cost_price, is_special, kind, is_revenda, is_shelf, weekly_count_enabled, is_fabricacao_propria, is_pj, catalog_type, category_id, production_days, production_area, production_process, allows_planned_production, allows_unplanned_production)::text
  from public.products where id = current_setting('teste.duplicate_product_id')::uuid),
  (select row(category, sort_order, unit, cost_price, is_special, kind, is_revenda, is_shelf, false, is_fabricacao_propria, is_pj, catalog_type, category_id, production_days, production_area, production_process, allows_planned_production, allows_unplanned_production)::text
  from public.products where id = 'd2300000-0000-4000-8000-000000000010'),
  'a cópia preserva os campos próprios do cadastro');
select is((select count(*)::integer from public.product_variants where product_id = current_setting('teste.duplicate_product_id')::uuid), 2,
  'a cópia recebe todas as variantes');
select ok(not exists (select 1 from public.product_variants where product_id = current_setting('teste.duplicate_product_id')::uuid and id in ('d2300000-0000-4000-8000-000000000020', 'd2300000-0000-4000-8000-000000000021')),
  'as variantes da cópia têm novos identificadores');
select is((select count(*)::integer from public.product_components where parent_product_id = current_setting('teste.duplicate_product_id')::uuid), 2,
  'a ficha técnica leva todos os componentes');
select ok(exists (
  select 1 from public.product_components component
  join public.product_variants variant on variant.id = component.component_variant_id
  where component.parent_product_id = current_setting('teste.duplicate_product_id')::uuid
    and component.component_id = current_setting('teste.duplicate_product_id')
    and variant.product_id = current_setting('teste.duplicate_product_id')::uuid
), 'componente que aponta para a própria origem é remapeado para a cópia');
select ok(exists (
  select 1 from public.product_components component
  where component.parent_product_id = current_setting('teste.duplicate_product_id')::uuid
    and component.component_id = 'd2300000-0000-4000-8000-000000000011'
    and component.component_variant_id = 'd2300000-0000-4000-8000-000000000022'
), 'componente externo continua apontando para o ingrediente externo');
select is((select count(*)::integer from public.product_recipe_yields where product_id = current_setting('teste.duplicate_product_id')::uuid), 2,
  'a cópia leva todos os rendimentos');
select is((select count(*)::integer from public.product_sale_options where product_id = current_setting('teste.duplicate_product_id')::uuid), 2,
  'a cópia leva todas as opções de venda');
select is((select count(*)::integer from public.product_pj_pack_rules where product_id = current_setting('teste.duplicate_product_id')::uuid), 1,
  'a cópia leva a regra de pacote PJ');
select ok(exists (
  select 1 from public.product_recipe_yields yield_row
  join public.product_variants variant on variant.id = yield_row.product_variant_id
  where yield_row.product_id = current_setting('teste.duplicate_product_id')::uuid
    and yield_row.batch_name = 'Massa forma'
    and variant.product_id = current_setting('teste.duplicate_product_id')::uuid
), 'rendimento por variante aponta para a nova variante');
select ok(exists (
  select 1 from public.product_pj_pack_rules rule
  join public.product_variants variant on variant.id = rule.product_variant_id
  where rule.product_id = current_setting('teste.duplicate_product_id')::uuid
    and variant.product_id = current_setting('teste.duplicate_product_id')::uuid
), 'regra PJ aponta para a nova variante');
select ok(exists (
  select 1 from public.product_sale_options option_row
  join public.product_variants variant on variant.id = option_row.product_variant_id
  where option_row.product_id = current_setting('teste.duplicate_product_id')::uuid
    and option_row.name = 'Forma unidade'
    and variant.product_id = current_setting('teste.duplicate_product_id')::uuid
), 'opção de venda aponta para a nova variante');
select ok(exists (select 1 from public.product_prices where product_id = current_setting('teste.duplicate_product_id') and product_name = '[TESTE] Produto duplicado completo' and unit_price = 19.90),
  'preço por destino acompanha o novo produto');
select ok(exists (
  select 1 from public.price_tier_items price
  join public.product_sale_options option_row on option_row.id = price.sale_option_id
  where price.product_id = current_setting('teste.duplicate_product_id')
    and price.product_name = '[TESTE] Produto duplicado completo'
    and price.unit_price = 22.50 and option_row.product_id = current_setting('teste.duplicate_product_id')::uuid
), 'preço de tabela acompanha a nova opção de venda');
select ok(exists (
  select 1 from public.customer_price_overrides price
  join public.product_sale_options option_row on option_row.id = price.sale_option_id
  where price.product_id = current_setting('teste.duplicate_product_id')
    and price.product_name = '[TESTE] Produto duplicado completo'
    and price.unit_price = 21.25 and option_row.product_id = current_setting('teste.duplicate_product_id')::uuid
), 'preço específico do cliente acompanha a nova opção de venda');

-- Uma referência comercial cruzada é possível no legado porque a FK confere
-- apenas que a opção existe. A cópia deve recusar o dado, não apagá-lo.
insert into public.product_sale_options (id, product_id, product_variant_id, name, sale_unit, reference_quantity, is_default, active)
values ('d2300000-0000-4000-8000-000000000032', 'd2300000-0000-4000-8000-000000000011', 'd2300000-0000-4000-8000-000000000022', 'Externa unidade', 'un', 1, true, true);
insert into public.price_tiers (id, name, active)
values ('d2300000-0000-4000-8000-000000000042', '[TESTE] Tabela cruzada duplicação', true);
insert into public.price_tier_items (tier_id, product_id, product_source, product_name, unit_price, pricing_unit, pack_size, active, sale_option_id)
values ('d2300000-0000-4000-8000-000000000042', 'd2300000-0000-4000-8000-000000000010', 'product', '[TESTE] Produto origem completo', 20, 'un', 1, true, 'd2300000-0000-4000-8000-000000000032');
select throws_ok($$select public.duplicate_product_complete('d2300000-0000-4000-8000-000000000010', '[TESTE] Cópia com preço cruzado')$$,
  '22023', 'Há preço ligado a uma opção de venda de outro produto.', 'preço com opção de outro produto falha fechado');

select set_config('teste.product_count_before_blank_name', (select count(*)::text from public.products), true);
select throws_ok($$select public.duplicate_product_complete('d2300000-0000-4000-8000-000000000010', '   ')$$,
  '22023', 'Informe o nome do novo produto.', 'nome vazio não deixa cópia parcial');
select is((select count(*)::text from public.products), current_setting('teste.product_count_before_blank_name'),
  'falha de nome vazio não cria nenhuma linha parcial');
select is((select count(*)::integer from public.products where name = ''), 0,
  'falha de validação não cria produto');
select throws_ok($$select public.duplicate_product_complete('d2300000-0000-4000-8000-000000000012', '[TESTE] Cópia sem categoria')$$,
  '22023', 'Classifique o produto de origem antes de duplicá-lo.', 'produto legado sem categoria é recusado');

select set_config('request.jwt.claim.sub', 'd2300000-0000-4000-8000-000000000051', true);
select throws_ok($$select public.duplicate_product_complete('d2300000-0000-4000-8000-000000000010', '[TESTE] Tentativa vendas')$$,
  '42501', 'Sem permissão para duplicar produtos.', 'vendas não duplica produto apesar de ter a rota');
reset role;

select * from finish();
rollback;
