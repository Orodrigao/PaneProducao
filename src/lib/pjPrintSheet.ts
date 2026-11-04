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
  /** Pedido PJ por quilo que o Forno não converteu em peças (ficha sem peso assado). */
  needs_weight_setup?: boolean | null
}

export interface PjPrintSheetRow {
  breadId: string
  breadName: string
  storeQuantities: readonly number[]
  storeTotal: number
  pjQuantity: number | null
  /** Tem pedido PJ por quilo fora do total: a folha avisa em vez de esconder. */
  pjWeightPending: boolean
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
    weightPending: boolean
  }>()

  for (const row of pjProduction) {
    const productId = row.product_id || row.bread_id
    if (!productId) continue
    const source = row.product_source === 'product' ? 'product' : 'bread'
    const quantity = positivePjQuantity(row.quantity)
    // Quantidade zero só vale como linha quando esconde pedido por quilo sem
    // conversão: sumir com o pão faria a folha parecer completa.
    const weightPending = row.needs_weight_setup === true
    if (quantity === null && !weightPending) continue
    const key = `${source}:${productId}`
    const current = pjByProduct.get(key)
    pjByProduct.set(key, {
      source,
      productId,
      productName: row.product_name || current?.productName || productId,
      quantity: (current?.quantity ?? 0) + (quantity ?? 0),
      weightPending: Boolean(current?.weightPending) || weightPending,
    })
  }

  const usedKeys = new Set<string>()
  const rows = breads.flatMap((bread) => {
    const key = `bread:${bread.breadId}`
    const storeTotal = bread.storeQuantities.reduce((total, quantity) => total + quantity, 0)
    const pj = pjByProduct.get(key)
    const pjQuantity = pj && pj.quantity > 0 ? pj.quantity : null
    const pjWeightPending = pj?.weightPending ?? false
    const total = storeTotal + (pjQuantity ?? 0)

    if (total <= 0 && !pjWeightPending) return []
    usedKeys.add(key)

    return [{
      breadId: bread.breadId,
      breadName: bread.breadName,
      storeQuantities: bread.storeQuantities,
      storeTotal,
      pjQuantity,
      pjWeightPending,
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
      pjQuantity: product.quantity > 0 ? product.quantity : null,
      pjWeightPending: product.weightPending,
      total: product.quantity,
    })
  }

  return rows
}
