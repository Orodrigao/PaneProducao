import { describe, expect, it } from 'vitest'
import { buildRecipeUsageIndex, findCurrentRecipeUsage } from '@/lib/recipeUsage'

const products = [
  { id: 'gotas', name: 'CHIPS AO LEITE GOTA PINGO', active: true },
  { id: 'recheio', name: 'Recheio Belga', active: true },
  { id: 'bolo', name: 'Bolo Belga', active: true },
  { id: 'outro', name: 'Outro recheio', active: false },
]

describe('uso atual nas fichas técnicas', () => {
  it('mostra ficha direta e produto que usa essa ficha, com o caminho', () => {
    const index = buildRecipeUsageIndex(products, [
      { parent_product_id: 'recheio', component_id: 'gotas', component_source: 'product' },
      { parent_product_id: 'bolo', component_id: 'recheio', component_source: 'product' },
      { parent_product_id: 'outro', component_id: 'gotas', component_source: 'product' },
    ])
    expect(findCurrentRecipeUsage(index, 'gotas')).toEqual({
      usages: [
        { productId: 'outro', name: 'Outro recheio', active: false, path: ['gotas', 'outro'] },
        { productId: 'recheio', name: 'Recheio Belga', active: true, path: ['gotas', 'recheio'] },
        { productId: 'bolo', name: 'Bolo Belga', active: true, path: ['gotas', 'recheio', 'bolo'] },
      ],
      truncated: false,
    })
  })

  it('ignora componente de pão e termina mesmo quando há ciclo de produtos', () => {
    const index = buildRecipeUsageIndex(products, [
      { parent_product_id: 'recheio', component_id: 'gotas', component_source: 'product' },
      { parent_product_id: 'bolo', component_id: 'recheio', component_source: 'product' },
      { parent_product_id: 'recheio', component_id: 'bolo', component_source: 'product' },
      { parent_product_id: 'outro', component_id: 'gotas', component_source: 'bread' },
    ])
    expect(findCurrentRecipeUsage(index, 'gotas').usages.map(usage => usage.productId)).toEqual(['recheio', 'bolo'])
  })
})
