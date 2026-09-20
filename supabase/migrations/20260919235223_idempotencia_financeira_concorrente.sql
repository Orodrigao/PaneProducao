-- Uma repeticao normal ja retornava o resultado anterior. Esta trava fecha a
-- janela entre a consulta e a escrita quando duas conexoes usam o mesmo
-- request_id ao mesmo tempo. Por ser transacional, ela some no commit/rollback.
create or replace function private.lock_financial_request(p_request_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_request_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'paneerp:financial-request:' || p_request_id::text,
        0
      )
    );
  end if;
end;
$$;

revoke all on function private.lock_financial_request(uuid)
from public, anon, authenticated, service_role;

-- As funcoes abaixo tem assinaturas e corpos extensos, alem de evoluirem em
-- migrations diferentes. Recria-las a partir da definicao efetiva evita
-- ressuscitar uma versao antiga: a unica mudanca e adquirir a trava comum no
-- inicio da transacao, antes de qualquer trava especifica do fluxo.
-- cancel_receivable e reverse_receivable_receipt nao entram nesta lista:
-- ambas serializam a propria cobranca/baixa com FOR UPDATE e decidem a
-- repeticao pelo estado da linha. create_receivable_from_pj_order serializa o
-- pedido e devolve a cobranca unica dele, sem consulta por request_id.
do $migration$
declare
  v_expected_names constant text[] := array[
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
  ];
  -- Universo fechado das RPCs publicas PL/pgSQL que recebem p_request_id.
  -- As 16 financeiras acima recebem a trava comum. As demais usam identidade,
  -- versao ou trava de linha do proprio fluxo e ficam classificadas aqui para
  -- que uma RPC nova nao escape silenciosamente desta revisao.
  v_classified_names constant text[] := array[
    'cancel_pj_order_atomic',
    'cancel_receivable',
    'change_pj_flow_terms',
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
    'create_pj_order_atomic',
    'create_receivable_from_pj_order',
    'create_receivable_from_romaneio',
    'create_xml_payable',
    'enroll_pj_flow',
    'record_receivable_receipt',
    'replace_pj_order_atomic',
    'replace_pj_order_atomic_v2',
    'resolve_pj_flow_excess',
    'reverse_finance_entry',
    'reverse_finance_transfer',
    'reverse_receivable_receipt',
    'rollback_pj_flow_enrollment',
    'save_pj_order_dispatch_quantities',
    'schedule_pj_production',
    'split_receivable',
    'transition_pj_flow_pilot'
  ];
  v_found_names text[];
  v_all_found_names text[];
  v_function record;
  v_definition text;
  v_patched_definition text;
begin
  select array_agg(proc.proname order by proc.proname)
    into v_all_found_names
  from pg_catalog.pg_proc proc
  join pg_catalog.pg_namespace namespace on namespace.oid = proc.pronamespace
  join pg_catalog.pg_language language on language.oid = proc.prolang
  where namespace.nspname = 'public'
    and 'p_request_id' = any(proc.proargnames)
    and language.lanname = 'plpgsql'
    and proc.prosecdef;

  if v_all_found_names is distinct from v_classified_names then
    raise exception using
      errcode = 'P0001',
      message = 'O universo de RPCs com request_id mudou; classifique a nova rotina antes de continuar.';
  end if;

  select array_agg(proc.proname order by proc.proname)
    into v_found_names
  from pg_catalog.pg_proc proc
  join pg_catalog.pg_namespace namespace on namespace.oid = proc.pronamespace
  join pg_catalog.pg_language language on language.oid = proc.prolang
  where namespace.nspname = 'public'
    and proc.proname = any(v_expected_names)
    and 'p_request_id' = any(proc.proargnames)
    and language.lanname = 'plpgsql'
    and proc.prosecdef;

  if v_found_names is distinct from v_expected_names then
    raise exception using
      errcode = 'P0001',
      message = 'A lista de RPCs financeiras mudou; revise a serializacao por request_id.';
  end if;

  for v_function in
    select proc.oid, proc.proname
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace namespace on namespace.oid = proc.pronamespace
    join pg_catalog.pg_language language on language.oid = proc.prolang
    where namespace.nspname = 'public'
      and proc.proname = any(v_expected_names)
      and 'p_request_id' = any(proc.proargnames)
      and language.lanname = 'plpgsql'
      and proc.prosecdef
    order by proc.proname
  loop
    v_definition := pg_catalog.pg_get_functiondef(v_function.oid);

    if v_definition like '%private.lock_financial_request(p_request_id)%' then
      raise exception using
        errcode = 'P0001',
        message = format('A RPC %s ja contem a trava financeira.', v_function.proname);
    end if;

    v_patched_definition := pg_catalog.regexp_replace(
      v_definition,
      E'\nbegin\n',
      E'\nbegin\n  perform private.lock_financial_request(p_request_id);\n',
      'i'
    );

    if v_patched_definition = v_definition then
      raise exception using
        errcode = 'P0001',
        message = format('Nao foi possivel localizar o inicio da RPC %s.', v_function.proname);
    end if;

    execute v_patched_definition;
  end loop;
end;
$migration$;
