-- O Romaneio precisa conhecer apenas a composição operacional da remessa.
-- O planejamento completo continua restrito ao acesso administrativo.
create or replace function public.get_romaneio_production_composition(
  p_production_date date,
  p_store text
)
returns table (
  bread_id text,
  planned_quantity numeric,
  frozen_quantity numeric,
  leftover_quantity numeric,
  new_quantity numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store text := lower(trim(coalesce(p_store, '')));
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Entre com e-mail para consultar a composição do Romaneio.';
  end if;

  if p_production_date is null or v_store not in ('jc', 'ja') then
    raise exception using errcode = '22023', message = 'Data ou loja inválida para a composição do Romaneio.';
  end if;

  if not (
    (select private.current_user_has_permission('romaneio.visualizar', v_store))
    or (select private.current_user_has_permission('romaneio.criar', v_store))
    or (select private.current_user_has_permission('romaneio.administrar', v_store))
  ) then
    raise exception using errcode = '42501', message = 'Sem permissão para consultar a composição desta loja.';
  end if;

  return query
  select
    item.bread_id,
    greatest(0, item.planned_quantity)::numeric,
    greatest(0, item.frozen_quantity)::numeric,
    greatest(0, coalesce(reuse.confirmed_quantity, item.leftover_confirmed_quantity, 0))::numeric,
    greatest(
      0,
      item.planned_quantity
        - item.frozen_quantity
        - coalesce(reuse.confirmed_quantity, item.leftover_confirmed_quantity, 0)
    )::numeric
  from public.production_plans plan
  join public.production_plan_items item on item.plan_id = plan.id
  left join (
    select
      reuse_plan.bread_id,
      sum(greatest(0, reuse_plan.confirmed_quantity))::numeric as confirmed_quantity
    from public.bread_reuse_plans reuse_plan
    where reuse_plan.target_production_date = p_production_date
      and lower(reuse_plan.store) = v_store
      and reuse_plan.status = 'confirmed'
    group by reuse_plan.bread_id
  ) reuse on reuse.bread_id = item.bread_id
  where plan.production_date = p_production_date
    and item.store = v_store
  order by item.bread_id;
end;
$$;

alter function public.get_romaneio_production_composition(date, text) owner to postgres;
revoke all on function public.get_romaneio_production_composition(date, text) from public, anon, authenticated;
grant execute on function public.get_romaneio_production_composition(date, text) to authenticated;
