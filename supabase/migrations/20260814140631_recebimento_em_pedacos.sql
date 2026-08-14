-- Contas a receber: uma cobrança passa a aceitar vários recebimentos.
--
-- Motivo operacional (Rodrigo, 2026-08-14): a Buck paga em pedaços, em dias
-- diferentes, dividindo entre Pix e dinheiro. O modelo das fases 2 a 4
-- guardava um recebimento só na própria cobrança, o que obrigava a Elis a
-- registrar uma mentira: ou o valor cheio antes de ter entrado, ou nada.
--
-- Decisão: vale para qualquer cobrança, não só a da Buck.
--
-- Momento escolhido de propósito: produção tem ZERO cobranças e ZERO
-- lançamentos de contas a receber no livro. Nenhum dado a migrar. Daqui a um
-- mês isto seria remendar dinheiro já lançado.
--
-- Detalhe que decide o desenho: `finance_entries` tem índice único de um
-- lançamento ativo por (origem, registro de origem, categoria). Com vários
-- pedaços, todos colidiriam se apontassem para a cobrança — então cada
-- lançamento aponta para o PEDAÇO.

begin;

-- ---------------------------------------------------------------------------
-- Os pedaços.
-- ---------------------------------------------------------------------------
create table if not exists public.receivable_receipts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  receivable_id uuid not null references public.receivables(id) on delete restrict,
  received_date date not null,
  amount numeric(12,2) not null check (amount > 0 and amount <= 1000000),
  method text not null check (method in ('dinheiro', 'pix', 'transferencia', 'boleto', 'cartao', 'outro')),
  account_id uuid not null references public.finance_accounts(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id),
  reversal_reason text,
  -- Estorno completo ou nenhum: motivo sem data, ou data sem motivo, seria
  -- história pela metade.
  constraint receivable_receipts_reversal_shape check (
    (reversed_at is null) = (reversal_reason is null)
    and (reversed_at is null or nullif(trim(coalesce(reversal_reason, '')), '') is not null)
  )
);

comment on table public.receivable_receipts is
  'Cada entrada de dinheiro de uma cobrança. Uma cobrança pode ter vários.';

create index if not exists receivable_receipts_receivable_idx
  on public.receivable_receipts (receivable_id, received_date);
create index if not exists receivable_receipts_ativos_idx
  on public.receivable_receipts (receivable_id)
  where reversed_at is null;

revoke all on table public.receivable_receipts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- A cobrança deixa de guardar o recebimento e passa a ter situação parcial.
-- ---------------------------------------------------------------------------
alter table public.receivables drop constraint if exists receivables_received_shape;
alter table public.receivables drop constraint if exists receivables_status_check;

alter table public.receivables
  add constraint receivables_status_check
    check (status in ('aberta', 'parcial', 'recebida', 'cancelada'));

-- As colunas de recebimento único saem: a verdade agora é a soma dos pedaços.
-- Seguro porque nenhuma cobrança existe em produção.
alter table public.receivables
  drop column if exists received_date,
  drop column if exists received_amount,
  drop column if exists received_method,
  drop column if exists received_account_id,
  drop column if exists received_by,
  drop column if exists received_at;

-- ---------------------------------------------------------------------------
-- Quanto já entrou e quanto falta.
-- ---------------------------------------------------------------------------
create or replace function private.receivable_recebido(p_receivable_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(sum(recibo.amount), 0)::numeric(12,2)
  from public.receivable_receipts recibo
  where recibo.receivable_id = p_receivable_id
    and recibo.reversed_at is null;
$fn$;

revoke all on function private.receivable_recebido(uuid) from public, anon, authenticated;
grant execute on function private.receivable_recebido(uuid) to authenticated;

-- A situação nasce da soma, nunca de um clique: recalcular sempre evita a
-- cobrança dizer "recebida" com dinheiro faltando.
create or replace function private.atualizar_situacao_receivable(p_receivable_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_cobranca record;
  v_recebido numeric(12,2);
  v_situacao text;
begin
  select cobranca.amount, cobranca.status into v_cobranca
  from public.receivables cobranca
  where cobranca.id = p_receivable_id;

  if v_cobranca.status = 'cancelada' then
    return 'cancelada';
  end if;

  v_recebido := private.receivable_recebido(p_receivable_id);
  v_situacao := case
    when v_recebido <= 0 then 'aberta'
    when v_recebido >= v_cobranca.amount then 'recebida'
    else 'parcial'
  end;

  update public.receivables set status = v_situacao where id = p_receivable_id;
  return v_situacao;
end;
$fn$;

revoke all on function private.atualizar_situacao_receivable(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Ponte com o livro: um lançamento por pedaço.
-- ---------------------------------------------------------------------------
drop function if exists private.sync_receivable_finance_entry(uuid, uuid, text);

create or replace function private.lancar_recibo_no_livro(p_receipt_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row record;
  v_descricao text;
begin
  select recibo.id, recibo.amount, recibo.received_date, recibo.method, recibo.account_id,
         cobranca.id as receivable_id, cobranca.finance_category_id, cobranca.description,
         cobranca.invoice_date, cobranca.due_date, cobranca.amount as valor_cobrado,
         customer.name as cliente
    into v_row
  from public.receivable_receipts recibo
  join public.receivables cobranca on cobranca.id = recibo.receivable_id
  join public.customers customer on customer.id = cobranca.customer_id
  where recibo.id = p_receipt_id;

  if v_row.id is null then
    return;
  end if;

  -- Idempotência: o mesmo pedaço nunca vira dois lançamentos.
  if exists (
    select 1 from public.finance_entries existente
    where existente.source = 'contas_receber'
      and existente.source_ref = p_receipt_id
      and existente.entry_type = 'lancamento'
      and existente.reversed_at is null
  ) then
    return;
  end if;

  v_descricao := coalesce(nullif(trim(v_row.cliente), ''), 'Cliente') || ' · ' || v_row.description
    || case when v_row.amount < v_row.valor_cobrado then ' · recebimento parcial' else '' end;

  insert into public.finance_entries (
    request_id, entry_type, category_id, account_id, store, competence_month,
    due_date, planned_amount, paid_date, amount, payment_method, description,
    source, source_ref, created_by
  )
  values (
    gen_random_uuid(), 'lancamento', v_row.finance_category_id, v_row.account_id,
    'jc',
    -- Competência no mês do faturamento, como nas fases anteriores: o pedaço
    -- entra no caixa hoje, mas a venda pesa no mês em que o pão saiu.
    date_trunc('month', v_row.invoice_date)::date,
    v_row.due_date,
    -- Previsto e realizado são iguais no pedaço: a diferença entre o cobrado e
    -- o recebido vive na cobrança, não em cada entrada.
    v_row.amount, v_row.received_date, v_row.amount,
    v_row.method, v_descricao,
    'contas_receber', p_receipt_id, p_user_id
  );
end;
$fn$;

revoke all on function private.lancar_recibo_no_livro(uuid, uuid) from public, anon, authenticated;

create or replace function private.estornar_recibo_no_livro(
  p_receipt_id uuid,
  p_user_id uuid,
  p_motivo text
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.finance_entries (
    request_id, entry_type, category_id, account_id, store, competence_month,
    due_date, planned_amount, paid_date, amount, payment_method, description,
    source, source_ref, reversal_of, reversal_reason, created_by
  )
  select gen_random_uuid(), 'estorno', anterior.category_id, anterior.account_id,
         anterior.store, anterior.competence_month, anterior.due_date,
         anterior.planned_amount, private.data_na_padaria(), anterior.amount,
         anterior.payment_method, 'Estorno de: ' || anterior.description,
         anterior.source, anterior.source_ref, anterior.id, p_motivo, p_user_id
  from public.finance_entries anterior
  where anterior.source = 'contas_receber'
    and anterior.source_ref = p_receipt_id
    and anterior.entry_type = 'lancamento'
    and anterior.reversed_at is null;

  update public.finance_entries
  set reversed_at = now(), reversed_by = p_user_id, reversal_reason = p_motivo
  where source = 'contas_receber'
    and source_ref = p_receipt_id
    and entry_type = 'lancamento'
    and reversed_at is null;
end;
$fn$;

revoke all on function private.estornar_recibo_no_livro(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Registrar um pedaço.
-- ---------------------------------------------------------------------------
-- Substitui record_receivable_payment. Confere somente contas_receber.baixar:
-- o lançamento no livro nasce por dentro da ação.
drop function if exists public.record_receivable_payment(uuid, uuid, date, numeric, text, text);

create or replace function public.record_receivable_receipt(
  p_request_id uuid,
  p_receivable_id uuid,
  p_received_date date,
  p_amount numeric,
  p_method text,
  p_account_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt_id uuid;
  v_cobranca record;
  v_account record;
  v_amount numeric(12,2);
  v_recebido numeric(12,2);
  v_user_id uuid := (select auth.uid());
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador do recebimento obrigatório.';
  end if;

  if not private.current_user_can_receivables('contas_receber.baixar') then
    raise exception using errcode = '42501', message = 'Sem permissão para registrar recebimentos.';
  end if;

  -- Idempotência: repetir a mesma requisição devolve o mesmo pedaço.
  select recibo.id into v_receipt_id
  from public.receivable_receipts recibo
  where recibo.request_id = p_request_id;
  if v_receipt_id is not null then
    return v_receipt_id;
  end if;

  select cobranca.* into v_cobranca
  from public.receivables cobranca
  where cobranca.id = p_receivable_id
  for update;
  if v_cobranca.id is null then
    raise exception using errcode = 'P0002', message = 'Cobrança não encontrada.';
  end if;
  if v_cobranca.status = 'cancelada' then
    raise exception using errcode = '22023', message = 'Cobrança cancelada não recebe pagamento.';
  end if;

  v_recebido := private.receivable_recebido(p_receivable_id);
  if v_recebido >= v_cobranca.amount then
    raise exception using errcode = '22023',
      message = 'Esta cobrança já está quitada. Estorne um recebimento antes de registrar outro.';
  end if;

  if p_received_date is null then
    raise exception using errcode = '22023', message = 'Informe a data em que o dinheiro entrou.';
  end if;
  if p_received_date > private.data_na_padaria() then
    raise exception using errcode = '22023', message = 'A data do recebimento não pode ser no futuro.';
  end if;
  if p_received_date < v_cobranca.invoice_date then
    raise exception using errcode = '22023', message = 'O recebimento não pode ser anterior ao faturamento.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception using errcode = '22023', message = 'Informe o valor recebido.';
  end if;
  v_amount := round(p_amount, 2);
  if v_amount > 1000000 then
    raise exception using errcode = '22023', message = 'Valor acima do limite permitido. Confira o que foi digitado.';
  end if;

  if p_method is null or p_method not in ('dinheiro', 'pix', 'transferencia', 'boleto', 'cartao', 'outro') then
    raise exception using errcode = '22023', message = 'Forma de recebimento inválida.';
  end if;

  select account.* into v_account
  from public.finance_accounts account
  where account.key = p_account_key and account.active;
  if v_account.id is null then
    raise exception using errcode = '22023', message = 'Escolha a conta em que o dinheiro entrou.';
  end if;
  if v_account.kind = 'cartao_credito' then
    raise exception using errcode = '22023', message = 'Cartão de crédito é conta de pagamento, não de recebimento.';
  end if;

  insert into public.receivable_receipts (
    request_id, receivable_id, received_date, amount, method, account_id, created_by
  )
  values (
    p_request_id, p_receivable_id, p_received_date, v_amount, p_method, v_account.id, v_user_id
  )
  returning id into v_receipt_id;

  insert into public.receivable_events (receivable_id, event_type, details, created_by)
  values (
    p_receivable_id, 'baixada',
    jsonb_build_object(
      'request_id', p_request_id,
      'receipt_id', v_receipt_id,
      'received_date', p_received_date,
      'amount', v_amount,
      'method', p_method,
      'account_key', p_account_key,
      'recebido_antes', v_recebido
    ),
    v_user_id
  );

  -- O livro é alimentado na mesma transação: ou as duas coisas acontecem, ou
  -- nenhuma.
  perform private.lancar_recibo_no_livro(v_receipt_id, v_user_id);
  perform private.atualizar_situacao_receivable(p_receivable_id);

  return v_receipt_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Estornar um pedaço.
-- ---------------------------------------------------------------------------
drop function if exists public.reverse_receivable_payment(uuid, uuid, text);

create or replace function public.reverse_receivable_receipt(
  p_request_id uuid,
  p_receipt_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recibo record;
  v_user_id uuid := (select auth.uid());
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador do estorno obrigatório.';
  end if;

  if not private.current_user_can_receivables('contas_receber.estornar') then
    raise exception using errcode = '42501', message = 'Sem permissão para estornar recebimentos.';
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null or length(trim(p_reason)) < 3 then
    raise exception using errcode = '22023', message = 'Informe o motivo do estorno.';
  end if;

  select recibo.* into v_recibo
  from public.receivable_receipts recibo
  where recibo.id = p_receipt_id
  for update;
  if v_recibo.id is null then
    raise exception using errcode = 'P0002', message = 'Recebimento não encontrado.';
  end if;

  if v_recibo.reversed_at is not null then
    -- Já estornado: repetir não faz nada, para o toque duplo não estourar erro.
    return;
  end if;

  perform private.estornar_recibo_no_livro(p_receipt_id, v_user_id, trim(p_reason));

  update public.receivable_receipts
  set reversed_at = now(), reversed_by = v_user_id, reversal_reason = trim(p_reason)
  where id = p_receipt_id;

  insert into public.receivable_events (receivable_id, event_type, reason, details, created_by)
  values (
    v_recibo.receivable_id, 'estornada', trim(p_reason),
    jsonb_build_object(
      'request_id', p_request_id,
      'receipt_id', p_receipt_id,
      'amount', v_recibo.amount,
      'received_date', v_recibo.received_date
    ),
    v_user_id
  );

  perform private.atualizar_situacao_receivable(v_recibo.receivable_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Cancelar exige que nenhum dinheiro tenha entrado.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_receivable(
  p_request_id uuid,
  p_receivable_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_recebido numeric(12,2);
  v_user_id uuid := (select auth.uid());
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador do cancelamento obrigatório.';
  end if;

  if not private.current_user_can_receivables('contas_receber.cancelar') then
    raise exception using errcode = '42501', message = 'Sem permissão para cancelar cobranças.';
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null or length(trim(p_reason)) < 3 then
    raise exception using errcode = '22023', message = 'Informe o motivo do cancelamento.';
  end if;

  select cobranca.* into v_row
  from public.receivables cobranca
  where cobranca.id = p_receivable_id
  for update;
  if v_row.id is null then
    raise exception using errcode = 'P0002', message = 'Cobrança não encontrada.';
  end if;
  if v_row.status = 'cancelada' then
    return;
  end if;

  -- Dinheiro que entrou não some por cancelamento, nem quando entrou só em
  -- parte.
  v_recebido := private.receivable_recebido(p_receivable_id);
  if v_recebido > 0 then
    raise exception using errcode = '22023',
      message = 'Esta cobrança já recebeu ' || to_char(v_recebido, 'FM999999990.00')
        || '. Estorne os recebimentos antes de cancelar.';
  end if;

  update public.receivables
  set status = 'cancelada',
      cancel_reason = trim(p_reason),
      cancelled_by = v_user_id,
      cancelled_at = now()
  where id = p_receivable_id;

  insert into public.receivable_events (receivable_id, event_type, reason, details, created_by)
  values (
    p_receivable_id, 'cancelada', trim(p_reason),
    jsonb_build_object('request_id', p_request_id),
    v_user_id
  );
end;
$$;

-- Corrigir vencimento continua exigindo cobrança sem dinheiro dentro? Não:
-- vencimento de cobrança parcialmente recebida pode ser renegociado. O que
-- muda é aceitar também a situação parcial.
create or replace function public.correct_receivable_due_date(
  p_request_id uuid,
  p_receivable_id uuid,
  p_due_date date,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_user_id uuid := (select auth.uid());
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador da correção obrigatório.';
  end if;

  if not private.current_user_can_receivables('contas_receber.corrigir_vencimento') then
    raise exception using errcode = '42501', message = 'Sem permissão para corrigir vencimentos.';
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null or length(trim(p_reason)) < 3 then
    raise exception using errcode = '22023', message = 'Informe o motivo da correção.';
  end if;

  select cobranca.* into v_row
  from public.receivables cobranca
  where cobranca.id = p_receivable_id
  for update;
  if v_row.id is null then
    raise exception using errcode = 'P0002', message = 'Cobrança não encontrada.';
  end if;

  if exists (
    select 1 from public.receivable_events evento
    where evento.receivable_id = p_receivable_id
      and evento.event_type = 'vencimento_corrigido'
      and evento.details ->> 'request_id' = p_request_id::text
  ) then
    return;
  end if;

  if v_row.status not in ('aberta', 'parcial') then
    raise exception using errcode = '22023',
      message = 'Só o vencimento de uma cobrança em aberto ou parcialmente recebida pode ser corrigido.';
  end if;
  if p_due_date is null then
    raise exception using errcode = '22023', message = 'Informe o novo vencimento.';
  end if;
  if p_due_date < v_row.original_due_date then
    raise exception using errcode = '22023',
      message = 'O vencimento não pode ser antecipado para antes do prazo combinado com o cliente.';
  end if;
  if p_due_date > v_row.invoice_date + 365 then
    raise exception using errcode = '22023', message = 'Vencimento distante demais do faturamento. Confira a data.';
  end if;

  update public.receivables set due_date = p_due_date where id = p_receivable_id;

  insert into public.receivable_events (receivable_id, event_type, reason, details, created_by)
  values (
    p_receivable_id, 'vencimento_corrigido', trim(p_reason),
    jsonb_build_object('request_id', p_request_id, 'de', v_row.due_date, 'para', p_due_date),
    v_user_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS e privilégios.
-- ---------------------------------------------------------------------------
alter table public.receivable_receipts enable row level security;
alter table public.receivable_receipts force row level security;

create policy receivable_receipts_select_financeiro
on public.receivable_receipts for select to authenticated
using (private.current_user_can_receivables('contas_receber.acessar'));

grant select on public.receivable_receipts to authenticated;

revoke all on function public.record_receivable_receipt(uuid, uuid, date, numeric, text, text) from public, anon;
revoke all on function public.reverse_receivable_receipt(uuid, uuid, text) from public, anon;
grant execute on function public.record_receivable_receipt(uuid, uuid, date, numeric, text, text) to authenticated;
grant execute on function public.reverse_receivable_receipt(uuid, uuid, text) to authenticated;

commit;
