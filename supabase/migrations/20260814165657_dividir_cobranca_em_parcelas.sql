-- Contas a receber: dividir a fatura em 2x ou 3x, por decisao da cobranca.
--
-- Motivo operacional (Rodrigo, 2026-08-14): ha clientes que dividem a fatura
-- quando ela sai alta e pagam de uma vez quando sai pequena. Parcelar nao e
-- caracteristica do cliente, e decisao daquela fatura — foi o proprio Rodrigo
-- quem corrigiu o desenho anterior, que prendia o parcelamento ao cadastro.
--
-- Decisoes:
--   * o cliente mantem UM prazo basico, como sempre teve;
--   * o prazo basico e o TETO: dividir em N distribui os vencimentos ate ele.
--     Cliente de 21 dias em 3 vezes vence em 7, 14 e 21; de 28 em 2 vezes,
--     em 14 e 28;
--   * cada parcela e uma cobranca propria, porque e assim que se cobra;
--   * o valor divide em partes iguais, com os centavos que sobram na primeira;
--   * a cobranca que nasce sozinha (envio confirmado pela Expedicao, romaneio
--     da Buck) nasce INTEIRA: nao ha ninguem na tela para decidir. Para essas,
--     existe a acao de dividir depois.
--
-- Producao segue com zero cobrancas: nada a migrar.

begin;

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

-- A trava de origem passa a considerar a parcela: um pedido dividido gera N
-- cobrancas vivas, e nao mais uma so.
drop index if exists public.receivables_origem_viva_idx;
create unique index if not exists receivables_origem_viva_idx
  on public.receivables (origin, origin_ref, installment_number)
  where origin_ref is not null and status <> 'cancelada';

alter table public.receivable_events
  drop constraint if exists receivable_events_event_type_check;

alter table public.receivable_events
  add constraint receivable_events_event_type_check
    check (event_type in ('lancada', 'baixada', 'estornada', 'cancelada', 'vencimento_corrigido', 'dividida'));

-- ---------------------------------------------------------------------------
-- O teto e a distribuicao dos vencimentos.
-- ---------------------------------------------------------------------------
-- Parcela i de n, com prazo basico p, vence em round(p * i / n) dias. A ultima
-- cai exatamente no prazo basico, que e o acordo que ja existia com o cliente.
create or replace function private.vencimento_da_parcela(
  p_prazo_basico integer,
  p_parcela integer,
  p_parcelas integer
)
returns integer
language sql
immutable
set search_path = ''
as $fn$
  select round(p_prazo_basico::numeric * p_parcela / p_parcelas)::integer;
$fn$;

revoke all on function private.vencimento_da_parcela(integer, integer, integer) from public, anon, authenticated;
grant execute on function private.vencimento_da_parcela(integer, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- O emissor: transforma um valor nas cobrancas da fatura.
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
  p_prazo_basico integer,
  p_parcelas integer,
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
  v_parcelas integer := greatest(coalesce(p_parcelas, 1), 1);
  v_base numeric(12,2);
  v_resto numeric(12,2);
  v_valor numeric(12,2);
  v_vencimento date;
  v_descricao text;
  v_id uuid;
  v_primeiro uuid;
  i integer;
begin
  if p_prazo_basico is null then
    raise exception using errcode = '22023',
      message = 'Este cliente ainda não tem prazo de pagamento cadastrado. Defina o prazo na tela de Clientes antes de cobrar.';
  end if;

  if v_parcelas > 12 then
    raise exception using errcode = '22023', message = 'No máximo 12 parcelas.';
  end if;

  -- Dividir exige prazo que caiba: em 3 vezes com prazo de 2 dias, duas
  -- parcelas venceriam no mesmo dia e nao seriam duas parcelas.
  if v_parcelas > 1 and p_prazo_basico < v_parcelas then
    raise exception using errcode = '22023',
      message = 'O prazo de ' || p_prazo_basico || ' dia(s) deste cliente é curto demais para dividir em '
        || v_parcelas || ' vezes.';
  end if;

  -- Valor pequeno demais para dividir vira parcela unica: melhor uma cobranca
  -- certa do que tres de um centavo.
  if p_total < v_parcelas * 0.01 then
    v_parcelas := 1;
  end if;

  v_base := trunc(p_total / v_parcelas, 2);
  v_resto := round(p_total - (v_base * v_parcelas), 2);

  for i in 1 .. v_parcelas loop
    -- Os centavos que sobram vao na primeira, para as demais ficarem redondas.
    v_valor := v_base + case when i = 1 then v_resto else 0 end;
    v_vencimento := p_invoice_date + private.vencimento_da_parcela(p_prazo_basico, i, v_parcelas);
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

revoke all on function private.emitir_cobrancas(uuid, uuid, text, uuid, uuid, text, date, numeric, integer, integer, uuid, date, date, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Dividir uma cobranca que ja existe.
-- ---------------------------------------------------------------------------
-- E o caminho para a cobranca que nasceu sozinha e saiu alta. A parcela 1
-- reaproveita a cobranca original: assim o vinculo com o pedido ou o romaneio
-- que a gerou nao se perde, e nao ha cancelamento no meio da historia.
create or replace function public.split_receivable(
  p_request_id uuid,
  p_receivable_id uuid,
  p_parcelas integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_prazo integer;
  v_base numeric(12,2);
  v_resto numeric(12,2);
  v_valor numeric(12,2);
  v_vencimento date;
  v_descricao_base text;
  v_user_id uuid := (select auth.uid());
  i integer;
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador da divisão obrigatório.';
  end if;

  if not private.current_user_can_receivables('contas_receber.lancar') then
    raise exception using errcode = '42501', message = 'Sem permissão para dividir cobranças.';
  end if;

  if p_parcelas is null or p_parcelas < 2 or p_parcelas > 12 then
    raise exception using errcode = '22023', message = 'Divida em 2 a 12 parcelas.';
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
      and evento.event_type = 'dividida'
      and evento.details ->> 'request_id' = p_request_id::text
  ) then
    return;
  end if;

  -- O dinheiro vem primeiro de proposito: cobranca que recebeu uma parte fica
  -- 'parcial', e reclamar do estado mandaria a Elis procurar o problema errado.
  -- O recado precisa dizer o que fazer, nao o que ela e.
  if private.receivable_recebido(p_receivable_id) > 0 then
    raise exception using errcode = '22023',
      message = 'Esta cobrança já recebeu dinheiro. Estorne os recebimentos antes de dividir.';
  end if;
  if v_row.installment_count > 1 then
    raise exception using errcode = '22023',
      message = 'Esta cobrança já é uma parcela. Divida a cobrança inteira, não um pedaço dela.';
  end if;
  if v_row.status <> 'aberta' then
    raise exception using errcode = '22023',
      message = 'Só uma cobrança em aberto pode ser dividida.';
  end if;

  -- O prazo vem da propria cobranca, e nao do cadastro: se o vencimento foi
  -- corrigido, e o combinado de verdade que manda.
  v_prazo := v_row.due_date - v_row.invoice_date;
  if v_prazo < p_parcelas then
    raise exception using errcode = '22023',
      message = 'O prazo de ' || v_prazo || ' dia(s) desta cobrança é curto demais para dividir em '
        || p_parcelas || ' vezes.';
  end if;
  if v_row.amount < p_parcelas * 0.01 then
    raise exception using errcode = '22023', message = 'Valor pequeno demais para dividir.';
  end if;

  v_descricao_base := v_row.description;
  v_base := trunc(v_row.amount / p_parcelas, 2);
  v_resto := round(v_row.amount - (v_base * p_parcelas), 2);

  for i in 1 .. p_parcelas loop
    v_valor := v_base + case when i = 1 then v_resto else 0 end;
    v_vencimento := v_row.invoice_date + private.vencimento_da_parcela(v_prazo, i, p_parcelas);

    if i = 1 then
      update public.receivables
      set amount = v_valor,
          due_date = v_vencimento,
          original_due_date = v_vencimento,
          installment_number = 1,
          installment_count = p_parcelas,
          description = v_descricao_base || ' · parcela 1/' || p_parcelas
      where id = p_receivable_id;
    else
      insert into public.receivables (
        request_id, customer_id, origin, origin_ref, finance_category_id, description,
        invoice_date, original_due_date, due_date, amount,
        installment_number, installment_count, period_start, period_end, created_by
      )
      values (
        gen_random_uuid(), v_row.customer_id, v_row.origin, v_row.origin_ref,
        v_row.finance_category_id, v_descricao_base || ' · parcela ' || i || '/' || p_parcelas,
        v_row.invoice_date, v_vencimento, v_vencimento, v_valor,
        i, p_parcelas, v_row.period_start, v_row.period_end, v_user_id
      );
    end if;
  end loop;

  insert into public.receivable_events (receivable_id, event_type, details, created_by)
  values (
    p_receivable_id, 'dividida',
    jsonb_build_object(
      'request_id', p_request_id,
      'parcelas', p_parcelas,
      'valor_original', v_row.amount,
      'vencimento_original', v_row.due_date
    ),
    v_user_id
  );
end;
$$;

revoke all on function public.split_receivable(uuid, uuid, integer) from public, anon;
grant execute on function public.split_receivable(uuid, uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- As tres origens passam a emitir pelo emissor unico.
-- ---------------------------------------------------------------------------
-- Corpos copiados das definicoes vigentes; a unica diferenca e a emissao.
-- A assinatura do lancamento avulso muda (ganha o numero de parcelas), entao a
-- versao antiga sai antes.
drop function if exists public.create_manual_receivable(uuid, uuid, date, numeric, text);

create or replace function public.create_manual_receivable(
  p_request_id uuid,
  p_customer_id uuid,
  p_invoice_date date,
  p_amount numeric,
  p_description text,
  p_parcelas integer default 1
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

  -- Dividir e decisao da fatura, nao do cadastro: o cliente tem um prazo
  -- basico e a Elis escolhe em quantas vezes esta cobranca especifica cai.
  return private.emitir_cobrancas(
    p_request_id, p_customer_id, 'avulso', null, v_category_id,
    trim(p_description), p_invoice_date, v_amount, v_customer.payment_term_days,
    coalesce(p_parcelas, 1), v_user_id
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
  select category.id into v_category_id
  from public.finance_categories category
  where category.key = 'clientes_pj' and category.active;
  if v_category_id is null then
    raise exception using errcode = 'P0002', message = 'Categoria de receita de clientes PJ não encontrada.';
  end if;

  v_descricao := 'Pedido de ' || to_char(v_pedido.data_entrega, 'DD/MM/YYYY');

  -- Nasce inteira: quem confirma o envio e a Expedicao, e nao ha ninguem na
  -- tela para decidir parcelamento. Se a fatura sair alta, a Elis divide
  -- depois, olhando o cliente.
  v_receivable_id := private.emitir_cobrancas(
    gen_random_uuid(), v_customer.id, 'pedido_pj', p_order_group_id, v_category_id,
    v_descricao, v_invoice_date, round(v_pedido.valor, 2), v_customer.payment_term_days,
    1, p_user_id,
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

  select customer.id, customer.name, customer.payment_term_days
    into v_customer
  from public.customers customer
  where lower(trim(customer.name)) = 'buck' and customer.active
  limit 1;
  if v_customer.id is null then
    raise exception using errcode = 'P0002', message = 'Cliente Buck não encontrado no cadastro.';
  end if;
  if v_customer.payment_term_days is null then
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
    p_ate, v_total, v_customer.payment_term_days, 1, v_user_id, p_de, p_ate,
    jsonb_build_object('period_start', p_de, 'period_end', p_ate, 'linhas', v_linhas)
  );

  return v_receivable_id;
exception
  when exclusion_violation then
    raise exception using errcode = '22023',
      message = 'Este período encosta em outro já cobrado. Confira as cobranças da Buck antes de gerar.';
end;
$$;

revoke all on function public.create_manual_receivable(uuid, uuid, date, numeric, text, integer) from public, anon;
grant execute on function public.create_manual_receivable(uuid, uuid, date, numeric, text, integer) to authenticated;

commit;
