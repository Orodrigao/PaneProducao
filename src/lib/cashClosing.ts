export interface CashClosingInput {
  banriAmount: number
  sitefAmount: number
  pixAmount: number
  siteSalesAmount: number
  ifoodSalesAmount: number
  cashWithdrawalAmount: number
  openingCashAmount: number
  closingCashAmount: number
  envelopeAmount: number
  nextDayCashAmount: number
}

export interface CashClosingTotals {
  cashSalesAmount: number
  nonCashPaymentTotal: number
  declaredTotal: number
  cashSplitTotal: number
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

// Duas pessoas no mesmo caixa ao mesmo tempo (08/10/2026, JC: uma salvou, a
// outra tentou salvar por cima de uma tela aberta antes). O banco recusa o
// fechamento novo repetido (uma loja, um fechamento por dia: 23505) e a tela
// recusa a atualizacao feita sobre uma versao que ja mudou (nenhuma linha com o
// updated_at lido: PGRST116). Os dois casos pedem a mesma saida na tela.
export function isCashClosingSaveConflict(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505' || error?.code === 'PGRST116'
}

// Confirma o conflito relendo o banco: houve outra gravacao depois que a tela
// leu. readVersion null = a tela achou que o fechamento era novo.
export function wasSavedMeanwhile(readVersion: string | null, latestVersion: string | null): boolean {
  if (!latestVersion) return false
  return readVersion !== latestVersion
}

export function describeCashClosingConflict(savedBy: string, savedAtTime: string): string {
  const who = savedBy.trim() || 'Outra pessoa'
  const when = savedAtTime ? ` às ${savedAtTime}` : ''
  return `${who} salvou este fechamento${when}, enquanto esta tela estava aberta. Os números da sua tela ainda não foram gravados.`
}

export function calculateCashClosingTotals(input: CashClosingInput): CashClosingTotals {
  const cashSalesAmountCents =
    toCents(input.closingCashAmount)
    + toCents(input.cashWithdrawalAmount)
    - toCents(input.openingCashAmount)

  const nonCashPaymentTotalCents =
    toCents(input.banriAmount)
    + toCents(input.siteSalesAmount)
    + toCents(input.sitefAmount)
    + toCents(input.pixAmount)

  const declaredTotalCents = cashSalesAmountCents + nonCashPaymentTotalCents

  const cashSplitTotalCents =
    toCents(input.envelopeAmount)
    + toCents(input.nextDayCashAmount)

  return {
    cashSalesAmount: fromCents(cashSalesAmountCents),
    nonCashPaymentTotal: fromCents(nonCashPaymentTotalCents),
    declaredTotal: fromCents(declaredTotalCents),
    cashSplitTotal: fromCents(cashSplitTotalCents),
  }
}
