-- Financeiro fase 3, PR 3a: crédito, débito e PIX por maquininha.
-- Decisão do Rodrigo em 29/10/2026: taxa de quem processa a venda.
-- Formato por fechamento: antigos continuam editáveis nos campos conjuntos;
-- novos usam nove campos, sem converter total antigo em crédito. Conversão
-- explícita zera antigos e preenche novos, estornando sem apagar o histórico.
-- Taxas novas desde 01/09/2026: alcançam dias faltantes lançados agora;
-- não afetam dias antigos nem corrigem suas taxas. Correção por extrato fica
-- para outra PR. SiTef PIX permanece pendente, sem taxa presumida.
-- Mantidos autorização, recibos, PT409 e travas pedido > ponte > linha.
-- Tela antiga recusa com 22023 e orientação para recarregar.
-- Reversão por PR com tela compatível; ponte pode ser desligada por migration
-- nova e receitas/taxas estornadas sem exclusão. Colunas antigas permanecem.
begin;
alter table public.cash_closings
 add column banri_credit_amount numeric(12,2) not null default 0 check (banri_credit_amount >= 0),
 add column banri_debit_amount numeric(12,2) not null default 0 check (banri_debit_amount >= 0),
 add column banri_pix_amount numeric(12,2) not null default 0 check (banri_pix_amount >= 0),
 add column stone_credit_amount numeric(12,2) not null default 0 check (stone_credit_amount >= 0),
 add column stone_debit_amount numeric(12,2) not null default 0 check (stone_debit_amount >= 0),
 add column stone_pix_amount numeric(12,2) not null default 0 check (stone_pix_amount >= 0),
 add column sitef_credit_amount numeric(12,2) not null default 0 check (sitef_credit_amount >= 0),
 add column sitef_debit_amount numeric(12,2) not null default 0 check (sitef_debit_amount >= 0),
 add column sitef_pix_amount numeric(12,2) not null default 0 check (sitef_pix_amount >= 0);
comment on column public.cash_closings.banri_amount is 'formato antigo, crédito e débito juntos; fechamentos salvos antes da troca de 2026-11';
comment on column public.cash_closings.stone_amount is 'formato antigo, crédito e débito juntos; fechamentos salvos antes da troca de 2026-11';
comment on column public.cash_closings.sitef_amount is 'formato antigo, crédito e débito juntos; fechamentos salvos antes da troca de 2026-11';
alter table public.finance_entries drop constraint finance_entries_source_detail_check;
alter table public.finance_entries add constraint finance_entries_source_detail_check check (source_detail in ('dinheiro','banrisul','stone','sitef','pix','ifood','food99','banrisul_credito','banrisul_debito','banrisul_pix','stone_credito','stone_debito','stone_pix','sitef_credito','sitef_debito','sitef_pix'));
alter table private.finance_fee_rates drop constraint finance_fee_rates_method_check;
alter table private.finance_fee_rates add constraint finance_fee_rates_method_check check (method in ('banrisul','stone','sitef','pix','ifood','food99','banrisul_credito','banrisul_debito','banrisul_pix','stone_credito','stone_debito','stone_pix','sitef_credito','sitef_debito','sitef_pix'));
insert into private.finance_fee_rates(method,rate,valid_from,author_name) values
 ('banrisul_credito',1.79,'2026-09-01','Decisão do Rodrigo em 29/10/2026'),
 ('banrisul_debito',1.39,'2026-09-01','Decisão do Rodrigo em 29/10/2026'),
 ('banrisul_pix',0.89,'2026-09-01','Decisão do Rodrigo em 29/10/2026'),
 ('stone_credito',3.57,'2026-09-01','Decisão do Rodrigo em 29/10/2026'),
 ('stone_debito',1.09,'2026-09-01','Decisão do Rodrigo em 29/10/2026'),
 ('stone_pix',0.5,'2026-09-01','Decisão do Rodrigo em 29/10/2026'),
 ('sitef_credito',2.05,'2026-09-01','Decisão do Rodrigo em 29/10/2026'),
 ('sitef_debito',0.89,'2026-09-01','Decisão do Rodrigo em 29/10/2026');
create or replace function private.cash_closing_method_label(p_method text) returns text
language sql immutable security definer set search_path = '' as $$
 select case p_method when 'dinheiro' then 'Dinheiro' when 'banrisul' then 'Banrisul' when 'stone' then 'Stone'
 when 'sitef' then 'SiTef' when 'pix' then 'PIX' when 'ifood' then 'iFood' when 'food99' then '99Food' when 'banrisul_credito' then 'Banrisul crédito' when 'banrisul_debito' then 'Banrisul débito' when 'banrisul_pix' then 'Banrisul PIX' when 'stone_credito' then 'Stone crédito' when 'stone_debito' then 'Stone débito' when 'stone_pix' then 'Stone PIX' when 'sitef_credito' then 'SiTef crédito' when 'sitef_debito' then 'SiTef débito' when 'sitef_pix' then 'SiTef PIX' end;
$$;
revoke all on function private.cash_closing_method_label(text) from public, anon, authenticated, service_role;
create or replace function private.sync_cash_closing_finance_entries(p_closing_id uuid,p_actor uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
 v_c public.cash_closings; v_settings private.cash_closing_bridge_settings; v_m record;
 v_e public.finance_entries; v_fee public.finance_entries; v_version uuid; v_account uuid; v_category uuid;
 v_id uuid; v_reason text; v_account_key text;
begin
 perform private.lock_cash_closing_bridge();
 select * into v_c from public.cash_closings where id=p_closing_id for update;
 if not found then raise exception using errcode='22023',message='Fechamento não encontrado.'; end if;
 if v_c.store='ex' then raise exception using errcode='22023',message='O fechamento da EX não entra no livro pela ponte.'; end if;
 select * into strict v_settings from private.cash_closing_bridge_settings;
 if not v_settings.enabled or v_c.closing_date<v_settings.start_date then return; end if;
 if p_actor is null or not exists(select 1 from auth.users where id=p_actor) then
  raise exception using errcode='22023',message='Autor do fechamento inválido.';
 end if;
 for v_m in select * from (values ('dinheiro',v_c.cash_amount),('banrisul',v_c.banri_amount),('stone',v_c.stone_amount),('sitef',v_c.sitef_amount),('banrisul_credito',v_c.banri_credit_amount),('banrisul_debito',v_c.banri_debit_amount),('banrisul_pix',v_c.banri_pix_amount),('stone_credito',v_c.stone_credit_amount),('stone_debito',v_c.stone_debit_amount),('stone_pix',v_c.stone_pix_amount),('sitef_credito',v_c.sitef_credit_amount),('sitef_debito',v_c.sitef_debit_amount),('sitef_pix',v_c.sitef_pix_amount),('pix',v_c.pix_amount),('ifood',v_c.ifood_sales_amount),('food99',v_c.food99_sales_amount)) as m(method,amount) loop
  select * into v_e from public.finance_entries where source='fechamento_caixa' and source_ref=v_c.id and source_detail=v_m.method and fee_of is null and entry_type='lancamento' and reversed_at is null for update;
  if coalesce(v_e.amount,0)=v_m.amount then continue; end if;
  v_version:=null;
  -- O histórico da taxa, inclusive estornada, congela a versão para as correções.
  select fee_rate_version_id into v_version from public.finance_entries where source='fechamento_caixa' and source_ref=v_c.id and source_detail=v_m.method and fee_of is not null and entry_type='lancamento' order by created_at desc,id desc limit 1;
  if v_version is null then select (private.finance_fee_rate_at(v_m.method,v_c.closing_date)).id into v_version; end if;
  if v_e.id is not null then
   v_reason:='Fechamento corrigido: '||private.cash_closing_method_label(v_m.method)||' de R$ '||replace(to_char(v_e.amount,'FM999999990.00'),'.',',')||' para R$ '||replace(to_char(v_m.amount,'FM999999990.00'),'.',',');
   for v_fee in select * from public.finance_entries where fee_of=v_e.id and entry_type='lancamento' and reversed_at is null for update loop
    perform private.reverse_cash_closing_entry(v_fee.id,p_actor,v_reason);
   end loop;
   perform private.reverse_cash_closing_entry(v_e.id,p_actor,v_reason);
  end if;
  if v_m.amount=0 then continue; end if;
  v_account:=null;
  v_account_key:=case when v_m.method='dinheiro' then 'caixa_fisico_'||v_c.store when v_m.method='ifood' then 'banco_ifood' end;
  if v_account_key is not null then
   select id into v_account from public.finance_accounts where key=v_account_key and active;
   if v_account is null then raise exception using errcode='22023',message='A conta '||v_account_key||' está ausente ou inativa. Reative a conta para salvar o fechamento.'; end if;
  end if;
  select id into strict v_category from public.finance_categories where key=case when v_m.method in ('ifood','food99') then v_m.method else 'venda_balcao' end;
  insert into public.finance_entries(request_id,category_id,account_id,store,competence_month,due_date,planned_amount,paid_date,amount,payment_method,description,source,source_ref,source_detail,created_by,created_at)
  values(gen_random_uuid(),v_category,v_account,v_c.store,date_trunc('month',v_c.closing_date)::date,v_c.closing_date,v_m.amount,v_c.closing_date,v_m.amount,
   case when v_m.method='dinheiro' then 'dinheiro' when v_m.method='pix' or v_m.method in ('banrisul_pix','stone_pix','sitef_pix') then 'pix' else 'outro' end,
   'Fechamento '||upper(v_c.store)||' '||to_char(v_c.closing_date,'DD/MM/YYYY')||' · '||private.cash_closing_method_label(v_m.method),'fechamento_caixa',v_c.id,v_m.method,p_actor,clock_timestamp()) returning id into v_id;
  if v_version is not null and v_m.method<>'dinheiro' then perform private.create_cash_closing_fee(v_id,v_version,p_actor); end if;
 end loop;
end; $$;
revoke all on function private.sync_cash_closing_finance_entries(uuid,uuid) from public, anon, authenticated, service_role;
create or replace function public.save_finance_fee_rate(p_request_id uuid,p_method text,p_rate numeric,p_valid_from date,p_expected_latest_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
 v_summary jsonb; v_previous private.finance_fee_rates; v_new private.finance_fee_rates;
 v_latest uuid; v_start date; v_actor uuid:=auth.uid(); v_name text; v_e public.finance_entries; v_count integer:=0;
begin
 perform private.lock_financial_request(p_request_id);
 perform private.lock_cash_closing_bridge();
 if not private.current_user_can_finance('financeiro.taxas') then
  raise exception using errcode='42501',message='Sem permissão para mudar as taxas dos meios de pagamento.';
 end if;
 select start_date into strict v_start from private.cash_closing_bridge_settings;
 if p_request_id is null or p_method is null or p_method not in ('banrisul','stone','sitef','pix','ifood','food99','banrisul_credito','banrisul_debito','banrisul_pix','stone_credito','stone_debito','stone_pix','sitef_credito','sitef_debito','sitef_pix')
 or p_valid_from is null or p_valid_from<v_start
 or (p_rate is not null and (p_rate::text in ('NaN','Infinity','-Infinity') or p_rate<0 or p_rate>100 or p_rate<>round(p_rate,4))) then
  raise exception using errcode='22023',message='Informe um meio válido, taxa entre 0 e 100 com até quatro casas e vigência a partir do início da ponte.';
 end if;
 v_summary:=jsonb_build_object('method',p_method,'rate',p_rate,'valid_from',p_valid_from,'expected_latest_id',p_expected_latest_id,'actor',v_actor);
 select * into v_previous from private.finance_fee_rates where request_id=p_request_id;
 if found then
  if (v_previous.request_summary-'result') is distinct from v_summary then
   raise exception using errcode='22023',message='Esta identificação de salvamento já foi usada com outro conteúdo.';
  end if;
  return v_previous.request_summary->'result';
 end if;
 select id into v_latest from private.finance_fee_rates where method=p_method order by created_at desc,id desc limit 1;
 if p_expected_latest_id is distinct from v_latest then
  raise exception using errcode='PT409',message='Outra pessoa mudou esta taxa. Recarregue para ver a atual.';
 end if;
 select coalesce(nullif(btrim(display_name),''),'Sem nome') into v_name from public.app_profiles where user_id=v_actor;
 -- Calculamos o retorno antes da inserção: o histórico é somente de inserção.
 -- A trava comum impede que o conjunto de receitas mude entre contagem e criação.
 select count(*)::integer into v_count from public.finance_entries e
 where e.source='fechamento_caixa' and e.source_detail=p_method and e.fee_of is null and e.entry_type='lancamento' and e.reversed_at is null
 and e.paid_date>=p_valid_from and p_rate is not null and round(e.amount*p_rate/100,2)>0
 and not exists(select 1 from public.finance_entries f where f.fee_of=e.id and f.entry_type='lancamento' and f.reversed_at is null)
 and not exists(select 1 from private.finance_fee_rates r where r.method=p_method and r.valid_from>p_valid_from and r.valid_from<=e.paid_date);
 v_new.id:=gen_random_uuid();
 v_new.created_at:=clock_timestamp();
 v_summary:=v_summary||jsonb_build_object('result',jsonb_build_object('version',jsonb_build_object('id',v_new.id,'method',p_method,'rate',p_rate,'valid_from',p_valid_from,'author_id',v_actor,'author_name',v_name,'created_at',v_new.created_at),'fees_created',v_count));
 insert into private.finance_fee_rates(id,method,rate,valid_from,request_id,request_summary,author_id,author_name,created_at)
 values(v_new.id,p_method,p_rate,p_valid_from,p_request_id,v_summary,v_actor,v_name,v_new.created_at) returning * into v_new;
 for v_e in select e.* from public.finance_entries e where e.source='fechamento_caixa' and e.source_detail=p_method and e.fee_of is null and e.entry_type='lancamento' and e.reversed_at is null
 and not exists(select 1 from public.finance_entries f where f.fee_of=e.id and f.entry_type='lancamento' and f.reversed_at is null)
 and (private.finance_fee_rate_at(p_method,e.paid_date)).id=v_new.id for update loop
  perform private.create_cash_closing_fee(v_e.id,v_new.id,v_actor);
 end loop;
 return v_new.request_summary->'result';
end; $$;
revoke all on function public.save_finance_fee_rate(uuid,text,numeric,date,uuid) from public, anon, authenticated, service_role;
grant execute on function public.save_finance_fee_rate(uuid,text,numeric,date,uuid) to authenticated;
create or replace function public.get_finance_fee_rates() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_methods jsonb; v_history jsonb; v_pending jsonb; v_settings jsonb;
begin
 if not private.current_user_can_finance('financeiro.acessar') then
  raise exception using errcode='42501',message='Sem permissão para consultar as taxas dos meios de pagamento.';
 end if;
 select jsonb_build_object('enabled',enabled,'start_date',start_date) into v_settings from private.cash_closing_bridge_settings;
 select jsonb_agg(jsonb_build_object('method',m.method,'latest',
  (select to_jsonb(r)-'request_summary'-'request_id' from private.finance_fee_rates r where r.method=m.method order by r.created_at desc,r.id desc limit 1),
  'current',to_jsonb(private.finance_fee_rate_at(m.method,private.data_na_padaria()))-'request_summary'-'request_id')) into v_methods
 from unnest(array['banrisul','stone','sitef','pix','ifood','food99','banrisul_credito','banrisul_debito','banrisul_pix','stone_credito','stone_debito','stone_pix','sitef_credito','sitef_debito','sitef_pix']) m(method);
 select coalesce(jsonb_agg(to_jsonb(r)-'request_summary'-'request_id' order by r.created_at desc,r.id desc),'[]'::jsonb) into v_history from private.finance_fee_rates r;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.method,p.store,p.competence_month),'[]'::jsonb) into v_pending from (
  select e.source_detail as method,e.store,e.competence_month,sum(e.amount) as amount,count(*) as quantity from public.finance_entries e
  where e.source='fechamento_caixa' and e.source_detail<>'dinheiro' and e.fee_of is null and e.entry_type='lancamento' and e.reversed_at is null
  and private.current_user_can_finance_store('financeiro.acessar', e.store)
  and (private.finance_fee_rate_at(e.source_detail,e.paid_date)).rate is null
  and not exists(select 1 from public.finance_entries f where f.fee_of=e.id and f.entry_type='lancamento' and f.reversed_at is null)
  group by e.source_detail,e.store,e.competence_month
 ) p;
 return jsonb_build_object('can_edit',private.current_user_can_finance('financeiro.taxas'),'bridge',v_settings,'methods',v_methods,'history',v_history,'pending',v_pending);
end; $$;
revoke all on function public.get_finance_fee_rates() from public, anon, authenticated, service_role;
grant execute on function public.get_finance_fee_rates() to authenticated;
create or replace function public.save_cash_closing(
 p_request_id uuid, p_store text, p_closing_date date, p_updated_at timestamptz,
 p_closing_cash_amount numeric,
 p_cash_withdrawal_amount numeric,
 p_opening_cash_amount numeric,
 p_banri_amount numeric,
 p_banri_credit_amount numeric,
 p_banri_debit_amount numeric,
 p_banri_pix_amount numeric,
 p_stone_amount numeric,
 p_stone_credit_amount numeric,
 p_stone_debit_amount numeric,
 p_stone_pix_amount numeric,
 p_sitef_amount numeric,
 p_sitef_credit_amount numeric,
 p_sitef_debit_amount numeric,
 p_sitef_pix_amount numeric,
 p_pix_amount numeric,
 p_ifood_sales_amount numeric,
 p_food99_sales_amount numeric,
 p_envelope_amount numeric,
 p_next_day_cash_amount numeric, p_notes text
) returns public.cash_closings language plpgsql security definer set search_path = '' as $$
declare
 v_actor uuid := auth.uid();
 v_name text;
 v_old public.cash_closings;
 v_new public.cash_closings;
 v_receipt private.cash_closing_requests;
 v_summary jsonb;
 v_cash numeric;
 v_total numeric;
 v_exists boolean;
begin
 perform private.lock_financial_request(p_request_id);
 perform private.lock_cash_closing_bridge();
 select coalesce(nullif(btrim(p.display_name), ''), auth.jwt()->>'email', 'Sem nome') into v_name from public.app_profiles p
 where p.user_id = v_actor and p.active
 and (p.role in ('admin','financeiro') or (p.role = 'vendas' and p.store = p_store));
 if not found then
  raise exception using errcode = '42501', message = 'Sem permissão para fechar o caixa desta loja';
 end if;
 if p_request_id is null or p_store is null or p_store not in ('jc','ja','ex')
 or p_closing_date is null or p_closing_date > private.data_na_padaria() then
  raise exception using errcode = '22023', message = 'Informe uma loja válida, uma data até hoje e a identificação do salvamento.';
 end if;
 if exists (select 1 from unnest(array[p_closing_cash_amount,p_cash_withdrawal_amount,p_opening_cash_amount,p_banri_amount,p_stone_amount,p_sitef_amount,p_banri_credit_amount,p_banri_debit_amount,p_banri_pix_amount,p_stone_credit_amount,p_stone_debit_amount,p_stone_pix_amount,p_sitef_credit_amount,p_sitef_debit_amount,p_sitef_pix_amount,p_pix_amount,p_ifood_sales_amount,p_food99_sales_amount,p_envelope_amount,p_next_day_cash_amount]) as x(value)
 where value is null or value < 0 or value > 1000000 or value::text in ('NaN','Infinity','-Infinity')) then
  raise exception using errcode = '22023', message = 'Informe valores entre zero e 1.000.000.';
 end if;
 p_closing_cash_amount := round(p_closing_cash_amount, 2);
 p_cash_withdrawal_amount := round(p_cash_withdrawal_amount, 2);
 p_opening_cash_amount := round(p_opening_cash_amount, 2);
 p_banri_amount := round(p_banri_amount, 2);
 p_stone_amount := round(p_stone_amount, 2);
 p_sitef_amount := round(p_sitef_amount, 2);
 p_pix_amount := round(p_pix_amount, 2);
 p_ifood_sales_amount := round(p_ifood_sales_amount, 2);
 p_food99_sales_amount := round(p_food99_sales_amount, 2);
 p_envelope_amount := round(p_envelope_amount, 2);
 p_next_day_cash_amount := round(p_next_day_cash_amount, 2);
 p_banri_credit_amount := round(p_banri_credit_amount, 2);
 p_banri_debit_amount := round(p_banri_debit_amount, 2);
 p_banri_pix_amount := round(p_banri_pix_amount, 2);
 p_stone_credit_amount := round(p_stone_credit_amount, 2);
 p_stone_debit_amount := round(p_stone_debit_amount, 2);
 p_stone_pix_amount := round(p_stone_pix_amount, 2);
 p_sitef_credit_amount := round(p_sitef_credit_amount, 2);
 p_sitef_debit_amount := round(p_sitef_debit_amount, 2);
 p_sitef_pix_amount := round(p_sitef_pix_amount, 2);
 p_notes := nullif(btrim(p_notes), '');
 v_summary := jsonb_build_object('store',p_store,'closing_date',p_closing_date,'updated_at',p_updated_at,
 'closing_cash_amount',p_closing_cash_amount,'cash_withdrawal_amount',p_cash_withdrawal_amount,'opening_cash_amount',p_opening_cash_amount,'banri_amount',p_banri_amount,'stone_amount',p_stone_amount,'sitef_amount',p_sitef_amount,'pix_amount',p_pix_amount,'ifood_sales_amount',p_ifood_sales_amount,'food99_sales_amount',p_food99_sales_amount,'envelope_amount',p_envelope_amount,'next_day_cash_amount',p_next_day_cash_amount,'banri_credit_amount',p_banri_credit_amount,'banri_debit_amount',p_banri_debit_amount,'banri_pix_amount',p_banri_pix_amount,'stone_credit_amount',p_stone_credit_amount,'stone_debit_amount',p_stone_debit_amount,'stone_pix_amount',p_stone_pix_amount,'sitef_credit_amount',p_sitef_credit_amount,'sitef_debit_amount',p_sitef_debit_amount,'sitef_pix_amount',p_sitef_pix_amount,'notes',p_notes,'actor',v_actor);
 select * into v_receipt from private.cash_closing_requests where request_id = p_request_id;
 if found then
  if v_receipt.request_summary is distinct from v_summary then
   raise exception using errcode = '22023', message = 'Esta identificação de salvamento já foi usada com outro conteúdo.';
  end if;
  select * into v_new from public.cash_closings where id = v_receipt.closing_id;
  return v_new;
 end if;
 v_cash := p_closing_cash_amount + p_cash_withdrawal_amount - p_opening_cash_amount;
 if v_cash < 0 then
  raise exception using errcode = '22023', message = 'Revise os valores: a venda em dinheiro ficou negativa.';
 end if;
 v_total := v_cash + p_banri_amount + p_stone_amount + p_sitef_amount + p_pix_amount + p_banri_credit_amount + p_banri_debit_amount + p_banri_pix_amount + p_stone_credit_amount + p_stone_debit_amount + p_stone_pix_amount + p_sitef_credit_amount + p_sitef_debit_amount + p_sitef_pix_amount;
 select * into v_old from public.cash_closings where store=p_store and closing_date=p_closing_date for update;
 v_exists := found;
 if (v_exists and (p_updated_at is null or p_updated_at is distinct from v_old.updated_at))
 or (not v_exists and p_updated_at is not null) then
  raise exception using errcode = 'PT409', message = 'Outro salvamento mudou este fechamento. Confira os números antes de substituir.';
 end if;
 -- O formato pertence ao fechamento, nunca à data nem à taxa disponível.
 if (p_banri_amount > 0 or p_stone_amount > 0 or p_sitef_amount > 0) and (p_banri_credit_amount > 0 or p_banri_debit_amount > 0 or p_banri_pix_amount > 0 or p_stone_credit_amount > 0 or p_stone_debit_amount > 0 or p_stone_pix_amount > 0 or p_sitef_credit_amount > 0 or p_sitef_debit_amount > 0 or p_sitef_pix_amount > 0) then
  raise exception using errcode='22023', message='Use os campos do formato antigo ou os campos separados por crédito, débito e PIX, sem misturar os dois.';
 end if;
 if (p_banri_amount > 0 or p_stone_amount > 0 or p_sitef_amount > 0) and (not v_exists or not (v_old.banri_amount > 0 or v_old.stone_amount > 0 or v_old.sitef_amount > 0 or v_old.site_sales_amount > 0)) then
  raise exception using errcode='22023', message='Este dia usa os campos separados por crédito, débito e PIX de cada maquininha. Recarregue a página antes de salvar.';
 end if;
 if v_exists and v_old.banri_credit_amount = p_banri_credit_amount and v_old.banri_debit_amount = p_banri_debit_amount and v_old.banri_pix_amount = p_banri_pix_amount and v_old.stone_credit_amount = p_stone_credit_amount and v_old.stone_debit_amount = p_stone_debit_amount and v_old.stone_pix_amount = p_stone_pix_amount and v_old.sitef_credit_amount = p_sitef_credit_amount and v_old.sitef_debit_amount = p_sitef_debit_amount and v_old.sitef_pix_amount = p_sitef_pix_amount and v_old.closing_cash_amount = p_closing_cash_amount and v_old.cash_withdrawal_amount = p_cash_withdrawal_amount and v_old.opening_cash_amount = p_opening_cash_amount and v_old.banri_amount = p_banri_amount and v_old.stone_amount = p_stone_amount and v_old.sitef_amount = p_sitef_amount and v_old.pix_amount = p_pix_amount and v_old.ifood_sales_amount = p_ifood_sales_amount and v_old.food99_sales_amount = p_food99_sales_amount and v_old.envelope_amount = p_envelope_amount and v_old.next_day_cash_amount = p_next_day_cash_amount
 and v_old.site_sales_amount = 0 and v_old.cash_amount = v_cash
 and v_old.sales_amount = v_total and v_old.total_amount = v_total and v_old.notes is not distinct from p_notes then
  insert into private.cash_closing_requests values(p_request_id,v_summary,v_old.id);
  return v_old;
 end if;
 if v_exists then
  update public.cash_closings set
   closing_cash_amount=p_closing_cash_amount,
   cash_withdrawal_amount=p_cash_withdrawal_amount,
   opening_cash_amount=p_opening_cash_amount,
   banri_amount=p_banri_amount,
   stone_amount=p_stone_amount,
   sitef_amount=p_sitef_amount,
   banri_credit_amount=p_banri_credit_amount,
   banri_debit_amount=p_banri_debit_amount,
   banri_pix_amount=p_banri_pix_amount,
   stone_credit_amount=p_stone_credit_amount,
   stone_debit_amount=p_stone_debit_amount,
   stone_pix_amount=p_stone_pix_amount,
   sitef_credit_amount=p_sitef_credit_amount,
   sitef_debit_amount=p_sitef_debit_amount,
   sitef_pix_amount=p_sitef_pix_amount,
   pix_amount=p_pix_amount,
   ifood_sales_amount=p_ifood_sales_amount,
   food99_sales_amount=p_food99_sales_amount,
   envelope_amount=p_envelope_amount,
   next_day_cash_amount=p_next_day_cash_amount,
   cash_amount=v_cash, sales_amount=v_total, total_amount=v_total, site_sales_amount=0,
   notes=p_notes, updated_by=v_actor::text, updated_by_name=v_name
  where id=v_old.id returning * into v_new;
 else
  begin
   insert into public.cash_closings(store,closing_date,weekday_label,closing_cash_amount,cash_withdrawal_amount,opening_cash_amount,banri_amount,stone_amount,sitef_amount,banri_credit_amount,banri_debit_amount,banri_pix_amount,stone_credit_amount,stone_debit_amount,stone_pix_amount,sitef_credit_amount,sitef_debit_amount,sitef_pix_amount,pix_amount,ifood_sales_amount,food99_sales_amount,envelope_amount,next_day_cash_amount,cash_amount,sales_amount,total_amount,site_sales_amount,notes,created_by,created_by_name,created_by_email,updated_by,updated_by_name,updated_at)
   values(p_store,p_closing_date,(array['domingo','segunda','terca','quarta','quinta','sexta','sabado'])[extract(dow from p_closing_date)::integer+1],p_closing_cash_amount,p_cash_withdrawal_amount,p_opening_cash_amount,p_banri_amount,p_stone_amount,p_sitef_amount,p_banri_credit_amount,p_banri_debit_amount,p_banri_pix_amount,p_stone_credit_amount,p_stone_debit_amount,p_stone_pix_amount,p_sitef_credit_amount,p_sitef_debit_amount,p_sitef_pix_amount,p_pix_amount,p_ifood_sales_amount,p_food99_sales_amount,p_envelope_amount,p_next_day_cash_amount,v_cash,v_total,v_total,0,p_notes,v_actor::text,v_name,auth.jwt()->>'email',v_actor::text,v_name,clock_timestamp()) returning * into v_new;
  exception when unique_violation then
   raise exception using errcode = 'PT409', message = 'Outro salvamento criou este fechamento. Confira os números antes de substituir.';
  end;
 end if;
 insert into public.cash_closing_revisions(closing_id,store,revision_type,reason,before_values,after_values,request_id,request_summary,author_id,author_name)
 values(v_new.id,v_new.store,case when v_exists then 'edicao' else 'criacao' end,'Salvamento do fechamento',case when v_exists then jsonb_build_object('sales_amount', v_old.sales_amount, 'cash_amount', v_old.cash_amount, 'total_amount', v_old.total_amount, 'site_sales_amount', v_old.site_sales_amount, 'closing_cash_amount', v_old.closing_cash_amount, 'cash_withdrawal_amount', v_old.cash_withdrawal_amount, 'opening_cash_amount', v_old.opening_cash_amount, 'banri_amount', v_old.banri_amount, 'stone_amount', v_old.stone_amount, 'sitef_amount', v_old.sitef_amount, 'pix_amount', v_old.pix_amount, 'ifood_sales_amount', v_old.ifood_sales_amount, 'food99_sales_amount', v_old.food99_sales_amount, 'envelope_amount', v_old.envelope_amount, 'next_day_cash_amount', v_old.next_day_cash_amount, 'banri_credit_amount', v_old.banri_credit_amount, 'banri_debit_amount', v_old.banri_debit_amount, 'banri_pix_amount', v_old.banri_pix_amount, 'stone_credit_amount', v_old.stone_credit_amount, 'stone_debit_amount', v_old.stone_debit_amount, 'stone_pix_amount', v_old.stone_pix_amount, 'sitef_credit_amount', v_old.sitef_credit_amount, 'sitef_debit_amount', v_old.sitef_debit_amount, 'sitef_pix_amount', v_old.sitef_pix_amount, 'notes', v_old.notes) end,jsonb_build_object('sales_amount', v_new.sales_amount, 'cash_amount', v_new.cash_amount, 'total_amount', v_new.total_amount, 'site_sales_amount', v_new.site_sales_amount, 'closing_cash_amount', v_new.closing_cash_amount, 'cash_withdrawal_amount', v_new.cash_withdrawal_amount, 'opening_cash_amount', v_new.opening_cash_amount, 'banri_amount', v_new.banri_amount, 'stone_amount', v_new.stone_amount, 'sitef_amount', v_new.sitef_amount, 'pix_amount', v_new.pix_amount, 'ifood_sales_amount', v_new.ifood_sales_amount, 'food99_sales_amount', v_new.food99_sales_amount, 'envelope_amount', v_new.envelope_amount, 'next_day_cash_amount', v_new.next_day_cash_amount, 'banri_credit_amount', v_new.banri_credit_amount, 'banri_debit_amount', v_new.banri_debit_amount, 'banri_pix_amount', v_new.banri_pix_amount, 'stone_credit_amount', v_new.stone_credit_amount, 'stone_debit_amount', v_new.stone_debit_amount, 'stone_pix_amount', v_new.stone_pix_amount, 'sitef_credit_amount', v_new.sitef_credit_amount, 'sitef_debit_amount', v_new.sitef_debit_amount, 'sitef_pix_amount', v_new.sitef_pix_amount, 'notes', v_new.notes),p_request_id,v_summary,v_actor,v_name);
 if v_new.store in ('jc','ja') then perform private.sync_cash_closing_finance_entries(v_new.id,auth.uid()); end if;
 insert into private.cash_closing_requests values(p_request_id,v_summary,v_new.id);
 return v_new;
end; $$;
revoke all on function public.save_cash_closing(uuid,text,date,timestamptz,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text) from public, anon, authenticated, service_role;
grant execute on function public.save_cash_closing(uuid,text,date,timestamptz,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text) to authenticated;
create or replace function public.save_cash_closing(
 p_request_id uuid, p_store text, p_closing_date date, p_updated_at timestamptz,
 p_closing_cash_amount numeric,
 p_cash_withdrawal_amount numeric,
 p_opening_cash_amount numeric,
 p_banri_amount numeric,
 p_stone_amount numeric,
 p_sitef_amount numeric,
 p_pix_amount numeric,
 p_ifood_sales_amount numeric,
 p_food99_sales_amount numeric,
 p_envelope_amount numeric,
 p_next_day_cash_amount numeric, p_notes text
) returns public.cash_closings language plpgsql security definer set search_path = '' as $$
begin
 raise exception using errcode='22023', message='Esta tela está desatualizada. Anote os números, recarregue a página e salve de novo.';
end; $$;
revoke all on function public.save_cash_closing(uuid,text,date,timestamptz,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text) from public, anon, authenticated, service_role;
grant execute on function public.save_cash_closing(uuid,text,date,timestamptz,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text) to authenticated;
commit;
