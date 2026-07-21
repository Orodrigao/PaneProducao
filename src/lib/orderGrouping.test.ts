import { describe, expect, it, vi } from 'vitest'
import {
  encomendaOrderGroupKey,
  ensureOrderGroupId,
  pjOrderGroupKey,
} from './orderGrouping'

const baseDates = {
  order_date: '2026-07-20',
  delivery_date: '2026-07-22',
}

describe('ensureOrderGroupId', () => {
  it('preserva a identidade do pedido durante a edição', () => {
    const generateId = vi.fn(() => 'novo-id')

    expect(ensureOrderGroupId('grupo-existente', generateId)).toBe('grupo-existente')
    expect(generateId).not.toHaveBeenCalled()
  })

  it('cria uma identidade para pedido novo ou legado sem etiqueta', () => {
    expect(ensureOrderGroupId(null, () => 'novo-id')).toBe('novo-id')
  })
})

describe('pjOrderGroupKey', () => {
  it('separa pedidos etiquetados mesmo quando cliente e datas são iguais', () => {
    const common = {
      ...baseDates,
      customer_id: 'cliente-1',
      pj_client: 'Cliente 1',
    }

    expect(pjOrderGroupKey({ ...common, order_group_id: 'grupo-1' }))
      .not.toBe(pjOrderGroupKey({ ...common, order_group_id: 'grupo-2' }))
  })

  it('mantém o agrupamento legado quando a etiqueta ainda não existe', () => {
    const legacy = {
      ...baseDates,
      order_group_id: null,
      customer_id: 'cliente-1',
      pj_client: 'Nome antigo',
    }

    expect(pjOrderGroupKey(legacy)).toBe(pjOrderGroupKey({ ...legacy, pj_client: 'Nome novo' }))
  })
})

describe('encomendaOrderGroupKey', () => {
  it('separa encomendas etiquetadas com os mesmos dados legados', () => {
    const common = {
      ...baseDates,
      customer_id: null,
      walkin_name: 'Cliente balcão',
    }

    expect(encomendaOrderGroupKey({ ...common, order_group_id: 'grupo-1' }))
      .not.toBe(encomendaOrderGroupKey({ ...common, order_group_id: 'grupo-2' }))
  })

  it('mantém o agrupamento legado de cliente avulso sem etiqueta', () => {
    const legacy = {
      ...baseDates,
      order_group_id: null,
      customer_id: null,
      walkin_name: 'Cliente balcão',
    }

    expect(encomendaOrderGroupKey(legacy)).toBe(encomendaOrderGroupKey({ ...legacy }))
  })
})
