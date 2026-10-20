begin;
set local statement_timeout = '90s';
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select no_plan();

-- PR 511 (Tabela Buck: trocar preco com data), achados 1 e 3 da revisao de
-- outra familia. Duas conexoes reais; um portao de teste para a primeira
-- depois que ela ja pegou as travas, e a corrida fica deterministica:
--   A. cobranca antiga primeiro, troca retroativa depois: a troca espera a
--      trava da semana e passa a ser recusada pela semana cobrada;
--   B. troca primeiro, cobranca antiga depois: a cobranca espera e sai pelo
--      preco novo, o mesmo que o historico da para o periodo;
--   C. troca primeiro, previa depois: a previa espera e calcula o antes e o
--      depois sobre o mesmo estado, com a versao da troca que terminou.
-- Tudo o que as conexoes gravam e apagado no fim (e no comeco, se uma rodada
-- anterior parou no meio).

create function pg_temp.conexao() returns text language sql as $$
  select format('hostaddr=%s port=%s dbname=%s user=postgres password=postgres',
    inet_server_addr(), current_setting('port'), current_database());
$$;

select extensions.dblink_connect('pr511_setup', pg_temp.conexao());
select extensions.dblink_connect('pr511_portao', pg_temp.conexao());
select extensions.dblink_connect('pr511_primeira', pg_temp.conexao());
select extensions.dblink_connect('pr511_segunda', pg_temp.conexao());

create function pg_temp.limpar() returns void language sql as $$
  select extensions.dblink_exec('pr511_setup', $remote$
    drop trigger if exists test_pr511_portao on public.receivables;
    drop trigger if exists test_pr511_portao on public.buck_price_history;
    drop function if exists private.test_pr511_portao();
    delete from public.receivables
      where request_id in ('98300000-0000-4000-8000-0000000000c1',
                           '98300000-0000-4000-8000-0000000000c2');
    delete from public.romaneio_items
      where id in ('98300000-0000-4000-8000-0000000000d1',
                   '98300000-0000-4000-8000-0000000000d2',
                   '98300000-0000-4000-8000-0000000000d3');
    delete from public.romaneios
      where id in ('98300000-0000-4000-8000-0000000000f1',
                   '98300000-0000-4000-8000-0000000000f2',
                   '98300000-0000-4000-8000-0000000000f3');
    delete from public.price_tier_items where id = '98300000-0000-4000-8000-0000000000a1';
    delete from public.buck_price_history where price_tier_item_id = '98300000-0000-4000-8000-0000000000a1';
    delete from public.app_user_permissions where user_id = '98300000-0000-4000-8000-000000000001';
    delete from public.app_profiles where user_id = '98300000-0000-4000-8000-000000000001';
    delete from auth.users where id = '98300000-0000-4000-8000-000000000001';
  $remote$);
$$;

select pg_temp.limpar();

-- Pao proprio na Tabela Buck a 5,00/un e tres romaneios da EX, um em cada
-- semana: 07/09 (corrida A), 14/09 (B) e 21/09 (C). Datas fixas, longe das
-- relativas a "hoje" e das cobrancas do seed (31/08 e 28/09).
select extensions.dblink_exec('pr511_setup', $remote$
  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin
  ) values (
    '98300000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated','authenticated','pr511-financeiro-concorrencia@example.com','',
    now(),now(),now(),'{"provider":"email","providers":["email"]}','{}',false
  );
  insert into public.app_profiles(user_id,display_name,role,store,active,allowed_routes)
  values ('98300000-0000-4000-8000-000000000001',
    'Financeiro concorrencia PR 511','financeiro','jc',true,'["/contas-receber","/tabelas-preco"]');
  insert into public.app_user_permissions(user_id,permission_key,scope)
  values
    ('98300000-0000-4000-8000-000000000001','contas_receber.acessar','jc'),
    ('98300000-0000-4000-8000-000000000001','contas_receber.lancar','jc');

  insert into public.breads (id, name, days, active, unit, is_special, is_shelf)
  values ('teste-pr511-concorrencia', '[TESTE] Pao Concorrencia PR 511', '{0,1,2,3,4,5,6}', true, 'un', false, false)
  on conflict (id) do nothing;

  insert into public.price_tier_items (
    id, tier_id, product_id, product_source, product_name, unit_price, pricing_unit, pack_size, active
  ) values (
    '98300000-0000-4000-8000-0000000000a1', private.buck_tier_id(),
    'teste-pr511-concorrencia', 'bread', '[TESTE] Pao Concorrencia PR 511', 5.00, 'un', 1, true
  );

  insert into public.romaneios (id, destination_id, record_date, trip_number, status, created_by)
  select romaneio.id, destino.id, romaneio.record_date, 1, 'enviado', 'Teste PR 511'
  from (values
    ('98300000-0000-4000-8000-0000000000f1'::uuid, date '2026-09-08'),
    ('98300000-0000-4000-8000-0000000000f2'::uuid, date '2026-09-15'),
    ('98300000-0000-4000-8000-0000000000f3'::uuid, date '2026-09-22')
  ) as romaneio(id, record_date)
  cross join lateral (
    select id from public.destinations where upper(code) = 'EX' and active order by id limit 1
  ) destino;

  insert into public.romaneio_items (id, romaneio_id, product_id, product_source, product_name, qty_sent, qty_accepted)
  values
    ('98300000-0000-4000-8000-0000000000d1', '98300000-0000-4000-8000-0000000000f1',
     'teste-pr511-concorrencia', 'bread', '[TESTE] Pao Concorrencia PR 511', 10, null),
    ('98300000-0000-4000-8000-0000000000d2', '98300000-0000-4000-8000-0000000000f2',
     'teste-pr511-concorrencia', 'bread', '[TESTE] Pao Concorrencia PR 511', 10, null),
    ('98300000-0000-4000-8000-0000000000d3', '98300000-0000-4000-8000-0000000000f3',
     'teste-pr511-concorrencia', 'bread', '[TESTE] Pao Concorrencia PR 511', 10, null);

  -- Portao: a primeira conexao para aqui, ja com as travas que pegou, ate o
  -- teste soltar.
  create function private.test_pr511_portao() returns trigger
  language plpgsql set search_path='' as $trigger$
  begin
    if pg_catalog.current_setting('application_name')
       in ('pr511-cobranca-primeira', 'pr511-troca-primeira') then
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('test:pr511:portao', 0));
    end if;
    return new;
  end;
  $trigger$;
  create trigger test_pr511_portao
    before insert on public.receivables
    for each row execute function private.test_pr511_portao();
  create trigger test_pr511_portao
    before insert on public.buck_price_history
    for each row execute function private.test_pr511_portao();
$remote$);

create temporary table pr511_backends as
select 'primeira'::text conexao, pid from extensions.dblink(
  'pr511_primeira', 'select pg_backend_pid()') as resposta(pid integer)
union all
select 'segunda', pid from extensions.dblink(
  'pr511_segunda', 'select pg_backend_pid()') as resposta(pid integer);

-- Espera a conexao parar numa trava consultiva (portao ou semana).
create function pg_temp.parou_em_trava(p_conexao text) returns boolean
language plpgsql as $$
declare
  v_pid integer := (select pid from pr511_backends where conexao = p_conexao);
  v_limite timestamptz := clock_timestamp() + interval '5 seconds';
begin
  loop
    perform pg_catalog.pg_stat_clear_snapshot();
    if exists (select 1 from pg_catalog.pg_stat_activity
      where pid = v_pid and wait_event_type = 'Lock' and wait_event = 'advisory') then
      return true;
    end if;
    if clock_timestamp() >= v_limite then return false; end if;
    perform pg_sleep(0.05);
  end loop;
end;
$$;

-- O que a segunda conexao fez enquanto a primeira estava no portao:
-- 'esperando' numa trava consultiva (a correcao), 'terminou' sem esperar ou
-- 'outra_espera' (presa em outra trava, como a da linha).
create function pg_temp.segunda_enquanto_portao() returns text
language plpgsql as $$
declare
  v_pid integer := (select pid from pr511_backends where conexao = 'segunda');
  v_limite timestamptz := clock_timestamp() + interval '5 seconds';
begin
  loop
    perform pg_catalog.pg_stat_clear_snapshot();
    if extensions.dblink_is_busy('pr511_segunda') = 0 then
      return 'terminou';
    end if;
    if exists (select 1 from pg_catalog.pg_stat_activity
      where pid = v_pid and wait_event_type = 'Lock' and wait_event = 'advisory') then
      return 'esperando';
    end if;
    if clock_timestamp() >= v_limite then return 'outra_espera'; end if;
    perform pg_sleep(0.05);
  end loop;
end;
$$;

create function pg_temp.fechar_portao() returns void language sql as $f$
  select extensions.dblink_exec('pr511_portao',
    'do $g$ begin perform pg_catalog.pg_advisory_lock(pg_catalog.hashtextextended(''test:pr511:portao'', 0)); end $g$');
$f$;

create function pg_temp.abrir_portao() returns void language sql as $f$
  select extensions.dblink_exec('pr511_portao',
    'do $g$ begin perform pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended(''test:pr511:portao'', 0)); end $g$');
$f$;

create function pg_temp.preparar(p_conexao text, p_nome text) returns void language sql as $f$
  select extensions.dblink_exec(p_conexao, 'reset role');
  select extensions.dblink_exec(p_conexao, $$set statement_timeout = '30s'$$);
  select extensions.dblink_exec(p_conexao, format('set application_name = %L', p_nome));
  select extensions.dblink_exec(p_conexao, 'set role authenticated');
  select extensions.dblink_exec(p_conexao,
    $$set "request.jwt.claim.sub" = '98300000-0000-4000-8000-000000000001'$$);
$f$;

-- Leituras do estado gravado pela conexao de apoio: a transacao do pgTAP nao
-- toca nas tabelas e nao segura travas ate o rollback.
create function pg_temp.ler(p_sql text) returns text language sql as $$
  select resposta.valor from extensions.dblink('pr511_setup', p_sql) as resposta(valor text);
$$;

-- O dblink devolve "ERROR:  <mensagem>" e o contexto; fica so a mensagem.
create function pg_temp.mensagem(p_erro text) returns text language sql as $$
  select split_part(regexp_replace(p_erro, '^ERROR:\s+', ''), E'\n', 1);
$$;

create temporary table pr511_resultado (
  corrida text, conexao text, resultado text, erro text, durante_portao text
);

create function pg_temp.colher(p_corrida text, p_durante text) returns void
language plpgsql as $$
begin
  insert into pr511_resultado
  select p_corrida, 'primeira', resposta.valor, pg_temp.mensagem(extensions.dblink_error_message('pr511_primeira')), null
  from extensions.dblink_get_result('pr511_primeira', false) as resposta(valor text);
  insert into pr511_resultado
  select p_corrida, 'segunda', resposta.valor, pg_temp.mensagem(extensions.dblink_error_message('pr511_segunda')), p_durante
  from extensions.dblink_get_result('pr511_segunda', false) as resposta(valor text);
  -- Sem linha de resultado (erro), registra so o erro.
  if not exists (select 1 from pr511_resultado where corrida = p_corrida and conexao = 'primeira') then
    insert into pr511_resultado values (p_corrida, 'primeira', null, pg_temp.mensagem(extensions.dblink_error_message('pr511_primeira')), null);
  end if;
  if not exists (select 1 from pr511_resultado where corrida = p_corrida and conexao = 'segunda') then
    insert into pr511_resultado values (p_corrida, 'segunda', null, pg_temp.mensagem(extensions.dblink_error_message('pr511_segunda')), p_durante);
  end if;
  -- Esvazia a fila de resultados das duas conexoes para a proxima corrida.
  perform extensions.dblink_get_result('pr511_primeira', false);
  perform extensions.dblink_get_result('pr511_segunda', false);
end;
$$;

-- Versao do preco que a "tela" leu antes de decidir.
create function pg_temp.versao_agora() returns bigint language sql as $f$
  select pg_temp.ler($$select coalesce(max(seq), 0)::text from public.buck_price_history
    where price_tier_item_id = '98300000-0000-4000-8000-0000000000a1'$$)::bigint;
$f$;

-- A. Cobranca antiga primeiro; troca retroativa para dentro do periodo -------

select pg_temp.fechar_portao();
select pg_temp.preparar('pr511_primeira', 'pr511-cobranca-primeira');
select extensions.dblink_send_query('pr511_primeira', $q$
  select public.create_receivable_from_romaneio(
    '98300000-0000-4000-8000-0000000000c1', date '2026-09-07', date '2026-09-13', null)::text
$q$);
select ok(pg_temp.parou_em_trava('primeira'),
  'A: a cobranca calculou e parou no portao antes de gravar');

select pg_temp.preparar('pr511_segunda', 'pr511-troca-segunda');
select extensions.dblink_send_query('pr511_segunda', format($q$
  select public.trocar_preco_buck(
    '98300000-0000-4000-8000-0000000000a1', 6.00, 'un', date '2026-09-08',
    'reajuste_combinado', 'corrida A', %s)::text
$q$, pg_temp.versao_agora()));
select set_config('pr511.durante', pg_temp.segunda_enquanto_portao(), true);
select pg_temp.abrir_portao();
select pg_temp.colher('A', current_setting('pr511.durante'));

select is((select durante_portao from pr511_resultado where corrida = 'A' and conexao = 'segunda'),
  'esperando', 'A: a troca esperou a trava da semana que a cobranca segurava');
select is((select erro from pr511_resultado where corrida = 'A' and conexao = 'primeira'),
  'OK', 'A: a cobranca gravou');
select is((select erro from pr511_resultado where corrida = 'A' and conexao = 'segunda'),
  'Escolha 14/09/2026 ou depois: antes disso este pão já entrou numa cobrança da Buck confirmada. Diferença de semana cobrada vai como acerto na próxima cobrança.',
  'A: a troca, ao entrar, enxerga a cobranca e e recusada');
select is(pg_temp.ler($$select amount::text from public.receivables
    where request_id = '98300000-0000-4000-8000-0000000000c1'$$),
  '50.00', 'A: a cobranca saiu com 10 x 5,00');
select is(pg_temp.ler($$select unit_price::text from private.buck_preco_na_data(
    '98300000-0000-4000-8000-0000000000a1', date '2026-09-08')$$),
  '5.00', 'A: o historico continua dando 5,00 para o periodo cobrado');

-- B. Troca primeiro; cobranca antiga do periodo da troca depois ---------------

select pg_temp.fechar_portao();
select pg_temp.preparar('pr511_primeira', 'pr511-troca-primeira');
select extensions.dblink_send_query('pr511_primeira', format($q$
  select public.trocar_preco_buck(
    '98300000-0000-4000-8000-0000000000a1', 7.00, 'un', date '2026-09-15',
    'reajuste_combinado', 'corrida B', %s)::text
$q$, pg_temp.versao_agora()));
select ok(pg_temp.parou_em_trava('primeira'),
  'B: a troca pegou as travas e parou no portao antes de gravar o historico');

select pg_temp.preparar('pr511_segunda', 'pr511-cobranca-segunda');
select extensions.dblink_send_query('pr511_segunda', $q$
  select public.create_receivable_from_romaneio(
    '98300000-0000-4000-8000-0000000000c2', date '2026-09-14', date '2026-09-20', null)::text
$q$);
select set_config('pr511.durante', pg_temp.segunda_enquanto_portao(), true);
select pg_temp.abrir_portao();
select pg_temp.colher('B', current_setting('pr511.durante'));

select is((select durante_portao from pr511_resultado where corrida = 'B' and conexao = 'segunda'),
  'esperando', 'B: a cobranca esperou a trava da semana que a troca segurava');
select is((select erro from pr511_resultado where corrida = 'B' and conexao = 'primeira'),
  'OK', 'B: a troca gravou');
select is((select erro from pr511_resultado where corrida = 'B' and conexao = 'segunda'),
  'OK', 'B: a cobranca gravou');
select is(pg_temp.ler($$select amount::text from public.receivables
    where request_id = '98300000-0000-4000-8000-0000000000c2'$$),
  '70.00', 'B: a cobranca saiu pelo preco novo: 10 x 7,00');
select is(pg_temp.ler($$select ((select amount from public.receivables
      where request_id = '98300000-0000-4000-8000-0000000000c2')
    = (select sum(total) from private.calcular_cobranca_buck(date '2026-09-14', date '2026-09-20')))::text$$),
  'true', 'B: cobranca e historico dao o mesmo valor para a semana');

-- C. Troca primeiro; previa de outra troca depois ----------------------------

select pg_temp.fechar_portao();
select pg_temp.preparar('pr511_primeira', 'pr511-troca-primeira');
select extensions.dblink_send_query('pr511_primeira', format($q$
  select public.trocar_preco_buck(
    '98300000-0000-4000-8000-0000000000a1', 8.00, 'un', date '2026-09-22',
    'reajuste_combinado', 'corrida C', %s)::text
$q$, pg_temp.versao_agora()));
select ok(pg_temp.parou_em_trava('primeira'),
  'C: a troca pegou as travas e parou no portao antes de gravar o historico');

select pg_temp.preparar('pr511_segunda', 'pr511-previa-segunda');
select extensions.dblink_send_query('pr511_segunda', $q$
  select public.previa_troca_preco_buck(
    '98300000-0000-4000-8000-0000000000a1', 9.00, 'un', date '2026-09-22')::text
$q$);
select set_config('pr511.durante', pg_temp.segunda_enquanto_portao(), true);
select pg_temp.abrir_portao();
select pg_temp.colher('C', current_setting('pr511.durante'));

select is((select durante_portao from pr511_resultado where corrida = 'C' and conexao = 'segunda'),
  'esperando', 'C: a previa esperou a trava da semana, antes de ler qualquer coisa');
select is((select erro from pr511_resultado where corrida = 'C' and conexao = 'primeira'),
  'OK', 'C: a troca gravou');
select is((select erro from pr511_resultado where corrida = 'C' and conexao = 'segunda'),
  'OK', 'C: a previa respondeu');
select is(
  (select (resultado::jsonb -> 'semanas' -> 0 ->> 'antes') || ' -> ' || (resultado::jsonb -> 'semanas' -> 0 ->> 'depois')
     from pr511_resultado where corrida = 'C' and conexao = 'segunda'),
  '80.00 -> 90.00', 'C: o antes ja e o preco da troca que terminou (10 x 8,00), nao o anterior');
select is(
  (select (resultado::jsonb -> 'vigente' ->> 'unit_price') || ' v' || (resultado::jsonb ->> 'versao')
     from pr511_resultado where corrida = 'C' and conexao = 'segunda'),
  '8.00 v' || pg_temp.versao_agora(), 'C: a previa devolve o preco em vigor e a versao do mesmo estado');

-- Limpeza ---------------------------------------------------------------------

select pg_temp.limpar();
select is(pg_temp.ler($$select count(*)::text from public.receivables
    where request_id in ('98300000-0000-4000-8000-0000000000c1', '98300000-0000-4000-8000-0000000000c2')$$),
  '0', 'as cobrancas do teste foram apagadas');

select extensions.dblink_disconnect('pr511_primeira');
select extensions.dblink_disconnect('pr511_segunda');
select extensions.dblink_disconnect('pr511_portao');
select extensions.dblink_disconnect('pr511_setup');

select * from finish();
rollback;
