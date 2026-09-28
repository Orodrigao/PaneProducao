export interface RecipeProduct {
  id: string
  name: string
  active: boolean
}

export interface RecipeComponentLink {
  parent_product_id: string
  component_id: string
  component_source: string
}

export interface RecipeUsageIndex {
  products: Map<string, RecipeProduct>
  parentsByComponent: Map<string, string[]>
}

export interface RecipeUsage {
  productId: string
  name: string
  active: boolean
  /** Caminho do insumo consultado até a ficha que o utiliza. */
  path: string[]
}

export interface RecipeUsageResult {
  usages: RecipeUsage[]
  truncated: boolean
}

const MAX_DEPTH = 12
const MAX_USAGES = 200

/** Somente componentes de produto são fichas; pão tem outra origem de dados. */
export function buildRecipeUsageIndex(products: readonly RecipeProduct[], links: readonly RecipeComponentLink[]): RecipeUsageIndex {
  const known = new Map(products.map(product => [product.id, product]))
  const parentsByComponent = new Map<string, string[]>()
  for (const link of links) {
    if (link.component_source !== 'product' || !known.has(link.parent_product_id)) continue
    const parents = parentsByComponent.get(link.component_id) ?? []
    if (!parents.includes(link.parent_product_id)) parents.push(link.parent_product_id)
    parentsByComponent.set(link.component_id, parents)
  }
  return { products: known, parentsByComponent }
}

/** Cada ficha aparece uma vez, pelo caminho mais curto, sem prender em ciclos. */
export function findCurrentRecipeUsage(index: RecipeUsageIndex, componentId: string): RecipeUsageResult {
  const queue: { id: string; path: string[] }[] = [{ id: componentId, path: [componentId] }]
  const seen = new Set([componentId])
  const usages: RecipeUsage[] = []
  let truncated = false

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]
    const parents = index.parentsByComponent.get(current.id) ?? []
    for (const parentId of parents) {
      if (seen.has(parentId)) continue
      if (current.path.length > MAX_DEPTH || usages.length >= MAX_USAGES) {
        truncated = true
        continue
      }
      seen.add(parentId)
      const path = [...current.path, parentId]
      const product = index.products.get(parentId)
      if (product) usages.push({ productId: parentId, name: product.name, active: product.active, path })
      queue.push({ id: parentId, path })
    }
  }

  usages.sort((left, right) => left.path.length - right.path.length || left.name.localeCompare(right.name, 'pt-BR'))
  return { usages, truncated }
}
