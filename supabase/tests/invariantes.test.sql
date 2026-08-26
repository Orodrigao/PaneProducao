-- Invariantes estruturais do banco, verificadas contra o estado FINAL de um
-- banco descartável que aplicou a história completa (CI Banco).
-- Diferente de asserção sobre texto de migration, isto não dá falso verde:
-- se uma migration futura remover uma policy, um grant ou um trigger, o
-- catálogo do Postgres reflete e o teste quebra.

begin;
create extension if not exists pgtap with schema extensions;

select plan(121);

-- Catálogo de permissões do sistema
select is((select count(*)::int from public.app_permissions), 45,
  'catálogo completo com 45 permissões');
select ok(exists(select 1 from public.app_permissions where key = 'romaneio.confirmar_saida'),
  'ações granulares do romaneio presentes');
select ok(exists(select 1 from public.app_permissions where key = 'pedidos_pj.confirmar_envio'),
  'permissão de envio PJ presente');
select ok(exists(select 1 from public.app_permissions where key = 'sobras.dar_destino'),
  'permissao de destino de sobras presente');
select is((select count(distinct module)::int from public.app_permissions), 6,
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
select ok(exists(select 1 from information_schema.tables where table_schema = 'public'
    and table_name = 'romaneio_replacement_pending'),
  'fila de reposicao do Romaneio existe');
select ok((select relrowsecurity and relforcerowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'romaneio_replacement_pending'),
  'fila de reposicao tem RLS habilitada e forcada');
select ok(not has_table_privilege('anon', 'public.romaneio_replacement_pending', 'select'),
  'anon nao le pendencias de reposicao');
select ok(has_table_privilege('authenticated', 'public.romaneio_replacement_pending', 'select'),
  'authenticated tem grant de leitura da fila de reposicao');
select ok(exists(select 1 from pg_policies where tablename = 'romaneio_replacement_pending'
    and policyname = 'romaneio_replacement_pending_select_permission'
    and qual ilike all(array['%romaneio.visualizar%', '%romaneio.administrar%'])),
  'leitura da fila de reposicao usa permissao granular do Romaneio');
select ok((select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'confirm_romaneio_receipt')
    ilike all(array['%romaneio_replacement_pending%', '%lower(v_destination_code) = ''ex''%', '%qty_sent - item.qty_accepted%']),
  'conferencia EX cria pendencia por enviado menos aceito');
select ok((select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'confirm_romaneio_departure')
    ilike all(array['%source_romaneio.record_date = v_record_date%', '%then ''baixada''%', '%pending_quantity - v_consumed_quantity%']),
  'saida EX baixa somente reposicoes abertas da mesma data');
select ok((select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'confirm_romaneio_receipt')
    ilike all(array['%jsonb_array_length%', '%count(distinct id)%', '%qty_accepted > qty_received%']),
  'recebimento do romaneio bloqueia payload vazio, duplicado e quantidade aceita invalida');

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

-- Planejamento de producao JC/JA
select ok(exists(select 1 from information_schema.tables where table_schema = 'public'
    and table_name = 'production_plans'),
  'planejamento de producao existe');
select ok(exists(select 1 from information_schema.tables where table_schema = 'public'
    and table_name = 'production_plan_items'),
  'itens do planejamento de producao existem');
select ok(exists(select 1 from pg_constraint
    where conname = 'production_plans_one_per_date'),
  'planejamento tem um registro por data de producao');
select ok(exists(select 1 from pg_constraint
    where conname = 'production_plan_items_unique'),
  'planejamento tem um item por loja e pao');
select ok((select relrowsecurity and relforcerowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'production_plans'),
  'production_plans tem RLS habilitada e forcada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'production_plan_items'),
  'production_plan_items tem RLS habilitada e forcada');
select ok(not has_table_privilege('anon', 'public.production_plans', 'select'),
  'anon nao le planejamento');
select ok(not has_table_privilege('anon', 'public.production_plan_items', 'select'),
  'anon nao le itens do planejamento');
select ok(has_table_privilege('authenticated', 'public.production_plans', 'select'),
  'authenticated tem grant de leitura do planejamento; RLS restringe a admin');
select ok(has_table_privilege('authenticated', 'public.production_plan_items', 'select'),
  'authenticated tem grant de leitura dos itens; RLS restringe a admin');
select ok((select qual from pg_policies
    where policyname = 'production_plans_select_admin')
    ilike '%current_user_is_access_admin%',
  'leitura do planejamento exige admin');
select ok((select with_check from pg_policies
    where policyname = 'production_plan_items_insert_admin')
    ilike '%current_user_is_access_admin%',
  'insercao de itens do planejamento exige admin');
select ok((select pg_get_constraintdef(oid)
    from pg_constraint
    where conname = 'production_plan_items_quantities_check')
    not ilike '%frozen_quantity + leftover_proposed_quantity <= planned_quantity%',
  'planejamento nao trata congelado e sobra como desconto do total');
select ok(obj_description('public.production_plan_items'::regclass, 'pg_class')
    ilike all(array['%soma%', '%paes novos%', '%congelados%', '%sobras%']),
  'comentario do planejamento registra total por soma das partes');
select ok(not has_function_privilege('authenticated',
    'public.set_production_planning_updated_at()', 'execute'),
  'gatilho do planejamento nao e executavel por authenticated');

-- Estoque congelado: rota especifica ou permissao geral do admin
select ok((select qual from pg_policies
    where policyname = 'frozen_products_manage_route_store')
    ilike all(array['%/estoque-congelado%', '%*%'])
    and (select with_check from pg_policies
      where policyname = 'frozen_products_manage_route_store')
    ilike all(array['%/estoque-congelado%', '%*%']),
  'cadastro de congelados aceita rota especifica ou permissao geral');
select ok((select qual from pg_policies
    where policyname = 'frozen_stock_manage_route_store')
    ilike all(array['%/estoque-congelado%', '%*%'])
    and (select with_check from pg_policies
      where policyname = 'frozen_stock_manage_route_store')
    ilike all(array['%/estoque-congelado%', '%*%']),
  'saldo de congelados aceita rota especifica ou permissao geral');
select ok((select with_check from pg_policies
    where policyname = 'frozen_movements_insert_route_store')
    ilike all(array['%/estoque-congelado%', '%*%']),
  'entrada de movimento congelado aceita rota especifica ou permissao geral');
select ok((select qual from pg_policies
    where policyname = 'frozen_movements_select_route_store')
    ilike all(array['%/estoque-congelado%', '%*%']),
  'historico de congelados aceita rota especifica ou permissao geral');

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

-- A fila precisa saber se o pedido já virou cobrança, senão prende para sempre
-- o que o banco não deixa mais conferir. Mas ela é "sem valores": pode saber
-- que a cobrança existe, nunca quanto ela vale.
select ok((select pg_get_function_result(p.oid) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_pj_orders_for_dispatch')
    ilike '%ja_virou_cobranca boolean%',
  'fila de envio informa se o pedido já virou cobrança');
select ok((select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_pj_orders_for_dispatch')
    not ilike all(array['%amount%', '%received_amount%']),
  'fila de envio não expõe valor de cobrança');
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
        'pizza_categorias', 'pizza_despesas', 'pizza_usuarios', 'pizza_vendas',
        'site_bread_catalog'
      )), 0,
  'anon acessa somente as tabelas legadas do ControlePizza e a vitrine pública de pães');
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

-- Financeiro (livro-caixa): RLS forçada e nenhuma porta de escrita direta.
-- A gravação é exclusiva das funções protegidas; se algum dia um grant de
-- insert aparecer aqui, o livro deixa de ser confiável.
select ok(exists(select 1 from public.app_permissions where key = 'financeiro.lancar'),
  'permissao de lancamento financeiro presente');
select ok((select relrowsecurity and relforcerowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'finance_entries'),
  'finance_entries tem RLS habilitada e forcada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'finance_categories'),
  'finance_categories tem RLS habilitada e forcada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'finance_accounts'),
  'finance_accounts tem RLS habilitada e forcada');
select ok(not has_table_privilege('anon', 'public.finance_entries', 'select'),
  'anon nao le o livro financeiro');
select ok(not has_table_privilege('authenticated', 'public.finance_entries', 'insert'),
  'ninguem escreve direto no livro financeiro');
select ok(not has_table_privilege('authenticated', 'public.finance_entries', 'update'),
  'ninguem altera lancamento direto');
select ok(not has_table_privilege('authenticated', 'public.finance_entries', 'delete'),
  'ninguem apaga lancamento');
select ok(has_function_privilege('authenticated',
    'public.create_finance_entry(uuid, text, text, text, numeric, date, text, text, date)', 'execute'),
  'financeiro lanca pela funcao protegida');
select ok(not has_function_privilege('anon',
    'public.create_finance_entry(uuid, text, text, text, numeric, date, text, text, date)', 'execute'),
  'anon nao lanca no financeiro');
select ok(not has_function_privilege('anon',
    'public.reverse_finance_entry(uuid, uuid, text)', 'execute'),
  'anon nao estorna lancamento');
select ok(exists(select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'finance_entries_one_reversal_idx'),
  'um estorno por lancamento, mesmo em chamadas simultaneas');

-- Recorrências: previsão virtual com escrita só pela confirmação protegida.
select ok(exists(select 1 from public.app_permissions where key = 'financeiro.recorrencias_gerenciar'),
  'permissao de gerenciar recorrencias presente');
select ok(exists(select 1 from public.app_permissions where key = 'financeiro.recorrencias_confirmar'),
  'permissao de confirmar recorrencias presente');
select ok((select relrowsecurity and relforcerowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'finance_recurring_rules'),
  'regras recorrentes tem RLS habilitada e forcada');
select ok(not has_table_privilege('anon', 'public.finance_recurring_rules', 'select'),
  'anon nao le regras recorrentes');
select ok(not has_table_privilege('authenticated', 'public.finance_recurring_rules', 'insert'),
  'ninguem cria regra recorrente direto na tabela');
select ok(has_function_privilege('authenticated',
    'public.confirm_finance_recurring_rule(uuid, uuid, date, date, numeric, text, text)', 'execute'),
  'pagamento recorrente e confirmado pela funcao protegida');
select ok(not has_function_privilege('anon',
    'public.confirm_finance_recurring_rule(uuid, uuid, date, date, numeric, text, text)', 'execute'),
  'anon nao confirma pagamento recorrente');

-- Unidade do insumo x quantidade usada na ficha tecnica
-- Regra de dominio do Rodrigo (2026-08-22): na padaria tudo e por kg. Cadastro
-- em unidade contavel usado em receita com quantidade fracionaria e rotulo
-- mentindo — e rotulo mentindo cega a trava de conversao da importacao de NF-e,
-- porque private.unidade_familia compara familia com familia. Num banco limpo
-- esta assercao passa por vacuidade; em producao ela prende a correcao.
select is(
  (select count(*)::int
   from public.products produto
   join public.product_components componente
     on componente.component_id = produto.id::text
    and componente.component_source = 'product'
   where produto.kind = 'insumo'
     and lower(coalesce(produto.unit, '')) in ('un', 'und', 'unidade')
   group by produto.id
   having max(componente.quantity) < 1
   limit 1),
  null::int,
  'nenhum insumo de receita com quantidade fracionaria fica em unidade contavel');

select * from finish();
rollback;
