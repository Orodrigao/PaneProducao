-- Juros recebidos de cliente param de inflar a receita de vendas.
--
-- Até aqui, o recebimento acima do que faltava na cobrança lançava o valor
-- CHEIO na categoria da cobrança. Em produção, 5 cobranças de pedido PJ
-- recebidas de 1 a 4 dias depois do vencimento somaram cerca de R$ 57 de
-- juros de boleto dentro de "Clientes PJ" (leitura somente leitura em
-- 14/09/2026). Decisão do Rodrigo na mesma data: o que passa do saldo é juros
-- e ganha linha própria.
--
-- O desenho:
--   * o pedaço guarda duas partes. `amount` é o que abate a cobrança, com teto
--     no saldo em aberto; `interest_amount` é o que passou. O dinheiro que
--     entrou é a soma das duas;
--   * no livro, o principal segue na categoria da cobrança e no mês do
--     faturamento; os juros vão para 'juros_recebidos', no mês do RECEBIMENTO.
--     Juro é consequência do atraso, não da venda; jogá-lo no mês do
--     faturamento mudaria um mês que o Rodrigo já olhou (mesma escolha da
--     migration 20260819202105, do lado das compras);
--   * pagar a mais SEM atraso não é juros de boleto e quase sempre é erro de
--     digitação. Decisão do Rodrigo: avisa e pede justificativa, mas não
--     impede. A justificativa fica no pedaço e na linha do livro.
--
-- Quando a sobra NÃO vira juros (private.receivable_excess_rule):
--   * cobrança da Buck: continua recusado, o que passa pertence a outra semana;
--   * a parte da sobra que é diferença da conferência de um pedido PJ. O
--     cliente pode ter na mão um boleto maior que a cobrança atual por dois
--     caminhos da jornada: a liberação com pagamento já feito reduz a cobrança
--     no mesmo id (evento 'valor_corrigido_pj', valor anterior em
--     details->>'de'), e a liberação sem pagamento cancela a emissão anterior
--     e emite outra menor. A diferença entre o maior valor já cobrado do
--     pedido e o que está em aberto hoje é valor do pedido, tratado na ficha
--     PJ por devolução ou crédito; só o que passar dela vira juros.
--
-- Fora do escopo, por decisão consciente: os 5 recebimentos antigos continuam
-- como estão (valor cheio em `amount`, `interest_amount` zero).
--
-- Convivência com o site no ar: as colunas novas nascem com padrão, e
-- `record_receivable_receipt` ganha um parâmetro opcional no fim. O site
-- antigo continua chamando com seis argumentos nomeados; só o pagamento a mais
-- sem atraso, que passa a exigir justificativa, é recusado para ele até o site
-- novo entrar.

begin;

-- ---------------------------------------------------------------------------
-- 1. A categoria.
-- ---------------------------------------------------------------------------
-- Receita, no grupo das financeiras: fica ao lado de juros e tarifas que a
-- padaria paga, e fora de "Receita", que é o que foi vendido.
insert into public.finance_categories (key, label, dre_tier, dre_group, nature, team, sort_order)
values ('juros_recebidos', 'Juros e multa recebidos', 'operacional', 'financeiras', 'receita', null, 355)
on conflict (key) do update set
  label = excluded.label,
  dre_tier = excluded.dre_tier,
  dre_group = excluded.dre_group,
  nature = excluded.nature,
  team = excluded.team,
  sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 2. O pedaço guarda o que passou do saldo.
-- ---------------------------------------------------------------------------
alter table public.receivable_receipts
  add column if not exists interest_amount numeric(12,2) not null default 0,
  add column if not exists excess_reason text;

alter table public.receivable_receipts
  drop constraint if exists receivable_receipts_interest_shape;

alter table public.receivable_receipts
  add constraint receivable_receipts_interest_shape check (
    interest_amount >= 0
    and interest_amount <= 1000000
    -- Justificativa só existe junto de valor a mais, e nunca em branco:
    -- espaço, tabulação e quebra de linha não contam como texto.
    and (excess_reason is null
      or (interest_amount > 0
        and length(btrim(excess_reason, E' \t\r\n')) between 3 and 300))
  );

comment on column public.receivable_receipts.amount is
  'Quanto deste pedaço abate a cobrança. Só passa do saldo em aberto pela diferença da conferência de pedido PJ, ou em recebimentos anteriores a 14/09/2026.';
comment on column public.receivable_receipts.interest_amount is
  'Quanto deste pedaço passou do saldo em aberto: juros e multa recebidos. O dinheiro que entrou é amount + interest_amount.';
comment on column public.receivable_receipts.excess_reason is
  'Justificativa digitada quando o pagamento veio a mais sem atraso.';

-- A leitura já era concedida na tabela inteira; fica explícita depois das
-- colunas novas (lição 2026-07-22).
grant select on public.receivable_receipts to authenticated;

-- ---------------------------------------------------------------------------
-- 3. O que acontece com a sobra nesta cobrança.
-- ---------------------------------------------------------------------------
-- Uma regra só, usada pela gravação e perguntada pela tela antes do clique:
--   modo 'recusa_buck'  a Buck não aceita valor acima do saldo;
--   modo 'juros'        a sobra vira juros recebidos, exceto
--   sobra_do_pedido     quanto da sobra ainda é diferença da conferência do
--                       pedido PJ, calculada pelo pedido inteiro (parcelas
--                       incluídas):
--                         maior valor já cobrado do pedido
--                         - valor das cobranças ativas do pedido
--                         - o que outras parcelas já receberam acima do valor.
--                       O maior valor já cobrado é o primeiro valor anterior a
--                       uma redução com dinheiro dentro, ou uma emissão inteira
--                       cancelada por nova conferência. Numa sequência de
--                       aumento e depois redução vale o primeiro valor, que
--                       acerta o caso comum de reduções sucessivas.
create or replace function private.receivable_excess_rule(p_receivable_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cobranca record;
  v_maior_cobrado numeric(12,2);
  v_ativo numeric(12,2);
  v_ja_usado numeric(12,2);
begin
  select cobranca.id, cobranca.origin, cobranca.origin_ref into v_cobranca
  from public.receivables cobranca
  where cobranca.id = p_receivable_id;
  if v_cobranca.id is null then
    return null;
  end if;

  if v_cobranca.origin = 'romaneio_ex' then
    return jsonb_build_object('modo', 'recusa_buck', 'sobra_do_pedido', 0);
  end if;
  if v_cobranca.origin <> 'pedido_pj' or v_cobranca.origin_ref is null then
    return jsonb_build_object('modo', 'juros', 'sobra_do_pedido', 0);
  end if;

  select greatest(
    coalesce((
      select case when evento.details->>'de' ~ '^[0-9]+(\.[0-9]+)?$'
                  then (evento.details->>'de')::numeric end
      from public.receivable_events evento
      join public.receivables parcela on parcela.id = evento.receivable_id
      where parcela.origin = 'pedido_pj'
        and parcela.origin_ref = v_cobranca.origin_ref
        and evento.event_type = 'valor_corrigido_pj'
      order by evento.created_at, evento.id
      limit 1
    ), 0),
    -- A liberação sem pagamento cancela todas as parcelas no mesmo instante:
    -- somadas por instante, são a emissão inteira que o cliente pode ter.
    coalesce((
      select max(emissao.total)
      from (
        select sum(parcela.amount) as total
        from public.receivables parcela
        where parcela.origin = 'pedido_pj'
          and parcela.origin_ref = v_cobranca.origin_ref
          and parcela.status = 'cancelada'
          and parcela.cancel_reason like 'Substituida apos nova conferencia%'
        group by parcela.cancelled_at
      ) emissao
    ), 0)
  ) into v_maior_cobrado;

  select coalesce(sum(parcela.amount), 0),
         coalesce(sum(greatest(private.receivable_recebido(parcela.id) - parcela.amount, 0)), 0)
    into v_ativo, v_ja_usado
  from public.receivables parcela
  where parcela.origin = 'pedido_pj'
    and parcela.origin_ref = v_cobranca.origin_ref
    and parcela.status <> 'cancelada';

  return jsonb_build_object(
    'modo', 'juros',
    'sobra_do_pedido', greatest(v_maior_cobrado - v_ativo - v_ja_usado, 0)
  );
end;
$$;

revoke all on function private.receivable_excess_rule(uuid) from public, anon, authenticated;

create or replace function public.receivable_excess_rule(p_receivable_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.current_user_can_receivables('contas_receber.baixar') then
    raise exception using errcode = '42501', message = 'Sem permissão para registrar recebimentos.';
  end if;
  return private.receivable_excess_rule(p_receivable_id);
end;
$$;

revoke all on function public.receivable_excess_rule(uuid) from public, anon;
grant execute on function public.receivable_excess_rule(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. O livro recebe principal e juros em linhas separadas.
-- ---------------------------------------------------------------------------
-- Redefinição integral a partir da versão vigente (20260814140631). Mudanças:
--   a) a linha do principal usa só `amount`;
--   b) os juros viram linha própria em 'juros_recebidos', no mês do
--      recebimento, com previsto zero: ninguém planeja receber juro;
--   c) se a própria cobrança já for da categoria de juros, ou a categoria não
--      existir, tudo sai numa linha só, para não colidir com o índice único de
--      lançamento ativo por (origem, pedaço, categoria) nem deixar o dinheiro
--      fora do livro.
create or replace function private.lancar_recibo_no_livro(p_receipt_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row record;
  v_descricao text;
  v_descricao_juros text;
  v_categoria_juros uuid;
begin
  select recibo.id, recibo.amount, recibo.interest_amount, recibo.excess_reason,
         recibo.received_date, recibo.method, recibo.account_id,
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

  -- Idempotência: o mesmo pedaço nunca vira dois lançamentos. O filtro não olha
  -- a categoria, então vale também para a linha de juros.
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
  v_descricao_juros := 'Juros/multa recebidos · '
    || coalesce(nullif(trim(v_row.cliente), ''), 'Cliente') || ' · ' || v_row.description
    || coalesce(' · ' || nullif(btrim(v_row.excess_reason, E' \t\r\n'), ''), '');

  select category.id into v_categoria_juros
  from public.finance_categories category
  where category.key = 'juros_recebidos';

  if v_row.interest_amount > 0
     and v_categoria_juros is not null
     and v_categoria_juros is distinct from v_row.finance_category_id then
    insert into public.finance_entries (
      request_id, entry_type, category_id, account_id, store, competence_month,
      due_date, planned_amount, paid_date, amount, payment_method, description,
      source, source_ref, created_by
    )
    values
      (
        gen_random_uuid(), 'lancamento', v_row.finance_category_id, v_row.account_id,
        'jc',
        -- Competência no mês do faturamento: a venda pesa no mês em que o pão saiu.
        date_trunc('month', v_row.invoice_date)::date,
        v_row.due_date,
        v_row.amount, v_row.received_date, v_row.amount,
        v_row.method, v_descricao,
        'contas_receber', p_receipt_id, p_user_id
      ),
      (
        gen_random_uuid(), 'lancamento', v_categoria_juros, v_row.account_id,
        'jc',
        -- Juros pesam no mês em que o dinheiro entrou.
        date_trunc('month', v_row.received_date)::date,
        v_row.due_date,
        0, v_row.received_date, v_row.interest_amount,
        v_row.method, v_descricao_juros,
        'contas_receber', p_receipt_id, p_user_id
      );
    return;
  end if;

  -- Sem juros, ou sem onde separá-los: uma linha só com todo o dinheiro.
  insert into public.finance_entries (
    request_id, entry_type, category_id, account_id, store, competence_month,
    due_date, planned_amount, paid_date, amount, payment_method, description,
    source, source_ref, created_by
  )
  values (
    gen_random_uuid(), 'lancamento', v_row.finance_category_id, v_row.account_id,
    'jc',
    date_trunc('month', v_row.invoice_date)::date,
    v_row.due_date,
    -- Previsto é o que abate a cobrança; a diferença para o realizado, quando
    -- existir, é o acréscimo que não teve onde ser separado.
    v_row.amount, v_row.received_date, v_row.amount + v_row.interest_amount,
    v_row.method, v_descricao,
    'contas_receber', p_receipt_id, p_user_id
  );
end;
$fn$;

revoke all on function private.lancar_recibo_no_livro(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Registrar um pedaço separa o que passou do saldo.
-- ---------------------------------------------------------------------------
-- Redefinição integral a partir da versão vigente (20260914030000, Buck).
-- Mudanças:
--   a) parâmetro opcional `p_excess_reason`;
--   b) o que passa do saldo em aberto, descontada a parte que ainda é valor
--      do pedido (private.receivable_excess_rule), vira `interest_amount`, e
--      juros com recebimento até o vencimento exigem justificativa;
--   c) `created_at` com o relógio real.
-- A assinatura muda, então a função antiga sai antes; os grants são refeitos.
drop function if exists public.record_receivable_receipt(uuid, uuid, date, numeric, text, text);

create function public.record_receivable_receipt(
  p_request_id uuid,
  p_receivable_id uuid,
  p_received_date date,
  p_amount numeric,
  p_method text,
  p_account_key text,
  p_excess_reason text default null
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
  v_falta numeric(12,2);
  v_principal numeric(12,2);
  v_juros numeric(12,2) := 0;
  v_sobra_pedido numeric(12,2);
  v_motivo text := nullif(btrim(coalesce(p_excess_reason, ''), E' \t\r\n'), '');
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

  v_falta := v_cobranca.amount - v_recebido;

  if v_cobranca.origin = 'romaneio_ex' and v_amount > v_falta then
    raise exception using errcode = '22023',
      message = 'Esta cobrança da Buck tem R$ '
        || replace(to_char(v_falta, 'FM999999990.00'), '.', ',')
        || ' em aberto. Registre no máximo esse valor; o que passar pertence a outra semana.';
  end if;

  if v_amount > v_falta then
    -- Da sobra, a parte que é diferença da conferência do pedido fica no
    -- pedido, como antes; só o que passar dela vira juros. A regra só é lida
    -- quando existe sobra.
    v_sobra_pedido := coalesce((private.receivable_excess_rule(p_receivable_id)->>'sobra_do_pedido')::numeric, 0);
    v_principal := v_falta + least(v_amount - v_falta, v_sobra_pedido);
    v_juros := v_amount - v_principal;
  else
    v_principal := v_amount;
  end if;

  if v_juros > 0 then
    -- Até o dia do vencimento o banco não cobra juros: valor a mais aqui quase
    -- sempre é digitação. Não impede, mas exige o porquê.
    if p_received_date <= v_cobranca.due_date and v_motivo is null then
      raise exception using errcode = '22023',
        message = 'O pagamento não está atrasado e passou R$ '
          || replace(to_char(v_juros, 'FM999999990.00'), '.', ',')
          || ' do que falta. Confira o valor ou informe a justificativa.';
    end if;
  else
    -- Sem juros não há o que justificar.
    v_motivo := null;
  end if;

  if v_motivo is not null and length(v_motivo) < 3 then
    raise exception using errcode = '22023', message = 'Escreva a justificativa com pelo menos 3 letras.';
  end if;
  if v_motivo is not null and length(v_motivo) > 300 then
    raise exception using errcode = '22023', message = 'A justificativa passou de 300 caracteres. Resuma o motivo.';
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

  -- `created_at` com o relógio real, e não o início da transação: é ele que
  -- ordena os pedaços na trava do estorno, e dois pedaços gravados na mesma
  -- transação empatariam com `now()`.
  insert into public.receivable_receipts (
    request_id, receivable_id, received_date, amount, interest_amount, excess_reason,
    method, account_id, created_by, created_at
  )
  values (
    p_request_id, p_receivable_id, p_received_date, v_principal, v_juros, v_motivo,
    p_method, v_account.id, v_user_id, clock_timestamp()
  )
  returning id into v_receipt_id;

  insert into public.receivable_events (receivable_id, event_type, details, created_by)
  values (
    p_receivable_id, 'baixada',
    jsonb_build_object(
      'request_id', p_request_id,
      'receipt_id', v_receipt_id,
      'received_date', p_received_date,
      'amount', v_principal,
      'interest_amount', v_juros,
      'cash_amount', v_amount,
      'excess_reason', v_motivo,
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

revoke all on function public.record_receivable_receipt(uuid, uuid, date, numeric, text, text, text) from public, anon;
grant execute on function public.record_receivable_receipt(uuid, uuid, date, numeric, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Estorno respeita a ordem dos juros.
-- ---------------------------------------------------------------------------
-- Redefinição integral a partir da versão vigente (20260814140631). Mudança:
-- os juros de um pedaço foram calculados sobre o saldo que os pedaços
-- anteriores deixaram. Estornar um anterior deixaria aqueles juros errados, então
-- o estorno recusa enquanto houver pedaço posterior ativo com juros e diz qual
-- estornar primeiro. A cobrança é travada antes, para um recebimento
-- simultâneo não escapar da conferência.
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
  v_posterior record;
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

  select recibo.receivable_id into v_recibo
  from public.receivable_receipts recibo
  where recibo.id = p_receipt_id;
  if v_recibo.receivable_id is null then
    raise exception using errcode = 'P0002', message = 'Recebimento não encontrado.';
  end if;

  -- Mesma ordem de trava do registro: primeiro a cobrança, depois o pedaço.
  perform 1 from public.receivables cobranca
  where cobranca.id = v_recibo.receivable_id
  for update;

  select recibo.* into v_recibo
  from public.receivable_receipts recibo
  where recibo.id = p_receipt_id
  for update;

  if v_recibo.reversed_at is not null then
    -- Já estornado: repetir não faz nada, para o toque duplo não estourar erro.
    return;
  end if;

  select posterior.received_date, posterior.interest_amount into v_posterior
  from public.receivable_receipts posterior
  where posterior.receivable_id = v_recibo.receivable_id
    and posterior.id <> v_recibo.id
    and posterior.reversed_at is null
    and posterior.interest_amount > 0
    and (posterior.created_at, posterior.id) > (v_recibo.created_at, v_recibo.id)
  order by posterior.created_at desc, posterior.id desc
  limit 1;
  if v_posterior.received_date is not null then
    raise exception using errcode = '22023',
      message = 'O recebimento de ' || to_char(v_posterior.received_date, 'DD/MM/YYYY')
        || ' separou R$ ' || replace(to_char(v_posterior.interest_amount, 'FM999999990.00'), '.', ',')
        || ' de juros contando com este. Estorne aquele primeiro.';
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
      'interest_amount', v_recibo.interest_amount,
      'received_date', v_recibo.received_date
    ),
    v_user_id
  );

  perform private.atualizar_situacao_receivable(v_recibo.receivable_id);
end;
$$;

revoke all on function public.reverse_receivable_receipt(uuid, uuid, text) from public, anon;
grant execute on function public.reverse_receivable_receipt(uuid, uuid, text) to authenticated;

commit;
