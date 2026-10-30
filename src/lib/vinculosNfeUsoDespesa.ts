import { currencyLabel, dateLabel, factorLabel } from '@/lib/vinculosNfe'
import type { InvoiceLinkHistory } from '@/lib/vinculosNfeClient'
import type { ConsumptionImpact, ConsumptionRow, FinanceSlice, ItemCorrectionImpact, PurchaseFinance } from '@/lib/vinculosNfeNotas'

/**
 * Fase 5 dos Vínculos de NF-e: item de nota entre uso ou despesa e insumo. O
 * banco devolve o efeito; aqui ele vira frases da padaria: em que pé está a
 * conta (paga, em aberto, livro-caixa), o que muda no consumo das contagens
 * fechadas e o que a próxima nota do fornecedor vai sugerir.
 */

/** Quantos itens a lista mostra de uma vez; a busca refina o resto. */
export const NON_CATALOG_LIST_LIMIT = 60

function monthLabel(value: string | null): string {
  if (!value) return 'mês não registrado'
  const date = new Date(`${value.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return 'mês não registrado'
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(date)
}

function slicesLabel(slices: readonly FinanceSlice[], withMonth: boolean): string {
  return slices.map(slice => `${slice.label} ${currencyLabel(slice.amount)}${withMonth ? ` em ${monthLabel(slice.competence_month)}` : ''}`).join('; ')
}

function itemsOf(impact: ItemCorrectionImpact, purchaseId: string) {
  return impact.items.filter(item => item.purchase_id === purchaseId)
}

/**
 * Uma linha por conta envolvida: situação, quanto saiu do caixa, rateio e livro.
 * Nada disto muda; o aviso aparece quando a categoria da conta não combina com
 * o novo destino do item, para o Financeiro revisar no Contas a pagar.
 */
export function describePurchaseFinance(purchase: PurchaseFinance, impact: ItemCorrectionImpact): string {
  const items = itemsOf(impact, purchase.purchase_id)
  const first = items[0]
  const note = first ? `NF ${first.nfe_number || 'sem número'} de ${first.supplier_name || 'fornecedor não identificado'}` : 'Conta da nota'
  const parts: string[] = []
  if (purchase.installments_paid === 0) {
    parts.push(`conta em aberto (${currencyLabel(purchase.total_value)}), nenhuma parcela paga`)
  } else {
    const paid = `${purchase.installments_paid} de ${purchase.installments} parcela(s) paga(s), ${currencyLabel(purchase.paid_total)} saíram do caixa`
    const last = purchase.last_paid_date ? ` (último pagamento em ${dateLabel(purchase.last_paid_date)})` : ''
    const fees = purchase.late_fees > 0 ? `, dos quais ${currencyLabel(purchase.late_fees)} de juros ou multa` : ''
    parts.push(`conta ${purchase.status === 'paga' ? 'paga' : 'paga em parte'}: ${paid}${last}${fees}`)
  }
  parts.push(purchase.split.length > 0
    ? `categoria de DRE da conta: ${slicesLabel(purchase.split, false)}`
    : 'conta ainda sem categoria de DRE')
  if (purchase.ledger.length > 0) parts.push(`no livro-caixa: ${slicesLabel(purchase.ledger, true)}`)
  let line = `${note} · ${parts.join(' · ')}. Nada disso muda com esta correção.`

  const goesToProduct = items.some(item => item.before.mapping_status === 'nao_aplicavel' && item.after.mapping_status !== 'nao_aplicavel')
  const goesToExpense = items.some(item => item.before.mapping_status !== 'nao_aplicavel' && item.after.mapping_status === 'nao_aplicavel')
  const hasCmv = purchase.split.some(slice => slice.group === 'cmv')
  const onlyCmv = purchase.split.length > 0 && purchase.split.every(slice => slice.group === 'cmv')
  if (goesToProduct && purchase.split.length > 0 && !hasCmv) {
    line += ' Atenção: a categoria da conta não é de custo de mercadoria (CMV); se esta compra é insumo, peça ao Financeiro para revisar a categoria da conta no Contas a pagar.'
  } else if (goesToExpense && onlyCmv) {
    line += ' Atenção: a conta inteira está em custo de mercadoria (CMV); o valor deste item continua lá até o Financeiro revisar a categoria da conta no Contas a pagar.'
  }
  return line
}

function quantity(value: number | null, unit: string | null): string {
  if (value === null) return 'sem dado'
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${unit || 'un'}`
}

function money(value: number | null): string {
  return value === null ? 'sem dado' : currencyLabel(value)
}

const CONSUMPTION_STATUS: Record<string, string> = {
  ok: 'ok',
  sem_par: 'sem as duas contagens',
  nao_contado: 'não contado',
  unidade_mudou: 'unidade mudou',
  incompleto: 'nota sem quantidade útil',
  sem_custo: 'sem custo',
  conferir: 'conferir (consumo negativo)',
}

function statusLabel(row: ConsumptionRow | null): string {
  if (!row) return 'sem linha'
  return CONSUMPTION_STATUS[row.status] ?? row.status
}

function periodLabel(start: string | null, end: string | null): string {
  return `semana de ${dateLabel(start)} a ${dateLabel(end)}`
}

/**
 * O que muda no consumo das contagens fechadas: por produto e por período, e
 * os totais de compras do período (contadas, fora da contagem, não é estoque).
 */
export function describeConsumption(consumption: ConsumptionImpact | null): string[] {
  if (!consumption) return ['Consumo semanal: correção anterior à prévia de consumo.']
  if (consumption.closed_periods === 0) return ['Ainda não há duas contagens semanais fechadas: nenhum consumo semanal muda.']
  if (consumption.items.length === 0 && consumption.periods.length === 0) {
    return ['Nenhuma contagem semanal fechada muda: a nota fica fora das semanas contadas ou não altera o custo de referência.']
  }
  const periods = new Map(consumption.periods.map(period => [period.period_end_count_id, period]))
  const lines = consumption.items.map(item => {
    // A linha traz as datas da semana; correção gravada antes disso cai nos totais do período.
    const period = periods.get(item.period_end_count_id)
    const start = item.start_date ?? period?.start_date ?? null
    const end = item.end_date ?? period?.end_date ?? null
    const when = start || end ? periodLabel(start, end) : 'contagem fechada'
    const before = item.before
    const after = item.after
    return `${when} · ${item.product_name}: entrada ${quantity(before?.qty_in ?? null, item.unit)} → ${quantity(after?.qty_in ?? null, item.unit)}; consumo ${quantity(before?.qty_consumed ?? null, item.unit)} → ${quantity(after?.qty_consumed ?? null, item.unit)}; valor ${money(before?.value_consumed ?? null)} → ${money(after?.value_consumed ?? null)} (${statusLabel(before)} → ${statusLabel(after)}).`
  })
  for (const period of consumption.periods) {
    lines.push(`${periodLabel(period.start_date, period.end_date)} · compras contadas ${currencyLabel(period.before.counted)} → ${currencyLabel(period.after.counted)}; fora da contagem ${currencyLabel(period.before.outside)} → ${currencyLabel(period.after.outside)}; não é estoque ${currencyLabel(period.before.not_stock)} → ${currencyLabel(period.after.not_stock)}.`)
  }
  return lines
}

/**
 * O que a próxima nota do fornecedor vai sugerir para cada item, depois da
 * correção. Uma linha por item; itens com a mesma descrição e o mesmo efeito
 * não repetem a frase, mas efeitos diferentes nunca se escondem.
 */
export function describeMemories(impact: ItemCorrectionImpact): string[] {
  const lines: string[] = []
  for (const item of impact.items) {
    const name = `${item.source_description || 'item sem descrição'} (${item.supplier_name || 'fornecedor não identificado'})`
    const switchedOff = item.memories_before.filter(memory => impact.memories_off.includes(memory.mapping_id))
    const product = item.memories_after.find(memory => memory.kind === 'insumo')
    const expense = item.memories_after.find(memory => memory.kind === 'uso_despesa')
    const resale = item.memories_after.find(memory => memory.kind === 'revenda')
    const toExpense = item.after.mapping_status === 'nao_aplicavel'
    let next: string
    const factor = product?.conversion_factor != null ? ` com fator ${factorLabel(product.conversion_factor)}` : ''
    if (product) next = `a próxima nota sugere ${product.product_name || 'um produto'}${factor}${toExpense ? '; para ela vir como uso ou despesa, desligue essa memória em Memórias de vínculo, na página do produto' : ''}`
    else if (expense) next = 'a próxima nota sugere uso ou despesa'
    else if (resale) next = 'a próxima nota sugere revenda sem cadastro'
    else next = 'a próxima nota chega sem sugestão e quem importa escolhe'
    const off = switchedOff.length === 0 ? ''
      : switchedOff.some(memory => memory.kind === 'revenda') ? 'a memória de revenda sem cadastro deste item será desligada; '
        : 'a memória de uso ou despesa deste item será desligada; '
    const line = `${name}: ${off}${next}.`
    if (!lines.includes(line)) lines.push(line)
  }
  if (impact.action === 'desfazer') lines.push('Desfazer não religa memória desligada: a próxima nota pergunta de novo.')
  return lines
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** Busca na lista de uso ou despesa por fornecedor, descrição ou número da nota. */
export function matchesNonCatalogSearch(item: Pick<InvoiceLinkHistory, 'supplier_name' | 'source_description' | 'invoice_number'>, search: string): boolean {
  const term = normalize(search)
  if (!term) return true
  return [item.supplier_name, item.source_description, item.invoice_number]
    .some(value => normalize(value ?? '').includes(term))
}

/** Situação da conta como a pessoa fala: paga, em aberto ou cancelada. */
export function purchaseStatusLabel(status: string): string {
  if (status === 'paga') return 'conta paga'
  if (status === 'aberta') return 'conta em aberto'
  if (status === 'cancelada') return 'conta cancelada'
  return `conta ${status}`
}
