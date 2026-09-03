begin;

create or replace function private.normalize_product_category_name(p_name text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  -- Precisa produzir EXATAMENTE a mesma chave que normalizeProductCategoryName,
  -- em src/lib/productCategories.ts. O acento chega de duas formas no Unicode:
  -- com o til dentro da letra, ou com o til como caractere separado, o que
  -- acontece com texto colado de alguns aparelhos. Decompor (NFD) e apagar as
  -- marcas resolve as duas de uma vez. Uma lista fixa de letras acentuadas
  -- deixava a segunda forma virar outra chave, e entao o banco aceitaria a
  -- mesma categoria duas vezes, que e justamente o que esta tela existe para
  -- impedir. `normalize` nao leva prefixo `pg_catalog.` porque e sintaxe do
  -- proprio parser; `pg_catalog` ja e pesquisado mesmo com search_path vazio.
  select pg_catalog.btrim(pg_catalog.regexp_replace(
    pg_catalog.lower(pg_catalog.regexp_replace(
      normalize(pg_catalog.btrim(p_name), NFD),
      '[\u0300-\u036f]', '', 'g'
    )),
    '[^a-z0-9]+', '-', 'g'
  ), '-');
$$;

-- O Postgres concede EXECUTE a PUBLIC em toda funcao nova, e `anon` herda isso.
-- A invariante "anon nao executa funcoes do ERP" cobre `public` e `private`, e
-- e o teste que segura a licao `grants-implicitos-variam-por-ambiente`: o que
-- vale e o privilegio efetivo depois de reconstruir o banco, nunca a intencao.
revoke all on function private.normalize_product_category_name(text)
  from public, anon, authenticated;

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 80),
  normalized_name text generated always as (private.normalize_product_category_name(name)) stored,
  catalog_type text not null check (catalog_type in (
    'materia_prima',
    'embalagem',
    'higiene_limpeza',
    'escritorio_administrativo',
    'utensilio_equipamento',
    'manutencao',
    'produto_fabricado',
    'produto_revenda',
    'kit'
  )),
  active boolean not null default true,
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (normalized_name),
  unique (id, catalog_type)
);

comment on table public.product_categories is
  'Categorias controladas do catálogo de itens; não se confunde com categorias financeiras do DRE.';
comment on column public.product_categories.catalog_type is
  'Natureza operacional fixa à qual a categoria pertence.';

create index product_categories_listing_idx
  on public.product_categories (active desc, catalog_type, sort_order, name);

alter table public.product_categories enable row level security;
alter table public.product_categories force row level security;

create policy product_categories_select_active_profile
on public.product_categories for select to authenticated
using (exists (
  select 1
  from public.app_profiles profile
  where profile.user_id = (select auth.uid())
    and profile.active
));

revoke all on table public.product_categories from public, anon, authenticated;
grant select on table public.product_categories to authenticated;

alter table public.products
  add column if not exists catalog_type text,
  add column if not exists category_id uuid;

alter table public.products
  add constraint products_catalog_type_check check (
    catalog_type is null or catalog_type in (
      'materia_prima',
      'embalagem',
      'higiene_limpeza',
      'escritorio_administrativo',
      'utensilio_equipamento',
      'manutencao',
      'produto_fabricado',
      'produto_revenda',
      'kit'
    )
  ),
  add constraint products_category_requires_type_check check (
    category_id is null or catalog_type is not null
  ),
  add constraint products_category_type_fkey foreign key (category_id, catalog_type)
    references public.product_categories (id, catalog_type)
    on update cascade on delete restrict;

comment on column public.products.catalog_type is
  'Natureza operacional controlada. Nulo significa item legado ainda não revisado.';
comment on column public.products.category_id is
  'Categoria controlada do catálogo. O texto legado products.category permanece até a migração assistida.';

create index products_catalog_type_idx
  on public.products (catalog_type) where catalog_type is not null;
create index products_category_id_idx
  on public.products (category_id) where category_id is not null;

create or replace function public.manage_product_category(
  p_name text,
  p_catalog_type text,
  p_id uuid default null,
  p_active boolean default true,
  p_sort_order integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text := pg_catalog.btrim(p_name);
begin
  if not (select private.current_user_is_access_admin()) then
    raise exception using errcode = '42501', message = 'Somente administradores podem gerenciar categorias de produtos.';
  end if;

  if v_name is null or char_length(v_name) not between 2 and 80 then
    raise exception using errcode = '22023', message = 'Informe um nome de categoria entre 2 e 80 caracteres.';
  end if;
  if private.normalize_product_category_name(v_name) = '' then
    raise exception using errcode = '22023', message = 'O nome da categoria precisa conter letras ou números.';
  end if;
  if p_catalog_type is null or p_catalog_type not in (
    'materia_prima', 'embalagem', 'higiene_limpeza', 'escritorio_administrativo',
    'utensilio_equipamento', 'manutencao', 'produto_fabricado', 'produto_revenda', 'kit'
  ) then
    raise exception using errcode = '22023', message = 'Tipo de item inválido.';
  end if;
  if p_sort_order is null or p_sort_order not between 0 and 10000 then
    raise exception using errcode = '22023', message = 'A ordem deve estar entre 0 e 10000.';
  end if;

  if p_id is null then
    insert into public.product_categories (name, catalog_type, active, sort_order)
    values (v_name, p_catalog_type, coalesce(p_active, true), p_sort_order)
    returning id into v_id;
  else
    if exists (
      select 1 from public.products product
      where product.category_id = p_id
        and product.catalog_type is distinct from p_catalog_type
    ) then
      raise exception using errcode = '23503',
        message = 'Não é possível trocar o tipo de uma categoria já usada por produtos.';
    end if;

    update public.product_categories category
    set name = v_name,
        catalog_type = p_catalog_type,
        active = coalesce(p_active, category.active),
        sort_order = p_sort_order,
        updated_at = now()
    where category.id = p_id
    returning category.id into v_id;

    if v_id is null then
      raise exception using errcode = 'P0002', message = 'Categoria de produto não encontrada.';
    end if;
  end if;

  return v_id;
exception
  when unique_violation then
    raise exception using errcode = '23505',
      message = 'Já existe uma categoria com esse nome, mesmo considerando acentos e maiúsculas.';
end;
$$;

revoke all on function public.manage_product_category(text, text, uuid, boolean, integer)
  from public, anon;
grant execute on function public.manage_product_category(text, text, uuid, boolean, integer)
  to authenticated;

commit;
