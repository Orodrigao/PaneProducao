-- Correcao pontual autorizada por Rodrigo (2026-09-29) do Romaneio EX de 22/08/2026.
--
-- 1) Viagem 2 (conferida): as 32 unidades foram lancadas como "Brioche Forma", mas
--    eram Brioche Hamburguer. A linha passa a usar o pao "Brioche Hamburguer", do
--    mesmo jeito que as linhas de Brioche Hamburguer dos outros romaneios, e a troca
--    fica na trilha romaneio_item_corrections. O preco da linha continua 0.
-- 2) Viagens 5 e 6 (enviadas, nunca conferidas): cada uma tinha uma unica linha de
--    Brioche Forma lancada por engano (24 e 12 unidades). Os dois romaneios saem
--    inteiros; as linhas somem junto (on delete cascade).
--
-- Registro do que foi removido, para quem precisar refazer (todos Brioche Forma,
-- EX, 2026-08-22, enviados por "expedicao", sem conferencia, preco 0):
--   romaneio 1e73e89c-a632-4bcc-b8d5-ad514e2db2ce, viagem 5, enviado 14:26 UTC,
--     linha 557d366e-4de9-4681-b02f-1a7a6abb8dc3, 24 un.
--   romaneio 9f9fe444-f428-4f97-a001-900090561618, viagem 6, enviado 14:32 UTC,
--     linha 4c005be9-53d5-459e-aaa6-3454727e1155, 12 un.
-- Cada bloco confere id, data, viagem, loja, estado, produto e quantidade antes de
-- agir; se algo nao bater (ou o dado nao existir, como nos bancos de teste), nao faz nada.

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
