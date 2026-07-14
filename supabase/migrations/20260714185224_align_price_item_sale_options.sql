alter table public.price_tier_items
  drop constraint if exists price_tier_items_tier_id_product_id_product_source_key;

alter table public.price_tier_items
  add constraint price_tier_items_tier_product_source_option_key
  unique nulls not distinct (tier_id, product_id, product_source, sale_option_id);

alter table public.customer_price_overrides
  drop constraint if exists customer_price_overrides_customer_id_product_id_product_sou_key;

alter table public.customer_price_overrides
  add constraint customer_price_overrides_customer_product_source_option_key
  unique nulls not distinct (customer_id, product_id, product_source, sale_option_id);
