begin;

-- O Forno apenas consulta a programação criada pela Produção PJ. Exigir a
-- permissão de programar para essa leitura retirava da tela quem opera o forno.
-- Mantemos os programadores atuais e acrescentamos somente quem já recebeu a
-- permissão operacional do Forno na unidade JC.
create or replace function public.list_pj_production_for_oven(p_production_date date)
returns table (
  bread_id text,
  quantity numeric
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
  select
    schedule.bread_id,
    sum(schedule.scheduled_quantity - schedule.frozen_quantity)::numeric
  from public.pj_production_schedules schedule
  join public.orders order_row on order_row.id = schedule.order_id
  where schedule.production_date = p_production_date
    and order_row.cancelled_at is null
    and schedule.scheduled_quantity > schedule.frozen_quantity
  group by schedule.bread_id
  order by schedule.bread_id;
end;
$$;

revoke all on function public.list_pj_production_for_oven(date)
  from public, anon, authenticated;
grant execute on function public.list_pj_production_for_oven(date)
  to authenticated, service_role;

create or replace function public.list_pj_production_for_oven_v2(p_production_date date)
returns table (
  product_source text,
  product_id text,
  product_name text,
  production_unit text,
  quantity numeric
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
  select
    case when schedule.bread_id is not null then 'bread' else schedule.product_source end,
    coalesce(schedule.bread_id, schedule.product_id),
    coalesce(bread.name, schedule.product_name),
    coalesce(bread.unit, schedule.production_unit, 'un'),
    sum(schedule.scheduled_quantity - schedule.frozen_quantity)::numeric
  from public.pj_production_schedules schedule
  join public.orders order_row on order_row.id = schedule.order_id
  left join public.breads bread on bread.id = schedule.bread_id
  where schedule.production_date = p_production_date
    and order_row.cancelled_at is null
    and schedule.production_process = 'forno'
    and schedule.scheduled_quantity > schedule.frozen_quantity
  group by 1, 2, 3, 4
  order by 3, 2;
end;
$$;

revoke all on function public.list_pj_production_for_oven_v2(date)
  from public, anon, authenticated;
grant execute on function public.list_pj_production_for_oven_v2(date)
  to authenticated, service_role;

commit;
