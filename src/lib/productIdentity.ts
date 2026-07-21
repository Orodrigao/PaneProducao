// Ponte entre as duas identidades de produto que convivem no sistema:
// o cadastro legado de pães (source 'bread') e o catálogo unificado
// (source 'product', com products.legacy_bread_id apontando para o pão).
// Toda tela que cruza dados operacionais com preço ou custo deve resolver
// a identidade por aqui, nunca comparar source:id cru — comparar cru é a
// causa clássica de "produto com preço salvo aparece como sem preço".

export interface ProductLegacyLink {
  productId: string
  legacyBreadId: string | null | undefined
}

export interface ProductIdentityResolver {
  /**
   * Chaves de identidade equivalentes, começando sempre pela própria
   * identidade (direta). Consumidores que aplicam "preço direto vence"
   * devem respeitar essa ordem.
   */
  keysFor(source: string, productId: string): string[]
}

export function productIdentityKey(source: string, productId: string) {
  return `${source}:${productId}`
}

export function createProductIdentityResolver(
  links: ReadonlyArray<ProductLegacyLink>,
): ProductIdentityResolver {
  const legacyByProduct = new Map<string, string>()
  const productsByLegacy = new Map<string, string[]>()
  links.forEach(link => {
    if (!link.productId || !link.legacyBreadId) return
    legacyByProduct.set(link.productId, link.legacyBreadId)
    productsByLegacy.set(link.legacyBreadId, [
      ...(productsByLegacy.get(link.legacyBreadId) || []),
      link.productId,
    ])
  })

  return {
    keysFor(source, productId) {
      const keys = [productIdentityKey(source, productId)]
      if (source === 'product') {
        const legacyBreadId = legacyByProduct.get(productId)
        if (legacyBreadId) keys.push(productIdentityKey('bread', legacyBreadId))
      } else if (source === 'bread') {
        for (const unifiedProductId of productsByLegacy.get(productId) || []) {
          keys.push(productIdentityKey('product', unifiedProductId))
        }
      }
      return keys
    },
  }
}
