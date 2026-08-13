-- Contas a receber, fase 2: a cobrança e o lançamento avulso.
--
-- Plano: docs/CONTAS_A_RECEBER.md. Esta fase cria a cobrança, a baixa, o
-- estorno, o cancelamento e a correção de vencimento — tudo digitado à mão.
-- As origens automáticas (pedido PJ na fase 3, romaneio da Buck na fase 4)
-- entram depois e reaproveitam as mesmas tabelas e a mesma ponte com o livro.
--
-- O molde é o do livro-caixa (20260812115945), não o do contas a pagar de
-- agosto: portas fechadas por padrão, permissão conferida em `private`,
-- registro imutável e idempotência por request_id.
--
-- Decisão 10 do plano: a baixa escreve no livro-caixa na mesma transação, na
-- categoria de receita da cobrança, com competência no mês do faturamento —
-- não no mês em que o dinheiro entrou.

begin;

-- ---------------------------------------------------------------------------
-- Permissões.
-- ---------------------------------------------------------------------------
insert into public.app_permissions (key, module, label, description, sort_order)
values
  ('contas_receber.acessar', 'Financeiro', 'Contas a receber', 'Consultar quem deve, quanto e quando vence.', 330),
  ('contas_receber.lancar', 'Financeiro', 'Lançar cobrança', 'Registrar uma cobrança avulsa de cliente.', 331),
  ('contas_receber.baixar', 'Financeiro', 'Baixar cobrança', 'Registrar o recebimento de uma cobrança.', 332),
  ('contas_receber.estornar', 'Financeiro', 'Estornar recebimento', 'Desfazer uma baixa errada, com motivo.', 333),
  ('contas_receber.cancelar', 'Financeiro', 'Cancelar cobrança', 'Cancelar uma cobrança ainda não recebida.', 334),
  ('contas_receber.corrigir_vencimento', 'Financeiro', 'Corrigir vencimento', 'Alterar o vencimento combinado de uma cobrança.', 335)
on conflict (key) do update set
  module = excluded.module,
  label = excluded.label,
  description = excluded.description,
  sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- A cobrança.
-- ---------------------------------------------------------------------------
-- Três datas, três papéis distintos (decisão 10):
--   * invoice_date  — quando o pão saiu. Manda no resultado do mês.
--   * due_date      — quando o cliente deveria pagar. Manda na lista de atrasados.
--   * received_date — quando o dinheiro caiu. Manda no saldo da conta.
create table if not exists public.receivables (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  customer_id uuid not null references public.customers(id),
  -- Nesta fase só 'avulso'. As fases 3 e 4 acrescentam 'pedido_pj' e
  -- 'romaneio_ex', junto do origin_ref que aponta para o registro de origem.
  origin text not null default 'avulso' check (origin in ('avulso')),
  origin_ref uuid,
  -- Onde a receita cai no DRE. Avulso e pedido PJ vão para 'Clientes PJ';
  -- a fase 4 usa 'Buck (EX)'.
  finance_category_id uuid not null references public.finance_categories(id),
  description text not null check (length(trim(description)) >= 3),
  invoice_date date not null,
  original_due_date date not null,
  due_date date not null,
  amount numeric(12,2) not null check (amount > 0 and amount <= 1000000),
  status text not null default 'aberta' check (status in ('aberta', 'recebida', 'cancelada')),
  received_date date,
  -- Pode ser diferente do valor cobrado: a diferença é juro, multa ou
  -- desconto. Pagamento parcial não existe — a cobrança é quitada inteira.
  received_amount numeric(12,2) check (received_amount > 0 and received_amount <= 1000000),
  received_method text check (received_method in ('dinheiro', 'pix', 'transferencia', 'boleto', 'cartao', 'outro')),
  received_account_id uuid references public.finance_accounts(id),
  received_by uuid references auth.users(id),
  received_at timestamptz,
  cancel_reason text,
  cancelled_by uuid references auth.users(id),
  cancelled_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  -- Recebida exige o fato completo; aberta e cancelada não podem carregar
  -- resquício de recebimento (é o que o estorno precisa limpar de verdade).
  constraint receivables_received_shape check (
    (status = 'recebida') = (received_date is not null)
    and (received_date is null) = (received_amount is null)
    and (received_date is null) = (received_method is null)
    and (received_date is null) = (received_at is null)
  ),
  constraint receivables_cancel_shape check (
    (status = 'cancelada') = (cancelled_at is not null)
    and (cancelled_at is null or nullif(trim(coalesce(cancel_reason, '')), '') is not null)
  ),
  constraint receivables_due_after_invoice check (due_date >= invoice_date),
  -- O vencimento só pode ser empurrado para frente: antecipar cobrança já
  -- combinada não é correção, é mudança de acordo.
  constraint receivables_due_never_earlier check (due_date >= original_due_date)
);

comment on table public.receivables is
  'Cobranças de clientes PJ. Escrita somente pelas funções protegidas deste módulo.';

create index if not exists receivables_status_due_idx
  on public.receivables (status, due_date);
create index if not exists receivables_customer_idx
  on public.receivables (customer_id, invoice_date desc);
create index if not exists receivables_invoice_idx
  on public.receivables (invoice_date desc, created_at desc);
-- Uma cobrança viva por origem automática: é o que impede a fase 3 de gerar
-- duas cobranças para o mesmo pedido.
create unique index if not exists receivables_origem_viva_idx
  on public.receivables (origin, origin_ref)
  where origin_ref is not null and status <> 'cancelada';

-- ---------------------------------------------------------------------------
-- A trilha: quem fez o quê, quando e por quê.
-- ---------------------------------------------------------------------------
create table if not exists public.receivable_events (
  id uuid primary key default gen_random_uuid(),
  receivable_id uuid not null references public.receivables(id) on delete cascade,
  event_type text not null check (event_type in ('lancada', 'baixada', 'estornada', 'cancelada', 'vencimento_corrigido')),
  reason text,
  details jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists receivable_events_receivable_idx
  on public.receivable_events (receivable_id, created_at);

-- ---------------------------------------------------------------------------
-- Privilégios: nada de escrita direta. Toda gravação passa pelas funções.
-- ---------------------------------------------------------------------------
revoke all on table public.receivables from anon, authenticated;
revoke all on table public.receivable_events from anon, authenticated;

-- Mesmo escopo do contas a pagar: a operação PJ é da JC.
create or replace function private.current_user_can_receivables(p_permission text)
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
      and (
        profile.role = 'admin'
        or exists (
          select 1
          from public.app_user_permissions assignment
          where assignment.user_id = profile.user_id
            and assignment.permission_key = p_permission
            and assignment.scope in ('*', 'jc')
        )
      )
  );
$$;

revoke all on function private.current_user_can_receivables(text) from public, anon, authenticated;
grant execute on function private.current_user_can_receivables(text) to authenticated;

-- Perfis financeiros ativos já nascem com as seis permissões no escopo global.
insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
select profile.user_id, permission.key, '*', null::uuid
from public.app_profiles profile
cross join public.app_permissions permission
where profile.active
  and profile.role = 'financeiro'
  and permission.key in (
    'contas_receber.acessar', 'contas_receber.lancar', 'contas_receber.baixar',
    'contas_receber.estornar', 'contas_receber.cancelar', 'contas_receber.corrigir_vencimento'
  )
on conflict (user_id, permission_key, scope) do nothing;

-- ---------------------------------------------------------------------------
-- O livro passa a aceitar a receita vinda das cobranças.
-- ---------------------------------------------------------------------------
alter table public.finance_entries
  drop constraint if exists finance_entries_source_check;

alter table public.finance_entries
  add constraint finance_entries_source_check
    check (source in ('avulso', 'contas_pagar', 'recorrencia', 'transferencia', 'contas_receber'));

-- ---------------------------------------------------------------------------
-- Ponte com o livro-caixa.
-- ---------------------------------------------------------------------------
-- Espelha private.sync_payable_finance_entries: o lançamento nunca é apagado
-- nem alterado; corrigir é estornar e relançar. Chamada dentro da mesma
-- transação da baixa — ou as duas coisas acontecem, ou nenhuma.
create or replace function private.sync_receivable_finance_entry(
  p_receivable_id uuid,
  p_user_id uuid,
  p_motivo_estorno text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_competencia date;
  v_descricao text;
begin
  select cobranca.id,
         cobranca.finance_category_id,
         cobranca.description,
         cobranca.invoice_date,
         cobranca.due_date,
         cobranca.amount,
         cobranca.received_date,
         cobranca.received_amount,
         cobranca.received_method,
         cobranca.received_account_id,
         customer.name as cliente
    into v_row
  from public.receivables cobranca
  join public.customers customer on customer.id = cobranca.customer_id
  where cobranca.id = p_receivable_id;

  if v_row.id is null then
    return;
  end if;

  -- Estorno: nasce o contra-lançamento e o original é marcado como estornado.
  if p_motivo_estorno is not null then
    insert into public.finance_entries (
      request_id, entry_type, category_id, account_id, store, competence_month,
      due_date, planned_amount, paid_date, amount, payment_method, description,
      source, source_ref, reversal_of, reversal_reason, created_by
    )
    select gen_random_uuid(), 'estorno', anterior.category_id, anterior.account_id,
           anterior.store, anterior.competence_month, anterior.due_date,
           anterior.planned_amount, current_date, anterior.amount,
           anterior.payment_method, 'Estorno de: ' || anterior.description,
           anterior.source, anterior.source_ref, anterior.id, p_motivo_estorno,
           p_user_id
    from public.finance_entries anterior
    where anterior.source = 'contas_receber'
      and anterior.source_ref = p_receivable_id
      and anterior.entry_type = 'lancamento'
      and anterior.reversed_at is null;

    update public.finance_entries
    set reversed_at = now(),
        reversed_by = p_user_id,
        reversal_reason = p_motivo_estorno
    where source = 'contas_receber'
      and source_ref = p_receivable_id
      and entry_type = 'lancamento'
      and reversed_at is null;

    return;
  end if;

  if v_row.received_date is null or v_row.received_amount is null then
    return;
  end if;

  -- Já existe lançamento ativo para esta cobrança: nada a fazer (idempotência
  -- contra toque duplo e contra chamadas simultâneas).
  if exists (
    select 1 from public.finance_entries existente
    where existente.source = 'contas_receber'
      and existente.source_ref = p_receivable_id
      and existente.entry_type = 'lancamento'
      and existente.reversed_at is null
  ) then
    return;
  end if;

  -- Competência no mês do faturamento, não no do recebimento: é o espelho da
  -- regra da despesa (decisão 6 de docs/FINANCEIRO.md).
  v_competencia := date_trunc('month', v_row.invoice_date)::date;
  v_descricao := coalesce(nullif(trim(v_row.cliente), ''), 'Cliente') || ' · ' || v_row.description;

  insert into public.finance_entries (
    request_id, entry_type, category_id, account_id, store, competence_month,
    due_date, planned_amount, paid_date, amount, payment_method, description,
    source, source_ref, created_by
  )
  values (
    gen_random_uuid(), 'lancamento', v_row.finance_category_id, v_row.received_account_id,
    -- A operação PJ é produzida na JC, como o contas a pagar já assume.
    'jc', v_competencia, v_row.due_date,
    -- Previsto é o que foi cobrado; realizado é o que entrou. A diferença é
    -- juro, multa ou desconto, e fica visível no livro.
    v_row.amount, v_row.received_date, v_row.received_amount,
    coalesce(v_row.received_method, 'outro'), v_descricao,
    'contas_receber', p_receivable_id, p_user_id
  );
end;
$$;

revoke all on function private.sync_receivable_finance_entry(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Lançar cobrança avulsa.
-- ---------------------------------------------------------------------------
create or replace function public.create_manual_receivable(
  p_request_id uuid,
  p_customer_id uuid,
  p_invoice_date date,
  p_amount numeric,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receivable_id uuid;
  v_customer record;
  v_category_id uuid;
  v_amount numeric(12,2);
  v_due_date date;
  v_user_id uuid := (select auth.uid());
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador da cobrança obrigatório.';
  end if;

  -- Idempotência: repetir a mesma requisição devolve a mesma cobrança.
  select existing.id into v_receivable_id
  from public.receivables existing
  where existing.request_id = p_request_id;
  if v_receivable_id is not null then
    return v_receivable_id;
  end if;

  if not private.current_user_can_receivables('contas_receber.lancar') then
    raise exception using errcode = '42501', message = 'Sem permissão para lançar cobranças.';
  end if;

  select customer.id, customer.name, customer.payment_term_days, customer.active
    into v_customer
  from public.customers customer
  where customer.id = p_customer_id;
  if v_customer.id is null then
    raise exception using errcode = 'P0002', message = 'Cliente não encontrado.';
  end if;
  if not v_customer.active then
    raise exception using errcode = '22023', message = 'Cliente inativo não recebe cobrança nova.';
  end if;
  -- Anunciado na migration da fase 1: sem prazo combinado, não há vencimento
  -- que se possa calcular sem inventar.
  if v_customer.payment_term_days is null then
    raise exception using errcode = '22023',
      message = 'Este cliente ainda não tem prazo de pagamento cadastrado. Defina o prazo na tela de Clientes antes de cobrar.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception using errcode = '22023', message = 'Informe um valor maior que zero.';
  end if;
  v_amount := round(p_amount, 2);
  if v_amount > 1000000 then
    raise exception using errcode = '22023', message = 'Valor acima do limite permitido. Confira o que foi digitado.';
  end if;

  if p_invoice_date is null then
    raise exception using errcode = '22023', message = 'Informe a data do faturamento.';
  end if;
  if p_invoice_date > current_date then
    raise exception using errcode = '22023', message = 'A data do faturamento não pode ser no futuro.';
  end if;
  if p_invoice_date < date '2020-01-01' then
    raise exception using errcode = '22023', message = 'Data do faturamento muito antiga. Confira o que foi digitado.';
  end if;

  if nullif(trim(coalesce(p_description, '')), '') is null or length(trim(p_description)) < 3 then
    raise exception using errcode = '22023', message = 'Descreva a cobrança com pelo menos 3 letras.';
  end if;

  select category.id into v_category_id
  from public.finance_categories category
  where category.key = 'clientes_pj' and category.active;
  if v_category_id is null then
    raise exception using errcode = 'P0002', message = 'Categoria de receita de clientes PJ não encontrada.';
  end if;

  v_due_date := p_invoice_date + v_customer.payment_term_days;

  insert into public.receivables (
    request_id, customer_id, origin, finance_category_id, description,
    invoice_date, original_due_date, due_date, amount, created_by
  )
  values (
    p_request_id, p_customer_id, 'avulso', v_category_id, trim(p_description),
    p_invoice_date, v_due_date, v_due_date, v_amount, v_user_id
  )
  returning id into v_receivable_id;

  insert into public.receivable_events (receivable_id, event_type, details, created_by)
  values (
    v_receivable_id, 'lancada',
    jsonb_build_object('amount', v_amount, 'due_date', v_due_date, 'origin', 'avulso'),
    v_user_id
  );

  return v_receivable_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Baixar: registrar que o dinheiro entrou.
-- ---------------------------------------------------------------------------
-- Confere somente contas_receber.baixar. O lançamento no livro nasce por
-- dentro desta ação, sem exigir financeiro.lancar de quem dá a baixa — é o
-- mesmo desenho de record_payable_installment_payment.
create or replace function public.record_receivable_payment(
  p_request_id uuid,
  p_receivable_id uuid,
  p_received_date date,
  p_received_amount numeric,
  p_received_method text,
  p_account_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_account record;
  v_amount numeric(12,2);
  v_user_id uuid := (select auth.uid());
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador da baixa obrigatório.';
  end if;

  if not private.current_user_can_receivables('contas_receber.baixar') then
    raise exception using errcode = '42501', message = 'Sem permissão para baixar cobranças.';
  end if;

  select cobranca.* into v_row
  from public.receivables cobranca
  where cobranca.id = p_receivable_id
  for update;
  if v_row.id is null then
    raise exception using errcode = 'P0002', message = 'Cobrança não encontrada.';
  end if;

  -- Idempotência contra toque duplo: a mesma requisição já registrada nesta
  -- cobrança não faz nada de novo.
  if exists (
    select 1 from public.receivable_events evento
    where evento.receivable_id = p_receivable_id
      and evento.event_type = 'baixada'
      and evento.details ->> 'request_id' = p_request_id::text
  ) then
    return;
  end if;

  if v_row.status = 'cancelada' then
    raise exception using errcode = '22023', message = 'Cobrança cancelada não pode ser baixada.';
  end if;
  if v_row.status = 'recebida' then
    raise exception using errcode = '22023', message = 'Esta cobrança já foi recebida. Estorne a baixa antes de registrar outra.';
  end if;

  if p_received_date is null then
    raise exception using errcode = '22023', message = 'Informe a data em que o dinheiro entrou.';
  end if;
  if p_received_date > current_date then
    raise exception using errcode = '22023', message = 'A data do recebimento não pode ser no futuro.';
  end if;
  if p_received_date < v_row.invoice_date then
    raise exception using errcode = '22023', message = 'O recebimento não pode ser anterior ao faturamento.';
  end if;

  if p_received_amount is null or p_received_amount <= 0 then
    raise exception using errcode = '22023', message = 'Informe o valor recebido.';
  end if;
  v_amount := round(p_received_amount, 2);
  if v_amount > 1000000 then
    raise exception using errcode = '22023', message = 'Valor acima do limite permitido. Confira o que foi digitado.';
  end if;

  if p_received_method is null or p_received_method not in
     ('dinheiro', 'pix', 'transferencia', 'boleto', 'cartao', 'outro') then
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

  update public.receivables
  set status = 'recebida',
      received_date = p_received_date,
      received_amount = v_amount,
      received_method = p_received_method,
      received_account_id = v_account.id,
      received_by = v_user_id,
      received_at = now()
  where id = p_receivable_id;

  insert into public.receivable_events (receivable_id, event_type, details, created_by)
  values (
    p_receivable_id, 'baixada',
    jsonb_build_object(
      'request_id', p_request_id,
      'received_date', p_received_date,
      'received_amount', v_amount,
      'received_method', p_received_method,
      'account_key', p_account_key
    ),
    v_user_id
  );

  -- O livro é alimentado pela mesma transação da baixa: ou as duas coisas
  -- acontecem, ou nenhuma.
  perform private.sync_receivable_finance_entry(p_receivable_id, v_user_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Estornar a baixa.
-- ---------------------------------------------------------------------------
create or replace function public.reverse_receivable_payment(
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
      and evento.event_type = 'estornada'
      and evento.details ->> 'request_id' = p_request_id::text
  ) then
    return;
  end if;

  if v_row.status <> 'recebida' then
    raise exception using errcode = '22023', message = 'Só é possível estornar uma cobrança já recebida.';
  end if;

  -- O contra-lançamento no livro nasce antes de a cobrança perder os dados do
  -- recebimento — a ponte lê a linha para montar o estorno.
  perform private.sync_receivable_finance_entry(p_receivable_id, v_user_id, trim(p_reason));

  update public.receivables
  set status = 'aberta',
      received_date = null,
      received_amount = null,
      received_method = null,
      received_account_id = null,
      received_by = null,
      received_at = null
  where id = p_receivable_id;

  insert into public.receivable_events (receivable_id, event_type, reason, details, created_by)
  values (
    p_receivable_id, 'estornada', trim(p_reason),
    jsonb_build_object(
      'request_id', p_request_id,
      'received_date', v_row.received_date,
      'received_amount', v_row.received_amount
    ),
    v_user_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Cancelar a cobrança.
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
  -- Dinheiro que entrou não some por cancelamento: primeiro estorna a baixa.
  if v_row.status = 'recebida' then
    raise exception using errcode = '22023',
      message = 'Cobrança já recebida não pode ser cancelada. Estorne a baixa antes.';
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

-- ---------------------------------------------------------------------------
-- Corrigir o vencimento.
-- ---------------------------------------------------------------------------
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

  if v_row.status <> 'aberta' then
    raise exception using errcode = '22023', message = 'Só o vencimento de uma cobrança em aberto pode ser corrigido.';
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

  update public.receivables
  set due_date = p_due_date
  where id = p_receivable_id;

  insert into public.receivable_events (receivable_id, event_type, reason, details, created_by)
  values (
    p_receivable_id, 'vencimento_corrigido', trim(p_reason),
    jsonb_build_object('request_id', p_request_id, 'de', v_row.due_date, 'para', p_due_date),
    v_user_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: leitura por permissão; escrita nenhuma (só pelas funções acima).
-- ---------------------------------------------------------------------------
alter table public.receivables enable row level security;
alter table public.receivables force row level security;
alter table public.receivable_events enable row level security;
alter table public.receivable_events force row level security;

create policy receivables_select_financeiro
on public.receivables for select to authenticated
using (private.current_user_can_receivables('contas_receber.acessar'));

-- Policy própria na tabela filha: a visibilidade do evento não pode depender
-- da visibilidade da cobrança (item 9 do gate técnico do plano).
create policy receivable_events_select_financeiro
on public.receivable_events for select to authenticated
using (private.current_user_can_receivables('contas_receber.acessar'));

grant select on public.receivables to authenticated;
grant select on public.receivable_events to authenticated;

revoke all on function public.create_manual_receivable(uuid, uuid, date, numeric, text) from public, anon;
revoke all on function public.record_receivable_payment(uuid, uuid, date, numeric, text, text) from public, anon;
revoke all on function public.reverse_receivable_payment(uuid, uuid, text) from public, anon;
revoke all on function public.cancel_receivable(uuid, uuid, text) from public, anon;
revoke all on function public.correct_receivable_due_date(uuid, uuid, date, text) from public, anon;

grant execute on function public.create_manual_receivable(uuid, uuid, date, numeric, text) to authenticated;
grant execute on function public.record_receivable_payment(uuid, uuid, date, numeric, text, text) to authenticated;
grant execute on function public.reverse_receivable_payment(uuid, uuid, text) to authenticated;
grant execute on function public.cancel_receivable(uuid, uuid, text) to authenticated;
grant execute on function public.correct_receivable_due_date(uuid, uuid, date, text) to authenticated;

commit;
