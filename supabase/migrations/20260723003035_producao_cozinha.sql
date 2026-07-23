-- Produção da Cozinha — lotes reais, lançados conforme a demanda.
--
-- Cada salvamento cria novos lotes. O horário, a data e a autoria vêm do
-- servidor; correções e cancelamentos preservam o lançamento original.

-- 1. Permissão granular do módulo.
INSERT INTO "public"."app_permissions" (
  "key", "module", "label", "description", "sort_order"
) VALUES (
  'producao_cozinha.lancar',
  'Operacao',
  'Producao da Cozinha',
  'Lancar a producao da cozinha na loja concedida.',
  100
)
ON CONFLICT ("key") DO UPDATE SET
  "module" = excluded."module",
  "label" = excluded."label",
  "description" = excluded."description",
  "sort_order" = excluded."sort_order"
WHERE (
  "app_permissions"."module",
  "app_permissions"."label",
  "app_permissions"."description",
  "app_permissions"."sort_order"
) IS DISTINCT FROM (
  excluded."module",
  excluded."label",
  excluded."description",
  excluded."sort_order"
);

-- 2. Histórico imutável por lote. Não existe unicidade por produto/dia:
-- produzir 4 e depois 3 precisa gerar duas linhas e totalizar 7.
CREATE TABLE IF NOT EXISTS "public"."kitchen_production" (
  "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
  "store" "text" NOT NULL,
  "product_id" "uuid" NOT NULL,
  "record_date" "date" NOT NULL,
  "quantity" integer NOT NULL,
  "recorded_by" "uuid" NOT NULL,
  "recorded_by_name" "text",
  "produced_at" timestamp with time zone DEFAULT "pg_catalog"."now"() NOT NULL,
  "corrected_at" timestamp with time zone,
  "corrected_by" "uuid",
  "cancelled_at" timestamp with time zone,
  "cancelled_by" "uuid",
  CONSTRAINT "kitchen_production_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "kitchen_production_product_id_fkey" FOREIGN KEY ("product_id")
    REFERENCES "public"."products"("id") ON DELETE RESTRICT,
  CONSTRAINT "kitchen_production_store_valid"
    CHECK ("store" IN ('jc', 'ja', 'ex')),
  CONSTRAINT "kitchen_production_quantity_range"
    CHECK ("quantity" > 0 AND "quantity" <= 999),
  CONSTRAINT "kitchen_production_server_date"
    CHECK (
      "record_date" =
      ("produced_at" AT TIME ZONE 'America/Sao_Paulo')::date
    ),
  CONSTRAINT "kitchen_production_correction_audit"
    CHECK (("corrected_at" IS NULL) = ("corrected_by" IS NULL)),
  CONSTRAINT "kitchen_production_cancellation_audit"
    CHECK (("cancelled_at" IS NULL) = ("cancelled_by" IS NULL))
);

ALTER TABLE "public"."kitchen_production" OWNER TO "postgres";

COMMENT ON TABLE "public"."kitchen_production" IS
  'Lotes produzidos pela cozinha. Cada salvamento cria uma linha com horário e autor do servidor; correções e cancelamentos preservam o evento original.';

CREATE INDEX IF NOT EXISTS "kitchen_production_date_store_idx"
  ON "public"."kitchen_production" USING "btree"
  ("record_date", "store", "produced_at" DESC);

CREATE INDEX IF NOT EXISTS "kitchen_production_product_idx"
  ON "public"."kitchen_production" USING "btree"
  ("product_id", "record_date");

CREATE INDEX IF NOT EXISTS "kitchen_production_author_today_idx"
  ON "public"."kitchen_production" USING "btree"
  ("recorded_by", "record_date", "produced_at" DESC);

-- 3. Grava todos os produtos de um clique na mesma transação. Assim uma falha
-- não deixa metade do salvamento registrada.
CREATE OR REPLACE FUNCTION "public"."record_kitchen_batches"(
  "p_store" "text",
  "p_batches" "jsonb"
) RETURNS "jsonb"
  LANGUAGE "plpgsql" SECURITY DEFINER
  SET "search_path" TO ''
  AS $$
declare
  v_user_id uuid := auth.uid();
  v_profile_name text;
  v_profile_role text;
  v_store text := pg_catalog.lower(pg_catalog.btrim(p_store));
  v_batch jsonb;
  v_product_id uuid;
  v_quantity numeric;
  v_produced_at timestamptz := pg_catalog.now();
  v_count integer := 0;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Entre com e-mail para lancar a producao da cozinha.';
  end if;

  select profile.display_name, profile.role
    into v_profile_name, v_profile_role
  from public.app_profiles as profile
  where profile.user_id = v_user_id
    and profile.active;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Usuario sem perfil ativo.';
  end if;

  if v_store is null or v_store not in ('jc', 'ja', 'ex') then
    raise exception using
      errcode = '22023',
      message = 'Loja invalida.';
  end if;

  if v_profile_role is distinct from 'admin'
    and not private.current_user_has_permission(
      'producao_cozinha.lancar',
      v_store
    )
  then
    raise exception using
      errcode = '42501',
      message = 'Sem permissao para lancar a producao nesta loja.';
  end if;

  if p_batches is null
    or pg_catalog.jsonb_typeof(p_batches) <> 'array'
    or pg_catalog.jsonb_array_length(p_batches) = 0
    or pg_catalog.jsonb_array_length(p_batches) > 100
  then
    raise exception using
      errcode = '22023',
      message = 'Informe de 1 a 100 lotes para salvar.';
  end if;

  for v_batch in
    select value from pg_catalog.jsonb_array_elements(p_batches)
  loop
    if pg_catalog.jsonb_typeof(v_batch) <> 'object'
      or pg_catalog.jsonb_typeof(v_batch -> 'product_id') <> 'string'
      or pg_catalog.jsonb_typeof(v_batch -> 'quantity') <> 'number'
    then
      raise exception using
        errcode = '22023',
        message = 'Lote invalido.';
    end if;

    begin
      v_product_id := (v_batch ->> 'product_id')::uuid;
      v_quantity := (v_batch ->> 'quantity')::numeric;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception using
          errcode = '22023',
          message = 'Produto ou quantidade invalida.';
    end;

    if v_quantity <> pg_catalog.trunc(v_quantity)
      or v_quantity < 1
      or v_quantity > 999
    then
      raise exception using
        errcode = '22023',
        message = 'A quantidade deve ser inteira, entre 1 e 999.';
    end if;

    if not exists (
      select 1
      from public.products as product
      where product.id = v_product_id
        and product.active
        and product.production_area = 'cozinha'
    ) then
      raise exception using
        errcode = '23503',
        message = 'Produto ativo da cozinha nao encontrado.';
    end if;

    insert into public.kitchen_production (
      store,
      product_id,
      record_date,
      quantity,
      recorded_by,
      recorded_by_name,
      produced_at
    ) values (
      v_store,
      v_product_id,
      (v_produced_at at time zone 'America/Sao_Paulo')::date,
      v_quantity::integer,
      v_user_id,
      v_profile_name,
      v_produced_at
    );

    v_count := v_count + 1;
  end loop;

  return pg_catalog.jsonb_build_object(
    'saved_count', v_count,
    'produced_at', v_produced_at
  );
end;
$$;

ALTER FUNCTION "public"."record_kitchen_batches"("text", "jsonb")
  OWNER TO "postgres";

COMMENT ON FUNCTION "public"."record_kitchen_batches"("text", "jsonb") IS
  'Cria lotes da cozinha com horário e autoria do servidor, validando perfil, loja, produto e quantidade.';

-- 4. Correção mantém produced_at e recorded_by originais. Quem lançou pode
-- corrigir o próprio lote no mesmo dia; administrador pode corrigir histórico.
CREATE OR REPLACE FUNCTION "public"."correct_kitchen_batch"(
  "p_batch_id" "uuid",
  "p_quantity" integer
) RETURNS "jsonb"
  LANGUAGE "plpgsql" SECURITY DEFINER
  SET "search_path" TO ''
  AS $$
declare
  v_user_id uuid := auth.uid();
  v_profile_role text;
  v_batch public.kitchen_production%rowtype;
  v_now timestamptz := pg_catalog.now();
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Entre com e-mail para corrigir o lote.';
  end if;

  select profile.role
    into v_profile_role
  from public.app_profiles as profile
  where profile.user_id = v_user_id
    and profile.active;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Usuario sem perfil ativo.';
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > 999 then
    raise exception using
      errcode = '22023',
      message = 'A quantidade deve ser inteira, entre 1 e 999.';
  end if;

  select *
    into v_batch
  from public.kitchen_production
  where id = p_batch_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Lote da cozinha nao encontrado.';
  end if;

  if v_batch.cancelled_at is not null then
    raise exception using
      errcode = '22023',
      message = 'Lote cancelado nao pode ser corrigido.';
  end if;

  if v_profile_role is distinct from 'admin'
    and (
      v_batch.recorded_by <> v_user_id
      or v_batch.record_date <>
        (v_now at time zone 'America/Sao_Paulo')::date
      or not private.current_user_has_permission(
        'producao_cozinha.lancar',
        v_batch.store
      )
    )
  then
    raise exception using
      errcode = '42501',
      message = 'Voce so pode corrigir seus lotes de hoje.';
  end if;

  update public.kitchen_production
  set quantity = p_quantity,
      corrected_at = v_now,
      corrected_by = v_user_id
  where id = v_batch.id;

  return pg_catalog.jsonb_build_object(
    'batch_id', v_batch.id,
    'quantity', p_quantity,
    'corrected_at', v_now
  );
end;
$$;

ALTER FUNCTION "public"."correct_kitchen_batch"("uuid", integer)
  OWNER TO "postgres";

COMMENT ON FUNCTION "public"."correct_kitchen_batch"("uuid", integer) IS
  'Corrige a quantidade e preserva horário e autor originais, registrando quem corrigiu e quando.';

-- 5. Cancelamento é lógico: a linha permanece para auditoria e deixa de entrar
-- nos totais. Repetir o cancelamento é seguro.
CREATE OR REPLACE FUNCTION "public"."cancel_kitchen_batch"(
  "p_batch_id" "uuid"
) RETURNS "jsonb"
  LANGUAGE "plpgsql" SECURITY DEFINER
  SET "search_path" TO ''
  AS $$
declare
  v_user_id uuid := auth.uid();
  v_profile_role text;
  v_batch public.kitchen_production%rowtype;
  v_now timestamptz := pg_catalog.now();
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Entre com e-mail para cancelar o lote.';
  end if;

  select profile.role
    into v_profile_role
  from public.app_profiles as profile
  where profile.user_id = v_user_id
    and profile.active;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Usuario sem perfil ativo.';
  end if;

  select *
    into v_batch
  from public.kitchen_production
  where id = p_batch_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Lote da cozinha nao encontrado.';
  end if;

  if v_profile_role is distinct from 'admin'
    and (
      v_batch.recorded_by <> v_user_id
      or v_batch.record_date <>
        (v_now at time zone 'America/Sao_Paulo')::date
      or not private.current_user_has_permission(
        'producao_cozinha.lancar',
        v_batch.store
      )
    )
  then
    raise exception using
      errcode = '42501',
      message = 'Voce so pode cancelar seus lotes de hoje.';
  end if;

  if v_batch.cancelled_at is null then
    update public.kitchen_production
    set cancelled_at = v_now,
        cancelled_by = v_user_id
    where id = v_batch.id;
  end if;

  return pg_catalog.jsonb_build_object(
    'batch_id', v_batch.id,
    'already_cancelled', v_batch.cancelled_at is not null,
    'cancelled_at', coalesce(v_batch.cancelled_at, v_now)
  );
end;
$$;

ALTER FUNCTION "public"."cancel_kitchen_batch"("uuid")
  OWNER TO "postgres";

COMMENT ON FUNCTION "public"."cancel_kitchen_batch"("uuid") IS
  'Cancela logicamente um lote e preserva a linha para auditoria.';

-- 6. RLS e grants: o navegador só lê o que lhe cabe. Toda escrita passa pelas
-- funções acima, que carimbam e validam o contexto real da sessão.
ALTER TABLE "public"."kitchen_production" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."kitchen_production"
  FROM PUBLIC, "anon", "authenticated";
GRANT SELECT ON TABLE "public"."kitchen_production"
  TO "authenticated";
GRANT ALL ON TABLE "public"."kitchen_production"
  TO "service_role";

DROP POLICY IF EXISTS "kitchen_production_select_permitted"
  ON "public"."kitchen_production";
CREATE POLICY "kitchen_production_select_permitted"
  ON "public"."kitchen_production"
  FOR SELECT TO "authenticated"
  USING (
    (SELECT "private"."current_user_is_access_admin"())
    OR (
      "kitchen_production"."recorded_by" = (SELECT "auth"."uid"())
      AND "kitchen_production"."record_date" =
        (("pg_catalog"."now"() AT TIME ZONE 'America/Sao_Paulo')::date)
      AND (
        SELECT "private"."current_user_has_permission"(
          'producao_cozinha.lancar',
          "kitchen_production"."store"
        )
      )
    )
  );

REVOKE ALL ON FUNCTION "public"."record_kitchen_batches"("text", "jsonb")
  FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."record_kitchen_batches"("text", "jsonb")
  TO "authenticated", "service_role";

REVOKE ALL ON FUNCTION "public"."correct_kitchen_batch"("uuid", integer)
  FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."correct_kitchen_batch"("uuid", integer)
  TO "authenticated", "service_role";

REVOKE ALL ON FUNCTION "public"."cancel_kitchen_batch"("uuid")
  FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."cancel_kitchen_batch"("uuid")
  TO "authenticated", "service_role";

-- 7. Itens do piloto. Ambiente novo de CI não tem produtos, então o UPDATE é
-- naturalmente inofensivo.
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
