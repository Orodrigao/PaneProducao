-- Backfill controlado de public.breads para public.products.
--
-- Esta migration pressupoe que 20260624183056_prepare_products_unified_catalog.sql
-- ja foi aplicada. Ela nao altera public.breads e nao muda telas.
--
-- Regra de custo:
-- - produtos existentes mantem cost_price quando ja possuem valor maior que zero;
-- - produtos existentes com cost_price nulo/zero recebem o custo vindo de breads;
-- - produtos novos recebem o custo atual de breads.

do $$
declare
  missing_breads integer;
begin
  select count(*)
    into missing_breads
  from (
    values
      ('belga1775678507408'),
      ('ciabatta1775678319364'),
      ('cuca_de_morango1775678950877'),
      ('focaccia_de_alecrim1775678468584'),
      ('focaccia_de_queijo1775678478927'),
      ('pao_de_milho1775678426513'),
      ('pao_de_sopa1778785206958'),
      ('pao_de_tapioca1778572678568'),
      ('3_cereais1775678458398'),
      ('b_brasil1775678384540'),
      ('b_brasil_integral1775678397507'),
      ('baguete1775678190589'),
      ('brioche_forma1775678330784'),
      ('brioche_hamburguer1775678357276'),
      ('caseirinho1780252159477'),
      ('cinnamon_rolls1779346550762'),
      ('croissant1775679010673'),
      ('cuca_de_banana1775678960466'),
      ('gorgonzola1775678500381'),
      ('grande_arome1775678443844'),
      ('hamburgueritaliano1779892461096'),
      ('integral1775678244925'),
      ('integral_de_forma1775678284293'),
      ('italiano1775678213582'),
      ('italiano_de_queijo_e_oregano1775756211728'),
      ('mandioquinha1779744368922'),
      ('mini_croissant1775679020868'),
      ('multi_de_forma1775678271869'),
      ('multigraos1775678255972'),
      ('pao_de_alecrim1775680191587'),
      ('paodeaboborabaguetinha1779892520050'),
      ('pao_de_azeitonas1775678296133'),
      ('pao_de_bacon1778787664799'),
      ('pao_de_batata_hamburguer1775678367874'),
      ('pao_de_calabresa1775678490836'),
      ('paodehotdog1779743021606'),
      ('paozinhodeabobora1780252052248'),
      ('pizza_redonda1775678980923'),
      ('pizza_romana1775678997139'),
      ('rugbrod1775678416046'),
      ('sarraceno1775678435981')
  ) as expected(bread_id)
  left join public.breads b on b.id = expected.bread_id
  where b.id is null;

  if missing_breads > 0 then
    raise exception 'Backfill abortado: % registros esperados em public.breads nao foram encontrados.', missing_breads;
  end if;
end $$;

with links (
  product_id,
  bread_id,
  bread_cost,
  bread_is_pj,
  bread_is_shelf,
  production_days
) as (
  values
    ('7eef2b32-5d05-4f83-9499-eaaabd8131f6'::uuid, 'belga1775678507408'::text, 3.30::numeric, false, false, array[4, 5, 6]::integer[]),
    ('3ebcca10-b49b-4758-aeee-953c55acce06'::uuid, 'ciabatta1775678319364'::text, 0.45::numeric, false, false, array[1, 2, 3, 4, 5, 6]::integer[]),
    ('53352836-d07d-44b7-9fc0-9e967f114a48'::uuid, 'cuca_de_morango1775678950877'::text, 9.00::numeric, false, true, array[4, 5, 6]::integer[]),
    ('7db3aac1-4745-4731-a96b-c6d412663a91'::uuid, 'focaccia_de_alecrim1775678468584'::text, 7.00::numeric, false, true, array[4, 5, 6]::integer[]),
    ('425c2aa4-399d-404c-993c-71fbc5eddd86'::uuid, 'focaccia_de_queijo1775678478927'::text, 9.00::numeric, false, true, array[4, 5, 6]::integer[]),
    ('dfe8ef27-0dff-4084-89e2-d3ea2323f4eb'::uuid, 'pao_de_milho1775678426513'::text, 2.00::numeric, false, true, array[1]::integer[]),
    ('1ec69792-6500-4bdc-bfe8-1174383cca51'::uuid, 'pao_de_sopa1778785206958'::text, 0.80::numeric, false, false, array[1, 2, 3, 4, 5, 6]::integer[]),
    ('427aa1d5-874e-45ed-92d8-9de8fb0b6e48'::uuid, 'pao_de_tapioca1778572678568'::text, 1.10::numeric, false, false, array[3]::integer[])
)
update public.products p
set
  legacy_bread_id = links.bread_id,
  is_fabricacao_propria = true,
  is_pj = links.bread_is_pj,
  is_revenda = false,
  is_shelf = coalesce(p.is_shelf, false) or links.bread_is_shelf,
  production_days = links.production_days,
  production_area = 'padaria',
  cost_price = case
    when p.cost_price is null or p.cost_price = 0 then links.bread_cost
    else p.cost_price
  end
from links
where p.id = links.product_id
  and (p.legacy_bread_id is null or p.legacy_bread_id = links.bread_id);

insert into public.products (
  name,
  category,
  unit,
  cost_price,
  active,
  is_shelf,
  is_special,
  kind,
  is_revenda,
  is_fabricacao_propria,
  is_pj,
  production_days,
  production_area,
  legacy_bread_id
)
select
  b.name,
  'Pães - Migrado',
  b.unit,
  b.cost_price,
  coalesce(b.active, true),
  b.is_shelf,
  b.is_special,
  'final',
  false,
  true,
  coalesce(b.is_pj, false),
  coalesce(b.days, '{}'::integer[]),
  'padaria',
  b.id
from public.breads b
where b.id in (
  '3_cereais1775678458398',
  'b_brasil1775678384540',
  'b_brasil_integral1775678397507',
  'baguete1775678190589',
  'brioche_forma1775678330784',
  'brioche_hamburguer1775678357276',
  'caseirinho1780252159477',
  'cinnamon_rolls1779346550762',
  'croissant1775679010673',
  'cuca_de_banana1775678960466',
  'gorgonzola1775678500381',
  'grande_arome1775678443844',
  'hamburgueritaliano1779892461096',
  'integral1775678244925',
  'integral_de_forma1775678284293',
  'italiano1775678213582',
  'italiano_de_queijo_e_oregano1775756211728',
  'mandioquinha1779744368922',
  'mini_croissant1775679020868',
  'multi_de_forma1775678271869',
  'multigraos1775678255972',
  'pao_de_alecrim1775680191587',
  'paodeaboborabaguetinha1779892520050',
  'pao_de_azeitonas1775678296133',
  'pao_de_bacon1778787664799',
  'pao_de_batata_hamburguer1775678367874',
  'pao_de_calabresa1775678490836',
  'paodehotdog1779743021606',
  'paozinhodeabobora1780252052248',
  'pizza_redonda1775678980923',
  'pizza_romana1775678997139',
  'rugbrod1775678416046',
  'sarraceno1775678435981'
)
and not exists (
  select 1
  from public.products p
  where p.legacy_bread_id = b.id
);

do $$
declare
  linked_products integer;
begin
  select count(*)
    into linked_products
  from public.products p
  where p.legacy_bread_id in (
    'belga1775678507408',
    'ciabatta1775678319364',
    'cuca_de_morango1775678950877',
    'focaccia_de_alecrim1775678468584',
    'focaccia_de_queijo1775678478927',
    'pao_de_milho1775678426513',
    'pao_de_sopa1778785206958',
    'pao_de_tapioca1778572678568',
    '3_cereais1775678458398',
    'b_brasil1775678384540',
    'b_brasil_integral1775678397507',
    'baguete1775678190589',
    'brioche_forma1775678330784',
    'brioche_hamburguer1775678357276',
    'caseirinho1780252159477',
    'cinnamon_rolls1779346550762',
    'croissant1775679010673',
    'cuca_de_banana1775678960466',
    'gorgonzola1775678500381',
    'grande_arome1775678443844',
    'hamburgueritaliano1779892461096',
    'integral1775678244925',
    'integral_de_forma1775678284293',
    'italiano1775678213582',
    'italiano_de_queijo_e_oregano1775756211728',
    'mandioquinha1779744368922',
    'mini_croissant1775679020868',
    'multi_de_forma1775678271869',
    'multigraos1775678255972',
    'pao_de_alecrim1775680191587',
    'paodeaboborabaguetinha1779892520050',
    'pao_de_azeitonas1775678296133',
    'pao_de_bacon1778787664799',
    'pao_de_batata_hamburguer1775678367874',
    'pao_de_calabresa1775678490836',
    'paodehotdog1779743021606',
    'paozinhodeabobora1780252052248',
    'pizza_redonda1775678980923',
    'pizza_romana1775678997139',
    'rugbrod1775678416046',
    'sarraceno1775678435981'
  );

  if linked_products <> 41 then
    raise exception 'Backfill incompleto: esperado 41 products com legacy_bread_id, encontrado %.', linked_products;
  end if;
end $$;
