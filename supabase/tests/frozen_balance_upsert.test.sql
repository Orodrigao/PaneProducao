-- O saldo congelado permanece protegido quando o seed reaplica uma linha.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into public.breads (id, name, days, active, unit, is_special, is_shelf)
values ('teste-upsert-congelado', '[TESTE] Upsert Congelado', '{0,1,2,3,4,5,6}', true, 'un', false, false);

insert into public.frozen_products (
  id, product_id, product_source, product_name, unit, active, store, visible_stores
) values (
  '97100000-0000-4000-8000-000000000001', 'teste-upsert-congelado', 'bread',
  '[TESTE] Upsert Congelado', 'un', true, 'jc', array['jc']::text[]
);

insert into public.frozen_stock (id, frozen_product_id, location, quantity)
values ('97100000-0000-4000-8000-000000000002',
  '97100000-0000-4000-8000-000000000001', 'jc-freezer-upsert', 8);

insert into public.production_plans (
  id, production_date, status, created_by, created_by_name
) values (
  '97100000-0000-4000-8000-000000000003', private.data_na_padaria() + 120,
  'rascunho', '97100000-0000-4000-8000-000000000004', 'Teste Upsert'
);

select lives_ok($$
  insert into public.production_plan_items (
    id, plan_id, store, bread_id, planned_quantity, frozen_quantity,
    leftover_proposed_quantity
  ) values (
    '97100000-0000-4000-8000-000000000005',
    '97100000-0000-4000-8000-000000000003',
    'jc', 'teste-upsert-congelado', 8, 8, 0
  )
$$, 'primeira reserva usa todo o saldo disponivel');

select lives_ok($$
  insert into public.production_plan_items (
    id, plan_id, store, bread_id, planned_quantity, frozen_quantity,
    leftover_proposed_quantity
  ) values (
    '97100000-0000-4000-8000-000000000005',
    '97100000-0000-4000-8000-000000000003',
    'jc', 'teste-upsert-congelado', 8, 8, 0
  )
  on conflict (plan_id, store, bread_id) do update set
    planned_quantity = excluded.planned_quantity,
    frozen_quantity = excluded.frozen_quantity
$$, 'reaplicar a mesma linha nao conta sua reserva duas vezes');

select throws_ok($$
  insert into public.production_plan_items (
    id, plan_id, store, bread_id, planned_quantity, frozen_quantity,
    leftover_proposed_quantity
  ) values (
    '97100000-0000-4000-8000-000000000005',
    '97100000-0000-4000-8000-000000000003',
    'jc', 'teste-upsert-congelado', 9, 9, 0
  )
  on conflict (plan_id, store, bread_id) do update set
    planned_quantity = excluded.planned_quantity,
    frozen_quantity = excluded.frozen_quantity
$$, '22023', 'O congelado disponivel ja esta reservado por outro planejamento.',
  'reaplicacao continua sem poder ultrapassar o estoque');

select is((select count(*)::int from public.production_plan_items
  where plan_id = '97100000-0000-4000-8000-000000000003'), 1,
  'a reaplicacao preserva uma unica linha');

select * from finish();
rollback;
