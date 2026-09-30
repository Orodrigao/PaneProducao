-- Recusa por tela desatualizada sem repetição infinita no PostgREST.
--
-- Seis funções de Pedidos PJ e cobrança recusavam "alguém mudou o pedido
-- depois que a tela abriu" com o código 40001 (serialization_failure). O
-- PostgREST 14 (produção roda a 14.5) trata esse código como falha passageira
-- e repete a transação sozinho, sem limite. Como o conflito é o estado gravado,
-- toda repetição falha igual: a tela fica em "Salvando..." para sempre, a
-- operação segue repetindo mesmo depois que o navegador desiste (só para com
-- pg_terminate_backend) e segura as travas do pedido. Prova no PostgREST 14.5
-- local em 2026-09-30: 6.648 recusas em 10 segundos numa única chamada de
-- replace_pj_order_atomic_v2. O pgTAP não pega isso, porque roda direto no
-- banco, sem PostgREST. Achado na PR 467, que corrigiu a Configuração do
-- Sistema do mesmo jeito.
--
-- A recusa passa a usar PT409, código próprio que o PostgREST devolve como
-- HTTP 409 sem repetir. Cada função abaixo é a definição vigente, exportada
-- com pg_get_functiondef de um banco reconstruído pelas migrations e conferida
-- por md5 contra produção; a única diferença é o código da recusa. Mensagens,
-- regras, travas e permissões continuam iguais. O teste
-- supabase/tests/conflito_sem_repeticao.test.sql impede que 40001 volte.

begin;

-- Conferência da expedição PJ (implementação atrás de public.save_pj_order_dispatch_quantities).
CREATE OR REPLACE FUNCTION private.save_pj_order_dispatch_quantities_lock_order_impl(p_request_id uuid, p_order_group_id uuid, p_items jsonb, p_expected_version timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid;
  v_user_name text;
  v_agora timestamptz := now();
  v_versao_atual timestamptz;
  v_linhas integer;
  v_enviadas integer;
  v_cobrada boolean;
  v_item jsonb;
  v_order_id uuid;
  v_quantidade numeric;
  v_motivo text;
  v_linha record;
  v_veredito text;
  v_gravadas integer := 0;
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador da conferência obrigatório.';
  end if;
  if p_order_group_id is null then
    raise exception using errcode = '22023', message = 'Pedido obrigatório.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = '22023', message = 'Nenhum item para conferir.';
  end if;

  -- Mesma porta da confirmação de envio: Expedição de JC com a permissão
  -- granular. Quem confere é quem separa.
  select profile.user_id, profile.display_name
  into v_user_id, v_user_name
  from public.app_profiles profile
  where profile.user_id = (select auth.uid())
    and profile.active
    and profile.role = 'expedicao'
    and profile.store = 'jc'
    and exists (
      select 1
      from public.app_user_permissions assignment
      where assignment.user_id = profile.user_id
        and assignment.permission_key = 'pedidos_pj.confirmar_envio'
        and assignment.scope in ('*', 'jc')
    );

  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Sem permissão para conferir este pedido.';
  end if;

  perform 1
  from public.orders order_row
  where order_row.order_group_id = p_order_group_id
    and order_row.order_type = 'pj'
  for update;

  -- Já gravado com esta mesma requisição: devolve o estado atual sem escrever
  -- de novo e sem criar histórico duplicado.
  --
  -- A checagem vem DEPOIS do `for update`, e não antes: duas chamadas iguais
  -- simultâneas passariam as duas pela consulta e a segunda terminaria em
  -- colisão de chave em vez de devolver o mesmo sucesso.
  if exists (
    select 1 from public.pj_order_quantity_checks registro
    where registro.request_id = p_request_id
  ) then
    return private.resumo_conferencia_pj(p_order_group_id);
  end if;

  select count(*),
         count(*) filter (where order_row.dispatched_at is not null),
         max(order_row.dispatched_quantity_at)
    into v_linhas, v_enviadas, v_versao_atual
  from public.orders order_row
  where order_row.order_group_id = p_order_group_id
    and order_row.order_type = 'pj'
    and order_row.cancelled_at is null;

  if v_linhas = 0 then
    raise exception using errcode = 'P0002', message = 'Pedido PJ não encontrado.';
  end if;

  if v_enviadas > 0 then
    raise exception using errcode = '22023',
      message = 'Este pedido já foi marcado como enviado. A conferência não pode mais ser alterada aqui.';
  end if;

  -- Pedido já cobrado é recusado com mensagem própria: sem isso, quem confere
  -- receberia a mensagem do gatilho, que fala de cancelar cobrança e não diz o
  -- que fazer com a conferência.
  select exists (
    select 1 from public.receivables cobranca
    where cobranca.origin = 'pedido_pj'
      and cobranca.origin_ref = p_order_group_id
      and cobranca.status <> 'cancelada'
  ) into v_cobrada;

  if v_cobrada then
    raise exception using errcode = '22023',
      message = 'Este pedido já virou cobrança e não aceita mais conferência. Avise o financeiro.';
  end if;

  -- Tela desatualizada: alguém gravou entre abrir e salvar.
  if coalesce(v_versao_atual, '-infinity'::timestamptz)
     <> coalesce(p_expected_version, '-infinity'::timestamptz) then
    raise exception using errcode = 'PT409',
      message = 'Outra pessoa conferiu este pedido enquanto você preenchia. Recarregue para ver o que já foi gravado.';
  end if;

  -- Abre a porta protegida da conferência para esta transação. O gatilho lá
  -- embaixo recusa qualquer escrita nas colunas de conferência sem ela, para
  -- que autoria e horário não possam ser forjados pela Data API por um perfil
  -- com UPDATE em `orders`.
  perform set_config('pane.pj_check_rpc', 'on', true);

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode = '22023', message = 'Item de conferência em formato inválido.';
    end if;

    v_order_id := nullif(v_item ->> 'order_id', '')::uuid;
    v_motivo := nullif(trim(coalesce(v_item ->> 'reason', '')), '');

    if v_order_id is null then
      raise exception using errcode = '22023', message = 'Item de conferência sem identificação da linha.';
    end if;

    if jsonb_typeof(v_item -> 'quantity') = 'null' or (v_item -> 'quantity') is null then
      v_quantidade := null;
    else
      begin
        v_quantidade := (v_item ->> 'quantity')::numeric;
      exception when others then
        raise exception using errcode = '22023', message = 'Quantidade conferida inválida.';
      end;
    end if;

    select order_row.id, order_row.quantity, order_row.pricing_unit,
           order_row.product_name, order_row.bread_id, order_row.dispatched_quantity
      into v_linha
    from public.orders order_row
    where order_row.id = v_order_id
      and order_row.order_group_id = p_order_group_id
      and order_row.order_type = 'pj'
      and order_row.cancelled_at is null;

    if v_linha.id is null then
      raise exception using errcode = 'P0002',
        message = 'Uma das linhas conferidas não pertence a este pedido.';
    end if;

    v_veredito := private.veredito_quantidade_enviada(
      v_linha.quantity, v_quantidade, v_linha.pricing_unit
    );

    if v_veredito = 'recusado' then
      raise exception using errcode = '22023',
        message = format(
          'A quantidade conferida de %s está fora do aceitável para um pedido de %s. Confira a unidade e o número antes de salvar.',
          coalesce(v_linha.product_name, v_linha.bread_id, 'um item'),
          trim(to_char(v_linha.quantity, 'FM999999990.999'))
        );
    end if;

    if v_veredito = 'exige_motivo' and v_motivo is null then
      raise exception using errcode = '22023',
        message = format(
          'A quantidade de %s difere bastante do pedido. Escreva o motivo antes de salvar.',
          coalesce(v_linha.product_name, v_linha.bread_id, 'um item')
        );
    end if;

    insert into public.pj_order_quantity_checks (
      request_id, order_id, order_group_id, estimated_quantity,
      quantity_before, quantity_after, reason, created_by, created_by_name
    )
    values (
      p_request_id, v_linha.id, p_order_group_id, v_linha.quantity,
      v_linha.dispatched_quantity, v_quantidade, v_motivo, v_user_id, v_user_name
    );

      update public.orders
    set dispatched_quantity = v_quantidade,
        dispatched_quantity_reason = v_motivo,
        dispatched_quantity_at = case when v_quantidade is null then null else v_agora end,
        dispatched_quantity_by = case when v_quantidade is null then null else v_user_id end,
        dispatched_quantity_by_name = case when v_quantidade is null then null else v_user_name end
    where id = v_linha.id;

    v_gravadas := v_gravadas + 1;
  end loop;

  if v_gravadas = 0 then
    raise exception using errcode = '22023', message = 'Nenhum item para conferir.';
  end if;

  -- Fecha a porta ao sair. `set_config(..., true)` vale ate o fim da
  -- transacao: via PostgREST cada chamada e uma transacao propria, mas deixar
  -- aberta emprestaria a chave a qualquer escrita que viesse depois na mesma
  -- transacao — inclusive num teste, que roda tudo numa so.
  perform set_config('pane.pj_check_rpc', '', true);

  return private.resumo_conferencia_pj(p_order_group_id);
end;
$function$;

-- Edição do Pedido PJ (implementação atrás de public.replace_pj_order_atomic_v2).
CREATE OR REPLACE FUNCTION public.replace_pj_order_atomic_v2_impl(p_request_id uuid, p_order_group_id uuid, p_rows jsonb, p_expected_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_existing private.pj_order_write_requests%rowtype;
  v_flow private.pj_flow%rowtype;
  v_item jsonb;
  v_payload jsonb;
  v_result jsonb;
  v_count integer;
  v_expected_count integer;
  v_unique_count integer;
  v_flow_enabled boolean := false;
begin
  perform private.assert_pj_order_write_access();
  if p_request_id is null or p_order_group_id is null then
    raise exception using errcode = '22023',
      message = 'Pedido e identificador da tentativa sao obrigatorios.';
  end if;

  v_payload := jsonb_build_object('rows', p_rows, 'expected_rows', p_expected_rows);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pane-pj-write:' || p_request_id::text, 0)
  );
  select * into v_existing
  from private.pj_order_write_requests
  where request_id = p_request_id;
  if found then
    if v_existing.actor <> auth.uid() or v_existing.action <> 'replace_v2'
      or v_existing.order_group_id <> p_order_group_id
      or v_existing.request_payload is distinct from v_payload then
      raise exception using errcode = '22023',
        message = 'Identificador ja usado para outra operacao.';
    end if;
    return v_existing.result || jsonb_build_object('repeated', true);
  end if;

  if jsonb_typeof(p_expected_rows) <> 'array'
    or jsonb_array_length(p_expected_rows) < 1
    or jsonb_array_length(p_expected_rows) > 100 then
    raise exception using errcode = '22023',
      message = 'A versao anterior do pedido e obrigatoria.';
  end if;
  v_expected_count := jsonb_array_length(p_expected_rows);
  for v_item in select value from jsonb_array_elements(p_expected_rows)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or not (v_item ? 'id') or not (v_item ? 'updated_at')
      or nullif(v_item->>'id', '') is null
      or (v_item - array['id', 'updated_at']) <> '{}'::jsonb then
      raise exception using errcode = '22023',
        message = 'A versao anterior do pedido e invalida.';
    end if;
    begin
      perform (v_item->>'id')::uuid;
      perform (v_item->>'updated_at')::timestamptz;
    exception when others then
      raise exception using errcode = '22023',
        message = 'A versao anterior do pedido e invalida.';
    end;
  end loop;
  select count(distinct value->>'id')
  into v_unique_count
  from jsonb_array_elements(p_expected_rows);
  if v_unique_count <> v_expected_count then
    raise exception using errcode = '22023',
      message = 'A versao anterior do pedido e invalida.';
  end if;

  -- Mantem a ordem de travas dos demais contratos: fluxo antes das linhas.
  select * into v_flow
  from private.pj_flow
  where order_group_id = p_order_group_id
  for update;
  v_flow_enabled := found;
  if v_flow_enabled and not private.pj_flow_commercial() then
    raise exception using errcode = '42501',
      message = 'Sem permissao para alterar este pedido da nova jornada PJ.';
  end if;
  if v_flow_enabled and (
    v_flow.version <> 0
    or v_flow.checked_at is not null
    or v_flow.released_at is not null
    or v_flow.departed_at is not null
    or exists (
      select 1 from private.pj_flow_events
      where order_group_id = p_order_group_id
    )
  ) then
    raise exception using errcode = '22023',
      message = 'Pedido que ja iniciou a conferencia nao pode ser alterado aqui.';
  end if;

  perform 1
  from public.orders
  where order_group_id = p_order_group_id
  order by id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Pedido PJ nao encontrado.';
  end if;
  if exists (
    select 1 from public.orders
    where order_group_id = p_order_group_id and order_type <> 'pj'
  ) then
    raise exception using errcode = '22023',
      message = 'O grupo informado nao e um Pedido PJ valido.';
  end if;
  if exists (
    select 1 from public.orders
    where order_group_id = p_order_group_id
      and (
        cancelled_at is not null
        or dispatched_at is not null
        or production_date is not null
        or dispatched_quantity is not null
        or dispatched_quantity_reason is not null
        or dispatched_quantity_at is not null
        or dispatched_quantity_by is not null
        or dispatched_quantity_by_name is not null
      )
  ) or exists (
    select 1
    from public.pj_order_quantity_checks q
    join public.orders o on o.id = q.order_id
    where o.order_group_id = p_order_group_id
  ) or exists (
    select 1
    from public.pj_production_schedules s
    join public.orders o on o.id = s.order_id
    where o.order_group_id = p_order_group_id
  ) or exists (
    select 1 from public.receivables
    where origin = 'pedido_pj' and origin_ref = p_order_group_id
  ) then
    raise exception using errcode = '22023',
      message = 'Pedido que ja entrou na operacao ou no financeiro nao pode ser alterado.';
  end if;

  select count(*) into v_count
  from public.orders
  where order_group_id = p_order_group_id;
  if v_count <> v_expected_count or exists (
    select 1
    from public.orders o
    where o.order_group_id = p_order_group_id
      and not exists (
        select 1
        from jsonb_array_elements(p_expected_rows) expected(value)
        where (expected.value->>'id')::uuid = o.id
          and ((expected.value->>'updated_at')::timestamptz is not distinct from o.updated_at)
      )
  ) then
    raise exception using errcode = 'PT409',
      message = 'Pedido mudou; recarregue antes de salvar novamente.';
  end if;

  perform private.assert_pj_order_payload(p_order_group_id, p_rows, false);
  perform set_config('pane.pj_order_write', p_order_group_id::text, true);
  delete from public.orders where order_group_id = p_order_group_id;
  v_count := private.insert_pj_order_rows(p_order_group_id, p_rows);
  perform set_config('pane.pj_order_write', '', true);

  v_result := jsonb_build_object(
    'repeated', false,
    'order_group_id', p_order_group_id,
    'row_count', v_count,
    'flow_enabled', v_flow_enabled
  );
  insert into private.pj_order_write_requests(
    request_id, actor, action, order_group_id, request_payload, result
  ) values (
    p_request_id, auth.uid(), 'replace_v2', p_order_group_id, v_payload, v_result
  );
  return v_result;
end;
$function$;

-- Correção da quantidade enviada depois da saída.
CREATE OR REPLACE FUNCTION public.corrigir_quantidade_enviada_pj(p_request_id uuid, p_order_group_id uuid, p_linhas jsonb, p_motivo text, p_expected_version timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform private.lock_financial_request(p_request_id);
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
    raise exception using errcode = 'PT409',
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
$function$;

-- Jornada PJ: conferir, revisar e liberar (versão velha e prazo do cliente mudado).
CREATE OR REPLACE FUNCTION public.transition_pj_flow_pilot(p_request_id uuid, p_order_group_id uuid, p_expected_version integer, p_action text, p_items jsonb DEFAULT '[]'::jsonb, p_nf_confirmed boolean DEFAULT false, p_review_term_days integer DEFAULT NULL::integer, p_credit_amount numeric DEFAULT 0, p_credit_source_group_id uuid DEFAULT NULL::uuid, p_credit_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_flow private.pj_flow%rowtype; v_request private.pj_flow_events%rowtype;
  v_payload jsonb; v_row record; v_item jsonb; v_quantity numeric; v_reason text;
  v_now timestamptz:=clock_timestamp(); v_user uuid:=auth.uid(); v_name text;
  v_total numeric(12,2); v_net numeric(12,2); v_credit numeric(12,2);
  v_received numeric(12,2); v_date date; v_invoice date; v_term integer;
  v_customer uuid; v_category uuid; v_bill uuid; v_plan jsonb; v_count integer:=1;
  v_base numeric(12,2); v_remainder numeric(12,2); v_resolution uuid; v_resolved numeric(12,2);
begin
  if p_request_id is null or p_order_group_id is null or p_expected_version is null
    or p_action is null or p_action not in ('save','check','release','depart') then
    raise exception using errcode='22023',message='Acao, pedido, versao e identificador sao obrigatorios.';
  end if;
  if (p_action='release' and not(private.pj_flow_commercial() and private.pj_flow_permission('pedidos_pj.liberar')
      and private.pj_flow_permission('contas_receber.lancar')))
    or (p_action<>'release' and not private.pj_flow_expedition()) then
    raise exception using errcode='42501',message='Sem permissao para esta acao no piloto PJ.';
  end if;
  select * into v_flow from private.pj_flow where order_group_id=p_order_group_id for update;
  if not found then raise exception using errcode='22023',message='Novo fluxo indisponivel para este pedido. Nenhuma acao foi realizada.'; end if;
  v_credit:=round(coalesce(p_credit_amount,0),2);
  v_payload:=jsonb_build_object('items',p_items,'nf',p_nf_confirmed,'expected',p_expected_version,
    'term',p_review_term_days,'credit_amount',v_credit,'credit_source',p_credit_source_group_id,
    'credit_reason',nullif(trim(coalesce(p_credit_reason,'')),''));
  select * into v_request from private.pj_flow_events where request_id=p_request_id;
  if found then
    if v_request.order_group_id<>p_order_group_id or v_request.actor<>v_user
      or v_request.action<>p_action or v_request.payload is distinct from v_payload then
      raise exception using errcode='22023',message='Identificador ja usado para outra operacao.';
    end if;
    return jsonb_build_object('repeated',true,'version',v_flow.version);
  end if;
  if v_flow.version<>p_expected_version then raise exception using errcode='PT409',message='O pedido mudou. Recarregue e revise a versao atual.'; end if;
  if v_flow.departed_at is not null then raise exception using errcode='22023',message='Saida ja registrada. Tratamento posterior esta fora deste piloto.'; end if;
  perform 1 from public.orders where order_group_id=p_order_group_id order by id for update;
  if not exists(select 1 from public.orders where order_group_id=p_order_group_id)
    or exists(select 1 from public.orders where order_group_id=p_order_group_id
      and(order_type<>'pj' or cancelled_at is not null or dispatched_at is not null)) then
    raise exception using errcode='22023',message='Pedido invalido ou pertencente ao fluxo legado.';
  end if;
  select display_name into v_name from public.app_profiles where user_id=v_user;
  if p_action='save' then
    if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
      raise exception using errcode='22023',message='Informe os itens conferidos.';
    end if;
    if(select count(*) from jsonb_array_elements(p_items))<>(select count(distinct i->>'id') from jsonb_array_elements(p_items)i) then
      raise exception using errcode='22023',message='Item repetido na conferencia.';
    end if;
    perform set_config('pane.pj_flow_check',p_order_group_id::text,true); perform set_config('pane.pj_check_rpc','on',true);
    for v_item in select * from jsonb_array_elements(p_items) loop
      select * into v_row from public.orders where id=(v_item->>'id')::uuid and order_group_id=p_order_group_id;
      if not found then raise exception using errcode='22023',message='Item nao pertence ao pedido.'; end if;
      v_quantity:=(v_item->>'quantity')::numeric; v_reason:=nullif(trim(v_item->>'reason'),'');
      if v_quantity is not null and(v_quantity::text in('NaN','Infinity','-Infinity') or v_quantity<0 or round(v_quantity,3)<>v_quantity) then
        raise exception using errcode='22023',message='Quantidade invalida: use ate tres casas decimais.';
      end if;
      update public.orders set dispatched_quantity=v_quantity,dispatched_quantity_reason=v_reason,
        dispatched_quantity_at=v_now,dispatched_quantity_by=v_user,dispatched_quantity_by_name=v_name where id=v_row.id;
    end loop;
    perform set_config('pane.pj_flow_check','',true); perform set_config('pane.pj_check_rpc','',true);
    update private.pj_flow set version=version+1,checked_at=null,checked_by=null,released_at=null,
      released_by=null,released_version=null,credit_applied_amount=0,credit_source_group_id=null,
      credit_reason=null,excess_resolution_id=null where order_group_id=p_order_group_id;
  elsif p_action='check' then
    if exists(select 1 from public.orders where order_group_id=p_order_group_id and dispatched_quantity is null) then
      raise exception using errcode='22023',message='Confira todos os itens antes de concluir.';
    end if;
    if v_flow.checked_at is not null then raise exception using errcode='22023',message='Conferencia ja concluida. Salve uma correcao para reabrir.'; end if;
    update private.pj_flow set version=version+1,checked_at=v_now,checked_by=v_user where order_group_id=p_order_group_id;
  elsif p_action='release' then
    if p_nf_confirmed is distinct from true or v_flow.checked_at is null then
      raise exception using errcode='22023',message='Conclua a conferencia e confirme a NF emitida externamente.';
    end if;
    if v_flow.released_at is not null then raise exception using errcode='22023',message='Esta versao ja esta liberada.'; end if;
    if(select count(distinct customer_id) from public.orders where order_group_id=p_order_group_id)<>1
      or exists(select 1 from public.orders where order_group_id=p_order_group_id and(customer_id is null or delivery_date is null))
      or(select count(distinct delivery_date) from public.orders where order_group_id=p_order_group_id)<>1 then
      raise exception using errcode='22023',message='Cliente e data combinada precisam estar definidos no pedido inteiro.';
    end if;
    if exists(select 1 from public.orders o where o.order_group_id=p_order_group_id and
      (o.dispatched_quantity is null or private.veredito_valor_linha_pj(o.quantity,o.dispatched_quantity,o.pricing_unit)<>'ok'
        or(o.dispatched_quantity>0 and(o.unit_price is null or o.unit_price<=0)))) then
      raise exception using errcode='22023',message='Revise as quantidades e os precos antes de cobrar.';
    end if;
    select round(sum(private.valor_linha_pj(quantity,dispatched_quantity,unit_price,null)),2),min(delivery_date),min(customer_id::text)::uuid
      into v_total,v_date,v_customer from public.orders where order_group_id=p_order_group_id;
    if v_total is null or v_total<=0 or v_total>1000000 then
      raise exception using errcode='22023',message='Pedido sem produtos para cobrar permanece pendente; nao pode sair.';
    end if;
    select payment_term_days into v_term from public.customers where id=v_customer and active;
    if v_term is null then raise exception using errcode='22023',message='Defina o cliente ativo e seu prazo de pagamento antes de liberar.'; end if;
    if v_term is distinct from p_review_term_days then raise exception using errcode='PT409',message='O prazo do cliente mudou. Recarregue e revise o vencimento antes de liberar.'; end if;
    if v_credit<0 or v_credit>v_total then raise exception using errcode='22023',message='O credito precisa ficar entre zero e o valor dos produtos.'; end if;
    if v_credit=0 and(p_credit_source_group_id is not null or nullif(trim(coalesce(p_credit_reason,'')),'') is not null)
      or v_credit>0 and(p_credit_source_group_id is null or length(trim(coalesce(p_credit_reason,'')))<3) then
      raise exception using errcode='22023',message='Credito exige valor, pedido de origem e justificativa.';
    end if;
    perform 1 from public.receivables where origin='pedido_pj' and origin_ref=p_order_group_id order by id for update;
    select coalesce(sum(rr.amount),0) into v_received from public.receivable_receipts rr join public.receivables r on r.id=rr.receivable_id
      where r.origin='pedido_pj' and r.origin_ref=p_order_group_id and rr.reversed_at is null;
    if v_received>0 and v_credit>0 then raise exception using errcode='22023',message='Pedido que ja recebeu dinheiro nao pode aplicar outro credito.'; end if;
    if v_credit>0 then
      perform 1 from private.pj_flow where order_group_id=p_credit_source_group_id for update;
      if not exists(select 1 from private.pj_flow sf
        where sf.order_group_id=p_credit_source_group_id and sf.departed_at is not null
          and(select coalesce(sum(sx.amount),0) from private.pj_flow_excess_resolutions sx
            where sx.order_group_id=sf.order_group_id and sx.kind='credit')>=v_credit
          and(select min(o.customer_id::text)::uuid from public.orders o where o.order_group_id=sf.order_group_id)=v_customer)
        or exists(select 1 from private.pj_flow used where used.credit_source_group_id=p_credit_source_group_id
          and used.order_group_id<>p_order_group_id) then
        raise exception using errcode='22023',message='O credito de origem nao esta disponivel para este cliente.';
      end if;
    end if;
    v_net:=v_total-v_credit;
    select coalesce(sum(amount),0) into v_resolved from private.pj_flow_excess_resolutions where order_group_id=p_order_group_id;
    if v_resolved<>greatest(v_received-v_total,0) then
      raise exception using errcode='22023',message='Trate o valor recebido a mais por devolucao Pix ou credito antes de liberar.';
    end if;
    select request_id into v_resolution from private.pj_flow_excess_resolutions where order_group_id=p_order_group_id
      order by created_at desc limit 1;
    if v_flow.receivable_id is not null then
      select jsonb_agg(jsonb_build_object('number',installment_number,'due',due_date,'original',original_due_date)
        order by installment_number),count(*) into v_plan,v_count from public.receivables
        where origin='pedido_pj' and origin_ref=p_order_group_id and status<>'cancelada';
    end if;
    if v_received>0 and v_count>1 then
      raise exception using errcode='22023',message='Correcao de pedido parcelado que ja recebeu dinheiro exige tratamento manual do Financeiro.';
    end if;
    perform set_config('pane.pj_flow_release',p_order_group_id::text,true);
    if v_received>0 then
      if v_count<1 or v_total<v_count*0.01 then raise exception using errcode='22023',message='O novo valor nao comporta as parcelas existentes.'; end if;
      v_base:=trunc((v_total*100)/v_count)/100; v_remainder:=v_total-(v_base*v_count);
      for v_row in select id,installment_number,amount from public.receivables where origin='pedido_pj'
        and origin_ref=p_order_group_id and status<>'cancelada' order by installment_number loop
        update public.receivables set amount=v_base+case when v_row.installment_number=1 then v_remainder else 0 end where id=v_row.id;
        perform private.atualizar_situacao_receivable(v_row.id);
        insert into public.receivable_events(receivable_id,event_type,reason,details,created_by)
          values(v_row.id,'valor_corrigido_pj','Nova conferencia apos pagamento',jsonb_build_object(
            'de',v_row.amount,'para',v_base+case when v_row.installment_number=1 then v_remainder else 0 end,
            'flow_version',v_flow.version+1,'excess_resolution_id',v_resolution),v_user);
      end loop;
      v_bill:=v_flow.receivable_id;
    else
      for v_row in select id from public.receivables where origin='pedido_pj' and origin_ref=p_order_group_id and status<>'cancelada' loop
        update public.receivables set status='cancelada',cancelled_at=v_now,cancelled_by=v_user,
          cancel_reason='Substituida apos nova conferencia e revisao PJ.' where id=v_row.id;
        insert into public.receivable_events(receivable_id,event_type,reason,created_by)
          values(v_row.id,'cancelada','Substituida na nova revisao PJ.',v_user);
      end loop;
      if v_net>0 then
        select id into v_category from public.finance_categories where key='clientes_pj' and active;
        if v_category is null then raise exception 'Categoria de clientes PJ indisponivel.'; end if;
        v_count:=greatest(coalesce(v_count,1),1);
        if v_net<v_count*0.01 then raise exception using errcode='22023',message='O valor liquido nao comporta as parcelas acordadas.'; end if;
        v_invoice:=least(v_date,private.data_na_padaria());
        v_bill:=private.emitir_cobrancas(p_request_id,v_customer,'pedido_pj',p_order_group_id,v_category,
          'Pedido PJ · entrega combinada '||to_char(v_date,'DD/MM/YYYY'),v_invoice,v_net,
          case when v_plan is null then(v_date+v_term)-v_invoice else v_count end,v_count,v_user,null,null,
          jsonb_build_object('base_do_valor','real_conferido_aprovado','gross_amount',v_total,
            'credit_amount',v_credit,'credit_source_group_id',p_credit_source_group_id,'agreed_date',v_date,
            'payment_term_days',v_term,'nf_confirmed',true,'flow_version',v_flow.version+1));
        if v_plan is not null then
          update public.receivables r set due_date=(a->>'due')::date,original_due_date=(a->>'original')::date
          from jsonb_array_elements(v_plan)a where r.origin='pedido_pj' and r.origin_ref=p_order_group_id
            and r.status<>'cancelada' and r.installment_number=(a->>'number')::integer;
          update public.receivable_events e set details=e.details||jsonb_build_object('due_date',r.due_date)
          from public.receivables r where e.receivable_id=r.id and e.event_type='lancada'
            and r.origin='pedido_pj' and r.origin_ref=p_order_group_id and r.status<>'cancelada'
            and e.details->>'flow_version'=(v_flow.version+1)::text;
        end if;
      else v_bill:=null;
      end if;
    end if;
    perform set_config('pane.pj_flow_release','',true);
    update private.pj_flow set version=version+1,released_version=version+1,released_at=v_now,
      released_by=v_user,receivable_id=v_bill,approved_amount=v_total,agreed_date=v_date,
      credit_applied_amount=v_credit,credit_source_group_id=p_credit_source_group_id,
      credit_reason=case when v_credit>0 then trim(p_credit_reason) end,excess_resolution_id=v_resolution
      where order_group_id=p_order_group_id;
  else
    perform 1 from public.receivables where origin='pedido_pj' and origin_ref=p_order_group_id order by id for update;
    if v_flow.released_at is null or v_flow.released_version<>v_flow.version or not private.pj_flow_billing_valid(p_order_group_id) then
      raise exception using errcode='22023',message='Saida bloqueada. Aguarde nova liberacao de Elis.';
    end if;
    update private.pj_flow set departed_at=v_now,departed_by=v_user where order_group_id=p_order_group_id;
  end if;
  select version into v_flow.version from private.pj_flow where order_group_id=p_order_group_id;
  insert into private.pj_flow_events(request_id,order_group_id,actor,action,payload,version)
    values(p_request_id,p_order_group_id,v_user,p_action,v_payload,v_flow.version);
  return jsonb_build_object('repeated',false,'version',v_flow.version);
end;
$function$;

-- Jornada PJ: vencimento e parcelas.
CREATE OR REPLACE FUNCTION public.change_pj_flow_terms(p_request_id uuid, p_order_group_id uuid, p_expected_version integer, p_action text, p_receivable_id uuid, p_due_date date DEFAULT NULL::date, p_installments integer DEFAULT NULL::integer, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_flow private.pj_flow%rowtype;
  v_event private.pj_flow_events%rowtype;
  v_bill public.receivables%rowtype;
  v_payload jsonb;
  v_before jsonb;
  v_after jsonb;
  v_user uuid := auth.uid();
  v_reason text := nullif(trim(p_reason),'');
  v_days integer;
  v_base numeric(12,2);
  v_remainder numeric(12,2);
  v_due date;
  i integer;
begin
  if p_request_id is null or p_order_group_id is null or p_expected_version is null
    or p_receivable_id is null or p_action is null or p_action not in ('due','split') then
    raise exception using errcode='22023',message='Pedido, cobrança, versão e ação são obrigatórios.';
  end if;
  if not (private.pj_flow_commercial() and private.pj_flow_permission('pedidos_pj.liberar')
    and private.pj_flow_permission(case when p_action='due' then 'contas_receber.corrigir_vencimento' else 'contas_receber.lancar' end)) then
    raise exception using errcode='42501',message='Sem permissão para alterar estas condições de cobrança PJ.';
  end if;
  if v_reason is null or length(v_reason)<3 or length(v_reason)>500 then
    raise exception using errcode='22023',message='Informe uma justificativa de 3 a 500 caracteres.';
  end if;
  select * into v_flow from private.pj_flow where order_group_id=p_order_group_id for update;
  if not found then raise exception using errcode='22023',message='Pedido fora desta jornada.'; end if;
  v_payload:=jsonb_build_object('expected',p_expected_version,'bill',p_receivable_id,'due',p_due_date,
    'installments',p_installments,'reason',v_reason);
  select * into v_event from private.pj_flow_events where request_id=p_request_id;
  if found then
    if v_event.order_group_id<>p_order_group_id or v_event.actor<>v_user or v_event.action<>p_action
      or (v_event.payload-'before'-'after') is distinct from v_payload then
      raise exception using errcode='22023',message='Identificador já usado para outra operação.';
    end if;
    return jsonb_build_object('repeated',true,'version',v_flow.version);
  end if;
  if v_flow.version<>p_expected_version then
    raise exception using errcode='PT409',message='O pedido mudou. Recarregue antes de alterar a cobrança.';
  end if;
  perform 1 from public.receivables where origin='pedido_pj' and origin_ref=p_order_group_id order by id for update;
  if not private.pj_flow_billing_valid(p_order_group_id) then
    raise exception using errcode='22023',message='Conjunto de cobranças inconsistente. Revise antes de alterar condições.';
  end if;
  select * into v_bill from public.receivables where id=p_receivable_id
    and origin='pedido_pj' and origin_ref=p_order_group_id and status<>'cancelada';
  if not found then raise exception using errcode='22023',message='Esta cobrança não pertence ao pedido ativo.'; end if;
  select jsonb_agg(jsonb_build_object('id',id,'number',installment_number,'count',installment_count,
    'amount',amount,'due_date',due_date,'original_due_date',original_due_date) order by installment_number)
    into v_before from public.receivables where origin='pedido_pj' and origin_ref=p_order_group_id and status<>'cancelada';

  if p_action='due' then
    if v_bill.status not in ('aberta','parcial') or p_due_date is null or p_installments is not null then
      raise exception using errcode='22023',message='Escolha uma cobrança aberta ou parcial e informe o novo vencimento.';
    end if;
    -- Mesmos limites do contrato existente de correção de vencimento.
    if p_due_date<v_bill.original_due_date or p_due_date>v_bill.invoice_date+365 then
      raise exception using errcode='22023',message='Use uma data a partir do vencimento original e até um ano do faturamento.';
    end if;
    if p_due_date=v_bill.due_date then raise exception using errcode='22023',message='Informe uma data diferente do vencimento atual.'; end if;
    perform set_config('pane.pj_flow_release',p_order_group_id::text,true);
    update public.receivables set due_date=p_due_date where id=v_bill.id;
    insert into public.receivable_events(receivable_id,event_type,reason,details,created_by)
      values(v_bill.id,'vencimento_corrigido',v_reason,
        jsonb_build_object('request_id',p_request_id,'de',v_bill.due_date,'para',p_due_date),v_user);
  else
    if p_due_date is not null or p_installments is null or p_installments<2 or p_installments>12 then
      raise exception using errcode='22023',message='Escolha de 2 a 12 parcelas.';
    end if;
    if v_flow.released_at is null or v_bill.status<>'aberta' or v_bill.installment_count<>1 then
      raise exception using errcode='22023',message='Divida uma cobrança inteira em aberto, após a liberação do pedido.';
    end if;
    if private.receivable_recebido(v_bill.id)>0 then
      raise exception using errcode='22023',message='Há recebimentos. Eles serão preservados; esta cobrança não pode ser dividida.';
    end if;
    v_days:=v_bill.due_date-v_flow.agreed_date;
    if v_days is null or v_days<p_installments or v_bill.amount<p_installments*0.01 then
      raise exception using errcode='22023',message='O prazo ou o valor não comporta essa quantidade de parcelas.';
    end if;
    v_base:=trunc(v_bill.amount/p_installments,2);
    v_remainder:=v_bill.amount-v_base*p_installments;
    perform set_config('pane.pj_flow_release',p_order_group_id::text,true);
    for i in 1..p_installments loop
      v_due:=v_flow.agreed_date+private.vencimento_da_parcela(v_days,i,p_installments);
      if i=1 then
        update public.receivables set amount=v_base+v_remainder,due_date=v_due,original_due_date=v_due,
          installment_number=1,installment_count=p_installments,description=v_bill.description||' · parcela 1/'||p_installments
          where id=v_bill.id;
      else
        insert into public.receivables(request_id,customer_id,origin,origin_ref,finance_category_id,description,
          invoice_date,original_due_date,due_date,amount,installment_number,installment_count,period_start,period_end,created_by)
        values(gen_random_uuid(),v_bill.customer_id,v_bill.origin,v_bill.origin_ref,v_bill.finance_category_id,
          v_bill.description||' · parcela '||i||'/'||p_installments,v_bill.invoice_date,v_due,v_due,v_base,
          i,p_installments,v_bill.period_start,v_bill.period_end,v_user);
      end if;
    end loop;
    insert into public.receivable_events(receivable_id,event_type,reason,details,created_by)
      values(v_bill.id,'dividida',v_reason,jsonb_build_object('request_id',p_request_id,'parcelas',p_installments,
        'valor_original',v_bill.amount,'vencimento_original',v_bill.due_date,'base_data',v_flow.agreed_date),v_user);
  end if;
  perform set_config('pane.pj_flow_release','',true);
  if not private.pj_flow_billing_valid(p_order_group_id) then raise exception 'Conjunto de cobranças inválido após alteração.'; end if;
  update private.pj_flow set version=version+1,
    released_version=case when released_at is not null then version+1 else null end
    where order_group_id=p_order_group_id returning version into v_flow.version;
  select jsonb_agg(jsonb_build_object('id',id,'number',installment_number,'count',installment_count,
    'amount',amount,'due_date',due_date,'original_due_date',original_due_date) order by installment_number)
    into v_after from public.receivables where origin='pedido_pj' and origin_ref=p_order_group_id and status<>'cancelada';
  insert into private.pj_flow_events(request_id,order_group_id,actor,action,payload,version)
    values(p_request_id,p_order_group_id,v_user,p_action,v_payload||jsonb_build_object('before',v_before,'after',v_after),v_flow.version);
  return jsonb_build_object('repeated',false,'version',v_flow.version);
end;
$function$;

-- Jornada PJ: devolução ou crédito da diferença.
CREATE OR REPLACE FUNCTION public.resolve_pj_flow_excess(p_request_id uuid, p_order_group_id uuid, p_expected_version integer, p_kind text, p_reason text, p_refund_date date DEFAULT NULL::date, p_account_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_flow private.pj_flow%rowtype; v_existing private.pj_flow_excess_resolutions%rowtype;
  v_received numeric(12,2); v_total numeric(12,2); v_amount numeric(12,2); v_resolved numeric(12,2);
  v_account public.finance_accounts%rowtype; v_category uuid; v_entry uuid;
  v_customer text; v_user uuid:=auth.uid();
begin
  if p_request_id is null or p_order_group_id is null or p_expected_version is null
    or p_kind not in ('refund_pix','credit') then
    raise exception using errcode='22023',message='Pedido, versao, tratamento e identificador sao obrigatorios.';
  end if;
  if not(private.pj_flow_commercial() and private.pj_flow_permission('pedidos_pj.liberar')
    and private.pj_flow_permission('contas_receber.lancar')) then
    raise exception using errcode='42501',message='Sem permissao para tratar a diferenca deste pedido.';
  end if;
  if length(trim(coalesce(p_reason,'')))<3 then
    raise exception using errcode='22023',message='Informe a justificativa combinada com o cliente.';
  end if;
  select * into v_flow from private.pj_flow where order_group_id=p_order_group_id for update;
  if not found then raise exception using errcode='P0002',message='Pedido do novo fluxo nao encontrado.'; end if;
  select * into v_existing from private.pj_flow_excess_resolutions where request_id=p_request_id;
  if found then
    if v_existing.order_group_id<>p_order_group_id or v_existing.flow_version<>p_expected_version
      or v_existing.kind<>p_kind or v_existing.reason<>trim(p_reason)
      or v_existing.refund_date is distinct from p_refund_date
      or (p_kind='refund_pix' and v_existing.refund_account_id is distinct from
        (select id from public.finance_accounts where key=p_account_key)) then
      raise exception using errcode='22023',message='Identificador ja usado para outro tratamento.';
    end if;
    return jsonb_build_object('repeated',true,'amount',v_existing.amount);
  end if;
  if v_flow.version<>p_expected_version then
    raise exception using errcode='PT409',message='O pedido mudou. Recarregue antes de tratar a diferenca.';
  end if;
  if v_flow.checked_at is null or v_flow.released_at is not null or v_flow.departed_at is not null then
    raise exception using errcode='22023',message='A diferenca so pode ser tratada apos a nova conferencia e antes da liberacao.';
  end if;
  perform 1 from public.receivables where origin='pedido_pj' and origin_ref=p_order_group_id order by id for update;
  if (select count(*) from public.receivables where origin='pedido_pj'
    and origin_ref=p_order_group_id and status<>'cancelada')>1 then
    raise exception using errcode='22023',
      message='Pedido parcelado que ja recebeu dinheiro exige tratamento manual antes de qualquer devolucao ou credito.';
  end if;
  select round(sum(private.valor_linha_pj(quantity,dispatched_quantity,unit_price,null)),2),
    min(c.name) into v_total,v_customer from public.orders o join public.customers c on c.id=o.customer_id
    where o.order_group_id=p_order_group_id;
  select coalesce(sum(rr.amount),0) into v_received from public.receivable_receipts rr
    join public.receivables r on r.id=rr.receivable_id
    where r.origin='pedido_pj' and r.origin_ref=p_order_group_id and rr.reversed_at is null;
  select coalesce(sum(x.amount),0) into v_resolved from private.pj_flow_excess_resolutions x
    where x.order_group_id=p_order_group_id;
  v_amount:=round(v_received-v_total-v_resolved,2);
  if v_amount<=0 then raise exception using errcode='22023',message='Nao existe valor recebido a mais neste pedido.'; end if;
  if exists(select 1 from private.pj_flow_excess_resolutions x
    where x.order_group_id=p_order_group_id and x.flow_version=p_expected_version) then
    raise exception using errcode='23505',message='Esta diferenca ja recebeu um tratamento. Recarregue a ficha.';
  end if;
  if p_kind='refund_pix' then
    if not private.pj_flow_permission('contas_receber.estornar') then
      raise exception using errcode='42501',message='Sem permissao para registrar a devolucao.';
    end if;
    if p_refund_date is null or p_refund_date>private.data_na_padaria()
      or p_refund_date<(select max(rr.received_date) from public.receivable_receipts rr
        join public.receivables r on r.id=rr.receivable_id where r.origin='pedido_pj'
          and r.origin_ref=p_order_group_id and rr.reversed_at is null) then
      raise exception using errcode='22023',message='A devolucao deve ocorrer entre o ultimo recebimento e hoje.';
    end if;
    select * into v_account from public.finance_accounts where key=p_account_key and active
      and kind='banco' and cnpj_label='RGE Pane e Pizza';
    if v_account.id is null then
      raise exception using errcode='22023',message='Escolha uma conta bancaria da JC de onde saiu o Pix.';
    end if;
    select id into v_category from public.finance_categories where key='devolucao_cliente' and active;
    if v_category is null then raise exception 'Categoria de devolucao indisponivel.'; end if;
    insert into public.finance_entries(request_id,entry_type,category_id,account_id,store,
      competence_month,due_date,planned_amount,paid_date,amount,payment_method,description,
      source,source_ref,created_by)
    values(p_request_id,'lancamento',v_category,v_account.id,'jc',date_trunc('month',p_refund_date)::date,
      p_refund_date,v_amount,p_refund_date,v_amount,'pix',coalesce(v_customer,'Cliente')||
      ' · devolucao de pedido PJ corrigido','pj_devolucao',p_request_id,v_user)
    returning id into v_entry;
  elsif p_refund_date is not null or p_account_key is not null then
    raise exception using errcode='22023',message='Credito aceito nao movimenta conta bancaria.';
  end if;
  insert into private.pj_flow_excess_resolutions(request_id,order_group_id,flow_version,kind,
    amount,reason,refund_date,refund_account_id,finance_entry_id,created_by)
  values(p_request_id,p_order_group_id,p_expected_version,p_kind,v_amount,trim(p_reason),
    p_refund_date,v_account.id,v_entry,v_user);
  return jsonb_build_object('repeated',false,'amount',v_amount);
end;
$function$;

-- create or replace mantém dono e privilégios; reafirmados aqui iguais aos
-- vigentes em produção.
revoke all on function private.save_pj_order_dispatch_quantities_lock_order_impl(uuid, uuid, jsonb, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.replace_pj_order_atomic_v2_impl(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.corrigir_quantidade_enviada_pj(uuid, uuid, jsonb, text, timestamptz)
  from public, anon, service_role;
grant execute on function public.corrigir_quantidade_enviada_pj(uuid, uuid, jsonb, text, timestamptz)
  to authenticated;
revoke all on function public.transition_pj_flow_pilot(uuid, uuid, integer, text, jsonb, boolean, integer, numeric, uuid, text)
  from public, anon, service_role;
grant execute on function public.transition_pj_flow_pilot(uuid, uuid, integer, text, jsonb, boolean, integer, numeric, uuid, text)
  to authenticated;
revoke all on function public.change_pj_flow_terms(uuid, uuid, integer, text, uuid, date, integer, text)
  from public, anon, service_role;
grant execute on function public.change_pj_flow_terms(uuid, uuid, integer, text, uuid, date, integer, text)
  to authenticated;
revoke all on function public.resolve_pj_flow_excess(uuid, uuid, integer, text, text, date, text)
  from public, anon, service_role;
grant execute on function public.resolve_pj_flow_excess(uuid, uuid, integer, text, text, date, text)
  to authenticated;

commit;
