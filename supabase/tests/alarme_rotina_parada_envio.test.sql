begin;
create extension if not exists pgtap with schema extensions;

select plan(53);

-- Alarme de rotina parada, fase 1b: fotografia do dia, ciclo novo/continua/
-- resolvido, expiracao e entrega so pelo servico interno. Datas fixas em
-- novembro de 2025, antes de qualquer linha do seed: as regras so enxergam o
-- que estas fixtures lancaram. 22/11 sabado, 23/11 domingo, 24/11 segunda.

-- Privilegio minimo.
select ok((select relrowsecurity and relforcerowsecurity
  from pg_class class
  join pg_namespace namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'private' and class.relname = 'alarme_rotina_envios'),
  'o historico do alarme tem RLS habilitada e forcada');
select ok(not has_table_privilege('authenticated', 'private.alarme_rotina_envios', 'select'),
  'usuario autenticado nao le o historico do alarme');
select ok(not has_table_privilege('service_role', 'private.alarme_rotina_envios', 'select'),
  'nem o servico interno le a tabela direto: so pelas funcoes de entrega');
select ok(not has_function_privilege('anon', 'public.claim_alarme_rotina_para_envio(text, timestamp with time zone)', 'execute'),
  'visitante sem login nao aciona o alarme');
select ok(not has_function_privilege('authenticated', 'public.claim_alarme_rotina_para_envio(text, timestamp with time zone)', 'execute'),
  'usuario autenticado nao aciona o alarme');
select ok(
  has_function_privilege('service_role', 'public.claim_alarme_rotina_para_envio(text, timestamp with time zone)', 'execute')
  and has_function_privilege('service_role', 'public.mark_alarme_rotina_enviado(text, uuid, uuid, text)', 'execute')
  and has_function_privilege('service_role', 'public.record_alarme_rotina_falha(text, uuid, uuid, text)', 'execute')
  and has_function_privilege('service_role', 'public.alarme_rotina_ultimo_dia_concluido()', 'execute'),
  'o servico interno aciona, marca, registra falha e le a saude');
select ok(
  not has_function_privilege('anon', 'public.alarme_rotina_ultimo_dia_concluido()', 'execute')
  and not has_function_privilege('authenticated', 'public.alarme_rotina_ultimo_dia_concluido()', 'execute')
  and not has_function_privilege('authenticated', 'public.mark_alarme_rotina_enviado(text, uuid, uuid, text)', 'execute'),
  'a saude e a marcacao ficam fora do alcance do navegador');
select ok(exists(select 1 from vault.decrypted_secrets where name = 'alarme_rotina_cron_secret'),
  'o segredo do cron nasceu no cofre do banco');
select ok(exists(
  select 1 from cron.job
  where jobname = 'alarme-rotina-parada'
    and schedule = '*/15 11-23 * * *'
    and command like '%functions/v1/alarme-rotina-parada%'
    and command like '%alarme_rotina_cron_secret%'),
  'o cron chama a funcao do alarme a cada 15 minutos das 8h as 20h45 de Brasilia com o segredo do cofre');

select set_config('test.segredo',
  (select decrypted_secret from vault.decrypted_secrets where name = 'alarme_rotina_cron_secret'), true);

set local role service_role;
select throws_ok(
  $$ select public.claim_alarme_rotina_para_envio('segredo-errado', '2025-11-24 08:00-03') $$,
  '42501', null,
  'segredo errado e recusado');
reset role;

-- Conferencia de cada bloco.
select is(
  private.alarme_rotina_validar_bloco('operacao',
    (select jsonb_agg(jsonb_build_object('rotina', 'r' || n, 'loja', 'jc', 'estado', 'em_dia', 'detalhe', 'ok'))
      from generate_series(1, 13) as n), 14),
  '{"bloco": "operacao", "verificado": false, "erro": "a regra devolveu 13 linhas em vez de 14"}'::jsonb,
  'bloco com numero de linhas diferente nao vale como verificado');
select is(
  private.alarme_rotina_validar_bloco('financeiro',
    '[{"rotina":"a","loja":"jc","estado":"talvez","detalhe":"x"}]'::jsonb, 1) ->> 'erro',
  'a regra devolveu linha fora do formato',
  'linha com estado desconhecido nao vale como verificada');
select is(
  private.alarme_rotina_validar_bloco('financeiro', '{"rotina":"a"}'::jsonb, 1) ->> 'verificado',
  'false',
  'resposta que nao e lista nao vale como verificada');
select is(
  private.alarme_rotina_validar_bloco('financeiro',
    '[{"rotina":"a","loja":"jc","estado":"atrasada","detalhe":"x"}]'::jsonb, 1) ->> 'verificado',
  'true',
  'lista completa e no formato vale como verificada');

-- Coleta: erro numa regra vira "nao foi possivel verificar", nunca tudo em dia.
select is(
  (select array_agg((bloco ->> 'bloco') || ':' || (bloco ->> 'verificado') || ':' || (bloco ? 'erro')::text order by posicao)
    from jsonb_array_elements(private.alarme_rotina_coletar(null)) with ordinality as item(bloco, posicao)),
  array['operacao:false:true', 'financeiro:false:true'],
  'regra que falha devolve o bloco sem verificacao e com o motivo');
select is(
  (select array_agg((bloco ->> 'bloco') || ':' || jsonb_array_length(bloco -> 'linhas') order by posicao)
    from jsonb_array_elements(private.alarme_rotina_coletar('2025-11-03 08:00-03')) with ordinality as item(bloco, posicao)),
  array['operacao:14', 'financeiro:4'],
  'a coleta junta as 14 rotinas da operacao e os 4 avisos do financeiro');

-- Classificacao com fotografias fabricadas.
select is(
  private.alarme_rotina_classificar(
    '[{"bloco":"operacao","verificado":true,"linhas":[{"rotina":"caixa","loja":"jc","estado":"atrasada","detalhe":"a"}]},
      {"bloco":"financeiro","verificado":false,"erro":"falhou"}]'::jsonb,
    '{"dia":"2025-11-18","linhas":[
      {"rotina":"caixa","loja":"jc","estado":"atrasada","bloco":"operacao","classe":"continua","desde":"2025-11-10"},
      {"rotina":"parcela_vencida","loja":"jc","estado":"atrasada","bloco":"financeiro","classe":"novo","desde":"2025-11-18"}]}'::jsonb,
    '2025-11-19') - array['blocos', 'linhas'],
  '{"dia": "2025-11-19", "base": "2025-11-18", "resolvidos": [], "segunda": false,
    "em_espera": [{"rotina": "parcela_vencida", "loja": "jc", "estado": "atrasada", "bloco": "financeiro", "classe": "novo", "desde": "2025-11-18"}],
    "motivos": ["atraso", "nao_verificado"], "deve_enviar": true}'::jsonb,
  'bloco nao verificado nao resolve nada: o atraso dele fica em espera com o dia do primeiro aviso');
select is(
  private.alarme_rotina_classificar(
    '[{"bloco":"operacao","verificado":true,"linhas":[{"rotina":"caixa","loja":"jc","estado":"em_dia","detalhe":"a"}]},
      {"bloco":"financeiro","verificado":true,"linhas":[{"rotina":"parcela_vencida","loja":"jc","estado":"atrasada","detalhe":"b"}]}]'::jsonb,
    '{"dia":"2025-11-19","linhas":[{"rotina":"caixa","loja":"jc","estado":"atrasada","bloco":"operacao","classe":"continua","desde":"2025-11-10"}],
      "em_espera":[{"rotina":"parcela_vencida","loja":"jc","estado":"atrasada","bloco":"financeiro","classe":"novo","desde":"2025-11-18"}]}'::jsonb,
    '2025-11-20') - array['blocos', 'em_espera', 'dia', 'base', 'segunda'],
  '{"linhas": [
      {"rotina": "caixa", "loja": "jc", "estado": "em_dia", "detalhe": "a", "bloco": "operacao", "classe": "em_dia", "desde": null},
      {"rotina": "parcela_vencida", "loja": "jc", "estado": "atrasada", "detalhe": "b", "bloco": "financeiro", "classe": "continua", "desde": "2025-11-18"}],
    "resolvidos": [{"rotina": "caixa", "loja": "jc", "bloco": "operacao", "detalhe": "a", "desde": "2025-11-10"}],
    "motivos": ["atraso", "resolvido"], "deve_enviar": true}'::jsonb,
  'quando o bloco volta, o atraso em espera continua desde o primeiro aviso e o que voltou ao normal sai como resolvido');
select is(
  private.alarme_rotina_classificar(
    '[{"bloco":"operacao","verificado":true,"linhas":[{"rotina":"nfe_atraso_emissao","loja":"todas","estado":"informativo","detalhe":"a"}]},
      {"bloco":"financeiro","verificado":true,"linhas":[{"rotina":"parcela_vencida","loja":"jc","estado":"informativo","detalhe":"b"}]}]'::jsonb,
    null, '2025-11-19') -> 'deve_enviar',
  'false'::jsonb,
  'informativo sozinho nao manda e-mail fora da segunda');

-- Destinatario: o perfil ativo unico "Rodrigão".
set local role service_role;
select throws_ok(
  $$ select public.claim_alarme_rotina_para_envio(current_setting('test.segredo'), '2025-11-22 09:00-03') $$,
  'P0001', null,
  'sem o perfil do Rodrigo o alarme recusa em vez de mandar para outra pessoa');
reset role;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values (
  '96500000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'rodrigo-alarme-test@example.com', '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
  now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
);
insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values ('96500000-0000-4000-8000-000000000001', U&'Rodrig\00E3o', 'admin', null, true, '["*"]'::jsonb);

-- Contagem de prateleira da JA lancada todo dia esperado de 10 a 22/11
-- (prazo: ate ontem). Sem 24 e 25/11 ela atrasa em 26/11.
insert into public.shelf_counts (record_date, store, product_id, product_source, quantity, counted_by, created_at)
select dia, 'ja', 'teste-alarme-envio', 'product', 1, 'Teste alarme',
  (dia + time '20:00') at time zone 'America/Sao_Paulo'
from unnest(array['2025-11-10', '2025-11-11', '2025-11-12', '2025-11-13', '2025-11-14',
  '2025-11-17', '2025-11-18', '2025-11-19', '2025-11-21', '2025-11-22']::date[]) as dia;

-- Horario e domingo.
set local role service_role;
select is(
  public.claim_alarme_rotina_para_envio(current_setting('test.segredo'), '2025-11-22 07:59-03') ->> 'state',
  'aguardando_horario',
  'antes das 8h o alarme espera');
select is(
  public.claim_alarme_rotina_para_envio(current_setting('test.segredo'), '2025-11-23 09:00-03') ->> 'state',
  'domingo',
  'domingo nao tem alarme');
reset role;
select is((select count(*)::integer from private.alarme_rotina_envios), 0,
  'nem antes das 8h nem no domingo nasce fotografia');

-- Segunda 24/11: tudo em dia, mas segunda manda o resumo.
set local role service_role;
select lives_ok(
  $$ select set_config('test.c24', public.claim_alarme_rotina_para_envio(current_setting('test.segredo'),
    '2025-11-24 08:00-03')::text, true) $$,
  'segunda 8h: o servico tira a fotografia');
reset role;
select is(
  (select jsonb_build_object('state', claim ->> 'state', 'recipient', claim ->> 'recipient',
      'motivos', claim -> 'fotografia' -> 'motivos', 'linhas', jsonb_array_length(claim -> 'fotografia' -> 'linhas'),
      'novos', (select count(*) from jsonb_array_elements(claim -> 'fotografia' -> 'linhas') linha where linha ->> 'classe' = 'novo'))
    from (select current_setting('test.c24')::jsonb as claim) as dado),
  '{"state": "pronto_para_enviar", "recipient": "rodrigo-alarme-test@example.com", "motivos": ["resumo_segunda"], "linhas": 18, "novos": 0}'::jsonb,
  'segunda sem atraso manda o resumo para o Rodrigo com as 18 linhas');
select is((select status from private.alarme_rotina_envios where report_date = '2025-11-24'), 'pendente',
  'a fotografia da segunda fica pendente ate o envio');

set local role service_role;
select lives_ok(
  $$ select public.mark_alarme_rotina_enviado(current_setting('test.segredo'),
    (current_setting('test.c24')::jsonb ->> 'envio_id')::uuid,
    (current_setting('test.c24')::jsonb ->> 'attempt_token')::uuid, 'resend-24') $$,
  'o servico marca o envio da segunda');
select is(
  public.claim_alarme_rotina_para_envio(current_setting('test.segredo'), '2025-11-24 09:00-03') ->> 'state',
  'concluido',
  'depois de enviado, a nova chamada do dia nao manda de novo');
reset role;
select is(
  (select row(status, provider_message_id, sent_at is not null, concluded_at is not null)::text
    from private.alarme_rotina_envios where report_date = '2025-11-24'),
  row('enviado', 'resend-24', true, true)::text,
  'o envio fica registrado com o identificador do Resend');

-- Terca 25/11: uma falta so nao atrasa; dia sem novidade conclui sem envio.
set local role service_role;
select is(
  public.claim_alarme_rotina_para_envio(current_setting('test.segredo'), '2025-11-25 08:00-03') ->> 'state',
  'concluido',
  'terca sem atraso conclui o dia sem e-mail');
reset role;
select is(
  (select row(status, deve_enviar, concluded_at is not null)::text from private.alarme_rotina_envios where report_date = '2025-11-25'),
  row('sem_envio', false, true)::text,
  'o dia sem novidade conta como concluido para o vigia');

-- Quarta 26/11: a prateleira da JA atrasa (novo); o envio falha.
set local role service_role;
select lives_ok(
  $$ select set_config('test.c26', public.claim_alarme_rotina_para_envio(current_setting('test.segredo'),
    '2025-11-26 08:00-03')::text, true) $$,
  'quarta 8h: o servico tira a fotografia');
reset role;
select is(
  (select linha - array['detalhe', 'ultimo_registro', 'faltas', 'datas_faltando']
    from jsonb_array_elements(current_setting('test.c26')::jsonb -> 'fotografia' -> 'linhas') as linha
    where linha ->> 'rotina' = 'prateleira' and linha ->> 'loja' = 'ja'),
  '{"rotina": "prateleira", "loja": "ja", "estado": "atrasada", "bloco": "operacao", "classe": "novo", "desde": "2025-11-26"}'::jsonb,
  'a rotina que atrasou hoje sai como nova, com o dia do primeiro aviso');
select is(
  (select jsonb_build_object('base', foto ->> 'base', 'motivos', foto -> 'motivos')
    from (select current_setting('test.c26')::jsonb -> 'fotografia' as foto) as dado),
  '{"base": "2025-11-25", "motivos": ["atraso"]}'::jsonb,
  'a comparacao parte da ultima fotografia concluida');

set local role service_role;
select lives_ok(
  $$ select public.record_alarme_rotina_falha(current_setting('test.segredo'),
    (current_setting('test.c26')::jsonb ->> 'envio_id')::uuid,
    (current_setting('test.c26')::jsonb ->> 'attempt_token')::uuid, 'Resend recusou o envio (503).') $$,
  'o servico registra a falha do envio');
select is(
  public.claim_alarme_rotina_para_envio(current_setting('test.segredo'), '2025-11-26 08:05-03') ->> 'state',
  'em_tentativa',
  'a nova tentativa espera 14 minutos para nao mandar duas vezes');
reset role;
select is(
  (select row(status, last_error)::text from private.alarme_rotina_envios where report_date = '2025-11-26'),
  row('pendente', 'Resend recusou o envio (503).')::text,
  'a falha fica registrada e a fotografia segue pendente');

select set_config('test.c26_antes', current_setting('test.c26'), true);
set local role service_role;
select lives_ok(
  $$ select set_config('test.c26', public.claim_alarme_rotina_para_envio(current_setting('test.segredo'),
    '2025-11-26 08:15-03')::text, true) $$,
  'passados 14 minutos o servico tenta de novo');
reset role;
select is(
  (select row(current_setting('test.c26')::jsonb ->> 'state', envio.id::text = current_setting('test.c26')::jsonb ->> 'envio_id',
      envio.attempt_token::text = current_setting('test.c26')::jsonb ->> 'attempt_token',
      current_setting('test.c26')::jsonb ->> 'attempt_token' <> current_setting('test.c26_antes')::jsonb ->> 'attempt_token',
      current_setting('test.c26')::jsonb -> 'fotografia' = current_setting('test.c26_antes')::jsonb -> 'fotografia',
      envio.status, envio.last_error is null)::text
    from private.alarme_rotina_envios as envio where envio.report_date = '2025-11-26'),
  row('pronto_para_enviar', true, true, true, true, 'pendente', true)::text,
  'a nova tentativa reaproveita a mesma fotografia com outro identificador de tentativa');

-- Quinta 27/11: a fotografia de quarta expira; a de hoje compara com terca.
set local role service_role;
select lives_ok(
  $$ select set_config('test.c27', public.claim_alarme_rotina_para_envio(current_setting('test.segredo'),
    '2025-11-27 08:00-03')::text, true) $$,
  'quinta 8h: o servico tira a fotografia');
reset role;
select is((select status from private.alarme_rotina_envios where report_date = '2025-11-26'), 'expirado',
  'a fotografia que nao saiu no proprio dia expira, sem enxurrada');
select is(
  (select row(linha ->> 'classe', linha ->> 'desde', current_setting('test.c27')::jsonb ->> 'report_date')::text
    from jsonb_array_elements(current_setting('test.c27')::jsonb -> 'fotografia' -> 'linhas') as linha
    where linha ->> 'rotina' = 'prateleira' and linha ->> 'loja' = 'ja'),
  row('novo', '2025-11-27', '2025-11-27')::text,
  'quem nunca recebeu o aviso de quarta recebe o atraso como novo na quinta');

set local role service_role;
select lives_ok(
  $$ select public.mark_alarme_rotina_enviado(current_setting('test.segredo'),
    (current_setting('test.c27')::jsonb ->> 'envio_id')::uuid,
    (current_setting('test.c27')::jsonb ->> 'attempt_token')::uuid, 'resend-27') $$,
  'o servico marca o envio de quinta');

-- Sexta 28/11: continua desde quinta.
select lives_ok(
  $$ select set_config('test.c28', public.claim_alarme_rotina_para_envio(current_setting('test.segredo'),
    '2025-11-28 08:00-03')::text, true) $$,
  'sexta 8h: o servico tira a fotografia');
reset role;
select is(
  (select row(linha ->> 'classe', linha ->> 'desde', (linha ->> 'faltas')::integer)::text
    from jsonb_array_elements(current_setting('test.c28')::jsonb -> 'fotografia' -> 'linhas') as linha
    where linha ->> 'rotina' = 'prateleira' and linha ->> 'loja' = 'ja'),
  row('continua', '2025-11-27', 4)::text,
  'o atraso que segue aparece como continua, desde o primeiro aviso');

set local role service_role;
select lives_ok(
  $$ select public.mark_alarme_rotina_enviado(current_setting('test.segredo'),
    (current_setting('test.c28')::jsonb ->> 'envio_id')::uuid,
    (current_setting('test.c28')::jsonb ->> 'attempt_token')::uuid, 'resend-28') $$,
  'o servico marca o envio de sexta');
reset role;

-- A JA lanca os dias que faltavam na sexta a noite: sabado sai resolvido.
insert into public.shelf_counts (record_date, store, product_id, product_source, quantity, counted_by, created_at)
select dia, 'ja', 'teste-alarme-envio', 'product', 1, 'Teste alarme', '2025-11-28 20:00-03'
from unnest(array['2025-11-24', '2025-11-25', '2025-11-26', '2025-11-27']::date[]) as dia;

set local role service_role;
select lives_ok(
  $$ select set_config('test.c29', public.claim_alarme_rotina_para_envio(current_setting('test.segredo'),
    '2025-11-29 08:00-03')::text, true) $$,
  'sabado 8h: o servico tira a fotografia');
reset role;
select is(
  (select jsonb_build_object('motivos', foto -> 'motivos', 'resolvidos', foto -> 'resolvidos',
      'atrasadas', (select count(*) from jsonb_array_elements(foto -> 'linhas') linha where linha ->> 'estado' = 'atrasada'))
    from (select current_setting('test.c29')::jsonb -> 'fotografia' as foto) as dado),
  jsonb_build_object('motivos', '["resolvido"]'::jsonb, 'atrasadas', 0, 'resolvidos', jsonb_build_array(jsonb_build_object(
    'rotina', 'prateleira', 'loja', 'ja', 'bloco', 'operacao', 'desde', '2025-11-27',
    'detalhe', 'Contagem de prateleira da JA: 1 dia sem lancamento nos ultimos 7 dias esperados (28/11).'))),
  'a rotina que voltou ao normal manda o e-mail de resolvido');

set local role service_role;
select lives_ok(
  $$ select public.mark_alarme_rotina_enviado(current_setting('test.segredo'),
    (current_setting('test.c29')::jsonb ->> 'envio_id')::uuid,
    (current_setting('test.c29')::jsonb ->> 'attempt_token')::uuid, 'resend-29') $$,
  'o servico marca o envio de sabado');

-- O e-mail de quarta aceito pelo Resend depois de expirar fica registrado.
select lives_ok(
  $$ select public.mark_alarme_rotina_enviado(current_setting('test.segredo'),
    (current_setting('test.c26')::jsonb ->> 'envio_id')::uuid,
    (current_setting('test.c26')::jsonb ->> 'attempt_token')::uuid, 'resend-26-tarde') $$,
  'envio aceito depois da expiracao fica registrado como enviado');
select throws_ok(
  $$ select public.mark_alarme_rotina_enviado(current_setting('test.segredo'),
    (current_setting('test.c29')::jsonb ->> 'envio_id')::uuid,
    '96500000-0000-4000-8000-0000000000ff'::uuid, 'resend-falso') $$,
  'P0001', null,
  'tentativa com outro identificador nao marca o envio');
select is(public.alarme_rotina_ultimo_dia_concluido(), '2025-11-29'::date,
  'a saude devolve o ultimo dia concluido para o vigia do GitHub');
reset role;

select is(
  (select string_agg(report_date::text || ':' || status, ' ' order by report_date) from private.alarme_rotina_envios),
  '2025-11-24:enviado 2025-11-25:sem_envio 2025-11-26:enviado 2025-11-27:enviado 2025-11-28:enviado 2025-11-29:enviado',
  'uma fotografia por dia, com a historia de cada envio');

select * from finish();
rollback;
