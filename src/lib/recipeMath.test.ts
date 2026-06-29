import { describe, expect, it } from 'vitest'
import {
  calculateRecipeTotals,
  isPackagingComponent,
  packagingCostForPriceBase,
  quantityFromBakersPercentage,
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
})
