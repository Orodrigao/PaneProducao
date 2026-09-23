export interface PjPrintBreadSource {
  breadId: string
  breadName: string
  storeQuantities: readonly number[]
}

export interface PjProductionPrintSource {
  bread_id?: string | null
  product_source?: 'bread' | 'product' | null
  product_id?: string | null
  product_name?: string | null
  production_unit?: string | null
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
  const pjByProduct = new Map<string, {
    source: 'bread' | 'product'
    productId: string
    productName: string
    quantity: number
  }>()

  for (const row of pjProduction) {
    const productId = row.product_id || row.bread_id
    if (!productId) continue
    const source = row.product_source === 'product' ? 'product' : 'bread'
    const quantity = positivePjQuantity(row.quantity)
    if (quantity === null) continue
    const key = `${source}:${productId}`
    const current = pjByProduct.get(key)
    pjByProduct.set(key, {
      source,
      productId,
      productName: row.product_name || current?.productName || productId,
      quantity: (current?.quantity ?? 0) + quantity,
    })
  }

  const usedKeys = new Set<string>()
  const rows = breads.flatMap((bread) => {
    const key = `bread:${bread.breadId}`
    const storeTotal = bread.storeQuantities.reduce((total, quantity) => total + quantity, 0)
    const pjQuantity = pjByProduct.get(key)?.quantity ?? null
    const total = storeTotal + (pjQuantity ?? 0)

    if (total <= 0) return []
    usedKeys.add(key)

    return [{
      breadId: bread.breadId,
      breadName: bread.breadName,
      storeQuantities: bread.storeQuantities,
      storeTotal,
      pjQuantity,
      total,
    }]
  })

  const emptyStoreQuantities = breads[0]?.storeQuantities.map(() => 0) ?? []
  for (const [key, product] of pjByProduct) {
    if (usedKeys.has(key)) continue
    rows.push({
      breadId: product.source === 'bread' ? product.productId : key,
      breadName: product.productName,
      storeQuantities: emptyStoreQuantities,
      storeTotal: 0,
      pjQuantity: product.quantity,
      total: product.quantity,
    })
  }

  return rows
}
