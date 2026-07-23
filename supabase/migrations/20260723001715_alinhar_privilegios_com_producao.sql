-- O projeto hospedado do Supabase concede acessos amplos por padrão. A
-- baseline foi extraída de produção, onde esses acessos já tinham sido
-- removidos, mas um projeto reconstruído os recriava. Esta migration torna
-- os privilégios determinísticos em qualquer ambiente.

revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
revoke all privileges on all functions in schema public, private from public, anon, authenticated;

-- Funções chamadas diretamente pelo ERP autenticado.
grant execute on function private.current_user_has_permission(text, text) to authenticated;
grant execute on function private.current_user_is_access_admin() to authenticated;
grant execute on function private.pizza_is_allowed() to authenticated;

grant execute on function public.approve_romaneio_divergence(uuid, uuid) to authenticated;
grant execute on function public.confirm_bread_reuse_plan(uuid, integer) to authenticated;
grant execute on function public.confirm_oven_output(date, text, integer, integer, text, text) to authenticated;
grant execute on function public.confirm_pj_order_dispatch(uuid) to authenticated;
grant execute on function public.confirm_romaneio_departure(uuid) to authenticated;
grant execute on function public.confirm_romaneio_receipt(uuid, jsonb) to authenticated;
grant execute on function public.list_pj_orders_for_dispatch() to authenticated;
grant execute on function public.mark_bread_as_shelf(text) to authenticated;
grant execute on function public.register_bread_leftovers(date, text, jsonb, text) to authenticated;
grant execute on function public.replace_user_permissions(uuid, jsonb) to authenticated;
grant execute on function public.resolve_bread_leftover(uuid, text, numeric, text) to authenticated;
grant execute on function public.save_bread_reuse_proposals(date, text, jsonb) to authenticated;
grant execute on function public.update_bread_leftover_location(uuid, text) to authenticated;

-- Dados usados pelo ERP. As policies RLS continuam decidindo quais linhas
-- cada perfil pode ler ou alterar.
grant select on table public.app_permissions to authenticated;
grant select on table public.app_profiles to authenticated;
grant select, insert, delete on table public.app_user_permissions to authenticated;
grant select on table public.bread_leftover_events to authenticated;
grant select, insert, delete on table public.bread_movements to authenticated;
grant select on table public.bread_reuse_plan_allocations to authenticated;
grant select on table public.bread_reuse_plans to authenticated;
grant select, insert, delete, update on table public.breads to authenticated;
grant select, insert, update on table public.cash_closings to authenticated;
grant select, insert, update on table public.customer_price_overrides to authenticated;
grant select, insert, update on table public.customers to authenticated;
grant select, insert, delete, update on table public.descartes to authenticated;
grant select, insert, delete, update on table public.destinations to authenticated;
grant select, insert on table public.frozen_movements to authenticated;
grant select, insert, delete, update on table public.frozen_products to authenticated;
grant select, insert, delete, update on table public.frozen_stock to authenticated;
grant select, insert, delete, update on table public.orders to authenticated;
grant select, insert, update on table public.price_tier_items to authenticated;
grant select, insert, update on table public.price_tiers to authenticated;
grant select, insert, delete, update on table public.product_components to authenticated;
grant select, insert, delete, update on table public.product_prices to authenticated;
grant select, insert, delete, update on table public.product_production to authenticated;
grant select, insert, update on table public.product_recipe_yields to authenticated;
grant select, insert, update on table public.product_sale_options to authenticated;
grant select on table public.production_actual_events to authenticated;
grant select on table public.production_actuals to authenticated;
grant select, insert, delete, update on table public.products to authenticated;
grant select, insert, delete, update on table public.romaneio_items to authenticated;
grant select, insert, delete, update on table public.romaneios to authenticated;
grant select, insert, update on table public.shelf_counts to authenticated;
grant select, insert, delete, update on table public.sobras to authenticated;
grant select, insert, update on table public.stock_balance to authenticated;
grant select, insert on table public.stock_entries to authenticated;
grant select, insert on table public.stock_entry_items to authenticated;
grant select, insert on table public.stock_movements to authenticated;
grant select, insert, delete, update on table public.suppliers to authenticated;

-- ControlePizza ainda usa acesso anônimo por decisão do sistema legado.
grant all privileges on table
  public.pizza_categorias,
  public.pizza_despesas,
  public.pizza_usuarios,
  public.pizza_vendas
to anon, authenticated;

grant all privileges on sequence
  public.pizza_categorias_id_seq,
  public.pizza_despesas_id_seq,
  public.pizza_vendas_id_seq
to anon, authenticated;

-- Novos objetos passam a nascer sem acesso automático. Cada migration deve
-- conceder somente o necessário, inclusive ao service_role.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all privileges on functions from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema private
  revoke all privileges on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema private
  revoke all privileges on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema private
  revoke all privileges on functions from public, anon, authenticated, service_role;
