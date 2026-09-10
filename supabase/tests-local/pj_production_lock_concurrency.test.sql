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
    'host=127.0.0.1 port=%s dbname=%s user=postgres password=postgres',
    current_setting('port'), current_database()
  )
);
select extensions.dblink_connect(
  'pj_lock_worker',
  format(
    'host=127.0.0.1 port=%s dbname=%s user=postgres password=postgres',
    current_setting('port'), current_database()
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
select like(
  extensions.dblink_error_message('pj_lock_worker'),
  '%A programacao PJ deve ser feita para hoje.%',
  'segunda sessao prossegue depois da liberacao sem deadlock'
);
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

select * from finish();
rollback;
