create or replace function public.set_app_profiles_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

revoke execute on function public.set_app_profiles_updated_at() from public;
revoke execute on function public.set_app_profiles_updated_at() from anon;
revoke execute on function public.set_app_profiles_updated_at() from authenticated;
