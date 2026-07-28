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
  v_expected_count integer := 0;
  v_payload_count integer := 0;
  v_distinct_payload_count integer := 0;
  v_invalid_count integer := 0;
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

  if p_items is null
    or jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = '22023', message = 'A conferencia precisa informar todos os itens do romaneio.';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'A conferencia precisa informar todos os itens do romaneio.';
  end if;

  select count(*)::integer
    into v_expected_count
  from public.romaneio_items item
  where item.romaneio_id = p_romaneio_id;

  if v_expected_count = 0 then
    raise exception using errcode = '22023', message = 'Romaneio sem itens para conferir.';
  end if;

  with payload as (
    select requested.id
    from jsonb_to_recordset(p_items) requested(
      id uuid,
      qty_received numeric,
      qty_accepted numeric,
      divergence_reason text,
      obs text
    )
  )
  select count(*)::integer, count(distinct id)::integer
    into v_payload_count, v_distinct_payload_count
  from payload;

  with payload as (
    select requested.id
    from jsonb_to_recordset(p_items) requested(
      id uuid,
      qty_received numeric,
      qty_accepted numeric,
      divergence_reason text,
      obs text
    )
  )
  select count(*)::integer
    into v_invalid_count
  from payload
  left join public.romaneio_items item
    on item.id = payload.id
   and item.romaneio_id = p_romaneio_id
  where payload.id is null
     or item.id is null;

  if v_invalid_count > 0 then
    raise exception using errcode = '22023', message = 'Item invalido para este romaneio.';
  end if;

  if v_payload_count <> v_distinct_payload_count then
    raise exception using errcode = '22023', message = 'A conferencia nao pode repetir item do romaneio.';
  end if;

  if v_payload_count <> v_expected_count then
    raise exception using errcode = '22023', message = 'Confira todos os itens antes de fechar o romaneio.';
  end if;

  with payload as (
    select requested.qty_received, requested.qty_accepted
    from jsonb_to_recordset(p_items) requested(
      id uuid,
      qty_received numeric,
      qty_accepted numeric,
      divergence_reason text,
      obs text
    )
  )
  select count(*)::integer
    into v_invalid_count
  from payload
  where qty_received is null
     or qty_accepted is null;

  if v_invalid_count > 0 then
    raise exception using errcode = '22023', message = 'Informe recebido e aceito para todos os itens.';
  end if;

  with payload as (
    select requested.qty_received, requested.qty_accepted
    from jsonb_to_recordset(p_items) requested(
      id uuid,
      qty_received numeric,
      qty_accepted numeric,
      divergence_reason text,
      obs text
    )
  )
  select count(*)::integer
    into v_invalid_count
  from payload
  where qty_received < 0
     or qty_accepted < 0;

  if v_invalid_count > 0 then
    raise exception using errcode = '22023', message = 'Quantidade recebida ou aceita nao pode ser negativa.';
  end if;

  with payload as (
    select requested.qty_received, requested.qty_accepted
    from jsonb_to_recordset(p_items) requested(
      id uuid,
      qty_received numeric,
      qty_accepted numeric,
      divergence_reason text,
      obs text
    )
  )
  select count(*)::integer
    into v_invalid_count
  from payload
  where qty_accepted > qty_received;

  if v_invalid_count > 0 then
    raise exception using errcode = '22023', message = 'Quantidade aceita nao pode ser maior que recebida.';
  end if;

  for v_item in
    select
      requested.id,
      requested.qty_received,
      requested.qty_accepted,
      requested.divergence_reason,
      requested.obs
    from jsonb_to_recordset(p_items) requested(
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
