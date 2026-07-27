alter table public.production_plan_items
drop constraint if exists production_plan_items_quantities_check;

alter table public.production_plan_items
add constraint production_plan_items_quantities_check check (
  planned_quantity >= 0
  and frozen_quantity >= 0
  and leftover_proposed_quantity >= 0
  and (
    leftover_confirmed_quantity is null
    or (
      leftover_confirmed_quantity >= 0
      and leftover_confirmed_quantity <= leftover_proposed_quantity
    )
  )
);

comment on table public.production_plan_items is
  'Itens planejados por loja e pao. O total do dia e a soma de paes novos, congelados e sobras usadas.';
comment on column public.production_plan_items.planned_quantity is
  'Quantidade de paes novos a produzir. Nome legado mantido para compatibilidade de deploy.';
comment on column public.production_plan_items.frozen_quantity is
  'Quantidade planejada para usar do congelado; a baixa real continua no modulo de Congelados.';
comment on column public.production_plan_items.leftover_proposed_quantity is
  'Quantidade de sobra que Rodrigo/admin pretende usar e que Geolar ainda precisa validar.';
comment on column public.production_plan_items.leftover_confirmed_quantity is
  'Quantidade de sobra aceita pelo Geolar. Quando nula, a proposta ainda aguarda validacao.';
