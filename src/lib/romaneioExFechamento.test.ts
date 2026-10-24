import { describe, expect, it } from 'vitest'
import {
  billedPeriodLabel,
  changeLabel,
  fechamentoExFromPayload,
  outsideNotice,
} from './romaneioExFechamento'

// A semana cobrada do seed do Preview, como `list_romaneio_ex_fechamento` devolve.
function semanaCobrada(overrides: Record<string, unknown> = {}) {
  return {
    receivable_id: 'cobranca-1',
    period_start: '2026-08-17',
    period_end: '2026-08-23',
    amount: 225,
    com_foto: true,
    linhas: [
      {
        product_source: 'bread', product_id: 'brioche', produto: 'Brioche', unidade: 'un',
        quantidade: 120, preco_unitario: 1.2, total: 144, problemas: [],
        itens: [
          { romaneio_id: 'r1', romaneio_item_id: 'i1', record_date: '2026-08-18', qty_sent: 80, qty_accepted: 80 },
          { romaneio_id: 'r2', romaneio_item_id: 'i3', record_date: '2026-08-20', qty_sent: 40, qty_accepted: null },
        ],
      },
      {
        product_source: 'bread', product_id: 'ciabatta', produto: 'Ciabatta', unidade: 'kg',
        quantidade: 2, preco_unitario: 38, total: 76, problemas: [],
        itens: [{ romaneio_id: 'r1', romaneio_item_id: 'i2', record_date: '2026-08-18', qty_sent: 2, qty_accepted: 2 }],
      },
    ],
    ajustes: [
      { position: 1, kind: 'produto_sem_romaneio', description: 'Pão que saiu sem romaneio', product_name: 'Baguete', quantity: 4, unit: 'un', unit_price: 2.5, amount: 10 },
      { position: 2, kind: 'acerto', description: 'Desconto combinado', product_name: null, quantity: null, unit: null, unit_price: null, amount: -5 },
    ],
    depois: [
      {
        product_source: 'bread', product_id: 'baguete', produto: 'Baguete', unidade: 'un',
        quantidade: 10, preco_unitario: 2.5, total: 25, problemas: [],
        itens: [{ romaneio_id: 'r3', romaneio_item_id: 'i4', record_date: '2026-08-22', antes: null, agora: 10 }],
      },
      {
        product_source: 'bread', product_id: 'brioche', produto: 'Brioche', unidade: 'un',
        quantidade: -4, preco_unitario: 1.2, total: -4.8, problemas: [],
        itens: [{ romaneio_id: 'r2', romaneio_item_id: 'i3', record_date: '2026-08-20', antes: 40, agora: 36 }],
      },
    ],
    ...overrides,
  }
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    mostra_cobrado: true,
    a_cobrar: [
      {
        product_source: 'bread', product_id: 'brioche', produto: 'Brioche', unidade: 'un',
        quantidade: 30, preco_unitario: 1.2, total: 36, problemas: [],
        itens: [{ romaneio_id: 'r9', romaneio_item_id: 'i9', record_date: '2026-08-25', qty_sent: 30 }],
      },
    ],
    cobrancas: [semanaCobrada()],
    fora_do_periodo: [],
    ...overrides,
  }
}

describe('fechamentoExFromPayload', () => {
  it('traduz a semana cobrada com a foto, os ajustes e o que mudou depois', () => {
    const fechamento = fechamentoExFromPayload(payload())

    expect(fechamento.showsBilled).toBe(true)
    expect(fechamento.billedTotal).toBe(225)
    expect(fechamento.toBill.total).toBe(36)
    const [cobranca] = fechamento.billed
    expect(cobranca).toMatchObject({ receivableId: 'cobranca-1', amount: 225, withPhoto: true, adjustmentsTotal: 5 })
    expect(cobranca.lines.total).toBe(220)
    expect(cobranca.lines.tripCount).toBe(2)
    expect(cobranca.lines.rows.map(row => [row.productName, row.billedQuantity, row.unitPrice, row.total])).toEqual([
      ['Brioche', 120, 1.2, 144],
      ['Ciabatta', 2, 38, 76],
    ])
    expect(cobranca.adjustments.map(ajuste => [ajuste.kind, ajuste.description, ajuste.amount])).toEqual([
      ['produto_sem_romaneio', 'Pão que saiu sem romaneio', 10],
      ['acerto', 'Desconto combinado', -5],
    ])
    expect(cobranca.changes.map(mudanca => [mudanca.productName, mudanca.kind, mudanca.quantity, mudanca.total, mudanca.dates])).toEqual([
      ['Baguete', 'entregue_depois', 10, 25, ['2026-08-22']],
      ['Brioche', 'saiu_depois', -4, -4.8, ['2026-08-20']],
    ])
    expect(cobranca.changesTotal).toBe(20.2)
    expect(cobranca.changesWithoutValue).toBe(false)
  })

  it('soma em centavos: 0,1 + 0,2 cobrados não viram 0,30000000000000004', () => {
    const fechamento = fechamentoExFromPayload(payload({
      cobrancas: [
        semanaCobrada({ receivable_id: 'a', amount: 0.1, depois: [] }),
        semanaCobrada({ receivable_id: 'b', period_start: '2026-08-24', period_end: '2026-08-30', amount: 0.2, depois: [] }),
      ],
    }))
    expect(fechamento.billedTotal).toBe(0.3)
  })

  it('pão sem preço depois da cobrança fica sem valor e avisa', () => {
    const fechamento = fechamentoExFromPayload(payload({
      cobrancas: [semanaCobrada({
        depois: [{
          product_source: 'extra', product_id: 'x', produto: 'Parmesão', unidade: 'un',
          quantidade: 3, preco_unitario: null, total: null, problemas: ['missing_price'],
          itens: [{ record_date: '2026-08-21', antes: null, agora: 3 }],
        }],
      })],
    }))
    const [mudanca] = fechamento.billed[0].changes
    expect(mudanca).toMatchObject({ kind: 'entregue_depois', total: null, issues: ['missing_price'] })
    expect(fechamento.billed[0].changesWithoutValue).toBe(true)
    expect(fechamento.billed[0].changesTotal).toBe(0)
  })

  it('problema que a tela não conhece também tira o valor da mudança', () => {
    const fechamento = fechamentoExFromPayload(payload({
      cobrancas: [semanaCobrada({
        depois: [{
          product_source: 'bread', product_id: 'brioche', produto: 'Brioche', unidade: 'un',
          quantidade: 2, preco_unitario: 1.2, total: 2.4, problemas: ['algo_novo'],
          itens: [],
        }],
      })],
    }))
    expect(fechamento.billed[0].changes[0]).toMatchObject({ total: null, issues: ['missing_price'] })
  })

  it('cobrança sem foto aparece só pelo valor', () => {
    const fechamento = fechamentoExFromPayload(payload({
      cobrancas: [semanaCobrada({ com_foto: false, linhas: [], ajustes: [], depois: [] })],
    }))
    expect(fechamento.billed[0]).toMatchObject({ withPhoto: false, amount: 225, changes: [] })
    expect(fechamento.billed[0].lines.rows).toEqual([])
  })

  it('sem acesso ao Contas a receber, o fechamento é só a conta do período', () => {
    const fechamento = fechamentoExFromPayload(payload({ mostra_cobrado: false, cobrancas: [], fora_do_periodo: [] }))
    expect(fechamento).toMatchObject({ showsBilled: false, billed: [], billedTotal: 0, outside: [] })
    expect(fechamento.toBill.rows).toHaveLength(1)
  })

  it('recusa cobrança vinda para quem não tem acesso ao cobrado', () => {
    expect(() => fechamentoExFromPayload(payload({ mostra_cobrado: false }))).toThrow(/formato que a tela não conhece/)
  })

  it.each([
    ['resposta vazia', null],
    ['lista ausente', { mostra_cobrado: true, a_cobrar: [], fora_do_periodo: [] }],
    ['valor cobrado ilegível', payload({ cobrancas: [semanaCobrada({ amount: 'muito' })] })],
    ['data fora do formato', payload({ cobrancas: [semanaCobrada({ period_end: '23/08/2026' })] })],
    ['linha sem produto', payload({ a_cobrar: [{ product_source: 'bread', product_id: 'x', unidade: 'un', itens: [] }] })],
    ['mudança zerada', payload({ cobrancas: [semanaCobrada({ depois: [{ ...semanaCobrada().depois[0], quantidade: 0 }] })] })],
  ])('recusa %s em vez de mostrar número faltando', (_caso, entrada) => {
    expect(() => fechamentoExFromPayload(entrada)).toThrow(/formato que a tela não conhece/)
  })
})

describe('textos do Fechamento EX', () => {
  it('chama de semana só o que vai de segunda a domingo', () => {
    expect(billedPeriodLabel('2026-09-14', '2026-09-20')).toBe('Semana de 14/09 a 20/09')
    expect(billedPeriodLabel('2026-09-15', '2026-09-21')).toBe('Cobrança de 15/09 a 21/09')
    expect(billedPeriodLabel('2026-09-01', '2026-09-15')).toBe('Cobrança de 01/09 a 15/09')
  })

  it('diz o sentido da mudança', () => {
    expect(changeLabel('entregue_depois')).toBe('entregue depois, não cobrado')
    expect(changeLabel('saiu_depois')).toBe('saiu do romaneio depois de cobrado')
  })

  it('explica onde aparecem os dias de uma cobrança que termina depois do período', () => {
    expect(outsideNotice([{ periodStart: '2026-09-28', periodEnd: '2026-10-04' }], '2026-09-01', '2026-09-30'))
      .toBe('Os dias 28/09 a 30/09 já foram cobrados na semana de 28/09 a 04/10, que aparece no período que contém o domingo dela.')
    expect(outsideNotice([{ periodStart: '2026-09-28', periodEnd: '2026-10-04' }], '2026-09-01', '2026-09-28'))
      .toBe('O dia 28/09 já foi cobrado na semana de 28/09 a 04/10, que aparece no período que contém o domingo dela.')
    expect(outsideNotice([{ periodStart: '2026-09-25', periodEnd: '2026-10-05' }], '2026-09-26', '2026-09-30'))
      .toBe('Os dias 26/09 a 30/09 já foram cobrados na cobrança de 25/09 a 05/10, que aparece no período que contém o último dia dela.')
    expect(outsideNotice([], '2026-09-01', '2026-09-30')).toBeNull()
  })
})
