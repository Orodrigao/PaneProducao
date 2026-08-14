-- Contas a receber: a data que vale e a da padaria, nao a do servidor.
--
-- O banco raciocina em UTC e a padaria vive em America/Sao_Paulo. Entre 21h e
-- meia-noite, `current_date` no banco ja e o dia seguinte para quem esta em
-- Santa Maria. As funcoes das fases 2 e 3 usavam `current_date` cru, e a
-- consequencia grave e na competencia: um pedido enviado as 22h do dia 31
-- nascia faturado no dia 1, jogando a receita para o mes errado.
--
-- O resto do repositorio ja converte o fuso explicitamente (producao da
-- cozinha, baixa do boleto, relatorio de vencimentos). Esta migration alinha o
-- contas a receber a essa convencao.
--
-- Os corpos abaixo sao copia fiel das definicoes vigentes, com a unica
-- diferenca sendo a data: `create or replace` e sobrescrita total, nao remendo
-- (licao funcao-de-banco-redefinida-perde-melhoria-recente).

begin;

-- O dia como a padaria o conta. Recebe o instante a converter, ou usa agora.
create or replace function private.data_na_padaria(p_at timestamptz default now())
returns date
language sql
stable
security definer
set search_path = ''
as $fn$
  select (p_at at time zone 'America/Sao_Paulo')::date;
$fn$;

revoke all on function private.data_na_padaria(timestamptz) from public, anon, authenticated;
grant execute on function private.data_na_padaria(timestamptz) to authenticated;

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
           anterior.planned_amount, private.data_na_padaria(), anterior.amount,
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
  if p_invoice_date > private.data_na_padaria() then
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
  if p_received_date > private.data_na_padaria() then
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

create or replace function private.build_receivable_from_pj_order(
  p_order_group_id uuid,
  p_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receivable_id uuid;
  v_pedido record;
  v_customer record;
  v_category_id uuid;
  v_invoice_date date;
  v_due_date date;
  v_descricao text;
begin
  if p_order_group_id is null then
    raise exception using errcode = '22023', message = 'Pedido obrigatório.';
  end if;

  -- Trava o grupo: duas chamadas simultâneas (o envio e o financeiro ao mesmo
  -- tempo) entram em fila em vez de gerarem duas cobranças.
  perform 1
  from public.orders order_row
  where order_row.order_group_id = p_order_group_id
    and order_row.order_type = 'pj'
  for update;

  select count(*) as linhas,
         count(*) filter (where order_row.cancelled_at is not null) as canceladas,
         count(*) filter (where order_row.dispatched_at is not null) as enviadas,
         (array_agg(order_row.customer_id order by order_row.id))[1] as customer_id,
         count(distinct order_row.customer_id) as clientes,
         private.data_na_padaria(max(order_row.dispatched_at)) as data_envio,
         max(coalesce(order_row.delivery_date, order_row.order_date)) as data_entrega,
         sum(order_row.quantity * coalesce(order_row.unit_price, 0)) as valor
    into v_pedido
  from public.orders order_row
  where order_row.order_group_id = p_order_group_id
    and order_row.order_type = 'pj';

  if v_pedido.linhas = 0 then
    raise exception using errcode = 'P0002', message = 'Pedido PJ não encontrado.';
  end if;
  if v_pedido.canceladas > 0 then
    raise exception using errcode = '22023', message = 'Pedido cancelado não vira cobrança.';
  end if;
  if v_pedido.clientes <> 1 or v_pedido.customer_id is null then
    raise exception using errcode = '22023', message = 'Pedido sem cliente definido não vira cobrança.';
  end if;

  -- Já existe cobrança viva para este pedido: devolve a mesma. É o que faz
  -- confirmar o envio duas vezes, ou o financeiro gerar o que o envio já
  -- gerou, não criar uma segunda cobrança.
  select cobranca.id into v_receivable_id
  from public.receivables cobranca
  where cobranca.origin = 'pedido_pj'
    and cobranca.origin_ref = p_order_group_id
    and cobranca.status <> 'cancelada';
  if v_receivable_id is not null then
    return v_receivable_id;
  end if;

  if v_pedido.valor is null or v_pedido.valor <= 0 then
    raise exception using errcode = '22023',
      message = 'Pedido sem preço não vira cobrança. Confira a tabela de preço do cliente.';
  end if;

  select customer.id, customer.name, customer.payment_term_days, customer.active
    into v_customer
  from public.customers customer
  where customer.id = v_pedido.customer_id;
  if v_customer.id is null then
    raise exception using errcode = 'P0002', message = 'Cliente do pedido não encontrado.';
  end if;

  -- Sem prazo combinado não há vencimento que se possa calcular sem inventar.
  -- Devolver null em vez de falhar é deliberado: quem chama pode ser a
  -- Expedição confirmando um envio, e travar a operação por causa de um campo
  -- do financeiro é acoplamento que quebra a padaria. O pedido continua
  -- aparecendo como "a faturar" até alguém cadastrar o prazo.
  if v_customer.payment_term_days is null then
    return null;
  end if;

  -- A data do faturamento é o dia em que o pão saiu: o envio confirmado
  -- quando ele existe, a data de entrega combinada quando não existe. É ela
  -- que decide em que mês a venda pesa (decisão 10).
  v_invoice_date := least(
    coalesce(v_pedido.data_envio, v_pedido.data_entrega),
    private.data_na_padaria()
  );
  v_due_date := v_invoice_date + v_customer.payment_term_days;

  select category.id into v_category_id
  from public.finance_categories category
  where category.key = 'clientes_pj' and category.active;
  if v_category_id is null then
    raise exception using errcode = 'P0002', message = 'Categoria de receita de clientes PJ não encontrada.';
  end if;

  v_descricao := 'Pedido de ' || to_char(v_pedido.data_entrega, 'DD/MM/YYYY');

  insert into public.receivables (
    request_id, customer_id, origin, origin_ref, finance_category_id, description,
    invoice_date, original_due_date, due_date, amount, created_by
  )
  values (
    gen_random_uuid(), v_customer.id, 'pedido_pj', p_order_group_id, v_category_id, v_descricao,
    v_invoice_date, v_due_date, v_due_date, round(v_pedido.valor, 2), p_user_id
  )
  returning id into v_receivable_id;

  insert into public.receivable_events (receivable_id, event_type, details, created_by)
  values (
    v_receivable_id, 'lancada',
    jsonb_build_object(
      'origin', 'pedido_pj',
      'order_group_id', p_order_group_id,
      'amount', round(v_pedido.valor, 2),
      'due_date', v_due_date,
      'dispatched', v_pedido.enviadas > 0
    ),
    p_user_id
  );

  return v_receivable_id;
end;
$$;

create or replace function public.list_pj_orders_to_bill()
returns table (
  order_group_id uuid,
  customer_id uuid,
  customer_name text,
  payment_term_days integer,
  delivery_date date,
  dispatched_at timestamptz,
  items integer,
  amount numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select pedido.order_group_id,
         pedido.customer_id,
         customer.name,
         customer.payment_term_days,
         pedido.delivery_date,
         pedido.dispatched_at,
         pedido.items,
         pedido.amount
  from (
    select order_row.order_group_id,
           (array_agg(order_row.customer_id order by order_row.id))[1] as customer_id,
           max(coalesce(order_row.delivery_date, order_row.order_date)) as delivery_date,
           max(order_row.dispatched_at) as dispatched_at,
           count(*)::int as items,
           round(sum(order_row.quantity * coalesce(order_row.unit_price, 0)), 2) as amount
    from public.orders order_row
    where order_row.order_type = 'pj'
      and order_row.cancelled_at is null
      and order_row.order_group_id is not null
    group by order_row.order_group_id
  ) pedido
  join public.customers customer on customer.id = pedido.customer_id
  where private.current_user_can_receivables('contas_receber.acessar')
    -- Entregue: o envio confirmado quando existe; senão, o dia combinado de
    -- entrega já ter passado. A segunda metade é dedução de calendário, e é
    -- por isso que quem confirma é a Elis, não o sistema
    -- (lição `status-deduzido-de-data-nao-e-fato`).
    and (pedido.dispatched_at is not null or pedido.delivery_date <= private.data_na_padaria())
    and pedido.amount > 0
    and not exists (
      select 1 from public.receivables cobranca
      where cobranca.origin = 'pedido_pj'
        and cobranca.origin_ref = pedido.order_group_id
        and cobranca.status <> 'cancelada'
    )
  order by pedido.delivery_date, customer.name;
$$;

commit;
