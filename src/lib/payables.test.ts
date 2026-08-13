import { beforeEach, describe, expect, it, vi } from 'vitest'

const supabaseMocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: supabaseMocks.from } }))
import {
  buildInstallments,
  effectiveDueDate,
  getPayableErrorMessage,
  isDueSoon,
  isOverdue,
  loadPayablePurchaseItems,
  payableDetailUrl,
  totalInstallments,
  totalItems,
  validateCategorySlices,
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
  beforeEach(() => {
    supabaseMocks.from.mockReset()
  })

  it('carrega todos os itens de uma NF-e pela compra, inclusive os já classificados', async () => {
    const order = vi.fn().mockResolvedValue({ data: [{ id: 'item-1', item_name: 'Leite', mapping_status: 'completa' }], error: null })
    const eq = vi.fn().mockReturnValue({ order })
    const select = vi.fn().mockReturnValue({ eq })
    supabaseMocks.from.mockReturnValue({ select })

    await expect(loadPayablePurchaseItems('purchase-1')).resolves.toEqual([{ id: 'item-1', item_name: 'Leite', mapping_status: 'completa' }])
    expect(supabaseMocks.from).toHaveBeenCalledWith('payable_purchase_items')
    expect(select).toHaveBeenCalledWith('id,purchase_id,item_name,unit,quantity,unit_price,line_total,source_description,source_unit,source_quantity,source_product_code,source_ean,conversion_basis')
    expect(eq).toHaveBeenCalledWith('purchase_id', 'purchase-1')
    expect(order).toHaveBeenCalledWith('source_line_number')
  })

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

  it('usa o vencimento renegociado nos alertas e no link direto da parcela', () => {
    const today = new Date('2026-08-03T12:00:00Z')
    const installment = {
      id: 'installment 1', installment_number: 1, due_date: '2026-08-02', current_due_date: '2026-08-09', amount: 10, status: 'pendente' as const,
    }
    expect(effectiveDueDate(installment)).toBe('2026-08-09')
    expect(isOverdue(installment, today)).toBe(false)
    expect(isDueSoon(installment, today)).toBe(true)
    expect(payableDetailUrl('purchase 1', installment.id)).toBe('/contas-pagar?purchase=purchase+1&installment=installment+1')
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

describe('classificacao financeira da conta a pagar', () => {
  const slices = (...pares: [string, string][]) => pares.map(([categoryKey, amount]) => ({ categoryKey, amount }))

  it('aceita uma categoria que leva o total da conta', () => {
    expect(validateCategorySlices(slices(['cmv_materia_prima', '1000']), 1000)).toBeNull()
  })

  it('aceita o rateio que fecha com o total', () => {
    expect(validateCategorySlices(slices(['cmv_materia_prima', '700'], ['cmv_embalagem', '300']), 1000)).toBeNull()
  })

  // A soma tem de fechar: e ela que garante que os lancamentos gerados somem
  // exatamente o valor pago.
  it('recusa rateio que nao fecha, para mais ou para menos', () => {
    expect(validateCategorySlices(slices(['cmv_materia_prima', '700']), 1000)).toMatch(/igual ao total/i)
    expect(validateCategorySlices(slices(['cmv_materia_prima', '700'], ['cmv_embalagem', '400']), 1000)).toMatch(/igual ao total/i)
  })

  it('recusa categoria repetida', () => {
    expect(validateCategorySlices(slices(['cmv_materia_prima', '500'], ['cmv_materia_prima', '500']), 1000))
      .toMatch(/duas vezes/i)
  })

  it('recusa mais de tres categorias', () => {
    expect(validateCategorySlices(
      slices(['a', '250'], ['b', '250'], ['c', '250'], ['d', '250']), 1000,
    )).toMatch(/no m[áa]ximo 3 categorias/i)
  })

  it('recusa fatia sem categoria ou sem valor', () => {
    expect(validateCategorySlices(slices(['', '1000']), 1000)).toMatch(/ao menos uma categoria/i)
    expect(validateCategorySlices(slices(['cmv_materia_prima', '0']), 1000)).toMatch(/maior que zero/i)
  })

  it('tolera centavos escritos com virgula decimal ja convertidos', () => {
    expect(validateCategorySlices(slices(['cmv_materia_prima', '999.99'], ['cmv_embalagem', '0.01']), 1000)).toBeNull()
  })
})

describe('rateio escrito do jeito brasileiro', () => {
  // Bug encontrado no teste de navegador: digitar "50,00" virava zero e o
  // rateio nunca fechava, com uma mensagem que nao explicava nada.
  it('entende virgula decimal', () => {
    expect(validateCategorySlices(
      [{ categoryKey: 'cmv_materia_prima', amount: '50,00' }, { categoryKey: 'cmv_embalagem', amount: '39,90' }],
      89.9,
    )).toBeNull()
  })

  it('entende ponto de milhar com virgula decimal', () => {
    expect(validateCategorySlices([{ categoryKey: 'cmv_materia_prima', amount: '1.234,56' }], 1234.56)).toBeNull()
  })

  it('continua entendendo ponto decimal, que e como a tela preenche sozinha', () => {
    expect(validateCategorySlices([{ categoryKey: 'cmv_materia_prima', amount: '89.90' }], 89.9)).toBeNull()
  })

  it('recusa texto que nao e dinheiro', () => {
    expect(validateCategorySlices([{ categoryKey: 'cmv_materia_prima', amount: 'abc' }], 89.9)).toMatch(/maior que zero/i)
  })
})
