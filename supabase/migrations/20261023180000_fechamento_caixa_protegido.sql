-- Fechamento protegido, fase 3 do Financeiro, PR 1.
-- A porta única save_cash_closing valida loja, valores e versão, registra histórico
-- e guarda recibo por request_id para repetir pedidos sem duplicar gravações.
-- Conflito usa PT409, nunca 40001, para não provocar repetição automática.
-- O gatilho recusa gravação direta do navegador: após a correção, a tela antiga
-- leria a Stone zerada no campo legado e a apagaria ao salvar. Preferimos falha
-- visível a dado errado. A PR 2 revoga grants e policies de escrita direta.
-- Stone opção A, decidida por Rodrigo em 23/10/2026: corrigir de 01/09/2026
-- em diante; agosto só ao editar. 99Food usa o canal food99 e não soma ao caixa.
-- Reversão exige PR nova com tela compatível com as colunas novas; nunca voltar
-- à tela antiga, que não preserva a Stone corrigida.

begin;
alter table public.cash_closings
  add column stone_amount numeric(12,2) not null default 0 check (stone_amount >= 0),
  add column food99_sales_amount numeric(12,2) not null default 0 check (food99_sales_amount >= 0);
comment on column public.cash_closings.stone_amount is 'Recebimentos Stone, separados do campo legado site_sales_amount.';
comment on column public.cash_closings.food99_sales_amount is 'Vendas do canal food99, informativas e fora do total do caixa.';
comment on column public.cash_closings.site_sales_amount is 'Legado: Stone de dias anteriores a 01/09/2026 ainda não editados; de setembro em diante fica zero.';

create table public.cash_closing_revisions (
  id bigint generated always as identity primary key,
  closing_id uuid not null references public.cash_closings(id),
  store text not null check (store in ('jc','ja','ex')),
  revision_type text not null check (revision_type in ('criacao','edicao','correcao')),
  reason text not null,
  before_values jsonb,
  after_values jsonb not null,
  request_id uuid unique,
  request_summary jsonb,
  author_id uuid,
  author_name text not null,
  changed_at timestamptz not null default clock_timestamp()
);
comment on table public.cash_closing_revisions is 'Histórico imutável de criação, edição e correção dos fechamentos, com autor e valores antes e depois.';
alter table public.cash_closing_revisions enable row level security;
alter table public.cash_closing_revisions force row level security;
revoke all on public.cash_closing_revisions from public, anon, authenticated, service_role;
grant select on public.cash_closing_revisions to authenticated;
revoke all on sequence public.cash_closing_revisions_id_seq from public, anon, authenticated, service_role;
create policy cash_closing_revisions_select on public.cash_closing_revisions for select to authenticated
using (exists (select 1 from public.app_profiles p where p.user_id = (select auth.uid())
 and p.active and (p.role in ('admin','financeiro') or (p.role = 'vendas' and p.store = cash_closing_revisions.store))));

create function private.cash_closing_revisions_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
 raise exception using errcode = '42501', message = 'O histórico de fechamento não pode ser alterado nem apagado.';
end; $$;
revoke all on function private.cash_closing_revisions_append_only() from public, anon, authenticated, service_role;
create trigger cash_closing_revisions_append_only before update or delete or truncate
on public.cash_closing_revisions for each statement execute function private.cash_closing_revisions_append_only();

create function private.guard_cash_closing_direct_write() returns trigger
language plpgsql set search_path = '' as $$
begin
 if current_user in ('authenticated','anon') then
   raise exception using errcode = '22023', message = 'Esta tela está desatualizada. Anote os números, recarregue a página e salve de novo.';
 end if;
 return new;
end; $$;
revoke all on function private.guard_cash_closing_direct_write() from public, anon, authenticated, service_role;
-- A tela antiga apagaria Stone após a correção. PR 2 revoga grants e policies de escrita.
create trigger cash_closings_guard_direct_write before insert or update on public.cash_closings
for each row execute function private.guard_cash_closing_direct_write();

-- Cada gravação tem versão própria, inclusive dentro da mesma transação.
create or replace function public.set_cash_closings_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
 new.updated_at = pg_catalog.clock_timestamp();
 return new;
end; $$;

-- Repetições de salvamentos sem mudança também precisam lembrar a chave,
-- sem fabricar uma revisão. O recibo não é exposto na Data API.
create table private.cash_closing_requests (
 request_id uuid primary key,
 request_summary jsonb not null,
 closing_id uuid not null references public.cash_closings(id)
);
comment on table private.cash_closing_requests is 'Recibos privados por request_id para repetição segura inclusive de salvamentos sem mudança.';
alter table private.cash_closing_requests enable row level security;
alter table private.cash_closing_requests force row level security;
revoke all on private.cash_closing_requests from public, anon, authenticated, service_role;

create function public.save_cash_closing(
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
 insert into private.cash_closing_requests values(p_request_id,v_summary,v_new.id);
 return v_new;
end; $$;
revoke all on function public.save_cash_closing(uuid,text,date,timestamptz,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text) from public, anon, service_role;
grant execute on function public.save_cash_closing(uuid,text,date,timestamptz,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text) to authenticated;

create function private.normalize_cash_closing_stone(p_from date) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_old public.cash_closings; v_new public.cash_closings; v_count integer := 0;
begin
 for v_old in select * from public.cash_closings where closing_date >= p_from and site_sales_amount > 0 for update loop
  update public.cash_closings set stone_amount=site_sales_amount, site_sales_amount=0 where id=v_old.id returning * into v_new;
  insert into public.cash_closing_revisions(closing_id,store,revision_type,reason,before_values,after_values,author_name)
  values(v_new.id,v_new.store,'correcao','Stone gravada na coluna de venda de site; correção opção A decidida pelo Rodrigo em 23/10/2026',jsonb_build_object('sales_amount', v_old.sales_amount, 'cash_amount', v_old.cash_amount, 'total_amount', v_old.total_amount, 'site_sales_amount', v_old.site_sales_amount, 'closing_cash_amount', v_old.closing_cash_amount, 'cash_withdrawal_amount', v_old.cash_withdrawal_amount, 'opening_cash_amount', v_old.opening_cash_amount, 'banri_amount', v_old.banri_amount, 'stone_amount', v_old.stone_amount, 'sitef_amount', v_old.sitef_amount, 'pix_amount', v_old.pix_amount, 'ifood_sales_amount', v_old.ifood_sales_amount, 'food99_sales_amount', v_old.food99_sales_amount, 'envelope_amount', v_old.envelope_amount, 'next_day_cash_amount', v_old.next_day_cash_amount, 'notes', v_old.notes),jsonb_build_object('sales_amount', v_new.sales_amount, 'cash_amount', v_new.cash_amount, 'total_amount', v_new.total_amount, 'site_sales_amount', v_new.site_sales_amount, 'closing_cash_amount', v_new.closing_cash_amount, 'cash_withdrawal_amount', v_new.cash_withdrawal_amount, 'opening_cash_amount', v_new.opening_cash_amount, 'banri_amount', v_new.banri_amount, 'stone_amount', v_new.stone_amount, 'sitef_amount', v_new.sitef_amount, 'pix_amount', v_new.pix_amount, 'ifood_sales_amount', v_new.ifood_sales_amount, 'food99_sales_amount', v_new.food99_sales_amount, 'envelope_amount', v_new.envelope_amount, 'next_day_cash_amount', v_new.next_day_cash_amount, 'notes', v_new.notes),'Correção da migration');
  v_count := v_count+1;
 end loop;
 return v_count;
end; $$;
revoke all on function private.normalize_cash_closing_stone(date) from public, anon, authenticated, service_role;
select private.normalize_cash_closing_stone(date '2026-09-01');

alter table private.pricing_settings_history drop constraint pricing_settings_history_channel_check;
alter table private.pricing_settings_history add constraint pricing_settings_history_channel_check check (channel in ('balcao', 'ifood', 'food99', 'buck'));
create or replace function public.save_pricing_settings(p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_actor_name text;
  v_change_id uuid := pg_catalog.gen_random_uuid();
  v_item jsonb;
  v_key text;
  v_channel text;
  v_category_id uuid;
  v_value numeric;
  v_previous numeric;
  v_current numeric;
  v_catalog_type text;
  v_seen text[] := array[]::text[];
  v_identity text;
  v_saved integer := 0;
begin
  if not (select private.current_user_is_access_admin()) then
    raise exception using errcode = '42501',
      message = 'Somente administradores podem mudar a Configuração do Sistema.';
  end if;

  select profile.display_name into v_actor_name
    from public.app_profiles profile
   where profile.user_id = v_actor;

  if p_changes is null or pg_catalog.jsonb_typeof(p_changes) <> 'array' then
    raise exception using errcode = '22023', message = 'Envie a lista de valores alterados.';
  end if;
  if pg_catalog.jsonb_array_length(p_changes) > 500 then
    raise exception using errcode = '22023', message = 'Valores demais num salvamento só.';
  end if;

  -- Um salvamento por vez: dois admins (ou dois toques) não intercalam a
  -- leitura do vigente com a gravação da versão nova. Leitura não espera.
  lock table private.pricing_settings_history in share row exclusive mode;

  for v_item in select item.value from pg_catalog.jsonb_array_elements(p_changes) as item(value) loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object'
       or not (v_item ? 'setting_key' and v_item ? 'value' and v_item ? 'previous_value') then
      raise exception using errcode = '22023', message = 'Valor alterado em formato inválido.';
    end if;

    if pg_catalog.jsonb_typeof(v_item -> 'setting_key') <> 'string' then
      raise exception using errcode = '22023', message = 'Parâmetro inválido.';
    end if;
    v_key := v_item ->> 'setting_key';
    if v_key not in ('imposto_venda', 'taxa_canal', 'margem_desejada', 'margem_minima') then
      raise exception using errcode = '22023', message = 'Parâmetro inválido.';
    end if;

    v_channel := null;
    if v_item ? 'channel' and pg_catalog.jsonb_typeof(v_item -> 'channel') <> 'null' then
      if pg_catalog.jsonb_typeof(v_item -> 'channel') <> 'string'
         or (v_item ->> 'channel') not in ('balcao', 'ifood', 'food99', 'buck') then
        raise exception using errcode = '22023', message = 'Canal inválido.';
      end if;
      v_channel := v_item ->> 'channel';
    end if;

    v_category_id := null;
    if v_item ? 'category_id' and pg_catalog.jsonb_typeof(v_item -> 'category_id') <> 'null' then
      if pg_catalog.jsonb_typeof(v_item -> 'category_id') <> 'string'
         or (v_item ->> 'category_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception using errcode = '22023', message = 'Categoria inválida.';
      end if;
      v_category_id := (v_item ->> 'category_id')::uuid;
      select category.catalog_type into v_catalog_type
        from public.product_categories category
       where category.id = v_category_id;
      if v_catalog_type is null or v_catalog_type not in ('produto_fabricado', 'produto_revenda') then
        raise exception using errcode = '22023',
          message = 'A exceção de margem vale só para categoria de produto fabricado ou de revenda.';
      end if;
    end if;

    if (v_key = 'imposto_venda' and (v_channel is not null or v_category_id is not null))
       or (v_key = 'taxa_canal' and (v_channel is null or v_category_id is not null))
       or (v_key in ('margem_desejada', 'margem_minima') and v_channel is null) then
      raise exception using errcode = '22023',
        message = 'Imposto vale para todos os canais; taxa é por canal; margem é por canal, com exceção opcional por categoria.';
    end if;

    v_identity := v_key || '|' || coalesce(v_channel, '') || '|' || coalesce(v_category_id::text, '');
    if v_identity = any(v_seen) then
      raise exception using errcode = '22023', message = 'O mesmo valor veio duas vezes no salvamento.';
    end if;
    v_seen := v_seen || v_identity;

    v_value := null;
    if pg_catalog.jsonb_typeof(v_item -> 'value') = 'number' then
      v_value := (v_item ->> 'value')::numeric;
    elsif pg_catalog.jsonb_typeof(v_item -> 'value') <> 'null' then
      raise exception using errcode = '22023', message = 'Percentual deve ser número ou vazio.';
    end if;
    if v_value is not null and (v_value < 0 or v_value > 100 or v_value <> pg_catalog.round(v_value, 2)) then
      raise exception using errcode = '22023',
        message = 'Percentual deve ficar entre 0 e 100, com até duas casas decimais.';
    end if;

    v_previous := null;
    if pg_catalog.jsonb_typeof(v_item -> 'previous_value') = 'number' then
      v_previous := (v_item ->> 'previous_value')::numeric;
    elsif pg_catalog.jsonb_typeof(v_item -> 'previous_value') <> 'null' then
      raise exception using errcode = '22023', message = 'Valor anterior em formato inválido.';
    end if;

    select current_value.cfg_value into v_current
      from private.pricing_settings_current() current_value
     where current_value.cfg_setting_key = v_key
       and current_value.cfg_channel is not distinct from v_channel
       and current_value.cfg_category_id is not distinct from v_category_id;
    if not found then
      v_current := null;
    end if;

    if v_current is not distinct from v_value then
      continue;
    end if;
    if v_current is distinct from v_previous then
      raise exception using errcode = 'PT409',
        message = 'Outro salvamento mudou a configuração depois que a tela abriu. Recarregue a página para ver os valores atuais.';
    end if;

    insert into private.pricing_settings_history (
      setting_key, channel, category_id, value, change_id, changed_by, changed_by_name
    ) values (
      v_key, v_channel, v_category_id, v_value, v_change_id, v_actor, coalesce(v_actor_name, 'Sem nome')
    );
    v_saved := v_saved + 1;
  end loop;

  -- Margem mínima acima da desejada não faz sentido. A comparação é pelo valor
  -- que vale de fato: numa exceção de categoria, o campo vazio herda o do
  -- canal (é o que a tela promete). Assim, mínima de exceção acima da desejada
  -- do canal, ou desejada de exceção abaixo da mínima do canal, também é
  -- recusada. Confere o estado final inteiro, não só o que veio agora.
  if exists (
    with vigente as (
      select * from private.pricing_settings_current()
    ),
    escopo as (
      select canal.channel, null::uuid as category_id
        from pg_catalog.unnest(array['balcao', 'ifood', 'food99', 'buck']) as canal(channel)
      union
      select vigente.cfg_channel, vigente.cfg_category_id
        from vigente
       where vigente.cfg_category_id is not null
    ),
    efetivo as (
      select
        coalesce(
          (select vigente.cfg_value from vigente
            where vigente.cfg_setting_key = 'margem_desejada' and vigente.cfg_channel = escopo.channel
              and vigente.cfg_category_id is not distinct from escopo.category_id),
          (select vigente.cfg_value from vigente
            where vigente.cfg_setting_key = 'margem_desejada' and vigente.cfg_channel = escopo.channel
              and vigente.cfg_category_id is null)
        ) as desired,
        coalesce(
          (select vigente.cfg_value from vigente
            where vigente.cfg_setting_key = 'margem_minima' and vigente.cfg_channel = escopo.channel
              and vigente.cfg_category_id is not distinct from escopo.category_id),
          (select vigente.cfg_value from vigente
            where vigente.cfg_setting_key = 'margem_minima' and vigente.cfg_channel = escopo.channel
              and vigente.cfg_category_id is null)
        ) as minimum
      from escopo
    )
    select 1 from efetivo
     where efetivo.minimum is not null
       and efetivo.desired is not null
       and efetivo.minimum > efetivo.desired
  ) then
    raise exception using errcode = '22023',
      message = 'A margem mínima não pode ser maior que a margem desejada que vale para o mesmo canal e categoria (campo vazio na exceção usa o valor do canal).';
  end if;

  return pg_catalog.jsonb_build_object(
    'change_id', case when v_saved > 0 then v_change_id end,
    'saved', v_saved
  );
end;
$$;
revoke all on function public.save_pricing_settings(jsonb) from public, anon, service_role;
grant execute on function public.save_pricing_settings(jsonb) to authenticated;


commit;
