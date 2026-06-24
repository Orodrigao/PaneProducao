alter table public.products
  add column if not exists is_fabricacao_propria boolean not null default false,
  add column if not exists is_pj boolean not null default false,
  add column if not exists production_days integer[] not null default '{}',
  add column if not exists production_area text,
  add column if not exists legacy_bread_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_production_days_valid'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_production_days_valid
      check (production_days <@ array[0, 1, 2, 3, 4, 5, 6]);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_production_area_valid'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_production_area_valid
      check (
        production_area is null
        or production_area in ('padaria', 'cozinha', 'confeitaria', 'expedicao', 'outros')
      );
  end if;
end $$;

create unique index if not exists products_legacy_bread_id_key
  on public.products (legacy_bread_id)
  where legacy_bread_id is not null;

create index if not exists products_fabricacao_propria_idx
  on public.products (is_fabricacao_propria)
  where active is distinct from false;

create index if not exists products_pj_idx
  on public.products (is_pj)
  where active is distinct from false;

comment on column public.products.is_fabricacao_propria is
  'Indica produto fabricado internamente. Preparacao para unificar breads em products.';

comment on column public.products.is_pj is
  'Indica item disponivel no catalogo PJ. Preparacao para remover dependencia de breads.is_pj.';

comment on column public.products.production_days is
  'Dias da semana em que o produto aparece no planejamento de producao. Usa 0..6, mantendo o padrao historico de breads.days.';

comment on column public.products.production_area is
  'Area operacional responsavel pela producao: padaria, cozinha, confeitaria, expedicao ou outros.';

comment on column public.products.legacy_bread_id is
  'Vinculo temporario com public.breads.id durante a migracao para catalogo unico.';
