-- Saneamento real do catálogo decidido por Rodrigo em 15/09/2026.
--
-- Esta é deliberadamente uma migration de dados, não uma limpeza visual. Ela
-- conserva os nomes já fotografados em pedidos e os preços já existentes; só
-- troca a identidade usada daqui para frente. Nenhum DELETE é feito.
--
-- Trava de segurança: o bloco só roda se encontrar o retrato auditado inteiro.
-- Uma base de CI/seed que não contenha nenhum destes IDs segue adiante sem
-- dados reais. Um retrato parcial ou diferente aborta a transação inteira.

begin;

create temp table catalog_saneamento_map (
  source text not null check (source in ('bread', 'product')),
  source_id text not null,
  source_name text not null,
  source_active boolean not null,
  master_product_id uuid not null,
  master_name text not null,
  variant_name text,
  units text[] not null,
  primary key (source, source_id)
) on commit drop;

insert into catalog_saneamento_map
  (source, source_id, source_name, source_active, master_product_id, master_name, variant_name, units)
values
  ('bread','b_brasil1775678384540','B.Brasil',true,'fb743d97-a911-4066-a2f4-c9e7447e1dac','Baguete Brasil',null,array['un','kg']),
  ('product','fb743d97-a911-4066-a2f4-c9e7447e1dac','B.Brasil',true,'fb743d97-a911-4066-a2f4-c9e7447e1dac','Baguete Brasil',null,array['un','kg']),
  ('bread','baguete1775678190589','Baguete',true,'aacd7a66-ce6b-4127-9ed6-27ced7eb3cb4','Baguete',null,array['un','kg']),
  ('product','aacd7a66-ce6b-4127-9ed6-27ced7eb3cb4','Baguete',true,'aacd7a66-ce6b-4127-9ed6-27ced7eb3cb4','Baguete',null,array['un','kg']),
  ('product','368cb35f-a101-4108-ba34-7a876598b14a','Baguete Tradicional kg',true,'aacd7a66-ce6b-4127-9ed6-27ced7eb3cb4','Baguete',null,array['un','kg']),
  ('bread','belga1775678507408','Belga',true,'7eef2b32-5d05-4f83-9499-eaaabd8131f6','Belga',null,array['un']),
  ('product','7eef2b32-5d05-4f83-9499-eaaabd8131f6','Belga',true,'7eef2b32-5d05-4f83-9499-eaaabd8131f6','Belga',null,array['un']),
  ('bread','ciabatta1775678319364','Ciabatta',true,'3ebcca10-b49b-4758-aeee-953c55acce06','Ciabatta',null,array['un','kg']),
  ('product','9df94c30-b660-4bb2-8dd5-1dcaee0fc21e','Ciabatta',true,'3ebcca10-b49b-4758-aeee-953c55acce06','Ciabatta',null,array['un','kg']),
  ('product','3ebcca10-b49b-4758-aeee-953c55acce06','Ciabatta UN',true,'3ebcca10-b49b-4758-aeee-953c55acce06','Ciabatta',null,array['un','kg']),
  ('bread','cinnamon_rolls1779346550762','Cinnamon rolls',true,'b7d81c3d-ebcf-4c97-94d2-cd95a2730502','Cinnamon Roll',null,array['un']),
  ('product','b7d81c3d-ebcf-4c97-94d2-cd95a2730502','Cinnamon rolls',true,'b7d81c3d-ebcf-4c97-94d2-cd95a2730502','Cinnamon Roll',null,array['un']),
  ('product','6b11d457-05e1-415f-b3c1-1b174934657e','Cinnamon Roll Tradicional',true,'b7d81c3d-ebcf-4c97-94d2-cd95a2730502','Cinnamon Roll',null,array['un']),
  ('bread','croissant1775679010673','Croissant',true,'c824c536-baa7-4479-b13d-e88e8ac10a4d','Croissant',null,array['un']),
  ('product','c824c536-baa7-4479-b13d-e88e8ac10a4d','Croissant',true,'c824c536-baa7-4479-b13d-e88e8ac10a4d','Croissant',null,array['un']),
  ('bread','focaccia_de_alecrim1775678468584','Focaccia de Alecrim',true,'7db3aac1-4745-4731-a96b-c6d412663a91','Focaccia de Alecrim',null,array['un','kg']),
  ('product','8a52d914-06da-414f-a8fc-d0abab063a89','Focaccia Alecrim kg',true,'7db3aac1-4745-4731-a96b-c6d412663a91','Focaccia de Alecrim',null,array['un','kg']),
  ('product','7db3aac1-4745-4731-a96b-c6d412663a91','Focaccia de Alecrim UN',true,'7db3aac1-4745-4731-a96b-c6d412663a91','Focaccia de Alecrim',null,array['un','kg']),
  ('bread','gorgonzola1775678500381','Gorgonzola',true,'389b8782-5644-406c-9204-789a70b5f877','Pão de Gorgonzola',null,array['un']),
  ('product','389b8782-5644-406c-9204-789a70b5f877','Pão de Gorgonzola',true,'389b8782-5644-406c-9204-789a70b5f877','Pão de Gorgonzola',null,array['un']),
  ('bread','hamburgueritaliano1779892461096','Hambúrguer Italiano',true,'122ca929-9867-42d5-be9f-ce39fd8ea5f6','Hambúrguer Italiano',null,array['un']),
  ('product','122ca929-9867-42d5-be9f-ce39fd8ea5f6','Hambúrguer Italiano',true,'122ca929-9867-42d5-be9f-ce39fd8ea5f6','Hambúrguer Italiano',null,array['un']),
  ('bread','integral1775678244925','Integral',true,'361057d9-e969-424e-98ed-096b15abecc5','Integral',null,array['un','kg']),
  ('product','361057d9-e969-424e-98ed-096b15abecc5','Integral',true,'361057d9-e969-424e-98ed-096b15abecc5','Integral',null,array['un','kg']),
  ('bread','italiano1775678213582','Italiano',true,'8a7e0e6e-c2bf-4831-9812-987079f00d91','Italiano',null,array['un','kg']),
  ('product','8a7e0e6e-c2bf-4831-9812-987079f00d91','Italiano',true,'8a7e0e6e-c2bf-4831-9812-987079f00d91','Italiano',null,array['un','kg']),
  ('product','c348481f-a673-47f9-bf9e-52d0d07f341b','Italiano/Filão',false,'8a7e0e6e-c2bf-4831-9812-987079f00d91','Italiano',null,array['un','kg']),
  ('product','1a9da89d-1edc-4b9c-be70-f30bed891830','Semi Italiano',true,'8a7e0e6e-c2bf-4831-9812-987079f00d91','Italiano','Semi Italiano',array['un','kg']),
  ('bread','mini_croissant1775679020868','Mini Croissant',true,'b5714db7-906f-4422-a59d-60e42512c5b9','Mini Croissant',null,array['kg']),
  ('product','b5714db7-906f-4422-a59d-60e42512c5b9','Mini Croissant',true,'b5714db7-906f-4422-a59d-60e42512c5b9','Mini Croissant',null,array['kg']),
  ('bread','multigraos1775678255972','Multigrãos',true,'9ba4a57c-53bd-4922-88a1-8a7b409dc90a','Multigrãos',null,array['un','kg']),
  ('product','9ba4a57c-53bd-4922-88a1-8a7b409dc90a','Multigrãos',true,'9ba4a57c-53bd-4922-88a1-8a7b409dc90a','Multigrãos',null,array['un','kg']),
  ('product','ba794d7f-8b39-49ba-8e94-dcc16c893e5f','Multigrãos rustico',true,'9ba4a57c-53bd-4922-88a1-8a7b409dc90a','Multigrãos',null,array['un','kg']),
  ('bread','pao_de_alecrim1775680191587','Pão de  Alecrim',true,'1322e86a-1e98-4c73-bf7a-29c57c17c9ec','Pão de Alecrim',null,array['un']),
  ('product','1322e86a-1e98-4c73-bf7a-29c57c17c9ec','Pão de  Alecrim',true,'1322e86a-1e98-4c73-bf7a-29c57c17c9ec','Pão de Alecrim',null,array['un']),
  ('bread','pao_de_azeitonas1775678296133','Pão de Azeitonas',true,'f5772baf-74a3-4fe4-b483-ba3e0a9274cc','Pão de Azeitonas',null,array['un','kg']),
  ('product','202e296f-a8ff-4745-82b2-284458eeea10','Pão de Azeitonas',true,'f5772baf-74a3-4fe4-b483-ba3e0a9274cc','Pão de Azeitonas',null,array['un','kg']),
  ('product','f5772baf-74a3-4fe4-b483-ba3e0a9274cc','Pão de Azeitonas',true,'f5772baf-74a3-4fe4-b483-ba3e0a9274cc','Pão de Azeitonas',null,array['un','kg']),
  ('bread','pao_de_calabresa1775678490836','Pão de Calabresa',true,'80d043d9-d540-468c-a9c0-a71cfc87d2c6','Pão de Calabresa',null,array['un']),
  ('product','80d043d9-d540-468c-a9c0-a71cfc87d2c6','Pão de Calabresa',true,'80d043d9-d540-468c-a9c0-a71cfc87d2c6','Pão de Calabresa',null,array['un']),
  ('bread','pizza_redonda1775678980923','Pizza Redonda',true,'d1db5a0e-ffdd-4b92-a204-ae371f71d8fe','Pizza Redonda',null,array['un']),
  ('product','d1db5a0e-ffdd-4b92-a204-ae371f71d8fe','Pizza Redonda',true,'d1db5a0e-ffdd-4b92-a204-ae371f71d8fe','Pizza Redonda',null,array['un']),
  ('bread','pizza_romana1775678997139','Pizza Romana',true,'2904e34a-e958-4be9-8d38-739af7fc0722','Pizza Romana',null,array['kg']),
  ('product','2904e34a-e958-4be9-8d38-739af7fc0722','Pizza Romana',true,'2904e34a-e958-4be9-8d38-739af7fc0722','Pizza Romana',null,array['kg']),
  ('bread','sarraceno1775678435981','Sarraceno',true,'d121ce93-4c10-4a30-b7e4-411e30005620','Sarraceno',null,array['un']),
  ('product','d121ce93-4c10-4a30-b7e4-411e30005620','Sarraceno',true,'d121ce93-4c10-4a30-b7e4-411e30005620','Sarraceno',null,array['un']),
  ('bread','brioche_forma1775678330784','Brioche Forma',true,'41aecca6-fb3e-4ab9-90fd-ad2884a31cc3','Brioche','Forma',array['un','kg']),
  ('bread','brioche_hamburguer1775678357276','Brioche Hamburguer',true,'41aecca6-fb3e-4ab9-90fd-ad2884a31cc3','Brioche','Hambúrguer',array['un','kg']),
  ('product','41aecca6-fb3e-4ab9-90fd-ad2884a31cc3','Brioche Hamburguer',true,'41aecca6-fb3e-4ab9-90fd-ad2884a31cc3','Brioche','Hambúrguer',array['un','kg']),
  ('product','f73bcdab-9c60-4f3a-92f4-8238eab81519','Mini Brioche',true,'41aecca6-fb3e-4ab9-90fd-ad2884a31cc3','Brioche','Mini',array['un','kg']),
  ('product','b194a73d-523f-4a09-9f95-40024c6cfb86','Brioche Flor',true,'41aecca6-fb3e-4ab9-90fd-ad2884a31cc3','Brioche','Flor',array['un','kg']);

insert into catalog_saneamento_map (source,source_id,source_name,source_active,master_product_id,master_name,variant_name,units) values
  ('bread','paodehotdog1779743021606','Pão de Hotdog',true,'888f9a70-ff75-45eb-b5fc-add486dc287c','Pão de Cachorro Quente',null,array['kg']),
  ('product','888f9a70-ff75-45eb-b5fc-add486dc287c','Pão Cachorro Quente',true,'888f9a70-ff75-45eb-b5fc-add486dc287c','Pão de Cachorro Quente',null,array['kg']),
  ('bread','pao_de_nozez1783037673222','Pão de Nozez',true,'13ceeab0-49d0-4700-aa4d-5015431526c8','Pão de Nozes',null,array['un']),
  ('product','13ceeab0-49d0-4700-aa4d-5015431526c8','Pão de Nozes',true,'13ceeab0-49d0-4700-aa4d-5015431526c8','Pão de Nozes',null,array['un']),
  ('bread','paozinhodeabobora1780252052248','Pãozinho de Abóbora',false,'944e4952-fae1-4c7b-abb5-64113e8f5acf','Pãozinho de Abóbora',null,array['un']),
  ('product','944e4952-fae1-4c7b-abb5-64113e8f5acf','Mini Abobora',true,'944e4952-fae1-4c7b-abb5-64113e8f5acf','Pãozinho de Abóbora',null,array['un']);

do $$
declare v_expected integer; v_found integer;
begin
  select count(*) into v_expected from catalog_saneamento_map;
  select count(*) into v_found from catalog_saneamento_map m
  where (m.source = 'bread' and exists (select 1 from public.breads b where b.id=m.source_id and b.name=m.source_name and b.active is not distinct from m.source_active))
     or (m.source = 'product' and exists (select 1 from public.products p where p.id::text=m.source_id and p.name=m.source_name and p.active is not distinct from m.source_active));
  if v_found = 0 then return; end if;
  if v_found <> v_expected
     or (select count(*) from public.breads) + (select count(*) from public.products) <> 99
     or (select count(*) from public.breads where active) + (select count(*) from public.products where active) <> 88 then
    raise exception using errcode='22023', message='O catálogo mudou desde a auditoria de 15/09/2026. O saneamento foi interrompido sem alterar dados.';
  end if;
end $$;

-- O guard acima também decide se esta é a base real. Em seeds de CI não há
-- nenhum ID auditado, portanto todo o restante fica sem efeito.
do $$ begin
  if not exists (select 1 from catalog_saneamento_map m join public.products p on p.id::text=m.source_id where m.source='product') then return; end if;

  update public.products p
  set name=m.master_name, active=true, kind=coalesce(p.kind,'final'), is_fabricacao_propria=true
  from (select distinct master_product_id, master_name from catalog_saneamento_map) m
  where p.id=m.master_product_id;

  update public.products p set active=false
  from catalog_saneamento_map m
  where m.source='product' and p.id::text=m.source_id and p.id<>m.master_product_id;

  -- Decisões de nomenclatura e de inativação que não exigem uma fusão de
  -- identidade. Os nomes antigos continuam nos pedidos e nos preços históricos.
  update public.products set name='Baguete italiana' where id='6b3302ef-ca40-4b82-8199-e393a3eaeb90';
  update public.products set name='Focaccia de Queijo' where id='425c2aa4-399d-404c-993c-71fbc5eddd86';
  update public.products set name='Focaccia de Azeitonas' where id='1ed4b77c-6be8-4e06-bbca-d60dbebcfcb1';
  update public.products set name='Focaccia de Tomate' where id='4fcc5970-7e19-408b-9618-56ebe4d5fb0d';
  update public.products set name='Massa Folhada' where id='5ddf24a1-af1a-4e0b-885a-2ecb9f45c2fb';
  update public.products set name='Grand Arome' where id='3e47332b-8be2-42c8-8106-57f5a06ee041';
  update public.products set active=false where id in ('febd339f-520b-4e70-bdc6-b2331ff6f54b','5f81ab79-9d57-4eb2-aeee-63f927b333d1');
  update public.breads set name='Multigrãos de Forma' where id='multi_de_forma1775678271869';
  update public.products set name='Pão de Cachorro Quente', legacy_bread_id='paodehotdog1779743021606'
    where id='888f9a70-ff75-45eb-b5fc-add486dc287c';
  update public.products set kind='kit', active=true where id in (
    '8ee9b67b-a506-4cf5-b788-f0e5cc5a6216','e236e196-ce49-4195-98d0-8af5fd6440ab','ee706b0e-49f7-4a36-ae2f-e835d57f831e'
  );

  -- Linhas que Rodrigo declarou inválidas ou fora de catálogo não são apagadas:
  -- ficam desativadas e continuam explicando o passado.
  update public.price_tier_items set active=false
  where active and unit_price <= .01
    and (product_source,product_id) in (select source,source_id from catalog_saneamento_map)
       or active and product_source='product' and product_id in ('85a395b9-5c5a-498d-9ebe-c2230967f07f','b2c76ce4-b953-4fd1-ace7-46b250cbf14e');
  update public.customer_price_overrides set active=false
  where active and unit_price <= .01
    and (product_source,product_id) in (select source,source_id from catalog_saneamento_map)
       or active and product_source='product' and product_id in ('85a395b9-5c5a-498d-9ebe-c2230967f07f','b2c76ce4-b953-4fd1-ace7-46b250cbf14e');

  -- Opções canônicas preservam as opções antigas para os pedidos históricos.
  insert into public.product_sale_options(product_id,name,sale_unit,reference_quantity,is_default,active)
  select distinct m.master_product_id,
    case when u.unit='un' then 'Unidade' else 'Quilo' end, u.unit,1,u.unit='un',true
  from catalog_saneamento_map m cross join lateral unnest(m.units) u(unit)
  where m.variant_name is null
  on conflict (product_id,sale_unit) where product_variant_id is null do update
    set active=true, name=excluded.name, updated_at=now();

  -- Brioche é a única receita que ganha variantes reais nesta entrega.
  insert into public.product_variants(product_id,name,sort_order,active)
  values
    ('41aecca6-fb3e-4ab9-90fd-ad2884a31cc3','Forma',1,true),
    ('41aecca6-fb3e-4ab9-90fd-ad2884a31cc3','Hambúrguer',2,true),
    ('41aecca6-fb3e-4ab9-90fd-ad2884a31cc3','Mini',3,true),
    ('41aecca6-fb3e-4ab9-90fd-ad2884a31cc3','Flor',4,true)
  on conflict do nothing;

  update public.product_sale_options set active=false, is_default=false, updated_at=now()
  where product_id='41aecca6-fb3e-4ab9-90fd-ad2884a31cc3' and product_variant_id is null;

  insert into public.product_sale_options(product_id,product_variant_id,name,sale_unit,reference_quantity,unit_weight_kg,is_default,active)
  select v.product_id,v.id,v.name || ' ' || case when u.unit='un' then 'Unidade' else 'Quilo' end,u.unit,1,
         case when v.name='Hambúrguer' and u.unit='un' then .08 else null end,u.unit='un',true
  from public.product_variants v cross join lateral unnest(array['un','kg']::text[]) u(unit)
  where v.product_id='41aecca6-fb3e-4ab9-90fd-ad2884a31cc3'
  on conflict (product_id,product_variant_id,sale_unit) where product_variant_id is not null do update
    set active=true,name=excluded.name,unit_weight_kg=excluded.unit_weight_kg,updated_at=now();

  insert into public.product_recipe_yields(product_id,product_variant_id,basis,finished_weight_kg,yield_units,notes)
  select v.product_id,v.id,'baked',.96,12,'Decisão 41: 80 g por unidade; pacote PJ de 12 unidades.'
  from public.product_variants v where v.product_id='41aecca6-fb3e-4ab9-90fd-ad2884a31cc3' and v.name='Hambúrguer'
  on conflict (product_id,product_variant_id) where product_variant_id is not null do update
    set basis=excluded.basis,finished_weight_kg=excluded.finished_weight_kg,yield_units=excluded.yield_units,notes=excluded.notes,updated_at=now();

  insert into public.product_pj_pack_rules(product_id,product_variant_id,pack_size_units,min_order_packs,order_multiple_packs,notes)
  select v.product_id,v.id,12,1,1,'Decisão 51: pedido PJ em pacotes inteiros de 12 unidades (0,96 kg).'
  from public.product_variants v where v.product_id='41aecca6-fb3e-4ab9-90fd-ad2884a31cc3' and v.name='Hambúrguer'
  on conflict (product_id,product_variant_id) where product_variant_id is not null do update
    set pack_size_units=12,min_order_packs=1,order_multiple_packs=1,notes=excluded.notes,updated_at=now();

  update public.price_tier_items i
  set product_source='product',product_id=m.master_product_id::text,product_name=m.master_name,sale_option_id=o.id
  from catalog_saneamento_map m
  left join public.product_variants v on v.product_id=m.master_product_id and v.name=m.variant_name
  join public.product_sale_options o on o.product_id=m.master_product_id and o.sale_unit=i.pricing_unit
    and o.product_variant_id is not distinct from v.id
  where i.product_source=m.source and i.product_id=m.source_id;

  update public.customer_price_overrides i
  set product_source='product',product_id=m.master_product_id::text,product_name=m.master_name,sale_option_id=o.id
  from catalog_saneamento_map m
  left join public.product_variants v on v.product_id=m.master_product_id and v.name=m.variant_name
  join public.product_sale_options o on o.product_id=m.master_product_id and o.sale_unit=i.pricing_unit
    and o.product_variant_id is not distinct from v.id
  where i.product_source=m.source and i.product_id=m.source_id;

  update public.product_prices i
  set product_source='product',product_id=m.master_product_id::text,product_name=m.master_name
  from catalog_saneamento_map m
  where i.product_source=m.source and i.product_id=m.source_id;

  -- Pedido fechado é fotografia histórica. Só pedidos ainda abertos que
  -- apontavam para duplicatas de product passam a usar a identidade mestre.
  update public.orders r
  set product_source='product',bread_id=m.master_product_id::text,sale_option_id=o.id
  from catalog_saneamento_map m
  left join public.product_variants v on v.product_id=m.master_product_id and v.name=m.variant_name
  join public.product_sale_options o on o.product_id=m.master_product_id and o.sale_unit=coalesce(r.pricing_unit,'un')
    and o.product_variant_id is not distinct from v.id
  where m.source='product' and r.product_source='product' and r.bread_id=m.source_id
    and m.source_id<>m.master_product_id::text and r.cancelled_at is null and r.dispatched_at is null;

  update public.product_components c
  set component_source='product',component_id=m.master_product_id::text,component_variant_id=v.id
  from catalog_saneamento_map m
  left join public.product_variants v on v.product_id=m.master_product_id and v.name=m.variant_name
  where c.component_source=m.source and c.component_id=m.source_id;

  -- As três composições confirmadas: kit financeiro separado, componente físico.
  update public.product_components c set component_source='product',component_id='fb743d97-a911-4066-a2f4-c9e7447e1dac',component_variant_id=null,quantity=4
  where c.parent_product_id='e236e196-ce49-4195-98d0-8af5fd6440ab';
  update public.product_components c set component_source='product',component_id='2eee673f-c0df-4435-a302-d4c4eea9d6f7',component_variant_id=null,quantity=6
  where c.parent_product_id='ee706b0e-49f7-4a36-ae2f-e835d57f831e';
  update public.product_components c set component_source='product',component_id='41aecca6-fb3e-4ab9-90fd-ad2884a31cc3',component_variant_id=v.id,quantity=4
  from public.product_variants v
  where c.parent_product_id='8ee9b67b-a506-4cf5-b788-f0e5cc5a6216'
    and v.product_id='41aecca6-fb3e-4ab9-90fd-ad2884a31cc3' and v.name='Hambúrguer';
end $$;

commit;
