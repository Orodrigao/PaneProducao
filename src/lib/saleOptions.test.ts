import { describe, expect, it } from 'vitest'
import {
  formatSaleOptionLabel,
  inferPricingUnit,
  parsePositiveDecimalInput,
  saleOptionKey,
} from './saleOptions'

describe('saleOptions', () => {
  it('diferencia o mesmo produto por forma de venda', () => {
    expect(saleOptionKey('product', 'baguete', 'unidade')).toBe('product_baguete_unidade')
    expect(saleOptionKey('product', 'baguete', 'quilo')).toBe('product_baguete_quilo')
    expect(saleOptionKey('product', 'baguete')).toBe('product_baguete_legacy')
  })

  it('prioriza a unidade da forma de venda sobre a unidade do produto', () => {
    expect(inferPricingUnit('un', { sale_unit: 'kg' })).toBe('kg')
    expect(inferPricingUnit('kg', { sale_unit: 'un' })).toBe('un')
    expect(inferPricingUnit('kg')).toBe('kg')
    expect(inferPricingUnit('un')).toBe('un')
  })

  it('formata e interpreta valores usados em fichas e venda', () => {
    expect(formatSaleOptionLabel({ name: 'Quilo', sale_unit: 'kg' })).toBe('Quilo (kg)')
    expect(formatSaleOptionLabel({ name: 'Unidade', sale_unit: 'un' })).toBe('Unidade (un)')
    expect(parsePositiveDecimalInput('1,250')).toBe(1.25)
    expect(parsePositiveDecimalInput('0')).toBeNull()
  })
})
