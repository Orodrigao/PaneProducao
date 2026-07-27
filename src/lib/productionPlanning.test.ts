import { describe, expect, it } from 'vitest'
import {
  aggregateFrozenBreadAvailability,
  aggregatePlanningLeftoverAvailability,
  calculatePlannedTotalQuantity,
  frozenLocationPlanningStore,
  matchesPlanningBreadSearch,
  normalizePlannedQuantity,
  normalizePlanningStores,
  plannedBreadsForDate,
  planningAvailabilityKey,
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

  it('monta a chave de disponibilidade por loja e pao', () => {
    expect(planningAvailabilityKey('jc', 'baguete')).toBe('jc:baguete')
  })

  it('normaliza lojas visiveis do congelado', () => {
    expect(normalizePlanningStores(['jc', 'ex', 'ja', 'JC'])).toEqual(['jc', 'ja'])
    expect(normalizePlanningStores('ja')).toEqual(['ja'])
    expect(normalizePlanningStores(null)).toBeNull()
  })

  it('identifica loja do local de congelado usado no planejamento', () => {
    expect(frozenLocationPlanningStore('jc-freezer')).toBe('jc')
    expect(frozenLocationPlanningStore('camara')).toBe('jc')
    expect(frozenLocationPlanningStore('ja-freezer')).toBe('ja')
    expect(frozenLocationPlanningStore('ex-freezer-1')).toBeNull()
  })

  it('soma congelados disponiveis por pao e loja sem misturar EX', () => {
    const availability = aggregateFrozenBreadAvailability([
      { id: 'fp-1', product_id: 'baguete', product_source: 'bread', visible_stores: ['jc', 'ja'] },
      { id: 'fp-2', product_id: 'ciabatta', product_source: 'bread', visible_stores: ['ja'] },
      { id: 'fp-3', product_id: 'produto', product_source: 'product', visible_stores: ['jc'] },
    ], [
      { frozen_product_id: 'fp-1', location: 'jc-freezer', quantity: 4 },
      { frozen_product_id: 'fp-1', location: 'ja-freezer', quantity: '2' },
      { frozen_product_id: 'fp-1', location: 'ex-freezer-1', quantity: 99 },
      { frozen_product_id: 'fp-2', location: 'jc-freezer', quantity: 8 },
      { frozen_product_id: 'fp-3', location: 'jc-freezer', quantity: 5 },
    ])

    expect(Object.fromEntries(availability)).toEqual({
      'jc:baguete': 4,
      'ja:baguete': 2,
    })
  })

  it('soma sobras inteiras disponiveis por pao e loja', () => {
    const availability = aggregatePlanningLeftoverAvailability([
      { store: 'jc', product_id: 'baguete', pending_quantity: 2.8 },
      { store: 'jc', product_id: 'baguete', pending_quantity: '1' },
      { store: 'ja', product_id: 'baguete', pending_quantity: 3 },
      { store: 'ex', product_id: 'baguete', pending_quantity: 9 },
      { store: 'jc', product_id: null, pending_quantity: 4 },
    ])

    expect(Object.fromEntries(availability)).toEqual({
      'jc:baguete': 3,
      'ja:baguete': 3,
    })
  })
})
