-- Condições financeiras do PJ já inscrito. Não inscreve pedidos nem concede acesso.
begin;

alter table private.pj_flow_events drop constraint pj_flow_events_action_check;
alter table private.pj_flow_events add constraint pj_flow_events_action_check
  check (action in ('save','check','release','depart','due','split'));

-- A primeira cobrança identifica o conjunto. As próprias parcelas continuam
-- sendo a fonte única; soma isolada não prova que o conjunto esteja completo.
create function private.pj_flow_billing_valid(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.pj_flow f
    join public.receivables root on root.id=f.receivable_id and root.status<>'cancelada'
      and root.origin='pedido_pj' and root.origin_ref=f.order_group_id and root.installment_number=1
    join public.receivables r on r.origin='pedido_pj' and r.origin_ref=f.order_group_id and r.status<>'cancelada'
    where f.order_group_id=p_group and f.approved_amount>0
    group by f.approved_amount,root.installment_count,root.customer_id,root.invoice_date
    having sum(r.amount)=f.approved_amount and count(*)=root.installment_count
      and count(distinct r.installment_number)=root.installment_count
      and min(r.installment_number)=1 and max(r.installment_number)=root.installment_count
      and bool_and(r.installment_count=root.installment_count and r.customer_id=root.customer_id
        and r.invoice_date=root.invoice_date and r.amount>0 and r.due_date>=r.original_due_date)
  );
$$;
revoke all on function private.pj_flow_billing_valid(uuid) from public,anon,authenticated;

create function public.change_pj_flow_terms(
  p_request_id uuid,p_order_group_id uuid,p_expected_version integer,p_action text,
  p_receivable_id uuid,p_due_date date default null,p_installments integer default null,p_reason text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
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
    raise exception using errcode='40001',message='O pedido mudou. Recarregue antes de alterar a cobrança.';
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
$$;
revoke all on function public.change_pj_flow_terms(uuid,uuid,integer,text,uuid,date,integer,text) from public,anon,authenticated;
grant execute on function public.change_pj_flow_terms(uuid,uuid,integer,text,uuid,date,integer,text) to authenticated;

create or replace function public.read_pj_flow_pilot() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_money boolean := private.pj_flow_commercial(); v_result jsonb;
begin
  if not v_money and not private.pj_flow_expedition() then
    raise exception using errcode='42501', message='Sem permissão para o piloto PJ.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.order_group_id, 'version', f.version,
    'checked_at', f.checked_at, 'released_at', f.released_at, 'departed_at', f.departed_at,
    'can_check', private.pj_flow_expedition(),
    'can_release', v_money and private.pj_flow_permission('pedidos_pj.liberar')
      and private.pj_flow_permission('contas_receber.lancar'),
    'items', (select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.product_name,
      'ordered', o.quantity, 'quantity', o.dispatched_quantity,
      'unit', coalesce(o.pricing_unit,'un'), 'reason', o.dispatched_quantity_reason)
      || case when v_money then jsonb_build_object('price', o.unit_price) else '{}'::jsonb end order by o.id)
      from public.orders o where o.order_group_id=f.order_group_id and o.order_type='pj'),
    'customer', (select c.name from public.orders o join public.customers c on c.id=o.customer_id
      where o.order_group_id=f.order_group_id order by o.id limit 1),
    'delivery_date', (select min(o.delivery_date) from public.orders o where o.order_group_id=f.order_group_id),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('action', e.action,
      'at', e.created_at, 'actor', p.display_name, 'version', e.version) order by e.created_at), '[]'::jsonb)
      from private.pj_flow_events e left join public.app_profiles p on p.user_id=e.actor
      where e.order_group_id=f.order_group_id and e.action in ('save','check','release','depart'))
    ) || case when v_money then jsonb_build_object(
      'approved_amount', f.approved_amount,
      'due_date', (select max(r.due_date) from public.receivables r where r.origin='pedido_pj' and r.origin_ref=f.order_group_id and r.status<>'cancelada'),
      'agreed_date', f.agreed_date,
      'can_correct_due', private.pj_flow_permission('pedidos_pj.liberar') and private.pj_flow_permission('contas_receber.corrigir_vencimento'),
      'can_split', private.pj_flow_permission('pedidos_pj.liberar') and private.pj_flow_permission('contas_receber.lancar'),
      'bills', (select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'number',r.installment_number,
        'count',r.installment_count,'amount',r.amount,'due_date',r.due_date,'original_due_date',r.original_due_date,
        'invoice_date',r.invoice_date,'received',private.receivable_recebido(r.id),'status',r.status)
        order by r.installment_number),'[]'::jsonb) from public.receivables r
        where r.origin='pedido_pj' and r.origin_ref=f.order_group_id and r.status<>'cancelada'),
      'financial_history', (select coalesce(jsonb_agg(jsonb_build_object('action',e.action,'at',e.created_at,
        'actor',p.display_name,'reason',e.payload->>'reason','before',e.payload->'before','after',e.payload->'after')
        order by e.created_at),'[]'::jsonb) from private.pj_flow_events e
        left join public.app_profiles p on p.user_id=e.actor
        where e.order_group_id=f.order_group_id and e.action in ('due','split')),
      'payment_term_days', (select c.payment_term_days from public.orders o
        join public.customers c on c.id=o.customer_id where o.order_group_id=f.order_group_id order by o.id limit 1))
      else '{}'::jsonb end order by f.order_group_id), '[]'::jsonb)
    into v_result from private.pj_flow f;
  return v_result;
end;
$$;

create or replace function public.transition_pj_flow_pilot(
  p_request_id uuid, p_order_group_id uuid, p_expected_version integer,
  p_action text, p_items jsonb default '[]'::jsonb, p_nf_confirmed boolean default false,
  p_review_term_days integer default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_flow private.pj_flow%rowtype;
  v_request private.pj_flow_events%rowtype;
  v_payload jsonb;
  v_row record;
  v_item jsonb;
  v_quantity numeric;
  v_reason text;
  v_now timestamptz := clock_timestamp();
  v_user uuid := auth.uid();
  v_name text;
  v_total numeric;
  v_date date;
  v_invoice date;
  v_term integer;
  v_customer uuid;
  v_category uuid;
  v_bill uuid;
  v_plan jsonb;
  v_count integer := 1;
begin
  if p_request_id is null or p_order_group_id is null or p_expected_version is null
    or p_action is null or p_action not in ('save','check','release','depart') then
    raise exception using errcode='22023', message='Ação, pedido, versão e identificador são obrigatórios.';
  end if;
  if (p_action='release' and not (private.pj_flow_commercial()
      and private.pj_flow_permission('pedidos_pj.liberar')
      and private.pj_flow_permission('contas_receber.lancar')))
    or (p_action<>'release' and not private.pj_flow_expedition()) then
    raise exception using errcode='42501', message='Sem permissão para esta ação no piloto PJ.';
  end if;
  -- Um único ponto estável de serialização, antes de itens e cobranças.
  select * into v_flow from private.pj_flow where order_group_id=p_order_group_id for update;
  if not found then
    raise exception using errcode='22023', message='Novo fluxo indisponível para este pedido. Nenhuma ação foi realizada.';
  end if;
  v_payload := jsonb_build_object('items',p_items,'nf',p_nf_confirmed,'expected',p_expected_version,'term',p_review_term_days);
  select * into v_request from private.pj_flow_events where request_id=p_request_id;
  if found then
    if v_request.order_group_id<>p_order_group_id or v_request.actor<>v_user
      or v_request.action<>p_action or v_request.payload is distinct from v_payload then
      raise exception using errcode='22023', message='Identificador já usado para outra operação.';
    end if;
    return jsonb_build_object('repeated',true,'version',v_flow.version);
  end if;
  if v_flow.version<>p_expected_version then
    raise exception using errcode='40001', message='O pedido mudou. Recarregue e revise a versão atual.';
  end if;
  if v_flow.departed_at is not null then
    raise exception using errcode='22023', message='Saída já registrada. Tratamento posterior está fora deste piloto.';
  end if;
  perform 1 from public.orders where order_group_id=p_order_group_id order by id for update;
  if not exists (select 1 from public.orders where order_group_id=p_order_group_id)
    or exists (select 1 from public.orders where order_group_id=p_order_group_id
      and (order_type<>'pj' or cancelled_at is not null or dispatched_at is not null)) then
    raise exception using errcode='22023', message='Pedido inválido ou pertencente ao fluxo legado.';
  end if;
  select display_name into v_name from public.app_profiles where user_id=v_user;

  if p_action='save' then
    if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
      raise exception using errcode='22023', message='Informe os itens conferidos.';
    end if;
    if (select count(*) from jsonb_array_elements(p_items)) <>
       (select count(distinct i->>'id') from jsonb_array_elements(p_items) i) then
      raise exception using errcode='22023', message='Item repetido na conferência.';
    end if;
    perform set_config('pane.pj_flow_check',p_order_group_id::text,true);
    perform set_config('pane.pj_check_rpc','on',true);
    for v_item in select * from jsonb_array_elements(p_items) loop
      select * into v_row from public.orders where id=(v_item->>'id')::uuid and order_group_id=p_order_group_id;
      if not found then raise exception using errcode='22023', message='Item não pertence ao pedido.'; end if;
      v_quantity := (v_item->>'quantity')::numeric;
      v_reason := nullif(trim(v_item->>'reason'),'');
      if v_quantity is not null and (v_quantity::text in ('NaN','Infinity','-Infinity')
        or v_quantity<0 or round(v_quantity,3)<>v_quantity) then
        raise exception using errcode='22023', message='Quantidade inválida: use até três casas decimais.';
      end if;
      update public.orders set dispatched_quantity=v_quantity, dispatched_quantity_reason=v_reason,
        dispatched_quantity_at=v_now, dispatched_quantity_by=v_user, dispatched_quantity_by_name=v_name
      where id=v_row.id;
    end loop;
    perform set_config('pane.pj_flow_check','',true);
    perform set_config('pane.pj_check_rpc','',true);
    update private.pj_flow set version=version+1, checked_at=null, checked_by=null,
      released_at=null, released_by=null, released_version=null where order_group_id=p_order_group_id;
  elsif p_action='check' then
    if exists (select 1 from public.orders where order_group_id=p_order_group_id and dispatched_quantity is null) then
      raise exception using errcode='22023', message='Confira todos os itens antes de concluir.';
    end if;
    if v_flow.checked_at is not null then
      raise exception using errcode='22023', message='Conferência já concluída. Salve uma correção para reabrir.';
    end if;
    update private.pj_flow set version=version+1, checked_at=v_now, checked_by=v_user
      where order_group_id=p_order_group_id;
  elsif p_action='release' then
    if p_nf_confirmed is distinct from true or v_flow.checked_at is null then
      raise exception using errcode='22023', message='Conclua a conferência e confirme a NF emitida externamente.';
    end if;
    if v_flow.released_at is not null then
      raise exception using errcode='22023', message='Esta versão já está liberada.';
    end if;
    if (select count(distinct customer_id) from public.orders where order_group_id=p_order_group_id)<>1
      or exists (select 1 from public.orders where order_group_id=p_order_group_id
        and (customer_id is null or delivery_date is null))
      or (select count(distinct delivery_date) from public.orders where order_group_id=p_order_group_id)<>1 then
      raise exception using errcode='22023', message='Cliente e data combinada precisam estar definidos no pedido inteiro.';
    end if;
    if exists (select 1 from public.orders o where o.order_group_id=p_order_group_id and
      (o.dispatched_quantity is null or private.veredito_valor_linha_pj(o.quantity,o.dispatched_quantity,o.pricing_unit)<>'ok'
        or (o.dispatched_quantity>0 and (o.unit_price is null or o.unit_price<=0)))) then
      raise exception using errcode='22023', message='Revise as quantidades e os preços antes de cobrar.';
    end if;
    select sum(private.valor_linha_pj(quantity,dispatched_quantity,unit_price,null)), min(delivery_date)
      into v_total,v_date from public.orders where order_group_id=p_order_group_id;
    if v_total is null or v_total<=0 or v_total>1000000 then
      raise exception using errcode='22023', message='Pedido sem produtos para cobrar permanece pendente; não pode sair.';
    end if;
    select c.id,c.payment_term_days into v_customer,v_term from public.orders o
      join public.customers c on c.id=o.customer_id where o.order_group_id=p_order_group_id and c.active limit 1;
    if v_customer is null or v_term is null then
      raise exception using errcode='22023', message='Defina o cliente ativo e seu prazo de pagamento antes de liberar.';
    end if;
    if v_term is distinct from p_review_term_days then
      raise exception using errcode='40001', message='O prazo do cliente mudou. Recarregue e revise o vencimento antes de liberar.';
    end if;
    perform 1 from public.receivables where origin='pedido_pj' and origin_ref=p_order_group_id order by id for update;
    if exists (select 1 from public.receivables r join public.receivable_receipts rr on rr.receivable_id=r.id
      where r.origin='pedido_pj' and r.origin_ref=p_order_group_id and rr.reversed_at is null) then
      raise exception using errcode='22023', message='Já há pagamento. Saída bloqueada: Elis precisa tratar a diferença preservando o recebimento; esta exceção não está habilitada no piloto.';
    end if;
    if v_flow.receivable_id is not null then
      if not private.pj_flow_billing_valid(p_order_group_id) then
        raise exception using errcode='22023',message='Conjunto de cobranças inconsistente. Revise antes de liberar.';
      end if;
      if v_flow.agreed_date is distinct from v_date then
        raise exception using errcode='22023',message='A data combinada mudou. Revise o acordo financeiro antes de liberar.';
      end if;
      select jsonb_agg(jsonb_build_object('number',installment_number,'due',due_date,'original',original_due_date)
        order by installment_number),count(*) into v_plan,v_count from public.receivables
        where origin='pedido_pj' and origin_ref=p_order_group_id and status<>'cancelada';
      if v_total<v_count*0.01 then
        raise exception using errcode='22023',message='O novo valor não comporta as parcelas acordadas. Revise com Elis.';
      end if;
    end if;
    perform set_config('pane.pj_flow_release',p_order_group_id::text,true);
    for v_row in select id from public.receivables where origin='pedido_pj' and origin_ref=p_order_group_id and status<>'cancelada' loop
      update public.receivables set status='cancelada', cancelled_at=v_now, cancelled_by=v_user,
        cancel_reason='Substituída após nova conferência e revisão PJ.' where id=v_row.id;
      insert into public.receivable_events(receivable_id,event_type,reason,created_by)
        values(v_row.id,'cancelada','Substituída na nova revisão PJ.',v_user);
    end loop;
    select id into v_category from public.finance_categories where key='clientes_pj' and active;
    if v_category is null then raise exception 'Categoria de clientes PJ indisponível.'; end if;
    v_invoice := least(v_date,private.data_na_padaria());
    v_bill := private.emitir_cobrancas(p_request_id,v_customer,'pedido_pj',p_order_group_id,v_category,
      'Pedido PJ · entrega combinada '||to_char(v_date,'DD/MM/YYYY'),v_invoice,v_total,
      case when v_plan is null then (v_date+v_term)-v_invoice else greatest(v_count,1) end,v_count,v_user,null,null,
      jsonb_build_object('base_do_valor','real_conferido_aprovado','agreed_date',v_date,
        'payment_term_days',v_term,'nf_confirmed',true,'flow_version',v_flow.version+1));
    if v_plan is not null then
      update public.receivables r set due_date=(a->>'due')::date,original_due_date=(a->>'original')::date
      from jsonb_array_elements(v_plan) a
      where r.origin='pedido_pj' and r.origin_ref=p_order_group_id and r.status<>'cancelada'
        and r.installment_number=(a->>'number')::integer;
      -- Somente os lançamentos desta reemissão: o histórico nasce com as datas efetivas.
      update public.receivable_events e set details=e.details||jsonb_build_object('due_date',r.due_date)
      from public.receivables r where e.receivable_id=r.id and e.event_type='lancada'
        and r.origin='pedido_pj' and r.origin_ref=p_order_group_id and r.status<>'cancelada'
        and e.details->>'flow_version'=(v_flow.version+1)::text;
    end if;
    perform set_config('pane.pj_flow_release','',true);
    update private.pj_flow set version=version+1, released_version=version+1, released_at=v_now,
      released_by=v_user, receivable_id=v_bill, approved_amount=v_total, agreed_date=v_date
      where order_group_id=p_order_group_id;
  else
    perform 1 from public.receivables where origin='pedido_pj' and origin_ref=p_order_group_id order by id for update;
    if v_flow.released_at is null or v_flow.released_version<>v_flow.version
      or not private.pj_flow_billing_valid(p_order_group_id) then
      raise exception using errcode='22023', message='Saída bloqueada. Aguarde nova liberação de Elis.';
    end if;
    update private.pj_flow set departed_at=v_now, departed_by=v_user where order_group_id=p_order_group_id;
  end if;
  select version into v_flow.version from private.pj_flow where order_group_id=p_order_group_id;
  insert into private.pj_flow_events(request_id,order_group_id,actor,action,payload,version)
    values(p_request_id,p_order_group_id,v_user,p_action,v_payload,v_flow.version);
  return jsonb_build_object('repeated',false,'version',v_flow.version);
end;
$$;
revoke all on function public.read_pj_flow_pilot(),
  public.transition_pj_flow_pilot(uuid,uuid,integer,text,jsonb,boolean,integer) from public,anon,authenticated;
grant execute on function public.read_pj_flow_pilot(),
  public.transition_pj_flow_pilot(uuid,uuid,integer,text,jsonb,boolean,integer) to authenticated;
commit;

