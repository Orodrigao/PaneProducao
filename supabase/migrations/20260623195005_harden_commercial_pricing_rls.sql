alter table public.customers enable row level security;
alter table public.price_tiers enable row level security;
alter table public.price_tier_items enable row level security;
alter table public.customer_price_overrides enable row level security;

revoke all on table public.customers from anon;
revoke all on table public.price_tiers from anon;
revoke all on table public.price_tier_items from anon;
revoke all on table public.customer_price_overrides from anon;

revoke all on table public.customers from authenticated;
revoke all on table public.price_tiers from authenticated;
revoke all on table public.price_tier_items from authenticated;
revoke all on table public.customer_price_overrides from authenticated;

grant select, insert, update on table public.customers to authenticated;
grant select, insert, update on table public.price_tiers to authenticated;
grant select, insert, update on table public.price_tier_items to authenticated;
grant select, insert, update on table public.customer_price_overrides to authenticated;

grant all on table public.customers to service_role;
grant all on table public.price_tiers to service_role;
grant all on table public.price_tier_items to service_role;
grant all on table public.customer_price_overrides to service_role;

drop policy if exists anon_select on public.customers;
drop policy if exists anon_insert on public.customers;
drop policy if exists anon_update on public.customers;
drop policy if exists customers_select_commercial on public.customers;
drop policy if exists customers_insert_commercial on public.customers;
drop policy if exists customers_update_commercial on public.customers;

drop policy if exists anon_select on public.price_tiers;
drop policy if exists anon_insert on public.price_tiers;
drop policy if exists anon_update on public.price_tiers;
drop policy if exists price_tiers_select_commercial on public.price_tiers;
drop policy if exists price_tiers_insert_commercial on public.price_tiers;
drop policy if exists price_tiers_update_commercial on public.price_tiers;

drop policy if exists anon_select on public.price_tier_items;
drop policy if exists anon_insert on public.price_tier_items;
drop policy if exists anon_update on public.price_tier_items;
drop policy if exists price_tier_items_select_commercial on public.price_tier_items;
drop policy if exists price_tier_items_insert_commercial on public.price_tier_items;
drop policy if exists price_tier_items_update_commercial on public.price_tier_items;

drop policy if exists anon_select on public.customer_price_overrides;
drop policy if exists anon_insert on public.customer_price_overrides;
drop policy if exists anon_update on public.customer_price_overrides;
drop policy if exists customer_price_overrides_select_commercial on public.customer_price_overrides;
drop policy if exists customer_price_overrides_insert_commercial on public.customer_price_overrides;
drop policy if exists customer_price_overrides_update_commercial on public.customer_price_overrides;

create policy customers_select_commercial
on public.customers
for select
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and (
        p.role in ('admin', 'financeiro')
        or (p.role = 'vendas' and public.customers.active)
      )
  )
);

create policy customers_insert_commercial
on public.customers
for insert
to authenticated
with check (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro')
  )
);

create policy customers_update_commercial
on public.customers
for update
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro')
  )
)
with check (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro')
  )
);

create policy price_tiers_select_commercial
on public.price_tiers
for select
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro')
  )
);

create policy price_tiers_insert_commercial
on public.price_tiers
for insert
to authenticated
with check (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro')
  )
);

create policy price_tiers_update_commercial
on public.price_tiers
for update
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro')
  )
)
with check (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro')
  )
);

create policy price_tier_items_select_commercial
on public.price_tier_items
for select
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro')
  )
);

create policy price_tier_items_insert_commercial
on public.price_tier_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro')
  )
);

create policy price_tier_items_update_commercial
on public.price_tier_items
for update
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro')
  )
)
with check (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro')
  )
);

create policy customer_price_overrides_select_commercial
on public.customer_price_overrides
for select
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro')
  )
);

create policy customer_price_overrides_insert_commercial
on public.customer_price_overrides
for insert
to authenticated
with check (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro')
  )
);

create policy customer_price_overrides_update_commercial
on public.customer_price_overrides
for update
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro')
  )
)
with check (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro')
  )
);
