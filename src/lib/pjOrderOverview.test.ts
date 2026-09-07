import { describe, expect, it } from 'vitest'
import { pjBillingForOrder, pjBillingTotals, pjHasPendingFollowup, pjOperationalOverview, type PjBillingEntry, type PjReceiptEntry } from './pjOrderOverview'

const order = { cancelled_at: null, dispatched_at: null, production_date: '2026-09-01', delivery_date: '2026-09-02', rows: [{ dispatched_quantity: null }] }
const bill: PjBillingEntry = { id: 'b1', origin_ref: 'g1', amount: 100, status: 'parcial', due_date: '2026-09-09' }
const receipt: PjReceiptEntry = { id: 'r1', receivable_id: 'b1', amount: 40, received_date: '2026-09-01', reversed_at: null }

describe('fatos e pendências PJ', () => {
  it('data vencida não comprova entrega nem produção concluída', () => {
    expect(pjOperationalOverview(order, '2026-09-07').status).toBe('Data combinada passou')
    expect(pjHasPendingFollowup(order, '2026-09-07')).toBe(true)
  })
  it('zero exige decisão e não cancela automaticamente', () => {
    const state = pjOperationalOverview({ ...order, rows: [{ dispatched_quantity: 0 }] }, '2026-09-07')
    expect(state.pending).toBe(true)
    expect(state.next).toContain('não cancela')
  })
  it('cobrança existente impede recomendar conferência pela expedição', () => {
    expect(pjOperationalOverview({ ...order, rows: [{ dispatched_quantity: null, already_billed: true }] }, '2026-09-07').owner).toBe('Financeiro')
  })
  it('não abate estorno nem cobrança cancelada da dívida ativa', () => {
    expect(pjBillingTotals([bill, { ...bill, id: 'b2', status: 'cancelada', amount: 300 }], [receipt, { ...receipt, id: 'r2', amount: 20, reversed_at: '2026-09-02' }])).toEqual({ amount: 100, received: 40, remaining: 60 })
  })
  it('pedido pronto com pagamento parcial continua pendente; quitado sai', () => {
    const ready = { ...order, dispatched_at: '2026-09-02' }
    expect(pjHasPendingFollowup(ready, '2026-09-07', { kind: 'loaded', bills: [bill], receipts: [receipt] })).toBe(true)
    expect(pjHasPendingFollowup(ready, '2026-09-07', { kind: 'loaded', bills: [bill], receipts: [{ ...receipt, amount: 100 }] })).toBe(false)
    expect(pjHasPendingFollowup(ready, '2026-09-07', { kind: 'unavailable' })).toBe(true)
  })
  it('cancelamento operacional não esconde cobrança vigente', () => {
    expect(pjHasPendingFollowup({ ...order, cancelled_at: '2026-09-03' }, '2026-09-07', { kind: 'loaded', bills: [bill], receipts: [] })).toBe(true)
  })
  it('separa pedidos e preserva indisponibilidade para legados sem identificador', () => {
    expect(pjBillingForOrder({ kind: 'loaded', bills: [bill], receipts: [receipt] }, 'outro')).toEqual({ kind: 'loaded', bills: [], receipts: [] })
    expect(pjBillingForOrder({ kind: 'loaded', bills: [], receipts: [] }, null)).toEqual({ kind: 'unavailable' })
  })
})
