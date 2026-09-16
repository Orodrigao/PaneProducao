-- Fecha a trava do fator de conversão que falhava aberta em create_xml_payable.
--
-- O bloqueio só disparava quando factor_confirmed chegava explicitamente
-- `false`; item sem o campo (NULL) passava sem conferência, mesmo com a
-- unidade da NF-e em família diferente da receita. classify_payable_item já
-- usa coalesce(..., false) para o mesmo caso — aqui alinhamos o comportamento.
-- Rodrigo autorizou esta correção em 2026-09-02, liberada assim que a tela
-- nova de importação fosse ao ar (foi ao ar no mesmo dia). A coexistência com
-- o site antigo que motivava a folga não é mais necessária.
--
-- ATENÇÃO — revisão de 2026-09-16 corrigiu um engano: a versão de 11
-- parâmetros (a de 20260912233829_importacao_pendente_nfe.sql) foi dropada em
-- 20260913141048_custo_com_impostos_nfe.sql, que criou a assinatura vigente
-- de 13 parâmetros (com p_nfe_totals e p_issued_at). Esta migration parte
-- dessa versão vigente, não da antiga. Corpo idêntico ao de
-- 20260913141048_custo_com_impostos_nfe.sql (linhas 348-736), com a única
-- mudança na condição da trava de unidade (linha com "not coalesce").
-- `create or replace` preserva os grants já concedidos a essa assinatura em
-- 20260913141048 (linhas 981-982), sem precisar repeti-los aqui.

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
  p_installments jsonb,
  p_nfe_totals jsonb default null,
  p_issued_at timestamptz default null
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
  v_acquisition_total numeric(12,2);
  v_item record;
  v_installment record;
  v_product record;
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
  -- A mesma chave serializa a confirmação com o rascunho pendente desta nota:
  -- salvar e confirmar ao mesmo tempo nunca deixam rascunho vivo de nota já importada.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('payable-import-draft:' || p_access_key, 0)
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

  if p_nfe_totals is null then
    -- Envio do site anterior à fase 3A: nenhum valor fiscal pode chegar pela
    -- metade, sem o bloco de totais que permite conferi-lo.
    if exists (
      select 1 from jsonb_array_elements(p_items) element
      where jsonb_typeof(element) = 'object'
        and element ?| array[
          'fiscal_gross_value', 'icms_st', 'fcp_st', 'ipi', 'ipi_returned', 'freight', 'insurance',
          'other_expenses', 'import_tax', 'icms_exempt', 'deducts_exemption', 'composes_total'
        ]
    ) then
      raise exception using errcode = '22023',
        message = 'A NF-e chegou com valores fiscais sem o bloco de totais. Recarregue a página e importe de novo.';
    end if;
  else
    perform private.validate_nfe_fiscal_composition(p_items, p_nfe_totals, p_total_value);
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
      if private.unidade_familia(v_item.source_unit) is distinct from private.unidade_familia(v_product_unit)
         and private.unidade_familia(v_product_unit) <> 'desconhecida'
         and not coalesce(v_item.factor_confirmed, false) then
        raise exception using errcode = '22023',
          message = 'Confira quanto vem na embalagem: a NF-e cobra em ' || v_item.source_unit ||
                    ' e a receita usa ' || v_product_unit || '.';
      end if;
      -- O custo do insumo é aplicado depois de todos os itens gravados, por
      -- insumo: ver private.apply_xml_purchase_cost, mais abaixo.
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

  -- Sem bloco de totais, a regra de antes: soma dos itens igual ao total. Com o
  -- bloco, a composição já foi conferida e a soma do custo é verificada abaixo.
  if p_nfe_totals is null and round(v_total, 2) <> round(p_total_value, 2) then
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
      nfe_key, nfe_number, nfe_series, nfe_issued_at, classification_status,
      nfe_issued_timestamp
    ) values (
      p_request_id, 'jc', p_supplier_id, p_issue_date, 'xml', 'nfe',
      p_payment_method, 'aberta', round(p_total_value, 2), nullif(trim(p_notes), ''),
      (select auth.uid()), p_access_key, p_nfe_number, p_nfe_series, p_issue_date,
      v_classification_status, p_issued_at
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
    factor_confirmed_at, factor_confirmed_by,
    fiscal_gross_value, fiscal_icms_st, fiscal_ipi, fiscal_freight,
    fiscal_other_expenses, fiscal_cent_adjustment
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
    case when item.product_id is not null and coalesce(item.factor_confirmed, false) then (select auth.uid()) else null end,
    case when p_nfe_totals is null then null else round(item.fiscal_gross_value, 2) end,
    case when p_nfe_totals is null then 0 else round(item.icms_st, 2) end,
    case when p_nfe_totals is null then 0 else round(item.ipi, 2) end,
    case when p_nfe_totals is null then 0 else round(item.freight, 2) end,
    case when p_nfe_totals is null then 0 else round(item.other_expenses, 2) end,
    case when p_nfe_totals is null then 0 else coalesce(adjustment.ajuste_valor, 0) end
  from jsonb_to_recordset(p_items) as item(
    product_id uuid, source_description text, source_unit text, source_quantity numeric,
    line_number integer, supplier_product_code text, supplier_ean text,
    conversion_basis text, conversion_factor numeric, usable_quantity numeric,
    unit_price numeric, line_total numeric, discount_value numeric,
    factor_confirmed boolean, mapping_status text,
    fiscal_gross_value numeric, icms_st numeric, ipi numeric, freight numeric, other_expenses numeric
  )
  left join public.products product on product.id = item.product_id
  left join private.nfe_cent_adjustments(p_items, p_nfe_totals) adjustment
    on p_nfe_totals is not null and adjustment.ajuste_linha = item.line_number;

  if p_nfe_totals is not null then
    -- O custo unitário gravado no item passa a sair do valor de aquisição.
    update public.payable_purchase_items item
    set normalized_unit_cost = round(item.acquisition_value / item.usable_quantity, 6)
    where item.purchase_id = v_purchase_id and item.usable_quantity > 0;

    -- Defesa final: o que foi gravado como custo dos itens é exatamente o total
    -- da nota. Um centavo que não achou destino, ou imposto contado duas vezes,
    -- desfaz a importação inteira.
    select sum(item.acquisition_value) into v_acquisition_total
    from public.payable_purchase_items item
    where item.purchase_id = v_purchase_id;
    if v_acquisition_total is distinct from round(p_total_value, 2) then
      raise exception using errcode = '22023',
        message = 'O custo dos itens (' || private.reais_texto(v_acquisition_total)
                  || ') não fecha com o total da NF-e (' || private.reais_texto(p_total_value) || ').';
    end if;
  end if;

  -- Custo do insumo: um por insumo, em ordem, depois de todos os itens gravados.
  for v_product in
    select distinct item.product_id
    from public.payable_purchase_items item
    where item.purchase_id = v_purchase_id and item.product_id is not null and item.usable_quantity > 0
    order by item.product_id
  loop
    perform private.apply_xml_purchase_cost(v_purchase_id, v_product.product_id);
  end loop;

  insert into public.payable_installments (purchase_id, installment_number, due_date, amount)
  select v_purchase_id, installment.installment_number, installment.due_date, round(installment.amount, 2)
  from jsonb_to_recordset(p_installments) as installment(
    installment_number integer, due_date date, amount numeric
  );

  -- A confirmação fecha, na mesma transação, o rascunho pendente desta NF-e.
  update public.payable_import_drafts draft
  set status = 'confirmada', purchase_id = v_purchase_id, confirmed_at = now(),
      updated_at = now(), updated_by = (select auth.uid())
  where draft.nfe_key = p_access_key and draft.status = 'pendente';

  insert into public.payable_events (purchase_id, event_type, details, occurred_by)
  values (
    v_purchase_id, 'criada',
    jsonb_build_object(
      'origin', 'xml', 'nfe_key', p_access_key, 'classification_status', v_classification_status,
      'fiscal_composition', p_nfe_totals is not null
    ),
    (select auth.uid())
  );
  return v_purchase_id;
end;
$$;
