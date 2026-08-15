-- A reposicao da EX so vale dentro da data operacional do romaneio. O saldo
-- aberto representa o que ainda precisa sair em uma proxima viagem do dia.
-- Ao sair, a nova viagem consome esse saldo; no dia seguinte ele nao volta
-- para a separacao e e encerrado na proxima saida da EX.

alter table public.romaneio_replacement_pending
  drop constraint romaneio_replacement_pending_quantity_check,
  add constraint romaneio_replacement_pending_quantity_check check (pending_quantity >= 0);

comment on column public.romaneio_replacement_pending.pending_quantity is
  'Saldo ainda pendente de reposicao no mesmo dia operacional. Zero quando a reposicao saiu ou expirou.';

-- Nao transforma divergencia passada em divida para a proxima operacao.
-- A divergencia continua registrada no item de origem do romaneio.
update public.romaneio_replacement_pending pending
set
  pending_quantity = 0,
  status = 'cancelada',
  updated_at = now()
from public.romaneios source_romaneio
where source_romaneio.id = pending.source_romaneio_id
  and pending.status = 'aberta'
  and source_romaneio.record_date < (now() at time zone 'America/Sao_Paulo')::date;

create or replace function public.confirm_romaneio_departure(p_romaneio_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_status text;
  v_destination_code text;
  v_destination_id uuid;
  v_record_date date;
  v_trip_number integer;
  v_user_name text;
  v_movements_exist boolean;
  v_item record;
  v_pending record;
  v_remaining_quantity numeric;
  v_consumed_quantity numeric;
begin
  select
    romaneio.status,
    destination.code,
    romaneio.destination_id,
    romaneio.record_date,
    romaneio.trip_number
  into
    v_status,
    v_destination_code,
    v_destination_id,
    v_record_date,
    v_trip_number
  from public.romaneios romaneio
  join public.destinations destination on destination.id = romaneio.destination_id
  where romaneio.id = p_romaneio_id
  for update of romaneio;

  if not found then
    raise exception using errcode = 'P0002', message = 'Romaneio nao encontrado.';
  end if;

  if not (select private.current_user_has_permission('romaneio.confirmar_saida', v_destination_code)) then
    raise exception using errcode = '42501', message = 'Sem permissao para confirmar esta saida.';
  end if;

  if v_status <> 'separado' then
    raise exception using errcode = '22023', message = 'O romaneio nao esta separado.';
  end if;

  select profile.display_name
    into v_user_name
  from public.app_profiles profile
  where profile.user_id = (select auth.uid())
    and profile.active;

  if v_user_name is null then
    raise exception using errcode = '42501', message = 'Perfil inativo.';
  end if;

  select exists (
    select 1
    from public.bread_movements existing
    where existing.reference_id = p_romaneio_id::text
      and existing.reference_type in ('romaneio', 'romaneio_kit')
  ) into v_movements_exist;

  insert into public.bread_movements (
    movement_type,
    bread_id,
    location,
    quantity,
    reference_id,
    reference_type,
    recorded_by
  )
  select
    'romaneio_envio',
    item.product_id,
    movement.location,
    item.qty_sent * movement.factor,
    p_romaneio_id::text,
    'romaneio',
    v_user_name
  from public.romaneio_items item
  cross join lateral (values
    ('central'::text, -1::numeric),
    (lower(v_destination_code), 1::numeric)
  ) movement(location, factor)
  where item.romaneio_id = p_romaneio_id
    and item.product_source = 'bread'
    and item.qty_sent > 0
    and not v_movements_exist;

  insert into public.bread_movements (
    movement_type,
    bread_id,
    location,
    quantity,
    reference_id,
    reference_type,
    recorded_by
  )
  select
    'romaneio_envio',
    component.component_id,
    movement.location,
    item.qty_sent * component.quantity * movement.factor,
    p_romaneio_id::text,
    'romaneio_kit',
    v_user_name
  from public.romaneio_items item
  join public.products product
    on product.id::text = item.product_id
   and product.kind = 'kit'
  join public.product_components component
    on component.parent_product_id = product.id
   and component.component_source = 'bread'
  cross join lateral (values
    ('central'::text, -1::numeric),
    (lower(v_destination_code), 1::numeric)
  ) movement(location, factor)
  where item.romaneio_id = p_romaneio_id
    and item.product_source <> 'bread'
    and item.qty_sent > 0
    and not v_movements_exist;

  if lower(v_destination_code) = 'ex' then
    -- Saldos de dias passados nao acompanham uma nova data de romaneio.
    update public.romaneio_replacement_pending pending
    set
      pending_quantity = 0,
      status = 'cancelada',
      updated_at = now()
    from public.romaneios source_romaneio
    where source_romaneio.id = pending.source_romaneio_id
      and pending.destination_id = v_destination_id
      and pending.status = 'aberta'
      and source_romaneio.record_date < v_record_date;

    -- Cada pao que efetivamente sai na proxima viagem baixa, em ordem, as
    -- faltas abertas das viagens anteriores da mesma data.
    for v_item in
      select item.product_id, item.qty_sent
      from public.romaneio_items item
      where item.romaneio_id = p_romaneio_id
        and item.product_source = 'bread'
        and item.qty_sent > 0
    loop
      v_remaining_quantity := v_item.qty_sent;

      for v_pending in
        select pending.id, pending.pending_quantity
        from public.romaneio_replacement_pending pending
        join public.romaneios source_romaneio on source_romaneio.id = pending.source_romaneio_id
        where pending.destination_id = v_destination_id
          and pending.product_id = v_item.product_id
          and pending.product_source = 'bread'
          and pending.status = 'aberta'
          and source_romaneio.record_date = v_record_date
          and source_romaneio.trip_number < v_trip_number
        order by source_romaneio.trip_number, pending.created_at, pending.id
        for update of pending
      loop
        exit when v_remaining_quantity <= 0;

        v_consumed_quantity := least(v_remaining_quantity, v_pending.pending_quantity);

        update public.romaneio_replacement_pending pending
        set
          pending_quantity = pending.pending_quantity - v_consumed_quantity,
          status = case
            when pending.pending_quantity - v_consumed_quantity = 0 then 'baixada'
            else 'aberta'
          end,
          updated_at = now()
        where pending.id = v_pending.id;

        v_remaining_quantity := v_remaining_quantity - v_consumed_quantity;
      end loop;
    end loop;
  end if;

  update public.romaneios
  set
    status = 'enviado',
    sent_by = v_user_name,
    sent_at = now()
  where id = p_romaneio_id;
end;
$$;

revoke all on function public.confirm_romaneio_departure(uuid) from public;
revoke all on function public.confirm_romaneio_departure(uuid) from anon;
grant execute on function public.confirm_romaneio_departure(uuid) to authenticated;
grant execute on function public.confirm_romaneio_departure(uuid) to service_role;
