-- Fase 1 do contas a receber: prazo de pagamento no cliente e CNPJ unico.
-- Roda depois da migration 20260810185250_prazo_pagamento_cliente.sql.

begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

select ok(
  exists(
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customers'
      and column_name = 'payment_term_days'
  ),
  'o cliente passou a ter prazo de pagamento'
);

-- O prazo nasce vazio: preencher os clientes existentes com um padrao
-- inventado produziria vencimento errado em cobranca real.
select is(
  (select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'customers'
     and column_name = 'payment_term_days'),
  null,
  'prazo de pagamento nao tem padrao inventado'
);

select is(
  (select is_nullable from information_schema.columns
   where table_schema = 'public' and table_name = 'customers'
     and column_name = 'payment_term_days'),
  'YES',
  'prazo pode ficar vazio enquanto nao for combinado'
);

select ok(
  exists(
    select 1 from pg_constraint
    where conname = 'customers_payment_term_days_check'
      and conrelid = 'public.customers'::regclass
  ),
  'o prazo tem limite validado no banco'
);

select ok(
  exists(
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'customers_doc_numerico_ativo_unico'
  ),
  'existe indice unico de CNPJ entre clientes ativos'
);

-- Comportamento, nao so estrutura: o banco precisa recusar de verdade.
insert into public.customers (id, name, doc, active, payment_term_days)
values ('99000000-0000-4000-8000-000000000001', '[TESTE] Unicidade A', '11.222.333/0001-81', true, 28);

select throws_ok(
  $$insert into public.customers (id, name, doc, active)
    values ('99000000-0000-4000-8000-000000000002', '[TESTE] Unicidade B', '11222333000181', true)$$,
  '23505',
  null,
  'o mesmo CNPJ sem pontuacao e recusado entre clientes ativos'
);

select lives_ok(
  $$insert into public.customers (id, name, doc, active)
    values ('99000000-0000-4000-8000-000000000003', '[TESTE] Unicidade C', '11222333000181', false)$$,
  'cadastro inativo pode repetir o CNPJ, para preservar historico'
);

select lives_ok(
  $$insert into public.customers (id, name, doc, active)
    values ('99000000-0000-4000-8000-000000000004', '[TESTE] Sem documento', null, true)$$,
  'cliente sem CNPJ continua permitido'
);

select throws_ok(
  $$update public.customers set payment_term_days = 181
    where id = '99000000-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'prazo acima do limite e recusado'
);

select lives_ok(
  $$update public.customers set payment_term_days = 0
    where id = '99000000-0000-4000-8000-000000000001'$$,
  'prazo zero e aceito e significa a vista'
);

select * from finish();
rollback;
