-- Fase 2 das vendas do balcao: vinculos manuais e curva ABC.
-- A linha importada continua imutavel. O vinculo e resolvido na leitura para
-- que uma correcao reorganize todo o historico analitico sem reescrever venda.
-- Itens sem equivalente permanecem pendentes ou ignorados, mas conservam receita.

begin;

create table public.sales_product_mappings (
  id uuid primary key default gen_random_uuid(),
  source_system text not null check (source_system ~ '^[a-z][a-z0-9_]{1,30}$'),
  store text not null check (store in ('jc', 'ja', 'ex')),
  external_product_key text not null check (length(trim(external_product_key)) between 1 and 300),
  decision text not null check (decision in ('mapped', 'ignored')),
  product_id uuid references public.products(id) on delete restrict,
  sale_unit text check (sale_unit in ('un', 'kg')),
  decided_by uuid not null references auth.users(id),
  decided_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint sales_product_mappings_decision_shape check (
    (decision = 'mapped' and product_id is not null and sale_unit is not null)
    or (decision = 'ignored' and product_id is null and sale_unit is null)
  ),
  unique (source_system, store, external_product_key)
);

create table public.sales_product_mapping_events (
  id uuid primary key default gen_random_uuid(),
  mapping_id uuid references public.sales_product_mappings(id) on delete set null,
  source_system text not null,
  store text not null,
  external_product_key text not null,
  event_type text not null check (event_type in ('created', 'changed', 'cleared')),
  previous_decision text check (previous_decision in ('mapped', 'ignored')),
  previous_product_id uuid,
  previous_sale_unit text check (previous_sale_unit in ('un', 'kg')),
  new_decision text check (new_decision in ('mapped', 'ignored', 'pending')),
  new_product_id uuid,
  new_sale_unit text check (new_sale_unit in ('un', 'kg')),
  reason text,
  occurred_by uuid not null references auth.users(id),
  occurred_at timestamptz not null default now()
);

create index sales_product_mapping_events_key_idx
  on public.sales_product_mapping_events (source_system, store, external_product_key, occurred_at desc);

revoke all on table public.sales_product_mappings, public.sales_product_mapping_events
  from public, anon, authenticated;
grant select on table public.sales_product_mappings, public.sales_product_mapping_events
  to authenticated;

alter table public.sales_product_mappings enable row level security;
alter table public.sales_product_mappings force row level security;
alter table public.sales_product_mapping_events enable row level security;
alter table public.sales_product_mapping_events force row level security;

create policy sales_product_mappings_select_authorized
on public.sales_product_mappings for select to authenticated
using ((select private.current_user_can_sales('vendas_balcao.visualizar', store)));

create policy sales_product_mapping_events_select_authorized
on public.sales_product_mapping_events for select to authenticated
using ((select private.current_user_can_sales('vendas_balcao.visualizar', store)));

create or replace function public.set_sales_product_mapping(
  p_source_system text,
  p_store text,
  p_external_product_key text,
  p_decision text,
  p_product_id uuid default null,
  p_sale_unit text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.sales_product_mappings%rowtype;
  v_product public.products%rowtype;
  v_mapping_id uuid;
  v_is_change boolean := false;
begin
  if p_source_system is distinct from 'cnm' or p_store is distinct from 'jc'
     or nullif(trim(p_external_product_key), '') is null
     or length(trim(p_external_product_key)) > 300
     or p_decision is null or p_decision not in ('mapped', 'ignored', 'pending') then
    raise exception using errcode = '22023', message = 'Decisão de vínculo inválida.';
  end if;
  if not private.current_user_can_sales('vendas_balcao.importar', p_store) then
    raise exception using errcode = '42501', message = 'Sem permissão para vincular produtos vendidos.';
  end if;
  if not exists (
    select 1
    from public.sales_import_items item
    join public.sales_imports import on import.id = item.import_id
    where import.source_system = p_source_system
      and import.store = p_store
      and import.status = 'confirmed'
      and item.external_product_key = trim(p_external_product_key)
  ) then
    raise exception using errcode = '22023', message = 'O item vendido não existe nas importações.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sales-product-mapping:' || p_source_system || ':' || p_store || ':' || trim(p_external_product_key), 0
  ));

  select * into v_current
  from public.sales_product_mappings mapping
  where mapping.source_system = p_source_system
    and mapping.store = p_store
    and mapping.external_product_key = trim(p_external_product_key)
  for update;

  if p_decision = 'mapped' then
    if p_product_id is null or p_sale_unit is null or p_sale_unit not in ('un', 'kg') then
      raise exception using errcode = '22023', message = 'Escolha o produto e se a venda foi por unidade ou quilo.';
    end if;
    select * into v_product from public.products product where product.id = p_product_id;
    if v_product.id is null or not v_product.active or v_product.kind = 'insumo' then
      raise exception using errcode = '22023', message = 'Escolha um produto de venda ativo.';
    end if;
    if lower(coalesce(v_product.unit, 'un')) <> p_sale_unit and not exists (
      select 1 from public.product_sale_options sale_option
      where sale_option.product_id = p_product_id
        and sale_option.sale_unit = p_sale_unit
        and sale_option.active
    ) then
      raise exception using errcode = '22023', message = 'Essa forma de venda não está cadastrada para o produto.';
    end if;
  elsif p_product_id is not null or p_sale_unit is not null then
    raise exception using errcode = '22023', message = 'Produto e unidade só podem ser informados ao vincular.';
  end if;

  if v_current.id is not null then
    v_is_change := v_current.decision is distinct from nullif(p_decision, 'pending')
      or v_current.product_id is distinct from p_product_id
      or v_current.sale_unit is distinct from p_sale_unit;
    if not v_is_change then
      return jsonb_build_object('id', v_current.id, 'outcome', 'unchanged');
    end if;
    if length(trim(coalesce(p_reason, ''))) < 3 then
      raise exception using errcode = '22023', message = 'Explique o motivo da correção do vínculo.';
    end if;
  end if;

  if p_decision = 'pending' then
    if v_current.id is null then
      return jsonb_build_object('id', null, 'outcome', 'unchanged');
    end if;
    delete from public.sales_product_mappings where id = v_current.id;
    insert into public.sales_product_mapping_events (
      mapping_id, source_system, store, external_product_key, event_type,
      previous_decision, previous_product_id, previous_sale_unit,
      new_decision, reason, occurred_by
    ) values (
      null, p_source_system, p_store, trim(p_external_product_key), 'cleared',
      v_current.decision, v_current.product_id, v_current.sale_unit,
      'pending', trim(p_reason), (select auth.uid())
    );
    return jsonb_build_object('id', null, 'outcome', 'cleared');
  end if;

  insert into public.sales_product_mappings (
    source_system, store, external_product_key, decision, product_id, sale_unit,
    decided_by, updated_by
  ) values (
    p_source_system, p_store, trim(p_external_product_key), p_decision,
    case when p_decision = 'mapped' then p_product_id end,
    case when p_decision = 'mapped' then p_sale_unit end,
    (select auth.uid()), (select auth.uid())
  )
  on conflict (source_system, store, external_product_key) do update set
    decision = excluded.decision,
    product_id = excluded.product_id,
    sale_unit = excluded.sale_unit,
    updated_by = excluded.updated_by,
    updated_at = now()
  returning id into v_mapping_id;

  insert into public.sales_product_mapping_events (
    mapping_id, source_system, store, external_product_key, event_type,
    previous_decision, previous_product_id, previous_sale_unit,
    new_decision, new_product_id, new_sale_unit, reason, occurred_by
  ) values (
    v_mapping_id, p_source_system, p_store, trim(p_external_product_key),
    case when v_current.id is null then 'created' else 'changed' end,
    v_current.decision, v_current.product_id, v_current.sale_unit,
    p_decision,
    case when p_decision = 'mapped' then p_product_id end,
    case when p_decision = 'mapped' then p_sale_unit end,
    nullif(trim(p_reason), ''), (select auth.uid())
  );

  return jsonb_build_object('id', v_mapping_id, 'outcome', case when v_current.id is null then 'created' else 'changed' end);
end;
$$;

revoke all on function public.set_sales_product_mapping(text, text, text, text, uuid, text, text)
  from public, anon;
grant execute on function public.set_sales_product_mapping(text, text, text, text, uuid, text, text)
  to authenticated;

create or replace function public.get_sales_product_mapping_queue(
  p_source_system text default 'cnm',
  p_store text default 'jc'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if p_source_system is distinct from 'cnm' or p_store is distinct from 'jc' then
    raise exception using errcode = '22023', message = 'Origem ou loja ainda não habilitada.';
  end if;
  if not private.current_user_can_sales('vendas_balcao.visualizar', p_store) then
    raise exception using errcode = '42501', message = 'Sem permissão para ver produtos vendidos.';
  end if;

  with grouped as (
    select item.external_product_key,
      max(item.raw_product_name) as raw_product_name,
      max(item.raw_category) as raw_category,
      count(distinct item.raw_product_name)::integer as raw_name_count,
      min(import.sale_date) as first_sale_date,
      max(import.sale_date) as last_sale_date,
      count(distinct import.sale_date)::integer as sale_days,
      sum(item.quantity)::numeric as total_quantity,
      sum(item.net_total)::numeric as total_net
    from public.sales_import_items item
    join public.sales_imports import on import.id = item.import_id
    where import.source_system = p_source_system and import.store = p_store
      and import.status = 'confirmed'
    group by item.external_product_key
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'external_product_key', grouped.external_product_key,
    'raw_product_name', grouped.raw_product_name,
    'raw_category', grouped.raw_category,
    'raw_name_count', grouped.raw_name_count,
    'first_sale_date', grouped.first_sale_date,
    'last_sale_date', grouped.last_sale_date,
    'sale_days', grouped.sale_days,
    'total_quantity', round(grouped.total_quantity, 4),
    'total_net', round(grouped.total_net, 2),
    'mapping_status', coalesce(mapping.decision, 'pending'),
    'product_id', mapping.product_id,
    'product_name', product.name,
    'sale_unit', mapping.sale_unit,
    'is_fabricacao_propria', product.is_fabricacao_propria,
    'is_revenda', product.is_revenda
  ) order by (mapping.id is not null), grouped.total_net desc, grouped.raw_product_name), '[]'::jsonb)
  into v_result
  from grouped
  left join public.sales_product_mappings mapping
    on mapping.source_system = p_source_system and mapping.store = p_store
    and mapping.external_product_key = grouped.external_product_key
  left join public.products product on product.id = mapping.product_id;
  return v_result;
end;
$$;

revoke all on function public.get_sales_product_mapping_queue(text, text) from public, anon;
grant execute on function public.get_sales_product_mapping_queue(text, text) to authenticated;

create or replace function public.get_sales_abc(
  p_source_system text,
  p_store text,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if p_source_system is distinct from 'cnm' or p_store is distinct from 'jc'
     or p_start_date is null or p_end_date is null
     or p_start_date > p_end_date
     or p_end_date > private.data_na_padaria()
     or p_end_date - p_start_date > 366 then
    raise exception using errcode = '22023', message = 'Período da curva ABC inválido.';
  end if;
  if not private.current_user_can_sales('vendas_balcao.visualizar', p_store) then
    raise exception using errcode = '42501', message = 'Sem permissão para ver a curva ABC.';
  end if;

  with base as (
    select
      case when mapping.decision = 'mapped' then 'product:' || mapping.product_id::text
        else 'raw:' || item.external_product_key end as analysis_key,
      case when mapping.decision = 'mapped' then product.name else max(item.raw_product_name) over (partition by item.external_product_key) end as display_name,
      case when mapping.decision = 'mapped' then 'mapped' else coalesce(mapping.decision, 'pending') end as mapping_status,
      mapping.product_id,
      mapping.sale_unit,
      product.is_fabricacao_propria,
      item.quantity,
      item.net_total
    from public.sales_import_items item
    join public.sales_imports import on import.id = item.import_id
    left join public.sales_product_mappings mapping
      on mapping.source_system = import.source_system and mapping.store = import.store
      and mapping.external_product_key = item.external_product_key
    left join public.products product on product.id = mapping.product_id
    where import.source_system = p_source_system and import.store = p_store
      and import.status = 'confirmed'
      and import.sale_date between p_start_date and p_end_date
  ), quantity_groups as (
    select analysis_key, sale_unit, sum(quantity)::numeric as total_quantity
    from base
    group by analysis_key, sale_unit
  ), quantity_breakdowns as (
    select analysis_key,
      jsonb_agg(jsonb_build_object(
        'sale_unit', sale_unit,
        'total_quantity', round(total_quantity, 4)
      ) order by sale_unit) filter (where sale_unit is not null) as quantity_by_unit
    from quantity_groups
    group by analysis_key
  ), grouped as (
    select analysis_key, max(display_name) as display_name,
      max(mapping_status) as mapping_status,
      (array_agg(product_id) filter (where product_id is not null))[1] as product_id,
      case when count(distinct sale_unit) <= 1 then max(sale_unit) end as sale_unit,
      count(distinct sale_unit)::integer as sale_unit_count,
      bool_or(is_fabricacao_propria) as is_fabricacao_propria,
      sum(quantity)::numeric as total_quantity, sum(net_total)::numeric as total_net
    from base
    group by analysis_key
  ), ranked as (
    select grouped.*, coalesce(quantity_breakdowns.quantity_by_unit, '[]'::jsonb) as quantity_by_unit,
      sum(total_net) over () as grand_total,
      sum(total_net) over (
        order by total_net desc, display_name, analysis_key
        rows between unbounded preceding and 1 preceding
      ) as prior_total,
      sum(total_net) over (
        order by total_net desc, display_name, analysis_key
        rows between unbounded preceding and current row
      ) as cumulative_total
    from grouped
    left join quantity_breakdowns using (analysis_key)
  ), calendar as (
    select day::date as sale_date
    from generate_series(p_start_date, p_end_date, interval '1 day') day
    where extract(isodow from day) < 7
  ), coverage as (
    select calendar.sale_date,
      exists (
        select 1 from public.sales_imports import
        where import.source_system = p_source_system and import.store = p_store
          and import.status = 'confirmed' and import.sale_date = calendar.sale_date
      ) as imported,
      exists (
        select 1 from public.sales_day_statuses status
        where status.source_system = p_source_system and status.store = p_store
          and status.sale_date = calendar.sale_date
      ) as explained
    from calendar
  ), result_items as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'analysis_key', analysis_key,
      'display_name', display_name,
      'mapping_status', mapping_status,
      'product_id', product_id,
      'sale_unit', sale_unit,
      'quantity_by_unit', quantity_by_unit,
      'is_fabricacao_propria', coalesce(is_fabricacao_propria, false),
      'total_quantity', case when sale_unit_count <= 1 then round(total_quantity, 4) end,
      'total_net', round(total_net, 2),
      'average_price', case when sale_unit_count <= 1 and total_quantity > 0 then round(total_net / total_quantity, 2) end,
      'share_pct', case when grand_total > 0 then round(total_net * 100 / grand_total, 2) end,
      'cumulative_pct', case when grand_total > 0 then round(cumulative_total * 100 / grand_total, 2) end,
      'abc_class', case when grand_total <= 0 then null
        when coalesce(prior_total, 0) / grand_total < 0.80 then 'A'
        when coalesce(prior_total, 0) / grand_total < 0.95 then 'B'
        else 'C' end
    ) order by total_net desc, display_name, analysis_key), '[]'::jsonb) as items,
    coalesce(max(grand_total), 0) as total_net
    from ranked
  ), coverage_result as (
    select count(*)::integer as expected_days,
      count(*) filter (where imported)::integer as imported_days,
      count(*) filter (where explained and not imported)::integer as explained_days,
      coalesce(jsonb_agg(sale_date order by sale_date) filter (where not imported and not explained), '[]'::jsonb) as missing_dates
    from coverage
  )
  select jsonb_build_object(
    'start_date', p_start_date,
    'end_date', p_end_date,
    'total_net', round(result_items.total_net, 2),
    'items', result_items.items,
    'coverage', jsonb_build_object(
      'expected_days', coverage_result.expected_days,
      'imported_days', coverage_result.imported_days,
      'explained_days', coverage_result.explained_days,
      'missing_dates', coverage_result.missing_dates
    )
  ) into v_result
  from result_items cross join coverage_result;
  return v_result;
end;
$$;

revoke all on function public.get_sales_abc(text, text, date, date) from public, anon;
grant execute on function public.get_sales_abc(text, text, date, date) to authenticated;

commit;
