drop policy if exists "frozen_movements_insert_route_store" on "public"."frozen_movements";
drop policy if exists "frozen_movements_select_route_store" on "public"."frozen_movements";
drop policy if exists "frozen_products_manage_route_store" on "public"."frozen_products";
drop policy if exists "frozen_stock_manage_route_store" on "public"."frozen_stock";

create policy "frozen_movements_insert_route_store"
on "public"."frozen_movements"
for insert
to "authenticated"
with check (
  exists (
    select 1
    from "public"."app_profiles" "p"
    join "public"."frozen_products" "fp"
      on "fp"."id" = "frozen_movements"."frozen_product_id"
    where "p"."user_id" = (select "auth"."uid"() as "uid")
      and "p"."active"
      and coalesce("p"."allowed_routes", '[]'::"jsonb") ?| array['*'::"text", '/estoque-congelado'::"text"]
      and (
        "p"."role" = any (array['admin'::"text", 'financeiro'::"text", 'producao'::"text", 'expedicao'::"text"])
        or (
          lower("p"."store") = lower("frozen_movements"."location")
          and (
            ("fp"."store" is null and "fp"."visible_stores" is null)
            or lower("fp"."store") = lower("p"."store")
            or lower("p"."store") = any (coalesce("fp"."visible_stores", '{}'::"text"[]))
          )
        )
      )
  )
);

create policy "frozen_movements_select_route_store"
on "public"."frozen_movements"
for select
to "authenticated"
using (
  exists (
    select 1
    from "public"."app_profiles" "p"
    join "public"."frozen_products" "fp"
      on "fp"."id" = "frozen_movements"."frozen_product_id"
    where "p"."user_id" = (select "auth"."uid"() as "uid")
      and "p"."active"
      and coalesce("p"."allowed_routes", '[]'::"jsonb") ?| array['*'::"text", '/estoque-congelado'::"text"]
      and (
        "p"."role" = any (array['admin'::"text", 'financeiro'::"text", 'producao'::"text", 'expedicao'::"text"])
        or (
          lower("p"."store") = lower("frozen_movements"."location")
          and (
            ("fp"."store" is null and "fp"."visible_stores" is null)
            or lower("fp"."store") = lower("p"."store")
            or lower("p"."store") = any (coalesce("fp"."visible_stores", '{}'::"text"[]))
          )
        )
      )
  )
);

create policy "frozen_products_manage_route_store"
on "public"."frozen_products"
to "authenticated"
using (
  exists (
    select 1
    from "public"."app_profiles" "p"
    where "p"."user_id" = (select "auth"."uid"() as "uid")
      and "p"."active"
      and coalesce("p"."allowed_routes", '[]'::"jsonb") ?| array['*'::"text", '/estoque-congelado'::"text"]
      and (
        "p"."role" = any (array['admin'::"text", 'financeiro'::"text", 'producao'::"text", 'expedicao'::"text"])
        or ("frozen_products"."store" is null and "frozen_products"."visible_stores" is null)
        or lower("frozen_products"."store") = lower("p"."store")
        or lower("p"."store") = any (coalesce("frozen_products"."visible_stores", '{}'::"text"[]))
      )
  )
)
with check (
  exists (
    select 1
    from "public"."app_profiles" "p"
    where "p"."user_id" = (select "auth"."uid"() as "uid")
      and "p"."active"
      and coalesce("p"."allowed_routes", '[]'::"jsonb") ?| array['*'::"text", '/estoque-congelado'::"text"]
      and (
        "p"."role" = any (array['admin'::"text", 'financeiro'::"text", 'producao'::"text", 'expedicao'::"text"])
        or ("frozen_products"."store" is null and "frozen_products"."visible_stores" is null)
        or lower("frozen_products"."store") = lower("p"."store")
        or lower("p"."store") = any (coalesce("frozen_products"."visible_stores", '{}'::"text"[]))
      )
  )
);

create policy "frozen_stock_manage_route_store"
on "public"."frozen_stock"
to "authenticated"
using (
  exists (
    select 1
    from "public"."app_profiles" "p"
    join "public"."frozen_products" "fp"
      on "fp"."id" = "frozen_stock"."frozen_product_id"
    where "p"."user_id" = (select "auth"."uid"() as "uid")
      and "p"."active"
      and coalesce("p"."allowed_routes", '[]'::"jsonb") ?| array['*'::"text", '/estoque-congelado'::"text"]
      and (
        "p"."role" = any (array['admin'::"text", 'financeiro'::"text", 'producao'::"text", 'expedicao'::"text"])
        or ("fp"."store" is null and "fp"."visible_stores" is null)
        or lower("fp"."store") = lower("p"."store")
        or lower("p"."store") = any (coalesce("fp"."visible_stores", '{}'::"text"[]))
      )
  )
)
with check (
  exists (
    select 1
    from "public"."app_profiles" "p"
    join "public"."frozen_products" "fp"
      on "fp"."id" = "frozen_stock"."frozen_product_id"
    where "p"."user_id" = (select "auth"."uid"() as "uid")
      and "p"."active"
      and coalesce("p"."allowed_routes", '[]'::"jsonb") ?| array['*'::"text", '/estoque-congelado'::"text"]
      and (
        "p"."role" = any (array['admin'::"text", 'financeiro'::"text", 'producao'::"text", 'expedicao'::"text"])
        or ("fp"."store" is null and "fp"."visible_stores" is null)
        or lower("fp"."store") = lower("p"."store")
        or lower("p"."store") = any (coalesce("fp"."visible_stores", '{}'::"text"[]))
      )
  )
);
