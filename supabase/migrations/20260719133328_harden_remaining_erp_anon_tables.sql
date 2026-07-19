-- Fecha as ultimas tabelas operacionais do PaneERP ainda acessiveis pelo role
-- anon. As tabelas pizza_* pertencem ao repositorio ControlePizza e nao fazem
-- parte desta migration.

alter table public.bread_movements enable row level security;
alter table public.breads enable row level security;
alter table public.frozen_movements enable row level security;
alter table public.orders enable row level security;
alter table public.product_components enable row level security;
alter table public.production_actuals enable row level security;
alter table public.shelf_counts enable row level security;

revoke all on table public.bread_movements from public, anon, authenticated;
revoke all on table public.breads from public, anon, authenticated;
revoke all on table public.frozen_movements from public, anon, authenticated;
revoke all on table public.orders from public, anon, authenticated;
revoke all on table public.product_components from public, anon, authenticated;
revoke all on table public.production_actuals from public, anon, authenticated;
revoke all on table public.shelf_counts from public, anon, authenticated;

grant select, insert, delete on table public.bread_movements to authenticated;
grant select, insert, update, delete on table public.breads to authenticated;
grant select, insert on table public.frozen_movements to authenticated;
grant select, insert, update, delete on table public.orders to authenticated;
grant select, insert, update, delete on table public.product_components to authenticated;
grant select on table public.production_actuals to authenticated;
grant select, insert, update on table public.shelf_counts to authenticated;

grant all on table public.bread_movements to service_role;
grant all on table public.breads to service_role;
grant all on table public.frozen_movements to service_role;
grant all on table public.orders to service_role;
grant all on table public.product_components to service_role;
grant all on table public.production_actuals to service_role;
grant all on table public.shelf_counts to service_role;

drop policy if exists anon_select on public.bread_movements;
drop policy if exists anon_insert on public.bread_movements;
drop policy if exists anon_update on public.bread_movements;
drop policy if exists anon_delete on public.bread_movements;

drop policy if exists anon_select on public.breads;
drop policy if exists anon_insert on public.breads;
drop policy if exists anon_update on public.breads;
drop policy if exists anon_delete on public.breads;

drop policy if exists anon_select on public.frozen_movements;
drop policy if exists anon_insert on public.frozen_movements;
drop policy if exists anon_update on public.frozen_movements;
drop policy if exists anon_delete on public.frozen_movements;

drop policy if exists anon_select on public.orders;
drop policy if exists anon_insert on public.orders;
drop policy if exists anon_update on public.orders;
drop policy if exists anon_delete on public.orders;

drop policy if exists anon_select on public.product_components;
drop policy if exists anon_insert on public.product_components;
drop policy if exists anon_update on public.product_components;
drop policy if exists anon_delete on public.product_components;

drop policy if exists anon_select on public.production_actuals;
drop policy if exists anon_insert on public.production_actuals;
drop policy if exists anon_update on public.production_actuals;
drop policy if exists anon_delete on public.production_actuals;

drop policy if exists anon_select on public.shelf_counts;
drop policy if exists anon_insert on public.shelf_counts;
drop policy if exists anon_update on public.shelf_counts;
drop policy if exists anon_delete on public.shelf_counts;

drop policy if exists bread_movements_insert_sobras_route
  on public.bread_movements;
create policy bread_movements_insert_sobras_route
on public.bread_movements
for insert
to authenticated
with check (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and coalesce(p.allowed_routes, '[]'::jsonb) ? '/sobras'
      and (
        p.role in ('admin', 'financeiro')
        or lower(p.store) = lower(public.bread_movements.location)
      )
  )
);

drop policy if exists bread_movements_delete_sobras_route
  on public.bread_movements;
create policy bread_movements_delete_sobras_route
on public.bread_movements
for delete
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and coalesce(p.allowed_routes, '[]'::jsonb) ? '/sobras'
      and (
        p.role in ('admin', 'financeiro')
        or lower(p.store) = lower(public.bread_movements.location)
      )
  )
);

drop policy if exists breads_insert_catalog_managers on public.breads;
create policy breads_insert_catalog_managers
on public.breads
for insert
to authenticated
with check (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro')
      and coalesce(p.allowed_routes, '[]'::jsonb) ? '/produtos'
  )
);

drop policy if exists breads_update_catalog_managers on public.breads;
create policy breads_update_catalog_managers
on public.breads
for update
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro')
      and coalesce(p.allowed_routes, '[]'::jsonb) ? '/produtos'
  )
)
with check (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro')
      and coalesce(p.allowed_routes, '[]'::jsonb) ? '/produtos'
  )
);

drop policy if exists breads_delete_catalog_managers on public.breads;
create policy breads_delete_catalog_managers
on public.breads
for delete
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro')
      and coalesce(p.allowed_routes, '[]'::jsonb) ? '/produtos'
  )
);

drop policy if exists frozen_movements_select_route_store
  on public.frozen_movements;
create policy frozen_movements_select_route_store
on public.frozen_movements
for select
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    join public.frozen_products fp
      on fp.id = public.frozen_movements.frozen_product_id
    where p.user_id = (select auth.uid())
      and p.active
      and coalesce(p.allowed_routes, '[]'::jsonb) ? '/estoque-congelado'
      and (
        p.role in ('admin', 'financeiro', 'producao', 'expedicao')
        or (
          lower(p.store) = lower(public.frozen_movements.location)
          and (
            (fp.store is null and fp.visible_stores is null)
            or lower(fp.store) = lower(p.store)
            or lower(p.store) = any(coalesce(fp.visible_stores, '{}'::text[]))
          )
        )
      )
  )
);

drop policy if exists frozen_movements_insert_route_store
  on public.frozen_movements;
create policy frozen_movements_insert_route_store
on public.frozen_movements
for insert
to authenticated
with check (
  exists (
    select 1
    from public.app_profiles p
    join public.frozen_products fp
      on fp.id = public.frozen_movements.frozen_product_id
    where p.user_id = (select auth.uid())
      and p.active
      and coalesce(p.allowed_routes, '[]'::jsonb) ? '/estoque-congelado'
      and (
        p.role in ('admin', 'financeiro', 'producao', 'expedicao')
        or (
          lower(p.store) = lower(public.frozen_movements.location)
          and (
            (fp.store is null and fp.visible_stores is null)
            or lower(fp.store) = lower(p.store)
            or lower(p.store) = any(coalesce(fp.visible_stores, '{}'::text[]))
          )
        )
      )
  )
);

drop policy if exists shelf_counts_select_route_store on public.shelf_counts;
create policy shelf_counts_select_route_store
on public.shelf_counts
for select
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and (
        coalesce(p.allowed_routes, '[]'::jsonb) ? '/sobras'
        or coalesce(p.allowed_routes, '[]'::jsonb) ? '/relatorios'
      )
      and (
        p.role in ('admin', 'financeiro')
        or lower(p.store) = lower(public.shelf_counts.store)
      )
  )
);

drop policy if exists shelf_counts_insert_route_store on public.shelf_counts;
create policy shelf_counts_insert_route_store
on public.shelf_counts
for insert
to authenticated
with check (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and coalesce(p.allowed_routes, '[]'::jsonb) ? '/sobras'
      and (
        p.role in ('admin', 'financeiro')
        or lower(p.store) = lower(public.shelf_counts.store)
      )
  )
);

drop policy if exists shelf_counts_update_route_store on public.shelf_counts;
create policy shelf_counts_update_route_store
on public.shelf_counts
for update
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and coalesce(p.allowed_routes, '[]'::jsonb) ? '/sobras'
      and (
        p.role in ('admin', 'financeiro')
        or lower(p.store) = lower(public.shelf_counts.store)
      )
  )
)
with check (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and coalesce(p.allowed_routes, '[]'::jsonb) ? '/sobras'
      and (
        p.role in ('admin', 'financeiro')
        or lower(p.store) = lower(public.shelf_counts.store)
      )
  )
);

create or replace function public.mark_bread_as_shelf(p_bread_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and coalesce(p.allowed_routes, '[]'::jsonb) ? '/sobras'
  ) then
    raise exception 'Perfil sem permissao para incluir pao na prateleira'
      using errcode = '42501';
  end if;

  update public.breads
  set is_shelf = true
  where id = p_bread_id;

  if not found then
    raise exception 'Pao nao encontrado'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.mark_bread_as_shelf(text) from public;
revoke all on function public.mark_bread_as_shelf(text) from anon;
revoke all on function public.mark_bread_as_shelf(text) from authenticated;
grant execute on function public.mark_bread_as_shelf(text) to authenticated;
grant execute on function public.mark_bread_as_shelf(text) to service_role;

comment on function public.mark_bread_as_shelf(text) is
  'Inclui um pao legado na contagem de prateleira sem liberar update amplo do catalogo.';

do $$
declare
  protected_table text;
begin
  foreach protected_table in array array[
    'bread_movements',
    'breads',
    'frozen_movements',
    'orders',
    'product_components',
    'production_actuals',
    'shelf_counts'
  ]
  loop
    if has_table_privilege(
      'anon',
      format('public.%I', protected_table),
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) then
      raise exception 'Hardening incompleto: anon ainda possui grant em public.%', protected_table;
    end if;

    if exists (
      select 1
      from pg_policies policy
      where policy.schemaname = 'public'
        and policy.tablename = protected_table
        and (
          'anon' = any(policy.roles)
          or 'public' = any(policy.roles)
        )
    ) then
      raise exception 'Hardening incompleto: policy publica ainda existe em public.%', protected_table;
    end if;
  end loop;
end;
$$;
