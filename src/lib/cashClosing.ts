export interface CashClosingInput {
  banriAmount: number
  sitefAmount: number
  pixAmount: number
  stoneAmount: number
  food99SalesAmount: number
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

// A função do banco devolve PT409 quando a versão lida já mudou.
export function isCashClosingSaveConflict(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PT409'
}

// Sem resposta do banco (rede caiu, requisicao cancelada) ou com erro do
// gateway, nao da para saber se a gravacao chegou: a tela precisa reler antes
// de decidir.
export function isUncertainWriteResult(result: { status: number }): boolean {
  return result.status === 0 || result.status >= 500
}

// Confirma o conflito relendo o banco: houve outra gravacao depois que a tela
// leu. readVersion null = a tela achou que o fechamento era novo.
export function wasSavedMeanwhile(readVersion: string | null, latestVersion: string | null): boolean {
  if (!latestVersion) return false
  return readVersion !== latestVersion
}

export function describeCashClosingConflict(savedBy: string, savedAt: string, own = false): string {
  const when = savedAt ? ` em ${savedAt}` : ''
  if (own) {
    return `Você já tinha salvo este fechamento${when}, em outra tentativa ou em outro aparelho, com números ou observações diferentes. O que está nesta tela ainda não foi gravado.`
  }
  const who = savedBy.trim() || 'Outra pessoa'
  return `${who} salvou este fechamento${when}, enquanto esta tela estava aberta. Os números da sua tela ainda não foram gravados.`
}

const CASH_CLOSING_INPUT_KEYS: (keyof CashClosingInput)[] = [
  'closingCashAmount',
  'cashWithdrawalAmount',
  'banriAmount',
  'stoneAmount',
  'sitefAmount',
  'pixAmount',
  'openingCashAmount',
  'ifoodSalesAmount',
  'food99SalesAmount',
  'envelopeAmount',
  'nextDayCashAmount',
]

// Campos em que o fechamento salvo e o da tela divergem, ao centavo: mesmo
// total com divisao diferente (Banrisul x Stone) tambem e diferenca.
export function cashClosingDifferences(
  saved: CashClosingInput,
  mine: CashClosingInput,
): (keyof CashClosingInput)[] {
  return CASH_CLOSING_INPUT_KEYS.filter(key => toCents(saved[key]) !== toCents(mine[key]))
}

// Quem substitui deixa nas observacoes o que estava gravado antes (total,
// cada campo que muda e as observacoes da outra pessoa): o numero que perdeu
// nao some sem rastro.
export function notesWithReplacement(
  notes: string,
  replaced: {
    savedBy: string
    savedAt: string
    totalAmount: number
    fields: { label: string; amount: number }[]
    savedNotes: string | null
  },
): string {
  const who = replaced.savedBy.trim() || 'outra pessoa'
  const when = replaced.savedAt ? ` em ${replaced.savedAt}` : ''
  const amounts = [
    `total do dia ${formatCurrencyBRL(replaced.totalAmount)}`,
    ...replaced.fields.map(field => `${field.label} ${formatCurrencyBRL(field.amount)}`),
  ]
  const current = notes.trim()
  let previous = (replaced.savedNotes ?? '').trim()
  // O que a tela ja traz nao se repete dentro da anotacao: sem isso, trocas
  // seguidas de "Substituir" aninham e dobram o texto a cada rodada.
  if (current && previous.startsWith(current)) previous = previous.slice(current.length).trim()
  if (previous.length > REPLACED_NOTES_LIMIT) previous = `${previous.slice(0, REPLACED_NOTES_LIMIT)}…`
  const previousNotes = previous ? ` Obs. de ${who}: ${previous}` : ''
  const line = `[Substituiu o fechamento que ${who} salvou${when}: ${amounts.join('; ')}.${previousNotes}]`
  return current ? `${current}\n${line}` : line
}

const REPLACED_NOTES_LIMIT = 300

export function calculateCashClosingTotals(input: CashClosingInput): CashClosingTotals {
  const cashSalesAmountCents =
    toCents(input.closingCashAmount)
    + toCents(input.cashWithdrawalAmount)
    - toCents(input.openingCashAmount)

  const nonCashPaymentTotalCents =
    toCents(input.banriAmount)
    + toCents(input.stoneAmount)
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

export function cashClosingSaveErrorMessage(error: { code?: string; message?: string }, status?: number): string {
  if (error.code === 'PGRST202' || status === 404) return 'O sistema está sendo atualizado; seus números continuam na tela. Aguarde um minuto e toque em Salvar de novo.'
  if (error.code === '42501') return 'Sem permissão para fechar o caixa desta loja.'
  return error.message ? 'Erro ao salvar: ' + error.message : 'Não foi possível salvar. Seus números continuam na tela.'
}

/** Parâmetros do link do livro: data estrita, loja só para quem pode trocar. */
export function cashClosingInitialSelection(search: string, canChangeStore: boolean, today: string): { date?: string; store?: 'jc' | 'ja' | 'ex' } {
  const params = new URLSearchParams(search)
  const date = params.get('data') ?? ''
  const store = params.get('loja')
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= '0001-01-01' && date <= today
    && Number.isFinite(new Date(date + 'T12:00:00Z').getTime())
    && new Date(date + 'T12:00:00Z').toISOString().slice(0, 10) === date
  return {
    ...(validDate ? { date } : {}),
    ...(canChangeStore && (store === 'jc' || store === 'ja' || store === 'ex') ? { store } : {}),
  }
}
