import { createProductIdentityResolver, productIdentityKey } from '@/lib/productIdentity'

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
  const resolver = createProductIdentityResolver(
    catalogItem._source === 'product' && catalogItem.legacy_bread_id
      ? [{ productId: catalogItem.id, legacyBreadId: catalogItem.legacy_bread_id }]
      : [],
  )
  const equivalentKeys = new Set(resolver.keysFor(catalogItem._source, catalogItem.id))

  return tierItems.some(item =>
    item.pricing_unit === catalogItem.pricing_unit
    && equivalentKeys.has(productIdentityKey(item.product_source, item.product_id)),
  )
}
