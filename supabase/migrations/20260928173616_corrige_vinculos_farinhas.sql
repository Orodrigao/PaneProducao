-- Correção de dados: vínculos das farinhas e memórias de fornecedor erradas
-- (aprovada por Rodrigo em 28/09/2026, lista item a item na PR).
--
-- Depende da migration anterior (memoria_fornecedor_sem_gtin): sem ela, a
-- próxima nota "SEM GTIN" desfaria as memórias corrigidas aqui.
--
-- Cada caso confere o estado de produção lido em 28/09/2026 antes de mudar.
-- Se a linha não existe (banco novo do CI ou do preview) ou já mudou (alguém
-- corrigiu pela tela, ou a migration rodou de novo), o caso é pulado inteiro,
-- com aviso, e nada é escrito pela metade. Nenhuma conta, parcela, pagamento ou
-- lançamento do livro-caixa muda: todos os itens mexidos são de Insumos antes e
-- depois, e o valor de cada item fica igual. Nenhum cadastro é apagado.
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

begin;

do $$
declare
  c_insumos constant uuid := '9f73925e-47df-483c-9f33-7e9062953fdc';
  c_integral constant uuid := '4079150d-e431-471b-b8cb-917966d454cc';
  c_duplicado constant uuid := '983ab611-b807-4b33-bbd1-6c59fb82e100';
  c_item_nordeste constant uuid := 'b7242715-e64a-4a34-84ab-28336983a99f';
  c_compra_nordeste constant uuid := '1ac350f8-fdfb-4e34-9d78-ef7398470b17';
  c_memoria_nordeste constant uuid := 'd7305fc0-9b3b-4c65-89d9-ab64a17a2008';
begin
  if not exists (
    select 1 from public.payable_purchase_items
    where id = c_item_nordeste and purchase_id = c_compra_nordeste and product_id = c_duplicado
  ) or not exists (select 1 from public.products where id = c_integral and active and kind = 'insumo') then
    raise notice 'Farinha integral Nordeste: estado diferente do conferido em 28/09/2026, caso pulado.';
    return;
  end if;

  -- Nome, unidade e categoria do item são cópia do cadastro no momento da
  -- classificação (create_xml_payable); a cópia acompanha o cadastro certo.
  update public.payable_purchase_items item
  set product_id = product.id, item_name = product.name,
      unit = coalesce(product.unit, 'un'), category_snapshot = product.category
  from public.products product
  where item.id = c_item_nordeste and product.id = c_integral;

  update public.payable_product_mappings
  set base_product_id = c_integral, base_unit = 'kg'
  where id = c_memoria_nordeste and base_product_id = c_duplicado;

  update public.products
  set active = false, weekly_count_enabled = false,
      category = 'Insumos', category_id = c_insumos, catalog_type = 'materia_prima'
  where id = c_duplicado
    and not exists (select 1 from public.payable_purchase_items where product_id = c_duplicado)
    and not exists (select 1 from public.payable_product_mappings where base_product_id = c_duplicado and active);

  -- Mesma regra da importação: a nota de 22/09 é mais antiga que a da Tondo
  -- (23/09), então o custo da integral não muda e o item fica sem custo aplicado.
  perform private.apply_xml_purchase_cost(c_compra_nordeste, c_integral);
end;
$$;

do $$
declare
  c_insumos constant uuid := '9f73925e-47df-483c-9f33-7e9062953fdc';
  c_compra constant uuid := 'd6a5a155-d581-4b9b-862a-2b650df4b051';
  c_croissant constant uuid := '62ee7968-6f69-4748-a6d6-5e3c4c266326';
  c_mora constant uuid := 'ce9795e8-91e6-4757-bd7e-b04d2e602ce7';
  c_la_rustica constant uuid := 'c6b45cd6-93f8-4813-b522-e12e37042c39';
  c_item_mora constant uuid := '00c01d3f-121d-4fdf-8c50-0bbf92a7c7ad';
  c_item_la_rustica constant uuid := '27ae5f4d-17d9-4e9d-b5cb-f12ecc6a6ca5';
  c_memoria_mora constant uuid := 'cda345e5-2e5d-4d24-9c75-4c0c2a037d22';
begin
  if (select count(*) from public.payable_purchase_items
      where purchase_id = c_compra and product_id = c_croissant
        and (id = c_item_mora and source_product_code = '000498'
          or id = c_item_la_rustica and source_product_code = '001028')) <> 2
    or not exists (select 1 from public.products where id = c_mora and active and kind = 'insumo') then
    raise notice 'Farinhas Le 5 Stagioni de 11/09: estado diferente do conferido em 28/09/2026, caso pulado.';
    return;
  end if;

  insert into public.products (id, name, category, category_id, catalog_type, active, unit, kind)
  values (c_la_rustica, 'FARINHA TIPO 1 LA RUSTICA LE5STAGIONI', 'Insumos', c_insumos, 'materia_prima', true, 'kg', 'insumo')
  on conflict (id) do nothing;

  update public.payable_purchase_items item
  set product_id = product.id, item_name = product.name,
      unit = coalesce(product.unit, 'un'), category_snapshot = product.category
  from public.products product
  where (item.id = c_item_mora and product.id = c_mora)
     or (item.id = c_item_la_rustica and product.id = c_la_rustica);

  update public.payable_product_mappings
  set base_product_id = c_mora
  where id = c_memoria_mora and base_product_id = c_croissant;

  perform private.apply_xml_purchase_cost(c_compra, c_croissant);
  perform private.apply_xml_purchase_cost(c_compra, c_mora);
  perform private.apply_xml_purchase_cost(c_compra, c_la_rustica);
end;
$$;

do $$
declare
  c_componente constant uuid := 'ceef920d-cfaf-4269-82ac-738b503c2854';
  c_croissant_produto constant uuid := 'c824c536-baa7-4479-b13d-e88e8ac10a4d';
  c_farinha_antiga constant text := '0c0d65e0-94f5-4e71-8e02-0d96b0a15b98';
  c_farinha_croissant constant text := '62ee7968-6f69-4748-a6d6-5e3c4c266326';
begin
  update public.product_components
  set component_id = c_farinha_croissant
  where id = c_componente
    and parent_product_id = c_croissant_produto
    and component_source = 'product'
    and component_id = c_farinha_antiga;

  if not found then
    raise notice 'Ficha do Croissant: estado diferente do conferido em 28/09/2026, caso pulado.';
  end if;
end;
$$;

-- Só desliga a memória se ela ainda aponta para o cadastro errado lido em
-- 28/09/2026; memória corrigida por alguém nesse meio tempo fica como está.
update public.payable_product_mappings mapping
set active = false, updated_at = now()
from (values
  ('106155a1-a394-48d1-83d3-6b917a506248'::uuid, 'cb5ebceb-ed90-44c6-8a81-883db218fa41'::uuid), -- Astoria: café Selezione -> café Casablanca
  ('a56d41ea-558b-45ff-9094-dec457839386'::uuid, '20f10f3d-d92d-48e3-b7c3-63b8a17404ac'::uuid), -- Ofelia: açúcar mascavo -> damasco
  ('849263bb-0fe2-4f79-8c63-1ed14d9bb82d'::uuid, 'a36b5a31-e4db-4e3f-92fd-928b1a343853'::uuid), -- Ofelia: cacau em pó -> fermento fresco
  ('b5537348-1502-4ec6-8956-e2a8e1d5b3cb'::uuid, '4bbba50d-95a4-4c10-8247-4e5394c40828'::uuid), -- Bersaglio: margarina Coamo -> goiabada
  ('65d617cd-980a-4fd5-aff1-72c84e7ddbf8'::uuid, '2fc2c567-6436-4e3e-8eea-dcb3fd474aea'::uuid), -- Claudia: saco incolor -> papel A4
  ('ac7f0f38-1737-40f6-a124-4b4d162dbc41'::uuid, 'b9da8469-92ea-4c72-9237-2464c0fba847'::uuid)  -- Claudia: etiqueta Motex -> etiqueta couché
) as errada(memoria_id, cadastro_errado)
where mapping.id = errada.memoria_id
  and mapping.base_product_id = errada.cadastro_errado
  and mapping.active;

-- Bersaglio: decisão "uso ou despesa" herdada pelo defeito por margarina,
-- filé de frango e presunto em caixa (erro confirmado por Rodrigo em 28/09).
update public.payable_non_catalog_mappings
set active = false, updated_at = now()
where id = '87623730-4cf1-4b2d-92b3-5121eaf0f03c' and active;

commit;
