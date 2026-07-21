import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  updateResult: vi.fn(),
  verifyResult: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      update: () => ({
        in: () => ({
          is: () => ({ select: mocks.updateResult }),
        }),
      }),
      select: () => ({ in: mocks.verifyResult }),
    }),
  },
}))

import { cancelOrderRows } from './orderCancellationClient'

describe('gravação do cancelamento', () => {
  beforeEach(() => {
    mocks.updateResult.mockReset()
    mocks.verifyResult.mockReset()
  })

  it('confirma quando todas as linhas foram atualizadas', async () => {
    mocks.updateResult.mockResolvedValue({
      data: [
        { id:'1', cancelled_at:'2026-07-20T12:00:00Z', cancelled_by:'Elis', cancel_reason:'Cliente desistiu' },
        { id:'2', cancelled_at:'2026-07-20T12:00:00Z', cancelled_by:'Elis', cancel_reason:'Cliente desistiu' },
      ],
      error: null,
    })

    const result = await cancelOrderRows(['1', '2'], 'Elis', 'Cliente desistiu')

    expect(result).toEqual({
      ok: true,
      cancellation: {
        cancelled_at:'2026-07-20T12:00:00Z',
        cancelled_by:'Elis',
        cancel_reason:'Cliente desistiu',
      },
    })
    expect(mocks.verifyResult).not.toHaveBeenCalled()
  })

  it('trata repetição como sucesso somente se o grupo já estiver todo cancelado', async () => {
    mocks.updateResult.mockResolvedValue({ data: [], error: null })
    mocks.verifyResult.mockResolvedValue({
      data: [
        { id:'1', cancelled_at:'2026-07-20T12:00:00Z', cancelled_by:'Rodrigo', cancel_reason:'Já cancelado' },
        { id:'2', cancelled_at:'2026-07-20T12:00:00Z', cancelled_by:'Rodrigo', cancel_reason:'Já cancelado' },
      ],
      error: null,
    })

    const result = await cancelOrderRows(['1', '2'], 'Elis', 'Novo toque')

    expect(result).toEqual({
      ok: true,
      cancellation: {
        cancelled_at:'2026-07-20T12:00:00Z',
        cancelled_by:'Rodrigo',
        cancel_reason:'Já cancelado',
      },
    })
  })

  it('não declara sucesso com atualização parcial', async () => {
    mocks.updateResult.mockResolvedValue({ data: [], error: null })
    mocks.verifyResult.mockResolvedValue({
      data: [
        { id:'1', cancelled_at:'2026-07-20T12:00:00Z', cancelled_by:'Elis', cancel_reason:'Motivo' },
        { id:'2', cancelled_at:null, cancelled_by:null, cancel_reason:null },
      ],
      error: null,
    })

    const result = await cancelOrderRows(['1', '2'], 'Elis', 'Motivo')

    expect(result).toEqual({
      ok: false,
      message: 'O pedido não foi cancelado por completo. Recarregue a página e fale com o Rodrigo.',
    })
  })
})
