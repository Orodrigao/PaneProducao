-- Relatório diário de contas da JC próximas do vencimento.
--
-- A rotina roda a cada 15 minutos, mas só cria o relatório do dia depois das
-- 06:00 em São Paulo. Se o Resend recusar temporariamente, a mesma fotografia
-- volta para a fila sem criar outro relatório ou outro idempotency key.

begin;

create extension if not exists pg_net;
create extension if not exists pg_cron;

create table if not exists private.payable_due_report_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  report_date date not null unique,
  snapshot jsonb not null default '[]'::jsonb,
  status text not null default 'pendente' check (status in ('pendente', 'enviado')),
  attempt_token uuid,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table private.payable_due_report_runs enable row level security;
alter table private.payable_due_report_runs force row level security;
revoke all on table private.payable_due_report_runs from public, anon, authenticated, service_role;

-- O segredo nasce dentro do cofre do banco; não passa pelo GitHub, pela tela
-- do ERP ou pelo código. O cron o lê apenas no instante de chamar a função.
do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets
    where name = 'payable_due_report_cron_secret'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'payable_due_report_cron_secret',
      'Autoriza exclusivamente o cron do relatório diário de contas a pagar.'
    );
  end if;
end;
$$;

create or replace function private.valid_payable_due_report_cron_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_secret is not null and exists (
    select 1
    from vault.decrypted_secrets secret
    where secret.name = 'payable_due_report_cron_secret'
      and secret.decrypted_secret = p_secret
  );
$$;

revoke all on function private.valid_payable_due_report_cron_secret(text) from public, anon, authenticated, service_role;

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
    raise exception using errcode = '42501', message = 'Chamada do relatório diário não autorizada.';
  end if;

  select count(*)::integer, min(user_account.email)
    into v_recipient_count, v_recipient
  from public.app_profiles profile
  join auth.users user_account on user_account.id = profile.user_id
  where profile.active
    and profile.display_name = 'Suélen';

  if v_recipient_count <> 1 or v_recipient is null then
    raise exception using errcode = 'P0001', message = 'O destinatário Suélen do relatório diário não está configurado de forma única.';
  end if;

  -- Uma execução de cada vez. O intervalo protege tanto o cron quanto uma
  -- eventual repetição da infraestrutura contra mandar o mesmo e-mail duas vezes.
  select run.* into v_run
  from private.payable_due_report_runs run
  where run.sent_at is null
    and (run.last_attempt_at is null or run.last_attempt_at <= now() - interval '14 minutes')
  order by run.report_date desc
  for update skip locked
  limit 1;

  if v_run.id is null and v_brazil_now::time >= time '06:00' then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'purchase_id', purchase.id,
          'installment_id', installment.id,
          'supplier_name', coalesce(supplier.name, 'Fornecedor não identificado'),
          'document_label', case
            when purchase.origin = 'xml' then 'NF-e ' || coalesce(purchase.nfe_number, 'sem número')
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

create or replace function public.mark_payable_due_report_sent(
  p_secret text,
  p_report_id uuid,
  p_attempt_token uuid,
  p_provider_message_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.valid_payable_due_report_cron_secret(p_secret) then
    raise exception using errcode = '42501', message = 'Chamada do relatório diário não autorizada.';
  end if;

  update private.payable_due_report_runs
  set status = 'enviado',
      sent_at = now(),
      provider_message_id = nullif(trim(p_provider_message_id), ''),
      last_error = null,
      updated_at = now()
  where id = p_report_id
    and attempt_token = p_attempt_token
    and sent_at is null;

  if not found then
    raise exception using errcode = 'P0001', message = 'A tentativa do relatório diário não está mais pendente.';
  end if;
end;
$$;

create or replace function public.record_payable_due_report_failure(
  p_secret text,
  p_report_id uuid,
  p_attempt_token uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.valid_payable_due_report_cron_secret(p_secret) then
    raise exception using errcode = '42501', message = 'Chamada do relatório diário não autorizada.';
  end if;

  update private.payable_due_report_runs
  set last_error = left(nullif(trim(p_error), ''), 500),
      updated_at = now()
  where id = p_report_id
    and attempt_token = p_attempt_token
    and sent_at is null;
end;
$$;

create or replace function public.get_payable_due_report_status()
returns table (
  report_date date,
  status text,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_brazil_now timestamp without time zone := now() at time zone 'America/Sao_Paulo';
begin
  if not private.current_user_can_finance('financeiro.acessar') then
    raise exception using errcode = '42501', message = 'Sem permissão para consultar o relatório diário.';
  end if;

  return query
  select v_today,
         coalesce(run.status, case when v_brazil_now::time < time '06:00' then 'programado' else 'aguardando' end),
         run.last_attempt_at,
         run.sent_at,
         run.last_error
  from (select 1) singleton
  left join private.payable_due_report_runs run on run.report_date = v_today;
end;
$$;

revoke all on function public.claim_payable_due_report_for_delivery(text, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_payable_due_report_sent(text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.record_payable_due_report_failure(text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.get_payable_due_report_status() from public, anon;
grant execute on function public.claim_payable_due_report_for_delivery(text, timestamptz) to service_role;
grant execute on function public.mark_payable_due_report_sent(text, uuid, uuid, text) to service_role;
grant execute on function public.record_payable_due_report_failure(text, uuid, uuid, text) to service_role;
grant execute on function public.get_payable_due_report_status() to authenticated, service_role;

select cron.schedule(
  'daily-payable-due-report',
  '*/15 * * * *',
  $command$
    select net.http_post(
      url := 'https://gohluceldchoitihrimw.supabase.co/functions/v1/daily-payable-due-report',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-payable-report-cron-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'payable_due_report_cron_secret'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    );
  $command$
);

commit;
