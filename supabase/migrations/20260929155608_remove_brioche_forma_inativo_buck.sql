-- Correcao pontual autorizada por Rodrigo (2026-09-29): tira da tabela de precos da
-- Buck a linha de "Brioche Forma", que ja estava inativa e com preco 0. O cadastro
-- certo e o "Brioche" com as variacoes; o produto Brioche Forma em si nao muda.
--
-- Registro do que foi removido, para quem precisar refazer:
--   price_tier_items 0fde43c9-854c-409a-be4a-a78f3169c74a, tabela BUCK
--   (0800a442-7a7d-4867-8df8-888e7ba74f80), produto adb6ce55-1956-42bc-abdf-4795adc04fad,
--   product_source product, pricing_unit un, pack_size 1, unit_price 0, active false,
--   sale_option_id 8886cb8d-64ae-4d14-a402-90f93e64b299, criada em 2026-09-28 22:11 UTC.
-- Confere id, tabela, produto, unidade, pacote, preco e estado antes de apagar; se algo nao bater (ou o
-- dado nao existir, como nos bancos de teste), nao faz nada.

delete from public.price_tier_items
where id = '0fde43c9-854c-409a-be4a-a78f3169c74a'
  and tier_id = '0800a442-7a7d-4867-8df8-888e7ba74f80'
  and product_id = 'adb6ce55-1956-42bc-abdf-4795adc04fad'
  and product_source = 'product'
  and pricing_unit = 'un'
  and pack_size = 1
  and unit_price = 0
  and active = false;
