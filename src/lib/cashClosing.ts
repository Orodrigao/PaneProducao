export interface CashClosingInput {
  salesAmount: number
  banriAmount: number
  sitefAmount: number
  pixAmount: number
  cashAmount: number
  siteSalesAmount: number
  ifoodSalesAmount: number
  totalAmount: number
  cashWithdrawalAmount: number
  openingCashAmount: number
  closingCashAmount: number
  envelopeAmount: number
  nextDayCashAmount: number
}

export interface CashClosingTotals {
  paymentTotal: number
  channelSalesTotal: number
  declaredTotal: number
  paymentDifference: number
  channelDifference: number
  expectedClosingCash: number
  cashDifference: number
  cashSplitTotal: number
  cashSplitDifference: number
}

const MONEY_FORMATTER = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

function toCents(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100)
}

function fromCents(value: number): number {
  return value / 100
}

export function parseMoneyInput(raw: string): number {
  const clean = raw
    .trim()
    .replace(/\s/g, '')
    .replace(/R\$/gi, '')

  if (!clean) return 0

  const normalized = clean.includes(',')
    ? clean.replace(/\./g, '').replace(',', '.')
    : clean

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return fromCents(toCents(parsed))
}

export function formatCurrencyBRL(value: number): string {
  return MONEY_FORMATTER.format(Number.isFinite(value) ? value : 0)
}

export function calculateCashClosingTotals(input: CashClosingInput): CashClosingTotals {
  const paymentTotalCents =
    toCents(input.banriAmount)
    + toCents(input.sitefAmount)
    + toCents(input.pixAmount)
    + toCents(input.cashAmount)

  const channelSalesTotalCents =
    toCents(input.salesAmount)
    + toCents(input.siteSalesAmount)
    + toCents(input.ifoodSalesAmount)

  const declaredTotalCents = toCents(input.totalAmount)
  const expectedClosingCashCents =
    toCents(input.openingCashAmount)
    + toCents(input.cashAmount)
    - toCents(input.cashWithdrawalAmount)

  const cashSplitTotalCents =
    toCents(input.envelopeAmount)
    + toCents(input.nextDayCashAmount)

  return {
    paymentTotal: fromCents(paymentTotalCents),
    channelSalesTotal: fromCents(channelSalesTotalCents),
    declaredTotal: fromCents(declaredTotalCents),
    paymentDifference: fromCents(declaredTotalCents - paymentTotalCents),
    channelDifference: fromCents(declaredTotalCents - channelSalesTotalCents),
    expectedClosingCash: fromCents(expectedClosingCashCents),
    cashDifference: fromCents(toCents(input.closingCashAmount) - expectedClosingCashCents),
    cashSplitTotal: fromCents(cashSplitTotalCents),
    cashSplitDifference: fromCents(toCents(input.closingCashAmount) - cashSplitTotalCents),
  }
}
