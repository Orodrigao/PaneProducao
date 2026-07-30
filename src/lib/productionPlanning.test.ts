import { describe, expect, it } from 'vitest'
import {
  aggregateFrozenBreadAvailability,
  aggregatePlanningLeftoverAvailability,
  buildLeftoverProposalDraftsFromPlan,
  buildProductionOrderDraftsFromPlan,
  calculateNewProductionQuantity,
  calculatePlannedTotalQuantity,
  frozenLocationPlanningStore,
  matchesPlanningBreadSearch,
  normalizePlannedQuantity,
  normalizePlanningStores,
  plannedBreadsForDate,
  planningAvailabilityKey,
  productionPlanItemOrderQuantity,
  planHasOrderConversion,
  planIsFullyConvertedToOrders,
  summarizePlanItemsByStore,
  subtractPlanningReuseProposals,
  storeNeedsOrderConversion,
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

  it('mantem a demanda total separada das fontes de atendimento', () => {
    expect(calculatePlannedTotalQuantity({
      newQuantity: 20,
      frozenQuantity: 5,
      leftoverConfirmedQuantity: 3,
    })).toBe(20)
  })

  it('calcula somente a producao nova depois de descontar congelado e sobra', () => {
    expect(calculateNewProductionQuantity({
      newQuantity: 10,
      frozenQuantity: 8,
    })).toBe(2)
  })

  it('usa a sobra proposta enquanto Geolar ainda nao confirmou', () => {
    expect(calculateNewProductionQuantity({
      newQuantity: 20,
      frozenQuantity: 5,
      leftoverProposedQuantity: 4,
      leftoverConfirmedQuantity: null,
    })).toBe(11)
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

  it('remove sobras ja propostas de outras telas da disponibilidade do planejamento', () => {
    const available = subtractPlanningReuseProposals(
      new Map([
        ['jc:baguete', 5],
        ['ja:baguete', 4],
      ]),
      [
        { store: 'jc', bread_id: 'baguete', proposed_quantity: 3, status: 'proposed' },
        { store: 'ja', bread_id: 'baguete', proposed_quantity: 2, status: 'confirmed' },
      ],
    )

    expect(Object.fromEntries(available)).toEqual({
      'jc:baguete': 2,
      'ja:baguete': 4,
    })
  })

  it('transforma um item planejado em quantidade nova de pedido', () => {
    expect(productionPlanItemOrderQuantity({
      store: 'jc',
      bread_id: 'baguete',
      planned_quantity: 5,
      frozen_quantity: 3,
      leftover_proposed_quantity: 2,
      leftover_confirmed_quantity: null,
    })).toBe(0)
  })

  it('gera linhas de pedido somente para a loja escolhida e com total positivo', () => {
    const rows = buildProductionOrderDraftsFromPlan([
      { store: 'jc', bread_id: 'baguete', planned_quantity: 5, frozen_quantity: 2, leftover_proposed_quantity: 1 },
      { store: 'jc', bread_id: 'ciabatta', planned_quantity: 0, frozen_quantity: 0, leftover_proposed_quantity: 0 },
      { store: 'ja', bread_id: 'baguete', planned_quantity: 9, frozen_quantity: 0, leftover_proposed_quantity: 0 },
    ], 'jc', '2026-07-28')

    expect(rows).toEqual([{
      store: 'jc',
      bread_id: 'baguete',
      quantity: 2,
      order_date: '2026-07-28',
      order_type: 'producao',
      obs: 'Gerado pelo Planejamento',
    }])
  })

  it('leva as propostas de sobra do planejamento para a rotina de sobras da producao', () => {
    expect(buildLeftoverProposalDraftsFromPlan([
      { store: 'jc', bread_id: 'baguete', planned_quantity: 5, leftover_proposed_quantity: 2 },
      { store: 'jc', bread_id: 'ciabatta', planned_quantity: 5, leftover_proposed_quantity: 0 },
      { store: 'ja', bread_id: 'baguete', planned_quantity: 5, leftover_proposed_quantity: 4 },
    ], 'jc')).toEqual([
      { bread_id: 'baguete', quantity: 2 },
      { bread_id: 'ciabatta', quantity: 0 },
    ])
  })

  it('resume o planejamento por loja para mostrar a acao na producao', () => {
    expect(summarizePlanItemsByStore([
      { store: 'jc', bread_id: 'baguete', planned_quantity: 5, frozen_quantity: 2, leftover_proposed_quantity: 1 },
      { store: 'ja', bread_id: 'baguete', planned_quantity: 3, frozen_quantity: 0, leftover_proposed_quantity: 0 },
    ])).toEqual({ jc: 2, ja: 3 })
  })

  it('nao pede nova conversao quando a loja ja virou pedido', () => {
    const items = [
      { store: 'jc', bread_id: 'baguete', planned_quantity: 5, frozen_quantity: 2, leftover_proposed_quantity: 1, order_created_at: '2026-07-28T01:00:00Z' },
      { store: 'ja', bread_id: 'baguete', planned_quantity: 3, frozen_quantity: 0, leftover_proposed_quantity: 0, order_created_at: null },
    ]

    expect(storeNeedsOrderConversion(items, 'jc')).toBe(false)
    expect(storeNeedsOrderConversion(items, 'ja')).toBe(true)
  })

  it('identifica planejamento que ja virou pedido por completo sem bloquear rascunho zerado', () => {
    const emptyDraft = [
      { store: 'jc', bread_id: 'baguete', planned_quantity: 0, frozen_quantity: 0, leftover_proposed_quantity: 0, order_created_at: null },
      { store: 'ja', bread_id: 'baguete', planned_quantity: 0, frozen_quantity: 0, leftover_proposed_quantity: 0, order_created_at: null },
    ]
    const fullyConverted = [
      { store: 'jc', bread_id: 'baguete', planned_quantity: 5, frozen_quantity: 0, leftover_proposed_quantity: 0, order_created_at: '2026-07-28T01:00:00Z' },
      { store: 'ja', bread_id: 'baguete', planned_quantity: 0, frozen_quantity: 0, leftover_proposed_quantity: 0, order_created_at: null },
    ]

    expect(planHasOrderConversion(emptyDraft)).toBe(false)
    expect(planIsFullyConvertedToOrders(emptyDraft)).toBe(false)
    expect(planHasOrderConversion(fullyConverted)).toBe(true)
    expect(planIsFullyConvertedToOrders(fullyConverted)).toBe(true)
  })
})
