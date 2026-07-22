// Produção da Cozinha — o que a cozinha realmente produziu no dia.
// Regras puras aqui; acesso a dados em kitchenProductionClient.ts e interface
// em /producao-cozinha. A autorização efetiva vive nas policies RLS de
// kitchen_production.

export const KITCHEN_PRODUCTION_ROUTE = '/producao-cozinha'
export const KITCHEN_PRODUCTION_PERMISSION = 'producao_cozinha.lancar'
export const KITCHEN_PRODUCTION_AREA = 'cozinha'
export const KITCHEN_MAX_QUANTITY = 999

export type KitchenStore = 'jc' | 'ja' | 'ex'
export const KITCHEN_STORES: readonly KitchenStore[] = ['jc', 'ja', 'ex']

export interface KitchenPermission {
  permission_key: string
  scope: string
}

export interface KitchenItem {
  id: string
  name: string
  category: string | null
  unit: string | null
}

export interface KitchenEntry {
  id: string
  product_id: string
  quantity: number
  recorded_by_name: string | null
  updated_at: string | null
}

export interface KitchenUpsertRow {
  store: KitchenStore
  product_id: string
  record_date: string
  quantity: number
  recorded_by: string | null
  recorded_by_name: string | null
}

export interface KitchenSavePlan {
  upserts: KitchenUpsertRow[]
  deleteIds: string[]
}

export function normalizeKitchenStore(value: string | null | undefined): KitchenStore | null {
  const normalized = (value ?? '').trim().toLowerCase()
  return KITCHEN_STORES.includes(normalized as KitchenStore) ? normalized as KitchenStore : null
}

/** Lojas em que o usuário pode lançar. Escopo `*` e admin valem para todas. */
export function kitchenStoresForUser(
  permissions: readonly KitchenPermission[],
  isAdmin: boolean,
): KitchenStore[] {
  if (isAdmin) return [...KITCHEN_STORES]

  const stores = new Set<KitchenStore>()
  for (const permission of permissions) {
    if (permission.permission_key !== KITCHEN_PRODUCTION_PERMISSION) continue
    if (permission.scope === '*') return [...KITCHEN_STORES]
    const store = normalizeKitchenStore(permission.scope)
    if (store) stores.add(store)
  }
  return KITCHEN_STORES.filter(store => stores.has(store))
}

export function canLaunchKitchenProduction(
  permissions: readonly KitchenPermission[],
  store: string | null | undefined,
  isAdmin: boolean,
): boolean {
  const target = normalizeKitchenStore(store)
  if (!target) return false
  return kitchenStoresForUser(permissions, isAdmin).includes(target)
}

/** Contagem de peça ou pote: inteira, nunca negativa, com teto igual ao do banco. */
export function sanitizeKitchenQuantity(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.min(Math.trunc(parsed), KITCHEN_MAX_QUANTITY)
}

export function shiftDateKey(dateKey: string, days: number): string {
  const parsed = new Date(`${dateKey}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return dateKey
  parsed.setDate(parsed.getDate() + days)
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
}

/**
 * Janela de lançamento de quem não é admin: hoje e ontem. Espelha
 * private.kitchen_production_date_is_open — quem esquece à noite ainda lança na
 * manhã seguinte, mas ninguém reescreve histórico antigo em silêncio.
 */
export function isKitchenDateOpen(recordDate: string, todayKey: string): boolean {
  return recordDate === todayKey || recordDate === shiftDateKey(todayKey, -1)
}

export function groupKitchenItems(
  items: readonly KitchenItem[],
): Array<{ category: string; items: KitchenItem[] }> {
  const groups = new Map<string, KitchenItem[]>()
  for (const item of items) {
    const category = item.category?.trim() || 'Outros'
    const group = groups.get(category) ?? []
    group.push(item)
    groups.set(category, group)
  }
  return Array.from(groups, ([category, groupedItems]) => ({ category, items: groupedItems }))
}

/**
 * Compara o que está na tela com o que já está gravado e devolve só a diferença:
 * grava o que mudou, apaga o que voltou a zero e ignora o resto.
 */
export function buildKitchenSavePlan(params: {
  store: KitchenStore
  recordDate: string
  quantities: Readonly<Record<string, number>>
  entries: readonly KitchenEntry[]
  recordedBy: string | null
  recordedByName: string | null
}): KitchenSavePlan {
  const { store, recordDate, quantities, entries, recordedBy, recordedByName } = params
  const entryByProduct = new Map(entries.map(entry => [entry.product_id, entry]))
  const upserts: KitchenUpsertRow[] = []
  const deleteIds: string[] = []

  for (const [productId, rawQuantity] of Object.entries(quantities)) {
    const quantity = sanitizeKitchenQuantity(rawQuantity)
    const existing = entryByProduct.get(productId)

    if (quantity === 0) {
      if (existing) deleteIds.push(existing.id)
      continue
    }
    if (existing && sanitizeKitchenQuantity(existing.quantity) === quantity) continue

    upserts.push({
      store,
      product_id: productId,
      record_date: recordDate,
      quantity,
      recorded_by: recordedBy,
      recorded_by_name: recordedByName,
    })
  }

  return { upserts, deleteIds }
}

export function isEmptyKitchenSavePlan(plan: KitchenSavePlan): boolean {
  return plan.upserts.length === 0 && plan.deleteIds.length === 0
}

export function totalKitchenQuantity(quantities: Readonly<Record<string, number>>): number {
  return Object.values(quantities).reduce((total, value) => total + sanitizeKitchenQuantity(value), 0)
}
