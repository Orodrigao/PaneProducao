create table public.production_plans (
  id uuid primary key default gen_random_uuid(),
  production_date date not null,
  status text not null default 'rascunho',
  created_by uuid not null default auth.uid(),
  created_by_name text,
  reopened_by uuid,
  reopened_by_name text,
  reopened_reason text,
  reopened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_plans_one_per_date unique (production_date),
  constraint production_plans_status_check check (
    status in (
      'rascunho',
      'aguardando_expedicao',
      'aguardando_sobras',
      'aguardando_geolar',
      'fechado',
      'reaberto'
    )
  ),
  constraint production_plans_reopen_audit_check check (
    (reopened_at is null and reopened_by is null and reopened_reason is null)
    or (reopened_at is not null and reopened_by is not null and nullif(btrim(reopened_reason), '') is not null)
  )
);

comment on table public.production_plans is
  'Planejamento oficial de producao de JC e JA. Um planejamento por data; EX permanece no fluxo atual.';
comment on column public.production_plans.status is
  'rascunho, aguardando_expedicao, aguardando_sobras, aguardando_geolar, fechado ou reaberto.';
comment on column public.production_plans.reopened_reason is
  'Motivo informado pelo Rodrigo/admin ao reabrir um planejamento travado.';

create table public.production_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.production_plans(id) on delete cascade,
  store text not null,
  bread_id text not null references public.breads(id) on delete restrict,
  planned_quantity integer not null default 0,
  frozen_quantity integer not null default 0,
  leftover_proposed_quantity integer not null default 0,
  leftover_confirmed_quantity integer,
  is_extra boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_plan_items_store_check check (store in ('jc', 'ja')),
  constraint production_plan_items_quantities_check check (
    planned_quantity >= 0
    and frozen_quantity >= 0
    and leftover_proposed_quantity >= 0
    and frozen_quantity + leftover_proposed_quantity <= planned_quantity
    and (
      leftover_confirmed_quantity is null
      or (
        leftover_confirmed_quantity >= 0
        and leftover_confirmed_quantity <= leftover_proposed_quantity
      )
    )
  ),
  constraint production_plan_items_unique unique (plan_id, store, bread_id)
);

comment on table public.production_plan_items is
  'Itens planejados por loja e pao. A producao nova e derivada de planned_quantity menos congelado e sobra confirmada.';
comment on column public.production_plan_items.is_extra is
  'Indica pao incluido manualmente so para esta data, sem alterar o cadastro semanal.';

create index production_plan_items_plan_store_idx
  on public.production_plan_items (plan_id, store, bread_id);

create or replace function public.set_production_planning_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_production_plans_updated_at
before update on public.production_plans
for each row execute function public.set_production_planning_updated_at();

create trigger set_production_plan_items_updated_at
before update on public.production_plan_items
for each row execute function public.set_production_planning_updated_at();

alter table public.production_plans enable row level security;
alter table public.production_plans force row level security;
alter table public.production_plan_items enable row level security;
alter table public.production_plan_items force row level security;

revoke all on table public.production_plans from public, anon, authenticated;
revoke all on table public.production_plan_items from public, anon, authenticated;
grant select, insert, update, delete on table public.production_plans to authenticated;
grant select, insert, update, delete on table public.production_plan_items to authenticated;
grant all on table public.production_plans to service_role;
grant all on table public.production_plan_items to service_role;

create policy production_plans_select_admin
on public.production_plans
for select to authenticated
using ((select private.current_user_is_access_admin()));

create policy production_plans_insert_admin
on public.production_plans
for insert to authenticated
with check (
  (select private.current_user_is_access_admin())
  and created_by = (select auth.uid())
);

create policy production_plans_update_admin
on public.production_plans
for update to authenticated
using ((select private.current_user_is_access_admin()))
with check ((select private.current_user_is_access_admin()));

create policy production_plans_delete_admin
on public.production_plans
for delete to authenticated
using ((select private.current_user_is_access_admin()));

create policy production_plan_items_select_admin
on public.production_plan_items
for select to authenticated
using ((select private.current_user_is_access_admin()));

create policy production_plan_items_insert_admin
on public.production_plan_items
for insert to authenticated
with check (
  (select private.current_user_is_access_admin())
  and exists (
    select 1
    from public.production_plans plan
    where plan.id = production_plan_items.plan_id
  )
);

create policy production_plan_items_update_admin
on public.production_plan_items
for update to authenticated
using ((select private.current_user_is_access_admin()))
with check ((select private.current_user_is_access_admin()));

create policy production_plan_items_delete_admin
on public.production_plan_items
for delete to authenticated
using ((select private.current_user_is_access_admin()));

revoke all on function public.set_production_planning_updated_at() from public, anon, authenticated;
grant execute on function public.set_production_planning_updated_at() to service_role;
