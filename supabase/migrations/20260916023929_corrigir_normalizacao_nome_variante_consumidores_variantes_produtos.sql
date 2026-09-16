-- Fase 2 do saneamento do catálogo: corrige a unicidade de nome de variante
-- para tratar acento, caixa e espaço de forma equivalente antes de qualquer
-- população real de variantes.
--
-- O índice único criado na fase 1 (product_variants_product_name_normalized_key)
-- usava lower(btrim(name)), que ainda permite "Hambúrguer" e "Hamburguer" como
-- duas variantes diferentes do mesmo produto. private.normalize_product_category_name
-- já resolve exatamente esse problema para product_categories (decompõe
-- Unicode NFD e apaga marcas de acento antes de comparar); é genérica o
-- suficiente para nome de qualquer entidade do catálogo, então esta migration
-- reaproveita a mesma função em vez de duplicar a lógica de normalização.
begin;

drop index "public"."product_variants_product_name_normalized_key";

create unique index "product_variants_product_name_normalized_key"
  on "public"."product_variants" using btree (
    "product_id",
    "private"."normalize_product_category_name"("name")
  );

comment on index "public"."product_variants_product_name_normalized_key" is
  'Reaproveita private.normalize_product_category_name (mesma normalização de nome de categoria) para que "Hambúrguer", "hamburguer" e "Hamburguer " sejam a mesma variante.';

commit;
