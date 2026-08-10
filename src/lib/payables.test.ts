import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
import {
  buildInstallments,
  getPayableErrorMessage,
  isDueSoon,
  isOverdue,
  totalInstallments,
  totalItems,
  validateDraft,
  type PayableDraft,
} from './payables'
import { buildPayablesReport, buildPayablesReportExportRows } from './payablesReport'

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
  it('preserva a mensagem do banco quando a NF-e ja foi importada', () => {
    expect(getPayableErrorMessage(
      { message: 'Esta NF-e já foi importada. A chave de acesso não pode ser repetida.' },
      'Não foi possível importar a NF-e.',
    )).toContain('Esta NF-e já foi importada')
  })

  it('calcula o total do CEASA por item e por parcela', () => {
    expect(totalItems(baseDraft.items)).toBe(250)
    expect(totalInstallments(baseDraft.installments)).toBe(250)
    expect(validateDraft(baseDraft)).toBeNull()
  })

  it('valida o valor real e a data do pagamento manual', () => {
    const paidDetails = { paidDate: '2026-08-03', paidAmount: '253.50', paidMethod: 'dinheiro' as const, currentDueDate: '' }
    expect(validateDraft({ ...baseDraft, paidDetails })).toBeNull()
    expect(validateDraft({ ...baseDraft, paidDetails: { ...paidDetails, paidAmount: '249.99' } })).toContain('menor que o total')
    expect(validateDraft({ ...baseDraft, paidDetails: { ...paidDetails, currentDueDate: '2026-08-02' } })).toContain('vencimento atualizado')
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

  it('monta o relatório de compras pela data da compra e conserva as parcelas', () => {
    const purchase = {
      id: 'purchase-1', purchase_date: '2026-08-03', document_type: 'sem_nota' as const,
      payment_method: 'boleto' as const, status: 'aberta' as const, total_value: 100,
      notes: null, suppliers: { name: 'Fornecedor Teste' }, payable_installments: [
        { id: 'installment-1', installment_number: 1, due_date: '2026-08-10', amount: 50, status: 'pendente' as const },
        { id: 'installment-2', installment_number: 2, due_date: '2026-09-10', amount: 50, status: 'pendente' as const },
      ],
    }
    const report = buildPayablesReport([purchase], { mode: 'compras', from: '2026-08-01', to: '2026-08-31' }, new Date('2026-08-03T12:00:00Z'))
    expect(report.summary.purchaseTotal).toBe(100)
    expect(report.summary.installmentCount).toBe(2)
    expect(report.summary.openTotal).toBe(100)
  })

  it('separa vencimentos e baixas pelo período financeiro', () => {
    const purchase = {
      id: 'purchase-2', purchase_date: '2026-07-20', document_type: 'nfe' as const,
      payment_method: 'boleto' as const, status: 'paga' as const, total_value: 100,
      notes: null, suppliers: { name: 'Fornecedor Teste' }, payable_installments: [
        { id: 'installment-3', installment_number: 1, due_date: '2026-07-30', amount: 50, status: 'paga' as const, paid_at: '2026-08-02T13:00:00Z' },
        { id: 'installment-4', installment_number: 2, due_date: '2026-08-30', amount: 50, status: 'paga' as const, paid_at: '2026-08-30T13:00:00Z' },
      ],
    }
    const report = buildPayablesReport([purchase], { mode: 'financeiro', from: '2026-08-01', to: '2026-08-31' })
    expect(report.summary.scheduledTotal).toBe(50)
    expect(report.summary.paidTotal).toBe(100)
    expect(report.rows).toHaveLength(2)
  })

  it('monta as linhas exportáveis mantendo uma linha por parcela', () => {
    const purchase = {
      id: 'purchase-3', purchase_date: '2026-08-04', document_type: 'nfe' as const,
      payment_method: 'boleto' as const, status: 'aberta' as const, total_value: 80,
      notes: null, origin: 'xml' as const, nfe_number: '123', suppliers: { name: 'Fornecedor Excel' }, payable_installments: [
        { id: 'installment-5', installment_number: 1, due_date: '2026-08-12', amount: 80, status: 'pendente' as const },
      ],
    }
    const report = buildPayablesReport([purchase], { mode: 'compras', from: '2026-08-01', to: '2026-08-31' })
    expect(buildPayablesReportExportRows(report)).toEqual([{
      fornecedor: 'Fornecedor Excel', documento: 'NF-e 123', data_compra: '2026-08-04', parcela: 1,
      vencimento: '2026-08-12', baixa: '', situacao: 'Pendente', valor: 80, criterio: 'Data da compra',
    }])
  })
})
