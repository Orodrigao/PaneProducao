begin;

-- Pedido PJ por peso (pricing_unit = 'kg') de um pão vendido por unidade
-- somava kg direto com unidades no previsto do Forno, gerando previsto
-- fracionado (ex.: 12.8) que o Forno recusa confirmar, porque pão 'un'
-- só aceita inteiro. O pão continua com um único cadastro: o peso médio só
-- converte peso em peças para o previsto do Forno, nunca cria pão duplicado.
alter table public.breads
  add column if not exists avg_unit_weight_kg numeric;

alter table public.breads
  add constraint breads_avg_unit_weight_kg_positive
  check (avg_unit_weight_kg is null or avg_unit_weight_kg > 0);

comment on column public.breads.avg_unit_weight_kg is
  'Peso medio de uma unidade assada, em kg. Usado so para converter pedido '
  'PJ cobrado por peso em quantidade de pecas no previsto do Forno; nao '
  'afeta como o pedido e cobrado.';

-- Redefine list_pj_production_for_oven_v2: quando a linha programada veio de
-- um pedido cobrado por peso (schedule.production_unit = 'kg') mas o pao em
-- si e vendido por unidade, converte pelo peso medio antes de somar. Sem
-- peso cadastrado, a trava fica fechada: o peso em kg fica fora da soma e
-- needs_weight_setup avisa, em vez de devolver fracao quebrada ou derrubar
-- o previsto inteiro.
drop function if exists public.list_pj_production_for_oven_v2(date);

create function public.list_pj_production_for_oven_v2(p_production_date date)
returns table (
  product_source text,
  product_id text,
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
      coalesce(bread.name, schedule.product_name) as row_name,
      case
        when schedule.bread_id is not null then coalesce(bread.unit, 'un')
        else coalesce(schedule.production_unit, 'un')
      end as target_unit,
      bread.avg_unit_weight_kg as avg_unit_weight_kg,
      (schedule.bread_id is not null) as is_legacy_bread,
      schedule.production_unit as row_unit,
      (schedule.scheduled_quantity - schedule.frozen_quantity) as pending_quantity
    from public.pj_production_schedules schedule
    join public.orders order_row on order_row.id = schedule.order_id
    left join public.breads bread on bread.id = schedule.bread_id
    where schedule.production_date = p_production_date
      and order_row.cancelled_at is null
      and schedule.production_process = 'forno'
      and schedule.scheduled_quantity > schedule.frozen_quantity
  ),
  aggregated as (
    select
      row_source,
      row_id,
      max(row_name) as row_name,
      max(target_unit) as target_unit,
      max(avg_unit_weight_kg) as avg_unit_weight_kg,
      sum(pending_quantity) filter (
        where not (is_legacy_bread and row_unit = 'kg' and target_unit <> 'kg')
      ) as native_quantity,
      sum(pending_quantity) filter (
        where is_legacy_bread and row_unit = 'kg' and target_unit <> 'kg'
      ) as kg_quantity_to_convert
    from schedule_rows
    group by row_source, row_id
  )
  select
    row_source,
    row_id,
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
  order by row_name, row_id;
end;
$$;

revoke all on function public.list_pj_production_for_oven_v2(date)
  from public, anon, authenticated;
grant execute on function public.list_pj_production_for_oven_v2(date)
  to authenticated, service_role;

commit;
