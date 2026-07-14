-- Permite registrar o fato fisico da sobra antes da confirmacao do Forno.
-- O registro recebe um lote operacional provisório LMMDD e fica explicitamente
-- aguardando conciliacao. A confirmacao real do Forno liga a sobra e seus
-- movimentos ao production_actual correspondente, sem inventar producao.

alter table public.sobras
  add column if not exists reconciliation_status text;

update public.sobras
set reconciliation_status = case
  when store is null then null
  when production_actual_id is not null then 'confirmed'
  when quantity = 0 then 'not_required'
  else 'awaiting_oven'
end
where reconciliation_status is null;

alter table public.sobras
  drop constraint if exists sobras_reconciliation_status_check,
  add constraint sobras_reconciliation_status_check
    check (
      reconciliation_status is null
      or reconciliation_status in ('awaiting_oven', 'confirmed', 'not_required')
    );

alter table public.sobras
  drop constraint if exists sobras_managed_fields_check,
  add constraint sobras_managed_fields_check
    check (
      store is null
      or (
        product_source = 'bread'
        and product_id is not null
        and lot_code is not null
        and pending_quantity is not null
        and status is not null
        and physical_location is not null
        and reconciliation_status is not null
        and (
          reconciliation_status in ('awaiting_oven', 'not_required')
          or production_actual_id is not null
        )
      )
    );

drop index if exists public.sobras_managed_batch_unique_idx;

create unique index if not exists sobras_managed_closing_unique_idx
  on public.sobras(store, product_id, record_date)
  where store is not null and product_source = 'bread';

create index if not exists sobras_awaiting_oven_idx
  on public.sobras(record_date, product_id, store)
  where reconciliation_status = 'awaiting_oven';

comment on column public.sobras.reconciliation_status is
  'confirmed: ligado ao Forno; awaiting_oven: fato fisico salvo antes do Forno; not_required: fechamento corrigido para zero.';

create or replace function public.register_bread_leftovers(
  p_record_date date,
  p_store text,
  p_items jsonb,
  p_physical_location text default 'balcao_fechamento'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile_name text;
  v_profile_role text;
  v_profile_store text;
  v_item jsonb;
  v_bread_id text;
  v_quantity numeric;
  v_actual_id uuid;
  v_lot_code text;
  v_reconciliation_status text;
  v_sobra public.sobras%rowtype;
  v_resolved numeric;
  v_pending numeric;
  v_sobra_found boolean;
  v_count integer := 0;
  v_awaiting_count integer := 0;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Entre com e-mail para registrar sobras.';
  end if;

  select display_name, role, store
  into v_profile_name, v_profile_role, v_profile_store
  from public.app_profiles
  where user_id = v_user_id and active;

  if not found or v_profile_role not in ('admin', 'producao', 'vendas') then
    raise exception using errcode = '42501', message = 'Usuario sem permissao para registrar sobras.';
  end if;

  if p_record_date is null or p_store not in ('jc', 'ja') then
    raise exception using errcode = '22023', message = 'Informe data e loja JC ou JA.';
  end if;

  if p_record_date > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception using errcode = '22023', message = 'A data do fechamento nao pode estar no futuro.';
  end if;

  if v_profile_role = 'vendas' and v_profile_store is distinct from p_store then
    raise exception using errcode = '42501', message = 'A atendente so pode registrar a propria loja.';
  end if;

  if p_physical_location not in ('balcao_fechamento', 'mesa_separacao', 'padaria_cozinha') then
    raise exception using errcode = '22023', message = 'Local fisico invalido.';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then
    raise exception using errcode = '22023', message = 'Lista de sobras invalida.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('leftovers:' || p_store || ':' || p_record_date::text, 0)
  );

  if exists (
    select 1 from public.sobras
    where store = p_store
      and pending_quantity > 0
      and record_date < p_record_date
  ) then
    raise exception using
      errcode = '23514',
      message = 'Resolva as sobras pendentes do dia anterior antes de fechar hoje.';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_bread_id := nullif(btrim(v_item ->> 'bread_id'), '');
    if v_bread_id is null
      or coalesce(v_item ->> 'quantity', '') !~ '^([0-9]+)([.][0-9]+)?$' then
      raise exception using errcode = '22023', message = 'Pao ou quantidade invalida na lista.';
    end if;

    v_quantity := (v_item ->> 'quantity')::numeric;
    if v_quantity < 0 then
      raise exception using errcode = '22023', message = 'Quantidade nao pode ser negativa.';
    end if;

    if not exists (
      select 1
      from public.breads
      where id = v_bread_id and active and not coalesce(is_pj, false)
    ) then
      raise exception using errcode = '23503', message = 'Pao ativo nao encontrado.';
    end if;

    select id, lot_code
    into v_actual_id, v_lot_code
    from public.production_actuals
    where bread_id = v_bread_id and record_date = p_record_date;

    if v_actual_id is null then
      v_lot_code := 'L' || to_char(p_record_date, 'MMDD');
    end if;

    v_reconciliation_status := case
      when v_quantity = 0 and v_actual_id is null then 'not_required'
      when v_actual_id is null then 'awaiting_oven'
      else 'confirmed'
    end;

    select * into v_sobra
    from public.sobras
    where store = p_store
      and product_source = 'bread'
      and product_id = v_bread_id
      and record_date = p_record_date
    for update;
    v_sobra_found := found;

    if v_quantity = 0 and not v_sobra_found then
      continue;
    end if;

    if not v_sobra_found then
      insert into public.sobras (
        record_date, responsible, product_id, product_source, quantity,
        store, production_actual_id, lot_code, pending_quantity, status,
        physical_location, reconciliation_status, updated_at
      ) values (
        p_record_date, v_profile_name, v_bread_id, 'bread', v_quantity,
        p_store, v_actual_id, v_lot_code, v_quantity,
        case when v_quantity > 0 then 'pending' else 'cancelled' end,
        p_physical_location, v_reconciliation_status, now()
      )
      returning * into v_sobra;

      insert into public.bread_leftover_events (
        sobra_id, action, quantity, to_location, actor_id, actor_name, obs
      ) values (
        v_sobra.id, 'registered', v_quantity, p_physical_location,
        v_user_id, v_profile_name,
        case when v_actual_id is null then 'Registrada antes da confirmacao do Forno.' else null end
      );
    else
      v_resolved := v_sobra.quantity - v_sobra.pending_quantity;
      if v_quantity < v_resolved then
        raise exception using
          errcode = '23514',
          message = 'A nova quantidade e menor que o total que ja recebeu destino.';
      end if;

      v_pending := v_quantity - v_resolved;
      update public.sobras
      set quantity = v_quantity,
          pending_quantity = v_pending,
          status = case
            when v_quantity = 0 then 'cancelled'
            when v_pending > 0 then 'pending'
            else 'resolved'
          end,
          physical_location = p_physical_location,
          responsible = v_profile_name,
          production_actual_id = coalesce(v_actual_id, production_actual_id),
          lot_code = coalesce(v_lot_code, lot_code),
          reconciliation_status = case
            when coalesce(v_actual_id, production_actual_id) is not null then 'confirmed'
            else v_reconciliation_status
          end,
          updated_at = now()
      where id = v_sobra.id;

      insert into public.bread_leftover_events (
        sobra_id, action, quantity, from_location, to_location,
        actor_id, actor_name, obs
      ) values (
        v_sobra.id, 'corrected', v_quantity, v_sobra.physical_location,
        p_physical_location, v_user_id, v_profile_name,
        case
          when v_actual_id is null
            then 'Quantidade total corrigida; destinos anteriores preservados; aguardando Forno.'
          else 'Quantidade total corrigida; destinos anteriores preservados.'
        end
      );
    end if;

    if v_reconciliation_status = 'awaiting_oven' then
      v_awaiting_count := v_awaiting_count + 1;
    end if;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'saved_items', v_count,
    'awaiting_oven_items', v_awaiting_count,
    'store', p_store,
    'record_date', p_record_date
  );
end;
$$;

comment on function public.register_bread_leftovers(date, text, jsonb, text) is
  'Registra a contagem fisica de JC/JA mesmo antes do Forno e marca a conciliacao pendente sem criar producao.';

revoke all on function public.register_bread_leftovers(date, text, jsonb, text) from public;
revoke all on function public.register_bread_leftovers(date, text, jsonb, text) from anon;
grant execute on function public.register_bread_leftovers(date, text, jsonb, text) to authenticated;
grant execute on function public.register_bread_leftovers(date, text, jsonb, text) to service_role;

create or replace function public.reconcile_bread_leftovers_after_oven()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.sobras
  set production_actual_id = new.id,
      lot_code = new.lot_code,
      reconciliation_status = case
        when quantity = 0 then 'not_required'
        else 'confirmed'
      end,
      updated_at = now()
  where store in ('jc', 'ja')
    and product_source = 'bread'
    and product_id = new.bread_id
    and record_date = new.record_date
    and reconciliation_status = 'awaiting_oven';

  update public.bread_movements as movement
  set lot_id = new.id
  from public.bread_leftover_events as event
  join public.sobras as sobra on sobra.id = event.sobra_id
  where movement.reference_type = 'bread_leftover_event'
    and movement.reference_id = event.id::text
    and sobra.store in ('jc', 'ja')
    and sobra.product_source = 'bread'
    and sobra.product_id = new.bread_id
    and sobra.record_date = new.record_date
    and movement.lot_id is distinct from new.id;

  return new;
end;
$$;

comment on function public.reconcile_bread_leftovers_after_oven() is
  'Trigger interno que liga sobras e destinos provisórios ao lote real quando o Forno e confirmado.';

revoke all on function public.reconcile_bread_leftovers_after_oven() from public;
revoke all on function public.reconcile_bread_leftovers_after_oven() from anon;
revoke all on function public.reconcile_bread_leftovers_after_oven() from authenticated;

drop trigger if exists reconcile_bread_leftovers_after_oven
  on public.production_actuals;

create trigger reconcile_bread_leftovers_after_oven
after insert or update of lot_code on public.production_actuals
for each row execute function public.reconcile_bread_leftovers_after_oven();
