import { describe, expect, it } from 'vitest'
import {
  buildInventoryReadiness,
  canonicalInventoryUnit,
  summarizeInventoryReadiness,
  type InventoryProductRow,
} from './inventoryReadiness'

const baseProduct: InventoryProductRow = {
  id: 'farinha',
  name: 'Farinha de trigo',
  category: 'INSUMOS',
  unit: 'KG',
  cost_price: 4.5,
  active: true,
  kind: 'insumo',
}

describe('prontidão para a contagem de estoque', () => {
  it('normaliza as grafias usuais sem aceitar números como unidade', () => {
    expect(canonicalInventoryUnit('KG')).toBe('kg')
    expect(canonicalInventoryUnit(' Litros ')).toBe('l')
    expect(canonicalInventoryUnit('Peça')).toBe('un')
    expect(canonicalInventoryUnit('12')).toBeNull()
    expect(canonicalInventoryUnit('kg2')).toBeNull()
    expect(canonicalInventoryUnit('12 kg')).toBeNull()
  })

  it('deixa o insumo pronto para contar mesmo sem compra XML anterior', () => {
    const [item] = buildInventoryReadiness([baseProduct], [])
    expect(item.ready).toBe(true)
    expect(item.warnings).toEqual(['Sem compra XML mapeada ainda'])
  })

  it('não libera o item quando o perfil não pode conferir as conversões', () => {
    const [item] = buildInventoryReadiness([baseProduct], [], {
      conversionCoverageKnown: false,
      costCoverageKnown: false,
    })
    expect(item.ready).toBe(false)
    expect(item.blockingIssues).toContain('Conversões de compra não conferidas neste perfil')
    expect(item.blockingIssues).toContain('Custo não conferido neste perfil')
    expect(item.warnings).toEqual([])
  })

  it('bloqueia unidade ou custo que não permitem valorizar a contagem', () => {
    const items = buildInventoryReadiness([
      { ...baseProduct, id: 'sem-unidade', name: 'Sem unidade', unit: '6' },
      { ...baseProduct, id: 'sem-custo', name: 'Sem custo', cost_price: 0 },
    ], [])
    expect(items.find(item => item.product.id === 'sem-unidade')?.ready).toBe(false)
    expect(items.find(item => item.product.id === 'sem-custo')?.ready).toBe(false)
    expect(summarizeInventoryReadiness(items)).toMatchObject({ invalidUnit: 1, missingCost: 1 })
  })

  it('aceita diferença apenas de grafia entre a unidade do produto e a conversão', () => {
    const [item] = buildInventoryReadiness([baseProduct], [{
      base_product_id: 'farinha',
      purchase_unit: 'KG',
      base_unit: 'kg',
      conversion_factor: 1,
      factor_confirmed: true,
      active: true,
    }])
    expect(item.ready).toBe(true)
    expect(item.conversionCount).toBe(1)
  })

  it('bloqueia fator inválido, unidade-base divergente e embalagem não confirmada', () => {
    const [item] = buildInventoryReadiness([baseProduct], [{
      base_product_id: 'farinha',
      purchase_unit: 'CX',
      base_unit: 'kg',
      conversion_factor: 25,
      factor_confirmed: false,
    }, {
      base_product_id: 'farinha',
      purchase_unit: 'KG',
      base_unit: 'l',
      conversion_factor: 1,
      factor_confirmed: true,
    }, {
      base_product_id: 'farinha',
      purchase_unit: 'KG',
      base_unit: 'kg',
      conversion_factor: 0,
      factor_confirmed: true,
    }])
    expect(item.ready).toBe(false)
    expect(item.blockingIssues).toEqual(expect.arrayContaining([
      'Conversão de CX ainda não foi confirmada',
      'Conversão de KG aponta para outra unidade-base',
      'Conversão de KG sem fator válido',
    ]))
  })

  it('bloqueia unidade de compra não reconhecida mesmo quando o fator foi confirmado', () => {
    const [item] = buildInventoryReadiness([baseProduct], [{
      base_product_id: 'farinha',
      purchase_unit: '12',
      base_unit: 'kg',
      conversion_factor: 12,
      factor_confirmed: true,
    }])
    expect(item.ready).toBe(false)
    expect(item.blockingIssues).toContain('Unidade de compra 12 não reconhecida')
    expect(summarizeInventoryReadiness([item]).conversionIssues).toBe(1)
  })

  it('bloqueia fator diferente de um quando compra e estoque usam a mesma unidade', () => {
    const [item] = buildInventoryReadiness([baseProduct], [{
      base_product_id: 'farinha',
      purchase_unit: 'kg',
      base_unit: 'kg',
      conversion_factor: 1000,
      factor_confirmed: true,
    }])
    expect(item.ready).toBe(false)
    expect(item.blockingIssues).toContain('Conversão de kg com fator incompatível com a mesma unidade')
  })

  it('ignora produtos finais, inativos e kits', () => {
    const items = buildInventoryReadiness([
      baseProduct,
      { ...baseProduct, id: 'final', kind: 'final', category: 'Pães' },
      { ...baseProduct, id: 'kit', kind: 'kit', category: 'Kits' },
      { ...baseProduct, id: 'inativo', active: false },
    ], [])
    expect(items.map(item => item.product.id)).toEqual(['farinha'])
  })

  it('não esconde item legado de categoria de insumo que ainda não tem classificação', () => {
    const [item] = buildInventoryReadiness([{
      ...baseProduct,
      kind: null,
      category: 'INSUMOS',
    }], [])
    expect(item.ready).toBe(false)
    expect(item.blockingIssues).toContain('Classificação de insumo pendente no catálogo')
  })

  it('mostra como pendente todo item legado ainda sem tipo, mesmo fora das categorias conhecidas', () => {
    const [item] = buildInventoryReadiness([{
      ...baseProduct,
      kind: null,
      category: 'Farinhas especiais',
    }], [])
    expect(item.ready).toBe(false)
    expect(item.blockingIssues).toContain('Classificação de insumo pendente no catálogo')
  })
})
