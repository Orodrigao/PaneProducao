-- Revenda sem cadastro, fase 2 (28/10/2026): o item de NF-e fora do cadastro
-- ganha o tipo.
--
-- Até aqui, todo item de NF-e sem produto e já resolvido (mapping_status =
-- 'nao_aplicavel') era "uso ou despesa". Mercadoria de revenda que a padaria
-- não quer cadastrar, como os suplementos da NF 5158 da Giants, não tinha
-- saída: ou virava produto, ou virava despesa. Decisão do Rodrigo (27/10 e
-- 28/10/2026): esses itens entram no Contas a pagar como revenda, sem cadastro
-- novo. Decisão técnica B, confirmada pela segunda opinião de outra família:
-- manter 'nao_aplicavel' ("fora do cadastro") e acrescentar o tipo.
--
--   * payable_purchase_items.non_catalog_kind: 'uso_despesa' ou 'revenda' no
--     item fora do cadastro, nulo em todos os outros. Um gatilho garante isso
--     também para os gravadores que não conhecem o tipo (o site anterior e
--     public.correct_payable_purchase_items, que é da fase 3): item que vira
--     'nao_aplicavel' sem tipo é uso ou despesa, como sempre foi; item que sai
--     de 'nao_aplicavel' perde o tipo que trazia. Tipo escrito de propósito num
--     item que não está fora do cadastro é recusado pelo check, não apagado.
--     Revenda sem cadastro não sai de fora do cadastro até a fase 3: a correção
--     de notas vigente a perderia no desfazer. Os itens que já estavam fora do
--     cadastro viram uso ou despesa: nada antigo muda de comportamento;
--   * payable_non_catalog_mappings.non_catalog_kind: a memória do fornecedor
--     guarda o tipo da última decisão. As memórias que existem são de uso ou
--     despesa;
--   * create_xml_payable, save_xml_import_draft e
--     classify_payable_item_without_product aceitam o tipo. As duas primeiras
--     recebem o tipo dentro da lista de itens (mesma assinatura); a terceira
--     ganha um parâmetro com padrão, e a versão de dois parâmetros sai na mesma
--     transação, para o PostgREST nunca ver duas candidatas. O site anterior,
--     que chama com dois parâmetros, continua gravando uso ou despesa, menos
--     quando isso apagaria uma revenda já decidida (memória do fornecedor ou
--     rascunho da nota): aí a gravação é recusada com o pedido de recarregar a
--     página. O site novo sempre manda o tipo; só o anterior o omite;
--   * a foto das memórias da correção de notas (private.memorias_do_item_nfe)
--     ganha non_catalog_kind; o campo kind continua 'uso_despesa' para toda
--     memória fora do cadastro, porque a correção vigente decide por ele quais
--     memórias desligar;
--   * o consumo semanal separa a revenda sem cadastro: o resumo do período
--     ganha a parte de revenda dentro do que não é estoque, e uma lista nova
--     mostra essas compras pela descrição da nota, porque não têm produto.
--
-- Revenda sem cadastro não tem produto, então não altera custo de receita, não
-- entra em contagem nem no CMV %. O valor de aquisição do item continua inteiro
-- (com os impostos e despesas da nota), e a categoria de DRE continua sendo da
-- conta, escolhida no Contas a pagar: nenhum estado de item escreve categoria.

begin;

-- ---------------------------------------------------------------------------
-- 1. Tipo no item da conta.
-- ---------------------------------------------------------------------------
alter table public.payable_purchase_items
  add column if not exists non_catalog_kind text;

comment on column public.payable_purchase_items.non_catalog_kind is
  'Item fora do cadastro (mapping_status nao_aplicavel): uso_despesa ou revenda. Nulo nos demais.';

create or replace function private.normalizar_tipo_fora_do_cadastro()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Revenda sem cadastro só sai de fora do cadastro pela correção de notas da
  -- fase 3, que leva o tipo à foto e ao desfazer. Até lá, a correção vigente
  -- (public.correct_payable_purchase_items) a trataria como uso ou despesa e o
  -- desfazer a devolveria como uso ou despesa: recusa aqui, para toda origem.
  if tg_op = 'UPDATE' and old.non_catalog_kind = 'revenda'
     and new.mapping_status is distinct from 'nao_aplicavel' then
    raise exception using errcode = '22023',
      message = 'Revenda sem cadastro ainda não pode ser trocada por produto: essa correção chega na próxima fase de Vínculos NF-e.';
  end if;
  if new.mapping_status = 'nao_aplicavel' then
    -- Quem marca fora do cadastro sem dizer o tipo é o gravador de antes desta
    -- fase: para ele, fora do cadastro sempre foi uso ou despesa.
    new.non_catalog_kind := coalesce(new.non_catalog_kind, 'uso_despesa');
  elsif tg_op = 'UPDATE' and new.non_catalog_kind is not distinct from old.non_catalog_kind then
    -- O item saiu de fora do cadastro e o tipo veio junto da linha antiga.
    new.non_catalog_kind := null;
  end if;
  return new;
end;
$$;

revoke all on function private.normalizar_tipo_fora_do_cadastro() from public, anon, authenticated;

drop trigger if exists normalizar_tipo_fora_do_cadastro on public.payable_purchase_items;
create trigger normalizar_tipo_fora_do_cadastro
before insert or update of mapping_status, non_catalog_kind on public.payable_purchase_items
for each row execute function private.normalizar_tipo_fora_do_cadastro();

-- Os itens que já estavam fora do cadastro eram todos uso ou despesa.
update public.payable_purchase_items
set non_catalog_kind = 'uso_despesa'
where mapping_status = 'nao_aplicavel' and non_catalog_kind is null;

alter table public.payable_purchase_items
  drop constraint if exists payable_purchase_items_non_catalog_kind_check;
alter table public.payable_purchase_items
  add constraint payable_purchase_items_non_catalog_kind_check
  check (
    (mapping_status = 'nao_aplicavel' and non_catalog_kind in ('uso_despesa', 'revenda'))
    or (mapping_status <> 'nao_aplicavel' and non_catalog_kind is null)
  );

-- ---------------------------------------------------------------------------
-- 2. Tipo na memória do fornecedor.
-- ---------------------------------------------------------------------------
alter table public.payable_non_catalog_mappings
  add column if not exists non_catalog_kind text not null default 'uso_despesa';

comment on column public.payable_non_catalog_mappings.non_catalog_kind is
  'Tipo da última decisão fora do cadastro deste item do fornecedor: uso_despesa ou revenda.';

alter table public.payable_non_catalog_mappings
  drop constraint if exists payable_non_catalog_mappings_kind_check;
alter table public.payable_non_catalog_mappings
  add constraint payable_non_catalog_mappings_kind_check
  check (non_catalog_kind in ('uso_despesa', 'revenda'));

-- ---------------------------------------------------------------------------
-- 3. create_xml_payable, a partir da versão vigente: o corpo de
--    20260916145213_trava_fator_conversao_nfe com a trava por request_id que
--    20260919235223_idempotencia_financeira_concorrente acrescentou por
--    substituição de texto (conferido contra produção em 30/10/2026: mesmo
--    md5 do corpo). Mudanças: cada item pode trazer non_catalog_kind; só item
--    fora do cadastro tem tipo, e sem tipo ele é uso ou despesa; o item e a
--    memória do fornecedor gravam o tipo. Mesma assinatura: `create or replace`
--    mantém os grants de 20260913141048.
-- ---------------------------------------------------------------------------
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
  perform private.lock_financial_request(p_request_id);
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
      mapping_status text,
      non_catalog_kind text
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
    -- Tipo só existe fora do cadastro. Sem tipo, fora do cadastro é uso ou
    -- despesa: é o que o site anterior a esta fase manda.
    if v_item.non_catalog_kind is not null
       and (v_item.mapping_status is distinct from 'nao_aplicavel'
            or v_item.non_catalog_kind not in ('uso_despesa', 'revenda')) then
      raise exception using errcode = '22023', message = 'Tipo do item fora do cadastro inválido.';
    end if;

    if v_item.mapping_status = 'nao_aplicavel' then
      if v_item.product_id is not null then
        raise exception using errcode = '22023', message = 'Item de uso ou despesa não pode alterar produto de receita.';
      end if;
      if v_item.conversion_factor is not null or v_item.usable_quantity is not null then
        raise exception using errcode = '22023', message = 'Item de uso ou despesa não possui conversão de receita.';
      end if;
      -- Sem o tipo é o site anterior, que só conhece uso ou despesa e leria a
      -- revenda lembrada ou salva no rascunho como uso ou despesa. Gravar assim
      -- apagaria a decisão: recusa e pede a tela nova.
      if v_item.non_catalog_kind is null and (
        exists (
          select 1 from public.payable_non_catalog_mappings mapping
          where mapping.active and mapping.non_catalog_kind = 'revenda'
            and mapping.supplier_id = p_supplier_id
            and mapping.purchase_unit = v_item.source_unit
            and (
              (v_item.supplier_product_code is not null and mapping.supplier_product_code = v_item.supplier_product_code)
              or (v_item.supplier_ean is not null and mapping.supplier_ean = v_item.supplier_ean)
              or (v_item.supplier_product_code is null and v_item.supplier_ean is null
                  and lower(trim(mapping.supplier_description)) = lower(trim(v_item.source_description)))
            )
        )
        or exists (
          select 1
          from public.payable_import_drafts draft
          cross join lateral jsonb_array_elements(
            case when jsonb_typeof(draft.item_decisions) = 'array' then draft.item_decisions else '[]'::jsonb end
          ) decision
          where draft.nfe_key = p_access_key and draft.status = 'pendente'
            and decision ->> 'line_number' = v_item.line_number::text
            and decision ->> 'non_catalog_kind' = 'revenda'
        )
      ) then
        raise exception using errcode = '22023',
          message = 'Esta tela foi aberta antes da revenda sem cadastro e trataria a revenda como uso ou despesa. Recarregue a página e confira a nota de novo.';
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
          purchase_unit, last_confirmed_by, non_catalog_kind
        ) values (
          p_supplier_id, v_item.supplier_product_code, v_item.supplier_ean,
          trim(v_item.source_description), v_item.source_unit, (select auth.uid()),
          coalesce(v_item.non_catalog_kind, 'uso_despesa')
        );
      else
        update public.payable_non_catalog_mappings
        set supplier_description = trim(v_item.source_description), active = true,
            non_catalog_kind = coalesce(v_item.non_catalog_kind, 'uso_despesa'),
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
    fiscal_other_expenses, fiscal_cent_adjustment, non_catalog_kind
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
    case when p_nfe_totals is null then 0 else coalesce(adjustment.ajuste_valor, 0) end,
    case when item.mapping_status = 'nao_aplicavel' then coalesce(item.non_catalog_kind, 'uso_despesa') end
  from jsonb_to_recordset(p_items) as item(
    product_id uuid, source_description text, source_unit text, source_quantity numeric,
    line_number integer, supplier_product_code text, supplier_ean text,
    conversion_basis text, conversion_factor numeric, usable_quantity numeric,
    unit_price numeric, line_total numeric, discount_value numeric,
    factor_confirmed boolean, mapping_status text, non_catalog_kind text,
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

-- ---------------------------------------------------------------------------
-- 4. save_xml_import_draft, a partir da versão vigente
--    (20260912233829_importacao_pendente_nfe). Mudança: a decisão de cada linha
--    pode trazer non_catalog_kind, conferido como na confirmação. O rascunho
--    guarda as decisões como chegaram; a retomada é que lê o tipo. Mesma
--    assinatura e grants.
-- ---------------------------------------------------------------------------
create or replace function public.save_xml_import_draft(
  p_access_key text,
  p_supplier_id uuid,
  p_supplier_name text,
  p_nfe_number text,
  p_nfe_series text,
  p_issue_date date,
  p_total_value numeric,
  p_xml_content text,
  p_item_decisions jsonb,
  p_installments jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft_id uuid;
  v_decision record;
  v_installment record;
begin
  if not private.current_user_can_payables('contas_pagar.importar_xml') then
    raise exception using errcode = '42501', message = 'Sem permissão para importar XML.';
  end if;
  if p_access_key !~ '^[0-9]{44}$' then
    raise exception using errcode = '22023', message = 'Chave da NF-e inválida.';
  end if;
  if nullif(trim(p_supplier_name), '') is null or p_issue_date is null
     or p_total_value is null or p_total_value <= 0 then
    raise exception using errcode = '22023', message = 'Fornecedor, data e valor total da NF-e são obrigatórios.';
  end if;
  if p_xml_content is null or length(p_xml_content) = 0 or length(p_xml_content) > 2000000 then
    raise exception using errcode = '22023', message = 'O XML da NF-e está vazio ou grande demais para guardar.';
  end if;
  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers supplier where supplier.id = p_supplier_id and supplier.active
  ) then
    raise exception using errcode = '22023', message = 'Fornecedor selecionado não existe ou está inativo.';
  end if;
  if jsonb_typeof(coalesce(p_item_decisions, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_installments, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'Decisões e parcelas do rascunho precisam ser listas.';
  end if;

  for v_decision in
    select * from jsonb_to_recordset(coalesce(p_item_decisions, '[]'::jsonb)) as decision(
      line_number integer,
      product_id uuid,
      conversion_basis text,
      conversion_factor numeric,
      mapping_status text,
      factor_confirmed boolean,
      remember_conversion boolean,
      non_catalog_kind text
    )
  loop
    if v_decision.line_number is null or v_decision.line_number <= 0 then
      raise exception using errcode = '22023', message = 'Linha do item inválida no rascunho.';
    end if;
    if v_decision.mapping_status is null
       or v_decision.mapping_status not in ('pendente', 'mapeado', 'nao_aplicavel') then
      raise exception using errcode = '22023', message = 'Classificação do item inválida.';
    end if;
    -- O tipo (uso ou despesa, ou revenda) só existe fora do cadastro. Rascunho
    -- salvo pelo site anterior não traz o tipo, e a retomada o lê como uso ou
    -- despesa.
    if v_decision.non_catalog_kind is not null
       and (v_decision.mapping_status <> 'nao_aplicavel'
            or v_decision.non_catalog_kind not in ('uso_despesa', 'revenda')) then
      raise exception using errcode = '22023', message = 'Tipo do item fora do cadastro inválido no rascunho.';
    end if;
    if v_decision.conversion_basis is not null
       and v_decision.conversion_basis not in ('simple', 'package', 'usable') then
      raise exception using errcode = '22023', message = 'Base de conversão inválida.';
    end if;
    if v_decision.conversion_factor is not null and v_decision.conversion_factor <= 0 then
      raise exception using errcode = '22023', message = 'Fator de conversão inválido.';
    end if;
    if v_decision.mapping_status = 'mapeado' then
      if v_decision.product_id is null or not exists (
        select 1 from public.products product where product.id = v_decision.product_id and product.active
      ) then
        raise exception using errcode = '22023', message = 'Item-base selecionado não existe ou está inativo.';
      end if;
      -- Item vinculado sem fator e base não é decisão: é rascunho de decisão.
      -- Guardar isso confirmaria na retomada um fator que ninguém escolheu.
      if v_decision.conversion_basis is null or v_decision.conversion_factor is null then
        raise exception using errcode = '22023', message = 'Item vinculado precisa de base e fator de conversão.';
      end if;
    elsif v_decision.product_id is not null then
      raise exception using errcode = '22023', message = 'Item pendente ou de uso/despesa não pode apontar para produto.';
    elsif v_decision.conversion_basis is not null or v_decision.conversion_factor is not null
       or coalesce(v_decision.factor_confirmed, false) then
      raise exception using errcode = '22023', message = 'Item pendente ou de uso/despesa não possui conversão.';
    end if;
  end loop;

  for v_installment in
    select * from jsonb_to_recordset(coalesce(p_installments, '[]'::jsonb)) as installment(
      installment_number integer,
      due_date date
    )
  loop
    if v_installment.installment_number is null or v_installment.installment_number <= 0 then
      raise exception using errcode = '22023', message = 'Parcela do rascunho inválida.';
    end if;
  end loop;

  -- Uma nota por vez: reenvio, duplo toque e confirmação simultânea encontram a
  -- mesma linha, e a verificação de "já importada" acontece dentro da trava.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('payable-import-draft:' || p_access_key, 0)
  );
  if exists (select 1 from public.payable_purchases purchase where purchase.nfe_key = p_access_key) then
    raise exception using errcode = '23505', message = 'Esta NF-e já foi importada. A chave de acesso não pode ser repetida.';
  end if;

  -- Dentro da trava por chave, o único pendente desta nota não muda de estado
  -- por outra sessão: descartar e confirmar tomam a mesma trava.
  select draft.id into v_draft_id
  from public.payable_import_drafts draft
  where draft.nfe_key = p_access_key and draft.status = 'pendente'
  for update;

  -- O site anterior relê a revenda do rascunho como uso ou despesa e salva sem
  -- o tipo: sobrescrever apagaria a decisão. Recusa e pede a tela nova.
  if v_draft_id is not null and exists (
    select 1
    from public.payable_import_drafts draft
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(draft.item_decisions) = 'array' then draft.item_decisions else '[]'::jsonb end
    ) saved
    cross join lateral jsonb_array_elements(coalesce(p_item_decisions, '[]'::jsonb)) incoming
    where draft.id = v_draft_id
      and saved ->> 'non_catalog_kind' = 'revenda'
      and incoming ->> 'line_number' = saved ->> 'line_number'
      and incoming ->> 'mapping_status' = 'nao_aplicavel'
      and incoming ->> 'non_catalog_kind' is null
  ) then
    raise exception using errcode = '22023',
      message = 'Esta tela foi aberta antes da revenda sem cadastro e trataria a revenda como uso ou despesa. Recarregue a página e confira a nota de novo.';
  end if;

  if v_draft_id is null then
    insert into public.payable_import_drafts (
      nfe_key, supplier_id, supplier_name, nfe_number, nfe_series, nfe_issued_at,
      total_value, xml_content, item_decisions, installments, created_by, updated_by
    ) values (
      p_access_key, p_supplier_id, trim(p_supplier_name), nullif(trim(p_nfe_number), ''),
      nullif(trim(p_nfe_series), ''), p_issue_date, round(p_total_value, 2), p_xml_content,
      coalesce(p_item_decisions, '[]'::jsonb), coalesce(p_installments, '[]'::jsonb),
      (select auth.uid()), (select auth.uid())
    ) returning id into v_draft_id;
  else
    update public.payable_import_drafts
    set supplier_id = p_supplier_id,
        supplier_name = trim(p_supplier_name),
        nfe_number = nullif(trim(p_nfe_number), ''),
        nfe_series = nullif(trim(p_nfe_series), ''),
        nfe_issued_at = p_issue_date,
        total_value = round(p_total_value, 2),
        xml_content = p_xml_content,
        item_decisions = coalesce(p_item_decisions, '[]'::jsonb),
        installments = coalesce(p_installments, '[]'::jsonb),
        updated_by = (select auth.uid()),
        updated_at = now()
    where id = v_draft_id and status = 'pendente';
    if not found then
      raise exception using errcode = 'P0001', message = 'O rascunho mudou de estado enquanto era salvo. Recarregue a tela e tente de novo.';
    end if;
  end if;
  return v_draft_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. classify_payable_item_without_product, a partir da versão vigente
--    (20261002223047_vinculos_nfe_corrigir_itens_notas). Mudanças: terceiro
--    parâmetro com o tipo (padrão: uso ou despesa, que é o que o site anterior
--    quer dizer com dois parâmetros); o item e a memória gravam o tipo; repetir
--    a mesma escolha continua sem efeito, e trocar o tipo de item já fora do
--    cadastro é recusado (a troca é da correção de notas, fase 3). A versão de
--    dois parâmetros sai: com as duas, a chamada de dois parâmetros do site
--    anterior seria ambígua para o PostgREST.
-- ---------------------------------------------------------------------------
drop function if exists public.classify_payable_item_without_product(uuid, boolean);

create function public.classify_payable_item_without_product(
  p_item_id uuid,
  p_remember_decision boolean,
  p_non_catalog_kind text default null
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
  v_current_kind text;
  v_kind text := coalesce(p_non_catalog_kind, 'uso_despesa');
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
  if v_kind not in ('uso_despesa', 'revenda') then
    raise exception using errcode = '22023', message = 'Tipo do item fora do cadastro inválido.';
  end if;
  -- Conta antes do item, a mesma ordem de public.correct_payable_purchase_items:
  -- travando o item antes, esta função e uma correção do mesmo item poderiam
  -- esperar uma pela outra (cada uma com metade das travas).
  perform 1 from public.payable_purchases purchase
  where purchase.id = (select item.purchase_id from public.payable_purchase_items item where item.id = p_item_id)
  for update;
  select item.purchase_id, purchase.supplier_id, purchase.status, item.mapping_status,
         item.non_catalog_kind, item.source_product_code, item.source_ean, item.source_description,
         item.source_unit, item.source_quantity
    into v_purchase_id, v_supplier_id, v_purchase_status, v_mapping_status,
         v_current_kind, v_source_code, v_source_ean, v_source_description, v_source_unit, v_source_quantity
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
  -- Repetir a mesma escolha (duplo toque) não é erro; trocar o tipo de um item
  -- já fora do cadastro não é classificação de pendente.
  if v_mapping_status = 'nao_aplicavel' then
    if v_current_kind = v_kind then return; end if;
    raise exception using errcode = '22023',
      message = 'Este item já foi classificado como '
                || case v_current_kind when 'revenda' then 'revenda sem cadastro' else 'uso ou despesa' end
                || '. Recarregue os itens pendentes.';
  end if;
  if v_mapping_status = 'mapeado' then
    raise exception using errcode = '22023', message = 'Este item já altera um produto de receita. Troque o vínculo pela tela de correção.';
  end if;
  -- Sem o tipo é o site anterior, que só conhece uso ou despesa: com a revenda
  -- lembrada para este item do fornecedor, gravar uso ou despesa trocaria a
  -- memória sem a pessoa ter visto a escolha de revenda.
  if p_non_catalog_kind is null and exists (
    select 1 from public.payable_non_catalog_mappings mapping
    where mapping.active and mapping.non_catalog_kind = 'revenda'
      and mapping.supplier_id = v_supplier_id
      and mapping.purchase_unit = v_source_unit
      and (
        (v_source_code is not null and mapping.supplier_product_code = v_source_code)
        or (v_source_ean is not null and mapping.supplier_ean = v_source_ean)
        or (v_source_code is null and v_source_ean is null
            and lower(trim(mapping.supplier_description)) = lower(trim(v_source_description)))
      )
  ) then
    raise exception using errcode = '22023',
      message = 'Esta tela foi aberta antes da revenda sem cadastro e trataria a revenda como uso ou despesa. Recarregue a página e confira a nota de novo.';
  end if;

  update public.payable_purchase_items
  set product_id = null, item_name = v_source_description, unit = v_source_unit,
      quantity = v_source_quantity, conversion_basis = null, conversion_factor = null,
      usable_quantity = null, normalized_unit_cost = null, category_snapshot = null,
      mapping_status = 'nao_aplicavel', non_catalog_kind = v_kind, mapping_confirmed_at = now(),
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
        purchase_unit, last_confirmed_by, non_catalog_kind
      ) values (
        v_supplier_id, v_source_code, v_source_ean, v_source_description,
        v_source_unit, (select auth.uid()), v_kind
      );
    else
      update public.payable_non_catalog_mappings
      set supplier_description = v_source_description, active = true, non_catalog_kind = v_kind,
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
    jsonb_build_object('item_id', p_item_id, 'classification', 'nao_aplicavel', 'non_catalog_kind', v_kind),
    (select auth.uid())
  );
end;
$$;

revoke all on function public.classify_payable_item_without_product(uuid, boolean, text) from public, anon;
grant execute on function public.classify_payable_item_without_product(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Foto das memórias da correção de notas, a partir da versão vigente
--    (20261019163500_vinculos_nfe_uso_despesa_insumo): a memória fora do
--    cadastro ganha non_catalog_kind. O campo kind segue 'uso_despesa' para
--    toda memória fora do cadastro: a correção vigente desliga por ele as
--    memórias do item que vira produto, e assim continua desligando também a
--    de revenda. A tela de Vínculos lê o tipo no campo novo.
-- ---------------------------------------------------------------------------
create or replace function private.memorias_do_item_nfe(p_item_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with source as (
    select item.source_product_code as code,
           item.source_ean as ean,
           item.source_description as description,
           item.source_unit as unit,
           purchase.supplier_id
    from public.payable_purchase_items item
    join public.payable_purchases purchase on purchase.id = item.purchase_id
    where item.id = p_item_id
  ),
  memories as (
    select jsonb_build_object(
             'kind', 'insumo',
             'mapping_id', mapping.id,
             'product_id', mapping.base_product_id,
             'product_name', product.name,
             'conversion_factor', mapping.conversion_factor,
             'version', mapping.updated_at at time zone 'UTC'
           ) as memory
    from source
    join public.payable_product_mappings mapping
      on mapping.supplier_id = source.supplier_id
     and mapping.purchase_unit = source.unit
     and mapping.active
     and (
       (source.code is not null and mapping.supplier_product_code = source.code)
       or (source.ean is not null and mapping.supplier_ean = source.ean)
       or (source.code is null and source.ean is null
           and lower(trim(mapping.supplier_description)) = lower(trim(source.description)))
     )
    left join public.products product on product.id = mapping.base_product_id
    union all
    select jsonb_build_object(
             'kind', 'uso_despesa',
             'non_catalog_kind', mapping.non_catalog_kind,
             'mapping_id', mapping.id,
             'product_id', null,
             'product_name', null,
             'conversion_factor', null,
             'version', mapping.updated_at at time zone 'UTC'
           )
    from source
    join public.payable_non_catalog_mappings mapping
      on mapping.supplier_id = source.supplier_id
     and mapping.purchase_unit = source.unit
     and mapping.active
     and (
       (source.code is not null and mapping.supplier_product_code = source.code)
       or (source.ean is not null and mapping.supplier_ean = source.ean)
       or (source.code is null and source.ean is null
           and lower(trim(mapping.supplier_description)) = lower(trim(source.description)))
     )
  )
  select coalesce(jsonb_agg(memories.memory order by memories.memory ->> 'kind', memories.memory ->> 'mapping_id'), '[]'::jsonb)
  from memories;
$$;

revoke all on function private.memorias_do_item_nfe(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Resumo do consumo semanal, a partir da versão vigente
--    (20260921190000_consumo_semanal_insumos). Mudança: a coluna
--    purchases_resale_no_catalog, a parte de revenda sem cadastro dentro de
--    purchases_not_stock. purchases_not_stock continua sendo tudo que está fora
--    do cadastro (uso ou despesa e revenda), para o site anterior e para a
--    prévia da correção de notas (private.consumo_semanal_dos_produtos_nfe)
--    seguirem fechando com o total. Coluna nova no resultado muda o tipo de
--    retorno, então a função é recriada e os grants repetidos.
-- ---------------------------------------------------------------------------
drop function if exists public.inventory_consumption_periods(text);

create function public.inventory_consumption_periods(p_store text default 'jc')
returns table (
  period_start_count_id uuid,
  period_end_count_id uuid,
  period_start_date date,
  period_end_date date,
  period_days integer,
  end_closed_at timestamptz,
  purchases_total numeric,
  purchases_counted numeric,
  purchases_outside_count numeric,
  purchases_unclassified numeric,
  purchases_not_stock numeric,
  purchases_resale_no_catalog numeric,
  unclassified_lines integer,
  late_lines integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_store is distinct from 'jc' then
    raise exception using errcode = '22023', message = 'Consumo semanal so existe para a JC nesta fase.';
  end if;

  if not private.current_user_can_payables('contas_pagar.acessar') then
    raise exception using errcode = '42501', message = 'Sem permissao para ver o consumo com custos.';
  end if;

  return query
  select period.start_count_id,
         period.end_count_id,
         period.start_date,
         period.end_date,
         (period.end_date - period.start_date)::integer,
         period.end_closed_at,
         coalesce(sum(line.valor), 0),
         coalesce(sum(line.valor) filter (where line.categoria = 'contado'), 0),
         coalesce(sum(line.valor) filter (where line.categoria = 'fora'), 0),
         coalesce(sum(line.valor) filter (where line.categoria = 'sem_classificacao'), 0),
         coalesce(sum(line.valor) filter (where line.categoria = 'nao_estoque'), 0),
         coalesce(sum(line.valor) filter (where line.categoria = 'nao_estoque' and line.revenda), 0),
         (count(line.item_id) filter (where line.categoria = 'sem_classificacao'))::integer,
         (count(line.item_id) filter (where line.atrasada))::integer
  from private.periodos_consumo_insumos(p_store) period
  left join lateral (
    select item.id as item_id,
           private.valor_linha_compra(item.acquisition_value, item.line_total, item.quantity, item.unit_price) as valor,
           purchase.created_at > period.end_closed_at as atrasada,
           item.non_catalog_kind = 'revenda' as revenda,
           case
             when item.mapping_status = 'nao_aplicavel' then 'nao_estoque'
             when item.product_id is null then 'sem_classificacao'
             when exists (
               select 1
               from public.inventory_weekly_count_items counted
               where counted.count_id = period.end_count_id
                 and counted.product_id = item.product_id
             ) then 'contado'
             else 'fora'
           end as categoria
    from public.payable_purchases purchase
    join public.payable_purchase_items item on item.purchase_id = purchase.id
    where purchase.store = p_store
      and purchase.status <> 'cancelada'
      and purchase.purchase_date > period.start_date
      and purchase.purchase_date <= period.end_date
  ) line on true
  group by period.start_count_id, period.end_count_id, period.start_date, period.end_date, period.end_closed_at
  order by period.end_date desc;
end;
$$;

revoke all on function public.inventory_consumption_periods(text) from public, anon;
grant execute on function public.inventory_consumption_periods(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Revenda sem cadastro em cada período, pela descrição da nota: esses itens
--    não têm produto, e a lista diz o que foi comprado, de quem e por quanto.
--    Fica fora do consumo e do CMV %: sem contagem, compra não prova venda.
--    Mesma janela, mesma regra de valor e mesma permissão das outras leituras
--    do consumo semanal.
-- ---------------------------------------------------------------------------
create function public.inventory_consumption_resale_items(
  p_store text default 'jc',
  p_end_count_id uuid default null
)
returns table (
  period_end_count_id uuid,
  supplier_name text,
  item_description text,
  item_unit text,
  purchases_count integer,
  quantity_purchased numeric,
  value_purchased numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_store is distinct from 'jc' then
    raise exception using errcode = '22023', message = 'Consumo semanal so existe para a JC nesta fase.';
  end if;

  if not private.current_user_can_payables('contas_pagar.acessar') then
    raise exception using errcode = '42501', message = 'Sem permissao para ver o consumo com custos.';
  end if;

  return query
  select period.end_count_id,
         coalesce(supplier_row.name, '(fornecedor nao identificado)'),
         coalesce(item.source_description, item.item_name),
         coalesce(item.source_unit, item.unit),
         count(distinct purchase.id)::integer,
         coalesce(sum(coalesce(item.source_quantity, item.quantity)), 0),
         coalesce(sum(private.valor_linha_compra(item.acquisition_value, item.line_total, item.quantity, item.unit_price)), 0)
  from private.periodos_consumo_insumos(p_store) period
  join public.payable_purchases purchase
    on purchase.store = p_store
   and purchase.status <> 'cancelada'
   and purchase.purchase_date > period.start_date
   and purchase.purchase_date <= period.end_date
  join public.payable_purchase_items item on item.purchase_id = purchase.id
  left join public.suppliers supplier_row on supplier_row.id = purchase.supplier_id
  where (p_end_count_id is null or period.end_count_id = p_end_count_id)
    and item.mapping_status = 'nao_aplicavel'
    and item.non_catalog_kind = 'revenda'
  group by period.end_count_id, period.end_date, purchase.supplier_id, supplier_row.name,
           coalesce(item.source_description, item.item_name), coalesce(item.source_unit, item.unit)
  order by period.end_date desc, 7 desc, 3, 2;
end;
$$;

revoke all on function public.inventory_consumption_resale_items(text, uuid) from public, anon;
grant execute on function public.inventory_consumption_resale_items(text, uuid) to authenticated;

commit;
