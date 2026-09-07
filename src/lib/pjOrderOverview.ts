export interface PjOperationalOrder {
  cancelled_at: string | null
  dispatched_at: string | null
  delivery_date: string | null
  production_date: string | null
  rows: { dispatched_quantity: number | null; already_billed?: boolean }[]
}

export function pjOperationalOverview(order: PjOperationalOrder, today: string) {
  if (order.cancelled_at) return { status: 'Cancelado', owner: 'Financeiro', next: 'Consultar o histórico e eventuais cobranças.', pending: false }
  if (order.dispatched_at) return { status: 'Pronto para entrega registrado', owner: 'Expedição / Financeiro', next: 'Acompanhar a entrega e consultar a cobrança. A saída física ainda não tem registro separado.', pending: false }
  if (order.rows.some(row => row.already_billed)) return { status: 'Conferência indisponível', owner: 'Financeiro', next: 'Revisar o pedido que já possui cobrança. A conferência atual não aceita alterações.', pending: true }
  if (!order.delivery_date) return { status: 'Data a combinar', owner: 'Elis / Financeiro', next: 'Combinar a entrega ou coleta e revisar o cadastro do pedido.', pending: true }
  const overdue = order.delivery_date < today
  if (order.rows.length > 0 && order.rows.every(row => row.dispatched_quantity !== null)) {
    const zero = order.rows.every(row => Number(row.dispatched_quantity) === 0)
    return { status: zero ? 'Nenhum item conferido para envio' : 'Quantidades conferidas', owner: zero ? 'Elis / Financeiro' : 'Expedição JC', next: zero ? 'Definir o destino do pedido. Quantidade zero não cancela o compromisso.' : 'Revisar a conferência e usar a confirmação atual de pronto para entrega.', pending: true }
  }
  return { status: overdue ? 'Data combinada passou' : 'Aguardando conferência', owner: 'Produção / Expedição JC', next: overdue ? 'Verificar o andamento e conferir as quantidades reais. A data não comprova entrega.' : 'Preparar e conferir as quantidades reais. A programação não comprova produção concluída.', pending: true }
}

export interface PjBillingEntry {
  id: string
  origin_ref: string | null
  amount: number
  due_date: string
  status: 'aberta' | 'parcial' | 'recebida' | 'cancelada'
}
export interface PjReceiptEntry {
  id: string
  receivable_id: string
  amount: number
  received_date: string
  reversed_at: string | null
}
export type PjBillingState =
  | { kind: 'loading' | 'restricted' | 'unavailable' }
  | { kind: 'loaded'; bills: PjBillingEntry[]; receipts: PjReceiptEntry[] }

export function pjBillingTotals(bills: PjBillingEntry[], receipts: PjReceiptEntry[]) {
  const active = bills.filter(bill => bill.status !== 'cancelada')
  const round = (value: number) => Math.round(value * 100) / 100
  const paidFor = (id: string) => receipts.filter(receipt => receipt.receivable_id === id && !receipt.reversed_at).reduce((sum, receipt) => sum + Number(receipt.amount), 0)
  return {
    amount: round(active.reduce((sum, bill) => sum + Number(bill.amount), 0)),
    received: round(active.reduce((sum, bill) => sum + paidFor(bill.id), 0)),
    remaining: round(active.reduce((sum, bill) => sum + Math.max(0, round(Number(bill.amount) - paidFor(bill.id))), 0)),
  }
}

export function pjBillingForOrder(state: PjBillingState, groupId: string | null): PjBillingState {
  if (!groupId) return { kind: 'unavailable' }
  if (state.kind !== 'loaded') return state
  const bills = state.bills.filter(bill => bill.origin_ref === groupId)
  const ids = new Set(bills.map(bill => bill.id))
  return { kind: 'loaded', bills, receipts: state.receipts.filter(receipt => ids.has(receipt.receivable_id)) }
}

export function pjHasPendingFollowup(order: PjOperationalOrder, today: string, billing?: PjBillingState): boolean {
  if (pjOperationalOverview(order, today).pending) return true
  if (!billing) return false
  if (billing.kind !== 'loaded') return !order.cancelled_at
  const active = billing.bills.filter(bill => bill.status !== 'cancelada')
  if (order.cancelled_at) return active.length > 0
  if (active.length === 0) return true
  return pjBillingTotals(active, billing.receipts).remaining > 0
}
