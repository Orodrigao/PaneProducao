import { describe, expect, it } from 'vitest'
import {
  calculateYieldUnitsFromRecipeWeight,
  calculateRecipeTotals,
  isPackagingComponent,
  packagingCostForPriceBase,
  quantityFromBakersPercentage,
  quantityFromBakersPercentageForComponent,
} from './recipeMath'

describe('recipeMath', () => {
  it('separa embalagem do custo e peso da receita', () => {
    const totals = calculateRecipeTotals([
      { name: 'Farinha de Trigo', category: 'INSUMOS', quantity: 1, cost: 4 },
      { name: 'Água', category: 'INSUMOS', quantity: 0.7, cost: 0 },
      { name: 'Embalagem Baguete', category: 'EMBALAGENS', quantity: 10, cost: 0.2 },
    ])

    expect(totals.ingredientCost).toBe(4)
    expect(totals.packagingCost).toBe(2)
    expect(totals.doughWeightKg).toBe(1.7)
    expect(totals.flourBaseKg).toBe(1)
  })

  it('calcula quantidade por porcentagem do padeiro', () => {
    expect(quantityFromBakersPercentage(70, 2)).toBe(1.4)
    expect(quantityFromBakersPercentage(70, null)).toBeNull()
    expect(quantityFromBakersPercentage(0, 2)).toBeNull()
  })

  it('permite cadastrar a primeira farinha por percentual', () => {
    expect(quantityFromBakersPercentageForComponent(100, null, { name: 'Farinha de Trigo', category: 'INSUMOS' })).toBe(1)
    expect(quantityFromBakersPercentageForComponent(20, null, { name: 'Farinha Integral', category: 'INSUMOS' })).toBe(0.2)
    expect(quantityFromBakersPercentageForComponent(70, null, { name: 'Água', category: 'INSUMOS' })).toBeNull()
    expect(quantityFromBakersPercentageForComponent(70, 1, { name: 'Água', category: 'INSUMOS' })).toBe(0.7)
  })

  it('identifica embalagem por categoria ou nome', () => {
    expect(isPackagingComponent({ name: 'Saco kraft', category: 'INSUMOS' })).toBe(true)
    expect(isPackagingComponent({ name: 'Caixa delivery', category: 'INSUMOS' })).toBe(true)
    expect(isPackagingComponent({ name: 'Produto qualquer', category: 'Embalagens' })).toBe(true)
  })

  it('mantem embalagem como custo por unidade e converte para kg quando possivel', () => {
    expect(packagingCostForPriceBase(0.3, 'un', null)).toBe(0.3)
    expect(packagingCostForPriceBase(0.3, 'kg', 0.15)).toBe(2)
    expect(packagingCostForPriceBase(0.3, 'kg', null)).toBeNull()
    expect(packagingCostForPriceBase(0, 'kg', null)).toBe(0)
  })

  it('calcula rendimento dividindo peso da receita pelo peso da unidade assada', () => {
    expect(calculateYieldUnitsFromRecipeWeight(1, 0.24)).toBeCloseTo(4.1667, 4)
    expect(calculateYieldUnitsFromRecipeWeight(1.7, 0.085)).toBeCloseTo(20, 4)
    expect(calculateYieldUnitsFromRecipeWeight(null, 0.085)).toBeNull()
    expect(calculateYieldUnitsFromRecipeWeight(1.7, 0)).toBeNull()
  })
})
