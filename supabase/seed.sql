-- Dados deliberadamente ficticios para ambientes locais e Preview.
-- Nunca executar com `--include-seed` em producao.
-- Contas com senha sao criadas pelo Supabase Auth na etapa de infraestrutura;
-- este seed apenas liga perfis/permissoes quando os e-mails ja existem.

insert into public.destinations (id, name, code, type, requires_conferencia, active)
values
  ('20000000-0000-4000-8000-000000000001', '[TESTE] Julio de Castilhos', 'jc', 'loja', false, true),
  ('20000000-0000-4000-8000-000000000002', '[TESTE] Jardim America', 'ja', 'loja', false, true),
  ('20000000-0000-4000-8000-000000000003', '[TESTE] Exposicao', 'ex', 'loja', true, true)
on conflict (code) do update set
  name = excluded.name,
  type = excluded.type,
  requires_conferencia = excluded.requires_conferencia,
  active = excluded.active;

insert into public.products (
  id, name, category, active, sort_order, unit, kind,
  is_fabricacao_propria, production_days, production_area
)
values
  ('10000000-0000-4000-8000-000000000001', '[TESTE] Bruschetta Brie', 'Bruschettas', true, 10, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000002', '[TESTE] Bruschetta de Alcachofra', 'Bruschettas', true, 20, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000003', '[TESTE] Bruschetta Gorgonzola', 'Bruschettas', true, 30, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000004', '[TESTE] Bruschetta Parma', 'Bruschettas', true, 40, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000005', '[TESTE] Pastinha de Azeitona', 'Pastas & Pesto', true, 50, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000006', '[TESTE] Pastinha de Frango', 'Pastas & Pesto', true, 60, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000007', '[TESTE] Pastinha de Manjericão', 'Pastas & Pesto', true, 70, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000008', '[TESTE] Pastinha de Tomate-Seco', 'Pastas & Pesto', true, 80, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000009', '[TESTE] Pesto Rosso', 'Pastas & Pesto', true, 90, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000010', '[TESTE] Pesto Verde', 'Pastas & Pesto', true, 100, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000011', '[TESTE] Pizza Redonda de Calabresa', 'Pizza Redonda', true, 110, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000012', '[TESTE] Pizza Redonda de Portuguesa', 'Pizza Redonda', true, 120, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000013', '[TESTE] Pizza Redonda de Queijo e Cebola', 'Pizza Redonda', true, 130, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000014', '[TESTE] Pizza Redonda Margherita', 'Pizza Redonda', true, 140, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000015', '[TESTE] Pizza Romana de Calabresa', 'Pizza Romana', true, 150, 'kg', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000016', '[TESTE] Pizza Romana de Carne e Azeitona', 'Pizza Romana', true, 160, 'kg', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000017', '[TESTE] Pizza Romana de Carne e Cebola Caramelizada', 'Pizza Romana', true, 170, 'kg', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000018', '[TESTE] Pizza Romana de Carne e Coalho', 'Pizza Romana', true, 180, 'kg', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000019', '[TESTE] Pizza Romana de Gorgonzola', 'Pizza Romana', true, 190, 'kg', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000020', '[TESTE] Pizza Romana de Parma', 'Pizza Romana', true, 200, 'kg', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha')
on conflict (id) do update set
  name = excluded.name,
  category = excluded.category,
  active = excluded.active,
  sort_order = excluded.sort_order,
  unit = excluded.unit,
  kind = excluded.kind,
  is_fabricacao_propria = excluded.is_fabricacao_propria,
  production_days = excluded.production_days,
  production_area = excluded.production_area;

insert into public.products (
  id, name, category, active, sort_order, unit, kind,
  is_fabricacao_propria, production_days, production_area
)
values
  ('10000000-0000-4000-8000-000000000021', '[TESTE] Manjericão', 'Insumos', true, 210, 'kg', 'insumo', false, '{0,1,2,3,4,5,6}', 'outros'),
  ('10000000-0000-4000-8000-000000000022', '[TESTE] Tomate cereja', 'Insumos', true, 220, 'kg', 'insumo', false, '{0,1,2,3,4,5,6}', 'outros')
on conflict (id) do update set
  name = excluded.name,
  category = excluded.category,
  active = excluded.active,
  sort_order = excluded.sort_order,
  unit = excluded.unit,
  kind = excluded.kind,
  is_fabricacao_propria = excluded.is_fabricacao_propria,
  production_days = excluded.production_days,
  production_area = excluded.production_area;

insert into public.suppliers (id, name, active)
values ('40000000-0000-4000-8000-000000000001', '[TESTE] Fornecedor CEASA JC', true)
on conflict (id) do update set name = excluded.name, active = excluded.active;

insert into public.breads (id, name, days, active, unit, is_special, is_shelf)
values
  ('teste-baguete', '[TESTE] Baguete', '{0,1,2,3,4,5,6}', true, 'un', false, false),
  ('teste-ciabatta', '[TESTE] Ciabatta', '{0,1,2,3,4,5,6}', true, 'un', false, false)
on conflict (id) do update set
  name = excluded.name,
  days = excluded.days,
  active = excluded.active,
  unit = excluded.unit,
  is_special = excluded.is_special,
  is_shelf = excluded.is_shelf;

insert into public.orders (
  id, store, bread_id, quantity, order_date, obs,
  order_type, product_source, product_name, needs_production
)
values
  ('30000000-0000-4000-8000-000000000001', 'ja', 'teste-baguete', 20, (now() at time zone 'America/Sao_Paulo')::date, '[TESTE] pedido para validar envio completo', 'producao', 'bread', '[TESTE] Baguete', true),
  ('30000000-0000-4000-8000-000000000002', 'ja', 'teste-ciabatta', 12, (now() at time zone 'America/Sao_Paulo')::date, '[TESTE] pedido para validar envio parcial', 'producao', 'bread', '[TESTE] Ciabatta', true),
  ('30000000-0000-4000-8000-000000000003', 'ex', 'teste-baguete', 8, (now() at time zone 'America/Sao_Paulo')::date, '[TESTE] pedido para validar conferencia', 'producao', 'bread', '[TESTE] Baguete', true),
  ('30000000-0000-4000-8000-000000000005', 'jc', 'teste-baguete', 3, (now() at time zone 'America/Sao_Paulo')::date, '[TESTE] pedido novo ao lado de uma composicao somente reaproveitada', 'producao', 'bread', '[TESTE] Baguete', true)
on conflict (id) do update set
  store = excluded.store,
  bread_id = excluded.bread_id,
  quantity = excluded.quantity,
  order_date = excluded.order_date,
  obs = excluded.obs,
  order_type = excluded.order_type,
  product_source = excluded.product_source,
  product_name = excluded.product_name,
  needs_production = excluded.needs_production,
  cancelled_at = null,
  cancelled_by = null,
  cancel_reason = null;

with test_schedule as (
  select (
    (now() at time zone 'America/Sao_Paulo')::date
    + case extract(dow from (now() at time zone 'America/Sao_Paulo')::date)
        when 0 then 1
        when 1 then 1
        when 2 then 1
        when 3 then 1
        when 4 then 2
        when 5 then 1
        when 6 then 2
      end::integer
  ) as production_date
)
insert into public.orders (
  id, store, bread_id, quantity, order_date, obs,
  order_type, product_source, product_name, needs_production
)
select
  '30000000-0000-4000-8000-000000000004',
  'jc',
  'teste-baguete',
  3,
  production_date,
  '[TESTE] pedido total 10 = 5 congelados + 2 sobras + 3 novos',
  'producao',
  'bread',
  '[TESTE] Baguete',
  true
from test_schedule
on conflict (id) do update set
  store = excluded.store,
  bread_id = excluded.bread_id,
  quantity = excluded.quantity,
  order_date = excluded.order_date,
  obs = excluded.obs,
  order_type = excluded.order_type,
  product_source = excluded.product_source,
  product_name = excluded.product_name,
  needs_production = excluded.needs_production,
  cancelled_at = null,
  cancelled_by = null,
  cancel_reason = null;

with test_profiles(email, display_name, role, store, allowed_routes) as (
  values
    ('rodrigao+teste@gmail.com', 'Rodrigo Teste', 'admin', null, '["/", "*"]'::jsonb),
    ('rodrigao+teste-vendas-ja@gmail.com', 'Vendas JA Teste', 'vendas', 'ja', '["/romaneio", "/fechamento-caixa", "/sobras", "/encomendas", "/estoque-congelado"]'::jsonb),
    ('rodrigao+teste-expedicao-jc@gmail.com', 'Expedicao JC Teste', 'expedicao', 'jc', '["/", "/romaneio", "/sobras", "/pedidos-pj"]'::jsonb),
    ('rodrigao+teste-romaneio-ex@gmail.com', 'Romaneio EX Teste', 'expedicao', 'ex', '["/romaneio"]'::jsonb),
    ('rodrigao+teste-cozinha-jc@gmail.com', 'Cozinha JC Teste', 'producao', 'jc', '["/producao-cozinha"]'::jsonb),
    ('rodrigao+teste-geolar-jc@gmail.com', 'Geolar JC Teste', 'producao', 'jc', '["/", "/sobras"]'::jsonb),
    ('rodrigao+teste-financeiro-jc@gmail.com', 'Financeiro JC Teste', 'financeiro', 'jc', '["/", "/contas-pagar", "/fornecedores"]'::jsonb)
)
insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
select user_account.id, profile.display_name, profile.role, profile.store, true, profile.allowed_routes
from test_profiles profile
join auth.users user_account on lower(user_account.email) = profile.email
on conflict (user_id) do update set
  display_name = excluded.display_name,
  role = excluded.role,
  store = excluded.store,
  active = excluded.active,
  allowed_routes = excluded.allowed_routes;

delete from public.app_user_permissions assignment
where assignment.user_id in (
  select user_account.id
  from auth.users user_account
  where lower(user_account.email) in (
    'rodrigao+teste@gmail.com',
    'rodrigao+teste-vendas-ja@gmail.com',
    'rodrigao+teste-expedicao-jc@gmail.com',
    'rodrigao+teste-romaneio-ex@gmail.com',
    'rodrigao+teste-cozinha-jc@gmail.com',
    'rodrigao+teste-geolar-jc@gmail.com',
    'rodrigao+teste-financeiro-jc@gmail.com'
  )
);

with requested_permissions(email, permission_key, scope) as (
  values
    ('rodrigao+teste-vendas-ja@gmail.com', 'caixa.acessar', '*'),
    ('rodrigao+teste-vendas-ja@gmail.com', 'sobras.acessar', '*'),
    ('rodrigao+teste-vendas-ja@gmail.com', 'encomendas.acessar', '*'),
    ('rodrigao+teste-vendas-ja@gmail.com', 'congelado.acessar', '*'),
    ('rodrigao+teste-vendas-ja@gmail.com', 'romaneio.acessar', '*'),
    ('rodrigao+teste-vendas-ja@gmail.com', 'romaneio.visualizar', '*'),
    ('rodrigao+teste-vendas-ja@gmail.com', 'romaneio.confirmar_saida', '*'),
    ('rodrigao+teste-expedicao-jc@gmail.com', 'romaneio.acessar', '*'),
    ('rodrigao+teste-expedicao-jc@gmail.com', 'romaneio.visualizar', '*'),
    ('rodrigao+teste-expedicao-jc@gmail.com', 'romaneio.criar', '*'),
    ('rodrigao+teste-expedicao-jc@gmail.com', 'romaneio.confirmar_saida', '*'),
    ('rodrigao+teste-expedicao-jc@gmail.com', 'sobras.dar_destino', 'jc'),
    ('rodrigao+teste-expedicao-jc@gmail.com', 'pedidos_pj.acessar', 'jc'),
    ('rodrigao+teste-expedicao-jc@gmail.com', 'pedidos_pj.confirmar_envio', 'jc'),
    ('rodrigao+teste-romaneio-ex@gmail.com', 'romaneio.acessar', 'ex'),
    ('rodrigao+teste-romaneio-ex@gmail.com', 'romaneio.visualizar', 'ex'),
    ('rodrigao+teste-romaneio-ex@gmail.com', 'romaneio.conferir_recebimento', 'ex'),
    ('rodrigao+teste-cozinha-jc@gmail.com', 'producao_cozinha.lancar', 'jc'),
    ('rodrigao+teste-financeiro-jc@gmail.com', 'contas_pagar.acessar', 'jc'),
    ('rodrigao+teste-financeiro-jc@gmail.com', 'contas_pagar.lancar', 'jc'),
    ('rodrigao+teste-financeiro-jc@gmail.com', 'contas_pagar.importar_xml', 'jc'),
    ('rodrigao+teste-financeiro-jc@gmail.com', 'contas_pagar.baixar', 'jc'),
    ('rodrigao+teste-financeiro-jc@gmail.com', 'contas_pagar.cancelar', 'jc')
), resolved_permissions as (
  select user_account.id as user_id, requested.permission_key, requested.scope
  from requested_permissions requested
  join auth.users user_account on lower(user_account.email) = requested.email
  join public.app_permissions permission on permission.key = requested.permission_key
), admin_permissions as (
  select user_account.id as user_id, permission.key as permission_key, '*'::text as scope
  from auth.users user_account
  cross join public.app_permissions permission
  where lower(user_account.email) = 'rodrigao+teste@gmail.com'
)
insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
select user_id, permission_key, scope, null::uuid from resolved_permissions
union all
select user_id, permission_key, scope, null::uuid from admin_permissions
on conflict (user_id, permission_key, scope) do nothing;

insert into public.frozen_products (
  id, product_id, product_source, product_name, unit,
  min_stock, active, store, visible_stores
)
values (
  '50000000-0000-4000-8000-000000000001',
  'teste-baguete',
  'bread',
  '[TESTE] Baguete',
  'un',
  0,
  true,
  'jc',
  array['jc']::text[]
)
on conflict (id) do update set
  product_id = excluded.product_id,
  product_source = excluded.product_source,
  product_name = excluded.product_name,
  unit = excluded.unit,
  min_stock = excluded.min_stock,
  active = excluded.active,
  store = excluded.store,
  visible_stores = excluded.visible_stores;

insert into public.frozen_stock (id, frozen_product_id, location, quantity, updated_at)
values (
  '51000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  'jc-freezer',
  5,
  now()
)
on conflict (id) do update set
  frozen_product_id = excluded.frozen_product_id,
  location = excluded.location,
  quantity = excluded.quantity,
  updated_at = excluded.updated_at;

insert into public.frozen_products (
  id, product_id, product_source, product_name, unit,
  min_stock, active, store, visible_stores
)
values (
  '50000000-0000-4000-8000-000000000002',
  'teste-ciabatta',
  'bread',
  '[TESTE] Ciabatta',
  'un',
  0,
  true,
  'jc',
  array['jc']::text[]
)
on conflict (id) do update set
  product_id = excluded.product_id,
  product_source = excluded.product_source,
  product_name = excluded.product_name,
  unit = excluded.unit,
  min_stock = excluded.min_stock,
  active = excluded.active,
  store = excluded.store,
  visible_stores = excluded.visible_stores;

insert into public.frozen_stock (id, frozen_product_id, location, quantity, updated_at)
values (
  '51000000-0000-4000-8000-000000000002',
  '50000000-0000-4000-8000-000000000002',
  'jc-freezer',
  8,
  now()
)
on conflict (id) do update set
  frozen_product_id = excluded.frozen_product_id,
  location = excluded.location,
  quantity = excluded.quantity,
  updated_at = excluded.updated_at;

insert into public.frozen_movements (
  id, frozen_product_id, location, movement_type, quantity,
  previous_quantity, responsible, obs
)
values (
  '52000000-0000-4000-8000-000000000002',
  '50000000-0000-4000-8000-000000000002',
  'jc-freezer',
  'entrada',
  8,
  0,
  'Rodrigo Teste',
  '[TESTE] oito ciabattas congeladas para a composicao do dia'
)
on conflict (id) do update set
  frozen_product_id = excluded.frozen_product_id,
  location = excluded.location,
  movement_type = excluded.movement_type,
  quantity = excluded.quantity,
  previous_quantity = excluded.previous_quantity,
  responsible = excluded.responsible,
  obs = excluded.obs;

insert into public.frozen_movements (
  id, frozen_product_id, location, movement_type, quantity,
  previous_quantity, responsible, obs
)
values (
  '52000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  'jc-freezer',
  'entrada',
  5,
  0,
  'Rodrigo Teste',
  '[TESTE] saldo congelado reservado para o planejamento da Geolar'
)
on conflict (id) do update set
  frozen_product_id = excluded.frozen_product_id,
  location = excluded.location,
  movement_type = excluded.movement_type,
  quantity = excluded.quantity,
  previous_quantity = excluded.previous_quantity,
  responsible = excluded.responsible,
  obs = excluded.obs;

with test_schedule as (
  select (
    (now() at time zone 'America/Sao_Paulo')::date
    + case extract(dow from (now() at time zone 'America/Sao_Paulo')::date)
        when 0 then 1
        when 1 then 1
        when 2 then 1
        when 3 then 1
        when 4 then 2
        when 5 then 1
        when 6 then 2
      end::integer
  ) as production_date
)
insert into public.sobras (
  id, record_date, responsible, product_id, quantity, obs,
  product_source, store, lot_code, pending_quantity, status,
  physical_location, reconciliation_status, updated_at
)
select
  '53000000-0000-4000-8000-000000000001',
  production_date - 1,
  'Geolar JC Teste',
  'teste-baguete',
  2,
  '[TESTE] sobra reservada para reaproveitamento na produção seguinte',
  'bread',
  'jc',
  'L' || to_char(production_date - 1, 'MMDD'),
  2,
  'pending',
  'padaria_cozinha',
  'awaiting_oven',
  now()
from test_schedule
on conflict (id) do update set
  record_date = excluded.record_date,
  responsible = excluded.responsible,
  product_id = excluded.product_id,
  quantity = excluded.quantity,
  obs = excluded.obs,
  product_source = excluded.product_source,
  store = excluded.store,
  lot_code = excluded.lot_code,
  pending_quantity = excluded.pending_quantity,
  status = excluded.status,
  physical_location = excluded.physical_location,
  reconciliation_status = excluded.reconciliation_status,
  updated_at = excluded.updated_at;

insert into public.sobras (
  id, record_date, responsible, product_id, quantity, obs,
  product_source, store, lot_code, pending_quantity, status,
  physical_location, reconciliation_status, updated_at
)
values (
  '53000000-0000-4000-8000-000000000002',
  (now() at time zone 'America/Sao_Paulo')::date - 1,
  'Geolar JC Teste',
  'teste-ciabatta',
  2,
  '[TESTE] duas ciabattas de sobra para a composicao do dia',
  'bread',
  'jc',
  'L' || to_char((now() at time zone 'America/Sao_Paulo')::date - 1, 'MMDD'),
  2,
  'pending',
  'padaria_cozinha',
  'awaiting_oven',
  now()
)
on conflict (id) do update set
  record_date = excluded.record_date,
  responsible = excluded.responsible,
  product_id = excluded.product_id,
  quantity = excluded.quantity,
  obs = excluded.obs,
  product_source = excluded.product_source,
  store = excluded.store,
  lot_code = excluded.lot_code,
  pending_quantity = excluded.pending_quantity,
  status = excluded.status,
  physical_location = excluded.physical_location,
  reconciliation_status = excluded.reconciliation_status,
  updated_at = excluded.updated_at;

with test_schedule as (
  select (
    (now() at time zone 'America/Sao_Paulo')::date
    + case extract(dow from (now() at time zone 'America/Sao_Paulo')::date)
        when 0 then 1
        when 1 then 1
        when 2 then 1
        when 3 then 1
        when 4 then 2
        when 5 then 1
        when 6 then 2
      end::integer
  ) as production_date
), test_admin as (
  select id
  from auth.users
  where lower(email) = 'rodrigao+teste@gmail.com'
)
insert into public.production_plans (
  id, production_date, status, created_by, created_by_name, updated_at
)
select
  '54000000-0000-4000-8000-000000000001',
  production_date,
  'aguardando_geolar',
  test_admin.id,
  'Rodrigo Teste',
  now()
from test_schedule
cross join test_admin
on conflict (production_date) do update set
  status = excluded.status,
  created_by = excluded.created_by,
  created_by_name = excluded.created_by_name,
  updated_at = excluded.updated_at;

insert into public.production_plan_items (
  id, plan_id, store, bread_id, planned_quantity, frozen_quantity,
  leftover_proposed_quantity, leftover_confirmed_quantity, is_extra,
  order_created_at, order_created_by_name, updated_at
)
select
  '55000000-0000-4000-8000-000000000001',
  plan.id,
  'jc',
  'teste-baguete',
  10,
  5,
  2,
  null,
  false,
  now(),
  'Rodrigo Teste',
  now()
from public.production_plans plan
where plan.id = '54000000-0000-4000-8000-000000000001'
on conflict (plan_id, store, bread_id) do update set
  planned_quantity = excluded.planned_quantity,
  frozen_quantity = excluded.frozen_quantity,
  leftover_proposed_quantity = excluded.leftover_proposed_quantity,
  leftover_confirmed_quantity = excluded.leftover_confirmed_quantity,
  is_extra = excluded.is_extra,
  order_created_at = excluded.order_created_at,
  order_created_by_name = excluded.order_created_by_name,
  updated_at = excluded.updated_at;

insert into public.production_plans (
  id, production_date, status, created_by, created_by_name, updated_at
)
values (
  '54000000-0000-4000-8000-000000000002',
  (now() at time zone 'America/Sao_Paulo')::date,
  'aguardando_geolar',
  '94000000-0000-4000-8000-000000000001',
  'Rodrigo Teste',
  now()
)
on conflict (production_date) do update set
  status = excluded.status,
  created_by = excluded.created_by,
  created_by_name = excluded.created_by_name,
  updated_at = excluded.updated_at;

insert into public.production_plan_items (
  id, plan_id, store, bread_id, planned_quantity, frozen_quantity,
  leftover_proposed_quantity, leftover_confirmed_quantity, is_extra,
  order_created_at, order_created_by_name, updated_at
)
select
  '55000000-0000-4000-8000-000000000002',
  plan.id,
  'jc',
  'teste-ciabatta',
  10,
  8,
  2,
  2,
  false,
  null,
  null,
  now()
from public.production_plans plan
where plan.production_date = (now() at time zone 'America/Sao_Paulo')::date
on conflict (plan_id, store, bread_id) do update set
  planned_quantity = excluded.planned_quantity,
  frozen_quantity = excluded.frozen_quantity,
  leftover_proposed_quantity = excluded.leftover_proposed_quantity,
  leftover_confirmed_quantity = excluded.leftover_confirmed_quantity,
  is_extra = excluded.is_extra,
  order_created_at = excluded.order_created_at,
  order_created_by_name = excluded.order_created_by_name,
  updated_at = excluded.updated_at;

with test_schedule as (
  select (
    (now() at time zone 'America/Sao_Paulo')::date
    + case extract(dow from (now() at time zone 'America/Sao_Paulo')::date)
        when 0 then 1
        when 1 then 1
        when 2 then 1
        when 3 then 1
        when 4 then 2
        when 5 then 1
        when 6 then 2
      end::integer
  ) as production_date
), test_admin as (
  select id
  from auth.users
  where lower(email) = 'rodrigao+teste@gmail.com'
)
insert into public.bread_reuse_plans (
  id, target_production_date, store, bread_id, proposed_quantity,
  confirmed_quantity, status, proposed_by, proposed_by_name, updated_at
)
select
  '56000000-0000-4000-8000-000000000001',
  production_date,
  'jc',
  'teste-baguete',
  2,
  null,
  'proposed',
  test_admin.id,
  'Rodrigo Teste',
  now()
from test_schedule
cross join test_admin
on conflict (target_production_date, store, bread_id) do update set
  proposed_quantity = excluded.proposed_quantity,
  confirmed_quantity = excluded.confirmed_quantity,
  status = excluded.status,
  proposed_by = excluded.proposed_by,
  proposed_by_name = excluded.proposed_by_name,
  updated_at = excluded.updated_at;

insert into public.romaneios (
  id, record_date, destination_id, trip_number, status, created_by, obs, sent_by, sent_at
)
values
  (
    '40000000-0000-4000-8000-000000000002',
    (now() at time zone 'America/Sao_Paulo')::date,
    '20000000-0000-4000-8000-000000000003',
    2,
    'com_divergencia',
    'Rodrigo Teste',
    '[TESTE] viagem EX com reposicao pendente',
    'Expedicao JC Teste',
    (now() at time zone 'America/Sao_Paulo') - interval '20 minutes'
  ),
  (
    '40000000-0000-4000-8000-000000000004',
    (now() at time zone 'America/Sao_Paulo')::date,
    '20000000-0000-4000-8000-000000000003',
    4,
    'separado',
    'Rodrigo Teste',
    '[TESTE] viagem EX visivel para a entregadora',
    null,
    null
  ),
  (
    '40000000-0000-4000-8000-000000000005',
    (now() at time zone 'America/Sao_Paulo')::date,
    '20000000-0000-4000-8000-000000000003',
    5,
    'enviado',
    'Rodrigo Teste',
    '[TESTE] viagem EX pendente de conferencia',
    'Expedicao JC Teste',
    (now() at time zone 'America/Sao_Paulo') - interval '10 minutes'
  )
on conflict (id) do update set
  record_date = excluded.record_date,
  destination_id = excluded.destination_id,
  trip_number = excluded.trip_number,
  status = excluded.status,
  created_by = excluded.created_by,
  obs = excluded.obs,
  sent_by = excluded.sent_by,
  sent_at = excluded.sent_at,
  confirmed_by = null,
  confirmed_at = null;

insert into public.romaneio_items (
  id,
  romaneio_id,
  product_id,
  product_source,
  product_name,
  qty_sent,
  qty_received,
  qty_accepted,
  unit_price,
  divergence_reason,
  item_status
)
values
  (
    '41000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000002',
    'teste-baguete',
    'bread',
    '[TESTE] Baguete',
    10,
    8,
    8,
    1,
    '[TESTE] faltou na contagem fisica',
    'divergencia'
  ),
  (
    '41000000-0000-4000-8000-000000000005',
    '40000000-0000-4000-8000-000000000005',
    'teste-baguete',
    'bread',
    '[TESTE] Baguete',
    8,
    null,
    null,
    1,
    null,
    'pendente'
  )
on conflict (id) do update set
  romaneio_id = excluded.romaneio_id,
  product_id = excluded.product_id,
  product_source = excluded.product_source,
  product_name = excluded.product_name,
  qty_sent = excluded.qty_sent,
  qty_received = excluded.qty_received,
  qty_accepted = excluded.qty_accepted,
  unit_price = excluded.unit_price,
  divergence_reason = excluded.divergence_reason,
  item_status = excluded.item_status;

insert into public.romaneio_replacement_pending (
  id,
  destination_id,
  source_romaneio_id,
  source_item_id,
  product_id,
  product_source,
  product_name,
  pending_quantity,
  status,
  created_by
)
values (
  '42000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000003',
  '40000000-0000-4000-8000-000000000002',
  '41000000-0000-4000-8000-000000000002',
  'teste-baguete',
  'bread',
  '[TESTE] Baguete',
  2,
  'aberta',
  'Rodrigo Teste'
)
on conflict (source_item_id) do update set
  pending_quantity = excluded.pending_quantity,
  status = excluded.status,
  updated_at = now();
