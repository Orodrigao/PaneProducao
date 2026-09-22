// Soma das quantidades enviadas nos romaneios de um dia, por produto e loja.
// Só quantidades: valores em reais ficam no fechamento oficial (Tabela Buck).
// Quilo e unidade nunca se somam: cada linha tem uma unidade e os totais são
// separados por unidade.

import {
  billingUnitForRomaneioProduct,
  explicitUnitInRomaneioProduct,
  type RomaneioBillingUnit,
} from './romaneioBilling'

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
  unit: RomaneioBillingUnit
  isExtra: boolean
  byStore: Record<string, SentSummaryCell>
  total: SentSummaryCell
}

export interface SentSummaryTotal {
  unit: RomaneioBillingUnit
  byStore: Record<string, SentSummaryCell>
  total: SentSummaryCell
}

export interface SentSummary {
  stores: SentSummaryStore[]
  rows: SentSummaryRow[]
  /** Um total por unidade presente no dia (un antes de kg). */
  totals: SentSummaryTotal[]
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

/** Unidade do cadastro do pão (`breads.unit`), por id do produto. */
export type SentSummaryCatalogUnits = Record<string, RomaneioBillingUnit>

export function catalogUnitFromBreadUnit(unit: string | null | undefined): RomaneioBillingUnit {
  return (unit ?? '').toLowerCase().includes('kg') ? 'kg' : 'un'
}

// Mesma ordem de decisão da montagem do romaneio: unidade escrita no nome,
// depois os pães sempre pesados, depois a unidade do cadastro.
function itemUnit(item: SentSummaryItem, name: string, catalogUnits: SentSummaryCatalogUnits): RomaneioBillingUnit {
  const explicit = explicitUnitInRomaneioProduct(name)
  if (explicit) return explicit
  if (billingUnitForRomaneioProduct(name) === 'kg') return 'kg'
  if (item.product_source === 'bread' && item.product_id) return catalogUnits[item.product_id] ?? 'un'
  return 'un'
}

function storeRank(code: string) {
  const i = STORE_ORDER.indexOf(code)
  return i === -1 ? STORE_ORDER.length : i
}

export function buildSentSummary(
  romaneios: SentSummaryRomaneio[],
  items: SentSummaryItem[],
  catalogUnits: SentSummaryCatalogUnits = {},
): SentSummary {
  const romById = new Map(romaneios.map(r => [r.id, r]))
  const stores = new Map<string, SentSummaryStore>()
  const rows = new Map<string, SentSummaryRow>()
  const totals = new Map<RomaneioBillingUnit, SentSummaryTotal>()

  for (const item of items) {
    const rom = romById.get(item.romaneio_id)
    const qty = toQty(item.qty_sent)
    if (!rom || qty === 0) continue

    const code = (rom.destinations?.code || '?').trim().toUpperCase()
    if (!stores.has(code)) stores.set(code, { code, name: rom.destinations?.name || code })
    const pending = rom.status === NOT_SENT_STATUS

    // Extra ganha id novo a cada romaneio; o mesmo extra se junta pelo nome.
    // O mesmo pão pode sair por unidade e por quilo (Ciabatta): a unidade
    // entra na chave para a linha nunca misturar as duas.
    const isExtra = item.product_source === 'extra'
    const name = item.product_name.trim()
    const unit = itemUnit(item, name, catalogUnits)
    const key = isExtra || !item.product_id
      ? `nome:${isExtra ? 'extra' : 'item'}:${unit}:${name.toLowerCase()}`
      : `${item.product_source || ''}:${item.product_id}:${unit}`
    let row = rows.get(key)
    if (!row) {
      row = { key, productName: name, unit, isExtra, byStore: {}, total: emptyCell() }
      rows.set(key, row)
    }
    let unitTotal = totals.get(unit)
    if (!unitTotal) {
      unitTotal = { unit, byStore: {}, total: emptyCell() }
      totals.set(unit, unitTotal)
    }
    row.byStore[code] ??= emptyCell()
    unitTotal.byStore[code] ??= emptyCell()
    addTo(row.byStore[code], qty, pending)
    addTo(row.total, qty, pending)
    addTo(unitTotal.byStore[code], qty, pending)
    addTo(unitTotal.total, qty, pending)
  }

  return {
    stores: [...stores.values()].sort((a, b) => storeRank(a.code) - storeRank(b.code) || a.code.localeCompare(b.code)),
    rows: [...rows.values()].sort((a, b) =>
      Number(a.isExtra) - Number(b.isExtra) || a.productName.localeCompare(b.productName, 'pt-BR')),
    totals: [...totals.values()].sort((a, b) => (a.unit === 'un' ? 0 : 1) - (b.unit === 'un' ? 0 : 1)),
    romaneioCount: romaneios.length,
    pendingRomaneioCount: romaneios.filter(r => r.status === NOT_SENT_STATUS).length,
  }
}

export function formatQty(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}
