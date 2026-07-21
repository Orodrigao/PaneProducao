import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PjOrderListPanel, type PjOrderListDisplayItem } from './PjOrderListPanel'

const order: PjOrderListDisplayItem = {
  key: 'pedido-1',
  customerName: 'Mercado Central',
  orderDate: '2026-07-20',
  productionDate: '2026-07-21',
  deliveryDate: '2026-07-22',
  cancelledAt: null,
  dispatchedAt: null,
  itemCount: 2,
  total: 125.5,
  statusLabel: 'em produção',
  statusClass: 'conferido',
  statusBorder: 'green',
}

function renderList(showCommercialValues: boolean) {
  return renderToStaticMarkup(createElement(PjOrderListPanel, {
    orders: [order],
    today: '2026-07-21',
    search: '',
    onSearchChange: vi.fn(),
    activeStage: 'open',
    onStageChange: vi.fn(),
    onOpen: vi.fn(),
    formatDate: value => value || '-',
    showCommercialValues,
  }))
}

function renderHistory(orderInHistory: PjOrderListDisplayItem) {
  return renderToStaticMarkup(createElement(PjOrderListPanel, {
    orders: [orderInHistory],
    today: '2026-07-21',
    search: '',
    onSearchChange: vi.fn(),
    activeStage: 'history',
    onStageChange: vi.fn(),
    onOpen: vi.fn(),
    formatDate: value => value || '-',
    showCommercialValues: false,
  }))
}

describe('lista operacional de Pedidos PJ', () => {
  it('não renderiza valores para a Expedição', () => {
    const markup = renderList(false)

    expect(markup).toContain('Mercado Central')
    expect(markup).toContain('2 itens')
    expect(markup).not.toContain('R$')
    expect(markup).not.toContain('125.50')
  })

  it('preserva os valores para Administração e Financeiro', () => {
    const markup = renderList(true)

    expect(markup).toContain('R$ 125.50')
  })

  it('diferencia um pedido enviado de um pedido cancelado', () => {
    const markup = renderHistory({
      ...order,
      dispatchedAt: '2026-07-21T15:00:00Z',
      statusLabel: 'enviado',
    })

    expect(markup).toContain('is-dispatched')
    expect(markup).not.toContain('is-cancelled')
  })
})
