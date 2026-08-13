-- Vitrine pública mínima para o site da Pane. Esta tabela nunca replica custo,
-- fornecedores, receita nem qualquer dado interno do catálogo.
create table public.site_bread_catalog (
  product_id uuid primary key references public.products(id) on delete cascade,
  name text not null,
  slug text not null unique,
  production_days integer[] not null,
  sort_order integer not null default 0,
  constraint site_bread_catalog_production_days_valid
    check (production_days <@ array[0, 1, 2, 3, 4, 5, 6] and cardinality(production_days) > 0)
);

comment on table public.site_bread_catalog is
  'Lista pública mínima dos pães da programação regular. Sincronizada automaticamente a partir de products.';
comment on column public.site_bread_catalog.slug is
  'Endereço público estável do pão. Permanece mesmo se o nome interno mudar.';

alter table public.site_bread_catalog enable row level security;
alter table public.site_bread_catalog force row level security;

revoke all on table public.site_bread_catalog from public, anon, authenticated, service_role;
grant select on table public.site_bread_catalog to anon;
grant all on table public.site_bread_catalog to service_role;

create policy site_bread_catalog_read_public
on public.site_bread_catalog
for select to anon
using (true);

create function private.site_bread_slug_base(p_name text, p_product_id uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(
      trim(both '-' from regexp_replace(
        translate(lower(btrim(p_name)),
          'áàãâäéèêëíìîïóòôõöúùûüçñ',
          'aaaaaeeeeiiiiooooouuuucn'
        ),
        '[^a-z0-9]+', '-', 'g'
      )),
      ''
    ),
    'pao-' || left(p_product_id::text, 8)
  );
$$;

revoke all on function private.site_bread_slug_base(text, uuid)
  from public, anon, authenticated, service_role;

create function private.sync_site_bread_catalog()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_public_bread boolean;
  next_slug text;
begin
  if tg_op = 'DELETE' then
    delete from public.site_bread_catalog where product_id = old.id;
    return old;
  end if;

  is_public_bread := new.active is true
    and new.production_area = 'padaria'
    and new.category like 'Pães%'
    and new.kind = 'final'
    and new.is_fabricacao_propria is true
    and new.is_pj is false
    and cardinality(new.production_days) > 0;

  if not is_public_bread then
    delete from public.site_bread_catalog where product_id = new.id;
    return new;
  end if;

  select slug into next_slug
  from public.site_bread_catalog
  where product_id = new.id;

  if next_slug is null then
    next_slug := private.site_bread_slug_base(new.name, new.id);

    if exists (select 1 from public.site_bread_catalog where slug = next_slug) then
      next_slug := next_slug || '-' || left(new.id::text, 8);
    end if;
  end if;

  insert into public.site_bread_catalog (product_id, name, slug, production_days, sort_order)
  values (new.id, new.name, next_slug, new.production_days, new.sort_order)
  on conflict (product_id) do update set
    name = excluded.name,
    production_days = excluded.production_days,
    sort_order = excluded.sort_order;

  return new;
end;
$$;

revoke all on function private.sync_site_bread_catalog()
  from public, anon, authenticated, service_role;

create trigger sync_site_bread_catalog_after_product_change
after insert or update of name, category, active, sort_order, kind,
  is_fabricacao_propria, is_pj, production_days, production_area or delete
on public.products
for each row execute function private.sync_site_bread_catalog();

with candidates as (
  select
    p.id,
    p.name,
    p.production_days,
    p.sort_order,
    private.site_bread_slug_base(p.name, p.id) as slug_base
  from public.products p
  where p.active is true
    and p.production_area = 'padaria'
    and p.category like 'Pães%'
    and p.kind = 'final'
    and p.is_fabricacao_propria is true
    and p.is_pj is false
    and cardinality(p.production_days) > 0
), ranked_candidates as (
  select *, row_number() over (partition by slug_base order by id) as slug_rank
  from candidates
)
insert into public.site_bread_catalog (product_id, name, slug, production_days, sort_order)
select
  id,
  name,
  case when slug_rank = 1 then slug_base else slug_base || '-' || left(id::text, 8) end,
  production_days,
  sort_order
from ranked_candidates;
