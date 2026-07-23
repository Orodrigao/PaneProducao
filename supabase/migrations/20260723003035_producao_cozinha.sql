-- Producao da Cozinha — registro diario do que a cozinha realmente produziu.
--
-- Contexto: product_production ja existe, mas e a LISTA PEDIDA pelo admin a
-- Padaria (aba "Itens JC"), escrita somente por admin. Falta o par realizado,
-- equivalente a production_actuals dos paes. Esta migration cria esse registro
-- para os itens de cozinha (bruschettas, pizzas por sabor, pastinhas).
--
-- Quem lanca e definido pela permissao granular producao_cozinha.lancar, com
-- escopo por loja. Nenhuma tabela existente muda de comportamento.

-- 1. Permissao nova no catalogo (idempotente, mesmo padrao do catalogo base).
INSERT INTO "public"."app_permissions" ("key", "module", "label", "description", "sort_order") VALUES
	('producao_cozinha.lancar', 'Operacao', 'Producao da Cozinha', 'Lancar a producao diaria da cozinha na loja concedida.', 100)
ON CONFLICT (key) DO UPDATE SET
  module = excluded.module,
  label = excluded.label,
  description = excluded.description,
  sort_order = excluded.sort_order
WHERE (app_permissions.module, app_permissions.label,
       app_permissions.description, app_permissions.sort_order)
  IS DISTINCT FROM
      (excluded.module, excluded.label,
       excluded.description, excluded.sort_order);

-- 2. Registro diario. Uma linha por (loja, produto, data).
CREATE TABLE IF NOT EXISTS "public"."kitchen_production" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "store" "text" NOT NULL,
  "product_id" "uuid" NOT NULL,
  "record_date" "date" NOT NULL,
  "quantity" numeric NOT NULL,
  "recorded_by" "uuid",
  "recorded_by_name" "text",
  "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
  CONSTRAINT "kitchen_production_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "kitchen_production_store_product_date_key" UNIQUE ("store", "product_id", "record_date"),
  CONSTRAINT "kitchen_production_product_id_fkey" FOREIGN KEY ("product_id")
    REFERENCES "public"."products"("id") ON DELETE RESTRICT,
  CONSTRAINT "kitchen_production_store_valid" CHECK ("store" IN ('jc', 'ja', 'ex')),
  -- Quantidade e contagem de peca/pote: inteira, positiva e com teto de sanidade.
  -- Licao de 2026-07-21 (validar-tambem-na-saida): numero que vira dinheiro
  -- precisa de limite no banco, nao so na tela.
  CONSTRAINT "kitchen_production_quantity_whole" CHECK ("quantity" = "trunc"("quantity")),
  CONSTRAINT "kitchen_production_quantity_range" CHECK ("quantity" > 0 AND "quantity" <= 999)
);

ALTER TABLE "public"."kitchen_production" OWNER TO "postgres";

COMMENT ON TABLE "public"."kitchen_production" IS 'Producao diaria realizada pela cozinha (bruschettas, pizzas, pastinhas). Uma linha por (loja, produto, data). Lancada em /producao-cozinha por quem tem producao_cozinha.lancar na loja. Diferente de product_production, que e a lista pedida a Padaria.';

CREATE INDEX IF NOT EXISTS "kitchen_production_date_store_idx"
  ON "public"."kitchen_production" USING "btree" ("record_date", "store");

CREATE INDEX IF NOT EXISTS "kitchen_production_product_idx"
  ON "public"."kitchen_production" USING "btree" ("product_id");

CREATE OR REPLACE FUNCTION "public"."set_kitchen_production_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

ALTER FUNCTION "public"."set_kitchen_production_updated_at"() OWNER TO "postgres";

DROP TRIGGER IF EXISTS "kitchen_production_set_updated_at" ON "public"."kitchen_production";
CREATE TRIGGER "kitchen_production_set_updated_at"
  BEFORE UPDATE ON "public"."kitchen_production"
  FOR EACH ROW EXECUTE FUNCTION "public"."set_kitchen_production_updated_at"();

-- 3. Janela de correcao: quem lanca pode corrigir hoje e ontem; admin corrige
-- qualquer data. Evita reescrita silenciosa de historico sem travar a operacao
-- de quem so consegue lancar na manha seguinte.
CREATE OR REPLACE FUNCTION "private"."kitchen_production_date_is_open"("p_record_date" "date")
  RETURNS boolean
  LANGUAGE "sql" STABLE
  SET "search_path" TO ''
  AS $$
    select p_record_date
      between ((pg_catalog.now() at time zone 'America/Sao_Paulo')::date - 1)
          and ((pg_catalog.now() at time zone 'America/Sao_Paulo')::date);
  $$;

ALTER FUNCTION "private"."kitchen_production_date_is_open"("date") OWNER TO "postgres";

-- A policy e avaliada com os privilegios de quem consulta: sem EXECUTE explicito
-- o lancamento falharia com "permission denied for function". Mesmo tratamento
-- dado as demais funcoes do schema private.
REVOKE ALL ON FUNCTION "private"."kitchen_production_date_is_open"("date") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."kitchen_production_date_is_open"("date") TO "authenticated";
GRANT ALL ON FUNCTION "private"."kitchen_production_date_is_open"("date") TO "service_role";

-- 4. RLS: a autorizacao efetiva. Nada para anon.
ALTER TABLE "public"."kitchen_production" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."kitchen_production" FROM "anon";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."kitchen_production" TO "authenticated";
GRANT ALL ON TABLE "public"."kitchen_production" TO "service_role";

DROP POLICY IF EXISTS "kitchen_production_select_permitted" ON "public"."kitchen_production";
CREATE POLICY "kitchen_production_select_permitted"
  ON "public"."kitchen_production" FOR SELECT TO "authenticated"
  USING (
    (SELECT "private"."current_user_is_access_admin"())
    OR (SELECT "private"."current_user_has_permission"('producao_cozinha.lancar', "kitchen_production"."store"))
  );

DROP POLICY IF EXISTS "kitchen_production_insert_permitted" ON "public"."kitchen_production";
CREATE POLICY "kitchen_production_insert_permitted"
  ON "public"."kitchen_production" FOR INSERT TO "authenticated"
  WITH CHECK (
    (SELECT "private"."current_user_is_access_admin"())
    OR (
      (SELECT "private"."current_user_has_permission"('producao_cozinha.lancar', "kitchen_production"."store"))
      AND (SELECT "private"."kitchen_production_date_is_open"("kitchen_production"."record_date"))
    )
  );

DROP POLICY IF EXISTS "kitchen_production_update_permitted" ON "public"."kitchen_production";
CREATE POLICY "kitchen_production_update_permitted"
  ON "public"."kitchen_production" FOR UPDATE TO "authenticated"
  USING (
    (SELECT "private"."current_user_is_access_admin"())
    OR (
      (SELECT "private"."current_user_has_permission"('producao_cozinha.lancar', "kitchen_production"."store"))
      AND (SELECT "private"."kitchen_production_date_is_open"("kitchen_production"."record_date"))
    )
  )
  WITH CHECK (
    (SELECT "private"."current_user_is_access_admin"())
    OR (
      (SELECT "private"."current_user_has_permission"('producao_cozinha.lancar', "kitchen_production"."store"))
      AND (SELECT "private"."kitchen_production_date_is_open"("kitchen_production"."record_date"))
    )
  );

DROP POLICY IF EXISTS "kitchen_production_delete_permitted" ON "public"."kitchen_production";
CREATE POLICY "kitchen_production_delete_permitted"
  ON "public"."kitchen_production" FOR DELETE TO "authenticated"
  USING (
    (SELECT "private"."current_user_is_access_admin"())
    OR (
      (SELECT "private"."current_user_has_permission"('producao_cozinha.lancar', "kitchen_production"."store"))
      AND (SELECT "private"."kitchen_production_date_is_open"("kitchen_production"."record_date"))
    )
  );

-- 5. Marca os itens de cozinha do piloto. products.production_area ja existe e
-- hoje so e lido pela tela /produtos; marcar aqui faz a tela nova nascer com a
-- lista certa sem exigir cadastro manual. Nao sobrescreve area ja definida e nao
-- toca em is_fabricacao_propria (que alimenta a auditoria de CMV — fora do
-- escopo). Ambiente novo (CI) nao tem produtos: o UPDATE atinge zero linhas.
UPDATE "public"."products"
   SET "production_area" = 'cozinha'
 WHERE "production_area" IS NULL
   AND "kind" = 'final'
   AND "name" IN (
     'Bruschetta Brie',
     'Bruschetta de Alcachofra',
     'Bruschetta Gorgonzola',
     'Bruschetta Parma',
     'Pastinha de Azeitona',
     'Pastinha de Frango',
     'Pastinha de Manjericão',
     'Pastinha de Tomate-Seco',
     'Pizza Redonda de Calabresa',
     'Pizza Redonda de Portuguesa',
     'Pizza Redonda de Queijo e Cebola',
     'Pizza Redonda Margherita',
     'Pizza Romana de Calabresa',
     'Pizza Romana de Carne e Azeitona',
     'Pizza Romana de Carne e Cebola Caramelizada',
     'Pizza Romana de Carne e Coalho',
     'Pizza Romana de Gorgonzola',
     'Pizza Romana de Parma'
   );
