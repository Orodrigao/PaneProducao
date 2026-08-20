-- Quantidade realmente enviada em Pedidos PJ, fase 1: a conferência.
--
-- Plano: docs/QUANTIDADE_ENVIADA_PEDIDOS_PJ.md.
--
-- O problema: a Elis lança "3 kg de mini-croissant" e o sistema cobra 3 kg,
-- mesmo que a expedição tenha mandado 3,067 kg. Esta fase faz a Expedição
-- registrar o que realmente saiu. **A cobrança NÃO muda aqui** — continua
-- saindo pela estimativa. A virada é a fase 2, depois de medir a adoção.
--
-- Três estados por linha, e a distinção entre eles é o ponto da fase:
--   * `dispatched_quantity is null` — ainda não conferido;
--   * `dispatched_quantity = 0`     — conferido e NÃO enviado, com motivo;
--   * `dispatched_quantity > 0`     — enviado, nessa quantidade.
--
-- Zero e ausência precisam ser coisas diferentes porque a fase 2 vai somar
-- `coalesce(enviado, estimado)`: se "não enviei este item" gravasse null, o
-- cliente seria cobrado justamente pelo item que não saiu.
--
-- Duas travas, não uma (decisão 6 do plano, emendada pelas revisões):
--   * 20% de diferença para cima ou para baixo exige motivo escrito;
--   * 3x para cima ou 1/3 para baixo é recusa, que ninguém ultrapassa.
-- Trava vencível por confirmação também deixaria passar 3.000 kg no lugar de
-- 3 kg — lição `validar-tambem-na-saida`, que nasceu de um erro de R$ 190 mil.

begin;

-- ---------------------------------------------------------------------------
-- As colunas da conferência.
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists dispatched_quantity numeric(12,3),
  add column if not exists dispatched_quantity_reason text,
  add column if not exists dispatched_quantity_at timestamptz,
  add column if not exists dispatched_quantity_by uuid references auth.users(id),
  add column if not exists dispatched_quantity_by_name text;

alter table public.orders
  drop constraint if exists orders_dispatched_quantity_nao_negativa;
alter table public.orders
  add constraint orders_dispatched_quantity_nao_negativa
    check (dispatched_quantity is null or dispatched_quantity >= 0);

-- Zero significa "conferido e não enviado", e isso sempre tem um porquê. Sem
-- esta trava, o zero viraria um valor mudo e a falta desapareceria do
-- histórico sem gerar providência.
alter table public.orders
  drop constraint if exists orders_dispatched_quantity_zero_tem_motivo;
alter table public.orders
  add constraint orders_dispatched_quantity_zero_tem_motivo
    check (
      dispatched_quantity is null
      or dispatched_quantity > 0
      or nullif(trim(coalesce(dispatched_quantity_reason, '')), '') is not null
    );

comment on column public.orders.dispatched_quantity is
  'Quantidade realmente enviada. null = não conferido; 0 = conferido e não enviado (com motivo); >0 = enviado. A estimativa do pedido continua em quantity.';
comment on column public.orders.dispatched_quantity_reason is
  'Por que a quantidade enviada difere da estimativa, ou por que o item não foi enviado. Obrigatório em zero e acima de 20% de diferença.';

-- ---------------------------------------------------------------------------
-- O histórico da conferência.
-- ---------------------------------------------------------------------------
-- Autoria e carimbo na própria linha guardam só a ÚLTIMA digitação. Numa
-- contestação de cliente é preciso provar quem digitou 3,067, quem trocou por
-- 3,670 e com que motivo.
create table if not exists public.pj_order_quantity_checks (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  order_id uuid not null references public.orders(id) on delete cascade,
  order_group_id uuid not null,
  estimated_quantity numeric(12,3) not null,
  quantity_before numeric(12,3),
  quantity_after numeric(12,3) not null,
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  created_by_name text
);

-- Repetir a mesma requisição não pode gerar histórico novo. É a convenção que
-- as funções de Contas a Receber já seguem.
create unique index if not exists pj_order_quantity_checks_request_line_unico
  on public.pj_order_quantity_checks (request_id, order_id);

create index if not exists pj_order_quantity_checks_por_grupo
  on public.pj_order_quantity_checks (order_group_id, created_at desc);

alter table public.pj_order_quantity_checks enable row level security;
alter table public.pj_order_quantity_checks force row level security;

-- Leitura para quem cuida do dinheiro e para a Expedição JC, que precisa ver o
-- que ela mesma registrou. Escrita, para ninguém: só a função abaixo grava.
drop policy if exists pj_order_quantity_checks_select on public.pj_order_quantity_checks;
create policy pj_order_quantity_checks_select
on public.pj_order_quantity_checks
for select
to authenticated
using (
  exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and (
        profile.role in ('admin', 'financeiro')
        or (profile.role = 'expedicao' and profile.store = 'jc')
      )
  )
);

revoke all on table public.pj_order_quantity_checks from public, anon, authenticated;
grant select on table public.pj_order_quantity_checks to authenticated;

-- ---------------------------------------------------------------------------
-- A trava de plausibilidade, num lugar só.
-- ---------------------------------------------------------------------------
-- Devolve o veredito para uma linha. Fica em `private` e é chamada tanto pela
-- gravação quanto pelos testes; na fase 2 o motor da cobrança chama a mesma
-- função, para que entrada e saída nunca divirjam.
--
-- Devolve:
--   'ok'             — dentro dos 20%, pode gravar sem motivo;
--   'exige_motivo'   — passou dos 20%, grava com motivo escrito;
--   'recusado'       — passou de 3x ou ficou abaixo de 1/3: ninguém ultrapassa.
create or replace function private.veredito_quantidade_enviada(
  p_estimada numeric,
  p_enviada numeric,
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
  if p_enviada is null then
    return 'ok';
  end if;

  if p_enviada < 0 then
    return 'recusado';
  end if;

  -- Item vendido por unidade não aceita fração: não existe 1,5 pão. Item por
  -- quilo aceita as três casas de `numeric(12,3)`.
  if coalesce(p_pricing_unit, 'un') = 'un' and p_enviada <> trunc(p_enviada) then
    return 'recusado';
  end if;

  -- Zero é uma decisão declarada ("não enviei este item"), não um desvio de
  -- quantidade: a trava de proporção não se aplica, e o motivo é exigido pela
  -- check constraint da tabela.
  if p_enviada = 0 then
    return 'exige_motivo';
  end if;

  if p_estimada is null or p_estimada <= 0 then
    -- Sem estimativa não há proporção a comparar. Pedir o motivo é o
    -- comportamento conservador.
    return 'exige_motivo';
  end if;

  v_fator := p_enviada / p_estimada;

  if v_fator > 3 or v_fator < (1.0 / 3.0) then
    return 'recusado';
  end if;

  if v_fator > 1.2 or v_fator < 0.8 then
    return 'exige_motivo';
  end if;

  return 'ok';
end;
$$;

revoke all on function private.veredito_quantidade_enviada(numeric, numeric, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- O resumo que a tela usa para saber se pode enviar.
-- ---------------------------------------------------------------------------
create or replace function private.resumo_conferencia_pj(p_order_group_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'order_group_id', p_order_group_id,
    'linhas', count(*),
    'conferidas', count(*) filter (where order_row.dispatched_quantity is not null),
    'pendentes', count(*) filter (where order_row.dispatched_quantity is null),
    'nao_enviadas', count(*) filter (where order_row.dispatched_quantity = 0),
    'version', max(order_row.dispatched_quantity_at),
    'itens', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'order_id', order_row.id,
          'quantity', order_row.dispatched_quantity,
          'reason', order_row.dispatched_quantity_reason,
          'checked_at', order_row.dispatched_quantity_at,
          'checked_by_name', order_row.dispatched_quantity_by_name
        )
        order by order_row.id
      ),
      '[]'::jsonb
    )
  )
  from public.orders order_row
  where order_row.order_group_id = p_order_group_id
    and order_row.order_type = 'pj'
    and order_row.cancelled_at is null;
$$;

revoke all on function private.resumo_conferencia_pj(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Gravar a conferência.
-- ---------------------------------------------------------------------------
-- `p_items` é `[{"order_id": uuid, "quantity": numeric|null, "reason": text}]`.
--
-- `p_expected_version` é o carimbo mais recente de conferência que a tela viu
-- quando abriu o pedido (null se nenhuma linha estava conferida). Se alguém
-- gravou no meio, esta chamada é recusada e a tela recarrega: sem isso, vence
-- quem salvar por último, não quem está certo.
create or replace function public.save_pj_order_dispatch_quantities(
  p_request_id uuid,
  p_order_group_id uuid,
  p_items jsonb,
  p_expected_version timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

  -- Já gravado com esta mesma requisição: devolve o estado atual sem escrever
  -- de novo e sem criar histórico duplicado.
  if exists (
    select 1 from public.pj_order_quantity_checks registro
    where registro.request_id = p_request_id
  ) then
    return private.resumo_conferencia_pj(p_order_group_id);
  end if;

  perform 1
  from public.orders order_row
  where order_row.order_group_id = p_order_group_id
    and order_row.order_type = 'pj'
  for update;

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
    raise exception using errcode = '40001',
      message = 'Outra pessoa conferiu este pedido enquanto você preenchia. Recarregue para ver o que já foi gravado.';
  end if;

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

  return private.resumo_conferencia_pj(p_order_group_id);
end;
$$;


revoke all on function public.save_pj_order_dispatch_quantities(uuid, uuid, jsonb, timestamptz)
  from public, anon;
grant execute on function public.save_pj_order_dispatch_quantities(uuid, uuid, jsonb, timestamptz)
  to authenticated;

-- ---------------------------------------------------------------------------
-- A fila da Expedição passa a devolver os dois números.
-- ---------------------------------------------------------------------------
-- `create or replace` não altera tipo de retorno, então é `drop` + `create`. E
-- o `drop` PERDE os grants: reconceder explicitamente logo abaixo, porque
-- objetos novos deste projeto nascem sem privilégio nenhum
-- (lição `grants-implicitos-variam-por-ambiente`).
drop function if exists public.list_pj_orders_for_dispatch();

create function public.list_pj_orders_for_dispatch()
returns table (
  id uuid,
  order_group_id uuid,
  customer_id uuid,
  customer_name text,
  order_date date,
  delivery_date date,
  production_date date,
  bread_id text,
  product_source text,
  product_name text,
  quantity numeric,
  pack_size numeric,
  pricing_unit text,
  sale_option_id uuid,
  obs text,
  cancelled_at timestamptz,
  dispatched_at timestamptz,
  dispatched_by uuid,
  dispatched_by_name text,
  dispatched_quantity numeric,
  dispatched_quantity_reason text,
  dispatched_quantity_at timestamptz,
  dispatched_quantity_by_name text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and profile.role = 'expedicao'
      and profile.store = 'jc'
      and exists (
        select 1
        from public.app_user_permissions assignment
        where assignment.user_id = profile.user_id
          and assignment.permission_key = 'pedidos_pj.acessar'
          and assignment.scope in ('*', 'jc')
      )
  ) then
    raise exception using
      errcode = '42501',
      message = 'Sem permissao para consultar a fila de Pedidos PJ.';
  end if;

  return query
  select
    order_row.id,
    order_row.order_group_id,
    order_row.customer_id,
    coalesce(customer.name, order_row.pj_client, '?') as customer_name,
    order_row.order_date,
    order_row.delivery_date,
    order_row.production_date,
    order_row.bread_id,
    order_row.product_source,
    order_row.product_name,
    order_row.quantity,
    order_row.pack_size,
    order_row.pricing_unit,
    order_row.sale_option_id,
    order_row.obs,
    order_row.cancelled_at,
    order_row.dispatched_at,
    order_row.dispatched_by,
    order_row.dispatched_by_name,
    order_row.dispatched_quantity,
    order_row.dispatched_quantity_reason,
    order_row.dispatched_quantity_at,
    order_row.dispatched_quantity_by_name
  from public.orders order_row
  left join public.customers customer on customer.id = order_row.customer_id
  where order_row.order_type = 'pj'
  order by order_row.order_date desc, order_row.order_group_id, order_row.id;
end;
$$;

revoke all on function public.list_pj_orders_for_dispatch() from public, anon;
grant execute on function public.list_pj_orders_for_dispatch() to authenticated;

-- ---------------------------------------------------------------------------
-- "Marcar como enviado" passa a exigir tudo conferido.
-- ---------------------------------------------------------------------------
-- Redefinição integral, partindo da versão VIGENTE, que é a de
-- `20260813215830_pedido_pj_vira_cobranca.sql` (conferido por `grep -l` em
-- todas as migrations: nenhuma outra redefiniu esta função desde então).
-- `create or replace` é sobrescrita total, não remendo — a única diferença
-- pretendida é a exigência da conferência
-- (lição `funcao-de-banco-redefinida-perde-melhoria-recente`).
--
-- **A cobrança continua nascendo da estimativa nesta fase.** Nenhuma linha do
-- cálculo mudou aqui de propósito: a virada é a fase 2.
create or replace function public.confirm_pj_order_dispatch(p_order_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_user_name text;
  v_row_count integer;
  v_cancelled_count integer;
  v_dispatched_count integer;
  v_pendentes integer;
  v_dispatched_at timestamptz;
  v_dispatched_by uuid;
  v_dispatched_by_name text;
begin
  if p_order_group_id is null then
    raise exception using errcode = '22023', message = 'Pedido obrigatorio.';
  end if;

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
    raise exception using errcode = '42501', message = 'Sem permissao para confirmar este envio.';
  end if;

  perform 1
  from public.orders order_row
  where order_row.order_group_id = p_order_group_id
    and order_row.order_type = 'pj'
  for update;

  select
    count(*),
    count(*) filter (where order_row.cancelled_at is not null),
    count(*) filter (where order_row.dispatched_at is not null)
  into v_row_count, v_cancelled_count, v_dispatched_count
  from public.orders order_row
  where order_row.order_group_id = p_order_group_id
    and order_row.order_type = 'pj';

  if v_row_count = 0 then
    raise exception using errcode = 'P0002', message = 'Pedido PJ nao encontrado.';
  end if;

  if v_cancelled_count > 0 then
    raise exception using errcode = '22023', message = 'Pedido cancelado nao pode ser enviado.';
  end if;

  if v_dispatched_count = v_row_count then
    select
      order_row.dispatched_at,
      order_row.dispatched_by,
      order_row.dispatched_by_name
    into v_dispatched_at, v_dispatched_by, v_dispatched_by_name
    from public.orders order_row
    where order_row.order_group_id = p_order_group_id
      and order_row.order_type = 'pj'
    order by order_row.id
    limit 1;

    -- Repetir a confirmação não cria uma segunda cobrança: o motor devolve a
    -- que já existe. Chamar aqui também recupera o caso em que o envio foi
    -- confirmado antes desta fase existir.
    perform private.build_receivable_from_pj_order(p_order_group_id, v_user_id);

    return jsonb_build_object(
      'dispatched_at', v_dispatched_at,
      'dispatched_by', v_dispatched_by,
      'dispatched_by_name', v_dispatched_by_name,
      'already_dispatched', true
    );
  end if;

  if v_dispatched_count > 0 then
    raise exception using errcode = '22023', message = 'Pedido com confirmacao de envio incompleta.';
  end if;

  -- A trava desta fase: não se envia o que não foi conferido. Pedido anterior
  -- a esta migration tem tudo em null, então a Expedição confere antes de
  -- enviar — é a coleta que a fase 1 existe para começar.
  select count(*)
  into v_pendentes
  from public.orders order_row
  where order_row.order_group_id = p_order_group_id
    and order_row.order_type = 'pj'
    and order_row.cancelled_at is null
    and order_row.dispatched_quantity is null;

  if v_pendentes > 0 then
    raise exception using errcode = '22023',
      message = format(
        'Confira a quantidade enviada de %s item(ns) antes de marcar o pedido como enviado.',
        v_pendentes
      );
  end if;

  v_dispatched_at := now();
  perform set_config('pane.pj_dispatch_rpc', 'on', true);

  update public.orders order_row
  set dispatched_at = v_dispatched_at,
      dispatched_by = v_user_id,
      dispatched_by_name = v_user_name
  where order_row.order_group_id = p_order_group_id
    and order_row.order_type = 'pj'
    and order_row.cancelled_at is null
    and order_row.dispatched_at is null;

  -- A cobrança nasce na mesma transação do envio: ou as duas coisas
  -- acontecem, ou nenhuma. Cliente sem prazo devolve null e o envio segue —
  -- o pedido fica na lista de "a faturar".
  perform private.build_receivable_from_pj_order(p_order_group_id, v_user_id);

  return jsonb_build_object(
    'dispatched_at', v_dispatched_at,
    'dispatched_by', v_user_id,
    'dispatched_by_name', v_user_name,
    'already_dispatched', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- O gatilho de pedido cobrado passa a cobrir as colunas novas.
-- ---------------------------------------------------------------------------
-- A lista de colunas do gatilho é fixa, e sem esta linha a conferência
-- escaparia da trava: seria possível mexer no número de um pedido que já virou
-- cobrança. `dispatched_*` continua fora da lista de propósito — é a
-- confirmação de envio que GERA a cobrança.
drop trigger if exists guard_billed_pj_order_changes on public.orders;
create trigger guard_billed_pj_order_changes
before update of quantity, unit_price, pack_size, customer_id, delivery_date, cancelled_at,
                 dispatched_quantity, dispatched_quantity_reason
on public.orders
for each row
when (new.order_type = 'pj')
execute function private.guard_billed_pj_order_changes();

-- ---------------------------------------------------------------------------
-- A trava vale para qualquer porta de entrada, não só para a RPC.
-- ---------------------------------------------------------------------------
-- `orders_update_authenticated_profiles` permite UPDATE em linha PJ para
-- `admin` e `financeiro`, direto do navegador. Sem este gatilho, a coluna nova
-- teria uma porta sem tranca: a RPC validaria e o acesso direto não.
--
-- É a lição `validar-tambem-na-saida` aplicada à entrada: toda porta nova
-- repete o mesmo limite, e limite só no cliente é mitigação, não garantia.
create or replace function private.guard_dispatched_quantity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_veredito text;
begin
  if new.dispatched_quantity is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.dispatched_quantity is not distinct from old.dispatched_quantity
     and new.dispatched_quantity_reason is not distinct from old.dispatched_quantity_reason
  then
    return new;
  end if;

  v_veredito := private.veredito_quantidade_enviada(
    new.quantity, new.dispatched_quantity, new.pricing_unit
  );

  if v_veredito = 'recusado' then
    raise exception using errcode = '22023',
      message = 'Quantidade enviada fora do aceitável para este item. Confira a unidade e o número.';
  end if;

  if v_veredito = 'exige_motivo'
     and nullif(trim(coalesce(new.dispatched_quantity_reason, '')), '') is null
  then
    raise exception using errcode = '22023',
      message = 'Quantidade enviada muito diferente do pedido exige motivo escrito.';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_dispatched_quantity() from public, anon, authenticated;

drop trigger if exists guard_dispatched_quantity_insert on public.orders;
create trigger guard_dispatched_quantity_insert
before insert on public.orders
for each row
when (new.order_type = 'pj' and new.dispatched_quantity is not null)
execute function private.guard_dispatched_quantity();

drop trigger if exists guard_dispatched_quantity_update on public.orders;
-- Só as colunas da conferência. `quantity` fica de fora de propósito: se a
-- estimativa mudar depois de conferido, quem deve ceder é a conferência, não a
-- edição do pedido — e na prática a tela comercial apaga e recria as linhas,
-- então a conferência da linha antiga vai junto.
create trigger guard_dispatched_quantity_update
before update of dispatched_quantity, dispatched_quantity_reason
on public.orders
for each row
when (new.order_type = 'pj')
execute function private.guard_dispatched_quantity();

-- ---------------------------------------------------------------------------
-- O contador de adoção.
-- ---------------------------------------------------------------------------
-- Adoção se mede por etapa do ciclo, nunca por total agregado: foi assim que
-- "1 uso em 116 pedidos" ficou invisível por semanas
-- (lição `adocao-se-mede-no-ciclo-inteiro`, e a medição da fase 3 do Contas a
-- Receber). É este número que decide quando a fase 2 pode começar.
create or replace function public.pj_dispatch_adoption_stats(p_desde date default null)
returns table (
  mes date,
  pedidos integer,
  com_alguma_conferencia integer,
  totalmente_conferidos integer,
  enviados integer,
  com_diferenca integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with pedido as (
    select order_row.order_group_id,
           date_trunc('month', coalesce(order_row.delivery_date, order_row.order_date))::date as mes,
           count(*) as linhas,
           count(*) filter (where order_row.dispatched_quantity is not null) as conferidas,
           count(*) filter (where order_row.dispatched_at is not null) as enviadas,
           count(*) filter (
             where order_row.dispatched_quantity is not null
               and order_row.dispatched_quantity <> order_row.quantity
           ) as diferentes
    from public.orders order_row
    where order_row.order_type = 'pj'
      and order_row.cancelled_at is null
      and order_row.order_group_id is not null
      and (p_desde is null or coalesce(order_row.delivery_date, order_row.order_date) >= p_desde)
    group by 1, 2
  )
  select pedido.mes,
         count(*)::int,
         count(*) filter (where pedido.conferidas > 0)::int,
         count(*) filter (where pedido.conferidas = pedido.linhas)::int,
         count(*) filter (where pedido.enviadas = pedido.linhas)::int,
         count(*) filter (where pedido.diferentes > 0)::int
  from pedido
  where exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and profile.role in ('admin', 'financeiro')
  )
  group by pedido.mes
  order by pedido.mes desc;
$$;

revoke all on function public.pj_dispatch_adoption_stats(date) from public, anon;
grant execute on function public.pj_dispatch_adoption_stats(date) to authenticated;

commit;
