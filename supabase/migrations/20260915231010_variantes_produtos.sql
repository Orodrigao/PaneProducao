-- Fundação aditiva de variantes de produtos (fase 1 do saneamento do catálogo).
--
-- Separa quatro conceitos hoje misturados: produto/receita (products), variante
-- física ou modelagem (product_variants, novo), forma de venda dentro da
-- variante (product_sale_options, já existente) e regra de pacote comercial
-- para PJ (product_pj_pack_rules, novo). Kit continua fora desta fase.
--
-- Exemplo guia: Brioche é a receita; Forma, Hamburguer, Mini e Flor são
-- variantes; cada variante vende por un ou kg; o Hamburguer pesa 80 g por
-- unidade e, para PJ, fecha sempre em pacotes de 12 unidades (0,96 kg).
--
-- Estritamente aditiva: nenhuma linha existente é alterada, nenhum produto ou
-- preço real é tocado, e o site antigo continua gravando product_sale_options
-- e product_recipe_yields sem informar variante (product_variant_id nulo).

-- 1. Variante física/modelagem de um produto-receita. Uma variante pertence a
-- exatamente um produto; UNIQUE(id, product_id) existe só para servir de alvo
-- às chaves estrangeiras compostas abaixo, que impedem uma opção de venda ou
-- um rendimento apontar para a variante de outro produto.
CREATE TABLE IF NOT EXISTS "public"."product_variants" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "product_id" uuid NOT NULL,
  "name" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone,
  CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_variants_name_not_blank" CHECK (btrim("name") <> ''),
  CONSTRAINT "product_variants_id_product_id_key" UNIQUE ("id", "product_id"),
  CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id")
    REFERENCES "public"."products"("id") ON DELETE CASCADE
);

ALTER TABLE "public"."product_variants" OWNER TO "postgres";
ALTER TABLE ONLY "public"."product_variants" FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE "public"."product_variants" IS
  'Variante fisica ou modelagem de um produto-receita (ex.: Forma, Hamburguer, Mini, Flor do Brioche). Nao duplica a receita nem substitui product_sale_options ou product_recipe_yields.';
COMMENT ON COLUMN "public"."product_variants"."product_id" IS
  'Receita dona da variante. Uma variante pertence a exatamente um produto.';
COMMENT ON CONSTRAINT "product_variants_id_product_id_key" ON "public"."product_variants" IS
  'Alvo das chaves estrangeiras compostas de product_sale_options, product_recipe_yields e product_pj_pack_rules, que assim recusam variante de outro produto.';

CREATE INDEX IF NOT EXISTS "product_variants_product_id_idx"
  ON "public"."product_variants" USING btree ("product_id");

-- Nome normalizado (minusculo, sem espaco nas pontas) em vez de UNIQUE cru:
-- "Hamburguer", "hamburguer" e "Hamburguer " sao a mesma variante para quem
-- cadastra, e permitir as tres como linhas diferentes seria exatamente a
-- confusao de identidade que esta fundacao existe para eliminar.
CREATE UNIQUE INDEX "product_variants_product_name_normalized_key"
  ON "public"."product_variants" USING btree ("product_id", lower(btrim("name")));

-- 2. Liga a opção de venda existente à variante correta, preservando o
-- comportamento legado. A constraint antiga UNIQUE(product_id, sale_unit)
-- é substituída por dois índices únicos parciais: um reproduz exatamente a
-- regra antiga para as linhas sem variante (product_variant_id nulo, como o
-- site antigo sempre grava), outro passa a valer por variante, permitindo que
-- Forma e Hamburguer do mesmo Brioche tenham cada um seu próprio 'un' e 'kg'.
ALTER TABLE "public"."product_sale_options"
  ADD COLUMN "product_variant_id" uuid;

COMMENT ON COLUMN "public"."product_sale_options"."product_variant_id" IS
  'Variante vendida por esta opcao. Nulo preserva o produto simples legado, sem variante explicita.';

ALTER TABLE "public"."product_sale_options"
  ADD CONSTRAINT "product_sale_options_variant_product_fkey"
  FOREIGN KEY ("product_variant_id", "product_id")
  REFERENCES "public"."product_variants"("id", "product_id");

ALTER TABLE "public"."product_sale_options"
  DROP CONSTRAINT "product_sale_options_product_unit_key";

CREATE UNIQUE INDEX "product_sale_options_legacy_product_unit_key"
  ON "public"."product_sale_options" USING btree ("product_id", "sale_unit")
  WHERE ("product_variant_id" IS NULL);

CREATE UNIQUE INDEX "product_sale_options_variant_unit_key"
  ON "public"."product_sale_options" USING btree ("product_id", "product_variant_id", "sale_unit")
  WHERE ("product_variant_id" IS NOT NULL);

CREATE INDEX IF NOT EXISTS "product_sale_options_variant_id_idx"
  ON "public"."product_sale_options" USING btree ("product_variant_id")
  WHERE ("product_variant_id" IS NOT NULL);

-- A opção padrão também era única só por produto, o que impedia cada
-- variante de ter sua própria opção padrão (ex.: Forma e Hamburguer do
-- Brioche, cada um com seu 'un' padrão). Mesma partição em duas parciais:
-- a legada por produto sem variante, e a nova por produto e variante.
DROP INDEX "public"."product_sale_options_default_key";

CREATE UNIQUE INDEX "product_sale_options_legacy_default_key"
  ON "public"."product_sale_options" USING btree ("product_id")
  WHERE ("is_default" AND "active" AND "product_variant_id" IS NULL);

CREATE UNIQUE INDEX "product_sale_options_variant_default_key"
  ON "public"."product_sale_options" USING btree ("product_id", "product_variant_id")
  WHERE ("is_default" AND "active" AND "product_variant_id" IS NOT NULL);

-- 3. Mesma lógica para o rendimento: a ficha técnica de peso/perda de forno
-- passa a poder variar por variante (Hamburguer pesa diferente da Forma) sem
-- duplicar a receita comum. UNIQUE(product_id) antigo vira dois índices
-- únicos parciais com a mesma reprodução do comportamento legado.
ALTER TABLE "public"."product_recipe_yields"
  ADD COLUMN "product_variant_id" uuid;

COMMENT ON COLUMN "public"."product_recipe_yields"."product_variant_id" IS
  'Variante cujo peso/rendimento este registro descreve. Nulo preserva o rendimento unico legado do produto sem variante.';

ALTER TABLE "public"."product_recipe_yields"
  ADD CONSTRAINT "product_recipe_yields_variant_product_fkey"
  FOREIGN KEY ("product_variant_id", "product_id")
  REFERENCES "public"."product_variants"("id", "product_id");

ALTER TABLE "public"."product_recipe_yields"
  DROP CONSTRAINT "product_recipe_yields_product_id_key";

CREATE UNIQUE INDEX "product_recipe_yields_legacy_product_key"
  ON "public"."product_recipe_yields" USING btree ("product_id")
  WHERE ("product_variant_id" IS NULL);

CREATE UNIQUE INDEX "product_recipe_yields_variant_key"
  ON "public"."product_recipe_yields" USING btree ("product_id", "product_variant_id")
  WHERE ("product_variant_id" IS NOT NULL);

CREATE INDEX IF NOT EXISTS "product_recipe_yields_variant_id_idx"
  ON "public"."product_recipe_yields" USING btree ("product_variant_id")
  WHERE ("product_variant_id" IS NOT NULL);

-- 4. Regra de pacote fechado para pedidos PJ (ex.: Brioche Hamburguer em
-- pacotes de 12 unidades). Fica deliberadamente separada de pack_size,
-- quantidade minima e unidade de cobranca hoje espalhados em outras tabelas:
-- pack_size_units é o tamanho fisico do pacote; min_order_packs é o pedido
-- minimo em pacotes; order_multiple_packs é o multiplo comercial em pacotes.
-- A unidade de cobranca continua em product_sale_options.sale_unit e nao é
-- duplicada aqui, porque a regra vale igual mesmo quando o preco muda de kg
-- para unidade. Nesta fase a tabela só existe como fundação: nenhuma tela ou
-- fluxo de Pedidos PJ passa a lê-la ainda.
CREATE TABLE IF NOT EXISTS "public"."product_pj_pack_rules" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "product_id" uuid NOT NULL,
  "product_variant_id" uuid,
  "pack_size_units" numeric NOT NULL,
  "min_order_packs" numeric DEFAULT 1 NOT NULL,
  "order_multiple_packs" numeric DEFAULT 1 NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone,
  CONSTRAINT "product_pj_pack_rules_pkey" PRIMARY KEY ("id"),
  -- numeric, e não integer, para que a comparação abaixo veja o valor
  -- exatamente como foi enviado: um integer arredondaria 6.5 para 7 no
  -- próprio cast de entrada, antes de qualquer CHECK rodar, e o pacote
  -- fracionado passaria batido em vez de ser recusado.
  CONSTRAINT "product_pj_pack_rules_pack_size_whole_positive" CHECK ("pack_size_units" > 0 AND "pack_size_units" = trunc("pack_size_units")),
  CONSTRAINT "product_pj_pack_rules_min_order_whole_positive" CHECK ("min_order_packs" > 0 AND "min_order_packs" = trunc("min_order_packs")),
  CONSTRAINT "product_pj_pack_rules_multiple_whole_positive" CHECK ("order_multiple_packs" > 0 AND "order_multiple_packs" = trunc("order_multiple_packs")),
  CONSTRAINT "product_pj_pack_rules_product_id_fkey" FOREIGN KEY ("product_id")
    REFERENCES "public"."products"("id") ON DELETE CASCADE,
  CONSTRAINT "product_pj_pack_rules_variant_product_fkey"
    FOREIGN KEY ("product_variant_id", "product_id")
    REFERENCES "public"."product_variants"("id", "product_id")
);

ALTER TABLE "public"."product_pj_pack_rules" OWNER TO "postgres";
ALTER TABLE ONLY "public"."product_pj_pack_rules" FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE "public"."product_pj_pack_rules" IS
  'Regra de pacote fechado para pedidos PJ. Independe da unidade de cobranca (un ou kg) da opcao de venda, que continua em product_sale_options.sale_unit.';
COMMENT ON COLUMN "public"."product_pj_pack_rules"."pack_size_units" IS
  'Quantas unidades fisicas formam um pacote fechado (ex.: 12 unidades do Brioche Hamburguer).';
COMMENT ON COLUMN "public"."product_pj_pack_rules"."min_order_packs" IS
  'Pedido minimo em pacotes, conceito distinto do tamanho do pacote.';
COMMENT ON COLUMN "public"."product_pj_pack_rules"."order_multiple_packs" IS
  'Multiplo comercial em pacotes que o pedido deve respeitar, conceito distinto do pedido minimo.';

CREATE UNIQUE INDEX "product_pj_pack_rules_legacy_product_key"
  ON "public"."product_pj_pack_rules" USING btree ("product_id")
  WHERE ("product_variant_id" IS NULL);

CREATE UNIQUE INDEX "product_pj_pack_rules_variant_key"
  ON "public"."product_pj_pack_rules" USING btree ("product_id", "product_variant_id")
  WHERE ("product_variant_id" IS NOT NULL);

CREATE INDEX IF NOT EXISTS "product_pj_pack_rules_product_id_idx"
  ON "public"."product_pj_pack_rules" USING btree ("product_id");

-- 5. RLS e grants das tabelas novas. Leitura segue o mesmo padrão de
-- product_sale_options/product_recipe_yields (qualquer perfil ativo, porque
-- vários módulos precisam consultar o catálogo). Escrita segue o mesmo padrão
-- de products (admin/financeiro com a rota /produtos liberada), porque
-- variante e pacote fazem parte da identidade estrutural do catálogo. Sem
-- policy de DELETE, como nas tabelas irmãs: correção é sempre por UPDATE.
ALTER TABLE "public"."product_variants" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_variants_select_internal" ON "public"."product_variants"
  FOR SELECT TO "authenticated"
  USING ((EXISTS ( SELECT 1
    FROM "public"."app_profiles" "p"
    WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active"))));

CREATE POLICY "product_variants_insert_catalog_managers" ON "public"."product_variants"
  FOR INSERT TO "authenticated"
  WITH CHECK ((EXISTS ( SELECT 1
    FROM "public"."app_profiles" "p"
    WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active"
      AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"]))
      AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/produtos'::"text")))));

CREATE POLICY "product_variants_update_catalog_managers" ON "public"."product_variants"
  FOR UPDATE TO "authenticated"
  USING ((EXISTS ( SELECT 1
    FROM "public"."app_profiles" "p"
    WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active"
      AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"]))
      AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/produtos'::"text")))))
  WITH CHECK ((EXISTS ( SELECT 1
    FROM "public"."app_profiles" "p"
    WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active"
      AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"]))
      AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/produtos'::"text")))));

REVOKE ALL ON TABLE "public"."product_variants" FROM PUBLIC, "anon", "authenticated";
GRANT SELECT, INSERT, UPDATE ON TABLE "public"."product_variants" TO "authenticated";
GRANT ALL ON TABLE "public"."product_variants" TO "service_role";

ALTER TABLE "public"."product_pj_pack_rules" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_pj_pack_rules_select_internal" ON "public"."product_pj_pack_rules"
  FOR SELECT TO "authenticated"
  USING ((EXISTS ( SELECT 1
    FROM "public"."app_profiles" "p"
    WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active"))));

CREATE POLICY "product_pj_pack_rules_insert_catalog_managers" ON "public"."product_pj_pack_rules"
  FOR INSERT TO "authenticated"
  WITH CHECK ((EXISTS ( SELECT 1
    FROM "public"."app_profiles" "p"
    WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active"
      AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"]))
      AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/produtos'::"text")))));

CREATE POLICY "product_pj_pack_rules_update_catalog_managers" ON "public"."product_pj_pack_rules"
  FOR UPDATE TO "authenticated"
  USING ((EXISTS ( SELECT 1
    FROM "public"."app_profiles" "p"
    WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active"
      AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"]))
      AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/produtos'::"text")))))
  WITH CHECK ((EXISTS ( SELECT 1
    FROM "public"."app_profiles" "p"
    WHERE (("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "p"."active"
      AND ("p"."role" = ANY (ARRAY['admin'::"text", 'financeiro'::"text"]))
      AND (COALESCE("p"."allowed_routes", '[]'::"jsonb") ? '/produtos'::"text")))));

REVOKE ALL ON TABLE "public"."product_pj_pack_rules" FROM PUBLIC, "anon", "authenticated";
GRANT SELECT, INSERT, UPDATE ON TABLE "public"."product_pj_pack_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."product_pj_pack_rules" TO "service_role";
