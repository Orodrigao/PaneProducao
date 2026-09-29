-- A correcao pontual do Romaneio EX de 22/08/2026 troca so a linha certa, deixa
-- trilha, remove so as duas viagens erradas e nao mexe em mais nada. O bloco
-- "migration" abaixo e copia da migration 20260929115500 (o teste de banco nao
-- consegue reexecutar arquivo de migration).

begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

insert into public.breads (id, name, active, is_pj)
values ('brioche_hamburguer1775678357276', 'Brioche Hamburguer', true, false)
on conflict (id) do update set name = excluded.name, active = true, is_pj = false;

insert into public.breads (id, name, active, is_pj)
values ('brioche_forma1775678330784', 'Brioche Forma', true, false)
on conflict (id) do update set name = excluded.name, active = true, is_pj = false;

insert into public.romaneios (id, record_date, destination_id, trip_number, status, created_by, sent_by, sent_at, confirmed_by, confirmed_at)
values
  ('404a4723-5918-49cf-b510-c25891e41f4a', date '2026-08-22', '20000000-0000-4000-8000-000000000003', 2, 'conferido', 'Teste', 'Teste', now(), 'Teste', now()),
  ('1e73e89c-a632-4bcc-b8d5-ad514e2db2ce', date '2026-08-22', '20000000-0000-4000-8000-000000000003', 5, 'enviado', 'Teste', 'Teste', now(), null, null),
  ('9f9fe444-f428-4f97-a001-900090561618', date '2026-08-22', '20000000-0000-4000-8000-000000000003', 6, 'enviado', 'Teste', 'Teste', now(), null, null),
  -- viagem 4 do mesmo dia: nao pode ser tocada
  ('89510d70-1e2d-4a96-8ad1-b17d6371d600', date '2026-08-22', '20000000-0000-4000-8000-000000000003', 4, 'enviado', 'Teste', 'Teste', now(), null, null);

insert into public.romaneio_items (id, romaneio_id, product_id, product_source, product_name, qty_sent, qty_received, qty_accepted, unit_price, item_status)
values
  ('7269d791-bdeb-46d5-8dcd-4049250ad0a5', '404a4723-5918-49cf-b510-c25891e41f4a', 'brioche_forma1775678330784', 'bread', 'Brioche Forma', 32, 32, 32, 0, 'ok'),
  ('557d366e-4de9-4681-b02f-1a7a6abb8dc3', '1e73e89c-a632-4bcc-b8d5-ad514e2db2ce', 'brioche_forma1775678330784', 'bread', 'Brioche Forma', 24, null, null, 0, 'pendente'),
  ('4c005be9-53d5-459e-aaa6-3454727e1155', '9f9fe444-f428-4f97-a001-900090561618', 'brioche_forma1775678330784', 'bread', 'Brioche Forma', 12, null, null, 0, 'pendente'),
  ('ef38fa12-ddba-4b71-9fb5-d3c49cacf48e', '89510d70-1e2d-4a96-8ad1-b17d6371d600', 'brioche_forma1775678330784', 'bread', 'Brioche Forma', 7, null, null, 0, 'pendente');

-- migration (copia)
do $$
declare
  v_item record;
begin
  select item.*
    into v_item
  from public.romaneio_items item
  join public.romaneios romaneio on romaneio.id = item.romaneio_id
  join public.destinations destination on destination.id = romaneio.destination_id
  where item.id = '7269d791-bdeb-46d5-8dcd-4049250ad0a5'
    and item.romaneio_id = '404a4723-5918-49cf-b510-c25891e41f4a'
    and item.product_id = 'brioche_forma1775678330784'
    and item.product_source = 'bread'
    and item.qty_sent = 32
    and romaneio.record_date = date '2026-08-22'
    and romaneio.trip_number = 2
    and romaneio.status = 'conferido'
    and lower(destination.code) = 'ex'
    and not exists (
      select 1 from public.romaneio_item_corrections correction
      where correction.item_id = item.id
    )
    and not exists (
      select 1 from public.receivable_romaneio_lines line
      where line.itens::text like '%' || item.romaneio_id::text || '%'
    )
    and exists (
      select 1 from public.breads bread
      where bread.id = 'brioche_hamburguer1775678357276'
        and bread.active
        and not bread.is_pj
    );

  if found then
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
      'brioche_hamburguer1775678357276',
      'bread',
      'Brioche Hamburguer',
      coalesce(v_item.unit_price, 0),
      'Migration 20260929115500 autorizada por Rodrigo',
      'Correcao pontual autorizada do Romaneio EX de 2026-08-22, viagem 2: Brioche Forma lancado no lugar de Brioche Hamburguer.'
    );

    update public.romaneio_items
    set
      product_id = 'brioche_hamburguer1775678357276',
      product_source = 'bread',
      product_name = 'Brioche Hamburguer'
    where id = v_item.id;
  end if;
end;
$$;

do $$
declare
  v_romaneio_id uuid;
begin
  for v_romaneio_id in
    select romaneio.id
    from public.romaneios romaneio
    join public.destinations destination on destination.id = romaneio.destination_id
    where lower(destination.code) = 'ex'
      and romaneio.record_date = date '2026-08-22'
      and romaneio.status = 'enviado'
      and (
        (romaneio.id = '1e73e89c-a632-4bcc-b8d5-ad514e2db2ce' and romaneio.trip_number = 5 and exists (
          select 1 from public.romaneio_items item
          where item.romaneio_id = romaneio.id and item.qty_sent = 24
        ))
        or (romaneio.id = '9f9fe444-f428-4f97-a001-900090561618' and romaneio.trip_number = 6 and exists (
          select 1 from public.romaneio_items item
          where item.romaneio_id = romaneio.id and item.qty_sent = 12
        ))
      )
      and (
        select count(*) from public.romaneio_items item where item.romaneio_id = romaneio.id
      ) = 1
      and exists (
        select 1
        from public.romaneio_items item
        where item.romaneio_id = romaneio.id
          and item.product_id = 'brioche_forma1775678330784'
          and item.product_source = 'bread'
          and item.qty_received is null
      )
      and not exists (
        select 1 from public.romaneio_item_corrections correction
        where correction.romaneio_id = romaneio.id
      )
      and not exists (
        select 1 from public.romaneio_replacement_pending pending
        where pending.source_romaneio_id = romaneio.id
      )
      and not exists (
        select 1 from public.receivable_romaneio_lines line
        where line.itens::text like '%' || romaneio.id::text || '%'
      )
  loop
    delete from public.romaneios where id = v_romaneio_id;
  end loop;
end;
$$;

select is(
  (select product_name from public.romaneio_items where id = '7269d791-bdeb-46d5-8dcd-4049250ad0a5'),
  'Brioche Hamburguer',
  'a linha da viagem 2 passa a ser Brioche Hamburguer'
);
select is(
  (select product_id || '/' || product_source from public.romaneio_items where id = '7269d791-bdeb-46d5-8dcd-4049250ad0a5'),
  'brioche_hamburguer1775678357276/bread',
  'a linha aponta para o cadastro Brioche Hamburguer'
);
select is(
  (select qty_sent || '/' || qty_received || '/' || qty_accepted || '/' || unit_price || '/' || item_status
   from public.romaneio_items where id = '7269d791-bdeb-46d5-8dcd-4049250ad0a5'),
  '32/32/32/0/ok',
  'quantidades, preco e conferencia da linha ficam como estavam'
);
select is(
  (select count(*)::integer from public.romaneio_item_corrections where item_id = '7269d791-bdeb-46d5-8dcd-4049250ad0a5'),
  1,
  'a troca deixa uma linha na trilha de correcoes'
);
select is(
  (select old_product_name || ' -> ' || new_product_name from public.romaneio_item_corrections where item_id = '7269d791-bdeb-46d5-8dcd-4049250ad0a5'),
  'Brioche Forma -> Brioche Hamburguer',
  'a trilha guarda o antes e o depois'
);
select is(
  (select count(*)::integer from public.romaneios where id in ('1e73e89c-a632-4bcc-b8d5-ad514e2db2ce', '9f9fe444-f428-4f97-a001-900090561618')),
  0,
  'as viagens 5 e 6 saem'
);
select is(
  (select count(*)::integer from public.romaneio_items where id in ('557d366e-4de9-4681-b02f-1a7a6abb8dc3', '4c005be9-53d5-459e-aaa6-3454727e1155')),
  0,
  'as linhas das viagens 5 e 6 saem junto'
);
select is(
  (select count(*)::integer from public.romaneios where id in ('404a4723-5918-49cf-b510-c25891e41f4a', '89510d70-1e2d-4a96-8ad1-b17d6371d600')),
  2,
  'as viagens 2 e 4 continuam'
);
select is(
  (select product_name from public.romaneio_items where id = 'ef38fa12-ddba-4b71-9fb5-d3c49cacf48e'),
  'Brioche Forma',
  'a linha da viagem 4 nao muda'
);

-- rodar de novo (copia da migration) nao faz nada
do $$
declare
  v_item record;
begin
  select item.*
    into v_item
  from public.romaneio_items item
  join public.romaneios romaneio on romaneio.id = item.romaneio_id
  join public.destinations destination on destination.id = romaneio.destination_id
  where item.id = '7269d791-bdeb-46d5-8dcd-4049250ad0a5'
    and item.romaneio_id = '404a4723-5918-49cf-b510-c25891e41f4a'
    and item.product_id = 'brioche_forma1775678330784'
    and item.product_source = 'bread'
    and item.qty_sent = 32
    and romaneio.record_date = date '2026-08-22'
    and romaneio.trip_number = 2
    and romaneio.status = 'conferido'
    and lower(destination.code) = 'ex'
    and not exists (
      select 1 from public.romaneio_item_corrections correction
      where correction.item_id = item.id
    )
    and not exists (
      select 1 from public.receivable_romaneio_lines line
      where line.itens::text like '%' || item.romaneio_id::text || '%'
    )
    and exists (
      select 1 from public.breads bread
      where bread.id = 'brioche_hamburguer1775678357276'
        and bread.active
        and not bread.is_pj
    );

  if found then
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
      'brioche_hamburguer1775678357276',
      'bread',
      'Brioche Hamburguer',
      coalesce(v_item.unit_price, 0),
      'Migration 20260929115500 autorizada por Rodrigo',
      'Correcao pontual autorizada do Romaneio EX de 2026-08-22, viagem 2: Brioche Forma lancado no lugar de Brioche Hamburguer.'
    );

    update public.romaneio_items
    set
      product_id = 'brioche_hamburguer1775678357276',
      product_source = 'bread',
      product_name = 'Brioche Hamburguer'
    where id = v_item.id;
  end if;
end;
$$;

do $$
declare
  v_romaneio_id uuid;
begin
  for v_romaneio_id in
    select romaneio.id
    from public.romaneios romaneio
    join public.destinations destination on destination.id = romaneio.destination_id
    where lower(destination.code) = 'ex'
      and romaneio.record_date = date '2026-08-22'
      and romaneio.status = 'enviado'
      and (
        (romaneio.id = '1e73e89c-a632-4bcc-b8d5-ad514e2db2ce' and romaneio.trip_number = 5 and exists (
          select 1 from public.romaneio_items item
          where item.romaneio_id = romaneio.id and item.qty_sent = 24
        ))
        or (romaneio.id = '9f9fe444-f428-4f97-a001-900090561618' and romaneio.trip_number = 6 and exists (
          select 1 from public.romaneio_items item
          where item.romaneio_id = romaneio.id and item.qty_sent = 12
        ))
      )
      and (
        select count(*) from public.romaneio_items item where item.romaneio_id = romaneio.id
      ) = 1
      and exists (
        select 1
        from public.romaneio_items item
        where item.romaneio_id = romaneio.id
          and item.product_id = 'brioche_forma1775678330784'
          and item.product_source = 'bread'
          and item.qty_received is null
      )
      and not exists (
        select 1 from public.romaneio_item_corrections correction
        where correction.romaneio_id = romaneio.id
      )
      and not exists (
        select 1 from public.romaneio_replacement_pending pending
        where pending.source_romaneio_id = romaneio.id
      )
      and not exists (
        select 1 from public.receivable_romaneio_lines line
        where line.itens::text like '%' || romaneio.id::text || '%'
      )
  loop
    delete from public.romaneios where id = v_romaneio_id;
  end loop;
end;
$$;

select is(
  (select count(*)::integer from public.romaneio_item_corrections where item_id = '7269d791-bdeb-46d5-8dcd-4049250ad0a5'),
  1,
  'repetir a correcao nao duplica a trilha'
);
select is(
  (select count(*)::integer from public.romaneio_items where romaneio_id = '404a4723-5918-49cf-b510-c25891e41f4a' and product_name = 'Brioche Hamburguer'),
  1,
  'repetir a correcao nao muda a viagem 2'
);

select * from finish();
rollback;
