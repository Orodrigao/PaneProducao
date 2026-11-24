import { parseMoneyInput } from '@/lib/cashClosing'
import { bakeryDayKey } from '@/lib/bakeryClock'
import type { FinanceEntryRow } from '@/lib/finance'

export type SearchPeriod = 'all' | 'current' | 'previous' | 'chosen'
export type SearchDate = 'paid_date' | 'competence_month'
export interface PaymentSearchCriteria {
  term: string
  period: SearchPeriod
  date: SearchDate
  month: string
}
export interface PaymentSearchTerm {
  text: string
  tokens: string[]
  cents: number | null
  key: string | null
  moneyOnly: boolean
}

export function normalizeSearchText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b0+(?=\d)/g, '')
}

export function parsePaymentSearch(raw: string): PaymentSearchTerm {
  const text = raw.trim()
  const digits = text.replace(/\s/g, '')
  const key = /^\d{44}$/.test(digits) ? digits : null
  const money = /^(?:R\$\s*)?\d+(?:\.\d{3})*(?:,\d{1,2})?$/i.test(text)
  const moneyOnly = money && /[,.]|R\$/i.test(text)
  // parseMoneyInput não interpreta ponto de milhar sem vírgula.
  const moneyText = text.includes('.') && !text.includes(',') ? text.replace(/\./g, '') : text
  const amount = money && !key ? parseMoneyInput(moneyText) : NaN
  return { text, tokens: normalizeSearchText(text).split(/\s+/).filter(Boolean),
    cents: Number.isFinite(amount) && Number.isSafeInteger(Math.round(amount * 100)) ? Math.round(amount * 100) : null,
    key, moneyOnly }
}

export function searchMonth(criteria: PaymentSearchCriteria, today = bakeryDayKey()): string | null {
  if (criteria.period === 'all') return null
  if (criteria.period === 'chosen') return criteria.month
  const month = today.slice(0, 7)
  if (criteria.period === 'current') return month
  const [year, number] = month.split('-').map(Number)
  return number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, '0')}`
}

const LETTERS: Record<string, string> = {
  a: '[aAáÁàÀâÂãÃäÄ]', e: '[eEéÉèÈêÊëË]', i: '[iIíÍìÌîÎïÏ]',
  o: '[oOóÓòÒôÔõÕöÖ]', u: '[uUúÚùÙûÛüÜ]', c: '[cCçÇ]',
}

/** Literal de regex PostgreSQL, depois literal entre aspas do PostgREST. */
export function searchRegex(token: string): string {
  return [...normalizeSearchText(token)].map(char => LETTERS[char]
    ?? (/[.*+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char)).join('')
}

export function postgrestQuoted(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function ledgerSearchFilter(term: PaymentSearchTerm): string {
  const text = term.tokens.map(token => `description.imatch.${postgrestQuoted(searchRegex(token))}`)
  const amount = term.cents === null ? [] : [`amount.eq.${term.cents / 100}`, `planned_amount.eq.${term.cents / 100}`]
  if (term.moneyOnly) return amount.length ? amount.join(',') : 'id.is.null'
  return [...(text.length > 1 ? [`and(${text.join(',')})`] : text), ...amount].join(',')
}

export function ledgerMatchReasons(entry: FinanceEntryRow, term: PaymentSearchTerm): string[] {
  const reasons: string[] = []
  if (!term.moneyOnly && term.tokens.every(token => normalizeSearchText(entry.description).includes(token))) reasons.push('descrição')
  if (term.cents !== null && Math.round(Number(entry.amount) * 100) === term.cents) reasons.push('valor desta linha')
  if (term.cents !== null && Math.round(Number(entry.planned_amount) * 100) === term.cents) reasons.push('valor previsto desta linha')
  return reasons
}

export const READ_PAGE_SIZE = 500
interface CountedPage<T> { data: T[] | null; count: number | null; error: unknown }

/** Nunca devolve uma lista parcial: inclusive mudanças de contagem entre páginas falham. */
export async function readCompletePages<T>(read: (from: number, to: number) => PromiseLike<CountedPage<T>>): Promise<T[]> {
  const rows: T[] = []
  let expected: number | null = null
  do {
    const page = await read(rows.length, rows.length + READ_PAGE_SIZE - 1)
    if (page.error) throw page.error
    if (typeof page.count !== 'number' || !Number.isSafeInteger(page.count) || page.count < 0
      || (expected !== null && page.count !== expected)) throw new Error('A contagem mudou ou não foi informada. Tente novamente.')
    expected = page.count
    if (!page.data || (!page.data.length && rows.length < expected)) throw new Error('A leitura ficou incompleta. Tente novamente.')
    rows.push(...page.data)
    if (rows.length > expected) throw new Error('A leitura divergiu da contagem. Tente novamente.')
  } while (rows.length < expected)
  const ids = rows.map(row => (row as { id?: string }).id).filter(Boolean)
  if (new Set(ids).size !== ids.length) throw new Error('A leitura repetiu registros. Tente novamente.')
  return rows
}

export type LedgerSearchIdentity = Pick<FinanceEntryRow, 'id' | 'source' | 'source_ref'>
export function ledgerPaymentKey(row: LedgerSearchIdentity): string {
  return row.source === 'contas_pagar' && row.source_ref ? `payable:${row.source_ref}` : `entry:${row.id}`
}
export function uniqueLedgerPayments(rows: LedgerSearchIdentity[], excluded: ReadonlySet<string>): LedgerSearchIdentity[] {
  const seen = new Set<string>()
  return rows.filter(row => {
    if (row.source === 'contas_pagar' && row.source_ref && excluded.has(row.source_ref)) return false
    const key = ledgerPaymentKey(row)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Compartilhado entre buscar, filtros, limpar, atualizar e mostrar mais. */
export function createSearchSequence() {
  let current = 0
  return { next: () => ++current, isCurrent: (ticket: number) => ticket === current }
}
