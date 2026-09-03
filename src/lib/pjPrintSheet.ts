export interface PjPrintBreadSource {
  breadId: string
  breadName: string
  storeQuantities: readonly number[]
}

export interface PjProductionPrintSource {
  bread_id: string | null
  quantity: unknown
}

export interface PjPrintSheetRow {
  breadId: string
  breadName: string
  storeQuantities: readonly number[]
  storeTotal: number
  pjQuantity: number | null
  total: number
}

function positivePjQuantity(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const quantity = Number(value)
  return Number.isFinite(quantity) && quantity > 0
    ? quantity
    : null
}

export function buildPjPrintSheet(
  breads: readonly PjPrintBreadSource[],
  pjProduction: readonly PjProductionPrintSource[],
): PjPrintSheetRow[] {
  const pjByBread = new Map<string, number>()

  for (const row of pjProduction) {
    if (!row.bread_id) continue
    const quantity = positivePjQuantity(row.quantity)
    if (quantity === null) continue
    pjByBread.set(row.bread_id, (pjByBread.get(row.bread_id) ?? 0) + quantity)
  }

  return breads.flatMap((bread) => {
    const storeTotal = bread.storeQuantities.reduce((total, quantity) => total + quantity, 0)
    const pjQuantity = pjByBread.get(bread.breadId) ?? null
    const total = storeTotal + (pjQuantity ?? 0)

    if (total <= 0) return []

    return [{
      breadId: bread.breadId,
      breadName: bread.breadName,
      storeQuantities: bread.storeQuantities,
      storeTotal,
      pjQuantity,
      total,
    }]
  })
}
