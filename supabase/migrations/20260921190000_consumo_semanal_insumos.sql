-- Fase 3A da contagem semanal: consumo real de insumos da JC.
--
-- Inventario periodico (decisao de 2026-08-22): o sistema nunca da baixa de
-- estoque. O consumo de cada insumo entre duas contagens fechadas seguidas e
--   estoque do sabado anterior + entradas por nota - estoque deste sabado.
--
-- Somente leitura: nenhuma tabela nova, nenhuma escrita. Tudo e calculado na
-- hora da consulta, entao reabrir e corrigir uma contagem, ou lancar uma nota
-- atrasada, muda o resultado na proxima leitura. Para isso nao passar
-- despercebido, cada linha conta as notas lancadas depois do fechamento.
--
-- Regras de corte:
-- * O corte de cada contagem e o sabado da semana dela (week_start + 5), nunca
--   o horario em que alguem apertou "fechar".
-- * Entrada da semana = nota nao cancelada da JC com data de emissao no
--   intervalo (sabado anterior, este sabado]. A nota viaja com a mercadoria;
--   as emitidas na sexta ou no sabado do corte sao marcadas para conferencia
--   (edge_lines), porque podem ter chegado depois da contagem.
--
-- Valor em reais: custo medio da semana, unico para o estoque inicial, as
-- entradas e o estoque final daquele insumo:
--   (estoque inicial x custo de referencia + valor das entradas)
--   / (estoque inicial + quantidade das entradas)
-- O custo de referencia e o custo da nota mais recente emitida ate o sabado
-- anterior (valor de aquisicao / quantidade de estoque, ponderado se o insumo
-- vier em varias linhas), ou o custo do cadastro se nunca houve nota. Assim, a
-- variacao de preco de uma nota nova nao aparece como consumo.
--
-- Falha fechada: o insumo so ganha numero quando todos os dados que o compoem
-- existem. Nota do insumo sem quantidade utilizavel (fator nao confirmado),
-- insumo ausente de uma das duas contagens, quantidade nao contada ou unidade
-- trocada entre as contagens deixam a linha sem numero, com o motivo.
--
-- Quem ve: quem ja enxerga as compras da JC (admin ou permissao
-- contas_pagar.acessar), porque o resultado expoe custo e valor de compra.

create or replace function private.valor_linha_compra(
  p_acquisition_value numeric,
  p_line_total numeric,
  p_quantity numeric,
  p_unit_price numeric
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_acquisition_value, p_line_total, p_quantity * p_unit_price, 0);
$$;

revoke all on function private.valor_linha_compra(numeric, numeric, numeric, numeric) from public, anon, authenticated;

-- Quantidade da linha na unidade de estoque. Linha de nota XML usa a
-- quantidade utilizavel confirmada na conferencia. Lancamento a mao nunca
-- recebe conversao (a conferencia so existe para XML); quando a unidade da
-- linha e a mesma do cadastro (kg com kg), a quantidade lancada ja e a de
-- estoque. Qualquer outro caso fica nulo e bloqueia o insumo.
create or replace function private.quantidade_estoque_linha(
  p_usable_quantity numeric,
  p_origin text,
  p_item_unit text,
  p_product_unit text,
  p_quantity numeric
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_usable_quantity,
    case
      when p_origin = 'manual'
       and pg_catalog.lower(pg_catalog.btrim(p_item_unit)) = pg_catalog.lower(pg_catalog.btrim(p_product_unit))
        then p_quantity
    end
  );
$$;

revoke all on function private.quantidade_estoque_linha(numeric, text, text, text, numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Pares de contagens fechadas seguidas: cada par e um periodo de consumo.
-- ---------------------------------------------------------------------------
create or replace function private.periodos_consumo_insumos(p_store text)
returns table (
  start_count_id uuid,
  end_count_id uuid,
  start_date date,
  end_date date,
  end_closed_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  select pair.start_count_id,
         pair.end_count_id,
         pair.start_week + 5,
         pair.end_week + 5,
         pair.end_closed_at
  from (
    select pg_catalog.lag(count_row.id) over ordem as start_count_id,
           pg_catalog.lag(count_row.week_start) over ordem as start_week,
           count_row.id as end_count_id,
           count_row.week_start as end_week,
           count_row.closed_at as end_closed_at
    from public.inventory_weekly_counts count_row
    where count_row.store = p_store
      and count_row.status = 'fechada'
    window ordem as (order by count_row.week_start)
  ) pair
  where pair.start_count_id is not null;
$$;

revoke all on function private.periodos_consumo_insumos(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Resumo de cada periodo: para onde foi o dinheiro de compras da janela.
-- ---------------------------------------------------------------------------
create or replace function public.inventory_consumption_periods(p_store text default 'jc')
returns table (
  period_start_count_id uuid,
  period_end_count_id uuid,
  period_start_date date,
  period_end_date date,
  period_days integer,
  end_closed_at timestamptz,
  purchases_total numeric,
  purchases_counted numeric,
  purchases_outside_count numeric,
  purchases_unclassified numeric,
  purchases_not_stock numeric,
  unclassified_lines integer,
  late_lines integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_store is distinct from 'jc' then
    raise exception using errcode = '22023', message = 'Consumo semanal so existe para a JC nesta fase.';
  end if;

  if not private.current_user_can_payables('contas_pagar.acessar') then
    raise exception using errcode = '42501', message = 'Sem permissao para ver o consumo com custos.';
  end if;

  return query
  select period.start_count_id,
         period.end_count_id,
         period.start_date,
         period.end_date,
         (period.end_date - period.start_date)::integer,
         period.end_closed_at,
         coalesce(sum(line.valor), 0),
         coalesce(sum(line.valor) filter (where line.categoria = 'contado'), 0),
         coalesce(sum(line.valor) filter (where line.categoria = 'fora'), 0),
         coalesce(sum(line.valor) filter (where line.categoria = 'sem_classificacao'), 0),
         coalesce(sum(line.valor) filter (where line.categoria = 'nao_estoque'), 0),
         (count(line.item_id) filter (where line.categoria = 'sem_classificacao'))::integer,
         (count(line.item_id) filter (where line.atrasada))::integer
  from private.periodos_consumo_insumos(p_store) period
  left join lateral (
    select item.id as item_id,
           private.valor_linha_compra(item.acquisition_value, item.line_total, item.quantity, item.unit_price) as valor,
           purchase.created_at > period.end_closed_at as atrasada,
           case
             when item.mapping_status = 'nao_aplicavel' then 'nao_estoque'
             when item.product_id is null then 'sem_classificacao'
             when exists (
               select 1
               from public.inventory_weekly_count_items counted
               where counted.count_id = period.end_count_id
                 and counted.product_id = item.product_id
             ) then 'contado'
             else 'fora'
           end as categoria
    from public.payable_purchases purchase
    join public.payable_purchase_items item on item.purchase_id = purchase.id
    where purchase.store = p_store
      and purchase.status <> 'cancelada'
      and purchase.purchase_date > period.start_date
      and purchase.purchase_date <= period.end_date
  ) line on true
  group by period.start_count_id, period.end_count_id, period.start_date, period.end_date, period.end_closed_at
  order by period.end_date desc;
end;
$$;

revoke all on function public.inventory_consumption_periods(text) from public, anon;
grant execute on function public.inventory_consumption_periods(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Consumo por insumo em cada periodo.
-- ---------------------------------------------------------------------------
-- status (a primeira regra que se aplica vence):
--   sem_par        insumo em so uma das duas contagens
--   nao_contado    ficou sem quantidade em uma das contagens
--   unidade_mudou  a unidade fotografada mudou entre as contagens
--   incompleto     nota do insumo na janela sem quantidade utilizavel
--   sem_custo      sem custo de referencia nem compra na janela
--   conferir       consumo negativo: contagem errada ou nota faltando
--   ok
create or replace function public.inventory_consumption_items(
  p_store text default 'jc',
  p_end_count_id uuid default null
)
returns table (
  period_end_count_id uuid,
  product_id uuid,
  product_name text,
  product_category text,
  unit text,
  qty_start numeric,
  qty_in numeric,
  qty_end numeric,
  qty_consumed numeric,
  unit_cost numeric,
  value_consumed numeric,
  purchase_lines integer,
  lines_without_quantity integer,
  edge_lines integer,
  late_lines integer,
  status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_store is distinct from 'jc' then
    raise exception using errcode = '22023', message = 'Consumo semanal so existe para a JC nesta fase.';
  end if;

  if not private.current_user_can_payables('contas_pagar.acessar') then
    raise exception using errcode = '42501', message = 'Sem permissao para ver o consumo com custos.';
  end if;

  return query
  with period as (
    select *
    from private.periodos_consumo_insumos(p_store) candidate
    where p_end_count_id is null or candidate.end_count_id = p_end_count_id
  ),
  produtos_do_periodo as (
    select distinct period.start_count_id, period.end_count_id, counted.product_id
    from period
    join public.inventory_weekly_count_items counted
      on counted.count_id in (period.start_count_id, period.end_count_id)
  ),
  produto_periodo as (
    select period.start_count_id,
           period.end_count_id,
           period.start_date,
           period.end_date,
           period.end_closed_at,
           produto.product_id,
           inicio.id is not null as no_inicio,
           fim.id is not null as no_fim,
           inicio.quantity as qtd_inicio,
           fim.quantity as qtd_fim,
           inicio.unit as unidade_inicio,
           fim.unit as unidade_fim
    from produtos_do_periodo produto
    join period on period.end_count_id = produto.end_count_id
    left join public.inventory_weekly_count_items inicio
      on inicio.count_id = produto.start_count_id and inicio.product_id = produto.product_id
    left join public.inventory_weekly_count_items fim
      on fim.count_id = produto.end_count_id and fim.product_id = produto.product_id
  ),
  base as (
    select pp.*,
           entradas.qtd_entrada,
           entradas.valor_entrada,
           entradas.linhas,
           entradas.linhas_sem_quantidade,
           entradas.linhas_no_corte,
           entradas.linhas_atrasadas,
           referencia.custo as custo_referencia
    from produto_periodo pp
    cross join lateral (
      select coalesce(sum(linha.qtd), 0) as qtd_entrada,
             coalesce(sum(linha.valor), 0) as valor_entrada,
             count(*)::integer as linhas,
             (count(*) filter (where linha.qtd is null))::integer as linhas_sem_quantidade,
             (count(*) filter (where linha.purchase_date >= pp.end_date - 1))::integer as linhas_no_corte,
             (count(*) filter (where linha.created_at > pp.end_closed_at))::integer as linhas_atrasadas
      from (
        select private.quantidade_estoque_linha(item.usable_quantity, purchase.origin, item.unit,
                 coalesce(pp.unidade_fim, pp.unidade_inicio), item.quantity) as qtd,
               private.valor_linha_compra(item.acquisition_value, item.line_total, item.quantity, item.unit_price) as valor,
               purchase.purchase_date,
               purchase.created_at
        from public.payable_purchases purchase
        join public.payable_purchase_items item on item.purchase_id = purchase.id
        where purchase.store = p_store
          and purchase.status <> 'cancelada'
          and item.product_id = pp.product_id
          and item.mapping_status is distinct from 'nao_aplicavel'
          and purchase.purchase_date > pp.start_date
          and purchase.purchase_date <= pp.end_date
      ) linha
    ) entradas
    -- Custo de referencia: a nota mais recente do insumo ate o sabado
    -- anterior, inteira (media ponderada se o insumo vier em varias linhas).
    -- Se essa nota ainda nao tem conversao confirmada, o custo fica nulo e o
    -- valor bloqueia; nunca cai silenciosamente para uma nota mais velha.
    -- Lancamento a mao sem conversao possivel e pulado, porque nao tem como
    -- ser corrigido. O custo do cadastro so vale se nunca houve nota.
    cross join lateral (
      select count(*) as linhas_anteriores
      from public.payable_purchases purchase
      join public.payable_purchase_items item on item.purchase_id = purchase.id
      where purchase.store = p_store
        and purchase.status <> 'cancelada'
        and item.product_id = pp.product_id
        and item.mapping_status is distinct from 'nao_aplicavel'
        and purchase.purchase_date <= pp.start_date
    ) historico
    -- A nota manual so serve de referencia se TODAS as linhas do insumo nela
    -- forem conversiveis; senao ela inteira e pulada. Nota XML e sempre
    -- elegivel: incompleta, ela bloqueia o valor ate a conferencia.
    left join lateral (
      select purchase.id as purchase_id
      from public.payable_purchases purchase
      where purchase.store = p_store
        and purchase.status <> 'cancelada'
        and purchase.purchase_date <= pp.start_date
        and exists (
          select 1
          from public.payable_purchase_items item
          where item.purchase_id = purchase.id
            and item.product_id = pp.product_id
            and item.mapping_status is distinct from 'nao_aplicavel'
        )
        and not (
          purchase.origin = 'manual'
          and exists (
            select 1
            from public.payable_purchase_items item
            where item.purchase_id = purchase.id
              and item.product_id = pp.product_id
              and item.mapping_status is distinct from 'nao_aplicavel'
              and private.quantidade_estoque_linha(item.usable_quantity, purchase.origin, item.unit,
                    coalesce(pp.unidade_fim, pp.unidade_inicio), item.quantity) is null
          )
        )
      order by purchase.purchase_date desc, purchase.created_at desc, purchase.id
      limit 1
    ) nota_referencia on true
    cross join lateral (
      select case
               when historico.linhas_anteriores = 0 then (
                 select nullif(product_row.cost_price, 0)
                 from public.products product_row
                 where product_row.id = pp.product_id
               )
               when nota_referencia.purchase_id is null then null
               else (
                 select case
                          when bool_and(linha.qtd is not null) and sum(linha.qtd) > 0
                            then sum(linha.valor) / sum(linha.qtd)
                        end
                 from (
                   select private.quantidade_estoque_linha(item.usable_quantity, purchase.origin, item.unit,
                            coalesce(pp.unidade_fim, pp.unidade_inicio), item.quantity) as qtd,
                          private.valor_linha_compra(item.acquisition_value, item.line_total, item.quantity, item.unit_price) as valor
                   from public.payable_purchases purchase
                   join public.payable_purchase_items item on item.purchase_id = purchase.id
                   where purchase.id = nota_referencia.purchase_id
                     and item.product_id = pp.product_id
                     and item.mapping_status is distinct from 'nao_aplicavel'
                 ) linha
               )
             end as custo
    ) referencia
  ),
  classificado as (
    select base.*,
           case
             when not (base.no_inicio and base.no_fim) then 'sem_par'
             when base.qtd_inicio is null or base.qtd_fim is null then 'nao_contado'
             when base.unidade_inicio is distinct from base.unidade_fim then 'unidade_mudou'
             when base.linhas_sem_quantidade > 0 then 'incompleto'
             else null
           end as bloqueio
    from base
  ),
  calculado as (
    select classificado.*,
           case when classificado.bloqueio is null
             then classificado.qtd_inicio + classificado.qtd_entrada - classificado.qtd_fim
           end as consumo,
           case
             when classificado.bloqueio is not null then null
             -- Estoque inicial sem custo conhecido: nao inventa valor.
             when classificado.qtd_inicio > 0 and classificado.custo_referencia is null then null
             when classificado.qtd_inicio + classificado.qtd_entrada > 0
               then (classificado.qtd_inicio * coalesce(classificado.custo_referencia, 0) + classificado.valor_entrada)
                    / (classificado.qtd_inicio + classificado.qtd_entrada)
             else classificado.custo_referencia
           end as custo_medio
    from classificado
  )
  select calculado.end_count_id,
         calculado.product_id,
         coalesce(product_row.name, '(insumo removido do catalogo)'),
         product_row.category,
         coalesce(calculado.unidade_fim, calculado.unidade_inicio),
         calculado.qtd_inicio,
         round(calculado.qtd_entrada, 3),
         calculado.qtd_fim,
         round(calculado.consumo, 3),
         round(calculado.custo_medio, 4),
         round(calculado.consumo * calculado.custo_medio, 2),
         calculado.linhas,
         calculado.linhas_sem_quantidade,
         calculado.linhas_no_corte,
         calculado.linhas_atrasadas,
         case
           when calculado.bloqueio is not null then calculado.bloqueio
           when calculado.custo_medio is null then 'sem_custo'
           when calculado.consumo < 0 then 'conferir'
           else 'ok'
         end
  from calculado
  left join public.products product_row on product_row.id = calculado.product_id
  order by calculado.end_date desc, product_row.name nulls last, calculado.product_id;
end;
$$;

revoke all on function public.inventory_consumption_items(text, uuid) from public, anon;
grant execute on function public.inventory_consumption_items(text, uuid) to authenticated;
