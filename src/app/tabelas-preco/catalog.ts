import { createProductIdentityResolver, productIdentityKey } from '@/lib/productIdentity'

export type PriceCatalogSource = 'bread' | 'product'
export type PriceCatalogUnit = 'un' | 'kg'

export interface PriceCatalogItemIdentity {
  id: string
  _source: PriceCatalogSource
  pricing_unit: PriceCatalogUnit
  legacy_bread_id?: string | null
  sale_option_id?: string | null
}

export interface PriceTierItemIdentity {
  product_id: string
  product_source: PriceCatalogSource
  pricing_unit: PriceCatalogUnit
  sale_option_id?: string | null
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

  return tierItems.some(item => {
    if (item.pricing_unit !== catalogItem.pricing_unit) return false
    if (!equivalentKeys.has(productIdentityKey(item.product_source, item.product_id))) return false
    // Duas variantes do mesmo produto podem vender na mesma unidade (ex.:
    // Forma e Hamburguer, ambas "un"). Sem checar a forma de venda, precificar
    // uma faria a outra desaparecer do catálogo como se já estivesse precificada.
    if (catalogItem.sale_option_id && item.sale_option_id) {
      return catalogItem.sale_option_id === item.sale_option_id
    }
    return true
  })
}
