import { canonicalInventoryUnit } from '@/lib/inventoryReadiness'
import { shiftDateKey, weekdayIndex } from '@/lib/bakeryClock'

export type InventoryWeeklyCountStatus = 'aberta' | 'fechada'

export interface InventoryWeeklyCount {
  id: string
  store: string
  week_start: string
  status: InventoryWeeklyCountStatus
  opened_at: string
  opened_by_name: string
  closed_at: string | null
  closed_by_name: string | null
  reopened_at: string | null
  reopened_by_name: string | null
}

export interface InventoryWeeklyCountItemRow {
  id: string
  product_id: string
  quantity: number | null
  unit: string
  updated_at: string
  updated_by_name: string | null
}

export interface InventoryCountProductLookup {
  id: string
  name: string
  category: string | null
}

export interface InventoryCountBoardRow {
  itemId: string
  productId: string
  productName: string
  category: string | null
  quantity: number | null
  counted: boolean
  displayUnit: string
  updatedAt: string
  updatedByName: string | null
}

export interface InventoryCountBoardSummary {
  total: number
  counted: number
  pending: number
}

// A rodada fotografa os itens na abertura (ver open_inventory_weekly_count).
// O quadro nasce dos itens da rodada, nunca de uma releitura do cadastro:
// insumo desmarcado ou inativado no meio da semana continua aparecendo com o
// que já foi contado, e um marcado depois só entra na próxima abertura.
export function buildInventoryCountBoard(
  items: InventoryWeeklyCountItemRow[],
  productsById: Record<string, InventoryCountProductLookup>,
): InventoryCountBoardRow[] {
  return items
    .map(item => {
      const product = productsById[item.product_id]
      return {
        itemId: item.id,
        productId: item.product_id,
        productName: product?.name ?? '(insumo removido do catálogo)',
        category: product?.category ?? null,
        quantity: item.quantity,
        counted: item.quantity !== null,
        displayUnit: canonicalInventoryUnit(item.unit) ?? item.unit,
        updatedAt: item.updated_at,
        updatedByName: item.updated_by_name,
      }
    })
    .sort((a, b) => a.productName.localeCompare(b.productName, 'pt-BR'))
}

export function summarizeInventoryCountBoard(rows: InventoryCountBoardRow[]): InventoryCountBoardSummary {
  const counted = rows.filter(row => row.counted).length
  return { total: rows.length, counted, pending: rows.length - counted }
}

export function isInventoryWeeklyCountEditable(count: Pick<InventoryWeeklyCount, 'status'> | null): boolean {
  return count?.status === 'aberta'
}

// Prazo de quem conta. Espelha, só para decidir o que a tela mostra, a regra
// do banco (reopen_inventory_weekly_count): a semana da contagem começa na
// segunda (date_trunc('week') do Postgres) e quem conta reabre até o domingo
// dessa semana, 23:59 na padaria; depois, só o admin. Quem decide de verdade
// é o banco. `todayKey` vem de `bakeryDayKey()`, então o fuso do aparelho não
// entra na conta; data inválida esconde o botão de quem conta.

/** Segunda-feira da semana de uma data YYYY-MM-DD. Vazio quando a data é inválida. */
export function inventoryCountWeekStart(dateKey: string): string {
  const dayOfWeek = weekdayIndex(dateKey)
  if (dayOfWeek < 0) return ''
  return shiftDateKey(dateKey, -((dayOfWeek + 6) % 7))
}

/** Domingo da semana da contagem: último dia em que quem conta ainda reabre. */
export function inventoryCountReopenDeadline(weekStart: string): string {
  if (inventoryCountWeekStart(weekStart) !== weekStart) return ''
  return shiftDateKey(weekStart, 6)
}

/** A contagem é a da semana de hoje na padaria. */
export function isInventoryCountOfCurrentWeek(
  count: Pick<InventoryWeeklyCount, 'week_start'> | null,
  todayKey: string,
): boolean {
  const currentWeekStart = inventoryCountWeekStart(todayKey)
  return Boolean(count && currentWeekStart !== '' && count.week_start === currentWeekStart)
}

export type InventoryCountReopenAccess =
  | 'admin'            // reabre qualquer contagem fechada
  | 'counter-in-time'  // quem conta, ainda dentro do prazo
  | 'counter-late'     // quem conta, prazo já terminou: só o admin reabre
  | 'none'             // contagem aberta, inexistente ou pessoa sem permissão

export function inventoryCountReopenAccess(params: {
  count: Pick<InventoryWeeklyCount, 'status' | 'week_start'> | null
  isAdmin: boolean
  canCount: boolean
  todayKey: string
}): InventoryCountReopenAccess {
  const { count, isAdmin, canCount, todayKey } = params
  if (!count || count.status !== 'fechada') return 'none'
  if (isAdmin) return 'admin'
  if (!canCount) return 'none'
  const deadline = inventoryCountReopenDeadline(count.week_start)
  if (deadline === '' || inventoryCountWeekStart(todayKey) === '') return 'counter-late'
  return todayKey <= deadline ? 'counter-in-time' : 'counter-late'
}

/** Data YYYY-MM-DD como dd/mm, para textos curtos. Data inválida volta como veio. */
export function formatDayMonth(dateKey: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(dateKey)
  return match ? `${match[2]}/${match[1]}` : dateKey
}

/**
 * Nomes dos insumos que ficariam sem contagem se a contagem fosse fechada
 * agora. Considera o que está digitado e ainda não salvou: fechar descarrega
 * esses campos antes (collectDirtyQuantityEdits), então um número digitado
 * conta como contado e um campo apagado conta como pendente.
 */
export function listPendingInventoryCountNames(
  rows: InventoryCountBoardRow[],
  inputs: Record<string, string>,
): string[] {
  return rows
    .filter(row => {
      const raw = inputs[row.productId]
      return raw === undefined ? !row.counted : raw.trim() === ''
    })
    .map(row => row.productName)
}

// Quais campos têm texto digitado ainda não confirmado pelo último item
// salvo. Usado para "descarregar" tudo que está pendente antes de fechar a
// contagem, para que fechar não vença uma corrida com o salvamento no blur
// e descarte o último número digitado.
export function collectDirtyQuantityEdits(
  rows: InventoryCountBoardRow[],
  inputs: Record<string, string>,
): Array<{ productId: string; rawValue: string }> {
  const dirty: Array<{ productId: string; rawValue: string }> = []
  for (const row of rows) {
    const raw = inputs[row.productId]
    if (raw === undefined) continue
    const saved = row.quantity === null ? '' : String(row.quantity)
    if (raw.trim() !== saved.trim()) dirty.push({ productId: row.productId, rawValue: raw })
  }
  return dirty
}
