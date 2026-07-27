import { describe, expect, it } from 'vitest'
import {
  calculateNewProductionQuantity,
  matchesPlanningBreadSearch,
  normalizePlannedQuantity,
  plannedBreadsForDate,
  statusAllowsDraftEditing,
  weekdayIndex,
} from './productionPlanning'

describe('productionPlanning', () => {
  it('filtra os pães previstos pela data sem trazer PJ', () => {
    const breads = [
      { id: 'integral', name: 'Integral', days: [1, 2], active: true, is_pj: false },
      { id: 'pj', name: 'PJ', days: [1], active: true, is_pj: true },
      { id: 'inativo', name: 'Inativo', days: [1], active: false, is_pj: false },
      { id: 'sexta', name: 'Sexta', days: [5], active: true, is_pj: false },
    ]

    expect(weekdayIndex('2026-07-27')).toBe(1)
    expect(plannedBreadsForDate(breads, '2026-07-27').map(bread => bread.id)).toEqual(['integral'])
  })

  it('calcula a produção nova descontando congelado e sobra confirmada', () => {
    expect(calculateNewProductionQuantity({
      plannedQuantity: 20,
      frozenQuantity: 5,
      leftoverConfirmedQuantity: 3,
    })).toBe(12)
  })

  it('normaliza quantidade planejada para unidade inteira positiva', () => {
    expect(normalizePlannedQuantity('4.8')).toBe(4)
    expect(normalizePlannedQuantity(-2)).toBe(0)
    expect(normalizePlannedQuantity('abc')).toBe(0)
  })

  it('busca pão avulso ignorando acentos e usando todas as palavras', () => {
    expect(matchesPlanningBreadSearch('Pão Integral Longa Fermentação', 'integral')).toBe(true)
    expect(matchesPlanningBreadSearch('Pão Integral Longa Fermentação', 'pao longa')).toBe(true)
    expect(matchesPlanningBreadSearch('Baguete', 'integral')).toBe(false)
  })

  it('só permite edição livre em rascunho ou reaberto', () => {
    expect(statusAllowsDraftEditing('rascunho')).toBe(true)
    expect(statusAllowsDraftEditing('reaberto')).toBe(true)
    expect(statusAllowsDraftEditing('fechado')).toBe(false)
  })
})
