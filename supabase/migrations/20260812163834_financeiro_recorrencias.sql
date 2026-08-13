-- Financeiro, fase 2: recorrências.
--
-- A regra não cria dinheiro nem um lançamento escondido. Ao abrir o mês, a
-- tela calcula a previsão a partir dela; só a confirmação protegida cria o
-- lançamento imutável no livro. Assim, uma conta esquecida continua visível
-- como pendência e não vira uma despesa fictícia.

begin;

insert into public.app_permissions (key, module, label, description, sort_order)
values
  ('financeiro.recorrencias_gerenciar', 'Financeiro', 'Gerenciar recorrências', 'Cadastrar e encerrar contas mensais previstas.', 323),
  ('financeiro.recorrencias_confirmar', 'Financeiro', 'Confirmar recorrências', 'Confirmar o pagamento real de uma conta mensal.', 324)
on conflict (key) do update set
  module = excluded.module,
  label = excluded.label,
  description = excluded.description,
  sort_order = excluded.sort_order;

-- A conta e a forma habituais tornam a confirmação rápida. Elas são somente
-- um padrão: a função de confirmação recebe a conta e a forma reais de cada
-- mês, que ficam congeladas no lançamento materializado.
create table public.finance_recurring_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) >= 3),
  category_id uuid not null references public.finance_categories(id),
  store text not null check (store in ('jc', 'ja', 'geral')),
  planned_amount numeric(12,2) not null check (planned_amount > 0 and planned_amount <= 1000000),
  due_day integer not null check (due_day between 1 and 31),
  start_month date not null check (start_month = date_trunc('month', start_month)::date),
  end_month date check (end_month is null or end_month = date_trunc('month', end_month)::date),
  default_account_id uuid not null references public.finance_accounts(id),
  default_payment_method text not null check (default_payment_method in (
    'dinheiro', 'pix', 'transferencia', 'boleto', 'cartao', 'debito_automatico', 'outro'
  )),
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_recurring_rules_period check (end_month is null or end_month >= start_month)
);

create index finance_recurring_rules_month_idx
  on public.finance_recurring_rules (active, start_month, end_month);

revoke all on table public.finance_recurring_rules from anon, authenticated;

alter table public.finance_recurring_rules enable row level security;
alter table public.finance_recurring_rules force row level security;

create policy finance_recurring_rules_select_finance
on public.finance_recurring_rules for select to authenticated
using (private.current_user_can_finance('financeiro.acessar'));

grant select on public.finance_recurring_rules to authenticated;

-- Uma recorrência usa a própria regra como origem e o mês como segunda chave.
-- A trava anterior de origem/categoria não permitiria a mesma conta reaparecer
-- no mês seguinte; as duas travas abaixo preservam Contas a Pagar e tornam a
-- confirmação regra+mês idempotente, inclusive sob concorrência.
alter table public.finance_entries
  drop constraint if exists finance_entries_source_check;

alter table public.finance_entries
  add constraint finance_entries_source_check
    check (source in ('avulso', 'contas_pagar', 'recorrencia'));

alter table public.finance_entries
  add column recurrence_month date;

alter table public.finance_entries
  add constraint finance_entries_recurrence_shape check (
    (source = 'recorrencia' and source_ref is not null
      and recurrence_month = date_trunc('month', recurrence_month)::date)
    or (source <> 'recorrencia' and recurrence_month is null)
  );

drop index if exists public.finance_entries_origem_ativa_idx;

create unique index finance_entries_origem_ativa_idx
  on public.finance_entries (source, source_ref, category_id)
  where source_ref is not null
    and source <> 'recorrencia'
    and entry_type = 'lancamento'
    and reversed_at is null;

create unique index finance_entries_recorrencia_ativa_idx
  on public.finance_entries (source_ref, recurrence_month)
  where source = 'recorrencia'
    and entry_type = 'lancamento'
    and reversed_at is null;

create or replace function public.create_finance_recurring_rule(
  p_name text,
  p_category_key text,
  p_store text,
  p_planned_amount numeric,
  p_due_day integer,
  p_start_month date,
  p_end_month date,
  p_default_account_key text,
  p_default_payment_method text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule_id uuid;
  v_category record;
  v_account record;
  v_start_month date;
  v_end_month date;
  v_amount numeric(12,2);
begin
  if p_store is null or p_store not in ('jc', 'ja', 'geral') then
    raise exception using errcode = '22023', message = 'Escolha a loja da recorrência (JC, JA ou geral).';
  end if;
  if not private.current_user_can_finance_store('financeiro.recorrencias_gerenciar', p_store) then
    raise exception using errcode = '42501', message = 'Sem permissão para gerenciar recorrências desta loja.';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null or length(trim(p_name)) < 3 then
    raise exception using errcode = '22023', message = 'Dê um nome à recorrência com pelo menos 3 letras.';
  end if;
  if p_due_day is null or p_due_day not between 1 and 31 then
    raise exception using errcode = '22023', message = 'Informe um dia de vencimento entre 1 e 31.';
  end if;
  if p_planned_amount is null or p_planned_amount <= 0 then
    raise exception using errcode = '22023', message = 'Informe um valor previsto maior que zero.';
  end if;
  v_amount := round(p_planned_amount, 2);
  if v_amount > 1000000 then
    raise exception using errcode = '22023', message = 'Valor acima do limite permitido. Confira o que foi digitado.';
  end if;
  if p_start_month is null then
    raise exception using errcode = '22023', message = 'Informe o mês de início da recorrência.';
  end if;
  v_start_month := date_trunc('month', p_start_month)::date;
  v_end_month := case when p_end_month is null then null else date_trunc('month', p_end_month)::date end;
  if v_end_month is not null and v_end_month < v_start_month then
    raise exception using errcode = '22023', message = 'O fim da vigência não pode ser antes do início.';
  end if;

  select category.* into v_category
  from public.finance_categories category
  where category.key = p_category_key and category.active;
  if v_category.id is null or v_category.nature = 'transferencia' then
    raise exception using errcode = '22023', message = 'Escolha uma categoria financeira válida para a recorrência.';
  end if;

  select account.* into v_account
  from public.finance_accounts account
  where account.key = p_default_account_key and account.active;
  if v_account.id is null then
    raise exception using errcode = '22023', message = 'Escolha a conta habitual da recorrência.';
  end if;
  if v_account.kind = 'caixa' and p_store <> 'geral' and v_account.store <> p_store then
    raise exception using errcode = '22023', message = 'O caixa físico escolhido é de outra loja.';
  end if;
  if p_default_payment_method is null or p_default_payment_method not in
     ('dinheiro', 'pix', 'transferencia', 'boleto', 'cartao', 'debito_automatico', 'outro') then
    raise exception using errcode = '22023', message = 'Forma habitual de pagamento inválida.';
  end if;

  insert into public.finance_recurring_rules (
    name, category_id, store, planned_amount, due_day, start_month, end_month,
    default_account_id, default_payment_method, created_by
  ) values (
    trim(p_name), v_category.id, p_store, v_amount, p_due_day, v_start_month, v_end_month,
    v_account.id, p_default_payment_method, (select auth.uid())
  ) returning id into v_rule_id;

  return v_rule_id;
end;
$$;

create or replace function public.end_finance_recurring_rule(
  p_rule_id uuid,
  p_end_month date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule record;
  v_end_month date;
  v_last_materialized_month date;
begin
  select rule.* into v_rule
  from public.finance_recurring_rules rule
  where rule.id = p_rule_id
  for update;
  if v_rule.id is null then
    raise exception using errcode = 'P0002', message = 'Recorrência não encontrada.';
  end if;
  if not private.current_user_can_finance_store('financeiro.recorrencias_gerenciar', v_rule.store) then
    raise exception using errcode = '42501', message = 'Sem permissão para gerenciar recorrências desta loja.';
  end if;
  if p_end_month is null then
    raise exception using errcode = '22023', message = 'Informe o último mês da vigência.';
  end if;
  v_end_month := date_trunc('month', p_end_month)::date;
  if v_end_month < v_rule.start_month then
    raise exception using errcode = '22023', message = 'O fim da vigência não pode ser antes do início.';
  end if;
  if v_end_month < date_trunc('month', current_date)::date then
    raise exception using errcode = '22023', message = 'A recorrência só pode ser encerrada do mês atual em diante.';
  end if;

  select max(entry.recurrence_month) into v_last_materialized_month
  from public.finance_entries entry
  where entry.source = 'recorrencia'
    and entry.source_ref = v_rule.id
    and entry.entry_type = 'lancamento'
    and entry.reversed_at is null;
  if v_last_materialized_month is not null and v_end_month < v_last_materialized_month then
    raise exception using errcode = '22023', message = 'O fim não pode esconder um pagamento já confirmado.';
  end if;

  update public.finance_recurring_rules
  set end_month = v_end_month, updated_at = now()
  where id = v_rule.id;
end;
$$;

create or replace function public.confirm_finance_recurring_rule(
  p_request_id uuid,
  p_rule_id uuid,
  p_competence_month date,
  p_paid_date date,
  p_amount numeric,
  p_payment_method text,
  p_account_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry_id uuid;
  v_rule record;
  v_account record;
  v_competence_month date;
  v_paid_date date;
  v_due_date date;
  v_amount numeric(12,2);
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador da confirmação obrigatório.';
  end if;
  select entry.id into v_entry_id
  from public.finance_entries entry
  where entry.request_id = p_request_id;
  if v_entry_id is not null then
    return v_entry_id;
  end if;
  if p_competence_month is null then
    raise exception using errcode = '22023', message = 'Informe o mês da recorrência.';
  end if;
  v_competence_month := date_trunc('month', p_competence_month)::date;
  if v_competence_month > date_trunc('month', current_date)::date then
    raise exception using errcode = '22023', message = 'Uma recorrência futura ainda não pode ser confirmada.';
  end if;

  select rule.* into v_rule
  from public.finance_recurring_rules rule
  where rule.id = p_rule_id
  for update;
  if v_rule.id is null then
    raise exception using errcode = 'P0002', message = 'Recorrência não encontrada.';
  end if;
  if not private.current_user_can_finance_store('financeiro.recorrencias_confirmar', v_rule.store) then
    raise exception using errcode = '42501', message = 'Sem permissão para confirmar recorrências desta loja.';
  end if;
  if not v_rule.active or v_competence_month < v_rule.start_month
     or (v_rule.end_month is not null and v_competence_month > v_rule.end_month) then
    raise exception using errcode = '22023', message = 'Esta recorrência não está vigente neste mês.';
  end if;

  -- Serializa confirmações da mesma regra e competência. O índice único é a
  -- segunda barreira; a trava permite devolver o lançamento existente ao
  -- segundo toque em vez de transformar uma repetição em erro técnico.
  perform pg_advisory_xact_lock(hashtext(v_rule.id::text || v_competence_month::text));
  select entry.id into v_entry_id
  from public.finance_entries entry
  where entry.source = 'recorrencia'
    and entry.source_ref = v_rule.id
    and entry.recurrence_month = v_competence_month
    and entry.entry_type = 'lancamento'
    and entry.reversed_at is null;
  if v_entry_id is not null then
    return v_entry_id;
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception using errcode = '22023', message = 'Informe um valor pago maior que zero.';
  end if;
  v_amount := round(p_amount, 2);
  if v_amount > 1000000 then
    raise exception using errcode = '22023', message = 'Valor acima do limite permitido. Confira o que foi digitado.';
  end if;
  v_paid_date := coalesce(p_paid_date, current_date);
  if v_paid_date > current_date + 1 or v_paid_date < date '2020-01-01' then
    raise exception using errcode = '22023', message = 'Informe uma data de pagamento válida.';
  end if;
  if p_payment_method is null or p_payment_method not in
     ('dinheiro', 'pix', 'transferencia', 'boleto', 'cartao', 'debito_automatico', 'outro') then
    raise exception using errcode = '22023', message = 'Forma de pagamento inválida.';
  end if;

  select account.* into v_account
  from public.finance_accounts account
  where account.key = p_account_key and account.active;
  if v_account.id is null then
    raise exception using errcode = '22023', message = 'Escolha a conta real usada no pagamento.';
  end if;
  if v_account.kind = 'caixa' and v_rule.store <> 'geral' and v_account.store <> v_rule.store then
    raise exception using errcode = '22023', message = 'O caixa físico escolhido é de outra loja.';
  end if;

  v_due_date := make_date(
    extract(year from v_competence_month)::integer,
    extract(month from v_competence_month)::integer,
    least(v_rule.due_day, extract(day from (v_competence_month + interval '1 month - 1 day'))::integer)
  );

  insert into public.finance_entries (
    request_id, entry_type, category_id, account_id, store, competence_month,
    due_date, planned_amount, paid_date, amount, payment_method, description,
    source, source_ref, recurrence_month, created_by
  ) values (
    p_request_id, 'lancamento', v_rule.category_id, v_account.id, v_rule.store,
    v_competence_month, v_due_date, v_rule.planned_amount, v_paid_date, v_amount,
    p_payment_method, v_rule.name, 'recorrencia', v_rule.id, v_competence_month,
    (select auth.uid())
  ) returning id into v_entry_id;

  return v_entry_id;
end;
$$;

-- O estorno precisa carregar a mesma origem. Sem isso, estornar uma
-- recorrência quebraria a forma da linha e a previsão não voltaria a aparecer
-- como pendência. A mesma cópia também preserva a origem da baixa de fornecedor.
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
  ) values (
    p_request_id, 'estorno', v_original.category_id, v_original.account_id, v_original.store,
    v_original.competence_month, v_original.due_date, v_original.planned_amount,
    current_date, v_original.amount, v_original.payment_method,
    'Estorno de: ' || v_original.description,
    v_original.source, v_original.source_ref, v_original.recurrence_month,
    v_original.id, trim(p_reason), (select auth.uid())
  ) returning id into v_reversal_id;

  update public.finance_entries
  set reversed_at = now(), reversed_by = (select auth.uid()), reversal_reason = trim(p_reason)
  where id = v_original.id;
  return v_reversal_id;
end;
$$;

revoke all on function public.create_finance_recurring_rule(text, text, text, numeric, integer, date, date, text, text) from public, anon;
revoke all on function public.end_finance_recurring_rule(uuid, date) from public, anon;
revoke all on function public.confirm_finance_recurring_rule(uuid, uuid, date, date, numeric, text, text) from public, anon;
grant execute on function public.create_finance_recurring_rule(text, text, text, numeric, integer, date, date, text, text) to authenticated;
grant execute on function public.end_finance_recurring_rule(uuid, date) to authenticated;
grant execute on function public.confirm_finance_recurring_rule(uuid, uuid, date, date, numeric, text, text) to authenticated;

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
select profile.user_id, permission.key, '*', null::uuid
from public.app_profiles profile
join public.app_permissions permission on permission.key in (
  'financeiro.recorrencias_gerenciar', 'financeiro.recorrencias_confirmar'
)
where profile.active and profile.role = 'financeiro'
on conflict (user_id, permission_key, scope) do nothing;

commit;
