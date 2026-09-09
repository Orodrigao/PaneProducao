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

const BAKERY_TIME_ZONE = 'America/Sao_Paulo'
const bakeryDayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BAKERY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Dia civil da padaria, sem depender do fuso configurado no aparelho. */
export function bakeryDayKey(value: Date = new Date()): string {
  if (Number.isNaN(value.getTime())) return ''
  const parts = Object.fromEntries(
    bakeryDayFormatter
      .formatToParts(value)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
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
