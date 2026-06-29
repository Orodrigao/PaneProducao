import { describe, expect, it } from 'vitest'
import {
  calculateSuggestedPrice,
  classifyGrossMargin,
  cmvForSaleOption,
  formatSaleOptionLabel,
  inferPricingUnit,
  parseNonNegativeDecimalInput,
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
    expect(parseNonNegativeDecimalInput('0')).toBe(0)
    expect(parseNonNegativeDecimalInput('2,50')).toBe(2.5)
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

  it('calcula preço sugerido com perdas, impostos e margem sobre venda', () => {
    const result = calculateSuggestedPrice({
      cmv: 10,
      packagingCost: 1,
      laborCost: 2,
      lossPct: 10,
      taxPct: 8,
      desiredMarginPct: 52,
    })

    expect(result.valid).toBe(true)
    expect(result.directCost).toBe(13)
    expect(result.adjustedCost).toBeCloseTo(14.4444, 4)
    expect(result.suggestedPrice).toBeCloseTo(36.1111, 4)
    expect(result.taxAmount).toBeCloseTo(2.8889, 4)
    expect(result.targetMarginAmount).toBeCloseTo(18.7778, 4)
  })

  it('recusa formação de preço quando a soma de percentuais inviabiliza o preço', () => {
    const result = calculateSuggestedPrice({
      cmv: 10,
      taxPct: 20,
      desiredMarginPct: 80,
    })

    expect(result.valid).toBe(false)
    expect(result.reason).toBe('Impostos + margem precisam ficar abaixo de 100%')
  })
})
