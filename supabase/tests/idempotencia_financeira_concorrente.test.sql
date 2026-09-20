begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select ok(
  to_regprocedure('private.lock_financial_request(uuid)') is not null,
  'a serializacao financeira existe no schema privado'
);

select ok(
  pg_get_functiondef('private.lock_financial_request(uuid)'::regprocedure)
    like '%pg_advisory_xact_lock%',
  'a trava dura somente ate o fim da transacao'
);

select ok(
  pg_get_functiondef('private.lock_financial_request(uuid)'::regprocedure)
    like '%paneerp:financial-request:%',
  'a chave de serializacao usa um namespace financeiro estavel'
);

select ok(
  not has_function_privilege(
    'anon', 'private.lock_financial_request(uuid)', 'execute'
  ),
  'visitante nao chama a trava interna diretamente'
);

select ok(
  not has_function_privilege(
    'authenticated', 'private.lock_financial_request(uuid)', 'execute'
  ),
  'usuario autenticado nao chama a trava interna diretamente'
);

select ok(
  not has_function_privilege(
    'service_role', 'private.lock_financial_request(uuid)', 'execute'
  ),
  'service role nao chama a trava interna diretamente'
);

with expected(name) as (
  select unnest(array[
    'confirm_finance_recurring_rule',
    'confirm_xml_import_draft',
    'correct_receivable_due_date',
    'corrigir_quantidade_enviada_pj',
    'create_and_pay_manual_payable',
    'create_buck_weekly_receivable',
    'create_finance_entry',
    'create_finance_transfer',
    'create_manual_payable',
    'create_manual_receivable',
    'create_receivable_from_romaneio',
    'create_xml_payable',
    'record_receivable_receipt',
    'reverse_finance_entry',
    'reverse_finance_transfer',
    'split_receivable'
  ]::text[])
), protected as (
  select proc.proname,
    pg_get_functiondef(proc.oid) definition
  from pg_proc proc
  join pg_namespace namespace on namespace.oid = proc.pronamespace
  join expected on expected.name = proc.proname
  where namespace.nspname = 'public'
    and 'p_request_id' = any(proc.proargnames)
)
select is(
  (
    select count(*)::integer
    from protected
    where definition like '%private.lock_financial_request(p_request_id)%'
      and strpos(definition, 'private.lock_financial_request(p_request_id)')
        - strpos(lower(definition), E'\nbegin\n') < 100
      and (
        strpos(definition, 'pg_advisory_xact_lock') = 0
        or strpos(definition, 'private.lock_financial_request(p_request_id)')
          < strpos(definition, 'pg_advisory_xact_lock')
      )
  ),
  16,
  'as 16 RPCs mapeadas travam o request antes das regras especificas'
);

select * from finish();
rollback;
