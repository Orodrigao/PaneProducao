-- Verificacao remota executada depois que a API oficial do Auth cria as contas.
-- Falha o workflow se perfis ou permissoes ficticias ficarem incompletos.

do $$
declare
  expected_users constant text[] := array[
    'rodrigao+teste@gmail.com',
    'rodrigao+teste-vendas-ja@gmail.com',
    'rodrigao+teste-expedicao-jc@gmail.com',
    'rodrigao+teste-romaneio-ex@gmail.com',
    'rodrigao+teste-cozinha-jc@gmail.com'
  ];
  user_count integer;
  profile_count integer;
begin
  select count(*) into user_count
  from auth.users
  where lower(email) = any(expected_users);

  if user_count <> 5 then
    raise exception 'Banco Preview deveria ter 5 contas ficticias, encontrou %.', user_count;
  end if;

  select count(*) into profile_count
  from public.app_profiles profile
  join auth.users user_account on user_account.id = profile.user_id
  where lower(user_account.email) = any(expected_users)
    and profile.active;

  if profile_count <> 5 then
    raise exception 'Banco Preview deveria ter 5 perfis ativos, encontrou %.', profile_count;
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
