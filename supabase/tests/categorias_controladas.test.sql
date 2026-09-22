-- Fase 2A do catálogo: a lista controlada nasce preenchida e o cadastro
-- existente passa a apontar para ela.
begin;
create extension if not exists pgtap with schema extensions;

select plan(26);

-- Contrato de acesso: registro e função são internos, como na unificação.
select ok(not has_table_privilege('authenticated', 'private.product_catalog_assignment_log', 'select'),
  'usuário autenticado não lê o registro da classificação');
select ok(not has_table_privilege('anon', 'private.product_catalog_assignment_log', 'select'),
  'anônimo não lê o registro da classificação');
select ok(not has_table_privilege('service_role', 'private.product_catalog_assignment_log', 'select'),
  'chave de serviço não lê o registro da classificação');
select ok(not has_function_privilege('authenticated', 'private.assign_controlled_product_categories()', 'execute'),
  'usuário autenticado não executa a classificação');
select ok(not has_function_privilege('anon', 'private.assign_controlled_product_categories()', 'execute'),
  'anônimo não executa a classificação');
select ok(not has_function_privilege('service_role', 'private.assign_controlled_product_categories()', 'execute'),
  'chave de serviço não executa a classificação');
select ok((select proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'assign_controlled_product_categories')
    @> array['search_path=""'],
  'classificação roda com search_path fechado');

-- A lista controlada, que estava vazia, nasce com as 20 categorias do cadastro.
select is(
  (select count(*)::integer from public.product_categories),
  20,
  'a lista controlada tem as 20 categorias do cadastro real'
);
select results_eq(
  $q$select name || ' => ' || catalog_type from public.product_categories
    order by catalog_type, sort_order, name$q$,
  $q$values
    ('Embalagens => embalagem'),
    ('Escritório => escritorio_administrativo'),
    ('Higiene e limpeza => higiene_limpeza'),
    ('Manutenção => manutencao'),
    ('Insumos => materia_prima'),
    ('Pães => produto_fabricado'),
    ('Pães Branco => produto_fabricado'),
    ('Pães Integ. => produto_fabricado'),
    ('Pães Recheados => produto_fabricado'),
    ('Croissant => produto_fabricado'),
    ('Focaccias => produto_fabricado'),
    ('Pizza Romana => produto_fabricado'),
    ('Pizza Redonda => produto_fabricado'),
    ('Bruschettas => produto_fabricado'),
    ('Lanches => produto_fabricado'),
    ('Salgados => produto_fabricado'),
    ('Sopas & Cremes => produto_fabricado'),
    ('Pastas & Pesto => produto_fabricado'),
    ('Confeitaria => produto_fabricado'),
    ('Revenda => produto_revenda')$q$,
  'cada categoria recebe o tipo de item decidido, na ordem de uso da padaria'
);
select ok((select bool_and(active) from public.product_categories),
  'toda categoria nasce ativa');

-- Nenhum produto do cadastro ficou apontando para categoria de outro tipo: é a
-- invariante que a chave estrangeira composta existe para segurar.
select is(
  (select count(*)::integer from public.products product
    join public.product_categories category on category.id = product.category_id
    where product.catalog_type is distinct from category.catalog_type),
  0,
  'nenhum produto aponta para categoria de outro tipo'
);

-- Cadastro fictício: um caso por regra que a classificação precisa respeitar.
insert into public.products (id, name, category, catalog_type, category_id, kind, active) values
  ('b0000000-0000-4000-8000-000000000001', '[TESTE] Farinha nova', 'Insumos', null, null, 'insumo', true),
  ('b0000000-0000-4000-8000-000000000002', '[TESTE] Insumo em caixa alta', 'INSUMOS', null, null, 'insumo', true),
  ('b0000000-0000-4000-8000-000000000003', '[TESTE] Saco de papel', 'Embalagens', null, null, 'insumo', true),
  ('b0000000-0000-4000-8000-000000000004', '[TESTE] Detergente', 'Higiene e limpeza', null, null, 'insumo', true),
  ('b0000000-0000-4000-8000-000000000005', '[TESTE] Refrigerante', 'Revenda', null, null, 'final', true),
  ('b0000000-0000-4000-8000-000000000006', '[TESTE] Bolo de fubá', 'Confeitaria', null, null, 'final', true),
  ('b0000000-0000-4000-8000-000000000007', '[TESTE] Kit quatro pães', 'Pães Branco', null, null, 'kit', true),
  ('b0000000-0000-4000-8000-000000000008', '[TESTE] Categoria inventada', 'Vitrine de Natal', null, null, 'final', true),
  ('b0000000-0000-4000-8000-000000000009', '[TESTE] Insumo com espaço sobrando', ' insumos ', null, null, 'insumo', true),
  ('b0000000-0000-4000-8000-000000000010', '[TESTE] Produto inativo', 'Croissant', null, null, 'final', false);

-- Produto com decisão já tomada por alguém: a classificação não sobrescreve.
insert into public.products (id, name, category, catalog_type, category_id, kind, active)
select
  'b0000000-0000-4000-8000-000000000011', '[TESTE] Já classificado à mão', 'Insumos',
  'produto_revenda', category.id, 'insumo', true
from public.product_categories category
where category.normalized_name = 'revenda';

-- Pão público no site, para provar que classificar não mexe na vitrine.
insert into public.products (
  id, name, category, kind, active, production_area, is_fabricacao_propria, is_pj, production_days
) values (
  'b0000000-0000-4000-8000-000000000012', '[TESTE] Pão da vitrine', 'Pães', 'final', true,
  'padaria', true, false, array[1, 3]
);

create temporary table site_slug_before as
  select slug from public.site_bread_catalog
  where product_id = 'b0000000-0000-4000-8000-000000000012';

select ok((select count(*) from site_slug_before) = 1,
  'pão fictício entrou no catálogo do site antes da classificação');

create temporary table assign_result as
  select private.assign_controlled_product_categories() as changed;

-- O seed do banco de teste insere produtos depois das migrations, então eles
-- chegam sem classificação e são apanhados aqui junto dos fictícios desta
-- prova. É a mesma situação de um produto cadastrado entre esta fase e a
-- seguinte, e mostra que a função continua servindo para quem chegar depois.
select ok((select changed from assign_result) >= 10,
  'classificação apanha os dez fictícios elegíveis e também o que o seed criou depois da migration');

select results_eq(
  $q$select product.name || ' => ' || coalesce(product.catalog_type, 'sem tipo')
      || ' / ' || coalesce(category.name, 'sem categoria')
    from public.products product
    left join public.product_categories category on category.id = product.category_id
    where product.id::text like 'b0000000-%'
    order by product.id$q$,
  $q$values
    ('[TESTE] Farinha nova => materia_prima / Insumos'),
    ('[TESTE] Insumo em caixa alta => materia_prima / Insumos'),
    ('[TESTE] Saco de papel => embalagem / Embalagens'),
    ('[TESTE] Detergente => higiene_limpeza / Higiene e limpeza'),
    ('[TESTE] Refrigerante => produto_revenda / Revenda'),
    ('[TESTE] Bolo de fubá => produto_fabricado / Confeitaria'),
    ('[TESTE] Kit quatro pães => produto_fabricado / Pães Branco'),
    ('[TESTE] Categoria inventada => sem tipo / sem categoria'),
    ('[TESTE] Insumo com espaço sobrando => materia_prima / Insumos'),
    ('[TESTE] Produto inativo => produto_fabricado / Croissant'),
    ('[TESTE] Já classificado à mão => produto_revenda / Revenda'),
    ('[TESTE] Pão da vitrine => produto_fabricado / Pães')$q$,
  'cada produto cai na categoria do próprio texto; caixa alta e espaço sobrando casam, categoria desconhecida fica em branco e decisão já tomada fica de pé'
);

select is(
  (select count(*)::integer from private.product_catalog_assignment_log
    where product_id::text like 'b0000000-%'),
  10,
  'registro tem uma linha por produto classificado'
);
select is(
  (select count(*)::integer from private.product_catalog_assignment_log
    where product_id::text like 'b0000000-%'
      and (old_catalog_type is not null or old_category_id is not null)),
  0,
  'registro guarda o estado anterior, que era em branco'
);
select is(
  (select count(*)::integer from private.product_catalog_assignment_log
    where product_id = 'b0000000-0000-4000-8000-000000000011'),
  0,
  'produto já classificado não entra no registro'
);

select ok(exists(select 1 from public.site_bread_catalog
    where product_id = 'b0000000-0000-4000-8000-000000000012'),
  'pão continua no catálogo do site depois da classificação');
select is(
  (select slug from public.site_bread_catalog where product_id = 'b0000000-0000-4000-8000-000000000012'),
  (select slug from site_slug_before),
  'endereço do pão no site não muda'
);

select is(private.assign_controlled_product_categories(), 0,
  'rodar de novo não classifica nada');

-- Categoria desativada sai de circulação: item novo nela fica sem classificação
-- em vez de entrar num grupo que a operação aposentou.
update public.product_categories set active = false where normalized_name = 'salgados';
insert into public.products (id, name, category, kind, active)
  values ('b0000000-0000-4000-8000-000000000013', '[TESTE] Coxinha nova', 'Salgados', 'final', true);
select is(private.assign_controlled_product_categories(), 0,
  'categoria inativa não classifica produto novo');
select ok((select catalog_type is null and category_id is null from public.products
    where id = 'b0000000-0000-4000-8000-000000000013'),
  'produto de categoria inativa fica sem classificação');
update public.product_categories set active = true where normalized_name = 'salgados';

-- Produto classificado depois de a categoria voltar: prova que a função serve
-- para o que chegar antes de a tela exigir a escolha, na fase seguinte.
select is(private.assign_controlled_product_categories(), 1,
  'categoria reativada classifica o produto que ficou para trás');

-- A trava composta recusa categoria de um tipo em produto de outro tipo.
select throws_ok(
  $q$update public.products set catalog_type = 'materia_prima'
      where id = 'b0000000-0000-4000-8000-000000000006'$q$,
  '23503',
  null,
  'produto não muda de tipo mantendo categoria de outro tipo'
);

-- Não sobrou nome repetido por acento ou caixa, que é o motivo da lista existir.
select is(
  (select count(distinct normalized_name)::integer from public.product_categories),
  (select count(*)::integer from public.product_categories),
  'nenhuma categoria repete a chave normalizada'
);

-- Todo produto classificado tem os dois campos, nunca só um.
select is(
  (select count(*)::integer from public.products
    where category_id is not null and catalog_type is null),
  0,
  'produto com categoria controlada sempre tem tipo'
);

select * from finish();
rollback;
