// src/lib/romaneioExBilling.ts — o Fechamento EX lido da conta do banco.
//
// A conta (preço do dia de cada romaneio, uma linha por preço) mora em
// `private.calcular_cobranca_buck_detalhada`, a mesma da cobrança semanal. A
// tela só traduz as linhas para o formato que ela já desenhava. Problema
// desconhecido vindo do banco bloqueia a impressão: nunca vira cobrança
// liberada por engano.

import type { RomaneioBillingIssue, RomaneioBillingResult, RomaneioBillingRow, RomaneioBillingUnit } from './romaneioBilling'

export interface BuckBillingLineItem {
  romaneio_id?: string | null
  romaneio_item_id?: string | null
  record_date?: string | null
  qty_sent?: number | string | null
}

export interface BuckBillingLine {
  product_source: string
  product_id: string
  produto: string
  unidade: string
  quantidade: number | string | null
  preco_unitario: number | string | null
  total: number | string | null
  problemas: string[] | null
  itens: BuckBillingLineItem[] | null
}

export interface RomaneioExBillingRow extends RomaneioBillingRow {
  firstDate: string | null
  lastDate: string | null
  /** O mesmo produto aparece em mais de uma linha porque o preço mudou no período. */
  priceChanged: boolean
}

export interface RomaneioExBillingResult extends Omit<RomaneioBillingResult, 'rows'> {
  rows: RomaneioExBillingRow[]
}

const KNOWN_ISSUES: ReadonlySet<string> = new Set<RomaneioBillingIssue>(['missing_price', 'unit_mismatch', 'suspicious_quantity'])

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function toIssues(problemas: string[] | null): RomaneioBillingIssue[] {
  const issues: RomaneioBillingIssue[] = []
  for (const problema of problemas ?? []) {
    const issue: RomaneioBillingIssue = KNOWN_ISSUES.has(problema) ? problema as RomaneioBillingIssue : 'missing_price'
    if (!issues.includes(issue)) issues.push(issue)
  }
  return issues
}

function toUnit(unidade: string): RomaneioBillingUnit {
  return unidade === 'kg' ? 'kg' : 'un'
}

export function billingResultFromBuckLines(lines: readonly BuckBillingLine[]): RomaneioExBillingResult {
  const linesPerProduct = new Map<string, number>()
  for (const line of lines) {
    const productKey = `${line.product_source}:${line.product_id}:${line.produto}:${line.unidade}`
    linesPerProduct.set(productKey, (linesPerProduct.get(productKey) ?? 0) + 1)
  }

  const trips = new Set<string>()
  let itemCount = 0
  let totalCents = 0

  const rows = lines.map((line, index): RomaneioExBillingRow => {
    const itens = line.itens ?? []
    const issues = toIssues(line.problemas)
    const unitPrice = toNumber(line.preco_unitario)
    const total = toNumber(line.total)
    const rowTrips = new Set<string>()
    const dates: string[] = []
    let sentQuantity = 0
    for (const item of itens) {
      if (item.romaneio_id) {
        rowTrips.add(item.romaneio_id)
        trips.add(item.romaneio_id)
      }
      if (item.record_date) dates.push(item.record_date)
      sentQuantity += Math.max(0, toNumber(item.qty_sent) ?? 0)
    }
    dates.sort()
    itemCount += itens.length
    const blocked = issues.length > 0
    if (!blocked && total !== null) totalCents += Math.round(total * 100)
    const productKey = `${line.product_source}:${line.product_id}:${line.produto}:${line.unidade}`

    return {
      key: `${productKey}:${unitPrice ?? 'sem-preco'}:${index}`,
      itemIds: itens.map(item => item.romaneio_item_id).filter((id): id is string => Boolean(id)),
      productId: line.product_id,
      productSource: line.product_source,
      productName: line.produto,
      billingUnit: toUnit(line.unidade),
      sentQuantity,
      billedQuantity: Math.max(0, toNumber(line.quantidade) ?? 0),
      tripCount: rowTrips.size,
      unitPrice: blocked ? null : unitPrice,
      total: blocked ? null : total,
      issues,
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
      priceChanged: (linesPerProduct.get(productKey) ?? 0) > 1,
    }
  })

  return {
    rows,
    total: totalCents / 100,
    tripCount: trips.size,
    itemCount,
    hasBlockingIssues: rows.some(row => row.issues.length > 0),
  }
}

function dayMonth(dateKey: string): string {
  const [, month, day] = dateKey.split('-')
  return `${day}/${month}`
}

/** "de 05/10 a 08/10", para a linha de um produto cujo preço mudou no período. */
export function billingRowPeriodLabel(row: Pick<RomaneioExBillingRow, 'firstDate' | 'lastDate'>): string | null {
  if (!row.firstDate || !row.lastDate) return null
  if (row.firstDate === row.lastDate) return `em ${dayMonth(row.firstDate)}`
  return `de ${dayMonth(row.firstDate)} a ${dayMonth(row.lastDate)}`
}

/** A função ainda não existe no banco (janela do deploy): a tela usa a conta antiga. */
export function isMissingBuckBillingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === 'PGRST202' || error.code === '42883' || (error.message ?? '').includes('list_romaneio_ex_billing')
}
