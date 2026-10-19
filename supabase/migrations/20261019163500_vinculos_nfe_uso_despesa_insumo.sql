-- Vínculos de NF-e, fase 5: item de nota entre uso ou despesa e insumo (19/10/2026).
--
-- Até aqui um item de NF-e marcado como "uso ou despesa" (detergente, papel
-- toalha, manutenção) que na verdade era insumo ou revenda (margarina, filé de
-- frango, queijo fatiado, bebida de revenda) não tinha conserto: a fase 4 só
-- corrige item já ligado a um produto. O mesmo vale no sentido contrário. Agora
-- Administração e o Financeiro autorizado (private.pode_corrigir_vinculos_nfe,
-- decisão do Rodrigo em 01/10/2026) corrigem pela tela Catálogo > Vínculos
-- NF-e, inclusive em conta já paga, com prévia financeira (decisão de
-- 28/09/2026):
--   * uso ou despesa -> produto ativo de compra, com fator;
--   * produto -> uso ou despesa;
--   * desfazer, como na fase 4.
--
-- A escrita continua só em public.correct_payable_purchase_items, redefinida a
-- partir da versão vigente (20261002223047_vinculos_nfe_corrigir_itens_notas).
-- Mudanças:
--   * pedido: cada item traz product_id e conversion_factor SEMPRE presentes;
--     product_id nulo explícito = uso ou despesa, e então o fator também é nulo.
--     Campo ausente, vazio ou com outro tipo é recusado;
--   * aceita item de uso ou despesa como origem; item pendente segue recusado
--     (a classificação é do Contas a pagar), com mensagem própria;
--   * virar uso ou despesa grava o item como classify_payable_item_without_product:
--     sem produto, fator, quantidade útil, custo e categoria, com nome e unidade
--     da nota. A quantidade nunca muda: o valor do item (line_total) sai dela;
--   * a sonda de custo da origem e o recálculo dos destinos tratam produto nulo
--     (is distinct from; destino só com produto);
--   * memória do fornecedor: ao corrigir item de uso ou despesa para um produto,
--     a memória de uso ou despesa ligada desse item do fornecedor é desligada na
--     mesma transação (a próxima nota não volta a sugerir uso ou despesa). A
--     memória de insumo continua só na função da fase 3; a prévia diz o que as
--     memórias ligadas vão sugerir na próxima nota. Desfazer não mexe em memória
--     (religar poderia deixar duas respostas ligadas);
--   * trava por fornecedor (a mesma fila payable-mapping-supplier: da importação,
--     da classificação e da fase 3) entre os itens e os produtos;
--   * prévia financeira no efeito (e no hash): por conta, situação, parcelas
--     pagas, juros, rateio de DRE e lançamentos do livro; por produto, custo
--     antes e depois; por contagem semanal fechada, consumo (quantidade, custo e
--     valor) dos produtos envolvidos e totais de compras antes e depois, só o que
--     mudou. Contas, parcelas, rateio e livro-caixa nunca mudam aqui: a
--     categoria de DRE é da conta, decidida no Contas a pagar;
--   * versões no hash: atualização da conta, parcelas, lançamentos ativos e
--     memórias. Baixa, reclassificação ou memória alteradas entre a prévia e a
--     confirmação dão PT409, mesmo que o resumo mostrado fosse igual;
--   * foto do item ganha situação, nome, unidade, quantidade, categoria e base
--     de conversão, para o desfazer voltar exatamente o que havia. Correções
--     antigas, sem esses campos, continuam desfazíveis como antes.

begin;

-- Foto de um item para o antes e o depois. O depois não leva os carimbos de
-- confirmação: eles são do momento da gravação e mudariam o hash entre a
-- prévia e a aplicação sem mudança real.
create or replace function private.foto_item_nfe(p_item_id uuid, p_with_confirmation boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
      'mapping_status', item.mapping_status,
      'product_id', item.product_id,
      'product_name', product.name,
      'product_unit', product.unit,
      'item_name', item.item_name,
      'unit', item.unit,
      'quantity', item.quantity,
      'category_snapshot', item.category_snapshot,
      'conversion_basis', item.conversion_basis,
      'conversion_factor', item.conversion_factor,
      'usable_quantity', item.usable_quantity,
      'normalized_unit_cost', item.normalized_unit_cost,
      'cost_applied', item.cost_applied
    ) || case when p_with_confirmation then jsonb_build_object(
      -- Em UTC explícito: o texto de timestamptz depende do fuso da sessão, e
      -- o hash da prévia precisa bater com o da confirmação.
      'mapping_confirmed_at', item.mapping_confirmed_at at time zone 'UTC',
      'mapping_confirmed_by', item.mapping_confirmed_by,
      'factor_confirmed_at', item.factor_confirmed_at at time zone 'UTC',
      'factor_confirmed_by', item.factor_confirmed_by
    ) else '{}'::jsonb end
  from public.payable_purchase_items item
  left join public.products product on product.id = item.product_id
  where item.id = p_item_id;
$$;

revoke all on function private.foto_item_nfe(uuid, boolean) from public, anon, authenticated;

-- Memórias LIGADAS que a importação usaria para este item do fornecedor, de
-- insumo e de uso ou despesa. Mesma regra de casamento das funções que gravam a
-- memória (create_xml_payable, classify_payable_item e
-- classify_payable_item_without_product): mesmo fornecedor e mesma unidade da
-- nota, e o código do fornecedor, o código de barras ou, sem nenhum dos dois, a
-- descrição igual. A memória guarda só GTIN válido (gatilho de 28/09/2026), então
-- "SEM GTIN" do item nunca casa.
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

-- Situação financeira de uma conta, para a prévia: a correção do item nunca
-- muda nada disto, mas quem corrige precisa ver em que pé a conta está. A
-- versão (não mostrada) entra no hash: baixa, correção de baixa,
-- reclassificação ou troca de conta entre a prévia e a confirmação dão PT409.
create or replace function private.situacao_financeira_compra_nfe(p_purchase_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'purchase_id', purchase.id,
    'status', purchase.status,
    'total_value', purchase.total_value,
    'competence_month', date_trunc('month', coalesce(purchase.nfe_issued_at, purchase.purchase_date))::date,
    'installments', (
      select count(*) from public.payable_installments installment
      where installment.purchase_id = purchase.id and installment.status <> 'cancelada'
    ),
    'installments_paid', (
      select count(*) from public.payable_installments installment
      where installment.purchase_id = purchase.id and installment.status = 'paga'
    ),
    'paid_total', (
      select coalesce(sum(installment.paid_amount), 0) from public.payable_installments installment
      where installment.purchase_id = purchase.id and installment.status = 'paga'
    ),
    'late_fees', (
      select coalesce(sum(greatest(installment.paid_amount - installment.amount, 0)), 0)
      from public.payable_installments installment
      where installment.purchase_id = purchase.id and installment.status = 'paga'
    ),
    'last_paid_date', (
      select max(installment.paid_date) from public.payable_installments installment
      where installment.purchase_id = purchase.id and installment.status = 'paga'
    ),
    'split', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'key', category.key, 'label', category.label, 'group', category.dre_group, 'amount', split.amount
             ) order by category.key), '[]'::jsonb)
      from public.payable_purchase_categories split
      join public.finance_categories category on category.id = split.category_id
      where split.purchase_id = purchase.id
    ),
    'ledger', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'key', ledger.key, 'label', ledger.label, 'competence_month', ledger.competence_month,
               'amount', ledger.amount
             ) order by ledger.key, ledger.competence_month), '[]'::jsonb)
      from (
        select category.key, category.label, entry.competence_month, sum(entry.amount) as amount
        from public.finance_entries entry
        join public.finance_categories category on category.id = entry.category_id
        where entry.source = 'contas_pagar'
          and entry.entry_type = 'lancamento'
          and entry.reversed_at is null
          and entry.source_ref in (
            select installment.id from public.payable_installments installment
            where installment.purchase_id = purchase.id
          )
        group by category.key, category.label, entry.competence_month
      ) ledger
    ),
    'version', jsonb_build_object(
      'updated_at', purchase.updated_at at time zone 'UTC',
      'finance_account_id', purchase.finance_account_id,
      'installments', (
        select coalesce(jsonb_agg(jsonb_build_array(
                 installment.id, installment.status, installment.amount, installment.paid_amount,
                 installment.paid_date, installment.paid_method
               ) order by installment.id), '[]'::jsonb)
        from public.payable_installments installment
        where installment.purchase_id = purchase.id
      ),
      'entries', (
        select coalesce(jsonb_agg(entry.id order by entry.id), '[]'::jsonb)
        from public.finance_entries entry
        where entry.source = 'contas_pagar'
          and entry.entry_type = 'lancamento'
          and entry.reversed_at is null
          and entry.source_ref in (
            select installment.id from public.payable_installments installment
            where installment.purchase_id = purchase.id
          )
      )
    )
  )
  from public.payable_purchases purchase
  where purchase.id = p_purchase_id;
$$;

revoke all on function private.situacao_financeira_compra_nfe(uuid) from public, anon, authenticated;

-- Consumo semanal (CMV real por inventário) dos produtos envolvidos, em todas as
-- contagens fechadas: uma nota antiga pode mudar o custo de referência de
-- semanas posteriores. Produto fora das contagens não tem linha de consumo; ele
-- aparece nos totais de compras do período ("fora da contagem").
-- Chamada só pela correção, que já conferiu a permissão; as funções do consumo
-- conferem de novo (contas_pagar.acessar ou administrador).
create or replace function private.consumo_semanal_dos_produtos_nfe(p_product_ids uuid[])
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  return jsonb_build_object(
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'period_end_count_id', consumption.period_end_count_id,
               'product_id', consumption.product_id,
               'product_name', consumption.product_name,
               'unit', consumption.unit,
               'qty_in', consumption.qty_in,
               'qty_consumed', consumption.qty_consumed,
               'unit_cost', consumption.unit_cost,
               'value_consumed', consumption.value_consumed,
               'status', consumption.status
             ) order by consumption.period_end_count_id, consumption.product_id), '[]'::jsonb)
      from public.inventory_consumption_items('jc', null) consumption
      where consumption.product_id = any(p_product_ids)
    ),
    'periods', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'period_end_count_id', period.period_end_count_id,
               'start_date', period.period_start_date,
               'end_date', period.period_end_date,
               'counted', period.purchases_counted,
               'outside', period.purchases_outside_count,
               'not_stock', period.purchases_not_stock,
               'unclassified', period.purchases_unclassified
             ) order by period.period_end_date, period.period_end_count_id), '[]'::jsonb)
      from public.inventory_consumption_periods('jc') period
    )
  );
end;
$$;

revoke all on function private.consumo_semanal_dos_produtos_nfe(uuid[]) from public, anon, authenticated;

create or replace function public.correct_payable_purchase_items(
  p_request_id uuid,
  p_mode text,
  p_items jsonb default null,
  p_undo_correction_id uuid default null,
  p_expected_impact_hash text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_uid uuid := (select auth.uid());
  v_action text;
  v_requested jsonb;
  v_element jsonb;
  v_existing public.payable_purchase_item_corrections%rowtype;
  v_undo public.payable_purchase_item_corrections%rowtype;
  v_line record;
  v_pair record;
  v_undone_item jsonb;
  v_from text;
  v_usable numeric;
  v_item_count integer;
  v_distinct_count integer;
  v_item_ids uuid[];
  v_product_ids uuid[];
  v_purchase_ids uuid[];
  v_supplier_ids uuid[];
  v_origins uuid[] := '{}';
  v_costs_before jsonb;
  v_items_before jsonb;
  v_memories_before jsonb;
  v_memories_off uuid[] := '{}';
  v_finance jsonb;
  v_consumption_before jsonb;
  v_consumption_after jsonb;
  v_consumption jsonb;
  v_items jsonb;
  v_products jsonb;
  v_decisions jsonb := '[]'::jsonb;
  v_impact jsonb;
  v_hash text;
  v_correction_id uuid;
  v_product uuid;
  v_supplier uuid;
  v_candidate uuid;
  v_source uuid;
  v_probe boolean;
  v_applied boolean;
begin
  if not private.pode_corrigir_vinculos_nfe() then
    raise exception using errcode = '42501', message = 'Sem permissão para corrigir itens de NF-e.';
  end if;
  if p_mode is null or p_mode not in ('previa', 'aplicar') then
    raise exception using errcode = '22023', message = 'Modo de correção inválido.';
  end if;
  if (p_items is null) = (p_undo_correction_id is null) then
    raise exception using errcode = '22023', message = 'Informe os itens a corrigir ou a correção a desfazer.';
  end if;
  if p_mode = 'aplicar' and (p_request_id is null or p_expected_impact_hash is null) then
    raise exception using errcode = '22023', message = 'Confira a prévia antes de confirmar.';
  end if;

  -- Fila única das correções de notas: duas correções nunca se cruzam nas
  -- travas de itens e produtos, e o pedido repetido é conferido em ordem.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('payable-item-correction', 0)
  );

  -- Pedido normalizado: ordenado por item, identificadores em minúsculas e
  -- fator com seis casas. É o que o histórico guarda e o replay compara.
  if p_undo_correction_id is not null then
    v_action := 'desfazer';
    select * into v_undo
    from public.payable_purchase_item_corrections correction
    where correction.id = p_undo_correction_id;
    if not found then
      raise exception using errcode = '22023', message = 'Correção não encontrada.';
    end if;
    if v_undo.action <> 'corrigir' then
      raise exception using errcode = '22023',
        message = 'Só uma correção pode ser desfeita. Para voltar de novo, faça uma correção nova.';
    end if;
    -- Volta o que estava gravado antes. product_id nulo = uso ou despesa. As
    -- fotos desta fase em diante (com mapping_status) trazem também nome,
    -- unidade, categoria e base, que voltam exatamente como eram,
    -- inclusive nulos; as da fase 4 não trazem, e o desfazer delas segue a
    -- regra da fase 4 (nome, unidade e categoria do cadastro, base mantida)
    -- com o pedido no formato da fase 4, para o replay de um desfazer
    -- antigo continuar devolvendo o que foi gravado.
    select jsonb_agg(jsonb_build_object(
        'item_id', entry ->> 'item_id',
        'product_id', entry -> 'before' ->> 'product_id',
        'conversion_factor', round((entry -> 'before' ->> 'conversion_factor')::numeric, 6),
        'usable_quantity', round((entry -> 'before' ->> 'usable_quantity')::numeric, 6)
      ) || case when entry -> 'before' ? 'mapping_status' then jsonb_build_object(
        'photo', true,
        'item_name', entry -> 'before' ->> 'item_name',
        'unit', entry -> 'before' ->> 'unit',
        'category_snapshot', entry -> 'before' ->> 'category_snapshot',
        'conversion_basis', entry -> 'before' ->> 'conversion_basis'
      ) else '{}'::jsonb end
      order by entry ->> 'item_id')
      into v_requested
    from jsonb_array_elements(v_undo.impact -> 'items') entry;
  else
    v_action := 'corrigir';
    if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 then
      raise exception using errcode = '22023', message = 'Escolha de 1 a 100 itens para corrigir.';
    end if;
    for v_element in select value from jsonb_array_elements(p_items) loop
      -- product_id e conversion_factor sempre presentes: um campo esquecido
      -- nunca vira "uso ou despesa" por acidente.
      if jsonb_typeof(v_element) is distinct from 'object'
         or coalesce(v_element ->> 'item_id', '') !~ c_uuid
         or not (v_element ? 'product_id')
         or not (v_element ? 'conversion_factor') then
        raise exception using errcode = '22023', message = 'Pedido de correção com item inválido.';
      end if;
      if jsonb_typeof(v_element -> 'product_id') = 'null' then
        if jsonb_typeof(v_element -> 'conversion_factor') is distinct from 'null' then
          raise exception using errcode = '22023',
            message = 'Item de uso ou despesa não tem fator: envie o fator vazio.';
        end if;
      else
        if jsonb_typeof(v_element -> 'product_id') is distinct from 'string'
           or (v_element ->> 'product_id') !~ c_uuid
           or jsonb_typeof(v_element -> 'conversion_factor') is distinct from 'number' then
          raise exception using errcode = '22023', message = 'Pedido de correção com item inválido.';
        end if;
        if (v_element ->> 'conversion_factor')::numeric <= 0
           or (v_element ->> 'conversion_factor')::numeric >= 100000000
           or (v_element ->> 'conversion_factor')::numeric <> round((v_element ->> 'conversion_factor')::numeric, 6) then
          raise exception using errcode = '22023',
            message = 'Informe quanto vem em cada unidade da nota: maior que zero e com até seis casas decimais.';
        end if;
      end if;
    end loop;
    select jsonb_agg(jsonb_build_object(
        'item_id', (entry ->> 'item_id')::uuid,
        'product_id', (entry ->> 'product_id')::uuid,
        'conversion_factor', round((entry ->> 'conversion_factor')::numeric, 6),
        'usable_quantity', null
      ) order by (entry ->> 'item_id')::uuid),
      count(*), count(distinct (entry ->> 'item_id')::uuid)
      into v_requested, v_item_count, v_distinct_count
    from jsonb_array_elements(p_items) entry;
    if v_item_count <> v_distinct_count then
      raise exception using errcode = '22023', message = 'O mesmo item aparece duas vezes no pedido.';
    end if;
  end if;

  -- Pedido repetido (toque duplo, rede que reenvia) devolve o que foi gravado,
  -- antes de qualquer conferência do estado atual. Identificador reaproveitado
  -- com outro conteúdo é recusado.
  if p_mode = 'aplicar' then
    select * into v_existing
    from public.payable_purchase_item_corrections correction
    where correction.request_id = p_request_id;
    if found then
      if v_existing.action = v_action
         and v_existing.undoes_correction_id is not distinct from p_undo_correction_id
         and v_existing.requested = v_requested
         and v_existing.impact_hash = p_expected_impact_hash then
        return jsonb_build_object(
          'mode', 'aplicar',
          'action', v_existing.action,
          'correction_id', v_existing.id,
          'impact', v_existing.impact,
          'impact_hash', v_existing.impact_hash,
          'replayed', true
        );
      end if;
      raise exception using errcode = '22023', message = 'Este pedido já foi usado em outra correção.';
    end if;
  end if;

  if v_action = 'desfazer' and exists (
    select 1 from public.payable_purchase_item_corrections correction
    where correction.undoes_correction_id = p_undo_correction_id
  ) then
    raise exception using errcode = '22023', message = 'Esta correção já foi desfeita.';
  end if;

  v_item_ids := array(
    select (entry ->> 'item_id')::uuid from jsonb_array_elements(v_requested) entry order by 1
  );

  begin
    -- Contas antes dos itens. classify_payable_item segura a conta e o item
    -- pendente e, ao recalcular o custo, mexe nos outros itens da mesma conta;
    -- se a correção segurasse um desses itens antes de esperar pela conta, as
    -- duas esperariam uma pela outra. Esperando pela conta sem segurar nenhum
    -- item dela, a correção só anda depois que a classificação termina.
    perform 1
    from public.payable_purchases purchase
    where purchase.id in (
      select item.purchase_id from public.payable_purchase_items item where item.id = any(v_item_ids)
    )
    order by purchase.id
    for update;
    perform 1
    from public.payable_purchase_items item
    where item.id = any(v_item_ids)
    order by item.id
    for update;

    -- Fornecedores depois dos itens e antes dos produtos: a mesma ordem de
    -- classify_payable_item e classify_payable_item_without_product (conta,
    -- item, fornecedor, produto). É a fila das memórias desse fornecedor; com
    -- ela, importação, classificação e a fase 3 não mudam a memória entre a
    -- foto da prévia e a gravação.
    v_supplier_ids := array(
      select distinct purchase.supplier_id
      from public.payable_purchases purchase
      where purchase.id in (
        select item.purchase_id from public.payable_purchase_items item where item.id = any(v_item_ids)
      )
        and purchase.supplier_id is not null
      order by 1
    );
    foreach v_supplier in array v_supplier_ids loop
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('payable-mapping-supplier:' || v_supplier::text, 0)
      );
    end loop;

    -- Produtos de origem e de destino travados ANTES de conferir o cadastro do
    -- destino: assim ninguém o transforma em kit ou fabricação própria entre a
    -- conferência e a gravação. Mesma ordem de create_xml_payable (por id).
    v_product_ids := array(
      select distinct product_id from (
        select item.product_id from public.payable_purchase_items item where item.id = any(v_item_ids)
        union
        select (entry ->> 'product_id')::uuid from jsonb_array_elements(v_requested) entry
      ) ids(product_id)
      where product_id is not null
      order by 1
    );
    perform 1 from public.products product
    where product.id = any(v_product_ids)
    order by product.id
    for update;

    -- Todas as contagens da JC, abertas e fechadas, seguram fechar e reabrir
    -- até o fim (close e reopen travam a linha da contagem): o consumo do antes
    -- e o do depois são medidos sobre as mesmas contagens fechadas. Uma contagem
    -- aberta e fechada por outra pessoa no meio da correção não entra na
    -- comparação: abrir fotografa os insumos contados (chave estrangeira para
    -- os produtos, que a correção já trava), então ela não traz linha dos
    -- produtos envolvidos, e os totais só comparam períodos que já existiam.
    perform 1 from public.inventory_weekly_counts count_row
    where count_row.store = 'jc'
    order by count_row.id
    for share;

    for v_line in
      select request.item_id, request.product_id, request.conversion_factor, request.usable_quantity,
             item.purchase_id, item.product_id as current_product_id, item.mapping_status,
             item.quantity, item.conversion_factor as current_factor,
             item.usable_quantity as current_usable,
             coalesce(item.acquisition_value, item.line_total) as item_value,
             purchase.origin, purchase.store, purchase.status,
             target.active as target_active, target.kind as target_kind,
             target.is_fabricacao_propria as target_own
      from jsonb_to_recordset(v_requested) as request(
        item_id uuid, product_id uuid, conversion_factor numeric, usable_quantity numeric
      )
      left join public.payable_purchase_items item on item.id = request.item_id
      left join public.payable_purchases purchase on purchase.id = item.purchase_id
      left join public.products target on target.id = request.product_id
      order by request.item_id
    loop
      if v_line.purchase_id is null then
        raise exception using errcode = '22023', message = 'Item de NF-e não encontrado.';
      end if;
      if v_line.origin <> 'xml' or v_line.store <> 'jc' then
        raise exception using errcode = '22023', message = 'Só itens de NF-e da JC são corrigidos aqui.';
      end if;
      if v_line.status = 'cancelada' then
        raise exception using errcode = '22023', message = 'Item de conta cancelada não é corrigido.';
      end if;
      if v_line.mapping_status = 'mapeado' and v_line.current_product_id is not null then
        v_from := 'produto';
      elsif v_line.mapping_status = 'nao_aplicavel' and v_line.current_product_id is null then
        v_from := 'uso_despesa';
      else
        raise exception using errcode = '22023',
          message = 'Item sem classificação: classifique em Contas a pagar.';
      end if;
      if v_line.product_id is not null and v_line.target_active is null then
        raise exception using errcode = '22023', message = 'O produto escolhido não existe.';
      end if;

      if v_action = 'corrigir' then
        if v_line.product_id is null then
          if v_from = 'uso_despesa' then
            raise exception using errcode = '22023', message = 'A correção não muda nada em um dos itens.';
          end if;
          v_usable := null;
        else
          if not v_line.target_active
             or coalesce(v_line.target_kind, '') not in ('insumo', 'final')
             or v_line.target_own then
            raise exception using errcode = '22023',
              message = 'Escolha um produto ativo que se compra: insumo ou revenda, sem kit nem fabricação própria.';
          end if;
          if v_from = 'produto' and v_line.product_id = v_line.current_product_id
             and v_line.conversion_factor = v_line.current_factor then
            raise exception using errcode = '22023', message = 'A correção não muda nada em um dos itens.';
          end if;
          v_usable := round(v_line.quantity * v_line.conversion_factor, 6);
          if v_usable is null or v_usable <= 0 or v_usable >= 100000000
             or round(v_line.item_value / v_usable, 6) >= 1000000 then
            raise exception using errcode = '22023',
              message = 'Com este fator a quantidade útil de um item fica fora do limite. Confira o fator.';
          end if;
        end if;
      else
        -- Desfazer só vale se o item ainda está exatamente como a correção o
        -- deixou; se alguém mexeu depois, voltar apagaria essa decisão. Foto
        -- antiga (fase 4) não tem a situação: era sempre item ligado.
        select entry -> 'after' into v_undone_item
        from jsonb_array_elements(v_undo.impact -> 'items') entry
        where (entry ->> 'item_id')::uuid = v_line.item_id;
        if coalesce(v_undone_item ->> 'mapping_status', 'mapeado') is distinct from v_line.mapping_status
           or (v_undone_item ->> 'product_id')::uuid is distinct from v_line.current_product_id
           or (v_undone_item ->> 'conversion_factor')::numeric is distinct from v_line.current_factor
           or (v_undone_item ->> 'usable_quantity')::numeric is distinct from v_line.current_usable then
          raise exception using errcode = '22023',
            message = 'Um item mudou depois desta correção; ela não pode mais ser desfeita.';
        end if;
        -- Mesmo valor não basta: uma correção mais nova que voltou o item ao
        -- mesmo produto e fator também seria apagada. Itens classificados só
        -- mudam por esta função, então o histórico diz se houve correção depois.
        if exists (
          select 1 from public.payable_purchase_item_corrections later
          where later.corrected_at > v_undo.corrected_at
            and later.impact -> 'items' @> jsonb_build_array(jsonb_build_object('item_id', v_line.item_id))
        ) then
          raise exception using errcode = '22023',
            message = 'Um item foi corrigido de novo depois desta correção; desfaça a correção mais nova.';
        end if;
        -- Volta exatamente o que estava gravado, inclusive sem fator ou sem
        -- quantidade útil (item antigo incompleto): já coube nas colunas.
        v_usable := v_line.usable_quantity;
      end if;
    end loop;

    -- Foto do antes: custos, itens, memórias ligadas, contas e consumo.
    select jsonb_object_agg(product.id::text, product.cost_price) into v_costs_before
    from public.products product where product.id = any(v_product_ids);
    select jsonb_object_agg(item.id::text, private.foto_item_nfe(item.id, true)),
           jsonb_object_agg(item.id::text, private.memorias_do_item_nfe(item.id))
      into v_items_before, v_memories_before
    from public.payable_purchase_items item where item.id = any(v_item_ids);
    v_purchase_ids := array(
      select distinct item.purchase_id from public.payable_purchase_items item
      where item.id = any(v_item_ids) order by 1
    );
    select coalesce(jsonb_agg(private.situacao_financeira_compra_nfe(purchase_id) order by purchase_id), '[]'::jsonb)
      into v_finance
    from unnest(v_purchase_ids) as purchase_id;
    v_consumption_before := private.consumo_semanal_dos_produtos_nfe(v_product_ids);

    -- Origens: o item que sai era o que deu o custo? Sonda num bloco sempre
    -- desfeito; só o resultado sobrevive. "Sai" inclui virar uso ou despesa.
    for v_pair in
      select distinct item.purchase_id, item.product_id
      from public.payable_purchase_items item
      join jsonb_to_recordset(v_requested) as request(item_id uuid, product_id uuid)
        on request.item_id = item.id
      where item.product_id is not null
        and request.product_id is distinct from item.product_id
        and item.cost_applied
      order by item.product_id, item.purchase_id
    loop
      v_probe := false;
      begin
        v_probe := private.apply_xml_purchase_cost(v_pair.purchase_id, v_pair.product_id);
        raise exception using errcode = 'PNSND', message = 'sonda';
      exception when sqlstate 'PNSND' then
        null;
      end;
      if v_probe and not (v_pair.product_id = any(v_origins)) then
        v_origins := v_origins || v_pair.product_id;
      end if;
    end loop;

    -- Move todos os itens antes de recalcular qualquer custo. Primeiro os que
    -- vão para um produto...
    update public.payable_purchase_items item
    set product_id = target.id,
        -- Desfazer com foto completa volta nome, unidade, categoria e base
        -- exatamente como estavam; o resto segue o cadastro de destino. A
        -- quantidade nunca muda aqui: o valor do item (line_total) sai dela.
        item_name = case when v_action = 'desfazer' and request.photo then request.item_name else target.name end,
        unit = case when v_action = 'desfazer' and request.photo then request.unit else coalesce(target.unit, 'un') end,
        category_snapshot = case when v_action = 'desfazer' and request.photo then request.category_snapshot
                                 else coalesce(target.category, 'Outros') end,
        mapping_status = 'mapeado',
        -- Item que vem de uso ou despesa não tem base e ganha a da fatoração:
        -- igual (fator 1) ou embalagem.
        conversion_basis = case
          when v_action = 'desfazer' and request.photo then request.conversion_basis
          else coalesce(item.conversion_basis, case when request.conversion_factor = 1 then 'simple' else 'package' end)
        end,
        conversion_factor = request.conversion_factor,
        -- Corrigir calcula a quantidade útil pelo fator; desfazer volta a gravada.
        usable_quantity = case when v_action = 'desfazer' then request.usable_quantity
                               else round(item.quantity * request.conversion_factor, 6) end,
        normalized_unit_cost = round(
          coalesce(item.acquisition_value, item.line_total)
          / nullif(case when v_action = 'desfazer' then request.usable_quantity
                        else round(item.quantity * request.conversion_factor, 6) end, 0), 6),
        mapping_confirmed_at = now(),
        mapping_confirmed_by = v_uid,
        factor_confirmed_at = case when request.conversion_factor is null then null else now() end,
        factor_confirmed_by = case when request.conversion_factor is null then null else v_uid end
    from jsonb_to_recordset(v_requested) as request(
      item_id uuid, product_id uuid, conversion_factor numeric, usable_quantity numeric,
      photo boolean, item_name text, unit text, category_snapshot text, conversion_basis text
    )
    join public.products target on target.id = request.product_id
    where item.id = request.item_id;

    -- ...depois os que viram uso ou despesa, gravados como
    -- classify_payable_item_without_product: nome e unidade da nota, sem
    -- produto. Desfazer com foto completa volta nome e unidade gravados. A
    -- quantidade não muda: o valor do item sai dela, e nas notas XML ela é
    -- sempre a quantidade da nota.
    update public.payable_purchase_items item
    set product_id = null,
        item_name = case when v_action = 'desfazer' and request.photo then request.item_name
                         else coalesce(item.source_description, item.item_name) end,
        unit = case when v_action = 'desfazer' and request.photo then request.unit
                    else coalesce(item.source_unit, item.unit) end,
        conversion_basis = null,
        conversion_factor = null,
        usable_quantity = null,
        normalized_unit_cost = null,
        category_snapshot = null,
        cost_applied = null,
        mapping_status = 'nao_aplicavel',
        mapping_confirmed_at = now(),
        mapping_confirmed_by = v_uid,
        factor_confirmed_at = null,
        factor_confirmed_by = null
    from jsonb_to_recordset(v_requested) as request(
      item_id uuid, product_id uuid, photo boolean, item_name text, unit text
    )
    where item.id = request.item_id
      and request.product_id is null;

    -- Destinos: regra da NF mais recente, nota a nota.
    for v_pair in
      select distinct item.purchase_id, item.product_id
      from public.payable_purchase_items item
      where item.id = any(v_item_ids)
        and item.product_id is not null
      order by item.product_id, item.purchase_id
    loop
      v_applied := private.apply_xml_purchase_cost(v_pair.purchase_id, v_pair.product_id);
      v_decisions := v_decisions || jsonb_build_object(
        'product_id', v_pair.product_id, 'kind', 'destino',
        'purchase_id', v_pair.purchase_id, 'cost_from_this_note', v_applied
      );
    end loop;

    -- Origens que perderam a nota do custo: NF mais recente que sobrou.
    foreach v_product in array array(select unnest(v_origins) order by 1) loop
      v_source := null;
      v_applied := false;
      for v_candidate in
        select purchase.id
        from public.payable_purchases purchase
        where purchase.origin = 'xml' and purchase.status <> 'cancelada'
          and exists (
            select 1 from public.payable_purchase_items other
            where other.purchase_id = purchase.id and other.product_id = v_product
              and other.usable_quantity > 0
          )
        order by purchase.nfe_issued_at desc nulls last,
                 purchase.nfe_issued_timestamp desc nulls last,
                 purchase.created_at desc, purchase.id
      loop
        v_source := v_candidate;
        if private.apply_xml_purchase_cost(v_candidate, v_product) then
          v_applied := true;
          exit;
        end if;
      end loop;
      if v_source is not null and not v_applied then
        raise exception using errcode = '22023',
          message = 'Não foi possível decidir qual nota restante é a mais recente de um produto (notas do mesmo dia sem hora). Nada foi gravado.';
      end if;
      v_decisions := v_decisions || jsonb_build_object(
        'product_id', v_product,
        'kind', case when v_source is null then 'origem_sem_nota' else 'origem_recalculada' end,
        'purchase_id', v_source,
        'cost_from_this_note', v_applied
      );
    end loop;

    -- Memória: item que saiu de uso ou despesa para um produto desliga a
    -- memória de uso ou despesa ligada desse item do fornecedor. Só na
    -- correção: desfazer não grava memória.
    if v_action = 'corrigir' then
      v_memories_off := array(
        select distinct (memory ->> 'mapping_id')::uuid
        from jsonb_to_recordset(v_requested) as request(item_id uuid, product_id uuid)
        cross join lateral jsonb_array_elements(v_memories_before -> request.item_id::text) memory
        where request.product_id is not null
          and v_items_before -> request.item_id::text ->> 'mapping_status' = 'nao_aplicavel'
          and memory ->> 'kind' = 'uso_despesa'
        order by 1
      );
      update public.payable_non_catalog_mappings mapping
      set active = false, updated_at = now()
      where mapping.id = any(v_memories_off)
        and mapping.active;
    end if;

    v_consumption_after := private.consumo_semanal_dos_produtos_nfe(v_product_ids);

    -- Consumo: só as linhas (contagem x produto) e os períodos que mudaram.
    -- Cada linha leva as datas do seu período: uma semana posterior pode mudar
    -- só pelo custo de referência, sem mudar os totais de compras dela.
    select jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'period_end_count_id', coalesce(before_row.value ->> 'period_end_count_id', after_row.value ->> 'period_end_count_id'),
                 'start_date', (
                   select period.value ->> 'start_date'
                   from jsonb_array_elements(v_consumption_after -> 'periods') period
                   where period.value ->> 'period_end_count_id'
                         = coalesce(before_row.value ->> 'period_end_count_id', after_row.value ->> 'period_end_count_id')
                 ),
                 'end_date', (
                   select period.value ->> 'end_date'
                   from jsonb_array_elements(v_consumption_after -> 'periods') period
                   where period.value ->> 'period_end_count_id'
                         = coalesce(before_row.value ->> 'period_end_count_id', after_row.value ->> 'period_end_count_id')
                 ),
                 'product_id', coalesce(before_row.value ->> 'product_id', after_row.value ->> 'product_id'),
                 'product_name', coalesce(before_row.value ->> 'product_name', after_row.value ->> 'product_name'),
                 'unit', coalesce(before_row.value ->> 'unit', after_row.value ->> 'unit'),
                 'before', before_row.value,
                 'after', after_row.value
               ) order by coalesce(before_row.value ->> 'period_end_count_id', after_row.value ->> 'period_end_count_id'),
                          coalesce(before_row.value ->> 'product_id', after_row.value ->> 'product_id'))
        from jsonb_array_elements(v_consumption_before -> 'items') before_row
        full join jsonb_array_elements(v_consumption_after -> 'items') after_row
          on before_row.value ->> 'period_end_count_id' = after_row.value ->> 'period_end_count_id'
         and before_row.value ->> 'product_id' = after_row.value ->> 'product_id'
        where before_row.value is distinct from after_row.value
      ), '[]'::jsonb),
      'periods', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'period_end_count_id', after_row.value ->> 'period_end_count_id',
                 'start_date', after_row.value ->> 'start_date',
                 'end_date', after_row.value ->> 'end_date',
                 'before', before_row.value,
                 'after', after_row.value
               ) order by after_row.value ->> 'end_date', after_row.value ->> 'period_end_count_id')
        from jsonb_array_elements(v_consumption_before -> 'periods') before_row
        join jsonb_array_elements(v_consumption_after -> 'periods') after_row
          on before_row.value ->> 'period_end_count_id' = after_row.value ->> 'period_end_count_id'
        where before_row.value is distinct from after_row.value
      ), '[]'::jsonb),
      'closed_periods', jsonb_array_length(v_consumption_after -> 'periods')
    ) into v_consumption;

    select jsonb_agg(jsonb_build_object(
        'item_id', item.id,
        'purchase_id', item.purchase_id,
        'supplier_name', supplier.name,
        'nfe_number', purchase.nfe_number,
        'issue_date', purchase.nfe_issued_at,
        'source_description', item.source_description,
        'source_unit', item.source_unit,
        'quantity', item.quantity,
        'item_value', coalesce(item.acquisition_value, item.line_total),
        'before', v_items_before -> item.id::text,
        'after', private.foto_item_nfe(item.id, false),
        'memories_before', v_memories_before -> item.id::text,
        'memories_after', private.memorias_do_item_nfe(item.id)
      ) order by item.id)
      into v_items
    from public.payable_purchase_items item
    join public.payable_purchases purchase on purchase.id = item.purchase_id
    left join public.suppliers supplier on supplier.id = purchase.supplier_id
    where item.id = any(v_item_ids);

    select jsonb_agg(jsonb_build_object(
        'product_id', product.id,
        'name', product.name,
        'unit', product.unit,
        'active', product.active,
        'cost_before', (v_costs_before ->> product.id::text)::numeric,
        'cost_after', product.cost_price
      ) order by product.id)
      into v_products
    from public.products product where product.id = any(v_product_ids);

    v_impact := jsonb_build_object(
      'action', v_action,
      'undoes_correction_id', p_undo_correction_id,
      'requested', v_requested,
      'items', v_items,
      'products', v_products,
      'decisions', v_decisions,
      'memories_off', to_jsonb(v_memories_off),
      'purchases', v_finance,
      'consumption', v_consumption
    );
    v_hash := encode(pg_catalog.sha256(convert_to(v_impact::text, 'UTF8')), 'hex');

    if p_mode = 'previa' then
      raise exception using errcode = 'PNPRV', message = 'prévia';
    end if;

    if v_hash is distinct from p_expected_impact_hash then
      -- PT409 e não 40001: o PostgREST repete 40001 sem limite (ver
      -- 20260930094600_conflito_pj_sem_repeticao.sql); PT409 volta como HTTP 409.
      raise exception using errcode = 'PT409',
        message = 'O efeito mudou desde a prévia (outra correção, nota nova, pagamento, memória ou cadastro alterado). Veja a prévia de novo antes de confirmar.';
    end if;

    update public.payable_purchases purchase
    set updated_at = now()
    where purchase.id = any(v_purchase_ids);

    insert into public.payable_purchase_item_corrections (
      request_id, action, undoes_correction_id, product_ids, requested, impact, impact_hash, corrected_by
    ) values (
      p_request_id, v_action, p_undo_correction_id, v_product_ids, v_requested, v_impact, v_hash, v_uid
    )
    returning id into v_correction_id;

    insert into public.payable_events (purchase_id, event_type, details, occurred_by)
    select (entry ->> 'purchase_id')::uuid, 'corrigida',
           jsonb_build_object(
             'item_correction_id', v_correction_id,
             'action', v_action,
             'items', jsonb_agg(jsonb_build_object(
               'item_id', entry ->> 'item_id',
               'from_mapping_status', coalesce(entry -> 'before' ->> 'mapping_status', 'mapeado'),
               'to_mapping_status', entry -> 'after' ->> 'mapping_status',
               'from_product_id', entry -> 'before' ->> 'product_id',
               'to_product_id', entry -> 'after' ->> 'product_id',
               'from_factor', entry -> 'before' -> 'conversion_factor',
               'to_factor', entry -> 'after' -> 'conversion_factor'
             ) order by entry ->> 'item_id')
           ),
           v_uid
    from jsonb_array_elements(v_items) entry
    group by entry ->> 'purchase_id';
  exception when sqlstate 'PNPRV' then
    -- Prévia: tudo o que o bloco gravou foi desfeito; o impacto ficou nas variáveis.
    null;
  end;

  return jsonb_build_object(
    'mode', p_mode,
    'action', v_action,
    'correction_id', v_correction_id,
    'impact', v_impact,
    'impact_hash', v_hash,
    'replayed', false
  );
end;
$$;

revoke all on function public.correct_payable_purchase_items(uuid, text, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.correct_payable_purchase_items(uuid, text, jsonb, uuid, text) to authenticated;

commit;
