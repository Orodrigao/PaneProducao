-- Ativacao controlada da jornada PJ. Um unico pedido real pode entrar nesta
-- primeira rodada; os pedidos restantes continuam integralmente no legado.
begin;

alter table private.pj_flow
  add column activation_mode text not null default 'test'
    check (activation_mode in ('test', 'controlled_real'));

-- Esta trava e deliberadamente temporaria: uma migration futura a remove
-- quando a primeira operacao real estiver acompanhada e aprovada.
create unique index pj_flow_single_controlled_real_idx
  on private.pj_flow(activation_mode)
  where activation_mode = 'controlled_real';

create table private.pj_flow_activation_events (
  request_id uuid primary key,
  order_group_id uuid not null,
  actor uuid not null references auth.users(id),
  action text not null check (action in ('enroll', 'rollback')),
  reason text,
  created_at timestamptz not null default clock_timestamp(),
  check ((action = 'rollback') = (reason is not null and length(trim(reason)) >= 3))
);
alter table private.pj_flow_activation_events enable row level security;
alter table private.pj_flow_activation_events force row level security;
revoke all on private.pj_flow_activation_events from public, anon, authenticated;

create function private.pj_flow_enrollment_permission() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.pj_flow_commercial()
    and private.pj_flow_permission('pedidos_pj.liberar')
    and private.pj_flow_permission('contas_receber.lancar');
$$;
revoke all on function private.pj_flow_enrollment_permission() from public, anon, authenticated;

create function public.read_pj_flow_enrollment_gate() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'can_enroll', private.pj_flow_enrollment_permission(),
    'slot_available', not exists (
      select 1 from private.pj_flow where activation_mode = 'controlled_real'
    )
  );
$$;
revoke all on function public.read_pj_flow_enrollment_gate() from public, anon, authenticated;
grant execute on function public.read_pj_flow_enrollment_gate() to authenticated;

create function public.read_pj_flow_activation_status(p_order_group_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_flow private.pj_flow%rowtype;
begin
  if not private.pj_flow_commercial() and not private.pj_flow_expedition() then
    raise exception using errcode = '42501', message = 'Sem permissão para consultar esta jornada PJ.';
  end if;
  select * into v_flow from private.pj_flow where order_group_id = p_order_group_id;
  if not found then
    return jsonb_build_object('mode', null, 'can_return', false);
  end if;
  return jsonb_build_object(
    'mode', v_flow.activation_mode,
    'can_return', v_flow.activation_mode = 'controlled_real'
      and private.pj_flow_enrollment_permission()
      and v_flow.version = 0
      and v_flow.checked_at is null
      and v_flow.released_at is null
      and v_flow.departed_at is null
      and not exists (select 1 from private.pj_flow_events where order_group_id = p_order_group_id)
      and not exists (select 1 from public.receivables where origin = 'pedido_pj' and origin_ref = p_order_group_id)
  );
end;
$$;
revoke all on function public.read_pj_flow_activation_status(uuid) from public, anon, authenticated;
grant execute on function public.read_pj_flow_activation_status(uuid) to authenticated;

create function public.enroll_pj_flow(
  p_request_id uuid, p_order_group_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_existing private.pj_flow_activation_events%rowtype;
  v_user uuid := auth.uid();
begin
  if p_request_id is null or p_order_group_id is null then
    raise exception using errcode = '22023', message = 'Pedido e identificador da tentativa são obrigatórios.';
  end if;
  if not private.pj_flow_enrollment_permission() then
    raise exception using errcode = '42501', message = 'Sem permissão para iniciar a nova jornada deste pedido.';
  end if;

  -- Uma trava comum serializa tanto dois cliques no mesmo pedido quanto a
  -- disputa entre dois pedidos pela unica vaga desta primeira rodada.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pane-pj-controlled-real-slot', 0));

  select * into v_existing from private.pj_flow_activation_events where request_id = p_request_id;
  if found then
    if v_existing.order_group_id <> p_order_group_id or v_existing.actor <> v_user
      or v_existing.action <> 'enroll' then
      raise exception using errcode = '22023', message = 'Identificador já usado para outra operação.';
    end if;
    return jsonb_build_object('repeated', true, 'enrolled', private.is_pj_flow(p_order_group_id));
  end if;

  perform 1 from public.orders where order_group_id = p_order_group_id order by id for update;
  if not found then
    raise exception using errcode = '22023', message = 'Pedido PJ não encontrado.';
  end if;
  if private.is_pj_flow(p_order_group_id) then
    raise exception using errcode = '22023', message = 'Este pedido já está na nova jornada.';
  end if;
  if exists (select 1 from private.pj_flow where activation_mode = 'controlled_real') then
    raise exception using errcode = '22023', message = 'A primeira operação real já está em acompanhamento. Não ative outro pedido ainda.';
  end if;
  if exists (
    select 1 from public.orders o where o.order_group_id = p_order_group_id
      and (o.order_type <> 'pj' or o.store <> 'pj' or o.cancelled_at is not null
        or o.dispatched_at is not null or o.dispatched_quantity is not null
        or o.dispatched_quantity_reason is not null or o.dispatched_quantity_at is not null
        or o.dispatched_quantity_by is not null or o.quantity <= 0
        or o.unit_price is null or o.unit_price <= 0)
  ) then
    raise exception using errcode = '22023', message = 'Escolha um pedido PJ aberto, ainda sem conferência ou cobrança, com quantidades e preços válidos.';
  end if;
  if (select count(distinct customer_id) from public.orders where order_group_id = p_order_group_id) <> 1
    or exists (select 1 from public.orders where order_group_id = p_order_group_id
      and (customer_id is null or delivery_date is null))
    or (select count(distinct delivery_date) from public.orders where order_group_id = p_order_group_id) <> 1
    or (select min(delivery_date) from public.orders where order_group_id = p_order_group_id) < private.data_na_padaria() then
    raise exception using errcode = '22023', message = 'O primeiro pedido precisa ter um único cliente e entrega combinada de hoje em diante.';
  end if;
  if not exists (
    select 1 from public.customers c
    where c.id = (select min(customer_id::text)::uuid from public.orders where order_group_id = p_order_group_id)
      and c.active and c.payment_term_days is not null
  ) then
    raise exception using errcode = '22023', message = 'Defina um cliente ativo e seu prazo antes de iniciar a nova jornada.';
  end if;
  if exists (select 1 from public.receivables where origin = 'pedido_pj' and origin_ref = p_order_group_id) then
    raise exception using errcode = '22023', message = 'Pedido que já passou pelo Contas a receber continua na rotina anterior.';
  end if;

  insert into private.pj_flow(order_group_id, activation_mode)
  values (p_order_group_id, 'controlled_real');
  insert into private.pj_flow_activation_events(request_id, order_group_id, actor, action)
  values (p_request_id, p_order_group_id, v_user, 'enroll');
  return jsonb_build_object('repeated', false, 'enrolled', true);
end;
$$;
revoke all on function public.enroll_pj_flow(uuid, uuid) from public, anon, authenticated;
grant execute on function public.enroll_pj_flow(uuid, uuid) to authenticated;

create function public.rollback_pj_flow_enrollment(
  p_request_id uuid, p_order_group_id uuid, p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_existing private.pj_flow_activation_events%rowtype;
  v_flow private.pj_flow%rowtype;
  v_user uuid := auth.uid();
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if p_request_id is null or p_order_group_id is null or length(coalesce(v_reason, '')) < 3 then
    raise exception using errcode = '22023', message = 'Pedido, identificador e motivo do retorno são obrigatórios.';
  end if;
  if not private.pj_flow_enrollment_permission() then
    raise exception using errcode = '42501', message = 'Sem permissão para devolver este pedido à rotina anterior.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pane-pj-controlled-real-slot', 0));
  select * into v_existing from private.pj_flow_activation_events where request_id = p_request_id;
  if found then
    if v_existing.order_group_id <> p_order_group_id or v_existing.actor <> v_user
      or v_existing.action <> 'rollback' or v_existing.reason is distinct from v_reason then
      raise exception using errcode = '22023', message = 'Identificador já usado para outra operação.';
    end if;
    return jsonb_build_object('repeated', true, 'returned', not private.is_pj_flow(p_order_group_id));
  end if;

  select * into v_flow from private.pj_flow where order_group_id = p_order_group_id for update;
  if not found or v_flow.activation_mode <> 'controlled_real' then
    raise exception using errcode = '22023', message = 'Este pedido não pertence à ativação real controlada.';
  end if;
  perform 1 from public.orders where order_group_id = p_order_group_id order by id for update;
  if v_flow.version <> 0 or v_flow.checked_at is not null or v_flow.released_at is not null
    or v_flow.departed_at is not null
    or exists (select 1 from private.pj_flow_events where order_group_id = p_order_group_id)
    or exists (select 1 from public.receivables where origin = 'pedido_pj' and origin_ref = p_order_group_id)
    or exists (select 1 from public.orders where order_group_id = p_order_group_id
      and (dispatched_quantity is not null or dispatched_quantity_reason is not null
        or dispatched_quantity_at is not null or dispatched_quantity_by is not null)) then
    raise exception using errcode = '22023', message = 'O pedido já começou a conferência ou movimentou dinheiro e não pode voltar à rotina anterior.';
  end if;

  delete from private.pj_flow where order_group_id = p_order_group_id;
  insert into private.pj_flow_activation_events(request_id, order_group_id, actor, action, reason)
  values (p_request_id, p_order_group_id, v_user, 'rollback', v_reason);
  return jsonb_build_object('repeated', false, 'returned', true);
end;
$$;
revoke all on function public.rollback_pj_flow_enrollment(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.rollback_pj_flow_enrollment(uuid, uuid, text) to authenticated;

commit;
