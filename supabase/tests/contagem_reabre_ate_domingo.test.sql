begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

-- Regra de 2026-09-28: quem conta (expedicao da JC com estoque.contar_semanal)
-- reabre a contagem ate o domingo da semana, 23:59 na padaria; depois so o
-- admin. Este arquivo tambem roda no Banco Preview compartilhado, entao limpa o
-- proprio espaco dentro da transacao, que termina em rollback.

select ok(not has_function_privilege('authenticated',
  'private.contagem_semanal_no_prazo_de_quem_conta(date,timestamptz)', 'execute'),
  'regra do prazo nao e chamavel direto por autenticado');
select ok(not has_function_privilege('anon',
  'private.contagem_semanal_no_prazo_de_quem_conta(date,timestamptz)', 'execute'),
  'regra do prazo nao e chamavel por anonimo');
select ok(has_function_privilege('authenticated',
  'public.reopen_inventory_weekly_count(uuid)', 'execute'), 'reabrir continua executavel por autenticado');
select ok(not has_function_privilege('anon',
  'public.reopen_inventory_weekly_count(uuid)', 'execute'), 'anonimo nunca reabre');

-- Fronteira do prazo com horario explicito: semana de segunda 28/09/2026 a
-- domingo 04/10/2026. Os carimbos em UTC provam que a virada e a de Brasilia.
select ok(private.contagem_semanal_no_prazo_de_quem_conta('2026-09-28', '2026-09-28 00:00:00-03'),
  'segunda 00:00, inicio da semana: dentro do prazo');
select ok(private.contagem_semanal_no_prazo_de_quem_conta('2026-09-28', '2026-10-03 12:04:00-03'),
  'sabado da contagem: dentro do prazo');
select ok(private.contagem_semanal_no_prazo_de_quem_conta('2026-09-28', '2026-10-04 23:59:59-03'),
  'domingo 23:59:59 na padaria: ainda dentro do prazo');
select ok(not private.contagem_semanal_no_prazo_de_quem_conta('2026-09-28', '2026-10-05 00:00:00-03'),
  'segunda seguinte 00:00 na padaria: fora do prazo');
select ok(private.contagem_semanal_no_prazo_de_quem_conta('2026-09-28', '2026-10-05 02:59:59+00'),
  'domingo 23:59:59 em Brasilia ja e segunda em UTC: continua dentro do prazo');
select ok(not private.contagem_semanal_no_prazo_de_quem_conta('2026-09-28', '2026-10-05 03:00:00+00'),
  'segunda 00:00 em Brasilia (03:00 UTC): fora do prazo');
select ok(not private.contagem_semanal_no_prazo_de_quem_conta(null, '2026-10-01 12:00:00-03'),
  'sem semana, na duvida bloqueia');

set local timezone = 'Pacific/Kiritimati';
select ok(private.contagem_semanal_no_prazo_de_quem_conta('2026-09-28', '2026-10-04 23:59:59-03'),
  'o fuso da sessao do banco nao muda o prazo');
set local timezone to default;

select ok((select "description" from public.app_permissions where "key" = 'estoque.contar_semanal') like '%reabrir%',
  'o texto da permissao diz que quem conta tambem reabre');

-- Espaco de trabalho limpo -----------------------------------------------------
delete from public.inventory_weekly_counts where store = 'jc';

insert into auth.users(id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
values
  ('97100000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-reabre@example.com','x',now(),now(),now(),'{}','{}',false),
  ('97100000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rafaela-reabre@example.com','x',now(),now(),now(),'{}','{}',false),
  ('97100000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','expedicao-escopo-geral@example.com','x',now(),now(),now(),'{}','{}',false),
  ('97100000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','expedicao-sem-permissao-reabre@example.com','x',now(),now(),now(),'{}','{}',false),
  ('97100000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','expedicao-ja-reabre@example.com','x',now(),now(),now(),'{}','{}',false),
  ('97100000-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000','authenticated','authenticated','expedicao-escopo-ex-reabre@example.com','x',now(),now(),now(),'{}','{}',false),
  ('97100000-0000-4000-8000-000000000007','00000000-0000-0000-0000-000000000000','authenticated','authenticated','expedicao-inativa-reabre@example.com','x',now(),now(),now(),'{}','{}',false),
  ('97100000-0000-4000-8000-000000000008','00000000-0000-0000-0000-000000000000','authenticated','authenticated','vendas-reabre@example.com','x',now(),now(),now(),'{}','{}',false),
  ('97100000-0000-4000-8000-000000000009','00000000-0000-0000-0000-000000000000','authenticated','authenticated','financeiro-reabre@example.com','x',now(),now(),now(),'{}','{}',false),
  ('97100000-0000-4000-8000-000000000010','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-inativo-reabre@example.com','x',now(),now(),now(),'{}','{}',false);
insert into public.app_profiles(user_id,display_name,role,store,active,allowed_routes) values
  ('97100000-0000-4000-8000-000000000001','Admin','admin','jc',true,'["/"]'),
  ('97100000-0000-4000-8000-000000000002','Rafaela','expedicao','jc',true,'["/estoque"]'),
  ('97100000-0000-4000-8000-000000000003','Expedicao escopo geral','expedicao','jc',true,'["/estoque"]'),
  ('97100000-0000-4000-8000-000000000004','Expedicao sem permissao','expedicao','jc',true,'["/estoque"]'),
  ('97100000-0000-4000-8000-000000000005','Expedicao JA','expedicao','ja',true,'["/estoque"]'),
  ('97100000-0000-4000-8000-000000000006','Expedicao escopo EX','expedicao','jc',true,'["/estoque"]'),
  ('97100000-0000-4000-8000-000000000007','Expedicao inativa','expedicao','jc',false,'["/estoque"]'),
  ('97100000-0000-4000-8000-000000000008','Vendas','vendas','jc',true,'["/"]'),
  ('97100000-0000-4000-8000-000000000009','Financeiro','financeiro','jc',true,'["/estoque"]'),
  ('97100000-0000-4000-8000-000000000010','Admin inativo','admin','jc',false,'["/"]');
-- O cracha real da expedicao em producao tem a permissao com escopo '*'
-- (leitura de 2026-09-28); o usuario 3 reproduz esse caso.
insert into public.app_user_permissions(user_id,permission_key,scope) values
  ('97100000-0000-4000-8000-000000000002','estoque.contar_semanal','jc'),
  ('97100000-0000-4000-8000-000000000003','estoque.contar_semanal','*'),
  ('97100000-0000-4000-8000-000000000005','estoque.contar_semanal','ja'),
  ('97100000-0000-4000-8000-000000000006','estoque.contar_semanal','ex'),
  ('97100000-0000-4000-8000-000000000007','estoque.contar_semanal','jc');

-- Duas contagens fechadas: a desta semana (dentro do prazo) e a da semana
-- passada (prazo terminou no domingo que passou), no relogio da padaria.
select pg_catalog.date_trunc('week', private.data_na_padaria())::date as v_semana_atual \gset
select pg_catalog.to_char(:'v_semana_atual'::date - 1, 'DD/MM') as v_domingo_passado \gset
insert into public.inventory_weekly_counts(id,store,week_start,status,opened_by,opened_by_name,closed_at,closed_by,closed_by_name) values
  ('97100000-0000-4000-8000-0000000000a1','jc',:'v_semana_atual'::date,'fechada',
   '97100000-0000-4000-8000-000000000002','Rafaela',now(),'97100000-0000-4000-8000-000000000002','Rafaela'),
  ('97100000-0000-4000-8000-0000000000a2','jc',:'v_semana_atual'::date - 7,'fechada',
   '97100000-0000-4000-8000-000000000002','Rafaela',now() - interval '7 days','97100000-0000-4000-8000-000000000002','Rafaela');

set local role authenticated;

-- Quem conta, dentro do prazo ------------------------------------------------
select set_config('request.jwt.claim.sub','97100000-0000-4000-8000-000000000002',true);
select is((select status from public.reopen_inventory_weekly_count('97100000-0000-4000-8000-0000000000a1')),
  'aberta','quem conta reabre a contagem desta semana, ainda dentro do prazo');
select is((select reopened_by_name from public.inventory_weekly_counts where id = '97100000-0000-4000-8000-0000000000a1'),
  'Rafaela','a reabertura registra o nome de quem reabriu');
select ok((select reopened_at is not null and reopened_by = '97100000-0000-4000-8000-000000000002'
  from public.inventory_weekly_counts where id = '97100000-0000-4000-8000-0000000000a1'),
  'a reabertura registra quando e quem reabriu');
select is((select status from public.reopen_inventory_weekly_count('97100000-0000-4000-8000-0000000000a1')),
  'aberta','reabrir de novo dentro do prazo e idempotente');
select is((select status from public.close_inventory_weekly_count('97100000-0000-4000-8000-0000000000a1')),
  'fechada','quem conta fecha de novo');

-- Quem conta, fora do prazo --------------------------------------------------
select throws_ok(
  $$select public.reopen_inventory_weekly_count('97100000-0000-4000-8000-0000000000a2')$$,
  '42501',
  'O prazo para reabrir esta contagem terminou no domingo ' || :'v_domingo_passado' || '. Agora so o admin reabre.',
  'quem conta nao reabre a contagem da semana passada');
select is((select status from public.inventory_weekly_counts where id = '97100000-0000-4000-8000-0000000000a2'),
  'fechada','a contagem fora do prazo continua fechada');

-- Permissao em todas as lojas, como o cracha real ---------------------------
select set_config('request.jwt.claim.sub','97100000-0000-4000-8000-000000000003',true);
select is((select status from public.reopen_inventory_weekly_count('97100000-0000-4000-8000-0000000000a1')),
  'aberta','expedicao da JC com a permissao em todas as lojas reabre dentro do prazo');
select is((select status from public.close_inventory_weekly_count('97100000-0000-4000-8000-0000000000a1')),
  'fechada','e fecha de novo');
select throws_ok(
  $$select public.reopen_inventory_weekly_count('97100000-0000-4000-8000-0000000000a2')$$,
  '42501',
  'O prazo para reabrir esta contagem terminou no domingo ' || :'v_domingo_passado' || '. Agora so o admin reabre.',
  'permissao em todas as lojas tambem respeita o prazo');

-- Bloqueados mesmo dentro do prazo -------------------------------------------
select set_config('request.jwt.claim.sub','97100000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.reopen_inventory_weekly_count('97100000-0000-4000-8000-0000000000a1')$$,
  '42501','Sem permissao para reabrir esta contagem.','expedicao sem a permissao nao reabre');
select set_config('request.jwt.claim.sub','97100000-0000-4000-8000-000000000005',true);
select throws_ok($$select public.reopen_inventory_weekly_count('97100000-0000-4000-8000-0000000000a1')$$,
  '42501','Sem permissao para reabrir esta contagem.','expedicao da JA nao reabre a contagem da JC');
select set_config('request.jwt.claim.sub','97100000-0000-4000-8000-000000000006',true);
select throws_ok($$select public.reopen_inventory_weekly_count('97100000-0000-4000-8000-0000000000a1')$$,
  '42501','Sem permissao para reabrir esta contagem.','permissao com escopo de outra loja nao reabre a JC');
select set_config('request.jwt.claim.sub','97100000-0000-4000-8000-000000000007',true);
select throws_ok($$select public.reopen_inventory_weekly_count('97100000-0000-4000-8000-0000000000a1')$$,
  '42501','Sem permissao para reabrir esta contagem.','perfil inativo nao reabre mesmo com a permissao');
select set_config('request.jwt.claim.sub','97100000-0000-4000-8000-000000000008',true);
select throws_ok($$select public.reopen_inventory_weekly_count('97100000-0000-4000-8000-0000000000a1')$$,
  '42501','Sem permissao para reabrir esta contagem.','vendas nao reabre');
select set_config('request.jwt.claim.sub','97100000-0000-4000-8000-000000000010',true);
select throws_ok($$select public.reopen_inventory_weekly_count('97100000-0000-4000-8000-0000000000a1')$$,
  '42501','Sem permissao para reabrir esta contagem.','admin inativo nao reabre');
select set_config('request.jwt.claim.sub','97100000-0000-4000-8000-000000000009',true);
select throws_ok($$select public.reopen_inventory_weekly_count('97100000-0000-4000-8000-0000000000a1')$$,
  '42501','Sem permissao para reabrir esta contagem.','financeiro enxerga a contagem, mas nao reabre');
select is((select status from public.inventory_weekly_counts where id = '97100000-0000-4000-8000-0000000000a1'),
  'fechada','nenhuma tentativa bloqueada mudou a contagem');

-- Admin reabre sempre ----------------------------------------------------------
select set_config('request.jwt.claim.sub','97100000-0000-4000-8000-000000000001',true);
select is((select status from public.reopen_inventory_weekly_count('97100000-0000-4000-8000-0000000000a2')),
  'aberta','admin reabre a contagem da semana passada, fora do prazo de quem conta');
select is((select reopened_by_name from public.inventory_weekly_counts where id = '97100000-0000-4000-8000-0000000000a2'),
  'Admin','a reabertura do admin tambem fica registrada');

-- Entradas invalidas -----------------------------------------------------------
select set_config('request.jwt.claim.sub','97100000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.reopen_inventory_weekly_count('97100000-0000-4000-8000-0000000000ff')$$,
  'P0002','Contagem semanal nao encontrada.','contagem inexistente e recusada');
select throws_ok($$select public.reopen_inventory_weekly_count(null)$$,
  '22023','Contagem obrigatoria.','reabrir sem contagem e recusado');

select * from finish();
rollback;
