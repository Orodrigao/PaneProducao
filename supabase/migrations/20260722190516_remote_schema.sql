


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "private"."current_user_has_permission"("p_permission_key" "text", "p_scope" "text" DEFAULT '*'::"text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$ select exists(select 1 from public.app_profiles profile join public.app_user_permissions permission on permission.user_id=profile.user_id where profile.user_id=(select auth.uid()) and profile.active and permission.permission_key=p_permission_key and (permission.scope='*' or permission.scope=lower(p_scope))); $$;


ALTER FUNCTION "private"."current_user_has_permission"("p_permission_key" "text", "p_scope" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."current_user_is_access_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1 from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active and profile.role = 'admin'
  );
$$;


ALTER FUNCTION "private"."current_user_is_access_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."guard_dispatched_pj_order_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if old.order_type = 'pj' and old.dispatched_at is not null
    and coalesce(current_setting('pane.pj_dispatch_rpc', true), '') <> 'on'
  then
    raise exception using
      errcode = '42501',
      message = 'Pedido enviado nao pode mais ser alterado ou excluido.';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."guard_dispatched_pj_order_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."guard_pj_dispatch_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if coalesce(current_setting('pane.pj_dispatch_rpc', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      if new.dispatched_at is not null
        or new.dispatched_by is not null
        or new.dispatched_by_name is not null
      then
        raise exception using
          errcode = '42501',
          message = 'A confirmacao de envio exige a acao protegida.';
      end if;
    elsif new.dispatched_at is distinct from old.dispatched_at
      or new.dispatched_by is distinct from old.dispatched_by
      or new.dispatched_by_name is distinct from old.dispatched_by_name
    then
      raise exception using
        errcode = '42501',
        message = 'A confirmacao de envio exige a acao protegida.';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "private"."guard_pj_dispatch_write"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."pizza_is_allowed"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.pizza_usuarios usuario
    where pg_catalog.lower(usuario.email) =
      pg_catalog.lower(coalesce((select auth.jwt()) ->> 'email', ''))
  );
$$;


ALTER FUNCTION "private"."pizza_is_allowed"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."approve_romaneio_divergence"("p_romaneio_id" "uuid" DEFAULT NULL::"uuid", "p_item_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$ declare v_romaneio_id uuid; v_destination_code text; begin if (p_romaneio_id is null)=(p_item_id is null) then raise exception using errcode='22023',message='Informe o romaneio ou um item.'; end if; if p_item_id is not null then select item.romaneio_id into v_romaneio_id from public.romaneio_items item where item.id=p_item_id; else v_romaneio_id:=p_romaneio_id; end if; select destination.code into v_destination_code from public.romaneios romaneio join public.destinations destination on destination.id=romaneio.destination_id where romaneio.id=v_romaneio_id for update of romaneio; if not found then raise exception using errcode='P0002',message='Romaneio nao encontrado.'; end if; if not (select private.current_user_has_permission('romaneio.aprovar_divergencia',v_destination_code)) then raise exception using errcode='42501',message='Sem permissao para aprovar esta divergencia.'; end if; if p_item_id is null then update public.romaneio_items set item_status='aprovado' where romaneio_id=v_romaneio_id and item_status='divergencia'; else update public.romaneio_items set item_status='aprovado' where id=p_item_id and romaneio_id=v_romaneio_id and item_status='divergencia'; if not found then raise exception using errcode='22023',message='Item sem divergencia pendente.'; end if; end if; if not exists(select 1 from public.romaneio_items where romaneio_id=v_romaneio_id and item_status='divergencia') then update public.romaneios set status='aprovado' where id=v_romaneio_id; end if; end; $$;


ALTER FUNCTION "public"."approve_romaneio_divergence"("p_romaneio_id" "uuid", "p_item_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_bread_reuse_plan"("p_plan_id" "uuid", "p_confirmed_quantity" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_profile_name text;
  v_profile_role text;
  v_plan public.bread_reuse_plans%rowtype;
  v_allocation record;
  v_sobra record;
  v_available numeric;
  v_order_quantity numeric;
  v_remaining integer;
  v_take integer;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Entre com e-mail para confirmar o reaproveitamento.';
  end if;

  select display_name, role into v_profile_name, v_profile_role
  from public.app_profiles
  where user_id = v_user_id and active;

  if not found or v_profile_role not in ('admin', 'producao') then
    raise exception using errcode = '42501', message = 'Usuario sem permissao para conferir reaproveitamento.';
  end if;

  if p_confirmed_quantity is null or p_confirmed_quantity < 0 then
    raise exception using errcode = '22023', message = 'Quantidade confirmada invalida.';
  end if;

  select * into v_plan
  from public.bread_reuse_plans
  where id = p_plan_id
  for update;

  if not found or v_plan.status = 'cancelled' then
    raise exception using errcode = 'P0002', message = 'Proposta de reaproveitamento nao encontrada.';
  end if;

  if p_confirmed_quantity > v_plan.proposed_quantity then
    raise exception using errcode = '23514', message = 'A confirmacao nao pode superar o que foi proposto.';
  end if;

  perform 1
  from public.sobras
  where store = v_plan.store
    and product_source = 'bread'
    and product_id = v_plan.bread_id
    and record_date < v_plan.target_production_date
  order by record_date, id
  for update;

  for v_allocation in
    select allocation.sobra_id, allocation.quantity
    from public.bread_reuse_plan_allocations as allocation
    where allocation.plan_id = v_plan.id
    order by allocation.sobra_id
  loop
    update public.sobras
    set pending_quantity = pending_quantity + v_allocation.quantity,
        status = 'pending',
        updated_at = now()
    where id = v_allocation.sobra_id;

    insert into public.bread_leftover_events (
      sobra_id, reuse_plan_id, action, quantity, actor_id, actor_name, obs
    ) values (
      v_allocation.sobra_id, v_plan.id, 'reuse_reversed', v_allocation.quantity,
      v_user_id, v_profile_name, 'Alocacao anterior devolvida antes da correcao.'
    );
  end loop;

  delete from public.bread_reuse_plan_allocations where plan_id = v_plan.id;

  select coalesce(sum(floor(pending_quantity)), 0) into v_available
  from public.sobras
  where store = v_plan.store
    and product_source = 'bread'
    and product_id = v_plan.bread_id
    and record_date < v_plan.target_production_date
    and pending_quantity > 0;

  select coalesce(sum(quantity), 0) into v_order_quantity
  from public.orders
  where order_date = v_plan.target_production_date
    and store = v_plan.store
    and bread_id = v_plan.bread_id;

  if p_confirmed_quantity > v_available or p_confirmed_quantity > v_order_quantity then
    raise exception using
      errcode = '23514',
      message = 'Quantidade confirmada supera a sobra disponivel ou o pedido da loja.';
  end if;

  v_remaining := p_confirmed_quantity;
  for v_sobra in
    select id, pending_quantity, physical_location
    from public.sobras
    where store = v_plan.store
      and product_source = 'bread'
      and product_id = v_plan.bread_id
      and record_date < v_plan.target_production_date
      and pending_quantity > 0
    order by record_date, created_at, id
  loop
    exit when v_remaining = 0;
    v_take := least(v_remaining, floor(v_sobra.pending_quantity)::integer);
    if v_take <= 0 then continue; end if;

    update public.sobras
    set pending_quantity = pending_quantity - v_take,
        status = case when pending_quantity - v_take = 0 then 'resolved' else 'pending' end,
        updated_at = now()
    where id = v_sobra.id;

    insert into public.bread_reuse_plan_allocations(plan_id, sobra_id, quantity)
    values (v_plan.id, v_sobra.id, v_take);

    insert into public.bread_leftover_events (
      sobra_id, reuse_plan_id, action, quantity, from_location, to_location,
      actor_id, actor_name, obs
    ) values (
      v_sobra.id, v_plan.id, 'reuse_confirmed', v_take,
      v_sobra.physical_location, 'vitrine', v_user_id, v_profile_name,
      'Reaproveitamento confirmado para reduzir a producao nova.'
    );

    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining > 0 then
    raise exception using errcode = '23514', message = 'Nao foi possivel alocar toda a quantidade confirmada.';
  end if;

  update public.bread_reuse_plans
  set confirmed_quantity = p_confirmed_quantity,
      status = 'confirmed',
      confirmed_by = v_user_id,
      confirmed_by_name = v_profile_name,
      confirmed_at = now(),
      updated_at = now()
  where id = v_plan.id;

  return jsonb_build_object(
    'plan_id', v_plan.id,
    'confirmed_quantity', p_confirmed_quantity,
    'bread_id', v_plan.bread_id,
    'store', v_plan.store
  );
end;
$$;


ALTER FUNCTION "public"."confirm_bread_reuse_plan"("p_plan_id" "uuid", "p_confirmed_quantity" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_oven_output"("p_record_date" "date", "p_bread_id" "text", "p_quantity_good" integer, "p_quantity_loss" integer DEFAULT 0, "p_loss_reason" "text" DEFAULT NULL::"text", "p_obs" "text" DEFAULT NULL::"text") RETURNS TABLE("production_actual_id" "uuid", "returned_lot_code" "text", "returned_quantity_good" integer, "returned_quantity_loss" integer, "returned_loss_reason" "text", "confirmed_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_profile_name text;
  v_profile_role text;
  v_lot_code text;
  v_loss_reason text;
  v_actual_id uuid;
  v_previous_good numeric;
  v_previous_loss numeric;
  v_confirmed_at timestamptz := now();
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'E necessario entrar com e-mail para confirmar o forno.';
  end if;

  select profile.display_name, profile.role
  into v_profile_name, v_profile_role
  from public.app_profiles as profile
  where profile.user_id = v_user_id
    and profile.active;

  if not found or v_profile_role not in ('admin', 'producao') then
    raise exception using
      errcode = '42501',
      message = 'Usuario sem permissao para confirmar o forno.';
  end if;

  if p_record_date is null then
    raise exception using errcode = '22004', message = 'Informe a data de producao.';
  end if;

  if p_quantity_good is null or p_quantity_good < 0 then
    raise exception using errcode = '22023', message = 'A saida boa deve ser zero ou maior.';
  end if;

  if p_quantity_loss is null or p_quantity_loss < 0 then
    raise exception using errcode = '22023', message = 'A perda deve ser zero ou maior.';
  end if;

  if not exists (
    select 1
    from public.breads as bread
    where bread.id = p_bread_id
  ) then
    raise exception using errcode = '23503', message = 'Pao nao encontrado.';
  end if;

  v_loss_reason := nullif(btrim(p_loss_reason), '');
  if p_quantity_loss > 0
    and (
      v_loss_reason is null
      or v_loss_reason not in ('Queimou', 'Fora do padrão', 'Caiu ou contaminou', 'Outro')
    ) then
    raise exception using
      errcode = '22023',
      message = 'Informe um motivo valido para a perda.';
  end if;

  if p_quantity_loss = 0 then
    v_loss_reason := null;
  end if;

  if length(coalesce(p_obs, '')) > 500 then
    raise exception using errcode = '22023', message = 'A observacao deve ter no maximo 500 caracteres.';
  end if;

  v_lot_code := 'L' || to_char(p_record_date, 'MMDD');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_bread_id || ':' || p_record_date::text, 0)
  );

  select actual.quantity_baked, actual.quantity_loss
  into v_previous_good, v_previous_loss
  from public.production_actuals as actual
  where actual.bread_id = p_bread_id
    and actual.record_date = p_record_date
  for update;

  insert into public.production_actuals (
    record_date,
    bread_id,
    lot_code,
    quantity_baked,
    quantity_loss,
    loss_reason,
    recorded_by,
    obs,
    updated_at
  ) values (
    p_record_date,
    p_bread_id,
    v_lot_code,
    p_quantity_good,
    p_quantity_loss,
    v_loss_reason,
    v_profile_name,
    nullif(btrim(p_obs), ''),
    v_confirmed_at
  )
  on conflict (bread_id, record_date)
  do update set
    lot_code = excluded.lot_code,
    quantity_baked = excluded.quantity_baked,
    quantity_loss = excluded.quantity_loss,
    loss_reason = excluded.loss_reason,
    recorded_by = excluded.recorded_by,
    obs = excluded.obs,
    updated_at = excluded.updated_at
  returning id into v_actual_id;

  delete from public.bread_movements as movement
  where movement.reference_type = 'production_actual'
    and movement.reference_id = v_actual_id::text
    and movement.movement_type in ('forno_entrada', 'forno_descarte');

  if p_quantity_good > 0 then
    insert into public.bread_movements (
      movement_type,
      bread_id,
      location,
      quantity,
      reference_id,
      reference_type,
      recorded_by,
      lot_id
    ) values (
      'forno_entrada',
      p_bread_id,
      'central',
      p_quantity_good,
      v_actual_id::text,
      'production_actual',
      v_profile_name,
      v_actual_id
    );
  end if;

  insert into public.production_actual_events (
    production_actual_id,
    bread_id,
    record_date,
    lot_code,
    previous_quantity_baked,
    previous_quantity_loss,
    quantity_baked,
    quantity_loss,
    loss_reason,
    changed_by,
    changed_by_name,
    created_at
  ) values (
    v_actual_id,
    p_bread_id,
    p_record_date,
    v_lot_code,
    v_previous_good,
    v_previous_loss,
    p_quantity_good,
    p_quantity_loss,
    v_loss_reason,
    v_user_id,
    v_profile_name,
    v_confirmed_at
  );

  return query
  select
    v_actual_id,
    v_lot_code,
    p_quantity_good,
    p_quantity_loss,
    v_loss_reason,
    v_confirmed_at;
end;
$$;


ALTER FUNCTION "public"."confirm_oven_output"("p_record_date" "date", "p_bread_id" "text", "p_quantity_good" integer, "p_quantity_loss" integer, "p_loss_reason" "text", "p_obs" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."confirm_oven_output"("p_record_date" "date", "p_bread_id" "text", "p_quantity_good" integer, "p_quantity_loss" integer, "p_loss_reason" "text", "p_obs" "text") IS 'Confirma ou corrige um produto/lote do forno e sincroniza sua entrada de estoque na mesma transacao.';



CREATE OR REPLACE FUNCTION "public"."confirm_pj_order_dispatch"("p_order_group_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid;
  v_user_name text;
  v_row_count integer;
  v_cancelled_count integer;
  v_dispatched_count integer;
  v_dispatched_at timestamptz;
  v_dispatched_by uuid;
  v_dispatched_by_name text;
begin
  if p_order_group_id is null then
    raise exception using errcode = '22023', message = 'Pedido obrigatorio.';
  end if;

  select profile.user_id, profile.display_name
  into v_user_id, v_user_name
  from public.app_profiles profile
  where profile.user_id = (select auth.uid())
    and profile.active
    and profile.role = 'expedicao'
    and profile.store = 'jc'
    and exists (
      select 1
      from public.app_user_permissions assignment
      where assignment.user_id = profile.user_id
        and assignment.permission_key = 'pedidos_pj.confirmar_envio'
        and assignment.scope in ('*', 'jc')
    );

  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Sem permissao para confirmar este envio.';
  end if;

  perform 1
  from public.orders order_row
  where order_row.order_group_id = p_order_group_id
    and order_row.order_type = 'pj'
  for update;

  select
    count(*),
    count(*) filter (where order_row.cancelled_at is not null),
    count(*) filter (where order_row.dispatched_at is not null)
  into v_row_count, v_cancelled_count, v_dispatched_count
  from public.orders order_row
  where order_row.order_group_id = p_order_group_id
    and order_row.order_type = 'pj';

  if v_row_count = 0 then
    raise exception using errcode = 'P0002', message = 'Pedido PJ nao encontrado.';
  end if;

  if v_cancelled_count > 0 then
    raise exception using errcode = '22023', message = 'Pedido cancelado nao pode ser enviado.';
  end if;

  if v_dispatched_count = v_row_count then
    select
      order_row.dispatched_at,
      order_row.dispatched_by,
      order_row.dispatched_by_name
    into v_dispatched_at, v_dispatched_by, v_dispatched_by_name
    from public.orders order_row
    where order_row.order_group_id = p_order_group_id
      and order_row.order_type = 'pj'
    order by order_row.id
    limit 1;

    return jsonb_build_object(
      'dispatched_at', v_dispatched_at,
      'dispatched_by', v_dispatched_by,
      'dispatched_by_name', v_dispatched_by_name,
      'already_dispatched', true
    );
  end if;

  if v_dispatched_count > 0 then
    raise exception using errcode = '22023', message = 'Pedido com confirmacao de envio incompleta.';
  end if;

  v_dispatched_at := now();
  perform set_config('pane.pj_dispatch_rpc', 'on', true);

  update public.orders order_row
  set dispatched_at = v_dispatched_at,
      dispatched_by = v_user_id,
      dispatched_by_name = v_user_name
  where order_row.order_group_id = p_order_group_id
    and order_row.order_type = 'pj'
    and order_row.cancelled_at is null
    and order_row.dispatched_at is null;

  return jsonb_build_object(
    'dispatched_at', v_dispatched_at,
    'dispatched_by', v_user_id,
    'dispatched_by_name', v_user_name,
    'already_dispatched', false
  );
end;
$$;


ALTER FUNCTION "public"."confirm_pj_order_dispatch"("p_order_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_romaneio_departure"("p_romaneio_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$ declare v_status text; v_destination_code text; v_user_name text; v_movements_exist boolean; begin select romaneio.status,destination.code into v_status,v_destination_code from public.romaneios romaneio join public.destinations destination on destination.id=romaneio.destination_id where romaneio.id=p_romaneio_id for update of romaneio; if not found then raise exception using errcode='P0002',message='Romaneio nao encontrado.'; end if; if not (select private.current_user_has_permission('romaneio.confirmar_saida',v_destination_code)) then raise exception using errcode='42501',message='Sem permissao para confirmar esta saida.'; end if; if v_status<>'separado' then raise exception using errcode='22023',message='O romaneio nao esta separado.'; end if; select profile.display_name into v_user_name from public.app_profiles profile where profile.user_id=(select auth.uid()) and profile.active; if v_user_name is null then raise exception using errcode='42501',message='Perfil inativo.'; end if; select exists(select 1 from public.bread_movements existing where existing.reference_id=p_romaneio_id::text and existing.reference_type in ('romaneio','romaneio_kit')) into v_movements_exist; insert into public.bread_movements(movement_type,bread_id,location,quantity,reference_id,reference_type,recorded_by) select 'romaneio_envio',item.product_id,movement.location,item.qty_sent*movement.factor,p_romaneio_id::text,'romaneio',v_user_name from public.romaneio_items item cross join lateral(values('central'::text,-1::numeric),(lower(v_destination_code),1::numeric)) movement(location,factor) where item.romaneio_id=p_romaneio_id and item.product_source='bread' and item.qty_sent>0 and not v_movements_exist; insert into public.bread_movements(movement_type,bread_id,location,quantity,reference_id,reference_type,recorded_by) select 'romaneio_envio',component.component_id,movement.location,item.qty_sent*component.quantity*movement.factor,p_romaneio_id::text,'romaneio_kit',v_user_name from public.romaneio_items item join public.products product on product.id::text=item.product_id and product.kind='kit' join public.product_components component on component.parent_product_id=product.id and component.component_source='bread' cross join lateral(values('central'::text,-1::numeric),(lower(v_destination_code),1::numeric)) movement(location,factor) where item.romaneio_id=p_romaneio_id and item.product_source<>'bread' and item.qty_sent>0 and not v_movements_exist; update public.romaneios set status='enviado',sent_by=v_user_name,sent_at=now() where id=p_romaneio_id; end; $$;


ALTER FUNCTION "public"."confirm_romaneio_departure"("p_romaneio_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_romaneio_receipt"("p_romaneio_id" "uuid", "p_items" "jsonb") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$ declare v_destination_code text; v_status text; v_user_name text; v_has_divergence boolean:=false; v_item record; begin select destination.code,romaneio.status into v_destination_code,v_status from public.romaneios romaneio join public.destinations destination on destination.id=romaneio.destination_id where romaneio.id=p_romaneio_id for update of romaneio; if not found then raise exception using errcode='P0002',message='Romaneio nao encontrado.'; end if; if not (select private.current_user_has_permission('romaneio.conferir_recebimento',v_destination_code)) then raise exception using errcode='42501',message='Sem permissao para conferir este recebimento.'; end if; if v_status<>'enviado' then raise exception using errcode='22023',message='O romaneio ainda nao foi enviado ou ja foi conferido.'; end if; select profile.display_name into v_user_name from public.app_profiles profile where profile.user_id=(select auth.uid()) and profile.active; if v_user_name is null then raise exception using errcode='42501',message='Perfil inativo.'; end if; for v_item in select requested.id,requested.qty_received,requested.qty_accepted,requested.divergence_reason,requested.obs from jsonb_to_recordset(coalesce(p_items,'[]'::jsonb)) requested(id uuid,qty_received numeric,qty_accepted numeric,divergence_reason text,obs text) loop update public.romaneio_items item set qty_received=v_item.qty_received,qty_accepted=v_item.qty_accepted,divergence_reason=nullif(v_item.divergence_reason,''),obs=nullif(v_item.obs,''),item_status=case when v_item.qty_received is distinct from item.qty_sent or v_item.qty_accepted is distinct from v_item.qty_received then 'divergencia' else 'ok' end where item.id=v_item.id and item.romaneio_id=p_romaneio_id; if not found then raise exception using errcode='22023',message='Item invalido para este romaneio.'; end if; end loop; select exists(select 1 from public.romaneio_items item where item.romaneio_id=p_romaneio_id and item.item_status='divergencia') into v_has_divergence; update public.romaneios set status=case when v_has_divergence then 'com_divergencia' else 'conferido' end,confirmed_by=v_user_name,confirmed_at=now() where id=p_romaneio_id; return case when v_has_divergence then 'com_divergencia' else 'conferido' end; end; $$;


ALTER FUNCTION "public"."confirm_romaneio_receipt"("p_romaneio_id" "uuid", "p_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_pj_orders_for_dispatch"() RETURNS TABLE("id" "uuid", "order_group_id" "uuid", "customer_id" "uuid", "customer_name" "text", "order_date" "date", "delivery_date" "date", "production_date" "date", "bread_id" "text", "product_source" "text", "product_name" "text", "quantity" numeric, "pack_size" numeric, "pricing_unit" "text", "sale_option_id" "uuid", "obs" "text", "cancelled_at" timestamp with time zone, "dispatched_at" timestamp with time zone, "dispatched_by" "uuid", "dispatched_by_name" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
    order_row.product_name,
    order_row.quantity,
    order_row.pack_size,
    order_row.pricing_unit,
    order_row.sale_option_id,
    order_row.obs,
    order_row.cancelled_at,
    order_row.dispatched_at,
    order_row.dispatched_by,
    order_row.dispatched_by_name
  from public.orders order_row
  left join public.customers customer on customer.id = order_row.customer_id
  where order_row.order_type = 'pj'
  order by order_row.order_date desc, order_row.order_group_id, order_row.id;
end;
$$;


ALTER FUNCTION "public"."list_pj_orders_for_dispatch"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_bread_as_shelf"("p_bread_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and coalesce(p.allowed_routes, '[]'::jsonb) ? '/sobras'
  ) then
    raise exception 'Perfil sem permissao para incluir pao na prateleira'
      using errcode = '42501';
  end if;

  update public.breads
  set is_shelf = true
  where id = p_bread_id;

  if not found then
    raise exception 'Pao nao encontrado'
      using errcode = 'P0002';
  end if;
end;
$$;


ALTER FUNCTION "public"."mark_bread_as_shelf"("p_bread_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mark_bread_as_shelf"("p_bread_id" "text") IS 'Inclui um pao legado na contagem de prateleira sem liberar update amplo do catalogo.';



CREATE OR REPLACE FUNCTION "public"."reconcile_bread_leftovers_after_oven"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."reconcile_bread_leftovers_after_oven"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reconcile_bread_leftovers_after_oven"() IS 'Trigger interno que liga sobras e destinos provisÃ³rios ao lote real quando o Forno e confirmado.';



CREATE OR REPLACE FUNCTION "public"."register_bread_leftovers"("p_record_date" "date", "p_store" "text", "p_items" "jsonb", "p_physical_location" "text" DEFAULT 'balcao_fechamento'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
$_$;


ALTER FUNCTION "public"."register_bread_leftovers"("p_record_date" "date", "p_store" "text", "p_items" "jsonb", "p_physical_location" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."register_bread_leftovers"("p_record_date" "date", "p_store" "text", "p_items" "jsonb", "p_physical_location" "text") IS 'Registra a contagem fisica de JC/JA mesmo antes do Forno e marca a conciliacao pendente sem criar producao.';



CREATE OR REPLACE FUNCTION "public"."replace_user_permissions"("p_user_id" "uuid", "p_assignments" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$ begin if p_user_id is null then raise exception using errcode='22023',message='Usuario obrigatorio.'; end if; if jsonb_typeof(coalesce(p_assignments,'[]'::jsonb))<>'array' then raise exception using errcode='22023',message='Lista de permissoes invalida.'; end if; if exists(select 1 from jsonb_to_recordset(coalesce(p_assignments,'[]'::jsonb)) requested("permissionKey" text,scope text) left join public.app_permissions permission on permission.key=requested."permissionKey" where permission.key is null or requested.scope not in ('*','jc','ja','ex')) then raise exception using errcode='22023',message='Permissao ou loja desconhecida.'; end if; delete from public.app_user_permissions where user_id=p_user_id; insert into public.app_user_permissions(user_id,permission_key,scope,granted_by) select distinct p_user_id,requested."permissionKey",requested.scope,(select auth.uid()) from jsonb_to_recordset(coalesce(p_assignments,'[]'::jsonb)) requested("permissionKey" text,scope text); end; $$;


ALTER FUNCTION "public"."replace_user_permissions"("p_user_id" "uuid", "p_assignments" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_bread_leftover"("p_sobra_id" "uuid", "p_action" "text", "p_quantity" numeric, "p_freezer_location" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_profile_name text;
  v_profile_role text;
  v_profile_store text;
  v_sobra public.sobras%rowtype;
  v_event_id uuid;
  v_bread_name text;
  v_bread_unit text;
  v_frozen_product_id uuid;
  v_freezer_location text;
  v_previous_frozen integer := 0;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Entre com e-mail para dar destino a sobra.';
  end if;

  select display_name, role, store
  into v_profile_name, v_profile_role, v_profile_store
  from public.app_profiles
  where user_id = v_user_id and active;

  if not found or v_profile_role not in ('admin', 'producao', 'vendas', 'estoque') then
    raise exception using errcode = '42501', message = 'Usuario sem permissao para dar destino a sobra.';
  end if;

  select * into v_sobra from public.sobras where id = p_sobra_id for update;
  if not found or v_sobra.store is null or v_sobra.product_source <> 'bread' then
    raise exception using errcode = 'P0002', message = 'Sobra pendente nao encontrada.';
  end if;

  if v_profile_role = 'vendas' and v_profile_store is distinct from v_sobra.store then
    raise exception using errcode = '42501', message = 'A atendente so pode movimentar a propria loja.';
  end if;

  if p_action not in ('display', 'internal_use', 'donation', 'discard', 'freeze')
    or p_quantity is null or p_quantity <= 0 or p_quantity > v_sobra.pending_quantity then
    raise exception using errcode = '22023', message = 'Destino ou quantidade invalida.';
  end if;

  if p_action = 'freeze' and p_quantity <> trunc(p_quantity) then
    raise exception using errcode = '22023', message = 'O estoque congelado aceita somente unidades inteiras.';
  end if;

  insert into public.bread_leftover_events (
    sobra_id, action, quantity, from_location, to_location,
    actor_id, actor_name
  ) values (
    v_sobra.id, p_action, p_quantity, v_sobra.physical_location,
    case p_action
      when 'display' then 'vitrine'
      when 'internal_use' then 'consumo_interno'
      when 'donation' then 'doacao'
      when 'discard' then 'descarte'
      else coalesce(p_freezer_location, case when v_sobra.store = 'jc' then 'jc-freezer' else 'ja-freezer' end)
    end,
    v_user_id, v_profile_name
  ) returning id into v_event_id;

  if p_action in ('internal_use', 'donation', 'discard', 'freeze') then
    insert into public.bread_movements (
      movement_type, bread_id, location, quantity, reference_id,
      reference_type, recorded_by, lot_id, obs
    ) values (
      case p_action
        when 'internal_use' then 'consumo_interno'
        when 'donation' then 'doacao'
        when 'discard' then 'descarte_loja'
        else 'sobra_congelada'
      end,
      v_sobra.product_id, v_sobra.store, -p_quantity, v_event_id::text,
      'bread_leftover_event', v_profile_name, v_sobra.production_actual_id,
      'Destino de sobra ' || p_action
    );
  end if;

  if p_action = 'freeze' then
    v_freezer_location := coalesce(
      p_freezer_location,
      case when v_sobra.store = 'jc' then 'jc-freezer' else 'ja-freezer' end
    );

    if (v_sobra.store = 'jc' and v_freezer_location not in ('jc-freezer', 'jc-camara', 'jc-freezer-loja'))
      or (v_sobra.store = 'ja' and v_freezer_location <> 'ja-freezer') then
      raise exception using errcode = '22023', message = 'Freezer invalido para a loja.';
    end if;

    select name, unit into v_bread_name, v_bread_unit
    from public.breads where id = v_sobra.product_id;

    insert into public.frozen_products (
      product_id, product_source, product_name, unit, min_stock,
      active, visible_stores
    ) values (
      v_sobra.product_id, 'bread', v_bread_name, coalesce(v_bread_unit, 'un'),
      0, true, array[v_sobra.store]
    )
    on conflict (product_id, product_source)
      where active = true and product_id is not null
    do update set
      visible_stores = case
        when public.frozen_products.visible_stores is null then null
        when v_sobra.store = any(public.frozen_products.visible_stores)
          then public.frozen_products.visible_stores
        else array_append(public.frozen_products.visible_stores, v_sobra.store)
      end
    returning id into v_frozen_product_id;

    insert into public.frozen_stock(frozen_product_id, location, quantity, updated_at)
    values (v_frozen_product_id, v_freezer_location, p_quantity::integer, now())
    on conflict (frozen_product_id, location)
    do update set quantity = public.frozen_stock.quantity + excluded.quantity,
                  updated_at = excluded.updated_at
    returning quantity - p_quantity::integer into v_previous_frozen;

    insert into public.frozen_movements (
      frozen_product_id, location, movement_type, quantity,
      previous_quantity, obs, responsible
    ) values (
      v_frozen_product_id, v_freezer_location, 'entrada', p_quantity::integer,
      v_previous_frozen, 'Congelado a partir da sobra ' || v_sobra.lot_code,
      v_profile_name
    );
  end if;

  update public.sobras
  set pending_quantity = pending_quantity - p_quantity,
      status = case when pending_quantity - p_quantity = 0 then 'resolved' else 'pending' end,
      updated_at = now()
  where id = v_sobra.id;

  return jsonb_build_object(
    'sobra_id', v_sobra.id,
    'action', p_action,
    'resolved_quantity', p_quantity,
    'pending_quantity', v_sobra.pending_quantity - p_quantity
  );
end;
$$;


ALTER FUNCTION "public"."resolve_bread_leftover"("p_sobra_id" "uuid", "p_action" "text", "p_quantity" numeric, "p_freezer_location" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_bread_reuse_proposals"("p_target_production_date" "date", "p_store" "text", "p_proposals" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_user_id uuid := auth.uid();
  v_profile_name text;
  v_profile_role text;
  v_item jsonb;
  v_bread_id text;
  v_quantity integer;
  v_order_quantity numeric;
  v_available numeric;
  v_existing public.bread_reuse_plans%rowtype;
  v_existing_found boolean;
  v_count integer := 0;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Entre com e-mail para planejar o reaproveitamento.';
  end if;

  select display_name, role into v_profile_name, v_profile_role
  from public.app_profiles
  where user_id = v_user_id and active;

  if not found or v_profile_role <> 'admin' then
    raise exception using errcode = '42501', message = 'Somente administradores podem propor reaproveitamento.';
  end if;

  if p_target_production_date is null or p_store not in ('jc', 'ja')
    or jsonb_typeof(p_proposals) <> 'array' or jsonb_array_length(p_proposals) > 200 then
    raise exception using errcode = '22023', message = 'Planejamento de reaproveitamento invalido.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('reuse-plan:' || p_store || ':' || p_target_production_date::text, 0)
  );

  for v_item in select value from jsonb_array_elements(p_proposals)
  loop
    v_bread_id := nullif(btrim(v_item ->> 'bread_id'), '');
    if v_bread_id is null or coalesce(v_item ->> 'quantity', '') !~ '^[0-9]+$' then
      raise exception using errcode = '22023', message = 'Proposta de reaproveitamento invalida.';
    end if;
    v_quantity := (v_item ->> 'quantity')::integer;

    select coalesce(sum(quantity), 0) into v_order_quantity
    from public.orders
    where order_date = p_target_production_date
      and store = p_store
      and bread_id = v_bread_id;

    select coalesce(sum(floor(pending_quantity)), 0) into v_available
    from public.sobras
    where store = p_store
      and product_source = 'bread'
      and product_id = v_bread_id
      and record_date < p_target_production_date
      and pending_quantity > 0;

    select * into v_existing
    from public.bread_reuse_plans
    where target_production_date = p_target_production_date
      and store = p_store
      and bread_id = v_bread_id
    for update;
    v_existing_found := found;

    if not v_existing_found and v_quantity = 0 then
      continue;
    end if;

    if v_quantity > v_order_quantity then
      raise exception using errcode = '23514', message = 'A sobra proposta nao pode superar o pedido da loja.';
    end if;

    if v_existing_found and v_existing.status = 'confirmed' then
      if coalesce(v_existing.confirmed_quantity, 0) > v_order_quantity then
        raise exception using
          errcode = '23514',
          message = 'O pedido nao pode ficar abaixo da sobra que ja voltou para a vitrine.';
      end if;
      if v_quantity <> v_existing.proposed_quantity then
        raise exception using
          errcode = '23514',
          message = 'O reaproveitamento deste pao ja foi conferido. Corrija na Central de Pendencias.';
      end if;
      continue;
    end if;

    if v_quantity > v_available then
      raise exception using errcode = '23514', message = 'A sobra proposta nao pode superar o saldo pendente.';
    end if;

    insert into public.bread_reuse_plans (
      target_production_date, store, bread_id, proposed_quantity,
      confirmed_quantity, status, proposed_by, proposed_by_name,
      proposed_at, confirmed_by, confirmed_by_name, confirmed_at, updated_at
    ) values (
      p_target_production_date, p_store, v_bread_id, v_quantity,
      null, case when v_quantity > 0 then 'proposed' else 'cancelled' end,
      v_user_id, v_profile_name, now(), null, null, null, now()
    )
    on conflict (target_production_date, store, bread_id)
    do update set
      proposed_quantity = excluded.proposed_quantity,
      confirmed_quantity = null,
      status = excluded.status,
      proposed_by = excluded.proposed_by,
      proposed_by_name = excluded.proposed_by_name,
      proposed_at = excluded.proposed_at,
      confirmed_by = null,
      confirmed_by_name = null,
      confirmed_at = null,
      updated_at = excluded.updated_at;

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('saved_proposals', v_count, 'store', p_store);
end;
$_$;


ALTER FUNCTION "public"."save_bread_reuse_proposals"("p_target_production_date" "date", "p_store" "text", "p_proposals" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_app_profiles_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_app_profiles_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_cash_closings_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_cash_closings_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_bread_leftover_location"("p_sobra_id" "uuid", "p_physical_location" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_profile_name text;
  v_profile_role text;
  v_profile_store text;
  v_sobra public.sobras%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Entre com e-mail para alterar o local.';
  end if;

  select display_name, role, store
  into v_profile_name, v_profile_role, v_profile_store
  from public.app_profiles
  where user_id = v_user_id and active;

  if not found or v_profile_role not in ('admin', 'producao', 'vendas', 'estoque') then
    raise exception using errcode = '42501', message = 'Usuario sem permissao para alterar o local.';
  end if;

  if p_physical_location not in ('balcao_fechamento', 'mesa_separacao', 'padaria_cozinha') then
    raise exception using errcode = '22023', message = 'Local fisico invalido.';
  end if;

  select * into v_sobra from public.sobras where id = p_sobra_id for update;
  if not found or coalesce(v_sobra.pending_quantity, 0) <= 0 then
    raise exception using errcode = 'P0002', message = 'Sobra pendente nao encontrada.';
  end if;

  if v_profile_role = 'vendas' and v_profile_store is distinct from v_sobra.store then
    raise exception using errcode = '42501', message = 'A atendente so pode movimentar a propria loja.';
  end if;

  update public.sobras
  set physical_location = p_physical_location, updated_at = now()
  where id = v_sobra.id;

  insert into public.bread_leftover_events (
    sobra_id, action, quantity, from_location, to_location,
    actor_id, actor_name
  ) values (
    v_sobra.id, 'location_changed', 0, v_sobra.physical_location,
    p_physical_location, v_user_id, v_profile_name
  );

  return jsonb_build_object('sobra_id', v_sobra.id, 'physical_location', p_physical_location);
end;
$$;


ALTER FUNCTION "public"."update_bread_leftover_location"("p_sobra_id" "uuid", "p_physical_location" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."app_permissions" (
    "key" "text" NOT NULL,
    "module" "text" NOT NULL,
    "label" "text" NOT NULL,
    "description" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "app_permissions_key_format" CHECK (("key" ~ '^[a-z0-9_]+\.[a-z0-9_]+$'::"text"))
);

ALTER TABLE ONLY "public"."app_permissions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_profiles" (
    "user_id" "uuid" NOT NULL,
    "display_name" "text" NOT NULL,
    "role" "text" NOT NULL,
    "store" "text",
    "active" boolean DEFAULT true NOT NULL,
    "allowed_routes" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "app_profiles_allowed_routes_array_check" CHECK ((("allowed_routes" IS NULL) OR ("jsonb_typeof"("allowed_routes") = 'array'::"text"))),
    CONSTRAINT "app_profiles_display_name_not_blank" CHECK (("btrim"("display_name") <> ''::"text")),
    CONSTRAINT "app_profiles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'producao'::"text", 'compras'::"text", 'estoque'::"text", 'expedicao'::"text", 'vendas'::"text"]))),
    CONSTRAINT "app_profiles_store_check" CHECK ((("store" IS NULL) OR ("store" = ANY (ARRAY['jc'::"text", 'ex'::"text", 'ja'::"text"]))))
);

ALTER TABLE ONLY "public"."app_profiles" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."app_profiles" IS 'Perfis operacionais do ERP vinculados ao Supabase Auth. Mantido em paralelo ao app_users durante a transicao.';



COMMENT ON COLUMN "public"."app_profiles"."user_id" IS 'Vinculo com auth.users.id. Nao armazena PIN ou segredo.';



COMMENT ON COLUMN "public"."app_profiles"."allowed_routes" IS 'Apoio para navegacao da UI. Nao substitui RLS.';



COMMENT ON CONSTRAINT "app_profiles_store_check" ON "public"."app_profiles" IS 'store null representa escopo global; PJ e canal/tipo de pedido, nao loja/unidade.';



CREATE TABLE IF NOT EXISTS "public"."app_user_permissions" (
    "user_id" "uuid" NOT NULL,
    "permission_key" "text" NOT NULL,
    "scope" "text" DEFAULT '*'::"text" NOT NULL,
    "granted_by" "uuid",
    "granted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "app_user_permissions_scope" CHECK (("scope" = ANY (ARRAY['*'::"text", 'jc'::"text", 'ja'::"text", 'ex'::"text"])))
);

ALTER TABLE ONLY "public"."app_user_permissions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_user_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_users" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "role" "text" NOT NULL,
    "pin" "text" NOT NULL,
    "color" "text" DEFAULT '#666666'::"text" NOT NULL,
    "routes" "jsonb" DEFAULT '["*"]'::"jsonb" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "store" "text",
    CONSTRAINT "app_users_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'producao'::"text", 'compras'::"text", 'expedicao'::"text"])))
);


ALTER TABLE "public"."app_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bread_leftover_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sobra_id" "uuid" NOT NULL,
    "reuse_plan_id" "uuid",
    "action" "text" NOT NULL,
    "quantity" numeric DEFAULT 0 NOT NULL,
    "from_location" "text",
    "to_location" "text",
    "actor_id" "uuid" NOT NULL,
    "actor_name" "text" NOT NULL,
    "obs" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bread_leftover_events_action_check" CHECK (("action" = ANY (ARRAY['registered'::"text", 'corrected'::"text", 'location_changed'::"text", 'reuse_confirmed'::"text", 'reuse_reversed'::"text", 'display'::"text", 'internal_use'::"text", 'donation'::"text", 'discard'::"text", 'freeze'::"text"]))),
    CONSTRAINT "bread_leftover_events_quantity_check" CHECK (("quantity" >= (0)::numeric))
);

ALTER TABLE ONLY "public"."bread_leftover_events" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."bread_leftover_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."bread_leftover_events" IS 'Historico imutavel de registro, correcao, local e destino das sobras de paes.';



CREATE TABLE IF NOT EXISTS "public"."bread_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "movement_type" "text" NOT NULL,
    "bread_id" "text" NOT NULL,
    "location" "text" NOT NULL,
    "quantity" numeric NOT NULL,
    "reference_id" "text",
    "reference_type" "text",
    "recorded_by" "text" NOT NULL,
    "obs" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "lot_id" "uuid"
);


ALTER TABLE "public"."bread_movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bread_reuse_plan_allocations" (
    "plan_id" "uuid" NOT NULL,
    "sobra_id" "uuid" NOT NULL,
    "quantity" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bread_reuse_plan_allocations_quantity_check" CHECK (("quantity" > 0))
);

ALTER TABLE ONLY "public"."bread_reuse_plan_allocations" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."bread_reuse_plan_allocations" OWNER TO "postgres";


COMMENT ON TABLE "public"."bread_reuse_plan_allocations" IS 'Alocacao atual, por lote FIFO, do reaproveitamento confirmado.';



CREATE TABLE IF NOT EXISTS "public"."bread_reuse_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "target_production_date" "date" NOT NULL,
    "store" "text" NOT NULL,
    "bread_id" "text" NOT NULL,
    "proposed_quantity" integer DEFAULT 0 NOT NULL,
    "confirmed_quantity" integer,
    "status" "text" DEFAULT 'proposed'::"text" NOT NULL,
    "proposed_by" "uuid" NOT NULL,
    "proposed_by_name" "text" NOT NULL,
    "proposed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "confirmed_by" "uuid",
    "confirmed_by_name" "text",
    "confirmed_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bread_reuse_plans_confirmed_quantity_check" CHECK ((("confirmed_quantity" IS NULL) OR (("confirmed_quantity" >= 0) AND ("confirmed_quantity" <= "proposed_quantity")))),
    CONSTRAINT "bread_reuse_plans_proposed_quantity_check" CHECK (("proposed_quantity" >= 0)),
    CONSTRAINT "bread_reuse_plans_status_check" CHECK (("status" = ANY (ARRAY['proposed'::"text", 'confirmed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "bread_reuse_plans_store_check" CHECK (("store" = ANY (ARRAY['jc'::"text", 'ja'::"text"])))
);

ALTER TABLE ONLY "public"."bread_reuse_plans" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."bread_reuse_plans" OWNER TO "postgres";


COMMENT ON TABLE "public"."bread_reuse_plans" IS 'Intencao do planejamento e confirmacao fisica que reduz a producao nova do Forno.';



CREATE TABLE IF NOT EXISTS "public"."breads" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "days" integer[] DEFAULT '{0,1,2,3,4,5,6}'::integer[] NOT NULL,
    "active" boolean DEFAULT true,
    "is_pj" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "cost_price" numeric(10,2) DEFAULT 0,
    "unit" "text" DEFAULT 'un'::"text",
    "is_special" boolean DEFAULT false NOT NULL,
    "is_shelf" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."breads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cash_closings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "closing_date" "date" NOT NULL,
    "weekday_label" "text" NOT NULL,
    "store" "text" NOT NULL,
    "sales_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "banri_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "sitef_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "pix_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "cash_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "site_sales_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "ifood_sales_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "total_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "cash_withdrawal_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "opening_cash_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "closing_cash_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "envelope_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "next_day_cash_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "notes" "text",
    "created_by" "text" NOT NULL,
    "created_by_name" "text" NOT NULL,
    "created_by_email" "text",
    "updated_by" "text",
    "updated_by_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cash_closings_created_by_name_not_blank" CHECK (("btrim"("created_by_name") <> ''::"text")),
    CONSTRAINT "cash_closings_created_by_not_blank" CHECK (("btrim"("created_by") <> ''::"text")),
    CONSTRAINT "cash_closings_non_negative_values" CHECK ((("sales_amount" >= (0)::numeric) AND ("banri_amount" >= (0)::numeric) AND ("sitef_amount" >= (0)::numeric) AND ("pix_amount" >= (0)::numeric) AND ("cash_amount" >= (0)::numeric) AND ("site_sales_amount" >= (0)::numeric) AND ("ifood_sales_amount" >= (0)::numeric) AND ("total_amount" >= (0)::numeric) AND ("cash_withdrawal_amount" >= (0)::numeric) AND ("opening_cash_amount" >= (0)::numeric) AND ("closing_cash_amount" >= (0)::numeric) AND ("envelope_amount" >= (0)::numeric) AND ("next_day_cash_amount" >= (0)::numeric))),
    CONSTRAINT "cash_closings_store_check" CHECK (("store" = ANY (ARRAY['jc'::"text", 'ja'::"text", 'ex'::"text"]))),
    CONSTRAINT "cash_closings_weekday_not_blank" CHECK (("btrim"("weekday_label") <> ''::"text"))
);

ALTER TABLE ONLY "public"."cash_closings" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."cash_closings" OWNER TO "postgres";


COMMENT ON TABLE "public"."cash_closings" IS 'Fechamento diario de caixa informado pelas lojas. Dados financeiros: manter RLS restritivo.';



COMMENT ON COLUMN "public"."cash_closings"."closing_date" IS 'Data operacional do fechamento.';



COMMENT ON COLUMN "public"."cash_closings"."sales_amount" IS 'Valor de vendas do dia em reais.';



COMMENT ON COLUMN "public"."cash_closings"."opening_cash_amount" IS 'Caixa anterior, usado como abertura do caixa.';



COMMENT ON COLUMN "public"."cash_closings"."envelope_amount" IS 'Dinheiro separado em malote para deposito.';



COMMENT ON COLUMN "public"."cash_closings"."next_day_cash_amount" IS 'Dinheiro deixado para abertura do caixa do proximo dia.';



CREATE TABLE IF NOT EXISTS "public"."customer_price_overrides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "product_id" "text" NOT NULL,
    "product_source" "text" NOT NULL,
    "product_name" "text" NOT NULL,
    "unit_price" numeric NOT NULL,
    "pricing_unit" "text" DEFAULT 'un'::"text" NOT NULL,
    "pack_size" numeric(12,3) DEFAULT 1 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sale_option_id" "uuid",
    CONSTRAINT "customer_price_overrides_pack_size_check" CHECK (("pack_size" >= (1)::numeric)),
    CONSTRAINT "customer_price_overrides_pricing_unit_check" CHECK (("pricing_unit" = ANY (ARRAY['un'::"text", 'kg'::"text"]))),
    CONSTRAINT "customer_price_overrides_product_source_check" CHECK (("product_source" = ANY (ARRAY['bread'::"text", 'product'::"text"]))),
    CONSTRAINT "customer_price_overrides_unit_price_check" CHECK (("unit_price" >= (0)::numeric))
);


ALTER TABLE "public"."customer_price_overrides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "doc" "text",
    "contact" "text",
    "default_tier_id" "uuid",
    "discount_pct" numeric DEFAULT 0 NOT NULL,
    "delivery_hours" integer DEFAULT 48 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "customers_delivery_hours_check" CHECK (("delivery_hours" >= 0)),
    CONSTRAINT "customers_discount_pct_check" CHECK ((("discount_pct" >= (0)::numeric) AND ("discount_pct" <= (100)::numeric)))
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."descartes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "record_date" "date" NOT NULL,
    "responsible" "text" NOT NULL,
    "product_id" "text",
    "quantity" numeric DEFAULT 0 NOT NULL,
    "obs" "text" DEFAULT ''::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "product_source" "text" DEFAULT 'catalog'::"text",
    CONSTRAINT "descartes_product_source_check" CHECK (("product_source" = ANY (ARRAY['catalog'::"text", 'bread'::"text"])))
);


ALTER TABLE "public"."descartes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."destinations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "code" "text" NOT NULL,
    "type" "text" DEFAULT 'loja'::"text" NOT NULL,
    "requires_conferencia" boolean DEFAULT false,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."destinations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."frozen_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "frozen_product_id" "uuid" NOT NULL,
    "location" "text" NOT NULL,
    "movement_type" "text" NOT NULL,
    "quantity" integer NOT NULL,
    "previous_quantity" integer DEFAULT 0 NOT NULL,
    "responsible" "text" DEFAULT 'Gustavo'::"text" NOT NULL,
    "obs" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "frozen_movements_movement_type_check" CHECK (("movement_type" = ANY (ARRAY['entrada'::"text", 'saida'::"text", 'inventario'::"text"])))
);


ALTER TABLE "public"."frozen_movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."frozen_products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "product_id" "text",
    "product_source" "text" DEFAULT 'product'::"text" NOT NULL,
    "product_name" "text" NOT NULL,
    "unit" "text" DEFAULT 'un'::"text" NOT NULL,
    "min_stock" integer DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "store" "text",
    "visible_stores" "text"[],
    CONSTRAINT "frozen_products_product_source_check" CHECK (("product_source" = ANY (ARRAY['bread'::"text", 'product'::"text"])))
);


ALTER TABLE "public"."frozen_products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."frozen_stock" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "frozen_product_id" "uuid" NOT NULL,
    "location" "text" NOT NULL,
    "quantity" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."frozen_stock" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "store" "text" NOT NULL,
    "bread_id" "text" NOT NULL,
    "quantity" numeric(12,3) DEFAULT 0,
    "order_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "obs" "text",
    "pj_client" "text",
    "pj_delivery_date" "date",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "customer_id" "uuid",
    "unit_price" numeric,
    "pack_size" numeric(12,3),
    "pricing_unit" "text",
    "order_type" "text" DEFAULT 'producao'::"text" NOT NULL,
    "delivery_date" "date",
    "production_date" "date",
    "product_source" "text",
    "product_name" "text",
    "walkin_name" "text",
    "walkin_phone" "text",
    "needs_production" boolean DEFAULT false NOT NULL,
    "sale_option_id" "uuid",
    "order_group_id" "uuid",
    "cancelled_at" timestamp with time zone,
    "cancelled_by" "text",
    "cancel_reason" "text",
    "dispatched_at" timestamp with time zone,
    "dispatched_by" "uuid",
    "dispatched_by_name" "text",
    CONSTRAINT "orders_order_type_check" CHECK (("order_type" = ANY (ARRAY['producao'::"text", 'pj'::"text", 'encomenda'::"text"]))),
    CONSTRAINT "orders_pricing_unit_check" CHECK ((("pricing_unit" = ANY (ARRAY['un'::"text", 'kg'::"text"])) OR ("pricing_unit" IS NULL))),
    CONSTRAINT "orders_product_source_check" CHECK ((("product_source" = ANY (ARRAY['bread'::"text", 'product'::"text"])) OR ("product_source" IS NULL)))
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


COMMENT ON COLUMN "public"."orders"."walkin_name" IS 'Nome do cliente avulso (encomenda PF sem cadastro em customers). Preencher quando customer_id IS NULL e order_type=encomenda.';



COMMENT ON COLUMN "public"."orders"."walkin_phone" IS 'Telefone/contato do cliente avulso.';



COMMENT ON COLUMN "public"."orders"."order_group_id" IS 'Identidade compartilhada pelas linhas de um mesmo pedido PJ ou encomenda.';



COMMENT ON COLUMN "public"."orders"."cancelled_at" IS 'Data e hora do cancelamento lógico do pedido.';



COMMENT ON COLUMN "public"."orders"."cancelled_by" IS 'Nome exibido do usuário que cancelou o pedido.';



COMMENT ON COLUMN "public"."orders"."cancel_reason" IS 'Motivo informado no cancelamento do pedido.';



CREATE TABLE IF NOT EXISTS "public"."pizza_categorias" (
    "id" bigint NOT NULL,
    "nome" "text" NOT NULL,
    "grupo" "text" NOT NULL,
    "ativo" boolean DEFAULT true NOT NULL,
    CONSTRAINT "pizza_categorias_grupo_check" CHECK (("grupo" = ANY (ARRAY['cmv'::"text", 'taxas'::"text", 'pessoal'::"text", 'fixas'::"text", 'outros'::"text"])))
);


ALTER TABLE "public"."pizza_categorias" OWNER TO "postgres";


COMMENT ON TABLE "public"."pizza_categorias" IS 'Categorias de gastos da pizzaria. grupo define a linha do DRE.';



ALTER TABLE "public"."pizza_categorias" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."pizza_categorias_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."pizza_despesas" (
    "id" bigint NOT NULL,
    "descricao" "text" NOT NULL,
    "categoria_id" bigint NOT NULL,
    "valor" numeric(12,2) NOT NULL,
    "vencimento" "date" NOT NULL,
    "pago" boolean DEFAULT false NOT NULL,
    "pago_em" "date",
    "obs" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pizza_despesas_valor_check" CHECK (("valor" > (0)::numeric))
);


ALTER TABLE "public"."pizza_despesas" OWNER TO "postgres";


ALTER TABLE "public"."pizza_despesas" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."pizza_despesas_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."pizza_usuarios" (
    "email" "text" NOT NULL
);


ALTER TABLE "public"."pizza_usuarios" OWNER TO "postgres";


COMMENT ON TABLE "public"."pizza_usuarios" IS 'Allowlist de e-mails com acesso ao Controle Pizza. Modulo independente do ERP.';



CREATE TABLE IF NOT EXISTS "public"."pizza_vendas" (
    "id" bigint NOT NULL,
    "data" "date" NOT NULL,
    "canal" "text" NOT NULL,
    "valor" numeric(12,2) NOT NULL,
    "obs" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pizza_vendas_canal_check" CHECK (("canal" = ANY (ARRAY['loja'::"text", 'ifood'::"text"]))),
    CONSTRAINT "pizza_vendas_valor_check" CHECK (("valor" > (0)::numeric))
);


ALTER TABLE "public"."pizza_vendas" OWNER TO "postgres";


COMMENT ON TABLE "public"."pizza_vendas" IS 'Entradas: canal loja = venda direta/balcao/entrega propria; ifood = vendas pelo app.';



ALTER TABLE "public"."pizza_vendas" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."pizza_vendas_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."price_tier_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tier_id" "uuid" NOT NULL,
    "product_id" "text" NOT NULL,
    "product_source" "text" NOT NULL,
    "product_name" "text" NOT NULL,
    "unit_price" numeric NOT NULL,
    "pricing_unit" "text" DEFAULT 'un'::"text" NOT NULL,
    "pack_size" numeric(12,3) DEFAULT 1 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sale_option_id" "uuid",
    CONSTRAINT "price_tier_items_pack_size_check" CHECK (("pack_size" >= (1)::numeric)),
    CONSTRAINT "price_tier_items_pricing_unit_check" CHECK (("pricing_unit" = ANY (ARRAY['un'::"text", 'kg'::"text"]))),
    CONSTRAINT "price_tier_items_product_source_check" CHECK (("product_source" = ANY (ARRAY['bread'::"text", 'product'::"text"]))),
    CONSTRAINT "price_tier_items_unit_price_check" CHECK (("unit_price" >= (0)::numeric))
);


ALTER TABLE "public"."price_tier_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."price_tiers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."price_tiers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_components" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "parent_product_id" "uuid" NOT NULL,
    "component_source" "text" NOT NULL,
    "component_id" "text" NOT NULL,
    "quantity" numeric DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "product_components_component_source_check" CHECK (("component_source" = ANY (ARRAY['bread'::"text", 'product'::"text"]))),
    CONSTRAINT "product_components_quantity_check" CHECK (("quantity" > (0)::numeric))
);


ALTER TABLE "public"."product_components" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_prices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "product_id" "text" NOT NULL,
    "product_source" "text" DEFAULT 'bread'::"text" NOT NULL,
    "product_name" "text" NOT NULL,
    "destination_id" "uuid",
    "unit_price" numeric DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."product_prices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_production" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "store" "text" DEFAULT 'jc'::"text" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "quantity" numeric DEFAULT 0 NOT NULL,
    "production_date" "date" NOT NULL,
    "obs" "text",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."product_production" OWNER TO "postgres";


COMMENT ON TABLE "public"."product_production" IS 'Lista de producao de itens nao-paes (bolos, salgados, doces, etc). Uma linha por (loja, produto, data). Atualizada na aba "Itens JC" em src/app/page.tsx.';



CREATE TABLE IF NOT EXISTS "public"."product_recipe_yields" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "product_id" "uuid" NOT NULL,
    "batch_name" "text",
    "basis" "text" DEFAULT 'dough'::"text" NOT NULL,
    "dough_weight_kg" numeric,
    "finished_weight_kg" numeric,
    "yield_units" numeric,
    "average_unit_weight_kg" numeric GENERATED ALWAYS AS (
CASE
    WHEN (("finished_weight_kg" IS NOT NULL) AND ("yield_units" IS NOT NULL) AND ("yield_units" > (0)::numeric)) THEN ("finished_weight_kg" / "yield_units")
    ELSE NULL::numeric
END) STORED,
    "bake_loss_pct" numeric GENERATED ALWAYS AS (
CASE
    WHEN (("dough_weight_kg" IS NOT NULL) AND ("dough_weight_kg" > (0)::numeric) AND ("finished_weight_kg" IS NOT NULL)) THEN ((("dough_weight_kg" - "finished_weight_kg") / "dough_weight_kg") * (100)::numeric)
    ELSE NULL::numeric
END) STORED,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone,
    CONSTRAINT "product_recipe_yields_basis_valid" CHECK (("basis" = ANY (ARRAY['dough'::"text", 'baked'::"text", 'unit'::"text"]))),
    CONSTRAINT "product_recipe_yields_positive_values" CHECK (((("dough_weight_kg" IS NULL) OR ("dough_weight_kg" > (0)::numeric)) AND (("finished_weight_kg" IS NULL) OR ("finished_weight_kg" > (0)::numeric)) AND (("yield_units" IS NULL) OR ("yield_units" > (0)::numeric))))
);


ALTER TABLE "public"."product_recipe_yields" OWNER TO "postgres";


COMMENT ON TABLE "public"."product_recipe_yields" IS 'Rendimento da ficha tecnica por produto: massa crua, peso assado e/ou unidades geradas.';



COMMENT ON COLUMN "public"."product_recipe_yields"."basis" IS 'Base usada para interpretar a ficha tecnica: dough=massa crua, baked=produto assado, unit=unidade pronta.';



CREATE TABLE IF NOT EXISTS "public"."product_sale_options" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "product_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "sale_unit" "text" NOT NULL,
    "reference_quantity" numeric DEFAULT 1 NOT NULL,
    "unit_weight_kg" numeric,
    "is_default" boolean DEFAULT false NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone,
    CONSTRAINT "product_sale_options_reference_quantity_positive" CHECK (("reference_quantity" > (0)::numeric)),
    CONSTRAINT "product_sale_options_sale_unit_valid" CHECK (("sale_unit" = ANY (ARRAY['un'::"text", 'kg'::"text"]))),
    CONSTRAINT "product_sale_options_unit_weight_positive" CHECK ((("unit_weight_kg" IS NULL) OR ("unit_weight_kg" > (0)::numeric)))
);


ALTER TABLE "public"."product_sale_options" OWNER TO "postgres";


COMMENT ON TABLE "public"."product_sale_options" IS 'Formas de venda do produto unico, como unidade e quilo, sem duplicar cadastro.';



COMMENT ON COLUMN "public"."product_sale_options"."reference_quantity" IS 'Quantidade de referencia da forma de venda. Ex.: 1 unidade ou 1 kg.';



COMMENT ON COLUMN "public"."product_sale_options"."unit_weight_kg" IS 'Peso medio em kg quando a forma de venda e por unidade.';



CREATE TABLE IF NOT EXISTS "public"."production_actual_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "production_actual_id" "uuid" NOT NULL,
    "bread_id" "text" NOT NULL,
    "record_date" "date" NOT NULL,
    "lot_code" "text" NOT NULL,
    "previous_quantity_baked" numeric,
    "previous_quantity_loss" numeric,
    "quantity_baked" numeric NOT NULL,
    "quantity_loss" numeric NOT NULL,
    "loss_reason" "text",
    "changed_by" "uuid" NOT NULL,
    "changed_by_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "production_actual_events_lot_code_matches_date" CHECK (("lot_code" = ('L'::"text" || "to_char"(("record_date")::timestamp with time zone, 'MMDD'::"text")))),
    CONSTRAINT "production_actual_events_quantities_are_whole_units" CHECK ((("quantity_baked" = "trunc"("quantity_baked")) AND ("quantity_loss" = "trunc"("quantity_loss")))),
    CONSTRAINT "production_actual_events_quantities_non_negative" CHECK ((("quantity_baked" >= (0)::numeric) AND ("quantity_loss" >= (0)::numeric)))
);

ALTER TABLE ONLY "public"."production_actual_events" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."production_actual_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."production_actual_events" IS 'Historico imutavel das confirmacoes e correcoes feitas no Forno.';



CREATE TABLE IF NOT EXISTS "public"."production_actuals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "record_date" "date" NOT NULL,
    "bread_id" "text" NOT NULL,
    "quantity_baked" numeric DEFAULT 0 NOT NULL,
    "quantity_loss" numeric DEFAULT 0 NOT NULL,
    "loss_reason" "text",
    "recorded_by" "text" NOT NULL,
    "obs" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "lot_code" "text" NOT NULL,
    CONSTRAINT "production_actuals_lot_code_matches_date" CHECK (("lot_code" = ('L'::"text" || "to_char"(("record_date")::timestamp with time zone, 'MMDD'::"text")))),
    CONSTRAINT "production_actuals_quantities_are_whole_units" CHECK ((("quantity_baked" = "trunc"("quantity_baked")) AND ("quantity_loss" = "trunc"("quantity_loss")))),
    CONSTRAINT "production_actuals_quantities_non_negative" CHECK ((("quantity_baked" >= (0)::numeric) AND ("quantity_loss" >= (0)::numeric)))
);


ALTER TABLE "public"."production_actuals" OWNER TO "postgres";


COMMENT ON COLUMN "public"."production_actuals"."quantity_baked" IS 'Quantidade boa que saiu do forno e entrou no estoque de paes.';



COMMENT ON COLUMN "public"."production_actuals"."quantity_loss" IS 'Perda ocorrida no forno. E apenas analitica porque nunca entrou no estoque.';



COMMENT ON COLUMN "public"."production_actuals"."lot_code" IS 'Codigo operacional diario no formato LMMDD. O UUID da linha distingue produto, ano e data.';



CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "category" "text" DEFAULT 'Outros'::"text" NOT NULL,
    "active" boolean DEFAULT true,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "cost_price" numeric(10,2) DEFAULT 0,
    "unit" "text" DEFAULT 'un'::"text",
    "is_special" boolean DEFAULT false NOT NULL,
    "kind" "text",
    "is_revenda" boolean DEFAULT false NOT NULL,
    "is_shelf" boolean DEFAULT false NOT NULL,
    "is_fabricacao_propria" boolean DEFAULT false NOT NULL,
    "is_pj" boolean DEFAULT false NOT NULL,
    "production_days" integer[] DEFAULT '{}'::integer[] NOT NULL,
    "production_area" "text",
    "legacy_bread_id" "text",
    CONSTRAINT "products_kind_check" CHECK (("kind" = ANY (ARRAY['kit'::"text", 'insumo'::"text", 'final'::"text"]))),
    CONSTRAINT "products_production_area_valid" CHECK ((("production_area" IS NULL) OR ("production_area" = ANY (ARRAY['padaria'::"text", 'cozinha'::"text", 'confeitaria'::"text", 'expedicao'::"text", 'outros'::"text"])))),
    CONSTRAINT "products_production_days_valid" CHECK (("production_days" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]))
);


ALTER TABLE "public"."products" OWNER TO "postgres";


COMMENT ON COLUMN "public"."products"."is_fabricacao_propria" IS 'Indica produto fabricado internamente. Preparacao para unificar breads em products.';



COMMENT ON COLUMN "public"."products"."is_pj" IS 'Indica item disponivel no catalogo PJ. Preparacao para remover dependencia de breads.is_pj.';



COMMENT ON COLUMN "public"."products"."production_days" IS 'Dias da semana em que o produto aparece no planejamento de producao. Usa 0..6, mantendo o padrao historico de breads.days.';



COMMENT ON COLUMN "public"."products"."production_area" IS 'Area operacional responsavel pela producao: padaria, cozinha, confeitaria, expedicao ou outros.';



COMMENT ON COLUMN "public"."products"."legacy_bread_id" IS 'Vinculo temporario com public.breads.id durante a migracao para catalogo unico.';



CREATE TABLE IF NOT EXISTS "public"."purchase_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "list_id" "uuid",
    "product_id" "uuid",
    "ad_hoc_name" "text",
    "unit" "text",
    "quantity" numeric,
    "checked" boolean DEFAULT false,
    "is_adhoc" boolean DEFAULT false,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "outcome" "text" DEFAULT 'pendente'::"text",
    "bought_quantity" numeric,
    "bought_by" "text",
    "bought_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "item_must_have_name" CHECK ((("product_id" IS NOT NULL) OR ("ad_hoc_name" IS NOT NULL))),
    CONSTRAINT "purchase_items_outcome_check" CHECK (("outcome" = ANY (ARRAY['pendente'::"text", 'comprado'::"text", 'tem'::"text", 'nao_encontrei'::"text"])))
);


ALTER TABLE "public"."purchase_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchase_lists" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sector" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text",
    "submitted_at" timestamp with time zone,
    "submitted_by" "text",
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "text",
    "closed_by" "text",
    "closed_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "purchase_lists_sector_check" CHECK (("sector" = ANY (ARRAY['padaria'::"text", 'cozinha'::"text", 'loja'::"text"]))),
    CONSTRAINT "purchase_lists_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'submitted'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."purchase_lists" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quotation_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "quotation_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "quantity" numeric DEFAULT 1 NOT NULL,
    "unit" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "quotation_items_quantity_check" CHECK (("quantity" > (0)::numeric))
);


ALTER TABLE "public"."quotation_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quotation_responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "quotation_id" "uuid" NOT NULL,
    "supplier_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "unit_price" numeric NOT NULL,
    "unit" "text",
    "available" boolean DEFAULT true NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "quotation_responses_unit_price_check" CHECK (("unit_price" >= (0)::numeric))
);


ALTER TABLE "public"."quotation_responses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quotation_suppliers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "quotation_id" "uuid" NOT NULL,
    "supplier_id" "uuid" NOT NULL,
    "channel" "text" DEFAULT 'whatsapp'::"text" NOT NULL,
    "generated_message" "text",
    "sent_at" timestamp with time zone,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "quotation_suppliers_channel_check" CHECK (("channel" = ANY (ARRAY['whatsapp'::"text", 'telegram'::"text", 'manual'::"text"]))),
    CONSTRAINT "quotation_suppliers_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'responded'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."quotation_suppliers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quotations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "week_reference" "date" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_by" "text" NOT NULL,
    CONSTRAINT "quotations_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'sent'::"text", 'responded'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."quotations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."romaneio_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "romaneio_id" "uuid",
    "product_id" "text",
    "product_source" "text" DEFAULT 'bread'::"text" NOT NULL,
    "product_name" "text" NOT NULL,
    "qty_sent" numeric DEFAULT 0 NOT NULL,
    "qty_received" numeric,
    "qty_accepted" numeric,
    "unit_price" numeric DEFAULT 0,
    "divergence_reason" "text" DEFAULT ''::"text",
    "obs" "text" DEFAULT ''::"text",
    "item_status" "text" DEFAULT 'pendente'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."romaneio_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."romaneios" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "record_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "destination_id" "uuid",
    "trip_number" integer DEFAULT 1 NOT NULL,
    "status" "text" DEFAULT 'separado'::"text" NOT NULL,
    "created_by" "text" NOT NULL,
    "sent_by" "text",
    "sent_at" timestamp with time zone,
    "confirmed_by" "text",
    "confirmed_at" timestamp with time zone,
    "obs" "text" DEFAULT ''::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."romaneios" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shelf_counts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "record_date" "date" NOT NULL,
    "store" "text" NOT NULL,
    "product_id" "text" NOT NULL,
    "product_source" "text" NOT NULL,
    "quantity" numeric DEFAULT 0 NOT NULL,
    "counted_by" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "shelf_counts_product_source_check" CHECK (("product_source" = ANY (ARRAY['bread'::"text", 'product'::"text"]))),
    CONSTRAINT "shelf_counts_quantity_check" CHECK (("quantity" >= (0)::numeric))
);


ALTER TABLE "public"."shelf_counts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sobras" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "record_date" "date" NOT NULL,
    "responsible" "text" NOT NULL,
    "product_id" "text",
    "quantity" numeric DEFAULT 0 NOT NULL,
    "obs" "text" DEFAULT ''::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "product_source" "text" DEFAULT 'catalog'::"text",
    "store" "text",
    "production_actual_id" "uuid",
    "lot_code" "text",
    "pending_quantity" numeric,
    "status" "text",
    "physical_location" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reconciliation_status" "text",
    CONSTRAINT "sobras_lot_code_matches_date" CHECK ((("lot_code" IS NULL) OR ("lot_code" = ('L'::"text" || "to_char"(("record_date")::timestamp with time zone, 'MMDD'::"text"))))),
    CONSTRAINT "sobras_managed_fields_check" CHECK ((("store" IS NULL) OR (("product_source" = 'bread'::"text") AND ("product_id" IS NOT NULL) AND ("lot_code" IS NOT NULL) AND ("pending_quantity" IS NOT NULL) AND ("status" IS NOT NULL) AND ("physical_location" IS NOT NULL) AND ("reconciliation_status" IS NOT NULL) AND (("reconciliation_status" = ANY (ARRAY['awaiting_oven'::"text", 'not_required'::"text"])) OR ("production_actual_id" IS NOT NULL))))),
    CONSTRAINT "sobras_managed_store_check" CHECK ((("store" IS NULL) OR ("store" = ANY (ARRAY['jc'::"text", 'ja'::"text"])))),
    CONSTRAINT "sobras_pending_quantity_check" CHECK ((("pending_quantity" IS NULL) OR (("pending_quantity" >= (0)::numeric) AND ("pending_quantity" <= "quantity")))),
    CONSTRAINT "sobras_physical_location_check" CHECK ((("physical_location" IS NULL) OR ("physical_location" = ANY (ARRAY['balcao_fechamento'::"text", 'mesa_separacao'::"text", 'padaria_cozinha'::"text"])))),
    CONSTRAINT "sobras_product_source_check" CHECK (("product_source" = ANY (ARRAY['catalog'::"text", 'bread'::"text"]))),
    CONSTRAINT "sobras_reconciliation_status_check" CHECK ((("reconciliation_status" IS NULL) OR ("reconciliation_status" = ANY (ARRAY['awaiting_oven'::"text", 'confirmed'::"text", 'not_required'::"text"])))),
    CONSTRAINT "sobras_status_check" CHECK ((("status" IS NULL) OR ("status" = ANY (ARRAY['pending'::"text", 'resolved'::"text", 'cancelled'::"text"]))))
);

ALTER TABLE ONLY "public"."sobras" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."sobras" OWNER TO "postgres";


COMMENT ON COLUMN "public"."sobras"."pending_quantity" IS 'Saldo do lote ainda aguardando destino. NULL identifica registro legado.';



COMMENT ON COLUMN "public"."sobras"."physical_location" IS 'Local fisico do saldo ainda pendente; destinos resolvidos ficam no historico de eventos.';



COMMENT ON COLUMN "public"."sobras"."reconciliation_status" IS 'confirmed: ligado ao Forno; awaiting_oven: fato fisico salvo antes do Forno; not_required: fechamento corrigido para zero.';



CREATE TABLE IF NOT EXISTS "public"."stock_balance" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "product_id" "uuid" NOT NULL,
    "quantity" numeric(10,3) DEFAULT 0 NOT NULL,
    "average_cost" numeric(10,4) DEFAULT 0 NOT NULL,
    "last_updated" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."stock_balance" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "supplier_id" "uuid",
    "entry_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "invoice_number" "text",
    "total_value" numeric(10,2),
    "notes" "text",
    "created_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."stock_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_entry_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "entry_id" "uuid" NOT NULL,
    "product_id" "uuid",
    "product_name" "text" NOT NULL,
    "quantity" numeric(10,3) NOT NULL,
    "unit" "text" NOT NULL,
    "unit_cost" numeric(10,4) NOT NULL,
    "total_cost" numeric(10,2) GENERATED ALWAYS AS (("quantity" * "unit_cost")) STORED
);


ALTER TABLE "public"."stock_entry_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "product_id" "uuid" NOT NULL,
    "movement_type" "text" NOT NULL,
    "quantity" numeric(10,3) NOT NULL,
    "unit_cost" numeric(10,4),
    "reference_id" "uuid",
    "reference_type" "text",
    "notes" "text",
    "created_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "stock_movements_movement_type_check" CHECK (("movement_type" = ANY (ARRAY['entrada'::"text", 'saida'::"text", 'ajuste'::"text", 'descarte'::"text"])))
);


ALTER TABLE "public"."stock_movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."supplier_order_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "supplier_order_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "quantity" numeric NOT NULL,
    "unit_price" numeric NOT NULL,
    "unit" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "supplier_order_items_quantity_check" CHECK (("quantity" > (0)::numeric)),
    CONSTRAINT "supplier_order_items_unit_price_check" CHECK (("unit_price" >= (0)::numeric))
);


ALTER TABLE "public"."supplier_order_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."supplier_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "quotation_id" "uuid",
    "supplier_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notes" "text",
    CONSTRAINT "supplier_orders_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'sent'::"text", 'received'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."supplier_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."supplier_products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "supplier_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "default_unit" "text",
    "supplier_code" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."supplier_products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."suppliers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "cnpj" "text",
    "phone" "text",
    "email" "text",
    "notes" "text",
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "whatsapp_e164" "text",
    "telegram_handle" "text"
);


ALTER TABLE "public"."suppliers" OWNER TO "postgres";


ALTER TABLE ONLY "public"."app_permissions"
    ADD CONSTRAINT "app_permissions_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."app_profiles"
    ADD CONSTRAINT "app_profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."app_user_permissions"
    ADD CONSTRAINT "app_user_permissions_pkey" PRIMARY KEY ("user_id", "permission_key", "scope");



ALTER TABLE ONLY "public"."app_users"
    ADD CONSTRAINT "app_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bread_leftover_events"
    ADD CONSTRAINT "bread_leftover_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bread_movements"
    ADD CONSTRAINT "bread_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bread_reuse_plan_allocations"
    ADD CONSTRAINT "bread_reuse_plan_allocations_pkey" PRIMARY KEY ("plan_id", "sobra_id");



ALTER TABLE ONLY "public"."bread_reuse_plans"
    ADD CONSTRAINT "bread_reuse_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bread_reuse_plans"
    ADD CONSTRAINT "bread_reuse_plans_unique" UNIQUE ("target_production_date", "store", "bread_id");



ALTER TABLE ONLY "public"."breads"
    ADD CONSTRAINT "breads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cash_closings"
    ADD CONSTRAINT "cash_closings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cash_closings"
    ADD CONSTRAINT "cash_closings_store_date_unique" UNIQUE ("store", "closing_date");



ALTER TABLE ONLY "public"."customer_price_overrides"
    ADD CONSTRAINT "customer_price_overrides_customer_product_source_option_key" UNIQUE NULLS NOT DISTINCT ("customer_id", "product_id", "product_source", "sale_option_id");



ALTER TABLE ONLY "public"."customer_price_overrides"
    ADD CONSTRAINT "customer_price_overrides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."descartes"
    ADD CONSTRAINT "descartes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."descartes"
    ADD CONSTRAINT "descartes_unique" UNIQUE ("record_date", "responsible", "product_id", "product_source");



ALTER TABLE ONLY "public"."descartes"
    ADD CONSTRAINT "descartes_unique_registro" UNIQUE ("record_date", "responsible", "product_id", "product_source");



ALTER TABLE ONLY "public"."destinations"
    ADD CONSTRAINT "destinations_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."destinations"
    ADD CONSTRAINT "destinations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."frozen_movements"
    ADD CONSTRAINT "frozen_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."frozen_products"
    ADD CONSTRAINT "frozen_products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."frozen_stock"
    ADD CONSTRAINT "frozen_stock_frozen_product_id_location_key" UNIQUE ("frozen_product_id", "location");



ALTER TABLE ONLY "public"."frozen_stock"
    ADD CONSTRAINT "frozen_stock_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pizza_categorias"
    ADD CONSTRAINT "pizza_categorias_nome_key" UNIQUE ("nome");



ALTER TABLE ONLY "public"."pizza_categorias"
    ADD CONSTRAINT "pizza_categorias_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pizza_despesas"
    ADD CONSTRAINT "pizza_despesas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pizza_usuarios"
    ADD CONSTRAINT "pizza_usuarios_pkey" PRIMARY KEY ("email");



ALTER TABLE ONLY "public"."pizza_vendas"
    ADD CONSTRAINT "pizza_vendas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."price_tier_items"
    ADD CONSTRAINT "price_tier_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."price_tier_items"
    ADD CONSTRAINT "price_tier_items_tier_product_source_option_key" UNIQUE NULLS NOT DISTINCT ("tier_id", "product_id", "product_source", "sale_option_id");



ALTER TABLE ONLY "public"."price_tiers"
    ADD CONSTRAINT "price_tiers_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."price_tiers"
    ADD CONSTRAINT "price_tiers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_components"
    ADD CONSTRAINT "product_components_parent_product_id_component_source_compo_key" UNIQUE ("parent_product_id", "component_source", "component_id");



ALTER TABLE ONLY "public"."product_components"
    ADD CONSTRAINT "product_components_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_prices"
    ADD CONSTRAINT "product_prices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_prices"
    ADD CONSTRAINT "product_prices_product_id_product_source_destination_id_key" UNIQUE ("product_id", "product_source", "destination_id");



ALTER TABLE ONLY "public"."product_production"
    ADD CONSTRAINT "product_production_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_production"
    ADD CONSTRAINT "product_production_store_product_id_production_date_key" UNIQUE ("store", "product_id", "production_date");



ALTER TABLE ONLY "public"."product_recipe_yields"
    ADD CONSTRAINT "product_recipe_yields_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_recipe_yields"
    ADD CONSTRAINT "product_recipe_yields_product_id_key" UNIQUE ("product_id");



ALTER TABLE ONLY "public"."product_sale_options"
    ADD CONSTRAINT "product_sale_options_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_sale_options"
    ADD CONSTRAINT "product_sale_options_product_unit_key" UNIQUE ("product_id", "sale_unit");



ALTER TABLE ONLY "public"."production_actual_events"
    ADD CONSTRAINT "production_actual_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."production_actuals"
    ADD CONSTRAINT "production_actuals_bread_id_record_date_key" UNIQUE ("bread_id", "record_date");



ALTER TABLE ONLY "public"."production_actuals"
    ADD CONSTRAINT "production_actuals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_leftovers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_items"
    ADD CONSTRAINT "purchase_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_lists"
    ADD CONSTRAINT "purchase_lists_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quotation_items"
    ADD CONSTRAINT "quotation_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quotation_items"
    ADD CONSTRAINT "quotation_items_quotation_id_product_id_key" UNIQUE ("quotation_id", "product_id");



ALTER TABLE ONLY "public"."quotation_responses"
    ADD CONSTRAINT "quotation_responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quotation_responses"
    ADD CONSTRAINT "quotation_responses_quotation_id_supplier_id_product_id_key" UNIQUE ("quotation_id", "supplier_id", "product_id");



ALTER TABLE ONLY "public"."quotation_suppliers"
    ADD CONSTRAINT "quotation_suppliers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quotation_suppliers"
    ADD CONSTRAINT "quotation_suppliers_quotation_id_supplier_id_key" UNIQUE ("quotation_id", "supplier_id");



ALTER TABLE ONLY "public"."quotations"
    ADD CONSTRAINT "quotations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."romaneio_items"
    ADD CONSTRAINT "romaneio_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."romaneios"
    ADD CONSTRAINT "romaneios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."romaneios"
    ADD CONSTRAINT "romaneios_record_date_destination_id_trip_number_key" UNIQUE ("record_date", "destination_id", "trip_number");



ALTER TABLE ONLY "public"."shelf_counts"
    ADD CONSTRAINT "shelf_counts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shelf_counts"
    ADD CONSTRAINT "shelf_counts_record_date_store_product_id_product_source_key" UNIQUE ("record_date", "store", "product_id", "product_source");



ALTER TABLE ONLY "public"."sobras"
    ADD CONSTRAINT "sobras_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_balance"
    ADD CONSTRAINT "stock_balance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_balance"
    ADD CONSTRAINT "stock_balance_product_id_key" UNIQUE ("product_id");



ALTER TABLE ONLY "public"."stock_entries"
    ADD CONSTRAINT "stock_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_entry_items"
    ADD CONSTRAINT "stock_entry_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supplier_order_items"
    ADD CONSTRAINT "supplier_order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supplier_orders"
    ADD CONSTRAINT "supplier_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supplier_products"
    ADD CONSTRAINT "supplier_products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supplier_products"
    ADD CONSTRAINT "supplier_products_supplier_id_product_id_key" UNIQUE ("supplier_id", "product_id");



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id");



CREATE INDEX "bread_leftover_events_reuse_plan_idx" ON "public"."bread_leftover_events" USING "btree" ("reuse_plan_id") WHERE ("reuse_plan_id" IS NOT NULL);



CREATE INDEX "bread_leftover_events_sobra_created_idx" ON "public"."bread_leftover_events" USING "btree" ("sobra_id", "created_at" DESC);



CREATE INDEX "bread_movements_lot_id_idx" ON "public"."bread_movements" USING "btree" ("lot_id") WHERE ("lot_id" IS NOT NULL);



CREATE INDEX "bread_reuse_plan_allocations_sobra_idx" ON "public"."bread_reuse_plan_allocations" USING "btree" ("sobra_id");



CREATE INDEX "bread_reuse_plans_bread_id_idx" ON "public"."bread_reuse_plans" USING "btree" ("bread_id");



CREATE INDEX "bread_reuse_plans_date_status_idx" ON "public"."bread_reuse_plans" USING "btree" ("target_production_date", "status", "bread_id");



CREATE INDEX "cash_closings_closing_date_idx" ON "public"."cash_closings" USING "btree" ("closing_date" DESC);



CREATE INDEX "cash_closings_store_date_idx" ON "public"."cash_closings" USING "btree" ("store", "closing_date" DESC);



CREATE INDEX "customer_price_overrides_sale_option_idx" ON "public"."customer_price_overrides" USING "btree" ("sale_option_id") WHERE ("sale_option_id" IS NOT NULL);



CREATE UNIQUE INDEX "frozen_products_catalog_uniq" ON "public"."frozen_products" USING "btree" ("product_id", "product_source") WHERE (("active" = true) AND ("product_id" IS NOT NULL));



CREATE INDEX "idx_bread_mov_date" ON "public"."bread_movements" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_bread_mov_location_bread" ON "public"."bread_movements" USING "btree" ("location", "bread_id");



CREATE INDEX "idx_bread_mov_ref" ON "public"."bread_movements" USING "btree" ("reference_type", "reference_id");



CREATE INDEX "idx_customers_active" ON "public"."customers" USING "btree" ("active") WHERE ("active" = true);



CREATE INDEX "idx_frozen_movements_date" ON "public"."frozen_movements" USING "btree" ("created_at");



CREATE INDEX "idx_frozen_movements_product" ON "public"."frozen_movements" USING "btree" ("frozen_product_id");



CREATE INDEX "idx_frozen_stock_product" ON "public"."frozen_stock" USING "btree" ("frozen_product_id");



CREATE INDEX "idx_overrides_lookup" ON "public"."customer_price_overrides" USING "btree" ("customer_id", "active");



CREATE INDEX "idx_prod_actuals_date" ON "public"."production_actuals" USING "btree" ("record_date");



CREATE INDEX "idx_product_components_parent" ON "public"."product_components" USING "btree" ("parent_product_id");



CREATE INDEX "idx_products_is_revenda" ON "public"."products" USING "btree" ("is_revenda") WHERE ("is_revenda" = true);



CREATE INDEX "idx_products_kind" ON "public"."products" USING "btree" ("kind") WHERE ("kind" IS NOT NULL);



CREATE INDEX "idx_quotation_items_quotation" ON "public"."quotation_items" USING "btree" ("quotation_id");



CREATE INDEX "idx_quotation_responses_lookup" ON "public"."quotation_responses" USING "btree" ("quotation_id", "supplier_id");



CREATE INDEX "idx_quotation_suppliers_quotation" ON "public"."quotation_suppliers" USING "btree" ("quotation_id");



CREATE INDEX "idx_quotations_week" ON "public"."quotations" USING "btree" ("week_reference" DESC);



CREATE INDEX "idx_shelf_counts_date_store" ON "public"."shelf_counts" USING "btree" ("record_date" DESC, "store");



CREATE INDEX "idx_stock_entries_date" ON "public"."stock_entries" USING "btree" ("entry_date");



CREATE INDEX "idx_stock_entry_items_entry" ON "public"."stock_entry_items" USING "btree" ("entry_id");



CREATE INDEX "idx_stock_movements_date" ON "public"."stock_movements" USING "btree" ("created_at");



CREATE INDEX "idx_stock_movements_product" ON "public"."stock_movements" USING "btree" ("product_id");



CREATE INDEX "idx_supplier_order_items_order" ON "public"."supplier_order_items" USING "btree" ("supplier_order_id");



CREATE INDEX "idx_supplier_orders_quotation" ON "public"."supplier_orders" USING "btree" ("quotation_id");



CREATE INDEX "idx_supplier_products_product" ON "public"."supplier_products" USING "btree" ("product_id") WHERE ("active" = true);



CREATE INDEX "idx_supplier_products_supplier" ON "public"."supplier_products" USING "btree" ("supplier_id") WHERE ("active" = true);



CREATE INDEX "idx_tier_items_lookup" ON "public"."price_tier_items" USING "btree" ("tier_id", "active");



CREATE INDEX "orders_order_group_id_idx" ON "public"."orders" USING "btree" ("order_group_id") WHERE ("order_group_id" IS NOT NULL);



CREATE INDEX "orders_pj_dispatch_queue_idx" ON "public"."orders" USING "btree" ("order_type", "dispatched_at", "delivery_date") WHERE (("order_type" = 'pj'::"text") AND ("cancelled_at" IS NULL));



CREATE INDEX "orders_sale_option_idx" ON "public"."orders" USING "btree" ("sale_option_id") WHERE ("sale_option_id" IS NOT NULL);



CREATE UNIQUE INDEX "orders_store_bread_id_order_date_key" ON "public"."orders" USING "btree" ("store", "bread_id", "order_date") WHERE ("store" <> 'pj'::"text");



CREATE INDEX "pizza_despesas_vencimento_idx" ON "public"."pizza_despesas" USING "btree" ("vencimento");



CREATE INDEX "pizza_vendas_data_idx" ON "public"."pizza_vendas" USING "btree" ("data");



CREATE INDEX "price_tier_items_sale_option_idx" ON "public"."price_tier_items" USING "btree" ("sale_option_id") WHERE ("sale_option_id" IS NOT NULL);



CREATE INDEX "product_production_date_store_idx" ON "public"."product_production" USING "btree" ("production_date", "store");



CREATE UNIQUE INDEX "product_sale_options_default_key" ON "public"."product_sale_options" USING "btree" ("product_id") WHERE ("is_default" AND "active");



CREATE INDEX "product_sale_options_product_idx" ON "public"."product_sale_options" USING "btree" ("product_id") WHERE "active";



CREATE INDEX "production_actual_events_actual_created_idx" ON "public"."production_actual_events" USING "btree" ("production_actual_id", "created_at" DESC);



CREATE INDEX "products_fabricacao_propria_idx" ON "public"."products" USING "btree" ("is_fabricacao_propria") WHERE ("active" IS DISTINCT FROM false);



CREATE UNIQUE INDEX "products_legacy_bread_id_key" ON "public"."products" USING "btree" ("legacy_bread_id") WHERE ("legacy_bread_id" IS NOT NULL);



CREATE INDEX "products_pj_idx" ON "public"."products" USING "btree" ("is_pj") WHERE ("active" IS DISTINCT FROM false);



CREATE INDEX "sobras_awaiting_oven_idx" ON "public"."sobras" USING "btree" ("record_date", "product_id", "store") WHERE ("reconciliation_status" = 'awaiting_oven'::"text");



CREATE UNIQUE INDEX "sobras_legacy_unique_idx" ON "public"."sobras" USING "btree" ("record_date", "responsible", "product_id", "product_source") WHERE ("store" IS NULL);



CREATE UNIQUE INDEX "sobras_managed_closing_unique_idx" ON "public"."sobras" USING "btree" ("store", "product_id", "record_date") WHERE (("store" IS NOT NULL) AND ("product_source" = 'bread'::"text"));



CREATE INDEX "sobras_pending_store_date_idx" ON "public"."sobras" USING "btree" ("store", "record_date", "product_id") WHERE (("pending_quantity" > (0)::numeric) AND ("store" IS NOT NULL));



CREATE INDEX "sobras_production_actual_id_idx" ON "public"."sobras" USING "btree" ("production_actual_id") WHERE ("production_actual_id" IS NOT NULL);



CREATE OR REPLACE TRIGGER "guard_dispatched_pj_order_changes" BEFORE DELETE OR UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "private"."guard_dispatched_pj_order_changes"();



CREATE OR REPLACE TRIGGER "guard_pj_dispatch_write" BEFORE INSERT OR UPDATE OF "dispatched_at", "dispatched_by", "dispatched_by_name" ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "private"."guard_pj_dispatch_write"();



CREATE OR REPLACE TRIGGER "reconcile_bread_leftovers_after_oven" AFTER INSERT OR UPDATE OF "lot_code" ON "public"."production_actuals" FOR EACH ROW EXECUTE FUNCTION "public"."reconcile_bread_leftovers_after_oven"();



CREATE OR REPLACE TRIGGER "set_app_profiles_updated_at" BEFORE UPDATE ON "public"."app_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_app_profiles_updated_at"();



CREATE OR REPLACE TRIGGER "set_cash_closings_updated_at" BEFORE UPDATE ON "public"."cash_closings" FOR EACH ROW EXECUTE FUNCTION "public"."set_cash_closings_updated_at"();



ALTER TABLE ONLY "public"."app_profiles"
    ADD CONSTRAINT "app_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."app_user_permissions"
    ADD CONSTRAINT "app_user_permissions_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."app_user_permissions"
    ADD CONSTRAINT "app_user_permissions_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "public"."app_permissions"("key") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."app_user_permissions"
    ADD CONSTRAINT "app_user_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."app_profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bread_leftover_events"
    ADD CONSTRAINT "bread_leftover_events_reuse_plan_id_fkey" FOREIGN KEY ("reuse_plan_id") REFERENCES "public"."bread_reuse_plans"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."bread_leftover_events"
    ADD CONSTRAINT "bread_leftover_events_sobra_id_fkey" FOREIGN KEY ("sobra_id") REFERENCES "public"."sobras"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."bread_movements"
    ADD CONSTRAINT "bread_movements_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "public"."production_actuals"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."bread_reuse_plan_allocations"
    ADD CONSTRAINT "bread_reuse_plan_allocations_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."bread_reuse_plans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bread_reuse_plan_allocations"
    ADD CONSTRAINT "bread_reuse_plan_allocations_sobra_id_fkey" FOREIGN KEY ("sobra_id") REFERENCES "public"."sobras"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."bread_reuse_plans"
    ADD CONSTRAINT "bread_reuse_plans_bread_id_fkey" FOREIGN KEY ("bread_id") REFERENCES "public"."breads"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."customer_price_overrides"
    ADD CONSTRAINT "customer_price_overrides_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_price_overrides"
    ADD CONSTRAINT "customer_price_overrides_sale_option_id_fkey" FOREIGN KEY ("sale_option_id") REFERENCES "public"."product_sale_options"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_default_tier_id_fkey" FOREIGN KEY ("default_tier_id") REFERENCES "public"."price_tiers"("id");



ALTER TABLE ONLY "public"."frozen_movements"
    ADD CONSTRAINT "frozen_movements_frozen_product_id_fkey" FOREIGN KEY ("frozen_product_id") REFERENCES "public"."frozen_products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."frozen_stock"
    ADD CONSTRAINT "frozen_stock_frozen_product_id_fkey" FOREIGN KEY ("frozen_product_id") REFERENCES "public"."frozen_products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_dispatched_by_fkey" FOREIGN KEY ("dispatched_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_sale_option_id_fkey" FOREIGN KEY ("sale_option_id") REFERENCES "public"."product_sale_options"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pizza_despesas"
    ADD CONSTRAINT "pizza_despesas_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "public"."pizza_categorias"("id");



ALTER TABLE ONLY "public"."price_tier_items"
    ADD CONSTRAINT "price_tier_items_sale_option_id_fkey" FOREIGN KEY ("sale_option_id") REFERENCES "public"."product_sale_options"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."price_tier_items"
    ADD CONSTRAINT "price_tier_items_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "public"."price_tiers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_components"
    ADD CONSTRAINT "product_components_parent_product_id_fkey" FOREIGN KEY ("parent_product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_prices"
    ADD CONSTRAINT "product_prices_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id");



ALTER TABLE ONLY "public"."product_production"
    ADD CONSTRAINT "product_production_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_recipe_yields"
    ADD CONSTRAINT "product_recipe_yields_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_sale_options"
    ADD CONSTRAINT "product_sale_options_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."production_actual_events"
    ADD CONSTRAINT "production_actual_events_production_actual_id_fkey" FOREIGN KEY ("production_actual_id") REFERENCES "public"."production_actuals"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchase_items"
    ADD CONSTRAINT "purchase_items_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "public"."purchase_lists"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_items"
    ADD CONSTRAINT "purchase_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."quotation_items"
    ADD CONSTRAINT "quotation_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."quotation_items"
    ADD CONSTRAINT "quotation_items_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quotation_responses"
    ADD CONSTRAINT "quotation_responses_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."quotation_responses"
    ADD CONSTRAINT "quotation_responses_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quotation_responses"
    ADD CONSTRAINT "quotation_responses_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id");



ALTER TABLE ONLY "public"."quotation_suppliers"
    ADD CONSTRAINT "quotation_suppliers_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quotation_suppliers"
    ADD CONSTRAINT "quotation_suppliers_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id");



ALTER TABLE ONLY "public"."romaneio_items"
    ADD CONSTRAINT "romaneio_items_romaneio_id_fkey" FOREIGN KEY ("romaneio_id") REFERENCES "public"."romaneios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."romaneios"
    ADD CONSTRAINT "romaneios_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id");



ALTER TABLE ONLY "public"."sobras"
    ADD CONSTRAINT "sobras_production_actual_id_fkey" FOREIGN KEY ("production_actual_id") REFERENCES "public"."production_actuals"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."stock_balance"
    ADD CONSTRAINT "stock_balance_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."stock_entries"
    ADD CONSTRAINT "stock_entries_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id");



ALTER TABLE ONLY "public"."stock_entry_items"
    ADD CONSTRAINT "stock_entry_items_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "public"."stock_entries"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stock_entry_items"
    ADD CONSTRAINT "stock_entry_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."supplier_order_items"
    ADD CONSTRAINT "supplier_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."supplier_order_items"
    ADD CONSTRAINT "supplier_order_items_supplier_order_id_fkey" FOREIGN KEY ("supplier_order_id") REFERENCES "public"."supplier_orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."supplier_orders"
    ADD CONSTRAINT "supplier_orders_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id");



ALTER TABLE ONLY "public"."supplier_orders"
    ADD CONSTRAINT "supplier_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id");



ALTER TABLE ONLY "public"."supplier_products"
    ADD CONSTRAINT "supplier_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."supplier_products"
    ADD CONSTRAINT "supplier_products_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE CASCADE;



ALTER TABLE "public"."app_permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_permissions_select_authenticated" ON "public"."app_permissions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "profile"
  WHERE (("profile"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "profile"."active"))));



ALTER TABLE "public"."app_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_profiles_select_access_admin" ON "public"."app_profiles" FOR SELECT TO "authenticated" USING (( SELECT "private"."current_user_is_access_admin"() AS "current_user_is_access_admin"));



CREATE POLICY "app_profiles_select_own" ON "public"."app_profiles" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."app_user_permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_user_permissions_delete_admin" ON "public"."app_user_permissions" FOR DELETE TO "authenticated" USING (( SELECT "private"."current_user_is_access_admin"() AS "current_user_is_access_admin"));



CREATE POLICY "app_user_permissions_insert_admin" ON "public"."app_user_permissions" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "private"."current_user_is_access_admin"() AS "current_user_is_access_admin") AND ("granted_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "app_user_permissions_select_own_or_admin" ON "public"."app_user_permissions" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "private"."current_user_is_access_admin"() AS "current_user_is_access_admin")));



ALTER TABLE "public"."app_users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bread_leftover_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bread_leftover_events_select_active_profiles" ON "public"."bread_leftover_events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."app_profiles" "profile"
     JOIN "public"."sobras" "sobra" ON (("sobra"."id" = "bread_leftover_events"."sobra_id")))
  WHERE (("profile"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "profile"."active" AND (("profile"."role" <> 'vendas'::"text") OR ("profile"."store" = "sobra"."store"))))));



ALTER TABLE "public"."bread_movements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bread_movements_delete_sobras_route" ON "public"."bread_movements" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/sobras'::"text") AND (("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) OR ("lower"("p"."store") = "lower"("bread_movements"."location")))))));



CREATE POLICY "bread_movements_insert_sobras_route" ON "public"."bread_movements" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/sobras'::"text") AND (("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) OR ("lower"("p"."store") = "lower"("bread_movements"."location")))))));



CREATE POLICY "bread_movements_select_authenticated_profiles" ON "public"."bread_movements" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "profile"
  WHERE (("profile"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "profile"."active"))));



CREATE POLICY "bread_reuse_allocations_select_active_profiles" ON "public"."bread_reuse_plan_allocations" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."app_profiles" "profile"
     JOIN "public"."sobras" "sobra" ON (("sobra"."id" = "bread_reuse_plan_allocations"."sobra_id")))
  WHERE (("profile"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "profile"."active" AND (("profile"."role" <> 'vendas'::"text") OR ("profile"."store" = "sobra"."store"))))));



ALTER TABLE "public"."bread_reuse_plan_allocations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bread_reuse_plans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bread_reuse_plans_select_active_profiles" ON "public"."bread_reuse_plans" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "profile"
  WHERE (("profile"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "profile"."active" AND (("profile"."role" <> 'vendas'::"text") OR ("profile"."store" = "bread_reuse_plans"."store"))))));



ALTER TABLE "public"."breads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "breads_delete_catalog_managers" ON "public"."breads" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/produtos'::"text")))));



CREATE POLICY "breads_insert_catalog_managers" ON "public"."breads" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/produtos'::"text")))));



CREATE POLICY "breads_select_internal" ON "public"."breads" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active"))));



COMMENT ON POLICY "breads_select_internal" ON "public"."breads" IS 'Usuarios internos autenticados podem ler paes legados usados em composicoes.';



CREATE POLICY "breads_update_catalog_managers" ON "public"."breads" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/produtos'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/produtos'::"text")))));



ALTER TABLE "public"."cash_closings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cash_closings_insert_internal" ON "public"."cash_closings" FOR INSERT TO "authenticated" WITH CHECK ((("created_by" = (( SELECT "auth"."uid"() AS "uid"))::"text") AND (EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND (("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) OR (("p"."role" = 'vendas'::"text") AND ("p"."store" = "cash_closings"."store"))))))));



CREATE POLICY "cash_closings_select_internal" ON "public"."cash_closings" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND (("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) OR (("p"."role" = 'vendas'::"text") AND ("p"."store" = "cash_closings"."store")))))));



CREATE POLICY "cash_closings_update_internal" ON "public"."cash_closings" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND (("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) OR (("p"."role" = 'vendas'::"text") AND ("p"."store" = "cash_closings"."store"))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND (("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) OR (("p"."role" = 'vendas'::"text") AND ("p"."store" = "cash_closings"."store")))))));



ALTER TABLE "public"."customer_price_overrides" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customer_price_overrides_insert_commercial" ON "public"."customer_price_overrides" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"]))))));



CREATE POLICY "customer_price_overrides_select_commercial" ON "public"."customer_price_overrides" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"]))))));



CREATE POLICY "customer_price_overrides_update_commercial" ON "public"."customer_price_overrides" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"]))))));



ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customers_insert_commercial" ON "public"."customers" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"]))))));



CREATE POLICY "customers_select_commercial" ON "public"."customers" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND (("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) OR (("p"."role" = 'vendas'::"text") AND "customers"."active"))))));



CREATE POLICY "customers_update_commercial" ON "public"."customers" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"]))))));



ALTER TABLE "public"."descartes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "descartes_manage_route_users" ON "public"."descartes" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/sobras'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/sobras'::"text")))));



ALTER TABLE "public"."destinations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "destinations_delete_managers" ON "public"."destinations" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'expedicao'::"text"])) AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/romaneio'::"text")))));



CREATE POLICY "destinations_insert_managers" ON "public"."destinations" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'expedicao'::"text"])) AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/romaneio'::"text")))));



CREATE POLICY "destinations_read_romaneio_permission" ON "public"."destinations" FOR SELECT TO "authenticated" USING ((( SELECT "private"."current_user_has_permission"('romaneio.visualizar'::"text", "destinations"."code") AS "current_user_has_permission") OR ( SELECT "private"."current_user_has_permission"('romaneio.criar'::"text", "destinations"."code") AS "current_user_has_permission") OR ( SELECT "private"."current_user_has_permission"('romaneio.confirmar_saida'::"text", "destinations"."code") AS "current_user_has_permission") OR ( SELECT "private"."current_user_has_permission"('romaneio.conferir_recebimento'::"text", "destinations"."code") AS "current_user_has_permission") OR ( SELECT "private"."current_user_has_permission"('romaneio.aprovar_divergencia'::"text", "destinations"."code") AS "current_user_has_permission") OR ( SELECT "private"."current_user_has_permission"('romaneio.administrar'::"text", "destinations"."code") AS "current_user_has_permission")));



CREATE POLICY "destinations_update_managers" ON "public"."destinations" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'expedicao'::"text"])) AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/romaneio'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'expedicao'::"text"])) AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/romaneio'::"text")))));



ALTER TABLE "public"."frozen_movements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "frozen_movements_insert_route_store" ON "public"."frozen_movements" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."app_profiles" "p"
     JOIN "public"."frozen_products" "fp" ON (("fp"."id" = "frozen_movements"."frozen_product_id")))
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/estoque-congelado'::"text") AND (("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'producao'::"text", 'expedicao'::"text"])) OR (("lower"("p"."store") = "lower"("frozen_movements"."location")) AND ((("fp"."store" IS NULL) AND ("fp"."visible_stores" IS NULL)) OR ("lower"("fp"."store") = "lower"("p"."store")) OR ("lower"("p"."store") = ANY (COALESCE("fp"."visible_stores", '{}'::"text"[]))))))))));



CREATE POLICY "frozen_movements_select_route_store" ON "public"."frozen_movements" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."app_profiles" "p"
     JOIN "public"."frozen_products" "fp" ON (("fp"."id" = "frozen_movements"."frozen_product_id")))
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/estoque-congelado'::"text") AND (("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'producao'::"text", 'expedicao'::"text"])) OR (("lower"("p"."store") = "lower"("frozen_movements"."location")) AND ((("fp"."store" IS NULL) AND ("fp"."visible_stores" IS NULL)) OR ("lower"("fp"."store") = "lower"("p"."store")) OR ("lower"("p"."store") = ANY (COALESCE("fp"."visible_stores", '{}'::"text"[]))))))))));



ALTER TABLE "public"."frozen_products" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "frozen_products_manage_route_store" ON "public"."frozen_products" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/estoque-congelado'::"text") AND (("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'producao'::"text", 'expedicao'::"text"])) OR (("frozen_products"."store" IS NULL) AND ("frozen_products"."visible_stores" IS NULL)) OR ("lower"("frozen_products"."store") = "lower"("p"."store")) OR ("lower"("p"."store") = ANY (COALESCE("frozen_products"."visible_stores", '{}'::"text"[])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/estoque-congelado'::"text") AND (("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'producao'::"text", 'expedicao'::"text"])) OR (("frozen_products"."store" IS NULL) AND ("frozen_products"."visible_stores" IS NULL)) OR ("lower"("frozen_products"."store") = "lower"("p"."store")) OR ("lower"("p"."store") = ANY (COALESCE("frozen_products"."visible_stores", '{}'::"text"[]))))))));



ALTER TABLE "public"."frozen_stock" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "frozen_stock_manage_route_store" ON "public"."frozen_stock" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."app_profiles" "p"
     JOIN "public"."frozen_products" "fp" ON (("fp"."id" = "frozen_stock"."frozen_product_id")))
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/estoque-congelado'::"text") AND (("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'producao'::"text", 'expedicao'::"text"])) OR (("fp"."store" IS NULL) AND ("fp"."visible_stores" IS NULL)) OR ("lower"("fp"."store") = "lower"("p"."store")) OR ("lower"("p"."store") = ANY (COALESCE("fp"."visible_stores", '{}'::"text"[])))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."app_profiles" "p"
     JOIN "public"."frozen_products" "fp" ON (("fp"."id" = "frozen_stock"."frozen_product_id")))
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/estoque-congelado'::"text") AND (("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'producao'::"text", 'expedicao'::"text"])) OR (("fp"."store" IS NULL) AND ("fp"."visible_stores" IS NULL)) OR ("lower"("fp"."store") = "lower"("p"."store")) OR ("lower"("p"."store") = ANY (COALESCE("fp"."visible_stores", '{}'::"text"[]))))))));



ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "orders_delete_authenticated_profiles" ON "public"."orders" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND (("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) OR (("p"."role" = 'vendas'::"text") AND (("orders"."order_type" = 'encomenda'::"text") OR (("orders"."order_type" = 'producao'::"text") AND ("p"."store" = "orders"."store")))))))));



CREATE POLICY "orders_insert_authenticated_profiles" ON "public"."orders" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND (("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) OR (("p"."role" = 'vendas'::"text") AND (("orders"."order_type" = 'encomenda'::"text") OR (("orders"."order_type" = 'producao'::"text") AND ("p"."store" = "orders"."store")))))))));



CREATE POLICY "orders_select_authenticated_profiles" ON "public"."orders" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "profile"
  WHERE (("profile"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "profile"."active" AND (("profile"."role" <> 'expedicao'::"text") OR ("orders"."order_type" <> 'pj'::"text"))))));



CREATE POLICY "orders_update_authenticated_profiles" ON "public"."orders" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND (("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) OR (("p"."role" = 'vendas'::"text") AND (("orders"."order_type" = 'encomenda'::"text") OR (("orders"."order_type" = 'producao'::"text") AND ("p"."store" = "orders"."store"))))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND (("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) OR (("p"."role" = 'vendas'::"text") AND (("orders"."order_type" = 'encomenda'::"text") OR (("orders"."order_type" = 'producao'::"text") AND ("p"."store" = "orders"."store")))))))));



ALTER TABLE "public"."pizza_categorias" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pizza_categorias_all" ON "public"."pizza_categorias" TO "authenticated" USING (( SELECT "private"."pizza_is_allowed"() AS "pizza_is_allowed")) WITH CHECK (( SELECT "private"."pizza_is_allowed"() AS "pizza_is_allowed"));



ALTER TABLE "public"."pizza_despesas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pizza_despesas_all" ON "public"."pizza_despesas" TO "authenticated" USING (( SELECT "private"."pizza_is_allowed"() AS "pizza_is_allowed")) WITH CHECK (( SELECT "private"."pizza_is_allowed"() AS "pizza_is_allowed"));



ALTER TABLE "public"."pizza_usuarios" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pizza_usuarios_all" ON "public"."pizza_usuarios" TO "authenticated" USING (( SELECT "private"."pizza_is_allowed"() AS "pizza_is_allowed")) WITH CHECK (( SELECT "private"."pizza_is_allowed"() AS "pizza_is_allowed"));



ALTER TABLE "public"."pizza_vendas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pizza_vendas_all" ON "public"."pizza_vendas" TO "authenticated" USING (( SELECT "private"."pizza_is_allowed"() AS "pizza_is_allowed")) WITH CHECK (( SELECT "private"."pizza_is_allowed"() AS "pizza_is_allowed"));



ALTER TABLE "public"."price_tier_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "price_tier_items_insert_commercial" ON "public"."price_tier_items" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"]))))));



CREATE POLICY "price_tier_items_select_commercial" ON "public"."price_tier_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"]))))));



CREATE POLICY "price_tier_items_update_commercial" ON "public"."price_tier_items" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"]))))));



ALTER TABLE "public"."price_tiers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "price_tiers_insert_commercial" ON "public"."price_tiers" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"]))))));



CREATE POLICY "price_tiers_select_commercial" ON "public"."price_tiers" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"]))))));



CREATE POLICY "price_tiers_update_commercial" ON "public"."price_tiers" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"]))))));



ALTER TABLE "public"."product_components" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "product_components_delete_internal" ON "public"."product_components" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'compras'::"text"]))))));



COMMENT ON POLICY "product_components_delete_internal" ON "public"."product_components" IS 'Apenas perfis autorizados podem remover componentes de ficha tecnica.';



CREATE POLICY "product_components_insert_internal" ON "public"."product_components" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'compras'::"text"]))))));



COMMENT ON POLICY "product_components_insert_internal" ON "public"."product_components" IS 'Apenas perfis autorizados podem criar componentes de ficha tecnica.';



CREATE POLICY "product_components_select_internal" ON "public"."product_components" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active"))));



COMMENT ON POLICY "product_components_select_internal" ON "public"."product_components" IS 'Usuarios internos autenticados podem ler os componentes das fichas tecnicas.';



CREATE POLICY "product_components_update_internal" ON "public"."product_components" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'compras'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'compras'::"text"]))))));



COMMENT ON POLICY "product_components_update_internal" ON "public"."product_components" IS 'Apenas perfis autorizados podem alterar componentes de ficha tecnica.';



ALTER TABLE "public"."product_prices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "product_prices_delete_pricing_managers" ON "public"."product_prices" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/tabelas-preco'::"text")))));



CREATE POLICY "product_prices_insert_pricing_managers" ON "public"."product_prices" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/tabelas-preco'::"text")))));



CREATE POLICY "product_prices_read_romaneio_permission" ON "public"."product_prices" FOR SELECT TO "authenticated" USING ((("destination_id" IS NULL) OR (EXISTS ( SELECT 1
   FROM "public"."app_profiles" "profile"
  WHERE (("profile"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "profile"."active" AND (COALESCE("profile"."allowed_routes", '[]'::"jsonb") ? '/tabelas-preco'::"text") AND ("profile"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"]))))) OR (EXISTS ( SELECT 1
   FROM "public"."destinations" "destination"
  WHERE (("destination"."id" = "product_prices"."destination_id") AND (( SELECT "private"."current_user_has_permission"('romaneio.visualizar'::"text", "destination"."code") AS "current_user_has_permission") OR ( SELECT "private"."current_user_has_permission"('romaneio.criar'::"text", "destination"."code") AS "current_user_has_permission") OR ( SELECT "private"."current_user_has_permission"('romaneio.administrar'::"text", "destination"."code") AS "current_user_has_permission")))))));



CREATE POLICY "product_prices_update_pricing_managers" ON "public"."product_prices" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/tabelas-preco'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/tabelas-preco'::"text")))));



ALTER TABLE "public"."product_production" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "product_production_delete_admins" ON "public"."product_production" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = 'admin'::"text")))));



CREATE POLICY "product_production_insert_admins" ON "public"."product_production" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = 'admin'::"text")))));



CREATE POLICY "product_production_select_active_profiles" ON "public"."product_production" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active"))));



CREATE POLICY "product_production_update_admins" ON "public"."product_production" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = 'admin'::"text")))));



ALTER TABLE "public"."product_recipe_yields" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "product_recipe_yields_insert_internal" ON "public"."product_recipe_yields" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'compras'::"text"]))))));



CREATE POLICY "product_recipe_yields_select_internal" ON "public"."product_recipe_yields" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active"))));



CREATE POLICY "product_recipe_yields_update_internal" ON "public"."product_recipe_yields" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'compras'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'compras'::"text"]))))));



ALTER TABLE "public"."product_sale_options" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "product_sale_options_insert_internal" ON "public"."product_sale_options" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'compras'::"text"]))))));



CREATE POLICY "product_sale_options_select_internal" ON "public"."product_sale_options" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active"))));



CREATE POLICY "product_sale_options_update_internal" ON "public"."product_sale_options" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'compras'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'compras'::"text"]))))));



ALTER TABLE "public"."production_actual_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "production_actual_events_select_active_profiles" ON "public"."production_actual_events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "profile"
  WHERE (("profile"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "profile"."active" AND ("profile"."role" = ANY (ARRAY['admin'::"text", 'producao'::"text", 'financeiro'::"text", 'estoque'::"text"]))))));



ALTER TABLE "public"."production_actuals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "production_actuals_select_authenticated_profiles" ON "public"."production_actuals" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "profile"
  WHERE (("profile"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "profile"."active"))));



ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "products_delete_catalog_managers" ON "public"."products" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/produtos'::"text")))));



CREATE POLICY "products_insert_catalog_managers" ON "public"."products" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/produtos'::"text")))));



CREATE POLICY "products_read_internal" ON "public"."products" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active"))));



CREATE POLICY "products_update_catalog_managers" ON "public"."products" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/produtos'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/produtos'::"text")))));



ALTER TABLE "public"."purchase_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_lists" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."quotation_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."quotation_responses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."quotation_suppliers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."quotations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."romaneio_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "romaneio_items_delete_admin_permission" ON "public"."romaneio_items" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."romaneios" "romaneio"
     JOIN "public"."destinations" "destination" ON (("destination"."id" = "romaneio"."destination_id")))
  WHERE (("romaneio"."id" = "romaneio_items"."romaneio_id") AND ( SELECT "private"."current_user_has_permission"('romaneio.administrar'::"text", "destination"."code") AS "current_user_has_permission")))));



CREATE POLICY "romaneio_items_insert_permission" ON "public"."romaneio_items" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."romaneios" "romaneio"
     JOIN "public"."destinations" "destination" ON (("destination"."id" = "romaneio"."destination_id")))
  WHERE (("romaneio"."id" = "romaneio_items"."romaneio_id") AND ("romaneio"."status" = 'separado'::"text") AND ( SELECT "private"."current_user_has_permission"('romaneio.criar'::"text", "destination"."code") AS "current_user_has_permission")))));



CREATE POLICY "romaneio_items_select_permission" ON "public"."romaneio_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."romaneios" "romaneio"
     JOIN "public"."destinations" "destination" ON (("destination"."id" = "romaneio"."destination_id")))
  WHERE (("romaneio"."id" = "romaneio_items"."romaneio_id") AND (( SELECT "private"."current_user_has_permission"('romaneio.visualizar'::"text", "destination"."code") AS "current_user_has_permission") OR ( SELECT "private"."current_user_has_permission"('romaneio.administrar'::"text", "destination"."code") AS "current_user_has_permission"))))));



CREATE POLICY "romaneio_items_update_admin_permission" ON "public"."romaneio_items" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."romaneios" "romaneio"
     JOIN "public"."destinations" "destination" ON (("destination"."id" = "romaneio"."destination_id")))
  WHERE (("romaneio"."id" = "romaneio_items"."romaneio_id") AND ( SELECT "private"."current_user_has_permission"('romaneio.administrar'::"text", "destination"."code") AS "current_user_has_permission")))));



ALTER TABLE "public"."romaneios" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "romaneios_delete_admin_permission" ON "public"."romaneios" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."destinations" "destination"
  WHERE (("destination"."id" = "romaneios"."destination_id") AND ( SELECT "private"."current_user_has_permission"('romaneio.administrar'::"text", "destination"."code") AS "current_user_has_permission")))));



CREATE POLICY "romaneios_insert_permission" ON "public"."romaneios" FOR INSERT TO "authenticated" WITH CHECK ((("status" = 'separado'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."destinations" "destination"
  WHERE (("destination"."id" = "romaneios"."destination_id") AND ( SELECT "private"."current_user_has_permission"('romaneio.criar'::"text", "destination"."code") AS "current_user_has_permission"))))));



CREATE POLICY "romaneios_select_permission" ON "public"."romaneios" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."destinations" "destination"
  WHERE (("destination"."id" = "romaneios"."destination_id") AND (( SELECT "private"."current_user_has_permission"('romaneio.visualizar'::"text", "destination"."code") AS "current_user_has_permission") OR ( SELECT "private"."current_user_has_permission"('romaneio.administrar'::"text", "destination"."code") AS "current_user_has_permission"))))));



CREATE POLICY "romaneios_update_admin_permission" ON "public"."romaneios" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."destinations" "destination"
  WHERE (("destination"."id" = "romaneios"."destination_id") AND ( SELECT "private"."current_user_has_permission"('romaneio.administrar'::"text", "destination"."code") AS "current_user_has_permission"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."destinations" "destination"
  WHERE (("destination"."id" = "romaneios"."destination_id") AND ( SELECT "private"."current_user_has_permission"('romaneio.administrar'::"text", "destination"."code") AS "current_user_has_permission")))));



ALTER TABLE "public"."shelf_counts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "shelf_counts_insert_route_store" ON "public"."shelf_counts" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/sobras'::"text") AND (("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) OR ("lower"("p"."store") = "lower"("shelf_counts"."store")))))));



CREATE POLICY "shelf_counts_select_route_store" ON "public"."shelf_counts" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ((COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/sobras'::"text") OR (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/relatorios'::"text")) AND (("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) OR ("lower"("p"."store") = "lower"("shelf_counts"."store")))))));



CREATE POLICY "shelf_counts_update_route_store" ON "public"."shelf_counts" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/sobras'::"text") AND (("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) OR ("lower"("p"."store") = "lower"("shelf_counts"."store"))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/sobras'::"text") AND (("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) OR ("lower"("p"."store") = "lower"("shelf_counts"."store")))))));



ALTER TABLE "public"."sobras" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sobras_delete_legacy_route" ON "public"."sobras" FOR DELETE TO "authenticated" USING ((("store" IS NULL) AND (EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/sobras'::"text"))))));



CREATE POLICY "sobras_insert_legacy_route" ON "public"."sobras" FOR INSERT TO "authenticated" WITH CHECK ((("store" IS NULL) AND (EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/sobras'::"text"))))));



CREATE POLICY "sobras_select_route_store" ON "public"."sobras" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/sobras'::"text") AND (("sobras"."store" IS NULL) OR ("p"."role" <> 'vendas'::"text") OR ("lower"("p"."store") = "lower"("sobras"."store")))))));



CREATE POLICY "sobras_update_legacy_route" ON "public"."sobras" FOR UPDATE TO "authenticated" USING ((("store" IS NULL) AND (EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/sobras'::"text")))))) WITH CHECK ((("store" IS NULL) AND (EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/sobras'::"text"))))));



ALTER TABLE "public"."stock_balance" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stock_balance_insert_internal" ON "public"."stock_balance" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'estoque'::"text", 'compras'::"text"]))))));



CREATE POLICY "stock_balance_select_internal" ON "public"."stock_balance" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'estoque'::"text", 'compras'::"text", 'expedicao'::"text"]))))));



CREATE POLICY "stock_balance_update_internal" ON "public"."stock_balance" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'estoque'::"text", 'compras'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'estoque'::"text", 'compras'::"text"]))))));



ALTER TABLE "public"."stock_entries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stock_entries_insert_internal" ON "public"."stock_entries" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'estoque'::"text", 'compras'::"text"]))))));



CREATE POLICY "stock_entries_select_internal" ON "public"."stock_entries" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'estoque'::"text", 'compras'::"text", 'expedicao'::"text"]))))));



ALTER TABLE "public"."stock_entry_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stock_entry_items_insert_internal" ON "public"."stock_entry_items" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'estoque'::"text", 'compras'::"text"]))))));



CREATE POLICY "stock_entry_items_select_internal" ON "public"."stock_entry_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'estoque'::"text", 'compras'::"text", 'expedicao'::"text"]))))));



ALTER TABLE "public"."stock_movements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stock_movements_insert_internal" ON "public"."stock_movements" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'estoque'::"text", 'compras'::"text"]))))));



CREATE POLICY "stock_movements_select_internal" ON "public"."stock_movements" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text", 'estoque'::"text", 'compras'::"text", 'expedicao'::"text"]))))));



ALTER TABLE "public"."supplier_order_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."supplier_orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."supplier_products" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."suppliers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "suppliers_manage_procurement" ON "public"."suppliers" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) AND (("p"."role" = 'admin'::"text") OR (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/fornecedores'::"text")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."app_profiles" "p"
  WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active" AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"])) AND (("p"."role" = 'admin'::"text") OR (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/fornecedores'::"text"))))));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "private" TO "authenticated";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































REVOKE ALL ON FUNCTION "private"."current_user_has_permission"("p_permission_key" "text", "p_scope" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."current_user_has_permission"("p_permission_key" "text", "p_scope" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."current_user_is_access_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."current_user_is_access_admin"() TO "authenticated";



REVOKE ALL ON FUNCTION "private"."guard_dispatched_pj_order_changes"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."guard_pj_dispatch_write"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."pizza_is_allowed"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."pizza_is_allowed"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."approve_romaneio_divergence"("p_romaneio_id" "uuid", "p_item_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."approve_romaneio_divergence"("p_romaneio_id" "uuid", "p_item_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."approve_romaneio_divergence"("p_romaneio_id" "uuid", "p_item_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."confirm_bread_reuse_plan"("p_plan_id" "uuid", "p_confirmed_quantity" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_bread_reuse_plan"("p_plan_id" "uuid", "p_confirmed_quantity" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirm_bread_reuse_plan"("p_plan_id" "uuid", "p_confirmed_quantity" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."confirm_oven_output"("p_record_date" "date", "p_bread_id" "text", "p_quantity_good" integer, "p_quantity_loss" integer, "p_loss_reason" "text", "p_obs" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_oven_output"("p_record_date" "date", "p_bread_id" "text", "p_quantity_good" integer, "p_quantity_loss" integer, "p_loss_reason" "text", "p_obs" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirm_oven_output"("p_record_date" "date", "p_bread_id" "text", "p_quantity_good" integer, "p_quantity_loss" integer, "p_loss_reason" "text", "p_obs" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."confirm_pj_order_dispatch"("p_order_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_pj_order_dispatch"("p_order_group_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."confirm_pj_order_dispatch"("p_order_group_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."confirm_romaneio_departure"("p_romaneio_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_romaneio_departure"("p_romaneio_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirm_romaneio_departure"("p_romaneio_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."confirm_romaneio_receipt"("p_romaneio_id" "uuid", "p_items" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_romaneio_receipt"("p_romaneio_id" "uuid", "p_items" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirm_romaneio_receipt"("p_romaneio_id" "uuid", "p_items" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_pj_orders_for_dispatch"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_pj_orders_for_dispatch"() TO "service_role";
GRANT ALL ON FUNCTION "public"."list_pj_orders_for_dispatch"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."mark_bread_as_shelf"("p_bread_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_bread_as_shelf"("p_bread_id" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."mark_bread_as_shelf"("p_bread_id" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."reconcile_bread_leftovers_after_oven"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reconcile_bread_leftovers_after_oven"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."register_bread_leftovers"("p_record_date" "date", "p_store" "text", "p_items" "jsonb", "p_physical_location" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."register_bread_leftovers"("p_record_date" "date", "p_store" "text", "p_items" "jsonb", "p_physical_location" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_bread_leftovers"("p_record_date" "date", "p_store" "text", "p_items" "jsonb", "p_physical_location" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."replace_user_permissions"("p_user_id" "uuid", "p_assignments" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."replace_user_permissions"("p_user_id" "uuid", "p_assignments" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."replace_user_permissions"("p_user_id" "uuid", "p_assignments" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_bread_leftover"("p_sobra_id" "uuid", "p_action" "text", "p_quantity" numeric, "p_freezer_location" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_bread_leftover"("p_sobra_id" "uuid", "p_action" "text", "p_quantity" numeric, "p_freezer_location" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_bread_leftover"("p_sobra_id" "uuid", "p_action" "text", "p_quantity" numeric, "p_freezer_location" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_bread_reuse_proposals"("p_target_production_date" "date", "p_store" "text", "p_proposals" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_bread_reuse_proposals"("p_target_production_date" "date", "p_store" "text", "p_proposals" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_bread_reuse_proposals"("p_target_production_date" "date", "p_store" "text", "p_proposals" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_app_profiles_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_app_profiles_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_cash_closings_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_cash_closings_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_bread_leftover_location"("p_sobra_id" "uuid", "p_physical_location" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_bread_leftover_location"("p_sobra_id" "uuid", "p_physical_location" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_bread_leftover_location"("p_sobra_id" "uuid", "p_physical_location" "text") TO "service_role";


















GRANT ALL ON TABLE "public"."app_permissions" TO "service_role";
GRANT SELECT ON TABLE "public"."app_permissions" TO "authenticated";



GRANT ALL ON TABLE "public"."app_profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."app_profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."app_user_permissions" TO "service_role";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."app_user_permissions" TO "authenticated";



GRANT ALL ON TABLE "public"."app_users" TO "service_role";



GRANT ALL ON TABLE "public"."bread_leftover_events" TO "service_role";
GRANT SELECT ON TABLE "public"."bread_leftover_events" TO "authenticated";



GRANT ALL ON TABLE "public"."bread_movements" TO "service_role";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."bread_movements" TO "authenticated";



GRANT ALL ON TABLE "public"."bread_reuse_plan_allocations" TO "service_role";
GRANT SELECT ON TABLE "public"."bread_reuse_plan_allocations" TO "authenticated";



GRANT ALL ON TABLE "public"."bread_reuse_plans" TO "service_role";
GRANT SELECT ON TABLE "public"."bread_reuse_plans" TO "authenticated";



GRANT ALL ON TABLE "public"."breads" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."breads" TO "authenticated";



GRANT ALL ON TABLE "public"."cash_closings" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."cash_closings" TO "authenticated";



GRANT ALL ON TABLE "public"."customer_price_overrides" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."customer_price_overrides" TO "authenticated";



GRANT ALL ON TABLE "public"."customers" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."customers" TO "authenticated";



GRANT ALL ON TABLE "public"."descartes" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."descartes" TO "authenticated";



GRANT ALL ON TABLE "public"."destinations" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."destinations" TO "authenticated";



GRANT ALL ON TABLE "public"."frozen_movements" TO "service_role";
GRANT SELECT,INSERT ON TABLE "public"."frozen_movements" TO "authenticated";



GRANT ALL ON TABLE "public"."frozen_products" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."frozen_products" TO "authenticated";



GRANT ALL ON TABLE "public"."frozen_stock" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."frozen_stock" TO "authenticated";



GRANT ALL ON TABLE "public"."orders" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."orders" TO "authenticated";



GRANT ALL ON TABLE "public"."pizza_categorias" TO "anon";
GRANT ALL ON TABLE "public"."pizza_categorias" TO "authenticated";
GRANT ALL ON TABLE "public"."pizza_categorias" TO "service_role";



GRANT ALL ON SEQUENCE "public"."pizza_categorias_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pizza_categorias_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pizza_categorias_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."pizza_despesas" TO "anon";
GRANT ALL ON TABLE "public"."pizza_despesas" TO "authenticated";
GRANT ALL ON TABLE "public"."pizza_despesas" TO "service_role";



GRANT ALL ON SEQUENCE "public"."pizza_despesas_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pizza_despesas_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pizza_despesas_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."pizza_usuarios" TO "anon";
GRANT ALL ON TABLE "public"."pizza_usuarios" TO "authenticated";
GRANT ALL ON TABLE "public"."pizza_usuarios" TO "service_role";



GRANT ALL ON TABLE "public"."pizza_vendas" TO "anon";
GRANT ALL ON TABLE "public"."pizza_vendas" TO "authenticated";
GRANT ALL ON TABLE "public"."pizza_vendas" TO "service_role";



GRANT ALL ON SEQUENCE "public"."pizza_vendas_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pizza_vendas_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pizza_vendas_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."price_tier_items" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."price_tier_items" TO "authenticated";



GRANT ALL ON TABLE "public"."price_tiers" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."price_tiers" TO "authenticated";



GRANT ALL ON TABLE "public"."product_components" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."product_components" TO "authenticated";



GRANT ALL ON TABLE "public"."product_prices" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."product_prices" TO "authenticated";



GRANT ALL ON TABLE "public"."product_production" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."product_production" TO "authenticated";



GRANT ALL ON TABLE "public"."product_recipe_yields" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."product_recipe_yields" TO "authenticated";



GRANT ALL ON TABLE "public"."product_sale_options" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."product_sale_options" TO "authenticated";



GRANT ALL ON TABLE "public"."production_actual_events" TO "service_role";
GRANT SELECT ON TABLE "public"."production_actual_events" TO "authenticated";



GRANT ALL ON TABLE "public"."production_actuals" TO "service_role";
GRANT SELECT ON TABLE "public"."production_actuals" TO "authenticated";



GRANT ALL ON TABLE "public"."products" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."products" TO "authenticated";



GRANT ALL ON TABLE "public"."purchase_items" TO "service_role";



GRANT ALL ON TABLE "public"."purchase_lists" TO "service_role";



GRANT ALL ON TABLE "public"."quotation_items" TO "service_role";



GRANT ALL ON TABLE "public"."quotation_responses" TO "service_role";



GRANT ALL ON TABLE "public"."quotation_suppliers" TO "service_role";



GRANT ALL ON TABLE "public"."quotations" TO "service_role";



GRANT ALL ON TABLE "public"."romaneio_items" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."romaneio_items" TO "authenticated";



GRANT ALL ON TABLE "public"."romaneios" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."romaneios" TO "authenticated";



GRANT ALL ON TABLE "public"."shelf_counts" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."shelf_counts" TO "authenticated";



GRANT ALL ON TABLE "public"."sobras" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."sobras" TO "authenticated";



GRANT ALL ON TABLE "public"."stock_balance" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."stock_balance" TO "authenticated";



GRANT ALL ON TABLE "public"."stock_entries" TO "service_role";
GRANT SELECT,INSERT ON TABLE "public"."stock_entries" TO "authenticated";



GRANT ALL ON TABLE "public"."stock_entry_items" TO "service_role";
GRANT SELECT,INSERT ON TABLE "public"."stock_entry_items" TO "authenticated";



GRANT ALL ON TABLE "public"."stock_movements" TO "service_role";
GRANT SELECT,INSERT ON TABLE "public"."stock_movements" TO "authenticated";



GRANT ALL ON TABLE "public"."supplier_order_items" TO "service_role";



GRANT ALL ON TABLE "public"."supplier_orders" TO "service_role";



GRANT ALL ON TABLE "public"."supplier_products" TO "service_role";



GRANT ALL ON TABLE "public"."suppliers" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."suppliers" TO "authenticated";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

revoke references on table "public"."app_permissions" from "anon";

revoke trigger on table "public"."app_permissions" from "anon";

revoke truncate on table "public"."app_permissions" from "anon";

revoke references on table "public"."app_permissions" from "authenticated";

revoke trigger on table "public"."app_permissions" from "authenticated";

revoke truncate on table "public"."app_permissions" from "authenticated";

revoke references on table "public"."app_profiles" from "anon";

revoke trigger on table "public"."app_profiles" from "anon";

revoke truncate on table "public"."app_profiles" from "anon";

revoke references on table "public"."app_profiles" from "authenticated";

revoke trigger on table "public"."app_profiles" from "authenticated";

revoke truncate on table "public"."app_profiles" from "authenticated";

revoke references on table "public"."app_user_permissions" from "anon";

revoke trigger on table "public"."app_user_permissions" from "anon";

revoke truncate on table "public"."app_user_permissions" from "anon";

revoke references on table "public"."app_user_permissions" from "authenticated";

revoke trigger on table "public"."app_user_permissions" from "authenticated";

revoke truncate on table "public"."app_user_permissions" from "authenticated";

revoke references on table "public"."app_users" from "anon";

revoke trigger on table "public"."app_users" from "anon";

revoke truncate on table "public"."app_users" from "anon";

revoke references on table "public"."app_users" from "authenticated";

revoke trigger on table "public"."app_users" from "authenticated";

revoke truncate on table "public"."app_users" from "authenticated";

revoke references on table "public"."bread_leftover_events" from "anon";

revoke trigger on table "public"."bread_leftover_events" from "anon";

revoke truncate on table "public"."bread_leftover_events" from "anon";

revoke references on table "public"."bread_leftover_events" from "authenticated";

revoke trigger on table "public"."bread_leftover_events" from "authenticated";

revoke truncate on table "public"."bread_leftover_events" from "authenticated";

revoke references on table "public"."bread_movements" from "anon";

revoke trigger on table "public"."bread_movements" from "anon";

revoke truncate on table "public"."bread_movements" from "anon";

revoke references on table "public"."bread_movements" from "authenticated";

revoke trigger on table "public"."bread_movements" from "authenticated";

revoke truncate on table "public"."bread_movements" from "authenticated";

revoke references on table "public"."bread_reuse_plan_allocations" from "anon";

revoke trigger on table "public"."bread_reuse_plan_allocations" from "anon";

revoke truncate on table "public"."bread_reuse_plan_allocations" from "anon";

revoke references on table "public"."bread_reuse_plan_allocations" from "authenticated";

revoke trigger on table "public"."bread_reuse_plan_allocations" from "authenticated";

revoke truncate on table "public"."bread_reuse_plan_allocations" from "authenticated";

revoke references on table "public"."bread_reuse_plans" from "anon";

revoke trigger on table "public"."bread_reuse_plans" from "anon";

revoke truncate on table "public"."bread_reuse_plans" from "anon";

revoke references on table "public"."bread_reuse_plans" from "authenticated";

revoke trigger on table "public"."bread_reuse_plans" from "authenticated";

revoke truncate on table "public"."bread_reuse_plans" from "authenticated";

revoke references on table "public"."breads" from "anon";

revoke trigger on table "public"."breads" from "anon";

revoke truncate on table "public"."breads" from "anon";

revoke references on table "public"."breads" from "authenticated";

revoke trigger on table "public"."breads" from "authenticated";

revoke truncate on table "public"."breads" from "authenticated";

revoke references on table "public"."cash_closings" from "anon";

revoke trigger on table "public"."cash_closings" from "anon";

revoke truncate on table "public"."cash_closings" from "anon";

revoke references on table "public"."cash_closings" from "authenticated";

revoke trigger on table "public"."cash_closings" from "authenticated";

revoke truncate on table "public"."cash_closings" from "authenticated";

revoke references on table "public"."customer_price_overrides" from "anon";

revoke trigger on table "public"."customer_price_overrides" from "anon";

revoke truncate on table "public"."customer_price_overrides" from "anon";

revoke references on table "public"."customer_price_overrides" from "authenticated";

revoke trigger on table "public"."customer_price_overrides" from "authenticated";

revoke truncate on table "public"."customer_price_overrides" from "authenticated";

revoke references on table "public"."customers" from "anon";

revoke trigger on table "public"."customers" from "anon";

revoke truncate on table "public"."customers" from "anon";

revoke references on table "public"."customers" from "authenticated";

revoke trigger on table "public"."customers" from "authenticated";

revoke truncate on table "public"."customers" from "authenticated";

revoke references on table "public"."descartes" from "anon";

revoke trigger on table "public"."descartes" from "anon";

revoke truncate on table "public"."descartes" from "anon";

revoke references on table "public"."descartes" from "authenticated";

revoke trigger on table "public"."descartes" from "authenticated";

revoke truncate on table "public"."descartes" from "authenticated";

revoke references on table "public"."destinations" from "anon";

revoke trigger on table "public"."destinations" from "anon";

revoke truncate on table "public"."destinations" from "anon";

revoke references on table "public"."destinations" from "authenticated";

revoke trigger on table "public"."destinations" from "authenticated";

revoke truncate on table "public"."destinations" from "authenticated";

revoke references on table "public"."frozen_movements" from "anon";

revoke trigger on table "public"."frozen_movements" from "anon";

revoke truncate on table "public"."frozen_movements" from "anon";

revoke references on table "public"."frozen_movements" from "authenticated";

revoke trigger on table "public"."frozen_movements" from "authenticated";

revoke truncate on table "public"."frozen_movements" from "authenticated";

revoke references on table "public"."frozen_products" from "anon";

revoke trigger on table "public"."frozen_products" from "anon";

revoke truncate on table "public"."frozen_products" from "anon";

revoke references on table "public"."frozen_products" from "authenticated";

revoke trigger on table "public"."frozen_products" from "authenticated";

revoke truncate on table "public"."frozen_products" from "authenticated";

revoke references on table "public"."frozen_stock" from "anon";

revoke trigger on table "public"."frozen_stock" from "anon";

revoke truncate on table "public"."frozen_stock" from "anon";

revoke references on table "public"."frozen_stock" from "authenticated";

revoke trigger on table "public"."frozen_stock" from "authenticated";

revoke truncate on table "public"."frozen_stock" from "authenticated";

revoke references on table "public"."orders" from "anon";

revoke trigger on table "public"."orders" from "anon";

revoke truncate on table "public"."orders" from "anon";

revoke references on table "public"."orders" from "authenticated";

revoke trigger on table "public"."orders" from "authenticated";

revoke truncate on table "public"."orders" from "authenticated";

revoke references on table "public"."price_tier_items" from "anon";

revoke trigger on table "public"."price_tier_items" from "anon";

revoke truncate on table "public"."price_tier_items" from "anon";

revoke references on table "public"."price_tier_items" from "authenticated";

revoke trigger on table "public"."price_tier_items" from "authenticated";

revoke truncate on table "public"."price_tier_items" from "authenticated";

revoke references on table "public"."price_tiers" from "anon";

revoke trigger on table "public"."price_tiers" from "anon";

revoke truncate on table "public"."price_tiers" from "anon";

revoke references on table "public"."price_tiers" from "authenticated";

revoke trigger on table "public"."price_tiers" from "authenticated";

revoke truncate on table "public"."price_tiers" from "authenticated";

revoke references on table "public"."product_components" from "anon";

revoke trigger on table "public"."product_components" from "anon";

revoke truncate on table "public"."product_components" from "anon";

revoke references on table "public"."product_components" from "authenticated";

revoke trigger on table "public"."product_components" from "authenticated";

revoke truncate on table "public"."product_components" from "authenticated";

revoke references on table "public"."product_prices" from "anon";

revoke trigger on table "public"."product_prices" from "anon";

revoke truncate on table "public"."product_prices" from "anon";

revoke references on table "public"."product_prices" from "authenticated";

revoke trigger on table "public"."product_prices" from "authenticated";

revoke truncate on table "public"."product_prices" from "authenticated";

revoke references on table "public"."product_production" from "anon";

revoke trigger on table "public"."product_production" from "anon";

revoke truncate on table "public"."product_production" from "anon";

revoke references on table "public"."product_production" from "authenticated";

revoke trigger on table "public"."product_production" from "authenticated";

revoke truncate on table "public"."product_production" from "authenticated";

revoke references on table "public"."product_recipe_yields" from "anon";

revoke trigger on table "public"."product_recipe_yields" from "anon";

revoke truncate on table "public"."product_recipe_yields" from "anon";

revoke references on table "public"."product_recipe_yields" from "authenticated";

revoke trigger on table "public"."product_recipe_yields" from "authenticated";

revoke truncate on table "public"."product_recipe_yields" from "authenticated";

revoke references on table "public"."product_sale_options" from "anon";

revoke trigger on table "public"."product_sale_options" from "anon";

revoke truncate on table "public"."product_sale_options" from "anon";

revoke references on table "public"."product_sale_options" from "authenticated";

revoke trigger on table "public"."product_sale_options" from "authenticated";

revoke truncate on table "public"."product_sale_options" from "authenticated";

revoke references on table "public"."production_actual_events" from "anon";

revoke trigger on table "public"."production_actual_events" from "anon";

revoke truncate on table "public"."production_actual_events" from "anon";

revoke references on table "public"."production_actual_events" from "authenticated";

revoke trigger on table "public"."production_actual_events" from "authenticated";

revoke truncate on table "public"."production_actual_events" from "authenticated";

revoke references on table "public"."production_actuals" from "anon";

revoke trigger on table "public"."production_actuals" from "anon";

revoke truncate on table "public"."production_actuals" from "anon";

revoke references on table "public"."production_actuals" from "authenticated";

revoke trigger on table "public"."production_actuals" from "authenticated";

revoke truncate on table "public"."production_actuals" from "authenticated";

revoke references on table "public"."products" from "anon";

revoke trigger on table "public"."products" from "anon";

revoke truncate on table "public"."products" from "anon";

revoke references on table "public"."products" from "authenticated";

revoke trigger on table "public"."products" from "authenticated";

revoke truncate on table "public"."products" from "authenticated";

revoke references on table "public"."purchase_items" from "anon";

revoke trigger on table "public"."purchase_items" from "anon";

revoke truncate on table "public"."purchase_items" from "anon";

revoke references on table "public"."purchase_items" from "authenticated";

revoke trigger on table "public"."purchase_items" from "authenticated";

revoke truncate on table "public"."purchase_items" from "authenticated";

revoke references on table "public"."purchase_lists" from "anon";

revoke trigger on table "public"."purchase_lists" from "anon";

revoke truncate on table "public"."purchase_lists" from "anon";

revoke references on table "public"."purchase_lists" from "authenticated";

revoke trigger on table "public"."purchase_lists" from "authenticated";

revoke truncate on table "public"."purchase_lists" from "authenticated";

revoke references on table "public"."quotation_items" from "anon";

revoke trigger on table "public"."quotation_items" from "anon";

revoke truncate on table "public"."quotation_items" from "anon";

revoke references on table "public"."quotation_items" from "authenticated";

revoke trigger on table "public"."quotation_items" from "authenticated";

revoke truncate on table "public"."quotation_items" from "authenticated";

revoke references on table "public"."quotation_responses" from "anon";

revoke trigger on table "public"."quotation_responses" from "anon";

revoke truncate on table "public"."quotation_responses" from "anon";

revoke references on table "public"."quotation_responses" from "authenticated";

revoke trigger on table "public"."quotation_responses" from "authenticated";

revoke truncate on table "public"."quotation_responses" from "authenticated";

revoke references on table "public"."quotation_suppliers" from "anon";

revoke trigger on table "public"."quotation_suppliers" from "anon";

revoke truncate on table "public"."quotation_suppliers" from "anon";

revoke references on table "public"."quotation_suppliers" from "authenticated";

revoke trigger on table "public"."quotation_suppliers" from "authenticated";

revoke truncate on table "public"."quotation_suppliers" from "authenticated";

revoke references on table "public"."quotations" from "anon";

revoke trigger on table "public"."quotations" from "anon";

revoke truncate on table "public"."quotations" from "anon";

revoke references on table "public"."quotations" from "authenticated";

revoke trigger on table "public"."quotations" from "authenticated";

revoke truncate on table "public"."quotations" from "authenticated";

revoke references on table "public"."romaneio_items" from "anon";

revoke trigger on table "public"."romaneio_items" from "anon";

revoke truncate on table "public"."romaneio_items" from "anon";

revoke references on table "public"."romaneio_items" from "authenticated";

revoke trigger on table "public"."romaneio_items" from "authenticated";

revoke truncate on table "public"."romaneio_items" from "authenticated";

revoke references on table "public"."romaneios" from "anon";

revoke trigger on table "public"."romaneios" from "anon";

revoke truncate on table "public"."romaneios" from "anon";

revoke references on table "public"."romaneios" from "authenticated";

revoke trigger on table "public"."romaneios" from "authenticated";

revoke truncate on table "public"."romaneios" from "authenticated";

revoke references on table "public"."shelf_counts" from "anon";

revoke trigger on table "public"."shelf_counts" from "anon";

revoke truncate on table "public"."shelf_counts" from "anon";

revoke references on table "public"."shelf_counts" from "authenticated";

revoke trigger on table "public"."shelf_counts" from "authenticated";

revoke truncate on table "public"."shelf_counts" from "authenticated";

revoke references on table "public"."sobras" from "anon";

revoke trigger on table "public"."sobras" from "anon";

revoke truncate on table "public"."sobras" from "anon";

revoke references on table "public"."sobras" from "authenticated";

revoke trigger on table "public"."sobras" from "authenticated";

revoke truncate on table "public"."sobras" from "authenticated";

revoke references on table "public"."stock_balance" from "anon";

revoke trigger on table "public"."stock_balance" from "anon";

revoke truncate on table "public"."stock_balance" from "anon";

revoke references on table "public"."stock_balance" from "authenticated";

revoke trigger on table "public"."stock_balance" from "authenticated";

revoke truncate on table "public"."stock_balance" from "authenticated";

revoke references on table "public"."stock_entries" from "anon";

revoke trigger on table "public"."stock_entries" from "anon";

revoke truncate on table "public"."stock_entries" from "anon";

revoke references on table "public"."stock_entries" from "authenticated";

revoke trigger on table "public"."stock_entries" from "authenticated";

revoke truncate on table "public"."stock_entries" from "authenticated";

revoke references on table "public"."stock_entry_items" from "anon";

revoke trigger on table "public"."stock_entry_items" from "anon";

revoke truncate on table "public"."stock_entry_items" from "anon";

revoke references on table "public"."stock_entry_items" from "authenticated";

revoke trigger on table "public"."stock_entry_items" from "authenticated";

revoke truncate on table "public"."stock_entry_items" from "authenticated";

revoke references on table "public"."stock_movements" from "anon";

revoke trigger on table "public"."stock_movements" from "anon";

revoke truncate on table "public"."stock_movements" from "anon";

revoke references on table "public"."stock_movements" from "authenticated";

revoke trigger on table "public"."stock_movements" from "authenticated";

revoke truncate on table "public"."stock_movements" from "authenticated";

revoke references on table "public"."supplier_order_items" from "anon";

revoke trigger on table "public"."supplier_order_items" from "anon";

revoke truncate on table "public"."supplier_order_items" from "anon";

revoke references on table "public"."supplier_order_items" from "authenticated";

revoke trigger on table "public"."supplier_order_items" from "authenticated";

revoke truncate on table "public"."supplier_order_items" from "authenticated";

revoke references on table "public"."supplier_orders" from "anon";

revoke trigger on table "public"."supplier_orders" from "anon";

revoke truncate on table "public"."supplier_orders" from "anon";

revoke references on table "public"."supplier_orders" from "authenticated";

revoke trigger on table "public"."supplier_orders" from "authenticated";

revoke truncate on table "public"."supplier_orders" from "authenticated";

revoke references on table "public"."supplier_products" from "anon";

revoke trigger on table "public"."supplier_products" from "anon";

revoke truncate on table "public"."supplier_products" from "anon";

revoke references on table "public"."supplier_products" from "authenticated";

revoke trigger on table "public"."supplier_products" from "authenticated";

revoke truncate on table "public"."supplier_products" from "authenticated";

revoke references on table "public"."suppliers" from "anon";

revoke trigger on table "public"."suppliers" from "anon";

revoke truncate on table "public"."suppliers" from "anon";

revoke references on table "public"."suppliers" from "authenticated";

revoke trigger on table "public"."suppliers" from "authenticated";

revoke truncate on table "public"."suppliers" from "authenticated";
