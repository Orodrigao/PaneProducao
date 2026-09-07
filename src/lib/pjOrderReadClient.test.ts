import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { from: mocks.from } }))
import { loadPjBilling, readAllPjPages } from './pjOrderReadClient'

function response(value: unknown) {
  const promise = Promise.resolve(value)
  return Object.assign(promise, { select: () => response(value), eq: () => response(value), in: () => response(value), order: () => response(value), range: () => promise, single: () => promise })
}

describe('consulta financeira protegida', () => {
  beforeEach(() => mocks.from.mockReset())
  it('sem concessão explícita nem consulta cobranças', async () => {
    mocks.from.mockImplementation((table: string) => response({ data: table === 'app_profiles' ? { active: true } : [], error: null }))
    expect(await loadPjBilling('user')).toEqual({ kind: 'restricted' })
    expect(mocks.from.mock.calls.map(call => call[0])).toEqual(['app_profiles', 'app_user_permissions'])
  })
  it('falha nos recebimentos não publica saldo zero', async () => {
    mocks.from.mockImplementation((table: string) => response(table === 'app_profiles' ? { data: { active: true }, error: null } : table === 'app_user_permissions' ? { data: [{ scope: 'jc' }], error: null } : table === 'receivables' ? { data: [{ id: 'b1', origin_ref: 'g1', amount: 100, due_date: '2026-09-08', status: 'parcial' }], count: 1, error: null } : { data: null, count: null, error: { message: 'falha' } }))
    expect(await loadPjBilling('user')).toEqual({ kind: 'unavailable' })
  })
  it('revalida acesso antes de concluir que a consulta está vazia', async () => {
    let permissionsRead = 0
    mocks.from.mockImplementation((table: string) => response(table === 'app_profiles' ? { data: { active: true }, error: null } : table === 'app_user_permissions' ? { data: ++permissionsRead === 1 ? [{ scope: 'jc' }] : [], error: null } : { data: [], count: 0, error: null }))
    expect(await loadPjBilling('user')).toEqual({ kind: 'unavailable' })
  })
})

describe('leitura completa dos pedidos', () => {
  it('preserva todas as 601 linhas mesmo com limite do servidor menor que a página', async () => {
    const rows = Array.from({ length: 601 }, (_, i) => ({ id: String(i) }))
    const read = vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, Math.min(from + 75, to + 1)), count: rows.length, error: null }))
    expect(await readAllPjPages(read)).toEqual(rows)
    expect(read).toHaveBeenCalledTimes(9)
  })
  it('aceita uma lista vazia com contagem confirmada', async () => {
    expect(await readAllPjPages(async () => ({ data: [], count: 0, error: null }))).toEqual([])
  })
  it('não entrega as primeiras linhas quando a segunda página falha', async () => {
    const read = vi.fn().mockResolvedValueOnce({ data: [{ id: 'a' }], count: 2, error: null })
      .mockResolvedValueOnce({ data: null, count: null, error: { message: 'Sem rede' } })
    await expect(readAllPjPages(read)).rejects.toThrow('Sem rede')
  })
  it.each([
    { data: [], count: null, error: null },
    { data: [], count: undefined, error: null },
    { data: [], count: 3, error: null },
    { data: [{ id: 'a' }], count: 1, error: null },
    { data: [{ id: 'b' }], count: 3, error: null },
  ])('recusa ausência de contagem, truncamento, repetição ou mudança de contagem', async next => {
    const read = vi.fn().mockResolvedValueOnce({ data: [{ id: 'a' }], count: 2, error: null }).mockResolvedValueOnce(next)
    await expect(readAllPjPages(read)).rejects.toThrow()
  })
})
