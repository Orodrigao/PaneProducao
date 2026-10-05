-- Correcao pontual autorizada por Rodrigo (2026-10-05) do Romaneio EX de 02/10/2026.
--
-- Viagem 2 (ja conferida, com divergencia em outros itens): 6 unidades foram
-- lancadas como avulso "Parmesão", mas eram Pao de Provolone. Como o romaneio ja
-- foi conferido, o botao "Vincular ao produto cadastrado" (funcao
-- correct_romaneio_extra_item) recusa a troca. Esta migration faz a mesma troca
-- que a funcao faria: a linha passa a usar o produto "Pão de Provolone" com o
-- preco Buck ativo em unidade, e a troca fica na trilha romaneio_item_corrections.
-- Quantidades e conferencia da linha ficam como estavam.
--
-- O bloco confere item, romaneio, data, viagem, loja, estado, produto avulso,
-- quantidades, conferencia e preco da linha, ausencia de correcao e de
-- cobranca, produto ativo e preco Buck unico; se algo nao bater (ou o dado nao
-- existir, como nos bancos de teste), nao faz nada. Por isso a Action verde nao
-- prova a troca: depois do merge, reler o item e a trilha em producao.

do $$
declare
  v_item record;
  v_new_name text;
  v_new_price numeric;
  v_price_count integer;
begin
  -- Mesma trava por semana da cobranca semanal Buck (semana de 28/09 a 04/10):
  -- a cobranca nao nasce no meio da troca.
  perform pg_advisory_xact_lock(hashtextextended('cobranca-buck-semana:' || date '2026-09-28'::text, 0));

  select item.*
    into v_item
  from public.romaneio_items item
  join public.romaneios romaneio on romaneio.id = item.romaneio_id
  join public.destinations destination on destination.id = romaneio.destination_id
  where item.id = 'caa9effa-ea16-4d84-82c0-9256294831c0'
    and item.romaneio_id = '5a0e7401-70d0-43fa-9753-53989d939fe2'
    and item.product_id = 'extra_1790948312461'
    and item.product_source = 'extra'
    and item.product_name = 'Parmesão'
    and item.qty_sent = 6
    and item.qty_received = 6
    and item.qty_accepted = 6
    and item.item_status = 'ok'
    and item.unit_price = 0
    and romaneio.record_date = date '2026-10-02'
    and romaneio.trip_number = 2
    and romaneio.status in ('conferido', 'com_divergencia')
    and lower(destination.code) = 'ex'
    and not exists (
      select 1 from public.romaneio_item_corrections correction
      where correction.item_id = item.id
    )
    and not exists (
      select 1 from public.receivable_romaneio_lines line
      where line.itens::text like '%' || item.romaneio_id::text || '%'
    )
  for update of item, romaneio;

  if not found then
    return;
  end if;

  select product.name
    into v_new_name
  from public.products product
  where product.id = '777dc8b6-60f0-4e0d-a3df-0869dd16d2c2'
    and product.active;

  select count(*)::integer, max(price_item.unit_price)
    into v_price_count, v_new_price
  from public.price_tier_items price_item
  join public.price_tiers tier on tier.id = price_item.tier_id
  where lower(btrim(tier.name)) = 'buck'
    and tier.active
    and price_item.active
    and price_item.product_source = 'product'
    and price_item.product_id = '777dc8b6-60f0-4e0d-a3df-0869dd16d2c2'
    and price_item.pricing_unit = 'un'
    and price_item.unit_price > 0;

  if v_new_name is null or v_price_count <> 1 then
    return;
  end if;

  insert into public.romaneio_item_corrections (
    item_id,
    romaneio_id,
    old_product_id,
    old_product_source,
    old_product_name,
    old_unit_price,
    new_product_id,
    new_product_source,
    new_product_name,
    new_unit_price,
    corrected_by_name,
    reason
  ) values (
    v_item.id,
    v_item.romaneio_id,
    v_item.product_id,
    v_item.product_source,
    v_item.product_name,
    v_item.unit_price,
    '777dc8b6-60f0-4e0d-a3df-0869dd16d2c2',
    'product',
    v_new_name,
    v_new_price,
    'Migration 20261005172536 autorizada por Rodrigo',
    'Correcao pontual autorizada do Romaneio EX de 2026-10-02, viagem 2: avulso Parmesão era Pão de Provolone.'
  );

  update public.romaneio_items
  set
    product_id = '777dc8b6-60f0-4e0d-a3df-0869dd16d2c2',
    product_source = 'product',
    product_name = v_new_name,
    unit_price = v_new_price
  where id = v_item.id;
end;
$$;
