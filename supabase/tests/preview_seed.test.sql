-- Dados ficticios que tornam ambientes descartaveis imediatamente testaveis.
-- Este arquivo roda somente nos bancos de CI/Preview, depois de seed.sql.

begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

select is(
  (select count(*)::int from public.destinations where code in ('jc', 'ja', 'ex')),
  3,
  'seed cria as tres lojas operacionais'
);

select is(
  (select count(*)::int from public.products
    where id::text like '10000000-0000-4000-8000-0000000000%'
      and name like '[TESTE]%'),
  20,
  'seed cria o catalogo ficticio completo da Cozinha'
);

select is(
  (select count(*)::int from public.products
    where id::text like '10000000-0000-4000-8000-0000000000%'
      and active
      and production_area = 'cozinha'),
  20,
  'seed deixa todo o catalogo ficticio ativo na Cozinha'
);

select is(
  (select count(*)::int from public.breads
    where id in ('teste-baguete', 'teste-ciabatta') and name like '[TESTE]%'),
  2,
  'seed cria paes ficticios para o Romaneio'
);

select is(
  (select count(*)::int from public.orders
    where id in (
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000003'
    ) and order_date = current_date),
  3,
  'seed cria pedidos do dia para testar JA e EX'
);

select is(
  (select count(*)::int from public.orders
    where id in (
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000003'
    ) and coalesce(walkin_name, '') <> ''),
  0,
  'seed nao inclui nome ou telefone de cliente real'
);

select * from finish();
rollback;
