begin;

-- A parcela continua guardando o valor original em amount e passa a guardar
-- separadamente o que aconteceu na quitação.
alter table public.payable_installments
  add column if not exists current_due_date date,
  add column if not exists paid_date date,
  add column if not exists paid_amount numeric(12,2),
  add column if not exists paid_method text;

alter table public.payable_installments
  drop constraint if exists payable_installments_paid_amount_check,
  drop constraint if exists payable_installments_paid_method_check,
  drop constraint if exists payable_installments_current_due_date_check;

alter table public.payable_installments
  add constraint payable_installments_paid_amount_check
    check (paid_amount is null or paid_amount >= amount),
  add constraint payable_installments_paid_method_check
    check (paid_method is null or paid_method in ('dinheiro', 'pix', 'transferencia', 'boleto', 'cartao', 'outro')),
  add constraint payable_installments_current_due_date_check
    check (current_due_date is null or current_due_date >= due_date);

-- As baixas existentes não têm o valor real informado pelo usuário. O único
-- preenchimento seguro é conservar o valor original e a data já registrada.
update public.payable_installments installment
set paid_date = coalesce(installment.paid_date, (coalesce(installment.paid_at, now()) at time zone 'America/Sao_Paulo')::date),
    paid_amount = coalesce(installment.paid_amount, installment.amount),
    paid_method = coalesce(installment.paid_method, purchase.payment_method)
from public.payable_purchases purchase
where purchase.id = installment.purchase_id
  and installment.status = 'paga';

-- Mantém o site antigo compatível durante a transição: qualquer caminho já
-- existente que marque a parcela como paga recebe os valores conservadores.
create or replace function private.fill_payable_installment_payment_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'paga' then
    new.paid_date := coalesce(new.paid_date, (coalesce(new.paid_at, now()) at time zone 'America/Sao_Paulo')::date);
    new.paid_amount := coalesce(new.paid_amount, new.amount);
    if new.paid_method is null then
      select purchase.payment_method
        into new.paid_method
      from public.payable_purchases purchase
      where purchase.id = new.purchase_id;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.fill_payable_installment_payment_defaults() from public, anon, authenticated;

drop trigger if exists payable_installment_payment_defaults on public.payable_installments;
create trigger payable_installment_payment_defaults
before insert or update of status, paid_at, paid_date, paid_amount, paid_method, amount
on public.payable_installments
for each row execute function private.fill_payable_installment_payment_defaults();

create or replace function public.record_payable_installment_payment(
  p_installment_id uuid,
  p_paid_date date,
  p_paid_amount numeric,
  p_paid_method text,
  p_current_due_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_installment record;
  v_user_id uuid := (select auth.uid());
begin
  if not private.current_user_can_payables('contas_pagar.baixar') then
    raise exception using errcode = '42501', message = 'Sem permissão para baixar contas da JC.';
  end if;

  select installment.id, installment.purchase_id, installment.amount, installment.due_date,
         installment.status as installment_status, purchase.status as purchase_status,
         purchase.purchase_date
    into v_installment
  from public.payable_installments installment
  join public.payable_purchases purchase on purchase.id = installment.purchase_id
  where installment.id = p_installment_id
  for update of installment, purchase;

  if v_installment.id is null then
    raise exception using errcode = 'P0002', message = 'Parcela não encontrada.';
  end if;
  if v_installment.purchase_status = 'cancelada' or v_installment.installment_status = 'cancelada' then
    raise exception using errcode = '22023', message = 'Conta cancelada não pode ser baixada.';
  end if;
  if v_installment.installment_status = 'paga' then
    raise exception using errcode = '22023', message = 'Parcela já paga. Use a correção da baixa.';
  end if;
  if p_paid_date is null or p_paid_date > current_date or p_paid_date < v_installment.purchase_date then
    raise exception using errcode = '22023', message = 'A data do pagamento precisa estar entre a compra e hoje.';
  end if;
  if p_paid_amount is null or p_paid_amount < v_installment.amount then
    raise exception using errcode = '22023', message = 'O valor pago não pode ser menor que o valor original da parcela.';
  end if;
  if p_paid_method not in ('dinheiro', 'pix', 'transferencia', 'boleto') then
    raise exception using errcode = '22023', message = 'Forma real de pagamento inválida.';
  end if;
  if p_current_due_date is not null and p_current_due_date < v_installment.due_date then
    raise exception using errcode = '22023', message = 'O vencimento atualizado não pode ser anterior ao vencimento original.';
  end if;

  update public.payable_installments
  set status = 'paga',
      paid_date = p_paid_date,
      paid_amount = round(p_paid_amount, 2),
      paid_method = p_paid_method,
      current_due_date = p_current_due_date,
      paid_at = now(),
      paid_by = v_user_id
  where id = p_installment_id;

  update public.payable_purchases purchase
  set status = case when not exists (
        select 1 from public.payable_installments installment
        where installment.purchase_id = v_installment.purchase_id and installment.status = 'pendente'
      ) then 'paga' else 'aberta' end,
      paid_at = case when not exists (
        select 1 from public.payable_installments installment
        where installment.purchase_id = v_installment.purchase_id and installment.status = 'pendente'
      ) then now() else null end,
      paid_by = case when not exists (
        select 1 from public.payable_installments installment
        where installment.purchase_id = v_installment.purchase_id and installment.status = 'pendente'
      ) then v_user_id else null end,
      updated_at = now()
  where purchase.id = v_installment.purchase_id;

  insert into public.payable_events (purchase_id, event_type, details, occurred_by)
  values (
    v_installment.purchase_id,
    'baixada',
    jsonb_build_object(
      'installment_id', p_installment_id,
      'paid_date', p_paid_date,
      'paid_amount', round(p_paid_amount, 2),
      'paid_method', p_paid_method,
      'current_due_date', p_current_due_date
    ),
    v_user_id
  );
end;
$$;

create or replace function public.correct_payable_installment_payment(
  p_installment_id uuid,
  p_paid_date date,
  p_paid_amount numeric,
  p_paid_method text,
  p_current_due_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_installment record;
  v_user_id uuid := (select auth.uid());
begin
  if not private.current_user_can_payables('contas_pagar.baixar') then
    raise exception using errcode = '42501', message = 'Sem permissão para corrigir baixas da JC.';
  end if;

  select installment.id, installment.purchase_id, installment.amount, installment.due_date,
         installment.status as installment_status, installment.paid_date as old_paid_date,
         installment.paid_amount as old_paid_amount, installment.paid_method as old_paid_method,
         installment.current_due_date as old_current_due_date, purchase.status as purchase_status,
         purchase.purchase_date
    into v_installment
  from public.payable_installments installment
  join public.payable_purchases purchase on purchase.id = installment.purchase_id
  where installment.id = p_installment_id
  for update of installment, purchase;

  if v_installment.id is null then
    raise exception using errcode = 'P0002', message = 'Parcela não encontrada.';
  end if;
  if v_installment.purchase_status = 'cancelada' or v_installment.installment_status = 'cancelada' then
    raise exception using errcode = '22023', message = 'Conta cancelada não pode ser corrigida.';
  end if;
  if v_installment.installment_status <> 'paga' then
    raise exception using errcode = '22023', message = 'Somente uma parcela paga pode ter a baixa corrigida.';
  end if;
  if p_paid_date is null or p_paid_date > current_date or p_paid_date < v_installment.purchase_date then
    raise exception using errcode = '22023', message = 'A data do pagamento precisa estar entre a compra e hoje.';
  end if;
  if p_paid_amount is null or p_paid_amount < v_installment.amount then
    raise exception using errcode = '22023', message = 'O valor pago não pode ser menor que o valor original da parcela.';
  end if;
  if p_paid_method not in ('dinheiro', 'pix', 'transferencia', 'boleto') then
    raise exception using errcode = '22023', message = 'Forma real de pagamento inválida.';
  end if;
  if p_current_due_date is not null and p_current_due_date < v_installment.due_date then
    raise exception using errcode = '22023', message = 'O vencimento atualizado não pode ser anterior ao vencimento original.';
  end if;

  update public.payable_installments
  set paid_date = p_paid_date,
      paid_amount = round(p_paid_amount, 2),
      paid_method = p_paid_method,
      current_due_date = p_current_due_date,
      paid_at = now(),
      paid_by = v_user_id
  where id = p_installment_id;

  update public.payable_purchases
  set updated_at = now(), paid_by = v_user_id
  where id = v_installment.purchase_id;

  insert into public.payable_events (purchase_id, event_type, details, occurred_by)
  values (
    v_installment.purchase_id,
    'corrigida',
    jsonb_build_object(
      'installment_id', p_installment_id,
      'old_paid_date', v_installment.old_paid_date,
      'old_paid_amount', v_installment.old_paid_amount,
      'old_paid_method', v_installment.old_paid_method,
      'old_current_due_date', v_installment.old_current_due_date,
      'paid_date', p_paid_date,
      'paid_amount', round(p_paid_amount, 2),
      'paid_method', p_paid_method,
      'current_due_date', p_current_due_date
    ),
    v_user_id
  );
end;
$$;

revoke all on function public.record_payable_installment_payment(uuid, date, numeric, text, date) from public, anon;
revoke all on function public.correct_payable_installment_payment(uuid, date, numeric, text, date) from public, anon;
grant execute on function public.record_payable_installment_payment(uuid, date, numeric, text, date) to authenticated;
grant execute on function public.correct_payable_installment_payment(uuid, date, numeric, text, date) to authenticated;

commit;
