-- Fase 2 do saneamento do catálogo: corrige a unicidade de nome de variante
-- para tratar acento, caixa e espaço de forma equivalente antes de qualquer
-- população real de variantes.
--
-- O índice único criado na fase 1 (product_variants_product_name_normalized_key)
-- usava lower(btrim(name)), que ainda permite "Hambúrguer" e "Hamburguer" como
-- duas variantes diferentes do mesmo produto. private.normalize_product_category_name
-- já resolve exatamente esse problema para product_categories (decompõe
-- Unicode NFD e apaga marcas de acento antes de comparar), mas essa função
-- tem EXECUTE revogado de authenticated de propósito (só era chamada por
-- trás de RPC SECURITY DEFINER, nunca diretamente por um perfil comum) — é
-- uma invariante de segurança testada, não um descuido a desfazer.
--
-- Um índice único, ao contrário de uma RPC, avalia sua expressão com o
-- privilégio de quem faz o INSERT/UPDATE de verdade (o perfil autenticado
-- comum), não do dono da tabela nem da função. Conceder EXECUTE direto na
-- função privada para destravar isso (tentativa anterior desta mesma
-- migration, corrigida aqui) quebrava exatamente a invariante que a
-- revogação original protegia. A solução é uma função-ponte, também em
-- private, SECURITY DEFINER: só ela recebe EXECUTE de authenticated: por
-- dentro, chama a função original com o privilégio de quem a criou (o
-- dono), sem exigir EXECUTE do chamador na função original.
begin;

create or replace function "private"."product_variant_name_key"("p_name" "text")
returns "text"
language "sql"
immutable
strict
security definer
set "search_path" = ''
as $$
  select "private"."normalize_product_category_name"("p_name");
$$;

comment on function "private"."product_variant_name_key"("text") is
  'Ponte SECURITY DEFINER só para o índice único de product_variants poder chamar private.normalize_product_category_name sem expor EXECUTE dessa função ao perfil autenticado comum.';

revoke all on function "private"."product_variant_name_key"("text") from "public", "anon", "authenticated";
grant execute on function "private"."product_variant_name_key"("text") to "authenticated";

drop index "public"."product_variants_product_name_normalized_key";

create unique index "product_variants_product_name_normalized_key"
  on "public"."product_variants" using btree (
    "product_id",
    "private"."product_variant_name_key"("name")
  );

comment on index "public"."product_variants_product_name_normalized_key" is
  'Usa private.product_variant_name_key (ponte SECURITY DEFINER para a normalização de nome de categoria) para que "Hambúrguer", "hamburguer" e "Hamburguer " sejam a mesma variante.';

commit;
