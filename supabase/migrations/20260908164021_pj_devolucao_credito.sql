-- Excecoes financeiras do fluxo PJ: devolucao Pix preserva o recebimento
-- original; credito aceito pode abater manualmente um unico pedido seguinte.
-- A coorte continua inativa em producao: esta migration nao inscreve pedidos.
begin;

insert into public.finance_categories(key,label,dre_tier,dre_group,nature,team,sort_order)
values('devolucao_cliente','Devolucao a cliente','operacional','receita','despesa',null,35)
on conflict(key) do update set label=excluded.label,dre_tier=excluded.dre_tier,
  dre_group=excluded.dre_group,nature=excluded.nature,team=excluded.team,sort_order=excluded.sort_order;

alter table public.finance_entries drop constraint if exists finance_entries_source_check;
alter table public.finance_entries add constraint finance_entries_source_check
  check(source in ('avulso','contas_pagar','recorrencia','transferencia','contas_receber','pj_devolucao'));

create table private.pj_flow_excess_resolutions(
  request_id uuid primary key,
  order_group_id uuid not null references private.pj_flow(order_group_id),
  flow_version integer not null check(flow_version>=0),
  kind text not null check(kind in ('refund_pix','credit')),
  amount numeric(12,2) not null check(amount>0 and amount<=1000000),
  reason text not null check(length(trim(reason))>=3),
  refund_date date,
  refund_account_id uuid references public.finance_accounts(id),
  finance_entry_id uuid unique references public.finance_entries(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  unique(order_group_id,flow_version),
  constraint pj_flow_resolution_shape check(
    (kind='refund_pix')=(refund_date is not null)
    and (kind='refund_pix')=(refund_account_id is not null)
    and (kind='refund_pix')=(finance_entry_id is not null)
  )
);
alter table private.pj_flow_excess_resolutions enable row level security;
alter table private.pj_flow_excess_resolutions force row level security;
revoke all on private.pj_flow_excess_resolutions from public,anon,authenticated;

alter table private.pj_flow
  add column credit_applied_amount numeric(12,2) not null default 0 check(credit_applied_amount>=0),
  add column credit_source_group_id uuid references private.pj_flow(order_group_id),
  add column credit_reason text,
  add column excess_resolution_id uuid references private.pj_flow_excess_resolutions(request_id),
  add constraint pj_flow_credit_shape check(
    (credit_applied_amount=0 and credit_source_group_id is null and credit_reason is null)
    or (credit_applied_amount>0 and credit_source_group_id is not null
      and length(trim(coalesce(credit_reason,'')))>=3 and credit_source_group_id<>order_group_id)
  );
create unique index pj_flow_credit_source_once_idx on private.pj_flow(credit_source_group_id)
  where credit_source_group_id is not null;

drop function if exists private.pj_flow_billing_valid(uuid);
create function private.pj_flow_billing_valid(p_group uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((
    select
      case when f.approved_amount is null or f.approved_amount<=0
        or f.credit_applied_amount<0 or f.credit_applied_amount>f.approved_amount then false
      when f.approved_amount-f.credit_applied_amount=0 then
        not exists(select 1 from public.receivables r where r.origin='pedido_pj'
          and r.origin_ref=f.order_group_id and r.status<>'cancelada')
      else exists(
        select 1 from public.receivables root
        join public.receivables r on r.origin='pedido_pj' and r.origin_ref=f.order_group_id
          and r.status<>'cancelada'
        where root.id=f.receivable_id and root.status<>'cancelada'
        group by root.installment_count,root.customer_id,root.invoice_date
        having sum(r.amount)=f.approved_amount-f.credit_applied_amount
          and count(*)=root.installment_count
          and count(distinct r.customer_id)=1 and min(r.customer_id)=root.customer_id
          and count(distinct r.invoice_date)=1 and min(r.invoice_date)=root.invoice_date)
      end
      and (select coalesce(sum(x.amount),0) from private.pj_flow_excess_resolutions x
        where x.order_group_id=f.order_group_id)=greatest((select coalesce(sum(rr.amount),0)
          from public.receivable_receipts rr join public.receivables r on r.id=rr.receivable_id
          where r.origin='pedido_pj' and r.origin_ref=f.order_group_id and rr.reversed_at is null)-f.approved_amount,0)
    from private.pj_flow f where f.order_group_id=p_group
  ),false);
$$;
revoke all on function private.pj_flow_billing_valid(uuid) from public,anon,authenticated;

create function public.resolve_pj_flow_excess(
  p_request_id uuid,p_order_group_id uuid,p_expected_version integer,p_kind text,
  p_reason text,p_refund_date date default null,p_account_key text default null
) returns jsonb
language plpgsql security definer set search_path='' as $$
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
    raise exception using errcode='40001',message='O pedido mudou. Recarregue antes de tratar a diferenca.';
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
$$;
revoke all on function public.resolve_pj_flow_excess(uuid,uuid,integer,text,text,date,text) from public,anon,authenticated;
grant execute on function public.resolve_pj_flow_excess(uuid,uuid,integer,text,text,date,text) to authenticated;

create or replace function public.read_pj_flow_pilot() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_money boolean:=private.pj_flow_commercial(); v_result jsonb;
begin
  if not v_money and not private.pj_flow_expedition() then
    raise exception using errcode='42501',message='Sem permissao para o piloto PJ.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',f.order_group_id,'version',f.version,'checked_at',f.checked_at,
    'released_at',f.released_at,'departed_at',f.departed_at,
    'can_check',private.pj_flow_expedition(),
    'can_release',v_money and private.pj_flow_permission('pedidos_pj.liberar')
      and private.pj_flow_permission('contas_receber.lancar'),
    'items',(select jsonb_agg(jsonb_build_object('id',o.id,'name',o.product_name,
      'ordered',o.quantity,'quantity',o.dispatched_quantity,'unit',coalesce(o.pricing_unit,'un'),
      'reason',o.dispatched_quantity_reason)||case when v_money then jsonb_build_object('price',o.unit_price)
      else '{}'::jsonb end order by o.id) from public.orders o where o.order_group_id=f.order_group_id and o.order_type='pj'),
    'customer',(select c.name from public.orders o join public.customers c on c.id=o.customer_id
      where o.order_group_id=f.order_group_id order by o.id limit 1),
    'delivery_date',(select min(o.delivery_date) from public.orders o where o.order_group_id=f.order_group_id),
    'history',(select coalesce(jsonb_agg(jsonb_build_object('action',e.action,'at',e.created_at,
      'actor',p.display_name,'version',e.version) order by e.created_at),'[]'::jsonb)
      from private.pj_flow_events e left join public.app_profiles p on p.user_id=e.actor
      where e.order_group_id=f.order_group_id and e.action in ('save','check','release','depart'))
  )||case when v_money then jsonb_build_object(
    'approved_amount',f.approved_amount,
    'current_gross_amount',(select round(sum(private.valor_linha_pj(o.quantity,o.dispatched_quantity,o.unit_price,null)),2)
      from public.orders o where o.order_group_id=f.order_group_id),
    'credit_applied_amount',f.credit_applied_amount,
    'credit_source_group_id',f.credit_source_group_id,'credit_reason',f.credit_reason,
    'net_amount',case when f.approved_amount is null then null else f.approved_amount-f.credit_applied_amount end,
    'received_total',(select coalesce(sum(rr.amount),0) from public.receivable_receipts rr
      join public.receivables r on r.id=rr.receivable_id where r.origin='pedido_pj'
        and r.origin_ref=f.order_group_id and rr.reversed_at is null),
    'pending_excess',greatest((select coalesce(sum(rr.amount),0) from public.receivable_receipts rr
      join public.receivables r on r.id=rr.receivable_id where r.origin='pedido_pj'
        and r.origin_ref=f.order_group_id and rr.reversed_at is null)-coalesce((select
          round(sum(private.valor_linha_pj(o.quantity,o.dispatched_quantity,o.unit_price,null)),2)
          from public.orders o where o.order_group_id=f.order_group_id),0)-
          (select coalesce(sum(x.amount),0) from private.pj_flow_excess_resolutions x
            where x.order_group_id=f.order_group_id),0),
    'excess_resolution',(select jsonb_build_object('id',x.request_id,'kind',x.kind,'amount',x.amount,
      'reason',x.reason,'refund_date',x.refund_date,'account',a.label,'at',x.created_at,'actor',p.display_name)
      from private.pj_flow_excess_resolutions x left join public.finance_accounts a on a.id=x.refund_account_id
      left join public.app_profiles p on p.user_id=x.created_by
      where x.request_id=(select x2.request_id from private.pj_flow_excess_resolutions x2
        where x2.order_group_id=f.order_group_id order by x2.created_at desc limit 1)),
    'can_resolve_excess',private.pj_flow_permission('pedidos_pj.liberar')
      and private.pj_flow_permission('contas_receber.lancar')
      and (select count(*) from public.receivables r where r.origin='pedido_pj'
        and r.origin_ref=f.order_group_id and r.status<>'cancelada')<=1,
    'excess_resolution_supported',(select count(*) from public.receivables r where r.origin='pedido_pj'
      and r.origin_ref=f.order_group_id and r.status<>'cancelada')<=1,
    'refund_accounts',(select coalesce(jsonb_agg(jsonb_build_object('key',a.key,'label',a.label)
      order by a.sort_order),'[]'::jsonb) from public.finance_accounts a where a.active and a.kind='banco'
        and a.cnpj_label='RGE Pane e Pizza'),
    'credit_sources',(select coalesce(jsonb_agg(jsonb_build_object('id',sf.order_group_id,
      'delivery_date',(select min(so.delivery_date) from public.orders so where so.order_group_id=sf.order_group_id),
      'amount',sx.amount,'reason',sx.reason) order by sf.order_group_id),'[]'::jsonb)
      from private.pj_flow sf join lateral(select sum(x.amount) amount,min(x.reason) reason
        from private.pj_flow_excess_resolutions x where x.order_group_id=sf.order_group_id and x.kind='credit')sx on sx.amount>0
      where sf.order_group_id<>f.order_group_id and sf.departed_at is not null
        and not exists(select 1 from private.pj_flow used where used.credit_source_group_id=sf.order_group_id)
        and (select min(so.customer_id) from public.orders so where so.order_group_id=sf.order_group_id)
          =(select min(o.customer_id) from public.orders o where o.order_group_id=f.order_group_id)),
    'due_date',(select max(r.due_date) from public.receivables r where r.origin='pedido_pj'
      and r.origin_ref=f.order_group_id and r.status<>'cancelada'),'agreed_date',f.agreed_date,
    'can_correct_due',private.pj_flow_permission('pedidos_pj.liberar') and private.pj_flow_permission('contas_receber.corrigir_vencimento'),
    'can_split',private.pj_flow_permission('pedidos_pj.liberar') and private.pj_flow_permission('contas_receber.lancar'),
    'bills',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'number',r.installment_number,
      'count',r.installment_count,'amount',r.amount,'due_date',r.due_date,'original_due_date',r.original_due_date,
      'invoice_date',r.invoice_date,'received',private.receivable_recebido(r.id),'status',r.status)
      order by r.installment_number),'[]'::jsonb) from public.receivables r where r.origin='pedido_pj'
      and r.origin_ref=f.order_group_id and r.status<>'cancelada'),
    'financial_history',(select coalesce(jsonb_agg(jsonb_build_object('action',e.action,'at',e.created_at,
      'actor',p.display_name,'reason',e.payload->>'reason','before',e.payload->'before','after',e.payload->'after')
      order by e.created_at),'[]'::jsonb) from private.pj_flow_events e left join public.app_profiles p on p.user_id=e.actor
      where e.order_group_id=f.order_group_id and e.action in ('due','split')),
    'payment_term_days',(select c.payment_term_days from public.orders o join public.customers c on c.id=o.customer_id
      where o.order_group_id=f.order_group_id order by o.id limit 1)
  ) else '{}'::jsonb end order by f.order_group_id),'[]'::jsonb) into v_result from private.pj_flow f;
  return v_result;
end;
$$;

drop function public.transition_pj_flow_pilot(uuid,uuid,integer,text,jsonb,boolean,integer);
create function public.transition_pj_flow_pilot(
  p_request_id uuid,p_order_group_id uuid,p_expected_version integer,p_action text,
  p_items jsonb default '[]'::jsonb,p_nf_confirmed boolean default false,
  p_review_term_days integer default null,p_credit_amount numeric default 0,
  p_credit_source_group_id uuid default null,p_credit_reason text default null
) returns jsonb
language plpgsql security definer set search_path='' as $$
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
  if v_flow.version<>p_expected_version then raise exception using errcode='40001',message='O pedido mudou. Recarregue e revise a versao atual.'; end if;
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
    select round(sum(private.valor_linha_pj(quantity,dispatched_quantity,unit_price,null)),2),min(delivery_date),min(customer_id)
      into v_total,v_date,v_customer from public.orders where order_group_id=p_order_group_id;
    if v_total is null or v_total<=0 or v_total>1000000 then
      raise exception using errcode='22023',message='Pedido sem produtos para cobrar permanece pendente; nao pode sair.';
    end if;
    select payment_term_days into v_term from public.customers where id=v_customer and active;
    if v_term is null then raise exception using errcode='22023',message='Defina o cliente ativo e seu prazo de pagamento antes de liberar.'; end if;
    if v_term is distinct from p_review_term_days then raise exception using errcode='40001',message='O prazo do cliente mudou. Recarregue e revise o vencimento antes de liberar.'; end if;
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
          and(select min(o.customer_id) from public.orders o where o.order_group_id=sf.order_group_id)=v_customer)
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
$$;
revoke all on function public.read_pj_flow_pilot(),
  public.transition_pj_flow_pilot(uuid,uuid,integer,text,jsonb,boolean,integer,numeric,uuid,text) from public,anon,authenticated;
grant execute on function public.read_pj_flow_pilot(),
  public.transition_pj_flow_pilot(uuid,uuid,integer,text,jsonb,boolean,integer,numeric,uuid,text) to authenticated;

commit;
