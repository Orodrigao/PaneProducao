import { describe, expect, it, vi } from 'vitest'
import type { NfeDraft, NfeItemDraft, NfeItemFiscal, NfeTotals } from '@/lib/nfeXml'

// As funções puras não tocam o banco; o cliente só existe aqui para o módulo carregar.
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))
import type { PayableProduct } from '@/lib/payables'
import {
  applyInstallmentDecisions,
  applyItemDecisions,
  extractInstallmentDecisions,
  extractItemDecisions,
  withProduct,
  withoutProduct,
} from '@/lib/xmlImportDrafts'

function fiscal(): NfeItemFiscal {
  return {
    discount: 0, freight: 0, insurance: 0, otherExpenses: 0, importTax: 0,
    icmsSt: 0, fcpSt: 0, ipi: 0, ipiReturned: 0, icmsExempt: 0,
    deductsExemption: null, composesTotal: null,
  }
}

function item(lineNumber: number, quantity = 1, purchaseUnit = 'CX'): NfeItemDraft {
  return {
    lineNumber,
    supplierCode: `COD-${lineNumber}`,
    ean: null,
    description: `ITEM ${lineNumber}`,
    ncm: null,
    quantity,
    purchaseUnit,
    taxQuantity: null,
    taxUnit: null,
    unitPrice: 10,
    grossLineTotal: 10 * quantity,
    discountValue: 0,
    lineTotal: 10 * quantity,
    baseProductId: null,
    baseProductName: null,
    baseUnit: null,
    category: null,
    conversionBasis: 'simple',
    conversionFactor: null,
    usableQuantity: null,
    mappingStatus: 'pendente',
    rememberConversion: true,
    factorConfirmed: false,
    recognized: false,
    fiscal: fiscal(),
  }
}

const totals: NfeTotals = {
  products: 30, discounts: 0, icmsSt: 0, fcpSt: 0, ipi: 0, ipiReturned: 0, freight: 0,
  insurance: 0, otherExpenses: 0, importTax: 0, icmsExempt: 0, services: 0, total: 30,
}

/** A nota como o leitor a devolve, antes de qualquer decisão. */
function freshDraft(): NfeDraft {
  return {
    accessKey: '35260900000000000000550010000000097000000097',
    number: '97',
    series: '1',
    issueDate: '2026-09-10',
    supplierName: 'FORNECEDOR TESTE',
    supplierCnpj: '00000000000191',
    total: 30,
    paymentMethod: 'boleto',
    dueDateSource: 'ausente',
    items: [item(1, 2), item(2), item(3)],
    installments: [{ number: 1, dueDate: '', amount: 30 }],
    totals,
  }
}

const farinha: PayableProduct = { id: 'prod-farinha', name: 'Farinha', unit: 'kg', category: 'Insumos' }
const catalog: readonly PayableProduct[] = [farinha]

describe('decisões do rascunho de importação', () => {
  it('extrai só as decisões da pessoa, por linha, e reaplica sobre a nota relida', () => {
    const classified = freshDraft()
    // Linha 1 vinculada com fator conferido, linha 2 uso/despesa, linha 3 sem decisão.
    classified.items[0] = withProduct({ ...classified.items[0], conversionBasis: 'package' }, farinha, 25, false, true)
    classified.items[1] = withoutProduct(classified.items[1])
    classified.items[1] = { ...classified.items[1], rememberConversion: false }

    const decisions = extractItemDecisions(classified)
    expect(decisions).toEqual([
      { line_number: 1, product_id: 'prod-farinha', conversion_basis: 'package', conversion_factor: 25, mapping_status: 'mapeado', factor_confirmed: true, remember_conversion: true },
      { line_number: 2, product_id: null, conversion_basis: null, conversion_factor: null, mapping_status: 'nao_aplicavel', factor_confirmed: false, remember_conversion: false },
      { line_number: 3, product_id: null, conversion_basis: null, conversion_factor: null, mapping_status: 'pendente', factor_confirmed: false, remember_conversion: true },
    ])

    const resumed = applyItemDecisions(freshDraft(), decisions, catalog)
    expect(resumed.lostLines).toEqual([])
    expect(resumed.draft.items).toEqual(classified.items)
    // O item retomado tem a quantidade útil recalculada: 2 caixas × 25 = 50 kg.
    expect(resumed.draft.items[0].usableQuantity).toBe(50)
  })

  it('item-base que saiu do catálogo volta a pendente e a linha é apontada', () => {
    const decisions = extractItemDecisions({
      ...freshDraft(),
      items: [withProduct(item(1), farinha, 1)],
    })
    const resumed = applyItemDecisions(freshDraft(), decisions, [])
    expect(resumed.lostLines).toEqual([1])
    expect(resumed.draft.items[0].mappingStatus).toBe('pendente')
    expect(resumed.draft.items[0].baseProductId).toBeNull()
  })

  it('decisão de linha que não existe mais é ignorada e linha nova fica pendente', () => {
    const resumed = applyItemDecisions(freshDraft(), [
      { line_number: 9, product_id: 'prod-farinha', conversion_basis: 'simple', conversion_factor: 1, mapping_status: 'mapeado', factor_confirmed: false, remember_conversion: true },
    ], catalog)
    expect(resumed.lostLines).toEqual([])
    expect(resumed.draft.items.every(candidate => candidate.mappingStatus === 'pendente')).toBe(true)
  })

  it('decisão inconsistente (mapeado sem produto ou fator inválido) falha para pendente ou fator 1', () => {
    const resumed = applyItemDecisions(freshDraft(), [
      { line_number: 1, product_id: null, conversion_basis: 'package', conversion_factor: 25, mapping_status: 'mapeado', factor_confirmed: true, remember_conversion: true },
      { line_number: 2, product_id: 'prod-farinha', conversion_basis: 'package', conversion_factor: 0, mapping_status: 'mapeado', factor_confirmed: true, remember_conversion: true },
    ], catalog)
    expect(resumed.draft.items[0].mappingStatus).toBe('pendente')
    expect(resumed.draft.items[1].mappingStatus).toBe('mapeado')
    expect(resumed.draft.items[1].conversionFactor).toBe(1)
  })

  it('vencimento vazio viaja como nulo e o digitado volta na retomada', () => {
    const draft = freshDraft()
    expect(extractInstallmentDecisions(draft)).toEqual([{ installment_number: 1, due_date: null }])

    const typed = { ...draft, installments: [{ number: 1, dueDate: '2026-09-30', amount: 30 }] }
    const decisions = extractInstallmentDecisions(typed)
    expect(decisions).toEqual([{ installment_number: 1, due_date: '2026-09-30' }])
    expect(applyInstallmentDecisions(freshDraft(), decisions).installments[0].dueDate).toBe('2026-09-30')
    // Sem data guardada, o vencimento que o XML trouxe (ou o vazio) permanece.
    expect(applyInstallmentDecisions(freshDraft(), [{ installment_number: 1, due_date: null }]).installments[0].dueDate).toBe('')
  })
})
