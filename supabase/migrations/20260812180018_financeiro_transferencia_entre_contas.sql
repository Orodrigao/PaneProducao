-- Transferência entre contas: o dinheiro anda entre duas contas sem virar
-- receita nem despesa (decisão 7 de docs/FINANCEIRO.md).
--
-- A fase 0 previu a categoria 'transferencia' e deixou a porta fechada de
-- propósito: `create_finance_entry` recusa essa categoria porque um lançamento
-- guarda UMA conta só, e movimento entre contas tem origem e destino. Esta
-- migration abre a porta pelo caminho certo — a transferência é um fato
-- próprio, com duas pernas que nascem e morrem juntas.
--
-- Sem isso não existe sangria, depósito, reforço nem pagamento de fatura de
-- cartão: o dinheiro sairia de uma conta sem entrar em lugar nenhum.

-- ---------------------------------------------------------------------------
-- Permissão própria. Transferir não é lançar: quem move dinheiro entre contas
-- pode ser outra pessoa (gate técnico — ações independentes, permissões
-- independentes).
-- ---------------------------------------------------------------------------
insert into public.app_permissions (key, module, label, description, sort_order)
values
  ('financeiro.transferir', 'Financeiro', 'Transferir entre contas',
   'Mover dinheiro entre contas e caixas (sangria, depósito, reforço).', 323)
on conflict (key) do update set
  module = excluded.module,
  label = excluded.label,
  description = excluded.description,
  sort_order = excluded.sort_order;

-- Quem já pode lançar no financeiro passa a poder transferir, no mesmo escopo.
-- Concessão inicial conservadora: não inventa acesso para quem não tinha nada.
insert into public.app_user_permissions (user_id, permission_key, scope)
select assignment.user_id, 'financeiro.transferir', assignment.scope
from public.app_user_permissions assignment
where assignment.permission_key = 'financeiro.lancar'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- A transferência como fato próprio.
-- ---------------------------------------------------------------------------
create table if not exists public.finance_transfers (
  id uuid primary key default gen_random_uuid(),
  -- Idempotência: dois toques no confirmar devolvem a mesma transferência.
  request_id uuid not null unique,
  origin_account_id uuid not null references public.finance_accounts(id),
  destination_account_id uuid not null references public.finance_accounts(id),
  amount numeric(12,2) not null check (amount > 0 and amount <= 1000000),
  transfer_date date not null,
  description text not null check (length(trim(description)) >= 3),
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id),
  reversal_reason text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint finance_transfers_accounts_differ
    check (origin_account_id <> destination_account_id),
  -- Estorno tem os três dados juntos ou nenhum (lição
  -- motivo-do-estorno-tem-dois-donos: modelar os dois lados antes da trava).
  constraint finance_transfers_reversal_complete check (
    (reversed_at is null and reversed_by is null and reversal_reason is null)
    or (reversed_at is not null and reversed_by is not null
        and length(trim(coalesce(reversal_reason, ''))) >= 3)
  )
);

create index if not exists finance_transfers_date_idx
  on public.finance_transfers (transfer_date desc);

-- ---------------------------------------------------------------------------
-- As duas pernas vivem no livro como qualquer lançamento — é lá que a Elis
-- enxerga o dinheiro. O vínculo é explícito: nada de deduzir par por valor e
-- data.
-- ---------------------------------------------------------------------------
alter table public.finance_entries
  add column if not exists transfer_id uuid references public.finance_transfers(id),
  add column if not exists transfer_leg text;

-- A origem 'transferencia' entra na lista fechada de `source`. A fase 0 abriu
-- com 'avulso'; contas a pagar e recorrências já a estenderam.
alter table public.finance_entries
  drop constraint if exists finance_entries_source_check;

alter table public.finance_entries
  add constraint finance_entries_source_check
    check (source in ('avulso', 'contas_pagar', 'recorrencia', 'transferencia'));

alter table public.finance_entries
  drop constraint if exists finance_entries_transfer_leg_check,
  drop constraint if exists finance_entries_transfer_pair_check;

alter table public.finance_entries
  add constraint finance_entries_transfer_leg_check
    check (transfer_leg is null or transfer_leg in ('saida', 'entrada')),
  -- Ou o lançamento é perna de transferência (com os dois campos), ou não é.
  add constraint finance_entries_transfer_pair_check
    check ((transfer_id is null) = (transfer_leg is null));

-- Uma perna de cada lado, nunca duas. É esta trava que impede "meia
-- transferência" e perna duplicada.
create unique index if not exists finance_entries_transfer_leg_unique
  on public.finance_entries (transfer_id, transfer_leg, entry_type)
  where transfer_id is not null;

-- ---------------------------------------------------------------------------
-- Lançar a transferência.
-- ---------------------------------------------------------------------------
create or replace function public.create_finance_transfer(
  p_request_id uuid,
  p_origin_account_key text,
  p_destination_account_key text,
  p_amount numeric,
  p_transfer_date date,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer_id uuid;
  v_origin record;
  v_destination record;
  v_category_id uuid;
  v_amount numeric(12,2);
  v_date date;
  v_origin_store text;
  v_destination_store text;
  v_description text;
  v_competence date;
  v_user_id uuid := (select auth.uid());
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador da transferência obrigatório.';
  end if;

  select existing.id into v_transfer_id
  from public.finance_transfers existing
  where existing.request_id = p_request_id;
  if v_transfer_id is not null then
    return v_transfer_id;
  end if;

  select account.* into v_origin
  from public.finance_accounts account
  where account.key = p_origin_account_key and account.active;
  if v_origin.id is null then
    raise exception using errcode = '22023', message = 'Conta de origem inválida ou inativa.';
  end if;

  select account.* into v_destination
  from public.finance_accounts account
  where account.key = p_destination_account_key and account.active;
  if v_destination.id is null then
    raise exception using errcode = '22023', message = 'Conta de destino inválida ou inativa.';
  end if;

  if v_origin.id = v_destination.id then
    raise exception using errcode = '22023', message = 'A conta de origem e a de destino precisam ser diferentes.';
  end if;

  -- Conta sem loja (banco da empresa) é dado da empresa inteira: 'geral'.
  v_origin_store := coalesce(v_origin.store, 'geral');
  v_destination_store := coalesce(v_destination.store, 'geral');

  -- Transferência entre lojas é legítima, mas exige permissão nas duas pontas.
  if not private.current_user_can_finance_store('financeiro.transferir', v_origin_store) then
    raise exception using errcode = '42501', message = 'Sem permissão para transferir a partir desta conta.';
  end if;
  if not private.current_user_can_finance_store('financeiro.transferir', v_destination_store) then
    raise exception using errcode = '42501', message = 'Sem permissão para transferir para esta conta.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception using errcode = '22023', message = 'Informe um valor maior que zero.';
  end if;
  v_amount := round(p_amount, 2);
  if v_amount > 1000000 then
    raise exception using errcode = '22023', message = 'Valor acima do limite permitido. Confira o que foi digitado.';
  end if;

  v_date := coalesce(p_transfer_date, current_date);
  if v_date > current_date + 1 then
    raise exception using errcode = '22023', message = 'A data da transferência não pode ser no futuro.';
  end if;
  if v_date < date '2020-01-01' then
    raise exception using errcode = '22023', message = 'Data da transferência muito antiga. Confira o que foi digitado.';
  end if;

  select category.id into v_category_id
  from public.finance_categories category
  where category.key = 'transferencia' and category.active;
  if v_category_id is null then
    raise exception using errcode = 'P0002', message = 'Categoria de transferência não encontrada.';
  end if;

  -- A descrição nasce pronta: no celular, quanto menos campo livre, melhor.
  v_description := 'Transferência: ' || v_origin.label || ' → ' || v_destination.label;
  if nullif(trim(coalesce(p_note, '')), '') is not null then
    v_description := v_description || ' · ' || trim(p_note);
  end if;

  v_competence := date_trunc('month', v_date)::date;

  insert into public.finance_transfers (
    request_id, origin_account_id, destination_account_id,
    amount, transfer_date, description, created_by
  )
  values (
    p_request_id, v_origin.id, v_destination.id,
    v_amount, v_date, v_description, v_user_id
  )
  returning id into v_transfer_id;

  -- As duas pernas na mesma transação. Meia transferência faz dinheiro
  -- aparecer ou sumir do nada.
  insert into public.finance_entries (
    request_id, entry_type, category_id, account_id, store, competence_month,
    due_date, planned_amount, paid_date, amount, payment_method, description,
    source, transfer_id, transfer_leg, created_by
  )
  values
    (gen_random_uuid(), 'lancamento', v_category_id, v_origin.id, v_origin_store,
     v_competence, v_date, v_amount, v_date, v_amount, 'transferencia',
     v_description, 'transferencia', v_transfer_id, 'saida', v_user_id),
    (gen_random_uuid(), 'lancamento', v_category_id, v_destination.id, v_destination_store,
     v_competence, v_date, v_amount, v_date, v_amount, 'transferencia',
     v_description, 'transferencia', v_transfer_id, 'entrada', v_user_id);

  return v_transfer_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Estornar a transferência inteira. Nunca uma perna só.
-- ---------------------------------------------------------------------------
create or replace function public.reverse_finance_transfer(
  p_request_id uuid,
  p_transfer_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer record;
  v_origin_store text;
  v_destination_store text;
  v_leg record;
  v_leg_request_id uuid := p_request_id;
  v_user_id uuid := (select auth.uid());
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador do estorno obrigatório.';
  end if;

  if exists (
    select 1 from public.finance_entries entry
    where entry.request_id = p_request_id
  ) then
    return p_transfer_id;
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null or length(trim(p_reason)) < 3 then
    raise exception using errcode = '22023', message = 'Informe o motivo do estorno.';
  end if;

  select transfer.* into v_transfer
  from public.finance_transfers transfer
  where transfer.id = p_transfer_id
  for update;
  if v_transfer.id is null then
    raise exception using errcode = 'P0002', message = 'Transferência não encontrada.';
  end if;
  if v_transfer.reversed_at is not null then
    raise exception using errcode = '22023', message = 'Esta transferência já foi estornada.';
  end if;

  select coalesce(account.store, 'geral') into v_origin_store
  from public.finance_accounts account where account.id = v_transfer.origin_account_id;
  select coalesce(account.store, 'geral') into v_destination_store
  from public.finance_accounts account where account.id = v_transfer.destination_account_id;

  if not private.current_user_can_finance_store('financeiro.estornar', v_origin_store)
     or not private.current_user_can_finance_store('financeiro.estornar', v_destination_store) then
    raise exception using errcode = '42501', message = 'Sem permissão para estornar esta transferência.';
  end if;

  -- Cada perna ganha seu contra-lançamento, ligado ao original. O livro é
  -- imutável: nada é apagado nem sobrescrito.
  for v_leg in
    select entry.* from public.finance_entries entry
    where entry.transfer_id = v_transfer.id and entry.entry_type = 'lancamento'
    order by entry.transfer_leg
  loop
    insert into public.finance_entries (
      request_id, entry_type, category_id, account_id, store, competence_month,
      due_date, planned_amount, paid_date, amount, payment_method, description,
      source, transfer_id, transfer_leg, reversal_of, reversal_reason, created_by
    )
    values (
      -- A primeira perna guarda a chave da requisição: é ela que faz o toque
      -- duplo no estorno devolver o mesmo resultado em vez de dar erro.
      v_leg_request_id, 'estorno', v_leg.category_id, v_leg.account_id, v_leg.store,
      v_leg.competence_month, v_leg.due_date, v_leg.planned_amount,
      current_date, v_leg.amount, v_leg.payment_method,
      'Estorno de: ' || v_leg.description,
      v_leg.source, v_leg.transfer_id, v_leg.transfer_leg,
      v_leg.id, trim(p_reason), v_user_id
    );

    update public.finance_entries
    set reversed_at = now(),
        reversed_by = v_user_id,
        reversal_reason = trim(p_reason)
    where id = v_leg.id;

    v_leg_request_id := gen_random_uuid();
  end loop;

  update public.finance_transfers
  set reversed_at = now(),
      reversed_by = v_user_id,
      reversal_reason = trim(p_reason)
  where id = v_transfer.id;

  return v_transfer.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Estornar perna solta é proibido: quebraria o par e faria dinheiro sumir.
-- ---------------------------------------------------------------------------
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
    source, reversal_of, reversal_reason, created_by
  )
  values (
    p_request_id, 'estorno', v_original.category_id, v_original.account_id, v_original.store,
    v_original.competence_month, v_original.due_date, v_original.planned_amount,
    current_date, v_original.amount, v_original.payment_method,
    'Estorno de: ' || v_original.description,
    v_original.source, v_original.id, trim(p_reason), (select auth.uid())
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

-- ---------------------------------------------------------------------------
-- RLS: leitura por permissão; escrita nenhuma fora das funções acima.
-- ---------------------------------------------------------------------------
alter table public.finance_transfers enable row level security;
alter table public.finance_transfers force row level security;

drop policy if exists finance_transfers_select_finance on public.finance_transfers;
create policy finance_transfers_select_finance
on public.finance_transfers for select to authenticated
using (private.current_user_can_finance('financeiro.acessar'));

revoke all on public.finance_transfers from anon, authenticated;
grant select on public.finance_transfers to authenticated;

revoke all on function public.create_finance_transfer(uuid, text, text, numeric, date, text)
  from public, anon, authenticated;
grant execute on function public.create_finance_transfer(uuid, text, text, numeric, date, text)
  to authenticated;

revoke all on function public.reverse_finance_transfer(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.reverse_finance_transfer(uuid, uuid, text)
  to authenticated;
