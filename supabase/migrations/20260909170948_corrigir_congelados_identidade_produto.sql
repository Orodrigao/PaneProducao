-- O estoque congelado aceita tanto a identidade historica do pao quanto a
-- identidade do catalogo de produtos. Enquanto o planejamento ainda grava
-- bread_id, produtos do catalogo so entram nesta composicao quando possuem a
-- equivalencia explicita legacy_bread_id. Nunca inferimos por nome.
--
-- Durante a transicao pode existir um frozen_product antigo (bread) e outro
-- novo (product) para o mesmo item fisico. Nesse caso o cadastro antigo segue
-- como fonte oficial e o novo nao e somado, evitando prometer o mesmo estoque
-- duas vezes. O cadastro novo assume apenas quando nao existe fonte bread ativa.

create or replace function private.frozen_stock_for_bread_store(
  p_bread_id text,
  p_store text
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(stock.quantity), 0)::numeric
  from public.frozen_stock stock
  join public.frozen_products frozen_product
    on frozen_product.id = stock.frozen_product_id
   and frozen_product.active
  left join public.products catalog_product
    on frozen_product.product_source = 'product'
   and catalog_product.id::text = frozen_product.product_id
  left join public.breads canonical_bread
    on canonical_bread.id = catalog_product.legacy_bread_id
  where (
    (
      frozen_product.product_source = 'bread'
      and frozen_product.product_id = p_bread_id
    )
    or (
      frozen_product.product_source = 'product'
      and catalog_product.active
      and catalog_product.legacy_bread_id = p_bread_id
      and canonical_bread.id is not null
      and lower(trim(catalog_product.unit)) = lower(trim(canonical_bread.unit))
      and lower(trim(frozen_product.unit)) = lower(trim(canonical_bread.unit))
      and not exists (
        select 1
        from public.frozen_products legacy_frozen_product
        where legacy_frozen_product.active
          and legacy_frozen_product.product_source = 'bread'
          and legacy_frozen_product.product_id = catalog_product.legacy_bread_id
          and (
            (legacy_frozen_product.store is null and legacy_frozen_product.visible_stores is null)
            or lower(legacy_frozen_product.store) = lower(p_store)
            or lower(p_store) = any(coalesce(legacy_frozen_product.visible_stores, '{}'::text[]))
          )
      )
    )
  )
  and case
    when lower(stock.location) in ('freezer', 'camara', 'freezer_loja') then 'jc'
    when lower(stock.location) like 'jc-%' then 'jc'
    when lower(stock.location) like 'ja-%' then 'ja'
    else null
  end = lower(p_store)
  and (
    (frozen_product.store is null and frozen_product.visible_stores is null)
    or lower(frozen_product.store) = lower(p_store)
    or lower(p_store) = any(coalesce(frozen_product.visible_stores, '{}'::text[]))
  );
$$;

comment on function private.frozen_stock_for_bread_store(text, text) is
  'Calcula congelado pela identidade canonica: bread tem precedencia; product ativo assume sem duplicar quando possui legacy_bread_id e unidade compativel.';

revoke all on function private.frozen_stock_for_bread_store(text, text)
  from public, anon, authenticated;
grant execute on function private.frozen_stock_for_bread_store(text, text)
  to service_role;

create or replace function public.list_frozen_production_availability(
  p_target_plan_date date default null
)
returns table (
  store text,
  bread_id text,
  available_quantity numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.current_user_can_plan_pj_production() then
    raise exception using errcode = '42501', message = 'Usuario sem permissao para planejar a producao.';
  end if;

  return query
  with stock_rows as (
    select
      case
        when frozen_product.product_source = 'bread' then frozen_product.product_id
        when frozen_product.product_source = 'product' then catalog_product.legacy_bread_id
        else null
      end as bread_id,
      case
        when lower(item.location) in ('freezer', 'camara', 'freezer_loja') then 'jc'
        when lower(item.location) like 'jc-%' then 'jc'
        when lower(item.location) like 'ja-%' then 'ja'
        else null
      end as store,
      item.quantity,
      frozen_product.store as product_store,
      frozen_product.visible_stores
    from public.frozen_stock item
    join public.frozen_products frozen_product
      on frozen_product.id = item.frozen_product_id
     and frozen_product.active
    left join public.products catalog_product
      on frozen_product.product_source = 'product'
     and catalog_product.id::text = frozen_product.product_id
    left join public.breads canonical_bread
      on canonical_bread.id = catalog_product.legacy_bread_id
    where (
        frozen_product.product_source = 'bread'
        and frozen_product.product_id is not null
      )
      or (
        frozen_product.product_source = 'product'
        and catalog_product.active
        and canonical_bread.id is not null
        and lower(trim(catalog_product.unit)) = lower(trim(canonical_bread.unit))
        and lower(trim(frozen_product.unit)) = lower(trim(canonical_bread.unit))
        and not exists (
          select 1
          from public.frozen_products legacy_frozen_product
          where legacy_frozen_product.active
            and legacy_frozen_product.product_source = 'bread'
            and legacy_frozen_product.product_id = catalog_product.legacy_bread_id
            and (
              (legacy_frozen_product.store is null and legacy_frozen_product.visible_stores is null)
              or lower(legacy_frozen_product.store) = case
                when lower(item.location) in ('freezer', 'camara', 'freezer_loja') then 'jc'
                when lower(item.location) like 'jc-%' then 'jc'
                when lower(item.location) like 'ja-%' then 'ja'
                else null
              end
              or case
                when lower(item.location) in ('freezer', 'camara', 'freezer_loja') then 'jc'
                when lower(item.location) like 'jc-%' then 'jc'
                when lower(item.location) like 'ja-%' then 'ja'
                else null
              end = any(coalesce(legacy_frozen_product.visible_stores, '{}'::text[]))
            )
        )
      )
  ), stock as (
    select
      stock_rows.bread_id,
      stock_rows.store,
      sum(stock_rows.quantity)::numeric as quantity
    from stock_rows
    where stock_rows.store in ('jc', 'ja')
      and (
        (stock_rows.product_store is null and stock_rows.visible_stores is null)
        or lower(stock_rows.product_store) = stock_rows.store
        or stock_rows.store = any(coalesce(stock_rows.visible_stores, '{}'::text[]))
      )
    group by stock_rows.bread_id, stock_rows.store
  ), store_reserved as (
    select plan_item.store, plan_item.bread_id, sum(plan_item.frozen_quantity)::numeric as quantity
    from public.production_plan_items plan_item
    join public.production_plans plan on plan.id = plan_item.plan_id
    where plan.production_date >= private.data_na_padaria()
      and (p_target_plan_date is null or plan.production_date <> p_target_plan_date)
    group by plan_item.store, plan_item.bread_id
  ), pj_reserved as (
    select schedule.bread_id, sum(schedule.frozen_quantity)::numeric as quantity
    from public.pj_production_schedules schedule
    where schedule.production_date >= private.data_na_padaria()
    group by schedule.bread_id
  )
  select
    stock.store,
    stock.bread_id,
    greatest(
      0,
      stock.quantity
        - coalesce(store_reserved.quantity, 0)
        - case when stock.store = 'jc' then coalesce(pj_reserved.quantity, 0) else 0 end
    )::numeric as available_quantity
  from stock
  left join store_reserved
    on store_reserved.store = stock.store
   and store_reserved.bread_id = stock.bread_id
  left join pj_reserved on pj_reserved.bread_id = stock.bread_id
  where stock.store in ('jc', 'ja')
  order by stock.store, stock.bread_id;
end;
$$;

comment on function public.list_frozen_production_availability(date) is
  'Lista saldo congelado por pao e loja: bread tem precedencia; product ativo assume sem duplicar quando possui legacy_bread_id e unidade compativel.';

revoke all on function public.list_frozen_production_availability(date)
  from public, anon, authenticated;
grant execute on function public.list_frozen_production_availability(date)
  to authenticated, service_role;
