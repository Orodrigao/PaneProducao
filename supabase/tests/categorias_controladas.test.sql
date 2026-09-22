-- Fase 2A do catálogo: a lista controlada nasce preenchida e o cadastro
-- existente passa a apontar para ela.
begin;
create extension if not exists pgtap with schema extensions;

select plan(30);

-- Contrato de acesso: registro e funções são internos, como na unificação.
select ok(not has_table_privilege('authenticated', 'private.product_catalog_assignment_log', 'select'),
  'usuário autenticado não lê o registro da classificação');
select ok(not has_table_privilege('anon', 'private.product_catalog_assignment_log', 'select'),
  'anônimo não lê o registro da classificação');
select ok(not has_table_privilege('service_role', 'private.product_catalog_assignment_log', 'select'),
  'chave de serviço não lê o registro da classificação');
select ok(not has_function_privilege('authenticated', 'private.assign_controlled_product_categories(text)', 'execute'),
  'usuário autenticado não executa a classificação');
select ok(not has_function_privilege('anon', 'private.assign_controlled_product_categories(text)', 'execute'),
  'anônimo não executa a classificação');
select ok(not has_function_privilege('service_role', 'private.assign_controlled_product_categories(text)', 'execute'),
  'chave de serviço não executa a classificação');
select ok(not has_function_privilege('anon', 'private.product_categories_without_match()', 'execute'),
  'anônimo não executa a conferência de cobertura');
select ok((select proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'assign_controlled_product_categories')
    @> array['search_path=""'],
  'classificação roda com search_path fechado');
select ok((select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'assign_controlled_product_categories'),
  'classificação roda com privilégio do dono, não do chamador');
select ok((select relrowsecurity and relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private' and c.relname = 'product_catalog_assignment_log'),
  'registro da classificação usa RLS forçada');

-- A lista controlada, que estava vazia, nasce com as 20 categorias do cadastro.
-- Esta asserção é detector de mudança, não prova de verdade: ela repete a
-- decisão escrita na migration. Quem prova que as 20 grafias batem com o
-- cadastro real é a conferência de cobertura, exercitada mais abaixo.
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

-- O cabeçalho da migration afirma que classificar não mexe na vitrine do site.
-- Provar pelo slug não serve: o gatilho reaproveita o slug existente, então a
-- asserção passaria mesmo se ele disparasse. A prova é a lista de colunas que
-- o acordam.
select ok(
  (select pg_get_triggerdef(t.oid) from pg_trigger t
    where t.tgname = 'sync_site_bread_catalog_after_product_change')
  not like all(array['%catalog_type%', '%category_id%']),
  'classificar não está entre as colunas que acordam a vitrine do site'
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

-- Pão público no site, para provar que classificar não tira pão da vitrine.
insert into public.products (
  id, name, category, kind, active, production_area, is_fabricacao_propria, is_pj, production_days
) values (
  'b0000000-0000-4000-8000-000000000012', '[TESTE] Pão da vitrine', 'Pães', 'final', true,
  'padaria', true, false, array[1, 3]
);

select ok(exists(select 1 from public.site_bread_catalog
    where product_id = 'b0000000-0000-4000-8000-000000000012'),
  'pão fictício entrou no catálogo do site antes da classificação');

-- Quantos produtos DEVEM ser classificados, contados antes da chamada. O seed
-- do banco de teste insere produtos depois das migrations, então eles chegam
-- sem classificação e entram nesta varredura junto dos fictícios. Contar aqui
-- em vez de escrever um número fixo mantém a asserção exata mesmo quando o
-- seed mudar de tamanho.
create temporary table elegiveis as
  select count(*)::integer as total
  from public.products product
  join public.product_categories category
    on category.normalized_name = private.normalize_product_category_name(product.category)
  where product.category_id is null
    and product.catalog_type is null
    and category.active;

create temporary table categoria_antes as
  select id, category from public.products;

create temporary table assign_result as
  select private.assign_controlled_product_categories('teste-fase-2a') as changed;

select is((select changed from assign_result), (select total from elegiveis),
  'classificação grava exatamente os produtos elegíveis contados antes da chamada');

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
-- O registro é o artefato de reversão: se ele guardar valor diferente do que
-- ficou no produto, desfazer escreve lixo. Nenhuma contagem pega isso.
select is(
  (select count(*)::integer
    from private.product_catalog_assignment_log registro
    join public.products product on product.id = registro.product_id
    where registro.product_id::text like 'b0000000-%'
      and (product.catalog_type is distinct from registro.new_catalog_type
        or product.category_id is distinct from registro.new_category_id)),
  0,
  'o registro casa com o tipo e a categoria que ficaram gravados no produto'
);
select is(
  (select count(distinct run_label)::integer from private.product_catalog_assignment_log
    where product_id::text like 'b0000000-%'),
  1,
  'o registro marca a rodada que classificou, para desfazer uma sem desfazer as outras'
);
select is(
  (select count(*)::integer from private.product_catalog_assignment_log
    where product_id = 'b0000000-0000-4000-8000-000000000011'),
  0,
  'produto já classificado não entra no registro'
);

select is(
  (select count(*)::integer from public.products product
    join categoria_antes antes on antes.id = product.id
    where product.category is distinct from antes.category),
  0,
  'o texto livre da categoria não é tocado por nenhum produto'
);

select ok(exists(select 1 from public.site_bread_catalog
    where product_id = 'b0000000-0000-4000-8000-000000000012'),
  'pão continua no catálogo do site depois da classificação');

select is(private.assign_controlled_product_categories('teste-fase-2a'), 0,
  'rodar de novo não classifica nada');

-- A conferência de cobertura é a trava que a migration usa para não classificar
-- meio cadastro em silêncio. Aqui ela é exercitada de verdade: o produto de
-- categoria inventada precisa aparecer.
select results_eq(
  $q$select * from private.product_categories_without_match()$q$,
  $q$values ('Vitrine de Natal')$q$,
  'a conferência acusa a categoria que não existe na lista controlada'
);

-- Categoria desativada sai de circulação: item novo nela fica sem classificação
-- em vez de entrar num grupo que a operação aposentou.
update public.product_categories set active = false where normalized_name = 'salgados';
insert into public.products (id, name, category, kind, active)
  values ('b0000000-0000-4000-8000-000000000013', '[TESTE] Coxinha nova', 'Salgados', 'final', true);
select is(private.assign_controlled_product_categories('teste-fase-2a'), 0,
  'categoria inativa não classifica produto novo');
select ok((select catalog_type is null and category_id is null from public.products
    where id = 'b0000000-0000-4000-8000-000000000013'),
  'produto de categoria inativa fica sem classificação');
update public.product_categories set active = true where normalized_name = 'salgados';

-- Produto classificado depois de a categoria voltar: prova que a função serve
-- para o que chegar antes de a tela exigir a escolha, na fase seguinte.
select is(private.assign_controlled_product_categories('teste-fase-2a'), 1,
  'categoria reativada classifica o produto que ficou para trás');

-- A trava composta recusa categoria de um tipo em produto de outro tipo.
select throws_ok(
  $q$update public.products set catalog_type = 'materia_prima'
      where id = 'b0000000-0000-4000-8000-000000000006'$q$,
  '23503',
  null,
  'produto não muda de tipo mantendo categoria de outro tipo'
);

-- Sem o produto de categoria inventada, a conferência fica vazia: é o estado
-- que a migration exige para completar em produção.
delete from public.products where id = 'b0000000-0000-4000-8000-000000000008';
select is_empty(
  $q$select * from private.product_categories_without_match()$q$,
  'com todo texto de categoria coberto, a conferência não acusa nada'
);

select * from finish();
rollback;
