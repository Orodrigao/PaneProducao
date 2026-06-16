create table if not exists public.app_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null,
  store text,
  active boolean not null default true,
  allowed_routes jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint app_profiles_display_name_not_blank
    check (btrim(display_name) <> ''),
  constraint app_profiles_role_check
    check (role in (
      'admin',
      'financeiro',
      'producao',
      'compras',
      'estoque',
      'expedicao',
      'vendas'
    )),
  constraint app_profiles_store_check
    check (store is null or store in ('jc', 'ex', 'ja', 'pj')),
  constraint app_profiles_allowed_routes_array_check
    check (allowed_routes is null or jsonb_typeof(allowed_routes) = 'array')
);

comment on table public.app_profiles is
  'Perfis operacionais do ERP vinculados ao Supabase Auth. Mantido em paralelo ao app_users durante a transicao.';
comment on column public.app_profiles.user_id is
  'Vinculo com auth.users.id. Nao armazena PIN ou segredo.';
comment on column public.app_profiles.allowed_routes is
  'Apoio para navegacao da UI. Nao substitui RLS.';

create or replace function public.set_app_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_app_profiles_updated_at on public.app_profiles;
create trigger set_app_profiles_updated_at
before update on public.app_profiles
for each row
execute function public.set_app_profiles_updated_at();

alter table public.app_profiles enable row level security;
alter table public.app_profiles force row level security;

revoke all on table public.app_profiles from anon;
revoke all on table public.app_profiles from authenticated;

grant select on table public.app_profiles to authenticated;

drop policy if exists app_profiles_select_own on public.app_profiles;
create policy app_profiles_select_own
on public.app_profiles
for select
to authenticated
using (user_id = auth.uid());
