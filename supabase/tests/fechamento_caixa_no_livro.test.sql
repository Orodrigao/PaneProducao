begin;
create extension if not exists pgtap with schema extensions;
select plan(111);
-- Datas passadas e fixtures próprias. Nada deste arquivo persiste.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin)
select ('97410000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','ponte-'||i||'@example.com','x',now(),now(),now(),'{}','{}',false from generate_series(1,4) i;
insert into public.app_profiles(user_id,display_name,role,store,active,allowed_routes) values
 ('97410000-0000-4000-8000-000000000001','Vendas JA ponte','vendas','ja',true,'["/"]'),
 ('97410000-0000-4000-8000-000000000002','Financeiro ponte','financeiro','jc',true,'["/"]'),
 ('97410000-0000-4000-8000-000000000003','Financeiro leitura','financeiro','jc',true,'["/"]'),
 ('97410000-0000-4000-8000-000000000004','Admin ponte','admin','jc',true,'["/"]');
insert into public.app_user_permissions(user_id,permission_key,scope) values
 ('97410000-0000-4000-8000-000000000002','financeiro.acessar','*'),
 ('97410000-0000-4000-8000-000000000002','financeiro.taxas','*'),
 ('97410000-0000-4000-8000-000000000002','financeiro.estornar','*'),
 ('97410000-0000-4000-8000-000000000002','financeiro.lancar','*'),
 ('97410000-0000-4000-8000-000000000003','financeiro.acessar','*');
create temporary table results(k text primary key,v jsonb);
grant select,insert,update on results to authenticated;
create function pg_temp.save(p_store text default 'ja',p_date date default '2026-09-15',p_values jsonb default '{}',p_request uuid default gen_random_uuid()) returns public.cash_closings language sql as $$
 select public.save_cash_closing(p_request,p_store,p_date,(select updated_at from public.cash_closings where store=p_store and closing_date=p_date),
 coalesce((p_values->>'cash')::numeric,100),0,0,coalesce((p_values->>'banrisul')::numeric,200),coalesce((p_values->>'stone')::numeric,300),coalesce((p_values->>'sitef')::numeric,400),coalesce((p_values->>'pix')::numeric,500),coalesce((p_values->>'ifood')::numeric,600),coalesce((p_values->>'food99')::numeric,700),0,0,'teste da ponte');
$$;
create function pg_temp.fee(p_method text,p_rate numeric,p_date date default '2026-09-01',p_request uuid default gen_random_uuid(),p_expected uuid default null) returns jsonb language sql as $$
 select public.save_finance_fee_rate(p_request,p_method,p_rate,p_date,p_expected);
$$;
-- Verificações de privilégios não dependem de RLS mascarando uma escrita.
select ok(not has_table_privilege('authenticated','public.cash_closings','insert'),'insert direto sem privilégio');
select ok(not has_table_privilege('authenticated','public.cash_closings','update'),'update direto sem privilégio');
select ok(not has_table_privilege('authenticated','public.cash_closings','delete'),'delete direto sem privilégio');
select ok(not has_table_privilege('anon','public.cash_closings','select'),'anon sem leitura de fechamento');
select ok(not has_table_privilege('service_role','public.cash_closings','insert'),'service role sem escrita direta');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.finance_fee_rates'::regclass),'taxas com RLS forçada');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.cash_closing_bridge_settings'::regclass),'chave com RLS forçada');
select ok(not has_table_privilege('authenticated','private.finance_fee_rates','select'),'histórico privado não exposto');
select ok(not has_function_privilege('authenticated','private.sync_cash_closing_finance_entries(uuid,uuid)','execute'),'ponte não exposta');
select ok(not has_function_privilege('authenticated','private.resync_cash_closing_finance_entries()','execute'),'ressincronização não exposta');
select ok(not has_function_privilege('anon','public.get_finance_fee_rates()','execute'),'anon não chama leitura');
select ok(not has_function_privilege('service_role','public.save_finance_fee_rate(uuid,text,numeric,date,uuid)','execute'),'service role não chama escrita de taxa');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where oid in ('public.save_finance_fee_rate(uuid,text,numeric,date,uuid)'::regprocedure,'public.get_finance_fee_rates()'::regprocedure)),'RPCs de taxas com caminho fechado');
select throws_ok($$update private.finance_fee_rates set rate=rate$$,'42501',null,'histórico de taxa recusa update como dono');
select throws_ok($$delete from private.finance_fee_rates$$,'42501',null,'histórico de taxa recusa delete como dono');
select throws_ok($$truncate private.finance_fee_rates$$,'0A000',null,'FK recusa truncate antes do gatilho');
select ok(exists(select 1 from pg_trigger where tgrelid='private.finance_fee_rates'::regclass and tgname='finance_fee_rates_append_only' and not tgisinternal and tgenabled <> 'D' and (tgtype::int & 56)=56),'gatilho imutável cobre UPDATE DELETE e TRUNCATE');
select ok((select count(*)=0 from pg_policy where polrelid='public.cash_closings'::regclass and polcmd in ('a','w','d','*')),'sem policies de escrita');
select ok((select strpos(prosrc,'lock_financial_request(p_request_id)')<strpos(prosrc,'lock_cash_closing_bridge()') and strpos(prosrc,'lock_cash_closing_bridge()')<strpos(prosrc,'for update') from pg_proc where proname='save_cash_closing' and pronamespace='public'::regnamespace),'fechamento trava pedido, ponte e linha nesta ordem');
select ok((select strpos(prosrc,'lock_financial_request(p_request_id)')<strpos(prosrc,'lock_cash_closing_bridge()') and strpos(prosrc,'lock_cash_closing_bridge()')<strpos(prosrc,'for update') from pg_proc where proname='save_finance_fee_rate' and pronamespace='public'::regnamespace),'taxa trava pedido, ponte e linha nesta ordem');
select ok((select strpos(prosrc,'lock_cash_closing_bridge()')<strpos(prosrc,'for update') from pg_proc where oid='private.resync_cash_closing_finance_entries()'::regprocedure),'carga trava ponte antes das linhas');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"97410000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into results values('closing',to_jsonb(pg_temp.save(p_request=>'97420000-0000-4000-8000-000000000001')));
select is((select count(*) from public.finance_entries),0::bigint,'vendas não lê livro');
select throws_ok($$select public.get_finance_fee_rates()$$,'42501',null,'vendas não lê taxas');
select throws_ok($$select pg_temp.fee('stone',3.51)$$,'42501','Sem permissão para mudar as taxas dos meios de pagamento.','vendas não grava taxa');
select throws_ok($$delete from public.cash_closings where store='ja'$$,'42501',null,'delete direto recusado');
select set_config('request.jwt.claims','{"sub":"97410000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select lives_ok($$select public.get_finance_fee_rates()$$,'financeiro sem taxas lê');
select is(public.get_finance_fee_rates()->>'can_edit','false','leitura explica falta de permissão');
select throws_ok($$select pg_temp.fee('stone',3.51)$$,'42501',null,'financeiro sem taxas não grava');
select set_config('request.jwt.claims','{"sub":"97410000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*) from public.finance_entries where source_ref=(select (v->>'id')::uuid from results where k='closing') and fee_of is null),7::bigint,'sete meios convivem, inclusive cinco em venda_balcao');
select is((select sum(amount) from public.finance_entries where source_ref=(select (v->>'id')::uuid from results where k='closing') and fee_of is null),2800::numeric,'receita bruta inclui apps sem somar duas vezes');
select is((select count(*) from public.finance_entries where source_ref=(select (v->>'id')::uuid from results where k='closing') and fee_of is not null),1::bigint,'somente iFood tem taxa conhecida não zero neste dia');
select is((select amount from public.finance_entries where source_ref=(select (v->>'id')::uuid from results where k='closing') and fee_of is not null),91.20::numeric,'iFood 15,2% arredondado por venda');
select ok((select bool_and(competence_month='2026-09-01' and due_date='2026-09-15' and paid_date='2026-09-15' and planned_amount=amount and created_by='97410000-0000-4000-8000-000000000001') from public.finance_entries where source_ref=(select (v->>'id')::uuid from results where k='closing')),'datas competência previsto e autor vêm do fechamento');
select is((select description from public.finance_entries where source_ref=(select (v->>'id')::uuid from results where k='closing') and source_detail='stone'),'Fechamento JA 15/09/2026 · Stone','descrição legível da receita');
select is((select description from public.finance_entries where source_ref=(select (v->>'id')::uuid from results where k='closing') and fee_of is not null),'Taxa iFood 15,2% · Fechamento JA 15/09/2026','descrição legível da taxa');
select ok((select bool_and(coalesce(case when e.source_detail='dinheiro' then a.key='caixa_fisico_ja' and e.payment_method='dinheiro' when e.source_detail='ifood' then a.key='banco_ifood' and e.payment_method='outro' when e.source_detail='pix' then e.account_id is null and e.payment_method='pix' else e.account_id is null and e.payment_method='outro' end,false)) from public.finance_entries e left join public.finance_accounts a on a.id=e.account_id where e.source_ref=(select (v->>'id')::uuid from results where k='closing') and e.fee_of is null),'contas e formas por meio corretas');
select ok((select bool_and(f.account_id is not distinct from r.account_id and f.payment_method='outro' and c.key='taxas_cartao_apps' and f.store=r.store and f.source_ref=r.source_ref and f.source_detail=r.source_detail) from public.finance_entries f join public.finance_entries r on r.id=f.fee_of join public.finance_categories c on c.id=f.category_id),'taxa aponta receita e copia conta loja e meio');
select ok(exists(select 1 from jsonb_array_elements(public.get_finance_fee_rates()->'pending') x where x->>'method'='stone' and x->>'competence_month'='2026-09-01' and (x->>'amount')::numeric=300),'venda sem taxa mostra Stone e mês');
select ok(not exists(select 1 from jsonb_array_elements(public.get_finance_fee_rates()->'pending') x where x->>'method'='pix'),'PIX zero não é pendência');
insert into results values('count',jsonb_build_object('n',(select count(*) from public.finance_entries where source='fechamento_caixa')));
-- Repetição com mesmo conteúdo precisa do actor original.
select set_config('request.jwt.claims','{"sub":"97410000-0000-4000-8000-000000000001","role":"authenticated"}',true);
-- A versão enviada na primeira chamada era nula. Chamada exata da RPC para replay.
select lives_ok($$select public.save_cash_closing('97420000-0000-4000-8000-000000000001','ja','2026-09-15',null,100,0,0,200,300,400,500,600,700,0,0,'teste da ponte')$$,'replay do mesmo request');
select lives_ok($$select pg_temp.save()$$,'salvar sem mudança');
select set_config('request.jwt.claims','{"sub":"97410000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*) from public.finance_entries where source='fechamento_caixa'),(select (v->>'n')::bigint from results where k='count'),'repetição e sem mudança não criam livro');
insert into results values('rate1',pg_temp.fee('stone',3.51,p_request=>'97430000-0000-4000-8000-000000000001'));
select is((select (v->>'fees_created')::integer from results where k='rate1'),1,'gravar taxa preenche uma pendente');
select is(pg_temp.fee('stone',3.51,p_request=>'97430000-0000-4000-8000-000000000001'),(select v from results where k='rate1'),'repetição da taxa devolve resultado idêntico');
select is((select count(*) from public.finance_entries where source_detail='stone' and fee_of is not null and entry_type='lancamento'),1::bigint,'repetição não duplica taxa');
select throws_ok($$select pg_temp.fee('stone',4,p_request=>'97430000-0000-4000-8000-000000000001')$$,'22023',null,'mesma chave outro conteúdo recusada');
select throws_ok($$select pg_temp.fee('stone',4)$$,'PT409','Outra pessoa mudou esta taxa. Recarregue para ver a atual.','versão antiga recusada');
insert into results values('rate2',pg_temp.fee('stone',4,p_expected=>(select (v->'version'->>'id')::uuid from results where k='rate1')));
select is((select fee_rate from public.finance_entries where source_detail='stone' and fee_of is not null and entry_type='lancamento' and reversed_at is null),3.51::numeric,'mudar taxa não reescreve despesa anterior');
select lives_ok($$select pg_temp.save(p_values=>'{"stone":320}')$$,'corrige só Stone');
select is((select count(*) from public.finance_entries where source_ref=(select (v->>'id')::uuid from results where k='closing') and entry_type='estorno'),2::bigint,'corrigir Stone estorna só receita e taxa dela');
select is((select amount from public.finance_entries where source_detail='stone' and fee_of is not null and entry_type='lancamento' and reversed_at is null),11.23::numeric,'Stone corrigida usa 3,51% e não 4%');
select is((select fee_rate_version_id from public.finance_entries where source_detail='stone' and fee_of is not null and entry_type='lancamento' and reversed_at is null),(select (v->'version'->>'id')::uuid from results where k='rate1'),'correção preserva id da versão');
select ok((select bool_and(r.category_id=o.category_id and r.account_id is not distinct from o.account_id and r.store=o.store and r.competence_month=o.competence_month and r.due_date=o.due_date and r.paid_date=o.paid_date and r.source=o.source and r.source_ref=o.source_ref and r.source_detail=o.source_detail and r.fee_of is not distinct from o.fee_of and r.fee_rate is not distinct from o.fee_rate and r.fee_rate_version_id is not distinct from o.fee_rate_version_id and o.reversed_by='97410000-0000-4000-8000-000000000002' and o.reversed_at is not null) from public.finance_entries r join public.finance_entries o on o.id=r.reversal_of where r.source='fechamento_caixa'),'estornos preservam dimensões e marcam original');
select lives_ok($$select pg_temp.save(p_values=>'{"stone":0}')$$,'zerar Stone estorna receita e taxa');
select is((select count(*) from public.finance_entries where source_detail='stone' and entry_type='lancamento' and reversed_at is null),0::bigint,'zerado não deixa receita nem taxa ativa');
select lives_ok($$select pg_temp.save('jc','2026-09-06')$$,'JC salva sete meios');
select is((select fee_rate from public.finance_entries where source_detail='stone' and store='jc' and fee_of is not null and entry_type='lancamento' and reversed_at is null),4::numeric,'fechamento novo usa nova taxa');
select is((select a.key from public.finance_entries e join public.finance_accounts a on a.id=e.account_id where e.source_detail='dinheiro' and e.store='jc' and e.source='fechamento_caixa'),'caixa_fisico_jc','dinheiro JC usa caixa JC');
select lives_ok($$select pg_temp.save('ex','2026-09-06')$$,'EX salva sem livro');
select is((select count(*) from public.finance_entries where source_ref=(select id from public.cash_closings where store='ex' and closing_date='2026-09-06')),0::bigint,'EX não gera receita');
reset role;
select throws_ok($$select private.sync_cash_closing_finance_entries((select id from public.cash_closings where store='ex' and closing_date='2026-09-06'),'97410000-0000-4000-8000-000000000002')$$,'22023',null,'ponte direta recusa EX');
select throws_ok($$select private.sync_cash_closing_finance_entries(gen_random_uuid(),'97410000-0000-4000-8000-000000000002')$$,'22023',null,'ponte recusa fechamento inexistente');
set local role authenticated;
select throws_ok($$select public.reverse_finance_entry(gen_random_uuid(),(select id from public.finance_entries where source='fechamento_caixa' and entry_type='lancamento' and reversed_at is null limit 1),'teste')$$,'22023','Este lançamento veio do Fechamento de caixa. Corrija o fechamento do dia em Fechamento de caixa.','estorno só pela origem');
select throws_ok($$select public.create_finance_entry(gen_random_uuid(),'venda_balcao','caixa_fisico_jc','jc',10,'2026-09-01','dinheiro','duplicou','2026-09-01')$$,'22023',null,'balcão avulso recusado');
select throws_ok($$select public.create_finance_entry(gen_random_uuid(),'ifood','banco_ifood','jc',10,'2026-09-01','outro','duplicou','2026-09-01')$$,'22023',null,'iFood avulso recusado');
select throws_ok($$select public.create_finance_entry(gen_random_uuid(),'food99','banco_ifood','jc',10,'2026-09-01','outro','duplicou','2026-09-01')$$,'22023',null,'99Food avulso recusado');
insert into results values('manual',to_jsonb(public.create_finance_entry(gen_random_uuid(),'taxas_cartao_apps','banco_ifood','jc',10,'2026-09-01','outro','ajuste no extrato','2026-09-01')));
select lives_ok($$select public.reverse_finance_entry(gen_random_uuid(),(select (v#>>'{}')::uuid from results where k='manual'),'ajuste errado')$$,'taxa avulsa continua livre e estornável');
select throws_ok($$select pg_temp.fee('dinheiro',1)$$,'22023',null,'dinheiro não configurável');
select throws_ok($$select pg_temp.fee('stone',-1)$$,'22023',null,'taxa negativa recusada');
select throws_ok($$select pg_temp.fee('stone',100.0001)$$,'22023',null,'taxa acima de 100 recusada');
select throws_ok($$select pg_temp.fee('stone',3.12345)$$,'22023',null,'cinco casas recusadas sem arredondar');
select throws_ok($$select pg_temp.fee('stone','NaN'::numeric)$$,'22023',null,'NaN recusado');
select throws_ok($$select pg_temp.fee('stone',1,null)$$,'22023',null,'vigência obrigatória');
select throws_ok($$select pg_temp.fee('stone',1,'2026-08-31')$$,'22023',null,'vigência antes da ponte recusada');
select set_config('request.jwt.claims','{"sub":"97410000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select lives_ok($$select pg_temp.fee('banrisul',null)$$,'admin grava taxa desconhecida');
insert into results values('tiny',pg_temp.fee('sitef',0.0001));
select is((select (v->>'fees_created')::integer from results where k='tiny'),0,'taxa abaixo de um centavo não cria despesa');
select ok(not exists(select 1 from jsonb_array_elements(public.get_finance_fee_rates()->'pending') x where x->>'method' in ('sitef','pix')),'taxa minúscula e PIX zero não são pendência');
reset role;
-- Falha fechada: conta inativa deve desfazer fechamento, revisão e recibo.
update public.finance_accounts set active=false where key='caixa_fisico_jc';
set local role authenticated;
select throws_ok($$select pg_temp.save('jc','2026-09-13',p_request=>'97420000-0000-4000-8000-000000000099')$$,'22023',null,'falha de conta desfaz salvamento');
reset role;
select is((select count(*) from public.cash_closings where store='jc' and closing_date='2026-09-13'),0::bigint,'falha não deixa fechamento');
select is((select count(*) from public.cash_closing_revisions where request_id='97420000-0000-4000-8000-000000000099'),0::bigint,'falha não deixa revisão');
select is((select count(*) from private.cash_closing_requests where request_id='97420000-0000-4000-8000-000000000099'),0::bigint,'falha não deixa recibo');
update public.finance_accounts set active=true where key='caixa_fisico_jc';
-- Seed tem autor não UUID: remove só essas fixtures, dentro do rollback.
delete from public.cash_closings where created_by='indicadores-preco-seed' and store in ('jc','ja');
update private.cash_closing_bridge_settings set enabled=false;
set local role authenticated;
select lives_ok($$select pg_temp.save('jc','2026-09-13')$$,'ponte desligada mantém rotina do fechamento');
select is((select count(*) from public.finance_entries where source_ref=(select id from public.cash_closings where store='jc' and closing_date='2026-09-13')),0::bigint,'desligada não mexe no livro');
reset role;
update private.cash_closing_bridge_settings set enabled=true;
insert into results values('resync',private.resync_cash_closing_finance_entries());
select ok((select (v->>'created')::integer>0 from results where k='resync'),'religar recupera lacunas');
select is(private.resync_cash_closing_finance_entries(),' {"created":0,"reversed":0}'::jsonb,'segunda carga não cria nem estorna');
-- Datas no corte e na véspera, sempre passadas.
set local role authenticated;
select lives_ok($$select pg_temp.save('jc','2026-09-01')$$,'dia do corte salva');
select lives_ok($$select pg_temp.save('jc','2026-08-31')$$,'véspera salva');
reset role;
select is((select count(*) from public.finance_entries where source_ref=(select id from public.cash_closings where store='jc' and closing_date='2026-09-01') and fee_of is null),7::bigint,'dia do corte entra');
select is((select count(*) from public.finance_entries where source_ref=(select id from public.cash_closings where store='jc' and closing_date='2026-08-31')),0::bigint,'véspera não entra');
insert into public.cash_closings(store,closing_date,weekday_label,created_by,created_by_name) values('jc','2026-09-20','domingo','autor-inválido','Teste');
select throws_ok($$select private.resync_cash_closing_finance_entries()$$,'22023','Autor inválido no fechamento JC 20/09/2026.','carga recusa autor inválido com loja e data');
delete from public.cash_closings where store='jc' and closing_date='2026-09-20';
-- Carga preserva todos os centavos por loja e meio, inclusive apps separados.
select results_eq($$
 select c.store,m.method,sum(m.amount) from public.cash_closings c cross join lateral (values ('dinheiro',c.cash_amount),('banrisul',c.banri_amount),('stone',c.stone_amount),('sitef',c.sitef_amount),('pix',c.pix_amount),('ifood',c.ifood_sales_amount),('food99',c.food99_sales_amount)) m(method,amount)
 where c.store in ('jc','ja') and c.closing_date>='2026-09-01' group by c.store,m.method having sum(m.amount)>0 order by 1,2
$$,$$
 select store,source_detail,sum(amount) from public.finance_entries where source='fechamento_caixa' and fee_of is null and entry_type='lancamento' and reversed_at is null group by store,source_detail order by 1,2
$$,'carga e fechamentos batem centavo por centavo por loja e meio');
select ok((select bool_and(f.amount=round(r.amount*15.2/100,2) and f.fee_rate=15.2) from public.finance_entries f join public.finance_entries r on r.id=f.fee_of where f.source_detail='ifood' and f.entry_type='lancamento' and f.reversed_at is null),'iFood da carga segue 15,2%');
select is((select count(*) from public.finance_entries where source='fechamento_caixa' and source_detail='pix' and fee_of is not null),0::bigint,'PIX da carga não tem despesa');
-- 99Food antes da vigência é pendência; a partir de 22/10 usa 14,1%.
set local role authenticated;
select lives_ok($$select pg_temp.save('jc','2026-10-25')$$,'99Food em dia coberto');
select is((select f.amount from public.finance_entries f join public.cash_closings c on c.id=f.source_ref where c.store='jc' and c.closing_date='2026-10-25' and f.source_detail='food99' and f.fee_of is not null and f.entry_type='lancamento'),98.70::numeric,'99Food aplica 14,1% sobre 700');
reset role;
-- Fixture histórica legítima, anterior à guarda: somente dentro deste rollback.
alter table public.finance_entries disable trigger finance_entries_guard_cash_closing_revenue;
insert into public.finance_entries(request_id,category_id,account_id,store,competence_month,due_date,planned_amount,paid_date,amount,payment_method,description,source,created_by)
select '97440000-0000-4000-8000-000000000001',c.id,a.id,'jc','2026-08-01','2026-08-10',10,'2026-08-10',10,'dinheiro','Avulso histórico','avulso','97410000-0000-4000-8000-000000000002'
from public.finance_categories c cross join public.finance_accounts a where c.key='venda_balcao' and a.key='caixa_fisico_jc';
alter table public.finance_entries enable trigger finance_entries_guard_cash_closing_revenue;
select lives_ok($$update public.finance_entries set category_id=category_id where request_id='97440000-0000-4000-8000-000000000001'$$,'update sem mudar categoria origem tipo passa no histórico');
set local role authenticated;
select lives_ok($$select public.reverse_finance_entry(gen_random_uuid(),(select id from public.finance_entries where request_id='97440000-0000-4000-8000-000000000001'),'Corrigir avulso antigo')$$,'estorno de receita avulsa antiga continua livre');
reset role;
-- Reativar um meio zerado ainda usa a taxa histórica anterior à correção.
set local role authenticated;
select lives_ok($$select pg_temp.save(p_values=>'{"stone":330}')$$,'reativa Stone zerada');
select is((select f.fee_rate_version_id from public.finance_entries f where f.source_ref=(select (v->>'id')::uuid from results where k='closing') and f.source_detail='stone' and f.fee_of is not null and f.entry_type='lancamento' and f.reversed_at is null),(select (v->'version'->>'id')::uuid from results where k='rate1'),'reativação recupera versão de taxa já estornada');
reset role;
-- A versão mais recente gravada pode ser futura; a vigente hoje é outra.
set local role authenticated;
insert into results values('future',pg_temp.fee('stone',8,private.data_na_padaria()+30,p_expected=>(select (v->'version'->>'id')::uuid from results where k='rate2')));
select is((select x->'latest'->>'id' from jsonb_array_elements(public.get_finance_fee_rates()->'methods') x where x->>'method'='stone'),(select v->'version'->>'id' from results where k='future'),'trava otimista usa última gravação, inclusive futura');
select is((select (x->'current'->>'rate')::numeric from jsonb_array_elements(public.get_finance_fee_rates()->'methods') x where x->>'method'='stone'),4::numeric,'taxa futura não muda vigente hoje');
reset role;
-- Autor de criação é aceito quando updated_by está vazio.
insert into public.cash_closings(store,closing_date,weekday_label,cash_amount,sales_amount,total_amount,created_by,updated_by,created_by_name)
values('jc','2026-09-27','domingo',12.34,12.34,12.34,'97410000-0000-4000-8000-000000000002','','Teste fallback');
select lives_ok($$select private.resync_cash_closing_finance_entries()$$,'carga aceita created_by quando updated_by vazio');
select is((select created_by from public.finance_entries where source_ref=(select id from public.cash_closings where store='jc' and closing_date='2026-09-27')),'97410000-0000-4000-8000-000000000002'::uuid,'fallback preserva autor válido');
-- Checks de forma recusam inconsistência antes dos índices.
create function pg_temp.malformed(p_source text,p_detail text,p_fee uuid,p_rate numeric,p_version uuid) returns void language plpgsql as $$
begin
 insert into public.finance_entries(request_id,category_id,account_id,store,competence_month,due_date,planned_amount,paid_date,amount,payment_method,description,source,source_ref,source_detail,fee_of,fee_rate,fee_rate_version_id,created_by)
 select gen_random_uuid(),(select id from public.finance_categories where key='taxas_cartao_apps'),account_id,store,competence_month,due_date,planned_amount,paid_date,amount,payment_method,description,p_source,source_ref,p_detail,p_fee,p_rate,p_version,created_by
 from public.finance_entries where source='fechamento_caixa' and source_detail='stone' and fee_of is null limit 1;
end; $$;
select throws_ok($$select pg_temp.malformed('fechamento_caixa',null,null,null,null)$$,'23514',null,'ponte exige meio');
select throws_ok($$select pg_temp.malformed('avulso','stone',null,null,null)$$,'23514',null,'avulso não aceita meio da ponte');
select throws_ok($$select pg_temp.malformed('fechamento_caixa','stone',null,3.51,null)$$,'23514',null,'metadados da taxa são preenchidos juntos');
-- Pendência obedece a mesma leitura por loja do livro.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"97410000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select lives_ok($$select pg_temp.save('jc','2026-09-28')$$,'fixture JC com Banrisul pendente');
reset role;
update public.app_user_permissions set scope='jc' where user_id='97410000-0000-4000-8000-000000000003' and permission_key='financeiro.acessar';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"97410000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select ok(exists(select 1 from jsonb_array_elements(public.get_finance_fee_rates()->'pending') x where x->>'method'='banrisul' and x->>'store'='jc'),'financeiro JC vê pendência JC');
select ok(not exists(select 1 from jsonb_array_elements(public.get_finance_fee_rates()->'pending') x where x->>'store'='ja'),'financeiro JC não vê pendência JA');
reset role;
update public.app_user_permissions set scope='*' where user_id='97410000-0000-4000-8000-000000000003' and permission_key='financeiro.acessar';
set local role authenticated;
select ok(exists(select 1 from jsonb_array_elements(public.get_finance_fee_rates()->'pending') x where x->>'method'='banrisul' and x->>'store'='jc'),'financeiro global vê pendência JC');
select ok(exists(select 1 from jsonb_array_elements(public.get_finance_fee_rates()->'pending') x where x->>'method'='banrisul' and x->>'store'='ja'),'financeiro global vê pendência JA');
reset role;
select * from finish();
rollback;
