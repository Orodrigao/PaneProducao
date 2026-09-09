import { describe, expect, it } from 'vitest'
import {
  normalizeOperationalClassification,
  requiresCompleteOperationalClassification,
} from './productOperationalClassification'

describe('normalizeOperationalClassification', () => {
  it('preserva produto antigo de fabricação própria como não revisado', () => {
    expect(normalizeOperationalClassification({ is_fabricacao_propria: true })).toEqual({
      ok: true,
      value: {
        production_process: null,
        allows_planned_production: null,
        allows_unplanned_production: null,
      },
    })
  })

  it('exige classificação completa de novo produto fabricado', () => {
    expect(normalizeOperationalClassification(
      { is_fabricacao_propria: true },
      { requireComplete: true },
    )).toEqual({
      ok: false,
      error: 'Informe como esse produto é produzido: forno, montagem ou preparo.',
    })
  })

  it('limpa a classificação quando deixa de ser fabricação própria', () => {
    expect(normalizeOperationalClassification({
      is_fabricacao_propria: false,
      production_area: 'cozinha',
      production_process: 'preparo',
      allows_planned_production: true,
      allows_unplanned_production: true,
    })).toEqual({
      ok: true,
      value: {
        production_process: null,
        allows_planned_production: null,
        allows_unplanned_production: null,
      },
    })
  })

  it('exige área para produto revisado', () => {
    expect(normalizeOperationalClassification({
      is_fabricacao_propria: true,
      production_process: 'montagem',
      allows_planned_production: true,
      allows_unplanned_production: false,
    })).toEqual({ ok: false, error: 'Informe a área responsável pela produção.' })
  })

  it('exige ao menos uma forma de produção', () => {
    expect(normalizeOperationalClassification({
      is_fabricacao_propria: true,
      production_area: 'cozinha',
      production_process: 'preparo',
      allows_planned_production: false,
      allows_unplanned_production: false,
    })).toEqual({ ok: false, error: 'Escolha ao menos uma forma de produção: planejada ou sem ordem.' })
  })

  it('aceita planejamento e lançamento sem ordem ao mesmo tempo', () => {
    expect(normalizeOperationalClassification({
      is_fabricacao_propria: true,
      production_area: 'cozinha',
      production_process: 'preparo',
      allows_planned_production: true,
      allows_unplanned_production: true,
    })).toEqual({
      ok: true,
      value: {
        production_process: 'preparo',
        allows_planned_production: true,
        allows_unplanned_production: true,
      },
    })
  })

  it.each([
    { allows_planned_production: undefined, allows_unplanned_production: true },
    { allows_planned_production: null, allows_unplanned_production: true },
    { allows_planned_production: true, allows_unplanned_production: undefined },
    { allows_planned_production: true, allows_unplanned_production: null },
  ])('recusa forma de produção indefinida: $allows_planned_production / $allows_unplanned_production', modes => {
    expect(normalizeOperationalClassification({
      is_fabricacao_propria: true,
      production_area: 'cozinha',
      production_process: 'preparo',
      ...modes,
    })).toEqual({ ok: false, error: 'Informe como a produção pode ser lançada.' })
  })

  it('aceita produto novo com classificação completa', () => {
    expect(normalizeOperationalClassification({
      is_fabricacao_propria: true,
      production_area: 'padaria',
      production_process: 'forno',
      allows_planned_production: true,
      allows_unplanned_production: false,
    }, { requireComplete: true })).toMatchObject({ ok: true })
  })

  it('não exige classificação de produto que não é fabricação própria', () => {
    expect(normalizeOperationalClassification(
      { is_fabricacao_propria: false },
      { requireComplete: true },
    )).toMatchObject({ ok: true })
  })
})

describe('requiresCompleteOperationalClassification', () => {
  it('exige de produto novo de fabricação própria', () => {
    expect(requiresCompleteOperationalClassification(true, false, true)).toBe(true)
  })

  it('exige quando produto existente passa a ser fabricação própria', () => {
    expect(requiresCompleteOperationalClassification(false, false, true)).toBe(true)
  })

  it('preserva a revisão gradual de produto próprio legado', () => {
    expect(requiresCompleteOperationalClassification(false, true, true)).toBe(false)
  })

  it('não exige de produto que não é fabricação própria', () => {
    expect(requiresCompleteOperationalClassification(false, true, false)).toBe(false)
  })
})
