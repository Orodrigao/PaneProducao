begin;
set local statement_timeout = '90s';
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select no_plan();

-- Fase 2 de "Expedição lança Pedido PJ": a correção e o cancelamento pela
-- Expedição disputam o mesmo pedido com a conferência e com a alteração do
-- Financeiro. Duas conexões reais; a primeira segura a transação aberta, a
-- segunda espera a trava e só decide pelo estado que a primeira gravou:
--   A. conferência primeiro, correção depois: a correção é recusada;
--   B. correção primeiro, conferência depois: a conferência é recusada e a
--      correção fica;
--   C. conferência primeiro, cancelamento depois: o cancelamento é recusado;
--   D. cancelamento primeiro, conferência depois: a conferência é recusada;
--   E. alteração do Financeiro primeiro, correção da Expedição depois: a
--      correção é recusada pelo motivo do Financeiro;
--   F. a permissão é retirada enquanto a correção espera a trava: a correção
--      é recusada por acesso, sem gravar.
-- Tudo o que as conexões gravam é apagado no fim (e no começo, se uma rodada
-- anterior parou no meio).

create function pg_temp.conexao() returns text language sql as $$
  select format('hostaddr=%s port=%s dbname=%s user=postgres password=postgres',
    inet_server_addr(), current_setting('port'), current_database());
$$;

select extensions.dblink_connect('f2_setup', pg_temp.conexao());
select extensions.dblink_connect('f2_primeira', pg_temp.conexao());
select extensions.dblink_connect('f2_segunda', pg_temp.conexao());

create function pg_temp.limpar() returns void language sql as $$
  select extensions.dblink_exec('f2_setup', $remote$
    delete from private.pj_flow_events where order_group_id::text like '9e300000-%';
    delete from private.pj_flow where order_group_id::text like '9e300000-%';
    delete from private.pj_order_write_requests where order_group_id::text like '9e300000-%';
    delete from public.orders where order_group_id::text like '9e300000-%';
    delete from public.price_tier_items where tier_id = '9e300000-0000-4000-8000-0000000000f1';
    delete from public.customers where id = '9e300000-0000-4000-8000-0000000000c1';
    delete from public.price_tiers where id = '9e300000-0000-4000-8000-0000000000f1';
    delete from public.breads where id = 'teste-f2-concorrencia';
    delete from public.app_user_permissions where user_id::text like '9e300000-%';
    delete from public.app_profiles where user_id::text like '9e300000-%';
    delete from auth.users where id::text like '9e300000-%';
  $remote$);
$$;

select pg_temp.limpar();

select extensions.dblink_exec('f2_setup', $remote$
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
    created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin)
  values
   ('9e300000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated',
    'authenticated','f2-concorrencia-expedicao@example.com','',now(),now(),now(),
    '{"provider":"email","providers":["email"]}','{}',false),
   ('9e300000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated',
    'authenticated','f2-concorrencia-financeiro@example.com','',now(),now(),now(),
    '{"provider":"email","providers":["email"]}','{}',false);
  insert into public.app_profiles(user_id,display_name,role,store,active,allowed_routes)
  values
   ('9e300000-0000-4000-8000-000000000001','Expedicao concorrencia F2','expedicao','jc',true,'["/pedidos-pj"]'),
   ('9e300000-0000-4000-8000-000000000002','Financeiro concorrencia F2','financeiro','jc',true,'["/pedidos-pj"]');
  insert into public.app_user_permissions(user_id,permission_key,scope)
  values
   ('9e300000-0000-4000-8000-000000000001','pedidos_pj.acessar','jc'),
   ('9e300000-0000-4000-8000-000000000001','pedidos_pj.confirmar_envio','jc'),
   ('9e300000-0000-4000-8000-000000000001','pedidos_pj.lancar','jc'),
   ('9e300000-0000-4000-8000-000000000002','pedidos_pj.acessar','jc'),
   ('9e300000-0000-4000-8000-000000000002','contas_receber.acessar','jc');
  insert into public.price_tiers(id,name) values ('9e300000-0000-4000-8000-0000000000f1','Tabela concorrencia F2');
  insert into public.customers(id,name,doc,payment_term_days,default_tier_id,discount_pct,active)
  values ('9e300000-0000-4000-8000-0000000000c1','Cliente concorrencia F2','00000000000301',7,
    '9e300000-0000-4000-8000-0000000000f1',0,true);
  insert into public.breads(id,name,days,active,unit,is_special,is_shelf)
  values ('teste-f2-concorrencia','Pao concorrencia F2','{0,1,2,3,4,5,6}',true,'un',false,false);
  insert into public.price_tier_items(tier_id,product_id,product_source,product_name,unit_price,pricing_unit,pack_size,sale_option_id,active)
  values ('9e300000-0000-4000-8000-0000000000f1','teste-f2-concorrencia','bread','Pao concorrencia F2',4,'un',1,null,true);
$remote$);

-- Cada corrida parte de um pedido novo, lançado pela Expedição.
create function pg_temp.lancar(p_group text) returns void language sql as $$
  select extensions.dblink_exec('f2_setup', format($remote$
    set local role authenticated;
    set local "request.jwt.claims" = '{"sub":"9e300000-0000-4000-8000-000000000001","role":"authenticated"}';
    do $block$ begin
      perform public.create_pj_order_by_expedition(gen_random_uuid(), %L, '9e300000-0000-4000-8000-0000000000c1',
        private.data_na_padaria() + 2, null,
        '[{"product_source":"bread","product_id":"teste-f2-concorrencia","packs":3,"quantity":3,"unit":"un"}]');
    end $block$;
  $remote$, p_group));
$$;

create function pg_temp.como(p_conexao text, p_user text) returns void language sql as $$
  select extensions.dblink_exec(p_conexao, 'set local role authenticated');
  select extensions.dblink_exec(p_conexao, format('set local "request.jwt.claims" = %L',
    jsonb_build_object('sub', p_user, 'role', 'authenticated')::text));
$$;

-- Itens e versão do pedido, lidos com a conexão administrativa.
create function pg_temp.itens(p_group text) returns text language sql as $$
  select items from extensions.dblink('f2_setup', format($remote$
    select jsonb_agg(jsonb_build_object('id', id, 'quantity', quantity, 'reason', null) order by id)::text
    from public.orders where order_group_id = %L$remote$, p_group)) as r(items text);
$$;
create function pg_temp.versao(p_group text) returns text language sql as $$
  select body from extensions.dblink('f2_setup', format($remote$
    select jsonb_agg(jsonb_build_object('id', id, 'updated_at', updated_at) order by id)::text
    from public.orders where order_group_id = %L$remote$, p_group)) as r(body text);
$$;
create function pg_temp.quantidades(p_group text) returns text language sql as $$
  select body from extensions.dblink('f2_setup', format($remote$
    select coalesce(string_agg(trim_scale(quantity)::text || case when cancelled_at is null then '' else ' cancelada' end,
      ',' order by id), 'nenhuma')
    from public.orders where order_group_id = %L$remote$, p_group)) as r(body text);
$$;
create function pg_temp.na_jornada(p_group text) returns boolean language sql as $$
  select found from extensions.dblink('f2_setup', format($remote$
    select exists (select 1 from private.pj_flow where order_group_id = %L)$remote$, p_group)) as r(found boolean);
$$;

create temporary table segunda_backend as
select pid from extensions.dblink('f2_segunda', 'select pg_backend_pid()') as response(pid integer);

-- A segunda conexão está parada numa trava (linha ou advisory).
create function pg_temp.esperando() returns boolean language plpgsql as $$
declare v_deadline timestamptz := clock_timestamp() + interval '5 seconds';
begin
  loop
    perform pg_catalog.pg_stat_clear_snapshot();
    if exists (select 1 from pg_catalog.pg_stat_activity
      where pid = (select pid from segunda_backend) and wait_event_type = 'Lock') then
      return true;
    end if;
    if clock_timestamp() >= v_deadline then return false; end if;
    perform pg_sleep(0.05);
  end loop;
end;
$$;

-- Termina a segunda conexão: devolve a mensagem de erro (ou 'sem erro') e
-- desfaz o que ela tiver aberto.
create function pg_temp.resultado_da_segunda() returns text language plpgsql as $$
declare v_message text;
begin
  perform * from extensions.dblink_get_result('f2_segunda', false) as response(result text);
  v_message := extensions.dblink_error_message('f2_segunda');
  perform * from extensions.dblink_get_result('f2_segunda', false) as response(result text);
  perform extensions.dblink_exec('f2_segunda', 'rollback');
  return case when v_message = 'OK' then 'sem erro' else v_message end;
end;
$$;

-- -------------------------------------------------------------------------
-- A. Conferência primeiro, correção depois.
-- -------------------------------------------------------------------------
select pg_temp.lancar('9e300000-0000-4000-8000-0000000002a1');
create temporary table corrida_a as select pg_temp.itens('9e300000-0000-4000-8000-0000000002a1') as itens,
  pg_temp.versao('9e300000-0000-4000-8000-0000000002a1') as versao;

select extensions.dblink_exec('f2_primeira', 'begin');
select pg_temp.como('f2_primeira', '9e300000-0000-4000-8000-000000000001');
select extensions.dblink_exec('f2_primeira', format($remote$
  do $block$ begin perform public.transition_pj_flow_pilot(gen_random_uuid(), '9e300000-0000-4000-8000-0000000002a1', 0, 'save', %L::jsonb); end $block$
$remote$, (select itens from corrida_a)));

select extensions.dblink_exec('f2_segunda', 'begin');
select pg_temp.como('f2_segunda', '9e300000-0000-4000-8000-000000000001');
select extensions.dblink_send_query('f2_segunda', format($remote$
  select public.replace_pj_order_by_expedition(gen_random_uuid(), '9e300000-0000-4000-8000-0000000002a1',
    private.data_na_padaria() + 2, null,
    '[{"product_source":"bread","product_id":"teste-f2-concorrencia","packs":7,"quantity":7,"unit":"un"}]', %L::jsonb)::text
$remote$, (select versao from corrida_a)));
select ok(pg_temp.esperando(), 'A: a correcao espera a conferencia em andamento');
select extensions.dblink_exec('f2_primeira', 'commit');
select ok(pg_temp.resultado_da_segunda() ilike '%A conferência deste pedido já começou%',
  'A: depois da conferencia gravada a correcao e recusada');
select is(pg_temp.quantidades('9e300000-0000-4000-8000-0000000002a1'), '3',
  'A: o pedido fica com a quantidade conferida');

-- -------------------------------------------------------------------------
-- B. Correção primeiro, conferência depois.
-- -------------------------------------------------------------------------
select pg_temp.lancar('9e300000-0000-4000-8000-0000000002b1');
create temporary table corrida_b as select pg_temp.itens('9e300000-0000-4000-8000-0000000002b1') as itens,
  pg_temp.versao('9e300000-0000-4000-8000-0000000002b1') as versao;

select extensions.dblink_exec('f2_primeira', 'begin');
select pg_temp.como('f2_primeira', '9e300000-0000-4000-8000-000000000001');
select extensions.dblink_exec('f2_primeira', format($remote$
  do $block$ begin perform public.replace_pj_order_by_expedition(gen_random_uuid(), '9e300000-0000-4000-8000-0000000002b1',
    private.data_na_padaria() + 2, null,
    '[{"product_source":"bread","product_id":"teste-f2-concorrencia","packs":7,"quantity":7,"unit":"un"}]', %L::jsonb); end $block$
$remote$, (select versao from corrida_b)));

select extensions.dblink_exec('f2_segunda', 'begin');
select pg_temp.como('f2_segunda', '9e300000-0000-4000-8000-000000000001');
select extensions.dblink_send_query('f2_segunda', format($remote$
  select public.transition_pj_flow_pilot(gen_random_uuid(), '9e300000-0000-4000-8000-0000000002b1', 0, 'save', %L::jsonb)::text
$remote$, (select itens from corrida_b)));
select ok(pg_temp.esperando(), 'B: a conferencia espera a correcao em andamento');
select extensions.dblink_exec('f2_primeira', 'commit');
select ok(pg_temp.resultado_da_segunda() ilike '%Item nao pertence ao pedido%',
  'B: a conferencia feita sobre a versao antiga e recusada');
select is(pg_temp.quantidades('9e300000-0000-4000-8000-0000000002b1'), '7', 'B: a correcao fica gravada');

-- -------------------------------------------------------------------------
-- C. Conferência primeiro, cancelamento depois.
-- -------------------------------------------------------------------------
select pg_temp.lancar('9e300000-0000-4000-8000-0000000002c1');
create temporary table corrida_c as select pg_temp.itens('9e300000-0000-4000-8000-0000000002c1') as itens;

select extensions.dblink_exec('f2_primeira', 'begin');
select pg_temp.como('f2_primeira', '9e300000-0000-4000-8000-000000000001');
select extensions.dblink_exec('f2_primeira', format($remote$
  do $block$ begin perform public.transition_pj_flow_pilot(gen_random_uuid(), '9e300000-0000-4000-8000-0000000002c1', 0, 'save', %L::jsonb); end $block$
$remote$, (select itens from corrida_c)));

select extensions.dblink_exec('f2_segunda', 'begin');
select pg_temp.como('f2_segunda', '9e300000-0000-4000-8000-000000000001');
select extensions.dblink_send_query('f2_segunda', $remote$
  select public.cancel_pj_order_by_expedition(gen_random_uuid(), '9e300000-0000-4000-8000-0000000002c1',
    'Cliente desistiu')::text
$remote$);
select ok(pg_temp.esperando(), 'C: o cancelamento espera a conferencia em andamento');
select extensions.dblink_exec('f2_primeira', 'commit');
select ok(pg_temp.resultado_da_segunda() ilike '%A conferência deste pedido já começou%',
  'C: depois da conferencia gravada o cancelamento e recusado');
select is(pg_temp.quantidades('9e300000-0000-4000-8000-0000000002c1'), '3', 'C: o pedido segue sem cancelar');
select ok(pg_temp.na_jornada('9e300000-0000-4000-8000-0000000002c1'), 'C: o pedido segue na jornada');

-- -------------------------------------------------------------------------
-- D. Cancelamento primeiro, conferência depois.
-- -------------------------------------------------------------------------
select pg_temp.lancar('9e300000-0000-4000-8000-0000000002d1');
create temporary table corrida_d as select pg_temp.itens('9e300000-0000-4000-8000-0000000002d1') as itens;

select extensions.dblink_exec('f2_primeira', 'begin');
select pg_temp.como('f2_primeira', '9e300000-0000-4000-8000-000000000001');
select extensions.dblink_exec('f2_primeira', $remote$
  do $block$ begin perform public.cancel_pj_order_by_expedition(gen_random_uuid(), '9e300000-0000-4000-8000-0000000002d1',
    'Cliente desistiu'); end $block$
$remote$);

select extensions.dblink_exec('f2_segunda', 'begin');
select pg_temp.como('f2_segunda', '9e300000-0000-4000-8000-000000000001');
select extensions.dblink_send_query('f2_segunda', format($remote$
  select public.transition_pj_flow_pilot(gen_random_uuid(), '9e300000-0000-4000-8000-0000000002d1', 0, 'save', %L::jsonb)::text
$remote$, (select itens from corrida_d)));
select ok(pg_temp.esperando(), 'D: a conferencia espera o cancelamento em andamento');
select extensions.dblink_exec('f2_primeira', 'commit');
select ok(pg_temp.resultado_da_segunda() ilike '%Novo fluxo indisponivel para este pedido%',
  'D: depois do cancelamento gravado a conferencia e recusada');
select is(pg_temp.quantidades('9e300000-0000-4000-8000-0000000002d1'), '3 cancelada', 'D: o pedido fica cancelado');

-- -------------------------------------------------------------------------
-- E. Alteração do Financeiro primeiro, correção da Expedição depois.
-- -------------------------------------------------------------------------
select pg_temp.lancar('9e300000-0000-4000-8000-0000000002e1');
create temporary table corrida_e as select pg_temp.versao('9e300000-0000-4000-8000-0000000002e1') as versao,
  (select rows from extensions.dblink('f2_setup', $remote$
    select jsonb_agg(jsonb_build_object('bread_id', bread_id, 'product_source', product_source,
      'product_name', product_name, 'quantity', 5, 'unit_price', unit_price, 'pack_size', pack_size,
      'pricing_unit', pricing_unit, 'customer_id', customer_id, 'pj_client', pj_client,
      'order_date', order_date, 'delivery_date', delivery_date) order by id)::text
    from public.orders where order_group_id = '9e300000-0000-4000-8000-0000000002e1'$remote$) as r(rows text)) as linhas;

select extensions.dblink_exec('f2_primeira', 'begin');
select pg_temp.como('f2_primeira', '9e300000-0000-4000-8000-000000000002');
select extensions.dblink_exec('f2_primeira', format($remote$
  do $block$ begin perform public.replace_pj_order_atomic_v2(gen_random_uuid(), '9e300000-0000-4000-8000-0000000002e1', %L::jsonb, %L::jsonb); end $block$
$remote$, (select linhas from corrida_e), (select versao from corrida_e)));

select extensions.dblink_exec('f2_segunda', 'begin');
select pg_temp.como('f2_segunda', '9e300000-0000-4000-8000-000000000001');
select extensions.dblink_send_query('f2_segunda', format($remote$
  select public.replace_pj_order_by_expedition(gen_random_uuid(), '9e300000-0000-4000-8000-0000000002e1',
    private.data_na_padaria() + 2, null,
    '[{"product_source":"bread","product_id":"teste-f2-concorrencia","packs":7,"quantity":7,"unit":"un"}]', %L::jsonb)::text
$remote$, (select versao from corrida_e)));
select ok(pg_temp.esperando(), 'E: a correcao da Expedicao espera a alteracao do Financeiro em andamento');
select extensions.dblink_exec('f2_primeira', 'commit');
select ok(pg_temp.resultado_da_segunda() ilike '%O Financeiro alterou este pedido%',
  'E: depois da alteracao do Financeiro a correcao da Expedicao e recusada');
select is(pg_temp.quantidades('9e300000-0000-4000-8000-0000000002e1'), '5', 'E: fica a alteracao do Financeiro');

-- -------------------------------------------------------------------------
-- F. Permissão retirada enquanto a correção espera a trava.
-- -------------------------------------------------------------------------
select pg_temp.lancar('9e300000-0000-4000-8000-0000000002f1');
create temporary table corrida_f as select pg_temp.versao('9e300000-0000-4000-8000-0000000002f1') as versao;

-- A primeira conexão segura a mesma vaga que as gravações de Pedido PJ usam.
select extensions.dblink_exec('f2_primeira', 'begin');
select extensions.dblink_exec('f2_primeira', $remote$
  do $block$ begin
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pane-pj-controlled-real-slot', 0));
  end $block$
$remote$);

select extensions.dblink_exec('f2_segunda', 'begin');
select pg_temp.como('f2_segunda', '9e300000-0000-4000-8000-000000000001');
select extensions.dblink_send_query('f2_segunda', format($remote$
  select public.replace_pj_order_by_expedition(gen_random_uuid(), '9e300000-0000-4000-8000-0000000002f1',
    private.data_na_padaria() + 2, null,
    '[{"product_source":"bread","product_id":"teste-f2-concorrencia","packs":7,"quantity":7,"unit":"un"}]', %L::jsonb)::text
$remote$, (select versao from corrida_f)));
select ok(pg_temp.esperando(), 'F: a correcao ja autorizada espera a vaga');
select extensions.dblink_exec('f2_setup', $remote$
  delete from public.app_user_permissions
  where user_id = '9e300000-0000-4000-8000-000000000001' and permission_key = 'pedidos_pj.lancar'
$remote$);
select extensions.dblink_exec('f2_primeira', 'commit');
select ok(pg_temp.resultado_da_segunda() ilike '%Sem permissao para corrigir Pedido PJ pela Expedicao%',
  'F: a permissao retirada durante a espera recusa a correcao');
select is(pg_temp.quantidades('9e300000-0000-4000-8000-0000000002f1'), '3', 'F: o pedido fica como estava');

select pg_temp.limpar();
select extensions.dblink_disconnect('f2_segunda');
select extensions.dblink_disconnect('f2_primeira');
select extensions.dblink_disconnect('f2_setup');

select * from finish();
rollback;
