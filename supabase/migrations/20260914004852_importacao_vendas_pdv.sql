-- Núcleo de vendas do balcão independente do fornecedor do PDV.
-- O CNM é apenas a primeira origem. Arquivo bruto, itens normalizados e troca
-- de versão ficam preservados para auditoria; nenhuma linha altera estoque,
-- custo ou preço de venda.

begin;

insert into public.app_permissions (key, module, label, description, sort_order)
values
  ('vendas_balcao.visualizar', 'Relatórios', 'Ver vendas do balcão', 'Consultar valores e importações de vendas do balcão.', 350),
  ('vendas_balcao.importar', 'Relatórios', 'Importar vendas do balcão', 'Conferir e confirmar arquivos de venda do PDV.', 351)
on conflict (key) do update set
  module = excluded.module,
  label = excluded.label,
  description = excluded.description,
  sort_order = excluded.sort_order;

-- A concessão acontece uma vez para os perfis atuais de Rodrigo e Elis. A
-- função abaixo não libera administradores ou financeiros futuros por papel:
-- uma nova pessoa precisa receber a permissão de forma explícita.
insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
select profile.user_id, permission.key, 'jc', null::uuid
from public.app_profiles profile
join auth.users user_account on user_account.id = profile.user_id
cross join public.app_permissions permission
where profile.active
  and lower(user_account.email) in ('rodrigao@gmail.com', 'financeiro@paneesalute.com.br')
  and permission.key in ('vendas_balcao.visualizar', 'vendas_balcao.importar')
on conflict (user_id, permission_key, scope) do nothing;

create or replace function private.current_user_can_sales(p_permission text, p_store text default 'jc')
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and exists (
        select 1
        from public.app_user_permissions assignment
        where assignment.user_id = profile.user_id
          and assignment.permission_key = p_permission
          and assignment.scope in ('*', lower(p_store))
      )
  );
$$;
revoke all on function private.current_user_can_sales(text, text) from public, anon;
grant execute on function private.current_user_can_sales(text, text) to authenticated;

create table public.sales_imports (
  id uuid primary key default gen_random_uuid(),
  source_system text not null check (source_system ~ '^[a-z][a-z0-9_]{1,30}$'),
  store text not null check (store in ('jc', 'ja', 'ex')),
  report_type text not null check (report_type = 'sales_by_product'),
  sale_date date not null,
  file_name text not null check (length(file_name) between 1 and 240),
  file_hash text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  storage_path text not null unique check (length(storage_path) between 1 and 500),
  parser_version text not null check (length(parser_version) between 1 and 80),
  status text not null default 'confirmed' check (status in ('confirmed', 'replaced')),
  row_count integer not null check (row_count > 0 and row_count <= 5000),
  total_quantity numeric(16,4) not null check (total_quantity > 0),
  total_net numeric(14,2) not null check (total_net >= 0),
  replaces_import_id uuid references public.sales_imports(id),
  replacement_reason text,
  confirmed_by uuid not null references auth.users(id),
  confirmed_at timestamptz not null default now(),
  replaced_by uuid references auth.users(id),
  replaced_at timestamptz,
  constraint sales_imports_replacement_origin check (
    (replaces_import_id is null and replacement_reason is null)
    or (replaces_import_id is not null and length(trim(replacement_reason)) >= 3)
  ),
  constraint sales_imports_status_audit check (
    (status = 'confirmed' and replaced_by is null and replaced_at is null)
    or (status = 'replaced' and replaced_by is not null and replaced_at is not null)
  )
);

create table public.sales_import_items (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.sales_imports(id),
  line_number integer not null check (line_number > 0),
  external_product_key text not null check (length(trim(external_product_key)) between 1 and 300),
  raw_product_name text not null check (length(trim(raw_product_name)) between 1 and 300),
  raw_category text not null check (length(trim(raw_category)) between 1 and 200),
  quantity numeric(16,4) not null check (quantity > 0),
  source_cmv numeric(14,2) check (source_cmv is null or source_cmv >= 0),
  take_away boolean,
  net_total numeric(14,2) not null check (net_total >= 0),
  raw_row jsonb not null check (jsonb_typeof(raw_row) = 'array'),
  unique (import_id, line_number)
);

create table public.sales_day_statuses (
  id uuid primary key default gen_random_uuid(),
  source_system text not null check (source_system ~ '^[a-z][a-z0-9_]{1,30}$'),
  store text not null check (store in ('jc', 'ja', 'ex')),
  sale_date date not null,
  status text not null check (status in ('closed', 'zero_sales')),
  reason text not null check (length(trim(reason)) between 3 and 300),
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  unique (source_system, store, sale_date)
);

create table public.sales_import_events (
  id uuid primary key default gen_random_uuid(),
  import_id uuid references public.sales_imports(id),
  source_system text not null,
  store text not null,
  sale_date date not null,
  event_type text not null check (event_type in ('created', 'replaced', 'restored', 'day_status_recorded', 'day_status_cleared')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  occurred_by uuid not null references auth.users(id),
  occurred_at timestamptz not null default now()
);

create unique index sales_imports_active_day_idx
  on public.sales_imports (source_system, store, report_type, sale_date)
  where status = 'confirmed';
create unique index sales_imports_file_version_idx
  on public.sales_imports (source_system, store, report_type, file_hash);
create index sales_imports_date_idx on public.sales_imports (sale_date desc, confirmed_at desc);
create index sales_import_items_import_idx on public.sales_import_items (import_id, line_number);

revoke all on table public.sales_imports, public.sales_import_items, public.sales_day_statuses, public.sales_import_events from public, anon, authenticated;
grant select on table public.sales_imports, public.sales_import_items, public.sales_day_statuses, public.sales_import_events to authenticated;
alter table public.sales_imports enable row level security;
alter table public.sales_imports force row level security;
alter table public.sales_import_items enable row level security;
alter table public.sales_import_items force row level security;
alter table public.sales_day_statuses enable row level security;
alter table public.sales_day_statuses force row level security;
alter table public.sales_import_events enable row level security;
alter table public.sales_import_events force row level security;

create policy sales_imports_select_authorized on public.sales_imports
for select to authenticated using (private.current_user_can_sales('vendas_balcao.visualizar', store));
create policy sales_items_select_authorized on public.sales_import_items
for select to authenticated using (
  exists (
    select 1 from public.sales_imports import
    where import.id = sales_import_items.import_id
      and private.current_user_can_sales('vendas_balcao.visualizar', import.store)
  )
);
create policy sales_day_statuses_select_authorized on public.sales_day_statuses
for select to authenticated using (private.current_user_can_sales('vendas_balcao.visualizar', store));
create policy sales_import_events_select_authorized on public.sales_import_events
for select to authenticated using (private.current_user_can_sales('vendas_balcao.visualizar', store));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sales-imports', 'sales-imports', false, 10485760, array['application/vnd.ms-excel'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy sales_import_files_insert_authorized on storage.objects
for insert to authenticated
with check (
  bucket_id = 'sales-imports'
  and private.current_user_can_sales('vendas_balcao.importar', 'jc')
  and name ~ '^[a-z][a-z0-9_]{1,30}/jc/[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9a-f]{64}\.xls$'
);
create policy sales_import_files_select_authorized on storage.objects
for select to authenticated
using (
  bucket_id = 'sales-imports'
  and private.current_user_can_sales('vendas_balcao.visualizar', 'jc')
);

create or replace function public.confirm_sales_import(
  p_source_system text,
  p_store text,
  p_report_type text,
  p_sale_date date,
  p_file_name text,
  p_file_hash text,
  p_storage_path text,
  p_parser_version text,
  p_reported_total numeric,
  p_replacement_reason text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active public.sales_imports%rowtype;
  v_existing public.sales_imports%rowtype;
  v_import_id uuid;
  v_item record;
  v_rows integer := 0;
  v_total_quantity numeric := 0;
  v_total_net numeric := 0;
begin
  if p_source_system <> 'cnm' or p_store <> 'jc' or p_report_type <> 'sales_by_product' then
    raise exception using errcode = '22023', message = 'Origem, loja ou tipo de relatório ainda não habilitado.';
  end if;
  if not private.current_user_can_sales('vendas_balcao.importar', p_store) then
    raise exception using errcode = '42501', message = 'Sem permissão para importar vendas do balcão.';
  end if;
  if p_sale_date is null or p_sale_date > private.data_na_padaria() then
    raise exception using errcode = '22023', message = 'A data da venda não pode estar no futuro.';
  end if;
  if p_file_name !~ '^CNM_(JC_[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{4}-[0-9]{2}-[0-9]{2}_JC)\.xls$'
     or p_file_name not in ('CNM_JC_' || p_sale_date::text || '.xls', 'CNM_' || p_sale_date::text || '_JC.xls') then
    raise exception using errcode = '22023', message = 'O nome do arquivo não confere com a data e a unidade JC.';
  end if;
  if p_file_hash !~ '^[0-9a-f]{64}$'
     or p_storage_path <> p_source_system || '/' || p_store || '/' || p_sale_date::text || '/' || p_file_hash || '.xls' then
    raise exception using errcode = '22023', message = 'Identificação do arquivo original inválida.';
  end if;
  if nullif(trim(p_parser_version), '') is null
     or jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 5000 then
    raise exception using errcode = '22023', message = 'A lista de itens do relatório é inválida.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sales-import:' || p_source_system || ':' || p_store || ':' || p_report_type || ':' || p_sale_date::text, 0
  ));

  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'sales-imports' and object.name = p_storage_path
  ) then
    raise exception using errcode = '22023', message = 'O arquivo original ainda não foi guardado.';
  end if;

  for v_item in
    select * from jsonb_to_recordset(p_items) as item(
      line_number integer,
      external_product_key text,
      raw_product_name text,
      raw_category text,
      quantity numeric,
      source_cmv numeric,
      take_away boolean,
      net_total numeric,
      raw_row jsonb
    )
  loop
    if v_item.line_number is null or v_item.line_number <= 0
       or nullif(trim(v_item.external_product_key), '') is null
       or nullif(trim(v_item.raw_product_name), '') is null
       or nullif(trim(v_item.raw_category), '') is null
       or v_item.quantity is null or v_item.quantity <= 0
       or v_item.net_total is null or v_item.net_total < 0
       or (v_item.source_cmv is not null and v_item.source_cmv < 0)
       or jsonb_typeof(coalesce(v_item.raw_row, 'null'::jsonb)) <> 'array' then
      raise exception using errcode = '22023', message = 'Há item inválido no relatório de vendas.';
    end if;
    v_rows := v_rows + 1;
    v_total_quantity := v_total_quantity + round(v_item.quantity, 4);
    v_total_net := v_total_net + round(v_item.net_total, 2);
  end loop;

  if p_reported_total is null or abs(round(v_total_net, 2) - round(p_reported_total, 2)) > 0.01 then
    raise exception using errcode = '22023', message = 'A soma dos produtos não fecha com o total informado no arquivo.';
  end if;

  select * into v_active from public.sales_imports import
  where import.source_system = p_source_system and import.store = p_store
    and import.report_type = p_report_type and import.sale_date = p_sale_date
    and import.status = 'confirmed'
  for update;

  if v_active.id is not null and v_active.file_hash = p_file_hash then
    return jsonb_build_object('id', v_active.id, 'outcome', 'unchanged');
  end if;
  if v_active.id is not null and length(trim(coalesce(p_replacement_reason, ''))) < 3 then
    raise exception using errcode = '23505', message = 'Já existe outra versão para este dia. Informe o motivo da substituição.';
  end if;

  select * into v_existing from public.sales_imports import
  where import.source_system = p_source_system and import.store = p_store
    and import.report_type = p_report_type
    and import.file_hash = p_file_hash;
  if v_existing.id is not null then
    raise exception using errcode = '23505',
      message = 'Este mesmo arquivo já foi importado em ' || to_char(v_existing.sale_date, 'DD/MM/YYYY') || '.';
  end if;

  if v_active.id is not null then
    update public.sales_imports
    set status = 'replaced', replaced_by = (select auth.uid()), replaced_at = now()
    where id = v_active.id;
  end if;

  insert into public.sales_imports (
    source_system, store, report_type, sale_date, file_name, file_hash,
    storage_path, parser_version, row_count, total_quantity, total_net,
    replaces_import_id, replacement_reason, confirmed_by
  ) values (
    p_source_system, p_store, p_report_type, p_sale_date, p_file_name, p_file_hash,
    p_storage_path, trim(p_parser_version), v_rows, round(v_total_quantity, 4),
    round(v_total_net, 2), v_active.id,
    case when v_active.id is null then null else nullif(trim(p_replacement_reason), '') end,
    (select auth.uid())
  ) returning id into v_import_id;

  insert into public.sales_import_items (
    import_id, line_number, external_product_key, raw_product_name, raw_category,
    quantity, source_cmv, take_away, net_total, raw_row
  )
  select v_import_id, item.line_number, trim(item.external_product_key),
    trim(item.raw_product_name), trim(item.raw_category), round(item.quantity, 4),
    case when item.source_cmv is null then null else round(item.source_cmv, 2) end,
    item.take_away, round(item.net_total, 2), item.raw_row
  from jsonb_to_recordset(p_items) as item(
    line_number integer, external_product_key text, raw_product_name text,
    raw_category text, quantity numeric, source_cmv numeric, take_away boolean,
    net_total numeric, raw_row jsonb
  );

  insert into public.sales_import_events (import_id, source_system, store, sale_date, event_type, details, occurred_by)
  values (
    v_import_id, p_source_system, p_store, p_sale_date,
    case when v_active.id is null then 'created' else 'replaced' end,
    jsonb_build_object('previous_import_id', v_active.id, 'reason', case when v_active.id is null then null else trim(p_replacement_reason) end),
    (select auth.uid())
  );
  insert into public.sales_import_events (import_id, source_system, store, sale_date, event_type, details, occurred_by)
  select v_import_id, status.source_system, status.store, status.sale_date, 'day_status_cleared',
    jsonb_build_object('status', status.status, 'reason', status.reason), (select auth.uid())
  from public.sales_day_statuses status
  where status.source_system = p_source_system and status.store = p_store and status.sale_date = p_sale_date;
  delete from public.sales_day_statuses status
  where status.source_system = p_source_system and status.store = p_store and status.sale_date = p_sale_date;
  return jsonb_build_object('id', v_import_id, 'outcome', case when v_active.id is null then 'created' else 'replaced' end);
end;
$$;
revoke all on function public.confirm_sales_import(text, text, text, date, text, text, text, text, numeric, text, jsonb) from public, anon;
grant execute on function public.confirm_sales_import(text, text, text, date, text, text, text, text, numeric, text, jsonb) to authenticated;

create or replace function public.restore_sales_import(p_import_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_target public.sales_imports%rowtype; v_active public.sales_imports%rowtype;
begin
  select * into v_target from public.sales_imports where id = p_import_id;
  if v_target.id is null or length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception using errcode='22023', message='Versão e motivo da restauração são obrigatórios.';
  end if;
  if not private.current_user_can_sales('vendas_balcao.importar', v_target.store) then
    raise exception using errcode='42501', message='Sem permissão para restaurar vendas do balcão.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sales-import:'||v_target.source_system||':'||v_target.store||':'||v_target.report_type||':'||v_target.sale_date::text, 0));
  select * into v_active from public.sales_imports import
  where import.source_system=v_target.source_system and import.store=v_target.store
    and import.report_type=v_target.report_type and import.sale_date=v_target.sale_date and import.status='confirmed'
  for update;
  if v_active.id = v_target.id then return v_target.id; end if;
  if v_active.id is null then raise exception using errcode='P0001', message='O dia não possui versão ativa para restaurar com segurança.'; end if;
  update public.sales_imports set status='replaced', replaced_by=(select auth.uid()), replaced_at=now() where id=v_active.id;
  update public.sales_imports set status='confirmed', replaced_by=null, replaced_at=null where id=v_target.id;
  insert into public.sales_import_events(import_id,source_system,store,sale_date,event_type,details,occurred_by)
  values(v_target.id,v_target.source_system,v_target.store,v_target.sale_date,'restored',
    jsonb_build_object('replaced_import_id',v_active.id,'reason',trim(p_reason)),(select auth.uid()));
  return v_target.id;
end; $$;
revoke all on function public.restore_sales_import(uuid,text) from public,anon;
grant execute on function public.restore_sales_import(uuid,text) to authenticated;

create or replace function public.discard_unconfirmed_sales_file(p_storage_path text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not private.current_user_can_sales('vendas_balcao.importar', 'jc') then
    raise exception using errcode='42501', message='Sem permissão para limpar arquivo não confirmado.';
  end if;
  if p_storage_path !~ '^[a-z][a-z0-9_]{1,30}/jc/[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9a-f]{64}\.xls$' then
    raise exception using errcode='22023', message='Caminho de arquivo inválido.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sales-import:' || split_part(p_storage_path,'/',1) || ':jc:sales_by_product:' || split_part(p_storage_path,'/',3), 0));
  if exists(select 1 from public.sales_imports where storage_path=p_storage_path) then
    return false;
  end if;
  delete from storage.objects where bucket_id='sales-imports' and name=p_storage_path;
  return found;
end; $$;
revoke all on function public.discard_unconfirmed_sales_file(text) from public,anon;
grant execute on function public.discard_unconfirmed_sales_file(text) to authenticated;

create or replace function public.record_sales_day_status(
  p_source_system text,
  p_store text,
  p_sale_date date,
  p_status text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if p_source_system <> 'cnm' or p_store <> 'jc' or p_status not in ('closed', 'zero_sales')
     or p_sale_date is null or p_sale_date > private.data_na_padaria()
     or length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception using errcode = '22023', message = 'Situação do dia inválida.';
  end if;
  if not private.current_user_can_sales('vendas_balcao.importar', p_store) then
    raise exception using errcode = '42501', message = 'Sem permissão para registrar a situação do dia.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sales-import:' || p_source_system || ':' || p_store || ':sales_by_product:' || p_sale_date::text, 0
  ));
  if exists (
    select 1 from public.sales_imports import
    where import.source_system = p_source_system and import.store = p_store
      and import.report_type = 'sales_by_product' and import.sale_date = p_sale_date
      and import.status = 'confirmed'
  ) then
    raise exception using errcode = '23505', message = 'Este dia já possui venda importada.';
  end if;
  insert into public.sales_day_statuses (source_system, store, sale_date, status, reason, recorded_by)
  values (p_source_system, p_store, p_sale_date, p_status, trim(p_reason), (select auth.uid()))
  on conflict (source_system, store, sale_date) do update set
    status = excluded.status, reason = excluded.reason,
    recorded_by = excluded.recorded_by, recorded_at = now()
  returning id into v_id;
  insert into public.sales_import_events(import_id,source_system,store,sale_date,event_type,details,occurred_by)
  values(null,p_source_system,p_store,p_sale_date,'day_status_recorded',
    jsonb_build_object('status',p_status,'reason',trim(p_reason)),(select auth.uid()));
  return v_id;
end;
$$;
revoke all on function public.record_sales_day_status(text, text, date, text, text) from public, anon;
grant execute on function public.record_sales_day_status(text, text, date, text, text) to authenticated;

commit;
