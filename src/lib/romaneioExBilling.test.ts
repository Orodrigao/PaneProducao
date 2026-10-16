import { describe, expect, it } from 'vitest'
import { billingResultFromBuckLines, billingRowPeriodLabel, isMissingBuckBillingFunction, type BuckBillingLine } from './romaneioExBilling'

function line(overrides: Partial<BuckBillingLine>): BuckBillingLine {
  return {
    product_source: 'bread',
    product_id: 'italiano',
    produto: 'Italiano',
    unidade: 'un',
    quantidade: 0,
    preco_unitario: null,
    total: null,
    problemas: [],
    itens: [],
    ...overrides,
  }
}

describe('billingResultFromBuckLines', () => {
  it('mostra cada preço numa linha quando a troca cai no meio do período', () => {
    const result = billingResultFromBuckLines([
      line({
        quantidade: '10', preco_unitario: '4.50', total: '45.00',
        itens: [{ romaneio_id: 'r1', romaneio_item_id: 'i1', record_date: '2026-10-06', qty_sent: 10 }],
      }),
      line({
        quantidade: 20, preco_unitario: 5.89, total: 117.8,
        itens: [
          { romaneio_id: 'r2', romaneio_item_id: 'i2', record_date: '2026-10-09', qty_sent: 12 },
          { romaneio_id: 'r3', romaneio_item_id: 'i3', record_date: '2026-10-10', qty_sent: 8 },
        ],
      }),
      line({
        product_id: 'azeitonas', produto: 'Pão de Azeitonas', quantidade: 4, preco_unitario: 9.5, total: 38,
        itens: [{ romaneio_id: 'r1', romaneio_item_id: 'i4', record_date: '2026-10-06', qty_sent: 4 }],
      }),
    ])

    expect(result.total).toBe(200.8)
    expect(result.tripCount).toBe(3)
    expect(result.itemCount).toBe(4)
    expect(result.hasBlockingIssues).toBe(false)
    expect(result.rows.map(row => [row.productName, row.unitPrice, row.total, row.priceChanged])).toEqual([
      ['Italiano', 4.5, 45, true],
      ['Italiano', 5.89, 117.8, true],
      ['Pão de Azeitonas', 9.5, 38, false],
    ])
    expect(new Set(result.rows.map(row => row.key)).size).toBe(3)
    expect(result.rows[1]).toMatchObject({ itemIds: ['i2', 'i3'], tripCount: 2, sentQuantity: 20, firstDate: '2026-10-09', lastDate: '2026-10-10' })
  })

  it('bloqueia a impressão e tira do total a linha com problema', () => {
    const result = billingResultFromBuckLines([
      line({ quantidade: 5, preco_unitario: 4.5, total: 22.5, itens: [{ romaneio_id: 'r1', romaneio_item_id: 'i1', qty_sent: 5 }] }),
      line({
        product_source: 'extra', product_id: 'extra_1', produto: 'Parmesão', quantidade: 6, problemas: ['missing_price'],
        itens: [{ romaneio_id: 'r1', romaneio_item_id: 'i2', qty_sent: 6 }],
      }),
      line({
        product_id: 'ciabatta', produto: 'Ciabatta (kg)', unidade: 'kg', quantidade: 1450, preco_unitario: 18.5, total: null,
        problemas: ['suspicious_quantity'], itens: [{ romaneio_id: 'r1', romaneio_item_id: 'i3', qty_sent: 1450 }],
      }),
    ])

    expect(result.hasBlockingIssues).toBe(true)
    expect(result.total).toBe(22.5)
    expect(result.rows[1]).toMatchObject({ productSource: 'extra', itemIds: ['i2'], unitPrice: null, issues: ['missing_price'] })
    expect(result.rows[2]).toMatchObject({ billingUnit: 'kg', unitPrice: null, total: null, issues: ['suspicious_quantity'] })
  })

  it('problema desconhecido do banco bloqueia, nunca libera', () => {
    const result = billingResultFromBuckLines([
      line({ quantidade: 5, preco_unitario: 4.5, total: 22.5, problemas: ['algo_novo'] }),
    ])
    expect(result.hasBlockingIssues).toBe(true)
    expect(result.total).toBe(0)
    expect(result.rows[0].issues).toEqual(['missing_price'])
  })

  it('soma em centavos, sem erro de ponto flutuante', () => {
    const result = billingResultFromBuckLines([
      line({ product_id: 'a', produto: 'A', quantidade: 1, preco_unitario: 0.1, total: 0.1 }),
      line({ product_id: 'b', produto: 'B', quantidade: 1, preco_unitario: 0.2, total: 0.2 }),
    ])
    expect(result.total).toBe(0.3)
  })
})

describe('billingRowPeriodLabel', () => {
  it('descreve o período da linha', () => {
    expect(billingRowPeriodLabel({ firstDate: '2026-10-05', lastDate: '2026-10-08' })).toBe('de 05/10 a 08/10')
    expect(billingRowPeriodLabel({ firstDate: '2026-10-09', lastDate: '2026-10-09' })).toBe('em 09/10')
    expect(billingRowPeriodLabel({ firstDate: null, lastDate: null })).toBeNull()
  })
})

describe('isMissingBuckBillingFunction', () => {
  it('reconhece a função que ainda não chegou ao banco, e só ela', () => {
    expect(isMissingBuckBillingFunction({ code: 'PGRST202', message: 'Could not find the function' })).toBe(true)
    expect(isMissingBuckBillingFunction({ code: '42883' })).toBe(true)
    expect(isMissingBuckBillingFunction({ code: '42501', message: 'Sem permissão para ver o Fechamento EX.' })).toBe(false)
    expect(isMissingBuckBillingFunction(null)).toBe(false)
  })
})
