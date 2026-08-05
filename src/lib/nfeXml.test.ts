import { describe, expect, it } from 'vitest'
import {
  calculateNetLineTotal,
  calculateNormalizedUnitCost,
  calculateUsableQuantity,
  conversionFactorFromUsableQuantity,
  formatConversionExplanation,
  isClassificationComplete,
  type NfeItemDraft,
} from '@/lib/nfeXml'

function item(overrides: Partial<NfeItemDraft> = {}): NfeItemDraft {
  return {
    lineNumber: 1,
    supplierCode: '1044',
    ean: null,
    description: 'SACO PAPEL RJ KRAFT 35GR 2KG',
    ncm: '48194000',
    quantity: 2,
    purchaseUnit: 'PACOTE',
    taxQuantity: 2,
    taxUnit: 'PACOTE',
    unitPrice: 54.03,
    grossLineTotal: 108.06,
    discountValue: 0,
    lineTotal: 108.06,
    baseProductId: null,
    baseProductName: null,
    baseUnit: null,
    category: null,
    conversionBasis: 'package',
    conversionFactor: null,
    usableQuantity: null,
    mappingStatus: 'pendente',
    rememberConversion: true,
    ...overrides,
  }
}

describe('conversão de itens importados da NF-e', () => {
  it('desconta o valor informado no item antes de fechar o total da NF', () => {
    expect(calculateNetLineTotal(1967.70, 39.10)).toBe(1928.60)
  })

  it('calcula 1.000 sacos quando são 2 pacotes de 500 unidades', () => {
    expect(calculateUsableQuantity(2, 500)).toBe(1000)
    expect(conversionFactorFromUsableQuantity(2, 1000)).toBe(500)
    expect(calculateNormalizedUnitCost(108.06, 1000)).toBe(0.10806)
  })

  it('calcula custo por kg aproveitável de azeitona drenada', () => {
    expect(calculateUsableQuantity(3, 0.6)).toBe(1.8)
    expect(calculateNormalizedUnitCost(60, 1.8)).toBe(33.333333)
  })

  it('explica o cálculo sem exigir que o usuário faça a conta', () => {
    expect(formatConversionExplanation(item({
      quantity: 2,
      purchaseUnit: 'PACOTE',
      conversionFactor: 500,
      usableQuantity: 1000,
      baseProductName: 'Saco de papel 2 kg',
      baseUnit: 'un',
      mappingStatus: 'mapeado',
    }))).toEqual({
      input: '2 PACOTE',
      operation: '2 × 500 = 1.000',
      output: '1.000 un de Saco de papel 2 kg',
      cost: 'R$ 0,1081 por un',
    })
  })

  it('não considera a NF classificada enquanto houver linha pendente', () => {
    expect(isClassificationComplete([item({ mappingStatus: 'mapeado', baseProductId: 'product-1', usableQuantity: 100 })])).toBe(true)
    expect(isClassificationComplete([item(), item({ lineNumber: 2, mappingStatus: 'mapeado', baseProductId: 'product-2', usableQuantity: 1 })])).toBe(false)
  })
})
