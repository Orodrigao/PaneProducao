import { describe, expect, it, vi } from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { rpc } }))
import { previewPjInstallments, validatePjDueDate, changePjFlowTerms, type PjFlowBill } from './pjFlowFinance'

describe('condições financeiras PJ', () => {
  it('divide centavos sem perder valor e conta desde a entrega combinada', () => {
    expect(previewPjInstallments(190, '2026-09-10', '2026-09-17', 3)).toEqual([
      { number: 1, amount: 63.34, due_date: '2026-09-12' },
      { number: 2, amount: 63.33, due_date: '2026-09-15' },
      { number: 3, amount: 63.33, due_date: '2026-09-17' },
    ])
    for (let cents = 12; cents < 1000; cents += 17) {
      const rows = previewPjInstallments(cents / 100, '2026-09-10', '2026-10-10', 12)
      expect(rows.reduce((sum, row) => sum + Math.round(row.amount * 100), 0)).toBe(cents)
    }
  })
  it('não inventa data nem parcela sem valor ou prazo', () => {
    for (const count of [0, 1, 2.5, 13]) expect(() => previewPjInstallments(190, '2026-09-10', '2026-09-17', count)).toThrow()
    expect(() => previewPjInstallments(0.02, '2026-09-10', '2026-09-17', 3)).toThrow()
    expect(() => previewPjInstallments(190, '2026-09-10', '2026-09-11', 2)).toThrow()
    expect(() => previewPjInstallments(190, '2026-02-30', '2026-03-10', 2)).toThrow()
  })
  it('preserva limites de vencimento existentes, incluindo ano bissexto', () => {
    const bill = { original_due_date: '2028-02-29', invoice_date: '2028-02-22', due_date: '2028-03-10' } as PjFlowBill
    expect(() => validatePjDueDate(bill, '2028-03-01')).not.toThrow()
    for (const due of ['2028-02-28', '2028-03-10', '2029-02-22', '2028-02-30', '']) {
      expect(() => validatePjDueDate(bill, due)).toThrow()
    }
  })
  it('repete o mesmo identificador, versão e acordo após resposta perdida', async () => {
    rpc.mockReset().mockResolvedValue({ error: null })
    const input = { action: 'due' as const, billId: 'bill', dueDate: '2026-09-20', installments: null, reason: 'Novo acordo' }
    await changePjFlowTerms({ id: 'pedido', version: 4 }, 'request', input)
    await changePjFlowTerms({ id: 'pedido', version: 4 }, 'request', input)
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1])
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_expected_version: 4, p_reason: 'Novo acordo', p_action: 'due' })
    rpc.mockResolvedValue({ error: { message: 'O pedido mudou' } })
    await expect(changePjFlowTerms({ id: 'pedido', version: 4 }, 'request', input)).rejects.toThrow('O pedido mudou')
  })
})
