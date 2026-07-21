alter table public.orders
  add column if not exists dispatched_at timestamptz,
  add column if not exists dispatched_by uuid references auth.users(id) on delete set null,
  add column if not exists dispatched_by_name text;

create index if not exists orders_pj_dispatch_queue_idx
on public.orders (order_type, dispatched_at, delivery_date)
where order_type = 'pj' and cancelled_at is null;

insert into public.app_permissions (key, module, label, description, sort_order)
values (
  'pedidos_pj.confirmar_envio',
  'Comercial',
  'Confirmar envio de Pedido PJ',
  'Marcar um Pedido PJ como enviado pela Expedicao da JC.',
  161
)
on conflict (key) do update
set module = excluded.module,
    label = excluded.label,
    description = excluded.description,
    sort_order = excluded.sort_order;

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
select profile.user_id, requested.permission_key, 'jc', null::uuid
from public.app_profiles profile
cross join (
  values
    ('pedidos_pj.acessar'::text),
    ('pedidos_pj.confirmar_envio'::text)
) requested(permission_key)
where profile.active
  and profile.role = 'expedicao'
  and profile.store = 'jc'
on conflict do nothing;

update public.app_profiles profile
set allowed_routes = coalesce(profile.allowed_routes, '[]'::jsonb) || '["/pedidos-pj"]'::jsonb
where profile.active
  and profile.role = 'expedicao'
  and profile.store = 'jc'
  and not coalesce(profile.allowed_routes, '[]'::jsonb) @> '["/pedidos-pj"]'::jsonb;

-- A Expedição lê os Pedidos PJ somente pela função operacional abaixo.
-- Assim, mesmo uma chamada direta à Data API não expõe unit_price.
drop policy if exists orders_select_authenticated_profiles on public.orders;
create policy orders_select_authenticated_profiles
on public.orders
for select
to authenticated
using (
  exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and (
        profile.role <> 'expedicao'
        or public.orders.order_type <> 'pj'
      )
  )
);

create or replace function private.guard_pj_dispatch_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('pane.pj_dispatch_rpc', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      if new.dispatched_at is not null
        or new.dispatched_by is not null
        or new.dispatched_by_name is not null
      then
        raise exception using
          errcode = '42501',
          message = 'A confirmacao de envio exige a acao protegida.';
      end if;
    elsif new.dispatched_at is distinct from old.dispatched_at
      or new.dispatched_by is distinct from old.dispatched_by
      or new.dispatched_by_name is distinct from old.dispatched_by_name
    then
      raise exception using
        errcode = '42501',
        message = 'A confirmacao de envio exige a acao protegida.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_pj_dispatch_write() from public, anon, authenticated;

drop trigger if exists guard_pj_dispatch_write on public.orders;
create trigger guard_pj_dispatch_write
before insert or update of dispatched_at, dispatched_by, dispatched_by_name
on public.orders
for each row execute function private.guard_pj_dispatch_write();

create or replace function private.guard_dispatched_pj_order_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.order_type = 'pj' and old.dispatched_at is not null
    and coalesce(current_setting('pane.pj_dispatch_rpc', true), '') <> 'on'
  then
    raise exception using
      errcode = '42501',
      message = 'Pedido enviado nao pode mais ser alterado ou excluido.';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.guard_dispatched_pj_order_changes() from public, anon, authenticated;

drop trigger if exists guard_dispatched_pj_order_changes on public.orders;
create trigger guard_dispatched_pj_order_changes
before update or delete on public.orders
for each row execute function private.guard_dispatched_pj_order_changes();

create or replace function public.list_pj_orders_for_dispatch()
returns table (
  id uuid,
  order_group_id uuid,
  customer_id uuid,
  customer_name text,
  order_date date,
  delivery_date date,
  production_date date,
  bread_id text,
  product_source text,
  product_name text,
  quantity numeric,
  pack_size numeric,
  pricing_unit text,
  sale_option_id uuid,
  obs text,
  cancelled_at timestamptz,
  dispatched_at timestamptz,
  dispatched_by uuid,
  dispatched_by_name text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and profile.role = 'expedicao'
      and profile.store = 'jc'
      and exists (
        select 1
        from public.app_user_permissions assignment
        where assignment.user_id = profile.user_id
          and assignment.permission_key = 'pedidos_pj.acessar'
          and assignment.scope in ('*', 'jc')
      )
  ) then
    raise exception using
      errcode = '42501',
      message = 'Sem permissao para consultar a fila de Pedidos PJ.';
  end if;

  return query
  select
    order_row.id,
    order_row.order_group_id,
    order_row.customer_id,
    coalesce(customer.name, order_row.pj_client, '?') as customer_name,
    order_row.order_date,
    order_row.delivery_date,
    order_row.production_date,
    order_row.bread_id,
    order_row.product_source,
    order_row.product_name,
    order_row.quantity,
    order_row.pack_size,
    order_row.pricing_unit,
    order_row.sale_option_id,
    order_row.obs,
    order_row.cancelled_at,
    order_row.dispatched_at,
    order_row.dispatched_by,
    order_row.dispatched_by_name
  from public.orders order_row
  left join public.customers customer on customer.id = order_row.customer_id
  where order_row.order_type = 'pj'
  order by order_row.order_date desc, order_row.order_group_id, order_row.id;
end;
$$;

revoke all on function public.list_pj_orders_for_dispatch() from public, anon, authenticated;
grant execute on function public.list_pj_orders_for_dispatch() to authenticated;

create or replace function public.confirm_pj_order_dispatch(p_order_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_user_name text;
  v_row_count integer;
  v_cancelled_count integer;
  v_dispatched_count integer;
  v_dispatched_at timestamptz;
  v_dispatched_by uuid;
  v_dispatched_by_name text;
begin
  if p_order_group_id is null then
    raise exception using errcode = '22023', message = 'Pedido obrigatorio.';
  end if;

  select profile.user_id, profile.display_name
  into v_user_id, v_user_name
  from public.app_profiles profile
  where profile.user_id = (select auth.uid())
    and profile.active
    and profile.role = 'expedicao'
    and profile.store = 'jc'
    and exists (
      select 1
      from public.app_user_permissions assignment
      where assignment.user_id = profile.user_id
        and assignment.permission_key = 'pedidos_pj.confirmar_envio'
        and assignment.scope in ('*', 'jc')
    );

  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Sem permissao para confirmar este envio.';
  end if;

  perform 1
  from public.orders order_row
  where order_row.order_group_id = p_order_group_id
    and order_row.order_type = 'pj'
  for update;

  select
    count(*),
    count(*) filter (where order_row.cancelled_at is not null),
    count(*) filter (where order_row.dispatched_at is not null)
  into v_row_count, v_cancelled_count, v_dispatched_count
  from public.orders order_row
  where order_row.order_group_id = p_order_group_id
    and order_row.order_type = 'pj';

  if v_row_count = 0 then
    raise exception using errcode = 'P0002', message = 'Pedido PJ nao encontrado.';
  end if;

  if v_cancelled_count > 0 then
    raise exception using errcode = '22023', message = 'Pedido cancelado nao pode ser enviado.';
  end if;

  if v_dispatched_count = v_row_count then
    select
      order_row.dispatched_at,
      order_row.dispatched_by,
      order_row.dispatched_by_name
    into v_dispatched_at, v_dispatched_by, v_dispatched_by_name
    from public.orders order_row
    where order_row.order_group_id = p_order_group_id
      and order_row.order_type = 'pj'
    order by order_row.id
    limit 1;

    return jsonb_build_object(
      'dispatched_at', v_dispatched_at,
      'dispatched_by', v_dispatched_by,
      'dispatched_by_name', v_dispatched_by_name,
      'already_dispatched', true
    );
  end if;

  if v_dispatched_count > 0 then
    raise exception using errcode = '22023', message = 'Pedido com confirmacao de envio incompleta.';
  end if;

  v_dispatched_at := now();
  perform set_config('pane.pj_dispatch_rpc', 'on', true);

  update public.orders order_row
  set dispatched_at = v_dispatched_at,
      dispatched_by = v_user_id,
      dispatched_by_name = v_user_name
  where order_row.order_group_id = p_order_group_id
    and order_row.order_type = 'pj'
    and order_row.cancelled_at is null
    and order_row.dispatched_at is null;

  return jsonb_build_object(
    'dispatched_at', v_dispatched_at,
    'dispatched_by', v_user_id,
    'dispatched_by_name', v_user_name,
    'already_dispatched', false
  );
end;
$$;

revoke all on function public.confirm_pj_order_dispatch(uuid) from public, anon, authenticated;
grant execute on function public.confirm_pj_order_dispatch(uuid) to authenticated;
