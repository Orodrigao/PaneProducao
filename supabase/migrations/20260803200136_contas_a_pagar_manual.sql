-- Fase 1: contas a pagar manuais da JC.
-- A compra financeira fica separada do estoque; o recebimento físico entra em
-- uma fase posterior, pela Expedição.

begin;

insert into public.app_permissions (key, module, label, description, sort_order)
values
  ('contas_pagar.acessar', 'Financeiro', 'Contas a pagar', 'Consultar contas e vencimentos da JC.', 310),
  ('contas_pagar.lancar', 'Financeiro', 'Lançar conta', 'Registrar compras manuais da JC.', 311),
  ('contas_pagar.baixar', 'Financeiro', 'Baixar conta', 'Registrar o pagamento de uma conta.', 312),
  ('contas_pagar.cancelar', 'Financeiro', 'Cancelar conta', 'Cancelar uma conta ainda não paga.', 313)
on conflict (key) do update set
  module = excluded.module,
  label = excluded.label,
  description = excluded.description,
  sort_order = excluded.sort_order;

create table if not exists public.payable_purchases (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  store text not null default 'jc' check (store = 'jc'),
  supplier_id uuid references public.suppliers(id),
  purchase_date date not null default current_date,
  origin text not null default 'manual' check (origin = 'manual'),
  document_type text not null default 'sem_nota' check (document_type in ('sem_nota', 'recibo')),
  payment_method text not null check (payment_method in ('dinheiro', 'pix', 'transferencia', 'boleto', 'cartao', 'outro')),
  status text not null default 'aberta' check (status in ('aberta', 'paga', 'cancelada')),
  total_value numeric(12,2) not null check (total_value > 0),
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  paid_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id),
  cancel_reason text
);

create table if not exists public.payable_purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.payable_purchases(id) on delete cascade,
  product_id uuid references public.products(id),
  item_name text not null,
  unit text not null,
  quantity numeric(12,3) not null check (quantity > 0),
  unit_price numeric(12,4) not null check (unit_price > 0),
  line_total numeric(12,2) generated always as (round(quantity * unit_price, 2)) stored
);

create table if not exists public.payable_installments (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.payable_purchases(id) on delete cascade,
  installment_number integer not null check (installment_number > 0),
  due_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'pendente' check (status in ('pendente', 'paga', 'cancelada')),
  paid_at timestamptz,
  paid_by uuid references auth.users(id),
  unique (purchase_id, installment_number)
);

create table if not exists public.payable_events (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.payable_purchases(id) on delete cascade,
  event_type text not null check (event_type in ('criada', 'corrigida', 'baixada', 'cancelada')),
  details jsonb not null default '{}'::jsonb,
  occurred_by uuid not null references auth.users(id),
  occurred_at timestamptz not null default now()
);

create index if not exists payable_purchases_date_idx
  on public.payable_purchases (purchase_date desc);
create index if not exists payable_purchases_status_idx
  on public.payable_purchases (status, purchase_date desc);
create index if not exists payable_installments_due_idx
  on public.payable_installments (status, due_date);
create index if not exists payable_items_purchase_idx
  on public.payable_purchase_items (purchase_id);
create index if not exists payable_events_purchase_idx
  on public.payable_events (purchase_id, occurred_at desc);

revoke all on table public.payable_purchases from anon, authenticated;
revoke all on table public.payable_purchase_items from anon, authenticated;
revoke all on table public.payable_installments from anon, authenticated;
revoke all on table public.payable_events from anon, authenticated;

create or replace function private.current_user_can_payables(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and (
        profile.role = 'admin'
        or exists (
          select 1
          from public.app_user_permissions assignment
          where assignment.user_id = profile.user_id
            and assignment.permission_key = p_permission
            and assignment.scope in ('*', 'jc')
        )
      )
  );
$$;

revoke all on function private.current_user_can_payables(text) from public;
grant execute on function private.current_user_can_payables(text) to authenticated;

-- Perfis financeiros existentes recebem somente o escopo aprovado da JC.
insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
select profile.user_id, permission.key, 'jc', null::uuid
from public.app_profiles profile
cross join public.app_permissions permission
where profile.active
  and profile.role = 'financeiro'
  and permission.key in (
    'contas_pagar.acessar',
    'contas_pagar.lancar',
    'contas_pagar.baixar',
    'contas_pagar.cancelar'
  )
on conflict (user_id, permission_key, scope) do nothing;

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

create or replace function public.pay_manual_payable_installment(p_installment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase_id uuid;
  v_purchase_status text;
  v_installment_status text;
begin
  if not private.current_user_can_payables('contas_pagar.baixar') then
    raise exception using errcode = '42501', message = 'Sem permissão para baixar contas da JC.';
  end if;
  select installment.purchase_id, purchase.status, installment.status
    into v_purchase_id, v_purchase_status, v_installment_status
  from public.payable_installments installment
  join public.payable_purchases purchase on purchase.id = installment.purchase_id
  where installment.id = p_installment_id
  for update of installment, purchase;
  if v_purchase_id is null then
    raise exception using errcode = 'P0002', message = 'Parcela não encontrada.';
  end if;
  if v_purchase_status = 'cancelada' then
    raise exception using errcode = '22023', message = 'Conta cancelada não pode ser baixada.';
  end if;
  if v_installment_status = 'cancelada' then
    raise exception using errcode = '22023', message = 'Parcela cancelada não pode ser baixada.';
  end if;
  if v_installment_status = 'paga' then
    return;
  end if;

  update public.payable_installments
  set status = 'paga', paid_at = now(), paid_by = (select auth.uid())
  where id = p_installment_id and status = 'pendente';

  update public.payable_purchases purchase
  set status = case when not exists (
        select 1 from public.payable_installments installment
        where installment.purchase_id = v_purchase_id and installment.status = 'pendente'
      ) then 'paga' else 'aberta' end,
      paid_at = case when not exists (
        select 1 from public.payable_installments installment
        where installment.purchase_id = v_purchase_id and installment.status = 'pendente'
      ) then now() else null end,
      paid_by = case when not exists (
        select 1 from public.payable_installments installment
        where installment.purchase_id = v_purchase_id and installment.status = 'pendente'
      ) then (select auth.uid()) else null end,
      updated_at = now()
  where purchase.id = v_purchase_id;

  insert into public.payable_events (purchase_id, event_type, details, occurred_by)
  values (v_purchase_id, 'baixada', jsonb_build_object('installment_id', p_installment_id), (select auth.uid()));
end;
$$;

create or replace function public.cancel_manual_payable(p_purchase_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not private.current_user_can_payables('contas_pagar.cancelar') then
    raise exception using errcode = '42501', message = 'Sem permissão para cancelar contas da JC.';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'Informe o motivo do cancelamento.';
  end if;
  select status into v_status
  from public.payable_purchases
  where id = p_purchase_id
  for update;
  if v_status is null then
    raise exception using errcode = 'P0002', message = 'Conta não encontrada.';
  end if;
  if v_status = 'paga' then
    raise exception using errcode = '22023', message = 'Conta já paga não pode ser cancelada.';
  end if;
  if exists (
    select 1 from public.payable_installments installment
    where installment.purchase_id = p_purchase_id and installment.status = 'paga'
  ) then
    raise exception using errcode = '22023', message = 'Conta com parcela paga não pode ser cancelada.';
  end if;
  if v_status = 'cancelada' then
    return;
  end if;

  update public.payable_purchases
  set status = 'cancelada', cancelled_at = now(), cancelled_by = (select auth.uid()),
      cancel_reason = trim(p_reason), updated_at = now()
  where id = p_purchase_id;
  update public.payable_installments
  set status = 'cancelada'
  where purchase_id = p_purchase_id and status = 'pendente';
  insert into public.payable_events (purchase_id, event_type, details, occurred_by)
  values (p_purchase_id, 'cancelada', jsonb_build_object('reason', trim(p_reason)), (select auth.uid()));
end;
$$;

alter table public.payable_purchases enable row level security;
alter table public.payable_purchases force row level security;
alter table public.payable_purchase_items enable row level security;
alter table public.payable_purchase_items force row level security;
alter table public.payable_installments enable row level security;
alter table public.payable_installments force row level security;
alter table public.payable_events enable row level security;
alter table public.payable_events force row level security;

create policy payable_purchases_select_finance
on public.payable_purchases for select to authenticated
using (
  store = 'jc'
  and (
    private.current_user_can_payables('contas_pagar.acessar')
    or private.current_user_can_payables('contas_pagar.lancar')
    or private.current_user_can_payables('contas_pagar.baixar')
    or private.current_user_can_payables('contas_pagar.cancelar')
  )
);

create policy payable_purchase_items_select_finance
on public.payable_purchase_items for select to authenticated
using (exists (
  select 1 from public.payable_purchases purchase
  where purchase.id = payable_purchase_items.purchase_id
));

create policy payable_installments_select_finance
on public.payable_installments for select to authenticated
using (exists (
  select 1 from public.payable_purchases purchase
  where purchase.id = payable_installments.purchase_id
));

create policy payable_events_select_finance
on public.payable_events for select to authenticated
using (exists (
  select 1 from public.payable_purchases purchase
  where purchase.id = payable_events.purchase_id
));

grant select on public.payable_purchases to authenticated;
grant select on public.payable_purchase_items to authenticated;
grant select on public.payable_installments to authenticated;
grant select on public.payable_events to authenticated;
grant execute on function public.create_manual_payable(uuid, uuid, date, text, text, text, boolean, jsonb, jsonb) to authenticated;
grant execute on function public.pay_manual_payable_installment(uuid) to authenticated;
grant execute on function public.cancel_manual_payable(uuid, text) to authenticated;

revoke all on function public.create_manual_payable(uuid, uuid, date, text, text, text, boolean, jsonb, jsonb) from public;
revoke all on function public.pay_manual_payable_installment(uuid) from public;
revoke all on function public.cancel_manual_payable(uuid, text) from public;
grant execute on function public.create_manual_payable(uuid, uuid, date, text, text, text, boolean, jsonb, jsonb) to authenticated;
grant execute on function public.pay_manual_payable_installment(uuid) to authenticated;
grant execute on function public.cancel_manual_payable(uuid, text) to authenticated;

commit;
