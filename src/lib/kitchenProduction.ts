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

// PostgREST responde 'PGRST205' quando a tabela não está no cache do schema e o
// Postgres responde '42P01' quando ela não existe. Antes do deploy da migration
// os dois significam a mesma coisa para quem está olhando a tela.
const MISSING_TABLE_CODES = new Set(['PGRST205', '42P01'])
const DENIED_CODES = new Set(['42501', 'PGRST301'])

function errorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return ''
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : ''
}

function errorMessage(error: unknown): string {
  if (typeof error !== 'object' || error === null) return ''
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' ? message : ''
}

/**
 * Mensagem honesta para quem está na cozinha. Culpar a internet quando o
 * problema é outro faz a pessoa tentar de novo para sempre.
 */
export function describeKitchenError(error: unknown): string {
  const code = errorCode(error)
  const message = errorMessage(error)

  if (MISSING_TABLE_CODES.has(code) || message.includes('kitchen_production')) {
    return 'Esta tela ainda não foi liberada no banco de dados. Isso é normal antes da mudança ir para o ar — avise o Rodrigo se continuar assim depois disso.'
  }
  if (DENIED_CODES.has(code)) {
    return 'Seu acesso não permite lançar nesta loja. Peça a permissão Produção da Cozinha ao administrador.'
  }
  return 'Não deu para falar com o sistema agora. Confira a internet e tente de novo.'
}
