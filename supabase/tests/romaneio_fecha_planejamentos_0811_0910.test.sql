-- A correcao pontual de 13/10/2026 fecha somente os Planejamentos de 11/08 e
-- 10/09/2026 quando tudo bate. A funcao temporaria abaixo e copia literal dos
-- dois UPDATEs da migration 20261013155842 (o teste de banco nao consegue
-- reexecutar arquivo de migration).

begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

create function pg_temp.aplicar_migration() returns void
language plpgsql
as $migration$
begin
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
end;
$migration$;

create function pg_temp.status_do(p_id uuid) returns text
language sql
as $$ select status from public.production_plans where id = p_id $$;

-- Um planejamento por data: abre espaco caso o banco de teste tenha um nessas datas.
delete from public.production_plans
where production_date in (date '2026-08-11', date '2026-09-10')
  and id not in ('fdf0f77f-a8c4-4600-bf3d-9d4d0c63de0f', '548fa119-81f4-4106-8a81-62e78e688fa5');

insert into public.breads (id, name, days, active, unit, is_special, is_shelf)
values
  ('teste-fecha-antigo-a', '[TESTE] Pao Fechamento Antigo A', '{0,1,2,3,4,5,6}', true, 'un', false, false),
  ('teste-fecha-antigo-b', '[TESTE] Pao Fechamento Antigo B', '{0,1,2,3,4,5,6}', true, 'un', false, false);

insert into public.production_plans (id, production_date, status, created_by, created_by_name)
values
  ('fdf0f77f-a8c4-4600-bf3d-9d4d0c63de0f', date '2026-08-11', 'rascunho', '00000000-0000-4000-8000-000000000000', '[TESTE] Rodrigo'),
  ('548fa119-81f4-4106-8a81-62e78e688fa5', date '2026-09-10', 'rascunho', '00000000-0000-4000-8000-000000000000', '[TESTE] Rodrigo');

-- Copia dos casos reais: 11/08 com a JA convertida e 251 paes da JC so no
-- Planejamento; 10/09 com a JC convertida e 73 paes da JA so no Planejamento.
-- O pao B zerado da loja convertida tambem tem pedido, como a importacao grava.
insert into public.production_plan_items (
  id, plan_id, store, bread_id, planned_quantity, frozen_quantity,
  leftover_proposed_quantity, order_created_at, order_created_by_name
)
values
  ('76000000-0000-4000-8000-000000000001', 'fdf0f77f-a8c4-4600-bf3d-9d4d0c63de0f', 'ja', 'teste-fecha-antigo-a', 40, 0, 0, now(), '[TESTE] Rodrigo'),
  ('76000000-0000-4000-8000-000000000002', 'fdf0f77f-a8c4-4600-bf3d-9d4d0c63de0f', 'ja', 'teste-fecha-antigo-b', 0, 0, 0, now(), '[TESTE] Rodrigo'),
  ('76000000-0000-4000-8000-000000000003', 'fdf0f77f-a8c4-4600-bf3d-9d4d0c63de0f', 'jc', 'teste-fecha-antigo-a', 200, 0, 0, null, null),
  ('76000000-0000-4000-8000-000000000004', 'fdf0f77f-a8c4-4600-bf3d-9d4d0c63de0f', 'jc', 'teste-fecha-antigo-b', 51, 0, 0, null, null),
  ('76000000-0000-4000-8000-000000000005', '548fa119-81f4-4106-8a81-62e78e688fa5', 'jc', 'teste-fecha-antigo-a', 30, 0, 0, now(), '[TESTE] Rodrigo'),
  ('76000000-0000-4000-8000-000000000006', '548fa119-81f4-4106-8a81-62e78e688fa5', 'jc', 'teste-fecha-antigo-b', 0, 0, 0, now(), '[TESTE] Rodrigo'),
  ('76000000-0000-4000-8000-000000000007', '548fa119-81f4-4106-8a81-62e78e688fa5', 'ja', 'teste-fecha-antigo-a', 70, 0, 0, null, null),
  ('76000000-0000-4000-8000-000000000008', '548fa119-81f4-4106-8a81-62e78e688fa5', 'ja', 'teste-fecha-antigo-b', 3, 0, 0, null, null);

-- Recusa 1: 11/08 com a JC convertida em parte; 10/09 com pedido da JA no dia.
update public.production_plan_items
set order_created_at = now(), order_created_by_name = '[TESTE] Rodrigo'
where id = '76000000-0000-4000-8000-000000000003';
insert into public.orders (
  id, store, bread_id, quantity, order_date, obs,
  order_type, product_source, product_name, needs_production
)
values (
  '77000000-0000-4000-8000-000000000001', 'ja', 'teste-fecha-antigo-a', 5, date '2026-09-10',
  '[TESTE] pedido da JA em 10/09', 'producao', 'bread', '[TESTE] Pao Fechamento Antigo A', true
);
select pg_temp.aplicar_migration();
select is(pg_temp.status_do('fdf0f77f-a8c4-4600-bf3d-9d4d0c63de0f'), 'rascunho', '11/08 com a JC convertida: continua aberto');
select is(pg_temp.status_do('548fa119-81f4-4106-8a81-62e78e688fa5'), 'rascunho', '10/09 com pedido da JA no dia: continua aberto');
update public.production_plan_items
set order_created_at = null, order_created_by_name = null
where id = '76000000-0000-4000-8000-000000000003';
delete from public.orders where id = '77000000-0000-4000-8000-000000000001';

-- Recusa 2: totais diferentes dos casos reais.
update public.production_plan_items set planned_quantity = 52 where id = '76000000-0000-4000-8000-000000000004';
update public.production_plan_items set planned_quantity = 4 where id = '76000000-0000-4000-8000-000000000008';
select pg_temp.aplicar_migration();
select is(pg_temp.status_do('fdf0f77f-a8c4-4600-bf3d-9d4d0c63de0f'), 'rascunho', '11/08 com total da JC diferente de 251: continua aberto');
select is(pg_temp.status_do('548fa119-81f4-4106-8a81-62e78e688fa5'), 'rascunho', '10/09 com total da JA diferente de 73: continua aberto');
update public.production_plan_items set planned_quantity = 51 where id = '76000000-0000-4000-8000-000000000004';
update public.production_plan_items set planned_quantity = 3 where id = '76000000-0000-4000-8000-000000000008';

-- Recusa 3: a loja convertida tem pao com quantidade que nao virou pedido.
update public.production_plan_items
set planned_quantity = 5, order_created_at = null, order_created_by_name = null
where id in ('76000000-0000-4000-8000-000000000002', '76000000-0000-4000-8000-000000000006');
select pg_temp.aplicar_migration();
select is(pg_temp.status_do('fdf0f77f-a8c4-4600-bf3d-9d4d0c63de0f'), 'rascunho', '11/08 com pao da JA sem pedido: continua aberto');
select is(pg_temp.status_do('548fa119-81f4-4106-8a81-62e78e688fa5'), 'rascunho', '10/09 com pao da JC sem pedido: continua aberto');
update public.production_plan_items
set planned_quantity = 0, order_created_at = now(), order_created_by_name = '[TESTE] Rodrigo'
where id in ('76000000-0000-4000-8000-000000000002', '76000000-0000-4000-8000-000000000006');

-- Recusa 4: planejamento que ja nao esta em rascunho nao e mexido.
update public.production_plans set status = 'aguardando_geolar'
where id in ('fdf0f77f-a8c4-4600-bf3d-9d4d0c63de0f', '548fa119-81f4-4106-8a81-62e78e688fa5');
select pg_temp.aplicar_migration();
select is(pg_temp.status_do('fdf0f77f-a8c4-4600-bf3d-9d4d0c63de0f'), 'aguardando_geolar', '11/08 fora de rascunho: status preservado');
select is(pg_temp.status_do('548fa119-81f4-4106-8a81-62e78e688fa5'), 'aguardando_geolar', '10/09 fora de rascunho: status preservado');
update public.production_plans set status = 'rascunho'
where id in ('fdf0f77f-a8c4-4600-bf3d-9d4d0c63de0f', '548fa119-81f4-4106-8a81-62e78e688fa5');

-- Pedido cancelado da JA em 10/09 nao conta como pedido.
insert into public.orders (
  id, store, bread_id, quantity, order_date, obs,
  order_type, product_source, product_name, needs_production, cancelled_at
)
values (
  '77000000-0000-4000-8000-000000000002', 'ja', 'teste-fecha-antigo-a', 5, date '2026-09-10',
  '[TESTE] pedido cancelado da JA em 10/09', 'producao', 'bread', '[TESTE] Pao Fechamento Antigo A', true, now()
);

-- Casos reais: fecham.
select pg_temp.aplicar_migration();
select is(pg_temp.status_do('fdf0f77f-a8c4-4600-bf3d-9d4d0c63de0f'), 'fechado', 'Caso de 11/08 bate: planejamento fechado');
select is(pg_temp.status_do('548fa119-81f4-4106-8a81-62e78e688fa5'), 'fechado', 'Caso de 10/09 bate: planejamento fechado');

select is(
  (select count(*)::int from public.production_plan_items
   where plan_id in ('fdf0f77f-a8c4-4600-bf3d-9d4d0c63de0f', '548fa119-81f4-4106-8a81-62e78e688fa5')),
  8,
  'Fechar nao apaga nenhum item dos planejamentos'
);

select lives_ok(
  $$ select pg_temp.aplicar_migration() $$,
  'Reaplicar a correcao e inofensivo'
);

select * from finish();
rollback;
