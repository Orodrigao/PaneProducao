import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: mocks.rpc },
}))

import { confirmPjOrderDispatch, loadPjOrdersForDispatch, savePjOrderDispatchQuantities } from './pjOrderDispatchClient'

describe('fila operacional de Pedidos PJ', () => {
  beforeEach(() => mocks.rpc.mockReset())

  it('carrega os itens pela leitura operacional protegida', async () => {
    mocks.rpc.mockReturnValue({ order: () => ({ range: async () => ({
      count: 1, data: [{
        id: 'item-1',
        order_group_id: 'grupo-1',
        customer_id: 'cliente-1',
        customer_name: 'Mercado Central',
        order_date: '2026-07-20',
        delivery_date: '2026-07-22',
        production_date: '2026-07-21',
        bread_id: 'produto-1',
        product_source: 'product',
        product_name: 'Focaccia',
        quantity: 4,
        pack_size: 1,
        pricing_unit: 'un',
        sale_option_id: null,
        obs: 'Entregar cedo',
        cancelled_at: null,
        dispatched_at: null,
        dispatched_by: null,
        dispatched_by_name: null,
      }],
      error: null,
    }) }) })

    const result = await loadPjOrdersForDispatch()

    expect(result.ok).toBe(true)
    expect(result.ok && result.orders[0].customer_name).toBe('Mercado Central')
    expect(mocks.rpc).toHaveBeenCalledWith('list_pj_orders_for_dispatch', {}, { count: 'exact' })
  })

  it('confirma o grupo uma vez e devolve os dados gravados', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        dispatched_at: '2026-07-21T15:00:00Z',
        dispatched_by: 'usuario-1',
        dispatched_by_name: 'Expedição',
        already_dispatched: false,
      },
      error: null,
    })

    const result = await confirmPjOrderDispatch('grupo-1')

    expect(result).toEqual({
      ok: true,
      dispatch: {
        dispatched_at: '2026-07-21T15:00:00Z',
        dispatched_by: 'usuario-1',
        dispatched_by_name: 'Expedição',
        already_dispatched: false,
      },
    })
    expect(mocks.rpc).toHaveBeenCalledWith('confirm_pj_order_dispatch', {
      p_order_group_id: 'grupo-1',
    })
  })

  it('não declara sucesso quando o banco recusa a ação', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Sem permissão' } })

    await expect(confirmPjOrderDispatch('grupo-1')).resolves.toEqual({
      ok: false,
      message: 'Não foi possível liberar o pedido para entrega: Sem permissão',
    })
  })

  it('preserva os numeros e orienta repetir quando a comunicacao falha', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '', message: 'TypeError: Load failed' } })
    const result = await savePjOrderDispatchQuantities('grupo-1', [
      { order_id: 'linha-1', quantity: 10, reason: null },
    ], null, '11111111-1111-4111-8111-111111111111')
    expect(result).toEqual({
      ok: false,
      message: 'A conferência não foi confirmada. Os números continuam na tela. Confira a internet e toque em Salvar conferência novamente.',
    })
  })

  it('repete a tentativa incerta com o mesmo identificador sem duplicar a gravacao', async () => {
    const requestId = '11111111-1111-4111-8111-111111111111'
    const items = [{ order_id: 'linha-1', quantity: 10, reason: null }]
    const summary = {
      linhas: 1,
      conferidas: 1,
      pendentes: 0,
      nao_enviadas: 0,
      version: '2026-09-14T15:10:00Z',
      itens: [],
    }
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: { code: '', message: 'TypeError: Load failed' } })
      .mockResolvedValueOnce({ data: summary, error: null })

    await savePjOrderDispatchQuantities('grupo-1', items, null, requestId)
    const retry = await savePjOrderDispatchQuantities('grupo-1', items, null, requestId)

    expect(retry).toEqual({ ok: true, summary })
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'save_pj_order_dispatch_quantities', {
      p_request_id: requestId,
      p_order_group_id: 'grupo-1',
      p_items: items,
      p_expected_version: null,
    })
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'save_pj_order_dispatch_quantities', {
      p_request_id: requestId,
      p_order_group_id: 'grupo-1',
      p_items: items,
      p_expected_version: null,
    })
  })
})
