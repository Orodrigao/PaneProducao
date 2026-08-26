-- Passo 1 da fase 2 do peso real: a cobranca passa a esperar a conferencia.
-- NENHUM VALOR MUDA AQUI. A cobranca continua saindo por quantidade PEDIDA x
-- preco. O que muda e QUANDO ela pode nascer.
--
-- O buraco: `list_pj_orders_to_bill` trata como entregue tambem o pedido cuja
-- data de entrega ja passou, sem envio confirmado. Entao um pedido que ninguem
-- conferiu aparecia para a Elis como "a faturar" e virava cobranca por deducao
-- de calendario. Foi assim que o pedido da Ines Vizioli (entrega 21/08,
-- R$ 388,00) virou fatura sem conferencia, e depois nem podia mais ser
-- conferido, porque o gatilho `guard_billed_pj_order_changes` congela pedido
-- faturado.
--
-- Medido em producao antes de escrever (2026-08-26, so leitura), pelo campo
-- `dispatched` gravado no evento `lancada`:
--
--   * historico inteiro: 87 cobrancas com envio confirmado, 64 sem;
--   * mas 62 das 64 sao a carga inicial de 19/08, quando o Contas a receber
--     entrou. Nao e rotina;
--   * na semana de 20/08 a 26/08: 24 com envio confirmado e 1 sem, e essa 1 e
--     exatamente a da Ines.
--
-- Ou seja, esta trava teria pego um caso em uma semana, e o caso certo. O
-- comentario de `src/lib/receivables.ts` que dizia ser esta lista "o caminho
-- principal da cobranca" descrevia julho, nao agosto, e foi corrigido no mesmo
-- commit.
--
-- O pedido bloqueado NAO fica sem saida, que e a licao que a fila da Expedicao
-- deixou hoje: como ele ainda nao virou cobranca, o gatilho de pedido faturado
-- nao se aplica, e a Expedicao consegue conferir e marcar como enviado
-- normalmente. A porta continua aberta pelo lado certo, e por isso nao existe
-- data de corte aqui: quem destrava e a conferencia, nao o calendario.

begin;

-- ---------------------------------------------------------------------------
-- A lista "a faturar" passa a dizer quem esta esperando conferencia
-- ---------------------------------------------------------------------------
-- Some da lista seria pior: a Elis perderia de vista um pedido entregue e nao
-- cobrado, que foi exatamente o estrago que a regra da fila da Expedicao
-- causou com a Rafaela. O pedido continua a vista, marcado e nao selecionavel.
--
-- `create or replace` nao altera tipo de retorno, entao e `drop` + `create`, e
-- o `drop` PERDE os grants (licao `grants-implicitos-variam-por-ambiente`).
drop function if exists public.list_pj_orders_to_bill();

create function public.list_pj_orders_to_bill()
returns table (
  order_group_id uuid,
  customer_id uuid,
  customer_name text,
  payment_term_days integer,
  delivery_date date,
  dispatched_at timestamptz,
  items integer,
  amount numeric,
  aguardando_conferencia boolean
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
         pedido.amount,
         pedido.aguardando_conferencia
  from (
    select order_row.order_group_id,
           (array_agg(order_row.customer_id order by order_row.id))[1] as customer_id,
           max(coalesce(order_row.delivery_date, order_row.order_date)) as delivery_date,
           max(order_row.dispatched_at) as dispatched_at,
           count(*)::int as items,
           round(sum(order_row.quantity * coalesce(order_row.unit_price, 0)), 2) as amount,
           -- Vale para pedido enviado a partir de 21/08, quando a
           -- conferencia nasceu: `confirm_pj_order_dispatch` passou a exigir
           -- tudo conferido. NAO vale para o legado — medi 74 grupos enviados
           -- com linha sem conferencia em 26/08. Por isso a lista olha o
           -- envio: legado enviado nao deve aparecer como pendente da
           -- Expedicao, ja que a cobranca dele existe e o retorno da cobranca
           -- existente resolve antes de qualquer trava.
           (max(order_row.dispatched_at) is null
            and count(*) filter (
              where order_row.dispatched_quantity is null
                and order_row.cancelled_at is null
            ) > 0) as aguardando_conferencia
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

revoke all on function public.list_pj_orders_to_bill() from public, anon;
grant execute on function public.list_pj_orders_to_bill() to authenticated;

-- ---------------------------------------------------------------------------
-- O motor recusa cobrar o que ninguem conferiu
-- ---------------------------------------------------------------------------
-- A tela ja nao deixa selecionar, mas tela nao e autorizacao: quem chamar a
-- funcao por fora da tela tem de bater na mesma porta.
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
         count(*) filter (
           where order_row.dispatched_quantity is null
             and order_row.cancelled_at is null
         ) as sem_conferencia,
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
  -- gerou, não criar uma segunda cobrança. Vem ANTES da trava da conferência
  -- de propósito: pedido legado que já virou cobrança continua respondendo o
  -- que sempre respondeu.
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

  -- A trava nova: sem envio confirmado e com linha sem conferência, o pedido
  -- não vira cobrança.
  --
  -- Vem DEPOIS da checagem de prazo de propósito: cliente sem prazo é
  -- bloqueio do cadastro, que a Elis resolve sozinha, e trava tudo daquele
  -- cliente. Deixar a conferência passar na frente trocaria um recado que
  -- ela resolve por um que depende de outra pessoa.
  --
  -- POR QUE NÃO É MAIS FORTE QUE ISSO, e é decisão consciente. A revisão
  -- adversarial apontou, com razão, que existe um segundo caminho para cobrar
  -- sem conferência: quando a Elis cancela a cobrança e corrige a quantidade,
  -- `private.limpar_conferencia_ao_mudar_pedido` apaga `dispatched_quantity`
  -- mas NÃO apaga `dispatched_at`, então o pedido segue "enviado" com número
  -- que ninguém conferiu.
  --
  -- Tentei fechar olhando só `sem_conferencia`. Vira BECO SEM SAÍDA, provado
  -- pelo CI: `save_pj_order_dispatch_quantities` recusa reconferir pedido já
  -- marcado como enviado ("A conferência não pode mais ser alterada aqui",
  -- 20260820232802:352). O pedido corrigido ficaria sem poder ser conferido E
  -- sem poder ser cobrado — a mesma armadilha de três portas que prendeu 65
  -- pedidos da Expedição em 26/08. Trocar um buraco por uma armadilha é pior.
  --
  -- Fica declarado como buraco conhecido, com tripwire em
  -- `supabase/tests/pedido_pj_vira_cobranca.test.sql`. Quem fecha é a metade B
  -- do passo 2, que existe exatamente para isso: cancelar as cobranças vivas,
  -- atualizar a quantidade e regerar pelo mesmo motor, numa transação só.
  --
  -- Quem confirma o envio não cai aqui: `confirm_pj_order_dispatch` grava
  -- `dispatched_at` antes desta chamada.
  if v_pedido.enviadas = 0 and v_pedido.sem_conferencia > 0 then
    raise exception using errcode = '22023',
      message = 'Este pedido ainda não foi conferido pela Expedição. Peça a conferência do que saiu antes de cobrar.';
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
  --
  -- `base_do_valor` grava de qual numero esta cobranca nasceu. Hoje e sempre
  -- `estimado`, porque a virada e o passo 2; sem esta marca, a coorte de antes
  -- e depois da virada fica irreconciliavel no relatorio da fase 3.
  v_receivable_id := private.emitir_cobrancas(
    gen_random_uuid(), v_customer.id, 'pedido_pj', p_order_group_id, v_category_id,
    v_descricao, v_invoice_date, round(v_pedido.valor, 2), v_customer.payment_term_days,
    1, p_user_id,
    null, null,
    jsonb_build_object(
      'order_group_id', p_order_group_id,
      'dispatched', v_pedido.enviadas > 0,
      'base_do_valor', 'estimado'
    )
  );

  return v_receivable_id;
end;
$$;

revoke all on function private.build_receivable_from_pj_order(uuid, uuid) from public, anon, authenticated;

commit;
