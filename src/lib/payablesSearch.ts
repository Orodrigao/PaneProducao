import type { PayableInstallmentRow, PayablePurchaseRow } from '@/lib/payables'
import { normalizeSearchText, parsePaymentSearch, searchMonth, type PaymentSearchCriteria, type PaymentSearchTerm } from '@/lib/financeSearch'

export interface PayableSearchResult {
  purchase: PayablePurchaseRow
  installment: PayableInstallmentRow
  reasons: string[]
}

export function matchesPayablePurchaseSearch(purchase: PayablePurchaseRow, term: string): boolean {
  const normalizedSearch = term.trim().toLocaleLowerCase('pt-BR')
  const supplier = Array.isArray(purchase.suppliers) ? purchase.suppliers[0] : purchase.suppliers
  const documentLabel = purchase.origin === 'xml'
    ? `NF-e ${purchase.nfe_number ?? 'sem número'}`
    : purchase.document_type === 'sem_nota' ? 'Sem nota' : 'Recibo'
  const legacySearchText = [
    supplier?.name ?? 'Fornecedor não identificado',
    purchase.nfe_number,
    purchase.nfe_key,
    purchase.notes,
    documentLabel,
  ].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR')
  // A lista preserva a busca anterior e encontra parcelas sem recorte de mês.
  return !normalizedSearch || legacySearchText.includes(normalizedSearch)
    || searchPayableInstallments([purchase], {
      term, period: 'all', date: 'paid_date', month: '2026-01',
    }).length > 0
}

function payableMatchReasons(purchase: PayablePurchaseRow, installment: PayableInstallmentRow, term: PaymentSearchTerm): string[] {
  if (term.key) return purchase.nfe_key === term.key ? ['chave da nota'] : []
  const reasons = new Set<string>()
  const supplier = Array.isArray(purchase.suppliers) ? purchase.suppliers[0] : purchase.suppliers
  const fields = [
    { label: 'nome', value: supplier?.name ?? '' },
    { label: 'descrição', value: purchase.notes ?? '' },
    { label: 'nº da nota', value: purchase.nfe_number ?? '' },
  ].map(field => ({ ...field, value: normalizeSearchText(field.value) }))
  if (!term.moneyOnly && term.tokens.every(token => fields.some(field => field.value.includes(token)))) {
    for (const token of term.tokens) for (const field of fields) if (field.value.includes(token)) reasons.add(field.label)
  }
  if (term.cents !== null) {
    if (Math.round(Number(installment.amount) * 100) === term.cents) reasons.add('valor da parcela')
    if (installment.status === 'paga' && installment.paid_amount != null && Math.round(Number(installment.paid_amount) * 100) === term.cents) reasons.add('valor pago')
    if (Math.round(Number(purchase.total_value) * 100) === term.cents) reasons.add('total da nota')
  }
  return [...reasons]
}

export function searchPayableInstallments(purchases: readonly PayablePurchaseRow[], criteria: PaymentSearchCriteria, today?: string): PayableSearchResult[] {
  const term = parsePaymentSearch(criteria.term)
  if (term.text.length < 2) return []
  const month = searchMonth(criteria, today)
  return purchases.flatMap(purchase => purchase.payable_installments.flatMap(installment => {
    // O valor e a data têm de pertencer à MESMA parcela.
    const date = criteria.date === 'competence_month' ? purchase.purchase_date : installment.paid_date
    if (month && (!date || date.slice(0, 7) !== month || (criteria.date === 'paid_date' && installment.status !== 'paga'))) return []
    const reasons = payableMatchReasons(purchase, installment, term)
    return reasons.length ? [{ purchase, installment, reasons }] : []
  })).sort((left, right) => (right.installment.paid_date ?? right.purchase.purchase_date)
    .localeCompare(left.installment.paid_date ?? left.purchase.purchase_date)
    || left.installment.id.localeCompare(right.installment.id))
}
