import { describe, expect, it } from 'vitest'
import { buildProductCmvAudits } from './cmvAudit'

const baseProduct = {
  id: 'baguete',
  name: 'Baguete',
  category: 'Pães',
  unit: 'un',
  cost_price: 0.8,
  active: true,
  kind: 'final',
  is_revenda: false,
  is_fabricacao_propria: true,
  legacy_bread_id: null,
}

describe('buildProductCmvAudits', () => {
  it('calcula CMV por unidade e classifica margem da tabela', () => {
    const [audit] = buildProductCmvAudits({
      products: [baseProduct],
      productCatalog: [
        { id: 'farinha', name: 'Farinha de Trigo', category: 'INSUMOS', unit: 'kg', cost_price: 4 },
      ],
      breadCatalog: [],
      components: [
        { parent_product_id: 'baguete', component_source: 'product', component_id: 'farinha', quantity: 1 },
      ],
      yields: [
        {
          product_id: 'baguete',
          basis: 'dough',
          dough_weight_kg: 1,
          finished_weight_kg: 1,
          yield_units: 4,
          average_unit_weight_kg: 0.25,
        },
      ],
      priceTiers: [{ id: 'tier-a', name: 'Atacado A', active: true }],
      priceLines: [
        {
          tier_id: 'tier-a',
          product_source: 'product',
          product_id: 'baguete',
          product_name: 'Baguete',
          unit_price: 4,
          pricing_unit: 'un',
          active: true,
        },
      ],
    })

    expect(audit?.cmvTotal).toBe(4)
    expect(audit?.cmvUnit).toBe(1)
    expect(audit?.cmvKgBaked).toBe(4)
    expect(audit?.status).toBe('boa')
    expect(audit?.worstPrice?.marginPct).toBe(75)
  })

  it('marca ficha incompleta quando algum componente não tem custo', () => {
    const [audit] = buildProductCmvAudits({
      products: [baseProduct],
      productCatalog: [
        { id: 'insumo-sem-custo', name: 'Insumo sem custo', category: 'INSUMOS', unit: 'kg', cost_price: null },
      ],
      breadCatalog: [],
      components: [
        { parent_product_id: 'baguete', component_source: 'product', component_id: 'insumo-sem-custo', quantity: 1 },
      ],
      yields: [],
      priceTiers: [],
      priceLines: [],
    })

    expect(audit?.missingCostCount).toBe(1)
    expect(audit?.status).toBe('sem_custo')
  })

  it('ignora revenda, insumo e produto inativo', () => {
    const audits = buildProductCmvAudits({
      products: [
        { ...baseProduct, id: 'revenda', name: 'Revenda', is_revenda: true },
        { ...baseProduct, id: 'insumo', name: 'Insumo', kind: 'insumo' },
        { ...baseProduct, id: 'inativo', name: 'Inativo', active: false },
      ],
      productCatalog: [],
      breadCatalog: [],
      components: [],
      yields: [],
      priceTiers: [],
      priceLines: [],
    })

    expect(audits).toHaveLength(0)
  })
})
