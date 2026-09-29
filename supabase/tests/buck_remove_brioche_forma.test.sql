-- A remocao pontual do Brioche Forma inativo da tabela da Buck apaga so essa linha:
-- nao apaga a linha ativa do mesmo produto, nem o Brioche da Buck, nem outra tabela.
-- O comando "migration" abaixo e copia da migration 20260929155608.

begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into public.price_tiers (id, name, description, active)
values ('0800a442-7a7d-4867-8df8-888e7ba74f80', '[TESTE] Buck 0929', 'Tabela de teste', true)
on conflict (id) do nothing;

insert into public.price_tiers (id, name, description, active)
values ('94000000-0000-4000-8000-000000000101', '[TESTE] Outra tabela 0929', 'Tabela de teste', true);

insert into public.price_tier_items (id, tier_id, product_id, product_source, product_name, unit_price, pricing_unit, pack_size, active)
values
  -- alvo
  ('0fde43c9-854c-409a-be4a-a78f3169c74a', '0800a442-7a7d-4867-8df8-888e7ba74f80', 'adb6ce55-1956-42bc-abdf-4795adc04fad', 'product', 'Brioche Forma', 0, 'un', 1, false),
  -- mesmo tabela, outro produto
  ('94000000-0000-4000-8000-000000000111', '0800a442-7a7d-4867-8df8-888e7ba74f80', '41aecca6-fb3e-4ab9-90fd-ad2884a31cc3', 'product', 'Brioche', 1.37, 'un', 12, true),
  -- mesmo produto, outra tabela
  ('94000000-0000-4000-8000-000000000112', '94000000-0000-4000-8000-000000000101', 'adb6ce55-1956-42bc-abdf-4795adc04fad', 'product', 'Brioche Forma', 0, 'un', 1, false);

-- migration (copia)
delete from public.price_tier_items
where id = '0fde43c9-854c-409a-be4a-a78f3169c74a'
  and tier_id = '0800a442-7a7d-4867-8df8-888e7ba74f80'
  and product_id = 'adb6ce55-1956-42bc-abdf-4795adc04fad'
  and product_source = 'product'
  and pricing_unit = 'un'
  and pack_size = 1
  and unit_price = 0
  and active = false;

select is((select count(*)::integer from public.price_tier_items where id = '0fde43c9-854c-409a-be4a-a78f3169c74a'), 0, 'a linha inativa do Brioche Forma sai da Buck');
select is((select count(*)::integer from public.price_tier_items where id = '94000000-0000-4000-8000-000000000111'), 1, 'o Brioche da Buck continua');
select is((select count(*)::integer from public.price_tier_items where id = '94000000-0000-4000-8000-000000000112'), 1, 'a mesma linha em outra tabela continua');

-- rodar de novo nao faz nada
delete from public.price_tier_items
where id = '0fde43c9-854c-409a-be4a-a78f3169c74a'
  and tier_id = '0800a442-7a7d-4867-8df8-888e7ba74f80'
  and product_id = 'adb6ce55-1956-42bc-abdf-4795adc04fad'
  and product_source = 'product'
  and pricing_unit = 'un'
  and pack_size = 1
  and unit_price = 0
  and active = false;

select is((select count(*)::integer from public.price_tier_items where tier_id = '0800a442-7a7d-4867-8df8-888e7ba74f80'), 1, 'repetir nao apaga mais nada');

-- guarda: linha ativa ou com preco nao e apagada
insert into public.price_tier_items (id, tier_id, product_id, product_source, product_name, unit_price, pricing_unit, pack_size, active)
values ('0fde43c9-854c-409a-be4a-a78f3169c74a', '0800a442-7a7d-4867-8df8-888e7ba74f80', 'adb6ce55-1956-42bc-abdf-4795adc04fad', 'product', 'Brioche Forma', 2, 'un', 1, true);
delete from public.price_tier_items
where id = '0fde43c9-854c-409a-be4a-a78f3169c74a'
  and tier_id = '0800a442-7a7d-4867-8df8-888e7ba74f80'
  and product_id = 'adb6ce55-1956-42bc-abdf-4795adc04fad'
  and product_source = 'product'
  and pricing_unit = 'un'
  and pack_size = 1
  and unit_price = 0
  and active = false;

select is((select count(*)::integer from public.price_tier_items where id = '0fde43c9-854c-409a-be4a-a78f3169c74a'), 1, 'linha ativa e com preco nao e apagada');
select is((select count(*)::integer from public.price_tier_items where tier_id = '0800a442-7a7d-4867-8df8-888e7ba74f80'), 2, 'a tabela fica com as duas linhas');

select * from finish();
rollback;
