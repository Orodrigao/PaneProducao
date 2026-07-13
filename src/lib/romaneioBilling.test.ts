import { describe, expect, it } from 'vitest'
import {
  billingUnitForRomaneioProduct,
  calculateRomaneioBilling,
  explicitUnitInRomaneioProduct,
} from './romaneioBilling'

describe('romaneioBilling', () => {
  it('aplica kg somente para ciabatta e mini croissant', () => {
    expect(billingUnitForRomaneioProduct('Ciabatta (kg)')).toBe('kg')
    expect(billingUnitForRomaneioProduct('Mini Croissant')).toBe('kg')
    expect(billingUnitForRomaneioProduct('Baguete')).toBe('un')
    expect(billingUnitForRomaneioProduct('Pão Italiano')).toBe('un')
  })

  it('calcula cobrança pela quantidade aceita, ou enviada sem conferência', () => {
    const result = calculateRomaneioBilling([
      { id: 'i1', romaneioId: 'r1', productId: 'baguete', productSource: 'bread', productName: 'Baguete', qtySent: 10, qtyAccepted: 9 },
      { id: 'i2', romaneioId: 'r1', productId: 'ciabatta', productSource: 'bread', productName: 'Ciabatta (kg)', qtySent: 3.2, qtyAccepted: null },
      { id: 'i3', romaneioId: 'r2', productId: 'mini', productSource: 'bread', productName: 'Mini Croissant (kg)', qtySent: 1.5 },
    ], [
      { productId: 'baguete', productSource: 'bread', unitPrice: 4, pricingUnit: 'un' },
      { productId: 'ciabatta', productSource: 'bread', unitPrice: 20, pricingUnit: 'kg' },
      { productId: 'mini', productSource: 'bread', unitPrice: 30, pricingUnit: 'kg' },
    ])

    expect(result.hasBlockingIssues).toBe(false)
    expect(result.tripCount).toBe(2)
    expect(result.total).toBe(145)
    expect(result.rows.map(row => [row.productName, row.billedQuantity, row.total])).toEqual([
      ['Baguete', 9, 36],
      ['Ciabatta (kg)', 3.2, 64],
      ['Mini Croissant (kg)', 1.5, 45],
    ])
  })

  it('não inclui no total itens sem preço ou com unidade incompatível', () => {
    const result = calculateRomaneioBilling([
      { id: 'i1', romaneioId: 'r1', productId: 'italiano', productSource: 'bread', productName: 'Italiano', qtySent: 5 },
      { id: 'i2', romaneioId: 'r2', productId: 'ciabatta', productSource: 'bread', productName: 'Ciabatta (un)', qtySent: 3 },
    ], [
      { productId: 'ciabatta', productSource: 'bread', unitPrice: 20, pricingUnit: 'kg' },
    ])

    expect(result.total).toBe(0)
    expect(result.hasBlockingIssues).toBe(true)
    expect(result.rows.find(row => row.productName === 'Italiano')?.issues).toEqual(['missing_price'])
    expect(result.rows.find(row => row.productName === 'Ciabatta (un)')?.issues).toEqual(['unit_mismatch'])
  })

  it('bloqueia preço cadastrado em unidade diferente da cobrança', () => {
    const result = calculateRomaneioBilling([
      { id: 'i1', romaneioId: 'r1', productId: 'baguete', productSource: 'bread', productName: 'Baguete', qtySent: 5 },
    ], [
      { productId: 'baguete', productSource: 'bread', unitPrice: 18, pricingUnit: 'kg' },
    ])

    expect(result.rows[0].issues).toEqual(['unit_mismatch'])
    expect(result.total).toBe(0)
  })

  it('identifica a unidade explícita exibida no romaneio', () => {
    expect(explicitUnitInRomaneioProduct('Ciabatta (kg)')).toBe('kg')
    expect(explicitUnitInRomaneioProduct('Ciabatta (un)')).toBe('un')
    expect(explicitUnitInRomaneioProduct('Baguete')).toBeNull()
  })
})
