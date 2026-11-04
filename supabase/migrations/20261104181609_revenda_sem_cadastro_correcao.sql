-- Revenda sem cadastro, fase 3 (04/11/2026): corrigir nota já gravada entre
-- uso ou despesa, revenda sem cadastro e produto.
--
-- A fase 2 (20261028193751_revenda_sem_cadastro_tipo) deu ao item fora do
-- cadastro o tipo (non_catalog_kind: uso_despesa ou revenda) e travou a
-- revenda dentro de fora do cadastro, porque a correção de notas não levava o
-- tipo à foto nem ao desfazer. Agora a correção de notas
-- (public.correct_payable_purchase_items, redefinida a partir da versão
-- vigente, 20261019163500_vinculos_nfe_uso_despesa_insumo) passa a fazer, com
-- prévia e a mesma recusa PT409:
--   * uso ou despesa <-> revenda sem cadastro (troca de tipo, sem produto em
--     nenhum dos lados);
--   * revenda sem cadastro -> produto, pelo mesmo caminho de uso ou despesa;
--   * produto -> revenda sem cadastro, pelo mesmo caminho de produto -> uso ou
--     despesa: o custo do produto de origem é recalculado pela nota mais recente
--     que sobrou; sem outra nota, fica como estava. "Sem custo" na revenda quer
--     dizer só que o cadastro não muda de custo: o valor de aquisição do item
--     continua o mesmo.
-- Contas, parcelas, rateio e livro-caixa continuam sem mudar: a categoria de
-- DRE é da conta, decidida no Contas a pagar.
--
-- Pedido: item fora do cadastro (product_id nulo) pode trazer non_catalog_kind.
-- Sem o campo é o site anterior, que só conhece uso ou despesa, e vale uso ou
-- despesa; o site anterior nunca chega a um item de revenda (as listas dele
-- deixam a revenda de fora), e se chegar a correção é recusada com o pedido de
-- recarregar a página. Item com produto não tem tipo.
--
-- O tipo entra em tudo o que guarda ou compara o item: a foto
-- (private.foto_item_nfe), o pedido normalizado, a comparação do desfazer, o
-- hash, o replay e o evento da conta. Correções antigas, gravadas sem o tipo,
-- continuam desfazíveis: na foto antiga, fora do cadastro era uso ou despesa.
-- O replay de um pedido antigo, gravado sem o tipo, continua devolvendo o
-- gravado.
--
-- Memória do fornecedor, só a de fora do cadastro (a de insumo continua na tela
-- Memórias de vínculo, como na fase 5), e só para item que muda de lado (fora
-- do cadastro <-> produto, ou troca de tipo):
--   * item que vira produto desliga a memória de fora do cadastro ligada (como
--     já fazia com uso ou despesa);
--   * item que fica fora do cadastro com outro tipo troca o tipo da memória
--     ligada;
--   * regra de conflito, item a item: se alguma memória desse item do
--     fornecedor (de insumo ou de fora do cadastro, ligada ou não) mudou depois
--     da decisão que está sendo corrigida (mapping_confirmed_at do item), há
--     decisão mais nova, de uma nota mais recente ou da tela de memórias: a
--     memória fica como está e a prévia diz isso. Basta um item da memória
--     nessa situação, ou sem a data da decisão, para ela ficar. Item que já
--     passou por correção desta fase compara as memórias de agora com a foto
--     exata que essa correção gravou (memories_snapshot), sem depender de
--     horário; só sem foto vale a comparação de horários
--     (private.memoria_mudou_depois_nfe). Corrigir nota antiga não muda a
--     sugestão das próximas;
--   * itens que casam com a mesma memória e vão para destinos diferentes no
--     mesmo pedido são recusados;
--   * desfazer volta a memória ao que era só se nada desse item do fornecedor
--     mudou depois da correção: a correção grava a foto de todas as memórias
--     que casam com os itens, e o desfazer a compara versão por versão (horário
--     não basta, porque quem grava a memória usa now(), o início da
--     transação). Senão ela fica (nunca restaura memória velha por cima de
--     escolha mais nova). Correção antiga, que não registrou a memória,
--     continua sem religar;
--   * a prévia (e o hash) leva, por memória atingida, o antes, o depois, o
--     motivo e a próxima sugestão de cada item, calculada como a importação
--     calcula (a memória gravada por último; empate fica com a de fora do
--     cadastro).
-- A memória mexida ganha updated_at igual ao carimbo da correção
-- (payable_purchase_item_corrections.corrected_at): é por ele que o desfazer
-- sabe que ninguém mexeu depois. Esse carimbo não entra no hash, porque a
-- prévia e a confirmação gravam em momentos diferentes.
--
-- Revenda sai de fora do cadastro só pela correção: o gatilho
-- normalizar_tipo_fora_do_cadastro troca a recusa da fase 2 por uma recusa a
-- todo gravador que não seja a correção (que marca a transação com
-- pane.correcao_itens_nfe), inclusive para trocar a revenda por uso ou
-- despesa.
--
-- Histórico achado pelo item: a troca de tipo não tem produto em nenhum dos
-- lados, e a consulta da tela buscava por produto. A tabela ganha item_ids
-- (preenchida para as correções que já existem a partir do pedido e do efeito
-- gravados), com índice.
--
-- Consumo semanal na prévia: os totais do período ganham a parte de revenda
-- sem cadastro (purchases_resale_no_catalog), que é o que a troca de tipo muda.

begin;

-- ---------------------------------------------------------------------------
-- 1. Histórico das correções achado pelo item.
-- ---------------------------------------------------------------------------
alter table public.payable_purchase_item_corrections
  add column if not exists item_ids uuid[];

update public.payable_purchase_item_corrections correction
set item_ids = array(
  select distinct ids.item_id
  from (
    select (entry ->> 'item_id')::uuid as item_id
    from jsonb_array_elements(
      case when jsonb_typeof(correction.requested) = 'array' then correction.requested else '[]'::jsonb end
    ) entry
    where entry ->> 'item_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    union
    select (entry ->> 'item_id')::uuid
    from jsonb_array_elements(
      case when jsonb_typeof(correction.impact -> 'items') = 'array' then correction.impact -> 'items' else '[]'::jsonb end
    ) entry
    where entry ->> 'item_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  ) ids
  order by 1
)
where correction.item_ids is null;

alter table public.payable_purchase_item_corrections
  alter column item_ids set default '{}',
  alter column item_ids set not null;

comment on column public.payable_purchase_item_corrections.item_ids is
  'Itens de NF-e da correção: acha a troca de tipo, que não tem produto em nenhum dos lados.';

create index if not exists payable_purchase_item_corrections_items_idx
  on public.payable_purchase_item_corrections using gin (item_ids);

-- ---------------------------------------------------------------------------
-- 2. Gatilho do tipo, a partir da versão vigente (20261028193751): a revenda
--    sai de fora do cadastro, ou troca de tipo, só pela correção de notas.
-- ---------------------------------------------------------------------------
create or replace function private.normalizar_tipo_fora_do_cadastro()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A correção de notas (public.correct_payable_purchase_items) leva o tipo à
  -- foto, ao hash e ao desfazer, e marca a transação só enquanto grava os
  -- itens. Qualquer outro gravador que tire a revenda de fora do cadastro, ou a
  -- troque por uso ou despesa, a perderia sem volta: recusa.
  if tg_op = 'UPDATE' and old.non_catalog_kind = 'revenda'
     and (new.mapping_status is distinct from 'nao_aplicavel'
          or new.non_catalog_kind is distinct from 'revenda')
     and coalesce(current_setting('pane.correcao_itens_nfe', true), '') <> 'sim' then
    raise exception using errcode = '22023',
      message = 'Revenda sem cadastro só muda pela correção de notas, em Catálogo > Vínculos NF-e.';
  end if;
  if new.mapping_status = 'nao_aplicavel' then
    -- Quem marca fora do cadastro sem dizer o tipo é o gravador de antes da
    -- fase 2: para ele, fora do cadastro sempre foi uso ou despesa.
    new.non_catalog_kind := coalesce(new.non_catalog_kind, 'uso_despesa');
  elsif tg_op = 'UPDATE' and new.non_catalog_kind is not distinct from old.non_catalog_kind then
    -- O item saiu de fora do cadastro e o tipo veio junto da linha antiga.
    new.non_catalog_kind := null;
  end if;
  return new;
end;
$$;

revoke all on function private.normalizar_tipo_fora_do_cadastro() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Foto do item, a partir da versão vigente (20261019163500): ganha o tipo.
-- ---------------------------------------------------------------------------
create or replace function private.foto_item_nfe(p_item_id uuid, p_with_confirmation boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
      'mapping_status', item.mapping_status,
      'non_catalog_kind', item.non_catalog_kind,
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

-- ---------------------------------------------------------------------------
-- 4. Todas as memórias que casam com o item, ligadas ou não, de insumo e de
--    fora do cadastro: a regra de conflito olha também as desligadas (desligar
--    é uma decisão). Mesmo casamento de private.memorias_do_item_nfe, que
--    continua sendo a lista das ligadas que a importação usaria.
-- ---------------------------------------------------------------------------
create or replace function private.memorias_casadas_item_nfe(p_item_id uuid)
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
             'active', mapping.active,
             'non_catalog_kind', null,
             'version', mapping.updated_at at time zone 'UTC'
           ) as memory
    from source
    join public.payable_product_mappings mapping
      on mapping.supplier_id = source.supplier_id
     and mapping.purchase_unit = source.unit
     and (
       (source.code is not null and mapping.supplier_product_code = source.code)
       or (source.ean is not null and mapping.supplier_ean = source.ean)
       or (source.code is null and source.ean is null
           and lower(trim(mapping.supplier_description)) = lower(trim(source.description)))
     )
    union all
    select jsonb_build_object(
             'kind', 'uso_despesa',
             'mapping_id', mapping.id,
             'active', mapping.active,
             'non_catalog_kind', mapping.non_catalog_kind,
             'version', mapping.updated_at at time zone 'UTC'
           )
    from source
    join public.payable_non_catalog_mappings mapping
      on mapping.supplier_id = source.supplier_id
     and mapping.purchase_unit = source.unit
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

revoke all on function private.memorias_casadas_item_nfe(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4b. Houve decisão sobre a memória deste item depois da decisão que está
--     sendo corrigida? Se o item já passou por uma correção desta fase em
--     diante, ela gravou a foto exata das memórias que casam com ele
--     (memories_snapshot); qualquer diferença de agora para essa foto é decisão
--     mais nova, sem depender de horário (quem grava a memória usa now(), o
--     início da transação, que pode ser anterior ao carimbo da correção mesmo
--     gravando depois dela). Sem essa foto (item decidido na importação ou na
--     classificação, que gravam item e memória na mesma transação, ou corrigido
--     antes desta fase), vale o horário: alguma memória com versão maior que a
--     decisão do item é decisão mais nova; versão um pouco ANTERIOR à decisão
--     (até 2 minutos) é ordem incerta, porque uma gravação concorrente que
--     esperou a trava do fornecedor grava now() anterior mesmo vindo depois. As
--     transações do site são curtas (o banco corta em segundos), então versão
--     mais velha que isso é de fato decisão anterior. Sem a data da decisão,
--     não há como saber. Duas correções do item no mesmo instante (que não
--     sejam a correção e o desfazer dela) também deixam a ordem incerta.
--     Incerto conta como conflito: a memória fica como está.
-- ---------------------------------------------------------------------------
drop function if exists private.memoria_mudou_depois_nfe(uuid, timestamp, jsonb);
create function private.memoria_mudou_depois_nfe(
  p_item_id uuid,
  p_decided_at timestamp,
  p_memories jsonb
)
returns table (conflict boolean, unknown boolean, newer_at timestamp, uncertain boolean)
language sql
stable
set search_path = ''
as $$
  with item_corrections as (
    select correction.id, correction.corrected_at, correction.undoes_correction_id,
           (select entry -> 'memories_snapshot'
            from jsonb_array_elements(
              case when jsonb_typeof(correction.impact -> 'items') = 'array' then correction.impact -> 'items' else '[]'::jsonb end
            ) entry
            where entry ->> 'item_id' = p_item_id::text
            limit 1) as snapshot
    from public.payable_purchase_item_corrections correction
    where correction.item_ids @> array[p_item_id]
  ),
  last_correction as (
    -- No mesmo instante, o desfazer vem depois da correção que ele desfaz.
    select item_corrections.*
    from item_corrections
    order by item_corrections.corrected_at desc, (item_corrections.undoes_correction_id is not null) desc,
             item_corrections.id desc
    limit 1
  ),
  tie as (
    select exists (
      select 1
      from item_corrections other
      cross join last_correction
      where other.corrected_at = last_correction.corrected_at
        and other.id <> last_correction.id
        and other.id is distinct from last_correction.undoes_correction_id
    ) as tied
  ),
  now_entries as (
    select distinct jsonb_build_object('mapping_id', memory ->> 'mapping_id', 'version', memory -> 'version') as entry
    from jsonb_array_elements(coalesce(p_memories, '[]'::jsonb)) memory
  ),
  left_entries as (
    -- Versão nula na foto é a da memória que aquela correção mexeu: o carimbo dela.
    select distinct jsonb_build_object(
             'mapping_id', snapshot_entry ->> 'mapping_id',
             'version', case when jsonb_typeof(snapshot_entry -> 'version') = 'null'
                             then to_jsonb(last_correction.corrected_at at time zone 'UTC') else snapshot_entry -> 'version' end
           ) as entry
    from last_correction
    cross join lateral jsonb_array_elements(last_correction.snapshot) snapshot_entry
    where jsonb_typeof(last_correction.snapshot) = 'array'
  ),
  by_snapshot as (
    select exists (select 1 from last_correction where jsonb_typeof(last_correction.snapshot) = 'array') as known,
           exists (select entry from now_entries except select entry from left_entries)
             or exists (select entry from left_entries except select entry from now_entries) as changed,
           (select max((now_entry.entry ->> 'version')::timestamp)
            from now_entries now_entry
            where not exists (select 1 from left_entries left_entry where left_entry.entry = now_entry.entry)) as newer
  ),
  by_clock as (
    select max((memory ->> 'version')::timestamp) as newest,
           coalesce(bool_or((memory ->> 'version')::timestamp < p_decided_at
                            and (memory ->> 'version')::timestamp >= p_decided_at - interval '2 minutes'), false) as close_before
    from jsonb_array_elements(coalesce(p_memories, '[]'::jsonb)) memory
  ),
  verdict as (
    select tie.tied,
           by_snapshot.known,
           by_snapshot.changed,
           by_snapshot.newer,
           by_clock.newest,
           p_decided_at is not null and coalesce(by_clock.newest > p_decided_at, false) as clock_newer,
           p_decided_at is not null and by_clock.close_before as clock_close
    from tie cross join by_snapshot cross join by_clock
  )
  select case when verdict.tied then true
              when verdict.known then verdict.changed
              else verdict.clock_newer or verdict.clock_close end,
         not verdict.tied and not verdict.known and p_decided_at is null,
         case when verdict.known then verdict.newer else verdict.newest end,
         verdict.tied or (not verdict.known and not verdict.clock_newer and verdict.clock_close)
  from verdict;
$$;

revoke all on function private.memoria_mudou_depois_nfe(uuid, timestamp, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Consumo semanal dos produtos envolvidos, a partir da versão vigente
--    (20261019163500): os totais do período ganham a revenda sem cadastro, a
--    parte de "não é estoque" que a troca de tipo muda.
-- ---------------------------------------------------------------------------
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
               'resale', period.purchases_resale_no_catalog,
               'unclassified', period.purchases_unclassified
             ) order by period.period_end_date, period.period_end_count_id), '[]'::jsonb)
      from public.inventory_consumption_periods('jc') period
    )
  );
end;
$$;

revoke all on function private.consumo_semanal_dos_produtos_nfe(uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. A correção de notas, a partir da versão vigente (20261019163500).
--    Mesma assinatura: `create or replace` mantém o nome no PostgREST; os
--    grants são repetidos no fim.
-- ---------------------------------------------------------------------------
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
  v_requested_legacy jsonb;
  v_kind_omitted boolean := false;
  v_element jsonb;
  v_existing public.payable_purchase_item_corrections%rowtype;
  v_undo public.payable_purchase_item_corrections%rowtype;
  v_line record;
  v_pair record;
  v_link record;
  v_change jsonb;
  v_undone_item jsonb;
  v_from text;
  v_target text;
  v_expected_kind text;
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
  v_memories_all_before jsonb;
  v_memory_changes jsonb := '[]'::jsonb;
  v_memories_changed uuid[] := '{}';
  v_memories_stamped uuid[] := '{}';
  v_memories_off uuid[] := '{}';
  v_memory_action text;
  v_memory_reason text;
  v_memory_after jsonb;
  v_newer timestamp;
  v_current_memory record;
  v_snapshot_now jsonb;
  v_snapshot_left jsonb;
  v_finance jsonb;
  v_consumption_before jsonb;
  v_consumption_after jsonb;
  v_consumption jsonb;
  v_items jsonb;
  v_products jsonb;
  v_decisions jsonb := '[]'::jsonb;
  v_impact jsonb;
  v_hash text;
  v_stamp timestamptz;
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

  -- Pedido normalizado: ordenado por item, identificadores em minúsculas,
  -- fator com seis casas e o tipo de fora do cadastro (nulo no item com
  -- produto). É o que o histórico guarda e o replay compara.
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
    -- Volta o que estava gravado antes. product_id nulo = fora do cadastro, com
    -- o tipo da foto; foto sem o tipo (antes desta fase) era uso ou despesa.
    -- As fotos da fase 5 em diante (com mapping_status) trazem também nome,
    -- unidade, categoria e base, que voltam exatamente como eram, inclusive
    -- nulos; as da fase 4 não trazem, e o desfazer delas segue a regra da
    -- fase 4 (nome, unidade e categoria do cadastro, base mantida).
    select jsonb_agg(jsonb_build_object(
        'item_id', entry ->> 'item_id',
        'product_id', entry -> 'before' ->> 'product_id',
        'conversion_factor', round((entry -> 'before' ->> 'conversion_factor')::numeric, 6),
        'usable_quantity', round((entry -> 'before' ->> 'usable_quantity')::numeric, 6),
        'non_catalog_kind', case
          when entry -> 'before' ->> 'product_id' is not null then null
          else coalesce(entry -> 'before' ->> 'non_catalog_kind', 'uso_despesa')
        end
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
      -- nunca vira "fora do cadastro" por acidente.
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
        if v_element ? 'non_catalog_kind' then
          if jsonb_typeof(v_element -> 'non_catalog_kind') is distinct from 'string'
             or (v_element ->> 'non_catalog_kind') not in ('uso_despesa', 'revenda') then
            raise exception using errcode = '22023', message = 'Tipo do item fora do cadastro inválido.';
          end if;
        else
          -- Site anterior: só conhece uso ou despesa.
          v_kind_omitted := true;
        end if;
      else
        if jsonb_typeof(v_element -> 'product_id') is distinct from 'string'
           or (v_element ->> 'product_id') !~ c_uuid
           or jsonb_typeof(v_element -> 'conversion_factor') is distinct from 'number' then
          raise exception using errcode = '22023', message = 'Pedido de correção com item inválido.';
        end if;
        if v_element ? 'non_catalog_kind' and jsonb_typeof(v_element -> 'non_catalog_kind') is distinct from 'null' then
          raise exception using errcode = '22023',
            message = 'Item ligado a produto não tem tipo de fora do cadastro: envie o tipo vazio.';
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
        'usable_quantity', null,
        'non_catalog_kind', case
          when jsonb_typeof(entry -> 'product_id') = 'null' then coalesce(entry ->> 'non_catalog_kind', 'uso_despesa')
          else null
        end
      ) order by (entry ->> 'item_id')::uuid),
      count(*), count(distinct (entry ->> 'item_id')::uuid)
      into v_requested, v_item_count, v_distinct_count
    from jsonb_array_elements(p_items) entry;
    if v_item_count <> v_distinct_count then
      raise exception using errcode = '22023', message = 'O mesmo item aparece duas vezes no pedido.';
    end if;
  end if;

  -- Forma do pedido gravada antes desta fase, sem o tipo: só existe para
  -- pedidos sem revenda (antes não havia revenda na correção).
  if not exists (
    select 1 from jsonb_array_elements(v_requested) entry where entry ->> 'non_catalog_kind' = 'revenda'
  ) then
    select jsonb_agg(entry - 'non_catalog_kind' order by entry ->> 'item_id')
      into v_requested_legacy
    from jsonb_array_elements(v_requested) entry;
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
         and (v_existing.requested = v_requested
              or (v_requested_legacy is not null and v_existing.requested = v_requested_legacy))
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
    -- ela, importação, classificação e a tela de memórias não mudam a memória
    -- entre a foto da prévia e a gravação.
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

    -- Um carimbo para tudo o que esta correção grava: a confirmação dos itens,
    -- a memória mexida e o histórico. É por ele que o desfazer sabe que a
    -- memória não mudou depois. Fica fora do hash.
    v_stamp := clock_timestamp();

    for v_line in
      select request.item_id, request.product_id, request.conversion_factor, request.usable_quantity,
             request.non_catalog_kind,
             item.purchase_id, item.product_id as current_product_id, item.mapping_status,
             item.non_catalog_kind as current_kind,
             item.quantity, item.conversion_factor as current_factor,
             item.usable_quantity as current_usable,
             coalesce(item.acquisition_value, item.line_total) as item_value,
             purchase.origin, purchase.store, purchase.status,
             target.active as target_active, target.kind as target_kind,
             target.is_fabricacao_propria as target_own
      from jsonb_to_recordset(v_requested) as request(
        item_id uuid, product_id uuid, conversion_factor numeric, usable_quantity numeric, non_catalog_kind text
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
        v_from := coalesce(v_line.current_kind, 'uso_despesa');
      else
        raise exception using errcode = '22023',
          message = 'Item sem classificação: classifique em Contas a pagar.';
      end if;
      if v_line.product_id is not null and v_line.target_active is null then
        raise exception using errcode = '22023', message = 'O produto escolhido não existe.';
      end if;

      if v_action = 'corrigir' then
        if v_line.product_id is null then
          if v_from = v_line.non_catalog_kind then
            raise exception using errcode = '22023', message = 'A correção não muda nada em um dos itens.';
          end if;
          if v_kind_omitted and v_from = 'revenda' then
            raise exception using errcode = '22023',
              message = 'Esta tela foi aberta antes da revenda sem cadastro e trataria a revenda como uso ou despesa. Recarregue a página e confira a nota de novo.';
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
        -- deixou, inclusive no tipo; se alguém mexeu depois, voltar apagaria
        -- essa decisão. Foto antiga (fase 4) não tem a situação: era sempre
        -- item ligado. Foto sem o tipo (antes desta fase) fora do cadastro era
        -- uso ou despesa.
        select entry -> 'after' into v_undone_item
        from jsonb_array_elements(v_undo.impact -> 'items') entry
        where (entry ->> 'item_id')::uuid = v_line.item_id;
        v_expected_kind := case
          when v_undone_item ? 'non_catalog_kind' then v_undone_item ->> 'non_catalog_kind'
          when coalesce(v_undone_item ->> 'mapping_status', 'mapeado') = 'nao_aplicavel' then 'uso_despesa'
          else null
        end;
        if coalesce(v_undone_item ->> 'mapping_status', 'mapeado') is distinct from v_line.mapping_status
           or v_expected_kind is distinct from v_line.current_kind
           or (v_undone_item ->> 'product_id')::uuid is distinct from v_line.current_product_id
           or (v_undone_item ->> 'conversion_factor')::numeric is distinct from v_line.current_factor
           or (v_undone_item ->> 'usable_quantity')::numeric is distinct from v_line.current_usable then
          raise exception using errcode = '22023',
            message = 'Um item mudou depois desta correção; ela não pode mais ser desfeita.';
        end if;
        -- Mesmo valor não basta: uma correção mais nova que voltou o item ao
        -- mesmo estado também seria apagada. Itens classificados só mudam por
        -- esta função, então o histórico diz se houve correção depois. Outra
        -- correção do item no mesmo instante conta como mais nova (na dúvida,
        -- não desfaz).
        if exists (
          select 1 from public.payable_purchase_item_corrections later
          where later.corrected_at >= v_undo.corrected_at
            and later.id <> v_undo.id
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

    -- Foto do antes: custos, itens, memórias (as ligadas, que a importação
    -- usaria, e todas, para a regra de conflito), contas e consumo.
    select jsonb_object_agg(product.id::text, product.cost_price) into v_costs_before
    from public.products product where product.id = any(v_product_ids);
    select jsonb_object_agg(item.id::text, private.foto_item_nfe(item.id, true)),
           jsonb_object_agg(item.id::text, private.memorias_do_item_nfe(item.id)),
           jsonb_object_agg(item.id::text, private.memorias_casadas_item_nfe(item.id))
      into v_items_before, v_memories_before, v_memories_all_before
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
    -- desfeito; só o resultado sobrevive. "Sai" inclui ir para fora do
    -- cadastro (uso ou despesa, ou revenda sem cadastro).
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

    -- Só esta correção tira revenda de fora do cadastro ou troca o tipo dela:
    -- o gatilho normalizar_tipo_fora_do_cadastro confere esta marca, que vale
    -- só enquanto os itens são gravados.
    perform pg_catalog.set_config('pane.correcao_itens_nfe', 'sim', true);

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
        non_catalog_kind = null,
        -- Item que vem de fora do cadastro não tem base e ganha a da fatoração:
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
        mapping_confirmed_at = v_stamp,
        mapping_confirmed_by = v_uid,
        factor_confirmed_at = case when request.conversion_factor is null then null else v_stamp end,
        factor_confirmed_by = case when request.conversion_factor is null then null else v_uid end
    from jsonb_to_recordset(v_requested) as request(
      item_id uuid, product_id uuid, conversion_factor numeric, usable_quantity numeric,
      photo boolean, item_name text, unit text, category_snapshot text, conversion_basis text
    )
    join public.products target on target.id = request.product_id
    where item.id = request.item_id;

    -- ...depois os que ficam fora do cadastro (uso ou despesa, ou revenda sem
    -- cadastro), gravados como classify_payable_item_without_product: nome e
    -- unidade da nota, sem produto, com o tipo pedido. Desfazer com foto
    -- completa volta nome e unidade gravados. A quantidade não muda: o valor
    -- do item sai dela, e nas notas XML ela é sempre a quantidade da nota.
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
        non_catalog_kind = request.non_catalog_kind,
        mapping_confirmed_at = v_stamp,
        mapping_confirmed_by = v_uid,
        factor_confirmed_at = null,
        factor_confirmed_by = null
    from jsonb_to_recordset(v_requested) as request(
      item_id uuid, product_id uuid, photo boolean, item_name text, unit text, non_catalog_kind text
    )
    where item.id = request.item_id
      and request.product_id is null;

    perform pg_catalog.set_config('pane.correcao_itens_nfe', '', true);

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

    -- Memória do fornecedor (só a de fora do cadastro), para os itens que
    -- mudam de lado. Ver o cabeçalho desta migration para a regra.
    if v_action = 'corrigir' then
      for v_link in
        select (link.memory ->> 'mapping_id')::uuid as mapping_id,
               (array_agg(link.memory order by link.item_id))[1] as memory,
               array_agg(distinct link.item_id order by link.item_id) as item_ids,
               array_agg(distinct link.target order by link.target) as targets,
               -- Conflito por item, antes de juntar: basta um item da memória
               -- sem data da decisão, ou com decisão mais nova sobre alguma
               -- memória dele (private.memoria_mudou_depois_nfe), para a
               -- memória ficar como está.
               bool_or(link.unknown) as decided_unknown,
               bool_or(link.conflict and not link.uncertain) as decided_before,
               bool_or(link.uncertain) as decided_uncertain,
               max(link.newer_at) filter (where link.conflict and not link.uncertain) as newer_at
        from (
          select request.item_id,
                 case when request.product_id is not null then 'produto' else request.non_catalog_kind end as target,
                 decision.conflict,
                 decision.unknown,
                 decision.newer_at,
                 decision.uncertain,
                 memory
          from jsonb_to_recordset(v_requested) as request(item_id uuid, product_id uuid, non_catalog_kind text)
          cross join lateral private.memoria_mudou_depois_nfe(
            request.item_id,
            (v_items_before -> request.item_id::text ->> 'mapping_confirmed_at')::timestamp,
            v_memories_all_before -> request.item_id::text
          ) decision
          cross join lateral jsonb_array_elements(v_memories_all_before -> request.item_id::text) memory
          where memory ->> 'kind' = 'uso_despesa'
            and (memory ->> 'active')::boolean
            -- Só quem muda de lado: produto -> produto não mexe em memória.
            and case when v_items_before -> request.item_id::text ->> 'mapping_status' = 'mapeado' then 'produto'
                     else coalesce(v_items_before -> request.item_id::text ->> 'non_catalog_kind', 'uso_despesa') end
                is distinct from
                case when request.product_id is not null then 'produto' else request.non_catalog_kind end
        ) link
        group by link.memory ->> 'mapping_id'
        order by 1
      loop
        if array_length(v_link.targets, 1) > 1 then
          raise exception using errcode = '22023',
            message = 'Itens que o fornecedor manda com o mesmo código estão com destinos diferentes no pedido: corrija um grupo de cada vez.';
        end if;
        v_target := v_link.targets[1];
        v_newer := v_link.newer_at;
        v_memory_after := null;
        v_memory_reason := null;
        if v_target <> 'produto' and v_link.memory ->> 'non_catalog_kind' = v_target then
          v_memory_action := 'manter';
          v_memory_reason := 'ja_certa';
        elsif v_link.decided_unknown then
          -- Sem a data da decisão não há como saber se a memória é mais nova
          -- (em produção todo item corrigível tem a data; o caso é de item
          -- antigo): fica como está.
          v_memory_action := 'manter';
          v_memory_reason := 'data_desconhecida';
        elsif v_link.decided_before then
          v_memory_action := 'manter';
          v_memory_reason := 'decisao_posterior';
        elsif v_link.decided_uncertain then
          v_memory_action := 'manter';
          v_memory_reason := 'ordem_incerta';
        elsif v_target = 'produto' then
          v_memory_action := 'desligar';
          v_memory_after := jsonb_build_object('active', false, 'non_catalog_kind', v_link.memory ->> 'non_catalog_kind');
        else
          v_memory_action := 'trocar_tipo';
          v_memory_after := jsonb_build_object('active', true, 'non_catalog_kind', v_target);
        end if;
        v_memory_changes := v_memory_changes || jsonb_build_object(
          'mapping_id', v_link.mapping_id,
          'item_ids', to_jsonb(v_link.item_ids),
          'action', v_memory_action,
          'reason', v_memory_reason,
          'before', jsonb_build_object(
            'active', (v_link.memory ->> 'active')::boolean,
            'non_catalog_kind', v_link.memory ->> 'non_catalog_kind',
            'version', v_link.memory -> 'version'
          ),
          'after', v_memory_after,
          'newer_at', case when v_memory_reason = 'decisao_posterior' then v_newer end
        );
      end loop;
    else
      -- Desfazer: volta a memória que a correção mexeu, se nada desse item do
      -- fornecedor mudou depois dela. Correção antiga não registrou a memória:
      -- a que ela desligou continua desligada.
      if not (v_undo.impact ? 'memory_changes') then
        for v_change in
          select to_jsonb(memory_id) from jsonb_array_elements_text(
            case when jsonb_typeof(v_undo.impact -> 'memories_off') = 'array' then v_undo.impact -> 'memories_off' else '[]'::jsonb end
          ) as off(memory_id)
          order by 1
        loop
          v_memory_changes := v_memory_changes || jsonb_build_object(
            'mapping_id', v_change #>> '{}', 'item_ids', '[]'::jsonb, 'action', 'manter',
            'reason', 'correcao_antiga', 'before', null, 'after', null, 'newer_at', null
          );
        end loop;
      end if;
      for v_change in
        select value from jsonb_array_elements(
          case when jsonb_typeof(v_undo.impact -> 'memory_changes') = 'array' then v_undo.impact -> 'memory_changes' else '[]'::jsonb end
        )
        where value ->> 'action' in ('desligar', 'trocar_tipo')
        order by value ->> 'mapping_id'
      loop
        select mapping.active, mapping.non_catalog_kind into v_current_memory
        from public.payable_non_catalog_mappings mapping
        where mapping.id = (v_change ->> 'mapping_id')::uuid;
        -- Foto de agora das memórias que casam com os itens, comparada com a
        -- que a correção deixou, versão por versão. Comparar horários não
        -- basta: quem grava a memória usa now(), o início da transação, que
        -- pode ser anterior ao carimbo da correção mesmo gravando depois dela
        -- (esperou a trava do fornecedor).
        select coalesce(jsonb_agg(snapshot.entry order by snapshot.entry ->> 'mapping_id'), '[]'::jsonb)
          into v_snapshot_now
        from (
          select distinct jsonb_build_object('mapping_id', memory ->> 'mapping_id', 'version', memory -> 'version') as entry
          from jsonb_array_elements_text(v_change -> 'item_ids') as involved(item_id)
          cross join lateral jsonb_array_elements(v_memories_all_before -> involved.item_id) memory
        ) snapshot;
        -- Na foto gravada, a versão nula é a da memória que a correção mexeu:
        -- o carimbo dela (corrected_at).
        select coalesce(jsonb_agg(jsonb_build_object(
                 'mapping_id', entry ->> 'mapping_id',
                 'version', case when jsonb_typeof(entry -> 'version') = 'null'
                                 then to_jsonb(v_undo.corrected_at at time zone 'UTC') else entry -> 'version' end
               ) order by entry ->> 'mapping_id'), '[]'::jsonb)
          into v_snapshot_left
        from jsonb_array_elements(
          case when jsonb_typeof(v_change -> 'after_memories') = 'array' then v_change -> 'after_memories' else '[]'::jsonb end
        ) entry;
        -- A mudança mais nova que diferencia as duas fotos, para a prévia.
        select max((memory_now.entry ->> 'version')::timestamp) into v_newer
        from jsonb_array_elements(v_snapshot_now) as memory_now(entry)
        where not (v_snapshot_left @> jsonb_build_array(memory_now.entry));
        v_memory_after := null;
        v_memory_reason := null;
        if v_current_memory is null then
          v_memory_action := 'manter';
          v_memory_reason := 'memoria_apagada';
        elsif not (v_change ? 'after_memories')
              or v_snapshot_now is distinct from v_snapshot_left
              or v_current_memory.active is distinct from (v_change -> 'after' ->> 'active')::boolean
              or v_current_memory.non_catalog_kind is distinct from v_change -> 'after' ->> 'non_catalog_kind' then
          v_memory_action := 'manter';
          v_memory_reason := 'mudou_depois';
        else
          -- Volta inteira, com a versão que tinha: assim o desfazer de uma
          -- correção anterior do mesmo item ainda reconhece a memória como
          -- intocada, e a importação volta a decidir como decidia.
          v_memory_action := 'restaurar';
          v_memory_after := jsonb_build_object(
            'active', (v_change -> 'before' ->> 'active')::boolean,
            'non_catalog_kind', v_change -> 'before' ->> 'non_catalog_kind',
            'version', v_change -> 'before' -> 'version'
          );
        end if;
        v_memory_changes := v_memory_changes || jsonb_build_object(
          'mapping_id', v_change ->> 'mapping_id',
          'item_ids', v_change -> 'item_ids',
          'action', v_memory_action,
          'reason', v_memory_reason,
          'before', case when v_current_memory is null then null else jsonb_build_object(
            'active', v_current_memory.active,
            'non_catalog_kind', v_current_memory.non_catalog_kind
          ) end,
          'after', v_memory_after,
          'newer_at', case when v_memory_reason = 'mudou_depois' then v_newer end
        );
      end loop;
    end if;

    -- Grava o que a regra decidiu. updated_at = carimbo da correção; ao
    -- restaurar, a versão que a memória tinha antes da correção desfeita.
    v_memories_changed := array(
      select (change ->> 'mapping_id')::uuid
      from jsonb_array_elements(v_memory_changes) change
      where change ->> 'action' in ('desligar', 'trocar_tipo', 'restaurar')
      order by 1
    );
    update public.payable_non_catalog_mappings mapping
    set active = (change -> 'after' ->> 'active')::boolean,
        non_catalog_kind = change -> 'after' ->> 'non_catalog_kind',
        updated_at = case
          when change ->> 'action' = 'restaurar' and change -> 'after' ->> 'version' is not null
            then (change -> 'after' ->> 'version')::timestamp at time zone 'UTC'
          else v_stamp
        end
    from jsonb_array_elements(v_memory_changes) change
    where mapping.id = (change ->> 'mapping_id')::uuid
      and change ->> 'action' in ('desligar', 'trocar_tipo', 'restaurar');
    v_memories_off := array(
      select (change ->> 'mapping_id')::uuid
      from jsonb_array_elements(v_memory_changes) change
      where change ->> 'action' = 'desligar'
      order by 1
    );
    -- As que ganharam o carimbo desta correção (a restaurada volta com a versão
    -- antiga, que se conhece).
    v_memories_stamped := array(
      select (change ->> 'mapping_id')::uuid
      from jsonb_array_elements(v_memory_changes) change
      where change ->> 'action' in ('desligar', 'trocar_tipo')
      order by 1
    );

    -- Foto, por memória atingida, de todas as memórias que casam com os itens
    -- como a correção as deixou: é com ela que o desfazer confere, versão por
    -- versão, que nada mudou depois. A versão da memória mexida aqui vai nula
    -- (é o carimbo da correção, que fica fora do hash).
    if v_action = 'corrigir' then
      select coalesce(jsonb_agg(change || jsonb_build_object('after_memories', (
               select coalesce(jsonb_agg(snapshot.entry order by snapshot.entry ->> 'mapping_id'), '[]'::jsonb)
               from (
                 select distinct jsonb_build_object(
                          'mapping_id', memory ->> 'mapping_id',
                          'version', case when (memory ->> 'mapping_id')::uuid = any(v_memories_stamped)
                                          then null else memory -> 'version' end
                        ) as entry
                 from jsonb_array_elements_text(change -> 'item_ids') as involved(item_id)
                 cross join lateral jsonb_array_elements(private.memorias_casadas_item_nfe(involved.item_id::uuid)) memory
               ) snapshot
             )) order by change ->> 'mapping_id'), '[]'::jsonb)
        into v_memory_changes
      from jsonb_array_elements(v_memory_changes) change;
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

    -- Memórias de depois: a mexida aqui leva a marca "changed" no lugar da
    -- versão (o carimbo muda entre a prévia e a confirmação). A próxima
    -- sugestão é calculada como a importação: a ligada gravada por último;
    -- empate fica com a de fora do cadastro.
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
        'memories_after', (
          select coalesce(jsonb_agg(
                   case when (listed.memory ->> 'mapping_id')::uuid = any(v_memories_changed)
                        then listed.memory || jsonb_build_object('version', null, 'changed', true)
                        else listed.memory end
                   order by listed.position), '[]'::jsonb)
          from jsonb_array_elements(private.memorias_do_item_nfe(item.id)) with ordinality as listed(memory, position)
        ),
        -- Foto exata das memórias que casam com o item como esta gravação as
        -- deixou (versão nula = carimbo desta correção): a próxima correção do
        -- item compara com ela para saber se houve decisão mais nova.
        'memories_snapshot', (
          select coalesce(jsonb_agg(snapshot.entry order by snapshot.entry ->> 'mapping_id'), '[]'::jsonb)
          from (
            select distinct jsonb_build_object(
                     'mapping_id', memory ->> 'mapping_id',
                     'version', case when (memory ->> 'mapping_id')::uuid = any(v_memories_stamped)
                                     then null else memory -> 'version' end
                   ) as entry
            from jsonb_array_elements(private.memorias_casadas_item_nfe(item.id)) memory
          ) snapshot
        ),
        'next_suggestion', (
          select candidate.memory - 'version'
          from jsonb_array_elements(private.memorias_do_item_nfe(item.id)) as candidate(memory)
          order by (candidate.memory ->> 'version')::timestamp desc nulls last,
                   (candidate.memory ->> 'kind' = 'uso_despesa') desc,
                   candidate.memory ->> 'mapping_id'
          limit 1
        )
      ) order by item.id)
      into v_items
    from public.payable_purchase_items item
    join public.payable_purchases purchase on purchase.id = item.purchase_id
    left join public.suppliers supplier on supplier.id = purchase.supplier_id
    where item.id = any(v_item_ids);

    select coalesce(jsonb_agg(jsonb_build_object(
        'product_id', product.id,
        'name', product.name,
        'unit', product.unit,
        'active', product.active,
        'cost_before', (v_costs_before ->> product.id::text)::numeric,
        'cost_after', product.cost_price
      ) order by product.id), '[]'::jsonb)
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
      'memory_changes', v_memory_changes,
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
      request_id, action, undoes_correction_id, product_ids, item_ids, requested, impact, impact_hash,
      corrected_by, corrected_at
    ) values (
      p_request_id, v_action, p_undo_correction_id, v_product_ids, v_item_ids, v_requested, v_impact, v_hash,
      v_uid, v_stamp
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
               'from_non_catalog_kind', entry -> 'before' ->> 'non_catalog_kind',
               'to_non_catalog_kind', entry -> 'after' ->> 'non_catalog_kind',
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
