alter table public.product_components enable row level security;
alter table public.breads enable row level security;

grant select, insert, update, delete on table public.product_components to authenticated;
grant select on table public.breads to authenticated;

drop policy if exists product_components_select_internal on public.product_components;
drop policy if exists product_components_insert_internal on public.product_components;
drop policy if exists product_components_update_internal on public.product_components;
drop policy if exists product_components_delete_internal on public.product_components;
drop policy if exists breads_select_internal on public.breads;

create policy product_components_select_internal
on public.product_components
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

create policy product_components_insert_internal
on public.product_components
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

create policy product_components_update_internal
on public.product_components
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

create policy product_components_delete_internal
on public.product_components
for delete
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role in ('admin', 'financeiro', 'compras')
  )
);

create policy breads_select_internal
on public.breads
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

comment on policy product_components_select_internal
on public.product_components
is 'Usuarios internos autenticados podem ler os componentes das fichas tecnicas.';

comment on policy product_components_insert_internal
on public.product_components
is 'Apenas perfis autorizados podem criar componentes de ficha tecnica.';

comment on policy product_components_update_internal
on public.product_components
is 'Apenas perfis autorizados podem alterar componentes de ficha tecnica.';

comment on policy product_components_delete_internal
on public.product_components
is 'Apenas perfis autorizados podem remover componentes de ficha tecnica.';

comment on policy breads_select_internal
on public.breads
is 'Usuarios internos autenticados podem ler paes legados usados em composicoes.';
