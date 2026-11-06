export interface CashClosingInput {
  banriCreditAmount: number
  banriDebitAmount: number
  banriPixAmount: number
  stoneCreditAmount: number
  stoneDebitAmount: number
  stonePixAmount: number
  sitefCreditAmount: number
  sitefDebitAmount: number
  sitefPixAmount: number
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
  'banriCreditAmount',
  'banriDebitAmount',
  'banriPixAmount',
  'stoneCreditAmount',
  'stoneDebitAmount',
  'stonePixAmount',
  'sitefCreditAmount',
  'sitefDebitAmount',
  'sitefPixAmount',
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
    + toCents(input.banriCreditAmount)
    + toCents(input.banriDebitAmount)
    + toCents(input.banriPixAmount)
    + toCents(input.stoneCreditAmount)
    + toCents(input.stoneDebitAmount)
    + toCents(input.stonePixAmount)
    + toCents(input.sitefCreditAmount)
    + toCents(input.sitefDebitAmount)
    + toCents(input.sitefPixAmount)

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

export const CLOSING_FIELDS: { key: keyof CashClosingInput; column: string; label: string; helper?: string }[] = [
  { key: 'closingCashAmount', column: 'closing_cash_amount', label: '1. Total em dinheiro', helper: 'todo dinheiro físico contado no caixa' },
  { key: 'cashWithdrawalAmount', column: 'cash_withdrawal_amount', label: '2. Sangrias', helper: 'retiradas feitas durante o dia' },
  { key: 'banriAmount', column: 'banri_amount', label: '3. Banrisul crédito e débito (formato antigo)' },
  { key: 'stoneAmount', column: 'stone_amount', label: '4. Stone crédito e débito (formato antigo)' },
  { key: 'sitefAmount', column: 'sitef_amount', label: '5. SiTef (formato antigo)' },
  { key: 'banriCreditAmount', column: 'banri_credit_amount', label: 'Banrisul crédito' },
  { key: 'banriDebitAmount', column: 'banri_debit_amount', label: 'Banrisul débito' },
  { key: 'banriPixAmount', column: 'banri_pix_amount', label: 'Banrisul PIX' },
  { key: 'stoneCreditAmount', column: 'stone_credit_amount', label: 'Stone crédito' },
  { key: 'stoneDebitAmount', column: 'stone_debit_amount', label: 'Stone débito' },
  { key: 'stonePixAmount', column: 'stone_pix_amount', label: 'Stone PIX' },
  { key: 'sitefCreditAmount', column: 'sitef_credit_amount', label: 'SiTef crédito' },
  { key: 'sitefDebitAmount', column: 'sitef_debit_amount', label: 'SiTef débito' },
  { key: 'sitefPixAmount', column: 'sitef_pix_amount', label: 'SiTef PIX' },
  { key: 'pixAmount', column: 'pix_amount', label: '6. PIX direto na conta (sem maquininha)' },
  { key: 'openingCashAmount', column: 'opening_cash_amount', label: '7. Abertura do caixa', helper: 'desconta do dinheiro contado' },
  { key: 'ifoodSalesAmount', column: 'ifood_sales_amount', label: '8. iFood', helper: 'informativo, não soma ao caixa' },
  { key: 'food99SalesAmount', column: 'food99_sales_amount', label: '9. 99Food', helper: 'informativo, não soma ao caixa' },
  { key: 'envelopeAmount', column: 'envelope_amount', label: '10. Envelope', helper: 'informativo, malote/depósito' },
  { key: 'nextDayCashAmount', column: 'next_day_cash_amount', label: '11. Próximo dia', helper: 'informativo, abertura seguinte' },
]
export type CashClosingForm = Record<keyof CashClosingInput, string>
export const EMPTY_CLOSING_FORM = Object.fromEntries(CLOSING_FIELDS.map(f => [f.key, ''])) as CashClosingForm
export type CashClosingMoneyRow = Partial<Record<'closing_cash_amount' | 'cash_withdrawal_amount' | 'banri_amount' | 'stone_amount' | 'sitef_amount' | 'banri_credit_amount' | 'banri_debit_amount' | 'banri_pix_amount' | 'stone_credit_amount' | 'stone_debit_amount' | 'stone_pix_amount' | 'sitef_credit_amount' | 'sitef_debit_amount' | 'sitef_pix_amount' | 'pix_amount' | 'opening_cash_amount' | 'ifood_sales_amount' | 'food99_sales_amount' | 'envelope_amount' | 'next_day_cash_amount' | 'site_sales_amount', number>>

export function isLegacyCashClosing(row: CashClosingMoneyRow | null): boolean {
  return Boolean(row && ['banri_amount', 'stone_amount', 'sitef_amount', 'site_sales_amount'].some(key => Number(row[key as keyof CashClosingMoneyRow] ?? 0) > 0))
}

export function cashClosingFormToInput(form: CashClosingForm): CashClosingInput {
  return Object.fromEntries(CLOSING_FIELDS.map(f => [f.key, parseMoneyInput(form[f.key])])) as unknown as CashClosingInput
}

export function cashClosingRowToForm(row: CashClosingMoneyRow): CashClosingForm {
  return Object.fromEntries(CLOSING_FIELDS.map(f => {
    const amount = Number(row[f.column as keyof CashClosingMoneyRow] ?? 0) + (f.key === 'stoneAmount' ? Number(row.site_sales_amount ?? 0) : 0)
    return [f.key, amount ? amount.toFixed(2).replace('.', ',') : '']
  })) as CashClosingForm
}

export const CASH_CLOSING_MACHINES = [
  { title: '3. Banrisul', label: 'Banrisul', keys: ['banriCreditAmount', 'banriDebitAmount', 'banriPixAmount'] },
  { title: '4. Stone', label: 'Stone', keys: ['stoneCreditAmount', 'stoneDebitAmount', 'stonePixAmount'] },
  { title: '5. SiTef', label: 'SiTef', keys: ['sitefCreditAmount', 'sitefDebitAmount', 'sitefPixAmount'] },
] as const

export function cashClosingMachineSubtotal(input: CashClosingInput, keys: readonly (keyof CashClosingInput)[]): number {
  return fromCents(keys.reduce((sum, key) => sum + toCents(input[key]), 0))
}

export function showCashClosingSitef(store: string, input: CashClosingInput): boolean {
  return store === 'jc' || input.sitefAmount > 0 || CASH_CLOSING_MACHINES[2].keys.some(key => input[key] > 0)
}

export function buildCashClosingRequest(input: CashClosingInput, meta: { requestId: string; store: string; date: string; updatedAt: string | null; notes: string }) {
  return {
    p_request_id: meta.requestId, p_store: meta.store, p_closing_date: meta.date, p_updated_at: meta.updatedAt,
    p_closing_cash_amount: input.closingCashAmount,
    p_cash_withdrawal_amount: input.cashWithdrawalAmount,
    p_opening_cash_amount: input.openingCashAmount,
    p_banri_amount: input.banriAmount,
    p_banri_credit_amount: input.banriCreditAmount,
    p_banri_debit_amount: input.banriDebitAmount,
    p_banri_pix_amount: input.banriPixAmount,
    p_stone_amount: input.stoneAmount,
    p_stone_credit_amount: input.stoneCreditAmount,
    p_stone_debit_amount: input.stoneDebitAmount,
    p_stone_pix_amount: input.stonePixAmount,
    p_sitef_amount: input.sitefAmount,
    p_sitef_credit_amount: input.sitefCreditAmount,
    p_sitef_debit_amount: input.sitefDebitAmount,
    p_sitef_pix_amount: input.sitefPixAmount,
    p_pix_amount: input.pixAmount,
    p_ifood_sales_amount: input.ifoodSalesAmount,
    p_food99_sales_amount: input.food99SalesAmount,
    p_envelope_amount: input.envelopeAmount,
    p_next_day_cash_amount: input.nextDayCashAmount,
    p_notes: meta.notes.trim() || null,
  }
}
