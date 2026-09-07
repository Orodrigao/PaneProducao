'use client'

import { pjBillingTotals, pjOperationalOverview, type PjBillingState, type PjOperationalOrder } from '@/lib/pjOrderOverview'
import { pjLineValue, pjLineEstimatedValue } from '@/lib/pjOrderValue'
import styles from './PjOrderOverview.module.css'

interface OverviewOrder extends PjOperationalOrder {
  order_group_id: string | null
  order_date: string
  obs: string | null
  cancelled_by: string | null
  cancel_reason: string | null
  dispatched_by_name: string | null
  rows: (PjOperationalOrder['rows'][number] & {
    id: string
    product_name: string | null
    bread_id: string
    quantity: number
    unit_price: number | null
    pricing_unit: string | null
    dispatched_at: string | null
    dispatched_quantity_reason: string | null
    dispatched_quantity_at: string | null
    dispatched_quantity_by_name: string | null
  })[]
}

const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const date = (value: string) => new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString('pt-BR')

export function PjOrderOverview({ order, today, billing, showValues }: {
  order: OverviewOrder; today: string; billing: PjBillingState; showValues: boolean
}) {
  const operation = pjOperationalOverview(order, today)
  const actual = order.rows.map(row => row.unit_price === null ? null : pjLineValue({
    quantity: row.quantity, dispatchedQuantity: row.dispatched_quantity,
    unitPrice: row.unit_price, dispatchedAt: row.dispatched_at, pricingUnit: row.pricing_unit,
  }))
  const estimateKnown = order.rows.every(row => row.unit_price !== null)
  const estimate = order.rows.reduce((sum, row) => sum + pjLineEstimatedValue({ quantity: row.quantity, unitPrice: row.unit_price, dispatchedQuantity: null, dispatchedAt: null }), 0)
  const totalKnown = actual.every(value => value !== null)
  const totals = billing.kind === 'loaded' ? pjBillingTotals(billing.bills, billing.receipts) : null
  return <div className={styles.overview}>
    <section className={styles.summary} aria-label="Andamento do pedido">
      <h4>{operation.status}</h4>
      <p><strong>Responsável pela próxima providência:</strong> {operation.owner}</p>
      <p>{operation.next}</p>
    </section>
    <section aria-label="Itens completos do pedido">
      <h4>Itens do pedido · {order.rows.length}</h4>
      <div className={styles.items}>{order.rows.map((row, index) => <div className={styles.item} key={row.id}>
        <strong>{row.product_name || row.bread_id}</strong>
        <span>Pedido: {Number(row.quantity).toLocaleString('pt-BR')} {row.pricing_unit || 'un'}</span>
        <span>Conferência: {row.dispatched_quantity === null ? 'pendente' : `${Number(row.dispatched_quantity).toLocaleString('pt-BR')} ${row.pricing_unit || 'un'}`}</span>
        {row.dispatched_quantity_reason && <span>Justificativa: {row.dispatched_quantity_reason}</span>}
        {showValues && <small>{actual[index] === null ? 'Valor conferido ainda indisponível' : `Valor dos itens: ${money(actual[index]!)}`}</small>}
      </div>)}</div>
      {showValues && <>
        {totalKnown && <p><strong>Valor dos itens: {money(actual.reduce<number>((sum, value) => sum + (value ?? 0), 0))}</strong></p>}
        <small>Estimativa do pedido: {estimateKnown ? money(estimate) : 'indisponível'}. Não representa pagamento recebido.</small>
      </>}
    </section>
    {order.obs && <p><strong>Observações:</strong> {order.obs}</p>}
    {showValues && <section className={styles.summary} aria-label="Situação financeira">
      <h4>Cobrança e recebimentos</h4>
      {billing.kind === 'loading' && <p role="status">Consultando cobrança…</p>}
      {billing.kind === 'restricted' && <p>Consulta financeira sem acesso disponível para este usuário.</p>}
      {billing.kind === 'unavailable' && <p role="status">Informação financeira indisponível. Consulte Contas a receber; isso não significa saldo zero.</p>}
      {billing.kind === 'loaded' && (billing.bills.length === 0 ? <p>Nenhuma cobrança visível nesta consulta. Confira em Contas a receber antes de concluir que não há cobrança.</p> : <>
        {billing.bills.some(bill => bill.status !== 'cancelada') && totals && <p>Cobrado: {money(totals.amount)} · Recebido: {money(totals.received)} · A receber: <strong>{money(totals.remaining)}</strong></p>}
        <ul>{billing.bills.map(bill => <li key={bill.id}>{bill.status === 'cancelada' ? 'Cobrança cancelada' : 'Cobrança'}: {money(Number(bill.amount))} · vencimento {date(bill.due_date)}</li>)}</ul>
        <p>Responsável: Elis / Financeiro. Pagamento e andamento do pedido são acompanhados separadamente.</p>
      </>)}
      {billing.kind === 'loaded' && <a href="/contas-receber">Abrir Contas a receber</a>}
    </section>}
    <details>
      <summary>Histórico disponível</summary>
      <ul className={styles.history}>
        <li>Pedido cadastrado em {date(order.order_date)}.</li>
        {order.production_date && <li>Produção programada para {date(order.production_date)}.</li>}
        {order.rows.filter(row => row.dispatched_quantity_at).map(row => <li key={row.id}>{row.product_name || row.bread_id}: última conferência em {date(row.dispatched_quantity_at!)} por {row.dispatched_quantity_by_name || 'pessoa não identificada'}.</li>)}
        {order.dispatched_at && <li>Pronto para entrega registrado em {date(order.dispatched_at)} por {order.dispatched_by_name || 'Expedição'}.</li>}
        {order.cancelled_at && <li>Cancelado em {date(order.cancelled_at)} por {order.cancelled_by || 'pessoa não identificada'}. Motivo: {order.cancel_reason || 'não informado'}.</li>}
        {showValues && billing.kind === 'loaded' && billing.receipts.map(receipt => <li key={receipt.id}>{receipt.reversed_at ? 'Recebimento estornado' : 'Recebimento'} de {money(Number(receipt.amount))} em {date(receipt.received_date)}.</li>)}
      </ul>
      <p>Estes são os registros disponíveis. A revisão de NF, a nova liberação financeira e a saída física ainda não têm etapas separadas neste fluxo.</p>
    </details>
  </div>
}
