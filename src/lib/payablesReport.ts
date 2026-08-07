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

export interface PayablesReportExportRow {
  fornecedor: string
  documento: string
  data_compra: string
  parcela: number
  vencimento: string
  baixa: string
  situacao: string
  valor: number
  criterio: string
}

function numeric(value: number | string): number {
  return Number(value) || 0
}

function dateOnly(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null
}

function supplierName(purchase: PayablePurchaseRow): string {
  const related = purchase.suppliers
  return (Array.isArray(related) ? related[0]?.name : related?.name) ?? 'Fornecedor não identificado'
}

function documentLabel(purchase: PayablePurchaseRow): string {
  if (purchase.origin === 'xml') return `NF-e ${purchase.nfe_number ?? 'sem número'}`
  return purchase.document_type === 'sem_nota' ? 'Sem nota' : 'Recibo'
}

function statusLabel(status: PayableInstallmentRow['status']): string {
  if (status === 'paga') return 'Paga'
  if (status === 'cancelada') return 'Cancelada'
  return 'Pendente'
}

function basisLabel(basis: PayablesReportRow['basis']): string {
  if (basis === 'baixa') return 'Data da baixa'
  if (basis === 'vencimento_e_baixa') return 'Vencimento e baixa'
  if (basis === 'vencimento') return 'Data do vencimento'
  return 'Data da compra'
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

export function buildPayablesReportExportRows(result: PayablesReportResult): PayablesReportExportRow[] {
  return result.rows.map(row => ({
    fornecedor: supplierName(row.purchase),
    documento: documentLabel(row.purchase),
    data_compra: dateOnly(row.purchase.purchase_date) ?? '',
    parcela: row.installment.installment_number,
    vencimento: dateOnly(row.installment.due_date) ?? '',
    baixa: dateOnly(row.installment.paid_at) ?? '',
    situacao: statusLabel(row.installment.status),
    valor: numeric(row.installment.amount),
    criterio: basisLabel(row.basis),
  }))
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
