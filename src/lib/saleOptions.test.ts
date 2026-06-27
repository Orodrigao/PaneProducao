import { describe, expect, it } from 'vitest'
import {
  classifyGrossMargin,
  cmvForSaleOption,
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

  it('converte CMV quando a forma de venda muda entre unidade e quilo', () => {
    expect(cmvForSaleOption(40, 'kg', { sale_unit: 'un', unit_weight_kg: 0.25 })).toBe(10)
    expect(cmvForSaleOption(10, 'un', { sale_unit: 'kg', unit_weight_kg: 0.25 })).toBe(40)
    expect(cmvForSaleOption(10, 'un', { sale_unit: 'un' })).toBe(10)
  })

  it('classifica margem bruta por preço e custo unitário', () => {
    expect(classifyGrossMargin(0, 1).status).toBe('preco_zerado')
    expect(classifyGrossMargin(10, null).status).toBe('sem_custo')
    expect(classifyGrossMargin(10, 10).status).toBe('prejuizo')
    expect(classifyGrossMargin(10, 6).status).toBe('ruim')
    expect(classifyGrossMargin(10, 4).status).toBe('media')
    expect(classifyGrossMargin(10, 3).status).toBe('boa')
  })
})
