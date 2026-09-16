-- Fase 2, parte 2 do saneamento do catálogo: leva variante e pacote PJ do
-- pedido até produção, Forno, Cozinha e expedição.
--
-- Contexto: a fase 1 (PR #403) criou product_variants/product_sale_options.
-- product_variant_id/product_recipe_yields.product_variant_id/
-- product_pj_pack_rules como fundação, sem nenhum consumidor. A fase 2 parte 1
-- (PR #404) fechou cadastro -> precificação (tabela de preço já resolve e
-- mostra a variante). Esta migration fecha pedido -> produção -> Forno/
-- Cozinha -> expedição, que hoje trabalham só com (product_source, product_id)
-- e por isso somariam "Brioche Hamburguer" e "Brioche Forma" como se fossem o
-- mesmo pão. Não popula variante real nem aplica as 51 decisões de catálogo:
-- só o mecanismo.
--
-- Regra de pacote fechado (product_pj_pack_rules, fase 1): quando existe regra
-- para o produto/variante, o pedido comercial fecha em pacotes inteiros,
-- nunca fração, nunca arredonda para baixo. Ex.: Brioche Hamburguer pesa 80 g
-- por unidade e fecha em pacotes de 12 (0,96 kg), mesmo quando o preço é por
-- kg. A regra é validada no servidor (falha fechada); o arredondamento visível
-- ao usuário é responsabilidade da tela.
begin;

-- ---------------------------------------------------------------------------
-- 1. product_variant_id propagado pelas tabelas do pipeline PJ. Sempre nulo
-- para product_source = 'bread' (pão legado nunca tem variante) e para
-- qualquer pedido que não seja do catálogo unificado.
-- ---------------------------------------------------------------------------

alter table public.orders
  add column product_variant_id uuid references public.product_variants(id);

alter table public.orders
  add constraint orders_variant_requires_product_source
  check (product_variant_id is null or product_source = 'product');

comment on column public.orders.product_variant_id is
  'Snapshot da variante vendida nesta linha, resolvida de sale_option_id na criação. Nulo para produto legado sem variante ou fonte bread.';

-- Cross-tabela (a variante precisa pertencer ao mesmo produto do bread_id) não
-- cabe em CHECK puro; falha fechada por trigger, mesmo padrão de
-- sync_legacy_pj_schedule_identity.
create function private.validate_order_product_variant() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.product_variant_id is not null and not exists (
    select 1 from public.product_variants v
    where v.id = new.product_variant_id
      and new.product_source = 'product'
      and v.product_id::text = new.bread_id
  ) then
    raise exception using errcode = '23514',
      message = 'A variante informada nao pertence a este produto.';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_order_product_variant() from public, anon, authenticated;
grant execute on function private.validate_order_product_variant() to service_role;

create trigger validate_order_product_variant
before insert or update of product_variant_id, product_source, bread_id on public.orders
for each row execute function private.validate_order_product_variant();

alter table public.pj_production_schedules
  add column product_variant_id uuid references public.product_variants(id);
alter table public.pj_production_schedules
  add constraint pj_production_schedules_variant_requires_product
  check (product_variant_id is null or product_source = 'product');
comment on column public.pj_production_schedules.product_variant_id is
  'Copia de orders.product_variant_id no momento da programacao. Chave de agregacao do Forno junto com product_source/product_id.';

alter table public.production_actuals
  add column product_variant_id uuid references public.product_variants(id);
alter table public.production_actuals
  add constraint production_actuals_variant_requires_product
  check (product_variant_id is null or product_source = 'product');
alter table public.production_actuals
  drop constraint production_actuals_product_date_key;
alter table public.production_actuals
  add constraint production_actuals_product_date_key
  unique nulls not distinct (product_source, product_id, record_date, product_variant_id);
comment on constraint production_actuals_product_date_key on public.production_actuals is
  'nulls not distinct: dois lancamentos do mesmo produto sem variante no mesmo dia continuam colidindo (comportamento legado); variantes diferentes do mesmo produto não colidem entre si.';

alter table public.production_actual_events
  add column product_variant_id uuid references public.product_variants(id);
alter table public.production_actual_events
  add constraint production_actual_events_variant_requires_product
  check (product_variant_id is null or product_source = 'product');

alter table public.kitchen_production
  add column product_variant_id uuid;
alter table public.kitchen_production
  add constraint kitchen_production_variant_product_fkey
  foreign key (product_variant_id, product_id)
  references public.product_variants(id, product_id);
comment on column public.kitchen_production.product_variant_id is
  'Copia de pj_production_schedules.product_variant_id quando o lote corresponde a programacao PJ. Nulo no lancamento livre, que ainda nao seleciona variante.';

-- ---------------------------------------------------------------------------
-- 2. Criação/edição do pedido PJ: resolve e grava product_variant_id, e
-- aplica a regra de pacote fechado (product_pj_pack_rules) quando existir.
-- ---------------------------------------------------------------------------

create or replace function private.insert_pj_order_rows(p_order_group_id uuid, p_rows jsonb) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare v_count integer;
begin
  insert into public.orders(
    store, order_type, order_group_id, bread_id, product_source, product_name,
    quantity, unit_price, pack_size, pricing_unit, sale_option_id, product_variant_id,
    customer_id, pj_client, order_date, delivery_date, production_date, pj_delivery_date, obs,
    needs_production
  )
  select 'pj', 'pj', p_order_group_id, x.bread_id, x.product_source,
    case when x.product_source='bread'
      then (select b.name from public.breads b where b.id=x.bread_id)
      else (select p.name from public.products p where p.id::text=x.bread_id) end,
    x.quantity, x.unit_price, x.pack_size, x.pricing_unit, x.sale_option_id,
    case when x.product_source = 'product' and x.sale_option_id is not null
      then (select s.product_variant_id from public.product_sale_options s where s.id = x.sale_option_id)
      else null end,
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

create or replace function private.assert_pj_order_payload(
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
  v_variant_id uuid;
  v_has_rule boolean;
  v_pack_rule_size numeric;
  v_pack_rule_min numeric;
  v_pack_rule_multiple numeric;
  v_unit_weight numeric;
  v_expected_pack_physical numeric;
  v_packs numeric;
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

    -- Identidade da variante: sempre resolvida da opção de venda escolhida,
    -- nunca informada solta pelo cliente (evita variante "encomendada" sem
    -- passar pela precificação real).
    v_variant_id := null;
    if v_source = 'product' and v_sale_option is not null then
      select s.product_variant_id into v_variant_id
      from public.product_sale_options s
      where s.id = v_sale_option;
    end if;

    -- Regra de pacote fechado: por variante primeiro, senão a regra do
    -- produto sem variante (fallback legado, só quando não há regra
    -- específica; nunca ignora uma regra que exista).
    select r.pack_size_units, r.min_order_packs, r.order_multiple_packs
      into v_pack_rule_size, v_pack_rule_min, v_pack_rule_multiple
    from public.product_pj_pack_rules r
    where r.product_id::text = v_product_id
      and r.product_variant_id is not distinct from v_variant_id
    limit 1;
    v_has_rule := found;
    if not v_has_rule and v_variant_id is not null then
      select r.pack_size_units, r.min_order_packs, r.order_multiple_packs
        into v_pack_rule_size, v_pack_rule_min, v_pack_rule_multiple
      from public.product_pj_pack_rules r
      where r.product_id::text = v_product_id and r.product_variant_id is null
      limit 1;
      v_has_rule := found;
    end if;

    if v_has_rule then
      -- O tamanho fisico do pacote fica fora de pack_size de propósito:
      -- customer_price_overrides/price_tier_items.pack_size tem CHECK (>= 1)
      -- de uma tabela que esta fase nao toca, e um pacote de 12 unidades de
      -- 80 g pesa 0,96 kg — menor que 1. A regra de pacote fechado valida
      -- direto contra a quantidade, nunca contra pack_size.
      if v_pricing_unit = 'un' then
        v_expected_pack_physical := v_pack_rule_size;
        if v_pack_size <> v_expected_pack_physical then
          raise exception using errcode = '22023',
            message = 'O tamanho do pacote nao confere com a regra de pacote fechado deste produto.';
        end if;
      else
        v_unit_weight := null;
        select s.unit_weight_kg into v_unit_weight
        from public.product_sale_options s
        where s.product_id::text = v_product_id
          and s.product_variant_id is not distinct from v_variant_id
          and s.sale_unit = 'un' and s.active
        limit 1;
        if v_unit_weight is null or v_unit_weight <= 0 then
          raise exception using errcode = '22023',
            message = 'Cadastre o peso da unidade para vender este produto em pacotes fechados por kg.';
        end if;
        v_expected_pack_physical := round(v_pack_rule_size * v_unit_weight, 3);
      end if;

      v_packs := round(v_quantity / v_expected_pack_physical, 6);
      if v_packs <> trunc(v_packs) then
        raise exception using errcode = '22023',
          message = 'A quantidade precisa fechar em pacotes inteiros deste produto.';
      end if;
      if v_packs < v_pack_rule_min then
        raise exception using errcode = '22023',
          message = 'A quantidade fica abaixo do pedido minimo em pacotes deste produto.';
      end if;
      if mod(v_packs, v_pack_rule_multiple) <> 0 then
        raise exception using errcode = '22023',
          message = 'A quantidade precisa ser multipla do pacote comercial deste produto.';
      end if;
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

-- ---------------------------------------------------------------------------
-- 3. Programação: copia product_variant_id do pedido para a linha agendada.
--
-- private.schedule_pj_production_lock_order_impl é o nome atual do corpo
-- completo desde a migration 20260910213145 (que renomeou o antigo
-- schedule_pj_production_contract_impl para este nome e criou, com o nome
-- antigo, um wrapper fino que só trava tudo antes de chamar este). Redefinir
-- schedule_pj_production_contract_impl aqui apagaria esse wrapper de trava;
-- o alvo certo da lógica é este.
-- ---------------------------------------------------------------------------

create or replace function private.schedule_pj_production_lock_order_impl(
  p_production_date date,
  p_items jsonb,
  p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_user_name text;
  v_item jsonb;
  v_order public.orders%rowtype;
  v_product public.products%rowtype;
  v_order_id uuid;
  v_quantity numeric;
  v_frozen numeric;
  v_scheduled numeric;
  v_source text;
  v_product_id text;
  v_bread_id text;
  v_product_name text;
  v_process text;
  v_area text;
  v_pricing_unit text;
  v_variant_id uuid;
  v_stock numeric;
  v_reserved numeric;
  v_existing_count integer;
  v_requested_count integer;
begin
  if not private.current_user_can_plan_pj_production() then
    raise exception using errcode = '42501', message = 'Usuario sem permissao para organizar a producao PJ.';
  end if;
  select profile.display_name into v_user_name from public.app_profiles profile
  where profile.user_id = v_user_id and profile.active;

  if p_production_date is null or p_production_date <> private.data_na_padaria() then
    raise exception using errcode = '22023', message = 'A programacao PJ deve ser feita para hoje.';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22004', message = 'Identificador da programacao ausente.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = '22023', message = 'Envie uma lista de itens para programar.';
  end if;
  v_requested_count := jsonb_array_length(p_items);
  if v_requested_count < 1 or v_requested_count > 100 then
    raise exception using errcode = '22023', message = 'Escolha de 1 a 100 itens por vez.';
  end if;
  if (select count(distinct item->>'order_id') from jsonb_array_elements(p_items) item) <> v_requested_count then
    raise exception using errcode = '22023', message = 'Cada linha do pedido deve aparecer uma unica vez.';
  end if;

  select count(*) into v_existing_count from public.pj_production_schedules schedule
  where schedule.request_id = p_request_id;
  if v_existing_count > 0 then
    if v_existing_count <> v_requested_count or exists (
      select 1 from jsonb_array_elements(p_items) item
      left join public.pj_production_schedules schedule
        on schedule.request_id = p_request_id
       and schedule.order_id = (item->>'order_id')::uuid
       and schedule.scheduled_quantity = (item->>'quantity')::numeric
       and schedule.frozen_quantity = coalesce((item->>'frozen_quantity')::numeric, 0)
      where schedule.id is null
    ) then
      raise exception using errcode = '22023', message = 'Esta programacao repetida chegou com valores diferentes.';
    end if;
    return jsonb_build_object('scheduled_count', v_existing_count, 'idempotent', true,
      'production_date', p_production_date);
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_order_id := (v_item->>'order_id')::uuid;
      v_quantity := (v_item->>'quantity')::numeric;
      v_frozen := coalesce((v_item->>'frozen_quantity')::numeric, 0);
    exception when others then
      raise exception using errcode = '22023', message = 'Item da programacao PJ invalido.';
    end;
    if v_quantity <= 0 or v_quantity > 1000000 or scale(v_quantity) > 3 then
      raise exception using errcode = '22023', message = 'Informe uma quantidade valida para produzir.';
    end if;
    if v_frozen < 0 or v_frozen > v_quantity or v_frozen <> trunc(v_frozen) then
      raise exception using errcode = '22023', message = 'Informe uma quantidade inteira e valida de congelados.';
    end if;

    select order_row.* into v_order from public.orders order_row
    where order_row.id = v_order_id for update;
    if not found or v_order.order_type <> 'pj' then
      raise exception using errcode = 'P0002', message = 'Linha do pedido PJ nao encontrada.';
    end if;
    if v_order.cancelled_at is not null or v_order.dispatched_at is not null then
      raise exception using errcode = '22023', message = 'Pedido cancelado ou ja enviado nao pode entrar na producao.';
    end if;
    if coalesce(v_order.delivery_date, v_order.pj_delivery_date) is null then
      raise exception using errcode = '22023', message = 'Pedido PJ sem data de entrega.';
    end if;

    v_source := coalesce(v_order.product_source, 'bread');
    v_variant_id := null;
    if v_source = 'bread' then
      select bread.id, bread.name, coalesce(v_order.pricing_unit, bread.unit, 'un')
      into v_product_id, v_product_name, v_pricing_unit
      from public.breads bread where bread.id = v_order.bread_id;
      if not found then raise exception using errcode = '23503', message = 'Pao antigo nao encontrado.'; end if;
      v_bread_id := v_product_id;
      v_process := 'forno';
      v_area := 'padaria';
    elsif v_source = 'product' then
      select product.* into v_product from public.products product where product.id::text = v_order.bread_id;
      if not found then raise exception using errcode = '23503', message = 'Produto nao encontrado no cadastro.'; end if;
      -- Sem checagem de "active" aqui de propósito: desde 20260910175540,
      -- produto inativado depois de um pedido aceito continua atendível na
      -- programação — a inativação impede pedido novo, não apaga o
      -- compromisso já existente (ver docs/CURRENT_STATE.md).
      if not v_product.is_fabricacao_propria then
        raise exception using errcode = '22023', message = 'Produto nao marcado como fabricacao propria.';
      end if;
      if v_product.legacy_bread_id is null
        and (v_product.production_process is null or v_product.production_area is null
          or v_product.allows_planned_production is null) then
        raise exception using errcode = '22023', message = 'Produto sem classificacao operacional para producao.';
      end if;
      if not coalesce(v_product.allows_planned_production, v_product.legacy_bread_id is not null) then
        raise exception using errcode = '22023', message = 'Produto nao aceita producao planejada.';
      end if;
      v_process := coalesce(v_product.production_process,
        case when v_product.legacy_bread_id is not null then 'forno' end);
      v_area := coalesce(v_product.production_area,
        case when v_product.legacy_bread_id is not null then 'padaria' end);
      if not (v_process = 'forno'
        or (v_area = 'cozinha' and v_process in ('montagem', 'preparo'))) then
        raise exception using errcode = '22023', message = 'Area ainda sem tela de producao autorizada.';
      end if;
      v_product_id := v_product.id::text;
      v_bread_id := v_product.legacy_bread_id;
      v_product_name := coalesce(v_order.product_name, v_product.name);
      v_pricing_unit := coalesce(v_order.pricing_unit, v_product.unit, 'un');
      v_variant_id := v_order.product_variant_id;
    else
      raise exception using errcode = '22023', message = 'Origem do produto invalida.';
    end if;

    if v_pricing_unit = 'un' and v_quantity <> trunc(v_quantity) then
      raise exception using errcode = '22023', message = 'Produto vendido por unidade nao aceita fracao.';
    end if;
    if v_process <> 'forno' and v_frozen > 0 then
      raise exception using errcode = '22023', message = 'Congelados so podem atender produtos do Forno.';
    end if;
    select coalesce(sum(schedule.scheduled_quantity), 0) into v_scheduled
    from public.pj_production_schedules schedule where schedule.order_id = v_order_id;
    if v_scheduled + v_quantity > v_order.quantity then
      raise exception using errcode = '22023', message = 'A quantidade escolhida passa do que ainda falta produzir.';
    end if;

    if v_frozen > 0 then
      if v_bread_id is null then
        raise exception using errcode = '22023', message = 'Este produto nao possui congelado compativel.';
      end if;
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('frozen:jc:' || v_bread_id, 0));
      v_stock := private.frozen_stock_for_bread_store(v_bread_id, 'jc');
      v_reserved := private.reserved_frozen_for_bread_store(v_bread_id, 'jc', null);
      if v_reserved + v_frozen > v_stock then
        raise exception using errcode = '22023',
          message = 'O congelado disponivel ja esta reservado por outro planejamento.';
      end if;
    end if;

    update public.orders set production_date = coalesce(production_date, p_production_date), updated_at = now()
    where id = v_order_id;
    insert into public.pj_production_schedules (
      order_id, production_date, bread_id, product_source, product_id, product_variant_id,
      production_process, production_area, product_name, production_unit,
      scheduled_quantity, frozen_quantity, request_id, created_by, created_by_name
    ) values (
      v_order_id, p_production_date, v_bread_id, v_source, v_product_id, v_variant_id,
      v_process, v_area, v_product_name, v_pricing_unit,
      v_quantity, v_frozen, p_request_id, v_user_id, v_user_name
    );
  end loop;
  return jsonb_build_object('scheduled_count', v_requested_count, 'idempotent', false,
    'production_date', p_production_date);
end;
$$;
revoke all on function private.schedule_pj_production_lock_order_impl(date, jsonb, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Forno: o previsto agrega por (product_source, product_id,
-- product_variant_id) em vez de (product_source, product_id), e a conversão
-- peso -> peças passa a valer também para o catálogo unificado (antes só
-- breads convertia). O tipo de retorno muda: drop + create, com regrant.
-- ---------------------------------------------------------------------------

drop function if exists public.list_pj_production_for_oven_v2(date);

create function public.list_pj_production_for_oven_v2(p_production_date date)
returns table (
  product_source text,
  product_id text,
  product_variant_id uuid,
  product_name text,
  production_unit text,
  quantity numeric,
  needs_weight_setup boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    private.current_user_can_plan_pj_production()
    or private.current_user_has_permission('forno.acessar', 'jc')
  ) then
    raise exception using errcode = '42501', message = 'Usuario sem permissao para consultar a producao PJ.';
  end if;
  if p_production_date is null then
    raise exception using errcode = '22004', message = 'Informe a data de producao.';
  end if;

  return query
  with schedule_rows as (
    select
      case when schedule.bread_id is not null then 'bread' else schedule.product_source end as row_source,
      coalesce(schedule.bread_id, schedule.product_id) as row_id,
      case when schedule.bread_id is not null then null::uuid else schedule.product_variant_id end as row_variant_id,
      coalesce(bread.name, schedule.product_name) as row_name,
      case
        when schedule.bread_id is not null then coalesce(bread.unit, 'un')
        when unit_option.id is not null then 'un'
        else coalesce(schedule.production_unit, 'un')
      end as target_unit,
      coalesce(bread.avg_unit_weight_kg, unit_option.unit_weight_kg) as avg_unit_weight_kg,
      schedule.production_unit as row_unit,
      (schedule.scheduled_quantity - schedule.frozen_quantity) as pending_quantity
    from public.pj_production_schedules schedule
    join public.orders order_row on order_row.id = schedule.order_id
    left join public.breads bread on bread.id = schedule.bread_id
    left join public.product_sale_options unit_option
      on schedule.bread_id is null
     and schedule.product_source = 'product'
     and unit_option.product_id::text = schedule.product_id
     and unit_option.product_variant_id is not distinct from schedule.product_variant_id
     and unit_option.sale_unit = 'un'
     and unit_option.active
    where schedule.production_date = p_production_date
      and order_row.cancelled_at is null
      and schedule.production_process = 'forno'
      and schedule.scheduled_quantity > schedule.frozen_quantity
  ),
  aggregated as (
    select
      row_source,
      row_id,
      row_variant_id,
      max(row_name) as row_name,
      max(target_unit) as target_unit,
      max(avg_unit_weight_kg) as avg_unit_weight_kg,
      sum(pending_quantity) filter (
        where not (row_unit = 'kg' and target_unit <> 'kg')
      ) as native_quantity,
      sum(pending_quantity) filter (
        where row_unit = 'kg' and target_unit <> 'kg'
      ) as kg_quantity_to_convert
    from schedule_rows
    group by row_source, row_id, row_variant_id
  )
  select
    row_source,
    row_id,
    row_variant_id,
    row_name,
    target_unit,
    coalesce(native_quantity, 0) + case
      when coalesce(kg_quantity_to_convert, 0) <= 0 then 0
      when avg_unit_weight_kg is null or avg_unit_weight_kg <= 0 then 0
      else round(kg_quantity_to_convert / avg_unit_weight_kg)
    end,
    (coalesce(kg_quantity_to_convert, 0) > 0
      and (avg_unit_weight_kg is null or avg_unit_weight_kg <= 0))
  from aggregated
  order by row_name, row_id, row_variant_id;
end;
$$;

revoke all on function public.list_pj_production_for_oven_v2(date)
  from public, anon, authenticated;
grant execute on function public.list_pj_production_for_oven_v2(date)
  to authenticated, service_role;

-- Confirmação do Forno: aceita a variante (parâmetro novo com default nulo,
-- compatível com o chamador atual) e passa a distinguir o lote por variante.
--
-- `create or replace` NÃO substitui aqui: acrescentar um parâmetro muda a
-- aridade (7 -> 8), e para o Postgres isso é um function overload novo, não
-- a mesma função redefinida. A assinatura antiga de 7 argumentos continuaria
-- viva, chamável por qualquer código que não mande o oitavo argumento
-- (exatamente o que src/app/forno/page.tsx faz hoje) — e o corpo antigo dela
-- referencia o `on conflict (product_source, product_id, record_date)` que
-- este arquivo acabou de dropar em favor da versão com product_variant_id.
-- Sem este drop explícito da assinatura antiga, toda confirmação de Forno
-- para produto do catálogo unificado quebraria em runtime assim que esta
-- migration fosse aplicada.
drop function if exists public.confirm_oven_product_output(date, text, text, numeric, numeric, text, text);

create function public.confirm_oven_product_output(
  p_record_date date,
  p_product_source text,
  p_product_id text,
  p_quantity_good numeric,
  p_quantity_loss numeric default 0,
  p_loss_reason text default null,
  p_obs text default null,
  p_product_variant_id uuid default null
)
returns table (
  production_actual_id uuid,
  returned_lot_code text,
  returned_quantity_good numeric,
  returned_quantity_loss numeric,
  returned_loss_reason text,
  confirmed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile_name text;
  v_profile_role text;
  v_product public.products%rowtype;
  v_product_found boolean := false;
  v_existing_actual public.production_actuals%rowtype;
  v_schedule_name text;
  v_schedule_unit text;
  v_has_schedule boolean := false;
  v_has_un_option boolean;
  v_name text;
  v_unit text;
  v_lot_code text;
  v_loss_reason text;
  v_actual_id uuid;
  v_previous_good numeric;
  v_previous_loss numeric;
  v_confirmed_at timestamptz := now();
begin
  if p_product_source = 'bread' then
    return query select * from public.confirm_oven_output(
      p_record_date, p_product_id, p_quantity_good, p_quantity_loss, p_loss_reason, p_obs
    );
    return;
  end if;

  if v_user_id is null then
    raise exception using errcode = '42501', message = 'E necessario entrar com e-mail para confirmar o forno.';
  end if;
  select profile.display_name, profile.role into v_profile_name, v_profile_role
  from public.app_profiles profile where profile.user_id = v_user_id and profile.active;
  if not found or v_profile_role not in ('admin', 'producao') then
    raise exception using errcode = '42501', message = 'Usuario sem permissao para confirmar o forno.';
  end if;
  if p_record_date is null then
    raise exception using errcode = '22004', message = 'Informe a data de producao.';
  end if;
  if p_product_source <> 'product' then
    raise exception using errcode = '22023', message = 'Origem do produto invalida.';
  end if;
  select product.* into v_product from public.products product
  where product.id::text = p_product_id;
  v_product_found := found;

  if p_product_variant_id is not null and not exists (
    select 1 from public.product_variants v
    where v.id = p_product_variant_id and v.product_id::text = p_product_id
  ) then
    raise exception using errcode = '22023', message = 'A variante informada nao pertence a este produto.';
  end if;

  -- Enquanto houver ponte legada, toda confirmacao converge para o mesmo lote
  -- antigo. Isso impede dois saldos para o mesmo produto por chamada direta.
  -- Produto com ponte legada nunca tem variante (regra da fase 1).
  if v_product_found and v_product.legacy_bread_id is not null then
    return query select * from public.confirm_oven_output(
      p_record_date, v_product.legacy_bread_id, p_quantity_good, p_quantity_loss,
      p_loss_reason, p_obs
    );
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'product:' || p_product_id || ':' || coalesce(p_product_variant_id::text, '-') || ':' || p_record_date::text,
      0
    )
  );
  select actual.* into v_existing_actual
  from public.production_actuals actual
  where actual.product_source = 'product' and actual.product_id = p_product_id
    and actual.product_variant_id is not distinct from p_product_variant_id
    and actual.record_date = p_record_date
  for update;
  v_previous_good := v_existing_actual.quantity_baked;
  v_previous_loss := v_existing_actual.quantity_loss;

  select schedule.product_name, schedule.production_unit, true
    into v_schedule_name, v_schedule_unit, v_has_schedule
  from public.pj_production_schedules schedule
  where schedule.production_date = p_record_date
    and schedule.product_source = 'product'
    and schedule.product_id = p_product_id
    and schedule.product_variant_id is not distinct from p_product_variant_id
    and schedule.production_process = 'forno'
  order by schedule.created_at
  limit 1;
  v_has_schedule := coalesce(v_has_schedule, false);

  if not v_product_found and v_existing_actual.id is null and not v_has_schedule then
    raise exception using errcode = '23503', message = 'Produto nao encontrado para este lote do Forno.';
  end if;
  if v_existing_actual.id is null and not v_has_schedule and (
    not v_product_found or not v_product.active or not v_product.is_fabricacao_propria
    or v_product.production_process <> 'forno'
  ) then
    raise exception using errcode = '22023', message = 'Produto nao pertence a confirmacao do Forno.';
  end if;
  if p_quantity_good is null or p_quantity_good < 0
    or p_quantity_loss is null or p_quantity_loss < 0
    or p_quantity_good > 1000000 or p_quantity_loss > 1000000
    or scale(p_quantity_good) > 3 or scale(p_quantity_loss) > 3
  then
    raise exception using errcode = '22023', message = 'Informe quantidades validas para o Forno.';
  end if;
  v_name := coalesce(v_existing_actual.product_name, v_schedule_name, v_product.name);

  -- A mesma regra de list_pj_production_for_oven_v2: se existe opção de venda
  -- 'un' ativa para este produto/variante, a unidade de produção é 'un',
  -- mesmo que o agendamento tenha sido gravado em 'kg' (pedido cobrado por
  -- peso de um item fisicamente contado em peças). Sem isso, o Forno
  -- confirmaria "12" como 12 kg quando o previsto já mostrou 12 peças.
  select exists (
    select 1 from public.product_sale_options s
    where s.product_id::text = p_product_id
      and s.product_variant_id is not distinct from p_product_variant_id
      and s.sale_unit = 'un' and s.active
  ) into v_has_un_option;
  v_unit := coalesce(
    v_existing_actual.production_unit,
    case when v_has_un_option then 'un' end,
    v_schedule_unit,
    v_product.unit,
    'un'
  );
  if v_unit <> 'kg'
    and (p_quantity_good <> trunc(p_quantity_good) or p_quantity_loss <> trunc(p_quantity_loss))
  then
    raise exception using errcode = '22023', message = 'Produto vendido por unidade nao aceita fracao.';
  end if;
  v_loss_reason := nullif(btrim(p_loss_reason), '');
  if p_quantity_loss > 0 and (v_loss_reason is null
    or v_loss_reason not in ('Queimou', 'Fora do padrão', 'Caiu ou contaminou', 'Outro'))
  then
    raise exception using errcode = '22023', message = 'Informe um motivo valido para a perda.';
  end if;
  if p_quantity_loss = 0 then v_loss_reason := null; end if;
  if length(coalesce(p_obs, '')) > 500 then
    raise exception using errcode = '22023', message = 'A observacao deve ter no maximo 500 caracteres.';
  end if;

  v_lot_code := 'L' || to_char(p_record_date, 'MMDD');

  insert into public.production_actuals (
    record_date, bread_id, product_source, product_id, product_variant_id, product_name, production_unit,
    lot_code, quantity_baked, quantity_loss, loss_reason, recorded_by, obs, updated_at
  ) values (
    p_record_date, null, 'product', p_product_id, p_product_variant_id, v_name, v_unit,
    v_lot_code, p_quantity_good, p_quantity_loss, v_loss_reason, v_profile_name,
    nullif(btrim(p_obs), ''), v_confirmed_at
  )
  on conflict (product_source, product_id, record_date, product_variant_id) do update set
    product_name = excluded.product_name,
    production_unit = excluded.production_unit,
    lot_code = excluded.lot_code,
    quantity_baked = excluded.quantity_baked,
    quantity_loss = excluded.quantity_loss,
    loss_reason = excluded.loss_reason,
    recorded_by = excluded.recorded_by,
    obs = excluded.obs,
    updated_at = excluded.updated_at
  returning id into v_actual_id;

  delete from public.bread_movements movement
  where movement.reference_type = 'production_actual'
    and movement.reference_id = v_actual_id::text
    and movement.movement_type in ('forno_entrada', 'forno_descarte');
  if p_quantity_good > 0 then
    insert into public.bread_movements (
      movement_type, bread_id, product_source, product_id, location, quantity,
      reference_id, reference_type, recorded_by, lot_id
    ) values (
      'forno_entrada', null, 'product', p_product_id, 'central', p_quantity_good,
      v_actual_id::text, 'production_actual', v_profile_name, v_actual_id
    );
  end if;

  insert into public.production_actual_events (
    production_actual_id, bread_id, product_source, product_id, product_variant_id, product_name, production_unit,
    record_date, lot_code, previous_quantity_baked, previous_quantity_loss,
    quantity_baked, quantity_loss, loss_reason, changed_by, changed_by_name, created_at
  ) values (
    v_actual_id, null, 'product', p_product_id, p_product_variant_id, v_name, v_unit,
    p_record_date, v_lot_code, v_previous_good, v_previous_loss,
    p_quantity_good, p_quantity_loss, v_loss_reason, v_user_id, v_profile_name, v_confirmed_at
  );

  return query select v_actual_id, v_lot_code, p_quantity_good, p_quantity_loss,
    v_loss_reason, v_confirmed_at;
end;
$$;

comment on function public.confirm_oven_product_output(date, text, text, numeric, numeric, text, text, uuid) is
  'Confirma ou corrige uma identidade do Forno. Bread usa o fluxo historico; product grava o catalogo unificado, distinguindo variante quando informada.';
revoke all on function public.confirm_oven_product_output(date, text, text, numeric, numeric, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.confirm_oven_product_output(date, text, text, numeric, numeric, text, text, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Expedição PJ: a fila já lê orders diretamente, então basta expor a
-- identidade da variante junto (o pedido é o próprio snapshot da expedição,
-- não existe tabela de itens separada — ver auditoria da fase).
-- ---------------------------------------------------------------------------

drop function if exists public.list_pj_orders_for_dispatch();

create function public.list_pj_orders_for_dispatch()
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
  product_variant_id uuid,
  product_name text,
  quantity numeric,
  pack_size numeric,
  pricing_unit text,
  sale_option_id uuid,
  obs text,
  cancelled_at timestamptz,
  dispatched_at timestamptz,
  dispatched_by uuid,
  dispatched_by_name text,
  dispatched_quantity numeric,
  dispatched_quantity_reason text,
  dispatched_quantity_at timestamptz,
  dispatched_quantity_by_name text,
  ja_virou_cobranca boolean
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
    order_row.product_variant_id,
    order_row.product_name,
    order_row.quantity,
    order_row.pack_size,
    order_row.pricing_unit,
    order_row.sale_option_id,
    order_row.obs,
    order_row.cancelled_at,
    order_row.dispatched_at,
    order_row.dispatched_by,
    order_row.dispatched_by_name,
    order_row.dispatched_quantity,
    order_row.dispatched_quantity_reason,
    order_row.dispatched_quantity_at,
    order_row.dispatched_quantity_by_name,
    -- A Expedicao nao le `receivables` pela Data API, e nao deve mesmo: a fila
    -- e "sem valores". O que ela precisa saber e apenas se a porta da
    -- conferencia ja fechou, e isso e um sim ou nao, sem cifra nenhuma.
    exists (
      select 1
      from public.receivables cobranca
      where cobranca.origin = 'pedido_pj'
        and cobranca.origin_ref = order_row.order_group_id
        and cobranca.status <> 'cancelada'
    ) as ja_virou_cobranca
  from public.orders order_row
  left join public.customers customer on customer.id = order_row.customer_id
  where order_row.order_type = 'pj'
  order by order_row.order_date desc, order_row.order_group_id, order_row.id;
end;
$$;

revoke all on function public.list_pj_orders_for_dispatch() from public, anon;
grant execute on function public.list_pj_orders_for_dispatch() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Cozinha (montagem/preparo): mesma defesa contra somar variantes
-- diferentes. Hoje nenhum produto de Cozinha tem variante cadastrada, então
-- este bloco é preventivo — não muda nenhum resultado existente.
-- ---------------------------------------------------------------------------

create or replace function private.record_kitchen_batches_impl(
  p_store text,
  p_batches jsonb,
  p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_profile_name text;
  v_profile_role text;
  v_store text := pg_catalog.lower(pg_catalog.btrim(p_store));
  v_batch jsonb;
  v_product public.products%rowtype;
  v_product_id uuid;
  v_variant_id uuid;
  v_quantity numeric;
  v_unit text;
  v_name text;
  v_process text;
  v_area text;
  v_has_plan boolean;
  v_produced_at timestamptz := pg_catalog.now();
  v_result jsonb;
  v_count integer := 0;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Entre com e-mail para lancar a producao da cozinha.';
  end if;
  select profile.display_name, profile.role into v_profile_name, v_profile_role
  from public.app_profiles profile
  where profile.user_id = v_user_id and profile.active;
  if not found then
    raise exception using errcode = '42501', message = 'Usuario sem perfil ativo.';
  end if;
  if v_store is null or v_store not in ('jc', 'ja', 'ex') then
    raise exception using errcode = '22023', message = 'Loja invalida.';
  end if;
  if v_profile_role is distinct from 'admin'
    and not private.current_user_has_permission('producao_cozinha.lancar', v_store) then
    raise exception using errcode = '42501', message = 'Sem permissao para lancar a producao nesta loja.';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22004', message = 'Identificador do salvamento ausente.';
  end if;
  if p_batches is null or jsonb_typeof(p_batches) <> 'array'
    or jsonb_array_length(p_batches) < 1 or jsonb_array_length(p_batches) > 100 then
    raise exception using errcode = '22023', message = 'Informe de 1 a 100 lotes para salvar.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kitchen-production:' || p_request_id::text, 0)
  );
  select request.result into v_result
  from private.kitchen_production_write_requests request
  where request.request_id = p_request_id
    and request.actor = v_user_id
    and request.store = v_store
    and request.batches = p_batches;
  if found then return v_result || jsonb_build_object('idempotent', true); end if;
  if exists (select 1 from private.kitchen_production_write_requests request
             where request.request_id = p_request_id) then
    raise exception using errcode = '22023', message = 'Este salvamento repetido chegou com valores diferentes.';
  end if;

  for v_batch in select value from jsonb_array_elements(p_batches)
  loop
    if jsonb_typeof(v_batch) <> 'object'
      or jsonb_typeof(v_batch -> 'product_id') <> 'string'
      or jsonb_typeof(v_batch -> 'quantity') <> 'number'
      or (v_batch - array['product_id', 'quantity']) <> '{}'::jsonb then
      raise exception using errcode = '22023', message = 'Lote invalido.';
    end if;
    begin
      v_product_id := (v_batch ->> 'product_id')::uuid;
      v_quantity := (v_batch ->> 'quantity')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = '22023', message = 'Produto ou quantidade invalida.';
    end;
    if v_quantity <= 0 or v_quantity > 999 or scale(v_quantity) > 3 then
      raise exception using errcode = '22023', message = 'A quantidade deve ser positiva e ter no maximo tres casas decimais.';
    end if;

    v_variant_id := null;
    select exists (
      select 1 from public.pj_production_schedules schedule
      join public.orders order_row on order_row.id = schedule.order_id
      where v_store = 'jc'
        and schedule.production_date = (v_produced_at at time zone 'America/Sao_Paulo')::date
        and schedule.product_source = 'product'
        and schedule.product_id = v_product_id::text
        and schedule.production_area = 'cozinha'
        and schedule.production_process in ('montagem', 'preparo')
        and order_row.cancelled_at is null
    ) into v_has_plan;

    if v_has_plan then
      select schedule.product_name, coalesce(schedule.production_unit, 'un'),
             schedule.production_process, schedule.production_area, schedule.product_variant_id
      into v_name, v_unit, v_process, v_area, v_variant_id
      from public.pj_production_schedules schedule
      join public.orders order_row on order_row.id = schedule.order_id
      where schedule.production_date = (v_produced_at at time zone 'America/Sao_Paulo')::date
        and schedule.product_source = 'product'
        and schedule.product_id = v_product_id::text
        and schedule.production_area = 'cozinha'
        and schedule.production_process in ('montagem', 'preparo')
        and order_row.cancelled_at is null
      order by schedule.created_at desc limit 1;
    else
      select product.* into v_product from public.products product where product.id = v_product_id;
      if not found or not v_product.active or not v_product.is_fabricacao_propria
        or v_product.production_area <> 'cozinha'
        or v_product.production_process not in ('montagem', 'preparo')
        or not coalesce(v_product.allows_unplanned_production, false) then
        raise exception using errcode = '23503',
          message = 'Produto nao esta liberado para producao livre na cozinha.';
      end if;
      v_name := v_product.name;
      v_unit := coalesce(v_product.unit, 'un');
      v_process := v_product.production_process;
      v_area := v_product.production_area;
    end if;
    if v_unit <> 'kg' and v_quantity <> trunc(v_quantity) then
      raise exception using errcode = '22023', message = 'Produto por unidade nao aceita fracao.';
    end if;

    insert into public.kitchen_production (
      store, product_id, record_date, quantity, recorded_by, recorded_by_name,
      produced_at, product_name, production_unit, production_process, production_area,
      product_variant_id
    ) values (
      v_store, v_product_id, (v_produced_at at time zone 'America/Sao_Paulo')::date,
      v_quantity, v_user_id, v_profile_name, v_produced_at,
      v_name, v_unit, v_process, v_area, v_variant_id
    );
    v_count := v_count + 1;
  end loop;

  v_result := jsonb_build_object(
    'saved_count', v_count, 'produced_at', v_produced_at, 'idempotent', false
  );
  insert into private.kitchen_production_write_requests(request_id, actor, store, batches, result)
  values (p_request_id, v_user_id, v_store, p_batches, v_result);
  return v_result;
end;
$$;
revoke all on function private.record_kitchen_batches_impl(text, jsonb, uuid)
  from public, anon, authenticated;

drop function if exists public.list_kitchen_production_plan(text, date);

create function public.list_kitchen_production_plan(
  p_store text,
  p_production_date date
) returns table (
  product_id uuid,
  product_variant_id uuid,
  product_name text,
  production_unit text,
  production_process text,
  planned_quantity numeric,
  produced_quantity numeric
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_store text := lower(btrim(p_store));
  v_role text;
begin
  select profile.role into v_role from public.app_profiles profile
  where profile.user_id = auth.uid() and profile.active;
  if not found then raise exception using errcode = '42501', message = 'Usuario sem perfil ativo.'; end if;
  if v_store is null or v_store not in ('jc', 'ja', 'ex') or p_production_date is null then
    raise exception using errcode = '22023', message = 'Loja ou data invalida.';
  end if;
  if v_role <> 'admin' and not private.current_user_has_permission('producao_cozinha.lancar', v_store) then
    raise exception using errcode = '42501', message = 'Sem permissao para consultar a producao desta loja.';
  end if;
  if v_role <> 'admin' and p_production_date not between (private.data_na_padaria() - 1)
      and private.data_na_padaria() then
    raise exception using errcode = '42501',
      message = 'A equipe da Cozinha consulta somente hoje e ontem.';
  end if;

  return query
  with planned as (
    select schedule.product_id::uuid as product_id,
           schedule.product_variant_id as product_variant_id,
           (array_agg(schedule.product_name order by schedule.created_at desc))[1] as product_name,
           (array_agg(coalesce(schedule.production_unit, 'un') order by schedule.created_at desc))[1] as production_unit,
           (array_agg(schedule.production_process order by schedule.created_at desc))[1] as production_process,
           sum(schedule.scheduled_quantity)::numeric as quantity
    from public.pj_production_schedules schedule
    join public.orders order_row on order_row.id = schedule.order_id
    where v_store = 'jc'
      and schedule.production_date = p_production_date
      and schedule.product_source = 'product'
      and schedule.production_area = 'cozinha'
      and schedule.production_process in ('montagem', 'preparo')
      and order_row.cancelled_at is null
    group by schedule.product_id, schedule.product_variant_id
  ), produced as (
    select record.product_id,
           record.product_variant_id as product_variant_id,
           (array_agg(record.product_name order by record.produced_at desc))[1] as product_name,
           (array_agg(coalesce(record.production_unit, 'un') order by record.produced_at desc))[1] as production_unit,
           (array_agg(record.production_process order by record.produced_at desc))[1] as production_process,
           sum(record.quantity) filter (where record.cancelled_at is null)::numeric as quantity
    from public.kitchen_production record
    where record.store = v_store and record.record_date = p_production_date
    group by record.product_id, record.product_variant_id
  )
  select coalesce(planned.product_id, produced.product_id),
         coalesce(planned.product_variant_id, produced.product_variant_id),
         coalesce(planned.product_name, produced.product_name, product.name),
         coalesce(planned.production_unit, produced.production_unit, product.unit, 'un'),
         coalesce(planned.production_process, produced.production_process, product.production_process),
         coalesce(planned.quantity, 0),
         coalesce(produced.quantity, 0)
  from planned full join produced
    on produced.product_id = planned.product_id
   and produced.product_variant_id is not distinct from planned.product_variant_id
  left join public.products product on product.id = coalesce(planned.product_id, produced.product_id)
  where coalesce(planned.quantity, 0) > 0
  order by coalesce(planned.product_name, produced.product_name, product.name);
end;
$$;
revoke all on function public.list_kitchen_production_plan(text, date)
  from public, anon, authenticated;
grant execute on function public.list_kitchen_production_plan(text, date)
  to authenticated, service_role;

commit;
