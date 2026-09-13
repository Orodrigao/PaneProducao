-- Fase 2 das compras por XML: importação pendente de conferência.
--
-- Hoje a importação da NF-e é tudo ou nada: ou vira conta a pagar (com parcelas
-- e custo do insumo atualizado), ou o trabalho de classificar os itens se perde.
-- Esta migração cria um rascunho de importação, separado da conta a pagar por
-- construção: guardar o rascunho nunca cria linha em payable_purchases, parcela
-- ou custo. A tabela guarda o XML original e as decisões da pessoa por linha;
-- ao retomar, o ERP relê o XML com o leitor atual e reaplica as decisões.
--
-- Gate financeiro desde a criação: RLS habilitada e forçada, leitura só para
-- quem pode importar XML na JC, escrita direta revogada e mutação somente por
-- RPC que valida sessão, permissão e escopo. Uma nota tem no máximo um rascunho
-- pendente; reenvio ou duplo toque atualizam a mesma linha.

begin;

create table if not exists public.payable_import_drafts (
  id uuid primary key default gen_random_uuid(),
  store text not null default 'jc' check (store = 'jc'),
  nfe_key text not null check (nfe_key ~ '^[0-9]{44}$'),
  status text not null default 'pendente' check (status in ('pendente', 'confirmada', 'descartada')),
  supplier_id uuid references public.suppliers(id),
  supplier_name text not null check (nullif(trim(supplier_name), '') is not null),
  nfe_number text,
  nfe_series text,
  nfe_issued_at date not null,
  total_value numeric(12,2) not null check (total_value > 0),
  xml_content text not null check (length(xml_content) between 1 and 2000000),
  item_decisions jsonb not null default '[]'::jsonb check (jsonb_typeof(item_decisions) = 'array'),
  installments jsonb not null default '[]'::jsonb check (jsonb_typeof(installments) = 'array'),
  purchase_id uuid references public.payable_purchases(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  discarded_at timestamptz,
  discarded_by uuid references auth.users(id)
);

-- Uma NF-e só pode ter um rascunho pendente por vez; histórico confirmado ou
-- descartado fica preservado.
create unique index if not exists payable_import_drafts_pending_key_idx
  on public.payable_import_drafts (nfe_key)
  where status = 'pendente';
create index if not exists payable_import_drafts_status_idx
  on public.payable_import_drafts (status, updated_at desc);

revoke all on table public.payable_import_drafts from public, anon, authenticated;
grant select on table public.payable_import_drafts to authenticated;
alter table public.payable_import_drafts enable row level security;
alter table public.payable_import_drafts force row level security;

create policy payable_import_drafts_select_importer
on public.payable_import_drafts for select to authenticated
using (
  store = 'jc'
  and private.current_user_can_payables('contas_pagar.importar_xml')
);

-- Salvar (ou atualizar) o rascunho pendente de uma NF-e. Nada aqui toca conta
-- a pagar, parcela, custo ou memória de fornecedor: isso é papel da confirmação.
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
      remember_conversion boolean
    )
  loop
    if v_decision.line_number is null or v_decision.line_number <= 0 then
      raise exception using errcode = '22023', message = 'Linha do item inválida no rascunho.';
    end if;
    if v_decision.mapping_status is null
       or v_decision.mapping_status not in ('pendente', 'mapeado', 'nao_aplicavel') then
      raise exception using errcode = '22023', message = 'Classificação do item inválida.';
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

-- Descartar um rascunho pendente. Repetir o descarte não é erro (duplo toque);
-- descartar o que já virou conta a pagar é.
create or replace function public.discard_xml_import_draft(p_draft_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_nfe_key text;
begin
  if not private.current_user_can_payables('contas_pagar.importar_xml') then
    raise exception using errcode = '42501', message = 'Sem permissão para importar XML.';
  end if;
  if p_draft_id is null then
    raise exception using errcode = '22023', message = 'Rascunho de importação inválido.';
  end if;
  select draft.nfe_key into v_nfe_key
  from public.payable_import_drafts draft
  where draft.id = p_draft_id and draft.store = 'jc';
  if v_nfe_key is null then
    raise exception using errcode = '22023', message = 'Rascunho de importação não encontrado.';
  end if;
  -- Descartar entra na mesma fila que salvar e confirmar a mesma nota: quem
  -- chegar depois enxerga o estado já decidido, nunca um meio-termo.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('payable-import-draft:' || v_nfe_key, 0)
  );
  select draft.status into v_status
  from public.payable_import_drafts draft
  where draft.id = p_draft_id
  for update;
  if v_status is null then
    raise exception using errcode = '22023', message = 'Rascunho de importação não encontrado.';
  end if;
  if v_status = 'confirmada' then
    raise exception using errcode = '22023', message = 'Esta importação já foi confirmada e virou conta a pagar; não há o que descartar.';
  end if;
  if v_status = 'descartada' then
    return;
  end if;
  update public.payable_import_drafts
  set status = 'descartada',
      discarded_at = now(),
      discarded_by = (select auth.uid()),
      updated_by = (select auth.uid()),
      updated_at = now()
  where id = p_draft_id;
end;
$$;

-- A confirmação continua sendo create_xml_payable, copiada da versão vigente
-- (20260902142639) com duas inserções: a trava pela chave da NF-e, que serializa
-- confirmar e salvar rascunho da mesma nota, e a marcação do rascunho pendente
-- como confirmado na mesma transação da conta a pagar. O restante é idêntico;
-- a trava do fator que falha aberta continua como está, por ser PR própria.
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

  -- A confirmação fecha, na mesma transação, o rascunho pendente desta NF-e.
  update public.payable_import_drafts draft
  set status = 'confirmada', purchase_id = v_purchase_id, confirmed_at = now(),
      updated_at = now(), updated_by = (select auth.uid())
  where draft.nfe_key = p_access_key and draft.status = 'pendente';

  insert into public.payable_events (purchase_id, event_type, details, occurred_by)
  values (
    v_purchase_id, 'criada',
    jsonb_build_object('origin', 'xml', 'nfe_key', p_access_key, 'classification_status', v_classification_status),
    (select auth.uid())
  );
  return v_purchase_id;
end;
$$;

-- Confirmar um rascunho retomado: a conta só nasce se o rascunho ainda estiver
-- pendente e na versão que a pessoa abriu na tela. Tudo dentro da mesma fila,
-- na ordem de create_xml_payable (fornecedor e depois chave), para nenhuma
-- rota cruzar travas. Descarte ou salvamento concorrente fazem esta chamada
-- falhar com explicação, em vez de criar conta de rascunho que já morreu.
create or replace function public.confirm_xml_import_draft(
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
  p_installments jsonb
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
  select draft.status, draft.nfe_key, draft.updated_at
    into v_status, v_nfe_key, v_updated_at
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
  return public.create_xml_payable(
    p_request_id, p_access_key, p_supplier_id, p_nfe_number, p_nfe_series, p_issue_date,
    p_payment_method, p_total_value, p_notes, p_items, p_installments
  );
end;
$$;

revoke all on function public.confirm_xml_import_draft(uuid, timestamptz, uuid, text, uuid, text, text, date, text, numeric, text, jsonb, jsonb) from public, anon;
grant execute on function public.confirm_xml_import_draft(uuid, timestamptz, uuid, text, uuid, text, text, date, text, numeric, text, jsonb, jsonb) to authenticated;
revoke all on function public.save_xml_import_draft(text, uuid, text, text, text, date, numeric, text, jsonb, jsonb) from public, anon;
grant execute on function public.save_xml_import_draft(text, uuid, text, text, text, date, numeric, text, jsonb, jsonb) to authenticated;
revoke all on function public.discard_xml_import_draft(uuid) from public, anon;
grant execute on function public.discard_xml_import_draft(uuid) to authenticated;
revoke all on function public.create_xml_payable(uuid, text, uuid, text, text, date, text, numeric, text, jsonb, jsonb) from public, anon;
grant execute on function public.create_xml_payable(uuid, text, uuid, text, text, date, text, numeric, text, jsonb, jsonb) to authenticated;

commit;
