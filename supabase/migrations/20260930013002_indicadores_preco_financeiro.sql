begin;

create or replace function private.pricing_financial_indicators_report(p_today date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select
      date '2026-09-01' as first_month,
      date_trunc('month', coalesce(p_today, private.data_na_padaria()))::date as current_month
  ),
  months as (
    select generate_series(
      bounds.first_month,
      bounds.current_month - interval '1 month',
      interval '1 month'
    )::date as month_start
    from bounds
    where bounds.current_month > bounds.first_month
  ),
  finance as (
    select
      entry.competence_month as month_start,
      sum(entry.amount) filter (where category.key in ('clientes_pj', 'buck_ex')) as pj_buck_revenue,
      sum(entry.amount) filter (
        where category.nature = 'despesa'
          and category.dre_tier = 'operacional'
          and category.dre_group in ('mao_de_obra', 'ocupacao', 'manutencao', 'servicos', 'financeiras', 'outras')
          and category.key <> 'mao_obra_producao'
      ) as fixed_expenses,
      sum(entry.amount) filter (where category.key = 'mao_obra_producao') as production_labor,
      bool_or(category.key in ('mao_obra_encargos', 'mao_obra_diarias')) as has_unassigned_labor
    from public.finance_entries entry
    join public.finance_categories category on category.id = entry.category_id
    where entry.competence_month >= (select first_month from bounds)
      and entry.competence_month < (select current_month from bounds)
      and entry.entry_type = 'lancamento'
      and entry.reversed_at is null
      and (
        category.key in ('clientes_pj', 'buck_ex', 'mao_obra_producao')
        or (
          category.nature = 'despesa'
          and category.dre_tier = 'operacional'
          and category.dre_group in ('mao_de_obra', 'ocupacao', 'manutencao', 'servicos', 'financeiras', 'outras')
          and category.key <> 'mao_obra_producao'
        )
      )
    group by entry.competence_month
  ),
  cash_sales as (
    select
      date_trunc('month', closing.closing_date)::date as month_start,
      sum(closing.sales_amount) as counter_sales,
      sum(closing.ifood_sales_amount) as ifood_sales
    from public.cash_closings closing
    where closing.store in ('jc', 'ja')
      and closing.closing_date >= (select first_month from bounds)
      and closing.closing_date < (select current_month from bounds)
    group by date_trunc('month', closing.closing_date)::date
  ),
  production as (
    select
      date_trunc('month', actual.record_date)::date as month_start,
      sum(actual.quantity_baked) as production_quantity,
      sum(case
        when actual.production_unit = 'kg' then actual.quantity_baked
        when unit_weight.weight_kg > 0 then actual.quantity_baked
        else 0
      end) as quantity_with_known_weight,
      sum(case
        when actual.production_unit = 'kg' then actual.quantity_baked
        when unit_weight.weight_kg > 0 then actual.quantity_baked * unit_weight.weight_kg
        else 0
      end) as kilograms_with_known_weight
    from public.production_actuals actual
    left join public.products product
      on actual.product_source = 'product'
     and product.id::text = actual.product_id
    left join public.breads legacy_bread
      on legacy_bread.id = case
        when actual.product_source = 'bread' then actual.product_id
        when actual.product_source = 'product' then product.legacy_bread_id::text
        else null
      end
    left join lateral (
      select option.unit_weight_kg
      from public.product_sale_options option
      where actual.product_source = 'product'
        and option.product_id::text = actual.product_id
        and option.sale_unit = 'un'
        and option.active
        and (option.product_variant_id is not distinct from actual.product_variant_id
          or option.product_variant_id is null)
        and option.unit_weight_kg is not null
      order by (option.product_variant_id is not distinct from actual.product_variant_id) desc,
        option.is_default desc,
        option.updated_at desc nulls last,
        option.created_at desc
      limit 1
    ) sale_option on true
    left join lateral (
      select yield.average_unit_weight_kg
      from public.product_recipe_yields yield
      where actual.product_source = 'product'
        and yield.product_id::text = actual.product_id
        and yield.average_unit_weight_kg is not null
      order by yield.updated_at desc nulls last, yield.created_at desc, yield.id desc
      limit 1
    ) recipe_yield on true
    cross join lateral (
      select coalesce(
        legacy_bread.avg_unit_weight_kg,
        sale_option.unit_weight_kg,
        recipe_yield.average_unit_weight_kg
      ) as weight_kg
    ) unit_weight
    where actual.record_date >= (select first_month from bounds)
      and actual.record_date < (select current_month from bounds)
      and actual.product_source in ('bread', 'product')
    group by date_trunc('month', actual.record_date)::date
  ),
  expected_closings as (
    select
      months.month_start,
      stores.store,
      count(*) filter (where closing.id is null)::integer as missing_days
    from months
    cross join (values ('jc'::text), ('ja'::text)) stores(store)
    cross join lateral generate_series(
      months.month_start,
      (months.month_start + interval '1 month - 1 day')::date,
      interval '1 day'
    ) day(day_date)
    left join public.cash_closings closing
      on closing.store = stores.store
     and closing.closing_date = day.day_date::date
    where stores.store <> 'jc' or extract(dow from day.day_date) <> 0
    group by months.month_start, stores.store
  ),
  monthly_base as (
    select
      months.month_start,
      coalesce(cash.counter_sales, 0) as counter_sales,
      coalesce(cash.ifood_sales, 0) as ifood_sales,
      coalesce(finance.pj_buck_revenue, 0) as pj_buck_revenue,
      coalesce(cash.counter_sales, 0) + coalesce(cash.ifood_sales, 0)
        + coalesce(finance.pj_buck_revenue, 0) as revenue,
      coalesce(finance.fixed_expenses, 0) as fixed_expenses,
      coalesce(finance.production_labor, 0) as production_labor,
      coalesce(production.production_quantity, 0) as production_quantity,
      coalesce(production.quantity_with_known_weight, 0) as quantity_with_known_weight,
      coalesce(production.kilograms_with_known_weight, 0) as kilograms_with_known_weight,
      coalesce(finance.has_unassigned_labor, false) as has_unassigned_labor,
      coalesce(closings.jc_missing, 0) as jc_missing,
      coalesce(closings.ja_missing, 0) as ja_missing
    from months
    left join finance on finance.month_start = months.month_start
    left join cash_sales cash on cash.month_start = months.month_start
    left join production on production.month_start = months.month_start
    left join lateral (
      select
        sum(missing_days) filter (where store = 'jc')::integer as jc_missing,
        sum(missing_days) filter (where store = 'ja')::integer as ja_missing
      from expected_closings expected
      where expected.month_start = months.month_start
    ) closings on true
  ),
  monthly_values as (
    select
      monthly_base.*,
      case when revenue > 0 then fixed_expenses / revenue else null end as fixed_expense_pct,
      case when production_quantity > 0 then quantity_with_known_weight / production_quantity else 0 end as weight_coverage,
      case when kilograms_with_known_weight > 0 then production_labor / kilograms_with_known_weight else null end as labor_cost_per_kg
    from monthly_base
  ),
  monthly_reasons as (
    select
      metric.*,
      array_remove(array[
        case when weight_coverage < 0.9 then 'cobertura de peso ' || round(weight_coverage * 100)::text || '%' end,
        case when jc_missing > 0 then 'mês sem fechamento de caixa da JC em ' || jc_missing::text || case when jc_missing = 1 then ' dia' else ' dias' end end,
        case when ja_missing > 0 then 'mês sem fechamento de caixa da JA em ' || ja_missing::text || case when ja_missing = 1 then ' dia' else ' dias' end end,
        case when has_unassigned_labor then 'encargos e diárias sem equipe' end,
        case when revenue <= 0 then 'sem faturamento para calcular despesas fixas' end,
        case when kilograms_with_known_weight <= 0 then 'sem quilos produzidos com peso conhecido' end
      ], null) as provisional_reasons
    from monthly_values metric
  ),
  average_reasons as (
    select coalesce(array_agg(distinct reason order by reason) filter (where reason is not null), array[]::text[]) as reasons
    from monthly_reasons
    left join lateral unnest(provisional_reasons) as listed_reasons(reason) on true
  ),
  result_months as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'month', to_char(month_start, 'YYYY-MM'),
      'counter_sales', counter_sales,
      'ifood_sales', ifood_sales,
      'pj_buck_revenue', pj_buck_revenue,
      'revenue', revenue,
      'fixed_expenses', fixed_expenses,
      'fixed_expense_pct', fixed_expense_pct,
      'production_labor', production_labor,
      'kilograms_with_known_weight', kilograms_with_known_weight,
      'production_quantity', production_quantity,
      'quantity_with_known_weight', quantity_with_known_weight,
      'weight_coverage_pct', weight_coverage * 100,
      'labor_cost_per_kg', labor_cost_per_kg,
      'is_provisional', cardinality(provisional_reasons) > 0,
      'provisional_reasons', to_jsonb(provisional_reasons)
    ) order by month_start), '[]'::jsonb) as rows
    from monthly_reasons
  ),
  averages as (
    select
      count(*)::integer as month_count,
      sum(revenue) as revenue_total,
      sum(fixed_expenses) as fixed_expenses_total,
      sum(production_labor) as production_labor_total,
      sum(kilograms_with_known_weight) as kilograms_total,
      sum(production_quantity) as production_quantity_total,
      sum(quantity_with_known_weight) as quantity_with_weight_total,
      bool_or(cardinality(provisional_reasons) > 0) as is_provisional
    from monthly_reasons
  )
  select jsonb_build_object(
    'months', result_months.rows,
    'average', case when averages.month_count = 0 then null else jsonb_build_object(
      'months_included', (select jsonb_agg(value->>'month' order by value->>'month') from jsonb_array_elements(result_months.rows) value),
      'month_count', averages.month_count,
      'revenue', averages.revenue_total / averages.month_count,
      'fixed_expenses', averages.fixed_expenses_total / averages.month_count,
      'fixed_expense_pct', case when averages.revenue_total > 0 then averages.fixed_expenses_total / averages.revenue_total else null end,
      'production_labor', averages.production_labor_total / averages.month_count,
      'kilograms_with_known_weight', averages.kilograms_total / averages.month_count,
      'production_quantity', averages.production_quantity_total / averages.month_count,
      'quantity_with_known_weight', averages.quantity_with_weight_total / averages.month_count,
      'weight_coverage_pct', case when averages.production_quantity_total > 0 then averages.quantity_with_weight_total / averages.production_quantity_total * 100 else 0 end,
      'labor_cost_per_kg', case when averages.kilograms_total > 0 then averages.production_labor_total / averages.kilograms_total else null end,
      'is_provisional', coalesce(averages.is_provisional, false),
      'provisional_reasons', to_jsonb(average_reasons.reasons)
    ) end
  )
  from result_months
  cross join averages
  cross join average_reasons;
$$;

revoke all on function private.pricing_financial_indicators_report(date) from public, anon, authenticated;

create or replace function public.get_pricing_financial_indicators()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.current_user_is_access_admin()) then
    raise exception using errcode = '42501', message = 'Apenas administradores podem consultar os indicadores de preço.';
  end if;

  return private.pricing_financial_indicators_report(private.data_na_padaria());
end;
$$;

revoke all on function public.get_pricing_financial_indicators() from public, anon, authenticated;
grant execute on function public.get_pricing_financial_indicators() to authenticated;

commit;
