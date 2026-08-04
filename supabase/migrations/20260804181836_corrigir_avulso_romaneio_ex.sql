-- Corrige um avulso confirmado pelo Rodrigo e cria a trilha segura para os
-- próximos casos. A tela nunca atualiza romaneio_items diretamente: a função
-- valida a loja, o estado do romaneio, o produto ativo e o preço Buck.

create table public.romaneio_item_corrections (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.romaneio_items(id),
  romaneio_id uuid not null references public.romaneios(id),
  old_product_id text not null,
  old_product_source text not null,
  old_product_name text not null,
  old_unit_price numeric,
  new_product_id text not null,
  new_product_source text not null,
  new_product_name text not null,
  new_unit_price numeric not null,
  corrected_by uuid references auth.users(id),
  corrected_by_name text not null,
  reason text not null,
  corrected_at timestamptz not null default now()
);

comment on table public.romaneio_item_corrections is
  'Trilha das correcoes de identidade de itens avulsos do Romaneio antes da cobranca.';

alter table public.romaneio_item_corrections enable row level security;
alter table public.romaneio_item_corrections force row level security;

revoke all on table public.romaneio_item_corrections from public, anon, authenticated;
grant select on table public.romaneio_item_corrections to authenticated;
grant all on table public.romaneio_item_corrections to service_role;

create policy romaneio_item_corrections_select_admin
on public.romaneio_item_corrections
for select
to authenticated
using (
  exists (
    select 1
    from public.romaneios romaneio
    join public.destinations destination on destination.id = romaneio.destination_id
    where romaneio.id = romaneio_item_corrections.romaneio_id
      and private.current_user_has_permission('romaneio.administrar', destination.code)
  )
);

create or replace function public.correct_romaneio_extra_item(
  p_item_id uuid,
  p_product_source text,
  p_product_id text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_item record;
  v_new_name text;
  v_new_price numeric;
  v_price_count integer;
  v_expected_unit text;
  v_user_name text;
begin
  if p_item_id is null or nullif(btrim(p_product_id), '') is null then
    raise exception using errcode = '22023', message = 'Informe o item e o produto cadastrado.';
  end if;

  if lower(btrim(coalesce(p_product_source, ''))) not in ('bread', 'product') then
    raise exception using errcode = '22023', message = 'Produto de destino invalido.';
  end if;

  select
    item.id,
    item.romaneio_id,
    item.product_id,
    item.product_source,
    item.product_name,
    item.unit_price,
    romaneio.destination_id,
    destination.code as destination_code,
    romaneio.status
    into v_item
  from public.romaneio_items item
  join public.romaneios romaneio on romaneio.id = item.romaneio_id
  join public.destinations destination on destination.id = romaneio.destination_id
  where item.id = p_item_id
  for update of item, romaneio;

  if not found then
    raise exception using errcode = 'P0002', message = 'Item do romaneio nao encontrado.';
  end if;

  if lower(v_item.destination_code) <> 'ex' then
    raise exception using errcode = '42501', message = 'Esta correcao so vale para Romaneios EX.';
  end if;

  if not private.current_user_has_permission('romaneio.administrar', v_item.destination_code) then
    raise exception using errcode = '42501', message = 'Sem permissao para corrigir este item.';
  end if;

  if v_item.status <> 'enviado' then
    raise exception using errcode = '22023', message = 'Corrija o item antes de conferir o recebimento.';
  end if;

  if v_item.product_source <> 'extra' then
    raise exception using errcode = '22023', message = 'Somente itens avulsos podem ser vinculados.';
  end if;

  select profile.display_name
    into v_user_name
  from public.app_profiles profile
  where profile.user_id = (select auth.uid())
    and profile.active;

  if v_user_name is null then
    raise exception using errcode = '42501', message = 'Perfil inativo.';
  end if;

  if lower(btrim(p_product_source)) = 'product' then
    select product.name
      into v_new_name
    from public.products product
    where product.id::text = btrim(p_product_id)
      and product.active;
  else
    select bread.name
      into v_new_name
    from public.breads bread
    where bread.id::text = btrim(p_product_id)
      and bread.active
      and not bread.is_pj;
  end if;

  if v_new_name is null then
    raise exception using errcode = '22023', message = 'Produto cadastrado ativo nao encontrado.';
  end if;

  v_expected_unit := case
    when lower(v_item.product_name) ~ '\(\s*kg\s*\)' then 'kg'
    else 'un'
  end;

  select count(*)::integer, max(price_item.unit_price)
    into v_price_count, v_new_price
  from public.price_tier_items price_item
  join public.price_tiers tier on tier.id = price_item.tier_id
  where lower(btrim(tier.name)) = 'buck'
    and tier.active
    and price_item.active
    and price_item.product_source = lower(btrim(p_product_source))
    and price_item.product_id = btrim(p_product_id)
    and price_item.pricing_unit = v_expected_unit
    and price_item.unit_price > 0;

  if v_price_count <> 1 then
    raise exception using errcode = '22023', message = 'O produto precisa ter exatamente um preco Buck ativo na unidade correta.';
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
    corrected_by,
    corrected_by_name,
    reason
  ) values (
    v_item.id,
    v_item.romaneio_id,
    v_item.product_id,
    v_item.product_source,
    v_item.product_name,
    v_item.unit_price,
    btrim(p_product_id),
    lower(btrim(p_product_source)),
    v_new_name,
    v_new_price,
    (select auth.uid()),
    v_user_name,
    'Vinculo explicito de item avulso ao produto cadastrado antes da cobranca.'
  );

  update public.romaneio_items
  set
    product_id = btrim(p_product_id),
    product_source = lower(btrim(p_product_source)),
    product_name = v_new_name,
    unit_price = v_new_price
  where id = v_item.id;

  return jsonb_build_object(
    'item_id', v_item.id,
    'product_id', btrim(p_product_id),
    'product_source', lower(btrim(p_product_source)),
    'product_name', v_new_name,
    'unit_price', v_new_price,
    'pricing_unit', v_expected_unit
  );
end;
$$;

revoke all on function public.correct_romaneio_extra_item(uuid, text, text) from public, anon;
grant execute on function public.correct_romaneio_extra_item(uuid, text, text) to authenticated, service_role;

-- Correcao pontual autorizada: a linha encontrada na auditoria live deve passar
-- a usar o produto cadastrado "Pao Originale (Mora)" e seu preco Buck ativo.
do $$
declare
  v_item record;
  v_new_price numeric;
begin
  select item.*
    into v_item
  from public.romaneio_items item
  join public.romaneios romaneio on romaneio.id = item.romaneio_id
  join public.destinations destination on destination.id = romaneio.destination_id
  where item.id = '3f571b95-ac70-4faf-b72a-cb6f73c78526'
    and item.product_id = 'extra_1785415751206'
    and item.product_source = 'extra'
    and item.product_name = 'Pão Originale'
    and item.qty_sent = 6
    and romaneio.record_date = date '2026-07-30'
    and romaneio.trip_number = 3
    and lower(destination.code) = 'ex';

  if found then
    select price_item.unit_price
      into v_new_price
    from public.price_tier_items price_item
    join public.price_tiers tier on tier.id = price_item.tier_id
    where lower(btrim(tier.name)) = 'buck'
      and tier.active
      and price_item.active
      and price_item.product_source = 'product'
      and price_item.product_id = 'a72ab703-1fc0-47e0-a82a-ea04280b120e'
      and price_item.pricing_unit = 'un'
      and price_item.unit_price > 0;

    if v_new_price is null then
      raise exception 'Preco Buck ativo do Pao Originale (Mora) nao encontrado.';
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
      'a72ab703-1fc0-47e0-a82a-ea04280b120e',
      'product',
      'Pão Originale (Mora)',
      v_new_price,
      'Migration 20260804181836 autorizada por Rodrigo',
      'Correcao pontual autorizada do Romaneio EX de 2026-07-30, viagem 3.'
    );

    update public.romaneio_items
    set
      product_id = 'a72ab703-1fc0-47e0-a82a-ea04280b120e',
      product_source = 'product',
      product_name = 'Pão Originale (Mora)',
      unit_price = v_new_price
    where id = v_item.id;
  end if;
end;
$$;
