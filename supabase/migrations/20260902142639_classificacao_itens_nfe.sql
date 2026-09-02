-- Itens como limpeza, manutenção e materiais de uso precisam continuar
-- identificados exatamente como vieram na NF-e, mas não são produtos de
-- receita. Esta migração cria uma resolução explícita sem produto canônico,
-- memoriza essa decisão por fornecedor e fecha a trava do fator também na
-- classificação feita depois da importação.

begin;

alter table public.payable_purchase_items
  drop constraint if exists payable_purchase_items_mapping_status_check;
alter table public.payable_purchase_items
  add constraint payable_purchase_items_mapping_status_check
  check (mapping_status in ('pendente', 'mapeado', 'nao_aplicavel'));

alter table public.payable_product_mappings
  add column if not exists factor_confirmed boolean not null default false;

create table if not exists public.payable_non_catalog_mappings (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id),
  supplier_product_code text,
  supplier_ean text,
  supplier_description text not null check (nullif(trim(supplier_description), '') is not null),
  purchase_unit text not null check (nullif(trim(purchase_unit), '') is not null),
  active boolean not null default true,
  last_confirmed_at timestamptz not null default now(),
  last_confirmed_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payable_non_catalog_mappings_lookup_idx
  on public.payable_non_catalog_mappings (supplier_id, purchase_unit, supplier_product_code, supplier_ean);
create index if not exists payable_non_catalog_mappings_description_idx
  on public.payable_non_catalog_mappings (supplier_id, lower(supplier_description));

revoke all on table public.payable_non_catalog_mappings from public, anon, authenticated;
grant select on table public.payable_non_catalog_mappings to authenticated;
alter table public.payable_non_catalog_mappings enable row level security;
alter table public.payable_non_catalog_mappings force row level security;

create policy payable_non_catalog_mappings_select_finance
on public.payable_non_catalog_mappings for select to authenticated
using (private.current_user_can_payables('contas_pagar.acessar'));

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
  v_product_unit text;
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
  if v_purchase_id is not null then return v_purchase_id; end if;
  if exists (select 1 from public.payable_purchases purchase where purchase.nfe_key = p_access_key) then
    raise exception using errcode = '23505', message = 'Esta NF-e já foi importada. A chave de acesso não pode ser repetida.';
  end if;
  if p_supplier_id is null or not exists (
    select 1 from public.suppliers supplier where supplier.id = p_supplier_id and supplier.active
  ) then
    raise exception using errcode = '22023', message = 'Fornecedor ativo obrigatório.';
  end if;
  -- Uma única decisão de memória por fornecedor é gravada de cada vez. Isso
  -- fecha a corrida entre duas importações simultâneas sem serializar fornecedores diferentes.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('payable-mapping-supplier:' || p_supplier_id::text, 0)
  );
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
      discount_value numeric,
      factor_confirmed boolean,
      remember_conversion boolean,
      mapping_status text
    )
  loop
    if nullif(trim(v_item.source_description), '') is null
       or nullif(trim(v_item.source_unit), '') is null
       or v_item.source_quantity is null or v_item.source_quantity <= 0
       or v_item.line_total is null or v_item.line_total <= 0
       or v_item.unit_price is null or v_item.unit_price <= 0 then
      raise exception using errcode = '22023', message = 'Item da NF-e com dados financeiros inválidos.';
    end if;
    if coalesce(v_item.discount_value, 0) < 0
       or round(coalesce(v_item.discount_value, 0), 2) > round(v_item.source_quantity * v_item.unit_price, 2) then
      raise exception using errcode = '22023', message = 'Desconto do item maior que o próprio item.';
    end if;
    if v_item.discount_value is not null
       and round(v_item.line_total, 2) <> round(v_item.source_quantity * v_item.unit_price - v_item.discount_value, 2) then
      raise exception using errcode = '22023', message = 'O valor do item não confere com quantidade, preço e desconto.';
    end if;
    if v_item.mapping_status is not null
       and v_item.mapping_status not in ('pendente', 'mapeado', 'nao_aplicavel') then
      raise exception using errcode = '22023', message = 'Classificação do item inválida.';
    end if;

    if v_item.mapping_status = 'nao_aplicavel' then
      if v_item.product_id is not null then
        raise exception using errcode = '22023', message = 'Item de uso ou despesa não pode alterar produto de receita.';
      end if;
      if v_item.conversion_factor is not null or v_item.usable_quantity is not null then
        raise exception using errcode = '22023', message = 'Item de uso ou despesa não possui conversão de receita.';
      end if;
    elsif v_item.product_id is null then
      v_classification_status := 'pendente';
    else
      if not exists (select 1 from public.products product where product.id = v_item.product_id and product.active) then
        raise exception using errcode = '22023', message = 'Item-base selecionado não existe ou está inativo.';
      end if;
      if v_item.conversion_factor is null or v_item.conversion_factor <= 0
         or v_item.usable_quantity is null or v_item.usable_quantity <= 0 then
        raise exception using errcode = '22023', message = 'Confirme a conversão de todos os itens classificados.';
      end if;
      select coalesce(product.unit, 'un')
        into v_product_unit
      from public.products product where product.id = v_item.product_id;
      -- `coalesce` e nao `is not null`: campo ausente precisa valer o mesmo que
      -- "nao conferido", senao quem chama a funcao por fora da tela desliga a
      -- trava simplesmente omitindo a chave. A funcao irma
      -- `classify_payable_item` ja fecha assim, e trava que existe em um lado e
      -- falha aberta no outro nao protege nada (licao `validar-tambem-na-saida`).
      if private.unidade_familia(v_item.source_unit) is distinct from private.unidade_familia(v_product_unit)
         and private.unidade_familia(v_product_unit) <> 'desconhecida'
         and not coalesce(v_item.factor_confirmed, false) then
        raise exception using errcode = '22023',
          message = 'Confira quanto vem na embalagem: a NF-e cobra em ' || v_item.source_unit ||
                    ' e a receita usa ' || v_product_unit || '.';
      end if;
      update public.products
      set cost_price = round(v_item.line_total / v_item.usable_quantity, 2)
      where id = v_item.product_id;
    end if;
    v_total := v_total + round(v_item.line_total, 2);

    if coalesce(v_item.remember_conversion, false) and v_item.mapping_status = 'nao_aplicavel' then
      select mapping.id into v_mapping_id
      from public.payable_non_catalog_mappings mapping
      where mapping.supplier_id = p_supplier_id
        and mapping.purchase_unit = v_item.source_unit
        and (
          (v_item.supplier_product_code is not null and mapping.supplier_product_code = v_item.supplier_product_code)
          or (v_item.supplier_ean is not null and mapping.supplier_ean = v_item.supplier_ean)
          or (v_item.supplier_product_code is null and v_item.supplier_ean is null
              and lower(trim(mapping.supplier_description)) = lower(trim(v_item.source_description)))
        )
      order by mapping.updated_at desc limit 1;
      if v_mapping_id is null then
        insert into public.payable_non_catalog_mappings (
          supplier_id, supplier_product_code, supplier_ean, supplier_description,
          purchase_unit, last_confirmed_by
        ) values (
          p_supplier_id, v_item.supplier_product_code, v_item.supplier_ean,
          trim(v_item.source_description), v_item.source_unit, (select auth.uid())
        );
      else
        update public.payable_non_catalog_mappings
        set supplier_description = trim(v_item.source_description), active = true,
            last_confirmed_at = now(), last_confirmed_by = (select auth.uid()), updated_at = now()
        where id = v_mapping_id;
      end if;
      update public.payable_product_mappings mapping
      set active = false, updated_at = now()
      where mapping.active and mapping.supplier_id = p_supplier_id
        and mapping.purchase_unit = v_item.source_unit
        and (
          (v_item.supplier_product_code is not null and mapping.supplier_product_code = v_item.supplier_product_code)
          or (v_item.supplier_ean is not null and mapping.supplier_ean = v_item.supplier_ean)
          or (v_item.supplier_product_code is null and v_item.supplier_ean is null
              and lower(trim(mapping.supplier_description)) = lower(trim(v_item.source_description)))
        );
    elsif coalesce(v_item.remember_conversion, false) and v_item.product_id is not null then
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
      order by mapping.updated_at desc limit 1;
      if v_mapping_id is null then
        insert into public.payable_product_mappings (
          supplier_id, supplier_product_code, supplier_ean, supplier_description,
          purchase_unit, base_product_id, base_unit, conversion_basis,
          conversion_factor, factor_confirmed, last_confirmed_by
        ) values (
          p_supplier_id, v_item.supplier_product_code, v_item.supplier_ean,
          trim(v_item.source_description), v_item.source_unit, v_item.product_id,
          v_product_unit, v_item.conversion_basis, v_item.conversion_factor,
          coalesce(v_item.factor_confirmed, false), (select auth.uid())
        );
      else
        update public.payable_product_mappings
        set base_product_id = v_item.product_id, base_unit = v_product_unit,
            conversion_basis = v_item.conversion_basis, conversion_factor = v_item.conversion_factor,
            factor_confirmed = coalesce(v_item.factor_confirmed, false),
            last_confirmed_at = now(), last_confirmed_by = (select auth.uid()), updated_at = now(), active = true
        where id = v_mapping_id;
      end if;
      update public.payable_non_catalog_mappings mapping
      set active = false, updated_at = now()
      where mapping.active and mapping.supplier_id = p_supplier_id
        and mapping.purchase_unit = v_item.source_unit
        and (
          (v_item.supplier_product_code is not null and mapping.supplier_product_code = v_item.supplier_product_code)
          or (v_item.supplier_ean is not null and mapping.supplier_ean = v_item.supplier_ean)
          or (v_item.supplier_product_code is null and v_item.supplier_ean is null
              and lower(trim(mapping.supplier_description)) = lower(trim(v_item.source_description)))
        );
    end if;
    v_mapping_id := null;
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
    where purchase.request_id = p_request_id limit 1;
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
    mapping_confirmed_at, mapping_confirmed_by, discount_value,
    factor_confirmed_at, factor_confirmed_by
  )
  select
    v_purchase_id, item.product_id,
    case when item.product_id is null then item.source_description else product.name end,
    case when item.product_id is null then item.source_unit else coalesce(product.unit, 'un') end,
    item.source_quantity, item.unit_price, item.line_number, item.supplier_product_code,
    item.supplier_ean, item.source_description, item.source_unit, item.source_quantity,
    case when item.mapping_status = 'nao_aplicavel' then null else item.conversion_basis end,
    case when item.mapping_status = 'nao_aplicavel' then null else item.conversion_factor end,
    case when item.mapping_status = 'nao_aplicavel' then null else item.usable_quantity end,
    case when coalesce(item.mapping_status, 'mapeado') <> 'nao_aplicavel' and item.usable_quantity > 0
      then round(item.line_total / item.usable_quantity, 6) else null end,
    case when item.product_id is null then null else product.category end,
    case when item.mapping_status = 'nao_aplicavel' then 'nao_aplicavel'
         when item.product_id is null then 'pendente' else 'mapeado' end,
    case when item.product_id is not null or item.mapping_status = 'nao_aplicavel' then now() else null end,
    case when item.product_id is not null or item.mapping_status = 'nao_aplicavel' then (select auth.uid()) else null end,
    round(coalesce(item.discount_value, 0), 2),
    case when item.product_id is not null and coalesce(item.factor_confirmed, false) then now() else null end,
    case when item.product_id is not null and coalesce(item.factor_confirmed, false) then (select auth.uid()) else null end
  from jsonb_to_recordset(p_items) as item(
    product_id uuid, source_description text, source_unit text, source_quantity numeric,
    line_number integer, supplier_product_code text, supplier_ean text,
    conversion_basis text, conversion_factor numeric, usable_quantity numeric,
    unit_price numeric, line_total numeric, discount_value numeric,
    factor_confirmed boolean, mapping_status text
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
  p_remember_conversion boolean,
  p_factor_confirmed boolean
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
         item.source_unit, item.line_total
    into v_purchase_id, v_supplier_id, v_status, v_source_code, v_source_ean,
         v_source_description, v_source_unit, v_line_total
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
  if private.unidade_familia(v_source_unit) is distinct from private.unidade_familia(v_product_unit)
     and private.unidade_familia(v_product_unit) <> 'desconhecida'
     and not coalesce(p_factor_confirmed, false) then
    raise exception using errcode = '22023',
      message = 'Confira quanto vem na embalagem: a NF-e cobra em ' || v_source_unit ||
                ' e a receita usa ' || v_product_unit || '.';
  end if;

  update public.payable_purchase_items
  set product_id = p_product_id, item_name = v_product_name, unit = v_product_unit,
      conversion_basis = p_conversion_basis, conversion_factor = p_conversion_factor,
      usable_quantity = p_usable_quantity,
      normalized_unit_cost = round(v_line_total / p_usable_quantity, 6),
      category_snapshot = v_category, mapping_status = 'mapeado',
      mapping_confirmed_at = now(), mapping_confirmed_by = (select auth.uid()),
      factor_confirmed_at = case when coalesce(p_factor_confirmed, false) then now() else null end,
      factor_confirmed_by = case when coalesce(p_factor_confirmed, false) then (select auth.uid()) else null end
  where id = p_item_id;
  update public.products
  set cost_price = round(v_line_total / p_usable_quantity, 2)
  where id = p_product_id;

  if coalesce(p_remember_conversion, false) then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('payable-mapping-supplier:' || v_supplier_id::text, 0)
    );
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
    order by mapping.updated_at desc limit 1;
    if v_mapping_id is null then
      insert into public.payable_product_mappings (
        supplier_id, supplier_product_code, supplier_ean, supplier_description,
        purchase_unit, base_product_id, base_unit, conversion_basis,
        conversion_factor, factor_confirmed, last_confirmed_by
      ) values (
        v_supplier_id, v_source_code, v_source_ean, v_source_description,
        v_source_unit, p_product_id, v_product_unit, p_conversion_basis,
        p_conversion_factor, coalesce(p_factor_confirmed, false), (select auth.uid())
      );
    else
      update public.payable_product_mappings
      set base_product_id = p_product_id, base_unit = v_product_unit,
          conversion_basis = p_conversion_basis, conversion_factor = p_conversion_factor,
          factor_confirmed = coalesce(p_factor_confirmed, false),
          last_confirmed_at = now(), last_confirmed_by = (select auth.uid()), updated_at = now(), active = true
      where id = v_mapping_id;
    end if;
    update public.payable_non_catalog_mappings mapping
    set active = false, updated_at = now()
    where mapping.active and mapping.supplier_id = v_supplier_id
      and mapping.purchase_unit = v_source_unit
      and (
        (v_source_code is not null and mapping.supplier_product_code = v_source_code)
        or (v_source_ean is not null and mapping.supplier_ean = v_source_ean)
        or (v_source_code is null and v_source_ean is null
            and lower(trim(mapping.supplier_description)) = lower(trim(v_source_description)))
      );
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

-- Compatibilidade com a tela anterior: fator diferente de 1 só aparece quando
-- alguém o digitou. Fator 1 entre famílias distintas fica bloqueado até a tela
-- nova enviar a confirmação explícita.
create or replace function public.classify_payable_item(
  p_item_id uuid,
  p_product_id uuid,
  p_conversion_basis text,
  p_conversion_factor numeric,
  p_usable_quantity numeric,
  p_remember_conversion boolean
)
returns void
language sql
security definer
set search_path = ''
as $$
  select public.classify_payable_item(
    p_item_id, p_product_id, p_conversion_basis, p_conversion_factor,
    p_usable_quantity, p_remember_conversion, p_conversion_factor <> 1
  );
$$;

create or replace function public.classify_payable_item_without_product(
  p_item_id uuid,
  p_remember_decision boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase_id uuid;
  v_supplier_id uuid;
  v_purchase_status text;
  v_mapping_status text;
  v_source_code text;
  v_source_ean text;
  v_source_description text;
  v_source_unit text;
  v_source_quantity numeric;
  v_mapping_id uuid;
begin
  if not private.current_user_can_payables('contas_pagar.lancar') then
    raise exception using errcode = '42501', message = 'Sem permissão para classificar item da NF-e.';
  end if;
  select item.purchase_id, purchase.supplier_id, purchase.status, item.mapping_status,
         item.source_product_code, item.source_ean, item.source_description,
         item.source_unit, item.source_quantity
    into v_purchase_id, v_supplier_id, v_purchase_status, v_mapping_status,
         v_source_code, v_source_ean, v_source_description, v_source_unit, v_source_quantity
  from public.payable_purchase_items item
  join public.payable_purchases purchase on purchase.id = item.purchase_id
  where item.id = p_item_id and purchase.origin = 'xml'
  for update of item, purchase;
  if v_purchase_id is null then
    raise exception using errcode = 'P0002', message = 'Item de NF-e não encontrado.';
  end if;
  if v_purchase_status = 'cancelada' then
    raise exception using errcode = '22023', message = 'Não é possível classificar uma conta cancelada.';
  end if;
  if v_mapping_status = 'nao_aplicavel' then return; end if;
  if v_mapping_status = 'mapeado' then
    raise exception using errcode = '22023', message = 'Este item já altera um produto de receita. Troque o vínculo pela tela de correção.';
  end if;

  update public.payable_purchase_items
  set product_id = null, item_name = v_source_description, unit = v_source_unit,
      quantity = v_source_quantity, conversion_basis = null, conversion_factor = null,
      usable_quantity = null, normalized_unit_cost = null, category_snapshot = null,
      mapping_status = 'nao_aplicavel', mapping_confirmed_at = now(),
      mapping_confirmed_by = (select auth.uid()), factor_confirmed_at = null,
      factor_confirmed_by = null
  where id = p_item_id;

  if coalesce(p_remember_decision, false) then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('payable-mapping-supplier:' || v_supplier_id::text, 0)
    );
    select mapping.id into v_mapping_id
    from public.payable_non_catalog_mappings mapping
    where mapping.supplier_id = v_supplier_id
      and mapping.purchase_unit = v_source_unit
      and (
        (v_source_code is not null and mapping.supplier_product_code = v_source_code)
        or (v_source_ean is not null and mapping.supplier_ean = v_source_ean)
        or (v_source_code is null and v_source_ean is null
            and lower(trim(mapping.supplier_description)) = lower(trim(v_source_description)))
      )
    order by mapping.updated_at desc limit 1;
    if v_mapping_id is null then
      insert into public.payable_non_catalog_mappings (
        supplier_id, supplier_product_code, supplier_ean, supplier_description,
        purchase_unit, last_confirmed_by
      ) values (
        v_supplier_id, v_source_code, v_source_ean, v_source_description,
        v_source_unit, (select auth.uid())
      );
    else
      update public.payable_non_catalog_mappings
      set supplier_description = v_source_description, active = true,
          last_confirmed_at = now(), last_confirmed_by = (select auth.uid()), updated_at = now()
      where id = v_mapping_id;
    end if;
    update public.payable_product_mappings mapping
    set active = false, updated_at = now()
    where mapping.active and mapping.supplier_id = v_supplier_id
      and mapping.purchase_unit = v_source_unit
      and (
        (v_source_code is not null and mapping.supplier_product_code = v_source_code)
        or (v_source_ean is not null and mapping.supplier_ean = v_source_ean)
        or (v_source_code is null and v_source_ean is null
            and lower(trim(mapping.supplier_description)) = lower(trim(v_source_description)))
      );
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
    jsonb_build_object('item_id', p_item_id, 'classification', 'nao_aplicavel'),
    (select auth.uid())
  );
end;
$$;

create or replace function public.update_payable_product_mappings(
  p_product_id uuid,
  p_mappings jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mapping record;
begin
  if not exists (
    select 1 from public.app_profiles profile
    where profile.user_id = (select auth.uid()) and profile.active
      and profile.role in ('admin', 'financeiro')
      and coalesce(profile.allowed_routes, '[]'::jsonb) ? '/produtos'
  ) then
    raise exception using errcode = '42501', message = 'Sem permissão para corrigir conversões de compra.';
  end if;
  if p_product_id is null
     or not exists (select 1 from public.products product where product.id = p_product_id) then
    raise exception using errcode = '22023', message = 'Produto-base inválido.';
  end if;
  if jsonb_typeof(coalesce(p_mappings, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'Lista de conversões inválida.';
  end if;
  for v_mapping in
    select * from jsonb_to_recordset(coalesce(p_mappings, '[]'::jsonb)) as item(
      id uuid, conversion_basis text, conversion_factor numeric
    )
  loop
    if v_mapping.id is null
       or v_mapping.conversion_basis not in ('simple', 'package', 'usable')
       or v_mapping.conversion_factor is null or v_mapping.conversion_factor <= 0 then
      raise exception using errcode = '22023', message = 'Fator de conversão inválido.';
    end if;
    update public.payable_product_mappings mapping
    set conversion_basis = v_mapping.conversion_basis,
        conversion_factor = v_mapping.conversion_factor,
        factor_confirmed = true, last_confirmed_at = now(),
        last_confirmed_by = (select auth.uid()), updated_at = now()
    where mapping.id = v_mapping.id and mapping.base_product_id = p_product_id and mapping.active;
    if not found then
      raise exception using errcode = '22023', message = 'Conversão não pertence ao produto informado.';
    end if;
  end loop;
end;
$$;

revoke all on function public.create_xml_payable(uuid, text, uuid, text, text, date, text, numeric, text, jsonb, jsonb) from public, anon;
grant execute on function public.create_xml_payable(uuid, text, uuid, text, text, date, text, numeric, text, jsonb, jsonb) to authenticated;

revoke all on function public.classify_payable_item(uuid, uuid, text, numeric, numeric, boolean, boolean) from public, anon;
grant execute on function public.classify_payable_item(uuid, uuid, text, numeric, numeric, boolean, boolean) to authenticated;
revoke all on function public.classify_payable_item(uuid, uuid, text, numeric, numeric, boolean) from public, anon;
grant execute on function public.classify_payable_item(uuid, uuid, text, numeric, numeric, boolean) to authenticated;

revoke all on function public.classify_payable_item_without_product(uuid, boolean) from public, anon;
grant execute on function public.classify_payable_item_without_product(uuid, boolean) to authenticated;
revoke all on function public.update_payable_product_mappings(uuid, jsonb) from public, anon;
grant execute on function public.update_payable_product_mappings(uuid, jsonb) to authenticated;

commit;
