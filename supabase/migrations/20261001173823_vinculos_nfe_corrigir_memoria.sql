-- Vínculos de NF-e, fase 3: corrigir ou desligar a memória de vínculo por
-- fornecedor para as próximas importações (01/10/2026).
--
-- A memória (public.payable_product_mappings) diz à importação de NF-e qual
-- produto do catálogo sugerir para um item de um fornecedor. Até aqui ela só
-- mudava quando alguém confirmava uma nota. Agora Administração e o Financeiro
-- autorizado (decisão do Rodrigo em 28/09 e 01/10/2026) podem, pela tela
-- Catálogo > Vínculos NF-e:
--   * corrigir: apontar a memória para outro produto, com o fator conferido;
--   * desligar: a próxima nota daquele item chega sem sugestão;
--   * religar: desfazer um desligamento, se o item não ganhou outra memória.
--
-- Nada aqui toca notas já gravadas, fichas, custos ou contas: a memória só vale
-- para importações futuras. Quem está com uma NF-e aberta enquanto a memória
-- muda normalmente é barrado ao salvar, porque a tela de importação compara a
-- memória aberta com a atual (updated_at entra nessa comparação). A comparação
-- é feita no navegador antes do envio: uma correção que chegue depois dela pode
-- ser substituída pela escolha confirmada na nota (limite documentado em
-- docs/COMPRAS_POR_XML.md).
--
-- Escrita somente pela função protegida public.correct_payable_product_mapping:
--   * versão: recebe o updated_at que a tela leu e recusa se a memória mudou;
--   * idempotência: o identificador do pedido é único no histórico; repetir o
--     mesmo pedido devolve o resultado gravado sem aplicar de novo;
--   * histórico: cada correção guarda autor, data, o antes e o depois.

begin;

-- Mesma regra da consulta da fase 2 (public.list_vinculo_nfe_authors e
-- canViewNfeLinks no site): administrador ativo, ou financeiro ativo com a rota
-- do Catálogo e o Contas a pagar da JC.
create or replace function private.pode_corrigir_vinculos_nfe()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and (
        profile.role = 'admin'
        or (
          profile.role = 'financeiro'
          and coalesce(profile.allowed_routes, '[]'::jsonb) ?| array['/produtos', '*']
          and private.current_user_can_payables('contas_pagar.acessar')
        )
      )
  );
$$;

revoke all on function private.pode_corrigir_vinculos_nfe() from public, anon, authenticated;
grant execute on function private.pode_corrigir_vinculos_nfe() to authenticated;

create table if not exists public.payable_product_mapping_corrections (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  mapping_id uuid not null references public.payable_product_mappings(id),
  action text not null check (action in ('corrigir', 'desligar', 'religar')),
  previous jsonb not null,
  result jsonb not null,
  corrected_by uuid not null references auth.users(id),
  corrected_at timestamptz not null default clock_timestamp()
);

create index if not exists payable_product_mapping_corrections_mapping_idx
  on public.payable_product_mapping_corrections (mapping_id, corrected_at desc);

revoke all on table public.payable_product_mapping_corrections from public, anon, authenticated;
grant select on table public.payable_product_mapping_corrections to authenticated;
alter table public.payable_product_mapping_corrections enable row level security;
alter table public.payable_product_mapping_corrections force row level security;

drop policy if exists payable_product_mapping_corrections_select_managers
on public.payable_product_mapping_corrections;
create policy payable_product_mapping_corrections_select_managers
on public.payable_product_mapping_corrections for select to authenticated
using (private.pode_corrigir_vinculos_nfe());

create or replace function public.correct_payable_product_mapping(
  p_request_id uuid,
  p_mapping_id uuid,
  p_expected_updated_at timestamptz,
  p_action text,
  p_product_id uuid default null,
  p_conversion_factor numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mapping public.payable_product_mappings%rowtype;
  v_existing public.payable_product_mapping_corrections%rowtype;
  v_product_name text;
  v_product_unit text;
  v_product_active boolean;
  v_previous jsonb;
  v_result jsonb;
  v_correction_id uuid;
  v_now timestamptz;
  v_supplier_id uuid;
begin
  if not private.pode_corrigir_vinculos_nfe() then
    raise exception using errcode = '42501', message = 'Sem permissão para corrigir vínculos de NF-e.';
  end if;
  if p_request_id is null or p_mapping_id is null then
    raise exception using errcode = '22023', message = 'Pedido de correção incompleto.';
  end if;
  if p_action is null or p_action not in ('corrigir', 'desligar', 'religar') then
    raise exception using errcode = '22023', message = 'Ação de correção inválida.';
  end if;

  select mapping.supplier_id into v_supplier_id
  from public.payable_product_mappings mapping
  where mapping.id = p_mapping_id;
  if not found then
    raise exception using errcode = '22023', message = 'Memória de vínculo não encontrada.';
  end if;
  -- Mesma fila das funções que gravam a memória deste fornecedor
  -- (create_xml_payable, classify_payable_item e
  -- classify_payable_item_without_product): uma decisão de memória por
  -- fornecedor de cada vez. Sem ela, duas correções em linhas diferentes do
  -- mesmo item poderiam conferir a duplicidade ao mesmo tempo e ligar as duas.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('payable-mapping-supplier:' || v_supplier_id::text, 0)
  );

  -- A trava da linha vem antes da conferência do pedido repetido: dois envios
  -- simultâneos do mesmo pedido esperam aqui, e o segundo encontra o histórico
  -- do primeiro.
  select * into v_mapping
  from public.payable_product_mappings mapping
  where mapping.id = p_mapping_id
  for update;

  select * into v_existing
  from public.payable_product_mapping_corrections correction
  where correction.request_id = p_request_id;
  if found then
    -- Só é repetição o mesmo pedido: mesma memória, mesma ação e, ao corrigir,
    -- o mesmo produto e o mesmo fator. Identificador reaproveitado com outro
    -- conteúdo é recusado, nunca respondido com o resultado de outra escolha.
    if v_existing.mapping_id <> p_mapping_id or v_existing.action <> p_action
       or (p_action = 'corrigir' and (
         v_existing.result ->> 'base_product_id' is distinct from p_product_id::text
         or (v_existing.result ->> 'conversion_factor')::numeric is distinct from p_conversion_factor))
       or (p_action <> 'corrigir' and (p_product_id is not null or p_conversion_factor is not null)) then
      raise exception using errcode = '22023', message = 'Este pedido já foi usado em outra correção.';
    end if;
    return jsonb_build_object(
      'correction_id', v_existing.id,
      'mapping_id', v_existing.mapping_id,
      'action', v_existing.action,
      'updated_at', v_existing.result ->> 'updated_at',
      'replayed', true
    );
  end if;

  if p_expected_updated_at is null or v_mapping.updated_at <> p_expected_updated_at then
    -- PT409 e não 40001: o PostgREST repete 40001 sem limite (ver
    -- 20260930094600_conflito_pj_sem_repeticao.sql); PT409 volta como HTTP 409.
    raise exception using errcode = 'PT409',
      message = 'Esta memória mudou desde que a tela foi aberta. Recarregue e confira de novo.';
  end if;

  select product.name into v_product_name
  from public.products product where product.id = v_mapping.base_product_id;
  v_previous := jsonb_build_object(
    'base_product_id', v_mapping.base_product_id,
    'base_product_name', v_product_name,
    'base_unit', v_mapping.base_unit,
    'conversion_basis', v_mapping.conversion_basis,
    'conversion_factor', v_mapping.conversion_factor,
    'factor_confirmed', v_mapping.factor_confirmed,
    'active', v_mapping.active,
    'last_confirmed_at', v_mapping.last_confirmed_at,
    'last_confirmed_by', v_mapping.last_confirmed_by,
    'updated_at', v_mapping.updated_at
  );

  -- Corrigir ou religar não pode deixar duas respostas ligadas para o mesmo
  -- item: a importação ficaria com a mais recente e a outra decisão sumiria
  -- sem aviso. A identificação do item repete a das funções que gravam a
  -- memória (create_xml_payable e classify_payable_item); o código de barras
  -- já chega normalizado pelo gatilho private.normalizar_gtin_memoria_fornecedor.
  if p_action in ('corrigir', 'religar') and (
    exists (
      select 1 from public.payable_product_mappings other
      where other.id <> v_mapping.id and other.active
        and other.supplier_id = v_mapping.supplier_id
        and other.purchase_unit = v_mapping.purchase_unit
        and (
          (v_mapping.supplier_product_code is not null and other.supplier_product_code = v_mapping.supplier_product_code)
          or (v_mapping.supplier_ean is not null and other.supplier_ean = v_mapping.supplier_ean)
          or (v_mapping.supplier_product_code is null and v_mapping.supplier_ean is null
              and lower(trim(other.supplier_description)) = lower(trim(v_mapping.supplier_description)))
        )
    )
    or exists (
      select 1 from public.payable_non_catalog_mappings other
      where other.active
        and other.supplier_id = v_mapping.supplier_id
        and other.purchase_unit = v_mapping.purchase_unit
        and (
          (v_mapping.supplier_product_code is not null and other.supplier_product_code = v_mapping.supplier_product_code)
          or (v_mapping.supplier_ean is not null and other.supplier_ean = v_mapping.supplier_ean)
          or (v_mapping.supplier_product_code is null and v_mapping.supplier_ean is null
              and lower(trim(other.supplier_description)) = lower(trim(v_mapping.supplier_description)))
        )
    )
  ) then
    raise exception using errcode = '22023',
      message = 'Este item do fornecedor tem outra memória ligada. Desligue a que estiver errada antes de corrigir ou religar esta.';
  end if;

  v_now := clock_timestamp();

  if p_action = 'desligar' then
    if p_product_id is not null or p_conversion_factor is not null then
      raise exception using errcode = '22023', message = 'Desligar a memória não troca produto nem fator.';
    end if;
    if not v_mapping.active then
      raise exception using errcode = '22023', message = 'Esta memória já está desligada.';
    end if;
    update public.payable_product_mappings mapping
    set active = false, updated_at = v_now
    where mapping.id = v_mapping.id;

  elsif p_action = 'religar' then
    if p_product_id is not null or p_conversion_factor is not null then
      raise exception using errcode = '22023', message = 'Religar a memória não troca produto nem fator; use Corrigir.';
    end if;
    if v_mapping.active then
      raise exception using errcode = '22023', message = 'Esta memória já está ligada.';
    end if;
    select product.active into v_product_active
    from public.products product where product.id = v_mapping.base_product_id;
    if not coalesce(v_product_active, false) then
      raise exception using errcode = '22023',
        message = 'O produto desta memória está inativo no catálogo. Use Corrigir para escolher outro produto.';
    end if;
    update public.payable_product_mappings mapping
    set active = true, updated_at = v_now
    where mapping.id = v_mapping.id;

  else
    if p_product_id is null then
      raise exception using errcode = '22023', message = 'Escolha o produto do catálogo.';
    end if;
    select product.name, coalesce(product.unit, 'un'), product.active
      into v_product_name, v_product_unit, v_product_active
    from public.products product where product.id = p_product_id;
    if not coalesce(v_product_active, false) then
      raise exception using errcode = '22023', message = 'O produto escolhido não existe ou está inativo.';
    end if;
    if p_conversion_factor is null or p_conversion_factor <= 0 or p_conversion_factor >= 100000000 then
      raise exception using errcode = '22023', message = 'Informe quanto vem em cada unidade da nota (maior que zero).';
    end if;
    if p_conversion_factor <> round(p_conversion_factor, 6) then
      raise exception using errcode = '22023', message = 'O fator aceita no máximo seis casas decimais.';
    end if;
    if v_mapping.active
       and v_mapping.base_product_id = p_product_id
       and v_mapping.conversion_factor = p_conversion_factor
       and v_mapping.base_unit = v_product_unit then
      raise exception using errcode = '22023', message = 'A correção não muda nada nesta memória.';
    end if;
    -- O fator foi digitado e conferido na prévia da correção; por isso a
    -- memória sai com o fator confirmado, como faz a tela de conversões do
    -- Catálogo (public.update_payable_product_mappings).
    update public.payable_product_mappings mapping
    set base_product_id = p_product_id,
        base_unit = v_product_unit,
        conversion_factor = p_conversion_factor,
        factor_confirmed = true,
        active = true,
        last_confirmed_at = v_now,
        last_confirmed_by = (select auth.uid()),
        updated_at = v_now
    where mapping.id = v_mapping.id;
  end if;

  select * into v_mapping
  from public.payable_product_mappings mapping
  where mapping.id = p_mapping_id;
  select product.name into v_product_name
  from public.products product where product.id = v_mapping.base_product_id;
  v_result := jsonb_build_object(
    'base_product_id', v_mapping.base_product_id,
    'base_product_name', v_product_name,
    'base_unit', v_mapping.base_unit,
    'conversion_basis', v_mapping.conversion_basis,
    'conversion_factor', v_mapping.conversion_factor,
    'factor_confirmed', v_mapping.factor_confirmed,
    'active', v_mapping.active,
    'last_confirmed_at', v_mapping.last_confirmed_at,
    'last_confirmed_by', v_mapping.last_confirmed_by,
    'updated_at', v_mapping.updated_at
  );

  insert into public.payable_product_mapping_corrections (
    request_id, mapping_id, action, previous, result, corrected_by, corrected_at
  ) values (
    p_request_id, p_mapping_id, p_action, v_previous, v_result, (select auth.uid()), v_now
  )
  returning id into v_correction_id;

  return jsonb_build_object(
    'correction_id', v_correction_id,
    'mapping_id', p_mapping_id,
    'action', p_action,
    'updated_at', v_mapping.updated_at,
    'replayed', false
  );
end;
$$;

revoke all on function public.correct_payable_product_mapping(uuid, uuid, timestamptz, text, uuid, numeric) from public, anon, authenticated;
grant execute on function public.correct_payable_product_mapping(uuid, uuid, timestamptz, text, uuid, numeric) to authenticated;

-- Autores: parte da definição vigente (20260929215549_vinculos_nfe_autores_consulta)
-- e acrescenta quem corrigiu memórias que entram ou saem do produto consultado.
-- A regra de acesso continua a mesma, agora pela função comum.
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
  )
  order by profile.display_name;
end;
$$;

revoke all on function public.list_vinculo_nfe_authors(uuid) from public, anon, authenticated;
grant execute on function public.list_vinculo_nfe_authors(uuid) to authenticated;

commit;
