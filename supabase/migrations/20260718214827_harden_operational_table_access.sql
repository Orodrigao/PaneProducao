-- Hardening das tabelas operacionais ainda expostas ao papel anon.
-- Grants definem quais verbos chegam ao RLS; policies definem quais linhas passam.

alter table public.orders enable row level security;
alter table public.breads enable row level security;
alter table public.bread_movements enable row level security;
alter table public.frozen_movements enable row level security;
alter table public.shelf_counts enable row level security;
alter table public.product_components enable row level security;

revoke all on table public.orders from public, anon, authenticated;
revoke all on table public.breads from public, anon, authenticated;
revoke all on table public.bread_movements from public, anon, authenticated;
revoke all on table public.frozen_movements from public, anon, authenticated;
revoke all on table public.shelf_counts from public, anon, authenticated;
revoke all on table public.product_components from public, anon, authenticated;

grant select, insert, update, delete on table public.orders to authenticated;
grant select on table public.breads to authenticated;
grant select, insert, delete on table public.bread_movements to authenticated;
grant select, insert on table public.frozen_movements to authenticated;
grant select, insert, update on table public.shelf_counts to authenticated;
grant select, insert, update, delete on table public.product_components to authenticated;

grant all on table public.orders to service_role;
grant all on table public.breads to service_role;
grant all on table public.bread_movements to service_role;
grant all on table public.frozen_movements to service_role;
grant all on table public.shelf_counts to service_role;
grant all on table public.product_components to service_role;

drop policy if exists anon_select on public.orders;
drop policy if exists anon_insert on public.orders;
drop policy if exists anon_update on public.orders;
drop policy if exists anon_delete on public.orders;

drop policy if exists anon_select on public.breads;
drop policy if exists anon_insert on public.breads;
drop policy if exists anon_update on public.breads;
drop policy if exists anon_delete on public.breads;

drop policy if exists anon_select on public.bread_movements;
drop policy if exists anon_insert on public.bread_movements;
drop policy if exists anon_update on public.bread_movements;
drop policy if exists anon_delete on public.bread_movements;

drop policy if exists anon_select on public.frozen_movements;
drop policy if exists anon_insert on public.frozen_movements;
drop policy if exists anon_update on public.frozen_movements;
drop policy if exists anon_delete on public.frozen_movements;

drop policy if exists anon_select on public.shelf_counts;
drop policy if exists anon_insert on public.shelf_counts;
drop policy if exists anon_update on public.shelf_counts;
drop policy if exists anon_delete on public.shelf_counts;

drop policy if exists anon_select on public.product_components;
drop policy if exists anon_insert on public.product_components;
drop policy if exists anon_update on public.product_components;
drop policy if exists anon_delete on public.product_components;

-- O histórico de pães continua legível apenas para perfis internos ativos.
-- As únicas escritas diretas restantes são débitos originados de descartes
-- do próprio perfil e conferidos contra a linha de descarte correspondente.
drop policy if exists bread_movements_insert_discard_permission on public.bread_movements;
drop policy if exists bread_movements_delete_discard_permission on public.bread_movements;

create policy bread_movements_insert_discard_permission
on public.bread_movements
for insert
to authenticated
with check (
  movement_type = 'descarte_loja'
  and reference_type in ('descarte', 'descarte_kit')
  and quantity < 0
  and exists (
    select 1
    from public.app_profiles profile
    join public.descartes discard_row
      on discard_row.id::text = public.bread_movements.reference_id
    where profile.user_id = (select auth.uid())
      and profile.active
      and profile.store = public.bread_movements.location
      and profile.display_name = public.bread_movements.recorded_by
      and discard_row.responsible = profile.display_name
      and (select private.current_user_has_permission('sobras.acessar', profile.store))
      and (
        (
          public.bread_movements.reference_type = 'descarte'
          and discard_row.product_source = 'bread'
          and discard_row.product_id = public.bread_movements.bread_id
          and public.bread_movements.quantity = -discard_row.quantity
        )
        or (
          public.bread_movements.reference_type = 'descarte_kit'
          and discard_row.product_source = 'catalog'
          and exists (
            select 1
            from public.product_components component
            where component.parent_product_id::text = discard_row.product_id
              and component.component_source = 'bread'
              and component.component_id = public.bread_movements.bread_id
              and public.bread_movements.quantity = -(discard_row.quantity * component.quantity)
          )
        )
      )
  )
);

create policy bread_movements_delete_discard_permission
on public.bread_movements
for delete
to authenticated
using (
  movement_type = 'descarte_loja'
  and reference_type in ('descarte', 'descarte_kit')
  and quantity < 0
  and exists (
    select 1
    from public.app_profiles profile
    join public.descartes discard_row
      on discard_row.id::text = public.bread_movements.reference_id
    where profile.user_id = (select auth.uid())
      and profile.active
      and profile.store = public.bread_movements.location
      and profile.display_name = public.bread_movements.recorded_by
      and discard_row.responsible = profile.display_name
      and (select private.current_user_has_permission('sobras.acessar', profile.store))
      and (
        (
          public.bread_movements.reference_type = 'descarte'
          and discard_row.product_source = 'bread'
          and discard_row.product_id = public.bread_movements.bread_id
          and public.bread_movements.quantity = -discard_row.quantity
        )
        or (
          public.bread_movements.reference_type = 'descarte_kit'
          and discard_row.product_source = 'catalog'
          and exists (
            select 1
            from public.product_components component
            where component.parent_product_id::text = discard_row.product_id
              and component.component_source = 'bread'
              and component.component_id = public.bread_movements.bread_id
              and public.bread_movements.quantity = -(discard_row.quantity * component.quantity)
          )
        )
      )
  )
);

drop policy if exists frozen_movements_select_permission on public.frozen_movements;
drop policy if exists frozen_movements_insert_permission on public.frozen_movements;

create policy frozen_movements_select_permission
on public.frozen_movements
for select
to authenticated
using (
  exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and (
        select private.current_user_has_permission(
          'congelado.acessar',
          coalesce(lower(profile.store), '*')
        )
      )
  )
);

create policy frozen_movements_insert_permission
on public.frozen_movements
for insert
to authenticated
with check (
  previous_quantity >= 0
  and (
    (movement_type = 'inventario' and quantity >= 0)
    or (movement_type in ('entrada', 'saida') and quantity > 0)
  )
  and exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and responsible = profile.display_name
      and (
        select private.current_user_has_permission(
          'congelado.acessar',
          coalesce(lower(profile.store), '*')
        )
      )
  )
  and exists (
    select 1
    from public.frozen_products product
    where product.id = public.frozen_movements.frozen_product_id
  )
);

drop policy if exists shelf_counts_select_permission on public.shelf_counts;
drop policy if exists shelf_counts_insert_permission on public.shelf_counts;
drop policy if exists shelf_counts_update_permission on public.shelf_counts;

create policy shelf_counts_select_permission
on public.shelf_counts
for select
to authenticated
using (
  (select private.current_user_has_permission('sobras.acessar', store))
  or (select private.current_user_has_permission('relatorios.acessar', store))
);

create policy shelf_counts_insert_permission
on public.shelf_counts
for insert
to authenticated
with check (
  quantity >= 0
  and (select private.current_user_has_permission('sobras.acessar', store))
  and exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and counted_by = profile.display_name
  )
);

create policy shelf_counts_update_permission
on public.shelf_counts
for update
to authenticated
using ((select private.current_user_has_permission('sobras.acessar', store)))
with check (
  quantity >= 0
  and (select private.current_user_has_permission('sobras.acessar', store))
  and exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and counted_by = profile.display_name
  )
);
