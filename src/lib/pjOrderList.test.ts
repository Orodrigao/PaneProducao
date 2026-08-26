import { describe, expect, it } from 'vitest'
import { hasPendingDispatchCheck, organizePjOrders, type PjOrderListItem } from './pjOrderList'

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
    dispatchedAt: null,
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

  it('move um pedido enviado para o histórico imediatamente', () => {
    const dispatched = {
      ...order('enviado', '2026-07-21', '2026-07-22'),
      dispatchedAt: '2026-07-20T15:30:00-03:00',
    }

    const result = organizePjOrders([dispatched], {
      today: '2026-07-20',
      query: '',
    })

    expect(result.open).toEqual([])
    expect(result.history.map(item => item.key)).toEqual(['enviado'])
  })
})

describe('pedido com conferência pendente', () => {
  const base = {
    key: 'g1',
    customerName: 'Buck',
    orderDate: '2026-08-15',
    productionDate: null,
    deliveryDate: '2026-08-15',
    cancelledAt: null,
    dispatchedAt: null,
  }

  it('fica na fila mesmo com a entrega vencida, para não virar órfão', () => {
    // Entregue no sábado, conferido na segunda: sem isto, some da tela da
    // Expedição à meia-noite e não há onde terminar a conferência.
    const { open, history, openSections } = organizePjOrders(
      [{ ...base, hasPendingCheck: true }],
      { today: '2026-08-17', query: '' },
    )
    expect(open).toHaveLength(1)
    expect(history).toHaveLength(0)
    expect(openSections[0].id).toBe('overdue')
  })

  it('vai para o Histórico assim que a conferência termina', () => {
    const { open, history } = organizePjOrders(
      [{ ...base, hasPendingCheck: false }],
      { today: '2026-08-17', query: '' },
    )
    expect(open).toHaveLength(0)
    expect(history).toHaveLength(1)
  })

  it('não segura pedido já enviado nem cancelado', () => {
    const { open, history } = organizePjOrders(
      [
        { ...base, key: 'a', hasPendingCheck: true, dispatchedAt: '2026-08-16T10:00:00Z' },
        { ...base, key: 'b', hasPendingCheck: true, cancelledAt: '2026-08-16T10:00:00Z' },
      ],
      { today: '2026-08-17', query: '' },
    )
    expect(open).toHaveLength(0)
    expect(history).toHaveLength(2)
  })
})

describe('quando o pedido ainda segura a fila da Expedição', () => {
  const linhaPorConferir = { dispatchedQuantity: null }
  const linhaConferida = { dispatchedQuantity: 48 }

  it('segura enquanto houver item por conferir', () => {
    expect(hasPendingDispatchCheck({
      cancelledAt: null,
      dispatchedAt: null,
      rows: [linhaConferida, linhaPorConferir],
    })).toBe(true)
  })

  it('solta assim que tudo foi conferido', () => {
    expect(hasPendingDispatchCheck({
      cancelledAt: null,
      dispatchedAt: null,
      rows: [linhaConferida, linhaConferida],
    })).toBe(false)
  })

  it('solta pedido que já virou cobrança, mesmo faltando conferir', () => {
    // A armadilha de 2026-08-26: o banco recusa conferência em pedido
    // faturado e "Marcar como enviado" exige tudo conferido. Segurar aqui
    // deixaria a Expedição com um item sem saída por porta nenhuma. Foram 65
    // pedidos presos, o mais antigo entregue em 04/06.
    expect(hasPendingDispatchCheck({
      cancelledAt: null,
      dispatchedAt: null,
      rows: [{ ...linhaPorConferir, alreadyBilled: true }],
    })).toBe(false)
  })

  it('basta uma linha faturada para o pedido inteiro sair da fila', () => {
    // A cobrança nasce do grupo, não da linha: se uma diz que existe, existe.
    expect(hasPendingDispatchCheck({
      cancelledAt: null,
      dispatchedAt: null,
      rows: [linhaPorConferir, { ...linhaPorConferir, alreadyBilled: true }],
    })).toBe(false)
  })

  it('não segura pedido cancelado nem já enviado', () => {
    expect(hasPendingDispatchCheck({
      cancelledAt: '2026-08-16T10:00:00Z',
      dispatchedAt: null,
      rows: [linhaPorConferir],
    })).toBe(false)
    expect(hasPendingDispatchCheck({
      cancelledAt: null,
      dispatchedAt: '2026-08-16T10:00:00Z',
      rows: [linhaPorConferir],
    })).toBe(false)
  })

  it('pedido sem linha nenhuma não segura a fila', () => {
    expect(hasPendingDispatchCheck({
      cancelledAt: null,
      dispatchedAt: null,
      rows: [],
    })).toBe(false)
  })
})
