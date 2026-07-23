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
  ('10000000-0000-4000-8000-000000000015', '[TESTE] Pizza Romana de Calabresa', 'Pizza Romana', true, 150, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000016', '[TESTE] Pizza Romana de Carne e Azeitona', 'Pizza Romana', true, 160, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000017', '[TESTE] Pizza Romana de Carne e Cebola Caramelizada', 'Pizza Romana', true, 170, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000018', '[TESTE] Pizza Romana de Carne e Coalho', 'Pizza Romana', true, 180, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000019', '[TESTE] Pizza Romana de Gorgonzola', 'Pizza Romana', true, 190, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000020', '[TESTE] Pizza Romana de Parma', 'Pizza Romana', true, 200, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha')
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
  ('30000000-0000-4000-8000-000000000001', 'ja', 'teste-baguete', 20, current_date, '[TESTE] pedido para validar envio completo', 'producao', 'bread', '[TESTE] Baguete', true),
  ('30000000-0000-4000-8000-000000000002', 'ja', 'teste-ciabatta', 12, current_date, '[TESTE] pedido para validar envio parcial', 'producao', 'bread', '[TESTE] Ciabatta', true),
  ('30000000-0000-4000-8000-000000000003', 'ex', 'teste-baguete', 8, current_date, '[TESTE] pedido para validar conferencia', 'producao', 'bread', '[TESTE] Baguete', true)
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
    ('rodrigao+teste-vendas-ja@gmail.com', 'Vendas JA Teste', 'vendas', 'ja', '["/"]'::jsonb),
    ('rodrigao+teste-expedicao-jc@gmail.com', 'Expedicao JC Teste', 'expedicao', 'jc', '["/", "/romaneio", "/pedidos-pj"]'::jsonb),
    ('rodrigao+teste-romaneio-ex@gmail.com', 'Romaneio EX Teste', 'expedicao', 'ex', '["/romaneio"]'::jsonb),
    ('rodrigao+teste-cozinha-jc@gmail.com', 'Cozinha JC Teste', 'producao', 'jc', '["/producao-cozinha"]'::jsonb)
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
    'rodrigao+teste-cozinha-jc@gmail.com'
  )
);

with requested_permissions(email, permission_key, scope) as (
  values
    ('rodrigao+teste-expedicao-jc@gmail.com', 'romaneio.acessar', '*'),
    ('rodrigao+teste-expedicao-jc@gmail.com', 'romaneio.visualizar', '*'),
    ('rodrigao+teste-expedicao-jc@gmail.com', 'romaneio.criar', '*'),
    ('rodrigao+teste-expedicao-jc@gmail.com', 'romaneio.confirmar_saida', '*'),
    ('rodrigao+teste-expedicao-jc@gmail.com', 'pedidos_pj.acessar', 'jc'),
    ('rodrigao+teste-expedicao-jc@gmail.com', 'pedidos_pj.confirmar_envio', 'jc'),
    ('rodrigao+teste-romaneio-ex@gmail.com', 'romaneio.acessar', 'ex'),
    ('rodrigao+teste-romaneio-ex@gmail.com', 'romaneio.visualizar', 'ex'),
    ('rodrigao+teste-romaneio-ex@gmail.com', 'romaneio.conferir_recebimento', 'ex'),
    ('rodrigao+teste-cozinha-jc@gmail.com', 'producao_cozinha.lancar', 'jc')
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
