-- Alarme de rotina parada, fase 1a: a regra que diz, para um instante de
-- referencia, quais rotinas do ERP pararam. Sem envio: o agendamento, o e-mail
-- e o vigia do vigia ficam na fase 1b.
--
-- Rotinas vigiadas (pedido do Rodrigo em 27/10/2026): fechamento de caixa JC e
-- JA, sobras JC e JA, contagem de prateleira JC e JA, forno, romaneio,
-- producao da cozinha JC, venda do balcao JC, contagem semanal JC e entrada de
-- NF-e (rascunho parado, falta de chegada e nota que chegou atrasada).
--
-- Calendario: segunda a sabado, menos os feriados nacionais de data fixa.
-- Feriado movel (Carnaval, Sexta-feira Santa, Corpus Christi) fica absorvido
-- pela tolerancia de faltas.
--
-- Rotina diaria: olha os ultimos 7 dias esperados que ja venceram o prazo de
-- lancamento e fica atrasada com 2 faltas ou mais, seguidas ou nao. O prazo e o
-- atraso de lancamento medido em producao (p90 + 1 dia, janela 28/08 a 27/10):
-- caixa, prateleira e romaneio ate ontem; sobras ate anteontem; forno ate 3
-- dias atras; cozinha ate 6 dias atras (p90 de 5 dias desde a volta ao
-- lancamento diario em 25/09).
--
-- Instante de referencia: so conta o que ja estava lancado em p_as_of. Assim o
-- ensaio sobre o historico roda a mesma consulta trocando p_as_of por um
-- instante fixo e ve o que a regra teria visto naquela manha. Linha apagada ou
-- data corrigida depois nao se reconstitui: limite aceito do ensaio. Sobra e
-- contagem semanal nao guardam o historico de cancelamento e de fechamento;
-- para elas vale o estado atual, entao no ensaio uma sobra cancelada depois ou
-- uma contagem fechada de novo depois aparece como falta no passado. O erro e
-- so para mais, nunca esconde atraso; em tempo real o estado atual e exato. Ate
-- 28/10/2026 nao havia sobra cancelada nem contagem reaberta em producao.
--
-- Rotina so e vigiada a partir do primeiro lancamento dela (antes disso nao ha
-- rotina para parar).
--
-- NF-e, chegada: o ensaio de 28/08 a 27/10 mostrou que a automacao entrega em
-- lote, com pausas normais de ate 2 dias uteis; as unicas pausas de 3 ou mais
-- foram as paradas reais (05 a 12/10 e 16 a 26/10). Por isso o alarme dispara
-- com 3 dias uteis sem nota (o plano previa 4, a calibrar no ensaio).
--
-- Sobras: a tela nao grava "sem sobra"; dia sem lancamento conta como falta.
-- No ensaio, um dia tipico teve 7 tipos de pao sobrando (minimo de 1 a 2), entao
-- dia sem sobra lancada e quase sempre esquecimento.

create or replace function private.alarme_rotina_parada(p_as_of timestamptz default now())
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
    raise exception 'Informe o instante de referencia do alarme de rotina parada.'
      using errcode = '22004';
  end if;

  return query
  -- inicio da consulta do ensaio: o ensaio roda este texto com p_as_of trocado
  with referencia as (
    select (p_as_of at time zone 'America/Sao_Paulo')::date as hoje
  ),
  calendario as (
    select serie.dia::date as dia,
      extract(isodow from serie.dia) < 7
        and to_char(serie.dia, 'MM-DD') <> all (feriado.datas) as esperado,
      extract(isodow from serie.dia) < 6
        and to_char(serie.dia, 'MM-DD') <> all (feriado.datas) as util
    from referencia
    cross join generate_series(referencia.hoje - 120, referencia.hoje, interval '1 day') as serie(dia)
    cross join (
      select array['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'] as datas
    ) as feriado
  ),
  regras_diarias (ordem, rotina, loja, nome, prazo_dias, dias_na_janela, faltas_para_alarmar) as (
    values
      (1, 'caixa', 'jc', 'Fechamento de caixa', 1, 7, 2),
      (2, 'caixa', 'ja', 'Fechamento de caixa', 1, 7, 2),
      (3, 'sobras', 'jc', 'Sobras', 2, 7, 2),
      (4, 'sobras', 'ja', 'Sobras', 2, 7, 2),
      (5, 'prateleira', 'jc', 'Contagem de prateleira', 1, 7, 2),
      (6, 'prateleira', 'ja', 'Contagem de prateleira', 1, 7, 2),
      (7, 'forno', 'jc', 'Forno', 3, 7, 2),
      (8, 'romaneio', 'jc', 'Romaneio', 1, 7, 2),
      (9, 'cozinha', 'jc', 'Producao da cozinha', 6, 7, 2)
  ),
  registros as (
    select 'caixa'::text as rotina, fechamento.store as loja, fechamento.closing_date as dia
    from public.cash_closings as fechamento
    where fechamento.created_at <= p_as_of
    union all
    select 'sobras', sobra.store, sobra.record_date
    from public.sobras as sobra
    where sobra.created_at <= p_as_of
      and sobra.status is distinct from 'cancelled'
    union all
    select 'prateleira', prateleira.store, prateleira.record_date
    from public.shelf_counts as prateleira
    where prateleira.created_at <= p_as_of
    union all
    select 'forno', 'jc', fornada.record_date
    from public.production_actuals as fornada
    where fornada.created_at <= p_as_of
    union all
    select 'romaneio', 'jc', romaneio.record_date
    from public.romaneios as romaneio
    where romaneio.created_at <= p_as_of
    union all
    select 'cozinha', cozinha.store, cozinha.record_date
    from public.kitchen_production as cozinha
    where cozinha.produced_at <= p_as_of
      and (cozinha.cancelled_at is null or cozinha.cancelled_at > p_as_of)
  ),
  dias_registrados as (
    select distinct registro.rotina, registro.loja, registro.dia
    from registros as registro
  ),
  resumo_registros as (
    select registro.rotina, registro.loja,
      min(registro.dia) as primeiro_dia,
      max(registro.dia) filter (where registro.dia <= referencia.hoje) as ultimo_dia
    from dias_registrados as registro
    cross join referencia
    group by registro.rotina, registro.loja
  ),
  janela_diaria as (
    select regra.rotina, regra.loja, regra.dias_na_janela, calendario.dia,
      row_number() over (partition by regra.rotina, regra.loja order by calendario.dia desc) as posicao
    from regras_diarias as regra
    cross join referencia
    join resumo_registros as resumo
      on resumo.rotina = regra.rotina and resumo.loja = regra.loja
    join calendario
      on calendario.esperado
      and calendario.dia <= referencia.hoje - regra.prazo_dias
      and calendario.dia >= resumo.primeiro_dia
  ),
  faltas_diarias as (
    select janela.rotina, janela.loja,
      array_agg(janela.dia order by janela.dia) filter (where registrado.dia is null) as datas
    from janela_diaria as janela
    left join dias_registrados as registrado
      on registrado.rotina = janela.rotina
      and registrado.loja = janela.loja
      and registrado.dia = janela.dia
    where janela.posicao <= janela.dias_na_janela
    group by janela.rotina, janela.loja
  ),
  saida_diaria as (
    select regra.ordem, regra.rotina, regra.loja,
      case when cardinality(coalesce(falta.datas, array[]::date[])) >= regra.faltas_para_alarmar
        then 'atrasada' else 'em_dia' end as estado,
      resumo.ultimo_dia as ultimo_registro,
      cardinality(coalesce(falta.datas, array[]::date[])) as faltas,
      coalesce(falta.datas, array[]::date[]) as datas_faltando,
      regra.nome || ' da ' || upper(regra.loja) || ': ' ||
        case
          when resumo.primeiro_dia is null
            then 'nenhum lancamento ainda; a vigia comeca no primeiro.'
          when cardinality(coalesce(falta.datas, array[]::date[])) = 0
            then 'em dia nos ultimos ' || regra.dias_na_janela || ' dias esperados.'
          else cardinality(falta.datas) ||
            case when cardinality(falta.datas) = 1 then ' dia' else ' dias' end ||
            ' sem lancamento nos ultimos ' || regra.dias_na_janela || ' dias esperados (' ||
            array_to_string(array(
              select to_char(faltou.dia, 'DD/MM') from unnest(falta.datas) as faltou(dia) order by faltou.dia
            ), ', ') || ').'
        end as detalhe
    from regras_diarias as regra
    left join resumo_registros as resumo
      on resumo.rotina = regra.rotina and resumo.loja = regra.loja
    left join faltas_diarias as falta
      on falta.rotina = regra.rotina and falta.loja = regra.loja
  ),
  -- Venda do balcao: importacao em lote, nao diaria. Atrasada quando o ultimo
  -- dia coberto (importacao confirmada ou dia explicado) fica mais de 7 dias
  -- atras de hoje.
  venda_coberta as (
    select max(coberto.dia) filter (where coberto.dia <= referencia.hoje) as ultimo_dia
    from referencia
    left join (
      select importacao.sale_date as dia
      from public.sales_imports as importacao
      where importacao.store = 'jc'
        and importacao.status in ('confirmed', 'replaced')
        and importacao.confirmed_at <= p_as_of
      union all
      select explicado.sale_date
      from public.sales_day_statuses as explicado
      where explicado.store = 'jc'
        and explicado.recorded_at <= p_as_of
    ) as coberto on true
  ),
  saida_venda as (
    select 10 as ordem, 'venda_balcao'::text as rotina, 'jc'::text as loja,
      case when referencia.hoje - venda.ultimo_dia > 7 then 'atrasada' else 'em_dia' end as estado,
      venda.ultimo_dia as ultimo_registro,
      coalesce(cardinality(descoberto.datas), 0) as faltas,
      coalesce(descoberto.datas, array[]::date[]) as datas_faltando,
      'Venda do balcao da JC: ' ||
        case
          when venda.ultimo_dia is null
            then 'nenhuma importacao ainda; a vigia comeca na primeira.'
          else 'importada ate ' || to_char(venda.ultimo_dia, 'DD/MM') || ', ' ||
            (referencia.hoje - venda.ultimo_dia) || ' dias atras (tolerancia de 7 dias).'
        end as detalhe
    from referencia
    cross join venda_coberta as venda
    left join lateral (
      select array_agg(calendario.dia order by calendario.dia) as datas
      from calendario
      where calendario.esperado
        and calendario.dia > venda.ultimo_dia
        and calendario.dia < referencia.hoje
    ) as descoberto on true
  ),
  -- Contagem semanal da JC: cada uma das ultimas 4 semanas ja vencidas
  -- (segunda seguinte chegou) precisa de contagem fechada; aberta nao conta.
  semanas_vencidas as (
    select (date_trunc('week', referencia.hoje)::date - 7 * passo.n) as inicio
    from referencia
    cross join generate_series(1, 4) as passo(n)
  ),
  -- Fechada no instante: o ultimo fechamento ja tinha acontecido e nao houve
  -- reabertura ate ele. A tabela guarda so o ultimo fechamento, entao semana
  -- fechada de novo depois do instante conta como aberta nele.
  contagens_fechadas as (
    select contagem.week_start
    from public.inventory_weekly_counts as contagem
    where contagem.store = 'jc'
      and contagem.closed_at <= p_as_of
      and (contagem.status = 'fechada' or contagem.reopened_at > p_as_of)
  ),
  contagem_semanal as (
    select semana.inicio,
      exists (
        select 1
        from contagens_fechadas as fechada
        where fechada.week_start = semana.inicio
      ) as fechada
    from semanas_vencidas as semana
    where semana.inicio >= (
      select min(primeira.week_start)
      from public.inventory_weekly_counts as primeira
      where primeira.store = 'jc' and primeira.created_at <= p_as_of
    )
  ),
  saida_contagem as (
    select 11 as ordem, 'contagem_semanal'::text as rotina, 'jc'::text as loja,
      case when count(*) filter (where not contagem.fechada) > 0 then 'atrasada' else 'em_dia' end as estado,
      (select max(fechada.week_start) from contagens_fechadas as fechada) as ultimo_registro,
      (count(*) filter (where not contagem.fechada))::integer as faltas,
      coalesce(array_agg(contagem.inicio order by contagem.inicio) filter (where not contagem.fechada),
        array[]::date[]) as datas_faltando,
      'Contagem semanal da JC: ' ||
        case
          when count(*) = 0 then 'nenhuma semana vencida desde a primeira contagem.'
          when count(*) filter (where not contagem.fechada) = 0
            then 'fechada nas ultimas ' || count(*) || ' semanas vencidas.'
          else 'semana de ' || array_to_string(array(
              select to_char(aberta.inicio, 'DD/MM')
              from contagem_semanal as aberta
              where not aberta.fechada
              order by aberta.inicio
            ), ', semana de ') || ' sem contagem fechada.'
        end as detalhe
    from contagem_semanal as contagem
  ),
  -- NF-e, rascunho parado: rascunho pendente que ja atravessou 2 dias uteis
  -- inteiros (segunda a sexta, sem feriado) sem confirmar nem descartar.
  rascunhos_pendentes as (
    select (rascunho.created_at at time zone 'America/Sao_Paulo')::date as criado_em,
      (
        select count(*)
        from calendario
        where calendario.util
          and calendario.dia > (rascunho.created_at at time zone 'America/Sao_Paulo')::date
          and calendario.dia < referencia.hoje
      ) as dias_uteis_parado
    from public.payable_import_drafts as rascunho
    cross join referencia
    where rascunho.created_at <= p_as_of
      and (rascunho.status = 'pendente'
        or rascunho.confirmed_at > p_as_of
        or rascunho.discarded_at > p_as_of)
  ),
  saida_rascunho as (
    select 12 as ordem, 'nfe_rascunho'::text as rotina, 'todas'::text as loja,
      case when count(*) filter (where pendente.dias_uteis_parado >= 2) > 0
        then 'atrasada' else 'em_dia' end as estado,
      (select max((greatest(decidido.confirmed_at, decidido.discarded_at) at time zone 'America/Sao_Paulo')::date)
        from public.payable_import_drafts as decidido
        where greatest(decidido.confirmed_at, decidido.discarded_at) <= p_as_of) as ultimo_registro,
      (count(*) filter (where pendente.dias_uteis_parado >= 2))::integer as faltas,
      coalesce(array_agg(distinct pendente.criado_em) filter (where pendente.dias_uteis_parado >= 2),
        array[]::date[]) as datas_faltando,
      'NF-e em rascunho: ' ||
        case
          when count(*) filter (where pendente.dias_uteis_parado >= 2) = 0
            then 'nenhum rascunho parado ha 2 dias uteis.'
          else (count(*) filter (where pendente.dias_uteis_parado >= 2)) ||
            case when count(*) filter (where pendente.dias_uteis_parado >= 2) = 1
              then ' rascunho parado' else ' rascunhos parados' end ||
            ' ha 2 dias uteis ou mais sem confirmar nem descartar (o mais antigo chegou em ' ||
            to_char(min(pendente.criado_em) filter (where pendente.dias_uteis_parado >= 2), 'DD/MM') || ').'
        end as detalhe
    from rascunhos_pendentes as pendente
  ),
  -- NF-e, chegada: inatividade quando nenhuma nota chegou (rascunho criado ou
  -- compra de XML lancada) em 3 dias uteis seguidos. Nao prova que todas as
  -- notas chegaram: so a busca na Receita prova completude.
  chegada_nfe as (
    select max(chegou.dia) filter (where chegou.dia <= referencia.hoje) as ultimo_dia
    from referencia
    left join (
      select (rascunho.created_at at time zone 'America/Sao_Paulo')::date as dia
      from public.payable_import_drafts as rascunho
      where rascunho.created_at <= p_as_of
      union all
      select (compra.created_at at time zone 'America/Sao_Paulo')::date
      from public.payable_purchases as compra
      where compra.origin = 'xml' and compra.created_at <= p_as_of
    ) as chegou on true
  ),
  saida_chegada as (
    select 13 as ordem, 'nfe_entrada'::text as rotina, 'todas'::text as loja,
      case when cardinality(coalesce(sem_nota.datas, array[]::date[])) >= 3
        then 'atrasada' else 'em_dia' end as estado,
      chegada.ultimo_dia as ultimo_registro,
      cardinality(coalesce(sem_nota.datas, array[]::date[])) as faltas,
      coalesce(sem_nota.datas, array[]::date[]) as datas_faltando,
      'Entrada de NF-e: ' ||
        case
          when chegada.ultimo_dia is null
            then 'nenhuma nota ainda; a vigia comeca na primeira.'
          when cardinality(coalesce(sem_nota.datas, array[]::date[])) = 0
            then 'chegou nota no ultimo dia util.'
          else 'ultima nota chegou em ' || to_char(chegada.ultimo_dia, 'DD/MM') || ', ' ||
            cardinality(sem_nota.datas) ||
            case when cardinality(sem_nota.datas) = 1 then ' dia util' else ' dias uteis' end ||
            ' sem nota (alarme a partir de 3).'
        end as detalhe
    from referencia
    cross join chegada_nfe as chegada
    left join lateral (
      select array_agg(calendario.dia order by calendario.dia) as datas
      from calendario
      where calendario.util
        and calendario.dia > chegada.ultimo_dia
        and calendario.dia < referencia.hoje
    ) as sem_nota on true
  ),
  -- NF-e, informativo: notas lancadas nos ultimos 7 dias que chegaram mais de
  -- 7 dias depois da emissao. Nao alarma sozinho.
  notas_atrasadas as (
    select compra.nfe_issued_at
    from public.payable_purchases as compra
    cross join referencia
    where compra.origin = 'xml'
      and compra.created_at <= p_as_of
      and (compra.cancelled_at is null or compra.cancelled_at > p_as_of)
      and compra.nfe_issued_at is not null
      and (compra.created_at at time zone 'America/Sao_Paulo')::date > referencia.hoje - 7
      and (compra.created_at at time zone 'America/Sao_Paulo')::date - compra.nfe_issued_at > 7
  ),
  saida_atraso_emissao as (
    select 14 as ordem, 'nfe_atraso_emissao'::text as rotina, 'todas'::text as loja,
      case when count(*) > 0 then 'informativo' else 'em_dia' end as estado,
      max(nota.nfe_issued_at) as ultimo_registro,
      count(*)::integer as faltas,
      coalesce(array_agg(distinct nota.nfe_issued_at), array[]::date[]) as datas_faltando,
      'NF-e lancadas nos ultimos 7 dias: ' ||
        case
          when count(*) = 0 then 'nenhuma chegou com mais de 7 dias de atraso.'
          else count(*) ||
            case when count(*) = 1 then ' nota chegou' else ' notas chegaram' end ||
            ' com mais de 7 dias desde a emissao (a mais antiga emitida em ' ||
            to_char(min(nota.nfe_issued_at), 'DD/MM') || ').'
        end as detalhe
    from notas_atrasadas as nota
  ),
  todas as (
    select * from saida_diaria
    union all select * from saida_venda
    union all select * from saida_contagem
    union all select * from saida_rascunho
    union all select * from saida_chegada
    union all select * from saida_atraso_emissao
  )
  select todas.rotina, todas.loja, todas.estado, todas.ultimo_registro,
    todas.faltas, todas.datas_faltando, todas.detalhe
  from todas
  order by todas.ordem;
  -- fim da consulta do ensaio
end;
$fn$;

comment on function private.alarme_rotina_parada(timestamptz) is
  'Alarme de rotina parada: uma linha por rotina vigiada, com estado atrasada, em_dia ou informativo no instante p_as_of. Fase 1a, sem envio.';

-- Privilegio minimo: nada para anon e authenticated. O service_role nao tem
-- uso do schema private; a fase 1b chama esta funcao de dentro da funcao
-- publica de entrega (security definer), como o relatorio de vencimentos.
revoke all on function private.alarme_rotina_parada(timestamptz) from public, anon, authenticated;
grant execute on function private.alarme_rotina_parada(timestamptz) to service_role;
