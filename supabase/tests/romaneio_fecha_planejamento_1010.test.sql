-- A correcao pontual de 13/10/2026 fecha somente o Planejamento de 10/10/2026
-- quando tudo bate: rascunho, JC inteira convertida em pedido, JA com 67 paes
-- sem pedido e nenhum pedido da JA no dia. A funcao temporaria abaixo e copia
-- do UPDATE da migration 20261013141847 (o teste de banco nao consegue
-- reexecutar arquivo de migration).

begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

create function pg_temp.aplicar_migration() returns void
language plpgsql
as $migration$
begin
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
end;
$migration$;

create function pg_temp.status_1010() returns text
language sql
as $$
  select status from public.production_plans
  where id = '73078a7f-76d4-4411-88cf-f9fa7a5acb2a'
$$;

-- Um planejamento por data: abre espaco caso o banco de teste tenha um em 10/10.
delete from public.production_plans
where production_date = date '2026-10-10'
  and id <> '73078a7f-76d4-4411-88cf-f9fa7a5acb2a';

insert into public.breads (id, name, days, active, unit, is_special, is_shelf)
values
  ('teste-fecha-1010-a', '[TESTE] Pao Fechamento 1010 A', '{0,1,2,3,4,5,6}', true, 'un', false, false),
  ('teste-fecha-1010-b', '[TESTE] Pao Fechamento 1010 B', '{0,1,2,3,4,5,6}', true, 'un', false, false);

insert into public.production_plans (id, production_date, status, created_by, created_by_name)
values (
  '73078a7f-76d4-4411-88cf-f9fa7a5acb2a',
  date '2026-10-10',
  'rascunho',
  '00000000-0000-4000-8000-000000000000',
  '[TESTE] Rodrigo'
);

-- Copia do caso real: JC convertida, JA com 67 paes so no Planejamento; o pao
-- B da JC esta zerado e sem pedido, como os itens sem quantidade de producao.
insert into public.production_plan_items (
  id, plan_id, store, bread_id, planned_quantity, frozen_quantity,
  leftover_proposed_quantity, order_created_at, order_created_by_name
)
values
  ('74000000-0000-4000-8000-000000000001', '73078a7f-76d4-4411-88cf-f9fa7a5acb2a', 'jc', 'teste-fecha-1010-a', 30, 0, 0, now(), '[TESTE] Rodrigo'),
  ('74000000-0000-4000-8000-000000000002', '73078a7f-76d4-4411-88cf-f9fa7a5acb2a', 'jc', 'teste-fecha-1010-b', 0, 0, 0, null, null),
  ('74000000-0000-4000-8000-000000000003', '73078a7f-76d4-4411-88cf-f9fa7a5acb2a', 'ja', 'teste-fecha-1010-a', 60, 0, 0, null, null),
  ('74000000-0000-4000-8000-000000000004', '73078a7f-76d4-4411-88cf-f9fa7a5acb2a', 'ja', 'teste-fecha-1010-b', 7, 0, 0, null, null);

-- Recusa 1: a JA tem pedido no dia.
insert into public.orders (
  id, store, bread_id, quantity, order_date, obs,
  order_type, product_source, product_name, needs_production
)
values (
  '75000000-0000-4000-8000-000000000001', 'ja', 'teste-fecha-1010-a', 5, date '2026-10-10',
  '[TESTE] pedido da JA em 10/10', 'producao', 'bread', '[TESTE] Pao Fechamento 1010 A', true
);
select pg_temp.aplicar_migration();
select is(pg_temp.status_1010(), 'rascunho', 'JA com pedido no dia: planejamento continua aberto');
delete from public.orders where id = '75000000-0000-4000-8000-000000000001';

-- Recusa 2: a JC tem pao com quantidade que nao virou pedido.
update public.production_plan_items
set order_created_at = null, order_created_by_name = null
where id = '74000000-0000-4000-8000-000000000001';
select pg_temp.aplicar_migration();
select is(pg_temp.status_1010(), 'rascunho', 'JC sem pedido gerado: planejamento continua aberto');
update public.production_plan_items
set order_created_at = now(), order_created_by_name = '[TESTE] Rodrigo'
where id = '74000000-0000-4000-8000-000000000001';

-- Recusa 3: o total da JA nao e o do caso real.
update public.production_plan_items set planned_quantity = 8
where id = '74000000-0000-4000-8000-000000000004';
select pg_temp.aplicar_migration();
select is(pg_temp.status_1010(), 'rascunho', 'JA com total diferente de 67: planejamento continua aberto');
update public.production_plan_items set planned_quantity = 7
where id = '74000000-0000-4000-8000-000000000004';

-- Recusa 4: a JA ja virou pedido em parte.
update public.production_plan_items
set order_created_at = now(), order_created_by_name = '[TESTE] Rodrigo'
where id = '74000000-0000-4000-8000-000000000004';
select pg_temp.aplicar_migration();
select is(pg_temp.status_1010(), 'rascunho', 'JA com pedido gerado: planejamento continua aberto');
update public.production_plan_items
set order_created_at = null, order_created_by_name = null
where id = '74000000-0000-4000-8000-000000000004';

-- Pedido cancelado da JA nao conta como pedido.
insert into public.orders (
  id, store, bread_id, quantity, order_date, obs,
  order_type, product_source, product_name, needs_production, cancelled_at
)
values (
  '75000000-0000-4000-8000-000000000002', 'ja', 'teste-fecha-1010-a', 5, date '2026-10-10',
  '[TESTE] pedido cancelado da JA em 10/10', 'producao', 'bread', '[TESTE] Pao Fechamento 1010 A', true, now()
);

-- Caso real: fecha.
select pg_temp.aplicar_migration();
select is(pg_temp.status_1010(), 'fechado', 'Caso de 10/10 bate: planejamento fechado');

select is(
  (select count(*)::int from public.production_plan_items where plan_id = '73078a7f-76d4-4411-88cf-f9fa7a5acb2a'),
  4,
  'Fechar nao apaga nenhum item do planejamento'
);
select is(
  (select sum(planned_quantity)::int from public.production_plan_items
   where plan_id = '73078a7f-76d4-4411-88cf-f9fa7a5acb2a' and store = 'ja' and order_created_at is null),
  67,
  'Os 67 paes da JA ficam registrados como planejados e sem pedido'
);

-- Reaplicar nao faz nada nem quebra.
select lives_ok(
  $$ select pg_temp.aplicar_migration() $$,
  'Reaplicar a correcao e inofensivo'
);

select * from finish();
rollback;
