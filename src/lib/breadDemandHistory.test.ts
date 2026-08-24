import { describe, expect, it } from 'vitest'
import {
  breadDemandCandidateDates,
  summarizeBreadDemandHistory,
  type BreadDemandHistoryInput,
  type BreadDemandLeftoverRow,
  type BreadDemandRomaneioItemRow,
  type BreadDemandRomaneioRow,
} from './breadDemandHistory'

const TARGET_DATE = '2026-08-25'
const TUESDAYS = breadDemandCandidateDates(TARGET_DATE)

function romaneio(date: string, store: 'jc' | 'ja', index: number): BreadDemandRomaneioRow {
  return {
    id: `${store}-${index}`,
    record_date: date,
    destination_id: store,
  }
}

function sent(
  romaneioId: string,
  quantity: number,
  overrides: Partial<BreadDemandRomaneioItemRow> = {},
): BreadDemandRomaneioItemRow {
  return {
    romaneio_id: romaneioId,
    product_id: 'integral',
    product_source: 'bread',
    product_name: 'Integral',
    qty_sent: quantity,
    qty_accepted: null,
    ...overrides,
  }
}

function closing(
  date: string,
  store: 'jc' | 'ja',
  quantity = 0,
  productId = 'integral',
): BreadDemandLeftoverRow {
  return {
    record_date: date,
    store,
    product_id: productId,
    product_source: 'bread',
    quantity,
  }
}

function input(overrides: Partial<BreadDemandHistoryInput> = {}): BreadDemandHistoryInput {
  return {
    targetDate: TARGET_DATE,
    breads: [{ id: 'integral', name: 'Integral', days: [2], unit: 'un' }],
    productLinks: [],
    destinations: [
      { id: 'jc', code: 'jc', name: 'Júlio de Castilhos' },
      { id: 'ja', code: 'JA', name: 'Jardim América' },
    ],
    romaneios: [],
    romaneioItems: [],
    leftovers: [],
    firmOrders: [],
    ...overrides,
  }
}

describe('breadDemandCandidateDates', () => {
  it('gera somente as 12 ocorrências anteriores do mesmo dia da semana', () => {
    expect(TUESDAYS).toHaveLength(12)
    expect(TUESDAYS.slice(0, 3)).toEqual(['2026-08-18', '2026-08-11', '2026-08-04'])
    expect(TUESDAYS.at(-1)).toBe('2026-06-02')
  })
})

describe('summarizeBreadDemandHistory', () => {
  it('descarta dia sem fechamento da loja em vez de tratá-lo como sobra zero', () => {
    const summary = summarizeBreadDemandHistory(input({
      romaneios: [romaneio(TUESDAYS[0], 'jc', 0), romaneio(TUESDAYS[1], 'jc', 1)],
      romaneioItems: [sent('jc-0', 10), sent('jc-1', 20)],
      leftovers: [closing(TUESDAYS[0], 'jc', 2)],
    })).integral.stores.jc

    expect(summary.validDays).toBe(1)
    expect(summary.confidence).toBe('insufficient')
    expect(summary.average).toBeNull()
  })

  it('descarta saída negativa como dia não confiável', () => {
    const dates = TUESDAYS.slice(0, 4)
    const summary = summarizeBreadDemandHistory(input({
      romaneios: dates.map((date, index) => romaneio(date, 'jc', index)),
      romaneioItems: dates.map((_, index) => sent(`jc-${index}`, 5)),
      leftovers: dates.map((date, index) => closing(date, 'jc', index === 0 ? 7 : 1)),
    })).integral.stores.jc

    expect(summary.validDays).toBe(3)
    expect(summary.confidence).toBe('insufficient')
  })

  it('bloqueia números quando encontra lançamentos em unidade e em quilo', () => {
    const dates = TUESDAYS.slice(0, 4)
    const result = summarizeBreadDemandHistory(input({
      romaneios: dates.map((date, index) => romaneio(date, 'jc', index)),
      romaneioItems: dates.map((_, index) => sent(`jc-${index}`, 5, {
        product_name: index === 0 ? 'Integral (kg)' : 'Integral (un)',
      })),
      leftovers: dates.map(date => closing(date, 'jc')),
    })).integral

    expect(result.mixedUnits).toBe(true)
    expect(result.stores.jc.validDays).toBe(4)
    expect(result.stores.jc.average).toBeNull()
    expect(result.totalAverage).toBeNull()
  })

  it('não mostra número com menos de quatro dias válidos', () => {
    const dates = TUESDAYS.slice(0, 3)
    const summary = summarizeBreadDemandHistory(input({
      romaneios: dates.map((date, index) => romaneio(date, 'jc', index)),
      romaneioItems: dates.map((_, index) => sent(`jc-${index}`, 8)),
      leftovers: dates.map(date => closing(date, 'jc', 1)),
    })).integral.stores.jc

    expect(summary).toMatchObject({
      confidence: 'insufficient',
      validDays: 3,
      average: null,
      minimum: null,
      maximum: null,
    })
  })

  it('marca de quatro a sete dias como provisório e calcula média e faixa', () => {
    const dates = TUESDAYS.slice(0, 5)
    const quantities = [5, 7, 9, 11, 13]
    const summary = summarizeBreadDemandHistory(input({
      romaneios: dates.map((date, index) => romaneio(date, 'jc', index)),
      romaneioItems: quantities.map((quantity, index) => sent(`jc-${index}`, quantity)),
      leftovers: dates.map(date => closing(date, 'jc', 1)),
    })).integral.stores.jc

    expect(summary.confidence).toBe('provisional')
    expect(summary.validDays).toBe(5)
    expect(summary.average).toBe(8)
    expect(summary.minimum).toBe(4)
    expect(summary.maximum).toBe(12)
  })

  it('conta dias com envio positivo e nenhuma sobra registrada para o pão', () => {
    const dates = TUESDAYS.slice(0, 4)
    const summary = summarizeBreadDemandHistory(input({
      romaneios: dates.map((date, index) => romaneio(date, 'jc', index)),
      romaneioItems: dates.map((_, index) => sent(`jc-${index}`, 8)),
      leftovers: [
        closing(dates[0], 'jc', 0),
        closing(dates[1], 'jc', 2),
        closing(dates[2], 'jc', 0, 'italiano'),
        closing(dates[3], 'jc', 1),
      ],
    })).integral.stores.jc

    expect(summary.noLeftoverDays).toBe(2)
  })

  it('usa quantidade aceita quando existe e soma várias viagens do mesmo dia', () => {
    const dates = TUESDAYS.slice(0, 4)
    const extraTrip: BreadDemandRomaneioRow = {
      id: 'jc-extra',
      record_date: dates[0],
      destination_id: 'jc',
    }
    const summary = summarizeBreadDemandHistory(input({
      romaneios: [...dates.map((date, index) => romaneio(date, 'jc', index)), extraTrip],
      romaneioItems: [
        sent('jc-0', 10, { qty_accepted: 7 }),
        sent('jc-extra', 2),
        ...dates.slice(1).map((_, index) => sent(`jc-${index + 1}`, 9)),
      ],
      leftovers: dates.map(date => closing(date, 'jc')),
    })).integral.stores.jc

    expect(summary.average).toBe(9)
    expect(summary.minimum).toBe(9)
    expect(summary.maximum).toBe(9)
  })

  it('limita a amostra às oito ocorrências válidas mais recentes', () => {
    const dates = TUESDAYS.slice(0, 11)
    const summary = summarizeBreadDemandHistory(input({
      romaneios: dates.map((date, index) => romaneio(date, 'jc', index)),
      romaneioItems: dates.map((_, index) => sent(`jc-${index}`, index + 1)),
      leftovers: dates.map(date => closing(date, 'jc')),
    })).integral.stores.jc

    expect(summary.confidence).toBe('normal')
    expect(summary.validDays).toBe(8)
    expect(summary.average).toBe(4.5)
    expect(summary.minimum).toBe(1)
    expect(summary.maximum).toBe(8)
  })

  it('resolve pedido firme do produto unificado para o pão legado e ignora cancelado', () => {
    const result = summarizeBreadDemandHistory(input({
      productLinks: [{ productId: 'produto-integral', legacyBreadId: 'integral' }],
      firmOrders: [
        {
          bread_id: 'produto-integral',
          product_source: 'product',
          quantity: 8,
          pricing_unit: 'un',
          store: 'ex',
          order_type: 'producao',
          order_date: TARGET_DATE,
          production_date: null,
          pj_delivery_date: null,
          cancelled_at: null,
        },
        {
          bread_id: 'integral',
          product_source: 'bread',
          quantity: 3,
          pricing_unit: 'un',
          store: 'pj',
          order_type: 'pj',
          order_date: '2026-08-24',
          production_date: TARGET_DATE,
          pj_delivery_date: '2026-08-26',
          cancelled_at: null,
        },
        {
          bread_id: 'integral',
          product_source: 'bread',
          quantity: 2,
          pricing_unit: 'un',
          store: 'pj',
          order_type: 'pj',
          order_date: '2026-08-24',
          production_date: null,
          pj_delivery_date: TARGET_DATE,
          cancelled_at: null,
        },
        {
          bread_id: 'integral',
          product_source: 'bread',
          quantity: 4,
          pricing_unit: 'un',
          store: 'jc',
          order_type: 'encomenda',
          order_date: '2026-08-24',
          production_date: TARGET_DATE,
          pj_delivery_date: null,
          cancelled_at: null,
        },
        {
          bread_id: 'integral',
          product_source: 'bread',
          quantity: 99,
          pricing_unit: 'un',
          store: 'ex',
          order_type: 'producao',
          order_date: TARGET_DATE,
          production_date: null,
          pj_delivery_date: null,
          cancelled_at: '2026-08-24T12:00:00Z',
        },
      ],
    })).integral

    expect(result.firm.ex).toEqual({ quantity: 8, unit: 'un', mixedUnits: false })
    expect(result.firm.pj.quantity).toBe(5)
    expect(result.firm.encomenda.quantity).toBe(4)
  })

  it('não cria média para pão fora da escala do dia planejado', () => {
    const dates = TUESDAYS.slice(0, 8)
    const result = summarizeBreadDemandHistory(input({
      breads: [{ id: 'integral', name: 'Integral', days: [1], unit: 'un' }],
      romaneios: dates.map((date, index) => romaneio(date, 'jc', index)),
      romaneioItems: dates.map((_, index) => sent(`jc-${index}`, 8)),
      leftovers: dates.map(date => closing(date, 'jc')),
    })).integral.stores.jc

    expect(result.validDays).toBe(0)
    expect(result.confidence).toBe('insufficient')
    expect(result.average).toBeNull()
  })
})
