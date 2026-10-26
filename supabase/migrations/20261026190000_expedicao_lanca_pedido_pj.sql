-- Expedição lança Pedido PJ sem ver preço (fase 1).
--
-- A Expedição JC passa a lançar cliente, data de entrega, produto e
-- quantidade. O preço nunca sai do banco para ela: cada linha é precificada
-- aqui, pela mesma regra que private.assert_pj_order_payload confere
-- (preço especial do cliente, senão tabela com o desconto do cliente), e o
-- pedido segue a jornada padrão, com a revisão da cobrança pelo Financeiro
-- antes da saída.
--
-- O que NÃO muda: as policies de public.orders (a Expedição continua sem
-- gravar nem ler pedido PJ direto), private.assert_pj_order_write_access
-- (os contratos antigos de criar, editar e cancelar seguem só para Admin e
-- Financeiro) e o cálculo de preço do formulário do Financeiro.

-- ---------------------------------------------------------------------------
-- 1. Permissão nova, sem concessão automática.
-- ---------------------------------------------------------------------------

insert into public.app_permissions (key, module, label, description, sort_order)
values ('pedidos_pj.lancar', 'Comercial', 'Lançar Pedido PJ pela Expedição',
  'Expedição JC lança cliente, data e quantidade; exige também Confirmar envio de Pedido PJ. O preço vem da tabela do cliente e ela não vê valores. Sem concessão automática.', 162)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. A trilha idempotente distingue o lançamento da Expedição. É por ela que
--    o Financeiro vê a origem do pedido, sem depender de nome ou cargo atual.
-- ---------------------------------------------------------------------------

alter table private.pj_order_write_requests
  drop constraint pj_order_write_requests_action_check;
alter table private.pj_order_write_requests
  add constraint pj_order_write_requests_action_check
  check (action in ('create', 'replace', 'replace_v2', 'cancel', 'create_expedition'));

-- ---------------------------------------------------------------------------
-- 3. Quem pode lançar: a mesma Expedição JC que confere os pedidos da
--    jornada (Pedidos PJ e Confirmar envio) e tem a permissão nova. Sem a
--    conferência ela lançaria pedido que não consegue acompanhar na lista.
--    Concessão a outro papel não abre nada: o papel é conferido aqui.
-- ---------------------------------------------------------------------------

create function private.pj_expedition_can_launch() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.pj_flow_expedition()
    and private.pj_flow_permission('pedidos_pj.lancar');
$$;
revoke all on function private.pj_expedition_can_launch() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Itens vendáveis de um cliente, com o preço que o banco aceitaria.
--    Uso interno: o catálogo da Expedição lê daqui sem o preço, e a criação
--    lê daqui com o preço. Qualquer divergência com a conferência de
--    assert_pj_order_payload faz a gravação ser recusada (falha fechada), e o
--    teste de banco prova a paridade.
-- ---------------------------------------------------------------------------

create function private.pj_launch_items(p_customer_id uuid)
returns table (
  item_product_source text,
  item_product_id text,
  item_sale_option_id uuid,
  item_product_variant_id uuid,
  item_product_name text,
  item_sale_option_name text,
  item_pricing_unit text,
  item_pack_size numeric,
  item_unit_price numeric,
  item_pack_rule_size numeric,
  item_pack_rule_min numeric,
  item_pack_rule_multiple numeric,
  item_unit_weight_kg numeric,
  item_blocked_reason text
)
language sql stable security definer set search_path = '' as $$
  with customer as (
    select c.id, c.default_tier_id, c.discount_pct
    from public.customers c
    where c.id = p_customer_id and c.active
  ),
  overrides as (
    select distinct on (o.product_source, o.product_id, o.sale_option_id)
      o.product_source, o.product_id, o.sale_option_id,
      o.unit_price, o.pack_size, o.pricing_unit
    from customer
    join public.customer_price_overrides o on o.customer_id = customer.id and o.active
    order by o.product_source, o.product_id, o.sale_option_id, o.created_at desc
  ),
  tier_items as (
    select distinct on (i.product_source, i.product_id, i.sale_option_id)
      i.product_source, i.product_id, i.sale_option_id,
      round(i.unit_price * (1 - customer.discount_pct / 100), 2) as unit_price,
      i.pack_size, i.pricing_unit
    from customer
    join public.price_tier_items i on i.tier_id = customer.default_tier_id and i.active
    where not exists (
      select 1 from overrides o
      where o.product_source = i.product_source and o.product_id = i.product_id
        and o.sale_option_id is not distinct from i.sale_option_id
    )
    order by i.product_source, i.product_id, i.sale_option_id, i.created_at desc
  ),
  priced as (
    select * from overrides
    union all
    select * from tier_items
  ),
  sellable as (
    select priced.*,
      case when priced.product_source = 'bread'
        then (select b.name from public.breads b where b.id = priced.product_id)
        else (select p.name from public.products p where p.id::text = priced.product_id) end as product_name,
      sale_option.name as sale_option_name,
      sale_option.product_variant_id
    from priced
    left join public.product_sale_options sale_option on sale_option.id = priced.sale_option_id
    where priced.pricing_unit in ('un', 'kg')
      and (
        (priced.product_source = 'bread' and priced.sale_option_id is null
          and exists (select 1 from public.breads b where b.id = priced.product_id and b.active))
        or (priced.product_source = 'product'
          and exists (select 1 from public.products p where p.id::text = priced.product_id and p.active)
          and (priced.sale_option_id is null or (
            sale_option.active and sale_option.product_id::text = priced.product_id
            and sale_option.sale_unit = priced.pricing_unit)))
      )
  ),
  with_rule as (
    select sellable.*,
      coalesce(specific_rule.pack_size_units, legacy_rule.pack_size_units) as pack_rule_size,
      coalesce(specific_rule.min_order_packs, legacy_rule.min_order_packs) as pack_rule_min,
      coalesce(specific_rule.order_multiple_packs, legacy_rule.order_multiple_packs) as pack_rule_multiple,
      (
        select s.unit_weight_kg
        from public.product_sale_options s
        where s.product_id::text = sellable.product_id
          and s.product_variant_id is not distinct from sellable.product_variant_id
          and s.sale_unit = 'un' and s.active
        limit 1
      ) as unit_weight_kg
    from sellable
    left join lateral (
      select r.pack_size_units, r.min_order_packs, r.order_multiple_packs
      from public.product_pj_pack_rules r
      where r.product_id::text = sellable.product_id
        and r.product_variant_id is not distinct from sellable.product_variant_id
      limit 1
    ) specific_rule on true
    left join lateral (
      select r.pack_size_units, r.min_order_packs, r.order_multiple_packs
      from public.product_pj_pack_rules r
      where specific_rule.pack_size_units is null
        and sellable.product_variant_id is not null
        and r.product_id::text = sellable.product_id
        and r.product_variant_id is null
      limit 1
    ) legacy_rule on true
  )
  select
    w.product_source, w.product_id, w.sale_option_id, w.product_variant_id,
    w.product_name, w.sale_option_name, w.pricing_unit, w.pack_size, w.unit_price,
    w.pack_rule_size, w.pack_rule_min, w.pack_rule_multiple,
    case when w.pack_rule_size is not null and w.pricing_unit = 'kg' then w.unit_weight_kg end,
    case
      when w.unit_price is null or w.unit_price <= 0 or w.pack_size is null or w.pack_size <= 0
        then 'Cadastro comercial incompleto. Avise o Financeiro.'
      when w.pack_rule_size is not null and w.pricing_unit = 'un' and w.pack_size <> w.pack_rule_size
        then 'O pacote da tabela não confere com o pacote fechado. Avise o Financeiro.'
      when w.pack_rule_size is not null and w.pricing_unit = 'kg'
        and (w.unit_weight_kg is null or w.unit_weight_kg <= 0)
        then 'Falta o peso da unidade para fechar o pacote em kg. Avise o Financeiro.'
    end
  from with_rule w;
$$;
revoke all on function private.pj_launch_items(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Catálogo da Expedição: clientes e produtos, sem preço nem desconto.
-- ---------------------------------------------------------------------------

create function public.list_pj_launch_catalog() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_customers jsonb;
  v_items jsonb;
begin
  if not private.pj_expedition_can_launch() then
    raise exception using errcode = '42501',
      message = 'Sem permissao para lancar Pedido PJ pela Expedicao.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'customer_id', c.id,
      'product_source', i.item_product_source,
      'product_id', i.item_product_id,
      'sale_option_id', i.item_sale_option_id,
      'product_name', i.item_product_name,
      'sale_option_name', i.item_sale_option_name,
      'pricing_unit', i.item_pricing_unit,
      'pack_size', i.item_pack_size,
      'pack_rule_size', i.item_pack_rule_size,
      'pack_rule_min', i.item_pack_rule_min,
      'pack_rule_multiple', i.item_pack_rule_multiple,
      'unit_weight_kg', i.item_unit_weight_kg,
      'blocked_reason', i.item_blocked_reason
    ) order by c.name, i.item_product_name, i.item_sale_option_name), '[]'::jsonb)
  into v_items
  from public.customers c
  cross join lateral private.pj_launch_items(c.id) i
  where c.active;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'blocked_reason', case
        when c.payment_term_days is null
          then 'Cliente sem prazo de pagamento. Avise o Financeiro.'
        when not exists (
          select 1 from jsonb_array_elements(v_items) item
          where item->>'customer_id' = c.id::text and item->>'blocked_reason' is null
        ) then 'Cliente sem produto disponível na tabela. Avise o Financeiro.'
      end
    ) order by c.name), '[]'::jsonb)
  into v_customers
  from public.customers c
  where c.active;

  return jsonb_build_object(
    'today', private.data_na_padaria(),
    'customers', v_customers,
    'items', v_items
  );
end;
$$;
revoke all on function public.list_pj_launch_catalog() from public, anon;
grant execute on function public.list_pj_launch_catalog() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Lançamento pela Expedição. A tela manda só cliente, data, observação e,
--    por produto, a quantidade em pacotes e o que mostrou na revisão:
--    quantidade física, unidade e tamanho do pacote fechado. Preço e pacote
--    da tabela saem daqui; o que a tela mostrou é recalculado pelo cadastro e
--    precisa bater, para uma mudança de pacote, peso ou unidade no meio do
--    preenchimento nunca gravar outra quantidade. Depois tudo passa pela mesma
--    conferência e pela mesma gravação do contrato do Financeiro.
--
--    Toda recusa depois da procura pela tentativa leva a dica
--    'pj-launch-not-saved': nessa altura nenhuma tentativa com o identificador
--    existe e nada foi gravado, então a tela pode liberar um envio novo. Sem a
--    dica (acesso, espera por trava, cancelamento), a tela repete a mesma
--    tentativa, que nunca vira dois pedidos.
-- ---------------------------------------------------------------------------

create function public.create_pj_order_by_expedition(
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
  v_today date;
  v_customer_name text;
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
    v_today := private.data_na_padaria();

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
        'pj_client', v_customer_name,
        'order_date', v_today,
        'delivery_date', p_delivery_date,
        'pj_delivery_date', p_delivery_date,
        'obs', v_obs
      ));
    end loop;

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
revoke all on function public.create_pj_order_by_expedition(uuid, uuid, uuid, date, text, jsonb) from public, anon;
grant execute on function public.create_pj_order_by_expedition(uuid, uuid, uuid, date, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Origem dos pedidos na jornada: quem lançou pela Expedição. Só devolve
--    pedidos lançados por ela; os demais seguem sem marca.
-- ---------------------------------------------------------------------------

create function public.list_pj_order_launch_origins(p_order_group_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.pj_flow_commercial() or private.pj_flow_expedition()) then
    raise exception using errcode = '42501',
      message = 'Sem permissao para consultar a origem dos Pedidos PJ.';
  end if;
  if p_order_group_ids is null or cardinality(p_order_group_ids) > 500 then
    raise exception using errcode = '22023', message = 'Informe de 0 a 500 pedidos.';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'order_group_id', request.order_group_id,
      'launched_by_name', coalesce(profile.display_name, 'Expedição'),
      'launched_by_me', request.actor = auth.uid(),
      'launched_at', request.created_at
    ) order by request.created_at)
    from private.pj_order_write_requests request
    left join public.app_profiles profile on profile.user_id = request.actor
    where request.action = 'create_expedition'
      and request.order_group_id = any(p_order_group_ids)
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.list_pj_order_launch_origins(uuid[]) from public, anon;
grant execute on function public.list_pj_order_launch_origins(uuid[]) to authenticated;
