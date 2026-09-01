export interface PjProductionQueueRow {
  order_id: string
  order_group_id: string | null
  customer_id: string | null
  customer_name: string
  order_date: string
  delivery_date: string | null
  product_name: string
  canonical_bread_id: string | null
  pricing_unit: 'un' | 'kg' | string
  ordered_quantity: number | string
  scheduled_quantity: number | string
  pending_quantity: number | string
  frozen_available: number | string
  last_scheduled_date: string | null
  mapping_error: string | null
}

export interface PjProductionQueueItem {
  orderId: string
  orderGroupId: string | null
  customerId: string | null
  customerName: string
  orderDate: string
  deliveryDate: string | null
  productName: string
  breadId: string | null
  pricingUnit: 'un' | 'kg'
  orderedQuantity: number
  scheduledQuantity: number
  pendingQuantity: number
  frozenAvailable: number
  lastScheduledDate: string | null
  mappingError: string | null
}

export interface PjProductionQueueGroup {
  key: string
  customerName: string
  deliveryDate: string | null
  items: PjProductionQueueItem[]
}

export interface PjProductionSelection {
  orderId: string
  quantity: number
  frozenQuantity: number
}

function nonNegativeQuantity(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return Math.round(parsed * 1000) / 1000
}

export function normalizePjProductionQueueRow(
  row: PjProductionQueueRow,
): PjProductionQueueItem {
  return {
    orderId: row.order_id,
    orderGroupId: row.order_group_id,
    customerId: row.customer_id,
    customerName: row.customer_name || 'Cliente PJ',
    orderDate: row.order_date,
    deliveryDate: row.delivery_date,
    productName: row.product_name || 'Produto sem nome',
    breadId: row.canonical_bread_id,
    pricingUnit: row.pricing_unit === 'kg' ? 'kg' : 'un',
    orderedQuantity: nonNegativeQuantity(row.ordered_quantity),
    scheduledQuantity: nonNegativeQuantity(row.scheduled_quantity),
    pendingQuantity: nonNegativeQuantity(row.pending_quantity),
    frozenAvailable: nonNegativeQuantity(row.frozen_available),
    lastScheduledDate: row.last_scheduled_date,
    mappingError: row.mapping_error,
  }
}

export function groupPjProductionQueue(
  rows: readonly PjProductionQueueRow[],
): PjProductionQueueGroup[] {
  const groups = new Map<string, PjProductionQueueGroup>()

  for (const row of rows) {
    const item = normalizePjProductionQueueRow(row)
    if (item.pendingQuantity <= 0) continue
    const key = item.orderGroupId ?? item.orderId
    const group = groups.get(key) ?? {
      key,
      customerName: item.customerName,
      deliveryDate: item.deliveryDate,
      items: [],
    }
    group.items.push(item)
    groups.set(key, group)
  }

  return Array.from(groups.values())
    .map(group => ({
      ...group,
      items: group.items.sort((left, right) =>
        left.productName.localeCompare(right.productName, 'pt-BR')),
    }))
    .sort((left, right) => {
      if (!left.deliveryDate && right.deliveryDate) return -1
      if (left.deliveryDate && !right.deliveryDate) return 1
      const byDelivery = (left.deliveryDate ?? '').localeCompare(right.deliveryDate ?? '')
      if (byDelivery !== 0) return byDelivery
      return left.customerName.localeCompare(right.customerName, 'pt-BR')
    })
}

export function parsePjProductionQuantity(
  value: string,
  unit: 'un' | 'kg',
): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) return null
  const quantity = Number(normalized)
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) return null
  if (unit === 'un' && !Number.isSafeInteger(quantity)) return null
  return quantity
}

export function parseFrozenProductionQuantity(value: string): number | null {
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) return null
  const quantity = Number(normalized)
  return Number.isSafeInteger(quantity) && quantity >= 0 ? quantity : null
}

export function validatePjProductionSelection(
  item: PjProductionQueueItem,
  quantityValue: string,
  frozenValue: string,
): PjProductionSelection | string {
  if (item.mappingError || !item.breadId) {
    return item.mappingError || 'Produto sem vínculo com o Forno.'
  }

  const quantity = parsePjProductionQuantity(quantityValue, item.pricingUnit)
  if (quantity === null) {
    return item.pricingUnit === 'kg'
      ? 'Informe uma quantidade com até 3 casas decimais.'
      : 'Informe uma quantidade inteira de pães.'
  }
  if (quantity > item.pendingQuantity) return 'A quantidade passa do que ainda falta produzir.'

  const frozenQuantity = parseFrozenProductionQuantity(frozenValue)
  if (frozenQuantity === null) return 'A quantidade de congelados deve ser inteira.'
  if (frozenQuantity > quantity) return 'Congelados não podem passar da quantidade programada.'
  if (frozenQuantity > item.frozenAvailable) return 'Não há essa quantidade disponível no congelado.'

  return { orderId: item.orderId, quantity, frozenQuantity }
}

export function formatPjProductionQuantity(quantity: number, unit: 'un' | 'kg'): string {
  const value = unit === 'kg'
    ? quantity.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
    : String(Math.trunc(quantity))
  return `${value} ${unit}`
}
