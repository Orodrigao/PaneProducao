import {
  isOverdue,
  roundMoney,
  type PayableInstallmentRow,
  type PayablePurchaseRow,
} from './payables'

export type PayablesReportMode = 'compras' | 'financeiro'

export interface PayablesReportFilters {
  mode: PayablesReportMode
  from: string
  to: string
}

export interface PayablesReportRow {
  purchase: PayablePurchaseRow
  installment: PayableInstallmentRow
  dueInPeriod: boolean
  paidInPeriod: boolean
  basis: 'compra' | 'vencimento' | 'baixa' | 'vencimento_e_baixa'
}

export interface PayablesReportSummary {
  purchaseCount: number
  installmentCount: number
  purchaseTotal: number
  scheduledTotal: number
  paidTotal: number
  openTotal: number
  overdueTotal: number
}

export interface PayablesReportResult {
  mode: PayablesReportMode
  purchases: PayablePurchaseRow[]
  rows: PayablesReportRow[]
  summary: PayablesReportSummary
}

function numeric(value: number | string): number {
  return Number(value) || 0
}

function dateOnly(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null
}

function inPeriod(value: string | null | undefined, from: string, to: string): boolean {
  const date = dateOnly(value)
  return !!date && date >= from && date <= to
}

function sumRows(rows: PayablesReportRow[], predicate: (row: PayablesReportRow) => boolean): number {
  return roundMoney(rows.reduce((total, row) => predicate(row) ? total + numeric(row.installment.amount) : total, 0))
}

function emptyResult(mode: PayablesReportMode): PayablesReportResult {
  return {
    mode,
    purchases: [],
    rows: [],
    summary: { purchaseCount: 0, installmentCount: 0, purchaseTotal: 0, scheduledTotal: 0, paidTotal: 0, openTotal: 0, overdueTotal: 0 },
  }
}

export function buildPayablesReport(
  purchases: PayablePurchaseRow[],
  filters: PayablesReportFilters,
  today = new Date(),
): PayablesReportResult {
  if (!filters.from || !filters.to || filters.from > filters.to) return emptyResult(filters.mode)

  if (filters.mode === 'compras') {
    const selectedPurchases = purchases.filter(purchase => inPeriod(purchase.purchase_date, filters.from, filters.to))
    const rows = selectedPurchases.flatMap(purchase => (purchase.payable_installments ?? []).map(installment => ({
      purchase,
      installment,
      dueInPeriod: inPeriod(installment.due_date, filters.from, filters.to),
      paidInPeriod: installment.status === 'paga' && inPeriod(installment.paid_at, filters.from, filters.to),
      basis: 'compra' as const,
    })))

    return {
      mode: filters.mode,
      purchases: selectedPurchases,
      rows,
      summary: {
        purchaseCount: selectedPurchases.length,
        installmentCount: rows.length,
        purchaseTotal: roundMoney(selectedPurchases.reduce((total, purchase) => total + numeric(purchase.total_value), 0)),
        scheduledTotal: sumRows(rows, () => true),
        paidTotal: sumRows(rows, row => row.installment.status === 'paga'),
        openTotal: sumRows(rows, row => row.installment.status === 'pendente'),
        overdueTotal: sumRows(rows, row => row.installment.status === 'pendente' && isOverdue(row.installment, today)),
      },
    }
  }

  const rows = purchases.flatMap(purchase => (purchase.payable_installments ?? []).flatMap(installment => {
    const dueInPeriod = inPeriod(installment.due_date, filters.from, filters.to)
    const paidInPeriod = installment.status === 'paga' && inPeriod(installment.paid_at, filters.from, filters.to)
    if (!dueInPeriod && !paidInPeriod) return []
    return [{
      purchase,
      installment,
      dueInPeriod,
      paidInPeriod,
      basis: dueInPeriod && paidInPeriod ? 'vencimento_e_baixa' as const : dueInPeriod ? 'vencimento' as const : 'baixa' as const,
    }]
  }))
  const selectedPurchases = Array.from(new Map(rows.map(row => [row.purchase.id, row.purchase])).values())

  return {
    mode: filters.mode,
    purchases: selectedPurchases,
    rows,
    summary: {
      purchaseCount: selectedPurchases.length,
      installmentCount: rows.length,
      purchaseTotal: 0,
      scheduledTotal: sumRows(rows, row => row.dueInPeriod),
      paidTotal: sumRows(rows, row => row.paidInPeriod),
      openTotal: sumRows(rows, row => row.dueInPeriod && row.installment.status === 'pendente'),
      overdueTotal: sumRows(rows, row => row.dueInPeriod && row.installment.status === 'pendente' && isOverdue(row.installment, today)),
    },
  }
}
