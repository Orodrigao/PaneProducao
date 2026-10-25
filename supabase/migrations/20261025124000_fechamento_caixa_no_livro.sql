-- Fechamento de caixa no livro, fase 3 do Financeiro, PR 2.
-- Salva receitas por meio e suas taxas na mesma transação do fechamento.
-- Decisões do Rodrigo em 23/10/2026: entrada desde 01/09/2026 para JC e JA;
-- EX fica fora; iFood 15,2%, 99Food 14,1% desde 22/10 e PIX zero.
-- Banrisul, Stone e SiTef aguardam taxa informada. Vazio difere de zero.
-- Dinheiro usa o caixa físico da loja e forma dinheiro; iFood usa banco_ifood
-- e outro; PIX usa conta nula e pix; demais usam conta nula e outro.
-- Maquininha não usa cartao: o gatilho exige conta de cartão de crédito.
-- A versão aplicável tem maior vigência até a venda, com desempate pela criação.
-- Taxa lançada não se reescreve; correção preserva a versão anterior do meio.
-- A chave privada nasce ligada e só migration a muda. A carga usa o autor do
-- fechamento (updated_by ou created_by), validado em auth.users; autor ou conta
-- inválidos fazem a transação inteira falhar, sem carga parcial.
-- Reversão: desligar a chave por migration nova e estornar a origem
-- fechamento_caixa inteira, receitas e taxas, sem apagar lançamentos.
begin;
create table private.finance_fee_rates (
 id uuid primary key default gen_random_uuid(),
 method text not null check (method in ('banrisul','stone','sitef','pix','ifood','food99')),
 rate numeric(7,4) check (rate between 0 and 100),
 valid_from date not null,
 request_id uuid unique, request_summary jsonb,
 author_id uuid references auth.users(id), author_name text not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table private.finance_fee_rates enable row level security;
alter table private.finance_fee_rates force row level security;
revoke all on private.finance_fee_rates from public, anon, authenticated, service_role;
create function private.finance_fee_rates_append_only() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 raise exception using errcode='42501', message='O histórico de taxas não pode ser alterado nem apagado.';
end; $$;
revoke all on function private.finance_fee_rates_append_only() from public, anon, authenticated, service_role;
create trigger finance_fee_rates_append_only before update or delete or truncate on private.finance_fee_rates
for each statement execute function private.finance_fee_rates_append_only();
insert into private.finance_fee_rates(method,rate,valid_from,author_name) values
 ('ifood',15.2,'2026-09-01','Decisão do Rodrigo em 23/10/2026'),
 ('food99',14.1,'2026-10-22','Decisão do Rodrigo em 23/10/2026'),
 ('pix',0,'2026-09-01','Decisão do Rodrigo em 23/10/2026');
create index finance_fee_rates_lookup_idx on private.finance_fee_rates(method,valid_from desc,created_at desc);
create function private.finance_fee_rate_at(p_method text,p_date date) returns private.finance_fee_rates
language sql stable security definer set search_path = '' as $$
 select r from private.finance_fee_rates r where r.method=p_method and r.valid_from<=p_date
 order by r.valid_from desc,r.created_at desc limit 1;
$$;
revoke all on function private.finance_fee_rate_at(text,date) from public, anon, authenticated, service_role;
create table private.cash_closing_bridge_settings (
 singleton boolean primary key default true check (singleton),
 enabled boolean not null, start_date date not null
);
alter table private.cash_closing_bridge_settings enable row level security;
alter table private.cash_closing_bridge_settings force row level security;
revoke all on private.cash_closing_bridge_settings from public, anon, authenticated, service_role;
insert into private.cash_closing_bridge_settings values(true,true,'2026-09-01');
create function private.lock_cash_closing_bridge() returns void
language sql security definer set search_path = '' as $$
 select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('paneerp:cash-closing-bridge',0));
$$;
revoke all on function private.lock_cash_closing_bridge() from public, anon, authenticated, service_role;

alter table public.finance_entries drop constraint finance_entries_source_check;
alter table public.finance_entries add constraint finance_entries_source_check check
 (source in ('avulso','contas_pagar','recorrencia','transferencia','contas_receber','pj_devolucao','fechamento_caixa'));
alter table public.finance_entries
 add column source_detail text check (source_detail in ('dinheiro','banrisul','stone','sitef','pix','ifood','food99')),
 add column fee_of uuid references public.finance_entries(id),
 add column fee_rate numeric(7,4),
 add column fee_rate_version_id uuid references private.finance_fee_rates(id),
 add constraint finance_entries_closing_shape check (
  (source='fechamento_caixa') = (source_detail is not null)
  and (source<>'fechamento_caixa' or source_ref is not null)),
 add constraint finance_entries_fee_shape check (
  (fee_of is null and fee_rate is null and fee_rate_version_id is null)
  or (source='fechamento_caixa' and fee_of is not null and fee_rate is not null and fee_rate_version_id is not null));
drop index public.finance_entries_origem_ativa_idx;
create unique index finance_entries_origem_ativa_idx on public.finance_entries(source,source_ref,category_id)
 where source_ref is not null and source not in ('recorrencia','fechamento_caixa') and entry_type='lancamento' and reversed_at is null;
create unique index finance_entries_closing_revenue_idx on public.finance_entries(source_ref,source_detail)
 where source='fechamento_caixa' and entry_type='lancamento' and reversed_at is null and fee_of is null;
create unique index finance_entries_closing_fee_idx on public.finance_entries(fee_of)
 where fee_of is not null and entry_type='lancamento' and reversed_at is null;
insert into public.finance_categories(key,label,dre_tier,dre_group,nature,sort_order)
 select 'food99','99Food','operacional','receita','receita',sort_order+1 from public.finance_categories where key='ifood';
create function private.guard_cash_closing_revenue() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if tg_op='UPDATE' and new.category_id is not distinct from old.category_id
 and new.source is not distinct from old.source and new.entry_type is not distinct from old.entry_type then return new; end if;
 if new.entry_type='lancamento' and new.source<>'fechamento_caixa'
 and exists(select 1 from public.finance_categories where id=new.category_id and key in ('venda_balcao','ifood','food99')) then
  raise exception using errcode='22023', message='A venda do balcão, do iFood e do 99Food entra pelo Fechamento de caixa: corrija o fechamento do dia, não o livro-caixa.';
 end if;
 return new;
end; $$;
revoke all on function private.guard_cash_closing_revenue() from public, anon, authenticated, service_role;
create trigger finance_entries_guard_cash_closing_revenue before insert or update of category_id,source,entry_type
on public.finance_entries for each row execute function private.guard_cash_closing_revenue();
insert into public.app_permissions(key,module,label,description,sort_order) values
 ('financeiro.taxas','Financeiro','Taxas dos meios de pagamento','Gravar taxas com vigência e consultar o histórico.',323);
insert into public.app_user_permissions(user_id,permission_key,scope,granted_by)
 select user_id,'financeiro.taxas','*',null::uuid from public.app_profiles where active and role='financeiro'
 on conflict(user_id,permission_key,scope) do nothing;

-- Somente funções privadas chamam estes auxiliares. Autoria e dimensões vêm da receita.
create function private.cash_closing_method_label(p_method text) returns text
language sql immutable security definer set search_path = '' as $$
 select case p_method when 'dinheiro' then 'Dinheiro' when 'banrisul' then 'Banrisul' when 'stone' then 'Stone'
 when 'sitef' then 'SiTef' when 'pix' then 'PIX' when 'ifood' then 'iFood' when 'food99' then '99Food' end;
$$;
revoke all on function private.cash_closing_method_label(text) from public, anon, authenticated, service_role;
create function private.create_cash_closing_fee(p_revenue_id uuid,p_version_id uuid,p_actor uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_e public.finance_entries; v_r private.finance_fee_rates; v_amount numeric; v_category uuid;
begin
 select * into strict v_e from public.finance_entries where id=p_revenue_id for update;
 select * into strict v_r from private.finance_fee_rates where id=p_version_id;
 if v_e.source<>'fechamento_caixa' or v_e.entry_type<>'lancamento' or v_e.reversed_at is not null
 or v_e.fee_of is not null or v_e.source_detail is distinct from v_r.method then
  raise exception using errcode='22023',message='A taxa precisa corresponder à receita ativa do fechamento.';
 end if;
 if v_r.rate is null then return 0; end if;
 v_amount:=round(v_e.amount*v_r.rate/100,2);
 if v_amount=0 or exists(select 1 from public.finance_entries where fee_of=v_e.id and entry_type='lancamento' and reversed_at is null) then return 0; end if;
 select id into strict v_category from public.finance_categories where key='taxas_cartao_apps';
 insert into public.finance_entries(request_id,category_id,account_id,store,competence_month,due_date,planned_amount,paid_date,amount,payment_method,description,source,source_ref,source_detail,fee_of,fee_rate,fee_rate_version_id,created_by,created_at)
 values(gen_random_uuid(),v_category,v_e.account_id,v_e.store,v_e.competence_month,v_e.due_date,v_amount,v_e.paid_date,v_amount,'outro',
 'Taxa '||private.cash_closing_method_label(v_e.source_detail)||' '||replace(trim(trailing '.' from trim(trailing '0' from v_r.rate::text)),'.',',')||'% · '||split_part(v_e.description,' · ',1),
 v_e.source,v_e.source_ref,v_e.source_detail,v_e.id,v_r.rate,v_r.id,p_actor,clock_timestamp());
 return 1;
end; $$;
revoke all on function private.create_cash_closing_fee(uuid,uuid,uuid) from public, anon, authenticated, service_role;
create function private.reverse_cash_closing_entry(p_id uuid,p_actor uuid,p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_e public.finance_entries;
begin
 select * into strict v_e from public.finance_entries where id=p_id for update;
 if v_e.source<>'fechamento_caixa' or v_e.entry_type<>'lancamento' or v_e.reversed_at is not null then
  raise exception using errcode='22023',message='Somente lançamento ativo do fechamento pode ser corrigido pela ponte.';
 end if;
 insert into public.finance_entries(request_id,entry_type,category_id,account_id,store,competence_month,due_date,planned_amount,paid_date,amount,payment_method,description,source,source_ref,source_detail,fee_of,fee_rate,fee_rate_version_id,reversal_of,reversal_reason,created_by,created_at)
 values(gen_random_uuid(),'estorno',v_e.category_id,v_e.account_id,v_e.store,v_e.competence_month,v_e.due_date,v_e.planned_amount,v_e.paid_date,v_e.amount,v_e.payment_method,'Estorno de: '||v_e.description,v_e.source,v_e.source_ref,v_e.source_detail,v_e.fee_of,v_e.fee_rate,v_e.fee_rate_version_id,v_e.id,p_reason,p_actor,clock_timestamp());
 update public.finance_entries set reversed_at=clock_timestamp(),reversed_by=p_actor,reversal_reason=p_reason where id=v_e.id;
end; $$;
revoke all on function private.reverse_cash_closing_entry(uuid,uuid,text) from public, anon, authenticated, service_role;
create function private.sync_cash_closing_finance_entries(p_closing_id uuid,p_actor uuid) returns void
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
 for v_m in select * from (values ('dinheiro',v_c.cash_amount),('banrisul',v_c.banri_amount),('stone',v_c.stone_amount),('sitef',v_c.sitef_amount),('pix',v_c.pix_amount),('ifood',v_c.ifood_sales_amount),('food99',v_c.food99_sales_amount)) as m(method,amount) loop
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
   case v_m.method when 'dinheiro' then 'dinheiro' when 'pix' then 'pix' else 'outro' end,
   'Fechamento '||upper(v_c.store)||' '||to_char(v_c.closing_date,'DD/MM/YYYY')||' · '||private.cash_closing_method_label(v_m.method),'fechamento_caixa',v_c.id,v_m.method,p_actor,clock_timestamp()) returning id into v_id;
  if v_version is not null and v_m.method<>'dinheiro' then perform private.create_cash_closing_fee(v_id,v_version,p_actor); end if;
 end loop;
end; $$;
revoke all on function private.sync_cash_closing_finance_entries(uuid,uuid) from public, anon, authenticated, service_role;

create function public.save_finance_fee_rate(p_request_id uuid,p_method text,p_rate numeric,p_valid_from date,p_expected_latest_id uuid) returns jsonb
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
 if p_request_id is null or p_method is null or p_method not in ('banrisul','stone','sitef','pix','ifood','food99')
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
create function public.get_finance_fee_rates() returns jsonb
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
 from unnest(array['banrisul','stone','sitef','pix','ifood','food99']) m(method);
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
create function private.resync_cash_closing_finance_entries() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_c public.cash_closings; v_actor uuid; v_text text; v_before bigint; v_after bigint; v_reversed_before bigint; v_reversed_after bigint;
begin
 perform private.lock_cash_closing_bridge();
 select count(*),count(*) filter(where entry_type='estorno') into v_before,v_reversed_before from public.finance_entries where source='fechamento_caixa';
 for v_c in select c.* from public.cash_closings c cross join private.cash_closing_bridge_settings s
 where s.enabled and c.store in ('jc','ja') and c.closing_date>=s.start_date order by c.closing_date,c.store for update of c loop
  v_text:=coalesce(nullif(btrim(v_c.updated_by),''),nullif(btrim(v_c.created_by),''));
  begin
   v_actor:=v_text::uuid;
  exception when invalid_text_representation then v_actor:=null;
  end;
  if v_actor is null or not exists(select 1 from auth.users where id=v_actor) then
   raise exception using errcode='22023',message='Autor inválido no fechamento '||upper(v_c.store)||' '||to_char(v_c.closing_date,'DD/MM/YYYY')||'.';
  end if;
  perform private.sync_cash_closing_finance_entries(v_c.id,v_actor);
 end loop;
 select count(*),count(*) filter(where entry_type='estorno') into v_after,v_reversed_after from public.finance_entries where source='fechamento_caixa';
 return jsonb_build_object('created',v_after-v_before-(v_reversed_after-v_reversed_before),'reversed',v_reversed_after-v_reversed_before);
end; $$;
revoke all on function private.resync_cash_closing_finance_entries() from public, anon, authenticated, service_role;

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
 if exists (select 1 from unnest(array[p_closing_cash_amount,p_cash_withdrawal_amount,p_opening_cash_amount,p_banri_amount,p_stone_amount,p_sitef_amount,p_pix_amount,p_ifood_sales_amount,p_food99_sales_amount,p_envelope_amount,p_next_day_cash_amount]) as x(value)
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
 p_notes := nullif(btrim(p_notes), '');
 v_summary := jsonb_build_object('store',p_store,'closing_date',p_closing_date,'updated_at',p_updated_at,
 'closing_cash_amount',p_closing_cash_amount,'cash_withdrawal_amount',p_cash_withdrawal_amount,'opening_cash_amount',p_opening_cash_amount,'banri_amount',p_banri_amount,'stone_amount',p_stone_amount,'sitef_amount',p_sitef_amount,'pix_amount',p_pix_amount,'ifood_sales_amount',p_ifood_sales_amount,'food99_sales_amount',p_food99_sales_amount,'envelope_amount',p_envelope_amount,'next_day_cash_amount',p_next_day_cash_amount,'notes',p_notes,'actor',v_actor);
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
 v_total := v_cash + p_banri_amount + p_stone_amount + p_sitef_amount + p_pix_amount;
 select * into v_old from public.cash_closings where store=p_store and closing_date=p_closing_date for update;
 v_exists := found;
 if (v_exists and (p_updated_at is null or p_updated_at is distinct from v_old.updated_at))
 or (not v_exists and p_updated_at is not null) then
  raise exception using errcode = 'PT409', message = 'Outro salvamento mudou este fechamento. Confira os números antes de substituir.';
 end if;
 if v_exists and v_old.closing_cash_amount = p_closing_cash_amount and v_old.cash_withdrawal_amount = p_cash_withdrawal_amount and v_old.opening_cash_amount = p_opening_cash_amount and v_old.banri_amount = p_banri_amount and v_old.stone_amount = p_stone_amount and v_old.sitef_amount = p_sitef_amount and v_old.pix_amount = p_pix_amount and v_old.ifood_sales_amount = p_ifood_sales_amount and v_old.food99_sales_amount = p_food99_sales_amount and v_old.envelope_amount = p_envelope_amount and v_old.next_day_cash_amount = p_next_day_cash_amount
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
   insert into public.cash_closings(store,closing_date,weekday_label,closing_cash_amount,cash_withdrawal_amount,opening_cash_amount,banri_amount,stone_amount,sitef_amount,pix_amount,ifood_sales_amount,food99_sales_amount,envelope_amount,next_day_cash_amount,cash_amount,sales_amount,total_amount,site_sales_amount,notes,created_by,created_by_name,created_by_email,updated_by,updated_by_name,updated_at)
   values(p_store,p_closing_date,(array['domingo','segunda','terca','quarta','quinta','sexta','sabado'])[extract(dow from p_closing_date)::integer+1],p_closing_cash_amount,p_cash_withdrawal_amount,p_opening_cash_amount,p_banri_amount,p_stone_amount,p_sitef_amount,p_pix_amount,p_ifood_sales_amount,p_food99_sales_amount,p_envelope_amount,p_next_day_cash_amount,v_cash,v_total,v_total,0,p_notes,v_actor::text,v_name,auth.jwt()->>'email',v_actor::text,v_name,clock_timestamp()) returning * into v_new;
  exception when unique_violation then
   raise exception using errcode = 'PT409', message = 'Outro salvamento criou este fechamento. Confira os números antes de substituir.';
  end;
 end if;
 insert into public.cash_closing_revisions(closing_id,store,revision_type,reason,before_values,after_values,request_id,request_summary,author_id,author_name)
 values(v_new.id,v_new.store,case when v_exists then 'edicao' else 'criacao' end,'Salvamento do fechamento',case when v_exists then jsonb_build_object('sales_amount', v_old.sales_amount, 'cash_amount', v_old.cash_amount, 'total_amount', v_old.total_amount, 'site_sales_amount', v_old.site_sales_amount, 'closing_cash_amount', v_old.closing_cash_amount, 'cash_withdrawal_amount', v_old.cash_withdrawal_amount, 'opening_cash_amount', v_old.opening_cash_amount, 'banri_amount', v_old.banri_amount, 'stone_amount', v_old.stone_amount, 'sitef_amount', v_old.sitef_amount, 'pix_amount', v_old.pix_amount, 'ifood_sales_amount', v_old.ifood_sales_amount, 'food99_sales_amount', v_old.food99_sales_amount, 'envelope_amount', v_old.envelope_amount, 'next_day_cash_amount', v_old.next_day_cash_amount, 'notes', v_old.notes) end,jsonb_build_object('sales_amount', v_new.sales_amount, 'cash_amount', v_new.cash_amount, 'total_amount', v_new.total_amount, 'site_sales_amount', v_new.site_sales_amount, 'closing_cash_amount', v_new.closing_cash_amount, 'cash_withdrawal_amount', v_new.cash_withdrawal_amount, 'opening_cash_amount', v_new.opening_cash_amount, 'banri_amount', v_new.banri_amount, 'stone_amount', v_new.stone_amount, 'sitef_amount', v_new.sitef_amount, 'pix_amount', v_new.pix_amount, 'ifood_sales_amount', v_new.ifood_sales_amount, 'food99_sales_amount', v_new.food99_sales_amount, 'envelope_amount', v_new.envelope_amount, 'next_day_cash_amount', v_new.next_day_cash_amount, 'notes', v_new.notes),p_request_id,v_summary,v_actor,v_name);
 if v_new.store in ('jc','ja') then perform private.sync_cash_closing_finance_entries(v_new.id,auth.uid()); end if;
 insert into private.cash_closing_requests values(p_request_id,v_summary,v_new.id);
 return v_new;
end; $$;
revoke all on function public.save_cash_closing(uuid,text,date,timestamptz,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text) from public, anon, authenticated, service_role;
grant execute on function public.save_cash_closing(uuid,text,date,timestamptz,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text) to authenticated;


create or replace function public.reverse_finance_entry(
  p_request_id uuid,
  p_entry_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reversal_id uuid;
  v_original record;
begin
  perform private.lock_financial_request(p_request_id);
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador do estorno obrigatório.';
  end if;

  select existing.id into v_reversal_id
  from public.finance_entries existing
  where existing.request_id = p_request_id;
  if v_reversal_id is not null then
    return v_reversal_id;
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null or length(trim(p_reason)) < 3 then
    raise exception using errcode = '22023', message = 'Informe o motivo do estorno.';
  end if;

  select entry.* into v_original
  from public.finance_entries entry
  where entry.id = p_entry_id
  for update;
  if v_original.id is null then
    raise exception using errcode = 'P0002', message = 'Lançamento não encontrado.';
  end if;

  if v_original.source = 'fechamento_caixa' then
    raise exception using errcode = '22023', message = 'Este lançamento veio do Fechamento de caixa. Corrija o fechamento do dia em Fechamento de caixa.';
  end if;

  if v_original.transfer_id is not null then
    raise exception using errcode = '22023',
      message = 'Este lançamento faz parte de uma transferência. Estorne a transferência inteira.';
  end if;

  if not private.current_user_can_finance_store('financeiro.estornar', v_original.store) then
    raise exception using errcode = '42501', message = 'Sem permissão para estornar lançamentos desta loja.';
  end if;

  if v_original.entry_type = 'estorno' then
    raise exception using errcode = '22023', message = 'Um estorno não pode ser estornado.';
  end if;
  if v_original.reversed_at is not null then
    raise exception using errcode = '22023', message = 'Este lançamento já foi estornado.';
  end if;

  insert into public.finance_entries (
    request_id, entry_type, category_id, account_id, store, competence_month,
    due_date, planned_amount, paid_date, amount, payment_method, description,
    source, source_ref, recurrence_month, reversal_of, reversal_reason, created_by
  )
  values (
    p_request_id, 'estorno', v_original.category_id, v_original.account_id, v_original.store,
    v_original.competence_month, v_original.due_date, v_original.planned_amount,
    current_date, v_original.amount, v_original.payment_method,
    'Estorno de: ' || v_original.description,
    v_original.source, v_original.source_ref, v_original.recurrence_month,
    v_original.id, trim(p_reason), (select auth.uid())
  )
  returning id into v_reversal_id;

  update public.finance_entries
  set reversed_at = now(),
      reversed_by = (select auth.uid()),
      reversal_reason = trim(p_reason)
  where id = v_original.id;

  return v_reversal_id;
end;
$$;
revoke all on function public.reverse_finance_entry(uuid,uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.reverse_finance_entry(uuid,uuid,text) to authenticated;
select private.normalize_cash_closing_stone(date '2026-09-01');
select private.resync_cash_closing_finance_entries();
revoke insert,update,delete,truncate on public.cash_closings from anon,authenticated,service_role;
drop policy cash_closings_insert_internal on public.cash_closings;
drop policy cash_closings_update_internal on public.cash_closings;
comment on trigger cash_closings_guard_direct_write on public.cash_closings is 'Terceira camada: gatilho preservado além dos privilégios revogados e da ausência de policies de escrita. Somente save_cash_closing grava pelo site.';
commit;
