-- Classificacao operacional independente da categoria comercial.
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

select ok(exists(select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'products' and column_name = 'production_process'),
  'produto possui processo final de producao');
select ok(exists(select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'products' and column_name = 'allows_planned_production'),
  'produto informa se aceita producao planejada');
select ok(exists(select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'products' and column_name = 'allows_unplanned_production'),
  'produto informa se aceita producao sem ordem');
select ok((select pg_get_constraintdef(oid) ilike all(array['%forno%', '%montagem%', '%preparo%'])
  from pg_constraint where conname = 'products_production_process_valid'),
  'processos operacionais aceitos sao restritos pelo banco');

select lives_ok(
  $$insert into public.products (id, name, is_fabricacao_propria, production_area)
    values ('94000000-0000-4000-8000-000000000001', '[TESTE] Legado não revisado', true, 'padaria')$$,
  'produto legado de fabricacao propria pode continuar nao revisado');
select is((select production_process from public.products
    where id = '94000000-0000-4000-8000-000000000001'),
  null, 'produto legado permanece sem classificacao automatica');

select throws_ok(
  $$insert into public.products (id, name, is_fabricacao_propria, production_area, production_process,
      allows_planned_production, allows_unplanned_production)
    values ('94000000-0000-4000-8000-000000000002', '[TESTE] Processo inválido', true, 'padaria',
      'fritura', true, false)$$,
  '23514', 'new row for relation "products" violates check constraint "products_production_process_valid"',
  'processo fora da lista e recusado pela restricao correta');
select throws_ok(
  $$insert into public.products (id, name, is_fabricacao_propria, production_area, production_process,
      allows_planned_production, allows_unplanned_production)
    values ('94000000-0000-4000-8000-000000000003', '[TESTE] Revenda no forno', false, 'padaria',
      'forno', true, false)$$,
  '23514', 'new row for relation "products" violates check constraint "products_operational_classification_coherent"',
  'produto classificado precisa ser de fabricacao propria');
select throws_ok(
  $$insert into public.products (id, name, is_fabricacao_propria, production_process,
      allows_planned_production, allows_unplanned_production)
    values ('94000000-0000-4000-8000-000000000004', '[TESTE] Sem área', true,
      'montagem', true, false)$$,
  '23514', 'new row for relation "products" violates check constraint "products_operational_classification_coherent"',
  'produto classificado precisa de area responsavel');
select throws_ok(
  $$insert into public.products (id, name, is_fabricacao_propria, production_area, production_process,
      allows_planned_production, allows_unplanned_production)
    values ('94000000-0000-4000-8000-000000000005', '[TESTE] Sem forma de apontar', true, 'cozinha',
      'preparo', false, false)$$,
  '23514', 'new row for relation "products" violates check constraint "products_operational_classification_coherent"',
  'produto revisado precisa aceitar ao menos uma forma de apontamento');
select throws_ok(
  $$insert into public.products (id, name, is_fabricacao_propria, production_area, production_process,
      allows_planned_production, allows_unplanned_production)
    values ('94000000-0000-4000-8000-000000000006', '[TESTE] Forma indefinida', true, 'cozinha',
      'preparo', null, true)$$,
  '23514', 'new row for relation "products" violates check constraint "products_operational_classification_coherent"',
  'produto revisado nao aceita forma de apontamento indefinida');

select lives_ok(
  $$insert into public.products (id, name, is_fabricacao_propria, production_area, production_process,
      allows_planned_production, allows_unplanned_production)
    values ('94000000-0000-4000-8000-000000000007', '[TESTE] Massa no forno', true, 'padaria',
      'forno', true, false)$$,
  'produto de forno aceita planejamento');
select lives_ok(
  $$insert into public.products (id, name, is_fabricacao_propria, production_area, production_process,
      allows_planned_production, allows_unplanned_production)
    values ('94000000-0000-4000-8000-000000000008', '[TESTE] Pastinha avulsa', true, 'cozinha',
      'preparo', false, true)$$,
  'produto da cozinha aceita apontamento sem ordem');

select lives_ok(
  $$update public.products
    set production_process = 'montagem',
        allows_planned_production = true,
        allows_unplanned_production = false
    where id = '94000000-0000-4000-8000-000000000001'$$,
  'produto legado pode ser revisado por atualizacao');
select throws_ok(
  $$update public.products set production_area = null
    where id = '94000000-0000-4000-8000-000000000001'$$,
  '23514', 'new row for relation "products" violates check constraint "products_operational_classification_coherent"',
  'produto revisado nao perde a area responsavel');
select throws_ok(
  $$update public.products set is_fabricacao_propria = false
    where id = '94000000-0000-4000-8000-000000000001'$$,
  '23514', 'new row for relation "products" violates check constraint "products_operational_classification_coherent"',
  'produto deixa de ser fabricacao propria somente se limpar a classificacao');
select lives_ok(
  $$update public.products
    set is_fabricacao_propria = false,
        production_process = null,
        allows_planned_production = null,
        allows_unplanned_production = null
    where id = '94000000-0000-4000-8000-000000000001'$$,
  'produto pode deixar de ser fabricacao propria com limpeza coerente');

select * from finish();
rollback;
