create table public.romaneio_replacement_pending (
  id uuid primary key default gen_random_uuid(),
  destination_id uuid not null references public.destinations(id),
  source_romaneio_id uuid not null references public.romaneios(id) on delete cascade,
  source_item_id uuid not null references public.romaneio_items(id) on delete cascade,
  product_id text not null,
  product_source text not null,
  product_name text not null,
  pending_quantity numeric not null,
  status text not null default 'aberta',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint romaneio_replacement_pending_quantity_check check (pending_quantity > 0),
  constraint romaneio_replacement_pending_status_check check (status in ('aberta', 'baixada', 'cancelada')),
  constraint romaneio_replacement_pending_source_item_key unique (source_item_id)
);

comment on table public.romaneio_replacement_pending is
  'Pendencias de reposicao do Romaneio EX geradas por diferenca entre quantidade enviada e aceita.';
comment on column public.romaneio_replacement_pending.pending_quantity is
  'Quantidade ainda pendente de reposicao. Fase 1 apenas cria e exibe; baixa automatica entra em fase posterior.';

alter table public.romaneio_replacement_pending enable row level security;
alter table public.romaneio_replacement_pending force row level security;

create trigger set_romaneio_replacement_pending_updated_at
before update on public.romaneio_replacement_pending
for each row execute function public.set_app_profiles_updated_at();

revoke all on table public.romaneio_replacement_pending from public;
revoke all on table public.romaneio_replacement_pending from anon;
revoke all on table public.romaneio_replacement_pending from authenticated;
grant select on table public.romaneio_replacement_pending to authenticated;
grant all on table public.romaneio_replacement_pending to service_role;

create policy romaneio_replacement_pending_select_permission
on public.romaneio_replacement_pending
for select
to authenticated
using (
  exists (
    select 1
    from public.destinations destination
    where destination.id = romaneio_replacement_pending.destination_id
      and (
        private.current_user_has_permission('romaneio.visualizar', destination.code)
        or private.current_user_has_permission('romaneio.administrar', destination.code)
      )
  )
);

create or replace function public.confirm_romaneio_receipt(p_romaneio_id uuid, p_items jsonb)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_destination_code text;
  v_status text;
  v_user_name text;
  v_has_divergence boolean := false;
  v_item record;
begin
  select destination.code, romaneio.status
    into v_destination_code, v_status
  from public.romaneios romaneio
  join public.destinations destination on destination.id = romaneio.destination_id
  where romaneio.id = p_romaneio_id
  for update of romaneio;

  if not found then
    raise exception using errcode = 'P0002', message = 'Romaneio nao encontrado.';
  end if;

  if not (select private.current_user_has_permission('romaneio.conferir_recebimento', v_destination_code)) then
    raise exception using errcode = '42501', message = 'Sem permissao para conferir este recebimento.';
  end if;

  if v_status <> 'enviado' then
    raise exception using errcode = '22023', message = 'O romaneio ainda nao foi enviado ou ja foi conferido.';
  end if;

  select profile.display_name
    into v_user_name
  from public.app_profiles profile
  where profile.user_id = (select auth.uid())
    and profile.active;

  if v_user_name is null then
    raise exception using errcode = '42501', message = 'Perfil inativo.';
  end if;

  for v_item in
    select
      requested.id,
      requested.qty_received,
      requested.qty_accepted,
      requested.divergence_reason,
      requested.obs
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) requested(
      id uuid,
      qty_received numeric,
      qty_accepted numeric,
      divergence_reason text,
      obs text
    )
  loop
    update public.romaneio_items item
    set
      qty_received = v_item.qty_received,
      qty_accepted = v_item.qty_accepted,
      divergence_reason = nullif(v_item.divergence_reason, ''),
      obs = nullif(v_item.obs, ''),
      item_status = case
        when v_item.qty_received is distinct from item.qty_sent
          or v_item.qty_accepted is distinct from v_item.qty_received
          then 'divergencia'
        else 'ok'
      end
    where item.id = v_item.id
      and item.romaneio_id = p_romaneio_id;

    if not found then
      raise exception using errcode = '22023', message = 'Item invalido para este romaneio.';
    end if;
  end loop;

  if lower(v_destination_code) = 'ex' then
    insert into public.romaneio_replacement_pending (
      destination_id,
      source_romaneio_id,
      source_item_id,
      product_id,
      product_source,
      product_name,
      pending_quantity,
      status,
      created_by
    )
    select
      romaneio.destination_id,
      romaneio.id,
      item.id,
      item.product_id,
      item.product_source,
      item.product_name,
      item.qty_sent - item.qty_accepted,
      'aberta',
      v_user_name
    from public.romaneios romaneio
    join public.romaneio_items item on item.romaneio_id = romaneio.id
    where romaneio.id = p_romaneio_id
      and item.product_source = 'bread'
      and item.item_status = 'divergencia'
      and item.qty_accepted is not null
      and item.qty_sent - item.qty_accepted > 0
    on conflict (source_item_id) do update set
      pending_quantity = excluded.pending_quantity,
      status = 'aberta',
      updated_at = now();
  end if;

  select exists (
    select 1
    from public.romaneio_items item
    where item.romaneio_id = p_romaneio_id
      and item.item_status = 'divergencia'
  ) into v_has_divergence;

  update public.romaneios
  set
    status = case when v_has_divergence then 'com_divergencia' else 'conferido' end,
    confirmed_by = v_user_name,
    confirmed_at = now()
  where id = p_romaneio_id;

  return case when v_has_divergence then 'com_divergencia' else 'conferido' end;
end;
$$;

revoke all on function public.confirm_romaneio_receipt(uuid, jsonb) from public;
revoke all on function public.confirm_romaneio_receipt(uuid, jsonb) from anon;
grant execute on function public.confirm_romaneio_receipt(uuid, jsonb) to authenticated;
grant execute on function public.confirm_romaneio_receipt(uuid, jsonb) to service_role;
