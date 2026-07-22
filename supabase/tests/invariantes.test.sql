-- Invariantes estruturais do banco, verificadas contra o estado FINAL de um
-- banco descartável que aplicou a história completa (CI Banco).
-- Diferente de asserção sobre texto de migration, isto não dá falso verde:
-- se uma migration futura remover uma policy, um grant ou um trigger, o
-- catálogo do Postgres reflete e o teste quebra.

begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

-- Catálogo de permissões do sistema
select is((select count(*)::int from public.app_permissions), 26,
  'catálogo completo com 26 permissões');
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

-- Sobras: conciliação interna pelo forno
select ok(exists(select 1 from pg_trigger where tgname = 'reconcile_bread_leftovers_after_oven'),
  'trigger de conciliação de sobras existe');
select ok(not has_function_privilege('authenticated',
    'public.reconcile_bread_leftovers_after_oven()', 'execute'),
  'conciliação de sobras não é executável por authenticated');

-- Envio de Pedidos PJ
select ok(exists(select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'orders' and column_name = 'dispatched_at'),
  'orders.dispatched_at existe');
select ok((select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_pj_orders_for_dispatch')
    not ilike '%unit_price%',
  'leitura operacional de envio não expõe preços');
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
select ok((select relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'app_permissions'),
  'RLS forçada no catálogo de permissões');

select * from finish();
rollback;
