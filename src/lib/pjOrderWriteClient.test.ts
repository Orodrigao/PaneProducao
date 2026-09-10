import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }))

import {
  cancelPjOrder,
  clearPendingPjCreate,
  createPjOrder,
  matchesPjWriteAttempt,
  pendingPjCreateAttempt,
  PjOrderWriteError,
  readPendingPjCreate,
  rememberPendingPjCreate,
  replacePjOrder,
  resolvePjWriteAttempt,
  type PjOrderWriteRow,
} from '@/lib/pjOrderWriteClient'

function ids(...values: string[]) {
  let index = 0
  return () => values[index++]
}

describe('tentativas de gravação de Pedidos PJ', () => {
  beforeEach(() => rpc.mockReset())

  it('repete criação idêntica com o mesmo pedido e a mesma tentativa', () => {
    const first = resolvePjWriteAttempt(null, 'create', null, [{ quantity: 2 }], ids('request-1', 'group-1'))
    const retry = resolvePjWriteAttempt(first, 'create', null, [{ quantity: 2 }], ids('unused'))

    expect(retry).toBe(first)
    expect(retry).toMatchObject({ requestId: 'request-1', orderGroupId: 'group-1' })
  })

  it('uma mudança no rascunho cria outra tentativa e outro pedido novo', () => {
    const first = resolvePjWriteAttempt(null, 'create', null, [{ quantity: 2 }], ids('request-1', 'group-1'))
    const changed = resolvePjWriteAttempt(first, 'create', null, [{ quantity: 3 }], ids('request-2', 'group-2'))

    expect(changed).toMatchObject({ requestId: 'request-2', orderGroupId: 'group-2' })
  })

  it('repete alteração idêntica no mesmo pedido, mas não em outro pedido', () => {
    const first = resolvePjWriteAttempt(null, 'replace', 'group-1', [{ quantity: 2 }], ids('request-1'))
    expect(resolvePjWriteAttempt(first, 'replace', 'group-1', [{ quantity: 2 }], ids('unused'))).toBe(first)

    const another = resolvePjWriteAttempt(first, 'replace', 'group-2', [{ quantity: 2 }], ids('request-2'))
    expect(another).toMatchObject({ requestId: 'request-2', orderGroupId: 'group-2' })
  })

  it('repete cancelamento com o mesmo motivo e recusa pedido sem identificação', () => {
    const first = resolvePjWriteAttempt(null, 'cancel', 'group-1', { reason: 'Cliente desistiu' }, ids('request-1'))
    expect(resolvePjWriteAttempt(first, 'cancel', 'group-1', { reason: 'Cliente desistiu' }, ids('unused'))).toBe(first)
    expect(() => resolvePjWriteAttempt(null, 'cancel', null, { reason: 'Cliente desistiu' })).toThrow(
      'Pedido antigo sem identificação',
    )
  })

  it('reconhece somente repetição imediata com o mesmo conteúdo', () => {
    const attempt = resolvePjWriteAttempt(null, 'create', null, [{ quantity: 2 }], ids('request-1', 'group-1'))
    expect(matchesPjWriteAttempt(attempt, 'create', null, [{ quantity: 2 }])).toBe(true)
    expect(matchesPjWriteAttempt(attempt, 'create', null, [{ quantity: 3 }])).toBe(false)
  })

  it('guarda a tentativa por pessoa e consegue repeti-la depois de recarregar', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    }
    const attempt = resolvePjWriteAttempt(null, 'create', null, [{ customer: 'não deve persistir' }], ids('request-1', 'group-1'))
    const rows = [{ customer_id: 'customer-1' }] as PjOrderWriteRow[]
    rememberPendingPjCreate('user-1', attempt, rows, storage)

    expect(readPendingPjCreate('user-1', storage)).toEqual({
      userId: 'user-1', requestId: 'request-1', orderGroupId: 'group-1', rows,
    })
    expect(readPendingPjCreate('user-2', storage)).toBeNull()
    expect([...values.keys()]).toEqual(['pane_pj_pending_create:user-1'])
    expect(pendingPjCreateAttempt(readPendingPjCreate('user-1', storage)!)).toMatchObject({
      requestId: 'request-1', orderGroupId: 'group-1', operation: 'create',
    })
    clearPendingPjCreate('user-1', storage)
    expect(values.size).toBe(0)
  })

  it('envia criação, alteração e cancelamento somente aos contratos atômicos', async () => {
    rpc.mockResolvedValue({ data: {
      repeated: false,
      order_group_id: 'group-1',
      row_count: 1,
      flow_enabled: false,
      cancelled_at: '2026-09-10T15:00:00Z',
      cancelled_by: 'Financeiro JC Teste',
      cancel_reason: 'Cliente desistiu',
    }, error: null })
    const rows = [{ bread_id: 'bread-1' }] as PjOrderWriteRow[]
    const create = resolvePjWriteAttempt(null, 'create', null, rows, ids('request-1', 'group-1'))
    const replace = resolvePjWriteAttempt(null, 'replace', 'group-1', rows, ids('request-2'))
    const cancel = resolvePjWriteAttempt(null, 'cancel', 'group-1', { reason: 'Cliente desistiu' }, ids('request-3'))

    await createPjOrder(create, rows)
    await replacePjOrder(replace, rows)
    await cancelPjOrder(cancel, 'Cliente desistiu')

    expect(rpc.mock.calls).toEqual([
      ['create_pj_order_atomic', { p_request_id: 'request-1', p_order_group_id: 'group-1', p_rows: rows }],
      ['replace_pj_order_atomic', { p_request_id: 'request-2', p_order_group_id: 'group-1', p_rows: rows }],
      ['cancel_pj_order_atomic', { p_request_id: 'request-3', p_order_group_id: 'group-1', p_reason: 'Cliente desistiu' }],
    ])
  })

  it('propaga a recusa do banco e recusa resposta sem confirmação', async () => {
    const attempt = resolvePjWriteAttempt(null, 'create', null, [], ids('request-1', 'group-1'))
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Revise os dados', code: '22023' } })
    const refusal = await createPjOrder(attempt, []).catch(error => error)
    expect(refusal).toBeInstanceOf(PjOrderWriteError)
    expect(refusal).toMatchObject({ message: 'Revise os dados', code: '22023', ambiguous: false })

    rpc.mockResolvedValueOnce({ data: null, error: null })
    const lost = await createPjOrder(attempt, []).catch(error => error)
    expect(lost).toMatchObject({ ambiguous: true })

    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Resultado desconhecido', code: '08007' } })
    const unknownTransaction = await createPjOrder(attempt, []).catch(error => error)
    expect(unknownTransaction).toMatchObject({ code: '08007', ambiguous: true })
  })
})
