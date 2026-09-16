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

-- Linhas que deixam a tabela comercial por colisão de identidade não somem:
-- ficam fotografadas, com a linha completa original, num livro interno que a
-- API pública não expõe. Isso permite manter um único preço corrente por
-- cliente/tabela e recuperar a configuração antiga em qualquer auditoria.
create table if not exists private.catalog_price_history (
  id uuid primary key default gen_random_uuid(),
  migration_key text not null,
  source_table text not null check (source_table in ('price_tier_items','customer_price_overrides')),
  source_row_id uuid not null,
  original_row jsonb not null,
  archive_reason text not null,
  archived_at timestamptz not null default now(),
  unique (migration_key,source_table,source_row_id)
);

revoke all on table private.catalog_price_history from anon, authenticated;
comment on table private.catalog_price_history is
  'Fotografia interna das linhas de preço retiradas do catálogo corrente durante consolidações aprovadas.';

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

-- O retrato inteiro, e não só os itens que serão unidos, protege esta
-- migration contra qualquer alteração posterior à auditoria.
create temp table catalog_saneamento_expected_identity (source text not null, source_id text not null, source_name text not null, source_active boolean not null, primary key (source,source_id)) on commit drop;

insert into catalog_saneamento_expected_identity(source,source_id,source_name,source_active) values
  ('bread','b_brasil1775678384540','B.Brasil',true),
  ('product','fb743d97-a911-4066-a2f4-c9e7447e1dac','B.Brasil',true),
  ('bread','baguete1775678190589','Baguete',true),
  ('product','aacd7a66-ce6b-4127-9ed6-27ced7eb3cb4','Baguete',true),
  ('product','81c23aea-1a61-4f4f-9c4f-39d699ddbdf2','Baguete de Alecrim ',true),
  ('product','22efe913-758d-45fb-809a-f85949638477','Baguete de Nozes',true),
  ('product','85a395b9-5c5a-498d-9ebe-c2230967f07f','Baguete Francesa',false),
  ('product','b2c76ce4-b953-4fd1-ace7-46b250cbf14e','Baguete Francesa de Tradição',false),
  ('product','59303609-cd18-42f1-9295-c673eb9b83b3','Baguete Macia Calabresa e Azeitonas',false),
  ('product','6b3302ef-ca40-4b82-8199-e393a3eaeb90','Baguete Rocca',true),
  ('product','368cb35f-a101-4108-ba34-7a876598b14a','Baguete Tradicional kg',true),
  ('product','db604ce6-113d-4f4a-ae82-8f742c58071a','Bauru Napolitano',true),
  ('bread','belga1775678507408','Belga',true),
  ('product','7eef2b32-5d05-4f83-9499-eaaabd8131f6','Belga',true),
  ('product','b194a73d-523f-4a09-9f95-40024c6cfb86','Brioche Flor',true),
  ('bread','brioche_forma1775678330784','Brioche Forma',true),
  ('bread','brioche_hamburguer1775678357276','Brioche Hamburguer',true),
  ('product','41aecca6-fb3e-4ab9-90fd-ad2884a31cc3','Brioche Hamburguer',true),
  ('bread','ciabatta1775678319364','Ciabatta',true),
  ('product','9df94c30-b660-4bb2-8dd5-1dcaee0fc21e','Ciabatta',true),
  ('product','3ebcca10-b49b-4758-aeee-953c55acce06','Ciabatta UN',true),
  ('product','6b11d457-05e1-415f-b3c1-1b174934657e','Cinnamon Roll Tradicional',true),
  ('bread','cinnamon_rolls1779346550762','Cinnamon rolls',true),
  ('product','b7d81c3d-ebcf-4c97-94d2-cd95a2730502','Cinnamon rolls',true),
  ('product','cd73dbac-da60-40fa-b1f6-bd29685ecc01','Creme de Aipim',true),
  ('product','0905fa31-f199-4f99-99f5-87742b049be9','Creme de Batata',true),
  ('product','f3d194fe-463a-4810-8490-94cc83504c31','Creme de Moranga',true),
  ('bread','croissant1775679010673','Croissant',true),
  ('product','c824c536-baa7-4479-b13d-e88e8ac10a4d','Croissant',true),
  ('product','7e0ae808-0895-4d53-884a-ef2b843236bf','Croissant de presunto e queijo',true),
  ('product','c868f3e8-3947-4961-8252-c28a12fae145','Croissant Frango',true),
  ('product','8a52d914-06da-414f-a8fc-d0abab063a89','Focaccia Alecrim kg',true),
  ('product','1ed4b77c-6be8-4e06-bbca-d60dbebcfcb1','Focaccia Azeitonas kg',true),
  ('bread','focaccia_de_alecrim1775678468584','Focaccia de Alecrim',true),
  ('product','7db3aac1-4745-4731-a96b-c6d412663a91','Focaccia de Alecrim UN',true),
  ('product','425c2aa4-399d-404c-993c-71fbc5eddd86','Focaccia de Queijo UN',true),
  ('product','4fcc5970-7e19-408b-9618-56ebe4d5fb0d','Focaccia Tomate',true),
  ('bread','gorgonzola1775678500381','Gorgonzola',true),
  ('product','febd339f-520b-4e70-bdc6-b2331ff6f54b','Gran Arome',true),
  ('product','3e47332b-8be2-42c8-8106-57f5a06ee041','Grande Arome',true),
  ('bread','hamburgueritaliano1779892461096','Hambúrguer Italiano',true),
  ('product','122ca929-9867-42d5-be9f-ce39fd8ea5f6','Hambúrguer Italiano',true),
  ('bread','integral1775678244925','Integral',true),
  ('product','361057d9-e969-424e-98ed-096b15abecc5','Integral',true),
  ('bread','integral_de_forma1775678284293','Integral de Forma',true),
  ('bread','italiano1775678213582','Italiano',true),
  ('product','8a7e0e6e-c2bf-4831-9812-987079f00d91','Italiano',true),
  ('bread','italiano_de_queijo_e_oregano1775756211728','Italiano de Queijo e Oregano',true),
  ('product','c348481f-a673-47f9-bf9e-52d0d07f341b','Italiano/Filão',false),
  ('product','8ee9b67b-a506-4cf5-b788-f0e5cc5a6216','KIT 4 PÃES BRIOCHE HAMBURGUER',true),
  ('product','e236e196-ce49-4195-98d0-8af5fd6440ab','Kit Baguete Brasil',true),
  ('product','ee706b0e-49f7-4a36-ae2f-e835d57f831e','Kit Pão de mandioquinha',true),
  ('product','2eee673f-c0df-4435-a302-d4c4eea9d6f7','Mandioquinha',true),
  ('product','5ddf24a1-af1a-4e0b-885a-2ecb9f45c2fb','Massa Folhada kg',true),
  ('product','1afafdb8-62fb-4376-abe6-d0540e47ea04','Medialuna',true),
  ('product','944e4952-fae1-4c7b-abb5-64113e8f5acf','Mini Abobora',true),
  ('product','bdd397bd-8224-48f8-ba17-ddd62472e5b2','Mini Australiano',true),
  ('product','f73bcdab-9c60-4f3a-92f4-8238eab81519','Mini Brioche',true),
  ('product','7e212f95-30fb-4240-a585-12c9b3d832b9','MINI Brownie',true),
  ('product','0f0e1533-8e41-482e-8cec-d47cbadb87b5','Mini Cachorro Quente',true),
  ('bread','mini_croissant1775679020868','Mini Croissant',true),
  ('product','b5714db7-906f-4422-a59d-60e42512c5b9','Mini Croissant',true),
  ('product','2b7ede5b-44e8-4624-ab14-9f0b532e2715','Mini Filão',true),
  ('product','d810f087-244a-4064-a219-da1ca88bc02a','Mini Pão de Milho',true),
  ('bread','multi_de_forma1775678271869','Multi de Forma',true),
  ('bread','multigraos1775678255972','Multigrãos',true),
  ('product','9ba4a57c-53bd-4922-88a1-8a7b409dc90a','Multigrãos',true),
  ('product','ba794d7f-8b39-49ba-8e94-dcc16c893e5f','Multigrãos rustico',true),
  ('product','888f9a70-ff75-45eb-b5fc-add486dc287c','Pão Cachorro Quente',true),
  ('bread','pao_de_alecrim1775680191587','Pão de  Alecrim',true),
  ('product','1322e86a-1e98-4c73-bf7a-29c57c17c9ec','Pão de  Alecrim',true),
  ('bread','pao_de_azeitonas1775678296133','Pão de Azeitonas',true),
  ('product','202e296f-a8ff-4745-82b2-284458eeea10','Pão de Azeitonas',true),
  ('product','f5772baf-74a3-4fe4-b483-ba3e0a9274cc','Pão de Azeitonas',true),
  ('product','fbff59ae-ee03-43c8-bd7f-e7d464e6d949','Pão de Batata Hamburguer',true),
  ('bread','pao_de_calabresa1775678490836','Pão de Calabresa',true),
  ('product','80d043d9-d540-468c-a9c0-a71cfc87d2c6','Pão de Calabresa',true),
  ('product','389b8782-5644-406c-9204-789a70b5f877','Pão de Gorgonzola',true),
  ('bread','paodehotdog1779743021606','Pão de Hotdog',true),
  ('bread','pao_de_milho1775678426513','Pão de Milho',true),
  ('product','13ceeab0-49d0-4700-aa4d-5015431526c8','Pão de Nozes',true),
  ('bread','pao_de_nozez1783037673222','Pão de Nozez',true),
  ('bread','pao_de_sopa1778785206958','Pão de Sopa',true),
  ('bread','pao_de_tapioca1778572678568','Pão de Tapioca',true),
  ('product','a937fd69-afa0-4b16-8244-950aac2adfc5','Pão Originale',false),
  ('product','a72ab703-1fc0-47e0-a82a-ea04280b120e','Pão Originale (Mora)',true),
  ('bread','paozinhodeabobora1780252052248','Pãozinho de Abóbora',false),
  ('bread','pizza_redonda1775678980923','Pizza Redonda',true),
  ('product','d1db5a0e-ffdd-4b92-a204-ae371f71d8fe','Pizza Redonda',true),
  ('bread','pizza_romana1775678997139','Pizza Romana',true),
  ('product','2904e34a-e958-4be9-8d38-739af7fc0722','Pizza Romana',true),
  ('bread','rugbrod1775678416046','Rugbrod',true),
  ('bread','sarraceno1775678435981','Sarraceno',true),
  ('product','d121ce93-4c10-4a30-b7e4-411e30005620','Sarraceno',true),
  ('product','1688c40f-7def-4c42-b802-f38553de5a07','Schiacciata de Pesto',true),
  ('product','5f81ab79-9d57-4eb2-aeee-63f927b333d1','Schiattiata',true),
  ('product','1a9da89d-1edc-4b9c-be70-f30bed891830','Semi Italiano',true),
  ('product','241a8435-7c9a-43ad-86ee-0edf2d7b52fe','Tortinha de Maçã',true),
  ('product','1a74e82c-1950-415b-94f2-be573ca78639','Trouxinha de Frango',true)
;

-- Cada uma das 207 linhas de preço foi fotografada por identidade, tabela ou
-- exceção, unidade, pacote, valor e estado. Divergência interrompe tudo.
create temp table catalog_saneamento_expected_price (source text not null, source_id text not null, price_kind text not null, context_name text not null, pricing_unit text not null, pack_size numeric not null, unit_price numeric not null, price_active boolean not null) on commit drop;

insert into catalog_saneamento_expected_price(source,source_id,price_kind,context_name,pricing_unit,pack_size,unit_price,price_active) values
  ('bread','b_brasil1775678384540','Exceção cliente','Buck','un',10,1,true),
  ('bread','b_brasil1775678384540','Tabela','Atacado A" (maior volume)','un',1,3.45,true),
  ('bread','b_brasil1775678384540','Tabela','Atacado A" (maior volume) (cópia)','un',4,1.43,false),
  ('bread','b_brasil1775678384540','Tabela','Atacado B" (médio)','un',1,3.45,true),
  ('bread','b_brasil1775678384540','Tabela','BECO','kg',1,22.9,true),
  ('bread','b_brasil1775678384540','Tabela','G. REGAL DA SILVA - Sohva Pharos','un',1,3.12,true),
  ('bread','b_brasil1775678384540','Tabela','Mercado do queijo','un',1,2.2,true),
  ('bread','b_brasil1775678384540','Tabela','Mercado do Queijos','un',1,2.2,true),
  ('product','fb743d97-a911-4066-a2f4-c9e7447e1dac','Tabela','BUCK','un',1,1.44,true),
  ('product','fb743d97-a911-4066-a2f4-c9e7447e1dac','Tabela','Quinta parrila','un',1,3.45,true),
  ('product','fb743d97-a911-4066-a2f4-c9e7447e1dac','Tabela','ROCCA','un',1,3.45,true),
  ('bread','baguete1775678190589','Tabela','Atacado A" (maior volume)','un',1,0,true),
  ('bread','baguete1775678190589','Tabela','La Padoca','un',1,10.15,true),
  ('bread','baguete1775678190589','Tabela','TONICO','kg',1,25.5,true),
  ('product','aacd7a66-ce6b-4127-9ed6-27ced7eb3cb4','Tabela','AMADA COZINHA','un',1,16,true),
  ('product','aacd7a66-ce6b-4127-9ed6-27ced7eb3cb4','Tabela','ANDREA SILVA OLIVEIRA','un',1,13,true),
  ('product','aacd7a66-ce6b-4127-9ed6-27ced7eb3cb4','Tabela','Atacado B" (médio)','un',1,13,true),
  ('product','aacd7a66-ce6b-4127-9ed6-27ced7eb3cb4','Tabela','BUCK','un',1,6.5,true),
  ('product','aacd7a66-ce6b-4127-9ed6-27ced7eb3cb4','Tabela','CAPULLO','un',1,20,true),
  ('product','aacd7a66-ce6b-4127-9ed6-27ced7eb3cb4','Tabela','EMPORIO ABRACCIO LTDA','un',1,2.2,true),
  ('product','aacd7a66-ce6b-4127-9ed6-27ced7eb3cb4','Tabela','ROCCA','un',1,7.9,false),
  ('product','aacd7a66-ce6b-4127-9ed6-27ced7eb3cb4','Tabela','TANNAT','un',1,33,false),
  ('product','81c23aea-1a61-4f4f-9c4f-39d699ddbdf2','Tabela','SUCRE','kg',1,31.55,true),
  ('product','22efe913-758d-45fb-809a-f85949638477','Tabela','SUCRE','kg',1,32.7,true),
  ('product','85a395b9-5c5a-498d-9ebe-c2230967f07f','Tabela','BDG BODEGA','kg',1,27.8,true),
  ('product','85a395b9-5c5a-498d-9ebe-c2230967f07f','Tabela','Me Gusta','kg',1,27.5,false),
  ('product','b2c76ce4-b953-4fd1-ace7-46b250cbf14e','Tabela','ANDREA SILVA OLIVEIRA','un',1,13,false),
  ('product','b2c76ce4-b953-4fd1-ace7-46b250cbf14e','Tabela','Atacado A" (maior volume)','un',1,13,true),
  ('product','b2c76ce4-b953-4fd1-ace7-46b250cbf14e','Tabela','BUCK','un',1,6.5,true),
  ('product','59303609-cd18-42f1-9295-c673eb9b83b3','Tabela','BUCK','un',1,10.3,true),
  ('product','6b3302ef-ca40-4b82-8199-e393a3eaeb90','Tabela','ROCCA','kg',1,31.6,true),
  ('product','368cb35f-a101-4108-ba34-7a876598b14a','Tabela','CAPULLO','kg',1,33,true),
  ('product','368cb35f-a101-4108-ba34-7a876598b14a','Tabela','Me Gusta','kg',1,27.5,true),
  ('product','368cb35f-a101-4108-ba34-7a876598b14a','Tabela','Nix','kg',1,33,true),
  ('product','368cb35f-a101-4108-ba34-7a876598b14a','Tabela','TANNAT','kg',1,33,true),
  ('product','db604ce6-113d-4f4a-ae82-8f742c58071a','Tabela','G. REGAL DA SILVA - Sohva Pharos','un',1,6,true),
  ('bread','belga1775678507408','Tabela','BUCK','un',1,11,true),
  ('product','7eef2b32-5d05-4f83-9499-eaaabd8131f6','Tabela','Atacado B" (médio)','un',1,22,true),
  ('product','7eef2b32-5d05-4f83-9499-eaaabd8131f6','Tabela','La Padoca','un',1,18.8,true),
  ('product','b194a73d-523f-4a09-9f95-40024c6cfb86','Tabela','CAPULLO','un',1,3.25,true),
  ('bread','brioche_forma1775678330784','Tabela','Atacado B" (médio)','kg',1,34.15,true),
  ('bread','brioche_forma1775678330784','Tabela','BECO','kg',1,22.9,true),
  ('bread','brioche_forma1775678330784','Tabela','BUCK','un',1,8.5,true),
  ('bread','brioche_forma1775678330784','Tabela','G. REGAL DA SILVA - Sohva Pharos','un',1,14,true),
  ('bread','brioche_forma1775678330784','Tabela','La Padoca','kg',1,34.9,true),
  ('bread','brioche_forma1775678330784','Tabela','SUCRE','kg',1,34.15,true),
  ('bread','brioche_hamburguer1775678357276','Tabela','Atacado A" (maior volume)','un',1,2.6,true),
  ('bread','brioche_hamburguer1775678357276','Tabela','Atacado B" (médio)','un',12,2.6,true),
  ('bread','brioche_hamburguer1775678357276','Tabela','BECO','kg',1,22.9,true),
  ('bread','brioche_hamburguer1775678357276','Tabela','G. REGAL DA SILVA - Sohva Pharos','un',1,2.6,true),
  ('bread','brioche_hamburguer1775678357276','Tabela','TONICO','un',1,2.6,true),
  ('product','41aecca6-fb3e-4ab9-90fd-ad2884a31cc3','Tabela','BUCK','un',1,1.37,true),
  ('product','41aecca6-fb3e-4ab9-90fd-ad2884a31cc3','Tabela','Ponto Coletivo','un',1,2.6,true),
  ('bread','ciabatta1775678319364','Tabela','Atacado B" (médio)','kg',1,31.55,true),
  ('bread','ciabatta1775678319364','Tabela','BECO','kg',1,22.9,true),
  ('bread','ciabatta1775678319364','Tabela','BUCK','kg',1,18.5,true),
  ('bread','ciabatta1775678319364','Tabela','La Padoca','kg',1,27.65,true),
  ('bread','ciabatta1775678319364','Tabela','SUCRE','kg',1,31.55,true),
  ('product','9df94c30-b660-4bb2-8dd5-1dcaee0fc21e','Tabela','BECO','kg',1,0,false),
  ('product','9df94c30-b660-4bb2-8dd5-1dcaee0fc21e','Tabela','EMPORIO ABRACCIO LTDA','kg',1,31.6,true),
  ('product','9df94c30-b660-4bb2-8dd5-1dcaee0fc21e','Tabela','LUCKY','kg',1,31.55,true),
  ('product','9df94c30-b660-4bb2-8dd5-1dcaee0fc21e','Tabela','Ponto Coletivo','kg',1,31.55,true),
  ('product','3ebcca10-b49b-4758-aeee-953c55acce06','Tabela','ANDREA SILVA OLIVEIRA','un',1,6,true),
  ('product','3ebcca10-b49b-4758-aeee-953c55acce06','Tabela','Atacado A" (maior volume)','un',1,0,true),
  ('product','3ebcca10-b49b-4758-aeee-953c55acce06','Tabela','EMPORIO ABRACCIO LTDA','un',1,31.6,false),
  ('product','3ebcca10-b49b-4758-aeee-953c55acce06','Tabela','Ponto Coletivo','un',1,3.12,false),
  ('product','3ebcca10-b49b-4758-aeee-953c55acce06','Tabela','ROCCA','un',1,3.25,true),
  ('product','3ebcca10-b49b-4758-aeee-953c55acce06','Tabela','TUDO EM GRÃO','un',1,6,true),
  ('product','6b11d457-05e1-415f-b3c1-1b174934657e','Tabela','BUCK','un',1,3.25,false),
  ('product','6b11d457-05e1-415f-b3c1-1b174934657e','Tabela','Solva Moinhos','un',1,7.15,true),
  ('bread','cinnamon_rolls1779346550762','Tabela','G. REGAL DA SILVA - Sohva Pharos','un',1,5.5,true),
  ('product','b7d81c3d-ebcf-4c97-94d2-cd95a2730502','Tabela','BUCK','un',1,3.25,true),
  ('product','cd73dbac-da60-40fa-b1f6-bd29685ecc01','Tabela','BUCK','un',1,9.5,true),
  ('product','0905fa31-f199-4f99-99f5-87742b049be9','Tabela','BUCK','un',1,9.5,true),
  ('product','f3d194fe-463a-4810-8490-94cc83504c31','Tabela','BUCK','un',1,9.5,true),
  ('bread','croissant1775679010673','Tabela','Atacado A" (maior volume)','un',1,6.6,true),
  ('bread','croissant1775679010673','Tabela','Atacado A" (maior volume) (cópia)','un',1,0,false),
  ('bread','croissant1775679010673','Tabela','Atacado B" (médio)','un',1,6.6,true),
  ('bread','croissant1775679010673','Tabela','BUCK','un',1,4.65,true),
  ('bread','croissant1775679010673','Tabela','G. REGAL DA SILVA - Sohva Pharos','un',1,5.5,true),
  ('bread','croissant1775679010673','Tabela','Solva Moinhos','un',1,6.6,true),
  ('bread','croissant1775679010673','Tabela','SUCRE','un',1,6.6,true),
  ('product','c824c536-baa7-4479-b13d-e88e8ac10a4d','Tabela','BUCK','un',2,4.65,false),
  ('product','c824c536-baa7-4479-b13d-e88e8ac10a4d','Tabela','EMPORIO ABRACCIO LTDA','un',1,6,true),
  ('product','c824c536-baa7-4479-b13d-e88e8ac10a4d','Tabela','LUCKY','un',1,6.6,true),
  ('product','7e0ae808-0895-4d53-884a-ef2b843236bf','Tabela','G. REGAL DA SILVA - Sohva Pharos','un',1,7,true),
  ('product','c868f3e8-3947-4961-8252-c28a12fae145','Tabela','G. REGAL DA SILVA - Sohva Pharos','un',1,7,true),
  ('product','8a52d914-06da-414f-a8fc-d0abab063a89','Tabela','BDG BODEGA','kg',1,39.5,true),
  ('product','8a52d914-06da-414f-a8fc-d0abab063a89','Tabela','CAPULLO','kg',1,35.9,false),
  ('product','8a52d914-06da-414f-a8fc-d0abab063a89','Tabela','EMPORIO ABRACCIO LTDA','kg',1,35.9,true),
  ('product','8a52d914-06da-414f-a8fc-d0abab063a89','Tabela','TANNAT','kg',1,35.9,true),
  ('product','1ed4b77c-6be8-4e06-bbca-d60dbebcfcb1','Tabela','BDG BODEGA','kg',1,42.9,true),
  ('bread','focaccia_de_alecrim1775678468584','Tabela','BUCK','un',1,11,true),
  ('bread','focaccia_de_alecrim1775678468584','Tabela','Mercado do Queijos','kg',1,35.9,true),
  ('product','7db3aac1-4745-4731-a96b-c6d412663a91','Tabela','ANDREA SILVA OLIVEIRA','un',1,45,false),
  ('product','425c2aa4-399d-404c-993c-71fbc5eddd86','Tabela','ANDREA SILVA OLIVEIRA','un',1,45,true),
  ('product','425c2aa4-399d-404c-993c-71fbc5eddd86','Tabela','BUCK','un',1,14,true),
  ('product','4fcc5970-7e19-408b-9618-56ebe4d5fb0d','Tabela','CAPULLO','kg',1,38.9,true),
  ('product','4fcc5970-7e19-408b-9618-56ebe4d5fb0d','Tabela','Mercado do Queijos','kg',1,42.9,true),
  ('bread','gorgonzola1775678500381','Tabela','BUCK','un',1,13.12,true),
  ('bread','gorgonzola1775678500381','Tabela','La Padoca','un',1,18.8,true),
  ('bread','gorgonzola1775678500381','Tabela','SICA','un',1,27,true),
  ('product','febd339f-520b-4e70-bdc6-b2331ff6f54b','Tabela','BUCK','un',1,11,false),
  ('product','3e47332b-8be2-42c8-8106-57f5a06ee041','Tabela','BUCK','un',1,11,true),
  ('bread','hamburgueritaliano1779892461096','Tabela','LA BRASA PATIO','un',1,2.2,true),
  ('product','122ca929-9867-42d5-be9f-ce39fd8ea5f6','Tabela','X CALOTA','un',1,2.2,true),
  ('product','122ca929-9867-42d5-be9f-ce39fd8ea5f6','Tabela','X CALOTA FARROUPILHA','un',1,2.2,true),
  ('bread','integral1775678244925','Tabela','BUCK','un',1,9.7,true),
  ('bread','integral1775678244925','Tabela','La Padoca','kg',1,33.3,true),
  ('bread','integral1775678244925','Tabela','SUCRE','kg',1,36.5,true),
  ('product','361057d9-e969-424e-98ed-096b15abecc5','Tabela','Atacado B" (médio)','un',1,22,true),
  ('product','361057d9-e969-424e-98ed-096b15abecc5','Tabela','TUDO EM GRÃO','un',1,15.2,true),
  ('bread','integral_de_forma1775678284293','Tabela','BUCK','un',1,9.5,true),
  ('bread','integral_de_forma1775678284293','Tabela','La Padoca','un',1,0,false),
  ('bread','italiano1775678213582','Tabela','Atacado A" (maior volume)','kg',1,31.55,true),
  ('bread','italiano1775678213582','Tabela','Atacado B" (médio)','kg',1,31.55,true),
  ('bread','italiano1775678213582','Tabela','BUCK','un',1,4.5,true),
  ('bread','italiano1775678213582','Tabela','Eventos','un',1,31.55,true),
  ('bread','italiano1775678213582','Tabela','SICA','un',1,14,true),
  ('product','8a7e0e6e-c2bf-4831-9812-987079f00d91','Tabela','EMPORIO ABRACCIO LTDA','un',1,14,true),
  ('product','8a7e0e6e-c2bf-4831-9812-987079f00d91','Tabela','Quinta parrila','un',1,31.55,true),
  ('bread','italiano_de_queijo_e_oregano1775756211728','Tabela','BUCK','un',1,7.5,true),
  ('product','c348481f-a673-47f9-bf9e-52d0d07f341b','Tabela','Quinta parrila','kg',1,31.55,false),
  ('product','8ee9b67b-a506-4cf5-b788-f0e5cc5a6216','Tabela','BUCK','un',1,5.46,false),
  ('product','e236e196-ce49-4195-98d0-8af5fd6440ab','Tabela','BUCK','un',1,5.76,false),
  ('product','ee706b0e-49f7-4a36-ae2f-e835d57f831e','Tabela','BUCK','un',1,8,false),
  ('product','2eee673f-c0df-4435-a302-d4c4eea9d6f7','Tabela','BUCK','un',1,8,true),
  ('product','5ddf24a1-af1a-4e0b-885a-2ecb9f45c2fb','Tabela','Atacado B" (médio)','kg',1,50,true),
  ('product','1afafdb8-62fb-4376-abe6-d0540e47ea04','Tabela','Solva Moinhos','un',1,4,true),
  ('product','944e4952-fae1-4c7b-abb5-64113e8f5acf','Tabela','CAPULLO','un',1,1.6,true),
  ('product','bdd397bd-8224-48f8-ba17-ddd62472e5b2','Tabela','CAPULLO','un',1,1.5,true),
  ('product','f73bcdab-9c60-4f3a-92f4-8238eab81519','Tabela','CAPULLO','un',1,1.2,true),
  ('product','7e212f95-30fb-4240-a585-12c9b3d832b9','Tabela','CAPULLO','un',1,1.2,true),
  ('product','7e212f95-30fb-4240-a585-12c9b3d832b9','Tabela','TANNAT','un',1,1.2,true),
  ('product','0f0e1533-8e41-482e-8cec-d47cbadb87b5','Tabela','CAPULLO','un',1,1.2,true),
  ('bread','mini_croissant1775679020868','Tabela','Atacado A" (maior volume)','un',1,0.01,true),
  ('bread','mini_croissant1775679020868','Tabela','BUCK','kg',1,50,true),
  ('bread','mini_croissant1775679020868','Tabela','G. REGAL DA SILVA - Sohva Pharos','kg',1,100,true),
  ('product','b5714db7-906f-4422-a59d-60e42512c5b9','Tabela','ANDREA SILVA OLIVEIRA','kg',1,110,true),
  ('product','b5714db7-906f-4422-a59d-60e42512c5b9','Tabela','Atacado B" (médio)','kg',1,110,true),
  ('product','b5714db7-906f-4422-a59d-60e42512c5b9','Tabela','BUCK','un',2,55,false),
  ('product','b5714db7-906f-4422-a59d-60e42512c5b9','Tabela','CAPULLO','kg',1,110,true),
  ('product','2b7ede5b-44e8-4624-ab14-9f0b532e2715','Tabela','CAPULLO','un',1,1.2,true),
  ('product','d810f087-244a-4064-a219-da1ca88bc02a','Tabela','CAPULLO','un',1,1.5,true),
  ('bread','multi_de_forma1775678271869','Tabela','BUCK','un',1,9.5,true),
  ('bread','multi_de_forma1775678271869','Tabela','G. REGAL DA SILVA - Sohva Pharos','un',1,14,true),
  ('bread','multigraos1775678255972','Tabela','Atacado A" (maior volume)','kg',1,31.55,true),
  ('bread','multigraos1775678255972','Tabela','Atacado A" (maior volume) (cópia)','un',1,18,false),
  ('bread','multigraos1775678255972','Tabela','Atacado B" (médio)','kg',1,31.55,true),
  ('bread','multigraos1775678255972','Tabela','BUCK','un',1,9.5,true),
  ('bread','multigraos1775678255972','Tabela','La Padoca','un',1,13.55,true),
  ('product','9ba4a57c-53bd-4922-88a1-8a7b409dc90a','Tabela','AMADA COZINHA','un',1,22,true),
  ('product','9ba4a57c-53bd-4922-88a1-8a7b409dc90a','Tabela','ANDREA SILVA OLIVEIRA','un',1,22,true),
  ('product','9ba4a57c-53bd-4922-88a1-8a7b409dc90a','Tabela','CAPULLO','un',1,15.2,true),
  ('product','9ba4a57c-53bd-4922-88a1-8a7b409dc90a','Tabela','EMPORIO ABRACCIO LTDA','un',1,19,true),
  ('product','9ba4a57c-53bd-4922-88a1-8a7b409dc90a','Tabela','LUCKY','un',1,15.2,true),
  ('product','9ba4a57c-53bd-4922-88a1-8a7b409dc90a','Tabela','Quinta parrila','un',1,18.8,true),
  ('product','9ba4a57c-53bd-4922-88a1-8a7b409dc90a','Tabela','TANNAT','un',1,22,true),
  ('product','9ba4a57c-53bd-4922-88a1-8a7b409dc90a','Tabela','TUDO EM GRÃO','un',1,15.2,true),
  ('product','ba794d7f-8b39-49ba-8e94-dcc16c893e5f','Tabela','LUCKY','un',1,0,false),
  ('product','888f9a70-ff75-45eb-b5fc-add486dc287c','Tabela','BECO','kg',1,22.9,false),
  ('product','888f9a70-ff75-45eb-b5fc-add486dc287c','Tabela','CAPULLO','un',1,1.2,false),
  ('bread','pao_de_alecrim1775680191587','Tabela','BUCK','un',1,6.5,true),
  ('bread','pao_de_alecrim1775680191587','Tabela','SICA','un',1,18,true),
  ('product','1322e86a-1e98-4c73-bf7a-29c57c17c9ec','Tabela','ANDREA SILVA OLIVEIRA','un',1,12,true),
  ('product','1322e86a-1e98-4c73-bf7a-29c57c17c9ec','Tabela','Quinta parrila','un',1,14,true),
  ('bread','pao_de_azeitonas1775678296133','Tabela','Atacado B" (médio)','kg',1,31.55,true),
  ('bread','pao_de_azeitonas1775678296133','Tabela','BUCK','un',1,9.5,true),
  ('product','202e296f-a8ff-4745-82b2-284458eeea10','Tabela','La Padoca','kg',1,36.2,true),
  ('product','f5772baf-74a3-4fe4-b483-ba3e0a9274cc','Tabela','AMADA COZINHA','un',1,22,true),
  ('product','f5772baf-74a3-4fe4-b483-ba3e0a9274cc','Tabela','La Padoca','un',1,6.9,false),
  ('product','f5772baf-74a3-4fe4-b483-ba3e0a9274cc','Tabela','Quinta parrila','un',1,18.8,true),
  ('product','f5772baf-74a3-4fe4-b483-ba3e0a9274cc','Tabela','TANNAT','un',1,22,true),
  ('product','f5772baf-74a3-4fe4-b483-ba3e0a9274cc','Tabela','TUDO EM GRÃO','un',1,15.2,true),
  ('product','fbff59ae-ee03-43c8-bd7f-e7d464e6d949','Tabela','BUCK','un',1,1.47,true),
  ('bread','pao_de_calabresa1775678490836','Tabela','BUCK','un',1,11,true),
  ('product','80d043d9-d540-468c-a9c0-a71cfc87d2c6','Tabela','ANDREA SILVA OLIVEIRA','un',1,22,true),
  ('product','80d043d9-d540-468c-a9c0-a71cfc87d2c6','Tabela','TANNAT','un',1,22,true),
  ('product','389b8782-5644-406c-9204-789a70b5f877','Tabela','ANDREA SILVA OLIVEIRA','un',1,27,true),
  ('product','389b8782-5644-406c-9204-789a70b5f877','Tabela','TANNAT','un',1,25,true),
  ('bread','paodehotdog1779743021606','Tabela','BECO','kg',1,22.9,true),
  ('bread','pao_de_milho1775678426513','Tabela','BUCK','un',1,8,true),
  ('product','13ceeab0-49d0-4700-aa4d-5015431526c8','Tabela','BUCK','un',1,11,false),
  ('bread','pao_de_nozez1783037673222','Tabela','BUCK','un',1,11,true),
  ('bread','pao_de_nozez1783037673222','Tabela','Quinta parrila','un',1,18.8,true),
  ('bread','pao_de_sopa1778785206958','Tabela','BECO','kg',1,22.9,true),
  ('bread','pao_de_sopa1778785206958','Tabela','BUCK','un',1,6,true),
  ('bread','pao_de_sopa1778785206958','Tabela','La Padoca','un',1,7.5,true),
  ('bread','pao_de_tapioca1778572678568','Tabela','BUCK','un',1,5.99,true),
  ('product','a937fd69-afa0-4b16-8244-950aac2adfc5','Tabela','BUCK','un',1,13,false),
  ('product','a72ab703-1fc0-47e0-a82a-ea04280b120e','Tabela','BUCK','un',1,13,true),
  ('bread','paozinhodeabobora1780252052248','Tabela','Solva Moinhos','un',1,3.1,true),
  ('bread','pizza_redonda1775678980923','Tabela','Atacado B" (médio)','un',1,12.4,true),
  ('bread','pizza_redonda1775678980923','Tabela','SICA','un',1,12.4,true),
  ('product','d1db5a0e-ffdd-4b92-a204-ae371f71d8fe','Tabela','BUCK','un',1,3.8,true),
  ('bread','pizza_romana1775678997139','Tabela','Atacado A" (maior volume)','kg',1,18.6,true),
  ('bread','pizza_romana1775678997139','Tabela','BUCK','kg',1,9.3,true),
  ('product','2904e34a-e958-4be9-8d38-739af7fc0722','Tabela','Ponto Coletivo','un',1,0,false),
  ('product','2904e34a-e958-4be9-8d38-739af7fc0722','Tabela','Ponto Coletivo','kg',1,18.6,true),
  ('bread','rugbrod1775678416046','Tabela','BUCK','un',1,7,true),
  ('bread','sarraceno1775678435981','Tabela','BUCK','un',1,9.5,true),
  ('product','d121ce93-4c10-4a30-b7e4-411e30005620','Tabela','BUCK','un',1,9.5,true),
  ('product','1688c40f-7def-4c42-b802-f38553de5a07','Tabela','BUCK','un',1,12,true),
  ('product','5f81ab79-9d57-4eb2-aeee-63f927b333d1','Tabela','CAPULLO','un',1,0,false),
  ('product','1a9da89d-1edc-4b9c-be70-f30bed891830','Tabela','La Padoca','un',1,3.9,true),
  ('product','241a8435-7c9a-43ad-86ee-0edf2d7b52fe','Tabela','G. REGAL DA SILVA - Sohva Pharos','un',1,6,true),
  ('product','1a74e82c-1950-415b-94f2-be573ca78639','Tabela','G. REGAL DA SILVA - Sohva Pharos','un',1,8,true)
;

do $$
declare v_expected integer; v_found integer;
begin
  select count(*) into v_expected from catalog_saneamento_expected_identity;
  select count(*) into v_found from catalog_saneamento_expected_identity e
  where (e.source = 'bread' and exists (select 1 from public.breads b where b.id=e.source_id and b.name=e.source_name and b.active is not distinct from e.source_active))
     or (e.source = 'product' and exists (select 1 from public.products p where p.id::text=e.source_id and p.name=e.source_name and p.active is not distinct from e.source_active));
  if v_found = 0 then return; end if;
  if v_found <> v_expected
     or (select count(*) from public.breads) + (select count(*) from public.products) <> 99
     or (select count(*) from public.breads where active) + (select count(*) from public.products where active) <> 88 then
    raise exception using errcode='22023', message='O catálogo mudou desde a auditoria de 15/09/2026. O saneamento foi interrompido sem alterar dados.';
  end if;

  select count(*) into v_expected from catalog_saneamento_expected_price;
  select count(*) into v_found
  from catalog_saneamento_expected_price e
  where (e.price_kind='Tabela' and exists (
    select 1 from public.price_tier_items i
    join public.price_tiers t on t.id=i.tier_id
    where i.product_source=e.source and i.product_id=e.source_id
      and t.name=e.context_name and i.pricing_unit=e.pricing_unit
      and i.pack_size=e.pack_size and i.unit_price=e.unit_price
      and i.active is not distinct from e.price_active
  )) or (e.price_kind='Exceção cliente' and exists (
    select 1 from public.customer_price_overrides i
    join public.customers c on c.id=i.customer_id
    where i.product_source=e.source and i.product_id=e.source_id
      and c.name=e.context_name and i.pricing_unit=e.pricing_unit
      and i.pack_size=e.pack_size and i.unit_price=e.unit_price
      and i.active is not distinct from e.price_active
  ));
  if v_found <> v_expected
     or (select count(*) from public.price_tier_items) + (select count(*) from public.customer_price_overrides) <> 207 then
    raise exception using errcode='22023', message='Os preços mudaram desde a auditoria de 15/09/2026. O saneamento foi interrompido sem alterar dados.';
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

  -- Decisões 16 e 22: as opções antigas por unidade ficam apenas como
  -- referência de pedidos já registrados; não voltam ao catálogo comercial.
  update public.product_sale_options
  set active=false, is_default=false, updated_at=now()
  where product_id in ('b5714db7-906f-4422-a59d-60e42512c5b9','2904e34a-e958-4be9-8d38-739af7fc0722')
    and product_variant_id is null and sale_unit='un';

  -- Baguete italiana é uma identidade própria, vendida somente por kg.
  insert into public.product_sale_options(product_id,name,sale_unit,reference_quantity,is_default,active)
  values ('6b3302ef-ca40-4b82-8199-e393a3eaeb90','Quilo','kg',1,true,true)
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

  -- Preço corrente e preço histórico não podem disputar a mesma chave. Antes
  -- de consolidar, todo registro envolvido é fotografado no livro interno;
  -- em seguida somente a configuração comercial válida volta ao catálogo.
  create temp table catalog_saneamento_price_plan (
    source_table text not null check (source_table in ('price_tier_items','customer_price_overrides')),
    source_row_id uuid not null,
    owner_id uuid not null,
    target_product_id uuid not null,
    target_product_name text not null,
    target_sale_option_id uuid not null,
    unit_price numeric not null,
    pricing_unit text not null,
    pack_size numeric not null,
    desired_active boolean not null,
    original_row jsonb not null,
    primary key (source_table,source_row_id)
  ) on commit drop;

  insert into catalog_saneamento_price_plan
    (source_table,source_row_id,owner_id,target_product_id,target_product_name,target_sale_option_id,unit_price,pricing_unit,pack_size,desired_active,original_row)
  select 'price_tier_items',i.id,i.tier_id,canonical.product_id,canonical.product_name,o.id,
         i.unit_price,i.pricing_unit,i.pack_size,
         case
           when i.unit_price <= .01 then false
           when m.source='bread' and m.source_id='b_brasil1775678384540'
             and i.unit_price=1 and i.pack_size=10 and i.pricing_unit='un' then false
           when canonical.product_id in ('b5714db7-906f-4422-a59d-60e42512c5b9','2904e34a-e958-4be9-8d38-739af7fc0722')
             and i.pricing_unit='un' then false
           when m.master_product_id='8a7e0e6e-c2bf-4831-9812-987079f00d91'
             and i.unit_price=31.55 and i.pricing_unit='un'
             and t.name in ('Eventos','Quinta parrila') then false
           when m.source='product' and m.source_id='c348481f-a673-47f9-bf9e-52d0d07f341b'
             and i.unit_price=31.55 and i.pricing_unit='kg' and t.name='Quinta parrila' then true
           else i.active
         end,
         to_jsonb(i)
  from public.price_tier_items i
  join catalog_saneamento_map m on m.source=i.product_source and m.source_id=i.product_id
  join public.price_tiers t on t.id=i.tier_id
  cross join lateral (
    select case when m.source='bread' and m.source_id='baguete1775678190589' and t.name='TONICO'
                  then '6b3302ef-ca40-4b82-8199-e393a3eaeb90'::uuid else m.master_product_id end as product_id,
           case when m.source='bread' and m.source_id='baguete1775678190589' and t.name='TONICO'
                  then 'Baguete italiana' else m.master_name end as product_name,
           m.variant_name as variant_name
  ) canonical
  left join public.product_variants v on v.product_id=canonical.product_id and v.name=canonical.variant_name
  join public.product_sale_options o on o.product_id=canonical.product_id and o.sale_unit=i.pricing_unit
    and o.product_variant_id is not distinct from v.id;

  insert into catalog_saneamento_price_plan
    (source_table,source_row_id,owner_id,target_product_id,target_product_name,target_sale_option_id,unit_price,pricing_unit,pack_size,desired_active,original_row)
  select 'customer_price_overrides',i.id,i.customer_id,canonical.product_id,canonical.product_name,o.id,
         i.unit_price,i.pricing_unit,i.pack_size,
         case
           when i.unit_price <= .01 then false
           when m.source='bread' and m.source_id='b_brasil1775678384540'
             and i.unit_price=1 and i.pack_size=10 and i.pricing_unit='un' then false
           when canonical.product_id in ('b5714db7-906f-4422-a59d-60e42512c5b9','2904e34a-e958-4be9-8d38-739af7fc0722')
             and i.pricing_unit='un' then false
           when m.master_product_id='8a7e0e6e-c2bf-4831-9812-987079f00d91'
             and i.unit_price=31.55 and i.pricing_unit='un'
             and c.name='Quinta Parrilla Bar LTDA' then false
           when m.source='product' and m.source_id='c348481f-a673-47f9-bf9e-52d0d07f341b'
             and i.unit_price=31.55 and i.pricing_unit='kg' and c.name='Quinta Parrilla Bar LTDA' then true
           else i.active
         end,
         to_jsonb(i)
  from public.customer_price_overrides i
  join catalog_saneamento_map m on m.source=i.product_source and m.source_id=i.product_id
  join public.customers c on c.id=i.customer_id
  cross join lateral (
    select case when m.source='bread' and m.source_id='baguete1775678190589' and c.name='Tonico Lanches'
                  then '6b3302ef-ca40-4b82-8199-e393a3eaeb90'::uuid else m.master_product_id end as product_id,
           case when m.source='bread' and m.source_id='baguete1775678190589' and c.name='Tonico Lanches'
                  then 'Baguete italiana' else m.master_name end as product_name,
           m.variant_name as variant_name
  ) canonical
  left join public.product_variants v on v.product_id=canonical.product_id and v.name=canonical.variant_name
  join public.product_sale_options o on o.product_id=canonical.product_id and o.sale_unit=i.pricing_unit
    and o.product_variant_id is not distinct from v.id;

  if (select count(*) from catalog_saneamento_price_plan)
       <> (select count(*) from public.price_tier_items i join catalog_saneamento_map m on m.source=i.product_source and m.source_id=i.product_id)
        + (select count(*) from public.customer_price_overrides i join catalog_saneamento_map m on m.source=i.product_source and m.source_id=i.product_id) then
    raise exception using errcode='22023', message='Há preço sem opção de venda compatível. O saneamento foi interrompido sem alterar dados.';
  end if;

  if exists (
    select 1 from catalog_saneamento_price_plan
    where desired_active
    group by source_table,owner_id,target_product_id,target_sale_option_id
    having count(distinct (unit_price::text || '|' || pricing_unit || '|' || pack_size::text)) > 1
  ) then
    raise exception using errcode='22023', message='Há dois preços comerciais diferentes para a mesma tabela/cliente após a consolidação. O saneamento foi interrompido sem alterar dados.';
  end if;

  insert into private.catalog_price_history(migration_key,source_table,source_row_id,original_row,archive_reason)
  select '20260916164741_saneamento_catalogo_decisoes',source_table,source_row_id,original_row,
         'Consolidação aprovada do catálogo; configuração anterior preservada antes de substituir a identidade comercial.'
  from catalog_saneamento_price_plan
  on conflict (migration_key,source_table,source_row_id) do nothing;

  -- Decisão 2: produto inativo, sem preço comercial. As duas linhas atuais
  -- ficam no histórico, mas não voltam à tabela ativa.
  insert into private.catalog_price_history(migration_key,source_table,source_row_id,original_row,archive_reason)
  select '20260916164741_saneamento_catalogo_decisoes','price_tier_items',i.id,to_jsonb(i),
         'Decisão 2: Baguete Francesa de Tradição permanece inativa; preços retirados do catálogo corrente.'
  from public.price_tier_items i
  where i.product_source='product' and i.product_id='b2c76ce4-b953-4fd1-ace7-46b250cbf14e'
  on conflict (migration_key,source_table,source_row_id) do nothing;
  insert into private.catalog_price_history(migration_key,source_table,source_row_id,original_row,archive_reason)
  select '20260916164741_saneamento_catalogo_decisoes','customer_price_overrides',i.id,to_jsonb(i),
         'Decisão 2: Baguete Francesa de Tradição permanece inativa; preços retirados do catálogo corrente.'
  from public.customer_price_overrides i
  where i.product_source='product' and i.product_id='b2c76ce4-b953-4fd1-ace7-46b250cbf14e'
  on conflict (migration_key,source_table,source_row_id) do nothing;

  delete from public.price_tier_items i
  using catalog_saneamento_price_plan p
  where p.source_table='price_tier_items' and p.source_row_id=i.id;
  delete from public.customer_price_overrides i
  using catalog_saneamento_price_plan p
  where p.source_table='customer_price_overrides' and p.source_row_id=i.id;
  delete from public.price_tier_items where product_source='product' and product_id='b2c76ce4-b953-4fd1-ace7-46b250cbf14e';
  delete from public.customer_price_overrides where product_source='product' and product_id='b2c76ce4-b953-4fd1-ace7-46b250cbf14e';

  insert into public.price_tier_items(id,tier_id,product_id,product_source,product_name,unit_price,pricing_unit,pack_size,active,created_at,sale_option_id)
  select distinct on (owner_id,target_product_id,target_sale_option_id)
         source_row_id,owner_id,target_product_id::text,'product',target_product_name,unit_price,pricing_unit,pack_size,true,
         coalesce((original_row->>'created_at')::timestamptz,now()),target_sale_option_id
  from catalog_saneamento_price_plan
  where source_table='price_tier_items' and desired_active
  order by owner_id,target_product_id,target_sale_option_id,source_row_id;

  insert into public.customer_price_overrides(id,customer_id,product_id,product_source,product_name,unit_price,pricing_unit,pack_size,active,created_at,sale_option_id)
  select distinct on (owner_id,target_product_id,target_sale_option_id)
         source_row_id,owner_id,target_product_id::text,'product',target_product_name,unit_price,pricing_unit,pack_size,true,
         coalesce((original_row->>'created_at')::timestamptz,now()),target_sale_option_id
  from catalog_saneamento_price_plan
  where source_table='customer_price_overrides' and desired_active
  order by owner_id,target_product_id,target_sale_option_id,source_row_id;

  -- Os preços de romaneio continuam ligados ao estoque bread até a tela de
  -- romaneio consumir produtos. Alterá-los agora faria o preço desaparecer da
  -- operação; eles não são preços PJ nem foram objeto das 51 decisões.

  -- Pedido fechado é fotografia histórica. Todo pedido ainda aberto, tanto
  -- bread legado quanto product duplicado, passa à identidade mestre para que
  -- produção e expedição não recebam duas referências do mesmo pão.
  if exists (
    select 1
    from public.orders r
    join catalog_saneamento_map m on m.source=r.product_source and m.source_id=r.bread_id
    left join public.product_variants v on v.product_id=m.master_product_id and v.name=m.variant_name
    left join public.product_sale_options o on o.product_id=m.master_product_id
      and o.sale_unit=coalesce(r.pricing_unit,'un')
      and o.product_variant_id is not distinct from v.id
    where r.cancelled_at is null and r.dispatched_at is null and o.id is null
  ) then
    raise exception using errcode='22023', message='Há pedido aberto sem opção de venda compatível. O saneamento foi interrompido sem alterar dados.';
  end if;

  update public.orders r
  set product_source='product',bread_id=m.master_product_id::text,product_name=m.master_name,
      sale_option_id=o.id,product_variant_id=v.id
  from catalog_saneamento_map m
  left join public.product_variants v on v.product_id=m.master_product_id and v.name=m.variant_name
  join public.product_sale_options o on o.product_id=m.master_product_id and o.sale_unit=coalesce(r.pricing_unit,'un')
    and o.product_variant_id is not distinct from v.id
  where r.product_source=m.source and r.bread_id=m.source_id
    and r.cancelled_at is null and r.dispatched_at is null;

  if exists (
    select 1
    from public.product_components c
    join catalog_saneamento_map m on m.source=c.component_source and m.source_id=c.component_id
    left join public.product_variants v on v.product_id=m.master_product_id and v.name=m.variant_name
    group by c.parent_product_id,m.master_product_id,v.id
    having count(*) > 1
  ) then
    raise exception using errcode='22023', message='A consolidação criaria dois componentes iguais numa composição. O saneamento foi interrompido sem alterar dados.';
  end if;

  update public.product_components c
  set component_source='product',component_id=m.master_product_id::text,component_variant_id=v.id
  from catalog_saneamento_map m
  left join public.product_variants v on v.product_id=m.master_product_id and v.name=m.variant_name
  where c.component_source=m.source and c.component_id=m.source_id;

  -- As três composições confirmadas: kit financeiro separado, componente físico.
  if (select count(*) from public.product_components where parent_product_id='e236e196-ce49-4195-98d0-8af5fd6440ab') <> 1
     or (select count(*) from public.product_components where parent_product_id='ee706b0e-49f7-4a36-ae2f-e835d57f831e') <> 1
     or (select count(*) from public.product_components where parent_product_id='8ee9b67b-a506-4cf5-b788-f0e5cc5a6216') <> 1 then
    raise exception using errcode='22023', message='A composição de um kit não confere com o retrato auditado. O saneamento foi interrompido sem alterar dados.';
  end if;

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
