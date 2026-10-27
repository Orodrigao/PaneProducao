-- Expedição corrige e cancela o Pedido PJ que ela lançou (fase 2).
--
-- A Expedição JC que lançou o pedido pela própria tela (fase 1) corrige a
-- data, a observação e as quantidades, ou cancela com motivo, enquanto a
-- conferência não começou: a mesma condição que vale para o Financeiro em
-- replace_pj_order_atomic_v2. Vale só para o pedido que ela mesma lançou e
-- enquanto ninguém mais mexeu nele. Colega da Expedição, outro papel, outra
-- loja e permissão retirada são recusados aqui dentro, na hora.
--
-- O preço continua saindo só do banco: as linhas da correção passam pela
-- mesma conta do lançamento (private.pj_expedition_order_rows, que a criação
-- também passa a usar) e pela mesma conferência do contrato do Financeiro.
-- As travas seguem a ordem dos contratos do Financeiro e da conferência e
-- liberação (transition_pj_flow_pilot): primeiro o fluxo, depois as linhas.
-- Quem chega depois de uma conferência ou liberação espera a trava e é
-- recusado pelo estado já gravado.
--
-- O que NÃO muda: as policies de public.orders, os contratos do Financeiro e
-- private.is_pj_flow. O cancelamento grava a ação 'cancel' na trilha, com a
-- origem 'expedition' no conteúdo, para o pedido cancelado continuar
-- protegido como pedido da jornada (is_pj_flow reconhece por essa ação).

-- ---------------------------------------------------------------------------
-- 1. A permissão da fase 1 passa a cobrir a correção do próprio pedido, e a
--    trilha ganha a ação da correção pela Expedição.
-- ---------------------------------------------------------------------------

update public.app_permissions
set description = 'Expedição JC lança cliente, data e quantidade e corrige ou cancela o pedido que ela lançou até a conferência começar; exige também Confirmar envio de Pedido PJ. O preço vem da tabela do cliente e ela não vê valores. Sem concessão automática.'
where key = 'pedidos_pj.lancar';

alter table private.pj_order_write_requests
  drop constraint pj_order_write_requests_action_check;
alter table private.pj_order_write_requests
  add constraint pj_order_write_requests_action_check
  check (action in ('create', 'replace', 'replace_v2', 'cancel', 'create_expedition', 'replace_expedition'));

-- ---------------------------------------------------------------------------
-- 2. Linhas do pedido a partir do que a Expedição enviou. É a conta que a
--    criação da fase 1 fazia dentro dela, sem nenhuma mudança de regra: a
--    criação e a correção passam pelo mesmo lugar. O cliente chega já
--    conferido por quem chama.
-- ---------------------------------------------------------------------------

create function private.pj_expedition_order_rows(
  p_customer_id uuid,
  p_customer_name text,
  p_order_date date,
  p_delivery_date date,
  p_obs text,
  p_lines jsonb
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_line jsonb;
  v_source text;
  v_product_id text;
  v_sale_option uuid;
  v_packs numeric;
  v_shown_quantity numeric;
  v_shown_unit text;
  v_shown_pack_units numeric;
  v_item record;
  v_physical numeric;
  v_quantity numeric;
  v_key text;
  v_keys text[] := array[]::text[];
  v_rows jsonb := '[]'::jsonb;
begin
  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    if jsonb_typeof(v_line) <> 'object'
      or (v_line - array['product_source', 'product_id', 'sale_option_id', 'packs', 'quantity',
        'unit', 'pack_units']) <> '{}'::jsonb then
      raise exception using errcode = '22023', message = 'O pedido contem campos desconhecidos.';
    end if;
    begin
      v_source := v_line->>'product_source';
      v_product_id := nullif(trim(v_line->>'product_id'), '');
      v_sale_option := nullif(v_line->>'sale_option_id', '')::uuid;
      v_packs := (v_line->>'packs')::numeric;
      v_shown_quantity := (v_line->>'quantity')::numeric;
      v_shown_unit := v_line->>'unit';
      v_shown_pack_units := (v_line->>'pack_units')::numeric;
    exception when others then
      raise exception using errcode = '22023', message = 'Um produto do pedido possui valor invalido.';
    end;
    if v_source is null or v_product_id is null then
      raise exception using errcode = '22023', message = 'Um produto do pedido possui valor invalido.';
    end if;

    v_key := v_source || '|' || v_product_id || '|' || coalesce(v_sale_option::text, '');
    if v_key = any(v_keys) then
      raise exception using errcode = '22023',
        message = 'O mesmo produto aparece duas vezes. Some as quantidades numa linha so.';
    end if;
    v_keys := v_keys || v_key;

    select * into v_item
    from private.pj_launch_items(p_customer_id) i
    where i.item_product_source = v_source and i.item_product_id = v_product_id
      and i.item_sale_option_id is not distinct from v_sale_option
    limit 1;
    if not found then
      raise exception using errcode = '22023',
        message = 'Um produto nao esta mais na tabela deste cliente. Recarregue a lista de produtos.';
    end if;
    if v_item.item_blocked_reason is not null then
      raise exception using errcode = '22023', message = v_item.item_blocked_reason;
    end if;

    if v_packs is null or v_packs <= 0 or v_packs > 100000 or scale(v_packs) > 3 then
      raise exception using errcode = '22023',
        message = 'Informe uma quantidade maior que zero, com ate tres casas decimais.';
    end if;
    if v_item.item_pack_rule_size is not null then
      if v_packs <> trunc(v_packs) then
        raise exception using errcode = '22023', message = 'Informe pacotes inteiros.';
      end if;
      v_physical := case when v_item.item_pricing_unit = 'un' then v_item.item_pack_rule_size
        else round(v_item.item_pack_rule_size * v_item.item_unit_weight_kg, 3) end;
    else
      if v_item.item_pricing_unit = 'un' and v_packs <> trunc(v_packs) then
        raise exception using errcode = '22023', message = 'Informe uma quantidade inteira.';
      end if;
      v_physical := v_item.item_pack_size;
    end if;
    v_quantity := trim_scale(v_packs * v_physical);
    if scale(v_quantity) > 3 then
      raise exception using errcode = '22023',
        message = 'A quantidade nao fecha em ate tres casas decimais. Ajuste a quantidade.';
    end if;
    if v_shown_quantity is null or v_shown_quantity <> v_quantity
      or v_shown_unit is distinct from v_item.item_pricing_unit
      or v_shown_pack_units is distinct from v_item.item_pack_rule_size then
      raise exception using errcode = '22023',
        message = 'O pacote, o peso ou a unidade de um produto mudou no cadastro. Recarregue a lista de produtos e revise as quantidades.';
    end if;

    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'bread_id', v_item.item_product_id,
      'product_source', v_item.item_product_source,
      'product_name', v_item.item_product_name,
      'quantity', v_quantity,
      'unit_price', v_item.item_unit_price,
      'pack_size', v_item.item_pack_size,
      'pricing_unit', v_item.item_pricing_unit,
      'sale_option_id', v_item.item_sale_option_id,
      'customer_id', p_customer_id,
      'pj_client', p_customer_name,
      'order_date', p_order_date,
      'delivery_date', p_delivery_date,
      'pj_delivery_date', p_delivery_date,
      'obs', p_obs
    ));
  end loop;
  return v_rows;
end;
$$;
revoke all on function private.pj_expedition_order_rows(uuid, text, date, date, text, jsonb)
  from public, anon, authenticated;

-- A criação da fase 1, igual, com o laço trocado pela chamada acima.
create or replace function public.create_pj_order_by_expedition(
  p_request_id uuid,
  p_order_group_id uuid,
  p_customer_id uuid,
  p_delivery_date date,
  p_obs text,
  p_lines jsonb
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_existing private.pj_order_write_requests%rowtype;
  v_payload jsonb;
  v_obs text;
  v_customer_name text;
  v_rows jsonb;
  v_count integer;
  v_result jsonb;
  v_error_state text;
  v_error_message text;
begin
  if not private.pj_expedition_can_launch() then
    raise exception using errcode = '42501',
      message = 'Sem permissao para lancar Pedido PJ pela Expedicao.';
  end if;
  if p_request_id is null or p_order_group_id is null or p_customer_id is null
    or p_delivery_date is null or jsonb_typeof(p_lines) is distinct from 'array'
    or jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 100 then
    raise exception using errcode = '22023',
      message = 'Escolha cliente, data de entrega e de 1 a 100 produtos.';
  end if;
  v_obs := nullif(trim(coalesce(p_obs, '')), '');
  if length(v_obs) > 500 then
    raise exception using errcode = '22023', message = 'A observacao passa de 500 caracteres.';
  end if;

  -- A repetição é reconhecida pelo que a Expedição enviou, nunca pelo preço:
  -- uma resposta perdida continua repetível mesmo se a tabela mudar depois.
  v_payload := jsonb_build_object('customer_id', p_customer_id, 'delivery_date', p_delivery_date,
    'obs', v_obs, 'lines', p_lines);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pane-pj-standard-cutover', 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pane-pj-write:' || p_request_id::text, 0));
  select * into v_existing from private.pj_order_write_requests where request_id = p_request_id;
  if found then
    if v_existing.actor <> auth.uid() or v_existing.action <> 'create_expedition'
      or v_existing.order_group_id <> p_order_group_id
      or v_existing.request_payload is distinct from v_payload then
      raise exception using errcode = '22023', message = 'Identificador ja usado para outra operacao.';
    end if;
    return v_existing.result || jsonb_build_object('repeated', true);
  end if;

  begin
    if private.pj_flow_rollout_state() is distinct from 'standard' then
      raise exception using errcode = '55000',
        message = 'O lancamento pela Expedicao so funciona na jornada padrao dos Pedidos PJ.';
    end if;
    if exists (select 1 from public.orders where order_group_id = p_order_group_id)
      or exists (select 1 from private.pj_flow where order_group_id = p_order_group_id) then
      raise exception using errcode = '22023', message = 'Este identificador de pedido ja existe.';
    end if;

    select c.name into v_customer_name from public.customers c where c.id = p_customer_id and c.active;
    if v_customer_name is null then
      raise exception using errcode = '22023', message = 'Escolha um cliente ativo.';
    end if;

    v_rows := private.pj_expedition_order_rows(p_customer_id, v_customer_name,
      private.data_na_padaria(), p_delivery_date, v_obs, p_lines);

    perform private.assert_pj_order_payload(p_order_group_id, v_rows, true);
    if not exists (
      select 1 from public.customers c
      where c.id = p_customer_id and c.payment_term_days is not null
    ) then
      raise exception using errcode = '22023',
        message = 'Cliente sem prazo de pagamento. Avise o Financeiro.';
    end if;

    perform set_config('pane.pj_order_write', p_order_group_id::text, true);
    v_count := private.insert_pj_order_rows(p_order_group_id, v_rows);
    insert into private.pj_flow(order_group_id, activation_mode)
    values (p_order_group_id, 'standard');
    perform set_config('pane.pj_order_write', '', true);

    v_result := jsonb_build_object(
      'repeated', false,
      'order_group_id', p_order_group_id,
      'row_count', v_count,
      'flow_enabled', true
    );
    insert into private.pj_order_write_requests(request_id, actor, action, order_group_id, request_payload, result)
    values (p_request_id, auth.uid(), 'create_expedition', p_order_group_id, v_payload, v_result);
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate, v_error_message = message_text;
    raise exception using errcode = v_error_state, message = v_error_message, hint = 'pj-launch-not-saved';
  end;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Quando a Expedição ainda pode mexer no próprio pedido. Devolve nulo
--    quando pode e, quando não pode, o motivo e a saída. Não confere papel nem
--    permissão: quem chama confere antes. Nas gravações, quem chama já
--    segurou o fluxo e as linhas, então a resposta vale até o fim da
--    transação.
-- ---------------------------------------------------------------------------

create function private.pj_expedition_change_blocked_reason(p_order_group_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when flow.order_group_id is null or flow.activation_mode <> 'standard'
      or not exists (select 1 from public.orders o
        where o.order_group_id = p_order_group_id and o.order_type = 'pj')
      then 'Este pedido não está mais na jornada dos Pedidos PJ. Recarregue a lista.'
    when launch.actor is null
      then 'Este pedido não foi lançado pela Expedição. Peça a correção ao Financeiro.'
    when launch.actor is distinct from auth.uid()
      then 'Este pedido foi lançado por outra pessoa da Expedição. Só quem lançou pode corrigir ou cancelar.'
    when exists (
      select 1 from private.pj_order_write_requests r
      where r.order_group_id = p_order_group_id
        and (r.actor <> launch.actor or r.action not in ('create_expedition', 'replace_expedition'))
    ) then 'O Financeiro alterou este pedido depois do lançamento. Peça a correção ao Financeiro.'
    when flow.version <> 0 or flow.checked_at is not null or flow.released_at is not null
      or flow.departed_at is not null
      or exists (select 1 from private.pj_flow_events e where e.order_group_id = p_order_group_id)
      then 'A conferência deste pedido já começou. Ajuste as quantidades na conferência ou peça a correção ao Financeiro.'
    when exists (
      select 1 from public.orders o
      where o.order_group_id = p_order_group_id
        and (
          o.order_type <> 'pj'
          or o.cancelled_at is not null
          or o.dispatched_at is not null
          or o.production_date is not null
          or o.dispatched_quantity is not null
          or o.dispatched_quantity_reason is not null
          or o.dispatched_quantity_at is not null
          or o.dispatched_quantity_by is not null
          or o.dispatched_quantity_by_name is not null
        )
    ) or exists (
      select 1 from public.pj_order_quantity_checks q
      join public.orders o on o.id = q.order_id
      where o.order_group_id = p_order_group_id
    ) or exists (
      select 1 from public.pj_production_schedules s
      join public.orders o on o.id = s.order_id
      where o.order_group_id = p_order_group_id
    ) or exists (
      select 1 from public.receivables r
      where r.origin = 'pedido_pj' and r.origin_ref = p_order_group_id
    ) then 'O pedido já entrou na produção ou no financeiro. Peça a correção ao Financeiro.'
  end
  from (select 1) anchor
  left join private.pj_flow flow on flow.order_group_id = p_order_group_id
  left join lateral (
    select r.actor
    from private.pj_order_write_requests r
    where r.order_group_id = p_order_group_id and r.action = 'create_expedition'
    order by r.created_at
    limit 1
  ) launch on true;
$$;
revoke all on function private.pj_expedition_change_blocked_reason(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Leitura para a ficha e para reabrir o formulário. O histórico (quem
--    criou, lançou, alterou, corrigiu ou cancelou) vale para o Financeiro e
--    para a Expedição da jornada. Só quem lançou, com a permissão e ainda
--    dentro do prazo, recebe o pedido para o formulário: cliente, entrega,
--    observação, produtos e quantidades, sem preço, e a versão das linhas
--    que a correção precisa devolver.
-- ---------------------------------------------------------------------------

create function public.read_pj_expedition_order(p_order_group_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_launcher boolean := private.pj_expedition_can_launch();
  v_reason text;
  v_history jsonb := '[]'::jsonb;
  v_order jsonb;
begin
  if not (v_launcher or private.pj_flow_commercial() or private.pj_flow_expedition()) then
    raise exception using errcode = '42501',
      message = 'Sem permissao para consultar este Pedido PJ.';
  end if;
  if p_order_group_id is null then
    raise exception using errcode = '22023', message = 'Informe o pedido.';
  end if;

  if private.is_pj_flow(p_order_group_id) then
    select coalesce(jsonb_agg(jsonb_build_object(
        'action', r.action,
        'by_name', coalesce(p.display_name, 'Usuário removido'),
        'by_me', r.actor = auth.uid(),
        'at', r.created_at
      ) order by r.created_at), '[]'::jsonb)
    into v_history
    from private.pj_order_write_requests r
    left join public.app_profiles p on p.user_id = r.actor
    where r.order_group_id = p_order_group_id;
  end if;

  if v_launcher then
    v_reason := private.pj_expedition_change_blocked_reason(p_order_group_id);
  end if;

  if v_launcher and v_reason is null then
    select jsonb_build_object(
      'customer_id', min(o.customer_id::text)::uuid,
      'customer_name', min(o.pj_client),
      'delivery_date', min(o.delivery_date),
      'obs', min(o.obs),
      'expected_rows', jsonb_agg(jsonb_build_object('id', o.id, 'updated_at', o.updated_at) order by o.id),
      'lines', jsonb_agg(jsonb_build_object(
        'product_source', o.product_source,
        'product_id', o.bread_id,
        'sale_option_id', o.sale_option_id,
        'product_name', o.product_name,
        'quantity', o.quantity,
        'unit', o.pricing_unit
      ) order by o.product_name, o.id)
    )
    into v_order
    from public.orders o
    where o.order_group_id = p_order_group_id and o.order_type = 'pj';
  end if;

  return jsonb_build_object(
    'order_group_id', p_order_group_id,
    'history', v_history,
    'can_change', v_launcher and v_reason is null,
    'change_blocked_reason', v_reason,
    'order', v_order
  );
end;
$$;
revoke all on function public.read_pj_expedition_order(uuid) from public, anon;
grant execute on function public.read_pj_expedition_order(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Correção pela Expedição. A tela manda a data, a observação, as linhas
--    no mesmo formato do lançamento e a versão das linhas que ela leu. O
--    cliente não muda: para outro cliente, cancela e lança de novo. Data de
--    entrega no passado só fica se já era a data do pedido.
--
--    Toda recusa depois da procura pela tentativa leva a dica
--    'pj-launch-not-saved', como no lançamento: nessa altura a tentativa não
--    existe e nada foi gravado, e a trava do identificador impede que outra
--    transação a grave ao mesmo tempo.
-- ---------------------------------------------------------------------------

create function public.replace_pj_order_by_expedition(
  p_request_id uuid,
  p_order_group_id uuid,
  p_delivery_date date,
  p_obs text,
  p_lines jsonb,
  p_expected_rows jsonb
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_existing private.pj_order_write_requests%rowtype;
  v_payload jsonb;
  v_obs text;
  v_reason text;
  v_item jsonb;
  v_expected_count integer;
  v_unique_count integer;
  v_count integer;
  v_customer uuid;
  v_customer_name text;
  v_order_date date;
  v_current_delivery date;
  v_rows jsonb;
  v_result jsonb;
  v_error_state text;
  v_error_message text;
begin
  if not private.pj_expedition_can_launch() then
    raise exception using errcode = '42501',
      message = 'Sem permissao para corrigir Pedido PJ pela Expedicao.';
  end if;
  if p_request_id is null or p_order_group_id is null or p_delivery_date is null
    or jsonb_typeof(p_lines) is distinct from 'array'
    or jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 100 then
    raise exception using errcode = '22023',
      message = 'Escolha a data de entrega e de 1 a 100 produtos.';
  end if;
  v_obs := nullif(trim(coalesce(p_obs, '')), '');
  if length(v_obs) > 500 then
    raise exception using errcode = '22023', message = 'A observacao passa de 500 caracteres.';
  end if;

  v_payload := jsonb_build_object('delivery_date', p_delivery_date, 'obs', v_obs,
    'lines', p_lines, 'expected_rows', p_expected_rows);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pane-pj-write:' || p_request_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pane-pj-controlled-real-slot', 0));
  select * into v_existing from private.pj_order_write_requests where request_id = p_request_id;
  if found then
    if v_existing.actor <> auth.uid() or v_existing.action <> 'replace_expedition'
      or v_existing.order_group_id <> p_order_group_id
      or v_existing.request_payload is distinct from v_payload then
      raise exception using errcode = '22023', message = 'Identificador ja usado para outra operacao.';
    end if;
    return v_existing.result || jsonb_build_object('repeated', true);
  end if;

  begin
    if jsonb_typeof(p_expected_rows) is distinct from 'array'
      or jsonb_array_length(p_expected_rows) < 1 or jsonb_array_length(p_expected_rows) > 100 then
      raise exception using errcode = '22023', message = 'A versao anterior do pedido e obrigatoria.';
    end if;
    v_expected_count := jsonb_array_length(p_expected_rows);
    for v_item in select value from jsonb_array_elements(p_expected_rows)
    loop
      if jsonb_typeof(v_item) <> 'object' or nullif(v_item->>'id', '') is null
        or not (v_item ? 'updated_at') or (v_item - array['id', 'updated_at']) <> '{}'::jsonb then
        raise exception using errcode = '22023', message = 'A versao anterior do pedido e invalida.';
      end if;
      begin
        perform (v_item->>'id')::uuid;
        perform (v_item->>'updated_at')::timestamptz;
      exception when others then
        raise exception using errcode = '22023', message = 'A versao anterior do pedido e invalida.';
      end;
    end loop;
    select count(distinct value->>'id') into v_unique_count from jsonb_array_elements(p_expected_rows);
    if v_unique_count <> v_expected_count then
      raise exception using errcode = '22023', message = 'A versao anterior do pedido e invalida.';
    end if;

    -- Mesma ordem de travas da conferência, da liberação e dos contratos do
    -- Financeiro: fluxo antes das linhas. A permissão é conferida de novo
    -- depois das travas: retirada enquanto a chamada esperava, não grava.
    perform 1 from private.pj_flow where order_group_id = p_order_group_id for update;
    perform 1 from public.orders where order_group_id = p_order_group_id order by id for update;
    if not private.pj_expedition_can_launch() then
      raise exception using errcode = '42501',
        message = 'Sem permissao para corrigir Pedido PJ pela Expedicao.';
    end if;
    v_reason := private.pj_expedition_change_blocked_reason(p_order_group_id);
    if v_reason is not null then
      raise exception using errcode = '22023', message = v_reason;
    end if;

    select count(*) into v_count from public.orders where order_group_id = p_order_group_id;
    if v_count <> v_expected_count or exists (
      select 1
      from public.orders o
      where o.order_group_id = p_order_group_id
        and not exists (
          select 1
          from jsonb_array_elements(p_expected_rows) expected(value)
          where (expected.value->>'id')::uuid = o.id
            and (expected.value->>'updated_at')::timestamptz is not distinct from o.updated_at
        )
    ) then
      raise exception using errcode = 'PT409',
        message = 'O pedido mudou depois que voce abriu a correcao. Recarregue e corrija de novo.';
    end if;

    select min(o.customer_id::text)::uuid, min(o.order_date), min(o.delivery_date)
    into v_customer, v_order_date, v_current_delivery
    from public.orders o
    where o.order_group_id = p_order_group_id;
    select c.name into v_customer_name from public.customers c where c.id = v_customer and c.active;
    if v_customer_name is null then
      raise exception using errcode = '22023',
        message = 'O cliente deste pedido nao esta mais ativo. Avise o Financeiro.';
    end if;
    if p_delivery_date < private.data_na_padaria() and p_delivery_date <> v_current_delivery then
      raise exception using errcode = '22023', message = 'A nova data de entrega nao pode ficar no passado.';
    end if;

    v_rows := private.pj_expedition_order_rows(v_customer, v_customer_name, v_order_date,
      p_delivery_date, v_obs, p_lines);
    perform private.assert_pj_order_payload(p_order_group_id, v_rows, false);
    if not exists (
      select 1 from public.customers c
      where c.id = v_customer and c.payment_term_days is not null
    ) then
      raise exception using errcode = '22023',
        message = 'Cliente sem prazo de pagamento. Avise o Financeiro.';
    end if;

    perform set_config('pane.pj_order_write', p_order_group_id::text, true);
    delete from public.orders where order_group_id = p_order_group_id;
    v_count := private.insert_pj_order_rows(p_order_group_id, v_rows);
    perform set_config('pane.pj_order_write', '', true);

    v_result := jsonb_build_object(
      'repeated', false,
      'order_group_id', p_order_group_id,
      'row_count', v_count,
      'flow_enabled', true
    );
    insert into private.pj_order_write_requests(request_id, actor, action, order_group_id, request_payload, result)
    values (p_request_id, auth.uid(), 'replace_expedition', p_order_group_id, v_payload, v_result);
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate, v_error_message = message_text;
    raise exception using errcode = v_error_state, message = v_error_message, hint = 'pj-launch-not-saved';
  end;
  return v_result;
end;
$$;
revoke all on function public.replace_pj_order_by_expedition(uuid, uuid, date, text, jsonb, jsonb) from public, anon;
grant execute on function public.replace_pj_order_by_expedition(uuid, uuid, date, text, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Cancelamento pela Expedição, com motivo. Grava como o cancelamento do
--    Financeiro (cancelled_at, quem cancelou e motivo nas linhas; o pedido
--    sai da jornada) e a trilha guarda a origem.
-- ---------------------------------------------------------------------------

create function public.cancel_pj_order_by_expedition(
  p_request_id uuid,
  p_order_group_id uuid,
  p_reason text
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_existing private.pj_order_write_requests%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_blocked text;
  v_name text;
  v_now timestamptz := clock_timestamp();
  v_payload jsonb;
  v_count integer;
  v_result jsonb;
  v_error_state text;
  v_error_message text;
begin
  if not private.pj_expedition_can_launch() then
    raise exception using errcode = '42501',
      message = 'Sem permissao para cancelar Pedido PJ pela Expedicao.';
  end if;
  if p_request_id is null or p_order_group_id is null
    or length(coalesce(v_reason, '')) < 3 or length(v_reason) > 500 then
    raise exception using errcode = '22023',
      message = 'Informe o motivo do cancelamento, com 3 a 500 caracteres.';
  end if;

  v_payload := jsonb_build_object('reason', v_reason, 'origin', 'expedition');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pane-pj-write:' || p_request_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pane-pj-controlled-real-slot', 0));
  select * into v_existing from private.pj_order_write_requests where request_id = p_request_id;
  if found then
    if v_existing.actor <> auth.uid() or v_existing.action <> 'cancel'
      or v_existing.order_group_id <> p_order_group_id
      or v_existing.request_payload is distinct from v_payload then
      raise exception using errcode = '22023', message = 'Identificador ja usado para outra operacao.';
    end if;
    return v_existing.result || jsonb_build_object('repeated', true);
  end if;

  begin
    perform 1 from private.pj_flow where order_group_id = p_order_group_id for update;
    perform 1 from public.orders where order_group_id = p_order_group_id order by id for update;
    if not private.pj_expedition_can_launch() then
      raise exception using errcode = '42501',
        message = 'Sem permissao para cancelar Pedido PJ pela Expedicao.';
    end if;
    v_blocked := private.pj_expedition_change_blocked_reason(p_order_group_id);
    if v_blocked is not null then
      raise exception using errcode = '22023', message = v_blocked;
    end if;

    select display_name into v_name from public.app_profiles where user_id = auth.uid() and active;
    perform set_config('pane.pj_order_write', p_order_group_id::text, true);
    update public.orders
    set cancelled_at = v_now, cancelled_by = v_name, cancel_reason = v_reason, updated_at = now()
    where order_group_id = p_order_group_id and cancelled_at is null;
    get diagnostics v_count = row_count;
    perform set_config('pane.pj_order_write', '', true);
    if v_count = 0 then
      raise exception using errcode = '22023', message = 'Este pedido ja estava cancelado.';
    end if;
    delete from private.pj_flow where order_group_id = p_order_group_id;

    v_result := jsonb_build_object(
      'repeated', false,
      'order_group_id', p_order_group_id,
      'row_count', v_count,
      'cancelled_at', v_now,
      'cancelled_by', v_name,
      'cancel_reason', v_reason,
      'flow_enabled', true
    );
    insert into private.pj_order_write_requests(request_id, actor, action, order_group_id, request_payload, result)
    values (p_request_id, auth.uid(), 'cancel', p_order_group_id, v_payload, v_result);
  exception when others then
    get stacked diagnostics v_error_state = returned_sqlstate, v_error_message = message_text;
    raise exception using errcode = v_error_state, message = v_error_message, hint = 'pj-launch-not-saved';
  end;
  return v_result;
end;
$$;
revoke all on function public.cancel_pj_order_by_expedition(uuid, uuid, text) from public, anon;
grant execute on function public.cancel_pj_order_by_expedition(uuid, uuid, text) to authenticated;
