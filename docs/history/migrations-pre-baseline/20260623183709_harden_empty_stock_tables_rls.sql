alter table public.stock_entries enable row level security;
alter table public.stock_entry_items enable row level security;
alter table public.stock_balance enable row level security;
alter table public.stock_movements enable row level security;

revoke all on table public.stock_entries from anon;
revoke all on table public.stock_entry_items from anon;
revoke all on table public.stock_balance from anon;
revoke all on table public.stock_movements from anon;

revoke all on table public.stock_entries from authenticated;
revoke all on table public.stock_entry_items from authenticated;
revoke all on table public.stock_balance from authenticated;
revoke all on table public.stock_movements from authenticated;

grant select, insert on table public.stock_entries to authenticated;
grant select, insert on table public.stock_entry_items to authenticated;
grant select, insert, update on table public.stock_balance to authenticated;
grant select, insert on table public.stock_movements to authenticated;

grant all on table public.stock_entries to service_role;
grant all on table public.stock_entry_items to service_role;
grant all on table public.stock_balance to service_role;
grant all on table public.stock_movements to service_role;

drop policy if exists anon_select on public.stock_movements;
drop policy if exists anon_insert on public.stock_movements;

drop policy if exists stock_entries_select_internal on public.stock_entries;
drop policy if exists stock_entries_insert_internal on public.stock_entries;
drop policy if exists stock_entry_items_select_internal on public.stock_entry_items;
drop policy if exists stock_entry_items_insert_internal on public.stock_entry_items;
drop policy if exists stock_balance_select_internal on public.stock_balance;
drop policy if exists stock_balance_insert_internal on public.stock_balance;
drop policy if exists stock_balance_update_internal on public.stock_balance;
drop policy if exists stock_movements_select_internal on public.stock_movements;
drop policy if exists stock_movements_insert_internal on public.stock_movements;

create policy stock_entries_select_internal
on public.stock_entries
for select
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro', 'estoque', 'compras', 'expedicao')
  )
);

create policy stock_entries_insert_internal
on public.stock_entries
for insert
to authenticated
with check (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro', 'estoque', 'compras')
  )
);

create policy stock_entry_items_select_internal
on public.stock_entry_items
for select
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro', 'estoque', 'compras', 'expedicao')
  )
);

create policy stock_entry_items_insert_internal
on public.stock_entry_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro', 'estoque', 'compras')
  )
);

create policy stock_balance_select_internal
on public.stock_balance
for select
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro', 'estoque', 'compras', 'expedicao')
  )
);

create policy stock_balance_insert_internal
on public.stock_balance
for insert
to authenticated
with check (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro', 'estoque', 'compras')
  )
);

create policy stock_balance_update_internal
on public.stock_balance
for update
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro', 'estoque', 'compras')
  )
)
with check (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro', 'estoque', 'compras')
  )
);

create policy stock_movements_select_internal
on public.stock_movements
for select
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro', 'estoque', 'compras', 'expedicao')
  )
);

create policy stock_movements_insert_internal
on public.stock_movements
for insert
to authenticated
with check (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro', 'estoque', 'compras')
  )
);
