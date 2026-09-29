-- Correcao pontual autorizada por Rodrigo (2026-09-29): tira da tabela de precos da
-- Buck a linha inativa do "KIT 4 PAES BRIOCHE HAMBURGUER". O produto em si nao muda.
--
-- Registro do que foi removido, para quem precisar refazer:
--   price_tier_items 40938834-16b2-4e1a-98ee-dc5411478917, tabela BUCK
--   (0800a442-7a7d-4867-8df8-888e7ba74f80), produto 8ee9b67b-a506-4cf5-b788-f0e5cc5a6216,
--   product_source product, pricing_unit un, pack_size 1, unit_price 5.46, active false,
--   sale_option_id nulo, criada em 2026-07-13 17:58 UTC.
-- Confere id, tabela, produto, unidade, pacote, preco e estado antes de apagar; se algo
-- nao bater (ou o dado nao existir, como nos bancos de teste), nao faz nada.

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
