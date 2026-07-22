-- Sobras de paes JC/JA: pendencias por lote, destino auditavel e
-- reaproveitamento confirmado antes de reduzir o previsto do Forno.

alter table public.sobras
  add column if not exists store text,
  add column if not exists production_actual_id uuid,
  add column if not exists lot_code text,
  add column if not exists pending_quantity numeric,
  add column if not exists status text,
  add column if not exists physical_location text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.sobras
  drop constraint if exists sobras_unique,
  drop constraint if exists sobras_unique_registro;

create unique index if not exists sobras_legacy_unique_idx
  on public.sobras(record_date, responsible, product_id, product_source)
  where store is null;

create unique index if not exists sobras_managed_batch_unique_idx
  on public.sobras(store, product_id, production_actual_id)
  where store is not null and product_source = 'bread';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sobras_production_actual_id_fkey'
      and conrelid = 'public.sobras'::regclass
  ) then
    alter table public.sobras
      add constraint sobras_production_actual_id_fkey
      foreign key (production_actual_id)
      references public.production_actuals(id)
      on delete restrict;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sobras_managed_store_check'
      and conrelid = 'public.sobras'::regclass
  ) then
    alter table public.sobras
      add constraint sobras_managed_store_check
      check (store is null or store in ('jc', 'ja'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'sobras_managed_fields_check'
      and conrelid = 'public.sobras'::regclass
  ) then
    alter table public.sobras
      add constraint sobras_managed_fields_check
      check (
        store is null
        or (
          product_source = 'bread'
          and product_id is not null
          and production_actual_id is not null
          and lot_code is not null
          and pending_quantity is not null
          and status is not null
          and physical_location is not null
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'sobras_pending_quantity_check'
      and conrelid = 'public.sobras'::regclass
  ) then
    alter table public.sobras
      add constraint sobras_pending_quantity_check
      check (
        pending_quantity is null
        or (pending_quantity >= 0 and pending_quantity <= quantity)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'sobras_status_check'
      and conrelid = 'public.sobras'::regclass
  ) then
    alter table public.sobras
      add constraint sobras_status_check
      check (status is null or status in ('pending', 'resolved', 'cancelled'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'sobras_physical_location_check'
      and conrelid = 'public.sobras'::regclass
  ) then
    alter table public.sobras
      add constraint sobras_physical_location_check
      check (
        physical_location is null
        or physical_location in ('balcao_fechamento', 'mesa_separacao', 'padaria_cozinha')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'sobras_lot_code_matches_date'
      and conrelid = 'public.sobras'::regclass
  ) then
    alter table public.sobras
      add constraint sobras_lot_code_matches_date
      check (lot_code is null or lot_code = 'L' || to_char(record_date, 'MMDD'));
  end if;
end $$;

create index if not exists sobras_pending_store_date_idx
  on public.sobras(store, record_date, product_id)
  where pending_quantity > 0 and store is not null;

create index if not exists sobras_production_actual_id_idx
  on public.sobras(production_actual_id)
  where production_actual_id is not null;

create table public.bread_reuse_plans (
  id uuid primary key default gen_random_uuid(),
  target_production_date date not null,
  store text not null,
  bread_id text not null references public.breads(id) on delete restrict,
  proposed_quantity integer not null default 0,
  confirmed_quantity integer,
  status text not null default 'proposed',
  proposed_by uuid not null,
  proposed_by_name text not null,
  proposed_at timestamptz not null default now(),
  confirmed_by uuid,
  confirmed_by_name text,
  confirmed_at timestamptz,
  updated_at timestamptz not null default now(),

  constraint bread_reuse_plans_store_check
    check (store in ('jc', 'ja')),
  constraint bread_reuse_plans_status_check
    check (status in ('proposed', 'confirmed', 'cancelled')),
  constraint bread_reuse_plans_proposed_quantity_check
    check (proposed_quantity >= 0),
  constraint bread_reuse_plans_confirmed_quantity_check
    check (
      confirmed_quantity is null
      or (confirmed_quantity >= 0 and confirmed_quantity <= proposed_quantity)
    ),
  constraint bread_reuse_plans_unique
    unique (target_production_date, store, bread_id)
);

create index bread_reuse_plans_date_status_idx
  on public.bread_reuse_plans(target_production_date, status, bread_id);

create index bread_reuse_plans_bread_id_idx
  on public.bread_reuse_plans(bread_id);

create table public.bread_leftover_events (
  id uuid primary key default gen_random_uuid(),
  sobra_id uuid not null references public.sobras(id) on delete restrict,
  reuse_plan_id uuid references public.bread_reuse_plans(id) on delete restrict,
  action text not null,
  quantity numeric not null default 0,
  from_location text,
  to_location text,
  actor_id uuid not null,
  actor_name text not null,
  obs text,
  created_at timestamptz not null default now(),

  constraint bread_leftover_events_action_check
    check (action in (
      'registered',
      'corrected',
      'location_changed',
      'reuse_confirmed',
      'reuse_reversed',
      'display',
      'internal_use',
      'donation',
      'discard',
      'freeze'
    )),
  constraint bread_leftover_events_quantity_check
    check (quantity >= 0)
);

create index bread_leftover_events_sobra_created_idx
  on public.bread_leftover_events(sobra_id, created_at desc);

create index bread_leftover_events_reuse_plan_idx
  on public.bread_leftover_events(reuse_plan_id)
  where reuse_plan_id is not null;

create table public.bread_reuse_plan_allocations (
  plan_id uuid not null references public.bread_reuse_plans(id) on delete cascade,
  sobra_id uuid not null references public.sobras(id) on delete restrict,
  quantity integer not null,
  created_at timestamptz not null default now(),
  primary key (plan_id, sobra_id),
  constraint bread_reuse_plan_allocations_quantity_check check (quantity > 0)
);

create index bread_reuse_plan_allocations_sobra_idx
  on public.bread_reuse_plan_allocations(sobra_id);

comment on column public.sobras.pending_quantity is
  'Saldo do lote ainda aguardando destino. NULL identifica registro legado.';
comment on column public.sobras.physical_location is
  'Local fisico do saldo ainda pendente; destinos resolvidos ficam no historico de eventos.';
comment on table public.bread_reuse_plans is
  'Intencao do planejamento e confirmacao fisica que reduz a producao nova do Forno.';
comment on table public.bread_reuse_plan_allocations is
  'Alocacao atual, por lote FIFO, do reaproveitamento confirmado.';
comment on table public.bread_leftover_events is
  'Historico imutavel de registro, correcao, local e destino das sobras de paes.';

-- RLS: registros legados de sobras continuam acessiveis ao fluxo antigo, mas
-- linhas gerenciadas (store nao nulo) so podem ser escritas pelas RPCs.
alter table public.sobras enable row level security;
alter table public.sobras force row level security;

revoke all on table public.sobras from anon;
revoke all on table public.sobras from authenticated;
grant select, insert, update, delete on table public.sobras to anon;
grant select, insert, update, delete on table public.sobras to authenticated;
grant all on table public.sobras to service_role;

drop policy if exists sobras_anon_select on public.sobras;
drop policy if exists sobras_anon_insert_legacy on public.sobras;
drop policy if exists sobras_anon_update_legacy on public.sobras;
drop policy if exists sobras_anon_delete_legacy on public.sobras;
drop policy if exists sobras_authenticated_select on public.sobras;
drop policy if exists sobras_authenticated_insert_legacy on public.sobras;
drop policy if exists sobras_authenticated_update_legacy on public.sobras;
drop policy if exists sobras_authenticated_delete_legacy on public.sobras;

create policy sobras_anon_select
on public.sobras for select to anon
using (store is null);

create policy sobras_anon_insert_legacy
on public.sobras for insert to anon
with check (store is null);

create policy sobras_anon_update_legacy
on public.sobras for update to anon
using (store is null)
with check (store is null);

create policy sobras_anon_delete_legacy
on public.sobras for delete to anon
using (store is null);

create policy sobras_authenticated_select
on public.sobras for select to authenticated
using (
  exists (
    select 1 from public.app_profiles as profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and (
        public.sobras.store is null
        or profile.role <> 'vendas'
        or profile.store = public.sobras.store
      )
  )
);

create policy sobras_authenticated_insert_legacy
on public.sobras for insert to authenticated
with check (
  store is null
  and exists (
    select 1 from public.app_profiles as profile
    where profile.user_id = (select auth.uid()) and profile.active
  )
);

create policy sobras_authenticated_update_legacy
on public.sobras for update to authenticated
using (
  store is null
  and exists (
    select 1 from public.app_profiles as profile
    where profile.user_id = (select auth.uid()) and profile.active
  )
)
with check (store is null);

create policy sobras_authenticated_delete_legacy
on public.sobras for delete to authenticated
using (
  store is null
  and exists (
    select 1 from public.app_profiles as profile
    where profile.user_id = (select auth.uid()) and profile.active
  )
);

alter table public.bread_reuse_plans enable row level security;
alter table public.bread_reuse_plans force row level security;
alter table public.bread_leftover_events enable row level security;
alter table public.bread_leftover_events force row level security;
alter table public.bread_reuse_plan_allocations enable row level security;
alter table public.bread_reuse_plan_allocations force row level security;

revoke all on table public.bread_reuse_plans from anon, authenticated;
revoke all on table public.bread_leftover_events from anon, authenticated;
revoke all on table public.bread_reuse_plan_allocations from anon, authenticated;
grant select on table public.bread_reuse_plans to authenticated;
grant select on table public.bread_leftover_events to authenticated;
grant select on table public.bread_reuse_plan_allocations to authenticated;
grant all on table public.bread_reuse_plans to service_role;
grant all on table public.bread_leftover_events to service_role;
grant all on table public.bread_reuse_plan_allocations to service_role;

create policy bread_reuse_plans_select_active_profiles
on public.bread_reuse_plans for select to authenticated
using (
  exists (
    select 1 from public.app_profiles as profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and (profile.role <> 'vendas' or profile.store = public.bread_reuse_plans.store)
  )
);

create policy bread_leftover_events_select_active_profiles
on public.bread_leftover_events for select to authenticated
using (
  exists (
    select 1
    from public.app_profiles as profile
    join public.sobras as sobra on sobra.id = public.bread_leftover_events.sobra_id
    where profile.user_id = (select auth.uid())
      and profile.active
      and (profile.role <> 'vendas' or profile.store = sobra.store)
  )
);

create policy bread_reuse_allocations_select_active_profiles
on public.bread_reuse_plan_allocations for select to authenticated
using (
  exists (
    select 1
    from public.app_profiles as profile
    join public.sobras as sobra on sobra.id = public.bread_reuse_plan_allocations.sobra_id
    where profile.user_id = (select auth.uid())
      and profile.active
      and (profile.role <> 'vendas' or profile.store = sobra.store)
  )
);

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
  v_sobra public.sobras%rowtype;
  v_resolved numeric;
  v_pending numeric;
  v_sobra_found boolean;
  v_count integer := 0;
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

    select id, lot_code
    into v_actual_id, v_lot_code
    from public.production_actuals
    where bread_id = v_bread_id and record_date = p_record_date;

    select * into v_sobra
    from public.sobras
    where store = p_store
      and product_source = 'bread'
      and product_id = v_bread_id
      and production_actual_id = v_actual_id
    for update;
    v_sobra_found := found;

    if v_quantity = 0 and not v_sobra_found then
      continue;
    end if;

    if v_actual_id is null then
      raise exception using
        errcode = '23503',
        message = 'Confirme primeiro a saida deste pao no Forno para gerar o lote.';
    end if;

    if not v_sobra_found then
      insert into public.sobras (
        record_date, responsible, product_id, product_source, quantity,
        store, production_actual_id, lot_code, pending_quantity, status,
        physical_location, updated_at
      ) values (
        p_record_date, v_profile_name, v_bread_id, 'bread', v_quantity,
        p_store, v_actual_id, v_lot_code, v_quantity,
        case when v_quantity > 0 then 'pending' else 'cancelled' end,
        p_physical_location, now()
      )
      returning * into v_sobra;

      insert into public.bread_leftover_events (
        sobra_id, action, quantity, to_location, actor_id, actor_name
      ) values (
        v_sobra.id, 'registered', v_quantity, p_physical_location,
        v_user_id, v_profile_name
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
          status = case when v_pending > 0 then 'pending' else 'resolved' end,
          physical_location = p_physical_location,
          responsible = v_profile_name,
          updated_at = now()
      where id = v_sobra.id;

      insert into public.bread_leftover_events (
        sobra_id, action, quantity, from_location, to_location,
        actor_id, actor_name, obs
      ) values (
        v_sobra.id, 'corrected', v_quantity, v_sobra.physical_location,
        p_physical_location, v_user_id, v_profile_name,
        'Quantidade total corrigida; destinos anteriores preservados.'
      );
    end if;

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('saved_items', v_count, 'store', p_store, 'record_date', p_record_date);
end;
$$;

create or replace function public.save_bread_reuse_proposals(
  p_target_production_date date,
  p_store text,
  p_proposals jsonb
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
$$;

create or replace function public.confirm_bread_reuse_plan(
  p_plan_id uuid,
  p_confirmed_quantity integer
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

create or replace function public.resolve_bread_leftover(
  p_sobra_id uuid,
  p_action text,
  p_quantity numeric,
  p_freezer_location text default null
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

create or replace function public.update_bread_leftover_location(
  p_sobra_id uuid,
  p_physical_location text
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

revoke all on function public.register_bread_leftovers(date, text, jsonb, text) from public, anon;
revoke all on function public.save_bread_reuse_proposals(date, text, jsonb) from public, anon;
revoke all on function public.confirm_bread_reuse_plan(uuid, integer) from public, anon;
revoke all on function public.resolve_bread_leftover(uuid, text, numeric, text) from public, anon;
revoke all on function public.update_bread_leftover_location(uuid, text) from public, anon;

grant execute on function public.register_bread_leftovers(date, text, jsonb, text) to authenticated, service_role;
grant execute on function public.save_bread_reuse_proposals(date, text, jsonb) to authenticated, service_role;
grant execute on function public.confirm_bread_reuse_plan(uuid, integer) to authenticated, service_role;
grant execute on function public.resolve_bread_leftover(uuid, text, numeric, text) to authenticated, service_role;
grant execute on function public.update_bread_leftover_location(uuid, text) to authenticated, service_role;
