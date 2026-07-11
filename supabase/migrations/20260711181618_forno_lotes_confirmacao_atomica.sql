-- Forno v2: lote diario, perda analitica e confirmacao transacional por produto.
-- Versao alinhada ao registro criado pelo Supabase remoto.
-- A saida boa entra no estoque. A perda no forno nunca entra e, portanto, nao
-- gera movimento negativo.

alter table public.production_actuals
  add column if not exists lot_code text;

update public.production_actuals
set lot_code = 'L' || to_char(record_date, 'MMDD')
where lot_code is null;

alter table public.production_actuals
  alter column lot_code set not null;

alter table public.production_actuals
  add constraint production_actuals_lot_code_matches_date
  check (lot_code = 'L' || to_char(record_date, 'MMDD'));

alter table public.production_actuals
  add constraint production_actuals_quantities_non_negative
  check (quantity_baked >= 0 and quantity_loss >= 0);

alter table public.production_actuals
  add constraint production_actuals_quantities_are_whole_units
  check (
    quantity_baked = trunc(quantity_baked)
    and quantity_loss = trunc(quantity_loss)
  );

alter table public.bread_movements
  add column if not exists lot_id uuid;

update public.bread_movements as movement
set lot_id = actual.id
from public.production_actuals as actual
where movement.lot_id is null
  and movement.reference_type = 'production_actual'
  and movement.reference_id = actual.id::text;

alter table public.bread_movements
  add constraint bread_movements_lot_id_fkey
  foreign key (lot_id)
  references public.production_actuals(id)
  on delete restrict;

create index if not exists bread_movements_lot_id_idx
  on public.bread_movements(lot_id)
  where lot_id is not null;

create table public.production_actual_events (
  id uuid primary key default gen_random_uuid(),
  production_actual_id uuid not null
    references public.production_actuals(id)
    on delete restrict,
  bread_id text not null,
  record_date date not null,
  lot_code text not null,
  previous_quantity_baked numeric,
  previous_quantity_loss numeric,
  quantity_baked numeric not null,
  quantity_loss numeric not null,
  loss_reason text,
  changed_by uuid not null,
  changed_by_name text not null,
  created_at timestamptz not null default now(),

  constraint production_actual_events_lot_code_matches_date
    check (lot_code = 'L' || to_char(record_date, 'MMDD')),
  constraint production_actual_events_quantities_non_negative
    check (quantity_baked >= 0 and quantity_loss >= 0),
  constraint production_actual_events_quantities_are_whole_units
    check (
      quantity_baked = trunc(quantity_baked)
      and quantity_loss = trunc(quantity_loss)
    )
);

comment on column public.production_actuals.quantity_baked is
  'Quantidade boa que saiu do forno e entrou no estoque de paes.';
comment on column public.production_actuals.quantity_loss is
  'Perda ocorrida no forno. E apenas analitica porque nunca entrou no estoque.';
comment on column public.production_actuals.lot_code is
  'Codigo operacional diario no formato LMMDD. O UUID da linha distingue produto, ano e data.';
comment on table public.production_actual_events is
  'Historico imutavel das confirmacoes e correcoes feitas no Forno.';

create index production_actual_events_actual_created_idx
  on public.production_actual_events(production_actual_id, created_at desc);

alter table public.production_actual_events enable row level security;
alter table public.production_actual_events force row level security;

revoke all on table public.production_actual_events from anon;
revoke all on table public.production_actual_events from authenticated;
grant select on table public.production_actual_events to authenticated;
grant all on table public.production_actual_events to service_role;

drop policy if exists production_actual_events_select_active_profiles
  on public.production_actual_events;
create policy production_actual_events_select_active_profiles
on public.production_actual_events
for select
to authenticated
using (
  exists (
    select 1
    from public.app_profiles as profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and profile.role in ('admin', 'producao', 'financeiro', 'estoque')
  )
);

-- Mantem leitura autenticada das tabelas operacionais. A escrita de
-- production_actuals passa exclusivamente pela funcao transacional abaixo.
grant select on table public.production_actuals to authenticated;
grant select on table public.bread_movements to authenticated;

drop policy if exists production_actuals_select_authenticated_profiles
  on public.production_actuals;
create policy production_actuals_select_authenticated_profiles
on public.production_actuals
for select
to authenticated
using (
  exists (
    select 1
    from public.app_profiles as profile
    where profile.user_id = (select auth.uid())
      and profile.active
  )
);

drop policy if exists bread_movements_select_authenticated_profiles
  on public.bread_movements;
create policy bread_movements_select_authenticated_profiles
on public.bread_movements
for select
to authenticated
using (
  exists (
    select 1
    from public.app_profiles as profile
    where profile.user_id = (select auth.uid())
      and profile.active
  )
);

drop policy if exists anon_insert on public.production_actuals;
drop policy if exists anon_update on public.production_actuals;
drop policy if exists anon_delete on public.production_actuals;
revoke insert, update, delete on table public.production_actuals from anon;
revoke insert, update, delete on table public.production_actuals from authenticated;

create or replace function public.confirm_oven_output(
  p_record_date date,
  p_bread_id text,
  p_quantity_good integer,
  p_quantity_loss integer default 0,
  p_loss_reason text default null,
  p_obs text default null
)
returns table (
  production_actual_id uuid,
  returned_lot_code text,
  returned_quantity_good integer,
  returned_quantity_loss integer,
  returned_loss_reason text,
  confirmed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
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

  -- Serializa dois toques simultaneos no mesmo produto/data sem bloquear
  -- confirmacoes de outros produtos.
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

comment on function public.confirm_oven_output(date, text, integer, integer, text, text) is
  'Confirma ou corrige um produto/lote do forno e sincroniza sua entrada de estoque na mesma transacao.';

revoke all on function public.confirm_oven_output(date, text, integer, integer, text, text)
  from public;
revoke all on function public.confirm_oven_output(date, text, integer, integer, text, text)
  from anon;
grant execute on function public.confirm_oven_output(date, text, integer, integer, text, text)
  to authenticated;
grant execute on function public.confirm_oven_output(date, text, integer, integer, text, text)
  to service_role;
