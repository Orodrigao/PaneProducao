begin;
create extension if not exists pgtap with schema extensions;

select plan(19);

select ok(exists(select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'payable_installments' and column_name = 'paid_date'),
  'parcela guarda o dia real do pagamento');
select ok(exists(select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'payable_installments' and column_name = 'paid_amount'),
  'parcela guarda o valor real pago');
select ok(exists(select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'payable_installments' and column_name = 'paid_method'),
  'parcela guarda a forma real de pagamento');
select ok(exists(select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'payable_installments' and column_name = 'current_due_date'),
  'parcela guarda o vencimento atualizado do boleto');

select ok(exists(select 1 from pg_constraint where conname = 'payable_installments_paid_amount_check'),
  'valor pago nao pode ser menor que o original');
select ok(exists(select 1 from pg_constraint where conname = 'payable_installments_paid_method_check'),
  'forma real de pagamento tem valores validos');
select ok(exists(select 1 from pg_trigger trigger_row
  join pg_class relation on relation.oid = trigger_row.tgrelid
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where trigger_row.tgname = 'payable_installment_payment_defaults'
    and namespace.nspname = 'public' and relation.relname = 'payable_installments'),
  'baixas antigas continuam compativeis com o modelo novo');

select ok(has_function_privilege('authenticated', 'public.record_payable_installment_payment(uuid, date, numeric, text, date)', 'execute'),
  'financeiro pode registrar baixa com dados reais');
select ok(not has_function_privilege('anon', 'public.record_payable_installment_payment(uuid, date, numeric, text, date)', 'execute'),
  'anon nao registra baixa com dados reais');
select ok(has_function_privilege('authenticated', 'public.correct_payable_installment_payment(uuid, date, numeric, text, date)', 'execute'),
  'financeiro pode corrigir baixa');
select ok(not has_function_privilege('anon', 'public.correct_payable_installment_payment(uuid, date, numeric, text, date)', 'execute'),
  'anon nao corrige baixa');

select ok((select prosrc from pg_proc routine
  join pg_namespace namespace on namespace.oid = routine.pronamespace
  where namespace.nspname = 'public' and routine.proname = 'record_payable_installment_payment')
  ilike all(array['%current_user_can_payables%', '%paid_date%', '%paid_amount%', '%paid_method%', '%current_due_date%']),
  'registro valida permissao e grava os dados reais da baixa');
select ok((select prosrc from pg_proc routine
  join pg_namespace namespace on namespace.oid = routine.pronamespace
  where namespace.nspname = 'public' and routine.proname = 'record_payable_installment_payment')
  ilike all(array['%menor%', '%current_due_date%', '%payable_events%']),
  'registro valida valor, vencimento atualizado e auditoria');
select ok((select prosrc from pg_proc routine
  join pg_namespace namespace on namespace.oid = routine.pronamespace
  where namespace.nspname = 'public' and routine.proname = 'correct_payable_installment_payment')
  ilike all(array['%current_user_can_payables%', '%old_paid_date%', '%old_paid_amount%', '%old_paid_method%']),
  'correcao preserva os valores anteriores no historico');
select ok((select prosrc from pg_proc routine
  join pg_namespace namespace on namespace.oid = routine.pronamespace
  where namespace.nspname = 'public' and routine.proname = 'correct_payable_installment_payment')
  ilike all(array['%Somente uma parcela paga%', '%payable_events%', '%corrigida%']),
  'correcao exige parcela paga e registra evento');
select ok((select prosrc from pg_proc routine
  join pg_namespace namespace on namespace.oid = routine.pronamespace
  where namespace.nspname = 'private' and routine.proname = 'fill_payable_installment_payment_defaults')
  ilike all(array['%paid_date%', '%paid_amount%', '%paid_method%', '%payable_purchases%']),
  'compatibilidade preenche defaults conservadores');

select ok(not has_table_privilege('authenticated', 'public.payable_installments', 'update'),
  'authenticated nao atualiza parcela diretamente');
select ok(not has_function_privilege('anon', 'public.correct_payable_installment_payment(uuid, date, numeric, text, date)', 'execute'),
  'anon nao altera historico de baixa');
select ok((select relrowsecurity and relforcerowsecurity from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public' and relation.relname = 'payable_installments'),
  'parcelas continuam com RLS forcada');

select * from finish();
rollback;
