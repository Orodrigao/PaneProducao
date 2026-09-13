-- Fase 3A das compras por XML: o custo do insumo inclui os impostos não
-- recuperáveis e as despesas de aquisição (docs/COMPRAS_POR_XML.md).
--
-- A Pane & Salute está no Simples Nacional: ICMS-ST, IPI, frete e outras
-- despesas cobrados na NF-e de compra não voltam como crédito e são custo.
-- O ICMS próprio já está dentro do vProd e não soma de novo.
--
-- O que muda:
--   * o item da NF-e guarda os valores fiscais exatos da nota (vProd e cada
--     acréscimo), e o banco calcula o valor de aquisição; o custo sai dele, e
--     não de quantidade x preço reconstruídos com menos casas decimais;
--   * create_xml_payable recebe o bloco de totais e confere a composição campo
--     a campo (produtos, desconto, cada acréscimo e o total da nota). Casos sem
--     evidência real continuam recusados. Não há rateio de despesa comum: a
--     SEFAZ recusa total diferente da soma dos itens (534, 535, 536, 538, 604 e
--     862), com tolerância de um centavo, que vai para o item de maior valor;
--   * o custo do insumo passa a ser da NF-e mais recente: nota com emissão
--     anterior à última que já gravou custo daquele insumo entra como conta,
--     mas não troca o custo (decisão de Rodrigo em 2026-09-13). O mesmo insumo
--     em várias linhas da nota recebe o custo médio da nota;
--   * confirmar um rascunho confere também total e fornecedor com o rascunho.
--
-- Convivência: o site anterior não manda o bloco de totais e segue na regra de
-- hoje (soma dos itens igual ao total). Envio com valores fiscais pela metade é
-- recusado. Notas já lançadas não são reprocessadas.

begin;

-- ---------------------------------------------------------------------------
-- 1. Valores fiscais exatos do item.
-- ---------------------------------------------------------------------------

alter table public.payable_purchase_items
  add column if not exists fiscal_gross_value numeric(12,2),
  add column if not exists fiscal_icms_st numeric(12,2) not null default 0,
  add column if not exists fiscal_ipi numeric(12,2) not null default 0,
  add column if not exists fiscal_freight numeric(12,2) not null default 0,
  add column if not exists fiscal_other_expenses numeric(12,2) not null default 0,
  add column if not exists fiscal_cent_adjustment numeric(12,2) not null default 0,
  add column if not exists cost_applied boolean;

alter table public.payable_purchase_items
  drop constraint if exists payable_purchase_items_fiscal_values_check;
alter table public.payable_purchase_items
  add constraint payable_purchase_items_fiscal_values_check check (
    (fiscal_gross_value is null or fiscal_gross_value > 0)
    and fiscal_icms_st >= 0 and fiscal_ipi >= 0
    and fiscal_freight >= 0 and fiscal_other_expenses >= 0
    and abs(fiscal_cent_adjustment) <= 0.04
    and (
      fiscal_gross_value is not null
      or (fiscal_icms_st = 0 and fiscal_ipi = 0 and fiscal_freight = 0
          and fiscal_other_expenses = 0 and fiscal_cent_adjustment = 0)
    )
  );

-- Nulo nas compras anteriores à fase 3A: ali o custo continua sendo line_total.
alter table public.payable_purchase_items
  add column if not exists acquisition_value numeric(12,2)
  generated always as (
    fiscal_gross_value - discount_value + fiscal_icms_st + fiscal_ipi
    + fiscal_freight + fiscal_other_expenses + fiscal_cent_adjustment
  ) stored;

comment on column public.payable_purchase_items.fiscal_gross_value is
  'vProd do item, exatamente como na NF-e. Nulo em compra anterior à fase 3A.';
comment on column public.payable_purchase_items.fiscal_cent_adjustment is
  'Centavos da tolerância da SEFAZ entre o total da nota e a soma dos itens que caíram neste item.';
comment on column public.payable_purchase_items.acquisition_value is
  'O que a padaria pagou pelo item: vProd - desconto + ST + IPI + frete + outras despesas + ajuste de centavo.';
comment on column public.payable_purchase_items.cost_applied is
  'Se esta linha trocou o custo do insumo. Falso quando já havia NF-e mais recente do mesmo insumo; nulo antes da fase 3A.';

-- ---------------------------------------------------------------------------
-- 2. Conferência da composição da NF-e, campo a campo.
-- ---------------------------------------------------------------------------

create or replace function private.reais_texto(p_value numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'R$ ' || replace(pg_catalog.to_char(round(coalesce(p_value, 0), 2), 'FM999999999990.00'), '.', ',');
$$;

create or replace function private.validate_nfe_fiscal_composition(
  p_items jsonb,
  p_totals jsonb,
  p_total_value numeric
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_total_keys constant text[] := array[
    'products', 'discounts', 'icms_st', 'fcp_st', 'ipi', 'ipi_returned', 'freight',
    'insurance', 'other_expenses', 'import_tax', 'icms_exempt', 'services', 'total'
  ];
  v_item_keys constant text[] := array[
    'line_number', 'fiscal_gross_value', 'discount_value', 'line_total', 'icms_st', 'fcp_st',
    'ipi', 'ipi_returned', 'freight', 'insurance', 'other_expenses', 'import_tax', 'icms_exempt'
  ];
  v_unsupported constant text[] := array['fcp_st', 'ipi_returned', 'insurance', 'import_tax'];
  v_labels constant jsonb := '{
    "icms_st": "ICMS substituição tributária", "ipi": "IPI", "freight": "frete",
    "other_expenses": "outras despesas", "fcp_st": "fundo de combate à pobreza (ST)",
    "ipi_returned": "IPI devolvido", "insurance": "seguro", "import_tax": "imposto de importação",
    "services": "serviços"
  }'::jsonb;
  v_key text;
  v_item jsonb;
  v_items_sum numeric;
  v_declared numeric;
  v_expected numeric;
begin
  if p_totals is null or jsonb_typeof(p_totals) <> 'object' then
    raise exception using errcode = '22023', message = 'Bloco de totais da NF-e inválido.';
  end if;
  foreach v_key in array v_total_keys loop
    if jsonb_typeof(p_totals -> v_key) is distinct from 'number' or (p_totals ->> v_key)::numeric < 0 then
      raise exception using errcode = '22023',
        message = 'O bloco de totais da NF-e não informa ' || v_key || ' como valor. Uma NF-e autorizada sempre traz esse campo.';
    end if;
  end loop;
  foreach v_key in array v_unsupported || array['services'] loop
    if round((p_totals ->> v_key)::numeric, 2) <> 0 then
      raise exception using errcode = '22023',
        message = 'A NF-e traz ' || (v_labels ->> v_key) || ', um caso que o ERP ainda não sabe conferir. Lance esta compra à mão.';
    end if;
  end loop;
  if round((p_totals ->> 'total')::numeric, 2) <> round(p_total_value, 2) then
    raise exception using errcode = '22023', message = 'O total da NF-e não confere com o bloco de totais da nota.';
  end if;

  for v_item in select element from jsonb_array_elements(p_items) element loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode = '22023', message = 'Item da NF-e inválido.';
    end if;
    foreach v_key in array v_item_keys loop
      if jsonb_typeof(v_item -> v_key) is distinct from 'number' or (v_item ->> v_key)::numeric < 0 then
        raise exception using errcode = '22023', message = 'Item da NF-e sem o valor fiscal ' || v_key || '.';
      end if;
    end loop;
    if not (v_item ? 'deducts_exemption') or not (v_item ? 'composes_total') then
      raise exception using errcode = '22023', message = 'Item da NF-e sem os indicadores fiscais da nota.';
    end if;
    if (v_item ->> 'line_number')::numeric <= 0
       or (v_item ->> 'line_number')::numeric <> trunc((v_item ->> 'line_number')::numeric) then
      raise exception using errcode = '22023', message = 'Número de linha da NF-e inválido.';
    end if;
    if (v_item ->> 'fiscal_gross_value')::numeric <= 0 then
      raise exception using errcode = '22023', message = 'Item da NF-e com valor do produto inválido.';
    end if;
    foreach v_key in array v_unsupported loop
      if round((v_item ->> v_key)::numeric, 2) <> 0 then
        raise exception using errcode = '22023',
          message = 'A NF-e traz ' || (v_labels ->> v_key) || ', um caso que o ERP ainda não sabe conferir. Lance esta compra à mão.';
      end if;
    end loop;
    if (v_item ->> 'composes_total') is distinct from '1' then
      raise exception using errcode = '22023',
        message = 'O item ' || (v_item ->> 'line_number') || ' não está marcado como parte do total da nota (indTot), um caso que o ERP ainda não sabe conferir.';
    end if;
    if round((v_item ->> 'icms_exempt')::numeric, 2) <> 0 and (v_item ->> 'deducts_exemption') is distinct from '0' then
      raise exception using errcode = '22023',
        message = 'O item ' || (v_item ->> 'line_number') || ' tem ICMS desonerado que abate do total ou sem indicador, um caso que o ERP ainda não sabe conferir.';
    end if;
    if round((v_item ->> 'fiscal_gross_value')::numeric - (v_item ->> 'discount_value')::numeric, 2)
       <> round((v_item ->> 'line_total')::numeric, 2) then
      raise exception using errcode = '22023', message = 'O valor do item não confere com o valor do produto e o desconto da NF-e.';
    end if;
  end loop;

  if (select count(*) from jsonb_array_elements(p_items))
     <> (select count(distinct (element ->> 'line_number')::numeric) from jsonb_array_elements(p_items) element) then
    raise exception using errcode = '22023', message = 'A NF-e tem número de linha repetido.';
  end if;

  -- Produtos, desconto e desoneração: o total é exatamente a soma dos itens.
  foreach v_key in array array['products:fiscal_gross_value', 'discounts:discount_value', 'icms_exempt:icms_exempt'] loop
    select coalesce(sum(round((element ->> split_part(v_key, ':', 2))::numeric, 2)), 0)
      into v_items_sum
    from jsonb_array_elements(p_items) element;
    v_declared := round((p_totals ->> split_part(v_key, ':', 1))::numeric, 2);
    if v_items_sum <> v_declared then
      raise exception using errcode = '22023',
        message = 'Os itens somam ' || private.reais_texto(v_items_sum) || ' em ' || split_part(v_key, ':', 1)
                  || ', mas o total da nota informa ' || private.reais_texto(v_declared) || '.';
    end if;
  end loop;

  -- Acréscimos que entram no custo: a SEFAZ tolera um centavo entre total e itens.
  foreach v_key in array array['icms_st', 'ipi', 'freight', 'other_expenses'] loop
    select coalesce(sum(round((element ->> v_key)::numeric, 2)), 0)
      into v_items_sum
    from jsonb_array_elements(p_items) element;
    v_declared := round((p_totals ->> v_key)::numeric, 2);
    if abs(v_declared - v_items_sum) > 0.01 then
      raise exception using errcode = '22023',
        message = 'Os itens somam ' || private.reais_texto(v_items_sum) || ' de ' || (v_labels ->> v_key)
                  || ', mas o total da nota informa ' || private.reais_texto(v_declared) || '.';
    end if;
  end loop;

  v_expected := round((p_totals ->> 'products')::numeric, 2) - round((p_totals ->> 'discounts')::numeric, 2)
    + round((p_totals ->> 'icms_st')::numeric, 2) + round((p_totals ->> 'ipi')::numeric, 2)
    + round((p_totals ->> 'freight')::numeric, 2) + round((p_totals ->> 'other_expenses')::numeric, 2);
  if v_expected <> round((p_totals ->> 'total')::numeric, 2) then
    raise exception using errcode = '22023',
      message = private.reais_texto(abs(round((p_totals ->> 'total')::numeric, 2) - v_expected))
                || ' da nota ficaram sem explicação. Confira o arquivo com o fornecedor; se o XML estiver correto, a leitura do ERP está falhando.';
  end if;
end;
$$;

-- Tolerância de um centavo por campo entre o total e a soma dos itens. A mais,
-- vai para o item de maior valor líquido; a menos, sai do maior item que tem
-- aquele acréscimo. Empate vence a menor linha. É a mesma regra de
-- allocateItemCosts em src/lib/nfeComposition.ts; a diferença acima de um
-- centavo já foi recusada por validate_nfe_fiscal_composition.
create or replace function private.nfe_cent_adjustments(p_items jsonb, p_totals jsonb)
returns table (ajuste_linha integer, ajuste_valor numeric)
language sql
immutable
set search_path = ''
as $$
  with linha as (
    select (element ->> 'line_number')::integer as numero,
           round((element ->> 'fiscal_gross_value')::numeric, 2) - round((element ->> 'discount_value')::numeric, 2) as liquido,
           element
    from jsonb_array_elements(p_items) element
  ), campo as (
    select chave from (values ('icms_st'), ('ipi'), ('freight'), ('other_expenses')) as campos(chave)
  ), diferenca as (
    select campo.chave,
           round((p_totals ->> campo.chave)::numeric, 2)
             - coalesce(sum(round((linha.element ->> campo.chave)::numeric, 2)), 0) as valor
    from campo cross join linha
    group by campo.chave
  ), destino as (
    select distinct on (diferenca.chave) diferenca.chave, diferenca.valor, linha.numero
    from diferenca
    join linha on diferenca.valor > 0 or round((linha.element ->> diferenca.chave)::numeric, 2) >= 0.01
    where diferenca.valor <> 0
    order by diferenca.chave, linha.liquido desc, linha.numero asc
  )
  select destino.numero, sum(destino.valor)
  from destino
  group by destino.numero;
$$;

-- ---------------------------------------------------------------------------
-- 3. Custo do insumo: NF-e mais recente manda, custo médio da nota.
-- ---------------------------------------------------------------------------

-- Chamada somente pelas funções de importação e classificação, que já validaram
-- permissão. Trava o insumo antes de decidir: duas notas do mesmo insumo em
-- sessões diferentes não cruzam a leitura com a gravação.
create or replace function private.apply_xml_purchase_cost(p_purchase_id uuid, p_product_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_issue_date date;
  v_value numeric;
  v_quantity numeric;
  v_newer boolean;
begin
  perform 1 from public.products product where product.id = p_product_id for update;

  select purchase.nfe_issued_at into v_issue_date
  from public.payable_purchases purchase
  where purchase.id = p_purchase_id;

  select coalesce(sum(coalesce(item.acquisition_value, item.line_total)), 0), coalesce(sum(item.usable_quantity), 0)
    into v_value, v_quantity
  from public.payable_purchase_items item
  where item.purchase_id = p_purchase_id and item.product_id = p_product_id and item.usable_quantity > 0;

  select exists (
    select 1
    from public.payable_purchase_items other_item
    join public.payable_purchases other_purchase on other_purchase.id = other_item.purchase_id
    where other_item.product_id = p_product_id
      and other_item.usable_quantity > 0
      and other_purchase.id <> p_purchase_id
      and other_purchase.origin = 'xml'
      and other_purchase.status <> 'cancelada'
      and other_purchase.nfe_issued_at > v_issue_date
  ) into v_newer;

  if v_newer or v_quantity <= 0 then
    update public.payable_purchase_items item
    set cost_applied = false
    where item.purchase_id = p_purchase_id and item.product_id = p_product_id and item.usable_quantity > 0;
    return false;
  end if;

  update public.products
  set cost_price = round(v_value / v_quantity, 2)
  where id = p_product_id;
  update public.payable_purchase_items item
  set cost_applied = true
  where item.purchase_id = p_purchase_id and item.product_id = p_product_id and item.usable_quantity > 0;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. create_xml_payable, a partir da versão vigente (20260912233829).
-- ---------------------------------------------------------------------------
-- Mudanças: parâmetro p_nfe_totals (opcional, por convivência), conferência da
-- composição, valores fiscais gravados no item e custo aplicado depois de todos
-- os itens gravados, por insumo e em ordem. O restante é idêntico, inclusive a
-- trava do fator que falha aberta, que continua como PR própria.

drop function if exists public.create_xml_payable(uuid, text, uuid, text, text, date, text, numeric, text, jsonb, jsonb);

create function public.create_xml_payable(
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
  p_nfe_totals jsonb default null
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
         and v_item.factor_confirmed is not null and not v_item.factor_confirmed then
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

-- ---------------------------------------------------------------------------
-- 5. confirm_xml_import_draft, a partir da versão vigente (20260912233829).
-- ---------------------------------------------------------------------------
-- Mudanças: repassa p_nfe_totals e confere total e fornecedor com o rascunho
-- aberto, para a confirmação não poder trocar a nota que foi salva.

drop function if exists public.confirm_xml_import_draft(uuid, timestamptz, uuid, text, uuid, text, text, date, text, numeric, text, jsonb, jsonb);

create function public.confirm_xml_import_draft(
  p_draft_id uuid,
  p_expected_updated_at timestamptz,
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
  p_nfe_totals jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_nfe_key text;
  v_updated_at timestamptz;
  v_total_value numeric(12,2);
  v_supplier_id uuid;
begin
  if not private.current_user_can_payables('contas_pagar.importar_xml') then
    raise exception using errcode = '42501', message = 'Sem permissão para importar XML.';
  end if;
  if p_draft_id is null or p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'Rascunho de importação inválido.';
  end if;
  if p_supplier_id is null or p_access_key !~ '^[0-9]{44}$' then
    raise exception using errcode = '22023', message = 'Fornecedor e chave da NF-e são obrigatórios.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('payable-mapping-supplier:' || p_supplier_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('payable-import-draft:' || p_access_key, 0)
  );
  select draft.status, draft.nfe_key, draft.updated_at, draft.total_value, draft.supplier_id
    into v_status, v_nfe_key, v_updated_at, v_total_value, v_supplier_id
  from public.payable_import_drafts draft
  where draft.id = p_draft_id and draft.store = 'jc'
  for update;
  if v_nfe_key is null then
    raise exception using errcode = '22023', message = 'Rascunho de importação não encontrado.';
  end if;
  if v_nfe_key <> p_access_key then
    raise exception using errcode = '22023', message = 'A NF-e enviada não é a do rascunho aberto.';
  end if;
  if v_status <> 'pendente' then
    raise exception using errcode = 'P0001', message = 'Esta importação pendente foi descartada ou confirmada por outra pessoa. Recarregue a lista.';
  end if;
  if v_updated_at <> p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'Esta importação foi alterada por outra pessoa depois que você a abriu. Recarregue e confira de novo.';
  end if;
  if round(p_total_value, 2) is distinct from v_total_value then
    raise exception using errcode = '22023', message = 'O total enviado não é o do rascunho aberto. Recarregue e confira de novo.';
  end if;
  if v_supplier_id is not null and v_supplier_id <> p_supplier_id then
    raise exception using errcode = '22023',
      message = 'O fornecedor escolhido não é o que foi salvo no rascunho. Salve a importação de novo antes de confirmar.';
  end if;
  return public.create_xml_payable(
    p_request_id, p_access_key, p_supplier_id, p_nfe_number, p_nfe_series, p_issue_date,
    p_payment_method, p_total_value, p_notes, p_items, p_installments, p_nfe_totals
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. classify_payable_item, a partir da versão vigente (20260902142639).
-- ---------------------------------------------------------------------------
-- Mudanças: o custo do item classificado depois sai do valor de aquisição
-- (quando a compra tem os valores fiscais) e o custo do insumo segue a mesma
-- regra da importação. O restante é idêntico.

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
  v_item_value numeric;
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
         item.source_unit, coalesce(item.acquisition_value, item.line_total)
    into v_purchase_id, v_supplier_id, v_status, v_source_code, v_source_ean,
         v_source_description, v_source_unit, v_item_value
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
      normalized_unit_cost = round(v_item_value / p_usable_quantity, 6),
      category_snapshot = v_category, mapping_status = 'mapeado',
      mapping_confirmed_at = now(), mapping_confirmed_by = (select auth.uid()),
      factor_confirmed_at = case when coalesce(p_factor_confirmed, false) then now() else null end,
      factor_confirmed_by = case when coalesce(p_factor_confirmed, false) then (select auth.uid()) else null end
  where id = p_item_id;
  perform private.apply_xml_purchase_cost(v_purchase_id, p_product_id);

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

-- ---------------------------------------------------------------------------
-- 7. Privilégios explícitos.
-- ---------------------------------------------------------------------------

revoke all on function private.reais_texto(numeric) from public, anon, authenticated;
revoke all on function private.validate_nfe_fiscal_composition(jsonb, jsonb, numeric) from public, anon, authenticated;
revoke all on function private.nfe_cent_adjustments(jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.apply_xml_purchase_cost(uuid, uuid) from public, anon, authenticated;

revoke all on function public.create_xml_payable(uuid, text, uuid, text, text, date, text, numeric, text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.create_xml_payable(uuid, text, uuid, text, text, date, text, numeric, text, jsonb, jsonb, jsonb) to authenticated;
revoke all on function public.confirm_xml_import_draft(uuid, timestamptz, uuid, text, uuid, text, text, date, text, numeric, text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.confirm_xml_import_draft(uuid, timestamptz, uuid, text, uuid, text, text, date, text, numeric, text, jsonb, jsonb, jsonb) to authenticated;
revoke all on function public.classify_payable_item(uuid, uuid, text, numeric, numeric, boolean, boolean) from public, anon;
grant execute on function public.classify_payable_item(uuid, uuid, text, numeric, numeric, boolean, boolean) to authenticated;

commit;
