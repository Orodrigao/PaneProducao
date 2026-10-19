import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProductionOrderHistory } from './ProductionOrderHistory'

const breads = [
  { id: 'daily', name: 'Pão diário', days: [1, 2, 3, 4, 5, 6], active: true },
  { id: 'saturday', name: 'Pão de sábado', days: [6], active: true },
  { id: 'inactive', name: 'Pão desativado depois do pedido', days: [6], active: false },
  { id: 'zero', name: 'Pão sem pedido', days: [6], active: true },
]

describe('histórico de pedidos da loja', () => {
  it('mostra o registro completo mesmo fora do dia de produção e após desativação', () => {
    const html = renderToStaticMarkup(createElement(ProductionOrderHistory, {
      storeLabel: 'Loja fictícia', breads,
      orders: { daily: { quantity: 3, obs: 'Observação do pedido' }, saturday: { quantity: 7 }, inactive: { quantity: 2 }, zero: { quantity: 0 } },
    }))
    expect(html).toContain('Pão diário')
    expect(html).toContain('Pão de sábado')
    expect(html).toContain('Pão desativado depois do pedido')
    expect(html).not.toContain('Pão sem pedido')
    expect(html).toContain('<td>Total</td><td class="num">12</td>')
    expect(html).toContain('Observação do pedido')
  })

  it('exibe vazio sem reaproveitar as quantidades de outra data ou loja', () => {
    const html = renderToStaticMarkup(createElement(ProductionOrderHistory, {
      storeLabel: 'Outra loja fictícia', breads, orders: {},
    }))
    expect(html).toContain('Nenhum pedido nesta data.')
    expect(html).not.toContain('<table')
  })

})
