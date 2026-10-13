-- Correcao pontual autorizada por Rodrigo (2026-10-13): os Planejamentos de
-- 11/08/2026 e 10/09/2026 saem de "Em andamento", como o de 10/10/2026
-- (migration 20261013141847). Os dois ficaram em rascunho com uma loja
-- convertida em pedido e a outra so no Planejamento:
--   11/08: JA convertida; JC com 251 paes sem pedido gerado (o pedido da JC
--          desse dia foi digitado a mao, 233 paes, e continua como esta).
--   10/09: JC convertida; JA com 73 paes sem pedido e sem pedido da JA no dia.
-- Fechar, e nao apagar: a loja convertida veio desse Planejamento, e a tela so
-- permite descartar quando nenhuma loja virou pedido. Fechado, ninguem gera por
-- engano pedido retroativo para essas datas.
--
-- Cada UPDATE so fecha se tudo bater; nos bancos de teste os planejamentos nao
-- existem e nada acontece. A Action verde nao prova o fechamento: depois do
-- merge, reler o status em producao.

update public.production_plans plan
set status = 'fechado'
where plan.id = 'fdf0f77f-a8c4-4600-bf3d-9d4d0c63de0f'
  and plan.production_date = date '2026-08-11'
  and plan.status = 'rascunho'
  and exists (
    select 1 from public.production_plan_items item
    where item.plan_id = plan.id and item.store = 'ja' and item.order_created_at is not null
  )
  and not exists (
    select 1 from public.production_plan_items item
    where item.plan_id = plan.id and item.store = 'ja'
      and item.order_created_at is null and item.planned_quantity > 0
  )
  and not exists (
    select 1 from public.production_plan_items item
    where item.plan_id = plan.id and item.store = 'jc' and item.order_created_at is not null
  )
  and (
    select coalesce(sum(item.planned_quantity), 0)
    from public.production_plan_items item
    where item.plan_id = plan.id and item.store = 'jc'
  ) = 251;

update public.production_plans plan
set status = 'fechado'
where plan.id = '548fa119-81f4-4106-8a81-62e78e688fa5'
  and plan.production_date = date '2026-09-10'
  and plan.status = 'rascunho'
  and exists (
    select 1 from public.production_plan_items item
    where item.plan_id = plan.id and item.store = 'jc' and item.order_created_at is not null
  )
  and not exists (
    select 1 from public.production_plan_items item
    where item.plan_id = plan.id and item.store = 'jc'
      and item.order_created_at is null and item.planned_quantity > 0
  )
  and not exists (
    select 1 from public.production_plan_items item
    where item.plan_id = plan.id and item.store = 'ja' and item.order_created_at is not null
  )
  and (
    select coalesce(sum(item.planned_quantity), 0)
    from public.production_plan_items item
    where item.plan_id = plan.id and item.store = 'ja'
  ) = 73
  and not exists (
    select 1 from public.orders ord
    where ord.store = 'ja'
      and ord.order_date = date '2026-09-10'
      and ord.cancelled_at is null
      and ord.quantity > 0
  );
