import { describe, expect, it } from 'vitest'
import { organizePjOrders, type PjOrderListItem } from './pjOrderList'

function order(
  key: string,
  productionDate: string | null,
  deliveryDate: string | null,
): PjOrderListItem {
  return {
    key,
    customerName: key,
    orderDate: '2026-07-18',
    productionDate,
    deliveryDate,
    cancelledAt: null,
  }
}

describe('organização da lista de Pedidos PJ', () => {
  it('coloca produção vencida antes de hoje, amanhã e datas futuras', () => {
    const result = organizePjOrders([
      order('futuro', '2026-07-25', '2026-07-26'),
      order('amanha', '2026-07-21', '2026-07-22'),
      order('vencido', '2026-07-19', '2026-07-22'),
      order('hoje', '2026-07-20', '2026-07-21'),
    ], { today: '2026-07-20', query: '' })

    expect(result.open.map(item => item.key)).toEqual([
      'vencido',
      'hoje',
      'amanha',
      'futuro',
    ])
    expect(result.openSections.map(section => section.id)).toEqual([
      'overdue',
      'today',
      'tomorrow',
      'date:2026-07-25',
    ])
  })

  it('busca parte do nome sem acento em pedidos abertos e no histórico', () => {
    const openOrder = {
      ...order('aberto', '2026-07-21', '2026-07-22'),
      customerName: 'José Restaurante',
    }
    const historyOrder = {
      ...order('historico', '2026-07-10', '2026-07-11'),
      customerName: 'Mercado São José',
    }

    const result = organizePjOrders([historyOrder, openOrder], {
      today: '2026-07-20',
      query: 'jose',
    })

    expect(result.searchResults.map(resultItem => ({
      key: resultItem.order.key,
      stage: resultItem.stage,
    }))).toEqual([
      { key: 'aberto', stage: 'open' },
      { key: 'historico', stage: 'history' },
    ])
  })

  it('separa cancelados e entregas passadas e desempata clientes por nome', () => {
    const cancelled = {
      ...order('cancelado', '2026-07-21', '2026-07-22'),
      cancelledAt: '2026-07-19T10:00:00-03:00',
    }
    const past = order('passado', '2026-07-18', '2026-07-19')
    const clientB = {
      ...order('cliente-b', '2026-07-20', '2026-07-21'),
      customerName: 'Bistrô da Praça',
    }
    const clientA = {
      ...order('cliente-a', '2026-07-20', '2026-07-21'),
      customerName: 'Armazém Central',
    }

    const result = organizePjOrders([cancelled, clientB, past, clientA], {
      today: '2026-07-20',
      query: '',
    })

    expect(result.open.map(item => item.key)).toEqual(['cliente-a', 'cliente-b'])
    expect(result.history.map(item => item.key).sort()).toEqual(['cancelado', 'passado'])
  })
})
