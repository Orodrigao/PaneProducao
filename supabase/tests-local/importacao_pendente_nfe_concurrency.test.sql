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
    delete from public.payable_purchase_item_corrections where undoes_correction_id is not null
      and product_ids && array['98000000-0000-4000-8000-0000000000d1', '98000000-0000-4000-8000-0000000000d2']::uuid[];
    delete from public.payable_purchase_item_corrections
      where product_ids && array['98000000-0000-4000-8000-0000000000d1', '98000000-0000-4000-8000-0000000000d2']::uuid[];
    delete from public.payable_purchases where nfe_key in (
      '35260900000000000000550010000000098000000071', '35260900000000000000550010000000098000000072',
      '35260900000000000000550010000000098000000073', '35260900000000000000550010000000098000000074',
      '35260900000000000000550010000000098000000075', '35260900000000000000550010000000098000000076',
      '35260900000000000000550010000000098000000077');
    delete from public.products where id = '98000000-0000-4000-8000-0000000000d2';
    delete from public.payable_product_mapping_corrections where mapping_id = '98000000-0000-4000-8000-0000000000e9';
    delete from public.payable_product_mappings where id = '98000000-0000-4000-8000-0000000000e9';
    delete from public.app_profiles where user_id = '98000000-0000-4000-8000-00000000000b';
    delete from auth.users where id = '98000000-0000-4000-8000-00000000000b';
    delete from public.products where id = '98000000-0000-4000-8000-0000000000d1';
    delete from public.suppliers where id = '98000000-0000-4000-8000-0000000000f2';
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
    values
      ('98000000-0000-4000-8000-00000000000a', 'contas_pagar.importar_xml', 'jc'),
      -- Fase 3A: o cenario 7 classifica item pendente, que exige lancar.
      ('98000000-0000-4000-8000-00000000000a', 'contas_pagar.lancar', 'jc');
    insert into public.suppliers(id, name, active)
    values ('98000000-0000-4000-8000-0000000000f1', '[TESTE] Fornecedor rascunho concorrente', true);
    -- Fase 3A: segundo fornecedor e um insumo disputado por duas notas.
    insert into public.suppliers(id, name, active)
    values ('98000000-0000-4000-8000-0000000000f2', '[TESTE] Outro fornecedor concorrente', true);
    insert into public.products(id, name, category, active, unit, kind, cost_price)
    values ('98000000-0000-4000-8000-0000000000d1', '[TESTE] Farinha concorrente', 'Insumos', true, 'kg', 'insumo', 5.00);
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

-- 6. Fase 3A: duas notas do mesmo insumo ao mesmo tempo -------------------
-- A nota mais recente do insumo esta sendo confirmada e ainda nao terminou;
-- outra pessoa, de outro fornecedor, confirma uma nota mais antiga do mesmo
-- insumo. Fornecedor e chave diferentes nao disputam as travas consultivas. Sem
-- a trava na linha do insumo, a nota antiga leria "nao ha nota mais nova" e
-- gravaria o custo velho por cima. Com a trava ela espera e, ao acordar,
-- enxerga a nota nova e nao troca o custo.

create function pg_temp.wait_for_lock(p_pid integer) returns boolean
language plpgsql as $$
declare v_deadline timestamptz := clock_timestamp() + interval '5 seconds';
begin
  loop
    perform pg_catalog.pg_stat_clear_snapshot();
    if exists (
      select 1 from pg_catalog.pg_stat_activity
      where pid = p_pid and wait_event_type = 'Lock'
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

create function pg_temp.import_cost_sql(p_request uuid, p_key text, p_supplier uuid, p_issue date, p_value numeric) returns text
language sql as $$
  select format(
    $q$select public.create_xml_payable(%L::uuid, %L, %L::uuid, '71', '1', %L::date, 'boleto', %s, '', %L::jsonb, %L::jsonb)::text$q$,
    p_request, p_key, p_supplier, p_issue, p_value,
    jsonb_build_array(jsonb_build_object(
      'line_number', 1, 'source_description', '[TESTE] FARINHA CONCORRENTE', 'source_unit', 'KG',
      'source_quantity', 1, 'product_id', '98000000-0000-4000-8000-0000000000d1', 'conversion_basis', 'simple',
      'conversion_factor', 5, 'usable_quantity', 5, 'line_total', p_value, 'unit_price', p_value,
      'discount_value', 0, 'factor_confirmed', true, 'remember_conversion', false, 'mapping_status', 'mapeado'
    )),
    jsonb_build_array(jsonb_build_object('installment_number', 1, 'due_date', '2026-10-10', 'amount', p_value))
  )
$$;

select pg_temp.as_financeiro('draft_holder');
create temporary table newer_cost_purchase as
select result::uuid as id
from extensions.dblink(
  'draft_holder',
  pg_temp.import_cost_sql('98000000-0000-4000-8000-000000000071', '35260900000000000000550010000000098000000071',
    '98000000-0000-4000-8000-0000000000f1', '2026-09-10', 50.00)
) as response(result text);

select pg_temp.as_financeiro('draft_worker');
select extensions.dblink_send_query(
  'draft_worker',
  pg_temp.import_cost_sql('98000000-0000-4000-8000-000000000072', '35260900000000000000550010000000098000000072',
    '98000000-0000-4000-8000-0000000000f2', '2026-09-01', 20.00)
);
select ok(
  pg_temp.wait_for_lock((select pid from worker_backend)),
  'a nota antiga espera na trava do insumo enquanto a nota nova do mesmo insumo nao terminou'
);

select extensions.dblink_exec('draft_holder', 'commit');
create temporary table older_cost_result as
select result from extensions.dblink_get_result('draft_worker', false) as response(result text);
select is(extensions.dblink_error_message('draft_worker'), 'OK', 'a nota antiga prossegue depois da liberacao, sem erro nem deadlock');
create temporary table older_cost_result_end as
select result from extensions.dblink_get_result('draft_worker', false) as response(result text);
select extensions.dblink_exec('draft_worker', 'commit');

select is(
  (select cost_price from public.products where id = '98000000-0000-4000-8000-0000000000d1'),
  10.00::numeric,
  'o custo final e o da nota mais recente (50 / 5): a antiga, que acordou depois, nao gravou por cima'
);
select is(
  (select item.cost_applied from public.payable_purchase_items item
    join public.payable_purchases purchase on purchase.id = item.purchase_id
    where purchase.nfe_key = '35260900000000000000550010000000098000000072'),
  false, 'a nota antiga vira conta e registra que nao trocou o custo'
);

-- 7. Fase 3A: importar e classificar o mesmo fornecedor e insumo ao mesmo tempo
-- A importacao trava o fornecedor e depois o insumo. A classificacao posterior
-- travava o insumo e so depois o fornecedor (quando havia memoria), e as duas
-- podiam se travar. Agora a classificacao tambem trava o fornecedor antes do
-- insumo: a importacao que chega no meio espera na trava do FORNECEDOR
-- (advisory), e nao na linha do insumo. Com a ordem antiga ela esperaria no
-- insumo, e esta prova falha.

select pg_temp.as_financeiro('draft_holder');
create temporary table pending_cost_purchase as
select result::uuid as id
from extensions.dblink(
  'draft_holder',
  format(
    $q$select public.create_xml_payable('98000000-0000-4000-8000-000000000073'::uuid,
        '35260900000000000000550010000000098000000073', '98000000-0000-4000-8000-0000000000f1'::uuid,
        '73', '1', '2026-09-11', 'boleto', 33, '', %L::jsonb, %L::jsonb)::text$q$,
    jsonb_build_array(jsonb_build_object(
      'line_number', 1, 'source_description', '[TESTE] FARINHA PENDENTE CONCORRENTE', 'source_unit', 'KG',
      'source_quantity', 1, 'product_id', null, 'conversion_basis', null, 'conversion_factor', null,
      'usable_quantity', null, 'line_total', 33, 'unit_price', 33, 'discount_value', 0,
      'factor_confirmed', false, 'remember_conversion', false, 'mapping_status', 'pendente'
    )),
    jsonb_build_array(jsonb_build_object('installment_number', 1, 'due_date', '2026-10-10', 'amount', 33))
  )
) as response(result text);
select extensions.dblink_exec('draft_holder', 'commit');

-- A classificacao comeca e nao termina: segura fornecedor e insumo.
select pg_temp.as_financeiro('draft_holder');
create temporary table classify_holder as
select result
from extensions.dblink(
  'draft_holder',
  format(
    $q$select 'ok'::text from public.classify_payable_item(%L::uuid, '98000000-0000-4000-8000-0000000000d1'::uuid, 'simple', 3, 3, false, true) as classified$q$,
    (select item.id from public.payable_purchase_items item
      join public.payable_purchases purchase on purchase.id = item.purchase_id
      where purchase.nfe_key = '35260900000000000000550010000000098000000073')
  )
) as response(result text);

select pg_temp.as_financeiro('draft_worker');
select extensions.dblink_send_query(
  'draft_worker',
  pg_temp.import_cost_sql('98000000-0000-4000-8000-000000000074', '35260900000000000000550010000000098000000074',
    '98000000-0000-4000-8000-0000000000f1', '2026-09-12', 60.00)
);
select ok(
  pg_temp.wait_for_advisory((select pid from worker_backend)),
  'a importacao do mesmo fornecedor espera na trava do fornecedor enquanto a classificacao nao terminou: fornecedor antes do insumo nas duas'
);

select extensions.dblink_exec('draft_holder', 'commit');
create temporary table import_after_classify as
select result from extensions.dblink_get_result('draft_worker', false) as response(result text);
select is(extensions.dblink_error_message('draft_worker'), 'OK', 'a importacao prossegue depois da classificacao, sem erro nem deadlock');
create temporary table import_after_classify_end as
select result from extensions.dblink_get_result('draft_worker', false) as response(result text);
select extensions.dblink_exec('draft_worker', 'commit');

select is(
  (select cost_price from public.products where id = '98000000-0000-4000-8000-0000000000d1'),
  12.00::numeric,
  'o custo final e o da nota de 12/09 (60 / 5), a mais recente'
);

-- Vinculos de NF-e, fase 3: corrigir a memoria entra na mesma fila por
-- fornecedor das funcoes que gravam a memoria na importacao. A sessao da
-- frente segura a trava com a mesma chave que create_xml_payable e
-- classify_payable_item usam; a correcao precisa esperar e so gravar depois.
select extensions.dblink_exec(
  'draft_holder',
  $remote$
    insert into auth.users(
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin
    ) values (
      '98000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'admin-correcao-concorrente@example.com', '', now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{}', false
    );
    insert into public.app_profiles(user_id, display_name, role, store, active, allowed_routes)
    values ('98000000-0000-4000-8000-00000000000b', 'Admin correcao concorrente', 'admin', null, true, '["/produtos"]');
    insert into public.payable_product_mappings(
      id, supplier_id, supplier_product_code, supplier_description, purchase_unit,
      base_product_id, base_unit, conversion_basis, conversion_factor, last_confirmed_by
    ) values (
      '98000000-0000-4000-8000-0000000000e9', '98000000-0000-4000-8000-0000000000f1', 'MEM-CONC',
      '[TESTE] Memoria concorrente', 'kg', '98000000-0000-4000-8000-0000000000d1', 'kg', 'simple', 1,
      '98000000-0000-4000-8000-00000000000b'
    );
  $remote$
);

select extensions.dblink_exec('draft_holder', 'begin');
select extensions.dblink_exec(
  'draft_holder',
  $q$do $lock$ begin
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('payable-mapping-supplier:98000000-0000-4000-8000-0000000000f1', 0));
  end $lock$$q$
);

select extensions.dblink_exec('draft_worker', 'begin');
select extensions.dblink_exec('draft_worker', $t$set local statement_timeout = '15s'$t$);
select extensions.dblink_exec('draft_worker', 'set local role authenticated');
select extensions.dblink_exec('draft_worker', $sub$set local "request.jwt.claim.sub" = '98000000-0000-4000-8000-00000000000b'$sub$);
select extensions.dblink_send_query(
  'draft_worker',
  $q$select public.correct_payable_product_mapping(
      '98000000-0000-4000-8000-0000000000ea', '98000000-0000-4000-8000-0000000000e9',
      (select updated_at from public.payable_product_mappings where id = '98000000-0000-4000-8000-0000000000e9'),
      'desligar')::text$q$
);
select ok(
  pg_temp.wait_for_advisory((select pid from worker_backend)),
  'a correcao da memoria espera na trava do fornecedor enquanto a importacao do mesmo fornecedor nao terminou'
);
select is(
  (select result from extensions.dblink('draft_holder',
    $q$select active::text from public.payable_product_mappings where id = '98000000-0000-4000-8000-0000000000e9'$q$) as response(result text)),
  'true',
  'enquanto espera, a correcao nao gravou nada'
);

select extensions.dblink_exec('draft_holder', 'commit');
create temporary table correction_after_import as
select result from extensions.dblink_get_result('draft_worker', false) as response(result text);
select is(extensions.dblink_error_message('draft_worker'), 'OK', 'a correcao prossegue depois da importacao, sem erro nem deadlock');
create temporary table correction_after_import_end as
select result from extensions.dblink_get_result('draft_worker', false) as response(result text);
select extensions.dblink_exec('draft_worker', 'commit');

select is(
  (select active from public.payable_product_mappings where id = '98000000-0000-4000-8000-0000000000e9'),
  false,
  'a memoria fica desligada depois que a fila andou'
);
select is(
  (select count(*)::integer from public.payable_product_mapping_corrections where mapping_id = '98000000-0000-4000-8000-0000000000e9'),
  1,
  'uma correcao no historico'
);

-- Vinculos de NF-e, fase 4: correcao de itens de notas gravadas. Duas
-- correcoes entram numa fila unica (trava consultiva payable-item-correction);
-- correcao e classificacao de item pendente disputando o mesmo produto esperam
-- uma pela outra e terminam sem deadlock, nas duas ordens.
select extensions.dblink_exec(
  'draft_holder',
  $remote$
    insert into public.products(id, name, category, active, unit, kind, cost_price)
    values ('98000000-0000-4000-8000-0000000000d2', '[TESTE] Farinha certa concorrente', 'Insumos', true, 'kg', 'insumo', 7.00);
    insert into public.payable_purchases (
      id, request_id, store, supplier_id, purchase_date, origin, document_type, payment_method,
      status, total_value, nfe_key, nfe_number, nfe_issued_at, classification_status, created_by
    ) values (
      '98000000-0000-4000-8000-000000000075', '98000000-0000-4000-8000-000000000175', 'jc',
      '98000000-0000-4000-8000-0000000000f1', '2026-09-14', 'xml', 'nfe', 'boleto', 'aberta', 30.00,
      '35260900000000000000550010000000098000000075', '75', '2026-09-14', 'pendente',
      '98000000-0000-4000-8000-00000000000a'
    );
    insert into public.payable_purchase_items (
      id, purchase_id, item_name, unit, quantity, unit_price, source_line_number,
      source_product_code, source_description, source_unit, source_quantity, conversion_basis, mapping_status
    ) values
      ('98000000-0000-4000-8000-0000000000c1', '98000000-0000-4000-8000-000000000075', 'PENDENTE 1', 'kg', 2, 10, 1,
       'PEN-1', '[TESTE] Pendente concorrente 1', 'kg', 2, 'simple', 'pendente'),
      ('98000000-0000-4000-8000-0000000000c2', '98000000-0000-4000-8000-000000000075', 'PENDENTE 2', 'kg', 1, 10, 2,
       'PEN-2', '[TESTE] Pendente concorrente 2', 'kg', 1, 'simple', 'pendente');
    -- Nota de 13/09 que sobra para a farinha quando o item de 14/09 sair dela.
    insert into public.payable_purchases (
      id, request_id, store, supplier_id, purchase_date, origin, document_type, payment_method,
      status, total_value, nfe_key, nfe_number, nfe_issued_at, classification_status, created_by
    ) values (
      '98000000-0000-4000-8000-000000000076', '98000000-0000-4000-8000-000000000176', 'jc',
      '98000000-0000-4000-8000-0000000000f1', '2026-09-13', 'xml', 'nfe', 'boleto', 'aberta', 20.00,
      '35260900000000000000550010000000098000000076', '76', '2026-09-13', 'pendente',
      '98000000-0000-4000-8000-00000000000a'
    );
    insert into public.payable_purchase_items (
      id, purchase_id, product_id, item_name, unit, quantity, unit_price, source_line_number,
      source_product_code, source_description, source_unit, source_quantity, conversion_basis,
      conversion_factor, usable_quantity, normalized_unit_cost, mapping_status
    ) values
      ('98000000-0000-4000-8000-0000000000c3', '98000000-0000-4000-8000-000000000076', null, 'PENDENTE 3', 'kg', 1, 10, 1,
       'PEN-3', '[TESTE] Pendente concorrente 3', 'kg', 1, 'simple', null, null, null, 'pendente'),
      ('98000000-0000-4000-8000-0000000000c4', '98000000-0000-4000-8000-000000000076', '98000000-0000-4000-8000-0000000000d1',
       '[TESTE] Farinha concorrente', 'kg', 1, 10, 2, 'FAR-76', '[TESTE] Farinha de 13/09', 'kg', 1, 'simple', 1, 1, 10, 'mapeado');
    -- Nota de 08/09 com um item pendente e outro ja na farinha (cenario E).
    insert into public.payable_purchases (
      id, request_id, store, supplier_id, purchase_date, origin, document_type, payment_method,
      status, total_value, nfe_key, nfe_number, nfe_issued_at, classification_status, created_by
    ) values (
      '98000000-0000-4000-8000-000000000077', '98000000-0000-4000-8000-000000000177', 'jc',
      '98000000-0000-4000-8000-0000000000f1', '2026-09-08', 'xml', 'nfe', 'boleto', 'aberta', 20.00,
      '35260900000000000000550010000000098000000077', '77', '2026-09-08', 'pendente',
      '98000000-0000-4000-8000-00000000000a'
    );
    insert into public.payable_purchase_items (
      id, purchase_id, product_id, item_name, unit, quantity, unit_price, source_line_number,
      source_product_code, source_description, source_unit, source_quantity, conversion_basis,
      conversion_factor, usable_quantity, normalized_unit_cost, mapping_status
    ) values
      ('98000000-0000-4000-8000-0000000000c5', '98000000-0000-4000-8000-000000000077', null, 'PENDENTE 5', 'kg', 1, 10, 1,
       'PEN-5', '[TESTE] Pendente concorrente 5', 'kg', 1, 'simple', null, null, null, 'pendente'),
      ('98000000-0000-4000-8000-0000000000c6', '98000000-0000-4000-8000-000000000077', '98000000-0000-4000-8000-0000000000d1',
       '[TESTE] Farinha concorrente', 'kg', 1, 10, 2, 'FAR-77', '[TESTE] Farinha de 08/09', 'kg', 1, 'simple', 1, 1, 10, 'mapeado');
  $remote$
);

create function pg_temp.as_admin(p_connection text) returns void
language plpgsql as $$
begin
  perform extensions.dblink_exec(p_connection, 'begin');
  perform extensions.dblink_exec(p_connection, $t$set local statement_timeout = '15s'$t$);
  perform extensions.dblink_exec(p_connection, 'set local role authenticated');
  perform extensions.dblink_exec(p_connection, $sub$set local "request.jwt.claim.sub" = '98000000-0000-4000-8000-00000000000b'$sub$);
end;
$$;

-- Item da nota de 12/09 (074) que vai para a farinha certa.
create temporary table correcao_item as
select item.id
from public.payable_purchase_items item
join public.payable_purchases purchase on purchase.id = item.purchase_id
where purchase.nfe_key = '35260900000000000000550010000000098000000074';

create function pg_temp.correcao_json() returns text
language sql as $$
  select jsonb_build_array(jsonb_build_object(
    'item_id', (select id from correcao_item),
    'product_id', '98000000-0000-4000-8000-0000000000d2',
    'conversion_factor', 1))::text
$$;

-- A0. O destino vira fabricacao propria enquanto a correcao espera a trava do
-- produto: a correcao confere o cadastro depois de travar e recusa.
select extensions.dblink_exec('draft_holder', 'begin');
select extensions.dblink_exec('draft_holder',
  $q$update public.products set is_fabricacao_propria = true where id = '98000000-0000-4000-8000-0000000000d2'$q$);
select pg_temp.as_admin('draft_worker');
select extensions.dblink_send_query('draft_worker',
  format($q$select (public.correct_payable_purchase_items(null, 'previa', %L::jsonb) ->> 'mode')$q$, pg_temp.correcao_json()));
select ok(
  pg_temp.wait_for_lock((select pid from worker_backend)),
  'a correcao espera a trava do produto de destino que esta sendo alterado'
);
select extensions.dblink_exec('draft_holder', 'commit');
create temporary table destino_mudou as
select result from extensions.dblink_get_result('draft_worker', false) as response(result text);
select ok(
  extensions.dblink_error_message('draft_worker') like '%Escolha um produto ativo que se compra%',
  'com o destino virado fabricacao propria durante a espera, a correcao e recusada'
);
create temporary table destino_mudou_fim as
select result from extensions.dblink_get_result('draft_worker', false) as response(result text);
select extensions.dblink_exec('draft_worker', 'rollback');
select extensions.dblink_exec('draft_holder',
  $q$update public.products set is_fabricacao_propria = false where id = '98000000-0000-4000-8000-0000000000d2'$q$);

-- A. Duas correcoes: a segunda espera a primeira terminar.
select pg_temp.as_admin('draft_holder');
select extensions.dblink_exec('draft_holder',
  format($q$do $previa$ begin perform public.correct_payable_purchase_items(null, 'previa', %L::jsonb); end $previa$$q$, pg_temp.correcao_json()));
select pg_temp.as_admin('draft_worker');
select extensions.dblink_send_query('draft_worker',
  format($q$select (public.correct_payable_purchase_items(null, 'previa', %L::jsonb) ->> 'mode')$q$, pg_temp.correcao_json()));
select ok(
  pg_temp.wait_for_advisory((select pid from worker_backend)),
  'a segunda correcao de notas espera na fila unica enquanto a primeira nao terminou'
);
select extensions.dblink_exec('draft_holder', 'commit');
create temporary table segunda_correcao as
select result from extensions.dblink_get_result('draft_worker', false) as response(result text);
select is(extensions.dblink_error_message('draft_worker'), 'OK', 'a segunda correcao prossegue depois da primeira, sem erro');
create temporary table segunda_correcao_fim as
select result from extensions.dblink_get_result('draft_worker', false) as response(result text);
select extensions.dblink_exec('draft_worker', 'commit');
select is((select result from segunda_correcao), 'previa', 'a previa da segunda correcao responde depois da espera');

-- B. Classificacao segura o produto; a correcao que o envolve espera e termina.
select pg_temp.as_financeiro('draft_holder');
select extensions.dblink_exec('draft_holder',
  $q$do $classifica$ begin perform public.classify_payable_item('98000000-0000-4000-8000-0000000000c1', '98000000-0000-4000-8000-0000000000d1', 'simple', 1, 2, false, true); end $classifica$$q$);
select pg_temp.as_admin('draft_worker');
select extensions.dblink_send_query('draft_worker',
  format($q$select (public.correct_payable_purchase_items(null, 'previa', %L::jsonb) ->> 'mode')$q$, pg_temp.correcao_json()));
select ok(
  pg_temp.wait_for_lock((select pid from worker_backend)),
  'a correcao espera a classificacao que segura o mesmo produto'
);
select extensions.dblink_exec('draft_holder', 'commit');
create temporary table correcao_depois_da_classificacao as
select result from extensions.dblink_get_result('draft_worker', false) as response(result text);
select is(extensions.dblink_error_message('draft_worker'), 'OK', 'a correcao prossegue depois da classificacao, sem deadlock');
create temporary table correcao_depois_da_classificacao_fim as
select result from extensions.dblink_get_result('draft_worker', false) as response(result text);
select extensions.dblink_exec('draft_worker', 'commit');

-- C. Correcao aplicada segura itens e produtos; a classificacao que cai no
-- produto de destino espera e termina.
select pg_temp.as_admin('draft_holder');
select extensions.dblink_exec('draft_holder', format($q$do $aplica$
  declare v_hash text;
  begin
    v_hash := public.correct_payable_purchase_items(null, 'previa', %1$L::jsonb) ->> 'impact_hash';
    perform public.correct_payable_purchase_items('98000000-0000-4000-8000-0000000000c9', 'aplicar', %1$L::jsonb, null, v_hash);
  end $aplica$$q$, pg_temp.correcao_json()));
select pg_temp.as_financeiro('draft_worker');
select extensions.dblink_send_query('draft_worker',
  $q$select 'ok'::text from public.classify_payable_item('98000000-0000-4000-8000-0000000000c2', '98000000-0000-4000-8000-0000000000d2', 'simple', 1, 1, false, true)$q$);
select ok(
  pg_temp.wait_for_lock((select pid from worker_backend)),
  'a classificacao espera a correcao que segura o produto de destino'
);
select extensions.dblink_exec('draft_holder', 'commit');
create temporary table classificacao_depois_da_correcao as
select result from extensions.dblink_get_result('draft_worker', false) as response(result text);
select is(extensions.dblink_error_message('draft_worker'), 'OK', 'a classificacao prossegue depois da correcao, sem deadlock');
create temporary table classificacao_depois_da_correcao_fim as
select result from extensions.dblink_get_result('draft_worker', false) as response(result text);
select extensions.dblink_exec('draft_worker', 'commit');

-- E. Classificacao de um item pendente e correcao de outro item da MESMA nota.
-- A classificacao segura a conta e o item pendente e, ao recalcular o custo,
-- mexe nos outros itens da conta. A correcao espera pela conta sem segurar
-- item nenhum dela, e as duas terminam sem deadlock. A sessao da frente faz o
-- primeiro passo da classificacao (travar item e conta) a mao, para a correcao
-- chegar no meio, e depois chama a classificacao de verdade.
select extensions.dblink_exec('draft_holder', 'begin');
select extensions.dblink_exec('draft_holder', $q$set local statement_timeout = '15s'$q$);
select extensions.dblink_exec('draft_holder', $q$do $trava$ begin
  perform 1 from public.payable_purchase_items item
  join public.payable_purchases purchase on purchase.id = item.purchase_id
  where item.id = '98000000-0000-4000-8000-0000000000c5'
  for update of item, purchase;
end $trava$$q$);
select pg_temp.as_admin('draft_worker');
select extensions.dblink_send_query('draft_worker',
  $q$select (public.correct_payable_purchase_items(null, 'previa',
    '[{"item_id":"98000000-0000-4000-8000-0000000000c6","product_id":"98000000-0000-4000-8000-0000000000d2","conversion_factor":1}]') ->> 'mode')$q$);
select ok(
  pg_temp.wait_for_lock((select pid from worker_backend)),
  'a correcao de um item espera a conta que a classificacao de outro item da mesma nota segura'
);
select extensions.dblink_exec('draft_holder', 'set local role authenticated');
select extensions.dblink_exec('draft_holder', $sub$set local "request.jwt.claim.sub" = '98000000-0000-4000-8000-00000000000a'$sub$);
select is(
  extensions.dblink_exec('draft_holder', $q$do $classifica$ begin
    perform public.classify_payable_item('98000000-0000-4000-8000-0000000000c5', '98000000-0000-4000-8000-0000000000d1', 'simple', 1, 1, false, true);
  end $classifica$$q$, false),
  'DO',
  'a classificacao recalcula o custo mexendo no outro item da nota sem esbarrar na correcao'
);
select extensions.dblink_exec('draft_holder', 'commit');
create temporary table correcao_na_mesma_nota as
select result from extensions.dblink_get_result('draft_worker', false) as response(result text);
select is(extensions.dblink_error_message('draft_worker'), 'OK', 'a correcao prossegue depois da classificacao da mesma nota, sem deadlock');
create temporary table correcao_na_mesma_nota_fim as
select result from extensions.dblink_get_result('draft_worker', false) as response(result text);
select extensions.dblink_exec('draft_worker', 'commit');

-- D. A correcao tira da farinha o item que dava o custo (nota de 14/09) e
-- recalcula pela nota de 13/09, que ainda tem um item pendente. A classificacao
-- desse item espera a correcao e termina, sem deadlock.
select pg_temp.as_admin('draft_holder');
select extensions.dblink_exec('draft_holder', $q$do $aplica$
  declare
    v_items jsonb := '[{"item_id":"98000000-0000-4000-8000-0000000000c1","product_id":"98000000-0000-4000-8000-0000000000d2","conversion_factor":1}]';
    v_hash text;
  begin
    v_hash := public.correct_payable_purchase_items(null, 'previa', v_items) ->> 'impact_hash';
    perform public.correct_payable_purchase_items('98000000-0000-4000-8000-0000000000ca', 'aplicar', v_items, null, v_hash);
  end $aplica$$q$);
select pg_temp.as_financeiro('draft_worker');
select extensions.dblink_send_query('draft_worker',
  $q$select 'ok'::text from public.classify_payable_item('98000000-0000-4000-8000-0000000000c3', '98000000-0000-4000-8000-0000000000d1', 'simple', 1, 1, false, true)$q$);
select ok(
  pg_temp.wait_for_lock((select pid from worker_backend)),
  'a classificacao na nota que sobrou espera a correcao que recalcula a origem'
);
select extensions.dblink_exec('draft_holder', 'commit');
create temporary table classificacao_na_nota_restante as
select result from extensions.dblink_get_result('draft_worker', false) as response(result text);
select is(extensions.dblink_error_message('draft_worker'), 'OK', 'a classificacao na nota que sobrou prossegue, sem deadlock');
create temporary table classificacao_na_nota_restante_fim as
select result from extensions.dblink_get_result('draft_worker', false) as response(result text);
select extensions.dblink_exec('draft_worker', 'commit');
select is(
  (select cost_price from public.products where id = '98000000-0000-4000-8000-0000000000d1'),
  10.00::numeric,
  'a farinha fica com o custo da nota de 13/09 (20 / 2), recalculado pela correcao e pela classificacao'
);

select is(
  (select product_id from public.payable_purchase_items where id = (select id from correcao_item)),
  '98000000-0000-4000-8000-0000000000d2'::uuid,
  'o item corrigido ficou na farinha certa'
);
select is(
  (select count(*)::integer from public.payable_purchase_item_corrections
   where product_ids @> array['98000000-0000-4000-8000-0000000000d2']::uuid[]),
  2,
  'duas correcoes de notas no historico: as previas e a recusada nao gravaram'
);

-- Limpeza (as outras sessoes gravaram fora desta transacao).
select extensions.dblink_exec(
  'draft_holder',
  $remote$
    delete from public.payable_purchase_item_corrections where undoes_correction_id is not null
      and product_ids && array['98000000-0000-4000-8000-0000000000d1', '98000000-0000-4000-8000-0000000000d2']::uuid[];
    delete from public.payable_purchase_item_corrections
      where product_ids && array['98000000-0000-4000-8000-0000000000d1', '98000000-0000-4000-8000-0000000000d2']::uuid[];
    delete from public.payable_purchases where nfe_key in (
      '35260900000000000000550010000000098000000071', '35260900000000000000550010000000098000000072',
      '35260900000000000000550010000000098000000073', '35260900000000000000550010000000098000000074',
      '35260900000000000000550010000000098000000075', '35260900000000000000550010000000098000000076',
      '35260900000000000000550010000000098000000077');
    delete from public.products where id = '98000000-0000-4000-8000-0000000000d2';
    delete from public.payable_product_mapping_corrections where mapping_id = '98000000-0000-4000-8000-0000000000e9';
    delete from public.payable_product_mappings where id = '98000000-0000-4000-8000-0000000000e9';
    delete from public.app_profiles where user_id = '98000000-0000-4000-8000-00000000000b';
    delete from auth.users where id = '98000000-0000-4000-8000-00000000000b';
    delete from public.products where id = '98000000-0000-4000-8000-0000000000d1';
    delete from public.suppliers where id = '98000000-0000-4000-8000-0000000000f2';
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
