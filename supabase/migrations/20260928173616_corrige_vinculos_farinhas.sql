-- Correção de dados: vínculos das farinhas e memórias de fornecedor erradas
-- (aprovada por Rodrigo em 28/09/2026, lista item a item na PR).
--
-- Depende da migration anterior (memoria_fornecedor_sem_gtin): sem ela, a
-- próxima nota "SEM GTIN" desfaria as memórias corrigidas aqui.
--
-- Como cada caso se protege:
--   * trava as linhas envolvidas e confere o estado lido em produção em
--     28/09/2026 (identidade, cadastro atual e o que mais aponta para ele);
--   * se qualquer conferência falha (banco novo do CI ou do preview, alguém já
--     corrigiu pela tela, a migration rodou de novo), o caso é pulado inteiro,
--     com aviso, antes de qualquer escrita;
--   * cada escrita repete o estado antigo no próprio WHERE e confere que mudou
--     exatamente uma linha; se não, a migration inteira é desfeita com erro, em
--     vez de deixar um caso pela metade.
-- Nenhuma conta, parcela, pagamento ou lançamento do livro-caixa muda: todos os
-- itens mexidos são de Insumos antes e depois, e o valor de cada item fica
-- igual. Nenhum cadastro é apagado.
--
-- 1. Farinha integral da Moinho Nordeste (nota de 22/09): o item foi ligado a um
--    cadastro criado na hora, "FARINHA INTEGRAL KG INSUMO", embora a
--    "Farinha de Trigo Integral" já existisse. O item e a memória do fornecedor
--    passam para ela; o cadastro duplicado é desativado e classificado em
--    Insumos. O custo da integral continua o da nota mais recente (Tondo, 23/09).
-- 2. Nota da Le 5 Stagioni de 11/09: Integral Mora e La Rustica entraram como
--    farinha de croissant, pré-preenchidas pelo defeito do "SEM GTIN". A Mora
--    volta para "FARINHA INTEGRAL MORA" (e a memória dela também); a La Rustica
--    ganha cadastro próprio. Os custos das três são recalculados pela mesma
--    regra da importação (private.apply_xml_purchase_cost), cada um só com a
--    linha do próprio insumo nesta nota.
-- 3. Ficha do Croissant: usava "Farinha de Trigo Croissant", cadastro antigo e
--    desativado, nunca comprado; passa a usar a farinha de croissant comprada.
-- 4. Memórias que o defeito do "SEM GTIN" deixou apontando para outro produto
--    são desligadas; na próxima nota o sistema pergunta de novo.
--
-- Nome, unidade e categoria do item da nota são cópia do cadastro no momento da
-- classificação (create_xml_payable); a cópia acompanha o cadastro certo.

begin;

-- Toda escrita é pela chave primária e repete o estado antigo no WHERE: muda
-- uma linha ou nenhuma. "Nenhuma" depois da conferência sob trava é impossível
-- na prática; se acontecer, a exceção desfaz a migration inteira.

-- 1. Farinha integral da Moinho Nordeste -------------------------------------
do $$
declare
  c_insumos constant uuid := '9f73925e-47df-483c-9f33-7e9062953fdc';
  c_nordeste constant uuid := '6af79b87-06a6-471a-a8e4-66461a15d391';
  c_integral constant uuid := '4079150d-e431-471b-b8cb-917966d454cc';
  c_duplicado constant uuid := '983ab611-b807-4b33-bbd1-6c59fb82e100';
  c_item constant uuid := 'b7242715-e64a-4a34-84ab-28336983a99f';
  c_compra constant uuid := '1ac350f8-fdfb-4e34-9d78-ef7398470b17';
  c_memoria constant uuid := 'd7305fc0-9b3b-4c65-89d9-ab64a17a2008';
begin
  perform 1 from public.payable_purchase_items where id = c_item for update;
  perform 1 from public.payable_product_mappings where id = c_memoria for update;
  perform 1 from public.products where id in (c_integral, c_duplicado) for update;

  if not (
    exists (select 1 from public.payable_purchase_items
            where id = c_item and purchase_id = c_compra and product_id = c_duplicado
              and source_product_code = '9965' and mapping_status = 'mapeado')
    and exists (select 1 from public.payable_product_mappings
                where id = c_memoria and supplier_id = c_nordeste and supplier_product_code = '9965'
                  and base_product_id = c_duplicado and active)
    and exists (select 1 from public.products
                where id = c_duplicado and active and kind = 'insumo' and category_id is null)
    and exists (select 1 from public.products
                where id = c_integral and active and kind = 'insumo' and unit = 'kg')
    and (select count(*) from public.payable_purchase_items where product_id = c_duplicado) = 1
    and (select count(*) from public.payable_product_mappings where base_product_id = c_duplicado) = 1
    and not exists (select 1 from public.product_components where component_id = c_duplicado::text)
    and not exists (select 1 from public.inventory_weekly_count_items where product_id = c_duplicado)
  ) then
    raise notice 'Farinha integral Nordeste: estado diferente do conferido em 28/09/2026, caso pulado.';
    return;
  end if;

  update public.payable_purchase_items item
  set product_id = product.id, item_name = product.name,
      unit = coalesce(product.unit, 'un'), category_snapshot = product.category
  from public.products product
  where item.id = c_item and item.product_id = c_duplicado and product.id = c_integral;
  if not found then
    raise exception 'Correção "item da farinha integral Nordeste" não alterou a linha esperada; nada foi aplicado.';
  end if;

  update public.payable_product_mappings
  set base_product_id = c_integral, base_unit = 'kg'
  where id = c_memoria and base_product_id = c_duplicado and active;
  if not found then
    raise exception 'Correção "memória da farinha integral Nordeste" não alterou a linha esperada; nada foi aplicado.';
  end if;

  update public.products
  set active = false, weekly_count_enabled = false,
      category = 'Insumos', category_id = c_insumos, catalog_type = 'materia_prima'
  where id = c_duplicado and active and category_id is null;
  if not found then
    raise exception 'Correção "cadastro duplicado da farinha integral" não alterou a linha esperada; nada foi aplicado.';
  end if;

  -- Mesma regra da importação: a nota de 22/09 é mais antiga que a da Tondo
  -- (23/09), então o custo da integral não muda e o item fica sem custo aplicado.
  perform private.apply_xml_purchase_cost(c_compra, c_integral);
end;
$$;

-- 2. Farinhas da Le 5 Stagioni, nota de 11/09 ---------------------------------
do $$
declare
  c_insumos constant uuid := '9f73925e-47df-483c-9f33-7e9062953fdc';
  c_impra constant uuid := '1640af03-f8b6-4deb-8f17-147a9cc19a2e';
  c_compra constant uuid := 'd6a5a155-d581-4b9b-862a-2b650df4b051';
  c_croissant constant uuid := '62ee7968-6f69-4748-a6d6-5e3c4c266326';
  c_mora constant uuid := 'ce9795e8-91e6-4757-bd7e-b04d2e602ce7';
  c_la_rustica constant uuid := 'c6b45cd6-93f8-4813-b522-e12e37042c39';
  c_nome_la_rustica constant text := 'FARINHA TIPO 1 LA RUSTICA LE5STAGIONI';
  c_item_mora constant uuid := '00c01d3f-121d-4fdf-8c50-0bbf92a7c7ad';
  c_item_la_rustica constant uuid := '27ae5f4d-17d9-4e9d-b5cb-f12ecc6a6ca5';
  c_memoria_mora constant uuid := 'cda345e5-2e5d-4d24-9c75-4c0c2a037d22';
begin
  perform 1 from public.payable_purchase_items where id in (c_item_mora, c_item_la_rustica) for update;
  perform 1 from public.payable_product_mappings where id = c_memoria_mora for update;
  perform 1 from public.products where id in (c_croissant, c_mora) for update;

  if not (
    exists (select 1 from public.payable_purchase_items
            where id = c_item_mora and purchase_id = c_compra and product_id = c_croissant
              and source_product_code = '000498' and mapping_status = 'mapeado')
    and exists (select 1 from public.payable_purchase_items
                where id = c_item_la_rustica and purchase_id = c_compra and product_id = c_croissant
                  and source_product_code = '001028' and mapping_status = 'mapeado')
    and exists (select 1 from public.payable_product_mappings
                where id = c_memoria_mora and supplier_id = c_impra and supplier_product_code = '000498'
                  and base_product_id = c_croissant and active)
    and exists (select 1 from public.products where id = c_croissant and active and kind = 'insumo')
    and exists (select 1 from public.products where id = c_mora and active and kind = 'insumo')
    and not exists (select 1 from public.products where id = c_la_rustica)
    and not exists (select 1 from public.products where upper(btrim(name)) = c_nome_la_rustica)
  ) then
    raise notice 'Farinhas Le 5 Stagioni de 11/09: estado diferente do conferido em 28/09/2026, caso pulado.';
    return;
  end if;

  insert into public.products (id, name, category, category_id, catalog_type, active, unit, kind)
  values (c_la_rustica, c_nome_la_rustica, 'Insumos', c_insumos, 'materia_prima', true, 'kg', 'insumo');

  update public.payable_purchase_items item
  set product_id = product.id, item_name = product.name,
      unit = coalesce(product.unit, 'un'), category_snapshot = product.category
  from public.products product
  where item.id = c_item_mora and item.product_id = c_croissant and product.id = c_mora;
  if not found then
    raise exception 'Correção "item da integral Mora" não alterou a linha esperada; nada foi aplicado.';
  end if;

  update public.payable_purchase_items item
  set product_id = product.id, item_name = product.name,
      unit = coalesce(product.unit, 'un'), category_snapshot = product.category
  from public.products product
  where item.id = c_item_la_rustica and item.product_id = c_croissant and product.id = c_la_rustica;
  if not found then
    raise exception 'Correção "item da La Rustica" não alterou a linha esperada; nada foi aplicado.';
  end if;

  update public.payable_product_mappings
  set base_product_id = c_mora
  where id = c_memoria_mora and base_product_id = c_croissant and active;
  if not found then
    raise exception 'Correção "memória da integral Mora" não alterou a linha esperada; nada foi aplicado.';
  end if;

  perform private.apply_xml_purchase_cost(c_compra, c_croissant);
  perform private.apply_xml_purchase_cost(c_compra, c_mora);
  perform private.apply_xml_purchase_cost(c_compra, c_la_rustica);
end;
$$;

-- 3. Ficha do Croissant -------------------------------------------------------
do $$
declare
  c_componente constant uuid := 'ceef920d-cfaf-4269-82ac-738b503c2854';
  c_croissant_produto constant uuid := 'c824c536-baa7-4479-b13d-e88e8ac10a4d';
  c_farinha_antiga constant uuid := '0c0d65e0-94f5-4e71-8e02-0d96b0a15b98';
  c_farinha_croissant constant uuid := '62ee7968-6f69-4748-a6d6-5e3c4c266326';
begin
  perform 1 from public.product_components where id = c_componente for update;

  if not (
    exists (select 1 from public.product_components
            where id = c_componente and parent_product_id = c_croissant_produto
              and component_source = 'product' and component_id = c_farinha_antiga::text
              and component_variant_id is null)
    and exists (select 1 from public.products where id = c_farinha_croissant and active and kind = 'insumo')
    and not exists (select 1 from public.product_components
                    where parent_product_id = c_croissant_produto and component_id = c_farinha_croissant::text)
  ) then
    raise notice 'Ficha do Croissant: estado diferente do conferido em 28/09/2026, caso pulado.';
    return;
  end if;

  update public.product_components
  set component_id = c_farinha_croissant::text
  where id = c_componente and component_id = c_farinha_antiga::text;
  if not found then
    raise exception 'Correção "ficha do Croissant" não alterou a linha esperada; nada foi aplicado.';
  end if;
end;
$$;

-- 4. Memórias que apontavam para outro produto --------------------------------
-- Cada memória é independente: desliga a que ainda está como foi lida em
-- 28/09/2026 (fornecedor, código e cadastro errado) e avisa a que mudou.
do $$
declare
  v_errada record;
begin
  for v_errada in
    select * from (values
      ('106155a1-a394-48d1-83d3-6b917a506248'::uuid, 'b7cda57c-204d-4a39-b34e-45e82d76e403'::uuid, '00006162', 'cb5ebceb-ed90-44c6-8a81-883db218fa41'::uuid, 'Astoria: café Selezione -> café Casablanca'),
      ('a56d41ea-558b-45ff-9094-dec457839386'::uuid, 'b4e223fa-2a68-4b11-8930-1a79ca5bb03d'::uuid, '10117', '20f10f3d-d92d-48e3-b7c3-63b8a17404ac'::uuid, 'Ofelia: açúcar mascavo -> damasco'),
      ('849263bb-0fe2-4f79-8c63-1ed14d9bb82d'::uuid, 'b4e223fa-2a68-4b11-8930-1a79ca5bb03d'::uuid, '1016640', 'a36b5a31-e4db-4e3f-92fd-928b1a343853'::uuid, 'Ofelia: cacau em pó -> fermento fresco'),
      ('b5537348-1502-4ec6-8956-e2a8e1d5b3cb'::uuid, 'ad182dc1-331d-45ae-a7d1-f534b5c9d957'::uuid, '19674', '4bbba50d-95a4-4c10-8247-4e5394c40828'::uuid, 'Bersaglio: margarina Coamo -> goiabada'),
      ('65d617cd-980a-4fd5-aff1-72c84e7ddbf8'::uuid, 'eff411d6-3efc-49ac-be52-34e5eee30393'::uuid, '953', '2fc2c567-6436-4e3e-8eea-dcb3fd474aea'::uuid, 'Claudia: saco incolor -> papel A4'),
      ('ac7f0f38-1737-40f6-a124-4b4d162dbc41'::uuid, 'eff411d6-3efc-49ac-be52-34e5eee30393'::uuid, '975', 'b9da8469-92ea-4c72-9237-2464c0fba847'::uuid, 'Claudia: etiqueta Motex -> etiqueta couché')
    ) as lista(memoria_id, fornecedor_id, codigo, cadastro_errado, descricao)
  loop
    update public.payable_product_mappings
    set active = false, updated_at = now()
    where id = v_errada.memoria_id and supplier_id = v_errada.fornecedor_id
      and supplier_product_code = v_errada.codigo
      and base_product_id = v_errada.cadastro_errado and active;
    if not found then
      raise notice 'Memória "%": estado diferente do conferido em 28/09/2026, mantida.', v_errada.descricao;
    end if;
  end loop;

  -- Bersaglio: decisão "uso ou despesa" herdada pelo defeito por margarina,
  -- filé de frango e presunto em caixa (erro confirmado por Rodrigo em 28/09).
  update public.payable_non_catalog_mappings
  set active = false, updated_at = now()
  where id = '87623730-4cf1-4b2d-92b3-5121eaf0f03c'
    and supplier_id = 'ad182dc1-331d-45ae-a7d1-f534b5c9d957'
    and supplier_product_code = '35882' and active;
  if not found then
    raise notice 'Memória de uso ou despesa da Bersaglio: estado diferente do conferido em 28/09/2026, mantida.';
  end if;
end;
$$;

commit;
