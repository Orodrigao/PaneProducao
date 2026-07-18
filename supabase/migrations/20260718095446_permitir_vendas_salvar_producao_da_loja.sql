alter table public.orders enable row level security;

drop policy if exists orders_insert_authenticated_profiles on public.orders;
drop policy if exists orders_update_authenticated_profiles on public.orders;
drop policy if exists orders_delete_authenticated_profiles on public.orders;

create policy orders_insert_authenticated_profiles
on public.orders
for insert
to authenticated
with check (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and (
        p.role in ('admin', 'financeiro')
        or (
          p.role = 'vendas'
          and (
            public.orders.order_type = 'encomenda'
            or (
              public.orders.order_type = 'producao'
              and p.store = public.orders.store
            )
          )
        )
      )
  )
);

create policy orders_update_authenticated_profiles
on public.orders
for update
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and (
        p.role in ('admin', 'financeiro')
        or (
          p.role = 'vendas'
          and (
            public.orders.order_type = 'encomenda'
            or (
              public.orders.order_type = 'producao'
              and p.store = public.orders.store
            )
          )
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and (
        p.role in ('admin', 'financeiro')
        or (
          p.role = 'vendas'
          and (
            public.orders.order_type = 'encomenda'
            or (
              public.orders.order_type = 'producao'
              and p.store = public.orders.store
            )
          )
        )
      )
  )
);

create policy orders_delete_authenticated_profiles
on public.orders
for delete
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and (
        p.role in ('admin', 'financeiro')
        or (
          p.role = 'vendas'
          and (
            public.orders.order_type = 'encomenda'
            or (
              public.orders.order_type = 'producao'
              and p.store = public.orders.store
            )
          )
        )
      )
  )
);
