begin;
create extension if not exists pgtap with schema extensions;
select plan(70);

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.cash_closing_revisions'::regclass),'RLS do histórico ligada e forçada');
select ok(not has_table_privilege('authenticated','public.cash_closing_revisions','insert'),'autenticado não insere revisão diretamente');
select ok(not has_table_privilege('authenticated','private.cash_closing_requests','select'),'recibos não são expostos ao navegador');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where pronamespace='public'::regnamespace and proname='save_cash_closing'),'salvamento roda como dono com caminho fechado');
select ok((select not prosecdef and proconfig @> array['search_path=""'] from pg_proc where pronamespace='private'::regnamespace and proname='guard_cash_closing_direct_write'),'gatilho de tela antiga mantém current_user do chamador');
select ok((select not has_function_privilege('anon',oid,'execute') from pg_proc where pronamespace='public'::regnamespace and proname='save_cash_closing'),'anon não executa salvamento');
select ok(not has_function_privilege('authenticated','private.normalize_cash_closing_stone(date)','execute'),'normalização não é concedida ao navegador');

-- Identidades exclusivamente fictícias e isoladas nesta transação.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin)
select ('97310000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','caixa-'||i||'@example.com','x',now(),now(),now(),'{}','{}',false from generate_series(1,5) i;
insert into public.app_profiles(user_id,display_name,role,store,active,allowed_routes) values
('97310000-0000-4000-8000-000000000001','Vendas JC','vendas','jc',true,'["/"]'),
('97310000-0000-4000-8000-000000000002','Vendas JA','vendas','ja',true,'["/"]'),
('97310000-0000-4000-8000-000000000003','Financeiro Teste','financeiro','jc',true,'["/"]'),
('97310000-0000-4000-8000-000000000004','Admin Teste','admin','jc',true,'["/"]'),
('97310000-0000-4000-8000-000000000005','Inativo','admin','jc',false,'["/"]');
create temporary table result(key text primary key, value jsonb);
grant select,insert,update on result to authenticated;
-- Adaptador invocador: toda regra continua sendo executada como authenticated.
create function pg_temp.save(p_store text default 'jc',p_date date default '2001-02-03',p_version timestamptz default null,p_request uuid default gen_random_uuid(),p_override jsonb default '{}')
returns public.cash_closings language sql as $$
select public.save_cash_closing(p_request,p_store,p_date,p_version,
case when p_override ? 'closing_cash_amount' then (p_override->>'closing_cash_amount')::numeric else 100 end,
case when p_override ? 'cash_withdrawal_amount' then (p_override->>'cash_withdrawal_amount')::numeric else 10 end,
case when p_override ? 'opening_cash_amount' then (p_override->>'opening_cash_amount')::numeric else 20 end,
case when p_override ? 'banri_amount' then (p_override->>'banri_amount')::numeric else 30 end,
case when p_override ? 'stone_amount' then (p_override->>'stone_amount')::numeric else 40 end,
case when p_override ? 'sitef_amount' then (p_override->>'sitef_amount')::numeric else 50 end,
case when p_override ? 'pix_amount' then (p_override->>'pix_amount')::numeric else 60 end,
case when p_override ? 'ifood_sales_amount' then (p_override->>'ifood_sales_amount')::numeric else 70 end,
case when p_override ? 'food99_sales_amount' then (p_override->>'food99_sales_amount')::numeric else 80 end,
case when p_override ? 'envelope_amount' then (p_override->>'envelope_amount')::numeric else 90 end,
case when p_override ? 'next_day_cash_amount' then (p_override->>'next_day_cash_amount')::numeric else 10 end,
case when p_override ? 'notes' then p_override->>'notes' else 'teste' end);
$$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"97310000-0000-4000-8000-000000000001","email":"caixa-1@example.com","role":"authenticated"}',true);
insert into result values('first',to_jsonb(pg_temp.save(p_request=>'97320000-0000-4000-8000-000000000001')));


select is((select value->>'store' from result where key='first'),'jc','vendas JC salva JC');

select throws_ok($$select pg_temp.save('ja')$$,'42501',null,'vendas JC não salva JA');

select is((select (value->>'cash_amount')::numeric from result where key='first'),90::numeric,'cash_amount calculado ou preservado pelo banco');

select is((select (value->>'total_amount')::numeric from result where key='first'),270::numeric,'total_amount calculado ou preservado pelo banco');

select is((select (value->>'sales_amount')::numeric from result where key='first'),270::numeric,'sales_amount calculado ou preservado pelo banco');

select is((select (value->>'site_sales_amount')::numeric from result where key='first'),0::numeric,'site_sales_amount calculado ou preservado pelo banco');

select is((select (value->>'stone_amount')::numeric from result where key='first'),40::numeric,'stone_amount calculado ou preservado pelo banco');

select is((select (value->>'food99_sales_amount')::numeric from result where key='first'),80::numeric,'food99_sales_amount calculado ou preservado pelo banco');

select is((select value->>'created_by' from result where key='first'),'97310000-0000-4000-8000-000000000001','created_by vem do banco');

select is((select value->>'created_by_name' from result where key='first'),'Vendas JC','created_by_name vem do banco');

select is((select value->>'created_by_email' from result where key='first'),'caixa-1@example.com','created_by_email vem do banco');

select is((select value->>'weekday_label' from result where key='first'),'sabado','weekday_label vem do banco');

select is((select count(*) from public.cash_closing_revisions where request_id='97320000-0000-4000-8000-000000000001'),1::bigint,'criação tem uma revisão');

select ok((select before_values is null and after_values->>'stone_amount' = '40.00' and author_name='Vendas JC' and author_id=auth.uid() and request_summary is not null from public.cash_closing_revisions where request_id='97320000-0000-4000-8000-000000000001'),'revisão da criação guarda conteúdo e autor');

select is(to_jsonb(pg_temp.save(p_request=>'97320000-0000-4000-8000-000000000001')),(select value from result where key='first'),'repetição devolve a mesma linha sem alterar carimbo');

select is((select count(*) from public.cash_closing_revisions where request_id='97320000-0000-4000-8000-000000000001'),1::bigint,'repetição não duplica revisão');

select throws_ok($$select pg_temp.save(p_request=>'97320000-0000-4000-8000-000000000001',p_override=>' {"stone_amount":41}')$$,'22023',null,'mesma chave com outro conteúdo é recusada');

select throws_ok($$select pg_temp.save()$$,'PT409',null,'existente com versão nula é conflito');

select throws_ok($$select pg_temp.save(p_version=>'2000-01-01')$$,'PT409',null,'versão antiga é conflito');

select is(to_jsonb(pg_temp.save(p_version=>(select (value->>'updated_at')::timestamptz from result where key='first'),p_request=>'97320000-0000-4000-8000-000000000002')),(select value from result where key='first'),'nenhuma mudança mantêm a versão');

select throws_ok($$select pg_temp.save(p_version=>(select (value->>'updated_at')::timestamptz from result where key='first'),p_request=>'97320000-0000-4000-8000-000000000002',p_override=>'{"notes":"outro"}')$$,'22023',null,'recibo sem mudança também impede reutilização com conteúdo diferente');

insert into result values('edited',to_jsonb(pg_temp.save(p_version=>(select (value->>'updated_at')::timestamptz from result where key='first'),p_request=>'97320000-0000-4000-8000-000000000003',p_override=>'{"notes":"edição","food99_sales_amount":91}')));

select isnt((select value->>'updated_at' from result where key='edited'),(select value->>'updated_at' from result where key='first'),'duas gravações na mesma transação têm versões distintas');

select is((select count(*) from public.cash_closing_revisions where closing_id=(select (value->>'id')::uuid from result where key='first')),2::bigint,'só criação e edição geram revisão');

select ok((select before_values->>'notes'='teste' and after_values->>'notes'='edição' and revision_type='edicao' from public.cash_closing_revisions where request_id='97320000-0000-4000-8000-000000000003'),'edição guarda antes e depois');

select is(to_jsonb(pg_temp.save(p_request=>'97320000-0000-4000-8000-000000000001')),(select value from result where key='edited'),'repetir criação antiga devolve fechamento atual');

select throws_ok($$select pg_temp.save(p_date=>'2001-02-04',p_override=>'{"closing_cash_amount":0,"opening_cash_amount":100}')$$,'22023',null,'recusa valores inválidos: {"closing_cash_amount":0,"opening_cash_amount":100}');

select throws_ok($$select pg_temp.save(p_date=>'2001-02-04',p_override=>'{"stone_amount":-1}')$$,'22023',null,'recusa valores inválidos: {"stone_amount":-1}');

select throws_ok($$select pg_temp.save(p_date=>'2001-02-04',p_override=>'{"stone_amount":null}')$$,'22023',null,'recusa valores inválidos: {"stone_amount":null}');

select throws_ok($$select pg_temp.save(p_date=>'2001-02-04',p_override=>'{"food99_sales_amount":1000001}')$$,'22023',null,'recusa valores inválidos: {"food99_sales_amount":1000001}');

select throws_ok($$select pg_temp.save(p_date=>private.data_na_padaria()+1)$$,'22023',null,'data futura é recusada');

select throws_ok($$select pg_temp.save(p_date=>null)$$,'22023',null,'data vazia é recusada');

select is((pg_temp.save(p_date=>'2001-02-05',p_override=>'{"stone_amount":40.126}')).stone_amount,40.13::numeric,'arredonda a centavos no banco');

select throws_ok($$insert into public.cash_closings(store,closing_date,weekday_label,created_by,created_by_name) values('jc','2001-03-01','quinta',auth.uid()::text,'Vendas JC')$$,'42501',null,'insert direto recusado');

select throws_ok($$update public.cash_closings set notes='apagou Stone' where store='jc' and closing_date='2001-02-03'$$,'42501',null,'update direto recusado');

select is((select notes from public.cash_closings where store='jc' and closing_date='2001-02-03'),'edição','recusa direta preserva linha');

select set_config('request.jwt.claims','{"sub":"97310000-0000-4000-8000-000000000002","role":"authenticated"}',true);

select is((select count(*) from public.cash_closing_revisions where store='jc'),0::bigint,'vendas JA não lê revisão JC');

select lives_ok($$select pg_temp.save('ja')$$,'vendas JA salva JA');

select set_config('request.jwt.claims','{"sub":"97310000-0000-4000-8000-000000000003","role":"authenticated"}',true);

select lives_ok($$select pg_temp.save('jc','2001-04-03')$$,'financeiro salva jc');

select lives_ok($$select pg_temp.save('ja','2001-04-03')$$,'financeiro salva ja');

select lives_ok($$select pg_temp.save('ex','2001-04-03')$$,'financeiro salva ex');

select set_config('request.jwt.claims','{"sub":"97310000-0000-4000-8000-000000000004","role":"authenticated"}',true);

select lives_ok($$select pg_temp.save('jc','2001-04-04')$$,'admin salva jc');

select lives_ok($$select pg_temp.save('ja','2001-04-04')$$,'admin salva ja');

select lives_ok($$select pg_temp.save('ex','2001-04-04')$$,'admin salva ex');

select throws_ok($$insert into public.cash_closings(store,closing_date,weekday_label,created_by,created_by_name) values('jc','2001-03-01','quinta',auth.uid()::text,'Vendas JC')$$,'42501',null,'nem admin faz insert direto');

select throws_ok($$update public.cash_closings set notes='admin' where store='jc' and closing_date='2001-02-03'$$,'42501',null,'nem admin faz update direto');

select lives_ok($$select public.save_pricing_settings('[{"setting_key":"taxa_canal","channel":"food99","value":14.1,"previous_value":null}]')$$,'food99 aceito na configuração');

select throws_ok($$select public.save_pricing_settings('[{"setting_key":"taxa_canal","channel":"inventado","value":1,"previous_value":null}]')$$,'22023',null,'canal inventado recusado');

select set_config('request.jwt.claims','{"sub":"97310000-0000-4000-8000-000000000005","role":"authenticated"}',true);

select throws_ok($$select pg_temp.save()$$,'42501',null,'inativo recusado');

reset role;

select throws_ok($$update public.cash_closing_revisions set reason=reason$$,'42501',null,'histórico recusa update até como dono');

select throws_ok($$delete from public.cash_closing_revisions$$,'42501',null,'histórico recusa delete até como dono');

select throws_ok($$truncate public.cash_closing_revisions$$,'42501',null,'histórico recusa truncate até como dono');

select lives_ok($$insert into public.cash_closings(store,closing_date,weekday_label,created_by,created_by_name) values('jc','2001-03-01','quinta','postgres','Teste')$$,'postgres continua inserindo diretamente');

select lives_ok($$update public.cash_closings set notes='postgres' where store='jc' and closing_date='2001-03-01'$$,'postgres continua atualizando diretamente');

-- Limpa apenas a condição de correção, dentro do rollback, antes das fixtures.
select private.normalize_cash_closing_stone(date '2026-09-01');
insert into public.cash_closings(store,closing_date,weekday_label,site_sales_amount,stone_amount,total_amount,sales_amount,created_by,created_by_name) values
('ex','2026-09-17','quinta',50,7,123,123,'postgres','Teste'),
('ex','2026-08-17','segunda',30,0,99,99,'postgres','Teste');

select is(private.normalize_cash_closing_stone(date '2026-09-01'),1,'corrige setembro uma vez');

select is(private.normalize_cash_closing_stone(date '2026-09-01'),0,'segunda correção não encontra nada');

select ok((select stone_amount=50 and site_sales_amount=0 and total_amount=123 and sales_amount=123 from public.cash_closings where store='ex' and closing_date='2026-09-17'),'Stone substitui, sem somar e sem mudar total');

select is((select site_sales_amount from public.cash_closings where store='ex' and closing_date='2026-08-17'),30::numeric,'agosto intocado');

select ok((select r.revision_type='correcao' and r.author_id is null and r.before_values->>'stone_amount'='7.00' and r.after_values->>'stone_amount'='50.00' from public.cash_closing_revisions r join public.cash_closings c on c.id=r.closing_id where c.store='ex' and c.closing_date='2026-09-17'),'correção tem revisão antes/depois sem autor inventado');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"97310000-0000-4000-8000-000000000004","role":"authenticated"}',true);
insert into result values('august',to_jsonb(pg_temp.save('ex','2026-08-17',(select updated_at from public.cash_closings where store='ex' and closing_date='2026-08-17'),p_override=>'{"stone_amount":30}')));

select ok((select (value->>'stone_amount')::numeric=30 and (value->>'site_sales_amount')::numeric=0 from result where key='august'),'editar agosto transfere legado para Stone');

select is((select count(*) from public.cash_closing_revisions where closing_id=(select (value->>'id')::uuid from result where key='august')),1::bigint,'edição de agosto tem revisão');

reset role;
-- Injeta uma colisão de unicidade entre a leitura vazia e o INSERT da RPC.
-- Prova determinística do handler; duas conexões reais ficam para o coordenador.
create function pg_temp.simulate_creation_race() returns trigger language plpgsql as $$
begin
 if new.closing_date = date '2001-05-01' and current_setting('test.cash_race',true) = 'on' then
  perform set_config('test.cash_race','off',true);
  insert into public.cash_closings(store,closing_date,weekday_label,created_by,created_by_name)
  values(new.store,new.closing_date,'terca','postgres','Concorrente');
 end if;
 return new;
end; $$;
create trigger cash_closings_test_race before insert on public.cash_closings for each row execute function pg_temp.simulate_creation_race();
set local role authenticated;
select set_config('test.cash_race','on',true);

select throws_ok($$select pg_temp.save(p_date=>'2001-05-01')$$,'PT409',null,'colisão de criação vira PT409');

reset role; set local role anon;

select throws_ok($$select * from public.cash_closing_revisions$$,'42501',null,'anon não lê histórico');

reset role;
select ok(exists(select 1 from pg_trigger where tgrelid='public.cash_closings'::regclass and tgname='cash_closings_guard_direct_write' and not tgisinternal),'gatilho de escrita direta continua instalado');
select * from finish();
rollback;