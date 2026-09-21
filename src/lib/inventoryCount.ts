import { canonicalInventoryUnit } from '@/lib/inventoryReadiness'

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
