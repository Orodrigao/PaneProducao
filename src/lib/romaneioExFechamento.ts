// src/lib/romaneioExFechamento.ts — o Fechamento EX lido de
// `public.list_romaneio_ex_fechamento` (Tabela Buck, fase 3).
//
// O banco monta tudo: as semanas já cobradas, com a foto das linhas e os
// ajustes da confirmação; o que mudou nos romaneios depois de cada cobrança; e
// o que falta cobrar pelo preço do dia de cada romaneio. A tela só traduz e
// soma em centavos. Resposta fora do formato vira erro, nunca um fechamento
// com número faltando.

import type { RomaneioBillingIssue, RomaneioBillingUnit } from './romaneioBilling'
import {
  billingResultFromBuckLines,
  buckIssues,
  type BuckBillingLine,
  type RomaneioExBillingResult,
} from './romaneioExBilling'

export interface FechamentoExAjuste {
  position: number
  /** Chave do banco; o rótulo vem de BUCK_ADJUSTMENT_KIND_LABELS na tela. */
  kind: string
  description: string
  productName: string | null
  quantity: number | null
  unit: string | null
  unitPrice: number | null
  amount: number
}

export type FechamentoExMudancaTipo = 'entregue_depois' | 'saiu_depois'

/** O que mudou num pão da semana depois da cobrança, fora do valor cobrado. */
export interface FechamentoExMudanca {
  key: string
  kind: FechamentoExMudancaTipo
  productName: string
  unit: RomaneioBillingUnit
  /** Com sinal: positivo entregou depois, negativo saiu depois de cobrado. */
  quantity: number
  unitPrice: number | null
  /** Com sinal; nulo quando o pão está sem preço ou com problema na conta. */
  total: number | null
  issues: RomaneioBillingIssue[]
  dates: string[]
}

export interface FechamentoExCobranca {
  receivableId: string
  periodStart: string
  periodEnd: string
  amount: number
  /** Cobrança feita pela função antiga não guardou as linhas. */
  withPhoto: boolean
  lines: RomaneioExBillingResult
  adjustments: FechamentoExAjuste[]
  adjustmentsTotal: number
  changes: FechamentoExMudanca[]
  changesTotal: number
  changesWithoutValue: boolean
}

export interface FechamentoExPeriodo {
  periodStart: string
  periodEnd: string
}

export interface FechamentoEx {
  /** Só quem lê o Contas a receber vê o que foi cobrado. */
  showsBilled: boolean
  toBill: RomaneioExBillingResult
  billed: FechamentoExCobranca[]
  billedTotal: number
  /** Cobranças que começam no período e terminam depois dele. */
  outside: FechamentoExPeriodo[]
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

function fail(what: string): never {
  throw new Error(`O Fechamento EX veio num formato que a tela não conhece (${what}). Nada foi mostrado; atualize a página.`)
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(what)
  return value as Record<string, unknown>
}

function asArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) fail(what)
  return value
}

function asNumber(value: unknown, what: string): number {
  const numeric = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN
  if (value === '' || !Number.isFinite(numeric)) fail(what)
  return numeric
}

function asOptionalNumber(value: unknown, what: string): number | null {
  return value === null || value === undefined ? null : asNumber(value, what)
}

function asText(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value) fail(what)
  return value
}

function asDateKey(value: unknown, what: string): string {
  if (typeof value !== 'string' || !DATE_KEY.test(value)) fail(what)
  return value
}

function cents(value: number): number {
  return Math.round(value * 100)
}

function asBuckLines(value: unknown, what: string): BuckBillingLine[] {
  return asArray(value, what).map(raw => {
    const line = asRecord(raw, what)
    asText(line.product_source, what)
    asText(line.product_id, what)
    asText(line.produto, what)
    asText(line.unidade, what)
    asArray(line.itens, what)
    asNumber(line.quantidade, what)
    // Linha sem problema sempre tem preço e total: sem eles ela sumiria do
    // total sem bloquear a impressão.
    if (asArray(line.problemas, what).length === 0) {
      asNumber(line.preco_unitario, what)
      asNumber(line.total, what)
    }
    return line as unknown as BuckBillingLine
  })
}

function toAdjustment(raw: unknown): FechamentoExAjuste {
  const ajuste = asRecord(raw, 'ajuste')
  return {
    position: asNumber(ajuste.position, 'ajuste'),
    kind: asText(ajuste.kind, 'ajuste'),
    description: typeof ajuste.description === 'string' ? ajuste.description : '',
    productName: typeof ajuste.product_name === 'string' ? ajuste.product_name : null,
    quantity: asOptionalNumber(ajuste.quantity, 'ajuste'),
    unit: typeof ajuste.unit === 'string' ? ajuste.unit : null,
    unitPrice: asOptionalNumber(ajuste.unit_price, 'ajuste'),
    amount: asNumber(ajuste.amount, 'ajuste'),
  }
}

function toChange(raw: unknown, index: number): FechamentoExMudanca {
  const mudanca = asRecord(raw, 'mudança')
  const quantity = asNumber(mudanca.quantidade, 'mudança')
  if (quantity === 0) fail('mudança')
  const issues = buckIssues(Array.isArray(mudanca.problemas) ? mudanca.problemas as string[] : [])
  const total = issues.length ? null : asOptionalNumber(mudanca.total, 'mudança')
  const dates = new Set<string>()
  for (const item of asArray(mudanca.itens, 'mudança')) {
    const date = asRecord(item, 'mudança').record_date
    if (typeof date === 'string' && DATE_KEY.test(date)) dates.add(date)
  }
  const productName = asText(mudanca.produto, 'mudança')
  const unit: RomaneioBillingUnit = mudanca.unidade === 'kg' ? 'kg' : 'un'
  return {
    key: `${mudanca.product_source}:${mudanca.product_id}:${unit}:${mudanca.preco_unitario ?? 'sem-preco'}:${index}`,
    kind: quantity > 0 ? 'entregue_depois' : 'saiu_depois',
    productName,
    unit,
    quantity,
    unitPrice: asOptionalNumber(mudanca.preco_unitario, 'mudança'),
    total,
    issues,
    dates: Array.from(dates).sort(),
  }
}

function toBilled(raw: unknown): FechamentoExCobranca {
  const cobranca = asRecord(raw, 'cobrança')
  const adjustments = asArray(cobranca.ajustes, 'cobrança').map(toAdjustment)
  const changes = asArray(cobranca.depois, 'cobrança').map(toChange)
  return {
    receivableId: asText(cobranca.receivable_id, 'cobrança'),
    periodStart: asDateKey(cobranca.period_start, 'cobrança'),
    periodEnd: asDateKey(cobranca.period_end, 'cobrança'),
    amount: asNumber(cobranca.amount, 'cobrança'),
    withPhoto: cobranca.com_foto === true,
    lines: billingResultFromBuckLines(asBuckLines(cobranca.linhas, 'cobrança')),
    adjustments,
    adjustmentsTotal: adjustments.reduce((sum, ajuste) => sum + cents(ajuste.amount), 0) / 100,
    changes,
    changesTotal: changes.reduce((sum, mudanca) => sum + (mudanca.total === null ? 0 : cents(mudanca.total)), 0) / 100,
    changesWithoutValue: changes.some(mudanca => mudanca.total === null),
  }
}

export function fechamentoExFromPayload(payload: unknown): FechamentoEx {
  const fechamento = asRecord(payload, 'resposta')
  if (typeof fechamento.mostra_cobrado !== 'boolean') fail('resposta')
  const billed = asArray(fechamento.cobrancas, 'cobranças').map(toBilled)
  const outside = asArray(fechamento.fora_do_periodo, 'fora do período').map(raw => {
    const periodo = asRecord(raw, 'fora do período')
    return {
      periodStart: asDateKey(periodo.period_start, 'fora do período'),
      periodEnd: asDateKey(periodo.period_end, 'fora do período'),
    }
  })
  // Sem acesso ao cobrado, o banco nunca manda cobrança; se mandar, é defeito.
  if (!fechamento.mostra_cobrado && (billed.length > 0 || outside.length > 0)) fail('cobrado sem acesso')

  return {
    showsBilled: fechamento.mostra_cobrado,
    toBill: billingResultFromBuckLines(asBuckLines(fechamento.a_cobrar, 'a cobrar')),
    billed,
    billedTotal: billed.reduce((sum, cobranca) => sum + cents(cobranca.amount), 0) / 100,
    outside,
  }
}

export function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function formatQuantity(value: number, unit: RomaneioBillingUnit): string {
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${unit}`
}

/** "2026-09-14" vira "14/09". */
export function formatDayMonth(dateKey: string): string {
  const [, month, day] = dateKey.split('-')
  return `${day}/${month}`
}

function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

function isMondayToSunday(periodStart: string, periodEnd: string): boolean {
  const [year, month, day] = periodStart.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 1 && addDays(periodStart, 6) === periodEnd
}

/** "Semana de 14/09 a 20/09"; período fora de segunda a domingo vira "Cobrança de ...". */
export function billedPeriodLabel(periodStart: string, periodEnd: string): string {
  const prefix = isMondayToSunday(periodStart, periodEnd) ? 'Semana' : 'Cobrança'
  return `${prefix} de ${formatDayMonth(periodStart)} a ${formatDayMonth(periodEnd)}`
}

export function changeLabel(kind: FechamentoExMudancaTipo): string {
  return kind === 'entregue_depois' ? 'entregue depois, não cobrado' : 'saiu do romaneio depois de cobrado'
}

/**
 * Os dias do período que pertencem a uma cobrança que termina depois dele:
 * não estão "a cobrar" e aparecem no período que contém o fim da cobrança.
 */
export function outsideNotice(outside: readonly FechamentoExPeriodo[], rangeFrom: string, rangeTo: string): string | null {
  const sentences = outside.map(periodo => {
    const from = periodo.periodStart > rangeFrom ? periodo.periodStart : rangeFrom
    const to = periodo.periodEnd < rangeTo ? periodo.periodEnd : rangeTo
    const days = from === to ? `O dia ${formatDayMonth(from)} já foi cobrado` : `Os dias ${formatDayMonth(from)} a ${formatDayMonth(to)} já foram cobrados`
    const week = isMondayToSunday(periodo.periodStart, periodo.periodEnd)
    const where = week
      ? `na semana de ${formatDayMonth(periodo.periodStart)} a ${formatDayMonth(periodo.periodEnd)}, que aparece no período que contém o domingo dela`
      : `na cobrança de ${formatDayMonth(periodo.periodStart)} a ${formatDayMonth(periodo.periodEnd)}, que aparece no período que contém o último dia dela`
    return `${days} ${where}.`
  })
  return sentences.length ? sentences.join(' ') : null
}
