export interface ClosingBreadSourceRow {
  bread_id: string | null
}

export interface SavedClosingBreadRow {
  product_id: string | null
}

export interface BreadLeftoverItemPayload {
  bread_id: string
  quantity: number
}

export function closingBreadIds(
  ordered: ClosingBreadSourceRow[],
  produced: ClosingBreadSourceRow[],
  saved: SavedClosingBreadRow[],
  included: string[],
): Set<string> {
  const ids = new Set<string>()

  for (const row of ordered) if (row.bread_id) ids.add(row.bread_id)
  for (const row of produced) if (row.bread_id) ids.add(row.bread_id)
  for (const row of saved) if (row.product_id) ids.add(row.product_id)
  for (const breadId of included) if (breadId) ids.add(breadId)

  return ids
}

// `blocked` marca a ida à Central causada pela recusa do fechamento. A Central
// usa isso para dizer qual fechamento está preso e devolver a pessoa para ele.
export function leftoverPendingPath(
  store: 'jc' | 'ja',
  recordDate: string,
  options: { blocked?: boolean } = {},
): string {
  const path = `/sobras/pendencias?store=${store}&date=${encodeURIComponent(recordDate)}`
  return options.blocked ? `${path}&blocked=1` : path
}

export function closingResumePath(store: 'jc' | 'ja', recordDate: string): string {
  return `/sobras?resume=${store}&date=${encodeURIComponent(recordDate)}`
}

// Só trava o fechamento o lote sem destino de um dia ANTERIOR ao que se quer
// fechar — a mesma regra do banco em register_bread_leftovers.
export function blocksClosing(
  leftover: { pending_quantity: number; record_date: string },
  closingDate: string,
): boolean {
  return leftover.pending_quantity > 0 && leftover.record_date < closingDate
}

export function isPendingLeftoversError(message: string): boolean {
  return message.toLocaleLowerCase('pt-BR').includes('sobras pendentes do dia anterior')
}

export function isValidClosingDate(recordDate: string, today: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(recordDate) && recordDate <= today
}

export function buildBreadLeftoverItems(
  visibleBreadIds: string[],
  quantities: Record<string, number>,
): BreadLeftoverItemPayload[] {
  const items = new Map<string, number>()

  for (const breadId of visibleBreadIds) {
    if (!breadId) continue
    items.set(breadId, normalizeQuantity(quantities[`bread_${breadId}`] ?? 0))
  }

  for (const [key, quantity] of Object.entries(quantities)) {
    if (!key.startsWith('bread_')) continue
    const breadId = key.slice('bread_'.length)
    const normalized = normalizeQuantity(quantity)
    if (!breadId || normalized <= 0 || items.has(breadId)) continue
    items.set(breadId, normalized)
  }

  return [...items.entries()].map(([bread_id, quantity]) => ({ bread_id, quantity }))
}

export function hasPositiveBreadLeftover(items: BreadLeftoverItemPayload[]): boolean {
  return items.some(item => item.quantity > 0)
}

export function resolvePendingLeftoverStore(
  user: { role: string; store?: string | null } | null,
  requestedStore: string | null,
): 'jc' | 'ja' {
  if (user?.role === 'vendas' && (user.store === 'jc' || user.store === 'ja')) return user.store
  if (requestedStore === 'jc' || requestedStore === 'ja') return requestedStore
  if (user?.store === 'jc' || user?.store === 'ja') return user.store
  return 'jc'
}

function normalizeQuantity(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}
