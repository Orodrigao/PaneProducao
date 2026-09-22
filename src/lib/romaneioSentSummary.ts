// Soma das quantidades enviadas nos romaneios de um dia, por produto e loja.
// Só quantidades: valores em reais ficam no fechamento oficial (Tabela Buck).

export interface SentSummaryRomaneio {
  id: string
  status: string
  destinations?: { name: string; code: string } | null
}

export interface SentSummaryItem {
  romaneio_id: string
  product_id: string | null
  product_source: string | null
  product_name: string
  qty_sent: number | string | null
}

export interface SentSummaryStore {
  code: string
  name: string
}

export interface SentSummaryCell {
  total: number
  /** Parte do total que ainda está em romaneio "separado" (não saiu). */
  pending: number
}

export interface SentSummaryRow {
  key: string
  productName: string
  byStore: Record<string, SentSummaryCell>
  total: SentSummaryCell
}

export interface SentSummary {
  stores: SentSummaryStore[]
  rows: SentSummaryRow[]
  storeTotals: Record<string, SentSummaryCell>
  total: SentSummaryCell
  romaneioCount: number
  pendingRomaneioCount: number
}

const STORE_ORDER = ['JC', 'JA', 'EX']
const NOT_SENT_STATUS = 'separado'

function toQty(value: number | string | null): number {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : value
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0
}

function emptyCell(): SentSummaryCell {
  return { total: 0, pending: 0 }
}

function addTo(cell: SentSummaryCell, qty: number, pending: boolean) {
  cell.total += qty
  if (pending) cell.pending += qty
}

function storeRank(code: string) {
  const i = STORE_ORDER.indexOf(code)
  return i === -1 ? STORE_ORDER.length : i
}

export function buildSentSummary(romaneios: SentSummaryRomaneio[], items: SentSummaryItem[]): SentSummary {
  const romById = new Map(romaneios.map(r => [r.id, r]))
  const stores = new Map<string, SentSummaryStore>()
  const rows = new Map<string, SentSummaryRow>()
  const storeTotals: Record<string, SentSummaryCell> = {}
  const total = emptyCell()

  for (const item of items) {
    const rom = romById.get(item.romaneio_id)
    const qty = toQty(item.qty_sent)
    if (!rom || qty === 0) continue

    const code = (rom.destinations?.code || '?').trim().toUpperCase()
    if (!stores.has(code)) stores.set(code, { code, name: rom.destinations?.name || code })
    const pending = rom.status === NOT_SENT_STATUS

    const key = item.product_id ? `${item.product_source || ''}:${item.product_id}` : `nome:${item.product_name.trim().toLowerCase()}`
    let row = rows.get(key)
    if (!row) {
      row = { key, productName: item.product_name.trim(), byStore: {}, total: emptyCell() }
      rows.set(key, row)
    }
    row.byStore[code] ??= emptyCell()
    storeTotals[code] ??= emptyCell()
    addTo(row.byStore[code], qty, pending)
    addTo(row.total, qty, pending)
    addTo(storeTotals[code], qty, pending)
    addTo(total, qty, pending)
  }

  return {
    stores: [...stores.values()].sort((a, b) => storeRank(a.code) - storeRank(b.code) || a.code.localeCompare(b.code)),
    rows: [...rows.values()].sort((a, b) => a.productName.localeCompare(b.productName, 'pt-BR')),
    storeTotals,
    total,
    romaneioCount: romaneios.length,
    pendingRomaneioCount: romaneios.filter(r => r.status === NOT_SENT_STATUS).length,
  }
}

export function formatQty(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}
