-- O vencimento pode ser antecipado até o dia do faturamento.
--
-- A cobrança semanal da Buck faturada em 20/09/2026 calculou 05/10 pelo prazo
-- cadastrado (15 dias corridos). O combinado com o cliente era 28/09, e a Elis
-- não conseguia gravar: a regra antiga só deixava empurrar o vencimento para
-- frente, nunca para trás. Na padaria quem decide a data é o acordo com o
-- cliente, e receber mais cedo não é o lado arriscado da correção.
--
-- O que continua trancado: o vencimento não pode ser anterior ao dia em que a
-- cobrança foi faturada (cobrar antes de faturar não existe) nem passar de um
-- ano dele, o motivo segue obrigatório, só cobrança em aberto ou parcial pode
-- ser corrigida e cada correção continua virando evento com "de" e "para".
--
-- `create or replace` substitui o corpo inteiro, então esta definição parte da
-- vigente (20260814140631_recebimento_em_pedacos.sql) somada à trava financeira
-- por request_id que 20260919235223_idempotencia_financeira_concorrente.sql
-- injetou reescrevendo a definição efetiva. Sem repetir a trava aqui, ela se
-- perderia silenciosamente.
--
-- A mesma regra estava escrita duas vezes: na função e como constraint da
-- tabela (receivables_due_never_earlier). Mudar só a função deixaria o banco
-- recusando a gravação no último passo, com erro técnico de constraint em vez
-- de recado. O piso que o Rodrigo exigiu continua garantido na tabela pela
-- constraint irmã receivables_due_after_invoice, que já existe desde o
-- primeiro dia do módulo e diz o mesmo: due_date >= invoice_date.
--
-- Esta migration não toca em change_pj_flow_terms: as parcelas do fluxo PJ têm
-- regra própria, e mexer nela é decisão separada.
--
-- Reversão: migration nova devolvendo a comparação a v_row.original_due_date e
-- recriando a constraint; recriá-la exige que nenhuma cobrança tenha sido
-- antecipada nesse meio tempo.

begin;

-- O vencimento pode andar para trás até o faturamento; o piso continua sendo
-- receivables_due_after_invoice.
alter table public.receivables
  drop constraint if exists receivables_due_never_earlier;

create or replace function public.correct_receivable_due_date(
  p_request_id uuid,
  p_receivable_id uuid,
  p_due_date date,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_user_id uuid := (select auth.uid());
begin
  perform private.lock_financial_request(p_request_id);

  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador da correção obrigatório.';
  end if;

  if not private.current_user_can_receivables('contas_receber.corrigir_vencimento') then
    raise exception using errcode = '42501', message = 'Sem permissão para corrigir vencimentos.';
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null or length(trim(p_reason)) < 3 then
    raise exception using errcode = '22023', message = 'Informe o motivo da correção.';
  end if;

  select cobranca.* into v_row
  from public.receivables cobranca
  where cobranca.id = p_receivable_id
  for update;
  if v_row.id is null then
    raise exception using errcode = 'P0002', message = 'Cobrança não encontrada.';
  end if;

  if exists (
    select 1 from public.receivable_events evento
    where evento.receivable_id = p_receivable_id
      and evento.event_type = 'vencimento_corrigido'
      and evento.details ->> 'request_id' = p_request_id::text
  ) then
    return;
  end if;

  if v_row.status not in ('aberta', 'parcial') then
    raise exception using errcode = '22023',
      message = 'Só o vencimento de uma cobrança em aberto ou parcialmente recebida pode ser corrigido.';
  end if;
  if p_due_date is null then
    raise exception using errcode = '22023', message = 'Informe o novo vencimento.';
  end if;
  if p_due_date < v_row.invoice_date then
    raise exception using errcode = '22023',
      message = 'O vencimento não pode ser anterior ao dia em que a cobrança foi faturada.';
  end if;
  if p_due_date > v_row.invoice_date + 365 then
    raise exception using errcode = '22023', message = 'Vencimento distante demais do faturamento. Confira a data.';
  end if;

  update public.receivables set due_date = p_due_date where id = p_receivable_id;

  insert into public.receivable_events (receivable_id, event_type, reason, details, created_by)
  values (
    p_receivable_id, 'vencimento_corrigido', trim(p_reason),
    jsonb_build_object('request_id', p_request_id, 'de', v_row.due_date, 'para', p_due_date),
    v_user_id
  );
end;
$$;

-- A assinatura não mudou e `create or replace` preserva os privilégios, mas
-- deixá-los escritos evita depender desse detalhe na próxima reconstrução do
-- banco do zero.
revoke all on function public.correct_receivable_due_date(uuid, uuid, date, text) from public, anon;
grant execute on function public.correct_receivable_due_date(uuid, uuid, date, text) to authenticated;

commit;
