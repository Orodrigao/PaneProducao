import { describe, expect, it } from 'vitest'
import {
  calculatePortionYield,
  portionDraftFromYield,
  portionDraftsEqual,
  portionYieldDiffersFromStored,
  type StoredRecipeYield,
} from './recipePortions'

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

  it('recusa peso digitado em kg ou com ponto de milhar no campo de gramas', () => {
    expect(calculatePortionYield({ basis: 'dough', recipeKg: 1.048, draft: { portionG: '0,08', bakedG: '' } }))
      .toEqual({ status: 'invalid', message: expect.stringContaining('em gramas') })
    expect(calculatePortionYield({ basis: 'dough', recipeKg: 1.048, draft: { portionG: '1.200', bakedG: '' } }).status).toBe('invalid')
    expect(calculatePortionYield({ basis: 'dough', recipeKg: 2.37, draft: { portionG: '14', bakedG: '' } }).status).toBe('ok')
  })

  it('recusa peso assado digitado em kg no campo de gramas', () => {
    expect(calculatePortionYield({ basis: 'dough', recipeKg: brioche, draft: { portionG: '80', bakedG: '0,072' } }))
      .toEqual({ status: 'invalid', message: expect.stringContaining('Peso assado é em gramas') })
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
    })).toEqual({ portionG: '300,3', bakedG: '240,24' })
  })

  it('ficha base assado sem massa usa o peso médio', () => {
    expect(portionDraftFromYield({
      basis: 'baked', dough_weight_kg: null, finished_weight_kg: 0.96, yield_units: 12, average_unit_weight_kg: 0.08,
    })).toEqual({ portionG: '80', bakedG: '' })
  })

  it('perda pequena em receita pequena não some ao reabrir (60 g, porção 30 g, assado 29,9 g)', () => {
    expect(portionDraftFromYield({
      basis: 'dough', dough_weight_kg: 0.06, finished_weight_kg: 0.0598, yield_units: 2, average_unit_weight_kg: 0.0299,
    })).toEqual({ portionG: '30', bakedG: '29,9' })
  })

  it('porção com centésimo de grama reabre igual (62,55 g)', () => {
    const saved = calculatePortionYield({ basis: 'dough', recipeKg: 2.37, draft: { portionG: '62,55', bakedG: '' } })
    if (saved.status !== 'ok') throw new Error('esperava ok')
    expect(portionDraftFromYield({ basis: 'dough', ...saved.values, average_unit_weight_kg: saved.averageUnitWeightKg }))
      .toEqual({ portionG: '62,55', bakedG: '' })
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

describe('portionYieldDiffersFromStored', () => {
  function reopenAndRecalculate(stored: StoredRecipeYield, recipeKg: number) {
    const result = calculatePortionYield({ basis: 'dough', recipeKg, draft: portionDraftFromYield(stored) })
    if (result.status !== 'ok') throw new Error('esperava ok')
    return portionYieldDiffersFromStored(stored, 'dough', result.values)
  }

  it('ficha antiga com a mesma receita não fica pendente (arredondamento da porção)', () => {
    expect(reopenAndRecalculate({
      basis: 'dough', dough_weight_kg: '1.048', finished_weight_kg: '1.048', yield_units: '6.986666666666667', average_unit_weight_kg: '0.15',
    }, 1.048)).toBe(false)
    expect(reopenAndRecalculate({
      basis: 'dough', dough_weight_kg: '2.441', finished_weight_kg: '2.441', yield_units: '27.122222', average_unit_weight_kg: '0.09',
    }, 2.441)).toBe(false)
  })

  it('salvar, reabrir e recalcular não deixa a linha pendente', () => {
    const cases: Array<{ recipeKg: number; portionG: string; bakedG: string }> = [
      { recipeKg: 0.06, portionG: '30', bakedG: '29,96' },
      { recipeKg: 2.37, portionG: '33,337', bakedG: '' },
      { recipeKg: 1.048, portionG: '5,004', bakedG: '' },
      { recipeKg: 1.3, portionG: '87,456', bakedG: '79,123' },
    ]
    for (const draft of cases) {
      const saved = calculatePortionYield({ basis: 'dough', recipeKg: draft.recipeKg, draft })
      if (saved.status !== 'ok') throw new Error(`esperava ok: ${draft.portionG}`)
      const stored: StoredRecipeYield = { basis: 'dough', ...saved.values, average_unit_weight_kg: saved.averageUnitWeightKg }
      expect(reopenAndRecalculate(stored, draft.recipeKg), draft.portionG).toBe(false)
    }
  })

  it('receita que mudou depois de gravar fica pendente', () => {
    expect(reopenAndRecalculate({
      basis: 'dough', dough_weight_kg: 2.37, finished_weight_kg: 2.37, yield_units: 24.947368421052627, average_unit_weight_kg: 0.095,
    }, 2.07)).toBe(true)
  })

  it('ficha gravada em produto assado fica pendente ao virar massa crua (Brioche Hamburguer 12 → 13,1 un)', () => {
    expect(reopenAndRecalculate({
      basis: 'baked', dough_weight_kg: null, finished_weight_kg: 0.96, yield_units: 12, average_unit_weight_kg: 0.08,
    }, brioche)).toBe(true)
  })
})
