-- Fase 3: importação de NF-e para contas a pagar da JC.
-- A NF é uma obrigação financeira única, mas cada item pode apontar para
-- um item-base diferente, com conversão própria e classificação pendente.

begin;

insert into public.app_permissions (key, module, label, description, sort_order)
values (
  'contas_pagar.importar_xml', 'Financeiro', 'Importar XML',
  'Importar NF-e e revisar seus itens antes da confirmação.', 314
)
on conflict (key) do update set
  module = excluded.module,
  label = excluded.label,
  description = excluded.description,
  sort_order = excluded.sort_order;

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
select profile.user_id, 'contas_pagar.importar_xml', 'jc', null::uuid
from public.app_profiles profile
where profile.active
  and profile.role = 'financeiro'
on conflict (user_id, permission_key, scope) do nothing;

alter table public.payable_purchases
  drop constraint if exists payable_purchases_origin_check,
  drop constraint if exists payable_purchases_document_type_check;

alter table public.payable_purchases
  add constraint payable_purchases_origin_check
    check (origin in ('manual', 'xml')),
  add constraint payable_purchases_document_type_check
    check (document_type in ('sem_nota', 'recibo', 'nfe'));

alter table public.payable_purchases
  add column if not exists nfe_key text,
  add column if not exists nfe_number text,
  add column if not exists nfe_series text,
  add column if not exists nfe_issued_at date,
  add column if not exists classification_status text not null default 'completa';

alter table public.payable_purchases
  add constraint payable_purchases_classification_status_check
    check (classification_status in ('completa', 'pendente'));

create unique index if not exists payable_purchases_nfe_key_unique_idx
  on public.payable_purchases (nfe_key)
  where nfe_key is not null;

alter table public.payable_purchase_items
  add column if not exists source_line_number integer,
  add column if not exists source_product_code text,
  add column if not exists source_ean text,
  add column if not exists source_description text,
  add column if not exists source_unit text,
  add column if not exists source_quantity numeric(12,3),
  add column if not exists conversion_basis text,
  add column if not exists conversion_factor numeric(14,6),
  add column if not exists usable_quantity numeric(14,6),
  add column if not exists normalized_unit_cost numeric(12,6),
  add column if not exists category_snapshot text,
  add column if not exists mapping_status text not null default 'mapeado',
  add column if not exists mapping_confirmed_at timestamptz,
  add column if not exists mapping_confirmed_by uuid references auth.users(id);

alter table public.payable_purchase_items
  add constraint payable_purchase_items_conversion_basis_check
    check (conversion_basis is null or conversion_basis in ('simple', 'package', 'usable')),
  add constraint payable_purchase_items_mapping_status_check
    check (mapping_status in ('pendente', 'mapeado')),
  add constraint payable_purchase_items_conversion_factor_check
    check (conversion_factor is null or conversion_factor > 0),
  add constraint payable_purchase_items_usable_quantity_check
    check (usable_quantity is null or usable_quantity > 0);

create table if not exists public.payable_product_mappings (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id),
  supplier_product_code text,
  supplier_ean text,
  supplier_description text not null,
  purchase_unit text not null,
  base_product_id uuid not null references public.products(id),
  base_unit text not null,
  conversion_basis text not null check (conversion_basis in ('simple', 'package', 'usable')),
  conversion_factor numeric(14,6) not null check (conversion_factor > 0),
  active boolean not null default true,
  last_confirmed_at timestamptz not null default now(),
  last_confirmed_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payable_product_mappings_lookup_idx
  on public.payable_product_mappings (supplier_id, purchase_unit, supplier_product_code, supplier_ean);

create index if not exists payable_product_mappings_description_idx
  on public.payable_product_mappings (supplier_id, lower(supplier_description));

revoke all on table public.payable_product_mappings from anon, authenticated;
grant select on public.payable_product_mappings to authenticated;
alter table public.payable_product_mappings enable row level security;
alter table public.payable_product_mappings force row level security;

create policy payable_product_mappings_select_finance
on public.payable_product_mappings for select to authenticated
using (private.current_user_can_payables('contas_pagar.acessar'));

create or replace function public.create_payable_catalog_product(
  p_name text,
  p_category text,
  p_unit text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
begin
  if not private.current_user_can_payables('contas_pagar.lancar') then
    raise exception using errcode = '42501', message = 'Sem permissão para cadastrar item nesta importação.';
  end if;
  if nullif(trim(p_name), '') is null or nullif(trim(p_unit), '') is null then
    raise exception using errcode = '22023', message = 'Nome e unidade do novo item são obrigatórios.';
  end if;
  select product.id into v_product_id
  from public.products product
  where product.active and lower(trim(product.name)) = lower(trim(p_name))
  order by product.created_at
  limit 1;
  if v_product_id is not null then
    return v_product_id;
  end if;
  insert into public.products (
    name, category, active, unit, kind, is_fabricacao_propria, production_area
  ) values (
    trim(p_name), coalesce(nullif(trim(p_category), ''), 'Insumos'), true,
    trim(p_unit), 'insumo', false, 'outros'
  ) returning id into v_product_id;
  return v_product_id;
end;
$$;

create or replace function public.create_xml_payable(
  p_request_id uuid,
  p_access_key text,
  p_supplier_id uuid,
  p_nfe_number text,
  p_nfe_series text,
  p_issue_date date,
  p_payment_method text,
  p_total_value numeric,
  p_notes text,
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
  v_product_name text;
  v_product_unit text;
  v_category text;
  v_classification_status text := 'completa';
  v_mapping_id uuid;
begin
  if not private.current_user_can_payables('contas_pagar.importar_xml') then
    raise exception using errcode = '42501', message = 'Sem permissão para importar XML.';
  end if;
  if p_request_id is null or p_access_key !~ '^[0-9]{44}$' then
    raise exception using errcode = '22023', message = 'Chave da NF-e ou identificador inválido.';
  end if;
  select purchase.id into v_purchase_id
  from public.payable_purchases purchase
  where purchase.request_id = p_request_id;
  if v_purchase_id is not null then
    return v_purchase_id;
  end if;
  if exists (select 1 from public.payable_purchases purchase where purchase.nfe_key = p_access_key) then
    raise exception using errcode = '23505', message = 'Esta NF-e já foi importada. A chave de acesso não pode ser repetida.';
  end if;
  if p_supplier_id is null or not exists (
    select 1 from public.suppliers supplier where supplier.id = p_supplier_id and supplier.active
  ) then
    raise exception using errcode = '22023', message = 'Fornecedor ativo obrigatório.';
  end if;
  if p_issue_date is null or p_total_value is null or p_total_value <= 0 then
    raise exception using errcode = '22023', message = 'Data e valor total da NF-e são obrigatórios.';
  end if;
  if p_payment_method not in ('dinheiro', 'pix', 'transferencia', 'boleto', 'cartao', 'outro') then
    raise exception using errcode = '22023', message = 'Forma de pagamento inválida.';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception using errcode = '22023', message = 'A NF-e precisa ter pelo menos um item.';
  end if;
  if jsonb_typeof(coalesce(p_installments, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_installments, '[]'::jsonb)) = 0 then
    raise exception using errcode = '22023', message = 'A NF-e precisa ter pelo menos uma parcela.';
  end if;

  for v_item in
    select * from jsonb_to_recordset(p_items) as item(
      line_number integer,
      supplier_product_code text,
      supplier_ean text,
      source_description text,
      source_unit text,
      source_quantity numeric,
      product_id uuid,
      conversion_basis text,
      conversion_factor numeric,
      usable_quantity numeric,
      line_total numeric,
      unit_price numeric,
      remember_conversion boolean
    )
  loop
    if nullif(trim(v_item.source_description), '') is null
       or nullif(trim(v_item.source_unit), '') is null
       or v_item.source_quantity is null or v_item.source_quantity <= 0
       or v_item.line_total is null or v_item.line_total <= 0
       or v_item.unit_price is null or v_item.unit_price <= 0 then
      raise exception using errcode = '22023', message = 'Item da NF-e com dados financeiros inválidos.';
    end if;
    if v_item.product_id is null then
      v_classification_status := 'pendente';
    else
      if not exists (select 1 from public.products product where product.id = v_item.product_id and product.active) then
        raise exception using errcode = '22023', message = 'Item-base selecionado não existe ou está inativo.';
      end if;
      if v_item.conversion_factor is null or v_item.conversion_factor <= 0
         or v_item.usable_quantity is null or v_item.usable_quantity <= 0 then
        raise exception using errcode = '22023', message = 'Confirme a conversão de todos os itens classificados.';
      end if;
      select product.name, coalesce(product.unit, 'un'), coalesce(product.category, 'Outros')
        into v_product_name, v_product_unit, v_category
      from public.products product where product.id = v_item.product_id;
      update public.products
      set cost_price = round(v_item.line_total / v_item.usable_quantity, 2)
      where id = v_item.product_id;
    end if;
    v_total := v_total + round(v_item.line_total, 2);

    if coalesce(v_item.remember_conversion, false) and v_item.product_id is not null then
      select mapping.id into v_mapping_id
      from public.payable_product_mappings mapping
      where mapping.supplier_id = p_supplier_id
        and mapping.purchase_unit = v_item.source_unit
        and (
          (v_item.supplier_product_code is not null and mapping.supplier_product_code = v_item.supplier_product_code)
          or (v_item.supplier_ean is not null and mapping.supplier_ean = v_item.supplier_ean)
          or (v_item.supplier_product_code is null and v_item.supplier_ean is null
              and lower(trim(mapping.supplier_description)) = lower(trim(v_item.source_description)))
        )
      order by mapping.updated_at desc
      limit 1;
      if v_mapping_id is null then
        insert into public.payable_product_mappings (
          supplier_id, supplier_product_code, supplier_ean, supplier_description,
          purchase_unit, base_product_id, base_unit, conversion_basis,
          conversion_factor, last_confirmed_by
        ) values (
          p_supplier_id, v_item.supplier_product_code, v_item.supplier_ean,
          trim(v_item.source_description), v_item.source_unit, v_item.product_id,
          v_product_unit, v_item.conversion_basis, v_item.conversion_factor,
          (select auth.uid())
        );
      else
        update public.payable_product_mappings
        set base_product_id = v_item.product_id, base_unit = v_product_unit,
            conversion_basis = v_item.conversion_basis, conversion_factor = v_item.conversion_factor,
            last_confirmed_at = now(), last_confirmed_by = (select auth.uid()), updated_at = now(), active = true
        where id = v_mapping_id;
      end if;
    end if;
  end loop;

  if round(v_total, 2) <> round(p_total_value, 2) then
    raise exception using errcode = '22023', message = 'A soma dos itens da NF-e não fecha com o total informado.';
  end if;

  for v_installment in
    select * from jsonb_to_recordset(p_installments) as installment(
      installment_number integer, due_date date, amount numeric
    )
  loop
    if v_installment.installment_number is null or v_installment.installment_number <= 0
       or v_installment.due_date is null or v_installment.amount is null or v_installment.amount <= 0 then
      raise exception using errcode = '22023', message = 'Parcela da NF-e com dados inválidos.';
    end if;
    v_installments_total := v_installments_total + round(v_installment.amount, 2);
  end loop;
  if round(v_installments_total, 2) <> round(p_total_value, 2) then
    raise exception using errcode = '22023', message = 'A soma das duplicatas precisa ser igual ao total da NF-e.';
  end if;

  begin
    insert into public.payable_purchases (
      request_id, store, supplier_id, purchase_date, origin, document_type,
      payment_method, status, total_value, notes, created_by,
      nfe_key, nfe_number, nfe_series, nfe_issued_at, classification_status
    ) values (
      p_request_id, 'jc', p_supplier_id, p_issue_date, 'xml', 'nfe',
      p_payment_method, 'aberta', round(p_total_value, 2), nullif(trim(p_notes), ''),
      (select auth.uid()), p_access_key, p_nfe_number, p_nfe_series, p_issue_date,
      v_classification_status
    ) returning id into v_purchase_id;
  exception when unique_violation then
    select purchase.id into v_purchase_id
    from public.payable_purchases purchase
    where purchase.request_id = p_request_id
    limit 1;
    if v_purchase_id is not null then return v_purchase_id; end if;
    if exists (select 1 from public.payable_purchases purchase where purchase.nfe_key = p_access_key) then
      raise exception using errcode = '23505', message = 'Esta NF-e já foi importada. A chave de acesso não pode ser repetida.';
    end if;
    raise;
  end;

  insert into public.payable_purchase_items (
    purchase_id, product_id, item_name, unit, quantity, unit_price,
    source_line_number, source_product_code, source_ean, source_description,
    source_unit, source_quantity, conversion_basis, conversion_factor,
    usable_quantity, normalized_unit_cost, category_snapshot, mapping_status,
    mapping_confirmed_at, mapping_confirmed_by
  )
  select
    v_purchase_id, item.product_id,
    case when item.product_id is null then item.source_description else product.name end,
    case when item.product_id is null then item.source_unit else coalesce(product.unit, 'un') end,
    item.source_quantity, item.unit_price, item.line_number, item.supplier_product_code,
    item.supplier_ean, item.source_description, item.source_unit, item.source_quantity,
    item.conversion_basis, item.conversion_factor, item.usable_quantity,
    case when item.usable_quantity > 0 then round(item.line_total / item.usable_quantity, 6) else null end,
    case when item.product_id is null then null else product.category end,
    case when item.product_id is null then 'pendente' else 'mapeado' end,
    case when item.product_id is null then null else now() end,
    case when item.product_id is null then null else (select auth.uid()) end
  from jsonb_to_recordset(p_items) as item(
    product_id uuid, source_description text, source_unit text, source_quantity numeric,
    line_number integer, supplier_product_code text, supplier_ean text,
    conversion_basis text, conversion_factor numeric, usable_quantity numeric,
    unit_price numeric, line_total numeric
  )
  left join public.products product on product.id = item.product_id;

  insert into public.payable_installments (purchase_id, installment_number, due_date, amount)
  select v_purchase_id, installment.installment_number, installment.due_date, round(installment.amount, 2)
  from jsonb_to_recordset(p_installments) as installment(
    installment_number integer, due_date date, amount numeric
  );

  insert into public.payable_events (purchase_id, event_type, details, occurred_by)
  values (
    v_purchase_id, 'criada',
    jsonb_build_object('origin', 'xml', 'nfe_key', p_access_key, 'classification_status', v_classification_status),
    (select auth.uid())
  );
  return v_purchase_id;
end;
$$;

create or replace function public.classify_payable_item(
  p_item_id uuid,
  p_product_id uuid,
  p_conversion_basis text,
  p_conversion_factor numeric,
  p_usable_quantity numeric,
  p_remember_conversion boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase_id uuid;
  v_supplier_id uuid;
  v_status text;
  v_source_code text;
  v_source_ean text;
  v_source_description text;
  v_source_unit text;
  v_product_name text;
  v_product_unit text;
  v_category text;
  v_line_total numeric;
  v_source_quantity numeric;
  v_mapping_id uuid;
begin
  if not private.current_user_can_payables('contas_pagar.lancar') then
    raise exception using errcode = '42501', message = 'Sem permissão para classificar item da NF-e.';
  end if;
  if p_conversion_basis not in ('simple', 'package', 'usable')
     or p_conversion_factor is null or p_conversion_factor <= 0
     or p_usable_quantity is null or p_usable_quantity <= 0 then
    raise exception using errcode = '22023', message = 'Conversão do item inválida.';
  end if;
  select item.purchase_id, purchase.supplier_id, purchase.status,
         item.source_product_code, item.source_ean, item.source_description,
         item.source_unit, item.line_total, item.source_quantity
    into v_purchase_id, v_supplier_id, v_status, v_source_code, v_source_ean,
         v_source_description, v_source_unit, v_line_total, v_source_quantity
  from public.payable_purchase_items item
  join public.payable_purchases purchase on purchase.id = item.purchase_id
  where item.id = p_item_id and purchase.origin = 'xml'
  for update of item, purchase;
  if v_purchase_id is null then
    raise exception using errcode = 'P0002', message = 'Item de NF-e não encontrado.';
  end if;
  if v_status = 'cancelada' then
    raise exception using errcode = '22023', message = 'Não é possível classificar uma conta cancelada.';
  end if;
  if not exists (select 1 from public.products product where product.id = p_product_id and product.active) then
    raise exception using errcode = '22023', message = 'Item-base inexistente ou inativo.';
  end if;
  select product.name, coalesce(product.unit, 'un'), coalesce(product.category, 'Outros')
    into v_product_name, v_product_unit, v_category
  from public.products product where product.id = p_product_id;
  update public.payable_purchase_items
  set product_id = p_product_id, item_name = v_product_name, unit = v_product_unit,
      conversion_basis = p_conversion_basis, conversion_factor = p_conversion_factor,
      usable_quantity = p_usable_quantity,
      normalized_unit_cost = round(v_line_total / p_usable_quantity, 6),
      category_snapshot = v_category, mapping_status = 'mapeado',
      mapping_confirmed_at = now(), mapping_confirmed_by = (select auth.uid())
  where id = p_item_id;
  update public.products
  set cost_price = round(v_line_total / p_usable_quantity, 2)
  where id = p_product_id;

  if coalesce(p_remember_conversion, false) then
    select mapping.id into v_mapping_id
    from public.payable_product_mappings mapping
    where mapping.supplier_id = v_supplier_id
      and mapping.purchase_unit = v_source_unit
      and (
        (v_source_code is not null and mapping.supplier_product_code = v_source_code)
        or (v_source_ean is not null and mapping.supplier_ean = v_source_ean)
        or (v_source_code is null and v_source_ean is null
            and lower(trim(mapping.supplier_description)) = lower(trim(v_source_description)))
      )
    order by mapping.updated_at desc
    limit 1;
    if v_mapping_id is null then
      insert into public.payable_product_mappings (
        supplier_id, supplier_product_code, supplier_ean, supplier_description,
        purchase_unit, base_product_id, base_unit, conversion_basis,
        conversion_factor, last_confirmed_by
      ) values (
        v_supplier_id, v_source_code, v_source_ean, v_source_description,
        v_source_unit, p_product_id, v_product_unit, p_conversion_basis,
        p_conversion_factor, (select auth.uid())
      );
    else
      update public.payable_product_mappings
      set base_product_id = p_product_id, base_unit = v_product_unit,
          conversion_basis = p_conversion_basis, conversion_factor = p_conversion_factor,
          last_confirmed_at = now(), last_confirmed_by = (select auth.uid()), updated_at = now(), active = true
      where id = v_mapping_id;
    end if;
  end if;

  update public.payable_purchases purchase
  set classification_status = case when not exists (
        select 1 from public.payable_purchase_items item
        where item.purchase_id = v_purchase_id and item.mapping_status = 'pendente'
      ) then 'completa' else 'pendente' end,
      updated_at = now()
  where purchase.id = v_purchase_id;
  insert into public.payable_events (purchase_id, event_type, details, occurred_by)
  values (
    v_purchase_id, 'corrigida',
    jsonb_build_object('item_id', p_item_id, 'product_id', p_product_id, 'usable_quantity', p_usable_quantity),
    (select auth.uid())
  );
end;
$$;

grant execute on function public.create_payable_catalog_product(text, text, text) to authenticated;
grant execute on function public.create_xml_payable(uuid, text, uuid, text, text, date, text, numeric, text, jsonb, jsonb) to authenticated;
grant execute on function public.classify_payable_item(uuid, uuid, text, numeric, numeric, boolean) to authenticated;
revoke all on function public.create_payable_catalog_product(text, text, text) from public;
revoke all on function public.create_xml_payable(uuid, text, uuid, text, text, date, text, numeric, text, jsonb, jsonb) from public;
revoke all on function public.classify_payable_item(uuid, uuid, text, numeric, numeric, boolean) from public;
grant execute on function public.create_payable_catalog_product(text, text, text) to authenticated;
grant execute on function public.create_xml_payable(uuid, text, uuid, text, text, date, text, numeric, text, jsonb, jsonb) to authenticated;
grant execute on function public.classify_payable_item(uuid, uuid, text, numeric, numeric, boolean) to authenticated;

commit;
