-- A Cozinha pode lançar a produção de até 31 dias atrás.
--
-- Quem lança a Produção da Cozinha sai às 17h e ainda pode haver produção
-- depois disso, então o lançamento acontece no dia seguinte. Além disso há uma
-- planilha com vários dias ainda sem registro. A regra antiga carimbava o lote
-- sempre com o dia do clique (trava kitchen_production_server_date) e só
-- deixava a equipe consultar hoje e ontem.
--
-- O que muda:
-- - record_kitchen_batches_v3 recebe o dia da produção. A equipe com
--   producao_cozinha.lancar escolhe entre hoje e 31 dias atrás; admin escolhe
--   qualquer dia passado. Dia futuro é recusado para todos.
-- - produced_at continua sendo o instante real do lançamento, carimbado pelo
--   servidor. É ele que mostra que o lote de 19/09 foi digitado em 23/09.
-- - A trava da tabela passa a dizer só "o dia da produção não é depois do dia
--   do lançamento".
-- - A equipe consulta o planejado e os lotes dos mesmos 31 dias.
-- - O pedido idempotente guarda o dia: repetir o mesmo salvamento para outro
--   dia é recusado, em vez de devolver o resultado antigo.
--
-- O que continua igual: a assinatura v2 (e a antiga) seguem gravando no dia de
-- hoje, para o site que estiver no ar durante a troca. Correção e cancelamento
-- de lote pela equipe continuam restritos ao dia de hoje; nenhuma tela usa
-- essas funções hoje.

begin;

-- ---------------------------------------------------------------------------
-- 1. Trava da tabela: dia da produção nunca depois do dia do lançamento.
-- Todas as linhas existentes têm os dois dias iguais, então cumprem a nova.
-- ---------------------------------------------------------------------------
alter table public.kitchen_production
  drop constraint kitchen_production_server_date;
alter table public.kitchen_production
  add constraint kitchen_production_record_date_not_after_launch
  check (record_date <= (produced_at at time zone 'America/Sao_Paulo')::date);

comment on column public.kitchen_production.record_date is
  'Dia da produção informado no lançamento. Nunca depois do dia de produced_at.';
comment on column public.kitchen_production.produced_at is
  'Instante real do lançamento, carimbado pelo servidor.';

-- ---------------------------------------------------------------------------
-- 2. O pedido idempotente guarda o dia. Os pedidos antigos gravaram no dia do
-- próprio lançamento, que é o dia do produced_at devolvido no resultado.
-- ---------------------------------------------------------------------------
alter table private.kitchen_production_write_requests
  add column record_date date;
update private.kitchen_production_write_requests
set record_date = ((result ->> 'produced_at')::timestamptz at time zone 'America/Sao_Paulo')::date
where record_date is null;
update private.kitchen_production_write_requests
set record_date = (created_at at time zone 'America/Sao_Paulo')::date
where record_date is null;
alter table private.kitchen_production_write_requests
  alter column record_date set not null;

-- ---------------------------------------------------------------------------
-- 3. Gravação com o dia escolhido. Parte da definição vigente em
-- 20260916052614 (variantes); a mudança é o dia usado no planejado e no lote.
-- ---------------------------------------------------------------------------
create function private.record_kitchen_batches_impl(
  p_store text,
  p_batches jsonb,
  p_request_id uuid,
  p_record_date date
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
  v_today date := private.data_na_padaria(pg_catalog.now());
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
  if p_record_date is null then
    raise exception using errcode = '22023', message = 'Informe o dia da producao.';
  end if;
  if p_record_date > v_today then
    raise exception using errcode = '22023', message = 'Nao da para lancar producao de dia futuro.';
  end if;
  if v_profile_role is distinct from 'admin' and p_record_date < v_today - 31 then
    raise exception using errcode = '42501',
      message = 'A equipe da Cozinha lanca somente ate 31 dias atras.';
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
    and request.batches = p_batches
    and request.record_date = p_record_date;
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
        and schedule.production_date = p_record_date
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
      where schedule.production_date = p_record_date
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
      v_store, v_product_id, p_record_date,
      v_quantity, v_user_id, v_profile_name, v_produced_at,
      v_name, v_unit, v_process, v_area, v_variant_id
    );
    v_count := v_count + 1;
  end loop;

  v_result := jsonb_build_object(
    'saved_count', v_count, 'produced_at', v_produced_at,
    'record_date', p_record_date, 'idempotent', false
  );
  insert into private.kitchen_production_write_requests(
    request_id, actor, store, batches, result, record_date
  ) values (p_request_id, v_user_id, v_store, p_batches, v_result, p_record_date);
  return v_result;
end;
$$;
revoke all on function private.record_kitchen_batches_impl(text, jsonb, uuid, date)
  from public, anon, authenticated;

-- A assinatura de três argumentos vira ponte para o dia de hoje. Assim v2 e a
-- função antiga continuam funcionando enquanto o site anterior estiver no ar.
create or replace function private.record_kitchen_batches_impl(
  p_store text,
  p_batches jsonb,
  p_request_id uuid
) returns jsonb
language sql security definer set search_path = '' as $$
  select private.record_kitchen_batches_impl(
    p_store, p_batches, p_request_id, private.data_na_padaria(pg_catalog.now())
  );
$$;
revoke all on function private.record_kitchen_batches_impl(text, jsonb, uuid)
  from public, anon, authenticated;

create function public.record_kitchen_batches_v3(
  p_store text, p_batches jsonb, p_request_id uuid, p_record_date date
) returns jsonb
language sql security definer set search_path = '' as $$
  select private.record_kitchen_batches_impl(p_store, p_batches, p_request_id, p_record_date);
$$;
revoke all on function public.record_kitchen_batches_v3(text, jsonb, uuid, date)
  from public, anon, authenticated;
grant execute on function public.record_kitchen_batches_v3(text, jsonb, uuid, date)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Leitura dos lotes: a equipe enxerga os últimos 31 dias da sua loja.
-- ---------------------------------------------------------------------------
drop policy if exists kitchen_production_select_permitted on public.kitchen_production;
create policy kitchen_production_select_permitted on public.kitchen_production
for select to authenticated using (
  (select private.current_user_is_access_admin())
  or (
    record_date between ((now() at time zone 'America/Sao_Paulo')::date - 31)
                        and (now() at time zone 'America/Sao_Paulo')::date
    and private.current_user_has_permission('producao_cozinha.lancar', store)
  )
);

-- ---------------------------------------------------------------------------
-- 5. Planejado x feito: mesma janela de 31 dias para a equipe. Parte da
-- definição vigente em 20260916052614; muda só a janela e a mensagem.
-- ---------------------------------------------------------------------------
create or replace function public.list_kitchen_production_plan(
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
  if v_role <> 'admin' and p_production_date not between (private.data_na_padaria() - 31)
      and private.data_na_padaria() then
    raise exception using errcode = '42501',
      message = 'A equipe da Cozinha consulta somente os ultimos 31 dias.';
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
