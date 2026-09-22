-- Unifica as grafias repetidas da categoria em texto livre de products.
--
-- O cadastro real tinha "REVENDA", "Revenda" e "revenda" como três categorias,
-- quatro variações de embalagem, "INSUMOS" e "Insumos", e assim por diante.
-- A contagem de estoque e os filtros das telas agrupam por esse texto, então
-- cada grafia virava um grupo separado. As decisões de nome são do Rodrigo
-- (2026-09-22): uma só Embalagens, uma só Higiene e limpeza, todo doce em
-- Confeitaria, "Pães - Migrado" vira "Pães", e alguns itens mudam de grupo.
--
-- Esta migration não mexe na lista controlada (product_categories), que segue
-- o plano próprio em docs/CATALOGO_PRODUTOS.md. Ela só limpa o texto legado.
--
-- Reversão: cada troca fica registrada em
-- private.product_category_unification_log com o texto antigo. Uma migration
-- nova pode devolver products.category a partir desse registro.
--
-- O gatilho sync_site_bread_catalog reage a mudança de categoria e publica no
-- site os pães cuja categoria começa com "Pães". Os dois nomes novos de pão
-- ("Pães" e "Pães Recheados") continuam começando assim, então o site não perde
-- nenhum pão; o teste da frente prova isso.

begin;

create table private.product_category_unification_log (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products (id) on delete cascade,
  old_category text not null,
  new_category text not null,
  unified_at timestamptz not null default now()
);

comment on table private.product_category_unification_log is
  'Registro das categorias em texto livre unificadas em 2026-09-22; permite devolver o texto antigo.';

alter table private.product_category_unification_log enable row level security;
alter table private.product_category_unification_log force row level security;
revoke all on table private.product_category_unification_log from public, anon, authenticated, service_role;

-- A função existe para esta limpeza e para o teste pgTAP provar a regra.
-- Não rode de novo em produção: ela devolveria ao grupo decidido hoje os itens
-- da lista de trocas que a operação tenha mudado de propósito depois.
create or replace function private.unify_legacy_product_categories()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed integer;
begin
  with category_map (legacy_key, new_category) as (
    -- Chaves pela mesma normalização da lista controlada: sem acento, sem
    -- maiúscula e sem pontuação. Assim "INSUMOS" e "Insumos" caem na mesma.
    values
      ('insumos', 'Insumos'),
      ('revenda', 'Revenda'),
      ('embalagem', 'Embalagens'),
      ('embalagens', 'Embalagens'),
      ('embalagem-producao', 'Embalagens'),
      ('embalgem-producao', 'Embalagens'),
      ('higiene', 'Higiene e limpeza'),
      ('limpeza', 'Higiene e limpeza'),
      ('higiene-limpeza', 'Higiene e limpeza'),
      ('manutencao', 'Manutenção'),
      ('matutencao', 'Manutenção'),
      ('ocupacao', 'Escritório'),
      ('paes-rech', 'Pães Recheados'),
      ('paes-recheados', 'Pães Recheados'),
      ('paes-migrado', 'Pães'),
      ('confeitaria', 'Confeitaria'),
      ('doce', 'Confeitaria'),
      ('bolos', 'Confeitaria'),
      ('muffins', 'Confeitaria'),
      ('cookies', 'Confeitaria'),
      ('brownie', 'Confeitaria'),
      ('folhados-doces', 'Confeitaria')
  ),
  item_moves (source_category, product_name, new_category) as (
    -- Itens que estavam no grupo errado. Casam por nome E pelo grupo já
    -- unificado de origem: não arrasta homônimo de outro grupo e, rodando de
    -- novo, o item que já saiu do grupo de origem não é movido outra vez.
    -- "Massa Folhada" fica em Confeitaria: tem preço em tabela de preço.
    values
      ('Confeitaria', 'BOMBOM SONHO DE VALSA', 'Revenda'),
      ('Confeitaria', 'OURO BRANCO BOMBOM', 'Revenda'),
      ('Confeitaria', 'BASE BRIGADEIRO CAS 2,57KG', 'Insumos'),
      ('Confeitaria', 'MISTURA PANETTONE INSUMO', 'Insumos'),
      ('Embalagens', 'LUVA LATEX AMARELA', 'Higiene e limpeza')
  ),
  target as (
    select
      product.id,
      product.category as old_category,
      coalesce(item_move.new_category, category_map.new_category) as new_category
    from public.products product
    left join category_map
      on category_map.legacy_key = private.normalize_product_category_name(product.category)
    left join item_moves item_move
      on item_move.source_category = coalesce(category_map.new_category, product.category)
     and item_move.product_name = pg_catalog.upper(pg_catalog.btrim(product.name))
    where coalesce(item_move.new_category, category_map.new_category) is not null
  ),
  changed as (
    update public.products product
    set category = target.new_category
    from target
    where product.id = target.id
      and product.category is distinct from target.new_category
    returning product.id, target.old_category, target.new_category
  ),
  logged as (
    insert into private.product_category_unification_log (product_id, old_category, new_category)
    select changed.id, changed.old_category, changed.new_category
    from changed
    returning 1
  )
  select count(*) into v_changed from logged;

  return v_changed;
end;
$$;

revoke all on function private.unify_legacy_product_categories()
  from public, anon, authenticated, service_role;

select private.unify_legacy_product_categories();

commit;
