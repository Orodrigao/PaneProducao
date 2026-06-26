create table if not exists public.product_recipe_yields (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  batch_name text,
  basis text not null default 'baked',
  dough_weight_kg numeric,
  finished_weight_kg numeric,
  yield_units numeric,
  average_unit_weight_kg numeric generated always as (
    case
      when finished_weight_kg is not null and yield_units is not null and yield_units > 0
        then finished_weight_kg / yield_units
      else null
    end
  ) stored,
  bake_loss_pct numeric generated always as (
    case
      when dough_weight_kg is not null
        and dough_weight_kg > 0
        and finished_weight_kg is not null
        then ((dough_weight_kg - finished_weight_kg) / dough_weight_kg) * 100
      else null
    end
  ) stored,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint product_recipe_yields_product_id_key unique (product_id),
  constraint product_recipe_yields_basis_valid check (basis in ('dough', 'baked', 'unit')),
  constraint product_recipe_yields_positive_values check (
    (dough_weight_kg is null or dough_weight_kg > 0)
    and (finished_weight_kg is null or finished_weight_kg > 0)
    and (yield_units is null or yield_units > 0)
  )
);

create table if not exists public.product_sale_options (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  sale_unit text not null,
  reference_quantity numeric not null default 1,
  unit_weight_kg numeric,
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint product_sale_options_sale_unit_valid check (sale_unit in ('un', 'kg')),
  constraint product_sale_options_reference_quantity_positive check (reference_quantity > 0),
  constraint product_sale_options_unit_weight_positive check (unit_weight_kg is null or unit_weight_kg > 0),
  constraint product_sale_options_product_unit_key unique (product_id, sale_unit)
);

create unique index if not exists product_sale_options_default_key
  on public.product_sale_options (product_id)
  where is_default and active;

create index if not exists product_sale_options_product_idx
  on public.product_sale_options (product_id)
  where active;

alter table public.price_tier_items
  add column if not exists sale_option_id uuid references public.product_sale_options(id) on delete set null;

alter table public.customer_price_overrides
  add column if not exists sale_option_id uuid references public.product_sale_options(id) on delete set null;

alter table public.orders
  add column if not exists sale_option_id uuid references public.product_sale_options(id) on delete set null;

create index if not exists price_tier_items_sale_option_idx
  on public.price_tier_items (sale_option_id)
  where sale_option_id is not null;

create index if not exists customer_price_overrides_sale_option_idx
  on public.customer_price_overrides (sale_option_id)
  where sale_option_id is not null;

create index if not exists orders_sale_option_idx
  on public.orders (sale_option_id)
  where sale_option_id is not null;

insert into public.product_sale_options (
  product_id,
  name,
  sale_unit,
  reference_quantity,
  is_default,
  active
)
select
  p.id,
  case when lower(coalesce(p.unit, 'un')) = 'kg' then 'Quilo' else 'Unidade' end,
  case when lower(coalesce(p.unit, 'un')) = 'kg' then 'kg' else 'un' end,
  1,
  true,
  coalesce(p.active, true)
from public.products p
where not exists (
  select 1
  from public.product_sale_options o
  where o.product_id = p.id
);

update public.price_tier_items i
set sale_option_id = o.id
from public.product_sale_options o
where i.sale_option_id is null
  and i.product_source = 'product'
  and i.product_id::uuid = o.product_id
  and o.is_default
  and o.active;

update public.customer_price_overrides c
set sale_option_id = o.id
from public.product_sale_options o
where c.sale_option_id is null
  and c.product_source = 'product'
  and c.product_id::uuid = o.product_id
  and o.is_default
  and o.active;

alter table public.product_recipe_yields enable row level security;
alter table public.product_sale_options enable row level security;

revoke all on table public.product_recipe_yields from anon;
revoke all on table public.product_sale_options from anon;

revoke all on table public.product_recipe_yields from authenticated;
revoke all on table public.product_sale_options from authenticated;

grant select, insert, update on table public.product_recipe_yields to authenticated;
grant select, insert, update on table public.product_sale_options to authenticated;

grant all on table public.product_recipe_yields to service_role;
grant all on table public.product_sale_options to service_role;

drop policy if exists product_recipe_yields_select_internal on public.product_recipe_yields;
drop policy if exists product_recipe_yields_insert_internal on public.product_recipe_yields;
drop policy if exists product_recipe_yields_update_internal on public.product_recipe_yields;
drop policy if exists product_sale_options_select_internal on public.product_sale_options;
drop policy if exists product_sale_options_insert_internal on public.product_sale_options;
drop policy if exists product_sale_options_update_internal on public.product_sale_options;

create policy product_recipe_yields_select_internal
on public.product_recipe_yields
for select
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
  )
);

create policy product_recipe_yields_insert_internal
on public.product_recipe_yields
for insert
to authenticated
with check (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro', 'compras')
  )
);

create policy product_recipe_yields_update_internal
on public.product_recipe_yields
for update
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro', 'compras')
  )
)
with check (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro', 'compras')
  )
);

create policy product_sale_options_select_internal
on public.product_sale_options
for select
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
  )
);

create policy product_sale_options_insert_internal
on public.product_sale_options
for insert
to authenticated
with check (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro', 'compras')
  )
);

create policy product_sale_options_update_internal
on public.product_sale_options
for update
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro', 'compras')
  )
)
with check (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro', 'compras')
  )
);

comment on table public.product_recipe_yields is
  'Rendimento da ficha tecnica por produto: massa crua, peso assado e/ou unidades geradas.';

comment on table public.product_sale_options is
  'Formas de venda do produto unico, como unidade e quilo, sem duplicar cadastro.';

comment on column public.product_sale_options.reference_quantity is
  'Quantidade de referencia da forma de venda. Ex.: 1 unidade ou 1 kg.';

comment on column public.product_sale_options.unit_weight_kg is
  'Peso medio em kg quando a forma de venda e por unidade.';
