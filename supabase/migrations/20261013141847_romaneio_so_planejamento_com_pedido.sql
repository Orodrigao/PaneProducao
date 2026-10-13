-- O Romaneio de JC e JA passa a ler o Planejamento de producao somente da loja
-- que ja teve o pedido gerado a partir dele (order_created_at, gravado por
-- import_production_plan_order para todos os itens da loja) ou que nao tem pao
-- novo a gerar: loja so com congelado e sobra nunca recebe o botao
-- "Transformar em Pedido" (storeNeedsOrderConversion na tela de Producao) e
-- continua aparecendo no Romaneio como antes.
--
-- Motivo: em 10/10/2026 o Planejamento ficou em rascunho com 67 paes digitados
-- para a JA, mas o pedido da JA nunca foi gerado (a loja nao abriu). Producao,
-- Geolar e Forno leem o pedido e mostraram zero para a JA; o Romaneio lia o
-- Planejamento e mandou separar 74 paes para a JA, tirados da parte da JC, que
-- voltaram e foram congelados. O pedido e a fonte de verdade de quanto vai para
-- cada loja; o Planejamento continua dando a composicao (pao novo, sobra e
-- congelado) de quem ja virou pedido.
--
-- "Pao novo a gerar" usa a mesma conta da importacao e da tela: planejado menos
-- congelado menos sobra (confirmada, senao proposta). Nos 40 planejamentos
-- fechados ate 13/10/2026 todo item com quantidade ja tem order_created_at; a
-- regra nova so deixa de fora loja de rascunho com pao novo sem pedido.

create or replace function public.get_romaneio_production_composition(
  p_production_date date,
  p_store text
)
returns table (
  bread_id text,
  planned_quantity numeric,
  frozen_quantity numeric,
  leftover_quantity numeric,
  new_quantity numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store text := lower(trim(coalesce(p_store, '')));
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Entre com e-mail para consultar a composição do Romaneio.';
  end if;

  if p_production_date is null or v_store not in ('jc', 'ja') then
    raise exception using errcode = '22023', message = 'Data ou loja inválida para a composição do Romaneio.';
  end if;

  if not (
    (select private.current_user_has_permission('romaneio.visualizar', v_store))
    or (select private.current_user_has_permission('romaneio.criar', v_store))
    or (select private.current_user_has_permission('romaneio.administrar', v_store))
  ) then
    raise exception using errcode = '42501', message = 'Sem permissão para consultar a composição desta loja.';
  end if;

  return query
  select
    item.bread_id,
    greatest(0, item.planned_quantity)::numeric,
    greatest(0, item.frozen_quantity)::numeric,
    greatest(0, coalesce(reuse.confirmed_quantity, item.leftover_confirmed_quantity, 0))::numeric,
    greatest(
      0,
      item.planned_quantity
        - item.frozen_quantity
        - coalesce(reuse.confirmed_quantity, item.leftover_confirmed_quantity, 0)
    )::numeric
  from public.production_plans plan
  join public.production_plan_items item on item.plan_id = plan.id
  left join (
    select
      reuse_plan.bread_id,
      sum(greatest(0, reuse_plan.confirmed_quantity))::numeric as confirmed_quantity
    from public.bread_reuse_plans reuse_plan
    where reuse_plan.target_production_date = p_production_date
      and lower(reuse_plan.store) = v_store
      and reuse_plan.status = 'confirmed'
    group by reuse_plan.bread_id
  ) reuse on reuse.bread_id = item.bread_id
  where plan.production_date = p_production_date
    and item.store = v_store
    and (
      item.order_created_at is not null
      or not exists (
        select 1
        from public.production_plan_items pending
        where pending.plan_id = plan.id
          and pending.store = v_store
          and pending.order_created_at is null
          and greatest(
            0,
            pending.planned_quantity
              - pending.frozen_quantity
              - coalesce(pending.leftover_confirmed_quantity, pending.leftover_proposed_quantity, 0)
          ) > 0
      )
    )
  order by item.bread_id;
end;
$$;

alter function public.get_romaneio_production_composition(date, text) owner to postgres;
revoke all on function public.get_romaneio_production_composition(date, text) from public, anon, authenticated;
grant execute on function public.get_romaneio_production_composition(date, text) to authenticated;

-- Explica para a Expedicao por que o Romaneio da loja nao traz os numeros do
-- Planejamento: ha planejamento em andamento com pao novo para a loja que nao
-- virou pedido. Responde so sim ou nao; o planejamento completo continua
-- restrito ao acesso administrativo.
create or replace function public.get_romaneio_plan_without_order(
  p_production_date date,
  p_store text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store text := lower(trim(coalesce(p_store, '')));
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Entre com e-mail para consultar o Planejamento do Romaneio.';
  end if;

  if p_production_date is null or v_store not in ('jc', 'ja') then
    raise exception using errcode = '22023', message = 'Data ou loja inválida para o Planejamento do Romaneio.';
  end if;

  if not (
    (select private.current_user_has_permission('romaneio.visualizar', v_store))
    or (select private.current_user_has_permission('romaneio.criar', v_store))
    or (select private.current_user_has_permission('romaneio.administrar', v_store))
  ) then
    raise exception using errcode = '42501', message = 'Sem permissão para consultar o Planejamento desta loja.';
  end if;

  return exists (
    select 1
    from public.production_plans plan
    join public.production_plan_items item on item.plan_id = plan.id
    where plan.production_date = p_production_date
      and plan.status <> 'fechado'
      and item.store = v_store
      and item.order_created_at is null
      and greatest(
        0,
        item.planned_quantity
          - item.frozen_quantity
          - coalesce(item.leftover_confirmed_quantity, item.leftover_proposed_quantity, 0)
      ) > 0
  );
end;
$$;

alter function public.get_romaneio_plan_without_order(date, text) owner to postgres;
revoke all on function public.get_romaneio_plan_without_order(date, text) from public, anon, authenticated;
grant execute on function public.get_romaneio_plan_without_order(date, text) to authenticated;

-- Correcao pontual autorizada por Rodrigo (2026-10-13): o Planejamento de
-- 10/10/2026 sai de "Em andamento". Fechar, e nao apagar: a JC virou pedido a
-- partir dele e a tela de Planejamento so permite descartar quando nenhuma loja
-- virou pedido. Fechado, ninguem gera por engano um pedido da JA para uma data
-- passada; os 67 paes da JA ficam registrados como planejados e sem pedido.
--
-- So fecha se tudo bater: data, rascunho, JC inteira convertida, JA com 67 paes
-- sem pedido e nenhum pedido da JA no dia. Nos bancos de teste o planejamento
-- nao existe e nada acontece; a Action verde nao prova o fechamento: depois do
-- merge, reler o status em producao.
update public.production_plans plan
set status = 'fechado'
where plan.id = '73078a7f-76d4-4411-88cf-f9fa7a5acb2a'
  and plan.production_date = date '2026-10-10'
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
  ) = 67
  and not exists (
    select 1 from public.orders ord
    where ord.store = 'ja'
      and ord.order_date = date '2026-10-10'
      and ord.cancelled_at is null
      and ord.quantity > 0
  );
