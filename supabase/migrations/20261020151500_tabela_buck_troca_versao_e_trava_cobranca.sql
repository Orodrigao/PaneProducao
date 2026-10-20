-- Tabela Buck com data de validade, fase 2: achados da revisao de outra
-- familia (Codex, 20/10/2026) sobre 20261019122339 e 20261019160524.
--
--   1. A cobranca antiga (`create_receivable_from_romaneio`) passa a pegar as
--      mesmas travas de semana da troca, antes de calcular. Sem isso, uma
--      troca retroativa no meio do calculo deixava a cobranca com o preco
--      velho e o historico com o novo para o mesmo periodo.
--   2. A troca exige a versao do historico que a previa devolveu. Uma tela
--      aberta ha tempo, que conferiu a variacao contra um preco que outra
--      pessoa ja trocou, e recusada sob a trava e pede nova conferencia.
--   3. A previa com preco e data pega as mesmas travas da troca, na mesma
--      ordem, antes de ler: o antes, o depois e a versao saem do mesmo estado.
--   4. `public.buck_precos_em_vigor`: o registro mais recente de cada linha
--      da Buck, para o "desde" da tela sem depender do limite de 1.000 linhas
--      da API sobre o historico inteiro.
--
-- As travas formam uma ordem so: semanas em ordem crescente e, depois, a
-- linha da tabela. A troca, a previa e as duas cobrancas seguem essa ordem.
-- A troca muda de assinatura (versao no fim); o site no ar nao a chama, e o
-- site novo chega junto com esta migration.

begin;

lock table public.price_tier_items in share row exclusive mode;

-- ---------------------------------------------------------------------------
-- 1. Uma trava de semanas so, para todo caminho que calcula ou muda preco
-- ---------------------------------------------------------------------------
-- Mesma chave da confirmacao semanal (`cobranca-buck-semana:<segunda>`),
-- sempre em ordem crescente. Semanas antes de 07/09/2026 nao travam: nenhuma
-- troca com data chega la (`buck_troca_primeiro_dia`).
create or replace function private.buck_travar_semanas(p_de date, p_ate date)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_segunda date;
begin
  if p_de is null or p_ate is null then
    return;
  end if;

  for v_segunda in
    select segunda::date
    from generate_series(
      date_trunc('week', greatest(p_de, private.buck_troca_primeiro_dia()))::date,
      date_trunc('week', p_ate)::date,
      interval '7 days'
    ) segunda
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended('cobranca-buck-semana:' || v_segunda::text, 0));
  end loop;
end;
$fn$;

revoke all on function private.buck_travar_semanas(date, date) from public, anon, authenticated;

-- Versao do preco de uma linha: o ultimo registro do historico. Toda mudanca
-- de preco, unidade ou presenca na tabela grava um registro.
create or replace function private.buck_troca_versao(p_item_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(max(historico.seq), 0)
  from public.buck_price_history historico
  where historico.price_tier_item_id = p_item_id;
$fn$;

revoke all on function private.buck_troca_versao(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Cobranca antiga: trava as semanas antes de calcular
-- ---------------------------------------------------------------------------
-- Partida da definicao vigente: 20260814165657 com a trava por request_id de
-- 20260919235223 logo depois do begin. Unica mudanca: as travas de semana do
-- periodo, depois das conferencias do periodo e antes da conta.
create or replace function public.create_receivable_from_romaneio(
  p_request_id uuid,
  p_de date,
  p_ate date,
  p_total_conferencia numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receivable_id uuid;
  v_customer record;
  v_category_id uuid;
  v_total numeric(12,2);
  v_problemas text[];
  v_linhas integer;
  v_user_id uuid := (select auth.uid());
begin
  perform private.lock_financial_request(p_request_id);
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador da cobrança obrigatório.';
  end if;

  if not private.current_user_can_receivables('contas_receber.lancar') then
    raise exception using errcode = '42501', message = 'Sem permissão para lançar cobranças.';
  end if;

  select existing.id into v_receivable_id
  from public.receivables existing
  where existing.request_id = p_request_id;
  if v_receivable_id is not null then
    return v_receivable_id;
  end if;

  if p_de is null or p_ate is null or p_ate < p_de then
    raise exception using errcode = '22023', message = 'Informe um período válido.';
  end if;
  if p_ate > private.data_na_padaria() then
    raise exception using errcode = '22023', message = 'O período não pode terminar no futuro.';
  end if;

  -- As mesmas travas da troca de preco com data: uma troca ao mesmo tempo ou
  -- termina antes (e a conta abaixo ja usa o preco novo) ou espera esta
  -- cobranca e passa a enxerga-la na data minima.
  perform private.buck_travar_semanas(p_de, p_ate);

  select count(*)::int, coalesce(sum(linha.total), 0)
    into v_linhas, v_total
  from private.calcular_cobranca_buck(p_de, p_ate) linha;

  -- Os problemas vêm numa consulta própria: desdobrar o array na mesma
  -- agregação multiplicaria as linhas com mais de um problema e estragaria a
  -- contagem.
  select coalesce(array_agg(distinct problema), array[]::text[])
    into v_problemas
  from private.calcular_cobranca_buck(p_de, p_ate) linha,
       unnest(linha.problemas) as problema;

  if v_linhas = 0 then
    raise exception using errcode = '22023', message = 'Nenhum romaneio da EX neste período.';
  end if;

  -- As mesmas travas que já impedem a impressão do documento.
  if 'missing_price' = any(v_problemas) then
    raise exception using errcode = '22023',
      message = 'Há produto sem preço na tabela BUCK neste período. Cadastre o preço antes de cobrar.';
  end if;
  if 'unit_mismatch' = any(v_problemas) then
    raise exception using errcode = '22023',
      message = 'Há produto com unidade incompatível entre o nome e a tabela BUCK. Corrija antes de cobrar.';
  end if;
  if 'suspicious_quantity' = any(v_problemas) then
    raise exception using errcode = '22023',
      message = 'Há quantidade suspeita por peso neste período (acima de 10 kg num romaneio). Confira o lançamento antes de cobrar.';
  end if;

  if v_total is null or v_total <= 0 then
    raise exception using errcode = '22023', message = 'O período fechou em zero. Não há o que cobrar.';
  end if;

  -- O total da tela é conferido, nunca aceito.
  if p_total_conferencia is not null and round(p_total_conferencia, 2) <> v_total then
    raise exception using errcode = '22023',
      message = 'A tela mostrou ' || to_char(round(p_total_conferencia, 2), 'FM999999990.00')
        || ' e o banco calculou ' || to_char(v_total, 'FM999999990.00')
        || '. Nada foi cobrado. Atualize a tela e confira o período.';
  end if;

  select customer.id, customer.name, customer.payment_term_days
    into v_customer
  from public.customers customer
  where lower(trim(customer.name)) = 'buck' and customer.active
  limit 1;
  if v_customer.id is null then
    raise exception using errcode = 'P0002', message = 'Cliente Buck não encontrado no cadastro.';
  end if;
  if v_customer.payment_term_days is null then
    raise exception using errcode = '22023',
      message = 'A Buck ainda não tem prazo de pagamento cadastrado. Defina o prazo na tela de Clientes antes de cobrar.';
  end if;

  select category.id into v_category_id
  from public.finance_categories category
  where category.key = 'buck_ex' and category.active;
  if v_category_id is null then
    raise exception using errcode = 'P0002', message = 'Categoria de receita da Buck não encontrada.';
  end if;

  -- A data do faturamento e o ultimo dia do periodo: semana que atravessa a
  -- virada do mes pesa no mes em que fecha (decisao 10).
  v_receivable_id := private.emitir_cobrancas(
    p_request_id, v_customer.id, 'romaneio_ex', null, v_category_id,
    'Romaneios de ' || to_char(p_de, 'DD/MM') || ' a ' || to_char(p_ate, 'DD/MM/YYYY'),
    p_ate, v_total, v_customer.payment_term_days, 1, v_user_id, p_de, p_ate,
    jsonb_build_object('period_start', p_de, 'period_end', p_ate, 'linhas', v_linhas)
  );

  return v_receivable_id;
exception
  when exclusion_violation then
    raise exception using errcode = '22023',
      message = 'Este período encosta em outro já cobrado. Confira as cobranças da Buck antes de gerar.';
end;
$$;

revoke all on function public.create_receivable_from_romaneio(uuid, date, date, numeric) from public, anon;
grant execute on function public.create_receivable_from_romaneio(uuid, date, date, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. A troca exige a versao que a previa devolveu
-- ---------------------------------------------------------------------------
-- Partida de 20261019122339; mudancas: `p_versao` no fim, conferida sob as
-- travas antes de qualquer regra, e as travas pela funcao unica.
drop function if exists public.trocar_preco_buck(uuid, numeric, text, date, text, text);

create function public.trocar_preco_buck(
  p_item_id uuid,
  p_preco numeric,
  p_unidade text,
  p_vale_a_partir date,
  p_motivo text,
  p_detalhe text default null,
  p_versao bigint default null
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
  v_versao bigint;
  v_atual public.buck_price_history%rowtype;
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

  if p_versao is null then
    raise exception using errcode = '22023',
      message = 'A troca precisa da prévia calculada agora. Atualize a tela e confira a prévia antes de trocar.';
  end if;

  perform private.buck_travar_semanas(p_vale_a_partir, v_hoje);

  -- Duas trocas na mesma linha nao leem o mesmo preco em vigor.
  perform 1 from public.price_tier_items item where item.id = p_item_id for update;

  -- Quem decidiu (e confirmou a variacao) olhou esta versao; se o preco mudou
  -- desde entao, a decisao foi sobre outro estado.
  v_versao := private.buck_troca_versao(p_item_id);
  if v_versao <> p_versao then
    select historico.* into v_atual
    from public.buck_price_history historico
    where historico.price_tier_item_id = p_item_id
    order by historico.seq desc
    limit 1;
    raise exception using errcode = 'PZ002',
      message = format(
        'O preço deste pão foi trocado depois que esta tela calculou a prévia (agora: %s a partir de %s). Nada foi gravado. Confira a prévia nova e confirme de novo.',
        case when coalesce(v_atual.unit_price, 0) > 0
          then private.buck_formatar_reais(v_atual.unit_price) || '/' || v_atual.pricing_unit
          else 'sem preço' end,
        to_char(v_atual.valid_from, 'DD/MM/YYYY'));
  end if;

  v_problema := private.buck_troca_problema(p_item_id, p_preco, p_unidade, p_vale_a_partir);
  if v_problema is not null then
    raise exception using errcode = '22023', message = v_problema;
  end if;

  v_seq := private.buck_aplicar_troca(p_item_id, p_preco, p_unidade, p_vale_a_partir, v_motivo);

  return jsonb_build_object(
    'seq', v_seq,
    'versao', v_seq,
    'unit_price', p_preco,
    'pricing_unit', p_unidade,
    'valid_from', p_vale_a_partir
  );
end;
$fn$;

revoke all on function public.trocar_preco_buck(uuid, numeric, text, date, text, text, bigint) from public, anon;
grant execute on function public.trocar_preco_buck(uuid, numeric, text, date, text, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. A previa trava antes de ler e devolve a versao
-- ---------------------------------------------------------------------------
-- Partida de 20261019160524; mudancas: com preco e data na janela, as travas
-- da troca (semanas e linha) antes de ler qualquer coisa; `versao` no
-- resultado, do mesmo registro que da o preco em vigor.
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

  -- Mesma ordem da troca: semanas, depois a linha. Ate o fim desta previa
  -- nenhuma troca nem confirmacao semanal muda o que ela le.
  if p_preco is not null
     and p_vale_a_partir is not null
     and p_vale_a_partir between private.buck_troca_primeiro_dia() and v_hoje then
    perform private.buck_travar_semanas(p_vale_a_partir, v_hoje);
    select item.* into v_linha from public.price_tier_items item where item.id = p_item_id for update;
  else
    select item.* into v_linha from public.price_tier_items item where item.id = p_item_id;
  end if;
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
    'versao', coalesce(v_atual.seq, 0),
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

-- ---------------------------------------------------------------------------
-- 5. O preco em vigor de cada linha, para o "desde" da tela
-- ---------------------------------------------------------------------------
-- Uma linha por item, pelo ultimo registro. Roda com a permissao de quem
-- chama: a policy do historico (admin e financeiro) continua decidindo.
create or replace function public.buck_precos_em_vigor(p_tier_id uuid)
returns table (
  price_tier_item_id uuid,
  seq bigint,
  valid_from date,
  unit_price numeric,
  pricing_unit text
)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select distinct on (historico.price_tier_item_id)
         historico.price_tier_item_id, historico.seq, historico.valid_from,
         historico.unit_price, historico.pricing_unit
  from public.buck_price_history historico
  where historico.tier_id = p_tier_id
  order by historico.price_tier_item_id, historico.seq desc;
$fn$;

revoke all on function public.buck_precos_em_vigor(uuid) from public, anon;
grant execute on function public.buck_precos_em_vigor(uuid) to authenticated;

commit;
