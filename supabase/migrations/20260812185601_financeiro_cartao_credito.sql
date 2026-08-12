-- Cartao de credito: despesa nasce no cartao; a fatura fica para a proxima fase.
begin;

alter table public.finance_accounts drop constraint if exists finance_accounts_kind_check;
alter table public.finance_accounts add constraint finance_accounts_kind_check
  check (kind in ('banco', 'caixa', 'cartao_credito'));

insert into public.finance_accounts (key, label, kind, store, cnpj_label, sort_order)
values
  ('cartao_sicredi_jc', 'Sicredi JC', 'cartao_credito', null, 'RGE Pane e Pizza', 150),
  ('cartao_banrisul_jc', 'Banrisul JC', 'cartao_credito', null, 'RGE Pane e Pizza', 160),
  ('cartao_sicredi_sf', 'Sicredi SF', 'cartao_credito', null, 'SF Salute', 250)
on conflict (key) do update set label = excluded.label, kind = excluded.kind,
  store = excluded.store, cnpj_label = excluded.cnpj_label, sort_order = excluded.sort_order;

alter table public.finance_entries add column if not exists card_invoice_id uuid;
comment on column public.finance_entries.card_invoice_id is
  'Vinculo futuro com a fatura do cartao; nulo ate a fase de faturas.';

-- A regra mora no banco: o navegador nunca pode transformar uma compra no
-- cartao em uma saida de banco (nem o contrario).
create or replace function private.assert_finance_account_payment_match(p_account_id uuid, p_payment_method text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_kind text;
begin
  if p_account_id is not null then
    select kind into v_kind from public.finance_accounts where id = p_account_id;
  end if;
  if p_payment_method = 'cartao' and coalesce(v_kind, '') <> 'cartao_credito' then
    raise exception using errcode = '22023', message = 'Pagamento em cartao exige um cartao de credito.';
  end if;
  if v_kind = 'cartao_credito' and p_payment_method <> 'cartao' then
    raise exception using errcode = '22023', message = 'Cartao de credito aceita somente a forma Cartao.';
  end if;
end;
$$;
revoke all on function private.assert_finance_account_payment_match(uuid, text) from public, anon, authenticated;

create or replace function private.check_finance_entry_account_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_finance_account_payment_match(new.account_id, new.payment_method);
  return new;
end;
$$;
drop trigger if exists finance_entries_account_payment_check on public.finance_entries;
create trigger finance_entries_account_payment_check before insert or update of account_id, payment_method
  on public.finance_entries for each row execute function private.check_finance_entry_account_payment();

create or replace function private.check_payable_installment_account_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_account_id uuid;
begin
  if current_setting('app.allow_payable_account_payment_change', true) = 'on' then return new; end if;
  if new.paid_method is not null then
    select finance_account_id into v_account_id from public.payable_purchases where id = new.purchase_id;
    perform private.assert_finance_account_payment_match(v_account_id, new.paid_method);
  end if;
  return new;
end;
$$;
drop trigger if exists payable_installments_account_payment_check on public.payable_installments;
create trigger payable_installments_account_payment_check before insert or update of paid_method
  on public.payable_installments for each row execute function private.check_payable_installment_account_payment();

create or replace function private.check_payable_purchase_account_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_method text;
begin
  if current_setting('app.allow_payable_account_payment_change', true) = 'on' then return new; end if;
  for v_method in select paid_method from public.payable_installments
    where purchase_id = new.id and paid_method is not null loop
    perform private.assert_finance_account_payment_match(new.finance_account_id, v_method);
  end loop;
  return new;
end;
$$;
drop trigger if exists payable_purchases_account_payment_check on public.payable_purchases;
create trigger payable_purchases_account_payment_check before update of finance_account_id
  on public.payable_purchases for each row execute function private.check_payable_purchase_account_payment();

-- A porta antiga nao pode mais marcar uma compra como paga sem a baixa
-- protegida e sem alimentar o livro.
create or replace function private.block_legacy_paid_installment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'paga' and new.paid_method is null then
    raise exception using errcode = '22023', message = 'Compra ja paga deve usar a baixa protegida.';
  end if;
  return new;
end;
$$;
drop trigger if exists payable_installments_legacy_paid_block on public.payable_installments;
create trigger payable_installments_legacy_paid_block before insert on public.payable_installments
  for each row execute function private.block_legacy_paid_installment();
revoke execute on function public.pay_manual_payable_installment(uuid) from authenticated;

-- A fatura ainda nao existe: transferencia generica nao pode simular sua quitacao.
create or replace function private.block_card_transfer()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.finance_accounts where id in (new.origin_account_id, new.destination_account_id)
             and kind = 'cartao_credito') then
    raise exception using errcode = '22023', message = 'Cartao so recebe gasto pelo contas a pagar ate a fase da fatura.';
  end if;
  return new;
end;
$$;
drop trigger if exists finance_transfers_card_block on public.finance_transfers;
create trigger finance_transfers_card_block before insert on public.finance_transfers
  for each row execute function private.block_card_transfer();

-- Partimos literalmente das duas funcoes vigentes da fase anterior e trocamos
-- somente a lista fechada de formas reais: Cartao agora e uma forma valida.
do $card$
declare v_definition text;
begin
  for v_definition in
    select pg_get_functiondef(proc.oid)
    from pg_proc proc join pg_namespace namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.proname in ('record_payable_installment_payment', 'correct_payable_installment_payment')
  loop
    v_definition := replace(v_definition,
      '(''dinheiro'', ''pix'', ''transferencia'', ''boleto'')',
      '(''dinheiro'', ''pix'', ''transferencia'', ''boleto'', ''cartao'')');
    execute v_definition;
  end loop;
end;
$card$;

-- Compra manual ja paga: cria, classifica e baixa na mesma transacao.
create or replace function public.create_and_pay_manual_payable(
  p_request_id uuid, p_supplier_id uuid, p_purchase_date date, p_document_type text,
  p_payment_method text, p_notes text, p_items jsonb, p_installments jsonb,
  p_paid_date date, p_paid_amount numeric, p_paid_method text, p_current_due_date date,
  p_account_key text, p_categories jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_purchase_id uuid; v_installment_id uuid;
begin
  if not private.current_user_can_payables('contas_pagar.lancar')
     or not private.current_user_can_payables('contas_pagar.baixar') then
    raise exception using errcode = '42501', message = 'Sem permissao para lancar e baixar contas da JC.';
  end if;
  if jsonb_typeof(coalesce(p_installments, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_installments, '[]'::jsonb)) <> 1
     or coalesce((p_installments -> 0 ->> 'installment_number')::integer, 0) <> 1 then
    raise exception using errcode = '22023', message = 'Compra manual ja paga precisa ter uma unica parcela a vista.';
  end if;
  select id into v_purchase_id from public.payable_purchases where request_id = p_request_id;
  if v_purchase_id is not null then return v_purchase_id; end if;
  v_purchase_id := public.create_manual_payable(p_request_id, p_supplier_id, p_purchase_date,
    p_document_type, p_payment_method, p_notes, false, p_items, p_installments);
  perform public.set_payable_finance_classification(v_purchase_id, p_account_key, p_categories);
  select id into v_installment_id from public.payable_installments
    where purchase_id = v_purchase_id and installment_number = 1 for update;
  perform public.record_payable_installment_payment(v_installment_id, p_paid_date, p_paid_amount,
    p_paid_method, p_current_due_date);
  return v_purchase_id;
end;
$$;
revoke all on function public.create_and_pay_manual_payable(uuid, uuid, date, text, text, text, jsonb, jsonb, date, numeric, text, date, text, jsonb) from public, anon;
grant execute on function public.create_and_pay_manual_payable(uuid, uuid, date, text, text, text, jsonb, jsonb, date, numeric, text, date, text, jsonb) to authenticated;

-- Correcao que troca forma e conta nao pode passar por um estado intermediario
-- incoerente. Esta unica RPC valida o par final e deixa o estorno/re-lancamento
-- acontecer na mesma transacao.
create or replace function public.correct_payable_payment_and_classification(
  p_installment_id uuid, p_paid_date date, p_paid_amount numeric, p_paid_method text,
  p_current_due_date date, p_account_key text, p_categories jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare v_purchase_id uuid; v_account_id uuid;
begin
  if not private.current_user_can_payables('contas_pagar.baixar') then
    raise exception using errcode = '42501', message = 'Sem permissao para corrigir baixas da JC.';
  end if;
  select purchase_id into v_purchase_id from public.payable_installments where id = p_installment_id for update;
  if v_purchase_id is null then raise exception using errcode = 'P0002', message = 'Parcela nao encontrada.'; end if;
  select id into v_account_id from public.finance_accounts where key = p_account_key and active;
  if v_account_id is null then raise exception using errcode = '22023', message = 'Conta de origem invalida ou inativa.'; end if;
  perform private.assert_finance_account_payment_match(v_account_id, p_paid_method);
  perform set_config('app.allow_payable_account_payment_change', 'on', true);
  perform public.set_payable_finance_classification(v_purchase_id, p_account_key, p_categories);
  perform public.correct_payable_installment_payment(p_installment_id, p_paid_date, p_paid_amount, p_paid_method, p_current_due_date);
  perform set_config('app.allow_payable_account_payment_change', 'off', true);
end;
$$;
revoke all on function public.correct_payable_payment_and_classification(uuid, date, numeric, text, date, text, jsonb) from public, anon;
grant execute on function public.correct_payable_payment_and_classification(uuid, date, numeric, text, date, text, jsonb) to authenticated;

commit;
