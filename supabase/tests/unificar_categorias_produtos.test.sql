-- Unificação das grafias repetidas da categoria em texto livre de products.
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

-- Contrato de acesso: registro e função são internos.
select ok(not has_table_privilege('authenticated', 'private.product_category_unification_log', 'select'),
  'usuário autenticado não lê o registro da unificação');
select ok(not has_table_privilege('anon', 'private.product_category_unification_log', 'select'),
  'anônimo não lê o registro da unificação');
select ok(not has_function_privilege('authenticated', 'private.unify_legacy_product_categories()', 'execute'),
  'usuário autenticado não executa a unificação');
select ok(not has_function_privilege('anon', 'private.unify_legacy_product_categories()', 'execute'),
  'anônimo não executa a unificação');
select ok(not has_table_privilege('service_role', 'private.product_category_unification_log', 'select'),
  'chave de serviço não lê o registro da unificação');
select ok(not has_function_privilege('service_role', 'private.unify_legacy_product_categories()', 'execute'),
  'chave de serviço não executa a unificação');
select ok((select proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'unify_legacy_product_categories')
    @> array['search_path=""'],
  'unificação roda com search_path fechado');

-- Cadastro fictício com as grafias vistas no cadastro real.
insert into public.products (id, name, category, kind, active) values
  ('a0000000-0000-4000-8000-000000000001', 'Teste revenda caixa alta', 'REVENDA', 'final', true),
  ('a0000000-0000-4000-8000-000000000002', 'Teste revenda minúscula', 'revenda', 'final', false),
  ('a0000000-0000-4000-8000-000000000003', 'Teste embalagem', 'EMBALAGEM', 'insumo', true),
  ('a0000000-0000-4000-8000-000000000004', 'Teste embalagem errada', 'Embalgem produção', 'insumo', true),
  ('a0000000-0000-4000-8000-000000000005', 'Teste insumo caixa alta', 'INSUMOS', 'insumo', true),
  ('a0000000-0000-4000-8000-000000000006', 'Teste higiene', 'Higiene/limpeza', 'insumo', true),
  ('a0000000-0000-4000-8000-000000000007', 'Teste manutenção', 'MATUTENÇÃO', 'insumo', true),
  ('a0000000-0000-4000-8000-000000000008', 'Teste doce', 'Doce', 'final', true),
  ('a0000000-0000-4000-8000-000000000009', 'Teste folhado', 'Folhados & Doces', 'final', false),
  ('a0000000-0000-4000-8000-000000000010', 'Ouro Branco Bombom', 'Doce', 'final', true),
  ('a0000000-0000-4000-8000-000000000011', 'Base Brigadeiro CAS 2,57KG', 'Confeitaria', 'final', true),
  ('a0000000-0000-4000-8000-000000000012', 'LUVA LATEX AMARELA', 'EMBALAGEM', 'insumo', true),
  ('a0000000-0000-4000-8000-000000000013', 'Base Brigadeiro CAS 2,57KG', 'Lanches', 'final', true),
  ('a0000000-0000-4000-8000-000000000014', 'Teste papel', 'OCUPAÇÃO', 'insumo', true),
  ('a0000000-0000-4000-8000-000000000015', 'Teste pão recheado', 'Pães Rech.', 'final', true),
  ('a0000000-0000-4000-8000-000000000016', 'Teste focaccia', 'Focaccias', 'final', true),
  ('a0000000-0000-4000-8000-000000000018', 'Bombom Sonho de Valsa', 'Bolos', 'final', true),
  ('a0000000-0000-4000-8000-000000000019', 'Massa Folhada', 'Confeitaria', 'final', true);

-- Pão público no site, na categoria antiga.
insert into public.products (
  id, name, category, kind, active, production_area, is_fabricacao_propria, is_pj, production_days
) values (
  'a0000000-0000-4000-8000-000000000017', 'Pão teste do site', 'Pães - Migrado', 'final', true,
  'padaria', true, false, array[1, 3]
);

select ok(exists(select 1 from public.site_bread_catalog
    where product_id = 'a0000000-0000-4000-8000-000000000017'),
  'pão fictício entrou no catálogo do site antes da unificação');

create temporary table site_slug_before as
  select slug from public.site_bread_catalog
  where product_id = 'a0000000-0000-4000-8000-000000000017';

create temporary table unify_result as
  select private.unify_legacy_product_categories() as changed;

select ok((select changed from unify_result) >= 16,
  'unificação informa quantos produtos trocou, incluindo os 16 fictícios fora do padrão');

select results_eq(
  $$select name || ' => ' || category from public.products
    where id::text like 'a0000000-%' order by id$$,
  $$values
    ('Teste revenda caixa alta => Revenda'),
    ('Teste revenda minúscula => Revenda'),
    ('Teste embalagem => Embalagens'),
    ('Teste embalagem errada => Embalagens'),
    ('Teste insumo caixa alta => Insumos'),
    ('Teste higiene => Higiene e limpeza'),
    ('Teste manutenção => Manutenção'),
    ('Teste doce => Confeitaria'),
    ('Teste folhado => Confeitaria'),
    ('Ouro Branco Bombom => Revenda'),
    ('Base Brigadeiro CAS 2,57KG => Insumos'),
    ('LUVA LATEX AMARELA => Higiene e limpeza'),
    ('Base Brigadeiro CAS 2,57KG => Lanches'),
    ('Teste papel => Escritório'),
    ('Teste pão recheado => Pães Recheados'),
    ('Teste focaccia => Focaccias'),
    ('Pão teste do site => Pães'),
    ('Bombom Sonho de Valsa => Revenda'),
    ('Massa Folhada => Confeitaria')$$,
  'cada grafia cai no nome decidido; homônimo de outro grupo e categoria sem repetição ficam como estavam'
);

select is(
  (select old_category from private.product_category_unification_log
    where product_id = 'a0000000-0000-4000-8000-000000000001'),
  'REVENDA',
  'registro guarda o texto antigo para reversão'
);
select is(
  (select count(*)::integer from private.product_category_unification_log
    where product_id::text like 'a0000000-%'),
  16,
  'registro tem uma linha por produto trocado'
);
select is(
  (select count(*)::integer from private.product_category_unification_log
    where product_id = 'a0000000-0000-4000-8000-000000000016'),
  0,
  'produto que já estava certo não entra no registro'
);

select ok(exists(select 1 from public.site_bread_catalog
    where product_id = 'a0000000-0000-4000-8000-000000000017'),
  'pão continua no catálogo do site depois de virar "Pães"');
select is(
  (select slug from public.site_bread_catalog where product_id = 'a0000000-0000-4000-8000-000000000017'),
  (select slug from site_slug_before),
  'endereço do pão no site não muda');

select is(private.unify_legacy_product_categories(), 0,
  'rodar de novo não troca nada');

-- Segunda execução com um item que voltou para Doce: ele unifica em
-- Confeitaria e sai para Revenda na mesma passada, sem depender da ordem.
update public.products set category = 'Doce' where id = 'a0000000-0000-4000-8000-000000000018';
select is(private.unify_legacy_product_categories(), 1,
  'item recolocado numa grafia antiga é tratado de novo numa passada só');
select is((select category from public.products where id = 'a0000000-0000-4000-8000-000000000018'),
  'Revenda', 'item movido cai direto no grupo decidido');

-- Nenhuma grafia antiga sobra em todo o cadastro, inclusive nos dados do seed.
select is(
  (select count(*)::integer from public.products
    where category in ('REVENDA', 'revenda', 'EMBALAGEM', 'EMBALAGENS', 'Embalagem produção',
      'Embalgem produção', 'INSUMOS', 'HIGIENE', 'LIMPEZA', 'Higiene/limpeza', 'MANUTENÇÃO',
      'MATUTENÇÃO', 'OCUPAÇÃO', 'Pães Rech.', 'Pães - Migrado', 'Doce', 'Bolos', 'Muffins',
      'Cookies', 'Brownie', 'Folhados & Doces')),
  0,
  'nenhuma grafia antiga sobra no cadastro');

select is(
  (select count(distinct category)::integer from public.products
    where private.normalize_product_category_name(category) in ('revenda', 'insumos', 'embalagens')),
  3,
  'Revenda, Insumos e Embalagens têm uma grafia cada');

-- A troca de grupo não altera outros campos do produto.
select is(
  (select kind || '/' || active::text from public.products where id = 'a0000000-0000-4000-8000-000000000002'),
  'final/false',
  'produto inativo é unificado sem ser reativado');
select is(
  (select kind from public.products where id = 'a0000000-0000-4000-8000-000000000011'),
  'final',
  'mover para Insumos não muda o tipo do produto');

select ok(
  (select relrowsecurity and relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private' and c.relname = 'product_category_unification_log'),
  'registro da unificação usa RLS forçada');

select ok(to_regclass('private.product_category_unification_log') is not null,
  'registro da unificação existe');

select * from finish();
rollback;
