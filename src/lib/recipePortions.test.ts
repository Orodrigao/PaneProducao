import { describe, expect, it } from 'vitest'
import { calculatePortionYield, portionDraftFromYield, portionDraftsEqual } from './recipePortions'

const brioche = 1.048

describe('calculatePortionYield', () => {
  it('rende pela massa crua da porção, não pelo peso assado (Brioche Hamburguer 80 g → 72 g)', () => {
    const result = calculatePortionYield({ basis: 'dough', recipeKg: brioche, draft: { portionG: '80', bakedG: '72' } })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.values.yield_units).toBeCloseTo(13.1, 2)
    expect(result.values.dough_weight_kg).toBe(brioche)
    expect(result.values.finished_weight_kg).toBeCloseTo(0.072 * 13.1, 4)
    expect(result.averageUnitWeightKg).toBeCloseTo(0.072, 6)
    expect(result.bakeLossPct).toBeCloseTo(10, 6)
  })

  it('cada variante divide a mesma receita pela própria porção', () => {
    const units = ['400', '150', '30'].map(portionG => {
      const result = calculatePortionYield({ basis: 'dough', recipeKg: brioche, draft: { portionG, bakedG: '' } })
      return result.status === 'ok' ? result.values.yield_units : null
    })
    expect(units[0]).toBeCloseTo(2.62, 2)
    expect(units[1]).toBeCloseTo(6.987, 2)
    expect(units[2]).toBeCloseTo(34.93, 2)
  })

  it('sem peso assado grava assado = massa, como a ficha sempre gravou', () => {
    const result = calculatePortionYield({ basis: 'dough', recipeKg: 2.37, draft: { portionG: '95', bakedG: '' } })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.values.finished_weight_kg).toBe(2.37)
    expect(result.averageUnitWeightKg).toBeCloseTo(0.095, 6)
    expect(result.bakeLossPct).toBeNull()
  })

  it('aceita vírgula decimal', () => {
    const result = calculatePortionYield({ basis: 'dough', recipeKg: 1, draft: { portionG: '62,5', bakedG: '' } })
    expect(result.status === 'ok' && result.values.yield_units).toBeCloseTo(16, 6)
  })

  it('recusa peso assado maior que a massa crua', () => {
    const result = calculatePortionYield({ basis: 'dough', recipeKg: 1.3, draft: { portionG: '330', bakedG: '436' } })
    expect(result).toEqual({ status: 'invalid', message: expect.stringContaining('pão não ganha peso') })
  })

  it('recusa valores inválidos e peso assado sem massa', () => {
    expect(calculatePortionYield({ basis: 'dough', recipeKg: 1, draft: { portionG: '0', bakedG: '' } }).status).toBe('invalid')
    expect(calculatePortionYield({ basis: 'dough', recipeKg: 1, draft: { portionG: 'abc', bakedG: '' } }).status).toBe('invalid')
    expect(calculatePortionYield({ basis: 'dough', recipeKg: 1, draft: { portionG: '80', bakedG: '-1' } }).status).toBe('invalid')
    expect(calculatePortionYield({ basis: 'dough', recipeKg: 1, draft: { portionG: '', bakedG: '70' } }).status).toBe('invalid')
    expect(calculatePortionYield({ basis: 'dough', recipeKg: null, draft: { portionG: '80', bakedG: '' } }).status).toBe('invalid')
  })

  it('linha vazia não é erro', () => {
    expect(calculatePortionYield({ basis: 'dough', recipeKg: 1, draft: { portionG: '', bakedG: '' } })).toEqual({ status: 'empty' })
  })

  it('base produto assado: porção é o peso pronto e não há perda', () => {
    const result = calculatePortionYield({ basis: 'baked', recipeKg: 0.96, draft: { portionG: '80', bakedG: '70' } })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.values).toEqual({ dough_weight_kg: null, finished_weight_kg: 0.96, yield_units: 12 })
    expect(result.bakeLossPct).toBeNull()
  })

  it('base unidade pronta: a receita inteira é uma unidade', () => {
    const result = calculatePortionYield({ basis: 'unit', recipeKg: 0.29, draft: { portionG: '', bakedG: '' } })
    expect(result.status === 'ok' && result.values).toEqual({ dough_weight_kg: 0.29, finished_weight_kg: 0.29, yield_units: 1 })
  })
})

describe('portionDraftFromYield', () => {
  it('ficha antiga (assado = massa) mostra o peso médio como massa por unidade e assado vazio', () => {
    expect(portionDraftFromYield({
      basis: 'dough', dough_weight_kg: '2.37', finished_weight_kg: '2.37', yield_units: '24.947368421052627', average_unit_weight_kg: '0.095',
    })).toEqual({ portionG: '95', bakedG: '' })
  })

  it('ficha com perda de forno de verdade separa massa e assado (Baguete 1 kg → 0,8 kg em 3,33 un)', () => {
    expect(portionDraftFromYield({
      basis: 'dough', dough_weight_kg: 1, finished_weight_kg: 0.8, yield_units: 3.33, average_unit_weight_kg: 0.24024,
    })).toEqual({ portionG: '300,3', bakedG: '240,2' })
  })

  it('ficha base assado sem massa usa o peso médio', () => {
    expect(portionDraftFromYield({
      basis: 'baked', dough_weight_kg: null, finished_weight_kg: 0.96, yield_units: 12, average_unit_weight_kg: 0.08,
    })).toEqual({ portionG: '80', bakedG: '' })
  })

  it('sem ficha devolve campos vazios', () => {
    expect(portionDraftFromYield(null)).toEqual({ portionG: '', bakedG: '' })
  })

  it('reabrir uma ficha salva devolve o que foi digitado', () => {
    const saved = calculatePortionYield({ basis: 'dough', recipeKg: brioche, draft: { portionG: '80', bakedG: '72' } })
    if (saved.status !== 'ok') throw new Error('esperava ok')
    const reopened = portionDraftFromYield({ basis: 'dough', ...saved.values, average_unit_weight_kg: saved.averageUnitWeightKg })
    expect(portionDraftsEqual(reopened, { portionG: '80', bakedG: '72' })).toBe(true)
  })
})
