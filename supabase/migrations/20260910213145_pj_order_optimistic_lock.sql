-- Impede que duas edicoes abertas sobre a mesma versao do pedido se
-- sobrescrevam. O contrato v1 permanece disponivel durante a publicacao
-- escalonada; a tela passa a usar somente o v2 antes da virada standard.
begin;

alter table private.pj_order_write_requests
  drop constraint pj_order_write_requests_action_check;
alter table private.pj_order_write_requests
  add constraint pj_order_write_requests_action_check
  check (action in ('create', 'replace', 'replace_v2', 'cancel'));

-- Os tres escritores abaixo ja eram atomicos, mas adquiriam as linhas em
-- ordens diferentes. Os wrappers preservam os contratos publicos e fazem um
-- pre-lock deterministico antes de entrar nas implementacoes existentes.
alter function public.save_pj_order_dispatch_quantities(uuid, uuid, jsonb, timestamptz)
  rename to save_pj_order_dispatch_quantities_lock_order_impl;
alter function public.save_pj_order_dispatch_quantities_lock_order_impl(uuid, uuid, jsonb, timestamptz)
  set schema private;
revoke all on function private.save_pj_order_dispatch_quantities_lock_order_impl(uuid, uuid, jsonb, timestamptz)
  from public, anon, authenticated, service_role;

create function public.save_pj_order_dispatch_quantities(
  p_request_id uuid,
  p_order_group_id uuid,
  p_items jsonb,
  p_expected_version timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador da conferência obrigatório.';
  end if;
  if p_order_group_id is null then
    raise exception using errcode = '22023', message = 'Pedido obrigatório.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = '22023', message = 'Nenhum item para conferir.';
  end if;
  if not exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = auth.uid()
      and profile.active
      and profile.role = 'expedicao'
      and profile.store = 'jc'
      and exists (
        select 1 from public.app_user_permissions assignment
        where assignment.user_id = profile.user_id
          and assignment.permission_key = 'pedidos_pj.confirmar_envio'
          and assignment.scope in ('*', 'jc')
      )
  ) then
    raise exception using errcode = '42501', message = 'Sem permissão para conferir este pedido.';
  end if;
  perform 1
  from public.orders order_row
  where order_row.order_group_id = p_order_group_id
    and order_row.order_type = 'pj'
  order by order_row.id
  for update;
  v_result := private.save_pj_order_dispatch_quantities_lock_order_impl(
    p_request_id, p_order_group_id, p_items, p_expected_version
  );
  return v_result;
end;
$$;

revoke all on function public.save_pj_order_dispatch_quantities(uuid, uuid, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.save_pj_order_dispatch_quantities(uuid, uuid, jsonb, timestamptz)
  to authenticated;

alter function public.confirm_pj_order_dispatch(uuid)
  rename to confirm_pj_order_dispatch_lock_order_impl;
alter function public.confirm_pj_order_dispatch_lock_order_impl(uuid)
  set schema private;
revoke all on function private.confirm_pj_order_dispatch_lock_order_impl(uuid)
  from public, anon, authenticated, service_role;

create function public.confirm_pj_order_dispatch(p_order_group_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if p_order_group_id is null then
    raise exception using errcode = '22023', message = 'Pedido obrigatorio.';
  end if;
  if not exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = auth.uid()
      and profile.active
      and profile.role = 'expedicao'
      and profile.store = 'jc'
      and exists (
        select 1 from public.app_user_permissions assignment
        where assignment.user_id = profile.user_id
          and assignment.permission_key = 'pedidos_pj.confirmar_envio'
          and assignment.scope in ('*', 'jc')
      )
  ) then
    raise exception using errcode = '42501', message = 'Sem permissao para confirmar este envio.';
  end if;
  perform 1
  from public.orders order_row
  where order_row.order_group_id = p_order_group_id
    and order_row.order_type = 'pj'
  order by order_row.id
  for update;
  v_result := private.confirm_pj_order_dispatch_lock_order_impl(p_order_group_id);
  return v_result;
end;
$$;

revoke all on function public.confirm_pj_order_dispatch(uuid)
  from public, anon, authenticated;
grant execute on function public.confirm_pj_order_dispatch(uuid)
  to authenticated;

alter function private.schedule_pj_production_contract_impl(date, jsonb, uuid)
  rename to schedule_pj_production_lock_order_impl;

create function private.schedule_pj_production_contract_impl(
  p_production_date date,
  p_items jsonb,
  p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not private.current_user_can_plan_pj_production() then
    raise exception using errcode = '42501', message = 'Usuario sem permissao para organizar a producao PJ.';
  end if;
  -- A implementacao antiga tambem trava saldos congelados por produto. Uma
  -- unica porta antes de qualquer linha impede duas listas em ordem inversa
  -- de formarem A->B/B->A nessas travas internas.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pane-pj-production-schedule', 0)
  );
  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    begin
      perform 1
      from public.orders order_row
      where order_row.id in (
        select (item.value->>'order_id')::uuid
        from jsonb_array_elements(p_items) item(value)
      )
      order by order_row.id
      for update;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'Item da programacao PJ invalido.';
    end;
  end if;
  v_result := private.schedule_pj_production_lock_order_impl(
    p_production_date, p_items, p_request_id
  );
  return v_result;
end;
$$;

revoke all on function private.schedule_pj_production_lock_order_impl(date, jsonb, uuid),
  private.schedule_pj_production_contract_impl(date, jsonb, uuid)
  from public, anon, authenticated, service_role;

create function public.replace_pj_order_atomic_v2(
  p_request_id uuid,
  p_order_group_id uuid,
  p_rows jsonb,
  p_expected_rows jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_existing private.pj_order_write_requests%rowtype;
  v_flow private.pj_flow%rowtype;
  v_item jsonb;
  v_payload jsonb;
  v_result jsonb;
  v_count integer;
  v_expected_count integer;
  v_unique_count integer;
  v_flow_enabled boolean := false;
begin
  perform private.assert_pj_order_write_access();
  if p_request_id is null or p_order_group_id is null then
    raise exception using errcode = '22023',
      message = 'Pedido e identificador da tentativa sao obrigatorios.';
  end if;

  v_payload := jsonb_build_object('rows', p_rows, 'expected_rows', p_expected_rows);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pane-pj-write:' || p_request_id::text, 0)
  );
  select * into v_existing
  from private.pj_order_write_requests
  where request_id = p_request_id;
  if found then
    if v_existing.actor <> auth.uid() or v_existing.action <> 'replace_v2'
      or v_existing.order_group_id <> p_order_group_id
      or v_existing.request_payload is distinct from v_payload then
      raise exception using errcode = '22023',
        message = 'Identificador ja usado para outra operacao.';
    end if;
    return v_existing.result || jsonb_build_object('repeated', true);
  end if;

  if jsonb_typeof(p_expected_rows) <> 'array'
    or jsonb_array_length(p_expected_rows) < 1
    or jsonb_array_length(p_expected_rows) > 100 then
    raise exception using errcode = '22023',
      message = 'A versao anterior do pedido e obrigatoria.';
  end if;
  v_expected_count := jsonb_array_length(p_expected_rows);
  for v_item in select value from jsonb_array_elements(p_expected_rows)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or not (v_item ? 'id') or not (v_item ? 'updated_at')
      or nullif(v_item->>'id', '') is null
      or (v_item - array['id', 'updated_at']) <> '{}'::jsonb then
      raise exception using errcode = '22023',
        message = 'A versao anterior do pedido e invalida.';
    end if;
    begin
      perform (v_item->>'id')::uuid;
      perform (v_item->>'updated_at')::timestamptz;
    exception when others then
      raise exception using errcode = '22023',
        message = 'A versao anterior do pedido e invalida.';
    end;
  end loop;
  select count(distinct value->>'id')
  into v_unique_count
  from jsonb_array_elements(p_expected_rows);
  if v_unique_count <> v_expected_count then
    raise exception using errcode = '22023',
      message = 'A versao anterior do pedido e invalida.';
  end if;

  -- Mantem a ordem de travas dos demais contratos: fluxo antes das linhas.
  select * into v_flow
  from private.pj_flow
  where order_group_id = p_order_group_id
  for update;
  v_flow_enabled := found;
  if v_flow_enabled and not private.pj_flow_commercial() then
    raise exception using errcode = '42501',
      message = 'Sem permissao para alterar este pedido da nova jornada PJ.';
  end if;
  if v_flow_enabled and (
    v_flow.version <> 0
    or v_flow.checked_at is not null
    or v_flow.released_at is not null
    or v_flow.departed_at is not null
    or exists (
      select 1 from private.pj_flow_events
      where order_group_id = p_order_group_id
    )
  ) then
    raise exception using errcode = '22023',
      message = 'Pedido que ja iniciou a conferencia nao pode ser alterado aqui.';
  end if;

  perform 1
  from public.orders
  where order_group_id = p_order_group_id
  order by id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Pedido PJ nao encontrado.';
  end if;
  if exists (
    select 1 from public.orders
    where order_group_id = p_order_group_id and order_type <> 'pj'
  ) then
    raise exception using errcode = '22023',
      message = 'O grupo informado nao e um Pedido PJ valido.';
  end if;
  if exists (
    select 1 from public.orders
    where order_group_id = p_order_group_id
      and (
        cancelled_at is not null
        or dispatched_at is not null
        or production_date is not null
        or dispatched_quantity is not null
        or dispatched_quantity_reason is not null
        or dispatched_quantity_at is not null
        or dispatched_quantity_by is not null
        or dispatched_quantity_by_name is not null
      )
  ) or exists (
    select 1
    from public.pj_order_quantity_checks q
    join public.orders o on o.id = q.order_id
    where o.order_group_id = p_order_group_id
  ) or exists (
    select 1
    from public.pj_production_schedules s
    join public.orders o on o.id = s.order_id
    where o.order_group_id = p_order_group_id
  ) or exists (
    select 1 from public.receivables
    where origin = 'pedido_pj' and origin_ref = p_order_group_id
  ) then
    raise exception using errcode = '22023',
      message = 'Pedido que ja entrou na operacao ou no financeiro nao pode ser alterado.';
  end if;

  select count(*) into v_count
  from public.orders
  where order_group_id = p_order_group_id;
  if v_count <> v_expected_count or exists (
    select 1
    from public.orders o
    where o.order_group_id = p_order_group_id
      and not exists (
        select 1
        from jsonb_array_elements(p_expected_rows) expected(value)
        where (expected.value->>'id')::uuid = o.id
          and ((expected.value->>'updated_at')::timestamptz is not distinct from o.updated_at)
      )
  ) then
    raise exception using errcode = '40001',
      message = 'Pedido mudou; recarregue antes de salvar novamente.';
  end if;

  perform private.assert_pj_order_payload(p_order_group_id, p_rows, false);
  perform set_config('pane.pj_order_write', p_order_group_id::text, true);
  delete from public.orders where order_group_id = p_order_group_id;
  v_count := private.insert_pj_order_rows(p_order_group_id, p_rows);
  perform set_config('pane.pj_order_write', '', true);

  v_result := jsonb_build_object(
    'repeated', false,
    'order_group_id', p_order_group_id,
    'row_count', v_count,
    'flow_enabled', v_flow_enabled
  );
  insert into private.pj_order_write_requests(
    request_id, actor, action, order_group_id, request_payload, result
  ) values (
    p_request_id, auth.uid(), 'replace_v2', p_order_group_id, v_payload, v_result
  );
  return v_result;
end;
$$;

revoke all on function public.replace_pj_order_atomic_v2(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_pj_order_atomic_v2(uuid, uuid, jsonb, jsonb)
  to authenticated;

commit;
