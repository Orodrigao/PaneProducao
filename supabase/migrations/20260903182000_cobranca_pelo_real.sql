-- Fase 2 da quantidade enviada em Pedidos PJ: a cobranca passa a usar o que
-- saiu, e o financeiro ganha como corrigir depois do envio.
--
-- Plano e decisoes: docs/QUANTIDADE_ENVIADA_PEDIDOS_PJ.md.
--
-- O QUE ACONTECIA. A Expedicao confere desde 21/08 e o numero dela ficava
-- guardado sem efeito: a cobranca nascia de `quantity * unit_price`, a
-- estimativa que a Elis lancou. Medido em producao em 02/09, desde 21/08:
-- 59 linhas conferidas, 13 com diferenca, R$ 182,58 entregues e nao cobrados e
-- R$ 93,76 cobrados de item que nao saiu. E a nota fiscal ja sai pelo numero da
-- Expedicao, porque a Elis a emite depois da entrega: ou seja, ERP e nota ja
-- discordavam, e e a cobranca que estava fora de linha.
--
-- AS DUAS METADES VAO JUNTAS (decisao 9 do Rodrigo). Ligar o dinheiro sem ter
-- como corrigir criaria a janela em que um erro de tara vira fatura sem caminho
-- de volta. Por isso esta migration traz o motor novo E a funcao de correcao.
--
-- O QUE NAO MUDA. Pedido ja cobrado nao e recalculado. Cliente que ja pagou nao
-- recebe cobranca de diferenca. A conferencia continua sendo uma pergunta, e nao
-- uma barreira, na hora de digitar (decisao 12).

begin;

-- ---------------------------------------------------------------------------
-- O marco: onde termina o legado
-- ---------------------------------------------------------------------------
-- Literal, e nao `now()`: o marco precisa devolver a mesma resposta daqui a um
-- ano, senao um pedido antigo muda de classificacao sozinho quando alguem
-- reprocessar. A data e a da fase 1, quando `confirm_pj_order_dispatch` passou a
-- exigir tudo conferido antes de enviar. Enviado antes disso e legado de
-- verdade: sao os 74 grupos medidos em 26/08, sem conferencia por nunca ter
-- existido campo. Enviado depois disso sem conferencia e anomalia, e o motor
-- recusa cobrar em vez de adivinhar.
create or replace function private.marco_cobranca_pelo_real()
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select timestamptz '2026-08-21 00:00:00-03';
$$;

revoke all on function private.marco_cobranca_pelo_real()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A conta do valor de uma linha, num lugar so
-- ---------------------------------------------------------------------------
-- Ate aqui esta conta estava escrita em cinco lugares (motor, lista, relatorio
-- de Vendas PJ e duas somas da tela). Trocar so um faria a tela mostrar um
-- numero e a cobranca gerar outro, que e a divida que o Romaneio ja cobrou caro
-- uma vez. Agora os pontos do banco chamam esta funcao e os da tela chamam o
-- espelho em `src/lib/pjOrderValue.ts`, com a mesma tabela de casos.
--
-- Devolve `null`, e nao zero, quando nao ha valor cobravel. Zero somaria em
-- silencio e a fatura sairia menor sem ninguem saber; `null` obriga quem chama
-- a decidir o que fazer.
create or replace function private.valor_linha_pj(
  p_quantity numeric,
  p_dispatched numeric,
  p_unit_price numeric,
  p_dispatched_at timestamptz
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    -- Conferido manda, inclusive quando o numero e zero: "nao enviei este
    -- item" e decisao declarada, com motivo obrigatorio desde a fase 1.
    when p_dispatched is not null
      then round(p_dispatched * coalesce(p_unit_price, 0), 2)
    -- Legado: saiu antes de a conferencia existir. Continua pela estimativa.
    when p_dispatched_at is not null
         and p_dispatched_at < private.marco_cobranca_pelo_real()
      then round(coalesce(p_quantity, 0) * coalesce(p_unit_price, 0), 2)
    -- Nao enviado ainda, ou enviado depois do marco sem conferencia.
    else null
  end;
$$;

revoke all on function private.valor_linha_pj(numeric, numeric, numeric, timestamptz)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A trava de saida, por linha (decisao 15, do Rodrigo, em 2026-09-02)
-- ---------------------------------------------------------------------------
-- A decisao 12 tirou a recusa da ENTRADA, de proposito: barreira por tamanho
-- pega 420 no lugar de 42 e nao pega 80 no lugar de 42. Com o numero virando
-- dinheiro, precisa existir uma porta na SAIDA, e ela e a licao
-- `validar-tambem-na-saida`, que nasceu de R$ 190 mil de dado envenenado.
--
-- Os numeros vem do historico real das linhas PJ, medido em 02/09: o fator
-- conferido/estimado ficou entre 0,69 e 1,57, a maior linha registrada desde
-- 01/06 tem 20 kg e a maior em unidade tem 600. A folga e deliberada: a trava
-- existe para pegar grama digitada em campo de quilo, nao para discutir com
-- quem separa mercadoria.
--
-- Zero nunca e recusado aqui: e falta declarada, nao desvio de quantidade.
create or replace function private.veredito_valor_linha_pj(
  p_quantity numeric,
  p_dispatched numeric,
  p_pricing_unit text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_fator numeric;
begin
  if p_dispatched is null or p_dispatched = 0 then
    return 'ok';
  end if;

  if coalesce(p_pricing_unit, 'un') = 'kg' then
    if p_dispatched > 50 then
      return 'acima_do_teto';
    end if;
  else
    if p_dispatched > 2000 then
      return 'acima_do_teto';
    end if;
  end if;

  if p_quantity is null or p_quantity <= 0 then
    return 'ok';
  end if;

  v_fator := p_dispatched / p_quantity;
  if v_fator > 3 or v_fator < (1.0 / 3.0) then
    return 'fora_da_faixa';
  end if;

  return 'ok';
end;
$$;

revoke all on function private.veredito_valor_linha_pj(numeric, numeric, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Quem pode corrigir a quantidade depois do envio
-- ---------------------------------------------------------------------------
-- Mesmo formato de `private.current_user_can_receivables`: administrador tem
-- passe-livre e os demais entram pela permissao granular. Sem o passe-livre a
-- tela nasceria travada para o proprio Rodrigo, que e quem testa.
create or replace function private.current_user_can_fix_pj_dispatch()
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
        or (
          -- A decisao 4 do plano diz "apenas financeiro/admin". Sem esta linha,
          -- conceder a permissao a um perfil de vendas na tela de usuarios
          -- abriria a correcao para ele, contra o que foi decidido. Permissao
          -- concede, perfil delimita.
          profile.role = 'financeiro'
          and exists (
            select 1
            from public.app_user_permissions assignment
            where assignment.user_id = profile.user_id
              and assignment.permission_key = 'pedidos_pj.corrigir_quantidade'
              and assignment.scope in ('*', 'jc')
          )
        )
      )
  );
$$;

revoke all on function private.current_user_can_fix_pj_dispatch()
  from public, anon, authenticated;
grant execute on function private.current_user_can_fix_pj_dispatch() to authenticated;

insert into public.app_permissions (key, module, label, description, sort_order)
values (
  'pedidos_pj.corrigir_quantidade',
  'Pedidos PJ',
  'Corrigir quantidade enviada depois do envio',
  'Refazer a cobranca de um pedido PJ ja enviado quando a quantidade conferida estiver errada. Bloqueada assim que o cliente paga.',
  40
)
on conflict (key) do update set
  module = excluded.module,
  label = excluded.label,
  description = excluded.description,
  sort_order = excluded.sort_order
where (app_permissions.module, app_permissions.label,
       app_permissions.description, app_permissions.sort_order)
  is distinct from
      (excluded.module, excluded.label,
       excluded.description, excluded.sort_order);

-- Nenhuma concessao a pessoa nomeada aqui. Quem concede e o Rodrigo, em
-- /admin/usuarios. O administrador ja alcanca pela regra acima.

-- ---------------------------------------------------------------------------
-- O motor da cobranca passa a somar o que saiu
-- ---------------------------------------------------------------------------
-- Redefinicao integral, partindo da versao VIGENTE, que e a de
-- `20260826201914_cobranca_espera_a_conferencia.sql` (conferido por grep em
-- todas as migrations: nenhuma outra a redefiniu desde entao). `create or
-- replace` e sobrescrita total, nao remendo - licao
-- `funcao-de-banco-redefinida-perde-melhoria-recente`.
--
-- O que muda em relacao a ela: a soma usa `private.valor_linha_pj`, a trava de
-- saida por linha entra, e o motivo de nao cobrar deixa de ser so excecao.
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
  v_descricao text;
  v_base_do_valor text;
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
         count(*) filter (
           where order_row.cancelled_at is null
             and order_row.dispatched_quantity is not null
         ) as conferidas,
         count(*) filter (
           where order_row.cancelled_at is null
             and private.valor_linha_pj(
                   order_row.quantity, order_row.dispatched_quantity,
                   order_row.unit_price, order_row.dispatched_at) is null
         ) as sem_valor,
         count(*) filter (
           where order_row.cancelled_at is null
             and private.veredito_valor_linha_pj(
                   order_row.quantity, order_row.dispatched_quantity,
                   order_row.pricing_unit) <> 'ok'
         ) as fora_da_trava,
         count(*) filter (
           where order_row.cancelled_at is null
             and order_row.dispatched_quantity is null
             and order_row.dispatched_at is not null
         ) as legado_sem_conferencia,
         -- Quantas linhas realmente entregaram alguma coisa, contando pela
         -- QUANTIDADE e nao pelo valor. Deduzir "nada saiu" de "valor zero"
         -- confunde pedido recusado na porta com pedido sem preco cadastrado,
         -- que sao problemas de pessoas diferentes.
         count(*) filter (
           where order_row.cancelled_at is null
             and coalesce(order_row.dispatched_quantity, order_row.quantity) > 0
         ) as linhas_com_saida,
         count(*) filter (
           where order_row.cancelled_at is null
             and coalesce(order_row.dispatched_quantity, order_row.quantity) > 0
             and coalesce(order_row.unit_price, 0) <= 0
         ) as linhas_sem_preco,
         (array_agg(order_row.customer_id order by order_row.id))[1] as customer_id,
         count(distinct order_row.customer_id) as clientes,
         private.data_na_padaria(max(order_row.dispatched_at)) as data_envio,
         max(coalesce(order_row.delivery_date, order_row.order_date)) as data_entrega,
         sum(order_row.quantity * coalesce(order_row.unit_price, 0)) as valor_estimado,
         sum(private.valor_linha_pj(
               order_row.quantity, order_row.dispatched_quantity,
               order_row.unit_price, order_row.dispatched_at)) as valor
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
  -- gerou, não criar uma segunda cobrança. Vem ANTES de qualquer trava de
  -- propósito: pedido que já virou cobrança continua respondendo o que sempre
  -- respondeu.
  select cobranca.id into v_receivable_id
  from public.receivables cobranca
  where cobranca.origin = 'pedido_pj'
    and cobranca.origin_ref = p_order_group_id
    and cobranca.status <> 'cancelada'
  limit 1;
  if v_receivable_id is not null then
    return v_receivable_id;
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
  -- do financeiro é acoplamento que quebra a padaria.
  if v_customer.payment_term_days is null then
    return null;
  end if;

  -- Nada conferido e nada enviado: o pedido espera a Expedição.
  if v_pedido.enviadas = 0 and v_pedido.sem_conferencia > 0 then
    raise exception using errcode = '22023',
      message = 'Este pedido ainda não foi conferido pela Expedição. Peça a conferência do que saiu antes de cobrar.';
  end if;

  -- A trava de saída. Não levanta exceção: o envio roda na mesma transação e
  -- abortá-lo prenderia a Expedição por causa de um problema do financeiro,
  -- que é a armadilha do bloqueador 4. O pedido fica na lista da Elis com o
  -- motivo.
  if v_pedido.fora_da_trava > 0 then
    return null;
  end if;

  -- Enviado depois do marco e sem conferência: é o buraco do cancelar-e-
  -- corrigir, e aqui ele para de virar dinheiro por adivinhação.
  if v_pedido.sem_valor > 0 then
    return null;
  end if;

  -- Nada saiu: fato legítimo (cliente recusou na porta), não erro de preço.
  -- Grava o envio, não gera cobrança, e o pedido aparece na lista. O critério é
  -- a QUANTIDADE, nunca o valor: um pedido inteiro sem preço cadastrado também
  -- soma zero, e chamar isso de "nada saiu" mandaria a Elis procurar a
  -- Expedição quando o problema é a tabela de preço dela.
  if v_pedido.linhas_com_saida = 0 then
    return null;
  end if;

  -- Item que saiu e não tem preço não pode sumir dentro da soma: sem isto, um
  -- pedido de dois itens em que um está sem preço vira cobrança pela metade,
  -- em silêncio.
  if v_pedido.linhas_sem_preco > 0 then
    raise exception using errcode = '22023',
      message = 'Pedido com item sem preço não vira cobrança. Confira a tabela de preço do cliente.';
  end if;

  if v_pedido.valor is null or v_pedido.valor <= 0 then
    raise exception using errcode = '22023',
      message = 'Pedido sem preço não vira cobrança. Confira a tabela de preço do cliente.';
  end if;

  -- A data do faturamento é o dia em que o pão saiu: o envio confirmado
  -- quando ele existe, a data de entrega combinada quando não existe.
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

  -- `base_do_valor` grava de qual número esta cobrança nasceu. Sem essa marca,
  -- a coorte de antes e depois da virada fica irreconciliável no relatório da
  -- fase 3.
  v_base_do_valor := case
    when v_pedido.legado_sem_conferencia > 0 then 'estimado_legado'
    else 'real_enviado'
  end;

  v_receivable_id := private.emitir_cobrancas(
    gen_random_uuid(), v_customer.id, 'pedido_pj', p_order_group_id, v_category_id,
    v_descricao, v_invoice_date, round(v_pedido.valor, 2), v_customer.payment_term_days,
    1, p_user_id,
    null, null,
    jsonb_build_object(
      'order_group_id', p_order_group_id,
      'dispatched', v_pedido.enviadas > 0,
      'base_do_valor', v_base_do_valor,
      'valor_estimado', round(coalesce(v_pedido.valor_estimado, 0), 2)
    )
  );

  return v_receivable_id;
end;
$$;

revoke all on function private.build_receivable_from_pj_order(uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A lista "a faturar" passa a dizer o motivo, e a somar o que saiu
-- ---------------------------------------------------------------------------
-- Some da lista seria pior: a Elis perderia de vista um pedido entregue e não
-- cobrado. O pedido continua à vista, com o motivo escrito e não selecionável.
--
-- `create or replace` não altera tipo de retorno, então é `drop` + `create`, e
-- o `drop` PERDE os grants (lição `grants-implicitos-variam-por-ambiente`).
-- ---------------------------------------------------------------------------
-- O motivo do bloqueio, num lugar so
-- ---------------------------------------------------------------------------
-- A lista mostra o motivo e a funcao publica precisa dele para dizer a verdade
-- a quem clicou. Escrever o mesmo CASE em dois lugares e o bloqueador 2 de
-- novo, com outra roupa: bastaria um deles mudar para a tela dizer uma coisa e
-- a cobranca fazer outra.
create or replace function private.motivo_bloqueio_cobranca_pj(p_order_group_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when pedido.linhas = 0 then 'pedido-inexistente'
    when pedido.dispatched_at is null and pedido.sem_conferencia > 0
      then 'aguardando-conferencia'
    when pedido.prazo is null then 'sem-prazo'
    when pedido.fora_da_trava > 0 then 'fora-da-trava'
    when pedido.sem_valor > 0 then 'sem-conferencia-depois-do-envio'
    when pedido.linhas_com_saida = 0 then 'nada-enviado'
    when pedido.linhas_sem_preco > 0 then 'item-sem-preco'
    else null
  end
  from (
    select count(*) as linhas,
           max(order_row.dispatched_at) as dispatched_at,
           max(customer.payment_term_days) as prazo,
           count(*) filter (
             where order_row.dispatched_quantity is null
               and order_row.cancelled_at is null
           ) as sem_conferencia,
           count(*) filter (
             where order_row.cancelled_at is null
               and private.valor_linha_pj(
                     order_row.quantity, order_row.dispatched_quantity,
                     order_row.unit_price, order_row.dispatched_at) is null
           ) as sem_valor,
           count(*) filter (
             where order_row.cancelled_at is null
               and private.veredito_valor_linha_pj(
                     order_row.quantity, order_row.dispatched_quantity,
                     order_row.pricing_unit) <> 'ok'
           ) as fora_da_trava,
           count(*) filter (
             where order_row.cancelled_at is null
               and coalesce(order_row.dispatched_quantity, order_row.quantity) > 0
           ) as linhas_com_saida,
           count(*) filter (
             where order_row.cancelled_at is null
               and coalesce(order_row.dispatched_quantity, order_row.quantity) > 0
               and coalesce(order_row.unit_price, 0) <= 0
           ) as linhas_sem_preco
    from public.orders order_row
    left join public.customers customer on customer.id = order_row.customer_id
    where order_row.order_group_id = p_order_group_id
      and order_row.order_type = 'pj'
      and order_row.cancelled_at is null
  ) pedido;
$$;

revoke all on function private.motivo_bloqueio_cobranca_pj(uuid)
  from public, anon, authenticated;

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
  amount_estimado numeric,
  motivo_bloqueio text
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
         -- O valor que a cobrança teria hoje. Quando alguma linha não tem valor
         -- cobrável, mostra a estimativa e o motivo explica por quê: número
         -- nenhum na tela é pior que número com etiqueta.
         case when pedido.sem_valor = 0
              then round(coalesce(pedido.valor, 0), 2)
              else round(coalesce(pedido.valor_estimado, 0), 2)
         end as amount,
         round(coalesce(pedido.valor_estimado, 0), 2) as amount_estimado,
         private.motivo_bloqueio_cobranca_pj(pedido.order_group_id) as motivo_bloqueio
  from (
    select order_row.order_group_id,
           (array_agg(order_row.customer_id order by order_row.id))[1] as customer_id,
           max(coalesce(order_row.delivery_date, order_row.order_date)) as delivery_date,
           max(order_row.dispatched_at) as dispatched_at,
           count(*)::int as items,
           sum(order_row.quantity * coalesce(order_row.unit_price, 0)) as valor_estimado,
           sum(private.valor_linha_pj(
                 order_row.quantity, order_row.dispatched_quantity,
                 order_row.unit_price, order_row.dispatched_at)) as valor,
           count(*) filter (
             where order_row.dispatched_quantity is null
               and order_row.cancelled_at is null
           ) as sem_conferencia,
           count(*) filter (
             where order_row.cancelled_at is null
               and order_row.dispatched_quantity is not null
           ) as conferidas,
           count(*) filter (
             where order_row.cancelled_at is null
               and private.valor_linha_pj(
                     order_row.quantity, order_row.dispatched_quantity,
                     order_row.unit_price, order_row.dispatched_at) is null
           ) as sem_valor,
           count(*) filter (
             where order_row.cancelled_at is null
               and private.veredito_valor_linha_pj(
                     order_row.quantity, order_row.dispatched_quantity,
                     order_row.pricing_unit) <> 'ok'
           ) as fora_da_trava,
           count(*) filter (
             where order_row.cancelled_at is null
               and coalesce(order_row.dispatched_quantity, order_row.quantity) > 0
           ) as linhas_com_saida
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
    and (pedido.valor_estimado > 0 or coalesce(pedido.valor, 0) > 0)
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
-- Corrigir a quantidade enviada depois do envio (metade B)
-- ---------------------------------------------------------------------------
-- A ordem aqui não é estilo, é obrigação: `guard_billed_pj_order_changes` cobre
-- `dispatched_quantity` e recusa qualquer UPDATE em pedido com cobrança viva.
-- Com a ordem invertida, a função barraria a si mesma.
--
-- O GUC `pane.pj_dispatch_rpc` é chave-mestra: ele também abre
-- `dispatched_at/by/by_name`. Por isso o UPDATE toca somente as duas colunas
-- pretendidas, e o pgTAP prova que o carimbo do envio não se moveu.
create or replace function public.corrigir_quantidade_enviada_pj(
  p_request_id uuid,
  p_order_group_id uuid,
  p_linhas jsonb,
  p_motivo text,
  p_expected_version timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_user_name text;
  v_linha record;
  v_atual record;
  v_cobranca record;
  v_recebido numeric(12,2);
  v_parcelas integer := 1;
  v_canceladas integer := 0;
  v_nova uuid;
  v_ja_registrado integer;
  v_motivo_linha text;
  v_versao_atual timestamptz;
  v_vencimentos jsonb;
  v_venc record;
  v_ajustadas integer := 0;
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador da correção obrigatório.';
  end if;
  if p_order_group_id is null then
    raise exception using errcode = '22023', message = 'Pedido obrigatório.';
  end if;
  if not private.current_user_can_fix_pj_dispatch() then
    raise exception using errcode = '42501',
      message = 'Sem permissão para corrigir a quantidade enviada.';
  end if;
  if nullif(trim(coalesce(p_motivo, '')), '') is null or length(trim(p_motivo)) < 3 then
    raise exception using errcode = '22023', message = 'Escreva o motivo da correção.';
  end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) = 0 then
    raise exception using errcode = '22023', message = 'Informe ao menos um item para corrigir.';
  end if;

  select profile.display_name into v_user_name
  from public.app_profiles profile
  where profile.user_id = v_user_id;

  -- Repetir a mesma requisição não refaz nada: a convenção de idempotência que
  -- as demais funções de Contas a Receber já seguem.
  select count(*) into v_ja_registrado
  from public.pj_order_quantity_checks historico
  where historico.request_id = p_request_id
    and historico.order_group_id = p_order_group_id;
  if v_ja_registrado > 0 then
    return jsonb_build_object('ja_aplicado', true, 'order_group_id', p_order_group_id);
  end if;

  -- O mesmo identificador em OUTRO pedido nao e repeticao, e sinal de engano:
  -- responder "ja aplicado" faria a tela dizer que corrigiu o que nao corrigiu.
  if exists (
    select 1 from public.pj_order_quantity_checks historico
    where historico.request_id = p_request_id
  ) then
    raise exception using errcode = '22023',
      message = 'Este identificador de correção já foi usado em outro pedido.';
  end if;

  perform 1
  from public.orders order_row
  where order_row.order_group_id = p_order_group_id
    and order_row.order_type = 'pj'
  for update;

  -- Tela desatualizada perde para quem está certo, e não para quem salvou por
  -- último: mesmo controle de versão que a conferência da fase 1 usa. A tela
  -- manda o carimbo que leu; se alguém corrigiu no meio, esta chamada para.
  select max(order_row.dispatched_quantity_at) into v_versao_atual
  from public.orders order_row
  where order_row.order_group_id = p_order_group_id
    and order_row.order_type = 'pj';

  if p_expected_version is not null and v_versao_atual is distinct from p_expected_version then
    raise exception using errcode = '40001',
      message = 'Alguém corrigiu este pedido enquanto a tela estava aberta. Recarregue e confira antes de salvar.';
  end if;

  -- Só faz sentido corrigir o que já foi enviado; antes disso a Expedição
  -- corrige sozinha, na tela dela.
  if not exists (
    select 1 from public.orders order_row
    where order_row.order_group_id = p_order_group_id
      and order_row.order_type = 'pj'
      and order_row.dispatched_at is not null
  ) then
    raise exception using errcode = '22023',
      message = 'Este pedido ainda não foi enviado. A Expedição corrige a conferência na tela dela.';
  end if;

  -- Dinheiro que entrou fecha a janela. Critério igual ao de
  -- `cancel_receivable`: conta o saldo ativo, e não qualquer passagem de
  -- dinheiro já estornada.
  for v_cobranca in
    select cobranca.id, cobranca.installment_count
    from public.receivables cobranca
    where cobranca.origin = 'pedido_pj'
      and cobranca.origin_ref = p_order_group_id
      and cobranca.status <> 'cancelada'
    for update
  loop
    v_recebido := private.receivable_recebido(v_cobranca.id);
    if v_recebido > 0 then
      raise exception using errcode = '22023',
        message = 'Este pedido já recebeu pagamento. Estorne o recebimento antes de corrigir a quantidade.';
    end if;
    v_parcelas := greatest(v_parcelas, coalesce(v_cobranca.installment_count, 1));
  end loop;

  -- Refazer um pedido parcelado passa por `split_receivable`, que exige
  -- `contas_receber.lancar`. Quem tivesse só a permissão nova cancelaria as
  -- parcelas e só descobriria a recusa no fim, com o pedido sem cobrança
  -- nenhuma. A pergunta vem antes de qualquer escrita.
  if v_parcelas > 1 and not private.current_user_can_receivables('contas_receber.lancar') then
    raise exception using errcode = '42501',
      message = 'Este pedido está parcelado, e refazer parcelas exige a permissão de lançar em Contas a receber. Peça ao financeiro.';
  end if;

  -- Guarda o vencimento efetivo de cada parcela ANTES de cancelar. Regerar usa
  -- o prazo atual do cadastro do cliente, então sem isto uma correção de
  -- quantidade mudaria silenciosamente a data combinada: basta a Elis ter
  -- corrigido o vencimento antes, ou o prazo do cliente ter mudado depois.
  select jsonb_agg(jsonb_build_object(
           'parcela', cobranca.installment_number,
           'vencimento', cobranca.due_date,
           'original', cobranca.original_due_date
         ) order by cobranca.installment_number)
    into v_vencimentos
  from public.receivables cobranca
  where cobranca.origin = 'pedido_pj'
    and cobranca.origin_ref = p_order_group_id
    and cobranca.status <> 'cancelada';

  -- Cancela TODAS as cobranças vivas do grupo. São várias porque
  -- `split_receivable` copia o `origin_ref` para cada parcela.
  for v_cobranca in
    select cobranca.id
    from public.receivables cobranca
    where cobranca.origin = 'pedido_pj'
      and cobranca.origin_ref = p_order_group_id
      and cobranca.status <> 'cancelada'
  loop
    update public.receivables
    set status = 'cancelada',
        cancel_reason = trim(p_motivo),
        cancelled_by = v_user_id,
        cancelled_at = now()
    where id = v_cobranca.id;

    insert into public.receivable_events (receivable_id, event_type, reason, details, created_by)
    values (
      v_cobranca.id, 'cancelada', trim(p_motivo),
      jsonb_build_object('request_id', p_request_id, 'origem', 'correcao_quantidade_enviada'),
      v_user_id
    );
    v_canceladas := v_canceladas + 1;
  end loop;

  -- DUAS chaves, e nao uma. `pane.pj_dispatch_rpc` libera mexer em pedido ja
  -- enviado; `pane.pj_check_rpc` libera escrever a conferencia. Sem a segunda,
  -- `guard_dispatched_quantity` recusa o UPDATE com 42501 e a correcao INTEIRA
  -- falha - achado do revisor adversarial em 2026-09-03, antes de ir ao ar.
  perform set_config('pane.pj_dispatch_rpc', 'on', true);
  perform set_config('pane.pj_check_rpc', 'on', true);

  for v_linha in
    select (item->>'order_id')::uuid as order_id,
           (item->>'dispatched_quantity')::numeric as dispatched_quantity,
           nullif(trim(coalesce(item->>'reason', '')), '') as reason
    from jsonb_array_elements(p_linhas) as item
  loop
    select order_row.id, order_row.quantity, order_row.dispatched_quantity,
           order_row.pricing_unit, order_row.order_group_id
      into v_atual
    from public.orders order_row
    where order_row.id = v_linha.order_id
      and order_row.order_type = 'pj';

    if v_atual.id is null or v_atual.order_group_id is distinct from p_order_group_id then
      raise exception using errcode = '22023',
        message = 'Um dos itens informados não pertence a este pedido.';
    end if;

    -- Mesma validação estrutural da entrada: negativo nunca, e fração só em
    -- item vendido por quilo.
    if v_linha.dispatched_quantity is null or v_linha.dispatched_quantity < 0 then
      raise exception using errcode = '22023',
        message = 'Quantidade inválida. Digite um número igual ou maior que zero.';
    end if;
    if coalesce(v_atual.pricing_unit, 'un') = 'un'
       and v_linha.dispatched_quantity <> trunc(v_linha.dispatched_quantity) then
      raise exception using errcode = '22023',
        message = 'Item vendido por unidade não aceita fração.';
    end if;
    if v_linha.dispatched_quantity = 0 and v_linha.reason is null then
      raise exception using errcode = '22023',
        message = 'Escreva por que este item não foi enviado.';
    end if;

    -- O motivo da CORRECAO vence o motivo antigo da conferencia. Guardar o
    -- texto velho faria o historico de uma cobranca contestada dizer "rendeu
    -- mais" quando a verdade e "a balanca estava com a bandeja".
    v_motivo_linha := coalesce(v_linha.reason, trim(p_motivo));

    insert into public.pj_order_quantity_checks (
      request_id, order_id, order_group_id, estimated_quantity,
      quantity_before, quantity_after, reason, created_by, created_by_name
    ) values (
      p_request_id, v_atual.id, p_order_group_id, v_atual.quantity,
      v_atual.dispatched_quantity, v_linha.dispatched_quantity,
      v_motivo_linha, v_user_id, v_user_name
    );

    update public.orders
    set dispatched_quantity = v_linha.dispatched_quantity,
        dispatched_quantity_reason = v_motivo_linha,
        dispatched_quantity_at = now(),
        dispatched_quantity_by = v_user_id,
        dispatched_quantity_by_name = v_user_name
    where id = v_atual.id;
  end loop;

  -- Chave-mestra fechada assim que o trabalho dela termina. Deixar aberta faria
  -- qualquer operacao seguinte da MESMA transacao herdar o direito de mexer em
  -- pedido enviado, inclusive no carimbo de quem enviou. E o mesmo cuidado que
  -- `save_pj_order_dispatch_quantities` ja toma.
  perform set_config('pane.pj_dispatch_rpc', '', true);
  perform set_config('pane.pj_check_rpc', '', true);

  -- Regera pelo mesmo motor, preservando o parcelamento que existia.
  v_nova := private.build_receivable_from_pj_order(p_order_group_id, v_user_id);

  if v_nova is not null and v_parcelas > 1 then
    perform public.split_receivable(gen_random_uuid(), v_nova, v_parcelas);
  end if;

  -- Devolve cada parcela ao vencimento que estava combinado. Só reaplica quando
  -- o desenho das parcelas é o mesmo; se mudou, mexer na data seria adivinhar,
  -- e o retorno avisa para a Elis conferir.
  if v_nova is not null and v_vencimentos is not null then
    for v_venc in
      select (item->>'parcela')::int as parcela, (item->>'vencimento')::date as vencimento
      from jsonb_array_elements(v_vencimentos) as item
    loop
      update public.receivables cobranca
      set due_date = v_venc.vencimento
      where cobranca.origin = 'pedido_pj'
        and cobranca.origin_ref = p_order_group_id
        and cobranca.status <> 'cancelada'
        and cobranca.installment_number = v_venc.parcela
        and cobranca.due_date is distinct from v_venc.vencimento;

      if found then
        v_ajustadas := v_ajustadas + 1;
        insert into public.receivable_events (receivable_id, event_type, reason, details, created_by)
        select cobranca.id, 'vencimento_corrigido',
               'vencimento preservado na correção da quantidade enviada',
               jsonb_build_object('request_id', p_request_id, 'parcela', v_venc.parcela),
               v_user_id
        from public.receivables cobranca
        where cobranca.origin = 'pedido_pj'
          and cobranca.origin_ref = p_order_group_id
          and cobranca.status <> 'cancelada'
          and cobranca.installment_number = v_venc.parcela;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'order_group_id', p_order_group_id,
    'cobrancas_canceladas', v_canceladas,
    'cobranca_nova', v_nova,
    'parcelas', v_parcelas,
    'vencimentos_preservados', v_ajustadas
  );
end;
$$;

revoke all on function public.corrigir_quantidade_enviada_pj(uuid, uuid, jsonb, text, timestamptz)
  from public, anon;
grant execute on function public.corrigir_quantidade_enviada_pj(uuid, uuid, jsonb, text, timestamptz)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Quem clica em "gerar cobranca" precisa ouvir o motivo certo
-- ---------------------------------------------------------------------------
-- Ate aqui esta funcao traduzia QUALQUER recusa do motor como "cliente sem
-- prazo", porque esse era o unico caso em que o motor devolvia nulo. A fase 2
-- acrescentou outros quatro, e sem esta mudanca a Elis leria "cadastre o prazo"
-- quando o problema e a conferencia, a trava ou o preco - mandando ela para a
-- tela errada. E o mesmo defeito de mensagem unica que a conferencia do
-- Romaneio ja ensinou em 26/08.
--
-- Redefinicao integral partindo da versao vigente, de
-- `20260813215830_pedido_pj_vira_cobranca.sql`, conferida por grep: nenhuma
-- outra migration a redefiniu desde entao.
create or replace function public.create_receivable_from_pj_order(
  p_request_id uuid,
  p_order_group_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receivable_id uuid;
  v_user_id uuid := (select auth.uid());
  v_motivo text;
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador da cobrança obrigatório.';
  end if;

  if not private.current_user_can_receivables('contas_receber.lancar') then
    raise exception using errcode = '42501', message = 'Sem permissão para lançar cobranças.';
  end if;

  v_receivable_id := private.build_receivable_from_pj_order(p_order_group_id, v_user_id);

  if v_receivable_id is null then
    v_motivo := private.motivo_bloqueio_cobranca_pj(p_order_group_id);
    raise exception using errcode = '22023', message = case v_motivo
      when 'aguardando-conferencia' then
        'Este pedido ainda não foi conferido pela Expedição. Peça a conferência do que saiu antes de cobrar.'
      when 'sem-prazo' then
        'Este cliente ainda não tem prazo de pagamento cadastrado. Defina o prazo na tela de Clientes antes de cobrar.'
      when 'fora-da-trava' then
        'A quantidade conferida está muito longe da pedida. Confira com a Expedição antes de cobrar.'
      when 'sem-conferencia-depois-do-envio' then
        'Este pedido saiu sem a conferência de algum item. Use "Corrigir quantidade enviada" em Pedidos PJ para registrar o que saiu.'
      when 'nada-enviado' then
        'A Expedição registrou que nada saiu neste pedido. Se foi recusa na porta, cancele o pedido.'
      when 'item-sem-preco' then
        'Este pedido tem item entregue sem preço. Confira a tabela de preço do cliente.'
      else
        'Este pedido ainda não pode virar cobrança. Confira a conferência da Expedição e o cadastro do cliente.'
    end;
  end if;

  return v_receivable_id;
end;
$$;

revoke all on function public.create_receivable_from_pj_order(uuid, uuid) from public, anon;
grant execute on function public.create_receivable_from_pj_order(uuid, uuid) to authenticated;

commit;
