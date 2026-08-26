-- A fila da Expedicao acumulava pedido que ela nao tinha como resolver.
--
-- Em 2026-08-26 a Rafaela via 69 pedidos em "Em aberto" e o Rodrigo via 4, na
-- mesma tela. A diferenca eram 65 pedidos, o mais antigo entregue em 04/06:
-- 26 de junho, 38 de julho e 1 de agosto.
--
-- A armadilha tinha quatro lados, e cada trava sozinha esta certa:
--
--   1. `hasPendingDispatchCheck` (src/lib/pjOrderList.ts) segura na fila o
--      pedido com item por conferir, para que entrega de sabado conferida na
--      segunda nao vire orfa. Vale so para o perfil da Expedicao, por isso a
--      tela do admin ficava limpa.
--   2. Conferir e recusado por `save_pj_order_dispatch_quantities`: 64 dos 65
--      ja tinham virado cobranca, e a funcao protege valor ja faturado.
--   3. "Marcar como enviado" e recusado por `confirm_pj_order_dispatch`, que
--      exige tudo conferido.
--   4. E o gatilho `private.guard_billed_pj_order_changes` congela QUALQUER
--      alteracao em pedido PJ ja faturado, e a lista de colunas congeladas
--      inclui `dispatched_quantity` e `dispatched_quantity_reason`.
--
-- Ninguem errou. O que ninguem previu foi o encontro dessas protecoes sobre
-- pedido nascido ANTES de a conferencia existir, em 2026-08-21. O comentario da
-- migration 20260820232802 chegou a declarar a hipotese errada: "Pedido
-- anterior a esta migration tem tudo em null, entao a Expedicao confere antes
-- de enviar". Ela nao consegue: a cobranca ja fechou a porta.
--
-- ---------------------------------------------------------------------------
-- POR QUE ESTE ARQUIVO FOI EDITADO DEPOIS DE MERGEADO
-- ---------------------------------------------------------------------------
-- A regra da casa e que migration e so ida, e correcao de migration mergeada e
-- migration nova. Ela vale para migration que APLICOU. Esta nunca aplicou.
--
-- A primeira versao deste arquivo tambem preenchia a conferencia dos 65 com a
-- quantidade pedida. Em producao isso bateu no gatilho do item 4 e a transacao
-- inteira voltou atras: `supabase_migrations.schema_migrations` nao registrou
-- esta versao, nenhuma linha mudou, e a `Banco (migrations)` de 2026-08-26
-- 19:03 falhou com "Este pedido ja virou cobranca". Enquanto o arquivo ficasse
-- como estava, ele seria retentado a cada publicacao e travaria toda mudanca de
-- banco seguinte. Adicionar uma migration nova nao resolveria: a que falha vem
-- antes na ordem.
--
-- O ensaio do `CI Banco` nao pegou o defeito porque roda num banco limpo, onde
-- o alvo do preenchimento e vazio: uma migration de dado cujo conjunto alvo nao
-- existe no banco de teste nao esta testada, so executada.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTA VERSAO FAZ, E O QUE DEIXOU DE FAZER
-- ---------------------------------------------------------------------------
-- Decisao do Rodrigo em 2026-08-26, depois de ver a trava do item 4: "o que
-- ficou para tras, ficou para tras". O preenchimento retroativo foi ABANDONADO.
-- Os 65 pedidos ficam sem conferencia para sempre, e isso e melhor do que
-- afrouxar uma protecao de dinheiro por um numero que ninguem observou.
--
-- Sobra a regra, que resolve a dor sem escrever em dado nenhum: a fila passa a
-- saber se o pedido ja virou cobranca, e o cliente solta o que nao tem mais
-- como ser conferido. Some 64 dos 65 da tela da Expedicao. O 65o segue la de
-- proposito: e o unico que nunca virou cobranca, entao e o unico que ela ainda
-- consegue conferir e fechar.

begin;

-- `create or replace` nao altera tipo de retorno, entao e `drop` + `create`. E
-- o `drop` PERDE os grants: reconceder explicitamente logo abaixo, porque
-- objetos novos deste projeto nascem sem privilegio nenhum
-- (licao `grants-implicitos-variam-por-ambiente`).
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
  dispatched_quantity_by_name text,
  ja_virou_cobranca boolean
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
    order_row.dispatched_quantity_by_name,
    -- A Expedicao nao le `receivables` pela Data API, e nao deve mesmo: a fila
    -- e "sem valores". O que ela precisa saber e apenas se a porta da
    -- conferencia ja fechou, e isso e um sim ou nao, sem cifra nenhuma.
    exists (
      select 1
      from public.receivables cobranca
      where cobranca.origin = 'pedido_pj'
        and cobranca.origin_ref = order_row.order_group_id
        and cobranca.status <> 'cancelada'
    ) as ja_virou_cobranca
  from public.orders order_row
  left join public.customers customer on customer.id = order_row.customer_id
  where order_row.order_type = 'pj'
  order by order_row.order_date desc, order_row.order_group_id, order_row.id;
end;
$$;

revoke all on function public.list_pj_orders_for_dispatch() from public, anon;
grant execute on function public.list_pj_orders_for_dispatch() to authenticated;

commit;
