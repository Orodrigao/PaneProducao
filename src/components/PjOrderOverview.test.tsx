import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PjOrderOverview } from './PjOrderOverview'

const order = {
  order_group_id: 'g1', order_date: '2026-09-01', delivery_date: '2026-09-02', production_date: null,
  obs: null, cancelled_at: null, cancelled_by: null, cancel_reason: null, dispatched_at: null, dispatched_by_name: null,
  rows: [{ id: 'item1', product_name: 'Produto fictício', bread_id: 'p1', quantity: 40, unit_price: 3, pricing_unit: 'un', dispatched_quantity: 38, dispatched_at: null, dispatched_quantity_at: null, dispatched_quantity_by_name: null, dispatched_quantity_reason: 'Disponibilidade' }],
}
describe('ficha PJ', () => {
  it('expedição recebe quantidades, nunca cifras ou histórico de recebimentos', () => {
    const html = renderToStaticMarkup(createElement(PjOrderOverview, { order, today: '2026-09-07', showValues: false, billing: { kind: 'loaded', bills: [], receipts: [{ id: 'r1', receivable_id: 'b1', amount: 777, received_date: '2026-09-02', reversed_at: null }] } }))
    expect(html).toContain('38 un')
    expect(html).not.toContain('R$')
    expect(html).not.toContain('777')
    expect(html).not.toContain('Cobrança e recebimentos')
  })
  it('indisponibilidade financeira tem aviso explícito, sem dívida zero', () => {
    const html = renderToStaticMarkup(createElement(PjOrderOverview, { order, today: '2026-09-07', showValues: true, billing: { kind: 'unavailable' } }))
    expect(html).toContain('Informação financeira indisponível')
    expect(html).not.toContain('A receber:')
    expect(html).toContain('Estimativa do pedido:')
    expect(html).toContain('Valor dos itens:')
  })
  it('preço ausente não vira valor zero', () => {
    const html = renderToStaticMarkup(createElement(PjOrderOverview, { order: { ...order, rows: [{ ...order.rows[0], unit_price: null }] }, today: '2026-09-07', showValues: true, billing: { kind: 'restricted' } }))
    expect(html).not.toContain('R$')
    expect(html).toContain('indisponível')
  })
})
