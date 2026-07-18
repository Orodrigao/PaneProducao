alter table public.product_production enable row level security;

revoke all on table public.product_production from public;
revoke all on table public.product_production from anon;
revoke all on table public.product_production from authenticated;

grant select, insert, update, delete
on table public.product_production
to authenticated;

grant all on table public.product_production to service_role;

drop policy if exists anon_select on public.product_production;
drop policy if exists anon_insert on public.product_production;
drop policy if exists anon_update on public.product_production;
drop policy if exists anon_delete on public.product_production;

drop policy if exists product_production_select_active_profiles
on public.product_production;
drop policy if exists product_production_insert_admins
on public.product_production;
drop policy if exists product_production_update_admins
on public.product_production;
drop policy if exists product_production_delete_admins
on public.product_production;

create policy product_production_select_active_profiles
on public.product_production
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

create policy product_production_insert_admins
on public.product_production
for insert
to authenticated
with check (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role = 'admin'
  )
);

create policy product_production_update_admins
on public.product_production
for update
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role = 'admin'
  )
);

create policy product_production_delete_admins
on public.product_production
for delete
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role = 'admin'
  )
);
