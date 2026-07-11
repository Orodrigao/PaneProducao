export type ManagedStore = 'jc' | 'ja'

export type LeftoverDestination =
  | 'display'
  | 'internal_use'
  | 'donation'
  | 'discard'
  | 'freeze'

export interface PendingLeftoverRow {
  store: string | null
  product_id: string | null
  pending_quantity: number | null
}

export interface ConfirmedReuseRow {
  bread_id: string
  confirmed_quantity: number | null
  status: string
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export function leftoverKey(store: ManagedStore, breadId: string): string {
  return `${store}-${breadId}`
}

export function aggregateWholePending(
  rows: PendingLeftoverRow[],
): Map<string, number> {
  const totals = new Map<string, number>()

  for (const row of rows) {
    if ((row.store !== 'jc' && row.store !== 'ja') || !row.product_id) continue
    const quantity = Number(row.pending_quantity ?? 0)
    if (!Number.isFinite(quantity) || quantity <= 0) continue

    const key = leftoverKey(row.store, row.product_id)
    totals.set(key, (totals.get(key) ?? 0) + Math.floor(quantity))
  }

  return totals
}

export function aggregateConfirmedReuse(
  rows: ConfirmedReuseRow[],
): Map<string, number> {
  const totals = new Map<string, number>()

  for (const row of rows) {
    if (row.status !== 'confirmed' || !row.bread_id) continue
    const quantity = Number(row.confirmed_quantity ?? 0)
    if (!Number.isSafeInteger(quantity) || quantity <= 0) continue
    totals.set(row.bread_id, (totals.get(row.bread_id) ?? 0) + quantity)
  }

  return totals
}

export function subtractConfirmedReuse(
  planned: Map<string, number>,
  confirmed: Map<string, number>,
): Map<string, number> {
  const adjusted = new Map<string, number>()

  for (const [breadId, quantity] of planned) {
    adjusted.set(breadId, Math.max(0, quantity - (confirmed.get(breadId) ?? 0)))
  }

  return adjusted
}

export function clampReuseProposal(
  value: number,
  orderQuantity: number,
  availableQuantity: number,
): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(
    0,
    Math.min(Math.floor(value), Math.floor(orderQuantity), Math.floor(availableQuantity)),
  )
}

export function validateDestinationQuantity(
  value: string,
  pendingQuantity: number,
): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null

  const quantity = Number(normalized)
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > pendingQuantity) return null
  return quantity
}

export function leftoverAgeDays(recordDate: string, referenceDate: string): number {
  const record = parseIsoDate(recordDate)
  const reference = parseIsoDate(referenceDate)
  if (!record || !reference) return 0
  return Math.max(0, Math.floor((reference.getTime() - record.getTime()) / 86_400_000))
}

function parseIsoDate(value: string): Date | null {
  const match = ISO_DATE_PATTERN.exec(value)
  if (!match) return null
  const [, year, month, day] = match
  const parsed = new Date(`${year}-${month}-${day}T00:00:00Z`)
  if (
    parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() + 1 !== Number(month)
    || parsed.getUTCDate() !== Number(day)
  ) return null
  return parsed
}
