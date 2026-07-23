-- Invariantes estruturais do banco, verificadas contra o estado FINAL de um
-- banco descartável que aplicou a história completa (CI Banco).
-- Diferente de asserção sobre texto de migration, isto não dá falso verde:
-- se uma migration futura remover uma policy, um grant ou um trigger, o
-- catálogo do Postgres reflete e o teste quebra.

begin;
create extension if not exists pgtap with schema extensions;

select plan(71);

-- Catálogo de permissões do sistema
select is((select count(*)::int from public.app_permissions), 27,
  'catálogo completo com 27 permissões');
select ok(exists(select 1 from public.app_permissions where key = 'romaneio.confirmar_saida'),
  'ações granulares do romaneio presentes');
select ok(exists(select 1 from public.app_permissions where key = 'pedidos_pj.confirmar_envio'),
  'permissão de envio PJ presente');
select is((select count(distinct module)::int from public.app_permissions), 5,
  'módulos do catálogo');

-- Produção de itens: anon fora, escrita via policies de admin
select ok(not has_table_privilege('anon', 'public.product_production', 'insert'),
  'anon não escreve em product_production');
select ok(has_table_privilege('authenticated', 'public.product_production', 'insert'),
  'authenticated tem grant de tabela (RLS decide o resto)');
select is((select count(*)::int from pg_policies where tablename = 'product_production'), 4,
  'as 4 policies de product_production existem');
select ok(exists(select 1 from pg_policies where tablename = 'product_production'
    and policyname = 'product_production_insert_admins'),
  'escrita de product_production restrita a admins');
select ok((select with_check from pg_policies
    where policyname = 'product_production_insert_admins')
    ilike all(array['%p.active%', '%''admin''%']),
  'a regra de escrita exige perfil ativo e papel admin, não só o nome da policy');

-- Pedidos: escopo de loja para vendas
select is((select count(*)::int from pg_policies where tablename = 'orders'
    and (qual ilike '%store%' or with_check ilike '%store%')), 3,
  'policies de orders com escopo de loja (insert/update/delete)');
select ok(exists(select 1 from pg_policies where tablename = 'orders'
    and qual ilike '%vendas%' and qual ilike '%producao%'),
  'vendas limitado a produção da própria loja');

-- Romaneio: funções transacionais com gate de permissão
select ok(exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'confirm_romaneio_departure'),
  'confirm_romaneio_departure existe');
select ok(exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'confirm_romaneio_receipt'),
  'confirm_romaneio_receipt existe');
select ok((select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'confirm_romaneio_departure')
    ilike '%current_user_has_permission%',
  'saída do romaneio exige permissão granular');
select ok(has_function_privilege('authenticated',
    'public.confirm_romaneio_departure(uuid)', 'execute'),
  'saída do romaneio executável por authenticated');
select ok(not has_function_privilege('anon',
    'public.confirm_romaneio_departure(uuid)', 'execute'),
  'saída do romaneio negada a anon');
select ok(has_function_privilege('authenticated',
    'public.confirm_romaneio_receipt(uuid, jsonb)', 'execute'),
  'recebimento do romaneio executável por authenticated');
select ok(not has_function_privilege('anon',
    'public.confirm_romaneio_receipt(uuid, jsonb)', 'execute'),
  'recebimento do romaneio negado a anon');

-- Sobras: conciliação interna pelo forno
select ok(exists(select 1 from pg_trigger where tgname = 'reconcile_bread_leftovers_after_oven'),
  'trigger de conciliação de sobras existe');
select ok(not has_function_privilege('authenticated',
    'public.reconcile_bread_leftovers_after_oven()', 'execute'),
  'conciliação de sobras não é executável por authenticated');

select ok(not has_function_privilege('authenticated',
    'public.set_app_profiles_updated_at()', 'execute'),
  'gatilho de perfis nao e executavel por authenticated');
select ok(not has_function_privilege('authenticated',
    'public.set_cash_closings_updated_at()', 'execute'),
  'gatilho de caixa nao e executavel por authenticated');

-- Envio de Pedidos PJ
select ok(exists(select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'orders' and column_name = 'dispatched_at'),
  'orders.dispatched_at existe');
select ok((select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_pj_orders_for_dispatch')
    not ilike '%unit_price%',
  'leitura operacional de envio não expõe preços');
select ok((select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_pj_orders_for_dispatch')
    ilike all(array['%expedicao%', '%''jc''%', '%pedidos_pj.acessar%']),
  'listagem de envio limitada à Expedição da JC com permissão');
select ok((select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'confirm_pj_order_dispatch')
    ilike all(array['%pedidos_pj.confirmar_envio%', '%for update%', '%set_config%']),
  'confirmação de envio exige permissão, trava a linha e marca o RPC');
select ok(has_function_privilege('authenticated',
    'public.confirm_pj_order_dispatch(uuid)', 'execute'),
  'confirmação de envio executável por authenticated');
select ok(not has_function_privilege('anon',
    'public.confirm_pj_order_dispatch(uuid)', 'execute'),
  'confirmação de envio negada a anon');
select ok(exists(select 1 from pg_trigger where tgname = 'guard_pj_dispatch_write'),
  'guarda contra confirmação forjada existe');
select ok(exists(select 1 from pg_trigger where tgname = 'guard_dispatched_pj_order_changes'),
  'guarda contra alteração pós-envio existe');

-- Identidade de pedidos: grupo opcional
select ok(exists(select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'orders' and column_name = 'order_group_id' and is_nullable = 'YES'),
  'order_group_id existe e é opcional');

-- Gestão de acesso
select ok(not has_table_privilege('anon', 'public.app_user_permissions', 'select'),
  'anon não lê atribuições de permissão');
select ok((select relrowsecurity and relforcerowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'app_permissions'),
  'RLS habilitada e forçada no catálogo de permissões');
select ok((select relrowsecurity and relforcerowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'app_user_permissions'),
  'RLS habilitada e forçada nas atribuições');
select ok(not has_table_privilege('anon', 'public.app_permissions', 'select'),
  'anon não lê o catálogo');
select ok(has_table_privilege('authenticated', 'public.app_permissions', 'select'),
  'authenticated lê o catálogo');
select ok(not has_table_privilege('authenticated', 'public.app_permissions', 'insert'),
  'authenticated não escreve no catálogo');
select ok(not has_table_privilege('anon', 'public.app_user_permissions', 'insert'),
  'anon não escreve atribuições');
select ok(has_table_privilege('authenticated', 'public.app_user_permissions', 'insert'),
  'authenticated escreve atribuições (policies restringem a admins)');
select ok(has_table_privilege('authenticated', 'public.app_user_permissions', 'select'),
  'authenticated lê atribuições (a tela de gestão depende disso)');
select ok(has_table_privilege('authenticated', 'public.app_user_permissions', 'delete'),
  'authenticated apaga atribuições (a RPC de substituição depende disso)');
select ok(not has_table_privilege('anon', 'public.app_permissions', 'insert'),
  'anon não escreve no catálogo');
select ok((select with_check from pg_policies
    where policyname = 'app_user_permissions_insert_admin')
    ilike all(array['%current_user_is_access_admin%', '%granted_by%']),
  'inserção de atribuição exige admin de acesso e autor real');
select ok((select qual from pg_policies
    where policyname = 'app_user_permissions_delete_admin')
    ilike '%current_user_is_access_admin%',
  'exclusão de atribuição exige admin de acesso');
select ok(exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'replace_user_permissions'
    and not p.prosecdef),
  'replace_user_permissions permanece SECURITY INVOKER');
select ok(has_function_privilege('authenticated',
    'public.replace_user_permissions(uuid, jsonb)', 'execute'),
  'substituição da matriz executável por authenticated');
select ok(not has_function_privilege('anon',
    'public.replace_user_permissions(uuid, jsonb)', 'execute'),
  'substituição da matriz negada a anon');

-- Produção da Cozinha: lotes independentes, autoria e horário do servidor
select ok(exists(select 1 from public.app_permissions where key = 'producao_cozinha.lancar'),
  'permissão de lançar produção da cozinha presente no catálogo');
select ok((select relrowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'kitchen_production'),
  'RLS habilitada em kitchen_production');
select ok(not has_table_privilege('anon', 'public.kitchen_production', 'select'),
  'anon não lê a produção da cozinha');
select ok(not has_table_privilege('anon', 'public.kitchen_production', 'insert'),
  'anon não escreve produção da cozinha');
select ok(has_table_privilege('authenticated', 'public.kitchen_production', 'select'),
  'authenticated pode ler somente as linhas liberadas pela RLS');
select ok(not has_table_privilege('authenticated', 'public.kitchen_production', 'insert'),
  'authenticated não insere diretamente: usa a ação protegida');
select ok(not has_table_privilege('authenticated', 'public.kitchen_production', 'update'),
  'authenticated não corrige diretamente: usa a ação protegida');
select ok(not has_table_privilege('authenticated', 'public.kitchen_production', 'delete'),
  'authenticated não apaga o histórico');
select is((select count(*)::int from pg_policies where tablename = 'kitchen_production'), 1,
  'kitchen_production expõe somente a policy de leitura');
select ok((select qual from pg_policies
    where policyname = 'kitchen_production_select_permitted')
    ilike all(array[
      '%current_user_is_access_admin%',
      '%producao_cozinha.lancar%',
      '%recorded_by%',
      '%record_date%'
    ]),
  'cozinha lê apenas seus lotes de hoje; admin lê o histórico');
select ok(exists(select 1 from pg_constraint
    where conname = 'kitchen_production_quantity_range'),
  'quantidade limitada no banco, não só na tela');
select ok(not exists(select 1 from pg_constraint
    where conname = 'kitchen_production_store_product_date_key'),
  'vários lotes do mesmo produto podem existir no mesmo dia');
select ok((select is_nullable = 'NO' from information_schema.columns
    where table_schema = 'public' and table_name = 'kitchen_production'
      and column_name = 'produced_at'),
  'horário original do lote é obrigatório');
select ok((select is_nullable = 'NO' from information_schema.columns
    where table_schema = 'public' and table_name = 'kitchen_production'
      and column_name = 'recorded_by'),
  'autor original do lote é obrigatório');
select is((select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'kitchen_production'
      and column_name in ('corrected_at', 'corrected_by', 'cancelled_at', 'cancelled_by')), 4,
  'correção e cancelamento deixam trilha de auditoria');
select is((select count(*)::int
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'record_kitchen_batches',
        'correct_kitchen_batch',
        'cancel_kitchen_batch'
      )
      and p.prosecdef), 3,
  'as três ações da cozinha são SECURITY DEFINER');
select is((select count(*)::int
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'record_kitchen_batches',
        'correct_kitchen_batch',
        'cancel_kitchen_batch'
      )
      and has_function_privilege('authenticated', p.oid, 'execute')), 3,
  'authenticated executa as três ações protegidas');
select is((select count(*)::int
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'record_kitchen_batches',
        'correct_kitchen_batch',
        'cancel_kitchen_batch'
      )
      and has_function_privilege('anon', p.oid, 'execute')), 0,
  'anon não executa ações da cozinha');
select is((select count(*)::int
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'record_kitchen_batches',
        'correct_kitchen_batch',
        'cancel_kitchen_batch'
      )
      and coalesce(array_to_string(p.proconfig, ','), '') ilike '%search_path=%'), 3,
  'as ações protegidas usam search_path seguro');

-- Privilegios deterministicos entre producao e bancos reconstruidos
select is((select count(*)::int
    from information_schema.role_table_grants
    where grantee = 'anon'
      and table_schema = 'public'
      and table_name not in (
        'pizza_categorias', 'pizza_despesas', 'pizza_usuarios', 'pizza_vendas'
      )), 0,
  'anon acessa somente as tabelas legadas do ControlePizza');
select is((select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and has_function_privilege('anon', p.oid, 'execute')), 0,
  'anon nao executa funcoes do ERP');

create table public._default_privilege_probe (id bigserial primary key);

select ok(not has_table_privilege('anon', 'public._default_privilege_probe', 'select')
    and not has_table_privilege('authenticated', 'public._default_privilege_probe', 'select')
    and not has_table_privilege('service_role', 'public._default_privilege_probe', 'select'),
  'nova tabela nasce fechada para os papeis da API');
select ok(not has_sequence_privilege('anon', 'public._default_privilege_probe_id_seq', 'usage')
    and not has_sequence_privilege('authenticated', 'public._default_privilege_probe_id_seq', 'usage')
    and not has_sequence_privilege('service_role', 'public._default_privilege_probe_id_seq', 'usage'),
  'nova sequencia nasce fechada para os papeis da API');
select is((select count(*)::int
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) x
    where d.defaclrole = 'postgres'::regrole
      and n.nspname in ('public', 'private')
      and d.defaclobjtype = 'f'
      and (x.grantee = 0 or x.grantee in (
        'anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole
      ))), 0,
  'novas funcoes das migrations nascem fechadas para os papeis da API');

select * from finish();
rollback;
