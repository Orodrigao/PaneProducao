begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select no_plan();

-- Issue #424: duas conexoes reais atravessam a consulta idempotente antes do
-- primeiro INSERT. O portao de teste torna a corrida deterministica.
select extensions.dblink_connect('fin_setup', format(
  'hostaddr=%s port=%s dbname=%s user=postgres password=postgres',
  inet_server_addr(), current_setting('port'), current_database()));
select extensions.dblink_connect('fin_gate', format(
  'hostaddr=%s port=%s dbname=%s user=postgres password=postgres',
  inet_server_addr(), current_setting('port'), current_database()));
select extensions.dblink_connect('fin_first', format(
  'hostaddr=%s port=%s dbname=%s user=postgres password=postgres',
  inet_server_addr(), current_setting('port'), current_database()));
select extensions.dblink_connect('fin_second', format(
  'hostaddr=%s port=%s dbname=%s user=postgres password=postgres',
  inet_server_addr(), current_setting('port'), current_database()));

select extensions.dblink_exec('fin_setup', $remote$
  drop trigger if exists test_issue_424_insert_gate on public.finance_entries;
  drop function if exists private.test_issue_424_insert_gate();
  delete from public.finance_entries
    where request_id='92400000-0000-4000-8000-000000000001';
  delete from public.app_user_permissions
    where user_id='92400000-0000-4000-8000-000000000001';
  delete from public.app_profiles
    where user_id='92400000-0000-4000-8000-000000000001';
  delete from auth.users
    where id='92400000-0000-4000-8000-000000000001';

  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin
  ) values (
    '92400000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated','authenticated','issue-424-financeiro@example.com','',
    now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false
  );
  insert into public.app_profiles(user_id,display_name,role,store,active,allowed_routes)
  values ('92400000-0000-4000-8000-000000000001',
    'Financeiro concorrencia issue 424','financeiro','jc',true,'["/financeiro"]');
  insert into public.app_user_permissions(user_id,permission_key,scope)
  values
    ('92400000-0000-4000-8000-000000000001','financeiro.acessar','*'),
    ('92400000-0000-4000-8000-000000000001','financeiro.lancar','*');

  create function private.test_issue_424_insert_gate() returns trigger
  language plpgsql set search_path='' as $trigger$
  declare
    v_connection text := pg_catalog.current_setting('application_name');
  begin
    if new.request_id='92400000-0000-4000-8000-000000000001'::uuid then
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          'test:issue-424-insert-gate:' || v_connection,
          0
        ));
    end if;
    return new;
  end;
  $trigger$;
  create trigger test_issue_424_insert_gate
    before insert on public.finance_entries
    for each row execute function private.test_issue_424_insert_gate();
$remote$);

create function pg_temp.wait_for_advisory(p_pid integer) returns boolean
language plpgsql as $$
declare v_deadline timestamptz := clock_timestamp() + interval '5 seconds';
begin
  loop
    perform pg_catalog.pg_stat_clear_snapshot();
    if exists (select 1 from pg_catalog.pg_stat_activity
      where pid=p_pid and wait_event_type='Lock' and wait_event='advisory') then
      return true;
    end if;
    if clock_timestamp() >= v_deadline then return false; end if;
    perform pg_sleep(0.05);
  end loop;
end;
$$;

create temporary table fin_backends as
select 'first'::text connection,pid from extensions.dblink(
  'fin_first','select pg_backend_pid()') as response(pid integer)
union all
select 'second',pid from extensions.dblink(
  'fin_second','select pg_backend_pid()') as response(pid integer);

select extensions.dblink_exec('fin_gate', $command$
  do $gate$
    begin
      perform pg_catalog.pg_advisory_lock(
        pg_catalog.hashtextextended('test:issue-424-insert-gate:issue424-first',0));
      perform pg_catalog.pg_advisory_lock(
        pg_catalog.hashtextextended('test:issue-424-insert-gate:issue424-second',0));
    end;
  $gate$;
$command$);

select extensions.dblink_exec('fin_first','begin');
select extensions.dblink_exec('fin_first',
  $$set local application_name='issue424-first'$$);
select extensions.dblink_exec('fin_first','set local role authenticated');
select extensions.dblink_exec('fin_first',
  $$set local "request.jwt.claim.sub"='92400000-0000-4000-8000-000000000001'$$);
select extensions.dblink_send_query('fin_first',$q$
  select public.create_finance_entry(
    '92400000-0000-4000-8000-000000000001','mao_obra_diarias',
    'caixa_fisico_jc','jc',150,private.data_na_padaria(),'dinheiro',
    'diaria concorrente issue 424')::text
$q$);
select ok(pg_temp.wait_for_advisory(
  (select pid from fin_backends where connection='first')),
  'a primeira sessao chegou ao portao anterior ao INSERT');

select extensions.dblink_exec('fin_second','begin');
select extensions.dblink_exec('fin_second',
  $$set local application_name='issue424-second'$$);
select extensions.dblink_exec('fin_second','set local role authenticated');
select extensions.dblink_exec('fin_second',
  $$set local "request.jwt.claim.sub"='92400000-0000-4000-8000-000000000001'$$);
select extensions.dblink_send_query('fin_second',$q$
  select public.create_finance_entry(
    '92400000-0000-4000-8000-000000000001','mao_obra_diarias',
    'caixa_fisico_jc','jc',150,private.data_na_padaria(),'dinheiro',
    'diaria concorrente issue 424')::text
$q$);
select ok(pg_temp.wait_for_advisory(
  (select pid from fin_backends where connection='second')),
  'a segunda sessao tambem fica comprovadamente em espera');

select extensions.dblink_exec('fin_gate', $command$
  do $gate$
    begin
      perform pg_catalog.pg_advisory_unlock(
        pg_catalog.hashtextextended('test:issue-424-insert-gate:issue424-first',0));
    end;
  $gate$;
$command$);
create temporary table fin_first_result as
select result::uuid id from extensions.dblink_get_result(
  'fin_first',false) as response(result text);
create temporary table fin_first_error as
select extensions.dblink_error_message('fin_first') message;
create temporary table fin_first_end as
select result from extensions.dblink_get_result(
  'fin_first',false) as response(result text);
select extensions.dblink_exec('fin_first','commit');

select extensions.dblink_exec('fin_gate', $command$
  do $gate$
    begin
      perform pg_catalog.pg_advisory_unlock(
        pg_catalog.hashtextextended('test:issue-424-insert-gate:issue424-second',0));
    end;
  $gate$;
$command$);

create temporary table fin_second_result as
select result::uuid id from extensions.dblink_get_result(
  'fin_second',false) as response(result text);
create temporary table fin_second_error as
select extensions.dblink_error_message('fin_second') message;
create temporary table fin_second_end as
select result from extensions.dblink_get_result(
  'fin_second',false) as response(result text);
select extensions.dblink_exec('fin_second','rollback');

select is((select message from fin_first_error),'OK',
  'a primeira chamada concorrente termina sem erro');
select is((select message from fin_second_error),'OK',
  'a segunda chamada retorna de forma idempotente, sem violar a chave unica');
select is((select id from fin_second_result),(select id from fin_first_result),
  'as duas chamadas recebem o mesmo identificador');
select is((select count(*)::integer from public.finance_entries
  where request_id='92400000-0000-4000-8000-000000000001'),1,
  'a corrida grava um unico lancamento financeiro');

select extensions.dblink_disconnect('fin_second');
select extensions.dblink_disconnect('fin_first');
select extensions.dblink_disconnect('fin_gate');
select extensions.dblink_exec('fin_setup',$remote$
  drop trigger if exists test_issue_424_insert_gate on public.finance_entries;
  drop function if exists private.test_issue_424_insert_gate();
  delete from public.finance_entries
    where request_id='92400000-0000-4000-8000-000000000001';
  delete from public.app_user_permissions
    where user_id='92400000-0000-4000-8000-000000000001';
  delete from public.app_profiles
    where user_id='92400000-0000-4000-8000-000000000001';
  delete from auth.users
    where id='92400000-0000-4000-8000-000000000001';
$remote$);
select extensions.dblink_disconnect('fin_setup');

select * from finish();
rollback;
