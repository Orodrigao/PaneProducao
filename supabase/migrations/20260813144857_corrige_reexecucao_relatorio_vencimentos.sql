-- Avoid a new reservation after today's report has been delivered.
-- The Edge Function handles empty bodies from void RPCs separately.

begin;

create or replace function public.claim_payable_due_report_for_delivery(
  p_secret text,
  p_now timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_brazil_now timestamp without time zone := v_now at time zone 'America/Sao_Paulo';
  v_today date := (v_now at time zone 'America/Sao_Paulo')::date;
  v_recipient text;
  v_recipient_count integer;
  v_snapshot jsonb;
  v_run private.payable_due_report_runs%rowtype;
  v_attempt_token uuid;
begin
  if not private.valid_payable_due_report_cron_secret(p_secret) then
    raise exception using errcode = '42501', message = 'Unauthorized daily report call.';
  end if;

  select count(*)::integer, min(user_account.email)
    into v_recipient_count, v_recipient
  from public.app_profiles profile
  join auth.users user_account on user_account.id = profile.user_id
  where profile.active
    and profile.display_name = U&'Su\00E9len';

  if v_recipient_count <> 1 or v_recipient is null then
    raise exception using errcode = 'P0001', message = 'Daily report recipient is not uniquely configured.';
  end if;

  select run.* into v_run
  from private.payable_due_report_runs run
  where run.sent_at is null
    and (run.last_attempt_at is null or run.last_attempt_at <= now() - interval '14 minutes')
  order by run.report_date desc
  for update skip locked
  limit 1;

  if v_run.id is null and exists (
    select 1
    from private.payable_due_report_runs run
    where run.report_date = v_today
      and run.sent_at is not null
  ) then
    return jsonb_build_object('state', 'ja_enviado');
  end if;

  if v_run.id is null and v_brazil_now::time >= time '06:00' then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'purchase_id', purchase.id,
          'installment_id', installment.id,
          'supplier_name', coalesce(supplier.name, U&'Fornecedor n\00E3o identificado'),
          'document_label', case
            when purchase.origin = 'xml' then 'NF-e ' || coalesce(purchase.nfe_number, U&'sem n\00FAmero')
            when purchase.document_type = 'recibo' then 'Recibo'
            else 'Sem nota'
          end,
          'installment_number', installment.installment_number,
          'due_date', coalesce(installment.current_due_date, installment.due_date),
          'amount', installment.amount
        )
        order by coalesce(installment.current_due_date, installment.due_date), supplier.name, installment.installment_number
      ),
      '[]'::jsonb
    ) into v_snapshot
    from public.payable_installments installment
    join public.payable_purchases purchase on purchase.id = installment.purchase_id
    left join public.suppliers supplier on supplier.id = purchase.supplier_id
    where purchase.store = 'jc'
      and purchase.status = 'aberta'
      and installment.status = 'pendente'
      and coalesce(installment.current_due_date, installment.due_date) between v_today and v_today + 2;

    insert into private.payable_due_report_runs (report_date, snapshot)
    values (v_today, v_snapshot)
    returning * into v_run;
  end if;

  if v_run.id is null then
    return jsonb_build_object('state', 'aguardando_horario');
  end if;

  v_attempt_token := extensions.gen_random_uuid();
  update private.payable_due_report_runs
  set attempt_token = v_attempt_token,
      last_attempt_at = now(),
      last_error = null,
      updated_at = now()
  where id = v_run.id;

  return jsonb_build_object(
    'state', 'pronto_para_enviar',
    'report_id', v_run.id,
    'report_date', v_run.report_date,
    'attempt_token', v_attempt_token,
    'recipient', v_recipient,
    'items', v_run.snapshot
  );
end;
$$;

commit;
