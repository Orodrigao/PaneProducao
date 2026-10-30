-- Alarme de rotina parada, fase 1b: o e-mail diario das 8h ao Rodrigo e os
-- quatro avisos do financeiro (fase A1, aprovada em 28/10/2026).
--
-- Como funciona:
-- 1. O pg_cron chama a Edge Function `alarme-rotina-parada` a cada 15 minutos,
--    das 08:00 as 20:45 em Brasilia, com um segredo que nasce no cofre do banco
--    (mesmo padrao do relatorio de vencimentos).
-- 2. A primeira chamada depois das 08:00 de segunda a sabado tira a fotografia
--    do dia: as 14 linhas da regra da fase 1a (private.alarme_rotina_parada) e
--    as 4 linhas do financeiro (private.alarme_financeiro, abaixo). Erro ou
--    numero de linhas diferente num bloco vira "nao foi possivel verificar"
--    naquele bloco, nunca "tudo em dia".
-- 3. Cada linha atrasada e comparada com a ultima fotografia concluida
--    (enviada ou sem envio): novo, continua (com o dia do primeiro aviso) ou
--    resolvido. O e-mail sai quando ha atraso, resolvido, bloco nao verificado
--    ou quando e segunda-feira (resumo mesmo sem atraso). Informativo sozinho
--    nao dispara envio.
-- 4. A fotografia que nao saiu no proprio dia expira: depois de uma queda o
--    Rodrigo recebe so a do dia, nunca uma enxurrada de dias velhos.
-- 5. O vigia do vigia (workflow agendado do GitHub) le a data da ultima
--    fotografia concluida pela Edge Function, sem segredo novo.

begin;

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- 1. Avisos do financeiro (A1)
-- ---------------------------------------------------------------------------
-- Mesmo contrato da fase 1a, com 4 linhas em ordem fixa: pj_liberacao/jc,
-- recorrencia_pendente/geral, recebimento_parado/geral, parcela_vencida/jc.
-- So conta o que ja estava lancado em p_as_of, para o ensaio sobre o historico
-- rodar o mesmo texto. Limites aceitos do ensaio (em tempo real o estado atual
-- e exato): pedido PJ conferido de novo depois guarda so a ultima conferencia,
-- regra recorrente desativada depois some do passado, vencimento renegociado
-- vale o atual, parcela cancelada sozinha (sem a compra) some do passado. Dia
-- util: segunda a sexta, menos os feriados nacionais de data fixa (o mesmo
-- calendario da fase 1a).
create or replace function private.alarme_financeiro(p_as_of timestamptz default now())
returns table (
  rotina text,
  loja text,
  estado text,
  ultimo_registro date,
  faltas integer,
  datas_faltando date[],
  detalhe text
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
begin
  if p_as_of is null then
    raise exception 'Informe o instante de referencia do alarme do financeiro.'
      using errcode = '22004';
  end if;

  return query
  -- inicio da consulta do ensaio: o ensaio roda este texto com p_as_of trocado
  with referencia as (
    select (p_as_of at time zone 'America/Sao_Paulo')::date as hoje
  ),
  calendario as (
    select serie.dia::date as dia,
      extract(isodow from serie.dia) < 6
        and to_char(serie.dia, 'MM-DD') <> all (feriado.datas) as util
    from referencia
    cross join generate_series(referencia.hoje - 400, referencia.hoje + 15, interval '1 day') as serie(dia)
    cross join (
      select array['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'] as datas
    ) as feriado
  ),
  proximo_util as (
    select min(calendario.dia) as dia
    from calendario
    cross join referencia
    where calendario.util
      and calendario.dia > referencia.hoje
  ),
  -- 1. Pedido PJ conferido pela Expedicao e sem liberacao do financeiro ha 1
  -- dia util inteiro ou mais (historico: mediana de meia hora, p90 de 20 h).
  -- Pedido com todos os itens cancelados nao conta.
  pj_parados as (
    select conferido.conferido_em
    from (
      select (fluxo.checked_at at time zone 'America/Sao_Paulo')::date as conferido_em,
        (
          select count(*)
          from calendario
          where calendario.util
            and calendario.dia > (fluxo.checked_at at time zone 'America/Sao_Paulo')::date
            and calendario.dia < referencia.hoje
        ) as dias_uteis_parado
      from private.pj_flow as fluxo
      cross join referencia
      where fluxo.checked_at <= p_as_of
        and (fluxo.released_at is null or fluxo.released_at > p_as_of)
        and exists (
          select 1
          from public.orders as pedido
          where pedido.order_group_id = fluxo.order_group_id
            and (pedido.cancelled_at is null or pedido.cancelled_at > p_as_of)
        )
    ) as conferido
    where conferido.dias_uteis_parado >= 1
  ),
  saida_pj as (
    select 1 as ordem, 'pj_liberacao'::text as rotina, 'jc'::text as loja,
      case when count(*) > 0 then 'atrasada' else 'em_dia' end as estado,
      (
        select max((liberado.released_at at time zone 'America/Sao_Paulo')::date)
        from private.pj_flow as liberado
        where liberado.released_at <= p_as_of
      ) as ultimo_registro,
      count(*)::integer as faltas,
      coalesce(array_agg(distinct parado.conferido_em order by parado.conferido_em),
        array[]::date[]) as datas_faltando,
      'Pedidos PJ: ' ||
        case
          when count(*) = 0
            then 'nenhum pedido conferido pela Expedição esperando liberação há 1 dia útil ou mais.'
          else count(*) ||
            case when count(*) = 1 then ' pedido conferido' else ' pedidos conferidos' end ||
            ' pela Expedição sem liberação há 1 dia útil ou mais (o mais antigo conferido em ' ||
            to_char(min(parado.conferido_em), 'DD/MM') || ').'
        end as detalhe
    from pj_parados as parado
  ),
  -- 2. Conta recorrente ativa cujo vencimento do mes passou ha 3 dias uteis
  -- inteiros sem confirmacao daquele mes. So vencimentos a partir do dia em
  -- que a regra foi cadastrada (antes disso a conta era paga fora do ERP).
  recorrencias_devidas as (
    select regra.name as nome, competencia.mes,
      (competencia.mes + (least(regra.due_day,
        extract(day from (competencia.mes + interval '1 month' - interval '1 day'))::integer) - 1))::date
        as vencimento,
      (regra.created_at at time zone 'America/Sao_Paulo')::date as cadastrada_em,
      regra.id
    from public.finance_recurring_rules as regra
    cross join referencia
    cross join lateral (
      select serie.mes::date as mes
      from generate_series(
        greatest(regra.start_month, date_trunc('month', regra.created_at at time zone 'America/Sao_Paulo')::date),
        least(date_trunc('month', referencia.hoje)::date,
          coalesce(regra.end_month, date_trunc('month', referencia.hoje)::date)),
        interval '1 month'
      ) as serie(mes)
    ) as competencia
    where regra.active
      and regra.created_at <= p_as_of
  ),
  recorrencias_pendentes as (
    select devida.nome, devida.vencimento
    from recorrencias_devidas as devida
    cross join referencia
    where devida.vencimento >= devida.cadastrada_em
      and devida.vencimento < referencia.hoje
      and (
        select count(*)
        from calendario
        where calendario.util
          and calendario.dia > devida.vencimento
          and calendario.dia < referencia.hoje
      ) >= 3
      and not exists (
        select 1
        from public.finance_entries as lancamento
        where lancamento.source = 'recorrencia'
          and lancamento.source_ref = devida.id
          and lancamento.recurrence_month = devida.mes
          and lancamento.entry_type = 'lancamento'
          and lancamento.created_at <= p_as_of
          and (lancamento.reversed_at is null or lancamento.reversed_at > p_as_of)
      )
  ),
  saida_recorrencia as (
    select 2 as ordem, 'recorrencia_pendente'::text as rotina, 'geral'::text as loja,
      case when count(*) > 0 then 'atrasada' else 'em_dia' end as estado,
      (
        select max((confirmada.created_at at time zone 'America/Sao_Paulo')::date)
        from public.finance_entries as confirmada
        where confirmada.source = 'recorrencia'
          and confirmada.entry_type = 'lancamento'
          and confirmada.created_at <= p_as_of
      ) as ultimo_registro,
      count(*)::integer as faltas,
      coalesce(array_agg(distinct pendente.vencimento order by pendente.vencimento),
        array[]::date[]) as datas_faltando,
      'Contas recorrentes: ' ||
        case
          when not exists (
            select 1 from public.finance_recurring_rules as cadastrada
            where cadastrada.active and cadastrada.created_at <= p_as_of
          )
            then 'nenhuma conta recorrente cadastrada; a vigia começa na primeira.'
          when count(*) = 0
            then 'nenhuma vencida há 3 dias úteis sem confirmação.'
          else count(*) ||
            case when count(*) = 1 then ' vencida' else ' vencidas' end ||
            ' há 3 dias úteis ou mais sem confirmação (' ||
            string_agg(pendente.nome || ', venceu em ' || to_char(pendente.vencimento, 'DD/MM'), '; '
              order by pendente.vencimento, pendente.nome) || ').'
        end as detalhe
    from recorrencias_pendentes as pendente
  ),
  -- 3. Nenhum recebimento registrado (e nao estornado) em 3 dias uteis
  -- seguidos, havendo cobranca vencida em aberto. Historico ate a licenca da
  -- Elis: o maior buraco foi de 2 dias uteis.
  recebimentos as (
    select recibo.receivable_id, recibo.amount,
      (recibo.created_at at time zone 'America/Sao_Paulo')::date as registrado_em
    from public.receivable_receipts as recibo
    where recibo.created_at <= p_as_of
      and (recibo.reversed_at is null or recibo.reversed_at > p_as_of)
  ),
  ultimo_recebimento as (
    select max(recebido.registrado_em) filter (where recebido.registrado_em <= referencia.hoje) as dia
    from referencia
    left join recebimentos as recebido on true
  ),
  cobrancas_vencidas as (
    select cobranca.due_date, cobranca.amount - coalesce(sum(recebido.amount), 0) as saldo
    from public.receivables as cobranca
    cross join referencia
    left join recebimentos as recebido on recebido.receivable_id = cobranca.id
    where cobranca.created_at <= p_as_of
      and (cobranca.cancelled_at is null or cobranca.cancelled_at > p_as_of)
      and cobranca.due_date < referencia.hoje
    group by cobranca.id, cobranca.due_date, cobranca.amount
    having coalesce(sum(recebido.amount), 0) < cobranca.amount
  ),
  vencidas_resumo as (
    select count(*)::integer as quantidade, sum(vencida.saldo) as saldo, min(vencida.due_date) as mais_antiga
    from cobrancas_vencidas as vencida
  ),
  -- Sem recebimento valido (nenhum ainda, ou todos estornados), a contagem
  -- parte da primeira cobranca lancada: cobranca vencida sem nenhum recebimento
  -- tambem e recebimento parado.
  inicio_recebimento as (
    select ultimo.dia as ultimo_dia,
      coalesce(ultimo.dia, (
        select min((cobranca.created_at at time zone 'America/Sao_Paulo')::date)
        from public.receivables as cobranca
        where cobranca.created_at <= p_as_of
      )) as dia
    from ultimo_recebimento as ultimo
  ),
  sem_recebimento as (
    select array_agg(calendario.dia order by calendario.dia) as datas
    from calendario
    cross join referencia
    cross join inicio_recebimento as inicio
    where calendario.util
      and calendario.dia > inicio.dia
      and calendario.dia < referencia.hoje
  ),
  saida_recebimento as (
    select 3 as ordem, 'recebimento_parado'::text as rotina, 'geral'::text as loja,
      case when cardinality(coalesce(sem.datas, array[]::date[])) >= 3 and vencidas.quantidade > 0
        then 'atrasada' else 'em_dia' end as estado,
      inicio.ultimo_dia as ultimo_registro,
      cardinality(coalesce(sem.datas, array[]::date[])) as faltas,
      coalesce(sem.datas, array[]::date[]) as datas_faltando,
      'Recebimentos: ' ||
        case
          when inicio.dia is null
            then 'nenhuma cobrança nem recebimento registrado ainda; a vigia começa na primeira cobrança.'
          when cardinality(coalesce(sem.datas, array[]::date[])) = 0 and inicio.ultimo_dia is null
            then 'nenhum recebimento registrado ainda; primeira cobrança lançada em ' || to_char(inicio.dia, 'DD/MM')
          when cardinality(coalesce(sem.datas, array[]::date[])) = 0
            then 'houve recebimento registrado no último dia útil'
          else
            case
              when inicio.ultimo_dia is null
                then 'nenhum recebimento desde a primeira cobrança, lançada em ' || to_char(inicio.dia, 'DD/MM') || '; '
              else 'último registrado em ' || to_char(inicio.dia, 'DD/MM') || ', '
            end ||
            cardinality(sem.datas) ||
            case when cardinality(sem.datas) = 1 then ' dia útil' else ' dias úteis' end ||
            ' sem nenhum (alarme a partir de 3)'
        end ||
        case
          when inicio.dia is null then ''
          when vencidas.quantidade = 0 then '; nenhuma cobrança vencida em aberto.'
          else '; ' || vencidas.quantidade ||
            case when vencidas.quantidade = 1 then ' cobrança vencida' else ' cobranças vencidas' end ||
            ' em aberto, R$ ' ||
            translate(to_char(vencidas.saldo, 'FM999,999,990.00'), ',.', '.,') ||
            ' (a mais antiga venceu em ' || to_char(vencidas.mais_antiga, 'DD/MM') || ').'
        end as detalhe
    from inicio_recebimento as inicio
    cross join sem_recebimento as sem
    cross join vencidas_resumo as vencidas
  ),
  -- 4. Parcela a pagar da JC sem baixa. Vencimento em fim de semana ou feriado
  -- vale no dia util seguinte; a parcela fica atrasada a partir do primeiro dia
  -- util depois dele (decisao do Rodrigo em 29/10: pagar depois do vencimento e
  -- atraso). As que vencem hoje ou ate o proximo dia util vao na mesma linha,
  -- como informativo, para pagar no dia. Sem baixa no instante: pendente hoje;
  -- paga depois dele (vale a primeira baixa registrada, porque corrigir a baixa
  -- regrava paid_at); ou cancelada junto com a compra depois dele.
  parcelas_sem_baixa as (
    select parcela.amount,
      coalesce(parcela.current_due_date, parcela.due_date) as vencimento
    from public.payable_installments as parcela
    join public.payable_purchases as compra on compra.id = parcela.purchase_id
    where compra.store = 'jc'
      and compra.created_at <= p_as_of
      and (compra.status <> 'cancelada' or compra.cancelled_at > p_as_of)
      and (
        parcela.status = 'pendente'
        or (parcela.status = 'paga' and least(parcela.paid_at, (
          select min(baixa.occurred_at)
          from public.payable_events as baixa
          where baixa.purchase_id = parcela.purchase_id
            and baixa.event_type = 'baixada'
            and baixa.details ->> 'installment_id' = parcela.id::text
        )) > p_as_of)
        or (parcela.status = 'cancelada' and compra.cancelled_at > p_as_of)
      )
  ),
  parcelas_abertas as (
    select sem_baixa.amount, sem_baixa.vencimento,
      exists (
        select 1
        from calendario
        cross join referencia
        where calendario.util
          and calendario.dia <= referencia.hoje
          and calendario.dia > coalesce(vence_util.dia, sem_baixa.vencimento)
      ) as vencida
    from parcelas_sem_baixa as sem_baixa
    left join lateral (
      select min(calendario.dia) as dia
      from calendario
      where calendario.util
        and calendario.dia >= sem_baixa.vencimento
    ) as vence_util on true
  ),
  parcelas_resumo as (
    select
      (count(*) filter (where aberta.vencida))::integer as vencidas,
      sum(aberta.amount) filter (where aberta.vencida) as valor_vencido,
      min(aberta.vencimento) filter (where aberta.vencida) as mais_antiga,
      coalesce(array_agg(distinct aberta.vencimento order by aberta.vencimento) filter (where aberta.vencida),
        array[]::date[]) as datas,
      (count(*) filter (where not aberta.vencida and aberta.vencimento <= proximo.dia))::integer as a_pagar,
      sum(aberta.amount) filter (where not aberta.vencida and aberta.vencimento <= proximo.dia) as valor_a_pagar,
      max(proximo.dia) as proximo_dia
    from proximo_util as proximo
    left join parcelas_abertas as aberta on true
  ),
  saida_parcela as (
    select 4 as ordem, 'parcela_vencida'::text as rotina, 'jc'::text as loja,
      case
        when resumo.vencidas > 0 then 'atrasada'
        when resumo.a_pagar > 0 then 'informativo'
        else 'em_dia'
      end as estado,
      (
        select max((paga.paid_at at time zone 'America/Sao_Paulo')::date)
        from public.payable_installments as paga
        join public.payable_purchases as compra on compra.id = paga.purchase_id
        where compra.store = 'jc'
          and paga.paid_at <= p_as_of
      ) as ultimo_registro,
      resumo.vencidas as faltas,
      resumo.datas as datas_faltando,
      'Parcelas a pagar da JC: ' ||
        case
          when resumo.vencidas = 0 then 'nenhuma vencida sem baixa'
          else resumo.vencidas ||
            case when resumo.vencidas = 1 then ' vencida' else ' vencidas' end ||
            ' sem baixa, a mais antiga de ' || to_char(resumo.mais_antiga, 'DD/MM') || ', R$ ' ||
            translate(to_char(resumo.valor_vencido, 'FM999,999,990.00'), ',.', '.,')
        end ||
        case
          when resumo.a_pagar = 0
            then '; nada vence até ' || to_char(resumo.proximo_dia, 'DD/MM') || '.'
          else '; vencem até ' || to_char(resumo.proximo_dia, 'DD/MM') || ': ' || resumo.a_pagar || ', R$ ' ||
            translate(to_char(resumo.valor_a_pagar, 'FM999,999,990.00'), ',.', '.,') || '.'
        end as detalhe
    from parcelas_resumo as resumo
  ),
  todas as (
    select * from saida_pj
    union all select * from saida_recorrencia
    union all select * from saida_recebimento
    union all select * from saida_parcela
  )
  select todas.rotina, todas.loja, todas.estado, todas.ultimo_registro,
    todas.faltas, todas.datas_faltando, todas.detalhe
  from todas
  order by todas.ordem;
  -- fim da consulta do ensaio
end;
$fn$;

comment on function private.alarme_financeiro(timestamptz) is
  'Alarme do financeiro (fase A1): pedido PJ sem liberar, recorrente nao confirmada, recebimento parado e parcela vencida, com estado atrasada, em_dia ou informativo no instante p_as_of.';

revoke all on function private.alarme_financeiro(timestamptz) from public, anon, authenticated;
grant execute on function private.alarme_financeiro(timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Historico das fotografias do dia
-- ---------------------------------------------------------------------------
create table if not exists private.alarme_rotina_envios (
  id uuid primary key default extensions.gen_random_uuid(),
  report_date date not null unique,
  fotografia jsonb not null,
  deve_enviar boolean not null,
  status text not null check (status in ('pendente', 'enviado', 'sem_envio', 'expirado')),
  attempt_token uuid,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  concluded_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Concluida e quem saiu (enviado) ou quem nao tinha o que mandar (sem envio).
  constraint alarme_rotina_envios_conclusao check (
    (status in ('enviado', 'sem_envio')) = (concluded_at is not null)
    and (status = 'enviado') = (sent_at is not null)
    and deve_enviar = (status <> 'sem_envio')
  )
);

comment on table private.alarme_rotina_envios is
  'Uma fotografia por dia do alarme de rotina parada: linhas classificadas, decisao de envio e tentativas.';

alter table private.alarme_rotina_envios enable row level security;
alter table private.alarme_rotina_envios force row level security;
revoke all on table private.alarme_rotina_envios from public, anon, authenticated, service_role;

-- O segredo nasce dentro do cofre do banco; nao passa pelo GitHub, pela tela
-- do ERP ou pelo codigo. O cron o le apenas no instante de chamar a funcao.
do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets
    where name = 'alarme_rotina_cron_secret'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'alarme_rotina_cron_secret',
      'Autoriza exclusivamente o cron do alarme de rotina parada.'
    );
  end if;
end;
$$;

create or replace function private.alarme_rotina_segredo_valido(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_secret is not null and exists (
    select 1
    from vault.decrypted_secrets secret
    where secret.name = 'alarme_rotina_cron_secret'
      and secret.decrypted_secret = p_secret
  );
$$;

revoke all on function private.alarme_rotina_segredo_valido(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Coleta, conferencia e classificacao
-- ---------------------------------------------------------------------------
-- Um bloco so vale com o numero exato de linhas e cada linha no formato do
-- contrato; qualquer outra coisa e "nao foi possivel verificar".
create or replace function private.alarme_rotina_validar_bloco(
  p_bloco text,
  p_linhas jsonb,
  p_esperadas integer
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_total integer;
begin
  if p_linhas is null or pg_catalog.jsonb_typeof(p_linhas) <> 'array' then
    return pg_catalog.jsonb_build_object('bloco', p_bloco, 'verificado', false,
      'erro', 'a regra nao devolveu uma lista de linhas');
  end if;

  v_total := pg_catalog.jsonb_array_length(p_linhas);
  if v_total <> p_esperadas then
    return pg_catalog.jsonb_build_object('bloco', p_bloco, 'verificado', false,
      'erro', 'a regra devolveu ' || v_total || ' linhas em vez de ' || p_esperadas);
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_linhas) as linha(valor)
    where pg_catalog.jsonb_typeof(linha.valor) <> 'object'
      or coalesce(linha.valor ->> 'rotina', '') = ''
      or coalesce(linha.valor ->> 'loja', '') = ''
      or coalesce(linha.valor ->> 'estado', '') not in ('atrasada', 'em_dia', 'informativo')
      or coalesce(linha.valor ->> 'detalhe', '') = ''
  ) then
    return pg_catalog.jsonb_build_object('bloco', p_bloco, 'verificado', false,
      'erro', 'a regra devolveu linha fora do formato');
  end if;

  return pg_catalog.jsonb_build_object('bloco', p_bloco, 'verificado', true, 'linhas', p_linhas);
end;
$$;

revoke all on function private.alarme_rotina_validar_bloco(text, jsonb, integer) from public, anon, authenticated, service_role;

-- Roda as duas regras no mesmo instante. Um bloco que falha nao derruba o
-- outro: cada um vira verificado ou "nao foi possivel verificar" com o motivo.
create or replace function private.alarme_rotina_coletar(p_as_of timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_linhas jsonb;
  v_operacao jsonb;
  v_financeiro jsonb;
begin
  begin
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(linha) - 'posicao' order by linha.posicao), '[]'::jsonb)
      into v_linhas
    from private.alarme_rotina_parada(p_as_of)
      with ordinality as linha(rotina, loja, estado, ultimo_registro, faltas, datas_faltando, detalhe, posicao);
    v_operacao := private.alarme_rotina_validar_bloco('operacao', v_linhas, 14);
  exception when others then
    v_operacao := pg_catalog.jsonb_build_object('bloco', 'operacao', 'verificado', false,
      'erro', left(sqlerrm, 300));
  end;

  begin
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(linha) - 'posicao' order by linha.posicao), '[]'::jsonb)
      into v_linhas
    from private.alarme_financeiro(p_as_of)
      with ordinality as linha(rotina, loja, estado, ultimo_registro, faltas, datas_faltando, detalhe, posicao);
    v_financeiro := private.alarme_rotina_validar_bloco('financeiro', v_linhas, 4);
  exception when others then
    v_financeiro := pg_catalog.jsonb_build_object('bloco', 'financeiro', 'verificado', false,
      'erro', left(sqlerrm, 300));
  end;

  return pg_catalog.jsonb_build_array(v_operacao, v_financeiro);
end;
$$;

revoke all on function private.alarme_rotina_coletar(timestamptz) from public, anon, authenticated, service_role;

-- Compara a coleta de hoje com a ultima fotografia concluida. Chave: (rotina,
-- loja). Atrasada que ja estava atrasada continua, com o dia do primeiro
-- aviso; atrasada nova e novo; atrasada de antes que hoje (num bloco
-- verificado) nao esta mais atrasada e resolvido. Bloco nao verificado nao
-- resolve nada: as atrasadas dele ficam em espera, com o dia do primeiro
-- aviso, e voltam a ser comparadas quando o bloco voltar.
create or replace function private.alarme_rotina_classificar(
  p_coleta jsonb,
  p_base jsonb,
  p_hoje date
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with blocos as (
    select bloco.valor, bloco.posicao
    from pg_catalog.jsonb_array_elements(p_coleta) with ordinality as bloco(valor, posicao)
  ),
  atuais as (
    select blocos.posicao as bloco_posicao, linha.posicao, blocos.valor ->> 'bloco' as bloco, linha.valor as linha
    from blocos
    cross join lateral pg_catalog.jsonb_array_elements(
      case when (blocos.valor ->> 'verificado')::boolean then blocos.valor -> 'linhas' else '[]'::jsonb end
    ) with ordinality as linha(valor, posicao)
  ),
  nao_verificados as (
    select blocos.valor ->> 'bloco' as bloco
    from blocos
    where not coalesce((blocos.valor ->> 'verificado')::boolean, false)
  ),
  -- Atrasadas da ultima fotografia concluida, mais as que ficaram em espera
  -- porque o bloco delas nao foi verificado naquele dia.
  anteriores as (
    select linha.valor as linha
    from pg_catalog.jsonb_array_elements(coalesce(p_base -> 'linhas', '[]'::jsonb)) as linha(valor)
    where linha.valor ->> 'classe' in ('novo', 'continua')
    union all
    select linha.valor
    from pg_catalog.jsonb_array_elements(coalesce(p_base -> 'em_espera', '[]'::jsonb)) as linha(valor)
  ),
  em_espera as (
    select anterior.linha
    from anteriores as anterior
    where anterior.linha ->> 'bloco' in (select nao_verificados.bloco from nao_verificados)
  ),
  classificadas as (
    select atual.bloco_posicao, atual.posicao,
      atual.linha || pg_catalog.jsonb_build_object(
        'bloco', atual.bloco,
        'classe', case
          when atual.linha ->> 'estado' = 'atrasada' and anterior.linha is not null then 'continua'
          when atual.linha ->> 'estado' = 'atrasada' then 'novo'
          else atual.linha ->> 'estado'
        end,
        'desde', case
          when atual.linha ->> 'estado' = 'atrasada'
            then coalesce(anterior.linha ->> 'desde', to_char(p_hoje, 'YYYY-MM-DD'))
        end
      ) as linha
    from atuais as atual
    left join anteriores as anterior
      on anterior.linha ->> 'rotina' = atual.linha ->> 'rotina'
      and anterior.linha ->> 'loja' = atual.linha ->> 'loja'
  ),
  resolvidas as (
    select atual.bloco_posicao, atual.posicao,
      pg_catalog.jsonb_build_object(
        'rotina', atual.linha ->> 'rotina',
        'loja', atual.linha ->> 'loja',
        'bloco', atual.bloco,
        'detalhe', atual.linha ->> 'detalhe',
        'desde', anterior.linha ->> 'desde'
      ) as linha
    from atuais as atual
    join anteriores as anterior
      on anterior.linha ->> 'rotina' = atual.linha ->> 'rotina'
      and anterior.linha ->> 'loja' = atual.linha ->> 'loja'
    where atual.linha ->> 'estado' <> 'atrasada'
  ),
  resultado as (
    select
      coalesce((select pg_catalog.jsonb_agg(blocos.valor - 'linhas' order by blocos.posicao) from blocos),
        '[]'::jsonb) as blocos,
      coalesce((select pg_catalog.jsonb_agg(classificada.linha order by classificada.bloco_posicao, classificada.posicao)
        from classificadas as classificada), '[]'::jsonb) as linhas,
      coalesce((select pg_catalog.jsonb_agg(resolvida.linha order by resolvida.bloco_posicao, resolvida.posicao)
        from resolvidas as resolvida), '[]'::jsonb) as resolvidos,
      exists (select 1 from classificadas where classificadas.linha ->> 'classe' in ('novo', 'continua')) as atraso,
      coalesce((select pg_catalog.jsonb_agg(espera.linha order by espera.linha ->> 'bloco', espera.linha ->> 'rotina',
        espera.linha ->> 'loja') from em_espera as espera), '[]'::jsonb) as em_espera,
      exists (select 1 from resolvidas) as resolvido,
      exists (select 1 from nao_verificados) as nao_verificado,
      extract(isodow from p_hoje) = 1 as segunda
  )
  select pg_catalog.jsonb_build_object(
    'dia', to_char(p_hoje, 'YYYY-MM-DD'),
    'base', p_base ->> 'dia',
    'blocos', resultado.blocos,
    'linhas', resultado.linhas,
    'resolvidos', resultado.resolvidos,
    'em_espera', resultado.em_espera,
    'segunda', resultado.segunda,
    'motivos', pg_catalog.to_jsonb(array_remove(array[
      case when resultado.atraso then 'atraso' end,
      case when resultado.resolvido then 'resolvido' end,
      case when resultado.nao_verificado then 'nao_verificado' end,
      case when resultado.segunda then 'resumo_segunda' end
    ], null)),
    'deve_enviar', resultado.atraso or resultado.resolvido or resultado.nao_verificado or resultado.segunda
  )
  from resultado;
$$;

revoke all on function private.alarme_rotina_classificar(jsonb, jsonb, date) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Entrega (so service_role, com o segredo do cron)
-- ---------------------------------------------------------------------------
create or replace function public.claim_alarme_rotina_para_envio(
  p_secret text,
  p_now timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_hoje date := (v_now at time zone 'America/Sao_Paulo')::date;
  v_hora time := (v_now at time zone 'America/Sao_Paulo')::time;
  v_destinatario text;
  v_destinatarios integer;
  v_base jsonb;
  v_fotografia jsonb;
  v_envio private.alarme_rotina_envios%rowtype;
  v_token uuid;
begin
  if not private.alarme_rotina_segredo_valido(p_secret) then
    raise exception using errcode = '42501', message = 'Chamada do alarme de rotina nao autorizada.';
  end if;

  -- A fotografia de um dia que passou sem sair nao sai mais.
  update private.alarme_rotina_envios
  set status = 'expirado',
      updated_at = now()
  where status = 'pendente'
    and report_date < v_hoje;

  if extract(isodow from v_hoje) = 7 then
    return pg_catalog.jsonb_build_object('state', 'domingo');
  end if;
  if v_hora < time '08:00' then
    return pg_catalog.jsonb_build_object('state', 'aguardando_horario');
  end if;

  select count(*)::integer, min(user_account.email)
    into v_destinatarios, v_destinatario
  from public.app_profiles profile
  join auth.users user_account on user_account.id = profile.user_id
  where profile.active
    and profile.display_name = U&'Rodrig\00E3o';

  if v_destinatarios <> 1 or v_destinatario is null then
    raise exception using errcode = 'P0001', message = 'O destinatario do alarme de rotina nao esta configurado de forma unica.';
  end if;

  -- Duas chamadas ao mesmo tempo nao tiram duas fotografias do dia.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('alarme-rotina-envio', 0));

  if not exists (select 1 from private.alarme_rotina_envios envio where envio.report_date = v_hoje) then
    select envio.fotografia into v_base
    from private.alarme_rotina_envios envio
    where envio.report_date < v_hoje
      and envio.status in ('enviado', 'sem_envio')
    order by envio.report_date desc
    limit 1;

    v_fotografia := private.alarme_rotina_classificar(private.alarme_rotina_coletar(v_now), v_base, v_hoje);

    insert into private.alarme_rotina_envios (report_date, fotografia, deve_enviar, status, concluded_at)
    values (
      v_hoje,
      v_fotografia,
      (v_fotografia ->> 'deve_enviar')::boolean,
      case when (v_fotografia ->> 'deve_enviar')::boolean then 'pendente' else 'sem_envio' end,
      case when (v_fotografia ->> 'deve_enviar')::boolean then null else now() end
    );
  end if;

  select envio.* into v_envio
  from private.alarme_rotina_envios envio
  where envio.report_date = v_hoje
    and envio.status = 'pendente'
    and (envio.last_attempt_at is null or envio.last_attempt_at <= v_now - interval '14 minutes')
  for update skip locked;

  if v_envio.id is null then
    if exists (
      select 1 from private.alarme_rotina_envios envio
      where envio.report_date = v_hoje and envio.status in ('enviado', 'sem_envio')
    ) then
      return pg_catalog.jsonb_build_object('state', 'concluido');
    end if;
    return pg_catalog.jsonb_build_object('state', 'em_tentativa');
  end if;

  v_token := extensions.gen_random_uuid();
  -- O intervalo entre tentativas usa o mesmo instante da fotografia: em
  -- producao e o relogio do banco; no teste, o instante informado.
  update private.alarme_rotina_envios
  set attempt_token = v_token,
      last_attempt_at = v_now,
      last_error = null,
      updated_at = now()
  where id = v_envio.id;

  return pg_catalog.jsonb_build_object(
    'state', 'pronto_para_enviar',
    'envio_id', v_envio.id,
    'report_date', v_envio.report_date,
    'attempt_token', v_token,
    'recipient', v_destinatario,
    'fotografia', v_envio.fotografia
  );
end;
$$;

-- Aceita tambem a fotografia que expirou durante o envio: se o Resend aceitou,
-- o e-mail saiu e o registro diz a verdade.
create or replace function public.mark_alarme_rotina_enviado(
  p_secret text,
  p_envio_id uuid,
  p_attempt_token uuid,
  p_provider_message_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.alarme_rotina_segredo_valido(p_secret) then
    raise exception using errcode = '42501', message = 'Chamada do alarme de rotina nao autorizada.';
  end if;

  update private.alarme_rotina_envios
  set status = 'enviado',
      sent_at = now(),
      concluded_at = now(),
      provider_message_id = nullif(trim(p_provider_message_id), ''),
      last_error = null,
      updated_at = now()
  where id = p_envio_id
    and attempt_token = p_attempt_token
    and status in ('pendente', 'expirado');

  if not found then
    raise exception using errcode = 'P0001', message = 'A tentativa do alarme de rotina nao esta mais pendente.';
  end if;
end;
$$;

create or replace function public.record_alarme_rotina_falha(
  p_secret text,
  p_envio_id uuid,
  p_attempt_token uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.alarme_rotina_segredo_valido(p_secret) then
    raise exception using errcode = '42501', message = 'Chamada do alarme de rotina nao autorizada.';
  end if;

  update private.alarme_rotina_envios
  set last_error = left(nullif(trim(p_error), ''), 500),
      updated_at = now()
  where id = p_envio_id
    and attempt_token = p_attempt_token
    and status = 'pendente';
end;
$$;

-- Saude para o vigia do vigia: so a data da ultima fotografia concluida
-- (enviada ou sem nada a enviar). Nao revela conteudo nem destinatario.
create or replace function public.alarme_rotina_ultimo_dia_concluido()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select max(envio.report_date)
  from private.alarme_rotina_envios envio
  where envio.status in ('enviado', 'sem_envio');
$$;

revoke all on function public.claim_alarme_rotina_para_envio(text, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_alarme_rotina_enviado(text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.record_alarme_rotina_falha(text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.alarme_rotina_ultimo_dia_concluido() from public, anon, authenticated;
grant execute on function public.claim_alarme_rotina_para_envio(text, timestamptz) to service_role;
grant execute on function public.mark_alarme_rotina_enviado(text, uuid, uuid, text) to service_role;
grant execute on function public.record_alarme_rotina_falha(text, uuid, uuid, text) to service_role;
grant execute on function public.alarme_rotina_ultimo_dia_concluido() to service_role;

-- 08:00 a 20:45 em Brasilia (11h a 23h45 em UTC); a funcao decide o resto.
select cron.schedule(
  'alarme-rotina-parada',
  '*/15 11-23 * * *',
  $command$
    select net.http_post(
      url := 'https://gohluceldchoitihrimw.supabase.co/functions/v1/alarme-rotina-parada',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alarme-rotina-cron-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'alarme_rotina_cron_secret'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $command$
);

commit;
