-- A ramificacao de banco da PR 381 aplicou a migration de corte antes da
-- barreira contra chamadas antigas entrar nela. Esta migration posterior
-- instala a mesma protecao naquele banco sem depender de reconstrucao.
-- Em uma aplicacao nova, ela apenas reafirma a definicao ja instalada pela
-- migration anterior. O DDL transacional nao abre uma janela sem gatilho.
begin;

create or replace function private.guard_pj_controlled_enrollment_after_cutover()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.activation_mode = 'controlled_real'
     and private.pj_flow_rollout_state() is distinct from 'preparing' then
    raise exception using
      errcode = '55000',
      message = 'A inscricao manual do piloto foi encerrada pela virada padrao.';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_pj_controlled_enrollment_after_cutover()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_pj_controlled_enrollment_after_cutover
  on private.pj_flow;
create trigger guard_pj_controlled_enrollment_after_cutover
before insert or update of activation_mode on private.pj_flow
for each row execute function private.guard_pj_controlled_enrollment_after_cutover();

commit;
