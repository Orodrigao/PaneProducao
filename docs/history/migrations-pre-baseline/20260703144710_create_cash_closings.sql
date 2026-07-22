create table if not exists public.cash_closings (
  id uuid primary key default gen_random_uuid(),
  closing_date date not null,
  weekday_label text not null,
  store text not null,
  sales_amount numeric(12,2) not null default 0,
  banri_amount numeric(12,2) not null default 0,
  sitef_amount numeric(12,2) not null default 0,
  pix_amount numeric(12,2) not null default 0,
  cash_amount numeric(12,2) not null default 0,
  site_sales_amount numeric(12,2) not null default 0,
  ifood_sales_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  cash_withdrawal_amount numeric(12,2) not null default 0,
  opening_cash_amount numeric(12,2) not null default 0,
  closing_cash_amount numeric(12,2) not null default 0,
  envelope_amount numeric(12,2) not null default 0,
  next_day_cash_amount numeric(12,2) not null default 0,
  notes text,
  created_by text not null,
  created_by_name text not null,
  created_by_email text,
  updated_by text,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cash_closings_store_check
    check (store in ('jc', 'ja', 'ex')),
  constraint cash_closings_weekday_not_blank
    check (btrim(weekday_label) <> ''),
  constraint cash_closings_created_by_not_blank
    check (btrim(created_by) <> ''),
  constraint cash_closings_created_by_name_not_blank
    check (btrim(created_by_name) <> ''),
  constraint cash_closings_non_negative_values
    check (
      sales_amount >= 0
      and banri_amount >= 0
      and sitef_amount >= 0
      and pix_amount >= 0
      and cash_amount >= 0
      and site_sales_amount >= 0
      and ifood_sales_amount >= 0
      and total_amount >= 0
      and cash_withdrawal_amount >= 0
      and opening_cash_amount >= 0
      and closing_cash_amount >= 0
      and envelope_amount >= 0
      and next_day_cash_amount >= 0
    ),
  constraint cash_closings_store_date_unique
    unique (store, closing_date)
);

comment on table public.cash_closings is
  'Fechamento diario de caixa informado pelas lojas. Dados financeiros: manter RLS restritivo.';
comment on column public.cash_closings.closing_date is
  'Data operacional do fechamento.';
comment on column public.cash_closings.sales_amount is
  'Valor de vendas do dia em reais.';
comment on column public.cash_closings.opening_cash_amount is
  'Caixa anterior, usado como abertura do caixa.';
comment on column public.cash_closings.envelope_amount is
  'Dinheiro separado em malote para deposito.';
comment on column public.cash_closings.next_day_cash_amount is
  'Dinheiro deixado para abertura do caixa do proximo dia.';

create index if not exists cash_closings_closing_date_idx
  on public.cash_closings (closing_date desc);

create index if not exists cash_closings_store_date_idx
  on public.cash_closings (store, closing_date desc);

create or replace function public.set_cash_closings_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists set_cash_closings_updated_at on public.cash_closings;
create trigger set_cash_closings_updated_at
before update on public.cash_closings
for each row
execute function public.set_cash_closings_updated_at();

revoke execute on function public.set_cash_closings_updated_at() from public;
revoke execute on function public.set_cash_closings_updated_at() from anon;
revoke execute on function public.set_cash_closings_updated_at() from authenticated;

alter table public.cash_closings enable row level security;
alter table public.cash_closings force row level security;

revoke all on table public.cash_closings from anon;
revoke all on table public.cash_closings from authenticated;

grant select, insert, update on table public.cash_closings to authenticated;
grant all on table public.cash_closings to service_role;

drop policy if exists cash_closings_select_internal on public.cash_closings;
drop policy if exists cash_closings_insert_internal on public.cash_closings;
drop policy if exists cash_closings_update_internal on public.cash_closings;

create policy cash_closings_select_internal
on public.cash_closings
for select
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and (
        p.role in ('admin', 'financeiro')
        or (p.role = 'vendas' and p.store = public.cash_closings.store)
      )
  )
);

create policy cash_closings_insert_internal
on public.cash_closings
for insert
to authenticated
with check (
  created_by = (select auth.uid())::text
  and exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and (
        p.role in ('admin', 'financeiro')
        or (p.role = 'vendas' and p.store = public.cash_closings.store)
      )
  )
);

create policy cash_closings_update_internal
on public.cash_closings
for update
to authenticated
using (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and (
        p.role in ('admin', 'financeiro')
        or (p.role = 'vendas' and p.store = public.cash_closings.store)
      )
  )
)
with check (
  exists (
    select 1
    from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and (
        p.role in ('admin', 'financeiro')
        or (p.role = 'vendas' and p.store = public.cash_closings.store)
      )
  )
);
