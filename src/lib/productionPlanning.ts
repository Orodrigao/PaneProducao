export const PRODUCTION_PLANNING_ROUTE = '/planejamento-producao'

export type ProductionPlanStore = 'jc' | 'ja'
export const PRODUCTION_PLAN_STORES: readonly ProductionPlanStore[] = ['jc', 'ja']

export type ProductionPlanStatus =
  | 'rascunho'
  | 'aguardando_expedicao'
  | 'aguardando_sobras'
  | 'aguardando_geolar'
  | 'fechado'
  | 'reaberto'

export const PRODUCTION_PLAN_STATUS_LABELS: Record<ProductionPlanStatus, string> = {
  rascunho: 'Rascunho',
  aguardando_expedicao: 'Aguardando Expedição',
  aguardando_sobras: 'Aguardando sobras',
  aguardando_geolar: 'Aguardando Geolar',
  fechado: 'Fechado',
  reaberto: 'Reaberto',
}

export interface PlanningBreadLite {
  id: string
  name: string
  days: number[] | null
  active?: boolean | null
  is_pj?: boolean | null
}

export interface ProductionPlanItemInput {
  newQuantity: number
  frozenQuantity?: number | null
  leftoverProposedQuantity?: number | null
  leftoverConfirmedQuantity?: number | null
}

export interface ProductionPlanOrderItemInput {
  store: ProductionPlanStore | string | null
  bread_id: string | null
  planned_quantity: number | string | null
  frozen_quantity?: number | string | null
  leftover_proposed_quantity?: number | string | null
  leftover_confirmed_quantity?: number | string | null
}

export interface ProductionOrderDraftFromPlan {
  store: ProductionPlanStore
  bread_id: string
  quantity: number
  order_date: string
  order_type: 'producao'
  obs: string
}

export interface ProductionLeftoverProposalFromPlan {
  bread_id: string
  quantity: number
}

export interface PlanningFrozenProductRow {
  id: string
  product_id: string | null
  product_source: string | null
  visible_stores?: string[] | string | null
  store?: string | null
}

export interface PlanningFrozenStockRow {
  frozen_product_id: string
  location: string | null
  quantity: number | string | null
}

export interface PlanningPendingLeftoverRow {
  store: string | null
  product_id: string | null
  pending_quantity: number | string | null
}

export function normalizePlanQuantity(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.trunc(parsed)
}

export const normalizePlannedQuantity = normalizePlanQuantity

export function weekdayIndex(dateKey: string): number {
  const parsed = new Date(`${dateKey}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return -1
  return parsed.getDay()
}

export function plannedBreadsForDate<T extends PlanningBreadLite>(
  breads: readonly T[],
  dateKey: string,
): T[] {
  const day = weekdayIndex(dateKey)
  return breads.filter(bread =>
    bread.active !== false
    && bread.is_pj !== true
    && Array.isArray(bread.days)
    && bread.days.includes(day),
  )
}

export function normalizePlanningSearch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export function matchesPlanningBreadSearch(breadName: string, query: string): boolean {
  const normalizedQuery = normalizePlanningSearch(query)
  if (normalizedQuery.length < 2) return false
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean)
  const normalizedName = normalizePlanningSearch(breadName)
  return tokens.every(token => normalizedName.includes(token))
}

export function calculatePlannedTotalQuantity(item: ProductionPlanItemInput): number {
  const fresh = normalizePlanQuantity(item.newQuantity)
  const frozen = normalizePlanQuantity(item.frozenQuantity ?? 0)
  const leftover = normalizePlanQuantity(item.leftoverConfirmedQuantity ?? item.leftoverProposedQuantity ?? 0)
  return fresh + frozen + leftover
}

export function productionPlanItemOrderQuantity(item: ProductionPlanOrderItemInput): number {
  return calculatePlannedTotalQuantity({
    newQuantity: normalizePlanQuantity(item.planned_quantity),
    frozenQuantity: normalizePlanQuantity(item.frozen_quantity ?? 0),
    leftoverProposedQuantity: normalizePlanQuantity(item.leftover_proposed_quantity ?? 0),
    leftoverConfirmedQuantity: item.leftover_confirmed_quantity == null
      ? null
      : normalizePlanQuantity(item.leftover_confirmed_quantity),
  })
}

export function buildProductionOrderDraftsFromPlan(
  items: readonly ProductionPlanOrderItemInput[],
  store: ProductionPlanStore,
  orderDate: string,
): ProductionOrderDraftFromPlan[] {
  return items
    .filter(item => item.store === store && Boolean(item.bread_id))
    .map(item => ({
      store,
      bread_id: String(item.bread_id),
      quantity: productionPlanItemOrderQuantity(item),
      order_date: orderDate,
      order_type: 'producao' as const,
      obs: 'Gerado pelo Planejamento',
    }))
    .filter(row => row.quantity > 0)
}

export function buildLeftoverProposalDraftsFromPlan(
  items: readonly ProductionPlanOrderItemInput[],
  store: ProductionPlanStore,
): ProductionLeftoverProposalFromPlan[] {
  return items
    .filter(item => item.store === store && Boolean(item.bread_id))
    .map(item => ({
      bread_id: String(item.bread_id),
      quantity: normalizePlanQuantity(item.leftover_proposed_quantity ?? 0),
    }))
}

export function summarizePlanItemsByStore(
  items: readonly ProductionPlanOrderItemInput[],
): Record<ProductionPlanStore, number> {
  return Object.fromEntries(PRODUCTION_PLAN_STORES.map(store => [
    store,
    items
      .filter(item => item.store === store)
      .reduce((total, item) => total + productionPlanItemOrderQuantity(item), 0),
  ])) as Record<ProductionPlanStore, number>
}

export function statusAllowsDraftEditing(status: ProductionPlanStatus): boolean {
  return status === 'rascunho' || status === 'reaberto'
}

export function planningAvailabilityKey(store: ProductionPlanStore, breadId: string): string {
  return `${store}:${breadId}`
}

export function normalizePlanningStores(value: unknown): ProductionPlanStore[] | null {
  if (value == null) return null
  const rawStores = Array.isArray(value) ? value : [value]
  const stores = rawStores
    .map(store => String(store).trim().toLowerCase())
    .filter((store): store is ProductionPlanStore => store === 'jc' || store === 'ja')

  return stores.length > 0 ? [...new Set(stores)] : null
}

export function frozenLocationPlanningStore(location: string | null | undefined): ProductionPlanStore | null {
  const normalized = (location ?? '').trim().toLowerCase()
  if (normalized === 'freezer' || normalized === 'camara' || normalized === 'freezer_loja') return 'jc'
  if (normalized.startsWith('jc-')) return 'jc'
  if (normalized.startsWith('ja-')) return 'ja'
  return null
}

export function aggregateFrozenBreadAvailability(
  products: PlanningFrozenProductRow[],
  stockRows: PlanningFrozenStockRow[],
): Map<string, number> {
  const productsById = new Map(products
    .filter(product => product.product_source === 'bread' && Boolean(product.product_id))
    .map(product => [product.id, product]))
  const totals = new Map<string, number>()

  for (const stock of stockRows) {
    const product = productsById.get(stock.frozen_product_id)
    if (!product?.product_id) continue

    const store = frozenLocationPlanningStore(stock.location)
    if (!store) continue

    const visibleStores = normalizePlanningStores(product.visible_stores ?? product.store)
    if (visibleStores && !visibleStores.includes(store)) continue

    const quantity = normalizePlanQuantity(stock.quantity)
    if (quantity <= 0) continue

    const key = planningAvailabilityKey(store, product.product_id)
    totals.set(key, (totals.get(key) ?? 0) + quantity)
  }

  return totals
}

export function aggregatePlanningLeftoverAvailability(
  rows: PlanningPendingLeftoverRow[],
): Map<string, number> {
  const totals = new Map<string, number>()

  for (const row of rows) {
    if ((row.store !== 'jc' && row.store !== 'ja') || !row.product_id) continue
    const quantity = normalizePlanQuantity(row.pending_quantity)
    if (quantity <= 0) continue

    const key = planningAvailabilityKey(row.store, row.product_id)
    totals.set(key, (totals.get(key) ?? 0) + quantity)
  }

  return totals
}
