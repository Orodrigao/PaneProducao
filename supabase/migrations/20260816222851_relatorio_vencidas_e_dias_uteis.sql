-- Relatorio diario de contas a pagar da JC em dois e-mails:
-- 1) "a_vencer": a janela passa de 3 dias corridos para "hoje ate o 3o dia
--    util" (seg-sex; feriado conta como util por decisao explicita; sabado e
--    domingo no meio da janela continuam incluidos, para conta que vence no
--    fim de semana nao sumir do radar).
-- 2) "vencida": novo e-mail, criado somente quando existir conta vencida em
--    aberto, com o atraso congelado na fotografia do dia (retry nao muda o
--    numero que a Suelen le).
-- A trava anti-duplicado passa a valer por (dia, tipo); as duas fotografias
-- nascem na mesma transacao apos as 06:00; a fila reserva sempre a tentativa
-- mais antiga, entao um tipo em falha nao bloqueia o outro.

begin;

alter table private.payable_due_report_runs
  add column if not exists report_kind text not null default 'a_vencer'
    constraint payable_due_report_runs_kind_check
    check (report_kind in ('a_vencer', 'vencida')),
  add column if not exists window_end_date date;

alter table private.payable_due_report_runs
  drop constraint if exists payable_due_report_runs_report_date_key;

create unique index if not exists payable_due_report_runs_date_kind_key
  on private.payable_due_report_runs (report_date, report_kind);

-- Data do 3o dia util a partir de p_start, contando p_start quando ele mesmo
-- for util. Sete dias de busca cobrem qualquer combinacao de fim de semana.
create or replace function private.payable_report_third_business_day(p_start date)
returns date
language sql
stable
set search_path = ''
as $$
  select max(uteis.dia)
  from (
    select serie.dia::date as dia
    from pg_catalog.generate_series(p_start::timestamp, (p_start + 6)::timestamp, interval '1 day') serie(dia)
    where extract(isodow from serie.dia) < 6
    order by serie.dia
    limit 3
  ) uteis;
$$;

revoke all on function private.payable_report_third_business_day(date) from public, anon, authenticated, service_role;

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
  v_window_end date;
  v_snapshot jsonb;
  v_overdue jsonb;
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

  -- As fotografias do dia nascem juntas, na mesma transacao, apos as 06:00.
  if v_brazil_now::time >= time '06:00' then
    if not exists (
      select 1 from private.payable_due_report_runs run
      where run.report_date = v_today and run.report_kind = 'a_vencer'
    ) then
      v_window_end := private.payable_report_third_business_day(v_today);

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
        and coalesce(installment.current_due_date, installment.due_date) between v_today and v_window_end;

      insert into private.payable_due_report_runs (report_date, report_kind, snapshot, window_end_date)
      values (v_today, 'a_vencer', v_snapshot, v_window_end)
      on conflict (report_date, report_kind) do nothing;
    end if;

    if not exists (
      select 1 from private.payable_due_report_runs run
      where run.report_date = v_today and run.report_kind = 'vencida'
    ) then
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
            'amount', installment.amount,
            'days_overdue', (v_today - coalesce(installment.current_due_date, installment.due_date))
          )
          order by coalesce(installment.current_due_date, installment.due_date), supplier.name, installment.installment_number
        ),
        '[]'::jsonb
      ) into v_overdue
      from public.payable_installments installment
      join public.payable_purchases purchase on purchase.id = installment.purchase_id
      left join public.suppliers supplier on supplier.id = purchase.supplier_id
      where purchase.store = 'jc'
        and purchase.status = 'aberta'
        and installment.status = 'pendente'
        and coalesce(installment.current_due_date, installment.due_date) < v_today;

      -- Sem vencida nao ha e-mail: o run do tipo "vencida" so nasce com itens.
      if pg_catalog.jsonb_array_length(v_overdue) > 0 then
        insert into private.payable_due_report_runs (report_date, report_kind, snapshot, window_end_date)
        values (v_today, 'vencida', v_overdue, null)
        on conflict (report_date, report_kind) do nothing;
      end if;
    end if;
  end if;

  -- Reserva a tentativa mais antiga primeiro: quem nunca tentou vem antes,
  -- e um tipo que falha repetidamente nao monopoliza a fila.
  select run.* into v_run
  from private.payable_due_report_runs run
  where run.sent_at is null
    and (run.last_attempt_at is null or run.last_attempt_at <= now() - interval '14 minutes')
  order by run.last_attempt_at asc nulls first, run.report_date asc, run.report_kind asc
  for update skip locked
  limit 1;

  if v_run.id is null then
    if exists (
      select 1
      from private.payable_due_report_runs run
      where run.report_date = v_today
        and run.sent_at is not null
    ) then
      return jsonb_build_object('state', 'ja_enviado');
    end if;
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
    'report_kind', v_run.report_kind,
    'window_end_date', v_run.window_end_date,
    'attempt_token', v_attempt_token,
    'recipient', v_recipient,
    'items', v_run.snapshot
  );
end;
$$;

-- O retorno ganha a coluna do tipo; mudanca de assinatura exige drop e
-- recriacao, e os grants precisam ser refeitos explicitamente.
drop function if exists public.get_payable_due_report_status();

create function public.get_payable_due_report_status()
returns table (
  report_kind text,
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
    raise exception using errcode = '42501', message = U&'Sem permiss\00E3o para consultar o relat\00F3rio di\00E1rio.';
  end if;

  return query
  select kinds.kind,
         v_today,
         coalesce(run.status, case
           when v_brazil_now::time < time '06:00' then 'programado'
           when kinds.kind = 'vencida' then 'sem_pendencias'
           else 'aguardando'
         end),
         run.last_attempt_at,
         run.sent_at,
         run.last_error
  from (values ('a_vencer'), ('vencida')) kinds(kind)
  left join private.payable_due_report_runs run
    on run.report_date = v_today and run.report_kind = kinds.kind
  order by kinds.kind;
end;
$$;

revoke all on function public.get_payable_due_report_status() from public, anon;
grant execute on function public.get_payable_due_report_status() to authenticated, service_role;

commit;
