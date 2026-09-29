-- A remocao pontual do kit inativo da tabela da Buck apaga so essa linha. O comando
-- "migration" abaixo e copia da migration com o mesmo nome de assunto.

begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into public.price_tiers (id, name, description, active)
values ('0800a442-7a7d-4867-8df8-888e7ba74f80', '[TESTE] Buck kit', 'Tabela de teste', true)
on conflict (id) do nothing;

insert into public.price_tiers (id, name, description, active)
values ('94000000-0000-4000-8000-000000000201', '[TESTE] Outra tabela kit', 'Tabela de teste', true);

insert into public.price_tier_items (id, tier_id, product_id, product_source, product_name, unit_price, pricing_unit, pack_size, active)
values
  ('40938834-16b2-4e1a-98ee-dc5411478917', '0800a442-7a7d-4867-8df8-888e7ba74f80', '8ee9b67b-a506-4cf5-b788-f0e5cc5a6216', 'product', 'KIT 4 PAES BRIOCHE HAMBURGUER', 5.46, 'un', 1, false),
  ('94000000-0000-4000-8000-000000000211', '0800a442-7a7d-4867-8df8-888e7ba74f80', '41aecca6-fb3e-4ab9-90fd-ad2884a31cc3', 'product', 'Brioche', 1.37, 'un', 12, true),
  ('94000000-0000-4000-8000-000000000212', '94000000-0000-4000-8000-000000000201', '8ee9b67b-a506-4cf5-b788-f0e5cc5a6216', 'product', 'KIT 4 PAES BRIOCHE HAMBURGUER', 5.46, 'un', 1, false);

-- migration (copia)
delete from public.price_tier_items
where id = '40938834-16b2-4e1a-98ee-dc5411478917'
  and tier_id = '0800a442-7a7d-4867-8df8-888e7ba74f80'
  and product_id = '8ee9b67b-a506-4cf5-b788-f0e5cc5a6216'
  and product_source = 'product'
  and pricing_unit = 'un'
  and pack_size = 1
  and unit_price = 5.46
  and active = false
  and sale_option_id is null;

select is((select count(*)::integer from public.price_tier_items where id = '40938834-16b2-4e1a-98ee-dc5411478917'), 0, 'a linha inativa do kit sai da Buck');
select is((select count(*)::integer from public.price_tier_items where id = '94000000-0000-4000-8000-000000000211'), 1, 'o Brioche da Buck continua');
select is((select count(*)::integer from public.price_tier_items where id = '94000000-0000-4000-8000-000000000212'), 1, 'a mesma linha em outra tabela continua');

-- rodar de novo nao faz nada
delete from public.price_tier_items
where id = '40938834-16b2-4e1a-98ee-dc5411478917'
  and tier_id = '0800a442-7a7d-4867-8df8-888e7ba74f80'
  and product_id = '8ee9b67b-a506-4cf5-b788-f0e5cc5a6216'
  and product_source = 'product'
  and pricing_unit = 'un'
  and pack_size = 1
  and unit_price = 5.46
  and active = false
  and sale_option_id is null;

select is((select count(*)::integer from public.price_tier_items where tier_id = '0800a442-7a7d-4867-8df8-888e7ba74f80'), 1, 'repetir nao apaga mais nada');

-- guarda: linha ativa ou com outro preco nao e apagada
insert into public.price_tier_items (id, tier_id, product_id, product_source, product_name, unit_price, pricing_unit, pack_size, active)
values ('40938834-16b2-4e1a-98ee-dc5411478917', '0800a442-7a7d-4867-8df8-888e7ba74f80', '8ee9b67b-a506-4cf5-b788-f0e5cc5a6216', 'product', 'KIT 4 PAES BRIOCHE HAMBURGUER', 6, 'un', 1, true);
delete from public.price_tier_items
where id = '40938834-16b2-4e1a-98ee-dc5411478917'
  and tier_id = '0800a442-7a7d-4867-8df8-888e7ba74f80'
  and product_id = '8ee9b67b-a506-4cf5-b788-f0e5cc5a6216'
  and product_source = 'product'
  and pricing_unit = 'un'
  and pack_size = 1
  and unit_price = 5.46
  and active = false
  and sale_option_id is null;

select is((select count(*)::integer from public.price_tier_items where id = '40938834-16b2-4e1a-98ee-dc5411478917'), 1, 'linha ativa e com outro preco nao e apagada');
select is((select count(*)::integer from public.price_tier_items where tier_id = '0800a442-7a7d-4867-8df8-888e7ba74f80'), 2, 'a tabela fica com as duas linhas');

select * from finish();
rollback;
