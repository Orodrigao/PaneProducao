begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select no_plan();

-- Esta prova usa duas conexoes ao Postgres local descartavel do CI Banco.
-- Ela fica fora de supabase/tests porque o mesmo diretorio tambem roda no
-- banco hospedado de preview, onde a credencial local deliberadamente nao vale.
select extensions.dblink_connect(
  'pj_lock_holder',
  format(
    'hostaddr=%s port=%s dbname=%s user=postgres password=postgres',
    inet_server_addr(), current_setting('port'), current_database()
  )
);
select extensions.dblink_connect(
  'pj_lock_worker',
  format(
    'hostaddr=%s port=%s dbname=%s user=postgres password=postgres',
    inet_server_addr(), current_setting('port'), current_database()
  )
);

select extensions.dblink_exec(
  'pj_lock_holder',
  $$delete from public.app_profiles where user_id='9e000000-0000-4000-8000-000000000004'$$
);
select extensions.dblink_exec(
  'pj_lock_holder',
  $$delete from auth.users where id='9e000000-0000-4000-8000-000000000004'$$
);

select extensions.dblink_exec(
  'pj_lock_holder',
  $remote$
    insert into auth.users(
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin
    ) values (
      '9e000000-0000-4000-8000-000000000004',
      '00000000-0000-0000-0000-000000000000',
      'authenticated','authenticated','pj-lock-remoto@example.com','',now(),now(),now(),
      '{"provider":"email","providers":["email"]}','{}',false
    )
  $remote$
);
select extensions.dblink_exec(
  'pj_lock_holder',
  $remote$
    insert into public.app_profiles(user_id, display_name, role, store, active, allowed_routes)
    values (
      '9e000000-0000-4000-8000-000000000004',
      'Programacao PJ remota','admin','jc',true,'["/pedidos-pj"]'
    )
  $remote$
);

create function pg_temp.wait_for_advisory(p_pid integer) returns boolean
language plpgsql as $$
declare v_deadline timestamptz := clock_timestamp() + interval '5 seconds';
begin
  loop
    if exists (
      select 1
      from pg_catalog.pg_stat_activity
      where pid = p_pid
        and wait_event_type = 'Lock'
        and wait_event = 'advisory'
    ) then
      return true;
    end if;
    if clock_timestamp() >= v_deadline then
      return false;
    end if;
    perform pg_sleep(0.05);
  end loop;
end;
$$;

create temporary table worker_backend as
select pid
from extensions.dblink(
  'pj_lock_worker', 'select pg_backend_pid()'
) as response(pid integer);

select extensions.dblink_exec('pj_lock_holder', 'begin');
select extensions.dblink_exec(
  'pj_lock_holder',
  $remote$
    do $block$
    begin
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('pane-pj-production-schedule', 0)
      );
    end
    $block$
  $remote$
);
select extensions.dblink_exec('pj_lock_worker', 'begin');
select extensions.dblink_exec('pj_lock_worker', 'set local role authenticated');
select extensions.dblink_exec(
  'pj_lock_worker',
  $$set local "request.jwt.claim.sub" = '9e000000-0000-4000-8000-000000000004'$$
);
select extensions.dblink_send_query(
  'pj_lock_worker',
  $$select public.schedule_pj_production(null, '[]'::jsonb, '9e000000-0000-4000-8000-000000000401')$$
);
select ok(
  pg_temp.wait_for_advisory((select pid from worker_backend)),
  'segunda sessao espera especificamente na porta global da producao'
);

select extensions.dblink_exec('pj_lock_holder', 'commit');
create temporary table remote_schedule_result as
select result
from extensions.dblink_get_result('pj_lock_worker', false) as response(result jsonb);
select ok(
  extensions.dblink_error_message('pj_lock_worker')
    ilike '%A programacao PJ deve ser feita para hoje.%',
  'segunda sessao prossegue depois da liberacao sem deadlock'
);
create temporary table remote_schedule_result_end as
select result
from extensions.dblink_get_result('pj_lock_worker', false) as response(result jsonb);
select extensions.dblink_exec('pj_lock_worker', 'rollback');

select extensions.dblink_exec(
  'pj_lock_holder',
  $$delete from public.app_profiles where user_id='9e000000-0000-4000-8000-000000000004'$$
);
select extensions.dblink_exec(
  'pj_lock_holder',
  $$delete from auth.users where id='9e000000-0000-4000-8000-000000000004'$$
);
select extensions.dblink_disconnect('pj_lock_worker');
select extensions.dblink_disconnect('pj_lock_holder');

-- Uma chamada de inscricao pode ter passado pelo GRANT antigo e estar na fila
-- quando a migration toma a vaga. A barreira da tabela precisa recusa-la
-- depois do corte, mesmo que ela continue executando o corpo antigo da RPC.
select extensions.dblink_connect(
  'pj_cutover_holder',
  format(
    'hostaddr=%s port=%s dbname=%s user=postgres password=postgres',
    inet_server_addr(), current_setting('port'), current_database()
  )
);
select extensions.dblink_connect(
  'pj_cutover_migration',
  format(
    'hostaddr=%s port=%s dbname=%s user=postgres password=postgres',
    inet_server_addr(), current_setting('port'), current_database()
  )
);
select extensions.dblink_connect(
  'pj_cutover_worker',
  format(
    'hostaddr=%s port=%s dbname=%s user=postgres password=postgres',
    inet_server_addr(), current_setting('port'), current_database()
  )
);

select extensions.dblink_exec(
  'pj_cutover_holder',
  $remote$
    update private.pj_flow_rollout_settings
    set state='preparing', cutover_at=null, updated_at=clock_timestamp()
    where singleton;
    drop trigger if exists guard_pj_controlled_enrollment_after_cutover
      on private.pj_flow;
    grant execute on function public.enroll_pj_flow(uuid,uuid) to authenticated;
    delete from private.pj_flow_activation_events
    where order_group_id='9d000000-0000-4000-8000-000000000201';
    delete from private.pj_flow
    where order_group_id='9d000000-0000-4000-8000-000000000201';
    delete from public.orders
    where order_group_id='9d000000-0000-4000-8000-000000000201';
    delete from public.app_user_permissions
    where user_id='9d000000-0000-4000-8000-000000000001';
    delete from public.app_profiles
    where user_id='9d000000-0000-4000-8000-000000000001';
    delete from auth.users
    where id='9d000000-0000-4000-8000-000000000001';
    delete from public.customers
    where id='9d000000-0000-4000-8000-000000000010';
    delete from public.breads where id='teste-corte-pj';

    insert into auth.users(
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin
    ) values (
      '9d000000-0000-4000-8000-000000000001',
      '00000000-0000-0000-0000-000000000000',
      'authenticated','authenticated','pj-cutover-worker@example.com','',now(),now(),now(),
      '{"provider":"email","providers":["email"]}','{}',false
    );
    insert into public.app_profiles(user_id,display_name,role,store,active,allowed_routes)
    values ('9d000000-0000-4000-8000-000000000001','Corte PJ concorrente',
      'financeiro','jc',true,'["/pedidos-pj"]');
    insert into public.app_user_permissions(user_id,permission_key,scope)
    select '9d000000-0000-4000-8000-000000000001', key, 'jc'
    from unnest(array['pedidos_pj.acessar','pedidos_pj.liberar',
      'contas_receber.acessar','contas_receber.lancar']) key;
    insert into public.customers(id,name,doc,payment_term_days,active)
    values ('9d000000-0000-4000-8000-000000000010',
      '[TESTE] Cliente Corte PJ','00000000000091',7,true);
    insert into public.breads(id,name,days,active,unit,is_special,is_shelf)
    values ('teste-corte-pj','[TESTE] Pao Corte PJ','{0,1,2,3,4,5,6}',true,'un',false,false);
    insert into public.orders(
      id,store,order_type,order_group_id,bread_id,product_source,product_name,
      quantity,unit_price,pack_size,pricing_unit,customer_id,pj_client,
      order_date,delivery_date,pj_delivery_date,needs_production
    ) values (
      '9d000000-0000-4000-8000-000000000101','pj','pj',
      '9d000000-0000-4000-8000-000000000201','teste-corte-pj','bread',
      '[TESTE] Pao Corte PJ',10,5,1,'un',
      '9d000000-0000-4000-8000-000000000010','[TESTE] Cliente Corte PJ',
      private.data_na_padaria(),private.data_na_padaria()+2,
      private.data_na_padaria()+2,false
    )
  $remote$
);

create temporary table cutover_backends as
select 'migration'::text as connection, pid
from extensions.dblink('pj_cutover_migration','select pg_backend_pid()')
  as response(pid integer)
union all
select 'worker'::text, pid
from extensions.dblink('pj_cutover_worker','select pg_backend_pid()')
  as response(pid integer);

select extensions.dblink_exec('pj_cutover_holder', 'begin');
select extensions.dblink_exec(
  'pj_cutover_holder',
  $remote$
    do $block$
    begin
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('pane-pj-controlled-real-slot',0)
      );
    end
    $block$
  $remote$
);

select extensions.dblink_exec('pj_cutover_migration', 'begin');
select extensions.dblink_exec(
  'pj_cutover_migration',
  $remote$
    do $block$
    begin
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('pane-pj-standard-cutover',0)
      );
    end
    $block$
  $remote$
);
select extensions.dblink_exec(
  'pj_cutover_migration',
  $remote$
    create function pg_temp.finish_cutover() returns text
    language plpgsql as $body$
    begin
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('pane-pj-controlled-real-slot',0)
      );
      execute 'create trigger guard_pj_controlled_enrollment_after_cutover
        before insert or update of activation_mode on private.pj_flow
        for each row execute function private.guard_pj_controlled_enrollment_after_cutover()';
      update private.pj_flow_rollout_settings
      set state='standard',cutover_at=clock_timestamp(),updated_at=clock_timestamp()
      where singleton;
      return private.pj_flow_rollout_state();
    end
    $body$
  $remote$
);
select extensions.dblink_send_query(
  'pj_cutover_migration',
  'select pg_temp.finish_cutover()'
);
select ok(
  pg_temp.wait_for_advisory((select pid from cutover_backends where connection='migration')),
  'migration espera na vaga controlada antes de concluir o corte'
);

select extensions.dblink_exec('pj_cutover_worker', 'begin');
select extensions.dblink_exec('pj_cutover_worker', 'set local role authenticated');
select extensions.dblink_exec(
  'pj_cutover_worker',
  $$set local "request.jwt.claim.sub" = '9d000000-0000-4000-8000-000000000001'$$
);
select extensions.dblink_send_query(
  'pj_cutover_worker',
  $$select public.enroll_pj_flow(
    '9d000000-0000-4000-8000-000000000301',
    '9d000000-0000-4000-8000-000000000201'
  )$$
);
select ok(
  pg_temp.wait_for_advisory((select pid from cutover_backends where connection='worker')),
  'inscricao ja autorizada fica enfileirada atras da migration'
);

select extensions.dblink_exec('pj_cutover_holder', 'commit');
create temporary table cutover_migration_result as
select state
from extensions.dblink_get_result('pj_cutover_migration', false)
  as response(state text);
select is((select state from cutover_migration_result),'standard',
  'migration concorrente conclui a virada antes da inscricao antiga');
create temporary table cutover_migration_result_end as
select state
from extensions.dblink_get_result('pj_cutover_migration', false)
  as response(state text);
select extensions.dblink_exec(
  'pj_cutover_migration',
  'revoke all on function public.enroll_pj_flow(uuid,uuid) from public, anon, authenticated, service_role'
);
select extensions.dblink_exec('pj_cutover_migration', 'commit');
select is((select count(*)::int from pg_catalog.pg_trigger
  where tgrelid='private.pj_flow'::regclass
    and tgname='guard_pj_controlled_enrollment_after_cutover'
    and not tgisinternal),1,
  'barreira criada na mesma transacao fica visivel quando a chamada antiga acorda');

create temporary table cutover_worker_result as
select result
from extensions.dblink_get_result('pj_cutover_worker', false)
  as response(result jsonb);
select ok(
  extensions.dblink_error_message('pj_cutover_worker')
    ilike '%A inscricao manual do piloto foi encerrada pela virada padrao.%',
  'chamada antiga acorda depois do corte e a barreira da tabela a recusa'
);
create temporary table cutover_worker_result_end as
select result
from extensions.dblink_get_result('pj_cutover_worker', false)
  as response(result jsonb);
select extensions.dblink_exec('pj_cutover_worker', 'rollback');

select is((select count(*)::int from private.pj_flow
  where order_group_id='9d000000-0000-4000-8000-000000000201'),0,
  'corrida nao inscreve o pedido historico depois do corte');
select is((select count(*)::int from private.pj_flow_activation_events
  where order_group_id='9d000000-0000-4000-8000-000000000201'),0,
  'corrida nao grava evento falso de ativacao');

select extensions.dblink_exec(
  'pj_cutover_holder',
  $remote$
    update private.pj_flow_rollout_settings
    set state='preparing',cutover_at=null,updated_at=clock_timestamp()
    where singleton;
    delete from private.pj_flow_activation_events
    where order_group_id='9d000000-0000-4000-8000-000000000201';
    delete from private.pj_flow
    where order_group_id='9d000000-0000-4000-8000-000000000201';
    delete from public.orders
    where order_group_id='9d000000-0000-4000-8000-000000000201';
    delete from public.app_user_permissions
    where user_id='9d000000-0000-4000-8000-000000000001';
    delete from public.app_profiles
    where user_id='9d000000-0000-4000-8000-000000000001';
    delete from auth.users
    where id='9d000000-0000-4000-8000-000000000001';
    delete from public.customers
    where id='9d000000-0000-4000-8000-000000000010';
    delete from public.breads where id='teste-corte-pj';
    update private.pj_flow_rollout_settings
    set state='standard',cutover_at=clock_timestamp(),updated_at=clock_timestamp()
    where singleton;
    revoke all on function public.enroll_pj_flow(uuid,uuid)
      from public, anon, authenticated, service_role
  $remote$
);
select extensions.dblink_disconnect('pj_cutover_worker');
select extensions.dblink_disconnect('pj_cutover_migration');
select extensions.dblink_disconnect('pj_cutover_holder');

select * from finish();
rollback;
