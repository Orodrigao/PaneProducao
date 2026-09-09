-- Classificacao operacional separada da categoria comercial do produto.
begin;

alter table public.products
  add column production_process text,
  add column allows_planned_production boolean,
  add column allows_unplanned_production boolean;

alter table public.products
  add constraint products_production_process_valid check (
    production_process is null
    or production_process = any (array['forno'::text, 'montagem'::text, 'preparo'::text])
  ),
  add constraint products_operational_classification_coherent check (
    (
      production_process is null
      and allows_planned_production is null
      and allows_unplanned_production is null
    )
    or
    (
      is_fabricacao_propria
      and production_process is not null
      and production_area is not null
      and allows_planned_production is not null
      and allows_unplanned_production is not null
      and (allows_planned_production or allows_unplanned_production)
    )
  );

comment on column public.products.production_process is
  'Processo final usado para apontar a producao: forno, montagem ou preparo. Nulo indica cadastro ainda nao revisado ou nao aplicavel.';
comment on column public.products.allows_planned_production is
  'Indica se o produto aceita quantidade planejada em uma ordem de producao.';
comment on column public.products.allows_unplanned_production is
  'Indica se o produto aceita lancamento de producao feita sem ordem previa.';

commit;
