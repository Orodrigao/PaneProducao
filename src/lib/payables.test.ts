import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
import {
  buildInstallments,
  isDueSoon,
  isOverdue,
  totalInstallments,
  totalItems,
  validateDraft,
  type PayableDraft,
} from './payables'

const baseDraft: PayableDraft = {
  supplierId: 'supplier-ceasa',
  purchaseDate: '2026-08-03',
  documentType: 'sem_nota',
  paymentMethod: 'dinheiro',
  paid: true,
  notes: '',
  items: [
    { productId: 'manjericao', itemName: 'Manjericão', unit: 'kg', quantity: '2', unitPrice: '50' },
    { productId: 'tomate-cereja', itemName: 'Tomate cereja', unit: 'kg', quantity: '3', unitPrice: '50' },
  ],
  installments: [{ number: 1, dueDate: '2026-08-03', amount: '250.00' }],
}

describe('contas a pagar manual', () => {
  it('calcula o total do CEASA por item e por parcela', () => {
    expect(totalItems(baseDraft.items)).toBe(250)
    expect(totalInstallments(baseDraft.installments)).toBe(250)
    expect(validateDraft(baseDraft)).toBeNull()
  })

  it('distribui parcelas e ajusta o centavo final', () => {
    expect(buildInstallments(100, 3, '2026-08-10')).toEqual([
      { number: 1, dueDate: '2026-08-10', amount: '33.33' },
      { number: 2, dueDate: '2026-09-10', amount: '33.33' },
      { number: 3, dueDate: '2026-10-10', amount: '33.34' },
    ])
  })

  it('recusa parcela com total diferente do total da compra', () => {
    expect(validateDraft({
      ...baseDraft,
      installments: [{ number: 1, dueDate: '2026-08-03', amount: '249.99' }],
    })).toContain('soma das parcelas')
  })

  it('marca vencimento atrasado e vencimento dos próximos sete dias', () => {
    const today = new Date('2026-08-03T12:00:00Z')
    expect(isOverdue({ id: '1', installment_number: 1, due_date: '2026-08-02', amount: 10, status: 'pendente' }, today)).toBe(true)
    expect(isDueSoon({ id: '2', installment_number: 1, due_date: '2026-08-10', amount: 10, status: 'pendente' }, today)).toBe(true)
    expect(isDueSoon({ id: '3', installment_number: 1, due_date: '2026-08-11', amount: 10, status: 'pendente' }, today)).toBe(false)
  })
})
