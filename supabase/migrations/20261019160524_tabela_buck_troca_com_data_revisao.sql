-- Tabela Buck com data de validade, fase 2: achados da revisao independente
-- do codigo (mesma PR de 20261019122339).
--
--   1. Data minima: cobranca confirmada conta mesmo sem foto das linhas. A
--      funcao antiga `create_receivable_from_romaneio` ainda cria cobranca da
--      EX sem foto; antes, a troca podia voltar para dentro dela. Agora conta
--      toda cobranca nao cancelada cujo periodo tem romaneio deste pao (por
--      qualquer identidade), alem das que tem o pao na foto.
--   2. Duas linhas com preco para o mesmo pao e a mesma unidade (duas opcoes
--      de venda, ou pao legado e produto): a conta nao separa as duas, porque
--      o romaneio nao diz a opcao de venda, e escolhe uma pela ordem do id.
--      Trocar a outra nao muda nada. A troca passa a ser recusada dizendo qual
--      e a outra linha. Em producao, em 19/10/2026, o Brioche tem duas linhas
--      "un" (Hamburguer a 1,37 e Forma a 8,50); as cobrancas usaram 1,37.
--   3. Inclusao pela API na Tabela Buck entra sempre sem preco (o preco vem
--      pela troca com data). Fecha a inclusao de varias linhas num comando so,
--      em que a checagem de "ja teve preco" nao enxergava as irmas, e o
--      caminho "desde sempre" sem data. Copiar produto continua funcionando;
--      a linha da copia na Buck entra sem preco.
--   4. A previa mostra so este pao, semana a semana, com quantidade e se a
--      conta dele tem problema (sem preco, unidade, peso), e so calcula as
--      semanas em que ele saiu.
--   5. O preco "anterior" do historico e o que valia na data escolhida, nao o
--      ultimo gravado (troca retroativa mostrava o preco errado).
--
-- Mesmos nomes, argumentos e retornos das funcoes publicas: deploy aditivo.

begin;

lock table public.price_tier_items in share row exclusive mode;

-- ---------------------------------------------------------------------------
-- 1. Data minima: cobranca com ou sem foto
-- ---------------------------------------------------------------------------
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
      and (
        exists (
          select 1
          from public.receivable_romaneio_lines foto
          join identidades ident
            on ident.fonte = foto.product_source and ident.pid = foto.product_id
          where foto.receivable_id = cobranca.id
        )
        or exists (
          select 1
          from public.romaneio_items item
          join public.romaneios romaneio on romaneio.id = item.romaneio_id
          join public.destinations destino on destino.id = romaneio.destination_id
          join identidades ident
            on ident.fonte = item.product_source and ident.pid = item.product_id
          where upper(destino.code) = 'EX'
            and destino.active
            and romaneio.status <> 'separado'
            and romaneio.record_date between cobranca.period_start and cobranca.period_end
        )
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

-- ---------------------------------------------------------------------------
-- 2. Outra linha com preco para o mesmo pao e a mesma unidade
-- ---------------------------------------------------------------------------
create or replace function private.buck_outra_linha_com_preco(p_item_id uuid, p_unidade text)
returns table (rotulo text, unit_price numeric, pricing_unit text)
language sql
stable
security definer
set search_path = ''
as $fn$
  with linha as (
    select item.id, item.tier_id, item.product_source, item.product_id
    from public.price_tier_items item
    where item.id = p_item_id
  ),
  identidades as (
    select ident.fonte, ident.pid
    from linha
    cross join lateral private.buck_identidades(linha.product_source, linha.product_id) ident
  )
  select outra.product_name || coalesce(' · ' || opcao.name, ''),
         trim_scale(outra.unit_price),
         outra.pricing_unit
  from linha
  join public.price_tier_items outra
    on outra.tier_id = linha.tier_id and outra.id <> linha.id
  left join public.product_sale_options opcao on opcao.id = outra.sale_option_id
  where outra.active
    and coalesce(outra.unit_price, 0) > 0
    and outra.pricing_unit = p_unidade
    and exists (
      select 1 from identidades ident
      where ident.fonte = outra.product_source and ident.pid = outra.product_id
    )
  order by outra.id
  limit 1;
$fn$;

revoke all on function private.buck_outra_linha_com_preco(uuid, text) from public, anon, authenticated;

-- Partida de 20261019122339; mudanca: recusa quando outra linha do mesmo pao
-- e da mesma unidade tem preco.
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
  v_outra record;
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

  select outra.* into v_outra from private.buck_outra_linha_com_preco(p_item_id, p_unidade) outra;
  if found then
    return format(
      'Este pão tem outra linha com preço na Tabela Buck (%s, %s/%s). A cobrança não separa as duas, porque o romaneio não diz a opção de venda. Remova da Tabela Buck a linha que a Buck não compra e troque o preço na que ficar.',
      v_outra.rotulo, private.buck_formatar_reais(v_outra.unit_price), v_outra.pricing_unit);
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

-- ---------------------------------------------------------------------------
-- 5. O preco anterior e o que valia na data escolhida
-- ---------------------------------------------------------------------------
-- Partida de 20261019122339; mudanca: preco anterior e evento pelo preco que
-- valia em p_vale, nao pelo ultimo registro.
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
  v_antes_preco numeric;
  v_antes_unidade text;
  v_autor uuid := (select auth.uid());
  v_nome text;
  v_evento text;
  v_seq bigint;
begin
  select na_data.unit_price, na_data.pricing_unit into v_antes_preco, v_antes_unidade
  from private.buck_preco_na_data(p_item_id, p_vale) na_data;

  if coalesce(v_antes_preco, 0) <= 0 then
    v_evento := 'primeiro_preco';
  elsif v_antes_preco = p_preco and v_antes_unidade is distinct from p_unidade then
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
    v_antes_preco, v_antes_unidade,
    v_evento, 'troca_com_data', p_motivo,
    v_autor, coalesce(v_nome, private.buck_autor_sem_perfil())
  )
  returning seq into v_seq;

  return v_seq;
end;
$fn$;

revoke all on function private.buck_aplicar_troca(uuid, numeric, text, date, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Previa: so este pao, nas semanas em que ele saiu
-- ---------------------------------------------------------------------------
-- Por semana (chave = segunda): quantidade, total e se alguma linha deste pao
-- tem problema na conta (sem preco, unidade, peso).
create or replace function private.buck_resumo_do_pao(p_item_id uuid, p_segundas date[])
returns jsonb
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
  )
  select coalesce(jsonb_object_agg(semana.de::text, jsonb_build_object(
           'quantidade', semana.quantidade,
           'unidade', semana.unidade,
           'total', semana.total,
           'problema', semana.problema
         )), '{}'::jsonb)
  from (
    select segunda as de,
           coalesce(sum(conta.quantidade), 0) as quantidade,
           max(conta.unidade) as unidade,
           coalesce(sum(conta.total), 0) as total,
           coalesce(bool_or(conta.total is null or cardinality(conta.problemas) > 0), false) as problema
    from unnest(p_segundas) segunda
    left join lateral (
      select detalhe.*
      from private.calcular_cobranca_buck_detalhada(segunda, segunda + 6) detalhe
      where exists (
        select 1 from identidades ident
        where ident.fonte = detalhe.product_source and ident.pid = detalhe.product_id
      )
    ) conta on true
    group by segunda
  ) semana;
$fn$;

revoke all on function private.buck_resumo_do_pao(uuid, date[]) from public, anon, authenticated;

-- Partida de 20261019122339; mudanca: o efeito sai de buck_resumo_do_pao, so
-- nas semanas com romaneio deste pao entre a data e hoje.
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
  v_segundas date[];
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

  -- Semanas em que este pao saiu para a EX entre a data e hoje.
  select coalesce(array_agg(distinct date_trunc('week', romaneio.record_date)::date
                            order by date_trunc('week', romaneio.record_date)::date), array[]::date[])
    into v_segundas
  from public.romaneio_items item
  join public.romaneios romaneio on romaneio.id = item.romaneio_id
  join public.destinations destino on destino.id = romaneio.destination_id
  join private.buck_identidades(v_linha.product_source, v_linha.product_id) ident
    on ident.fonte = item.product_source and ident.pid = item.product_id
  where upper(destino.code) = 'EX'
    and destino.active
    and romaneio.status <> 'separado'
    and romaneio.record_date between p_vale_a_partir and v_hoje;

  if cardinality(v_segundas) > 0 then
    -- Efeito pela conta de verdade: aplica, mede e desfaz.
    v_antes := private.buck_resumo_do_pao(p_item_id, v_segundas);
    begin
      perform private.buck_aplicar_troca(p_item_id, p_preco, v_unidade, p_vale_a_partir, 'Prévia da troca');
      v_depois := private.buck_resumo_do_pao(p_item_id, v_segundas);
      raise exception using errcode = 'PZ001', message = 'previa desfeita';
    exception
      when sqlstate 'PZ001' then
        null;
    end;

    select coalesce(jsonb_agg(jsonb_build_object(
             'de', antes.key::date,
             'ate', antes.key::date + 6,
             'quantidade', (v_depois -> antes.key ->> 'quantidade')::numeric,
             'unidade', v_depois -> antes.key ->> 'unidade',
             'antes', (antes.value ->> 'total')::numeric,
             'depois', (v_depois -> antes.key ->> 'total')::numeric,
             'problema_antes', (antes.value ->> 'problema')::boolean,
             'problema_depois', (v_depois -> antes.key ->> 'problema')::boolean
           ) order by antes.key), '[]'::jsonb)
      into v_semanas
    from jsonb_each(v_antes) antes;
  end if;

  return v_resultado || jsonb_build_object(
    'problema', null,
    'deixam_de_valer', v_deixam,
    'semanas', v_semanas
  );
end;
$fn$;

revoke all on function public.previa_troca_preco_buck(uuid, numeric, text, date) from public, anon;
grant execute on function public.previa_troca_preco_buck(uuid, numeric, text, date) to authenticated;

drop function if exists private.buck_totais_por_semana(date, date);

-- ---------------------------------------------------------------------------
-- 3. Inclusao pela API na Tabela Buck entra sem preco
-- ---------------------------------------------------------------------------
-- Partida de 20261019122339; mudanca: inclusao vinda da API na Buck tem o
-- preco zerado (antes: recusada so quando o pao ja tinha tido preco).
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
    if new.tier_id = v_buck and coalesce(new.unit_price, 0) > 0 then
      new.unit_price := 0;
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

commit;
