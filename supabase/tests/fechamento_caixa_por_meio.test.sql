-- Aceite PR 3a. Mutantes a executar pelo coordenador no banco descartável:
-- (3) retirar o continue do meio sem mudança deve quebrar a igualdade de IDs;
-- (4) retirar a guarda de formato deve quebrar 22023 e ausência de linha/recibo;
-- (6) usar só as colunas novas na ponte deve quebrar receita/taxa antiga e IDs.
-- Não basta contar entradas: comparamos meios, valores e identidade das demais.
begin;
create extension if not exists pgtap with schema extensions;
select plan(128);
select is((select array_agg(pronargs::int order by pronargs) from pg_proc where pronamespace='public'::regnamespace and proname='save_cash_closing'),array[16,25],'duas assinaturas, sem ambiguidade');
select ok((select bool_and(pronargdefaults=0) from pg_proc where pronamespace='public'::regnamespace and proname='save_cash_closing'),'nenhuma assinatura tem parâmetro padrão');
select ok((select bool_and(has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute')) from pg_proc where pronamespace='public'::regnamespace and proname='save_cash_closing'),'authenticated executa as duas, anon nenhuma');
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_super_admin)
select ('97560000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','por-meio-'||i||'@example.com','x',now(),now(),now(),'{}','{}',false from generate_series(1,3) i;
insert into public.app_profiles(user_id,display_name,role,store,active,allowed_routes) values
 ('97560000-0000-4000-8000-000000000001','Vendas JA meios','vendas','ja',true,'["/"]'),
 ('97560000-0000-4000-8000-000000000002','Financeiro meios','financeiro','jc',true,'["/"]'),
 ('97560000-0000-4000-8000-000000000003','Vendas JC meios','vendas','jc',true,'["/"]');
insert into public.app_user_permissions(user_id,permission_key,scope) values
 ('97560000-0000-4000-8000-000000000002','financeiro.acessar','*'),
 ('97560000-0000-4000-8000-000000000002','financeiro.taxas','*');
create temporary table results(k text primary key,v jsonb);
grant select,insert,update on results to authenticated;
create function pg_temp.save(p_store text default 'ja',p_day date default '2026-11-02',p_values jsonb default '{}',p_request uuid default gen_random_uuid(),p_version timestamptz default null) returns public.cash_closings language sql as $$
 select public.save_cash_closing(p_request,p_store,p_day,coalesce(p_version,(select updated_at from public.cash_closings where store=p_store and closing_date=p_day)),
 coalesce((p_values->>'cash')::numeric,100),20,10,
 coalesce((p_values->>'banri_amount')::numeric,0),case when p_values ? 'banri_credit_amount' then (p_values->>'banri_credit_amount')::numeric else case when p_values ? 'legacy' then 0 else 100 end end,case when p_values ? 'banri_debit_amount' then (p_values->>'banri_debit_amount')::numeric else case when p_values ? 'legacy' then 0 else 100 end end,case when p_values ? 'banri_pix_amount' then (p_values->>'banri_pix_amount')::numeric else case when p_values ? 'legacy' then 0 else 100 end end,
 coalesce((p_values->>'stone_amount')::numeric,0),case when p_values ? 'stone_credit_amount' then (p_values->>'stone_credit_amount')::numeric else case when p_values ? 'legacy' then 0 else 100 end end,case when p_values ? 'stone_debit_amount' then (p_values->>'stone_debit_amount')::numeric else case when p_values ? 'legacy' then 0 else 100 end end,case when p_values ? 'stone_pix_amount' then (p_values->>'stone_pix_amount')::numeric else case when p_values ? 'legacy' then 0 else 100 end end,
 coalesce((p_values->>'sitef_amount')::numeric,0),case when p_values ? 'sitef_credit_amount' then (p_values->>'sitef_credit_amount')::numeric else case when p_values ? 'legacy' then 0 else 100 end end,case when p_values ? 'sitef_debit_amount' then (p_values->>'sitef_debit_amount')::numeric else case when p_values ? 'legacy' then 0 else 100 end end,case when p_values ? 'sitef_pix_amount' then (p_values->>'sitef_pix_amount')::numeric else case when p_values ? 'legacy' then 0 else 100 end end,
 50,0,0,0,0,'teste por meio');
$$;
-- Histórico antigo legítimo. Taxas antigas próprias, sem alterar taxas existentes.
insert into private.finance_fee_rates(method,rate,valid_from,author_name) values
 ('banrisul',2,'2026-09-01','Fixture taxa antiga'),('stone',3,'2026-09-01','Fixture taxa antiga'),('sitef',4,'2026-09-01','Fixture taxa antiga');
insert into public.cash_closings(store,closing_date,weekday_label,banri_amount,stone_amount,sitef_amount,cash_amount,total_amount,sales_amount,created_by,created_by_name)
values('ja','2026-11-01','domingo',150,50,25,0,225,225,'97560000-0000-4000-8000-000000000002','Financeiro meios');
select private.sync_cash_closing_finance_entries((select id from public.cash_closings where store='ja' and closing_date='2026-11-01'),'97560000-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"97560000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into results values('created',to_jsonb(pg_temp.save(p_request=>'97561000-0000-4000-8000-000000000001')));
select is((select count(*) from public.finance_entries),0::bigint,'vendas não lê o livro');
select throws_ok($$select pg_temp.save('jc')$$,'42501',null,'vendas JA não salva JC');
select throws_ok($$select public.save_finance_fee_rate(gen_random_uuid(),'stone_debito',1,'2026-09-01',null)$$,'42501',null,'vendas não grava taxa');
select set_config('request.jwt.claims','{"sub":"97560000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select (v->>'cash_amount')::numeric from results where k='created'),110::numeric,'venda em dinheiro contado + sangria - abertura');
select is((select (v->>'total_amount')::numeric from results where k='created'),1060::numeric,'total soma dinheiro, nove meios e PIX direto');
select is((select (v->>'sales_amount')::numeric from results where k='created'),1060::numeric,'venda total consistente');
select is((select count(*) from public.finance_entries where source_ref=(select (v->>'id')::uuid from results where k='created') and fee_of is null),11::bigint,'uma receita por meio mais dinheiro e PIX direto');
select is((select count(*) from public.finance_entries where source_ref=(select (v->>'id')::uuid from results where k='created') and fee_of is not null),8::bigint,'oito taxas conhecidas, SiTef PIX pendente');
select is((select amount from public.finance_entries where source_ref=(select (v->>'id')::uuid from results where k='created') and entry_type='lancamento' and reversed_at is null and source_detail='banrisul_credito' and fee_of is null),100::numeric,'receita única banrisul_credito');
select ok((select f.amount=1.79 and f.fee_rate=1.79 and f.fee_of=r.id and r.amount=100 from public.finance_entries f join public.finance_entries r on r.id=f.fee_of where f.source_ref=(select (v->>'id')::uuid from results where k='created') and f.entry_type='lancamento' and f.reversed_at is null and f.source_detail='banrisul_credito'),'taxa correta banrisul_credito');
select is((select amount from public.finance_entries where source_ref=(select (v->>'id')::uuid from results where k='created') and entry_type='lancamento' and reversed_at is null and source_detail='banrisul_debito' and fee_of is null),100::numeric,'receita única banrisul_debito');
select ok((select f.amount=1.39 and f.fee_rate=1.39 and f.fee_of=r.id and r.amount=100 from public.finance_entries f join public.finance_entries r on r.id=f.fee_of where f.source_ref=(select (v->>'id')::uuid from results where k='created') and f.entry_type='lancamento' and f.reversed_at is null and f.source_detail='banrisul_debito'),'taxa correta banrisul_debito');
select is((select amount from public.finance_entries where source_ref=(select (v->>'id')::uuid from results where k='created') and entry_type='lancamento' and reversed_at is null and source_detail='banrisul_pix' and fee_of is null),100::numeric,'receita única banrisul_pix');
select ok((select f.amount=0.89 and f.fee_rate=0.89 and f.fee_of=r.id and r.amount=100 from public.finance_entries f join public.finance_entries r on r.id=f.fee_of where f.source_ref=(select (v->>'id')::uuid from results where k='created') and f.entry_type='lancamento' and f.reversed_at is null and f.source_detail='banrisul_pix'),'taxa correta banrisul_pix');
select is((select amount from public.finance_entries where source_ref=(select (v->>'id')::uuid from results where k='created') and entry_type='lancamento' and reversed_at is null and source_detail='stone_credito' and fee_of is null),100::numeric,'receita única stone_credito');
select ok((select f.amount=3.57 and f.fee_rate=3.57 and f.fee_of=r.id and r.amount=100 from public.finance_entries f join public.finance_entries r on r.id=f.fee_of where f.source_ref=(select (v->>'id')::uuid from results where k='created') and f.entry_type='lancamento' and f.reversed_at is null and f.source_detail='stone_credito'),'taxa correta stone_credito');
select is((select amount from public.finance_entries where source_ref=(select (v->>'id')::uuid from results where k='created') and entry_type='lancamento' and reversed_at is null and source_detail='stone_debito' and fee_of is null),100::numeric,'receita única stone_debito');
select ok((select f.amount=1.09 and f.fee_rate=1.09 and f.fee_of=r.id and r.amount=100 from public.finance_entries f join public.finance_entries r on r.id=f.fee_of where f.source_ref=(select (v->>'id')::uuid from results where k='created') and f.entry_type='lancamento' and f.reversed_at is null and f.source_detail='stone_debito'),'taxa correta stone_debito');
select is((select amount from public.finance_entries where source_ref=(select (v->>'id')::uuid from results where k='created') and entry_type='lancamento' and reversed_at is null and source_detail='stone_pix' and fee_of is null),100::numeric,'receita única stone_pix');
select ok((select f.amount=0.5 and f.fee_rate=0.5 and f.fee_of=r.id and r.amount=100 from public.finance_entries f join public.finance_entries r on r.id=f.fee_of where f.source_ref=(select (v->>'id')::uuid from results where k='created') and f.entry_type='lancamento' and f.reversed_at is null and f.source_detail='stone_pix'),'taxa correta stone_pix');
select is((select amount from public.finance_entries where source_ref=(select (v->>'id')::uuid from results where k='created') and entry_type='lancamento' and reversed_at is null and source_detail='sitef_credito' and fee_of is null),100::numeric,'receita única sitef_credito');
select ok((select f.amount=2.05 and f.fee_rate=2.05 and f.fee_of=r.id and r.amount=100 from public.finance_entries f join public.finance_entries r on r.id=f.fee_of where f.source_ref=(select (v->>'id')::uuid from results where k='created') and f.entry_type='lancamento' and f.reversed_at is null and f.source_detail='sitef_credito'),'taxa correta sitef_credito');
select is((select amount from public.finance_entries where source_ref=(select (v->>'id')::uuid from results where k='created') and entry_type='lancamento' and reversed_at is null and source_detail='sitef_debito' and fee_of is null),100::numeric,'receita única sitef_debito');
select ok((select f.amount=0.89 and f.fee_rate=0.89 and f.fee_of=r.id and r.amount=100 from public.finance_entries f join public.finance_entries r on r.id=f.fee_of where f.source_ref=(select (v->>'id')::uuid from results where k='created') and f.entry_type='lancamento' and f.reversed_at is null and f.source_detail='sitef_debito'),'taxa correta sitef_debito');
select is((select amount from public.finance_entries where source_ref=(select (v->>'id')::uuid from results where k='created') and entry_type='lancamento' and reversed_at is null and source_detail='sitef_pix' and fee_of is null),100::numeric,'receita única sitef_pix');
select ok((select bool_and(account_id is null and payment_method=case when source_detail like '%_pix' then 'pix' else 'outro' end) from public.finance_entries where source_ref=(select (v->>'id')::uuid from results where k='created') and entry_type='lancamento' and reversed_at is null and fee_of is null and source_detail in ('banrisul_credito','banrisul_debito','banrisul_pix','stone_credito','stone_debito','stone_pix','sitef_credito','sitef_debito','sitef_pix')),'conta nula e forma conforme o meio');
select ok(exists(select 1 from jsonb_array_elements(public.get_finance_fee_rates()->'pending') p where p->>'method'='sitef_pix' and p->>'store'='ja' and (p->>'amount')::numeric>=100),'SiTef PIX aparece pendente');
insert into results values('before',(select jsonb_agg(to_jsonb(e) order by e.id) from public.finance_entries e where source_ref=(select (v->>'id')::uuid from results where k='created') and entry_type='lancamento' and reversed_at is null));
insert into results values('revision-count',jsonb_build_object('n',(select count(*) from public.cash_closing_revisions where closing_id=(select (v->>'id')::uuid from results where k='created'))));
select lives_ok($$select pg_temp.save()$$,'salvar sem mudança');
select is((select jsonb_agg(to_jsonb(e) order by e.id) from public.finance_entries e where source_ref=(select (v->>'id')::uuid from results where k='created') and entry_type='lancamento' and reversed_at is null),(select v from results where k='before'),'sem mudança preserva entradas e IDs');
select set_config('request.jwt.claims','{"sub":"97560000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(to_jsonb(public.save_cash_closing('97561000-0000-4000-8000-000000000001','ja','2026-11-02',null,100,20,10,0,100,100,100,0,100,100,100,0,100,100,100,50,0,0,0,0,'teste por meio')),(select v from results where k='created'),'replay precisa enviar versão original nula');
select throws_ok($$select public.save_cash_closing('97561000-0000-4000-8000-000000000001','ja','2026-11-02',null,101,20,10,0,100,100,100,0,100,100,100,0,100,100,100,50,0,0,0,0,'teste por meio')$$,'22023',null,'mesma chave conteúdo diferente');
select set_config('request.jwt.claims','{"sub":"97560000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*) from public.cash_closing_revisions where closing_id=(select (v->>'id')::uuid from results where k='created')),(select (v->>'n')::bigint from results where k='revision-count'),'sem mudança e replay não criam revisão');
select lives_ok($$select public.save_finance_fee_rate(gen_random_uuid(),'stone_debito',9,'2026-09-01',(select (x->'latest'->>'id')::uuid from jsonb_array_elements(public.get_finance_fee_rates()->'methods') x where x->>'method'='stone_debito'))$$,'mudar configuração stone_debito não altera versão já lançada');
select lives_ok($$select pg_temp.save(p_values=>'{"stone_debit_amount":200}')$$,'muda só Stone débito');
select is((select count(*) from public.finance_entries where source_ref=(select (v->>'id')::uuid from results where k='created') and entry_type='estorno'),2::bigint,'Stone débito estorna apenas receita e taxa');
select results_eq($$select id from public.finance_entries where source_ref=(select (v->>'id')::uuid from results where k='created') and entry_type='lancamento' and reversed_at is null and source_detail<>'stone_debito' order by id$$,$$select (e->>'id')::uuid from results cross join lateral jsonb_array_elements(v) e where k='before' and e->>'source_detail'<>'stone_debito' order by 1$$,'outros meios preservam exatamente seus IDs');
select ok((select r.amount=200 and f.amount=2.18 and f.fee_rate=1.09 from public.finance_entries r join public.finance_entries f on f.fee_of=r.id where r.source_ref=(select (v->>'id')::uuid from results where k='created') and r.entry_type='lancamento' and r.reversed_at is null and r.source_detail='stone_debito' and f.entry_type='lancamento' and f.reversed_at is null),'novo débito usa 1,09%, sem taxa de crédito');
select ok((select before_values->>'stone_debit_amount'='100.00' and after_values->>'stone_debit_amount'='200.00' and before_values ?& array['banri_credit_amount','banri_debit_amount','banri_pix_amount','stone_credit_amount','stone_debit_amount','stone_pix_amount','sitef_credit_amount','sitef_debit_amount','sitef_pix_amount'] and after_values ?& array['banri_credit_amount','banri_debit_amount','banri_pix_amount','stone_credit_amount','stone_debit_amount','stone_pix_amount','sitef_credit_amount','sitef_debit_amount','sitef_pix_amount'] from public.cash_closing_revisions where closing_id=(select (v->>'id')::uuid from results where k='created') and revision_type='edicao' order by changed_at desc, id desc limit 1),'revisão guarda nove campos antes e depois');
select lives_ok($$select pg_temp.save(p_values=>'{"stone_debit_amount":200,"banri_pix_amount":0}')$$,'zera Banrisul PIX');
select is((select count(*) from public.finance_entries where source_ref=(select (v->>'id')::uuid from results where k='created') and entry_type='lancamento' and reversed_at is null and source_detail='banrisul_pix'),0::bigint,'zerar meio estorna receita e taxa');
select throws_ok($$select pg_temp.save(p_day=>'2026-11-04',p_values=>'{"legacy":true,"banri_amount":100}',p_request=>'97561000-0000-4000-8000-000000000004')$$,'22023',null,'campo antigo em fechamento novo recusado');
select is((select count(*) from public.cash_closings where store='ja' and closing_date='2026-11-04'),0::bigint,'recusa não grava fechamento');
reset role;
select is((select count(*) from private.cash_closing_requests where request_id='97561000-0000-4000-8000-000000000004'),0::bigint,'recusa não grava recibo');
set local role authenticated;
select throws_ok($$select pg_temp.save(p_values=>'{"banri_amount":1}')$$,'22023',null,'antigo e novo juntos recusados');
select throws_ok($$select pg_temp.save(p_values=>'{"legacy":true,"banri_amount":1}')$$,'22023',null,'dia novo existente não aceita voltar ao formato antigo');
-- Snapshot antigo: prova não só totais, mas identidade dos meios não alterados.
insert into results values('old-before',(select jsonb_agg(to_jsonb(e) order by id) from public.finance_entries e where source_ref=(select id from public.cash_closings where store='ja' and closing_date='2026-11-01') and entry_type='lancamento' and reversed_at is null));
select lives_ok($$select public.save_finance_fee_rate(gen_random_uuid(),'banrisul',9,'2026-09-01',(select (x->'latest'->>'id')::uuid from jsonb_array_elements(public.get_finance_fee_rates()->'methods') x where x->>'method'='banrisul'))$$,'mudar configuração banrisul não altera versão já lançada');
select lives_ok($$select pg_temp.save(p_day=>'2026-11-01',p_values=>'{"legacy":true,"banri_amount":160,"stone_amount":50,"sitef_amount":25}')$$,'edita antigo pelos antigos');
select is((select banri_credit_amount+stone_credit_amount+sitef_credit_amount from public.cash_closings where store='ja' and closing_date='2026-11-01'),0::numeric,'antigo não vira crédito');
select results_eq($$select id from public.finance_entries where source_ref=(select id from public.cash_closings where store='ja' and closing_date='2026-11-01') and source_detail in ('stone','sitef') and entry_type='lancamento' and reversed_at is null order by id$$,$$select (e->>'id')::uuid from results cross join lateral jsonb_array_elements(v) e where k='old-before' and e->>'source_detail' in ('stone','sitef') order by 1$$,'Stone e SiTef antigos preservam receita e taxa por ID');
select ok((select r.amount=160 and f.amount=3.20 and f.fee_rate=2 from public.finance_entries r join public.finance_entries f on f.fee_of=r.id join public.cash_closings c on c.id=r.source_ref where c.store='ja' and c.closing_date='2026-11-01' and r.source_detail='banrisul' and r.entry_type='lancamento' and r.reversed_at is null and f.entry_type='lancamento' and f.reversed_at is null),'Banrisul antigo usa a taxa antiga, sem substituição pela nova');
select is((select count(*) from public.finance_entries e join public.cash_closings c on c.id=e.source_ref where c.store='ja' and c.closing_date='2026-11-01' and e.entry_type='estorno' and e.source_detail='banrisul'),2::bigint,'só receita e taxa Banrisul antigas estornadas');
select lives_ok($$select pg_temp.save(p_day=>'2026-11-01')$$,'conversão explícita para os nove meios');
select is((select count(*) from public.finance_entries e join public.cash_closings c on c.id=e.source_ref where c.store='ja' and c.closing_date='2026-11-01' and e.source_detail in ('banrisul','stone','sitef') and e.entry_type='lancamento' and e.reversed_at is null),0::bigint,'conversão estorna todos os meios antigos');
select is((select count(*) from public.finance_entries e join public.cash_closings c on c.id=e.source_ref where c.store='ja' and c.closing_date='2026-11-01' and e.source_detail in ('banrisul_credito','banrisul_debito','banrisul_pix','stone_credito','stone_debito','stone_pix','sitef_credito','sitef_debito','sitef_pix') and e.entry_type='lancamento' and e.reversed_at is null and e.fee_of is null),9::bigint,'conversão lança os nove meios');
select ok(not exists(select 1 from jsonb_array_elements((select v from results where k='old-before')) x where not exists(select 1 from public.finance_entries where id=(x->>'id')::uuid)),'conversão não apaga originais');
select throws_ok($$select public.save_cash_closing(gen_random_uuid(),'ja','2026-11-05',null,100,0,0,10,20,30,0,0,0,0,0,null)$$,'22023','Esta tela está desatualizada. Anote os números, recarregue a página e salve de novo.','assinatura antiga recusa orientando a recarga');
select is((select count(*) from public.cash_closings where store='ja' and closing_date='2026-11-05'),0::bigint,'assinatura antiga não grava');
select lives_ok($$select pg_temp.save('jc')$$,'financeiro salva JC');
select lives_ok($$select pg_temp.save('ex')$$,'financeiro salva EX sem ponte');
select is((select count(*) from public.finance_entries e join public.cash_closings c on c.id=e.source_ref where c.store='ex' and c.closing_date='2026-11-02'),0::bigint,'EX não gera livro');
select set_config('request.jwt.claims','{"sub":"97560000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select lives_ok($$select pg_temp.save('jc')$$,'vendas JC salva JC');
select throws_ok($$select pg_temp.save('ja')$$,'42501',null,'vendas JC não salva JA');
select set_config('request.jwt.claims','{"sub":"97560000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select pg_temp.save(p_values=>'{"banri_credit_amount":-1}')$$,'22023',null,'banri_credit_amount recusa -1');
select throws_ok($$select pg_temp.save(p_values=>'{"banri_credit_amount":"NaN"}')$$,'22023',null,'banri_credit_amount recusa NaN');
select throws_ok($$select pg_temp.save(p_values=>'{"banri_credit_amount":1000001}')$$,'22023',null,'banri_credit_amount recusa 1000001');
select throws_ok($$select pg_temp.save(p_values=>'{"banri_credit_amount":null}')$$,'22023',null,'banri_credit_amount recusa null');
select throws_ok($$select pg_temp.save(p_values=>'{"banri_debit_amount":-1}')$$,'22023',null,'banri_debit_amount recusa -1');
select throws_ok($$select pg_temp.save(p_values=>'{"banri_debit_amount":"NaN"}')$$,'22023',null,'banri_debit_amount recusa NaN');
select throws_ok($$select pg_temp.save(p_values=>'{"banri_debit_amount":1000001}')$$,'22023',null,'banri_debit_amount recusa 1000001');
select throws_ok($$select pg_temp.save(p_values=>'{"banri_debit_amount":null}')$$,'22023',null,'banri_debit_amount recusa null');
select throws_ok($$select pg_temp.save(p_values=>'{"banri_pix_amount":-1}')$$,'22023',null,'banri_pix_amount recusa -1');
select throws_ok($$select pg_temp.save(p_values=>'{"banri_pix_amount":"NaN"}')$$,'22023',null,'banri_pix_amount recusa NaN');
select throws_ok($$select pg_temp.save(p_values=>'{"banri_pix_amount":1000001}')$$,'22023',null,'banri_pix_amount recusa 1000001');
select throws_ok($$select pg_temp.save(p_values=>'{"banri_pix_amount":null}')$$,'22023',null,'banri_pix_amount recusa null');
select throws_ok($$select pg_temp.save(p_values=>'{"stone_credit_amount":-1}')$$,'22023',null,'stone_credit_amount recusa -1');
select throws_ok($$select pg_temp.save(p_values=>'{"stone_credit_amount":"NaN"}')$$,'22023',null,'stone_credit_amount recusa NaN');
select throws_ok($$select pg_temp.save(p_values=>'{"stone_credit_amount":1000001}')$$,'22023',null,'stone_credit_amount recusa 1000001');
select throws_ok($$select pg_temp.save(p_values=>'{"stone_credit_amount":null}')$$,'22023',null,'stone_credit_amount recusa null');
select throws_ok($$select pg_temp.save(p_values=>'{"stone_debit_amount":-1}')$$,'22023',null,'stone_debit_amount recusa -1');
select throws_ok($$select pg_temp.save(p_values=>'{"stone_debit_amount":"NaN"}')$$,'22023',null,'stone_debit_amount recusa NaN');
select throws_ok($$select pg_temp.save(p_values=>'{"stone_debit_amount":1000001}')$$,'22023',null,'stone_debit_amount recusa 1000001');
select throws_ok($$select pg_temp.save(p_values=>'{"stone_debit_amount":null}')$$,'22023',null,'stone_debit_amount recusa null');
select throws_ok($$select pg_temp.save(p_values=>'{"stone_pix_amount":-1}')$$,'22023',null,'stone_pix_amount recusa -1');
select throws_ok($$select pg_temp.save(p_values=>'{"stone_pix_amount":"NaN"}')$$,'22023',null,'stone_pix_amount recusa NaN');
select throws_ok($$select pg_temp.save(p_values=>'{"stone_pix_amount":1000001}')$$,'22023',null,'stone_pix_amount recusa 1000001');
select throws_ok($$select pg_temp.save(p_values=>'{"stone_pix_amount":null}')$$,'22023',null,'stone_pix_amount recusa null');
select throws_ok($$select pg_temp.save(p_values=>'{"sitef_credit_amount":-1}')$$,'22023',null,'sitef_credit_amount recusa -1');
select throws_ok($$select pg_temp.save(p_values=>'{"sitef_credit_amount":"NaN"}')$$,'22023',null,'sitef_credit_amount recusa NaN');
select throws_ok($$select pg_temp.save(p_values=>'{"sitef_credit_amount":1000001}')$$,'22023',null,'sitef_credit_amount recusa 1000001');
select throws_ok($$select pg_temp.save(p_values=>'{"sitef_credit_amount":null}')$$,'22023',null,'sitef_credit_amount recusa null');
select throws_ok($$select pg_temp.save(p_values=>'{"sitef_debit_amount":-1}')$$,'22023',null,'sitef_debit_amount recusa -1');
select throws_ok($$select pg_temp.save(p_values=>'{"sitef_debit_amount":"NaN"}')$$,'22023',null,'sitef_debit_amount recusa NaN');
select throws_ok($$select pg_temp.save(p_values=>'{"sitef_debit_amount":1000001}')$$,'22023',null,'sitef_debit_amount recusa 1000001');
select throws_ok($$select pg_temp.save(p_values=>'{"sitef_debit_amount":null}')$$,'22023',null,'sitef_debit_amount recusa null');
select throws_ok($$select pg_temp.save(p_values=>'{"sitef_pix_amount":-1}')$$,'22023',null,'sitef_pix_amount recusa -1');
select throws_ok($$select pg_temp.save(p_values=>'{"sitef_pix_amount":"NaN"}')$$,'22023',null,'sitef_pix_amount recusa NaN');
select throws_ok($$select pg_temp.save(p_values=>'{"sitef_pix_amount":1000001}')$$,'22023',null,'sitef_pix_amount recusa 1000001');
select throws_ok($$select pg_temp.save(p_values=>'{"sitef_pix_amount":null}')$$,'22023',null,'sitef_pix_amount recusa null');
reset role;
select is(private.cash_closing_method_label('banrisul_credito'),'Banrisul crédito','rótulo banrisul_credito');
select is((select count(*) from private.finance_fee_rates where method='banrisul_credito' and rate=1.79 and valid_from='2026-09-01' and author_name='Decisão do Rodrigo em 29/10/2026'),1::bigint,'taxa semeada banrisul_credito com vigência e autor');
set local role authenticated;
select ok(exists(select 1 from jsonb_array_elements(public.get_finance_fee_rates()->'methods') x where x->>'method'='banrisul_credito'),'painel retorna banrisul_credito');
reset role;
select is(private.cash_closing_method_label('banrisul_debito'),'Banrisul débito','rótulo banrisul_debito');
select is((select count(*) from private.finance_fee_rates where method='banrisul_debito' and rate=1.39 and valid_from='2026-09-01' and author_name='Decisão do Rodrigo em 29/10/2026'),1::bigint,'taxa semeada banrisul_debito com vigência e autor');
set local role authenticated;
select ok(exists(select 1 from jsonb_array_elements(public.get_finance_fee_rates()->'methods') x where x->>'method'='banrisul_debito'),'painel retorna banrisul_debito');
reset role;
select is(private.cash_closing_method_label('banrisul_pix'),'Banrisul PIX','rótulo banrisul_pix');
select is((select count(*) from private.finance_fee_rates where method='banrisul_pix' and rate=0.89 and valid_from='2026-09-01' and author_name='Decisão do Rodrigo em 29/10/2026'),1::bigint,'taxa semeada banrisul_pix com vigência e autor');
set local role authenticated;
select ok(exists(select 1 from jsonb_array_elements(public.get_finance_fee_rates()->'methods') x where x->>'method'='banrisul_pix'),'painel retorna banrisul_pix');
reset role;
select is(private.cash_closing_method_label('stone_credito'),'Stone crédito','rótulo stone_credito');
select is((select count(*) from private.finance_fee_rates where method='stone_credito' and rate=3.57 and valid_from='2026-09-01' and author_name='Decisão do Rodrigo em 29/10/2026'),1::bigint,'taxa semeada stone_credito com vigência e autor');
set local role authenticated;
select ok(exists(select 1 from jsonb_array_elements(public.get_finance_fee_rates()->'methods') x where x->>'method'='stone_credito'),'painel retorna stone_credito');
reset role;
select is(private.cash_closing_method_label('stone_debito'),'Stone débito','rótulo stone_debito');
select is((select count(*) from private.finance_fee_rates where method='stone_debito' and rate=1.09 and valid_from='2026-09-01' and author_name='Decisão do Rodrigo em 29/10/2026'),1::bigint,'taxa semeada stone_debito com vigência e autor');
set local role authenticated;
select ok(exists(select 1 from jsonb_array_elements(public.get_finance_fee_rates()->'methods') x where x->>'method'='stone_debito'),'painel retorna stone_debito');
reset role;
select is(private.cash_closing_method_label('stone_pix'),'Stone PIX','rótulo stone_pix');
select is((select count(*) from private.finance_fee_rates where method='stone_pix' and rate=0.5 and valid_from='2026-09-01' and author_name='Decisão do Rodrigo em 29/10/2026'),1::bigint,'taxa semeada stone_pix com vigência e autor');
set local role authenticated;
select ok(exists(select 1 from jsonb_array_elements(public.get_finance_fee_rates()->'methods') x where x->>'method'='stone_pix'),'painel retorna stone_pix');
reset role;
select is(private.cash_closing_method_label('sitef_credito'),'SiTef crédito','rótulo sitef_credito');
select is((select count(*) from private.finance_fee_rates where method='sitef_credito' and rate=2.05 and valid_from='2026-09-01' and author_name='Decisão do Rodrigo em 29/10/2026'),1::bigint,'taxa semeada sitef_credito com vigência e autor');
set local role authenticated;
select ok(exists(select 1 from jsonb_array_elements(public.get_finance_fee_rates()->'methods') x where x->>'method'='sitef_credito'),'painel retorna sitef_credito');
reset role;
select is(private.cash_closing_method_label('sitef_debito'),'SiTef débito','rótulo sitef_debito');
select is((select count(*) from private.finance_fee_rates where method='sitef_debito' and rate=0.89 and valid_from='2026-09-01' and author_name='Decisão do Rodrigo em 29/10/2026'),1::bigint,'taxa semeada sitef_debito com vigência e autor');
set local role authenticated;
select ok(exists(select 1 from jsonb_array_elements(public.get_finance_fee_rates()->'methods') x where x->>'method'='sitef_debito'),'painel retorna sitef_debito');
reset role;
select is(private.cash_closing_method_label('sitef_pix'),'SiTef PIX','rótulo sitef_pix');
set local role authenticated;
select ok(exists(select 1 from jsonb_array_elements(public.get_finance_fee_rates()->'methods') x where x->>'method'='sitef_pix'),'painel retorna sitef_pix');
reset role;
select is((select count(*) from private.finance_fee_rates where method='sitef_pix'),0::bigint,'SiTef PIX não tem taxa presumida');
select * from finish();
rollback;
