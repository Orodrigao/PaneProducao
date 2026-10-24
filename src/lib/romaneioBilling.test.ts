import { describe, expect, it } from 'vitest'
import {
  billingUnitForRomaneioProduct,
  explicitUnitInRomaneioProduct,
  isBuckPriceTierName,
} from './romaneioBilling'

describe('romaneioBilling', () => {
  it('aplica kg para produtos vendidos por peso no romaneio', () => {
    expect(billingUnitForRomaneioProduct('Ciabatta (kg)')).toBe('kg')
    expect(billingUnitForRomaneioProduct('Mini Croissant')).toBe('kg')
    expect(billingUnitForRomaneioProduct('Pizza Romana de Calabresa')).toBe('kg')
    expect(billingUnitForRomaneioProduct('Baguete')).toBe('un')
    expect(billingUnitForRomaneioProduct('Pão Italiano')).toBe('un')
  })

  it('identifica somente a tabela BUCK para a cobrança da EX', () => {
    expect(isBuckPriceTierName('BUCK')).toBe(true)
    expect(isBuckPriceTierName(' buck ')).toBe(true)
    expect(isBuckPriceTierName('Buck - Exposição')).toBe(false)
    expect(isBuckPriceTierName('Atacado BUCK')).toBe(false)
  })

  it('identifica a unidade explícita exibida no romaneio', () => {
    expect(explicitUnitInRomaneioProduct('Ciabatta (kg)')).toBe('kg')
    expect(explicitUnitInRomaneioProduct('Ciabatta (un)')).toBe('un')
    expect(explicitUnitInRomaneioProduct('Baguete')).toBeNull()
  })
})
