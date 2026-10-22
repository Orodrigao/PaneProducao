-- CMV real semanal da JC sobre a venda (fase 3B da contagem semanal).
--
-- A fase 3A (20260921190000) calcula o consumo de cada insumo entre duas
-- contagens fechadas. Esta fase acrescenta duas leituras, sem nenhuma tabela
-- nova e sem escrita:
--
-- 1. A venda de cada periodo de consumo, para a tela mostrar o CMV em %.
--    Decisao do Rodrigo em 2026-10-22: a JC e a JA sao uma contabilidade so
--    (a JA nao tem estoque e o caixa dela soma ao da JC); a EX tem
--    contabilidade propria e compra da JC como cliente PJ. Entao a venda que
--    divide o consumo da JC e:
--      caixa da JC + caixa da JA + iFood das duas + cobrancas de pedido PJ
--      + cobrancas da EX.
--    * Caixa: valor de vendas do fechamento (`cash_closings.sales_amount`),
--      pela data do fechamento, mais o iFood, que o fechamento guarda a parte
--      porque nao passa pela gaveta. E a mesma receita dos indicadores de
--      preco (20260930013002: venda do balcao + iFood + PJ/Buck).
--    * Dia sem fechamento e contado (a JC nao abre domingo; a JA abre todo
--      dia, mesma regra dos indicadores) para a tela avisar venda incompleta.
--    * Pedido PJ: cobranca nao cancelada pela data da nota (`invoice_date`),
--      que e a data da entrega e nao a do pagamento: boleto pago atrasado nao
--      muda a semana. Cobranca parcelada repete a mesma data em todas as
--      parcelas, entao a soma das parcelas cai inteira na semana certa.
--    * EX: a cobranca semanal do romaneio cobre segunda a domingo e o periodo
--      de consumo vai de domingo a sabado. O valor e dividido pelos dias que
--      caem dentro do periodo. Dia do periodo sem cobranca da EX e contado
--      para a tela avisar que a venda esta incompleta.
--    Mesmo corte da 3A: periodo (sabado anterior, este sabado].
--
-- 2. A lista dos itens de nota que ficaram fora da contagem no periodo, para
--    a tela mostrar quais sao e nao so o total. Usa a mesma regra de
--    classificacao de `inventory_consumption_periods` (categoria 'fora').
--
-- Quem ve: o consumo exige o Contas a pagar da JC (custo de compra). A venda
-- exige, alem disso, o Contas a receber, porque expoe o faturamento dos
-- clientes PJ. Quem tem so o primeiro continua vendo o consumo em reais.

begin;

-- ---------------------------------------------------------------------------
-- Venda de cada periodo de consumo.
-- ---------------------------------------------------------------------------
create or replace function public.inventory_consumption_revenue(p_store text default 'jc')
returns table (
  period_end_count_id uuid,
  cash_jc numeric,
  cash_jc_days integer,
  cash_ja numeric,
  cash_ja_days integer,
  cash_ifood numeric,
  cash_jc_missing_days integer,
  cash_ja_missing_days integer,
  pj_orders numeric,
  pj_orders_lines integer,
  ex_billed numeric,
  ex_days_billed integer,
  revenue_total numeric
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

  if not private.current_user_can_payables('contas_pagar.acessar')
     or not private.current_user_can_receivables('contas_receber.acessar') then
    raise exception using errcode = '42501', message = 'Sem permissao para ver a venda da semana.';
  end if;

  return query
  select period.end_count_id,
         caixa.jc_valor,
         caixa.jc_dias,
         caixa.ja_valor,
         caixa.ja_dias,
         caixa.ifood_valor,
         faltando.jc_dias,
         faltando.ja_dias,
         pj.valor,
         pj.linhas,
         round(ex.valor, 2),
         ex.dias,
         caixa.jc_valor + caixa.ja_valor + caixa.ifood_valor + pj.valor + round(ex.valor, 2)
  from private.periodos_consumo_insumos(p_store) period
  cross join lateral (
    select coalesce(sum(closing.sales_amount) filter (where closing.store = 'jc'), 0) as jc_valor,
           (count(distinct closing.closing_date) filter (where closing.store = 'jc'))::integer as jc_dias,
           coalesce(sum(closing.sales_amount) filter (where closing.store = 'ja'), 0) as ja_valor,
           (count(distinct closing.closing_date) filter (where closing.store = 'ja'))::integer as ja_dias,
           coalesce(sum(closing.ifood_sales_amount), 0) as ifood_valor
    from public.cash_closings closing
    where closing.store in ('jc', 'ja')
      and closing.closing_date > period.start_date
      and closing.closing_date <= period.end_date
  ) caixa
  cross join lateral (
    select (count(*) filter (where loja.store = 'jc' and closing.id is null))::integer as jc_dias,
           (count(*) filter (where loja.store = 'ja' and closing.id is null))::integer as ja_dias
    from pg_catalog.generate_series(period.start_date + 1, period.end_date, interval '1 day') dia(data)
    cross join (values ('jc'::text), ('ja'::text)) loja(store)
    left join public.cash_closings closing
      on closing.store = loja.store
     and closing.closing_date = dia.data::date
    where loja.store <> 'jc' or extract(dow from dia.data) <> 0
  ) faltando
  cross join lateral (
    select coalesce(sum(receivable.amount), 0) as valor,
           count(*)::integer as linhas
    from public.receivables receivable
    where receivable.origin = 'pedido_pj'
      and receivable.status <> 'cancelada'
      and receivable.invoice_date > period.start_date
      and receivable.invoice_date <= period.end_date
  ) pj
  cross join lateral (
    -- Dias de sobreposicao entre a cobranca [period_start, period_end] e o
    -- periodo (start_date, end_date]. A trava receivables_periodo_sem_sobreposicao
    -- garante que duas cobrancas ativas nunca cobrem o mesmo dia.
    select coalesce(sum(
             receivable.amount
             * (least(receivable.period_end, period.end_date)
                - greatest(receivable.period_start, period.start_date + 1) + 1)
             / (receivable.period_end - receivable.period_start + 1)
           ), 0) as valor,
           coalesce(sum(
             least(receivable.period_end, period.end_date)
             - greatest(receivable.period_start, period.start_date + 1) + 1
           ), 0)::integer as dias
    from public.receivables receivable
    where receivable.origin = 'romaneio_ex'
      and receivable.status <> 'cancelada'
      and receivable.period_start <= period.end_date
      and receivable.period_end > period.start_date
  ) ex
  order by period.end_date desc;
end;
$$;

revoke all on function public.inventory_consumption_revenue(text) from public, anon;
grant execute on function public.inventory_consumption_revenue(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Itens de nota fora da contagem em cada periodo.
-- ---------------------------------------------------------------------------
create or replace function public.inventory_consumption_outside_items(
  p_store text default 'jc',
  p_end_count_id uuid default null
)
returns table (
  period_end_count_id uuid,
  product_id uuid,
  product_name text,
  product_category text,
  purchases_count integer,
  value_purchased numeric
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
  select period.end_count_id,
         item.product_id,
         coalesce(product_row.name, '(insumo removido do catalogo)'),
         product_row.category,
         count(distinct purchase.id)::integer,
         coalesce(sum(private.valor_linha_compra(item.acquisition_value, item.line_total, item.quantity, item.unit_price)), 0)
  from private.periodos_consumo_insumos(p_store) period
  join public.payable_purchases purchase
    on purchase.store = p_store
   and purchase.status <> 'cancelada'
   and purchase.purchase_date > period.start_date
   and purchase.purchase_date <= period.end_date
  join public.payable_purchase_items item on item.purchase_id = purchase.id
  left join public.products product_row on product_row.id = item.product_id
  where (p_end_count_id is null or period.end_count_id = p_end_count_id)
    and item.mapping_status is distinct from 'nao_aplicavel'
    and item.product_id is not null
    and not exists (
      select 1
      from public.inventory_weekly_count_items counted
      where counted.count_id = period.end_count_id
        and counted.product_id = item.product_id
    )
  group by period.end_count_id, period.end_date, item.product_id, product_row.name, product_row.category
  order by period.end_date desc, 6 desc, 3;
end;
$$;

revoke all on function public.inventory_consumption_outside_items(text, uuid) from public, anon;
grant execute on function public.inventory_consumption_outside_items(text, uuid) to authenticated;

commit;
