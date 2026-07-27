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

export function statusAllowsDraftEditing(status: ProductionPlanStatus): boolean {
  return status === 'rascunho' || status === 'reaberto'
}
