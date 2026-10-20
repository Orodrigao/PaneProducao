-- Tabela Buck com data de validade (fase 2 de 3): trocar preco com data e
-- motivo, e nenhum outro caminho para mudar o preco da Buck.
--
-- Decisoes do Rodrigo (15/10 e 19/10/2026):
--   * o preco novo vale a partir de uma data escolhida por quem troca, ja
--     preenchida com hoje; sem data futura nesta versao;
--   * cobranca confirmada nao muda: a data nao pode alcancar romaneio deste
--     pao que ja entrou numa cobranca da Buck. Diferenca de semana cobrada vai
--     como acerto na proxima cobranca;
--   * quem troca preco continua sendo admin e financeiro, como hoje.
--
-- O que esta migration faz:
--   1. `public.trocar_preco_buck`: a unica porta para mudar preco ou unidade de
--      uma linha da Buck. Grava a linha e o historico na mesma transacao, com
--      a data escolhida e o motivo. Pega as mesmas travas de semana da
--      confirmacao semanal (`cobranca-buck-semana:<segunda>`), da semana da
--      data ate hoje, e trava a linha antes de conferir: uma confirmacao ao
--      mesmo tempo ou termina antes (e a troca enxerga a cobranca) ou espera.
--   2. `public.previa_troca_preco_buck`: o que a tela mostra antes de gravar:
--      data minima, preco em vigor, trocas que deixam de valer e o efeito em
--      R$ em cada semana. O efeito sai da conta de verdade: a troca e aplicada
--      dentro de um bloco que e desfeito no fim (nada fica gravado).
--   3. Trava: gravacao vinda da API (authenticated, anon, service_role) que
--      deixe uma linha da Buck com preco positivo diferente do que estava e
--      recusada, assim como incluir com preco um pao que ja teve preco na Buck
--      e trocar qual tabela e a Buck. Remover da tabela, zerar o preco, mudar o
--      pacote e incluir pao novo seguem livres. Migration e teste de banco
--      (sem papel da API) continuam gravando direto, com o gatilho da fase 1.
--   4. O gatilho do historico deixa a gravacao da troca com data para a
--      propria funcao, que sabe a data e o motivo.
--
-- Por que a regra da data e por pao e nao global: a lista do Contas a receber
-- deixa confirmar semanas fora de ordem. Uma semana parada por pao sem preco
-- nunca destravaria se uma semana mais nova, sem esse pao, ja tivesse sido
-- cobrada.
--
-- Deploy aditivo: funcoes novas, gatilhos novos e o gatilho do historico com a
-- mesma assinatura. O site no ar continua lendo tudo; so a gravacao direta do
-- preco da Buck passa a ser recusada, e a tela nova deixa de faze-la.

begin;

lock table public.price_tier_items in share row exclusive mode;

-- ---------------------------------------------------------------------------
-- 1. Regras auxiliares
-- ---------------------------------------------------------------------------

-- Antes de 07/09/2026 a Buck foi acertada fora do Contas a receber: ate 30/08
-- no livro-caixa, e a semana de 31/08 a 06/09 lancada no financeiro por partes
-- (a cobranca da semana foi cancelada por isso). A troca com data nao reescreve
-- esse periodo.
create or replace function private.buck_troca_primeiro_dia()
returns date
language sql
immutable
set search_path = ''
as $fn$
  select date '2026-09-07';
$fn$;

revoke all on function private.buck_troca_primeiro_dia() from public, anon, authenticated;

-- Gravacao vinda da API do site. Dentro de funcao security definer o papel da
-- chamada continua em `role`; migration e teste de banco rodam sem ele.
create or replace function private.buck_gravacao_pela_api()
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select coalesce(nullif(current_setting('role', true), ''), 'none')
         in ('authenticated', 'anon', 'service_role');
$fn$;

revoke all on function private.buck_gravacao_pela_api() from public, anon, authenticated;

-- Mesmo criterio da policy de gravacao de `price_tier_items`.
create or replace function private.pode_trocar_preco_buck()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and profile.role = any (array['admin'::text, 'financeiro'::text])
  );
$fn$;

revoke all on function private.pode_trocar_preco_buck() from public, anon, authenticated;

-- Data mais antiga que uma troca desta linha pode alcancar, e por que:
--   * semana_cobrada: dia seguinte a ultima cobranca da Buck (nao cancelada)
--     que tem este pao, por qualquer identidade (pao legado ou produto);
--   * outra_linha: antes do primeiro registro desta linha o preco do pao
--     estava em outra linha, e duas linhas com preco empatariam na conta;
--   * acerto_fora: o primeiro dia acima.
create or replace function private.buck_troca_data_minima(p_item_id uuid)
returns table (data_minima date, motivo text)
language sql
stable
security definer
set search_path = ''
as $fn$
  with linha as (
    select item.product_source, item.product_id
    from public.price_tier_items item
    where item.id = p_item_id
  ),
  identidades as (
    select ident.fonte, ident.pid
    from linha
    cross join lateral private.buck_identidades(linha.product_source, linha.product_id) ident
  ),
  cobrada as (
    select max(cobranca.period_end) as fim
    from public.receivables cobranca
    where cobranca.origin = 'romaneio_ex'
      and cobranca.status <> 'cancelada'
      and exists (
        select 1
        from public.receivable_romaneio_lines foto
        join identidades ident
          on ident.fonte = foto.product_source and ident.pid = foto.product_id
        where foto.receivable_id = cobranca.id
      )
  ),
  inicio_da_linha as (
    select min(historico.valid_from) as inicio
    from public.buck_price_history historico
    where historico.price_tier_item_id = p_item_id
  ),
  candidatos as (
    select private.buck_troca_primeiro_dia() as dia, 'acerto_fora'::text as motivo, 3 as ordem
    union all
    select cobrada.fim + 1, 'semana_cobrada', 1 from cobrada where cobrada.fim is not null
    union all
    select inicio_da_linha.inicio, 'outra_linha', 2 from inicio_da_linha where inicio_da_linha.inicio is not null
  )
  select candidato.dia, candidato.motivo
  from candidatos candidato
  order by candidato.dia desc, candidato.ordem
  limit 1;
$fn$;

revoke all on function private.buck_troca_data_minima(uuid) from public, anon, authenticated;

create or replace function private.buck_formatar_reais(p_valor numeric)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select 'R$ ' || replace(to_char(p_valor, 'FM999999990.00'), '.', ',');
$fn$;

revoke all on function private.buck_formatar_reais(numeric) from public, anon, authenticated;

-- O que impede a troca, em texto para a tela; null quando pode.
create or replace function private.buck_troca_problema(
  p_item_id uuid,
  p_preco numeric,
  p_unidade text,
  p_vale date
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_buck uuid := private.buck_tier_id();
  v_hoje date := private.data_na_padaria();
  v_linha public.price_tier_items%rowtype;
  v_atual public.buck_price_history%rowtype;
  v_minima date;
  v_motivo text;
begin
  select item.* into v_linha from public.price_tier_items item where item.id = p_item_id;
  if not found or v_buck is null or v_linha.tier_id is distinct from v_buck then
    return 'Este produto não está na Tabela Buck. Atualize a tela.';
  end if;
  if not v_linha.active then
    return 'Este produto foi removido da Tabela Buck. Inclua de novo antes de dar preço.';
  end if;
  if p_preco is null or p_preco <= 0 then
    return 'Informe um preço maior que zero.';
  end if;
  if p_preco <> round(p_preco, 2) then
    return 'Use no máximo duas casas depois da vírgula.';
  end if;
  if p_preco > 10000 then
    return 'Preço acima de R$ 10.000,00. Confira o valor.';
  end if;
  if p_unidade is null or p_unidade not in ('un', 'kg') then
    return 'Escolha a unidade: un ou kg.';
  end if;
  if p_vale is null then
    return 'Informe a partir de quando o preço vale.';
  end if;
  if p_vale > v_hoje then
    return 'O preço novo não pode valer a partir de uma data futura.';
  end if;

  select minima.data_minima, minima.motivo into v_minima, v_motivo
  from private.buck_troca_data_minima(p_item_id) minima;
  if p_vale < v_minima then
    return case v_motivo
      when 'semana_cobrada' then format(
        'Escolha %s ou depois: antes disso este pão já entrou numa cobrança da Buck confirmada. Diferença de semana cobrada vai como acerto na próxima cobrança.',
        to_char(v_minima, 'DD/MM/YYYY'))
      when 'outra_linha' then format(
        'Escolha %s ou depois: antes disso o preço deste pão estava em outra linha da Tabela Buck.',
        to_char(v_minima, 'DD/MM/YYYY'))
      else format(
        'Escolha %s ou depois: antes disso a Buck foi acertada fora do Contas a receber.',
        to_char(v_minima, 'DD/MM/YYYY'))
    end;
  end if;

  select historico.* into v_atual
  from public.buck_price_history historico
  where historico.price_tier_item_id = p_item_id
  order by historico.seq desc
  limit 1;
  if found
     and v_atual.unit_price = p_preco
     and v_atual.pricing_unit = p_unidade
     and p_vale >= v_atual.valid_from then
    return format('Nada muda: %s/%s já é o preço em vigor nessa data.',
      private.buck_formatar_reais(p_preco), p_unidade);
  end if;

  return null;
end;
$fn$;

revoke all on function private.buck_troca_problema(uuid, numeric, text, date) from public, anon, authenticated;

-- Motivo da troca, como fica no historico.
create or replace function private.buck_troca_motivo(p_motivo text, p_detalhe text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_detalhe text := nullif(btrim(coalesce(p_detalhe, '')), '');
begin
  if v_detalhe is not null and length(v_detalhe) > 150 then
    raise exception using errcode = '22023', message = 'Escreva o motivo em até 150 caracteres.';
  end if;
  case p_motivo
    when 'reajuste_combinado' then
      return 'Reajuste combinado com a Buck' || coalesce(': ' || v_detalhe, '');
    when 'correcao_digitacao' then
      return 'Correção de digitação' || coalesce(': ' || v_detalhe, '');
    when 'outro' then
      if v_detalhe is null or length(v_detalhe) < 3 then
        raise exception using errcode = '22023', message = 'Escreva o motivo da troca.';
      end if;
      return v_detalhe;
    else
      raise exception using errcode = '22023', message = 'Escolha o motivo da troca.';
  end case;
end;
$fn$;

revoke all on function private.buck_troca_motivo(text, text) from public, anon, authenticated;

-- Aplica a troca: linha e historico. So chamada depois de conferida.
create or replace function private.buck_aplicar_troca(
  p_item_id uuid,
  p_preco numeric,
  p_unidade text,
  p_vale date,
  p_motivo text
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_linha public.price_tier_items%rowtype;
  v_atual public.buck_price_history%rowtype;
  v_tem_atual boolean;
  v_autor uuid := (select auth.uid());
  v_nome text;
  v_evento text;
  v_seq bigint;
begin
  select historico.* into v_atual
  from public.buck_price_history historico
  where historico.price_tier_item_id = p_item_id
  order by historico.seq desc
  limit 1;
  v_tem_atual := found;

  if not v_tem_atual or coalesce(v_atual.unit_price, 0) <= 0 then
    v_evento := 'primeiro_preco';
  elsif v_atual.unit_price = p_preco and v_atual.pricing_unit is distinct from p_unidade then
    v_evento := 'troca_de_unidade';
  else
    v_evento := 'troca_de_preco';
  end if;

  -- O sinal vale so nesta transacao e so para esta linha: a trava deixa passar
  -- e o gatilho do historico nao grava por cima da data escolhida.
  perform set_config('pane.buck_troca_item', p_item_id::text, true);
  update public.price_tier_items
  set unit_price = p_preco, pricing_unit = p_unidade
  where id = p_item_id
  returning * into v_linha;
  perform set_config('pane.buck_troca_item', '', true);

  select profile.display_name into v_nome
  from public.app_profiles profile
  where profile.user_id = v_autor;

  insert into public.buck_price_history (
    price_tier_item_id, tier_id, product_source, product_id, sale_option_id,
    product_name, unit_price, pricing_unit, valid_from,
    previous_unit_price, previous_pricing_unit, event, origin, reason,
    created_by, created_by_name
  ) values (
    v_linha.id, v_linha.tier_id, v_linha.product_source, v_linha.product_id, v_linha.sale_option_id,
    v_linha.product_name, p_preco, p_unidade, p_vale,
    case when v_tem_atual then v_atual.unit_price end,
    case when v_tem_atual then v_atual.pricing_unit end,
    v_evento, 'troca_com_data', p_motivo,
    v_autor, coalesce(v_nome, private.buck_autor_sem_perfil())
  )
  returning seq into v_seq;

  return v_seq;
end;
$fn$;

revoke all on function private.buck_aplicar_troca(uuid, numeric, text, date, text) from public, anon, authenticated;

-- Total de cada semana (segunda a domingo) entre duas datas, pela conta da
-- cobranca. Linha travada (sem preco, unidade, peso) nao soma.
create or replace function private.buck_totais_por_semana(p_de date, p_ate date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(jsonb_object_agg(semana.de::text, semana.total), '{}'::jsonb)
  from (
    select segunda::date as de,
           coalesce((select sum(conta.total)
                       from private.calcular_cobranca_buck_detalhada(segunda::date, segunda::date + 6) conta), 0) as total
    from generate_series(date_trunc('week', p_de)::date, date_trunc('week', p_ate)::date, interval '7 days') segunda
  ) semana;
$fn$;

revoke all on function private.buck_totais_por_semana(date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. A troca com data
-- ---------------------------------------------------------------------------
create or replace function public.trocar_preco_buck(
  p_item_id uuid,
  p_preco numeric,
  p_unidade text,
  p_vale_a_partir date,
  p_motivo text,
  p_detalhe text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_hoje date := private.data_na_padaria();
  v_motivo text;
  v_problema text;
  v_segunda date;
  v_seq bigint;
begin
  if not private.pode_trocar_preco_buck() then
    raise exception using errcode = '42501', message = 'Sem permissão para trocar preço da Tabela Buck.';
  end if;

  v_motivo := private.buck_troca_motivo(p_motivo, p_detalhe);

  -- A data fora da janela nem chega a travar semanas.
  if p_vale_a_partir is null or p_vale_a_partir > v_hoje or p_vale_a_partir < private.buck_troca_primeiro_dia() then
    v_problema := coalesce(
      private.buck_troca_problema(p_item_id, p_preco, p_unidade, p_vale_a_partir),
      'Informe a partir de quando o preço vale.');
    raise exception using errcode = '22023', message = v_problema;
  end if;

  -- Mesma chave da confirmacao semanal, sempre em ordem crescente.
  for v_segunda in
    select segunda::date
    from generate_series(date_trunc('week', p_vale_a_partir)::date, date_trunc('week', v_hoje)::date, interval '7 days') segunda
  loop
    perform pg_advisory_xact_lock(hashtextextended('cobranca-buck-semana:' || v_segunda::text, 0));
  end loop;

  -- Duas trocas na mesma linha nao leem o mesmo preco em vigor.
  perform 1 from public.price_tier_items item where item.id = p_item_id for update;

  v_problema := private.buck_troca_problema(p_item_id, p_preco, p_unidade, p_vale_a_partir);
  if v_problema is not null then
    raise exception using errcode = '22023', message = v_problema;
  end if;

  v_seq := private.buck_aplicar_troca(p_item_id, p_preco, p_unidade, p_vale_a_partir, v_motivo);

  return jsonb_build_object(
    'seq', v_seq,
    'unit_price', p_preco,
    'pricing_unit', p_unidade,
    'valid_from', p_vale_a_partir
  );
end;
$fn$;

revoke all on function public.trocar_preco_buck(uuid, numeric, text, date, text, text) from public, anon;
grant execute on function public.trocar_preco_buck(uuid, numeric, text, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. O que a tela mostra antes de gravar
-- ---------------------------------------------------------------------------
create or replace function public.previa_troca_preco_buck(
  p_item_id uuid,
  p_preco numeric default null,
  p_unidade text default null,
  p_vale_a_partir date default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_buck uuid := private.buck_tier_id();
  v_hoje date := private.data_na_padaria();
  v_linha public.price_tier_items%rowtype;
  v_atual public.buck_price_history%rowtype;
  v_minima date;
  v_motivo_minima text;
  v_unidade text;
  v_problema text;
  v_deixam jsonb := '[]'::jsonb;
  v_antes jsonb;
  v_depois jsonb;
  v_semanas jsonb := '[]'::jsonb;
  v_resultado jsonb;
begin
  if not private.pode_trocar_preco_buck() then
    raise exception using errcode = '42501', message = 'Sem permissão para trocar preço da Tabela Buck.';
  end if;

  select item.* into v_linha from public.price_tier_items item where item.id = p_item_id;
  if not found or v_buck is null or v_linha.tier_id is distinct from v_buck then
    raise exception using errcode = '22023', message = 'Este produto não está na Tabela Buck. Atualize a tela.';
  end if;

  select minima.data_minima, minima.motivo into v_minima, v_motivo_minima
  from private.buck_troca_data_minima(p_item_id) minima;

  select historico.* into v_atual
  from public.buck_price_history historico
  where historico.price_tier_item_id = p_item_id
  order by historico.seq desc
  limit 1;

  v_resultado := jsonb_build_object(
    'hoje', v_hoje,
    'data_minima', v_minima,
    'motivo_data_minima', v_motivo_minima,
    'vigente', case when v_atual.seq is null then null else jsonb_build_object(
      'unit_price', v_atual.unit_price,
      'pricing_unit', v_atual.pricing_unit,
      'valid_from', v_atual.valid_from
    ) end
  );

  if p_preco is null or p_vale_a_partir is null then
    return v_resultado;
  end if;

  v_unidade := coalesce(p_unidade, v_linha.pricing_unit);
  v_problema := private.buck_troca_problema(p_item_id, p_preco, v_unidade, p_vale_a_partir);
  if v_problema is not null then
    return v_resultado || jsonb_build_object('problema', v_problema);
  end if;

  -- Registros que ainda valem para algum dia e que a troca cobre inteiros.
  select coalesce(jsonb_agg(jsonb_build_object(
           'valid_from', historico.valid_from,
           'unit_price', historico.unit_price,
           'pricing_unit', historico.pricing_unit
         ) order by historico.valid_from, historico.seq), '[]'::jsonb)
    into v_deixam
  from public.buck_price_history historico
  where historico.price_tier_item_id = p_item_id
    and historico.valid_from >= p_vale_a_partir
    and not exists (
      select 1 from public.buck_price_history depois
      where depois.price_tier_item_id = historico.price_tier_item_id
        and depois.seq > historico.seq
        and depois.valid_from <= historico.valid_from
    );

  -- Efeito pela conta de verdade: aplica, mede e desfaz.
  v_antes := private.buck_totais_por_semana(p_vale_a_partir, v_hoje);
  begin
    perform private.buck_aplicar_troca(p_item_id, p_preco, v_unidade, p_vale_a_partir, 'Prévia da troca');
    v_depois := private.buck_totais_por_semana(p_vale_a_partir, v_hoje);
    raise exception using errcode = 'PZ001', message = 'previa desfeita';
  exception
    when sqlstate 'PZ001' then
      null;
  end;

  select coalesce(jsonb_agg(jsonb_build_object(
           'de', antes.key::date,
           'ate', antes.key::date + 6,
           'antes', antes.value::numeric,
           'depois', (v_depois ->> antes.key)::numeric
         ) order by antes.key), '[]'::jsonb)
    into v_semanas
  from jsonb_each_text(v_antes) antes
  where antes.value::numeric is distinct from (v_depois ->> antes.key)::numeric;

  return v_resultado || jsonb_build_object(
    'problema', null,
    'deixam_de_valer', v_deixam,
    'semanas', v_semanas
  );
end;
$fn$;

revoke all on function public.previa_troca_preco_buck(uuid, numeric, text, date) from public, anon;
grant execute on function public.previa_troca_preco_buck(uuid, numeric, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Trava: nenhum outro caminho muda o preco da Buck
-- ---------------------------------------------------------------------------
create or replace function private.buck_trava_troca_sem_data()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_buck uuid;
begin
  if not private.buck_gravacao_pela_api() then
    return coalesce(new, old);
  end if;

  v_buck := private.buck_tier_id();
  if v_buck is null or tg_op = 'DELETE' then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    if new.tier_id = v_buck
       and new.active
       and coalesce(new.unit_price, 0) > 0
       and private.buck_produto_ja_teve_preco(new.product_source, new.product_id) then
      raise exception using errcode = '22023',
        message = 'O preço da Tabela Buck só muda pelo botão "Trocar preço", com data e motivo. Inclua o produto sem preço e use o botão.';
    end if;
    return new;
  end if;

  if (old.tier_id = v_buck or new.tier_id = v_buck)
     and new.active
     and coalesce(new.unit_price, 0) > 0
     and (old.unit_price is distinct from new.unit_price
          or old.pricing_unit is distinct from new.pricing_unit
          or not old.active
          or old.tier_id is distinct from new.tier_id)
     and current_setting('pane.buck_troca_item', true) is distinct from new.id::text then
    raise exception using errcode = '22023',
      message = 'O preço da Tabela Buck só muda pelo botão "Trocar preço", com data e motivo.';
  end if;
  return new;
end;
$fn$;

revoke all on function private.buck_trava_troca_sem_data() from public, anon, authenticated;

drop trigger if exists price_tier_items_trava_troca_buck on public.price_tier_items;

create trigger price_tier_items_trava_troca_buck
before insert or update on public.price_tier_items
for each row execute function private.buck_trava_troca_sem_data();

-- Trocar qual tabela e a Buck muda o preco cobrado sem data nem motivo.
create or replace function private.buck_trava_troca_de_tabela()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_era_buck boolean := tg_op in ('UPDATE', 'DELETE') and lower(trim(old.name)) = 'buck' and old.active;
  v_e_buck boolean := tg_op in ('INSERT', 'UPDATE') and lower(trim(new.name)) = 'buck' and new.active;
begin
  if private.buck_gravacao_pela_api() and v_era_buck is distinct from v_e_buck then
    raise exception using errcode = '22023',
      message = 'A Tabela Buck não pode ser renomeada, desativada nem trocada por outra pela tela: isso mudaria o preço cobrado da Buck sem data nem motivo.';
  end if;
  return coalesce(new, old);
end;
$fn$;

revoke all on function private.buck_trava_troca_de_tabela() from public, anon, authenticated;

drop trigger if exists price_tiers_trava_troca_buck on public.price_tiers;

create trigger price_tiers_trava_troca_buck
before insert or update of name, active or delete on public.price_tiers
for each row execute function private.buck_trava_troca_de_tabela();

-- ---------------------------------------------------------------------------
-- 5. Gatilho do historico: a troca com data grava o proprio registro
-- ---------------------------------------------------------------------------
-- Partida de 20261016135709; unica mudanca: sai antes de gravar quando a linha
-- e a da troca com data em andamento.
create or replace function private.registrar_historico_preco_buck()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_buck uuid := private.buck_tier_id();
  v_hoje date := private.data_na_padaria();
  v_linha public.price_tier_items%rowtype;
  v_atual public.buck_price_history%rowtype;
  v_tem_atual boolean;
  v_atual_positivo boolean;
  v_preco numeric;
  v_unidade text;
  v_evento text;
  v_validade date;
  v_autor uuid := (select auth.uid());
  v_nome text;
begin
  if v_buck is null then
    return null;
  end if;

  if tg_op = 'UPDATE'
     and (old.tier_id = v_buck or new.tier_id = v_buck)
     and (old.tier_id is distinct from new.tier_id
          or old.product_id is distinct from new.product_id
          or old.product_source is distinct from new.product_source) then
    raise exception using errcode = '22023',
      message = 'Uma linha da Tabela Buck não muda de produto nem de tabela. Remova a linha e inclua o produto certo.';
  end if;

  if tg_op = 'DELETE' then
    v_linha := old;
  else
    v_linha := new;
  end if;

  if v_linha.tier_id is distinct from v_buck then
    return null;
  end if;

  -- A troca com data (public.trocar_preco_buck) grava o registro com a data e
  -- o motivo escolhidos.
  if current_setting('pane.buck_troca_item', true) = v_linha.id::text then
    return null;
  end if;

  select historico.* into v_atual
  from public.buck_price_history historico
  where historico.price_tier_item_id = v_linha.id
  order by historico.seq desc
  limit 1;
  v_tem_atual := found;
  v_atual_positivo := v_tem_atual and coalesce(v_atual.unit_price, 0) > 0;

  if tg_op = 'DELETE' then
    v_preco := null;
    v_unidade := null;
  elsif new.active then
    v_preco := new.unit_price;
    v_unidade := new.pricing_unit;
  else
    v_preco := null;
    v_unidade := null;
  end if;

  if tg_op = 'INSERT' or not v_tem_atual then
    v_evento := 'cadastro';
    if private.buck_produto_ja_teve_preco(v_linha.product_source, v_linha.product_id) then
      v_validade := v_hoje;
    else
      v_validade := private.buck_preco_desde_sempre();
    end if;
  elsif v_preco is not distinct from v_atual.unit_price
        and v_unidade is not distinct from v_atual.pricing_unit then
    return null;
  elsif tg_op = 'DELETE' then
    v_evento := 'exclusao';
    v_validade := case when v_atual_positivo then v_hoje else v_atual.valid_from end;
  elsif v_preco is null then
    v_evento := 'remocao';
    v_validade := case when v_atual_positivo then v_hoje else v_atual.valid_from end;
  elsif not v_atual_positivo then
    v_evento := 'primeiro_preco';
    v_validade := v_atual.valid_from;
  elsif v_unidade is distinct from v_atual.pricing_unit then
    v_evento := 'troca_de_unidade';
    v_validade := v_atual.valid_from;
  else
    v_evento := 'troca_de_preco';
    v_validade := v_hoje;
  end if;

  -- Gravacoes seguidas da mesma pessoa na mesma linha, em ate 10 minutos, sao
  -- uma edicao so (a tela antiga salva a cada tecla).
  if v_tem_atual
     and v_evento in ('troca_de_preco', 'remocao', 'exclusao')
     and v_atual.origin = 'tabela'
     and v_atual.created_by is not distinct from v_autor
     and v_atual.created_at > clock_timestamp() - interval '10 minutes' then
    v_validade := v_atual.valid_from;
  end if;

  select profile.display_name into v_nome
  from public.app_profiles profile
  where profile.user_id = v_autor;

  insert into public.buck_price_history (
    price_tier_item_id, tier_id, product_source, product_id, sale_option_id,
    product_name, unit_price, pricing_unit, valid_from,
    previous_unit_price, previous_pricing_unit, event, origin,
    created_by, created_by_name
  ) values (
    v_linha.id, v_linha.tier_id, v_linha.product_source, v_linha.product_id, v_linha.sale_option_id,
    v_linha.product_name, v_preco, v_unidade, v_validade,
    case when v_tem_atual then v_atual.unit_price end,
    case when v_tem_atual then v_atual.pricing_unit end,
    v_evento, 'tabela',
    v_autor, coalesce(v_nome, private.buck_autor_sem_perfil())
  );

  return null;
end;
$fn$;

revoke all on function private.registrar_historico_preco_buck() from public, anon, authenticated;

commit;
