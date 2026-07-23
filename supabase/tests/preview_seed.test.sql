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
    where id in (
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003'
    ) and name like '[TESTE]%'),
  3,
  'seed usa somente nomes de produtos explicitamente ficticios'
);

select is(
  (select count(*)::int from public.products
    where id in (
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003'
    ) and production_area = 'cozinha'),
  3,
  'seed deixa produtos da Cozinha prontos para o primeiro piloto'
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
