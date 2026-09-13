begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select no_plan();

-- Fase 2 das compras por XML: salvar, descartar e confirmar a mesma NF-e
-- entram numa fila só (trava consultiva por chave da nota). Esta prova usa
-- duas conexoes ao Postgres local descartavel do CI Banco, como a prova de
-- concorrencia da programacao PJ. Fica fora de supabase/tests porque o mesmo
-- diretorio tambem roda no banco hospedado de preview, onde a credencial local
-- deliberadamente nao vale.
--
-- O que ela protege: sem a trava no descarte, "salvar" podia responder sucesso
-- e deixar a linha descartada, e "descartar" podia passar no meio de uma
-- confirmacao. Aqui a segunda sessao precisa comprovadamente ESPERAR.

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

create function pg_temp.as_financeiro(p_connection text) returns void
language plpgsql as $$
begin
  perform extensions.dblink_exec(p_connection, 'begin');
  perform extensions.dblink_exec(p_connection, 'set local role authenticated');
  perform extensions.dblink_exec(p_connection, $sub$set local "request.jwt.claim.sub" = '98000000-0000-4000-8000-00000000000a'$sub$);
end;
$$;

create temporary table worker_backend as
select pid
from extensions.dblink('draft_worker', 'select pg_backend_pid()') as response(pid integer);

-- 1. Descartar espera o salvar em andamento --------------------------------

select pg_temp.as_financeiro('draft_holder');
create temporary table first_draft as
select id::uuid as id
from extensions.dblink(
  'draft_holder',
  $$select public.save_xml_import_draft(
      '35260900000000000000550010000000098000000098',
      '98000000-0000-4000-8000-0000000000f1'::uuid, '[TESTE] Fornecedor rascunho concorrente', '98', '1', '2026-09-10',
      100.00, '<NFe/>', '[]'::jsonb, '[]'::jsonb)::text$$
) as response(id text);

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
  'descartada', 'o rascunho salvo ficou descartado: o descarte enxergou o salvar inteiro'
);

-- 2. Salvar espera o descarte em andamento e recomeca do zero ---------------

select pg_temp.as_financeiro('draft_holder');
create temporary table second_draft as
select id::uuid as id
from extensions.dblink(
  'draft_holder',
  $$select public.save_xml_import_draft(
      '35260900000000000000550010000000098000000098',
      '98000000-0000-4000-8000-0000000000f1'::uuid, '[TESTE] Fornecedor rascunho concorrente', '98', '1', '2026-09-10',
      100.00, '<NFe/>', '[]'::jsonb, '[]'::jsonb)::text$$
) as response(id text);
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

-- 3. Confirmar espera o descarte e nada vira conta antes disso -------------

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
  $$select public.create_xml_payable(
      '98000000-0000-4000-8000-000000000001'::uuid, '35260900000000000000550010000000098000000098',
      '98000000-0000-4000-8000-0000000000f1'::uuid, '98', '1', '2026-09-10', 'boleto', 100.00, '',
      '[{"line_number":1,"source_description":"DETERGENTE 5L","source_unit":"UN","source_quantity":1,
         "product_id":null,"conversion_basis":"simple","conversion_factor":null,"usable_quantity":null,
         "line_total":100.00,"unit_price":100.00,"discount_value":0,"factor_confirmed":false,
         "remember_conversion":false,"mapping_status":"nao_aplicavel"}]'::jsonb,
      '[{"installment_number":1,"due_date":"2026-09-30","amount":100.00}]'::jsonb)::text$$
);
select ok(
  pg_temp.wait_for_advisory((select pid from worker_backend)),
  'confirmar espera na trava por chave enquanto o descarte da mesma nota nao terminou'
);
select is(
  (select count(*)::int from public.payable_purchases where nfe_key = '35260900000000000000550010000000098000000098'),
  0, 'enquanto a confirmacao espera, nenhuma conta a pagar existe'
);

select extensions.dblink_exec('draft_holder', 'commit');
create temporary table purchase_result as
select result::uuid as id from extensions.dblink_get_result('draft_worker', false) as response(result text);
select is(extensions.dblink_error_message('draft_worker'), 'OK', 'a confirmacao prossegue depois da liberacao, sem erro nem deadlock');
create temporary table purchase_result_end as
select result from extensions.dblink_get_result('draft_worker', false) as response(result text);
select extensions.dblink_exec('draft_worker', 'commit');

select is(
  (select count(*)::int from public.payable_purchases where nfe_key = '35260900000000000000550010000000098000000098'),
  1, 'a confirmacao que esperou cria a conta uma unica vez'
);
select is(
  (select status from public.payable_import_drafts where id = (select id from third_draft)),
  'descartada', 'o rascunho descartado antes da confirmacao permanece descartado e nao e reescrito'
);

-- Limpeza (as outras sessoes gravaram fora desta transacao).
select extensions.dblink_exec(
  'draft_holder',
  $remote$
    delete from public.payable_import_drafts where nfe_key = '35260900000000000000550010000000098000000098';
    delete from public.payable_events where purchase_id in (select id from public.payable_purchases where nfe_key = '35260900000000000000550010000000098000000098');
    delete from public.payable_installments where purchase_id in (select id from public.payable_purchases where nfe_key = '35260900000000000000550010000000098000000098');
    delete from public.payable_purchase_items where purchase_id in (select id from public.payable_purchases where nfe_key = '35260900000000000000550010000000098000000098');
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
