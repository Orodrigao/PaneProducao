export interface PjOrderListItem {
  key: string
  customerName: string
  orderDate: string
  productionDate: string | null
  deliveryDate: string | null
  cancelledAt: string | null
  dispatchedAt: string | null
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
  const open = orders
    .filter(order => !order.cancelledAt && !order.dispatchedAt && (!order.deliveryDate || order.deliveryDate >= options.today))
    .sort((a, b) => {
      const byDate = priorityDate(a).localeCompare(priorityDate(b))
      if (byDate !== 0) return byDate
      return a.customerName.localeCompare(b.customerName, 'pt-BR', { sensitivity: 'base' })
    })
  const history = orders
    .filter(order => Boolean(order.cancelledAt) || Boolean(order.dispatchedAt) || Boolean(order.deliveryDate && order.deliveryDate < options.today))
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
