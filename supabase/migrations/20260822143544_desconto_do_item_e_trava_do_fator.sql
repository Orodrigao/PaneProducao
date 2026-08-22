-- O desconto do item da NF-e estava sendo jogado fora: line_total era uma coluna
-- gerada como quantidade x preco bruto, e o liquido calculado no navegador nunca
-- chegava ao banco. Em producao, 3 das 28 notas importadas tem itens somando
-- R$ 131,42 a mais que o total da propria nota.
--
-- E o fator de conversao 1 continuava passando em silencio quando a unidade da
-- NF-e e de outra familia que a da receita: foi assim que farinha em saco de
-- 25 kg ficou gravada a R$ 74,00 o quilo, em 49 de 72 vinculos. A trava existia
-- so na tela, e a tela fala direto com o banco.

begin;

-- 1. O desconto passa a ser guardado, e o valor do item passa a ser o liquido.

alter table public.payable_purchase_items
  add column if not exists discount_value numeric(12,2) not null default 0;

alter table public.payable_purchase_items
  drop constraint if exists payable_purchase_items_discount_value_check;
alter table public.payable_purchase_items
  add constraint payable_purchase_items_discount_value_check
  check (discount_value >= 0 and discount_value <= round(quantity * unit_price, 2));

-- Coluna gerada nao aceita alterar a expressao: e preciso recriar. Como o
-- desconto nasce zerado, toda linha existente mantem exatamente o valor de hoje
-- (as 3 notas com desconto perdido ficam para a fase de limpeza, com o registro
-- de que o valor por item nao e recuperavel do que foi guardado).
alter table public.payable_purchase_items drop column line_total;
alter table public.payable_purchase_items
  add column line_total numeric(12,2)
  generated always as (round(quantity * unit_price - discount_value, 2)) stored;

-- 2. Quem confirma o fator vira fato guardado, nao suposicao da tela.

alter table public.payable_purchase_items
  add column if not exists factor_confirmed_at timestamptz;
alter table public.payable_purchase_items
  add column if not exists factor_confirmed_by uuid references auth.users(id);

-- 3. Familia da unidade, para o banco decidir sozinho quando exigir conferencia.
--    ATENCAO: esta lista e a mesma de unitFamily em src/lib/nfeXml.ts. Divida
--    assumida e consciente: as duas precisam mudar juntas.

create or replace function private.unidade_familia(p_unidade text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case upper(translate(coalesce(trim(p_unidade), ''),
                              'ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç',
                              'AAAAEEIOOOUCaaaaeeioouc'))
    when 'KG' then 'peso'
    when 'QUILO' then 'peso'
    when 'QUILOS' then 'peso'
    when 'K' then 'peso'
    when 'G' then 'peso'
    when 'GR' then 'peso'
    when 'GRAMA' then 'peso'
    when 'GRAMAS' then 'peso'
    when 'L' then 'volume'
    when 'LT' then 'volume'
    when 'LITRO' then 'volume'
    when 'LITROS' then 'volume'
    when 'ML' then 'volume'
    when 'MILILITRO' then 'volume'
    when 'UN' then 'unidade'
    when 'UND' then 'unidade'
    when 'UNID' then 'unidade'
    when 'UNIDADE' then 'unidade'
    when 'UNIDADES' then 'unidade'
    when 'PC' then 'unidade'
    when 'PCT' then 'unidade'
    when 'PECA' then 'unidade'
    else 'desconhecida'
  end;
$$;

revoke all on function private.unidade_familia(text) from public;

-- 4. A funcao de importacao passa a receber o desconto e a confirmacao do fator.
--    Partiu da versao vigente (20260804111716) e o diff foi conferido: as unicas
--    diferencas sao os dois campos novos, as duas validacoes de valor e a trava
--    do fator.

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
      discount_value numeric,
      factor_confirmed boolean,
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
    if coalesce(v_item.discount_value, 0) < 0
       or round(coalesce(v_item.discount_value, 0), 2) > round(v_item.source_quantity * v_item.unit_price, 2) then
      raise exception using errcode = '22023', message = 'Desconto do item maior que o próprio item.';
    end if;
    -- Campo ausente significa site antigo ainda no ar: site e banco atualizam
    -- independentes no mesmo merge, e recusar a versao anterior travaria a
    -- operacao na janela entre os dois. Exigir o campo e a segunda fase.
    if v_item.discount_value is not null
       and round(v_item.line_total, 2) <> round(v_item.source_quantity * v_item.unit_price - v_item.discount_value, 2) then
      raise exception using errcode = '22023', message = 'O valor do item não confere com quantidade, preço e desconto.';
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
      -- A tela ja pergunta, mas o site fala direto com o banco: sem esta trava
      -- o fator 1 volta a passar sozinho e o saco de 25 kg vira 1 kg.
      if private.unidade_familia(v_item.source_unit) is distinct from private.unidade_familia(v_product_unit)
         and private.unidade_familia(v_product_unit) <> 'desconhecida'
         and v_item.factor_confirmed is not null and not v_item.factor_confirmed then
        raise exception using errcode = '22023',
          message = 'Confira quanto vem na embalagem: a NF-e cobra em ' || v_item.source_unit ||
                    ' e a receita usa ' || v_product_unit || '.';
      end if;
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
    mapping_confirmed_at, mapping_confirmed_by, discount_value,
    factor_confirmed_at, factor_confirmed_by
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
    case when item.product_id is null then null else (select auth.uid()) end,
    round(coalesce(item.discount_value, 0), 2),
    case when coalesce(item.factor_confirmed, false) then now() else null end,
    case when coalesce(item.factor_confirmed, false) then (select auth.uid()) else null end
  from jsonb_to_recordset(p_items) as item(
    product_id uuid, source_description text, source_unit text, source_quantity numeric,
    line_number integer, supplier_product_code text, supplier_ean text,
    conversion_basis text, conversion_factor numeric, usable_quantity numeric,
    unit_price numeric, line_total numeric, discount_value numeric, factor_confirmed boolean
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

grant execute on function public.create_xml_payable(uuid, text, uuid, text, text, date, text, numeric, text, jsonb, jsonb) to authenticated;
revoke all on function public.create_xml_payable(uuid, text, uuid, text, text, date, text, numeric, text, jsonb, jsonb) from public;
grant execute on function public.create_xml_payable(uuid, text, uuid, text, text, date, text, numeric, text, jsonb, jsonb) to authenticated;

commit;
