-- Configuração do Sistema (fase 1 da formação de preço): só admin ativo lê e
-- grava; vazio fica vazio; o histórico só cresce.
begin;
create extension if not exists pgtap with schema extensions;

select plan(70);

-- Contrato de acesso ----------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'private.pricing_settings_history', 'select'),
  'autenticado não lê o histórico direto');
select ok(not has_table_privilege('authenticated', 'private.pricing_settings_history', 'insert'),
  'autenticado não grava no histórico direto');
select ok(not has_table_privilege('anon', 'private.pricing_settings_history', 'select'),
  'anônimo não lê o histórico');
select ok(not has_table_privilege('service_role', 'private.pricing_settings_history', 'select'),
  'chave de serviço não lê o histórico');
select ok((select relrowsecurity and relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private' and c.relname = 'pricing_settings_history'),
  'histórico usa RLS forçada');
select ok(not has_function_privilege('authenticated', 'private.pricing_settings_current()', 'execute'),
  'autenticado não chama o valor vigente interno');
select ok(not has_function_privilege('anon', 'private.pricing_settings_current()', 'execute'),
  'anônimo não chama o valor vigente interno');
select ok(has_function_privilege('authenticated', 'public.get_pricing_settings(integer)', 'execute'),
  'autenticado chama a leitura (o banco decide dentro dela)');
select ok(has_function_privilege('authenticated', 'public.save_pricing_settings(jsonb)', 'execute'),
  'autenticado chama a gravação (o banco decide dentro dela)');
select ok(not has_function_privilege('anon', 'public.get_pricing_settings(integer)', 'execute'),
  'anônimo não lê a configuração');
select ok(not has_function_privilege('anon', 'public.save_pricing_settings(jsonb)', 'execute'),
  'anônimo não grava a configuração');
-- 40001 faz o PostgREST repetir a transação sem fim quando o conflito é o
-- próprio estado gravado (visto no preview da PR 467). Nenhuma função desta
-- frente pode recusar com ele.
select ok((select bool_and(pg_catalog.pg_get_functiondef(p.oid) not like '%40001%')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname, p.proname) in (('public', 'get_pricing_settings'), ('public', 'save_pricing_settings'))),
  'conflito de salvamento não usa 40001, que o PostgREST repete para sempre');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname, p.proname) in (('public', 'get_pricing_settings'), ('public', 'save_pricing_settings'),
      ('private', 'pricing_settings_current'))),
  'as três funções rodam como dono e com search_path fechado');

-- Espaço de trabalho limpo ----------------------------------------------------
-- O histórico recusa apagar; o teste desliga a trava só dentro desta
-- transação, que termina em rollback, para não depender do que o preview já
-- tiver gravado.
alter table private.pricing_settings_history disable trigger pricing_settings_history_append_only;
delete from private.pricing_settings_history;
alter table private.pricing_settings_history enable trigger pricing_settings_history_append_only;

insert into auth.users(id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
values
  ('97200000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-config-preco@example.com','x',now(),now(),now(),'{}','{}',false),
  ('97200000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin2-config-preco@example.com','x',now(),now(),now(),'{}','{}',false),
  ('97200000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','compras-config-preco@example.com','x',now(),now(),now(),'{}','{}',false),
  ('97200000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','financeiro-config-preco@example.com','x',now(),now(),now(),'{}','{}',false),
  ('97200000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','producao-config-preco@example.com','x',now(),now(),now(),'{}','{}',false),
  ('97200000-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-inativo-config-preco@example.com','x',now(),now(),now(),'{}','{}',false);
insert into public.app_profiles(user_id,display_name,role,store,active,allowed_routes) values
  ('97200000-0000-4000-8000-000000000001','Admin Preço','admin','jc',true,'["/"]'),
  ('97200000-0000-4000-8000-000000000002','Outro Admin','admin','jc',true,'["/"]'),
  ('97200000-0000-4000-8000-000000000003','Compras','compras','jc',true,'["*"]'),
  ('97200000-0000-4000-8000-000000000004','Financeiro','financeiro','jc',true,'["*"]'),
  ('97200000-0000-4000-8000-000000000005','Produção','producao','jc',true,'["/"]'),
  ('97200000-0000-4000-8000-000000000006','Admin inativo','admin','jc',false,'["/"]');

select id as v_croissant from public.product_categories where name = 'Croissant' \gset
select id as v_revenda from public.product_categories where name = 'Revenda' \gset
select id as v_insumos from public.product_categories where name = 'Insumos' \gset

set local role authenticated;

-- Quem não é admin ativo recebe recusa do banco, na leitura e na gravação -----
select set_config('request.jwt.claim.sub','97200000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.get_pricing_settings()$$, '42501', null,
  'Compras não lê a configuração, nem com rota liberada');
select throws_ok($$select public.save_pricing_settings('[{"setting_key":"imposto_venda","value":6,"previous_value":null}]')$$,
  '42501', null, 'Compras não grava a configuração');
select set_config('request.jwt.claim.sub','97200000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.get_pricing_settings()$$, '42501', null,
  'Financeiro não lê a configuração');
select throws_ok($$select public.save_pricing_settings('[{"setting_key":"imposto_venda","value":6,"previous_value":null}]')$$,
  '42501', null, 'Financeiro não grava a configuração');
select set_config('request.jwt.claim.sub','97200000-0000-4000-8000-000000000005',true);
select throws_ok($$select public.get_pricing_settings()$$, '42501', null, 'Produção não lê a configuração');
select set_config('request.jwt.claim.sub','97200000-0000-4000-8000-000000000006',true);
select throws_ok($$select public.save_pricing_settings('[{"setting_key":"imposto_venda","value":6,"previous_value":null}]')$$,
  '42501', null, 'admin inativo não grava a configuração');
select throws_ok($$select public.get_pricing_settings()$$, '42501', null, 'admin inativo não lê a configuração');
select throws_ok($$select count(*) from private.pricing_settings_history$$, '42501', null,
  'leitura direta do histórico é recusada pelo banco');

-- Admin: começa vazio e nada nasce preenchido --------------------------------
select set_config('request.jwt.claim.sub','97200000-0000-4000-8000-000000000001',true);
select is(public.get_pricing_settings(), '{"current": [], "history": []}'::jsonb,
  'sem nada gravado, nenhum valor aparece: nem margem, nem imposto');

select is((public.save_pricing_settings(pg_catalog.format($j$[
    {"setting_key":"imposto_venda","value":6,"previous_value":null},
    {"setting_key":"taxa_canal","channel":"balcao","value":2.5,"previous_value":null},
    {"setting_key":"taxa_canal","channel":"ifood","value":23,"previous_value":null},
    {"setting_key":"taxa_canal","channel":"buck","value":0,"previous_value":null},
    {"setting_key":"margem_desejada","channel":"balcao","value":40,"previous_value":null},
    {"setting_key":"margem_minima","channel":"balcao","value":30,"previous_value":null},
    {"setting_key":"margem_desejada","channel":"balcao","category_id":"%s","value":50,"previous_value":null},
    {"setting_key":"margem_minima","channel":"ifood","value":null,"previous_value":null}
  ]$j$, :'v_croissant')::jsonb) ->> 'saved')::integer, 7,
  'admin grava imposto, três taxas e margens; o campo vazio não vira versão');

select is(
  (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(item ->> 'setting_key', item ->> 'channel',
      (item ->> 'category_id') is not null, (item ->> 'value')::numeric)
    order by item ->> 'setting_key', item ->> 'channel', item ->> 'category_id' nulls first)
    from pg_catalog.jsonb_array_elements(public.get_pricing_settings() -> 'current') item),
  '[["imposto_venda", null, false, 6.00], ["margem_desejada", "balcao", false, 40.00],
    ["margem_desejada", "balcao", true, 50.00], ["margem_minima", "balcao", false, 30.00],
    ["taxa_canal", "balcao", false, 2.50], ["taxa_canal", "buck", false, 0.00],
    ["taxa_canal", "ifood", false, 23.00]]'::jsonb,
  'relido, cada valor volta na sua chave; a taxa zero da Buck é zero de verdade');
select ok(not exists (
    select 1 from pg_catalog.jsonb_array_elements(public.get_pricing_settings() -> 'current') item
    where item ->> 'setting_key' = 'margem_minima' and item ->> 'channel' = 'ifood'),
  'margem mínima do iFood deixada vazia continua sem valor, não zero');
select ok((select bool_and(item ->> 'changed_by_name' = 'Admin Preço' and (item ->> 'changed_at') is not null)
    from pg_catalog.jsonb_array_elements(public.get_pricing_settings() -> 'current') item),
  'cada valor diz quem mudou e quando');
reset role;
select is((select count(distinct history.change_id)::integer from private.pricing_settings_history history), 1,
  'um salvamento grava uma única versão para todos os valores que mudaram');
select ok((select pg_catalog.pg_get_expr(d.adbin, d.adrelid) like '%clock_timestamp()%'
    from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
    where d.adrelid = 'private.pricing_settings_history'::regclass and a.attname = 'changed_at'),
  'a ordem das versões usa clock_timestamp(), não o início da transação');
set local role authenticated;
select set_config('request.jwt.claim.sub','97200000-0000-4000-8000-000000000001',true);

-- Segundo toque em Salvar, com os mesmos valores: nada novo ------------------
select is((public.save_pricing_settings('[
    {"setting_key":"imposto_venda","value":6,"previous_value":null},
    {"setting_key":"taxa_canal","channel":"ifood","value":23,"previous_value":null}
  ]') ->> 'saved')::integer, 0,
  'repetir o mesmo salvamento não cria versão repetida');

-- Mudar e limpar ---------------------------------------------------------------
select is((public.save_pricing_settings('[
    {"setting_key":"imposto_venda","value":6.5,"previous_value":6},
    {"setting_key":"margem_desejada","channel":"balcao","value":45,"previous_value":40}
  ]') ->> 'saved')::integer, 2, 'admin muda o imposto e a margem desejada do balcão');
select is((public.save_pricing_settings('[
    {"setting_key":"taxa_canal","channel":"balcao","value":null,"previous_value":2.5}
  ]') ->> 'saved')::integer, 1, 'admin limpa a taxa do balcão');
select is((select item -> 'value' from pg_catalog.jsonb_array_elements(public.get_pricing_settings() -> 'current') item
    where item ->> 'setting_key' = 'taxa_canal' and item ->> 'channel' = 'balcao'),
  'null'::jsonb, 'taxa limpa volta vazia, com quem limpou, e não zero');
select is((select (item ->> 'value')::numeric from pg_catalog.jsonb_array_elements(public.get_pricing_settings() -> 'current') item
    where item ->> 'setting_key' = 'imposto_venda'), 6.50::numeric,
  'imposto tem um valor vigente só, o mais recente');

-- Histórico: anterior, novo, quem e quando -------------------------------------
select is(
  (select pg_catalog.jsonb_build_array(item -> 'previous_value', item -> 'value', item -> 'changed_by_name')
    from pg_catalog.jsonb_array_elements(public.get_pricing_settings() -> 'history') item
    where item ->> 'setting_key' = 'imposto_venda'
    order by item ->> 'changed_at' desc limit 1),
  '[6.00, 6.50, "Admin Preço"]'::jsonb,
  'histórico do imposto mostra o anterior, o novo e quem mudou');
select is(
  (select pg_catalog.jsonb_build_array(item -> 'previous_value', item -> 'value')
    from pg_catalog.jsonb_array_elements(public.get_pricing_settings() -> 'history') item
    where item ->> 'setting_key' = 'taxa_canal' and item ->> 'channel' = 'balcao'
    order by item ->> 'changed_at' desc limit 1),
  '[2.50, null]'::jsonb, 'histórico registra a limpeza da taxa do balcão');
select is(
  (select item ->> 'category_name'
    from pg_catalog.jsonb_array_elements(public.get_pricing_settings() -> 'history') item
    where item ->> 'category_id' is not null limit 1),
  'Croissant', 'histórico da exceção traz o nome da categoria');
select is(pg_catalog.jsonb_array_length(public.get_pricing_settings(1) -> 'history'), 1,
  'o limite do histórico é respeitado');
select is(
  (select item ->> 'setting_key'
    from pg_catalog.jsonb_array_elements(public.get_pricing_settings(1) -> 'history') item),
  'taxa_canal', 'o histórico vem do mais recente para o mais antigo');

-- Outro salvamento no meio: recusa em vez de atropelar -------------------------
select set_config('request.jwt.claim.sub','97200000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.save_pricing_settings('[{"setting_key":"imposto_venda","value":7,"previous_value":6}]')$$,
  'PT409', null, 'tela velha (imposto 6 na tela, 6,5 no banco) não atropela o salvamento do outro admin');
select is((select (item ->> 'value')::numeric from pg_catalog.jsonb_array_elements(public.get_pricing_settings() -> 'current') item
    where item ->> 'setting_key' = 'imposto_venda'), 6.50::numeric,
  'a recusa por conflito não gravou nada');
select is((public.save_pricing_settings('[{"setting_key":"imposto_venda","value":7,"previous_value":6.5}]') ->> 'saved')::integer, 1,
  'outro admin com a tela atual grava normalmente');
select is((select item ->> 'changed_by_name' from pg_catalog.jsonb_array_elements(public.get_pricing_settings() -> 'current') item
    where item ->> 'setting_key' = 'imposto_venda'), 'Outro Admin',
  'o valor vigente diz qual admin mudou por último');

-- Entradas inválidas: o salvamento inteiro é recusado ----------------------------
select set_config('request.jwt.claim.sub','97200000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.save_pricing_settings('[{"setting_key":"imposto_venda","value":101,"previous_value":7}]')$$,
  '22023', null, 'percentual acima de 100 é recusado');
select throws_ok($$select public.save_pricing_settings('[{"setting_key":"imposto_venda","value":-1,"previous_value":7}]')$$,
  '22023', null, 'percentual negativo é recusado');
select throws_ok($$select public.save_pricing_settings('[{"setting_key":"imposto_venda","value":6.555,"previous_value":7}]')$$,
  '22023', null, 'mais de duas casas decimais é recusado');
select throws_ok($$select public.save_pricing_settings('[{"setting_key":"imposto_venda","value":"6","previous_value":7}]')$$,
  '22023', null, 'percentual em texto é recusado');
select throws_ok($$select public.save_pricing_settings('[{"setting_key":"imposto_venda","value":6}]')$$,
  '22023', null, 'sem o valor anterior da tela é recusado');
select throws_ok($$select public.save_pricing_settings('[{"setting_key":"imposto_venda","channel":"ifood","value":6,"previous_value":null}]')$$,
  '22023', null, 'imposto por canal é recusado: ele vale para todos');
select throws_ok($$select public.save_pricing_settings('[{"setting_key":"taxa_canal","value":3,"previous_value":null}]')$$,
  '22023', null, 'taxa sem canal é recusada');
select throws_ok($$select public.save_pricing_settings('[{"setting_key":"taxa_canal","channel":"pj","value":3,"previous_value":null}]')$$,
  '22023', null, 'canal fora de Balcão, iFood e Buck é recusado');
select throws_ok($$select public.save_pricing_settings('[{"setting_key":"margem_desejada","value":30,"previous_value":null}]')$$,
  '22023', null, 'margem sem canal é recusada');
select throws_ok($$select public.save_pricing_settings('[{"setting_key":"custo_fixo","value":3,"previous_value":null}]')$$,
  '22023', null, 'parâmetro desconhecido é recusado');
select throws_ok(pg_catalog.format($q$select public.save_pricing_settings('[{"setting_key":"margem_desejada","channel":"buck","category_id":"%s","value":30,"previous_value":null}]')$q$, :'v_insumos'),
  '22023', null, 'exceção de margem para categoria de matéria-prima é recusada');
select throws_ok($$select public.save_pricing_settings('[{"setting_key":"margem_desejada","channel":"buck","category_id":"00000000-0000-4000-8000-000000000000","value":30,"previous_value":null}]')$$,
  '22023', null, 'exceção para categoria inexistente é recusada');
select throws_ok($$select public.save_pricing_settings('[{"setting_key":"margem_desejada","channel":"buck","category_id":"nao-e-uuid","value":30,"previous_value":null}]')$$,
  '22023', null, 'categoria em formato inválido é recusada');
select throws_ok($$select public.save_pricing_settings('[
    {"setting_key":"taxa_canal","channel":"ifood","value":24,"previous_value":23},
    {"setting_key":"taxa_canal","channel":"ifood","value":25,"previous_value":23}]')$$,
  '22023', null, 'o mesmo valor duas vezes no salvamento é recusado');
select throws_ok($$select public.save_pricing_settings('{"setting_key":"imposto_venda"}')$$,
  '22023', null, 'corpo que não é lista é recusado');
select throws_ok($$select public.save_pricing_settings('[1]')$$,
  '22023', null, 'item que não é objeto é recusado');
select throws_ok($$select public.save_pricing_settings('[{"setting_key":"taxa_canal","channel":1,"value":3,"previous_value":null}]')$$,
  '22023', null, 'canal que não é texto é recusado');
select throws_ok($$select public.save_pricing_settings('[
    {"setting_key":"taxa_canal","channel":"ifood","value":20,"previous_value":23},
    {"setting_key":"margem_minima","channel":"balcao","value":46,"previous_value":30}]')$$,
  '22023', null, 'margem mínima acima da desejada do mesmo canal é recusada');
select is((select (item ->> 'value')::numeric from pg_catalog.jsonb_array_elements(public.get_pricing_settings() -> 'current') item
    where item ->> 'setting_key' = 'taxa_canal' and item ->> 'channel' = 'ifood'), 23.00::numeric,
  'recusa de um item não grava os outros do mesmo salvamento');
-- Herança: campo vazio na exceção vale o do canal (desejada do balcão = 45,
-- mínima do balcão = 30). A comparação é pelo valor que vale de fato.
select throws_ok(pg_catalog.format($q$select public.save_pricing_settings('[
    {"setting_key":"margem_minima","channel":"balcao","category_id":"%s","value":60,"previous_value":null}]')$q$,
    :'v_revenda'),
  '22023', null, 'mínima de exceção acima da desejada herdada do canal é recusada');
select is((public.save_pricing_settings(pg_catalog.format($j$[
    {"setting_key":"margem_minima","channel":"balcao","category_id":"%s","value":40,"previous_value":null}]$j$,
    :'v_revenda')::jsonb) ->> 'saved')::integer, 1,
  'mínima de exceção abaixo da desejada herdada do canal grava');
select throws_ok($$select public.save_pricing_settings('[
    {"setting_key":"margem_desejada","channel":"balcao","value":35,"previous_value":45}]')$$,
  '22023', null, 'baixar a desejada do canal abaixo da mínima de uma exceção que a herda é recusado');
select is((public.save_pricing_settings('[{"setting_key":"margem_minima","channel":"buck","value":25,"previous_value":null}]') ->> 'saved')::integer, 1,
  'mínima do canal Buck grava sem desejada definida');
select throws_ok(pg_catalog.format($q$select public.save_pricing_settings('[
    {"setting_key":"margem_desejada","channel":"buck","category_id":"%s","value":20,"previous_value":null}]')$q$,
    :'v_croissant'),
  '22023', null, 'desejada de exceção abaixo da mínima herdada do canal é recusada');
select is((public.save_pricing_settings('[]') ->> 'saved')::integer, 0, 'lista vazia não grava nada');

-- O passado não se reescreve ---------------------------------------------------
reset role;
select throws_ok($$update private.pricing_settings_history set value = 1$$, '42501', null,
  'nem o dono da tabela altera uma versão gravada');
select throws_ok($$delete from private.pricing_settings_history$$, '42501', null,
  'nem o dono da tabela apaga uma versão gravada');
select throws_ok($$insert into private.pricing_settings_history
    (setting_key, value, change_id, changed_by, changed_by_name)
    values ('imposto_venda', 150, gen_random_uuid(), gen_random_uuid(), 'x')$$, '23514', null,
  'a tabela recusa percentual acima de 100 mesmo fora da função');

select * from finish();
rollback;
