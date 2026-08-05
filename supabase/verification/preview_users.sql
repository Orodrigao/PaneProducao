-- Verificacao remota executada depois que a API oficial do Auth cria as contas.
-- Falha o workflow se perfis ou permissoes ficticias ficarem incompletos.

do $$
declare
  expected_users constant text[] := array[
    'rodrigao+teste@gmail.com',
    'rodrigao+teste-vendas-ja@gmail.com',
    'rodrigao+teste-expedicao-jc@gmail.com',
    'rodrigao+teste-romaneio-ex@gmail.com',
    'rodrigao+teste-cozinha-jc@gmail.com',
    'rodrigao+teste-geolar-jc@gmail.com',
    'rodrigao+teste-financeiro-jc@gmail.com'
  ];
  user_count integer;
  profile_count integer;
  vendas_ja_permission_diff integer;
begin
  select count(*) into user_count
  from auth.users
  where lower(email) = any(expected_users);

  if user_count <> 7 then
    raise exception 'Banco Preview deveria ter 7 contas ficticias, encontrou %.', user_count;
  end if;

  select count(*) into profile_count
  from public.app_profiles profile
  join auth.users user_account on user_account.id = profile.user_id
  where lower(user_account.email) = any(expected_users)
    and profile.active;

  if profile_count <> 7 then
    raise exception 'Banco Preview deveria ter 7 perfis ativos, encontrou %.', profile_count;
  end if;

  if not exists (
    select 1
    from public.app_profiles profile
    join auth.users user_account on user_account.id = profile.user_id
    where lower(user_account.email) = 'rodrigao+teste@gmail.com'
      and profile.allowed_routes ->> 0 = '/'
      and profile.allowed_routes ? '*'
  ) then
    raise exception 'Administrador de teste precisa iniciar em / e manter acesso total.';
  end if;

  if not exists (
    select 1
    from public.app_profiles profile
    join auth.users user_account on user_account.id = profile.user_id
    where lower(user_account.email) = 'rodrigao+teste-vendas-ja@gmail.com'
      and profile.role = 'vendas'
      and lower(profile.store) = 'ja'
      and profile.allowed_routes = '[
        "/romaneio",
        "/fechamento-caixa",
        "/sobras",
        "/encomendas",
        "/estoque-congelado"
      ]'::jsonb
  ) then
    raise exception 'Perfil Vendas JA deve entrar pelo Romaneio e ter somente as cinco rotas aprovadas.';
  end if;

  with expected(permission_key, scope) as (
    values
      ('caixa.acessar', '*'),
      ('sobras.acessar', '*'),
      ('encomendas.acessar', '*'),
      ('congelado.acessar', '*'),
      ('romaneio.acessar', '*'),
      ('romaneio.visualizar', '*'),
      ('romaneio.confirmar_saida', '*')
  ), actual as (
    select assignment.permission_key, assignment.scope
    from public.app_user_permissions assignment
    join auth.users user_account on user_account.id = assignment.user_id
    where lower(user_account.email) = 'rodrigao+teste-vendas-ja@gmail.com'
  ), permission_diff as (
    (select permission_key, scope from expected
     except
     select permission_key, scope from actual)
    union all
    (select permission_key, scope from actual
     except
     select permission_key, scope from expected)
  )
  select count(*) into vendas_ja_permission_diff
  from permission_diff;

  if vendas_ja_permission_diff <> 0 then
    raise exception 'Permissoes do Vendas JA diferem da matriz aprovada.';
  end if;

  if not exists (
    select 1
    from public.app_user_permissions assignment
    join auth.users user_account on user_account.id = assignment.user_id
    where lower(user_account.email) = 'rodrigao+teste-expedicao-jc@gmail.com'
      and assignment.permission_key = 'romaneio.confirmar_saida'
      and assignment.scope = '*'
  ) then
    raise exception 'Perfil Expedicao JC ficou sem permissao para confirmar saida.';
  end if;

  if not exists (
    select 1
    from public.app_profiles profile
    join auth.users user_account on user_account.id = profile.user_id
    where lower(user_account.email) = 'rodrigao+teste-expedicao-jc@gmail.com'
      and profile.allowed_routes ? '/sobras'
  ) then
    raise exception 'Perfil Expedicao JC deve abrir a Central de Pendencias.';
  end if;

  if not exists (
    select 1
    from public.app_user_permissions assignment
    join auth.users user_account on user_account.id = assignment.user_id
    where lower(user_account.email) = 'rodrigao+teste-expedicao-jc@gmail.com'
      and assignment.permission_key = 'sobras.dar_destino'
      and assignment.scope = 'jc'
  ) then
    raise exception 'Perfil Expedicao JC ficou sem permissao para dar destino a sobras da JC.';
  end if;

  if not exists (
    select 1
    from public.app_user_permissions assignment
    join auth.users user_account on user_account.id = assignment.user_id
    where lower(user_account.email) = 'rodrigao+teste-romaneio-ex@gmail.com'
      and assignment.permission_key = 'romaneio.conferir_recebimento'
      and assignment.scope = 'ex'
  ) then
    raise exception 'Perfil Romaneio EX ficou sem permissao para conferir chegada.';
  end if;

  if exists (
    select 1
    from public.app_user_permissions assignment
    join auth.users user_account on user_account.id = assignment.user_id
    where lower(user_account.email) = 'rodrigao+teste-vendas-ja@gmail.com'
      and assignment.permission_key = 'producao_cozinha.lancar'
  ) then
    raise exception 'Perfil Vendas JA recebeu acesso indevido a Producao da Cozinha.';
  end if;

  if not exists (
    select 1
    from public.app_profiles profile
    join auth.users user_account on user_account.id = profile.user_id
    where lower(user_account.email) = 'rodrigao+teste-financeiro-jc@gmail.com'
      and profile.role = 'financeiro'
      and lower(profile.store) = 'jc'
      and profile.allowed_routes ? '/contas-pagar'
  ) then
    raise exception 'Perfil Financeiro JC deve abrir Contas a pagar.';
  end if;

  if not exists (
    select 1
    from public.app_user_permissions assignment
    join auth.users user_account on user_account.id = assignment.user_id
    where lower(user_account.email) = 'rodrigao+teste-financeiro-jc@gmail.com'
      and assignment.permission_key = 'contas_pagar.lancar'
      and assignment.scope = 'jc'
  ) then
    raise exception 'Perfil Financeiro JC ficou sem permissao para lancar contas.';
  end if;

  if not exists (
    select 1
    from public.app_profiles profile
    join auth.users user_account on user_account.id = profile.user_id
    where lower(user_account.email) = 'rodrigao+teste-geolar-jc@gmail.com'
      and profile.role = 'producao'
      and lower(profile.store) = 'jc'
      and profile.allowed_routes = '["/", "/sobras"]'::jsonb
  ) then
    raise exception 'Perfil Geolar JC deve entrar na tela de Producao e abrir a conferencia de sobras.';
  end if;

  if not exists (
    select 1
    from public.orders order_row
    where order_row.id = '30000000-0000-4000-8000-000000000004'
      and order_row.store = 'jc'
      and order_row.bread_id = 'teste-baguete'
      and order_row.quantity = 3
      and order_row.obs = '[TESTE] pedido total 10 = 5 congelados + 2 sobras + 3 novos'
  ) then
    raise exception 'Cenario Geolar deve ter pedido de 3 paes novos para demanda total de 10.';
  end if;

  if not exists (
    select 1
    from public.frozen_stock stock
    join public.frozen_products product on product.id = stock.frozen_product_id
    where product.product_id = 'teste-baguete'
      and product.store = 'jc'
      and stock.location = 'jc-freezer'
      and stock.quantity = 5
  ) then
    raise exception 'Cenario Geolar deve ter 5 paes congelados no freezer JC.';
  end if;

  if not exists (
    select 1
    from public.sobras leftover
    where leftover.id = '53000000-0000-4000-8000-000000000001'
      and leftover.store = 'jc'
      and leftover.product_id = 'teste-baguete'
      and leftover.pending_quantity = 2
      and leftover.status = 'pending'
  ) then
    raise exception 'Cenario Geolar deve ter 2 paes de sobra pendentes na JC.';
  end if;

  if not exists (
    select 1
    from public.production_plans plan
    join public.production_plan_items item on item.plan_id = plan.id
    where plan.id = '54000000-0000-4000-8000-000000000001'
      and plan.status = 'aguardando_geolar'
      and item.store = 'jc'
      and item.bread_id = 'teste-baguete'
      and item.planned_quantity = 10
      and item.frozen_quantity = 5
      and item.leftover_proposed_quantity = 2
  ) then
    raise exception 'Cenario Geolar deve ter planejamento 10 = 5 congelados + 2 sobras + 3 novos.';
  end if;

  if not exists (
    select 1
    from public.bread_reuse_plans reuse_plan
    where reuse_plan.id = '56000000-0000-4000-8000-000000000001'
      and reuse_plan.store = 'jc'
      and reuse_plan.bread_id = 'teste-baguete'
      and reuse_plan.proposed_quantity = 2
      and reuse_plan.status = 'proposed'
  ) then
    raise exception 'Cenario Geolar deve bloquear a lista com reaproveitamento pendente.';
  end if;

  if exists (
    select 1 from public.app_permissions
    where key = 'producao_cozinha.lancar'
  ) and not exists (
    select 1
    from public.app_user_permissions assignment
    join auth.users user_account on user_account.id = assignment.user_id
    where lower(user_account.email) = 'rodrigao+teste-cozinha-jc@gmail.com'
      and assignment.permission_key = 'producao_cozinha.lancar'
      and assignment.scope = 'jc'
  ) then
    raise exception 'Perfil Cozinha JC ficou sem permissao para lancar producao.';
  end if;
end
$$;
