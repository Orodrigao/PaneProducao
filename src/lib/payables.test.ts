import { beforeEach, describe, expect, it, vi } from 'vitest'

const supabaseMocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: supabaseMocks.from, rpc: supabaseMocks.rpc } }))
import {
  buildInstallments,
  classifyPayableItem,
  classifyPayableItemWithoutProduct,
  effectiveDueDate,
  getPayableErrorMessage,
  isDueSoon,
  isOverdue,
  loadPayablePurchaseItems,
  overdueDays,
  payableDetailUrl,
  prioritizeOverduePayablePurchases,
  summarizeSupplierPurchaseStatus,
  totalInstallments,
  totalItems,
  validateCategorySlices,
  validateDraft,
  type PayableDraft,
  type PayablePurchaseRow,
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
    supabaseMocks.rpc.mockReset()
  })

  it('envia ao banco a confirmação explícita do fator na classificação posterior', async () => {
    supabaseMocks.rpc.mockResolvedValue({ error: null })

    await classifyPayableItem('item-1', 'product-1', 'package', 1, 1, true, true)

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('classify_payable_item', {
      p_item_id: 'item-1',
      p_product_id: 'product-1',
      p_conversion_basis: 'package',
      p_conversion_factor: 1,
      p_usable_quantity: 1,
      p_remember_conversion: true,
      p_factor_confirmed: true,
    })
  })

  it('resolve item de uso ou despesa sem inventar produto canônico', async () => {
    supabaseMocks.rpc.mockResolvedValue({ error: null })

    await classifyPayableItemWithoutProduct('item-1', true)

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('classify_payable_item_without_product', {
      p_item_id: 'item-1',
      p_remember_decision: true,
    })
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

  it('prioriza no topo as contas com parcela vencida e preserva a ordem das demais', () => {
    const today = new Date('2026-08-03T12:00:00Z')
    const purchases = [
      { id: 'future', purchase_date: '2026-08-03', document_type: 'sem_nota' as const, payment_method: 'boleto' as const, status: 'aberta' as const, total_value: 10, notes: null, suppliers: null, payable_installments: [{ id: 'future-1', installment_number: 1, due_date: '2026-08-10', amount: 10, status: 'pendente' as const }] },
      { id: 'overdue', purchase_date: '2026-08-02', document_type: 'sem_nota' as const, payment_method: 'boleto' as const, status: 'aberta' as const, total_value: 20, notes: null, suppliers: null, payable_installments: [{ id: 'overdue-1', installment_number: 1, due_date: '2026-08-02', amount: 20, status: 'pendente' as const }] },
      { id: 'paid', purchase_date: '2026-08-01', document_type: 'sem_nota' as const, payment_method: 'boleto' as const, status: 'paga' as const, total_value: 30, notes: null, suppliers: null, payable_installments: [{ id: 'paid-1', installment_number: 1, due_date: '2026-08-01', amount: 30, status: 'paga' as const }] },
    ]

    expect(prioritizeOverduePayablePurchases(purchases, today).map(purchase => purchase.id)).toEqual(['overdue', 'future', 'paid'])
    expect(purchases.map(purchase => purchase.id)).toEqual(['future', 'overdue', 'paid'])
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

describe('semáforo de fornecedores para compra', () => {
  const HOJE = new Date('2026-08-18T12:00:00Z')
  const fornecedores = [
    { id: 'aaaaaaaa-0000-0000-0000-00000000000a', name: 'Moinho Anaconda' },
    { id: 'bbbbbbbb-0000-0000-0000-00000000000b', name: 'Frios do Vale' },
  ]

  function compra(overrides: Partial<PayablePurchaseRow> = {}): PayablePurchaseRow {
    return {
      id: 'compra-1', purchase_date: '2026-08-01', document_type: 'nfe', payment_method: 'boleto',
      status: 'aberta', total_value: 100, notes: null,
      supplier_id: 'aaaaaaaa-0000-0000-0000-00000000000a', suppliers: { name: 'Moinho Anaconda' },
      payable_installments: [],
      ...overrides,
    }
  }

  it('trava o fornecedor com boleto vencido e soma parcela, total e dias de atraso', () => {
    const resultado = summarizeSupplierPurchaseStatus(fornecedores, [
      compra({
        payable_installments: [
          { id: 'parcela-1', installment_number: 1, due_date: '2026-08-10', amount: 100.5, status: 'pendente' },
          { id: 'parcela-2', installment_number: 2, due_date: '2026-08-15', amount: 49.5, status: 'pendente' },
        ],
      }),
    ], HOJE)

    expect(resultado[0]).toEqual({
      key: 'aaaaaaaa-0000-0000-0000-00000000000a', name: 'Moinho Anaconda',
      purchaseCount: 1, overdueCount: 2, overdueTotal: 150, oldestOverdueDays: 8,
    })
    expect(resultado[1]).toEqual({
      key: 'bbbbbbbb-0000-0000-0000-00000000000b', name: 'Frios do Vale',
      purchaseCount: 0, overdueCount: 0, overdueTotal: 0, oldestOverdueDays: 0,
    })
  })

  it('fornecedor sem nada vencido fica liberado: parcela paga, futura ou renegociada não trava', () => {
    const resultado = summarizeSupplierPurchaseStatus(fornecedores, [
      compra({
        payable_installments: [
          { id: 'paga', installment_number: 1, due_date: '2026-08-01', amount: 50, status: 'paga' },
          { id: 'futura', installment_number: 2, due_date: '2026-08-25', amount: 50, status: 'pendente' },
          { id: 'renegociada', installment_number: 3, due_date: '2026-08-10', current_due_date: '2026-08-25', amount: 50, status: 'pendente' },
        ],
      }),
    ], HOJE)

    expect(resultado.every(status => status.overdueCount === 0)).toBe(true)
  })

  it('compra cancelada não trava ninguém', () => {
    const resultado = summarizeSupplierPurchaseStatus(fornecedores, [
      compra({
        status: 'cancelada',
        payable_installments: [{ id: 'velha', installment_number: 1, due_date: '2026-08-01', amount: 50, status: 'pendente' }],
      }),
    ], HOJE)

    expect(resultado.every(status => status.overdueCount === 0)).toBe(true)
  })

  it('dívida vencida de fornecedor fora do cadastro ativo continua visível', () => {
    const resultado = summarizeSupplierPurchaseStatus(fornecedores, [
      compra({
        supplier_id: null, suppliers: { name: 'Fornecedor Desativado' },
        payable_installments: [{ id: 'orfa', installment_number: 1, due_date: '2026-08-01', amount: 80, status: 'pendente' }],
      }),
    ], HOJE)

    expect(resultado[0].name).toBe('Fornecedor Desativado')
    expect(resultado[0].overdueCount).toBe(1)
    expect(resultado).toHaveLength(3)
  })

  // Verde tem de significar "olhamos e nao ha nada vencido". Cadastro sem
  // compra nenhuma nao olhou nada: e o caso do fornecedor cadastrado duas
  // vezes, com a divida vencida guardada sob o nome completo da empresa.
  it('cadastro sem compra nenhuma nao conta como liberado', () => {
    const resultado = summarizeSupplierPurchaseStatus(fornecedores, [], HOJE)

    expect(resultado.every(status => status.purchaseCount === 0)).toBe(true)
  })

  it('separa o duplicado sem compra do cadastro que realmente deve', () => {
    const resultado = summarizeSupplierPurchaseStatus(
      [
        { id: 'aaaaaaaa-0000-0000-0000-00000000000a', name: 'Moinho' },
        { id: 'cccccccc-0000-0000-0000-00000000000c', name: 'MOINHO ANACONDA ALIMENTOS LTDA' },
      ],
      [
        compra({
          supplier_id: 'cccccccc-0000-0000-0000-00000000000c',
          suppliers: { name: 'MOINHO ANACONDA ALIMENTOS LTDA' },
          payable_installments: [{ id: 'vencida', installment_number: 1, due_date: '2026-08-05', amount: 90, status: 'pendente' }],
        }),
      ],
      HOJE,
    )

    expect(resultado[0]).toMatchObject({ name: 'MOINHO ANACONDA ALIMENTOS LTDA', purchaseCount: 1, overdueCount: 1 })
    expect(resultado[1]).toMatchObject({ name: 'Moinho', purchaseCount: 0, overdueCount: 0 })
  })

  it('conta as compras nao canceladas do fornecedor liberado', () => {
    const resultado = summarizeSupplierPurchaseStatus(fornecedores, [
      compra({ payable_installments: [{ id: 'paga', installment_number: 1, due_date: '2026-08-01', amount: 50, status: 'paga' }] }),
      compra({ id: 'compra-2', payable_installments: [{ id: 'futura', installment_number: 1, due_date: '2026-08-25', amount: 50, status: 'pendente' }] }),
      compra({ id: 'compra-3', status: 'cancelada', payable_installments: [] }),
    ], HOJE)

    expect(resultado[0]).toMatchObject({ name: 'Moinho Anaconda', purchaseCount: 2, overdueCount: 0 })
  })

  it('ordena travados, depois liberados e por ultimo quem nao tem compra', () => {
    const resultado = summarizeSupplierPurchaseStatus(
      [
        { id: 'aaaaaaaa-0000-0000-0000-00000000000a', name: 'Moinho Anaconda' },
        { id: 'bbbbbbbb-0000-0000-0000-00000000000b', name: 'Frios do Vale' },
        { id: 'cccccccc-0000-0000-0000-00000000000c', name: 'Adega sem compra' },
      ],
      [
        compra({
          supplier_id: 'bbbbbbbb-0000-0000-0000-00000000000b', suppliers: { name: 'Frios do Vale' },
          payable_installments: [{ id: 'paga', installment_number: 1, due_date: '2026-08-01', amount: 10, status: 'paga' }],
        }),
        compra({
          id: 'compra-2',
          payable_installments: [{ id: 'antiga', installment_number: 1, due_date: '2026-08-05', amount: 10, status: 'pendente' }],
        }),
      ],
      HOJE,
    )

    expect(resultado.map(status => status.name)).toEqual(['Moinho Anaconda', 'Frios do Vale', 'Adega sem compra'])
  })

  it('ordena travados primeiro, do atraso mais antigo para o mais novo, e liberados por nome', () => {
    const resultado = summarizeSupplierPurchaseStatus(fornecedores, [
      compra({
        supplier_id: 'bbbbbbbb-0000-0000-0000-00000000000b', suppliers: { name: 'Frios do Vale' },
        payable_installments: [{ id: 'recente', installment_number: 1, due_date: '2026-08-17', amount: 10, status: 'pendente' }],
      }),
      compra({
        id: 'compra-2',
        payable_installments: [{ id: 'antiga', installment_number: 1, due_date: '2026-08-05', amount: 10, status: 'pendente' }],
      }),
    ], HOJE)

    expect(resultado.map(status => status.name)).toEqual(['Moinho Anaconda', 'Frios do Vale'])
  })

  it('conta os dias de atraso pelo vencimento renegociado', () => {
    expect(overdueDays(
      { id: 'p', installment_number: 1, due_date: '2026-08-01', current_due_date: '2026-08-15', amount: 10, status: 'pendente' },
      HOJE,
    )).toBe(3)
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
