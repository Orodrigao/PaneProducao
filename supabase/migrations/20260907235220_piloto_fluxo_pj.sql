-- Preparação da fase 2. NENHUM pedido é inscrito por esta migration.
-- Somente o seed fictício inscreve pedidos; não existe RPC de inscrição.
-- A ativação e o tratamento do corte de produção pertencem à fase 3.
begin;

insert into public.app_permissions (key, module, label, description, sort_order)
values ('pedidos_pj.liberar', 'Pedidos PJ', 'Revisar e liberar pedido PJ',
  'Confirmar cobrança e NF externa antes da saída. Sem concessão automática.', 206)
on conflict (key) do nothing;

create table private.pj_flow (
  order_group_id uuid primary key,
  version integer not null default 0 check (version >= 0),
  checked_at timestamptz,
  checked_by uuid references auth.users(id),
  released_version integer,
  released_at timestamptz,
  released_by uuid references auth.users(id),
  departed_at timestamptz,
  departed_by uuid references auth.users(id),
  receivable_id uuid references public.receivables(id),
  agreed_date date,
  approved_amount numeric(12,2),
  check ((released_at is null) = (released_version is null)),
  check (released_version is null or released_version = version),
  check (departed_at is null or released_at is not null)
);
create table private.pj_flow_events (
  request_id uuid primary key,
  order_group_id uuid not null references private.pj_flow(order_group_id),
  actor uuid not null references auth.users(id),
  action text not null check (action in ('save', 'check', 'release', 'depart')),
  payload jsonb not null,
  version integer not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table private.pj_flow enable row level security;
alter table private.pj_flow force row level security;
alter table private.pj_flow_events enable row level security;
alter table private.pj_flow_events force row level security;
revoke all on private.pj_flow, private.pj_flow_events from public, anon, authenticated;

create function private.pj_flow_permission(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_profiles p
    join public.app_user_permissions a on a.user_id = p.user_id
    where p.user_id = auth.uid() and p.active
      and a.permission_key = p_key and a.scope in ('*', 'jc'));
$$;
create function private.pj_flow_commercial() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.pj_flow_permission('pedidos_pj.acessar')
    and private.pj_flow_permission('contas_receber.acessar')
    and exists (select 1 from public.app_profiles p where p.user_id = auth.uid()
      and p.active and p.role in ('financeiro', 'admin'));
$$;
create function private.pj_flow_expedition() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.pj_flow_permission('pedidos_pj.acessar')
    and private.pj_flow_permission('pedidos_pj.confirmar_envio')
    and exists (select 1 from public.app_profiles p where p.user_id = auth.uid()
      and p.active and p.role = 'expedicao' and p.store = 'jc');
$$;
create function private.is_pj_flow(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.pj_flow where order_group_id = p_group);
$$;
revoke all on function private.pj_flow_permission(text), private.pj_flow_commercial(),
  private.pj_flow_expedition(), private.is_pj_flow(uuid) from public, anon, authenticated;
grant execute on function private.pj_flow_commercial(), private.is_pj_flow(uuid) to authenticated;

-- Restrição adicional SOMENTE para a coorte nova. O endurecimento integral
-- da leitura legada é outra frente: não muda acesso dos pedidos em andamento.
create policy orders_pj_flow_read on public.orders as restrictive for select to authenticated
using (not private.is_pj_flow(order_group_id) or private.pj_flow_commercial());
create policy receivables_pj_flow_read on public.receivables as restrictive for select to authenticated
using (not (origin='pedido_pj' and private.is_pj_flow(origin_ref)) or private.pj_flow_commercial());
create function private.is_pj_flow_receivable(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.receivables r where r.id=p_id
    and r.origin='pedido_pj' and private.is_pj_flow(r.origin_ref));
$$;
revoke all on function private.is_pj_flow_receivable(uuid) from public,anon,authenticated;
grant execute on function private.is_pj_flow_receivable(uuid) to authenticated;
create policy receipts_pj_flow_read on public.receivable_receipts as restrictive for select to authenticated
using (not private.is_pj_flow_receivable(receivable_id) or private.pj_flow_commercial());
create policy receivable_events_pj_flow_read on public.receivable_events as restrictive for select to authenticated
using (not private.is_pj_flow_receivable(receivable_id) or private.pj_flow_commercial());

-- Fecha as portas antigas, inclusive mover/inserir um item no grupo protegido.
-- Não usa a chave antiga de despacho como autorização do fluxo novo.
create function private.guard_pj_flow_order() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op <> 'INSERT' and private.is_pj_flow(old.order_group_id))
     or (tg_op <> 'DELETE' and private.is_pj_flow(new.order_group_id)) then
    if tg_op <> 'UPDATE'
       or coalesce(current_setting('pane.pj_flow_check', true), '') <> new.order_group_id::text
       or (to_jsonb(new) - array['dispatched_quantity','dispatched_quantity_reason',
         'dispatched_quantity_at','dispatched_quantity_by','dispatched_quantity_by_name'])
          is distinct from
          (to_jsonb(old) - array['dispatched_quantity','dispatched_quantity_reason',
         'dispatched_quantity_at','dispatched_quantity_by','dispatched_quantity_by_name']) then
      raise exception using errcode='42501', message='Pedido do novo fluxo: use a conferência, revisão e saída do piloto.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger aa_guard_pj_flow_order before insert or update or delete on public.orders
for each row execute function private.guard_pj_flow_order();

-- Correção conserva a cobrança anterior até a revisão de Elis. Este desvio
-- estreito só permite os campos conferidos validados pelo gatilho acima.
create or replace function private.guard_billed_pj_order_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and private.is_pj_flow(new.order_group_id)
    and coalesce(current_setting('pane.pj_flow_check', true), '') = new.order_group_id::text then
    return new;
  end if;
  if new.order_group_id is not null and exists (select 1 from public.receivables r
    where r.origin='pedido_pj' and r.origin_ref=new.order_group_id and r.status <> 'cancelada') then
    raise exception using errcode='22023',
      message='Este pedido já virou cobrança. Cancele a cobrança em Contas a receber antes de alterá-lo.';
  end if;
  return new;
end;
$$;

-- Em preparação, alterações de valor/vencimento/parcelas/cancelamento só
-- acontecem na revisão protegida. Recebimentos seguem seu contrato existente.
create function private.guard_pj_flow_receivable() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_group uuid;
begin
  if tg_op <> 'INSERT' and old.origin='pedido_pj' and private.is_pj_flow(old.origin_ref) then
    v_group := old.origin_ref;
  elsif tg_op <> 'DELETE' and new.origin='pedido_pj' and private.is_pj_flow(new.origin_ref) then
    v_group := new.origin_ref;
  end if;
  if v_group is not null
    and coalesce(current_setting('pane.pj_flow_release', true), '') <> v_group::text then
    if tg_op <> 'UPDATE' or new.status='cancelada'
      or (to_jsonb(new) - array['status','received_date','received_amount','received_method',
        'received_account_id','received_by','received_at']) is distinct from
         (to_jsonb(old) - array['status','received_date','received_amount','received_method',
        'received_account_id','received_by','received_at']) then
      raise exception using errcode='42501', message='Cobrança do piloto: alteração exige nova revisão do pedido.';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger guard_pj_flow_receivable before insert or update or delete on public.receivables
for each row execute function private.guard_pj_flow_receivable();
revoke all on function private.guard_pj_flow_order(), private.guard_pj_flow_receivable(),
  private.guard_billed_pj_order_changes() from public, anon, authenticated;

-- Leitura operacional com projeção explícita: preço nunca viaja à Expedição.
create function public.read_pj_flow_pilot() returns jsonb
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
      where e.order_group_id=f.order_group_id)
    ) || case when v_money then jsonb_build_object(
      'approved_amount', f.approved_amount,
      'due_date', (select r.due_date from public.receivables r where r.id=f.receivable_id),
      'payment_term_days', (select c.payment_term_days from public.orders o
        join public.customers c on c.id=o.customer_id where o.order_group_id=f.order_group_id order by o.id limit 1))
      else '{}'::jsonb end order by f.order_group_id), '[]'::jsonb)
    into v_result from private.pj_flow f;
  return v_result;
end;
$$;

create function public.transition_pj_flow_pilot(
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
      (v_date+v_term)-v_invoice,1,v_user,null,null,
      jsonb_build_object('base_do_valor','real_conferido_aprovado','agreed_date',v_date,
        'payment_term_days',v_term,'nf_confirmed',true,'flow_version',v_flow.version+1));
    perform set_config('pane.pj_flow_release','',true);
    update private.pj_flow set version=version+1, released_version=version+1, released_at=v_now,
      released_by=v_user, receivable_id=v_bill, approved_amount=v_total, agreed_date=v_date
      where order_group_id=p_order_group_id;
  else
    if v_flow.released_at is null or v_flow.released_version<>v_flow.version
      or not exists (select 1 from public.receivables where id=v_flow.receivable_id and status<>'cancelada'
        and amount=v_flow.approved_amount) then
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
