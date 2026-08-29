-- Evita que um INSERT ... ON CONFLICT conte duas vezes a propria reserva
-- existente antes de o Postgres transformar a operacao em UPDATE.
create or replace function private.guard_production_plan_frozen_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stock numeric;
  v_reserved numeric;
  v_excluded_plan_item_id uuid;
begin
  if new.frozen_quantity <= 0 then return new; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('frozen:' || new.store || ':' || new.bread_id, 0)
  );

  if tg_op = 'UPDATE' then
    v_excluded_plan_item_id := old.id;
  else
    select item.id
    into v_excluded_plan_item_id
    from public.production_plan_items item
    where item.plan_id = new.plan_id
      and item.store = new.store
      and item.bread_id = new.bread_id;
  end if;

  v_stock := private.frozen_stock_for_bread_store(new.bread_id, new.store);
  v_reserved := private.reserved_frozen_for_bread_store(
    new.bread_id,
    new.store,
    v_excluded_plan_item_id
  );

  if v_reserved + new.frozen_quantity > v_stock then
    raise exception using
      errcode = '22023',
      message = 'O congelado disponivel ja esta reservado por outro planejamento.';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_production_plan_frozen_balance()
  from public, anon, authenticated;
grant execute on function private.guard_production_plan_frozen_balance()
  to service_role;
