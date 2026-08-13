-- Contas a receber, fase 3: o pedido PJ entregue vira cobrança.
--
-- Plano: docs/CONTAS_A_RECEBER.md. Dois caminhos para o mesmo destino, por
-- decisão do Rodrigo em 2026-08-13 (decisão 11), depois da medição em
-- produção: 116 pedidos PJ desde junho, 1 com envio confirmado.
--
--   * automático — a ação que confirma o envio gera a cobrança por dentro,
--     sem dar nenhuma permissão financeira à Expedição;
--   * manual — o financeiro vê a lista de pedidos entregues e ainda não
--     cobrados e gera as cobranças que faltam.
--
-- Os dois chamam o MESMO motor em `private`, então valor, vencimento e travas
-- não podem divergir entre eles.
--
-- Um pedido PJ é um GRUPO de linhas em `orders` (`order_group_id`), nunca uma
-- linha só: a cobrança aponta para o grupo e soma o grupo inteiro.

begin;

-- ---------------------------------------------------------------------------
-- A cobrança passa a aceitar a origem automática.
-- ---------------------------------------------------------------------------
alter table public.receivables
  drop constraint if exists receivables_origin_check;

alter table public.receivables
  add constraint receivables_origin_check
    check (origin in ('avulso', 'pedido_pj'));

comment on column public.receivables.origin_ref is
  'Registro que originou a cobrança. Na origem pedido_pj é o orders.order_group_id.';

-- ---------------------------------------------------------------------------
-- O motor: transforma um pedido PJ em cobrança.
-- ---------------------------------------------------------------------------
-- Devolve o id da cobrança, ou null quando o pedido ainda não pode virar
-- cobrança por um motivo que NÃO deve interromper quem chamou (hoje: cliente
-- sem prazo de pagamento combinado). Motivo que indica erro de verdade —
-- pedido inexistente, cancelado — levanta exceção.
--
-- O valor é somado aqui, do preço travado em cada linha do pedido. Nunca vem
-- pronto do navegador: é a lição `validar-tambem-na-saida`, que nasceu de um
-- erro de R$ 190 mil.
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
         min(order_row.customer_id) as customer_id,
         count(distinct order_row.customer_id) as clientes,
         max(order_row.dispatched_at)::date as data_envio,
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
    current_date
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

revoke all on function private.build_receivable_from_pj_order(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Caminho manual: o financeiro gera a cobrança de um pedido entregue.
-- ---------------------------------------------------------------------------
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
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador da cobrança obrigatório.';
  end if;

  if not private.current_user_can_receivables('contas_receber.lancar') then
    raise exception using errcode = '42501', message = 'Sem permissão para lançar cobranças.';
  end if;

  v_receivable_id := private.build_receivable_from_pj_order(p_order_group_id, v_user_id);

  if v_receivable_id is null then
    raise exception using errcode = '22023',
      message = 'Este cliente ainda não tem prazo de pagamento cadastrado. Defina o prazo na tela de Clientes antes de cobrar.';
  end if;

  return v_receivable_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Caminho automático: confirmar o envio passa a gerar a cobrança.
-- ---------------------------------------------------------------------------
-- Redefinição integral de `confirm_pj_order_dispatch`, partindo da versão
-- vigente (baseline `20260722190516_remote_schema.sql`, nunca redefinida
-- desde então — conferido por busca em todas as migrations). `create or
-- replace` é sobrescrita total, não remendo: a única diferença pretendida em
-- relação à versão anterior é a geração da cobrança ao final
-- (lição `funcao-de-banco-redefinida-perde-melhoria-recente`).
--
-- A Expedição continua sem permissão financeira e sem ver valor: quem cria o
-- registro é esta ação protegida, não a pessoa.
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
-- Pedido já cobrado não pode ser alterado nem cancelado por fora.
-- ---------------------------------------------------------------------------
-- Sem esta trava, editar a quantidade de um pedido depois de cobrado faria a
-- cobrança e o pedido contarem histórias diferentes, e ninguém perceberia.
create or replace function private.guard_billed_pj_order_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid := new.order_group_id;
begin
  if v_group_id is null then
    return new;
  end if;

  if exists (
    select 1 from public.receivables cobranca
    where cobranca.origin = 'pedido_pj'
      and cobranca.origin_ref = v_group_id
      and cobranca.status <> 'cancelada'
  ) then
    raise exception using errcode = '22023',
      message = 'Este pedido já virou cobrança. Cancele a cobrança em Contas a receber antes de alterá-lo.';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_billed_pj_order_changes() from public, anon, authenticated;

-- Mesma trava para a exclusão, onde só `old` existe.
create or replace function private.guard_billed_pj_order_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.order_group_id is not null and exists (
    select 1 from public.receivables cobranca
    where cobranca.origin = 'pedido_pj'
      and cobranca.origin_ref = old.order_group_id
      and cobranca.status <> 'cancelada'
  ) then
    raise exception using errcode = '22023',
      message = 'Este pedido já virou cobrança. Cancele a cobrança em Contas a receber antes de apagá-lo.';
  end if;

  return old;
end;
$$;

revoke all on function private.guard_billed_pj_order_delete() from public, anon, authenticated;

drop trigger if exists guard_billed_pj_order_insert on public.orders;
drop trigger if exists guard_billed_pj_order_changes on public.orders;
drop trigger if exists guard_billed_pj_order_delete on public.orders;

-- Dois gatilhos, e não um: o Postgres não aceita `new` na condição de um
-- gatilho que também cobre exclusão.
--
-- A lista de colunas é só o que muda valor ou existência do pedido. A
-- confirmação de envio escreve em `dispatched_*` e precisa continuar
-- passando — é ela que gera a cobrança.
-- O INSERT também é travado, e isso não é zelo excessivo: a tela de Pedidos PJ
-- edita gravando as linhas novas ANTES de apagar as antigas, sem transação.
-- Travar só a exclusão faria a edição de um pedido cobrado gravar metade e
-- falhar na outra — o pedido dobraria de tamanho. Travando a entrada, a
-- edição é recusada antes de escrever qualquer coisa.
create trigger guard_billed_pj_order_insert
before insert on public.orders
for each row
when (new.order_type = 'pj')
execute function private.guard_billed_pj_order_changes();

create trigger guard_billed_pj_order_changes
before update of quantity, unit_price, pack_size, customer_id, delivery_date, cancelled_at
on public.orders
for each row
when (new.order_type = 'pj')
execute function private.guard_billed_pj_order_changes();

create trigger guard_billed_pj_order_delete
before delete on public.orders
for each row
when (old.order_type = 'pj')
execute function private.guard_billed_pj_order_delete();

-- ---------------------------------------------------------------------------
-- A lista de pedidos entregues e ainda não cobrados.
-- ---------------------------------------------------------------------------
-- É a rede de proteção exigida pela decisão 8 e, enquanto a Expedição não
-- confirmar envio, é também o caminho principal (decisão 11).
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
           min(order_row.customer_id) as customer_id,
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
    and (pedido.dispatched_at is not null or pedido.delivery_date <= current_date)
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

revoke all on function public.create_receivable_from_pj_order(uuid, uuid) from public, anon;
grant execute on function public.create_receivable_from_pj_order(uuid, uuid) to authenticated;

commit;
