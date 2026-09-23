begin;

-- Duplica um cadastro de produto em uma única transação: identidade do
-- catálogo, ficha técnica e preços comerciais. Histórico, estoque, pedidos,
-- compras e vínculos com fornecedores ficam deliberadamente fora.
create function public.duplicate_product_complete(
  p_source_product_id uuid,
  p_new_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.products%rowtype;
  v_new_product_id uuid;
  v_new_name text := btrim(coalesce(p_new_name, ''));
  v_variant record;
  v_new_variant_id uuid;
  v_variant_map jsonb := '{}'::jsonb;
  v_sale_option record;
  v_new_sale_option_id uuid;
  v_sale_option_map jsonb := '{}'::jsonb;
begin
  if v_new_name = '' then
    raise exception using errcode = '22023', message = 'Informe o nome do novo produto.';
  end if;

  -- A cópia dá acesso de escrita a várias tabelas de catálogo de uma vez.
  -- Por isso a função não confia apenas no SECURITY DEFINER: exige a mesma
  -- permissão de quem cria ou altera produtos pela tela.
  if not exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and profile.role = any (array['admin'::text, 'financeiro'::text])
      and coalesce(profile.allowed_routes, '[]'::jsonb) ? '/produtos'
  ) then
    raise exception using errcode = '42501', message = 'Sem permissão para duplicar produtos.';
  end if;

  select * into v_source
  from public.products
  where id = p_source_product_id
  for share;

  if not found then
    raise exception using errcode = 'P0002', message = 'Produto de origem não encontrado.';
  end if;

  -- Produto novo já nasce no catálogo controlado; não perpetua um cadastro
  -- antigo que ainda não recebeu categoria e tipo válidos.
  if v_source.category_id is null or v_source.catalog_type is null then
    raise exception using errcode = '22023', message = 'Classifique o produto de origem antes de duplicá-lo.';
  end if;

  -- sale_option_id só é uma chave estrangeira para a opção, não para o
  -- produto do preço. Cadastro legado inconsistente não pode fazer a cópia
  -- perder silenciosamente uma referência comercial que apontava para fora.
  if exists (
    select 1
    from public.price_tier_items tier_price
    left join public.product_sale_options option_row
      on option_row.id = tier_price.sale_option_id
      and option_row.product_id = p_source_product_id
    where tier_price.product_source = 'product'
      and tier_price.product_id = p_source_product_id::text
      and tier_price.sale_option_id is not null
      and option_row.id is null
    union all
    select 1
    from public.customer_price_overrides override_price
    left join public.product_sale_options option_row
      on option_row.id = override_price.sale_option_id
      and option_row.product_id = p_source_product_id
    where override_price.product_source = 'product'
      and override_price.product_id = p_source_product_id::text
      and override_price.sale_option_id is not null
      and option_row.id is null
  ) then
    raise exception using errcode = '22023', message = 'Há preço ligado a uma opção de venda de outro produto.';
  end if;

  insert into public.products (
    name, category, active, sort_order, cost_price, unit, is_special, kind, is_revenda,
    is_shelf, weekly_count_enabled, is_fabricacao_propria, is_pj,
    catalog_type, category_id, production_days, production_area,
    production_process, allows_planned_production, allows_unplanned_production
  ) values (
    v_new_name, v_source.category, false, v_source.sort_order, v_source.cost_price, v_source.unit,
    v_source.is_special, v_source.kind, v_source.is_revenda, v_source.is_shelf,
    false, v_source.is_fabricacao_propria, v_source.is_pj,
    v_source.catalog_type, v_source.category_id, v_source.production_days,
    v_source.production_area, v_source.production_process,
    v_source.allows_planned_production, v_source.allows_unplanned_production
  ) returning id into v_new_product_id;

  -- Variantes e opções recebem novos IDs. Os mapas mantêm as referências da
  -- ficha e dos preços apontando para a cópia, nunca para o cadastro de origem.
  for v_variant in
    select * from public.product_variants where product_id = p_source_product_id order by sort_order, id
  loop
    insert into public.product_variants (product_id, name, sort_order, active)
    values (v_new_product_id, v_variant.name, v_variant.sort_order, v_variant.active)
    returning id into v_new_variant_id;
    v_variant_map := v_variant_map || jsonb_build_object(v_variant.id::text, v_new_variant_id::text);
  end loop;

  insert into public.product_components (
    parent_product_id, component_source, component_id, component_variant_id, quantity
  )
  select
    v_new_product_id,
    component.component_source,
    case when component.component_id = p_source_product_id::text
      then v_new_product_id::text else component.component_id end,
    case
      when component.component_id = p_source_product_id::text
        and component.component_variant_id is not null
      then (v_variant_map ->> component.component_variant_id::text)::uuid
      else component.component_variant_id
    end,
    component.quantity
  from public.product_components component
  where component.parent_product_id = p_source_product_id;

  insert into public.product_recipe_yields (
    product_id, product_variant_id, batch_name, basis, dough_weight_kg,
    finished_weight_kg, yield_units, notes
  )
  select
    v_new_product_id,
    case when yield_row.product_variant_id is null then null
      else (v_variant_map ->> yield_row.product_variant_id::text)::uuid end,
    yield_row.batch_name, yield_row.basis, yield_row.dough_weight_kg,
    yield_row.finished_weight_kg, yield_row.yield_units, yield_row.notes
  from public.product_recipe_yields yield_row
  where yield_row.product_id = p_source_product_id;

  for v_sale_option in
    select * from public.product_sale_options where product_id = p_source_product_id order by id
  loop
    insert into public.product_sale_options (
      product_id, product_variant_id, name, sale_unit, reference_quantity,
      unit_weight_kg, is_default, active
    ) values (
      v_new_product_id,
      case when v_sale_option.product_variant_id is null then null
        else (v_variant_map ->> v_sale_option.product_variant_id::text)::uuid end,
      v_sale_option.name, v_sale_option.sale_unit, v_sale_option.reference_quantity,
      v_sale_option.unit_weight_kg, v_sale_option.is_default, v_sale_option.active
    ) returning id into v_new_sale_option_id;
    v_sale_option_map := v_sale_option_map || jsonb_build_object(v_sale_option.id::text, v_new_sale_option_id::text);
  end loop;

  insert into public.product_pj_pack_rules (
    product_id, product_variant_id, pack_size_units, min_order_packs,
    order_multiple_packs, notes
  )
  select
    v_new_product_id,
    case when rule.product_variant_id is null then null
      else (v_variant_map ->> rule.product_variant_id::text)::uuid end,
    rule.pack_size_units, rule.min_order_packs, rule.order_multiple_packs, rule.notes
  from public.product_pj_pack_rules rule
  where rule.product_id = p_source_product_id;

  -- As três tabelas abaixo são configurações comerciais, não histórico: a
  -- nova ficha já nasce vendável com os mesmos preços por destino, tabela e
  -- cliente. product_name é uma fotografia exibida nas telas e muda junto.
  insert into public.product_prices (
    product_id, product_source, product_name, destination_id, unit_price, active
  )
  select v_new_product_id::text, 'product', v_new_name, price.destination_id,
    price.unit_price, price.active
  from public.product_prices price
  where price.product_source = 'product' and price.product_id = p_source_product_id::text;

  insert into public.price_tier_items (
    tier_id, product_id, product_source, product_name, unit_price, pricing_unit,
    pack_size, active, sale_option_id
  )
  select tier_price.tier_id, v_new_product_id::text, 'product', v_new_name,
    tier_price.unit_price, tier_price.pricing_unit, tier_price.pack_size,
    tier_price.active,
    case when tier_price.sale_option_id is null then null
      else (v_sale_option_map ->> tier_price.sale_option_id::text)::uuid end
  from public.price_tier_items tier_price
  where tier_price.product_source = 'product' and tier_price.product_id = p_source_product_id::text;

  insert into public.customer_price_overrides (
    customer_id, product_id, product_source, product_name, unit_price,
    pricing_unit, pack_size, active, sale_option_id
  )
  select override_price.customer_id, v_new_product_id::text, 'product', v_new_name,
    override_price.unit_price, override_price.pricing_unit, override_price.pack_size,
    override_price.active,
    case when override_price.sale_option_id is null then null
      else (v_sale_option_map ->> override_price.sale_option_id::text)::uuid end
  from public.customer_price_overrides override_price
  where override_price.product_source = 'product' and override_price.product_id = p_source_product_id::text;

  return v_new_product_id;
end;
$$;

revoke all on function public.duplicate_product_complete(uuid, text) from public, anon;
grant execute on function public.duplicate_product_complete(uuid, text) to authenticated;

commit;
