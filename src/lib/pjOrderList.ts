export interface PjOrderListItem {
  key: string
  customerName: string
  orderDate: string
  productionDate: string | null
  deliveryDate: string | null
  cancelledAt: string | null
  dispatchedAt: string | null
  /**
   * Há item ainda não conferido pela Expedição **e a conferência ainda é
   * possível**. Enquanto houver, o pedido não cai no Histórico pela virada do
   * dia: pedido entregue no sábado e conferido na segunda viraria órfão, sem
   * fila em que aparecer.
   *
   * Quem monta este campo precisa excluir o pedido que já virou cobrança: o
   * banco recusa conferência nele, e "Marcar como enviado" exige tudo
   * conferido. Sem essa exclusão o pedido fica preso na fila para sempre, sem
   * saída por nenhuma das duas portas.
   */
  hasPendingCheck?: boolean
}

export interface PjPendingCheckOrder {
  cancelledAt: string | null
  dispatchedAt: string | null
  rows: Array<{
    dispatchedQuantity: number | null
    /** O pedido já virou cobrança, então o banco recusa conferência nele. */
    alreadyBilled?: boolean
  }>
}

/**
 * Decide se o pedido ainda segura a fila da Expedição.
 *
 * Segura só quando conferir é possível E necessário. As três portas que
 * prenderam 65 pedidos até 2026-08-26:
 *
 * - cancelado ou já enviado: não há o que conferir;
 * - já virou cobrança: `save_pj_order_dispatch_quantities` recusa, e
 *   `confirm_pj_order_dispatch` exige tudo conferido, então o pedido não sai
 *   por porta nenhuma e a fila só cresce;
 * - nada pendente: já foi conferido.
 */
export function hasPendingDispatchCheck(order: PjPendingCheckOrder): boolean {
  if (order.cancelledAt || order.dispatchedAt) return false
  if (order.rows.some(row => row.alreadyBilled === true)) return false
  return order.rows.some(row => row.dispatchedQuantity === null)
}

export interface PjOrderListSection<T extends PjOrderListItem> {
  id: 'overdue' | 'today' | 'tomorrow' | `date:${string}`
  date: string | null
  orders: T[]
}

interface OrganizePjOrdersOptions {
  today: string
  query: string
}

export interface PjOrderSearchResult<T extends PjOrderListItem> {
  order: T
  stage: 'open' | 'history'
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00`)
  parsed.setDate(parsed.getDate() + days)
  return parsed.toISOString().slice(0, 10)
}

function priorityDate(order: PjOrderListItem): string {
  return order.productionDate || order.deliveryDate || order.orderDate
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim()
}

function openSectionId(
  order: PjOrderListItem,
  today: string,
  tomorrow: string,
): PjOrderListSection<PjOrderListItem>['id'] {
  const date = priorityDate(order)
  if (date < today) return 'overdue'
  if (date === today) return 'today'
  if (date === tomorrow) return 'tomorrow'
  return `date:${date}`
}

export function organizePjOrders<T extends PjOrderListItem>(
  orders: T[],
  options: OrganizePjOrdersOptions,
) {
  const tomorrow = addDays(options.today, 1)
  const stillOpen = (order: T) => (
    !order.cancelledAt
    && !order.dispatchedAt
    && (!order.deliveryDate || order.deliveryDate >= options.today || order.hasPendingCheck === true)
  )
  const open = orders
    .filter(stillOpen)
    .sort((a, b) => {
      const byDate = priorityDate(a).localeCompare(priorityDate(b))
      if (byDate !== 0) return byDate
      return a.customerName.localeCompare(b.customerName, 'pt-BR', { sensitivity: 'base' })
    })
  const history = orders
    .filter(order => !stillOpen(order))
    .sort((a, b) => (b.deliveryDate || b.orderDate).localeCompare(a.deliveryDate || a.orderDate))

  const sections = new Map<PjOrderListSection<T>['id'], PjOrderListSection<T>>()
  open.forEach(order => {
    const id = openSectionId(order, options.today, tomorrow) as PjOrderListSection<T>['id']
    const existing = sections.get(id)
    if (existing) {
      existing.orders.push(order)
      return
    }
    sections.set(id, {
      id,
      date: id.startsWith('date:') ? id.slice(5) : null,
      orders: [order],
    })
  })

  const query = normalizeSearchText(options.query)
  const searchResults: PjOrderSearchResult<T>[] = query
    ? [
        ...open
          .filter(order => normalizeSearchText(order.customerName).includes(query))
          .map(order => ({ order, stage: 'open' as const })),
        ...history
          .filter(order => normalizeSearchText(order.customerName).includes(query))
          .map(order => ({ order, stage: 'history' as const })),
      ]
    : []

  return {
    open,
    history,
    openSections: Array.from(sections.values()),
    searchResults,
  }
}
