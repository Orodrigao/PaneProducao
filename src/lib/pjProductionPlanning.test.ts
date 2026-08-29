import { describe, expect, it } from 'vitest'
import {
  groupPjProductionQueue,
  parseFrozenProductionQuantity,
  parsePjProductionQuantity,
  validatePjProductionSelection,
  type PjProductionQueueItem,
  type PjProductionQueueRow,
} from './pjProductionPlanning'

function row(patch: Partial<PjProductionQueueRow> = {}): PjProductionQueueRow {
  return {
    order_id: 'order-1',
    order_group_id: 'group-1',
    customer_id: 'customer-1',
    customer_name: 'Hamburgueria A',
    order_date: '2026-08-29',
    delivery_date: '2026-08-31',
    product_name: 'Brioche',
    canonical_bread_id: 'brioche',
    pricing_unit: 'un',
    ordered_quantity: 600,
    scheduled_quantity: 300,
    pending_quantity: 300,
    frozen_available: 40,
    last_scheduled_date: null,
    mapping_error: null,
    ...patch,
  }
}

describe('groupPjProductionQueue', () => {
  it('mantém os produtos do mesmo pedido juntos e ordena pela entrega mais próxima', () => {
    const groups = groupPjProductionQueue([
      row({ order_id: '3', order_group_id: 'group-b', customer_name: 'Cliente B', delivery_date: '2026-09-02' }),
      row({ order_id: '2', product_name: 'Italiano' }),
      row({ order_id: '1', product_name: 'Brioche' }),
    ])

    expect(groups.map(group => group.key)).toEqual(['group-1', 'group-b'])
    expect(groups[0].items.map(item => item.productName)).toEqual(['Brioche', 'Italiano'])
  })

  it('não perde a linha bloqueada sem vínculo com o Forno', () => {
    const groups = groupPjProductionQueue([
      row({ canonical_bread_id: null, mapping_error: 'Produto sem vínculo com um pão do Forno.' }),
    ])
    expect(groups[0].items[0].mappingError).toContain('sem vínculo')
  })
})

describe('parsePjProductionQuantity', () => {
  it('aceita pão inteiro e peso com até três casas', () => {
    expect(parsePjProductionQuantity('300', 'un')).toBe(300)
    expect(parsePjProductionQuantity('4,125', 'kg')).toBe(4.125)
  })

  it('recusa meio pão e precisão maior que a gravada pelo pedido', () => {
    expect(parsePjProductionQuantity('2.5', 'un')).toBeNull()
    expect(parsePjProductionQuantity('1.2345', 'kg')).toBeNull()
  })
})

describe('parseFrozenProductionQuantity', () => {
  it('aceita zero e inteiros, mas não fração', () => {
    expect(parseFrozenProductionQuantity('0')).toBe(0)
    expect(parseFrozenProductionQuantity('12')).toBe(12)
    expect(parseFrozenProductionQuantity('1.5')).toBeNull()
  })
})

describe('validatePjProductionSelection', () => {
  const item: PjProductionQueueItem = {
    orderId: 'order-1',
    orderGroupId: 'group-1',
    customerId: 'customer-1',
    customerName: 'Hamburgueria A',
    orderDate: '2026-08-29',
    deliveryDate: '2026-08-31',
    productName: 'Brioche',
    breadId: 'brioche',
    pricingUnit: 'un',
    orderedQuantity: 600,
    scheduledQuantity: 300,
    pendingQuantity: 300,
    frozenAvailable: 40,
    lastScheduledDate: null,
    mappingError: null,
  }

  it('permite dividir 600 em uma programação de 300', () => {
    expect(validatePjProductionSelection(item, '300', '0')).toEqual({
      orderId: 'order-1',
      quantity: 300,
      frozenQuantity: 0,
    })
  })

  it('recusa quantidade acima da pendência e congelado já reservado', () => {
    expect(validatePjProductionSelection(item, '301', '0')).toContain('passa')
    expect(validatePjProductionSelection(item, '100', '41')).toContain('congelado')
  })
})
