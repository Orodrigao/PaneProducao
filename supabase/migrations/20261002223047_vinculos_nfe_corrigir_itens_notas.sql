-- Vínculos de NF-e, fase 4: corrigir itens de notas já gravadas (02/10/2026).
--
-- Até aqui um item de NF-e gravado no insumo errado (defeito do "SEM GTIN",
-- corrigido em 28/09) ou com o fator errado só mudava por migration de dados.
-- Agora Administração e o Financeiro autorizado (mesma regra da fase 3,
-- private.pode_corrigir_vinculos_nfe) corrigem pela tela Catálogo > Vínculos
-- NF-e, conforme decidido pelo Rodrigo em 28/09, 01/10 e 02/10/2026:
--   * trocar o produto de um ou mais itens e o fator (quanto vem em cada
--     unidade da nota), ou só o fator de item que já está no produto certo;
--   * ver, antes de confirmar, o que muda em cada item e no custo de cada
--     produto;
--   * desfazer uma correção.
--
-- Escrita somente por public.correct_payable_purchase_items, que faz a prévia
-- e a aplicação com o MESMO código: aplica tudo dentro de um bloco, mede o
-- impacto e, na prévia, desfaz o bloco com um código de erro próprio (PNPRV)
-- que só esse bloco captura; as variáveis com o impacto sobrevivem ao desfazer.
-- A aplicação refaz a conta sob trava e recusa com PT409 se o impacto mudou
-- desde a prévia (outra correção, nota nova, custo ou cadastro alterado).
-- Por escrever e desfazer, a prévia precisa de transação de escrita: chamada
-- por POST (supabase.rpc), nunca por GET.
--
-- Custo do produto (products.cost_price, gravado, não recalcula sozinho):
--   * destino: regra da NF mais recente, private.apply_xml_purchase_cost;
--   * origem: só recalcula se o item movido era o que deu o custo, a partir da
--     NF mais recente que sobrar; sem NF restante, o custo fica como estava.
--     cost_applied sozinho não prova "era o que deu o custo": a marca não é
--     limpa quando chega nota mais nova. Por isso a própria
--     apply_xml_purchase_cost é chamada como sonda, num bloco sempre desfeito:
--     ela devolve true só para a nota mais recente do produto, pela regra
--     exata dela, e nada do que ela grava fica. "Era o que deu o custo" =
--     cost_applied = true E sonda = true. É uma aproximação: custo editado à mão
--     depois da nota não é detectado.
--   * notas do mesmo dia sem hora podem não ter ordem clara; se nenhuma nota
--     restante da origem se declara a mais recente, a correção é recusada em
--     vez de deixar o custo antigo contaminado.
-- Desfazer é uma correção inversa: volta produto, fator e quantidade útil
-- gravados antes, e o custo segue as regras acima com as notas de hoje (pode
-- não voltar ao valor antigo se chegou nota nova ou se o destino não tinha
-- outra nota; a prévia mostra).
-- Nada muda em contas, parcelas, pagamentos ou livro-caixa: o valor de cada
-- item fica igual. Consumo semanal e custos de referência são calculados na
-- hora a partir dos itens e acompanham a correção.
--
-- Travas: uma fila única para todas as correções de notas (trava consultiva
-- payable-item-correction), depois as contas das notas, depois os itens, depois
-- produtos em ordem de identificador, a mesma ordem de create_xml_payable. O
-- cadastro do destino é conferido só depois de travado.
--
-- Porta lateral fechada: classify_payable_item reapontava item já classificado
-- sem recalcular o custo do produto antigo. Passa a aceitar só item pendente;
-- a tela de Contas a pagar só oferece pendentes, então nada visível muda. A
-- versão de seis parâmetros encaminha para esta e herda a recusa.

begin;

create table if not exists public.payable_purchase_item_corrections (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  action text not null check (action in ('corrigir', 'desfazer')),
  undoes_correction_id uuid unique references public.payable_purchase_item_corrections(id),
  product_ids uuid[] not null,
  requested jsonb not null,
  impact jsonb not null,
  impact_hash text not null,
  corrected_by uuid not null references auth.users(id),
  corrected_at timestamptz not null default clock_timestamp(),
  constraint payable_purchase_item_corrections_undo_check
    check ((action = 'desfazer') = (undoes_correction_id is not null))
);

create index if not exists payable_purchase_item_corrections_products_idx
  on public.payable_purchase_item_corrections using gin (product_ids);

revoke all on table public.payable_purchase_item_corrections from public, anon, authenticated;
grant select on table public.payable_purchase_item_corrections to authenticated;
alter table public.payable_purchase_item_corrections enable row level security;
alter table public.payable_purchase_item_corrections force row level security;

drop policy if exists payable_purchase_item_corrections_select_managers
on public.payable_purchase_item_corrections;
create policy payable_purchase_item_corrections_select_managers
on public.payable_purchase_item_corrections for select to authenticated
using (private.pode_corrigir_vinculos_nfe());

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
      'product_id', item.product_id,
      'product_name', product.name,
      'product_unit', product.unit,
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
  v_usable numeric;
  v_item_count integer;
  v_distinct_count integer;
  v_item_ids uuid[];
  v_product_ids uuid[];
  v_purchase_ids uuid[];
  v_origins uuid[] := '{}';
  v_costs_before jsonb;
  v_items_before jsonb;
  v_items jsonb;
  v_products jsonb;
  v_decisions jsonb := '[]'::jsonb;
  v_impact jsonb;
  v_hash text;
  v_correction_id uuid;
  v_product uuid;
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
    select jsonb_agg(jsonb_build_object(
        'item_id', entry ->> 'item_id',
        'product_id', entry -> 'before' ->> 'product_id',
        'conversion_factor', round((entry -> 'before' ->> 'conversion_factor')::numeric, 6),
        'usable_quantity', round((entry -> 'before' ->> 'usable_quantity')::numeric, 6)
      ) order by entry ->> 'item_id')
      into v_requested
    from jsonb_array_elements(v_undo.impact -> 'items') entry;
  else
    v_action := 'corrigir';
    if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 then
      raise exception using errcode = '22023', message = 'Escolha de 1 a 100 itens para corrigir.';
    end if;
    for v_element in select value from jsonb_array_elements(p_items) loop
      if jsonb_typeof(v_element) is distinct from 'object'
         or coalesce(v_element ->> 'item_id', '') !~ c_uuid
         or coalesce(v_element ->> 'product_id', '') !~ c_uuid
         or jsonb_typeof(v_element -> 'conversion_factor') is distinct from 'number' then
        raise exception using errcode = '22023', message = 'Pedido de correção com item inválido.';
      end if;
      if (v_element ->> 'conversion_factor')::numeric <= 0
         or (v_element ->> 'conversion_factor')::numeric >= 100000000
         or (v_element ->> 'conversion_factor')::numeric <> round((v_element ->> 'conversion_factor')::numeric, 6) then
        raise exception using errcode = '22023',
          message = 'Informe quanto vem em cada unidade da nota: maior que zero e com até seis casas decimais.';
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
      if v_line.mapping_status <> 'mapeado' or v_line.current_product_id is null then
        raise exception using errcode = '22023',
          message = 'Só itens ligados a um produto do catálogo são corrigidos aqui.';
      end if;
      if v_line.target_active is null then
        raise exception using errcode = '22023', message = 'O produto escolhido não existe.';
      end if;

      if v_action = 'corrigir' then
        if not v_line.target_active
           or coalesce(v_line.target_kind, '') not in ('insumo', 'final')
           or v_line.target_own then
          raise exception using errcode = '22023',
            message = 'Escolha um produto ativo que se compra: insumo ou revenda, sem kit nem fabricação própria.';
        end if;
        if v_line.product_id = v_line.current_product_id and v_line.conversion_factor = v_line.current_factor then
          raise exception using errcode = '22023', message = 'A correção não muda nada em um dos itens.';
        end if;
        v_usable := round(v_line.quantity * v_line.conversion_factor, 6);
      else
        -- Desfazer só vale se o item ainda está exatamente como a correção o
        -- deixou; se alguém mexeu depois, voltar apagaria essa decisão.
        select entry -> 'after' into v_undone_item
        from jsonb_array_elements(v_undo.impact -> 'items') entry
        where (entry ->> 'item_id')::uuid = v_line.item_id;
        if (v_undone_item ->> 'product_id')::uuid is distinct from v_line.current_product_id
           or (v_undone_item ->> 'conversion_factor')::numeric is distinct from v_line.current_factor
           or (v_undone_item ->> 'usable_quantity')::numeric is distinct from v_line.current_usable then
          raise exception using errcode = '22023',
            message = 'Um item mudou depois desta correção; ela não pode mais ser desfeita.';
        end if;
        -- Mesmo valor não basta: uma correção mais nova que voltou o item ao
        -- mesmo produto e fator também seria apagada. Itens ligados só mudam
        -- por esta função, então o histórico diz se houve correção depois.
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

      if v_action = 'corrigir' and (
        v_usable is null or v_usable <= 0 or v_usable >= 100000000
        or round(v_line.item_value / v_usable, 6) >= 1000000
      ) then
        raise exception using errcode = '22023',
          message = 'Com este fator a quantidade útil de um item fica fora do limite. Confira o fator.';
      end if;
    end loop;

    -- Foto do antes.
    select jsonb_object_agg(product.id::text, product.cost_price) into v_costs_before
    from public.products product where product.id = any(v_product_ids);
    select jsonb_object_agg(item.id::text, private.foto_item_nfe(item.id, true)) into v_items_before
    from public.payable_purchase_items item where item.id = any(v_item_ids);
    v_purchase_ids := array(
      select distinct item.purchase_id from public.payable_purchase_items item
      where item.id = any(v_item_ids) order by 1
    );

    -- Origens: o item que sai era o que deu o custo? Sonda num bloco sempre
    -- desfeito; só o resultado sobrevive.
    for v_pair in
      select distinct item.purchase_id, item.product_id
      from public.payable_purchase_items item
      join jsonb_to_recordset(v_requested) as request(item_id uuid, product_id uuid)
        on request.item_id = item.id
      where request.product_id <> item.product_id and item.cost_applied
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

    -- Move todos os itens antes de recalcular qualquer custo.
    update public.payable_purchase_items item
    set product_id = target.id,
        item_name = target.name,
        unit = coalesce(target.unit, 'un'),
        category_snapshot = coalesce(target.category, 'Outros'),
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
      item_id uuid, product_id uuid, conversion_factor numeric, usable_quantity numeric
    )
    join public.products target on target.id = request.product_id
    where item.id = request.item_id;

    -- Destinos: regra da NF mais recente, nota a nota.
    for v_pair in
      select distinct item.purchase_id, item.product_id
      from public.payable_purchase_items item
      where item.id = any(v_item_ids)
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
        'after', private.foto_item_nfe(item.id, false)
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
      'decisions', v_decisions
    );
    v_hash := encode(pg_catalog.sha256(convert_to(v_impact::text, 'UTF8')), 'hex');

    if p_mode = 'previa' then
      raise exception using errcode = 'PNPRV', message = 'prévia';
    end if;

    if v_hash is distinct from p_expected_impact_hash then
      -- PT409 e não 40001: o PostgREST repete 40001 sem limite (ver
      -- 20260930094600_conflito_pj_sem_repeticao.sql); PT409 volta como HTTP 409.
      raise exception using errcode = 'PT409',
        message = 'O efeito mudou desde a prévia (outra correção, nota nova ou cadastro alterado). Veja a prévia de novo antes de confirmar.';
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

-- ---------------------------------------------------------------------------
-- Autores: parte da definição vigente (20261001173823_vinculos_nfe_corrigir_memoria)
-- e acrescenta quem corrigiu itens de notas que saíram deste produto ou vieram
-- para ele. A regra de acesso continua a mesma.
-- ---------------------------------------------------------------------------

create or replace function public.list_vinculo_nfe_authors(p_product_id uuid)
returns table (author_id uuid, display_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_product_id is null then
    raise exception using errcode = '22023', message = 'Produto obrigatório.';
  end if;

  if not private.pode_corrigir_vinculos_nfe() then
    raise exception using errcode = '42501', message = 'Sem permissão para consultar autores dos vínculos.';
  end if;

  return query
  select profile.user_id, profile.display_name
  from public.app_profiles profile
  where profile.user_id in (
    select mapping.last_confirmed_by
    from public.payable_product_mappings mapping
    where mapping.base_product_id = p_product_id

    union

    select item.mapping_confirmed_by
    from public.payable_purchase_items item
    join public.payable_purchases purchase on purchase.id = item.purchase_id
    where item.product_id = p_product_id
      and purchase.origin = 'xml'
      and purchase.store = 'jc'

    union

    select item.factor_confirmed_by
    from public.payable_purchase_items item
    join public.payable_purchases purchase on purchase.id = item.purchase_id
    where item.product_id = p_product_id
      and purchase.origin = 'xml'
      and purchase.store = 'jc'

    union

    select correction.corrected_by
    from public.payable_product_mapping_corrections correction
    where correction.previous ->> 'base_product_id' = p_product_id::text
       or correction.result ->> 'base_product_id' = p_product_id::text

    union

    select correction.corrected_by
    from public.payable_purchase_item_corrections correction
    where p_product_id = any(correction.product_ids)
  )
  order by profile.display_name;
end;
$$;

revoke all on function public.list_vinculo_nfe_authors(uuid) from public, anon, authenticated;
grant execute on function public.list_vinculo_nfe_authors(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- classify_payable_item, a partir da versão vigente (20260913141048).
-- Mudanças: recusa item que não esteja pendente (v_mapping_status) e trava a
-- conta antes do item.
-- ---------------------------------------------------------------------------

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
  v_mapping_status text;
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
  -- Conta antes do item, a mesma ordem de public.correct_payable_purchase_items:
  -- travando o item antes, esta função e uma correção do mesmo item poderiam
  -- esperar uma pela outra (cada uma com metade das travas).
  perform 1 from public.payable_purchases purchase
  where purchase.id = (select item.purchase_id from public.payable_purchase_items item where item.id = p_item_id)
  for update;
  select item.purchase_id, purchase.supplier_id, purchase.status, item.mapping_status,
         item.source_product_code, item.source_ean, item.source_description,
         item.source_unit, coalesce(item.acquisition_value, item.line_total)
    into v_purchase_id, v_supplier_id, v_status, v_mapping_status, v_source_code, v_source_ean,
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
  -- Item já classificado não é reapontado aqui: a troca não recalculava o
  -- custo do produto antigo. A correção é pela tela Catálogo > Vínculos NF-e
  -- (public.correct_payable_purchase_items).
  if v_mapping_status = 'mapeado' then
    raise exception using errcode = '22023',
      message = 'Este item já foi classificado. Para trocar o produto ou o fator, use Catálogo > Vínculos NF-e.';
  end if;
  if v_mapping_status is distinct from 'pendente' then
    raise exception using errcode = '22023',
      message = 'Este item foi lançado como uso ou despesa e não é reclassificado aqui.';
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

  -- Ordem única de travas no fluxo da NF-e: fornecedor antes do insumo.
  -- create_xml_payable trava o fornecedor e depois o insumo; aqui a trava do
  -- fornecedor vinha depois do insumo (só com memória), e importar e classificar
  -- ao mesmo tempo podiam travar uma à outra.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('payable-mapping-supplier:' || v_supplier_id::text, 0)
  );

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
    -- A trava do fornecedor já foi tomada acima, antes do insumo.
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

revoke all on function public.classify_payable_item(uuid, uuid, text, numeric, numeric, boolean, boolean) from public, anon;
grant execute on function public.classify_payable_item(uuid, uuid, text, numeric, numeric, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- classify_payable_item_without_product, a partir da versão vigente
-- (20260902142639). Única mudança: trava a conta antes do item.
-- ---------------------------------------------------------------------------

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
  -- Conta antes do item, a mesma ordem de public.correct_payable_purchase_items:
  -- travando o item antes, esta função e uma correção do mesmo item poderiam
  -- esperar uma pela outra (cada uma com metade das travas).
  perform 1 from public.payable_purchases purchase
  where purchase.id = (select item.purchase_id from public.payable_purchase_items item where item.id = p_item_id)
  for update;
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

revoke all on function public.classify_payable_item_without_product(uuid, boolean) from public, anon;
grant execute on function public.classify_payable_item_without_product(uuid, boolean) to authenticated;

commit;
