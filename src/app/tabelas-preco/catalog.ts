export type PriceCatalogSource = 'bread' | 'product'
export type PriceCatalogUnit = 'un' | 'kg'

export interface PriceCatalogItemIdentity {
  id: string
  _source: PriceCatalogSource
  pricing_unit: PriceCatalogUnit
  legacy_bread_id?: string | null
}

export interface PriceTierItemIdentity {
  product_id: string
  product_source: PriceCatalogSource
  pricing_unit: PriceCatalogUnit
}

export function isLegacyBreadUnified(breadId: string, unifiedBreadIds: ReadonlySet<string>) {
  return unifiedBreadIds.has(breadId)
}

export function isCatalogItemAlreadyPriced(
  catalogItem: PriceCatalogItemIdentity,
  tierItems: ReadonlyArray<PriceTierItemIdentity>,
) {
  const hasDirectPrice = tierItems.some(item =>
    item.product_source === catalogItem._source
    && item.product_id === catalogItem.id
    && item.pricing_unit === catalogItem.pricing_unit,
  )

  if (hasDirectPrice || catalogItem._source !== 'product' || !catalogItem.legacy_bread_id) {
    return hasDirectPrice
  }

  return tierItems.some(item =>
    item.product_source === 'bread'
    && item.product_id === catalogItem.legacy_bread_id
    && item.pricing_unit === catalogItem.pricing_unit,
  )
}
