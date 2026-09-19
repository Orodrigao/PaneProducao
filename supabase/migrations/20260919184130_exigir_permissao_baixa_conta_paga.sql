begin;

-- A porta antiga nao recebe classificacao, conta de origem nem os dados reais
-- da baixa. Por isso ela so pode criar conta em aberto; conta ja paga precisa
-- passar pela operacao atomica create_and_pay_manual_payable.
create or replace function public.create_manual_payable(
  p_request_id uuid,
  p_supplier_id uuid,
  p_purchase_date date,
  p_document_type text,
  p_payment_method text,
  p_notes text,
  p_paid boolean,
  p_items jsonb,
  p_installments jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase_id uuid;
  v_total numeric(12,2) := 0;
  v_installments_total numeric(12,2) := 0;
  v_item record;
  v_installment record;
begin
  if not private.current_user_can_payables('contas_pagar.lancar') then
    raise exception using errcode = '42501', message = 'Sem permissão para lançar contas da JC.';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador do lançamento obrigatório.';
  end if;
  select existing.id into v_purchase_id
  from public.payable_purchases existing
  where existing.request_id = p_request_id;
  if v_purchase_id is not null then
    return v_purchase_id;
  end if;
  if p_paid then
    raise exception using errcode = '22023',
      message = 'Conta já paga deve usar a operação completa de lançamento e baixa.';
  end if;
  if p_purchase_date is null then
    raise exception using errcode = '22023', message = 'Data da compra obrigatória.';
  end if;
  if p_supplier_id is null or not exists (
    select 1 from public.suppliers supplier where supplier.id = p_supplier_id and supplier.active
  ) then
    raise exception using errcode = '22023', message = 'Fornecedor ativo obrigatório.';
  end if;
  if p_document_type not in ('sem_nota', 'recibo') then
    raise exception using errcode = '22023', message = 'Tipo de documento inválido.';
  end if;
  if p_payment_method not in ('dinheiro', 'pix', 'transferencia', 'boleto', 'cartao', 'outro') then
    raise exception using errcode = '22023', message = 'Forma de pagamento inválida.';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception using errcode = '22023', message = 'A compra precisa ter pelo menos um item.';
  end if;
  if jsonb_typeof(coalesce(p_installments, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_installments, '[]'::jsonb)) = 0 then
    raise exception using errcode = '22023', message = 'A compra precisa ter pelo menos uma parcela.';
  end if;

  for v_item in
    select *
    from jsonb_to_recordset(p_items) as item(
      product_id uuid,
      item_name text,
      unit text,
      quantity numeric,
      unit_price numeric
    )
  loop
    if nullif(trim(v_item.item_name), '') is null
       or nullif(trim(v_item.unit), '') is null
       or v_item.quantity is null or v_item.quantity <= 0
       or v_item.unit_price is null or v_item.unit_price <= 0 then
      raise exception using errcode = '22023', message = 'Item com nome, unidade, quantidade ou preço inválido.';
    end if;
    if v_item.product_id is not null and not exists (
      select 1 from public.products product
      where product.id = v_item.product_id and product.active
    ) then
      raise exception using errcode = '22023', message = 'Produto selecionado não existe ou está inativo.';
    end if;
    v_total := v_total + round(v_item.quantity * v_item.unit_price, 2);
  end loop;

  for v_installment in
    select *
    from jsonb_to_recordset(p_installments) as installment(
      installment_number integer,
      due_date date,
      amount numeric
    )
  loop
    if v_installment.installment_number is null or v_installment.installment_number <= 0
       or v_installment.due_date is null
       or v_installment.amount is null or v_installment.amount <= 0 then
      raise exception using errcode = '22023', message = 'Parcela com número, vencimento ou valor inválido.';
    end if;
    v_installments_total := v_installments_total + round(v_installment.amount, 2);
  end loop;

  if round(v_total, 2) <> round(v_installments_total, 2) then
    raise exception using errcode = '22023', message = 'A soma das parcelas precisa ser igual à soma dos itens.';
  end if;

  insert into public.payable_purchases (
    request_id, store, supplier_id, purchase_date, origin, document_type,
    payment_method, status, total_value, notes, created_by, paid_at, paid_by
  )
  values (
    p_request_id, 'jc', p_supplier_id, p_purchase_date, 'manual', p_document_type,
    p_payment_method, case when p_paid then 'paga' else 'aberta' end,
    round(v_total, 2), nullif(trim(p_notes), ''), (select auth.uid()),
    case when p_paid then now() else null end,
    case when p_paid then (select auth.uid()) else null end
  )
  returning id into v_purchase_id;

  insert into public.payable_purchase_items (purchase_id, product_id, item_name, unit, quantity, unit_price)
  select v_purchase_id, item.product_id, item.item_name, item.unit, item.quantity, item.unit_price
  from jsonb_to_recordset(p_items) as item(
    product_id uuid, item_name text, unit text, quantity numeric, unit_price numeric
  );

  insert into public.payable_installments (
    purchase_id, installment_number, due_date, amount, status, paid_at, paid_by
  )
  select
    v_purchase_id, installment.installment_number, installment.due_date,
    round(installment.amount, 2),
    case when p_paid then 'paga' else 'pendente' end,
    case when p_paid then now() else null end,
    case when p_paid then (select auth.uid()) else null end
  from jsonb_to_recordset(p_installments) as installment(
    installment_number integer, due_date date, amount numeric
  );

  insert into public.payable_events (purchase_id, event_type, details, occurred_by)
  values (v_purchase_id, 'criada', jsonb_build_object('origin', 'manual', 'paid', p_paid), (select auth.uid()));

  return v_purchase_id;
end;
$$;

revoke all on function public.create_manual_payable(uuid, uuid, date, text, text, text, boolean, jsonb, jsonb)
  from public, anon;
grant execute on function public.create_manual_payable(uuid, uuid, date, text, text, text, boolean, jsonb, jsonb)
  to authenticated;

commit;
