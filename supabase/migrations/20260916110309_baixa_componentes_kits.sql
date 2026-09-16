-- Fase 3 do saneamento do catálogo: baixa de componentes de kit na venda.
--
-- Kit é item comercial composto, não receita nem produção. Vender um kit
-- debita fisicamente os componentes cadastrados em product_components (pão,
-- produto ou uma variante específica de produto), na loja e na venda de
-- origem, de forma rastreável e idempotente.
--
-- Este ERP não tem hoje um evento de "venda de balcão" transacional: o único
-- registro real de venda é a importação do relatório do PDV (CNM), que por
-- decisão explícita da migration anterior (20260914004852) não altera
-- estoque. Esta migration abre uma exceção estreita: quando uma linha
-- importada é vinculada (sales_product_mappings) a um produto kind='kit', a
-- baixa dos componentes físicos passa a ser gerada e mantida em sincronia com
-- o ciclo de vida da importação (confirmação, substituição, restauração) e
-- do próprio vínculo. Isso não torna o CNM autoritativo sobre custo ou
-- preço — só o efeito de estoque do kit específico é novo. Pedido de
-- encomenda, PJ, romaneio e os demais fluxos continuam sem qualquer baixa
-- própria; nenhum caminho fora deste escopo foi tocado.

begin;

-- ---------------------------------------------------------------------------
-- 1. product_components: componente pode apontar para uma variante
--    específica do produto (necessário pro kit citar "Brioche Hambúrguer
--    80 g", não só "Brioche" genérico). Nulo cascateia o produto inteiro,
--    sem distinguir variante — comportamento legado preservado.
-- ---------------------------------------------------------------------------

alter table public.product_components
  add column component_variant_id uuid references public.product_variants(id);

alter table public.product_components
  add constraint product_components_variant_requires_product
  check (component_variant_id is null or component_source = 'product');

comment on column public.product_components.component_variant_id is
  'Variante especifica do produto componente (component_source=product). Nulo cascateia o produto inteiro, sem distinguir variante.';

-- Cross-tabela (a variante precisa pertencer ao mesmo produto do componente)
-- não cabe em CHECK puro; falha fechada por trigger, mesmo padrão de
-- private.validate_order_product_variant (20260916052614).
create function private.validate_product_component_variant() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.component_variant_id is not null and not exists (
    select 1 from public.product_variants v
    where v.id = new.component_variant_id
      and new.component_source = 'product'
      and v.product_id::text = new.component_id
  ) then
    raise exception using errcode = '23514',
      message = 'A variante informada nao pertence a este componente.';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_product_component_variant() from public, anon, authenticated;
grant execute on function private.validate_product_component_variant() to service_role;

create trigger validate_product_component_variant
before insert or update of component_variant_id, component_source, component_id
on public.product_components
for each row execute function private.validate_product_component_variant();

-- A unicidade antiga (parent, source, id) impedia dois componentes do mesmo
-- produto com variantes diferentes no mesmo kit (ex.: 2un Hambúrguer + 3un
-- Forma). Amplia pra incluir a variante; nulls not distinct preserva a
-- colisão legada quando não há variante.
alter table public.product_components
  drop constraint product_components_parent_product_id_component_source_compo_key;
alter table public.product_components
  add constraint product_components_parent_source_component_variant_key
  unique nulls not distinct (parent_product_id, component_source, component_id, component_variant_id);

-- ---------------------------------------------------------------------------
-- 2. bread_movements: a baixa de um componente-variante precisa preservar
--    qual variante saiu, não só o produto. Mesmo padrão das tabelas do
--    pipeline PJ (20260916052614).
-- ---------------------------------------------------------------------------

alter table public.bread_movements
  add column product_variant_id uuid references public.product_variants(id);

alter table public.bread_movements
  add constraint bread_movements_variant_requires_product
  check (product_variant_id is null or product_source = 'product');

comment on column public.bread_movements.product_variant_id is
  'Variante do produto debitado/creditado neste movimento, quando o componente de origem (kit, receita) aponta para uma variante especifica.';

-- ---------------------------------------------------------------------------
-- 3. Baixa de kit vendido: motor de sincronização.
--
-- Cada linha de venda (sales_import_items, imutável) que hoje resolve pra um
-- produto kind='kit' gera um movimento de bread_movements por componente
-- físico do kit, multiplicando a quantidade vendida pela quantidade da
-- composição. reference_type='venda_kit' e reference_id=item.id (uuid da
-- linha, imutável e único) tornam a sincronização idempotente por natureza:
-- resincronizar sempre apaga e recria os movimentos daquele item, nunca soma
-- em cima do que já existe. Import substituído ou item sem vínculo pra kit
-- fica sem movimento — nunca órfão.
-- ---------------------------------------------------------------------------

create function private.sync_kit_sale_movement_for_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.sales_import_items%rowtype;
  v_import public.sales_imports%rowtype;
  v_mapping public.sales_product_mappings%rowtype;
  v_product public.products%rowtype;
  v_user_name text;
begin
  select * into v_item from public.sales_import_items item where item.id = p_item_id;
  if v_item.id is null then
    return;
  end if;
  select * into v_import from public.sales_imports import where import.id = v_item.import_id;

  -- Sempre limpa antes: reprocessar nunca soma em cima do que já existe, e
  -- vínculo removido/trocado pra não-kit não deixa órfão.
  delete from public.bread_movements
  where reference_type = 'venda_kit' and reference_id = v_item.id::text;

  -- Só gera para import ativo (confirmed); import substituído fica sem
  -- movimento — a versão vigente é a única fonte de verdade do dia.
  if v_import.id is null or v_import.status <> 'confirmed' then
    return;
  end if;

  select * into v_mapping
  from public.sales_product_mappings mapping
  where mapping.source_system = v_import.source_system
    and mapping.store = v_import.store
    and mapping.external_product_key = v_item.external_product_key;
  if v_mapping.id is null or v_mapping.decision <> 'mapped' then
    return;
  end if;

  select * into v_product from public.products product where product.id = v_mapping.product_id;
  if v_product.id is null or v_product.kind <> 'kit' then
    return;
  end if;

  select profile.display_name into v_user_name
  from public.app_profiles profile
  where profile.user_id = (select auth.uid()) and profile.active;
  if v_user_name is null then
    v_user_name := 'sistema';
  end if;

  insert into public.bread_movements (
    movement_type, bread_id, location, quantity, reference_id, reference_type,
    recorded_by, product_source, product_id, product_variant_id
  )
  select
    'venda_kit',
    case when component.component_source = 'bread' then component.component_id end,
    v_import.store,
    -(component.quantity * v_item.quantity),
    v_item.id::text,
    'venda_kit',
    v_user_name,
    component.component_source,
    component.component_id,
    component.component_variant_id
  from public.product_components component
  where component.parent_product_id = v_product.id;
end;
$$;
revoke all on function private.sync_kit_sale_movement_for_item(uuid) from public, anon, authenticated;
grant execute on function private.sync_kit_sale_movement_for_item(uuid) to service_role;

create function private.sync_kit_sale_movements_for_import(p_import_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_item_id uuid;
begin
  for v_item_id in
    select item.id from public.sales_import_items item where item.import_id = p_import_id
  loop
    perform private.sync_kit_sale_movement_for_item(v_item_id);
  end loop;
end;
$$;
revoke all on function private.sync_kit_sale_movements_for_import(uuid) from public, anon, authenticated;
grant execute on function private.sync_kit_sale_movements_for_import(uuid) to service_role;

create function private.sync_kit_sale_movements_for_key(p_source_system text, p_store text, p_external_product_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_item_id uuid;
begin
  for v_item_id in
    select item.id
    from public.sales_import_items item
    join public.sales_imports import on import.id = item.import_id
    where import.source_system = p_source_system
      and import.store = p_store
      and import.status = 'confirmed'
      and item.external_product_key = p_external_product_key
  loop
    perform private.sync_kit_sale_movement_for_item(v_item_id);
  end loop;
end;
$$;
revoke all on function private.sync_kit_sale_movements_for_key(text, text, text) from public, anon, authenticated;
grant execute on function private.sync_kit_sale_movements_for_key(text, text, text) to service_role;

create function private.sync_kit_sale_movements_for_product(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_mapping record;
begin
  for v_mapping in
    select mapping.source_system, mapping.store, mapping.external_product_key
    from public.sales_product_mappings mapping
    where mapping.decision = 'mapped' and mapping.product_id = p_product_id
  loop
    perform private.sync_kit_sale_movements_for_key(v_mapping.source_system, v_mapping.store, v_mapping.external_product_key);
  end loop;
end;
$$;
revoke all on function private.sync_kit_sale_movements_for_product(uuid) from public, anon, authenticated;
grant execute on function private.sync_kit_sale_movements_for_product(uuid) to service_role;

-- Editar a composição de um kit já vendido (corrigir quantidade, adicionar
-- ou remover componente) precisa refletir na baixa das vendas já
-- confirmadas — senão o cadastro corrige e a baixa fica desatualizada até
-- o próximo evento de venda/vínculo mexer nela de novo. Cobre todo INSERT,
-- UPDATE ou DELETE em product_components, mesmo os que não passam pela
-- ficha técnica (ex.: importar receita de outro produto).
create function private.sync_kit_sale_movements_after_component_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform private.sync_kit_sale_movements_for_product(old.parent_product_id);
    return old;
  end if;
  perform private.sync_kit_sale_movements_for_product(new.parent_product_id);
  if tg_op = 'UPDATE' and old.parent_product_id <> new.parent_product_id then
    perform private.sync_kit_sale_movements_for_product(old.parent_product_id);
  end if;
  return new;
end;
$$;
revoke all on function private.sync_kit_sale_movements_after_component_change() from public, anon, authenticated;
grant execute on function private.sync_kit_sale_movements_after_component_change() to service_role;

create trigger sync_kit_sale_movements_after_component_change
after insert or update or delete on public.product_components
for each row execute function private.sync_kit_sale_movements_after_component_change();

-- ---------------------------------------------------------------------------
-- 4. Entrada em sincronia com o motor: confirmação/substituição de import,
--    restauração de versão antiga e mudança de vínculo produto<->venda.
--    Corpo idêntico ao de 20260914004852/20260914085043, só com as chamadas
--    de sincronização inseridas nos pontos onde o conjunto de movimentos
--    "vigente" muda.
-- ---------------------------------------------------------------------------

create or replace function public.confirm_sales_import(
  p_source_system text,
  p_store text,
  p_report_type text,
  p_sale_date date,
  p_file_name text,
  p_file_hash text,
  p_storage_path text,
  p_parser_version text,
  p_reported_total numeric,
  p_replacement_reason text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active public.sales_imports%rowtype;
  v_existing public.sales_imports%rowtype;
  v_import_id uuid;
  v_item record;
  v_rows integer := 0;
  v_total_quantity numeric := 0;
  v_total_net numeric := 0;
begin
  if p_source_system <> 'cnm' or p_store <> 'jc' or p_report_type <> 'sales_by_product' then
    raise exception using errcode = '22023', message = 'Origem, loja ou tipo de relatório ainda não habilitado.';
  end if;
  if not private.current_user_can_sales('vendas_balcao.importar', p_store) then
    raise exception using errcode = '42501', message = 'Sem permissão para importar vendas do balcão.';
  end if;
  if p_sale_date is null or p_sale_date > private.data_na_padaria() then
    raise exception using errcode = '22023', message = 'A data da venda não pode estar no futuro.';
  end if;
  if p_file_name !~ '^CNM_(JC_[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{4}-[0-9]{2}-[0-9]{2}_JC)\.xls$'
     or p_file_name not in ('CNM_JC_' || p_sale_date::text || '.xls', 'CNM_' || p_sale_date::text || '_JC.xls') then
    raise exception using errcode = '22023', message = 'O nome do arquivo não confere com a data e a unidade JC.';
  end if;
  if p_file_hash !~ '^[0-9a-f]{64}$'
     or p_storage_path <> p_source_system || '/' || p_store || '/' || p_sale_date::text || '/' || p_file_hash || '.xls' then
    raise exception using errcode = '22023', message = 'Identificação do arquivo original inválida.';
  end if;
  if nullif(trim(p_parser_version), '') is null
     or jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 5000 then
    raise exception using errcode = '22023', message = 'A lista de itens do relatório é inválida.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sales-import:' || p_source_system || ':' || p_store || ':' || p_report_type || ':' || p_sale_date::text, 0
  ));

  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'sales-imports' and object.name = p_storage_path
  ) then
    raise exception using errcode = '22023', message = 'O arquivo original ainda não foi guardado.';
  end if;

  for v_item in
    select * from jsonb_to_recordset(p_items) as item(
      line_number integer,
      external_product_key text,
      raw_product_name text,
      raw_category text,
      quantity numeric,
      source_cmv numeric,
      take_away boolean,
      net_total numeric,
      raw_row jsonb
    )
  loop
    if v_item.line_number is null or v_item.line_number <= 0
       or nullif(trim(v_item.external_product_key), '') is null
       or nullif(trim(v_item.raw_product_name), '') is null
       or nullif(trim(v_item.raw_category), '') is null
       or v_item.quantity is null or v_item.quantity <= 0
       or v_item.net_total is null or v_item.net_total < 0
       or (v_item.source_cmv is not null and v_item.source_cmv < 0)
       or jsonb_typeof(coalesce(v_item.raw_row, 'null'::jsonb)) <> 'array' then
      raise exception using errcode = '22023', message = 'Há item inválido no relatório de vendas.';
    end if;
    v_rows := v_rows + 1;
    v_total_quantity := v_total_quantity + round(v_item.quantity, 4);
    v_total_net := v_total_net + round(v_item.net_total, 2);
  end loop;

  if p_reported_total is null or abs(round(v_total_net, 2) - round(p_reported_total, 2)) > 0.01 then
    raise exception using errcode = '22023', message = 'A soma dos produtos não fecha com o total informado no arquivo.';
  end if;

  select * into v_active from public.sales_imports import
  where import.source_system = p_source_system and import.store = p_store
    and import.report_type = p_report_type and import.sale_date = p_sale_date
    and import.status = 'confirmed'
  for update;

  if v_active.id is not null and v_active.file_hash = p_file_hash then
    return jsonb_build_object('id', v_active.id, 'outcome', 'unchanged');
  end if;
  if v_active.id is not null and length(trim(coalesce(p_replacement_reason, ''))) < 3 then
    raise exception using errcode = '23505', message = 'Já existe outra versão para este dia. Informe o motivo da substituição.';
  end if;

  select * into v_existing from public.sales_imports import
  where import.source_system = p_source_system and import.store = p_store
    and import.report_type = p_report_type
    and import.file_hash = p_file_hash;
  if v_existing.id is not null then
    raise exception using errcode = '23505',
      message = 'Este mesmo arquivo já foi importado em ' || to_char(v_existing.sale_date, 'DD/MM/YYYY') || '.';
  end if;

  if v_active.id is not null then
    update public.sales_imports
    set status = 'replaced', replaced_by = (select auth.uid()), replaced_at = now()
    where id = v_active.id;
    -- Import substituído deixa de ser a fonte vigente: apaga os movimentos de
    -- kit que a versão antiga tinha gerado, sem deixar estoque órfão.
    perform private.sync_kit_sale_movements_for_import(v_active.id);
  end if;

  insert into public.sales_imports (
    source_system, store, report_type, sale_date, file_name, file_hash,
    storage_path, parser_version, row_count, total_quantity, total_net,
    replaces_import_id, replacement_reason, confirmed_by
  ) values (
    p_source_system, p_store, p_report_type, p_sale_date, p_file_name, p_file_hash,
    p_storage_path, trim(p_parser_version), v_rows, round(v_total_quantity, 4),
    round(v_total_net, 2), v_active.id,
    case when v_active.id is null then null else nullif(trim(p_replacement_reason), '') end,
    (select auth.uid())
  ) returning id into v_import_id;

  insert into public.sales_import_items (
    import_id, line_number, external_product_key, raw_product_name, raw_category,
    quantity, source_cmv, take_away, net_total, raw_row
  )
  select v_import_id, item.line_number, trim(item.external_product_key),
    trim(item.raw_product_name), trim(item.raw_category), round(item.quantity, 4),
    case when item.source_cmv is null then null else round(item.source_cmv, 2) end,
    item.take_away, round(item.net_total, 2), item.raw_row
  from jsonb_to_recordset(p_items) as item(
    line_number integer, external_product_key text, raw_product_name text,
    raw_category text, quantity numeric, source_cmv numeric, take_away boolean,
    net_total numeric, raw_row jsonb
  );

  insert into public.sales_import_events (import_id, source_system, store, sale_date, event_type, details, occurred_by)
  values (
    v_import_id, p_source_system, p_store, p_sale_date,
    case when v_active.id is null then 'created' else 'replaced' end,
    jsonb_build_object('previous_import_id', v_active.id, 'reason', case when v_active.id is null then null else trim(p_replacement_reason) end),
    (select auth.uid())
  );
  insert into public.sales_import_events (import_id, source_system, store, sale_date, event_type, details, occurred_by)
  select v_import_id, status.source_system, status.store, status.sale_date, 'day_status_cleared',
    jsonb_build_object('status', status.status, 'reason', status.reason), (select auth.uid())
  from public.sales_day_statuses status
  where status.source_system = p_source_system and status.store = p_store and status.sale_date = p_sale_date;
  delete from public.sales_day_statuses status
  where status.source_system = p_source_system and status.store = p_store and status.sale_date = p_sale_date;

  -- Import novo vira a fonte vigente: gera a baixa dos itens já vinculados a
  -- kit. Item ainda sem vínculo fica pendente até o vínculo ser feito, e o
  -- vínculo faz a própria sincronização (ver set_sales_product_mapping).
  perform private.sync_kit_sale_movements_for_import(v_import_id);

  return jsonb_build_object('id', v_import_id, 'outcome', case when v_active.id is null then 'created' else 'replaced' end);
end;
$$;
revoke all on function public.confirm_sales_import(text, text, text, date, text, text, text, text, numeric, text, jsonb) from public, anon;
grant execute on function public.confirm_sales_import(text, text, text, date, text, text, text, text, numeric, text, jsonb) to authenticated;

create or replace function public.restore_sales_import(p_import_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_target public.sales_imports%rowtype; v_active public.sales_imports%rowtype;
begin
  select * into v_target from public.sales_imports where id = p_import_id;
  if v_target.id is null or length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception using errcode='22023', message='Versão e motivo da restauração são obrigatórios.';
  end if;
  if not private.current_user_can_sales('vendas_balcao.importar', v_target.store) then
    raise exception using errcode='42501', message='Sem permissão para restaurar vendas do balcão.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sales-import:'||v_target.source_system||':'||v_target.store||':'||v_target.report_type||':'||v_target.sale_date::text, 0));
  select * into v_active from public.sales_imports import
  where import.source_system=v_target.source_system and import.store=v_target.store
    and import.report_type=v_target.report_type and import.sale_date=v_target.sale_date and import.status='confirmed'
  for update;
  if v_active.id = v_target.id then return v_target.id; end if;
  if v_active.id is null then raise exception using errcode='P0001', message='O dia não possui versão ativa para restaurar com segurança.'; end if;
  update public.sales_imports set status='replaced', replaced_by=(select auth.uid()), replaced_at=now() where id=v_active.id;
  update public.sales_imports set status='confirmed', replaced_by=null, replaced_at=null where id=v_target.id;
  -- Troca de versão vigente: apaga a baixa da versão que sai e regenera a da
  -- versão restaurada, na mesma transação.
  perform private.sync_kit_sale_movements_for_import(v_active.id);
  perform private.sync_kit_sale_movements_for_import(v_target.id);
  insert into public.sales_import_events(import_id,source_system,store,sale_date,event_type,details,occurred_by)
  values(v_target.id,v_target.source_system,v_target.store,v_target.sale_date,'restored',
    jsonb_build_object('replaced_import_id',v_active.id,'reason',trim(p_reason)),(select auth.uid()));
  return v_target.id;
end; $$;
revoke all on function public.restore_sales_import(uuid,text) from public,anon;
grant execute on function public.restore_sales_import(uuid,text) to authenticated;

create or replace function public.set_sales_product_mapping(
  p_source_system text,
  p_store text,
  p_external_product_key text,
  p_decision text,
  p_product_id uuid default null,
  p_sale_unit text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.sales_product_mappings%rowtype;
  v_product public.products%rowtype;
  v_mapping_id uuid;
  v_is_change boolean := false;
begin
  if p_source_system is distinct from 'cnm' or p_store is distinct from 'jc'
     or nullif(trim(p_external_product_key), '') is null
     or length(trim(p_external_product_key)) > 300
     or p_decision is null or p_decision not in ('mapped', 'ignored', 'pending') then
    raise exception using errcode = '22023', message = 'Decisão de vínculo inválida.';
  end if;
  if not private.current_user_can_sales('vendas_balcao.importar', p_store) then
    raise exception using errcode = '42501', message = 'Sem permissão para vincular produtos vendidos.';
  end if;
  if not exists (
    select 1
    from public.sales_import_items item
    join public.sales_imports import on import.id = item.import_id
    where import.source_system = p_source_system
      and import.store = p_store
      and import.status = 'confirmed'
      and item.external_product_key = trim(p_external_product_key)
  ) then
    raise exception using errcode = '22023', message = 'O item vendido não existe nas importações.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sales-product-mapping:' || p_source_system || ':' || p_store || ':' || trim(p_external_product_key), 0
  ));

  select * into v_current
  from public.sales_product_mappings mapping
  where mapping.source_system = p_source_system
    and mapping.store = p_store
    and mapping.external_product_key = trim(p_external_product_key)
  for update;

  if p_decision = 'mapped' then
    if p_product_id is null or p_sale_unit is null or p_sale_unit not in ('un', 'kg') then
      raise exception using errcode = '22023', message = 'Escolha o produto e se a venda foi por unidade ou quilo.';
    end if;
    select * into v_product from public.products product where product.id = p_product_id;
    if v_product.id is null or not v_product.active or v_product.kind = 'insumo' then
      raise exception using errcode = '22023', message = 'Escolha um produto de venda ativo.';
    end if;
    if v_product.kind = 'kit' and p_sale_unit <> 'un' then
      raise exception using errcode = '22023', message = 'Kit só pode ser vendido por unidade.';
    end if;
    if lower(coalesce(v_product.unit, 'un')) <> p_sale_unit and not exists (
      select 1 from public.product_sale_options sale_option
      where sale_option.product_id = p_product_id
        and sale_option.sale_unit = p_sale_unit
        and sale_option.active
    ) then
      raise exception using errcode = '22023', message = 'Essa forma de venda não está cadastrada para o produto.';
    end if;
  elsif p_product_id is not null or p_sale_unit is not null then
    raise exception using errcode = '22023', message = 'Produto e unidade só podem ser informados ao vincular.';
  end if;

  if v_current.id is not null then
    v_is_change := v_current.decision is distinct from nullif(p_decision, 'pending')
      or v_current.product_id is distinct from p_product_id
      or v_current.sale_unit is distinct from p_sale_unit;
    if not v_is_change then
      return jsonb_build_object('id', v_current.id, 'outcome', 'unchanged');
    end if;
    if length(trim(coalesce(p_reason, ''))) < 3 then
      raise exception using errcode = '22023', message = 'Explique o motivo da correção do vínculo.';
    end if;
  end if;

  if p_decision = 'pending' then
    if v_current.id is null then
      return jsonb_build_object('id', null, 'outcome', 'unchanged');
    end if;
    delete from public.sales_product_mappings where id = v_current.id;
    insert into public.sales_product_mapping_events (
      mapping_id, source_system, store, external_product_key, event_type,
      previous_decision, previous_product_id, previous_sale_unit,
      new_decision, reason, occurred_by
    ) values (
      null, p_source_system, p_store, trim(p_external_product_key), 'cleared',
      v_current.decision, v_current.product_id, v_current.sale_unit,
      'pending', trim(p_reason), (select auth.uid())
    );
    -- Vínculo removido: se apontava pra kit, apaga a baixa gerada por ele em
    -- toda venda confirmada com essa chave, sem deixar estoque órfão.
    perform private.sync_kit_sale_movements_for_key(p_source_system, p_store, trim(p_external_product_key));
    return jsonb_build_object('id', null, 'outcome', 'cleared');
  end if;

  insert into public.sales_product_mappings (
    source_system, store, external_product_key, decision, product_id, sale_unit,
    decided_by, updated_by
  ) values (
    p_source_system, p_store, trim(p_external_product_key), p_decision,
    case when p_decision = 'mapped' then p_product_id end,
    case when p_decision = 'mapped' then p_sale_unit end,
    (select auth.uid()), (select auth.uid())
  )
  on conflict (source_system, store, external_product_key) do update set
    decision = excluded.decision,
    product_id = excluded.product_id,
    sale_unit = excluded.sale_unit,
    updated_by = excluded.updated_by,
    updated_at = now()
  returning id into v_mapping_id;

  insert into public.sales_product_mapping_events (
    mapping_id, source_system, store, external_product_key, event_type,
    previous_decision, previous_product_id, previous_sale_unit,
    new_decision, new_product_id, new_sale_unit, reason, occurred_by
  ) values (
    v_mapping_id, p_source_system, p_store, trim(p_external_product_key),
    case when v_current.id is null then 'created' else 'changed' end,
    v_current.decision, v_current.product_id, v_current.sale_unit,
    p_decision,
    case when p_decision = 'mapped' then p_product_id end,
    case when p_decision = 'mapped' then p_sale_unit end,
    nullif(trim(p_reason), ''), (select auth.uid())
  );

  -- Vínculo criado, trocado de produto ou de kg<->un: resincroniza toda venda
  -- confirmada com essa chave — cobre virar kit, deixar de ser kit e trocar
  -- de kit pra outro kit com composição diferente.
  perform private.sync_kit_sale_movements_for_key(p_source_system, p_store, trim(p_external_product_key));

  return jsonb_build_object('id', v_mapping_id, 'outcome', case when v_current.id is null then 'created' else 'changed' end);
end;
$$;
revoke all on function public.set_sales_product_mapping(text, text, text, text, uuid, text, text) from public, anon;
grant execute on function public.set_sales_product_mapping(text, text, text, text, uuid, text, text) to authenticated;

commit;
