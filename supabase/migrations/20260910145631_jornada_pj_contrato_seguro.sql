-- Contratos de escrita para a futura jornada padrao de Pedidos PJ.
-- A migration instala as portas seguras, mas mantem o corte DESLIGADO:
-- enquanto o estado for "preparing", pedidos novos continuam legados.
begin;

alter table private.pj_flow
  drop constraint if exists pj_flow_activation_mode_check;
alter table private.pj_flow
  add constraint pj_flow_activation_mode_check
  check (activation_mode in ('test', 'controlled_real', 'standard'));

create table private.pj_flow_rollout_settings (
  singleton boolean primary key default true check (singleton),
  state text not null default 'preparing' check (state in ('preparing', 'standard', 'paused')),
  cutover_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  check ((state = 'preparing' and cutover_at is null) or (state <> 'preparing' and cutover_at is not null))
);
insert into private.pj_flow_rollout_settings(singleton, state) values (true, 'preparing');
alter table private.pj_flow_rollout_settings enable row level security;
alter table private.pj_flow_rollout_settings force row level security;
revoke all on private.pj_flow_rollout_settings from public, anon, authenticated;

create table private.pj_order_write_requests (
  request_id uuid primary key,
  actor uuid not null references auth.users(id),
  action text not null check (action in ('create', 'replace', 'cancel')),
  order_group_id uuid not null,
  request_payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index pj_order_write_requests_group_idx
  on private.pj_order_write_requests(order_group_id, created_at);
alter table private.pj_order_write_requests enable row level security;
alter table private.pj_order_write_requests force row level security;
revoke all on private.pj_order_write_requests from public, anon, authenticated;

-- Um pedido standard cancelado sai da fila viva, mas conserva sua identidade
-- protegida no historico de escrita para nao reabrir a leitura legada.
create or replace function private.is_pj_flow(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.pj_flow where order_group_id = p_group)
    or exists (select 1 from private.pj_order_write_requests
      where order_group_id = p_group and action = 'cancel'
        and coalesce((result->>'flow_enabled')::boolean, false));
$$;
revoke all on function private.is_pj_flow(uuid) from public, anon, authenticated;
grant execute on function private.is_pj_flow(uuid) to authenticated;

create function private.pj_flow_rollout_state() returns text
language sql stable security definer set search_path = '' as $$
  select state from private.pj_flow_rollout_settings where singleton;
$$;
revoke all on function private.pj_flow_rollout_state() from public, anon, authenticated;

create function private.assert_pj_order_write_access() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.app_profiles p
    where p.user_id = auth.uid() and p.active and p.role in ('admin', 'financeiro')
  ) then
    raise exception using errcode = '42501', message = 'Sem permissao para criar, alterar ou cancelar Pedidos PJ.';
  end if;
end;
$$;
revoke all on function private.assert_pj_order_write_access() from public, anon, authenticated;

create function private.assert_pj_order_payload(
  p_order_group_id uuid,
  p_rows jsonb,
  p_creating boolean
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_customer uuid;
  v_first_customer uuid;
  v_delivery date;
  v_first_delivery date;
  v_order_date date;
  v_first_order_date date;
  v_source text;
  v_product_id text;
  v_quantity numeric;
  v_unit_price numeric;
  v_pack_size numeric;
  v_pricing_unit text;
  v_sale_option uuid;
  v_expected_price numeric;
  v_expected_pack numeric;
  v_expected_unit text;
begin
  if p_order_group_id is null or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 100 then
    raise exception using errcode = '22023', message = 'Pedido e lista de 1 a 100 produtos sao obrigatorios.';
  end if;

  for v_item in select value from jsonb_array_elements(p_rows)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or (v_item - array['store','order_type','order_group_id','bread_id','product_source',
        'product_name','quantity','unit_price','pack_size','pricing_unit','sale_option_id',
        'customer_id','pj_client','order_date','delivery_date','production_date',
        'pj_delivery_date','obs','needs_production']) <> '{}'::jsonb then
      raise exception using errcode = '22023', message = 'O pedido contem campos desconhecidos.';
    end if;

    begin
      v_customer := (v_item->>'customer_id')::uuid;
      v_delivery := (v_item->>'delivery_date')::date;
      v_order_date := (v_item->>'order_date')::date;
      v_source := v_item->>'product_source';
      v_product_id := nullif(trim(v_item->>'bread_id'), '');
      v_quantity := (v_item->>'quantity')::numeric;
      v_unit_price := (v_item->>'unit_price')::numeric;
      v_pack_size := (v_item->>'pack_size')::numeric;
      v_pricing_unit := v_item->>'pricing_unit';
      v_sale_option := nullif(v_item->>'sale_option_id', '')::uuid;
    exception when others then
      raise exception using errcode = '22023', message = 'Um produto do pedido possui valor invalido.';
    end;

    if coalesce(v_item->>'store', 'pj') <> 'pj'
      or coalesce(v_item->>'order_type', 'pj') <> 'pj'
      or (v_item ? 'order_group_id' and (v_item->>'order_group_id')::uuid <> p_order_group_id)
      or nullif(trim(coalesce(v_item->>'product_name', '')), '') is null
      or nullif(trim(coalesce(v_item->>'pj_client', '')), '') is null
      or v_source is null or v_source not in ('bread', 'product')
      or v_product_id is null
      or v_quantity is null or v_quantity <= 0 or v_quantity > 1000000 or scale(v_quantity) > 3
      or v_unit_price is null or v_unit_price <= 0 or v_unit_price > 1000000 or scale(v_unit_price) > 2
      or v_pack_size is null or v_pack_size <= 0 or v_pack_size > 1000000 or scale(v_pack_size) > 3
      or v_pricing_unit is null or v_pricing_unit not in ('un', 'kg')
      or v_customer is null or v_delivery is null or v_order_date is null
      or (v_item ? 'production_date' and v_item->>'production_date' is not null)
      or (v_item ? 'needs_production' and coalesce((v_item->>'needs_production')::boolean, false)) then
      raise exception using errcode = '22023', message = 'Revise cliente, datas, produto, quantidade e preco do pedido.';
    end if;

    if v_item ? 'pj_delivery_date'
      and (v_item->>'pj_delivery_date')::date is distinct from v_delivery then
      raise exception using errcode = '22023', message = 'As datas de entrega do pedido nao conferem.';
    end if;
    if v_source = 'bread' and not exists (
      select 1 from public.breads b where b.id = v_product_id and b.active
    ) then
      raise exception using errcode = '22023', message = 'Um produto do pedido nao esta ativo no catalogo.';
    end if;
    if v_source = 'product' and not exists (
      select 1 from public.products p where p.id::text = v_product_id and p.active
    ) then
      raise exception using errcode = '22023', message = 'Um produto do pedido nao esta ativo no catalogo.';
    end if;
    if v_sale_option is not null and (v_source <> 'product' or not exists (
      select 1 from public.product_sale_options s
      where s.id = v_sale_option and s.active and s.product_id::text = v_product_id
        and s.sale_unit = v_pricing_unit
    )) then
      raise exception using errcode = '22023', message = 'A opcao de venda escolhida nao esta ativa.';
    end if;

    select o.unit_price, o.pack_size, o.pricing_unit
    into v_expected_price, v_expected_pack, v_expected_unit
    from public.customer_price_overrides o
    where o.customer_id=v_customer and o.product_id=v_product_id
      and o.product_source=v_source and o.sale_option_id is not distinct from v_sale_option
      and o.active;
    if not found then
      select round(i.unit_price * (1 - c.discount_pct / 100), 2), i.pack_size, i.pricing_unit
      into v_expected_price, v_expected_pack, v_expected_unit
      from public.customers c
      join public.price_tier_items i on i.tier_id=c.default_tier_id
      where c.id=v_customer and i.product_id=v_product_id and i.product_source=v_source
        and i.sale_option_id is not distinct from v_sale_option and i.active;
    end if;
    if not found or v_unit_price <> v_expected_price or v_pack_size <> v_expected_pack
      or v_pricing_unit <> v_expected_unit then
      raise exception using errcode = '22023',
        message = 'O preco ou a forma de venda mudou. Reabra o pedido para usar o catalogo atual.';
    end if;

    if v_first_customer is null then
      v_first_customer := v_customer;
      v_first_delivery := v_delivery;
      v_first_order_date := v_order_date;
    elsif v_customer <> v_first_customer or v_delivery <> v_first_delivery
      or v_order_date <> v_first_order_date then
      raise exception using errcode = '22023', message = 'Todas as linhas precisam pertencer ao mesmo cliente e as mesmas datas.';
    end if;
  end loop;

  if not exists (select 1 from public.customers c where c.id = v_first_customer and c.active) then
    raise exception using errcode = '22023', message = 'Escolha um cliente ativo.';
  end if;
  if p_creating and v_first_delivery < private.data_na_padaria() then
    raise exception using errcode = '22023', message = 'A entrega de um pedido novo nao pode ficar no passado.';
  end if;
end;
$$;
revoke all on function private.assert_pj_order_payload(uuid, jsonb, boolean) from public, anon, authenticated;

create function private.insert_pj_order_rows(p_order_group_id uuid, p_rows jsonb) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare v_count integer;
begin
  insert into public.orders(
    store, order_type, order_group_id, bread_id, product_source, product_name,
    quantity, unit_price, pack_size, pricing_unit, sale_option_id, customer_id,
    pj_client, order_date, delivery_date, production_date, pj_delivery_date, obs,
    needs_production
  )
  select 'pj', 'pj', p_order_group_id, x.bread_id, x.product_source,
    case when x.product_source='bread'
      then (select b.name from public.breads b where b.id=x.bread_id)
      else (select p.name from public.products p where p.id::text=x.bread_id) end,
    x.quantity, x.unit_price, x.pack_size, x.pricing_unit, x.sale_option_id,
    x.customer_id, (select c.name from public.customers c where c.id=x.customer_id),
    x.order_date, x.delivery_date, null,
    x.delivery_date, nullif(trim(coalesce(x.obs, '')), ''), false
  from jsonb_to_recordset(p_rows) as x(
    bread_id text, product_source text, product_name text, quantity numeric,
    unit_price numeric, pack_size numeric, pricing_unit text, sale_option_id uuid,
    customer_id uuid, pj_client text, order_date date, delivery_date date, obs text
  );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function private.insert_pj_order_rows(uuid, jsonb) from public, anon, authenticated;

-- A programacao ja era atomica e idempotente. O invólucro apenas entrega ao
-- gatilho do novo fluxo uma prova interna de que production_date veio dela.
alter function public.schedule_pj_production(date, jsonb, uuid)
  rename to schedule_pj_production_contract_impl;
alter function public.schedule_pj_production_contract_impl(date, jsonb, uuid)
  set schema private;
revoke all on function private.schedule_pj_production_contract_impl(date, jsonb, uuid)
  from public, anon, authenticated;

create function public.schedule_pj_production(
  p_production_date date,
  p_items jsonb,
  p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform set_config('pane.pj_production_rpc', 'on', true);
  v_result := private.schedule_pj_production_contract_impl(
    p_production_date, p_items, p_request_id
  );
  perform set_config('pane.pj_production_rpc', '', true);
  return v_result;
end;
$$;
revoke all on function public.schedule_pj_production(date, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.schedule_pj_production(date, jsonb, uuid)
  to authenticated, service_role;

-- O desvio existe somente para os tres contratos abaixo. Depois da ativacao,
-- uma tela antiga autenticada nao consegue gravar diretamente na tabela.
create function private.guard_pj_standard_order_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_group uuid := case when tg_op = 'DELETE' then old.order_group_id else new.order_group_id end;
  v_is_pj boolean := case when tg_op = 'DELETE' then old.order_type = 'pj' else new.order_type = 'pj' end;
  v_allowed text := coalesce(current_setting('pane.pj_order_write', true), '');
begin
  -- A mesma trava usada pela migration de ativacao fecha a janela em que
  -- uma tela antiga poderia confirmar um INSERT depois do corte.
  if tg_op = 'INSERT' and new.order_type = 'pj' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('pane-pj-standard-cutover', 0)
    );
  end if;
  if auth.uid() is not null and private.pj_flow_rollout_state() <> 'preparing'
    and (v_is_pj or (tg_op = 'UPDATE' and old.order_type = 'pj')) then
    if v_group is null or v_allowed <> v_group::text
      or (tg_op = 'UPDATE' and old.order_group_id is distinct from new.order_group_id) then
      raise exception using errcode = '42501',
        message = 'Pedidos PJ agora sao gravados pela nova rotina. Recarregue a pagina.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger aaa_guard_pj_standard_order_insert_delete
before insert or delete on public.orders
for each row execute function private.guard_pj_standard_order_write();
create trigger aaa_guard_pj_standard_order_commercial_update
before update of store, order_type, order_group_id, bread_id, product_source, product_name, quantity,
  unit_price, pack_size, pricing_unit, sale_option_id, customer_id, pj_client,
  order_date, delivery_date, pj_delivery_date, obs, cancelled_at, cancelled_by,
  cancel_reason
on public.orders
for each row execute function private.guard_pj_standard_order_write();
revoke all on function private.guard_pj_standard_order_write() from public, anon, authenticated;

-- Mantem as protecoes do piloto e abre apenas o corredor atomico acima.
create or replace function private.guard_pj_flow_order() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_group uuid := case when tg_op = 'DELETE' then old.order_group_id else new.order_group_id end;
begin
  if (tg_op <> 'INSERT' and private.is_pj_flow(old.order_group_id))
     or (tg_op <> 'DELETE' and private.is_pj_flow(new.order_group_id)) then
    if coalesce(current_setting('pane.pj_order_write', true), '') = coalesce(v_group::text, '') then
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end if;
    if tg_op = 'UPDATE'
      and coalesce(current_setting('pane.pj_production_rpc', true), '') = 'on'
      and (to_jsonb(new) - array['production_date','updated_at'])
        is not distinct from (to_jsonb(old) - array['production_date','updated_at']) then
      return new;
    end if;
    if tg_op <> 'UPDATE'
       or coalesce(current_setting('pane.pj_flow_check', true), '') <> new.order_group_id::text
       or (to_jsonb(new) - array['dispatched_quantity','dispatched_quantity_reason',
         'dispatched_quantity_at','dispatched_quantity_by','dispatched_quantity_by_name'])
          is distinct from
          (to_jsonb(old) - array['dispatched_quantity','dispatched_quantity_reason',
         'dispatched_quantity_at','dispatched_quantity_by','dispatched_quantity_by_name']) then
      raise exception using errcode='42501', message='Pedido do novo fluxo: use a conferencia, revisao e saida da nova jornada.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create function public.create_pj_order_atomic(
  p_request_id uuid,
  p_order_group_id uuid,
  p_rows jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_existing private.pj_order_write_requests%rowtype;
  v_state text;
  v_result jsonb;
  v_count integer;
begin
  perform private.assert_pj_order_write_access();
  if p_request_id is null or p_order_group_id is null then
    raise exception using errcode = '22023', message = 'Pedido e identificador da tentativa sao obrigatorios.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pane-pj-standard-cutover', 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pane-pj-write:' || p_request_id::text, 0));

  select * into v_existing from private.pj_order_write_requests where request_id = p_request_id;
  if found then
    if v_existing.actor <> auth.uid() or v_existing.action <> 'create'
      or v_existing.order_group_id <> p_order_group_id
      or v_existing.request_payload is distinct from p_rows then
      raise exception using errcode = '22023', message = 'Identificador ja usado para outra operacao.';
    end if;
    return v_existing.result || jsonb_build_object('repeated', true);
  end if;

  v_state := private.pj_flow_rollout_state();
  if v_state = 'paused' then
    raise exception using errcode = '55000', message = 'A criacao de Pedidos PJ esta temporariamente pausada.';
  end if;
  if v_state = 'standard' and not private.pj_flow_commercial() then
    raise exception using errcode = '42501',
      message = 'Sem permissao para criar um pedido na nova jornada PJ.';
  end if;
  if exists (select 1 from public.orders where order_group_id = p_order_group_id)
    or exists (select 1 from private.pj_flow where order_group_id = p_order_group_id) then
    raise exception using errcode = '22023', message = 'Este identificador de pedido ja existe.';
  end if;
  perform private.assert_pj_order_payload(p_order_group_id, p_rows, true);
  if v_state = 'standard' and not exists (
    select 1 from public.customers c
    where c.id = (p_rows->0->>'customer_id')::uuid and c.payment_term_days is not null
  ) then
    raise exception using errcode = '22023', message = 'Defina o prazo de pagamento do cliente antes de criar o pedido.';
  end if;

  perform set_config('pane.pj_order_write', p_order_group_id::text, true);
  v_count := private.insert_pj_order_rows(p_order_group_id, p_rows);
  if v_state = 'standard' then
    insert into private.pj_flow(order_group_id, activation_mode)
    values (p_order_group_id, 'standard');
  end if;
  perform set_config('pane.pj_order_write', '', true);

  v_result := jsonb_build_object(
    'repeated', false,
    'order_group_id', p_order_group_id,
    'row_count', v_count,
    'flow_enabled', v_state = 'standard'
  );
  insert into private.pj_order_write_requests(request_id, actor, action, order_group_id, request_payload, result)
  values (p_request_id, auth.uid(), 'create', p_order_group_id, p_rows, v_result);
  return v_result;
end;
$$;

create function public.replace_pj_order_atomic(
  p_request_id uuid,
  p_order_group_id uuid,
  p_rows jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_existing private.pj_order_write_requests%rowtype;
  v_flow private.pj_flow%rowtype;
  v_result jsonb;
  v_count integer;
  v_flow_enabled boolean := false;
begin
  perform private.assert_pj_order_write_access();
  if p_request_id is null or p_order_group_id is null then
    raise exception using errcode = '22023', message = 'Pedido e identificador da tentativa sao obrigatorios.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pane-pj-write:' || p_request_id::text, 0));
  select * into v_existing from private.pj_order_write_requests where request_id = p_request_id;
  if found then
    if v_existing.actor <> auth.uid() or v_existing.action <> 'replace'
      or v_existing.order_group_id <> p_order_group_id
      or v_existing.request_payload is distinct from p_rows then
      raise exception using errcode = '22023', message = 'Identificador ja usado para outra operacao.';
    end if;
    return v_existing.result || jsonb_build_object('repeated', true);
  end if;

  -- Mesma ordem da jornada operacional: primeiro o fluxo, depois as linhas.
  select * into v_flow from private.pj_flow where order_group_id = p_order_group_id for update;
  v_flow_enabled := found;
  if v_flow_enabled and not private.pj_flow_commercial() then
    raise exception using errcode = '42501', message = 'Sem permissao para alterar este pedido da nova jornada PJ.';
  end if;
  if v_flow_enabled and (v_flow.version <> 0 or v_flow.checked_at is not null or v_flow.released_at is not null
      or v_flow.departed_at is not null
      or exists (select 1 from private.pj_flow_events where order_group_id=p_order_group_id)) then
    raise exception using errcode = '22023', message = 'Pedido que ja iniciou a conferencia nao pode ser alterado aqui.';
  end if;
  perform 1 from public.orders where order_group_id = p_order_group_id order by id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Pedido PJ nao encontrado.';
  end if;
  if exists (select 1 from public.orders where order_group_id = p_order_group_id and order_type <> 'pj') then
    raise exception using errcode = '22023', message = 'O grupo informado nao e um Pedido PJ valido.';
  end if;
  if exists (select 1 from public.orders where order_group_id = p_order_group_id
      and (cancelled_at is not null or dispatched_at is not null or production_date is not null))
    or exists (select 1 from public.pj_production_schedules s join public.orders o on o.id=s.order_id
      where o.order_group_id=p_order_group_id)
    or exists (select 1 from public.receivables where origin='pedido_pj' and origin_ref=p_order_group_id) then
    raise exception using errcode = '22023', message = 'Pedido que ja entrou na operacao ou no financeiro nao pode ser alterado.';
  end if;
  perform private.assert_pj_order_payload(p_order_group_id, p_rows, false);

  perform set_config('pane.pj_order_write', p_order_group_id::text, true);
  delete from public.orders where order_group_id = p_order_group_id;
  v_count := private.insert_pj_order_rows(p_order_group_id, p_rows);
  perform set_config('pane.pj_order_write', '', true);

  v_result := jsonb_build_object('repeated', false, 'order_group_id', p_order_group_id,
    'row_count', v_count, 'flow_enabled', v_flow_enabled);
  insert into private.pj_order_write_requests(request_id, actor, action, order_group_id, request_payload, result)
  values (p_request_id, auth.uid(), 'replace', p_order_group_id, p_rows, v_result);
  return v_result;
end;
$$;

create function public.cancel_pj_order_atomic(
  p_request_id uuid,
  p_order_group_id uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_existing private.pj_order_write_requests%rowtype;
  v_flow private.pj_flow%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_name text;
  v_now timestamptz := clock_timestamp();
  v_payload jsonb;
  v_result jsonb;
  v_count integer;
  v_flow_enabled boolean := false;
begin
  perform private.assert_pj_order_write_access();
  if p_request_id is null or p_order_group_id is null or length(coalesce(v_reason, '')) < 3 then
    raise exception using errcode = '22023', message = 'Pedido, identificador e motivo do cancelamento sao obrigatorios.';
  end if;
  v_payload := jsonb_build_object('reason', v_reason);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pane-pj-write:' || p_request_id::text, 0));
  select * into v_existing from private.pj_order_write_requests where request_id = p_request_id;
  if found then
    if v_existing.actor <> auth.uid() or v_existing.action <> 'cancel'
      or v_existing.order_group_id <> p_order_group_id
      or v_existing.request_payload is distinct from v_payload then
      raise exception using errcode = '22023', message = 'Identificador ja usado para outra operacao.';
    end if;
    return v_existing.result || jsonb_build_object('repeated', true);
  end if;

  -- Mesma ordem da jornada operacional: primeiro o fluxo, depois as linhas.
  select * into v_flow from private.pj_flow where order_group_id=p_order_group_id for update;
  v_flow_enabled := found;
  if v_flow_enabled and not private.pj_flow_commercial() then
    raise exception using errcode = '42501', message = 'Sem permissao para cancelar este pedido da nova jornada PJ.';
  end if;
  if v_flow_enabled and v_flow.activation_mode <> 'standard' then
    raise exception using errcode = '22023', message = 'Este pedido acompanhado usa os controles do piloto.';
  end if;
  if v_flow_enabled and (v_flow.version <> 0 or v_flow.checked_at is not null or v_flow.released_at is not null
      or v_flow.departed_at is not null
      or exists (select 1 from private.pj_flow_events where order_group_id=p_order_group_id)) then
    raise exception using errcode = '22023', message = 'Pedido que ja iniciou a conferencia nao pode ser cancelado aqui.';
  end if;
  perform 1 from public.orders where order_group_id = p_order_group_id order by id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Pedido PJ nao encontrado.';
  end if;
  if exists (select 1 from public.orders where order_group_id=p_order_group_id
    and (order_type <> 'pj' or dispatched_at is not null or production_date is not null))
    or exists (select 1 from public.pj_production_schedules s join public.orders o on o.id=s.order_id
      where o.order_group_id=p_order_group_id)
    or exists (select 1 from public.receivables where origin='pedido_pj' and origin_ref=p_order_group_id) then
    raise exception using errcode = '22023', message = 'Pedido que ja entrou na operacao ou no financeiro nao pode ser cancelado.';
  end if;
  select display_name into v_name from public.app_profiles where user_id=auth.uid() and active;
  perform set_config('pane.pj_order_write', p_order_group_id::text, true);
  update public.orders set cancelled_at=v_now, cancelled_by=v_name, cancel_reason=v_reason,
    updated_at=now()
  where order_group_id=p_order_group_id and cancelled_at is null;
  get diagnostics v_count = row_count;
  perform set_config('pane.pj_order_write', '', true);
  if v_count = 0 then
    raise exception using errcode = '22023', message = 'Este pedido ja estava cancelado.';
  end if;
  if v_flow_enabled then
    delete from private.pj_flow where order_group_id=p_order_group_id;
  end if;

  v_result := jsonb_build_object('repeated', false, 'order_group_id', p_order_group_id,
    'row_count', v_count, 'cancelled_at', v_now, 'cancelled_by', v_name,
    'cancel_reason', v_reason, 'flow_enabled', v_flow_enabled);
  insert into private.pj_order_write_requests(request_id, actor, action, order_group_id, request_payload, result)
  values (p_request_id, auth.uid(), 'cancel', p_order_group_id, v_payload, v_result);
  return v_result;
end;
$$;

revoke all on function public.create_pj_order_atomic(uuid, uuid, jsonb),
  public.replace_pj_order_atomic(uuid, uuid, jsonb),
  public.cancel_pj_order_atomic(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.create_pj_order_atomic(uuid, uuid, jsonb),
  public.replace_pj_order_atomic(uuid, uuid, jsonb),
  public.cancel_pj_order_atomic(uuid, uuid, text) to authenticated;

commit;
