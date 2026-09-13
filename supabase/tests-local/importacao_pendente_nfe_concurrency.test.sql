begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select no_plan();

-- Fase 2 das compras por XML: salvar, descartar e confirmar a mesma NF-e
-- entram numa fila so (trava consultiva por chave da nota). Esta prova usa
-- duas conexoes ao Postgres local descartavel do CI Banco, como a prova de
-- concorrencia da programacao PJ. Fica fora de supabase/tests porque o mesmo
-- diretorio tambem roda no banco hospedado de preview, onde a credencial local
-- deliberadamente nao vale.
--
-- O que ela protege: a segunda sessao precisa comprovadamente ESPERAR, e o
-- resultado financeiro depois da espera precisa ser o certo: salvar sobre
-- rascunho descartado recomeca do zero; confirmar rascunho que outra pessoa
-- descartou ou alterou nao cria conta.

select extensions.dblink_connect(
  'draft_holder',
  format(
    'hostaddr=%s port=%s dbname=%s user=postgres password=postgres',
    inet_server_addr(), current_setting('port'), current_database()
  )
);
select extensions.dblink_connect(
  'draft_worker',
  format(
    'hostaddr=%s port=%s dbname=%s user=postgres password=postgres',
    inet_server_addr(), current_setting('port'), current_database()
  )
);

-- Cenario (fora da transacao deste teste, porque as outras sessoes precisam ve-lo).
select extensions.dblink_exec(
  'draft_holder',
  $remote$
    delete from public.payable_import_drafts where nfe_key = '35260900000000000000550010000000098000000098';
    delete from public.payable_purchases where nfe_key = '35260900000000000000550010000000098000000098';
    delete from public.app_user_permissions where user_id = '98000000-0000-4000-8000-00000000000a';
    delete from public.app_profiles where user_id = '98000000-0000-4000-8000-00000000000a';
    delete from auth.users where id = '98000000-0000-4000-8000-00000000000a';
    delete from public.suppliers where id = '98000000-0000-4000-8000-0000000000f1';

    insert into auth.users(
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin
    ) values (
      '98000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'financeiro-rascunho-concorrente@example.com', '', now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{}', false
    );
    insert into public.app_profiles(user_id, display_name, role, store, active, allowed_routes)
    values ('98000000-0000-4000-8000-00000000000a', 'Financeiro rascunho concorrente', 'financeiro', 'jc', true, '["/contas-pagar"]');
    insert into public.app_user_permissions(user_id, permission_key, scope)
    values ('98000000-0000-4000-8000-00000000000a', 'contas_pagar.importar_xml', 'jc');
    insert into public.suppliers(id, name, active)
    values ('98000000-0000-4000-8000-0000000000f1', '[TESTE] Fornecedor rascunho concorrente', true);
  $remote$
);

create function pg_temp.wait_for_advisory(p_pid integer) returns boolean
language plpgsql as $$
declare v_deadline timestamptz := clock_timestamp() + interval '5 seconds';
begin
  loop
    perform pg_catalog.pg_stat_clear_snapshot();
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

-- Abre uma transacao remota como o financeiro. Um statement_timeout curto faz
-- uma regressao que trave virar erro rapido e explicado, em vez de CI pendurado.
create function pg_temp.as_financeiro(p_connection text) returns void
language plpgsql as $$
begin
  perform extensions.dblink_exec(p_connection, 'begin');
  perform extensions.dblink_exec(p_connection, $t$set local statement_timeout = '15s'$t$);
  perform extensions.dblink_exec(p_connection, 'set local role authenticated');
  perform extensions.dblink_exec(p_connection, $sub$set local "request.jwt.claim.sub" = '98000000-0000-4000-8000-00000000000a'$sub$);
end;
$$;

-- Salva (ou atualiza) o rascunho da nota de teste na conexao dada e devolve o id.
create function pg_temp.save_draft(p_connection text, p_decisions text) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  select id::uuid into v_id
  from extensions.dblink(
    p_connection,
    format($q$select public.save_xml_import_draft(
        '35260900000000000000550010000000098000000098',
        '98000000-0000-4000-8000-0000000000f1'::uuid, '[TESTE] Fornecedor rascunho concorrente', '98', '1', '2026-09-10',
        100.00, '<NFe/>', %L::jsonb, '[]'::jsonb)::text$q$, p_decisions)
  ) as response(id text);
  return v_id;
end;
$$;

-- A chamada de confirmacao do rascunho retomado, com a versao que a tela abriu.
create function pg_temp.confirm_sql(p_draft_id uuid, p_expected timestamptz, p_request uuid) returns text
language sql as $$
  select format($q$select public.confirm_xml_import_draft(
      %L::uuid, %L::timestamptz, %L::uuid, '35260900000000000000550010000000098000000098',
      '98000000-0000-4000-8000-0000000000f1'::uuid, '98', '1', '2026-09-10', 'boleto', 100.00, '',
      '[{"line_number":1,"source_description":"DETERGENTE 5L","source_unit":"UN","source_quantity":1,
         "product_id":null,"conversion_basis":"simple","conversion_factor":null,"usable_quantity":null,
         "line_total":100.00,"unit_price":100.00,"discount_value":0,"factor_confirmed":false,
         "remember_conversion":false,"mapping_status":"nao_aplicavel"}]'::jsonb,
      '[{"installment_number":1,"due_date":"2026-09-30","amount":100.00}]'::jsonb)::text$q$,
    p_draft_id, p_expected, p_request)
$$;

create temporary table worker_backend as
select pid
from extensions.dblink('draft_worker', 'select pg_backend_pid()') as response(pid integer);

-- 1. Descartar espera o salvar em andamento --------------------------------
-- O rascunho ja existe e esta confirmado no banco; o salvar aberto o atualiza.

select pg_temp.as_financeiro('draft_holder');
create temporary table first_draft as select pg_temp.save_draft('draft_holder', '[]') as id;
select extensions.dblink_exec('draft_holder', 'commit');

select pg_temp.as_financeiro('draft_holder');
create temporary table first_draft_update as
select pg_temp.save_draft('draft_holder',
  '[{"line_number":1,"product_id":null,"conversion_basis":null,"conversion_factor":null,"mapping_status":"nao_aplicavel","factor_confirmed":false,"remember_conversion":false}]') as id;
select is((select id from first_draft_update), (select id from first_draft), 'o salvar aberto atualiza o mesmo rascunho');

select pg_temp.as_financeiro('draft_worker');
select extensions.dblink_send_query(
  'draft_worker',
  format($$select public.discard_xml_import_draft(%L::uuid)::text$$, (select id from first_draft))
);
select ok(
  pg_temp.wait_for_advisory((select pid from worker_backend)),
  'descartar espera na trava por chave enquanto o salvar da mesma nota nao terminou'
);

select extensions.dblink_exec('draft_holder', 'commit');
create temporary table discard_result as
select result from extensions.dblink_get_result('draft_worker', false) as response(result text);
select is(extensions.dblink_error_message('draft_worker'), 'OK', 'o descarte prossegue depois da liberacao, sem erro nem deadlock');
create temporary table discard_result_end as
select result from extensions.dblink_get_result('draft_worker', false) as response(result text);
select extensions.dblink_exec('draft_worker', 'commit');

select is(
  (select status from public.payable_import_drafts where id = (select id from first_draft)),
  'descartada', 'o rascunho ficou descartado: o descarte enxergou o salvar inteiro'
);
select is(
  (select item_decisions -> 0 ->> 'mapping_status' from public.payable_import_drafts where id = (select id from first_draft)),
  'nao_aplicavel', 'o conteudo gravado pelo salvar que veio antes ficou na linha descartada'
);

-- 2. Salvar espera o descarte em andamento e recomeca do zero ---------------

select pg_temp.as_financeiro('draft_holder');
create temporary table second_draft as select pg_temp.save_draft('draft_holder', '[]') as id;
select extensions.dblink_exec('draft_holder', 'commit');

select pg_temp.as_financeiro('draft_holder');
create temporary table holder_discard as
select result
from extensions.dblink(
  'draft_holder',
  format($$select public.discard_xml_import_draft(%L::uuid)::text$$, (select id from second_draft))
) as response(result text);

select pg_temp.as_financeiro('draft_worker');
select extensions.dblink_send_query(
  'draft_worker',
  $$select public.save_xml_import_draft(
      '35260900000000000000550010000000098000000098',
      '98000000-0000-4000-8000-0000000000f1'::uuid, '[TESTE] Fornecedor rascunho concorrente', '98', '1', '2026-09-10',
      100.00, '<NFe/>', '[{"line_number":1,"product_id":null,"conversion_basis":null,"conversion_factor":null,"mapping_status":"nao_aplicavel","factor_confirmed":false,"remember_conversion":false}]'::jsonb, '[]'::jsonb)::text$$
);
select ok(
  pg_temp.wait_for_advisory((select pid from worker_backend)),
  'salvar espera na trava por chave enquanto o descarte da mesma nota nao terminou'
);

select extensions.dblink_exec('draft_holder', 'commit');
create temporary table third_draft as
select result::uuid as id from extensions.dblink_get_result('draft_worker', false) as response(result text);
select is(extensions.dblink_error_message('draft_worker'), 'OK', 'o salvar prossegue depois da liberacao, sem erro nem deadlock');
create temporary table save_result_end as
select result from extensions.dblink_get_result('draft_worker', false) as response(result text);
select extensions.dblink_exec('draft_worker', 'commit');

select isnt(
  (select id from third_draft), (select id from second_draft),
  'o salvar que esperou o descarte cria um rascunho novo em vez de gravar sobre o descartado'
);
select is(
  (select status from public.payable_import_drafts where id = (select id from second_draft)),
  'descartada', 'o rascunho descartado continua descartado'
);
select is(
  (select count(*)::int from public.payable_import_drafts
    where nfe_key = '35260900000000000000550010000000098000000098' and status = 'pendente'),
  1, 'a nota termina com um unico rascunho pendente'
);
select is(
  (select item_decisions -> 0 ->> 'mapping_status' from public.payable_import_drafts where id = (select id from third_draft)),
  'nao_aplicavel', 'o rascunho novo guarda as decisoes enviadas pela sessao que esperou'
);

-- 3. Confirmar o rascunho retomado espera o descarte e NAO cria conta -------

create temporary table third_version as
select updated_at from public.payable_import_drafts where id = (select id from third_draft);

select pg_temp.as_financeiro('draft_holder');
create temporary table holder_discard_third as
select result
from extensions.dblink(
  'draft_holder',
  format($$select public.discard_xml_import_draft(%L::uuid)::text$$, (select id from third_draft))
) as response(result text);

select pg_temp.as_financeiro('draft_worker');
select extensions.dblink_send_query(
  'draft_worker',
  pg_temp.confirm_sql((select id from third_draft), (select updated_at from third_version), '98000000-0000-4000-8000-000000000001')
);
select ok(
  pg_temp.wait_for_advisory((select pid from worker_backend)),
  'confirmar o rascunho espera na trava por chave enquanto o descarte da mesma nota nao terminou'
);
select is(
  (select count(*)::int from public.payable_purchases where nfe_key = '35260900000000000000550010000000098000000098'),
  0, 'enquanto a confirmacao espera, nenhuma conta a pagar existe'
);

select extensions.dblink_exec('draft_holder', 'commit');
create temporary table confirm_after_discard as
select result from extensions.dblink_get_result('draft_worker', false) as response(result text);
select ok(
  extensions.dblink_error_message('draft_worker') ilike '%descartada ou confirmada por outra pessoa%',
  'a confirmacao que acordou depois do descarte e recusada com explicacao'
);
create temporary table confirm_after_discard_end as
select result from extensions.dblink_get_result('draft_worker', false) as response(result text);
select extensions.dblink_exec('draft_worker', 'rollback');

select is(
  (select count(*)::int from public.payable_purchases where nfe_key = '35260900000000000000550010000000098000000098'),
  0, 'rascunho descartado durante a confirmacao nao vira conta a pagar'
);

-- 4. Confirmar espera o salvar e recusa a versao que ficou para tras --------

select pg_temp.as_financeiro('draft_holder');
create temporary table fourth_draft as select pg_temp.save_draft('draft_holder', '[]') as id;
select extensions.dblink_exec('draft_holder', 'commit');
create temporary table fourth_version as
select updated_at from public.payable_import_drafts where id = (select id from fourth_draft);

-- Outra tela salva decisoes novas e ainda nao terminou.
select pg_temp.as_financeiro('draft_holder');
create temporary table fourth_update as
select pg_temp.save_draft('draft_holder',
  '[{"line_number":1,"product_id":null,"conversion_basis":null,"conversion_factor":null,"mapping_status":"nao_aplicavel","factor_confirmed":false,"remember_conversion":false}]') as id;

select pg_temp.as_financeiro('draft_worker');
select extensions.dblink_send_query(
  'draft_worker',
  pg_temp.confirm_sql((select id from fourth_draft), (select updated_at from fourth_version), '98000000-0000-4000-8000-000000000002')
);
select ok(
  pg_temp.wait_for_advisory((select pid from worker_backend)),
  'confirmar o rascunho espera na trava por chave enquanto outro salvar da mesma nota nao terminou'
);

select extensions.dblink_exec('draft_holder', 'commit');
create temporary table confirm_after_save as
select result from extensions.dblink_get_result('draft_worker', false) as response(result text);
select ok(
  extensions.dblink_error_message('draft_worker') ilike '%alterada por outra pessoa%',
  'a confirmacao com a versao antiga e recusada depois que o salvar novo entrou'
);
create temporary table confirm_after_save_end as
select result from extensions.dblink_get_result('draft_worker', false) as response(result text);
select extensions.dblink_exec('draft_worker', 'rollback');

select is(
  (select count(*)::int from public.payable_purchases where nfe_key = '35260900000000000000550010000000098000000098'),
  0, 'versao desatualizada nao vira conta a pagar'
);
select is(
  (select status from public.payable_import_drafts where id = (select id from fourth_draft)),
  'pendente', 'o rascunho atualizado continua pendente para a pessoa reconferir'
);

-- 5. Com a versao atual, a confirmacao cria a conta uma vez e fecha o rascunho

create temporary table fourth_current as
select updated_at from public.payable_import_drafts where id = (select id from fourth_draft);
select pg_temp.as_financeiro('draft_worker');
create temporary table confirmed_purchase as
select result::uuid as id
from extensions.dblink(
  'draft_worker',
  pg_temp.confirm_sql((select id from fourth_draft), (select updated_at from fourth_current), '98000000-0000-4000-8000-000000000003')
) as response(result text);
select extensions.dblink_exec('draft_worker', 'commit');

select is(
  (select count(*)::int from public.payable_purchases where nfe_key = '35260900000000000000550010000000098000000098'),
  1, 'a confirmacao com a versao atual cria a conta uma unica vez'
);
select is(
  (select status from public.payable_import_drafts where id = (select id from fourth_draft)),
  'confirmada', 'o rascunho confirmado fica marcado e aponta para a conta'
);
select is(
  (select purchase_id from public.payable_import_drafts where id = (select id from fourth_draft)),
  (select id from confirmed_purchase),
  'o rascunho aponta para a conta criada'
);

-- Limpeza (as outras sessoes gravaram fora desta transacao).
select extensions.dblink_exec(
  'draft_holder',
  $remote$
    delete from public.payable_import_drafts where nfe_key = '35260900000000000000550010000000098000000098';
    delete from public.payable_purchases where nfe_key = '35260900000000000000550010000000098000000098';
    delete from public.app_user_permissions where user_id = '98000000-0000-4000-8000-00000000000a';
    delete from public.app_profiles where user_id = '98000000-0000-4000-8000-00000000000a';
    delete from auth.users where id = '98000000-0000-4000-8000-00000000000a';
    delete from public.suppliers where id = '98000000-0000-4000-8000-0000000000f1';
  $remote$
);
select extensions.dblink_disconnect('draft_worker');
select extensions.dblink_disconnect('draft_holder');

select * from finish();
rollback;
