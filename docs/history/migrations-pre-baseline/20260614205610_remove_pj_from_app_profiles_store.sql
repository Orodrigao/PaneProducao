alter table public.app_profiles
  drop constraint if exists app_profiles_store_check;

alter table public.app_profiles
  add constraint app_profiles_store_check
  check (store is null or store in ('jc', 'ex', 'ja'));

comment on constraint app_profiles_store_check on public.app_profiles is
  'store null representa escopo global; PJ e canal/tipo de pedido, nao loja/unidade.';
