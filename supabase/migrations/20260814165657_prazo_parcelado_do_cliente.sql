-- Contas a receber: o cliente passa a ter um PLANO de prazos, e cada prazo
-- vira uma cobranca propria.
--
-- Motivo operacional (Rodrigo, 2026-08-14): ha clientes que pagam a fatura em
-- tres vezes — 7, 14 e 21 dias. O cadastro guardava um prazo so, entao a Elis
-- nao tinha como registrar o acordo real.
--
-- Decisoes: cada parcela e uma cobranca separada, porque e assim que se cobra
-- (liga-se por causa da parcela vencida, nao da fatura inteira); e o valor
-- divide em partes iguais, com os centavos que sobram na primeira.
--
-- Producao segue com zero cobrancas, entao nada a migrar do lado do dinheiro.
-- O cadastro tem 34 clientes ativos, 30 com prazo unico — todos viram um plano
-- de uma parcela so, sem mudanca de comportamento.
--
-- `payment_term_days` continua existindo e sincronizada por gatilho: a
-- migration entra enquanto a versao antiga do site ainda esta no ar e le essa
-- coluna. Remove-la e tarefa de um PR seguinte (mudanca destrutiva em duas
-- fases, regra do AGENTS.md).

begin;

-- ---------------------------------------------------------------------------
-- O plano de prazos do cliente.
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists payment_terms integer[];

comment on column public.customers.payment_terms is
  'Plano de prazos em dias corridos, contados da entrega. {0} = a vista; {7,14,21} = tres parcelas. NULL = ainda nao combinado.';

update public.customers
set payment_terms = array[payment_term_days]
where payment_terms is null and payment_term_days is not null;

alter table public.customers
  drop constraint if exists customers_payment_terms_check;

alter table public.customers
  add constraint customers_payment_terms_check check (
    payment_terms is null
    or (
      array_length(payment_terms, 1) between 1 and 12
      -- Nenhum prazo negativo nem absurdo, e nada repetido ou fora de ordem:
      -- duas parcelas no mesmo dia sao uma parcela so.
      and payment_terms = (select array_agg(distinct dia order by dia) from unnest(payment_terms) as dia)
      and (select bool_and(dia >= 0 and dia <= 180) from unnest(payment_terms) as dia)
    )
  );

-- Mantem as duas colunas de acordo, nos DOIS sentidos. A migration entra
-- enquanto a versao anterior do site ainda esta no ar, e essa versao grava
-- `payment_term_days` ao editar um cliente: sincronizar so num sentido
-- deixaria o plano desatualizado no dia seguinte, em silencio.
create or replace function private.sincronizar_prazo_legado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT' then
    if new.payment_terms is null and new.payment_term_days is not null then
      new.payment_terms := array[new.payment_term_days];
    end if;
    new.payment_term_days := new.payment_terms[1];
    return new;
  end if;

  -- Quem mexeu manda: o plano vence quando foi ele que mudou, e a coluna
  -- antiga vence quando a mudanca veio do site velho.
  if new.payment_terms is distinct from old.payment_terms then
    new.payment_term_days := new.payment_terms[1];
  elsif new.payment_term_days is distinct from old.payment_term_days then
    new.payment_terms := case
      when new.payment_term_days is null then null
      else array[new.payment_term_days]
    end;
  end if;

  return new;
end;
$fn$;

revoke all on function private.sincronizar_prazo_legado() from public, anon, authenticated;

drop trigger if exists sincronizar_prazo_legado on public.customers;
create trigger sincronizar_prazo_legado
before insert or update on public.customers
for each row execute function private.sincronizar_prazo_legado();

-- ---------------------------------------------------------------------------
-- A cobranca sabe qual parcela ela e.
-- ---------------------------------------------------------------------------
alter table public.receivables
  add column if not exists installment_number integer not null default 1,
  add column if not exists installment_count integer not null default 1;

alter table public.receivables
  drop constraint if exists receivables_installment_shape;

alter table public.receivables
  add constraint receivables_installment_shape check (
    installment_number >= 1
    and installment_count >= 1
    and installment_number <= installment_count
  );

-- A trava de origem passa a considerar a parcela: um pedido gera N cobrancas
-- vivas, uma por prazo, e nao mais uma so.
drop index if exists public.receivables_origem_viva_idx;
create unique index if not exists receivables_origem_viva_idx
  on public.receivables (origin, origin_ref, installment_number)
  where origin_ref is not null and status <> 'cancelada';

-- ---------------------------------------------------------------------------
-- O emissor: transforma um valor no conjunto de cobrancas do plano.
-- ---------------------------------------------------------------------------
-- Devolve o id da PRIMEIRA parcela. Chamado pelas tres origens, para que o
-- parcelamento nao dependa de por onde a cobranca nasceu.
create or replace function private.emitir_cobrancas(
  p_request_id uuid,
  p_customer_id uuid,
  p_origin text,
  p_origin_ref uuid,
  p_category_id uuid,
  p_description text,
  p_invoice_date date,
  p_total numeric,
  p_user_id uuid,
  p_period_start date default null,
  p_period_end date default null,
  p_extra_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_prazos integer[];
  v_parcelas integer;
  v_base numeric(12,2);
  v_resto numeric(12,2);
  v_valor numeric(12,2);
  v_vencimento date;
  v_descricao text;
  v_id uuid;
  v_primeiro uuid;
  i integer;
begin
  select customer.payment_terms into v_prazos
  from public.customers customer
  where customer.id = p_customer_id;

  if coalesce(array_length(v_prazos, 1), 0) = 0 then
    raise exception using errcode = '22023',
      message = 'Este cliente ainda não tem prazo de pagamento cadastrado. Defina o prazo na tela de Clientes antes de cobrar.';
  end if;

  v_parcelas := array_length(v_prazos, 1);

  -- Valor pequeno demais para dividir vira parcela unica: e melhor uma
  -- cobranca certa do que tres de um centavo.
  if p_total < v_parcelas * 0.01 then
    v_parcelas := 1;
  end if;

  v_base := trunc(p_total / v_parcelas, 2);
  v_resto := round(p_total - (v_base * v_parcelas), 2);

  for i in 1 .. v_parcelas loop
    -- Os centavos que sobram vao na primeira, para as demais ficarem redondas.
    v_valor := v_base + case when i = 1 then v_resto else 0 end;
    v_vencimento := p_invoice_date + v_prazos[i];
    v_descricao := p_description
      || case when v_parcelas > 1 then ' · parcela ' || i || '/' || v_parcelas else '' end;

    insert into public.receivables (
      request_id, customer_id, origin, origin_ref, finance_category_id, description,
      invoice_date, original_due_date, due_date, amount,
      installment_number, installment_count, period_start, period_end, created_by
    )
    values (
      case when i = 1 then p_request_id else gen_random_uuid() end,
      p_customer_id, p_origin, p_origin_ref, p_category_id, v_descricao,
      p_invoice_date, v_vencimento, v_vencimento, v_valor,
      i, v_parcelas, p_period_start, p_period_end, p_user_id
    )
    returning id into v_id;

    if i = 1 then v_primeiro := v_id; end if;

    insert into public.receivable_events (receivable_id, event_type, details, created_by)
    values (
      v_id, 'lancada',
      p_extra_details || jsonb_build_object(
        'origin', p_origin,
        'amount', v_valor,
        'due_date', v_vencimento,
        'parcela', i,
        'parcelas', v_parcelas
      ),
      p_user_id
    );
  end loop;

  return v_primeiro;
end;
$fn$;

revoke all on function private.emitir_cobrancas(uuid, uuid, text, uuid, uuid, text, date, numeric, uuid, date, date, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- As tres origens passam a emitir pelo plano.
-- ---------------------------------------------------------------------------
-- Corpos copiados das definicoes vigentes; a unica diferenca e a emissao.

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

  select customer.id, customer.name, customer.payment_terms, customer.active
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
  if coalesce(array_length(v_customer.payment_terms, 1), 0) = 0 then
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

  -- O plano do cliente decide quantas cobrancas nascem: prazo 7/14/21 vira
  -- tres, cada uma com sua parte e seu vencimento.
  return private.emitir_cobrancas(
    p_request_id, p_customer_id, 'avulso', null, v_category_id,
    trim(p_description), p_invoice_date, v_amount, v_user_id
  );
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

  select customer.id, customer.name, customer.payment_terms, customer.active
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
  if coalesce(array_length(v_customer.payment_terms, 1), 0) = 0 then
    return null;
  end if;

  -- A data do faturamento é o dia em que o pão saiu: o envio confirmado
  -- quando ele existe, a data de entrega combinada quando não existe. É ela
  -- que decide em que mês a venda pesa (decisão 10).
  v_invoice_date := least(
    coalesce(v_pedido.data_envio, v_pedido.data_entrega),
    private.data_na_padaria()
  );
  select category.id into v_category_id
  from public.finance_categories category
  where category.key = 'clientes_pj' and category.active;
  if v_category_id is null then
    raise exception using errcode = 'P0002', message = 'Categoria de receita de clientes PJ não encontrada.';
  end if;

  v_descricao := 'Pedido de ' || to_char(v_pedido.data_entrega, 'DD/MM/YYYY');

  -- Uma cobranca por prazo do cliente. O identificador devolvido e o da
  -- primeira parcela, que e o que a trava de origem procura.
  v_receivable_id := private.emitir_cobrancas(
    gen_random_uuid(), v_customer.id, 'pedido_pj', p_order_group_id, v_category_id,
    v_descricao, v_invoice_date, round(v_pedido.valor, 2), p_user_id,
    null, null,
    jsonb_build_object('order_group_id', p_order_group_id, 'dispatched', v_pedido.enviadas > 0)
  );

  return v_receivable_id;
end;
$$;

create or replace function public.create_receivable_from_romaneio(
  p_request_id uuid,
  p_de date,
  p_ate date,
  p_total_conferencia numeric default null
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
  v_total numeric(12,2);
  v_problemas text[];
  v_linhas integer;
  v_user_id uuid := (select auth.uid());
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador da cobrança obrigatório.';
  end if;

  if not private.current_user_can_receivables('contas_receber.lancar') then
    raise exception using errcode = '42501', message = 'Sem permissão para lançar cobranças.';
  end if;

  select existing.id into v_receivable_id
  from public.receivables existing
  where existing.request_id = p_request_id;
  if v_receivable_id is not null then
    return v_receivable_id;
  end if;

  if p_de is null or p_ate is null or p_ate < p_de then
    raise exception using errcode = '22023', message = 'Informe um período válido.';
  end if;
  if p_ate > private.data_na_padaria() then
    raise exception using errcode = '22023', message = 'O período não pode terminar no futuro.';
  end if;

  select count(*)::int, coalesce(sum(linha.total), 0)
    into v_linhas, v_total
  from private.calcular_cobranca_buck(p_de, p_ate) linha;

  -- Os problemas vêm numa consulta própria: desdobrar o array na mesma
  -- agregação multiplicaria as linhas com mais de um problema e estragaria a
  -- contagem.
  select coalesce(array_agg(distinct problema), array[]::text[])
    into v_problemas
  from private.calcular_cobranca_buck(p_de, p_ate) linha,
       unnest(linha.problemas) as problema;

  if v_linhas = 0 then
    raise exception using errcode = '22023', message = 'Nenhum romaneio da EX neste período.';
  end if;

  -- As mesmas travas que já impedem a impressão do documento.
  if 'missing_price' = any(v_problemas) then
    raise exception using errcode = '22023',
      message = 'Há produto sem preço na tabela BUCK neste período. Cadastre o preço antes de cobrar.';
  end if;
  if 'unit_mismatch' = any(v_problemas) then
    raise exception using errcode = '22023',
      message = 'Há produto com unidade incompatível entre o nome e a tabela BUCK. Corrija antes de cobrar.';
  end if;
  if 'suspicious_quantity' = any(v_problemas) then
    raise exception using errcode = '22023',
      message = 'Há quantidade suspeita por peso neste período (acima de 10 kg num romaneio). Confira o lançamento antes de cobrar.';
  end if;

  if v_total is null or v_total <= 0 then
    raise exception using errcode = '22023', message = 'O período fechou em zero. Não há o que cobrar.';
  end if;

  -- O total da tela é conferido, nunca aceito.
  if p_total_conferencia is not null and round(p_total_conferencia, 2) <> v_total then
    raise exception using errcode = '22023',
      message = 'A tela mostrou ' || to_char(round(p_total_conferencia, 2), 'FM999999990.00')
        || ' e o banco calculou ' || to_char(v_total, 'FM999999990.00')
        || '. Nada foi cobrado. Atualize a tela e confira o período.';
  end if;

  select customer.id, customer.name, customer.payment_terms
    into v_customer
  from public.customers customer
  where lower(trim(customer.name)) = 'buck' and customer.active
  limit 1;
  if v_customer.id is null then
    raise exception using errcode = 'P0002', message = 'Cliente Buck não encontrado no cadastro.';
  end if;
  if coalesce(array_length(v_customer.payment_terms, 1), 0) = 0 then
    raise exception using errcode = '22023',
      message = 'A Buck ainda não tem prazo de pagamento cadastrado. Defina o prazo na tela de Clientes antes de cobrar.';
  end if;

  select category.id into v_category_id
  from public.finance_categories category
  where category.key = 'buck_ex' and category.active;
  if v_category_id is null then
    raise exception using errcode = 'P0002', message = 'Categoria de receita da Buck não encontrada.';
  end if;

  -- A data do faturamento e o ultimo dia do periodo: semana que atravessa a
  -- virada do mes pesa no mes em que fecha (decisao 10).
  v_receivable_id := private.emitir_cobrancas(
    p_request_id, v_customer.id, 'romaneio_ex', null, v_category_id,
    'Romaneios de ' || to_char(p_de, 'DD/MM') || ' a ' || to_char(p_ate, 'DD/MM/YYYY'),
    p_ate, v_total, v_user_id, p_de, p_ate,
    jsonb_build_object('period_start', p_de, 'period_end', p_ate, 'linhas', v_linhas)
  );

  return v_receivable_id;
exception
  when exclusion_violation then
    raise exception using errcode = '22023',
      message = 'Este período encosta em outro já cobrado. Confira as cobranças da Buck antes de gerar.';
end;
$$;

commit;
