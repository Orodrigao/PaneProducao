import { describe, expect, it } from 'vitest'
import {
  calculatePlannedTotalQuantity,
  matchesPlanningBreadSearch,
  normalizePlannedQuantity,
  plannedBreadsForDate,
  statusAllowsDraftEditing,
  weekdayIndex,
} from './productionPlanning'

describe('productionPlanning', () => {
  it('filtra os paes previstos pela data sem trazer PJ', () => {
    const breads = [
      { id: 'integral', name: 'Integral', days: [1, 2], active: true, is_pj: false },
      { id: 'pj', name: 'PJ', days: [1], active: true, is_pj: true },
      { id: 'inativo', name: 'Inativo', days: [1], active: false, is_pj: false },
      { id: 'sexta', name: 'Sexta', days: [5], active: true, is_pj: false },
    ]

    expect(weekdayIndex('2026-07-27')).toBe(1)
    expect(plannedBreadsForDate(breads, '2026-07-27').map(bread => bread.id)).toEqual(['integral'])
  })

  it('calcula o total planejado somando novo, congelado e sobra confirmada', () => {
    expect(calculatePlannedTotalQuantity({
      newQuantity: 20,
      frozenQuantity: 5,
      leftoverConfirmedQuantity: 3,
    })).toBe(28)
  })

  it('usa a sobra proposta enquanto Geolar ainda nao confirmou', () => {
    expect(calculatePlannedTotalQuantity({
      newQuantity: 20,
      frozenQuantity: 5,
      leftoverProposedQuantity: 4,
      leftoverConfirmedQuantity: null,
    })).toBe(29)
  })

  it('normaliza quantidade planejada para unidade inteira positiva', () => {
    expect(normalizePlannedQuantity('4.8')).toBe(4)
    expect(normalizePlannedQuantity(-2)).toBe(0)
    expect(normalizePlannedQuantity('abc')).toBe(0)
  })

  it('busca pao avulso ignorando acentos e usando todas as palavras', () => {
    const breadName = 'P\u00e3o Integral Longa Fermenta\u00e7\u00e3o'
    expect(matchesPlanningBreadSearch(breadName, 'integral')).toBe(true)
    expect(matchesPlanningBreadSearch(breadName, 'pao longa')).toBe(true)
    expect(matchesPlanningBreadSearch('Baguete', 'integral')).toBe(false)
  })

  it('so permite edicao livre em rascunho ou reaberto', () => {
    expect(statusAllowsDraftEditing('rascunho')).toBe(true)
    expect(statusAllowsDraftEditing('reaberto')).toBe(true)
    expect(statusAllowsDraftEditing('fechado')).toBe(false)
  })
})
