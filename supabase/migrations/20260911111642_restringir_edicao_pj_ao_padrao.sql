begin;

alter function public.replace_pj_order_atomic_v2(uuid, uuid, jsonb, jsonb)
  rename to replace_pj_order_atomic_v2_impl;

create function public.replace_pj_order_atomic_v2(
  p_request_id uuid,
  p_order_group_id uuid,
  p_rows jsonb,
  p_expected_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activation_mode text;
  v_existing private.pj_order_write_requests%rowtype;
  v_payload jsonb;
begin
  perform private.assert_pj_order_write_access();

  v_payload := jsonb_build_object('rows', p_rows, 'expected_rows', p_expected_rows);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pane-pj-write:' || p_request_id::text, 0)
  );

  -- A ativação e o retorno do piloto usam a mesma trava antes de criar ou
  -- remover o fluxo. Assim não existe uma fresta entre "não encontrei fluxo"
  -- e a implementação travar as linhas do pedido.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pane-pj-controlled-real-slot', 0)
  );

  -- Uma resposta perdida continua repetível mesmo se, depois do sucesso, o
  -- pedido tiver mudado de modalidade. Só a tentativa nova passa pela barreira.
  select *
  into v_existing
  from private.pj_order_write_requests
  where request_id = p_request_id;
  if found then
    if v_existing.actor <> auth.uid()
      or v_existing.action <> 'replace_v2'
      or v_existing.order_group_id <> p_order_group_id
      or v_existing.request_payload is distinct from v_payload then
      raise exception using errcode = '22023',
        message = 'Identificador ja usado para outra operacao.';
    end if;
    return v_existing.result || jsonb_build_object('repeated', true);
  end if;

  -- A interface permite gerenciar somente pedidos que nasceram depois da
  -- virada definitiva. A trava também vive aqui para que URL, console ou uma
  -- versão antiga do navegador não alterem um piloto acompanhado.
  select activation_mode
  into v_activation_mode
  from private.pj_flow
  where order_group_id = p_order_group_id
  for update;

  if found and v_activation_mode is distinct from 'standard' then
    raise exception using errcode = '22023',
      message = 'Pedido acompanhado usa os controles do piloto e nao pode ser editado aqui.';
  end if;

  return public.replace_pj_order_atomic_v2_impl(
    p_request_id,
    p_order_group_id,
    p_rows,
    p_expected_rows
  );
end;
$$;

revoke all on function public.replace_pj_order_atomic_v2_impl(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.replace_pj_order_atomic(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.replace_pj_order_atomic_v2(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_pj_order_atomic_v2(uuid, uuid, jsonb, jsonb)
  to authenticated;

alter function public.cancel_pj_order_atomic(uuid, uuid, text)
  rename to cancel_pj_order_atomic_impl;

create function public.cancel_pj_order_atomic(
  p_request_id uuid,
  p_order_group_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_pj_order_write_access();
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pane-pj-write:' || p_request_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pane-pj-controlled-real-slot', 0)
  );

  return public.cancel_pj_order_atomic_impl(
    p_request_id,
    p_order_group_id,
    p_reason
  );
end;
$$;

revoke all on function public.cancel_pj_order_atomic_impl(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.cancel_pj_order_atomic(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.cancel_pj_order_atomic(uuid, uuid, text)
  to authenticated;

commit;
