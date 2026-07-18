-- A equipe de Jardim America confirma a saida da carga que segue para EX.
-- O perfil continua precisando estar ativo e ter a rota /romaneio.

drop policy if exists destinations_read_romaneio_scope
on public.destinations;

create policy destinations_read_romaneio_scope
on public.destinations
for select
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and coalesce(p.allowed_routes, '[]'::jsonb) ? '/romaneio'
      and (
        p.role in ('admin', 'financeiro', 'producao', 'expedicao')
        or lower(p.store) = lower(public.destinations.code)
        or (
          p.role = 'vendas'
          and lower(p.store) = 'ja'
          and lower(public.destinations.code) = 'ex'
        )
      )
  )
);

drop policy if exists romaneios_manage_route_store
on public.romaneios;

create policy romaneios_manage_route_store
on public.romaneios
for all
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and coalesce(p.allowed_routes, '[]'::jsonb) ? '/romaneio'
      and (
        p.role in ('admin', 'financeiro', 'producao', 'expedicao')
        or exists (
          select 1
          from public.destinations d
          where d.id = public.romaneios.destination_id
            and (
              lower(d.code) = lower(p.store)
              or (
                p.role = 'vendas'
                and lower(p.store) = 'ja'
                and lower(d.code) = 'ex'
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
      and coalesce(p.allowed_routes, '[]'::jsonb) ? '/romaneio'
      and (
        p.role in ('admin', 'financeiro', 'producao', 'expedicao')
        or exists (
          select 1
          from public.destinations d
          where d.id = public.romaneios.destination_id
            and (
              lower(d.code) = lower(p.store)
              or (
                p.role = 'vendas'
                and lower(p.store) = 'ja'
                and lower(d.code) = 'ex'
              )
            )
        )
      )
  )
);

drop policy if exists romaneio_items_manage_route_store
on public.romaneio_items;

create policy romaneio_items_manage_route_store
on public.romaneio_items
for all
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    join public.romaneios r on r.id = public.romaneio_items.romaneio_id
    join public.destinations d on d.id = r.destination_id
    where p.user_id = (select auth.uid())
      and p.active
      and coalesce(p.allowed_routes, '[]'::jsonb) ? '/romaneio'
      and (
        p.role in ('admin', 'financeiro', 'producao', 'expedicao')
        or lower(d.code) = lower(p.store)
        or (
          p.role = 'vendas'
          and lower(p.store) = 'ja'
          and lower(d.code) = 'ex'
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.app_profiles p
    join public.romaneios r on r.id = public.romaneio_items.romaneio_id
    join public.destinations d on d.id = r.destination_id
    where p.user_id = (select auth.uid())
      and p.active
      and coalesce(p.allowed_routes, '[]'::jsonb) ? '/romaneio'
      and (
        p.role in ('admin', 'financeiro', 'producao', 'expedicao')
        or lower(d.code) = lower(p.store)
        or (
          p.role = 'vendas'
          and lower(p.store) = 'ja'
          and lower(d.code) = 'ex'
        )
      )
  )
);
