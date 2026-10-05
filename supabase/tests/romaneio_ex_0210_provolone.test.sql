-- A correcao pontual do Romaneio EX de 02/10/2026 troca so a linha certa para o
-- Pao de Provolone com o preco Buck, deixa trilha, nao mexe em mais nada e nao
-- faz nada quando o produto ou o preco nao estao prontos. A funcao temporaria
-- abaixo e copia do corpo da migration 20261005172536 (o teste de banco nao
-- consegue reexecutar arquivo de migration).

begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

create function pg_temp.aplicar_migration() returns void
language plpgsql
as $migration$
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
$migration$;

-- O seed traz a tabela BUCK e o nome dela e unico. Este cenario monta a sua
-- propria; tudo roda em transacao e volta atras no fim.
delete from public.price_tier_items
where tier_id in (select id from public.price_tiers where name = 'BUCK');
delete from public.price_tiers where name = 'BUCK';

insert into public.price_tiers (id, name, description, active)
values ('95000000-0000-4000-8000-000000000010', 'BUCK', 'Tabela de teste', true);

insert into public.products (id, name, category, active, unit, kind, is_pj)
values ('777dc8b6-60f0-4e0d-a3df-0869dd16d2c2', 'Pão de Provolone', 'PAES', false, 'un', 'final', false);

insert into public.price_tier_items (
  id, tier_id, product_id, product_source, product_name, unit_price, pricing_unit, active
) values (
  '95000000-0000-4000-8000-000000000011',
  '95000000-0000-4000-8000-000000000010',
  '777dc8b6-60f0-4e0d-a3df-0869dd16d2c2',
  'product',
  'Pão de Provolone',
  11,
  'un',
  true
);

insert into public.romaneios (id, record_date, destination_id, trip_number, status, created_by, sent_by, sent_at, confirmed_by, confirmed_at)
values
  ('5a0e7401-70d0-43fa-9753-53989d939fe2', date '2026-10-02', '20000000-0000-4000-8000-000000000003', 2, 'com_divergencia', 'Teste', 'Teste', now(), 'Teste', now()),
  -- 01/10, viagem 2: o avulso "Provolone" fica para o botao da tela
  ('95000000-0000-4000-8000-000000000020', date '2026-10-01', '20000000-0000-4000-8000-000000000003', 2, 'enviado', 'Teste', 'Teste', now(), null, null);

insert into public.romaneio_items (id, romaneio_id, product_id, product_source, product_name, qty_sent, qty_received, qty_accepted, unit_price, item_status)
values
  ('caa9effa-ea16-4d84-82c0-9256294831c0', '5a0e7401-70d0-43fa-9753-53989d939fe2', 'extra_1790948312461', 'extra', 'Parmesão', 6, 6, 6, 0, 'ok'),
  -- outro avulso no mesmo romaneio: nao pode ser tocado
  ('95000000-0000-4000-8000-000000000021', '5a0e7401-70d0-43fa-9753-53989d939fe2', 'extra_950', 'extra', 'Rugbrod', 6, 6, 6, 0, 'ok'),
  ('95000000-0000-4000-8000-000000000022', '95000000-0000-4000-8000-000000000020', 'extra_1790858861058', 'extra', 'Provolone', 6, null, null, 0, 'pendente');

-- Produto inativo: a migration nao faz nada.
select pg_temp.aplicar_migration();

select is(
  (select product_name || '/' || product_source from public.romaneio_items where id = 'caa9effa-ea16-4d84-82c0-9256294831c0'),
  'Parmesão/extra',
  'com o produto inativo a linha fica como estava'
);
select is(
  (select count(*)::integer from public.romaneio_item_corrections where item_id = 'caa9effa-ea16-4d84-82c0-9256294831c0'),
  0,
  'com o produto inativo nao ha trilha'
);

-- Produto ativo, mas sem preco Buck ativo: tambem nao faz nada.
update public.products set active = true where id = '777dc8b6-60f0-4e0d-a3df-0869dd16d2c2';
update public.price_tier_items set active = false where id = '95000000-0000-4000-8000-000000000011';

select pg_temp.aplicar_migration();

select is(
  (select product_name from public.romaneio_items where id = 'caa9effa-ea16-4d84-82c0-9256294831c0'),
  'Parmesão',
  'sem preco Buck ativo a linha fica como estava'
);

-- Com produto ativo e um unico preco Buck, a troca acontece.
update public.price_tier_items set active = true where id = '95000000-0000-4000-8000-000000000011';

select pg_temp.aplicar_migration();

select is(
  (select product_name from public.romaneio_items where id = 'caa9effa-ea16-4d84-82c0-9256294831c0'),
  'Pão de Provolone',
  'a linha passa a ser Pao de Provolone'
);
select is(
  (select product_id || '/' || product_source from public.romaneio_items where id = 'caa9effa-ea16-4d84-82c0-9256294831c0'),
  '777dc8b6-60f0-4e0d-a3df-0869dd16d2c2/product',
  'a linha aponta para o produto cadastrado'
);
select is(
  (select unit_price from public.romaneio_items where id = 'caa9effa-ea16-4d84-82c0-9256294831c0'),
  11::numeric,
  'a linha recebe o preco Buck ativo, como faria o botao da tela'
);
select is(
  (select qty_sent || '/' || qty_received || '/' || qty_accepted || '/' || item_status
   from public.romaneio_items where id = 'caa9effa-ea16-4d84-82c0-9256294831c0'),
  '6/6/6/ok',
  'quantidades e conferencia da linha ficam como estavam'
);
select is(
  (select old_product_name || ' -> ' || new_product_name || ' por ' || new_unit_price
   from public.romaneio_item_corrections where item_id = 'caa9effa-ea16-4d84-82c0-9256294831c0'),
  'Parmesão -> Pão de Provolone por 11',
  'a trilha guarda o antes, o depois e o preco'
);
select is(
  (select product_name || '/' || product_source from public.romaneio_items where id = '95000000-0000-4000-8000-000000000021'),
  'Rugbrod/extra',
  'o outro avulso do mesmo romaneio nao muda'
);
select is(
  (select product_name || '/' || product_source from public.romaneio_items where id = '95000000-0000-4000-8000-000000000022'),
  'Provolone/extra',
  'o avulso de 01/10 nao muda'
);

-- Rodar de novo nao faz nada.
select pg_temp.aplicar_migration();

select is(
  (select count(*)::integer from public.romaneio_item_corrections where item_id = 'caa9effa-ea16-4d84-82c0-9256294831c0'),
  1,
  'repetir a correcao nao duplica a trilha'
);
select is(
  (select status from public.romaneios where id = '5a0e7401-70d0-43fa-9753-53989d939fe2'),
  'com_divergencia',
  'o romaneio continua no mesmo estado'
);

select * from finish();
rollback;
