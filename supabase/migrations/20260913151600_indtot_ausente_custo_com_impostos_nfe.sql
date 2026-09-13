-- Fase 3A das compras por XML: marcador indTot ausente no item.
--
-- A conferência da composição (20260913141048) exigia indTot igual a 1 em todo
-- item. A tela, desde a fase 1, só bloqueia o item marcado como fora do total
-- (indTot 0) e aceita o marcador ausente. Com a regra do banco mais dura, nota
-- sem o marcador passava na tela e era recusada na confirmação: a prova no
-- preview isolado da PR 391 pegou isso em nota simples, sem acréscimo.
--
-- A regra passa a ser a mesma da tela: indTot 0 continua recusado; marcador
-- ausente é aceito. Isso não abre porta para diferença: um item que não
-- compusesse o total deixaria sobra, e a composição inteira ainda precisa fechar
-- com o total da nota, o que continua conferido abaixo.
--
-- Função copiada da versão de 20260913141048 com essa única troca.

begin;

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
    "services": "serviços", "products": "produtos", "discounts": "desconto",
    "icms_exempt": "ICMS desonerado"
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
    if (v_item ->> 'composes_total') = '0' then
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
        message = 'Os itens somam ' || private.reais_texto(v_items_sum) || ' de ' || (v_labels ->> split_part(v_key, ':', 1))
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

revoke all on function private.validate_nfe_fiscal_composition(jsonb, jsonb, numeric) from public, anon, authenticated;

commit;
