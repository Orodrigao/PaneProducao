-- Fase 2A do catálogo: a lista controlada nasce preenchida e o cadastro
-- existente passa a apontar para ela.
--
-- A fase 1 (PR #318) criou public.product_categories, os nove tipos de item e
-- as colunas products.catalog_type e products.category_id, mas nada foi
-- preenchido: a lista ficou vazia e nenhum produto foi classificado. A PR #432
-- unificou o texto livre de products.category em 20 grafias limpas, e é isso
-- que torna esta migration possível sem tela de classificação item a item:
-- cada uma das 20 vira uma categoria controlada, e o produto encontra a sua
-- pela mesma chave normalizada que a lista já usa.
--
-- O tipo de item de cada categoria foi decidido pelo Rodrigo em 2026-09-22:
-- Insumos é matéria-prima; Embalagens, Higiene e limpeza, Escritório e
-- Manutenção vão para os tipos de mesmo nome; Revenda é produto de revenda; e
-- as catorze categorias de venda são produto fabricado. Os seis produtos
-- marcados como kit no cadastro (kind = 'kit') seguem a categoria de pão onde
-- já estão, porque quem responde "isto é um kit" hoje é products.kind: criar
-- uma segunda fonte para a mesma pergunta é como as grafias repetidas
-- nasceram. Os tipos utensilio_equipamento e kit continuam existindo, sem
-- categoria, até a operação precisar deles.
--
-- Reversão: cada classificação fica em
-- private.product_catalog_assignment_log com o valor anterior. O texto livre
-- em products.category não é tocado, então nenhuma tela que ainda lê o texto
-- muda de comportamento por causa desta migration.
--
-- O gatilho sync_site_bread_catalog publica pão no site e reage a UPDATE OF
-- name, category, active, sort_order, kind, is_fabricacao_propria, is_pj,
-- production_days, production_area. Esta migration escreve só catalog_type e
-- category_id, que estão fora dessa lista; o teste da frente prova que o
-- catálogo do site fica igual.

begin;

-- 1. A lista controlada recebe as categorias que o cadastro já usa.
--    Quem decide se uma categoria já existe é a chave normalizada, a mesma do
--    índice único da tabela: assim rodar de novo não tenta inserir duplicata
--    nem depende do nome ter sido escrito com o mesmo acento.
insert into public.product_categories (name, catalog_type, sort_order)
select seed.name, seed.catalog_type, seed.sort_order
from (values
  ('Insumos', 'materia_prima', 10),
  ('Embalagens', 'embalagem', 10),
  ('Higiene e limpeza', 'higiene_limpeza', 10),
  ('Escritório', 'escritorio_administrativo', 10),
  ('Manutenção', 'manutencao', 10),
  ('Revenda', 'produto_revenda', 10),
  -- Produto fabricado em ordem de uso na padaria, não alfabética: quem
  -- cadastra item novo abre a lista atrás de pão muito mais vezes que atrás
  -- de sopa.
  ('Pães', 'produto_fabricado', 10),
  ('Pães Branco', 'produto_fabricado', 20),
  ('Pães Integ.', 'produto_fabricado', 30),
  ('Pães Recheados', 'produto_fabricado', 40),
  ('Croissant', 'produto_fabricado', 50),
  ('Focaccias', 'produto_fabricado', 60),
  ('Pizza Romana', 'produto_fabricado', 70),
  ('Pizza Redonda', 'produto_fabricado', 80),
  ('Bruschettas', 'produto_fabricado', 90),
  ('Lanches', 'produto_fabricado', 100),
  ('Salgados', 'produto_fabricado', 110),
  ('Sopas & Cremes', 'produto_fabricado', 120),
  ('Pastas & Pesto', 'produto_fabricado', 130),
  ('Confeitaria', 'produto_fabricado', 140)
) as seed(name, catalog_type, sort_order)
where not exists (
  select 1
  from public.product_categories existing
  where existing.normalized_name = private.normalize_product_category_name(seed.name)
);

create table private.product_catalog_assignment_log (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products (id) on delete cascade,
  old_catalog_type text,
  old_category_id uuid,
  new_catalog_type text not null,
  new_category_id uuid not null,
  assigned_at timestamptz not null default now()
);

comment on table private.product_catalog_assignment_log is
  'Registro da classificação automática de 2026-09-22; permite devolver tipo e categoria controlada ao valor anterior.';

alter table private.product_catalog_assignment_log enable row level security;
alter table private.product_catalog_assignment_log force row level security;
revoke all on table private.product_catalog_assignment_log
  from public, anon, authenticated, service_role;

-- Classifica pelo nome da categoria em texto livre. Só toca produto que está
-- sem tipo E sem categoria: decisão já registrada por alguém, inclusive uma
-- feita depois desta migration, não é sobrescrita. Por isso a função é segura
-- para rodar de novo, e a fase seguinte pode reaproveitá-la para os produtos
-- que chegarem antes de a tela exigir a escolha.
create or replace function private.assign_controlled_product_categories()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed integer;
begin
  with target as (
    select
      product.id,
      product.catalog_type as old_catalog_type,
      product.category_id as old_category_id,
      category.id as new_category_id,
      category.catalog_type as new_catalog_type
    from public.products product
    join public.product_categories category
      on category.normalized_name = private.normalize_product_category_name(product.category)
    where product.category_id is null
      and product.catalog_type is null
      and category.active
  ),
  changed as (
    update public.products product
    set catalog_type = target.new_catalog_type,
        category_id = target.new_category_id
    from target
    where product.id = target.id
    returning
      product.id,
      target.old_catalog_type,
      target.old_category_id,
      target.new_catalog_type,
      target.new_category_id
  ),
  logged as (
    insert into private.product_catalog_assignment_log (
      product_id, old_catalog_type, old_category_id, new_catalog_type, new_category_id
    )
    select
      changed.id,
      changed.old_catalog_type,
      changed.old_category_id,
      changed.new_catalog_type,
      changed.new_category_id
    from changed
    returning 1
  )
  select pg_catalog.count(*) into v_changed from logged;

  return v_changed;
end;
$$;

-- O Postgres concede EXECUTE a PUBLIC em toda função nova, e anon herda isso.
revoke all on function private.assign_controlled_product_categories()
  from public, anon, authenticated, service_role;

select private.assign_controlled_product_categories();

commit;
