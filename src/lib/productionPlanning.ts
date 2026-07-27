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
  plannedQuantity: number
  frozenQuantity?: number | null
  leftoverConfirmedQuantity?: number | null
}

export function normalizePlannedQuantity(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.trunc(parsed)
}

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

export function calculateNewProductionQuantity(item: ProductionPlanItemInput): number {
  const planned = normalizePlannedQuantity(item.plannedQuantity)
  const frozen = normalizePlannedQuantity(item.frozenQuantity ?? 0)
  const leftover = normalizePlannedQuantity(item.leftoverConfirmedQuantity ?? 0)
  return Math.max(0, planned - frozen - leftover)
}

export function statusAllowsDraftEditing(status: ProductionPlanStatus): boolean {
  return status === 'rascunho' || status === 'reaberto'
}
