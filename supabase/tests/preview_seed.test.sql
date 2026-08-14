-- Dados ficticios que tornam ambientes descartaveis imediatamente testaveis.
-- Este arquivo roda somente nos bancos de CI/Preview, depois de seed.sql.

begin;
create extension if not exists pgtap with schema extensions;

select plan(30);

select is(
  (select count(*)::int from public.destinations where code in ('jc', 'ja', 'ex')),
  3,
  'seed cria as tres lojas operacionais'
);

select is(
  (select count(*)::int from public.products
    where id::text like '10000000-0000-4000-8000-0000000000%'
      and name like '[TESTE]%'),
  22,
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
  (select count(*)::int from public.products
    where id::text like '10000000-0000-4000-8000-0000000000%'
      and category = 'Pizza Romana'
      and unit = 'kg'),
  6,
  'seed cadastra Pizza Romana por kg'
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
      '30000000-0000-4000-8000-000000000003',
      '30000000-0000-4000-8000-000000000005'
    ) and order_date = (now() at time zone 'America/Sao_Paulo')::date),
  4,
  'seed cria pedidos do dia para testar JA, EX e composicao no JC'
);

select is(
  (select count(*)::int from public.orders
    where id in (
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000003',
      '30000000-0000-4000-8000-000000000005'
    ) and coalesce(walkin_name, '') <> ''),
  0,
  'seed nao inclui nome ou telefone de cliente real'
);

select is(
  (select count(*)::int
   from public.romaneios romaneio
   join public.destinations destination on destination.id = romaneio.destination_id
   where romaneio.id = '40000000-0000-4000-8000-000000000004'
     and romaneio.record_date = (now() at time zone 'America/Sao_Paulo')::date
     and romaneio.trip_number = 4
     and romaneio.status = 'separado'
     and destination.code = 'ex'),
  1,
  'seed cria viagem EX separada para validar a entregadora'
);

select is(
  (select count(*)::int
   from public.romaneios romaneio
   join public.destinations destination on destination.id = romaneio.destination_id
   where romaneio.id = '40000000-0000-4000-8000-000000000005'
     and romaneio.record_date = (now() at time zone 'America/Sao_Paulo')::date
     and romaneio.trip_number = 5
     and romaneio.status = 'enviado'
     and romaneio.sent_by = 'Expedicao JC Teste'
     and romaneio.sent_at is not null
     and destination.code = 'ex'),
  1,
  'seed cria viagem EX enviada para validar conferencia pendente'
);

select is(
  (select count(*)::int
   from public.romaneio_items item
   where item.romaneio_id = '40000000-0000-4000-8000-000000000005'
     and item.product_id = 'teste-baguete'
     and item.qty_sent = 8
     and item.qty_received is null
     and item.qty_accepted is null
     and item.item_status = 'pendente'),
  1,
  'viagem EX pendente de conferencia tem item ficticio para abrir a tela'
);

select is(
  (
    select pending.pending_quantity
    from public.romaneio_replacement_pending pending
    where pending.id = '42000000-0000-4000-8000-000000000002'
      and pending.destination_id = '20000000-0000-4000-8000-000000000003'
      and pending.product_id = 'teste-baguete'
      and pending.status = 'aberta'
  ),
  2::numeric,
  'seed cria reposicao pendente ficticia da EX'
);

select is(
  (select count(*)::int
   from public.romaneio_replacement_pending pending
   join public.romaneio_items item on item.id = pending.source_item_id
   where pending.id = '42000000-0000-4000-8000-000000000002'
     and item.qty_sent = 10
     and item.qty_accepted = 8),
  1,
  'pendencia ficticia representa enviado menos aceito'
);

select is(
  (select quantity from public.frozen_stock stock
   join public.frozen_products product on product.id = stock.frozen_product_id
   where product.product_id = 'teste-ciabatta' and product.store = 'jc'),
  8,
  'seed prepara oito ciabattas congeladas para a composicao do dia'
);

select is(
  (select pending_quantity from public.sobras
   where product_id = 'teste-ciabatta'
     and store = 'jc'
     and record_date = (now() at time zone 'America/Sao_Paulo')::date - 1),
  2::numeric,
  'seed prepara duas ciabattas de sobra para a composicao do dia'
);

select is(
  (select item.planned_quantity
   from public.production_plan_items item
   join public.production_plans plan on plan.id = item.plan_id
   where plan.production_date = (now() at time zone 'America/Sao_Paulo')::date
     and item.store = 'jc'
     and item.bread_id = 'teste-ciabatta'),
  10,
  'seed cria producao do dia com ciabatta composta'
);

select is(
  (select item.frozen_quantity + item.leftover_confirmed_quantity
   from public.production_plan_items item
   join public.production_plans plan on plan.id = item.plan_id
   where plan.production_date = (now() at time zone 'America/Sao_Paulo')::date
     and item.store = 'jc'
     and item.bread_id = 'teste-ciabatta'
     and item.order_created_at is null),
  10,
  'composicao do dia fecha oito congelados mais duas sobras sem pedido novo'
);

select is(
  (select count(*)::int from public.price_tier_items
    where tier_id = '50000000-0000-4000-8000-000000000001' and active),
  3,
  'seed cria a tabela de preco ficticia de PJ com tres itens'
);

select is(
  (select count(*)::int from public.customers
    where id::text like '60000000-0000-4000-8000-0000000000%'
      and active
      and default_tier_id = '50000000-0000-4000-8000-000000000001'),
  3,
  'seed cria clientes PJ ficticios ja ligados a uma tabela de preco'
);

select is(
  (select count(*)::int from public.customers
    where id::text like '60000000-0000-4000-8000-0000000000%'
      and payment_term_days is not null),
  3,
  'seed cria clientes com prazo de pagamento combinado'
);

-- Cenario obrigatorio do contas a receber: cliente sem prazo nao pode gerar
-- cobranca, entao precisa existir um no Preview para a tela ser testavel.
select is(
  (select count(*)::int from public.customers
    where id::text like '60000000-0000-4000-8000-0000000000%'
      and payment_term_days is null),
  1,
  'seed cria um cliente sem prazo definido'
);

select is(
  (select count(*)::int from public.customers
    where id::text like '60000000-0000-4000-8000-0000000000%'
      -- A Buck e a unica excecao ao prefixo: a conta do romaneio encontra o
      -- cliente pelo nome exato, entao o cenario precisa reproduzi-lo. Ela
      -- entra sem documento e sem contato.
      and name <> 'Buck'
      and (name not like '[TESTE]%' or contact not like '%@exemplo.invalid')),
  0,
  'seed nao inclui nome ou contato de cliente real'
);

select is(
  (select count(*)::int from public.orders
    where id::text like '30000000-0000-4000-8000-0000000001%'
      and order_type = 'pj'
      and store = 'pj'),
  5,
  'seed cria pedidos PJ em aberto, por quilo, enviado, cancelado e sem prazo'
);

-- Trava do valor: a linha do pedido ja guarda a quantidade final vendida, entao
-- o total e sempre unit_price x quantity. Multiplicar por pack_size de novo
-- inflaria a soma para R$ 10.278,90. Ver lessons.md 2026-07-21
-- (validar-tambem-na-saida) e src/lib/pjSalesReport.ts.
select is(
  (select round(sum(unit_price * quantity), 2) from public.orders
    where id::text like '30000000-0000-4000-8000-0000000001%'
      and order_type = 'pj'
      and cancelled_at is null),
  971.70::numeric,
  'pedidos PJ ficticios nao cancelados somam R$ 971,70'
);

select is(
  (select count(*)::int from public.orders
    where id::text like '30000000-0000-4000-8000-0000000001%'
      and (
        (dispatched_at is not null and dispatched_by_name = '[TESTE] Expedicao JC')
        or (cancelled_at is not null and nullif(trim(coalesce(cancel_reason, '')), '') is not null)
      )),
  2,
  'cenario PJ cobre um pedido enviado e um cancelado'
);

select is(
  (select count(*)::int from public.payable_purchases
   where id = '80000000-0000-4000-8000-000000000001'
     and origin = 'xml'
     and nfe_number = '999001'
     and total_value = 89.90),
  case when exists (
    select 1 from auth.users user_account
    where lower(user_account.email) = 'rodrigao+teste-financeiro-jc@gmail.com'
  ) then 1 else 0 end,
  'seed cria a NF-e fictícia depois que o Auth de teste está pronto'
);

select is(
  (select count(*)::int from public.payable_purchase_items
   where purchase_id = '80000000-0000-4000-8000-000000000001'
     and source_description like '[TESTE]%'),
  case when exists (
    select 1 from auth.users user_account
    where lower(user_account.email) = 'rodrigao+teste-financeiro-jc@gmail.com'
  ) then 2 else 0 end,
  'NF-e fictícia tem os dois itens depois que o Auth de teste está pronto'
);

-- Cenario da Buck (EX): sem ele a fase 4 nao tem o que cobrar no Preview.
select is(
  (select count(*)::int from public.romaneios romaneio
     join public.destinations destino on destino.id = romaneio.destination_id
    where upper(destino.code) = 'EX'
      and romaneio.id::text like '72000000-%'),
  2,
  'seed cria dois romaneios da EX para a conta da Buck'
);

select is(
  (select round(sum(item.qty_sent * preco.unit_price), 2)
     from public.romaneio_items item
     join public.price_tier_items preco
       on preco.product_id = item.product_id
      and preco.product_source = item.product_source
      and preco.tier_id = '50000000-0000-4000-8000-000000000002'
    where item.id::text like '73000000-%'),
  325.00::numeric,
  'os itens semeados batem com a tabela BUCK pelo enviado'
);

select is(
  (select payment_term_days from public.customers where lower(trim(name)) = 'buck'),
  15,
  'a Buck tem prazo cadastrado, sem o qual nao ha cobranca'
);

-- Sem estas duas a tela de Relatorios > Romaneios abre vazia para o
-- financeiro: a RLS de destinations e romaneios exige permissao de romaneio
-- com escopo da loja.
select ok(
  exists(
    select 1 from public.app_user_permissions assignment
    join auth.users conta on conta.id = assignment.user_id
    where lower(conta.email) = 'rodrigao+teste-financeiro-jc@gmail.com'
      and assignment.permission_key = 'romaneio.visualizar'
      and assignment.scope = '*'
  ),
  'financeiro ficticio enxerga romaneios, como a Elis em producao'
);

select * from finish();
rollback;
