comment on table public.production_plan_items is
  'Itens planejados por loja e pao. planned_quantity e o total do dia, formado pela soma de paes novos, congelados e sobras usadas.';

comment on column public.production_plan_items.planned_quantity is
  'Quantidade total planejada para o dia. Nome legado mantido para compatibilidade de deploy; a producao nova e derivada da composicao.';

comment on column public.production_plan_items.frozen_quantity is
  'Quantidade planejada para usar do congelado; a baixa real continua no modulo de Congelados.';

comment on column public.production_plan_items.leftover_proposed_quantity is
  'Quantidade de sobra proposta para compor o total do dia e que Geolar ainda precisa validar.';

comment on column public.production_plan_items.leftover_confirmed_quantity is
  'Quantidade de sobra confirmada para compor o total do dia. Quando nula, a proposta ainda aguarda validacao.';
