-- Desfaz o destino "volta a vitrine" registrado por engano na JC em 2026-08-26.
--
-- O QUE ACONTECEU: as 22:24:08 (UTC) do dia 26/08 o fechamento da JC entrou com
-- 7 paes, 58 unidades. Entre 22:24:18 e 22:24:22 — quatorze segundos depois, um
-- toque por card — os 7 lotes receberam "volta a vitrine", que e o destino ja
-- pre-selecionado na tela e ja vem com a quantidade cheia preenchida. Rodrigo
-- confirmou em 27/08 que foi engano de operacao: os paes nao voltaram.
--
-- POR QUE IMPORTA: "volta a vitrine" e o unico destino que NAO gera movimento
-- de estoque. Conferido em producao antes de escrever: os 7 eventos produziram
-- ZERO linhas em bread_movements. Ou seja, a baixa nunca aconteceu e o sistema
-- segue achando que os 58 paes estao na loja. E perda invisivel, nao numero
-- errado em relatorio.
--
-- O QUE ESTA MIGRATION FAZ: devolve os 7 lotes para "sem destino", para a
-- equipe registrar na Central o destino que de fato ocorreu. Os eventos
-- 'display' originais PERMANECEM — historico nao se apaga, se compensa, e o
-- engano faz parte da historia.
--
-- CONSEQUENCIA OPERACIONAL, ACEITA PELO RODRIGO EM 27/08: sobra pendente de dia
-- anterior trava o fechamento seguinte (register_bread_leftovers). A JC so
-- fecha depois que alguem resolver esses lotes na Central.
--
-- NAO ha alteracao de estoque aqui, justamente porque nao houve na ida.

-- 1) Vocabulario. O banco sabia registrar dez coisas e nenhuma delas era
-- "desfiz um destino". Sem isso a correcao teria de mentir num evento existente
-- ou apagar o original.
alter table public.bread_leftover_events
  drop constraint bread_leftover_events_action_check;

alter table public.bread_leftover_events
  add constraint bread_leftover_events_action_check
  check (action = any (array[
    'registered'::text,
    'corrected'::text,
    'location_changed'::text,
    'reuse_confirmed'::text,
    'reuse_reversed'::text,
    'display'::text,
    'internal_use'::text,
    'donation'::text,
    'discard'::text,
    'freeze'::text,
    'destination_reversed'::text
  ]));

-- 2) O contra-lancamento, um por lote.
--
-- O alvo vem declarado linha a linha com a quantidade esperada, e o estado
-- anterior (pendente zerado, resolvido, display cobrindo o lote inteiro) faz
-- parte da condicao. Assim: rodar de novo nao faz nada, o diff conta a
-- historia, e se producao tiver mudado desde a medicao a linha simplesmente
-- nao e tocada em vez de ser corrompida.
--
-- from_location guarda o destino desfeito ('vitrine') e to_location, para onde
-- o saldo volta — o mesmo par que resolve_bread_leftover grava na ida, so que
-- invertido.
with alvo (sobra_id, quantidade_esperada) as (
  values
    ('047139e5-20c3-4009-af09-ba22fd23d41a'::uuid, 23::numeric), -- Croissant
    ('a197eeb3-8d59-494a-a31e-43455162b989'::uuid, 10::numeric), -- Integral
    ('f85fcd57-f396-424d-8380-9d63f1fe4d8e'::uuid,  8::numeric), -- Multigraos
    ('defcfdd2-2560-4323-83d4-bcb92bb76d69'::uuid,  7::numeric), -- Multi de Forma
    ('6000abc1-6410-489f-9344-ecf9a1144d6b'::uuid,  5::numeric), -- Pao de Azeitonas
    ('1b1c2b41-b425-4225-9dca-288ebf5b3828'::uuid,  3::numeric), -- Integral de Forma
    ('0a06c862-e56a-4773-9154-3eb04b99f585'::uuid,  2::numeric)  -- Italiano
),
elegivel as (
  select s.id, s.quantity, s.physical_location
  from public.sobras s
  join alvo a on a.sobra_id = s.id
  where s.store = 'jc'
    and s.record_date = date '2026-08-26'
    and s.product_source = 'bread'
    and s.pending_quantity = 0
    and s.status = 'resolved'
    and s.quantity = a.quantidade_esperada
    and coalesce((
      select sum(evento.quantity)
      from public.bread_leftover_events evento
      where evento.sobra_id = s.id and evento.action = 'display'
    ), 0) = a.quantidade_esperada
)
insert into public.bread_leftover_events (
  sobra_id, action, quantity, from_location, to_location,
  actor_id, actor_name, obs
)
select
  elegivel.id,
  'destination_reversed',
  elegivel.quantity,
  'vitrine',
  elegivel.physical_location,
  'be51b105-5ce1-4fa8-afcd-cec5b663c7b7'::uuid,
  'Rodrigão',
  'Volta a vitrine registrada por engano no fechamento de 26/08. Lote devolvido para a Central sem destino em 27/08, por decisao do Rodrigo, para receber o destino que de fato ocorreu.'
from elegivel;

-- 3) O saldo volta, e so para quem acabou de receber o contra-lancamento.
--
-- Depender do evento (em vez de repetir a lista) garante a ordem: se o insert
-- acima nao tocou uma linha, esta atualizacao tambem nao toca. E como o filtro
-- exige pendente zerado, rodar de novo nao faz nada.
update public.sobras alvo
set pending_quantity = alvo.quantity,
    status = 'pending',
    updated_at = now()
where alvo.store = 'jc'
  and alvo.record_date = date '2026-08-26'
  and alvo.product_source = 'bread'
  and alvo.pending_quantity = 0
  and alvo.status = 'resolved'
  and exists (
    select 1
    from public.bread_leftover_events evento
    where evento.sobra_id = alvo.id
      and evento.action = 'destination_reversed'
  );
