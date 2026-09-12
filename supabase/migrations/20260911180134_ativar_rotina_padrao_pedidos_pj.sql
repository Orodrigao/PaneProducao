-- Ativa a jornada padrao somente para pedidos criados depois deste corte.
-- A mesma trava e usada pela criacao de pedidos, portanto nao existe pedido
-- que possa nascer no meio da mudanca sem uma classificacao deterministica.
begin;

do $$
declare
  v_state text;
  v_cutover_at timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pane-pj-standard-cutover', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pane-pj-controlled-real-slot', 0)
  );

  select state, cutover_at
  into v_state, v_cutover_at
  from private.pj_flow_rollout_settings
  where singleton
  for update;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'Configuracao unica da jornada PJ nao encontrada; virada recusada.';
  end if;

  if v_state <> 'preparing' or v_cutover_at is not null then
    raise exception using
      errcode = '55000',
      message = format(
        'Jornada PJ esperava preparing sem corte, encontrou %s com corte %s; virada recusada.',
        v_state,
        coalesce(v_cutover_at::text, 'nulo')
      );
  end if;

  update private.pj_flow_rollout_settings
  set state = 'standard',
      cutover_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where singleton;
end;
$$;

-- O piloto deixa de aceitar novas inscricoes. O retorno do unico pedido ja
-- acompanhado continua disponivel pela funcao separada de rollback.
revoke all on function public.enroll_pj_flow(uuid, uuid)
  from public, anon, authenticated, service_role;

commit;
