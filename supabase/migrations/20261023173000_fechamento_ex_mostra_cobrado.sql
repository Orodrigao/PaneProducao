-- Tabela Buck com data de validade, fase 3: o Fechamento EX mostra o que foi
-- cobrado.
--
-- Ate aqui o Fechamento EX refazia a conta de qualquer periodo pelo preco do
-- dia de cada romaneio, inclusive nas semanas ja cobradas. A semana cobrada,
-- porem, tem foto: as linhas e os ajustes gravados na confirmacao
-- (`receivable_romaneio_lines` e `receivable_adjustments`). Quando um preco ou
-- um romaneio muda depois, a conta refeita diverge do que foi cobrado da Buck
-- (caso real: semanas de 21/09 e 28/09, confirmadas com o preco novo).
--
-- Decisoes do Rodrigo (19/10/2026), docs/CONTAS_A_RECEBER.md, Fase 6A:
--   * quem tem acesso ao Contas a receber ve a semana cobrada com o que foi
--     cobrado (rotulo "Cobrado", nao "pago"), inteira no periodo que contem o
--     domingo dela, com os ajustes;
--   * romaneio lancado ou editado depois da cobranca aparece como "entregue
--     depois, nao cobrado" (e o que saiu do romaneio depois, como cobrado a
--     mais);
--   * quem nao tem acesso ao Contas a receber (como a vendas da EX) continua
--     vendo o Fechamento EX pelo preco do dia, sem o valor cobrado.
--
-- Uma funcao nova, so de leitura. `list_romaneio_ex_billing` fica como esta:
-- o site no ar le dela durante a janela do deploy, e o roteiro do preview da
-- fase 2 tambem.
--
-- Regras desta funcao:
--   * cobranca da Buck e a de origem `romaneio_ex` que nao foi cancelada. Ela
--     aparece inteira no periodo que contem o ultimo dia dela (o domingo, na
--     semana de segunda a domingo); em periodo que nao contem esse dia, os dias
--     dela nao aparecem como "a cobrar". Cobranca feita pela funcao antiga
--     `create_receivable_from_romaneio` nao tem foto: aparece pelo valor, sem
--     linhas nem comparacao;
--   * "a cobrar" e a conta de sempre (`private.calcular_cobranca_buck_detalhada`)
--     nos dias do periodo que nenhuma cobranca cobre, por trecho continuo; o
--     mesmo produto ao mesmo preco em dois trechos vira uma linha. Sem cobranca
--     no meio e uma chamada so, igual ao `list_romaneio_ex_billing`;
--   * "depois da cobranca" compara item a item a foto com a conta de hoje do
--     periodo da cobranca. Item igual (mesmo produto, unidade e quantidade)
--     nao entra; o resto entra pelo que tinha na foto (ao preco da foto) e
--     pelo que tem hoje (ao preco do dia), somado por produto, unidade e
--     preco. O que se anula some.
--
-- Deploy aditivo: nada aqui muda o que o site no ar usa.

begin;

-- A ordem dos problemas e a da conta (`calcular_cobranca_buck_detalhada`):
-- sem cobranca no meio, "a cobrar" sai identico ao `list_romaneio_ex_billing`.
create or replace function private.fechamento_ex_ordem_problema(p_problema text)
returns integer
language sql
immutable
set search_path = ''
as $fn$
  select coalesce(array_position(array['missing_price', 'unit_mismatch', 'suspicious_quantity'], p_problema), 99);
$fn$;

revoke all on function private.fechamento_ex_ordem_problema(text) from public, anon, authenticated;

create or replace function public.list_romaneio_ex_fechamento(p_de date, p_ate date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_mostra_cobrado boolean;
  v_cobertas daterange[] := array[]::daterange[];
  v_a_cobrar jsonb;
  v_cobrancas jsonb;
  v_fora jsonb;
begin
  if not private.pode_ler_fechamento_ex() then
    raise exception using errcode = '42501', message = 'Sem permissão para ver o Fechamento EX.';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de then
    raise exception using errcode = '22023', message = 'Informe um período válido.';
  end if;
  if p_ate - p_de > 1100 then
    raise exception using errcode = '22023', message = 'Escolha um período de até três anos.';
  end if;

  -- O valor cobrado mora no Contas a receber: so quem le o Contas a receber
  -- ve. Para os outros, a conta do periodo inteiro pelo preco do dia.
  v_mostra_cobrado := private.current_user_can_receivables('contas_receber.acessar');

  if v_mostra_cobrado then
    select coalesce(array_agg(daterange(cobranca.period_start, cobranca.period_end, '[]')),
                    array[]::daterange[])
      into v_cobertas
    from public.receivables cobranca
    where cobranca.origin = 'romaneio_ex'
      and cobranca.status <> 'cancelada'
      and cobranca.period_start <= cobranca.period_end
      and cobranca.period_start <= p_ate
      and cobranca.period_end >= p_de;
  end if;

  -- A cobrar ---------------------------------------------------------------
  with dias as (
    select serie.dia::date as dia
    from generate_series(p_de::timestamp, p_ate::timestamp, interval '1 day') serie(dia)
    where not exists (
      select 1 from unnest(v_cobertas) coberta(periodo)
      where serie.dia::date <@ coberta.periodo
    )
  ),
  trechos as (
    select min(ilha.dia) as de, max(ilha.dia) as ate
    from (
      select dias.dia, dias.dia - (row_number() over (order by dias.dia))::int as grupo
      from dias
    ) ilha
    group by ilha.grupo
  ),
  linhas as (
    select conta.product_source, conta.product_id, conta.produto, conta.unidade,
           conta.quantidade, conta.preco_unitario, conta.total, conta.problemas, conta.itens
    from trechos
    cross join lateral private.calcular_cobranca_buck_detalhada(trechos.de, trechos.ate) conta
  ),
  -- O total da linha reunida e a quantidade reunida vezes o preco, com um
  -- arredondamento so (somar totais ja arredondados erraria o centavo).
  somas as (
    select linha.product_source, linha.product_id, linha.produto, linha.unidade, linha.preco_unitario,
           sum(linha.quantidade) as quantidade,
           case when bool_or(linha.total is null) or linha.preco_unitario is null then null
                else round(sum(linha.quantidade) * linha.preco_unitario, 2) end as total
    from linhas linha
    group by linha.product_source, linha.product_id, linha.produto, linha.unidade, linha.preco_unitario
  ),
  itens as (
    select linha.product_source, linha.product_id, linha.produto, linha.unidade, linha.preco_unitario,
           jsonb_agg(item.value order by item.value ->> 'record_date', item.value ->> 'romaneio_item_id') as itens
    from linhas linha
    cross join lateral jsonb_array_elements(linha.itens) item
    group by linha.product_source, linha.product_id, linha.produto, linha.unidade, linha.preco_unitario
  ),
  problemas as (
    select problema.product_source, problema.product_id, problema.produto, problema.unidade,
           problema.preco_unitario,
           array_agg(problema.valor order by private.fechamento_ex_ordem_problema(problema.valor)) as problemas
    from (
      select distinct linha.product_source, linha.product_id, linha.produto, linha.unidade,
             linha.preco_unitario, valor
      from linhas linha
      cross join lateral unnest(linha.problemas) as lista(valor)
    ) problema
    group by problema.product_source, problema.product_id, problema.produto, problema.unidade,
             problema.preco_unitario
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'product_source', soma.product_source,
           'product_id', soma.product_id,
           'produto', soma.produto,
           'unidade', soma.unidade,
           'quantidade', soma.quantidade,
           'preco_unitario', soma.preco_unitario,
           'total', soma.total,
           'problemas', to_jsonb(coalesce(problema.problemas, array[]::text[])),
           'itens', item.itens
         ) order by soma.produto, soma.unidade, (item.itens -> 0 ->> 'record_date'),
                    soma.preco_unitario nulls first), '[]'::jsonb)
    into v_a_cobrar
  from somas soma
  join itens item
    on item.product_source = soma.product_source
   and item.product_id = soma.product_id
   and item.produto = soma.produto
   and item.unidade = soma.unidade
   and item.preco_unitario is not distinct from soma.preco_unitario
  left join problemas problema
    on problema.product_source = soma.product_source
   and problema.product_id = soma.product_id
   and problema.produto = soma.produto
   and problema.unidade = soma.unidade
   and problema.preco_unitario is not distinct from soma.preco_unitario;

  -- Cobrancas que terminam dentro do periodo, inteiras ----------------------
  select coalesce(jsonb_agg(jsonb_build_object(
           'receivable_id', cobranca.id,
           'period_start', cobranca.period_start,
           'period_end', cobranca.period_end,
           'amount', cobranca.amount,
           'com_foto', foto.com_foto,
           'linhas', foto.linhas,
           'ajustes', ajuste.lista,
           'depois', depois.lista
         ) order by cobranca.period_start), '[]'::jsonb)
    into v_cobrancas
  from public.receivables cobranca
  cross join lateral (
    select count(*) > 0 as com_foto,
           coalesce(jsonb_agg(jsonb_build_object(
             'product_source', linha.product_source,
             'product_id', linha.product_id,
             'produto', linha.product_name,
             'unidade', linha.unidade,
             'quantidade', linha.quantidade,
             'preco_unitario', linha.preco_unitario,
             'total', linha.total,
             'problemas', '[]'::jsonb,
             'itens', linha.itens
           ) order by linha.product_name, linha.unidade, (linha.itens -> 0 ->> 'record_date'),
                      linha.preco_unitario), '[]'::jsonb) as linhas
    from public.receivable_romaneio_lines linha
    where linha.receivable_id = cobranca.id
  ) foto
  cross join lateral (
    select coalesce(jsonb_agg(jsonb_build_object(
             'position', registro.position,
             'kind', registro.kind,
             'description', registro.description,
             'product_name', registro.product_name,
             'quantity', registro.quantity,
             'unit', registro.unit,
             'unit_price', registro.unit_price,
             'amount', registro.amount
           ) order by registro.position), '[]'::jsonb) as lista
    from public.receivable_adjustments registro
    where registro.receivable_id = cobranca.id
  ) ajuste
  cross join lateral (
    with na_foto as (
      select linha.product_source, linha.product_id, linha.product_name as produto, linha.unidade,
             linha.preco_unitario as preco, '[]'::jsonb as problemas,
             item.value ->> 'romaneio_item_id' as item_id,
             item.value ->> 'romaneio_id' as romaneio_id,
             (item.value ->> 'record_date')::date as record_date,
             (item.value ->> 'quantidade_usada')::numeric as quantidade
      from public.receivable_romaneio_lines linha
      cross join lateral jsonb_array_elements(linha.itens) item
      where linha.receivable_id = cobranca.id
    ),
    hoje as (
      select conta.product_source, conta.product_id, conta.produto, conta.unidade,
             conta.preco_unitario as preco, to_jsonb(conta.problemas) as problemas,
             item.value ->> 'romaneio_item_id' as item_id,
             item.value ->> 'romaneio_id' as romaneio_id,
             (item.value ->> 'record_date')::date as record_date,
             (item.value ->> 'quantidade_usada')::numeric as quantidade
      from private.calcular_cobranca_buck_detalhada(cobranca.period_start, cobranca.period_end) conta
      cross join lateral jsonb_array_elements(conta.itens) item
      where foto.com_foto
    ),
    -- O preco nao entra na comparacao: o cobrado e o da foto, e preco de
    -- semana cobrada so muda por migration (a troca com data nao alcanca).
    iguais as (
      select na_foto.item_id
      from na_foto
      join hoje
        on hoje.item_id = na_foto.item_id
       and hoje.product_source = na_foto.product_source
       and hoje.product_id = na_foto.product_id
       and hoje.unidade = na_foto.unidade
       and hoje.quantidade = na_foto.quantidade
    ),
    movimentos as (
      select na_foto.product_source, na_foto.product_id, na_foto.produto, na_foto.unidade,
             na_foto.preco, na_foto.problemas, na_foto.item_id, na_foto.romaneio_id,
             na_foto.record_date, na_foto.quantidade as antes, null::numeric as agora,
             false as de_hoje
      from na_foto
      where not exists (select 1 from iguais where iguais.item_id = na_foto.item_id)
      union all
      select hoje.product_source, hoje.product_id, hoje.produto, hoje.unidade,
             hoje.preco, hoje.problemas, hoje.item_id, hoje.romaneio_id,
             hoje.record_date, null::numeric, hoje.quantidade,
             true
      from hoje
      where not exists (select 1 from iguais where iguais.item_id = hoje.item_id)
    ),
    -- Um item que so mudou de quantidade vira uma linha so: antes e agora.
    por_item as (
      select movimento.product_source, movimento.product_id, movimento.unidade, movimento.preco,
             movimento.item_id,
             (array_agg(movimento.romaneio_id order by movimento.de_hoje desc))[1] as romaneio_id,
             (array_agg(movimento.record_date order by movimento.de_hoje desc))[1] as record_date,
             (array_agg(movimento.produto order by movimento.de_hoje desc))[1] as produto,
             (array_agg(movimento.problemas order by movimento.de_hoje desc))[1] as problemas,
             bool_or(movimento.de_hoje) as existe_hoje,
             sum(movimento.antes) as antes,
             sum(movimento.agora) as agora,
             coalesce(sum(movimento.agora), 0) - coalesce(sum(movimento.antes), 0) as diferenca
      from movimentos movimento
      group by movimento.product_source, movimento.product_id, movimento.unidade, movimento.preco,
               movimento.item_id
    ),
    problemas_do_produto as (
      select problema.product_source, problema.product_id, problema.unidade, problema.preco,
             array_agg(problema.valor order by private.fechamento_ex_ordem_problema(problema.valor)) as problemas
      from (
        select distinct item.product_source, item.product_id, item.unidade, item.preco, valor
        from por_item item
        cross join lateral jsonb_array_elements_text(item.problemas) as lista(valor)
      ) problema
      group by problema.product_source, problema.product_id, problema.unidade, problema.preco
    ),
    por_produto as (
      select item.product_source, item.product_id, item.unidade, item.preco,
             (array_agg(item.produto order by item.existe_hoje desc, item.record_date desc))[1] as produto,
             sum(item.diferenca) as quantidade,
             jsonb_agg(jsonb_build_object(
               'romaneio_id', item.romaneio_id,
               'romaneio_item_id', item.item_id,
               'record_date', item.record_date,
               'antes', item.antes,
               'agora', item.agora
             ) order by item.record_date, item.item_id) as itens
      from por_item item
      group by item.product_source, item.product_id, item.unidade, item.preco
      having sum(item.diferenca) <> 0
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'product_source', produto.product_source,
             'product_id', produto.product_id,
             'produto', produto.produto,
             'unidade', produto.unidade,
             'quantidade', produto.quantidade,
             'preco_unitario', produto.preco,
             'total', case when produto.preco is null or problema.problemas is not null then null
                           else round(produto.quantidade * produto.preco, 2) end,
             'problemas', to_jsonb(coalesce(problema.problemas, array[]::text[])),
             'itens', produto.itens
           ) order by produto.produto, produto.unidade, produto.preco nulls first), '[]'::jsonb) as lista
    from por_produto produto
    left join problemas_do_produto problema
      on problema.product_source = produto.product_source
     and problema.product_id = produto.product_id
     and problema.unidade = produto.unidade
     and problema.preco is not distinct from produto.preco
  ) depois
  where v_mostra_cobrado
    and cobranca.origin = 'romaneio_ex'
    and cobranca.status <> 'cancelada'
    and cobranca.period_start <= cobranca.period_end
    and cobranca.period_end between p_de and p_ate;

  -- Cobrancas que comecam no periodo e terminam depois dele: os dias delas
  -- nao estao "a cobrar", e a tela diz em que periodo elas aparecem.
  select coalesce(jsonb_agg(jsonb_build_object(
           'period_start', cobranca.period_start,
           'period_end', cobranca.period_end
         ) order by cobranca.period_start), '[]'::jsonb)
    into v_fora
  from public.receivables cobranca
  where v_mostra_cobrado
    and cobranca.origin = 'romaneio_ex'
    and cobranca.status <> 'cancelada'
    and cobranca.period_start <= cobranca.period_end
    and cobranca.period_start <= p_ate
    and cobranca.period_end > p_ate;

  return jsonb_build_object(
    'mostra_cobrado', v_mostra_cobrado,
    'a_cobrar', v_a_cobrar,
    'cobrancas', v_cobrancas,
    'fora_do_periodo', v_fora
  );
end;
$fn$;

revoke all on function public.list_romaneio_ex_fechamento(date, date) from public, anon;
grant execute on function public.list_romaneio_ex_fechamento(date, date) to authenticated;

commit;
