import { nonCatalogKindLabel, readNonCatalogKind, type NfeNonCatalogKind } from '@/lib/nfeXml'
import { currencyLabel, dateLabel, factorLabel } from '@/lib/vinculosNfe'
import type { InvoiceLinkHistory } from '@/lib/vinculosNfeClient'
import type { ConsumptionImpact, ConsumptionRow, FinanceSlice, ItemCorrectionImpact, ItemImpact, ItemSnapshot, MemoryChange, MemoryRef, PurchaseFinance } from '@/lib/vinculosNfeNotas'

/**
 * Fase 5 dos Vínculos de NF-e e fase 3 da revenda sem cadastro: item de nota
 * entre uso ou despesa, revenda sem cadastro e produto. O banco devolve o
 * efeito; aqui ele vira frases da padaria: em que pé está a conta (paga, em
 * aberto, livro-caixa), o que muda no consumo das contagens fechadas e o que a
 * próxima nota do fornecedor vai sugerir.
 */

/** Quantos itens a lista mostra de uma vez; a busca refina o resto. */
export const NON_CATALOG_LIST_LIMIT = 60

/** Para onde o item vai (ou de onde sai): um produto ou um dos tipos de fora do cadastro. */
export type ItemSide = 'produto' | NfeNonCatalogKind

export function itemSide(state: Pick<ItemSnapshot, 'mapping_status' | 'non_catalog_kind'>): ItemSide {
  if (state.mapping_status !== 'nao_aplicavel') return 'produto'
  return readNonCatalogKind(state.non_catalog_kind)
}

function monthLabel(value: string | null): string {
  if (!value) return 'mês não registrado'
  const date = new Date(`${value.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return 'mês não registrado'
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(date)
}

/** Data de um carimbo do banco em UTC (sem fuso no texto), no dia de quem lê. */
function utcDateLabel(value: string | null): string {
  if (!value) return 'data não registrada'
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`)
  if (Number.isNaN(date.getTime())) return 'data não registrada'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(date)
}

function slicesLabel(slices: readonly FinanceSlice[], withMonth: boolean): string {
  return slices.map(slice => `${slice.label} ${currencyLabel(slice.amount)}${withMonth ? ` em ${monthLabel(slice.competence_month)}` : ''}`).join('; ')
}

function itemsOf(impact: ItemCorrectionImpact, purchaseId: string) {
  return impact.items.filter(item => item.purchase_id === purchaseId)
}

const CATEGORY_TO_PRODUCT = ' Atenção: a categoria da conta não é de custo de mercadoria (CMV); se esta compra é insumo, peça ao Financeiro para revisar a categoria da conta no Contas a pagar.'
const CATEGORY_TO_EXPENSE = ' Atenção: a conta inteira está em custo de mercadoria (CMV); o valor deste item continua lá até o Financeiro revisar a categoria da conta no Contas a pagar.'
const CATEGORY_TO_RESALE = ' Atenção: a categoria da conta não é de custo de mercadoria (CMV); revenda costuma ficar em CMV de revenda. Se esta compra é revenda, peça ao Financeiro para revisar a categoria da conta no Contas a pagar.'
const CATEGORY_TO_RESALE_OTHER_CMV = ' A conta está em custo de mercadoria (CMV), mas não em CMV de revenda; se esta compra é revenda, peça ao Financeiro para conferir a categoria da conta no Contas a pagar.'
const CATEGORY_MIXED = ' A conta está dividida entre custo de mercadoria (CMV) e outras categorias; confira no Contas a pagar se o valor deste item está na parte certa.'

/**
 * Avisos de categoria de DRE para os itens da conta que mudam de lado. A
 * categoria é da conta e nada aqui a muda; o aviso só aparece quando ela não
 * combina com o novo destino. Revenda vai para CMV de revenda, então produto
 * que vira revenda numa conta de CMV não ganha o aviso de "virou despesa".
 * Nota mista (itens indo para lados diferentes, ou conta dividida entre CMV e
 * outras categorias) ganha cada aviso que se aplica, sem repetir.
 */
function categoryWarnings(purchase: PurchaseFinance, items: readonly ItemImpact[]): string[] {
  const split = purchase.split
  if (split.length === 0) return []
  const destinations = new Set(items
    .filter(item => itemSide(item.before) !== itemSide(item.after))
    .map(item => itemSide(item.after)))
  if (destinations.size === 0) return []
  const hasCmv = split.some(slice => slice.group === 'cmv')
  const onlyCmv = split.every(slice => slice.group === 'cmv')
  const hasResaleCmv = split.some(slice => slice.key === 'cmv_revenda')
  const warnings: string[] = []
  if (destinations.has('produto') && !hasCmv) warnings.push(CATEGORY_TO_PRODUCT)
  if (destinations.has('revenda')) {
    if (!hasCmv) warnings.push(CATEGORY_TO_RESALE)
    else if (!hasResaleCmv) warnings.push(CATEGORY_TO_RESALE_OTHER_CMV)
  }
  if (destinations.has('uso_despesa') && onlyCmv) warnings.push(CATEGORY_TO_EXPENSE)
  if (warnings.length === 0 && hasCmv && !onlyCmv) warnings.push(CATEGORY_MIXED)
  return warnings
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
  return `${note} · ${parts.join(' · ')}. Nada disso muda com esta correção.${categoryWarnings(purchase, items).join('')}`
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
 * os totais de compras do período (contadas, fora da contagem, não é estoque e,
 * dentro dele, a revenda sem cadastro).
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
    // A parte de revenda só existe nas prévias desde a revenda sem cadastro.
    const resale = period.before.resale !== null && period.after.resale !== null && period.before.resale !== period.after.resale
      ? `, dos quais revenda sem cadastro ${currencyLabel(period.before.resale)} → ${currencyLabel(period.after.resale)} (fora do CMV %)`
      : ''
    lines.push(`${periodLabel(period.start_date, period.end_date)} · compras contadas ${currencyLabel(period.before.counted)} → ${currencyLabel(period.after.counted)}; fora da contagem ${currencyLabel(period.before.outside)} → ${currencyLabel(period.after.outside)}; não é estoque ${currencyLabel(period.before.not_stock)} → ${currencyLabel(period.after.not_stock)}${resale}.`)
  }
  return lines
}

/** A memória gravada por último; sem versão (foto antiga), a primeira da lista. */
function latestMemory(memories: readonly MemoryRef[]): MemoryRef | undefined {
  return memories.reduce<MemoryRef | undefined>(
    (best, memory) => (!best || (memory.version ?? '') > (best.version ?? '') ? memory : best),
    undefined,
  )
}

function itemName(item: ItemImpact): string {
  return `${item.source_description || 'item sem descrição'} (${item.supplier_name || 'fornecedor não identificado'})`
}

function factorText(memory: MemoryRef): string {
  return memory.conversion_factor != null ? ` com fator ${factorLabel(memory.conversion_factor)}` : ''
}

/**
 * Frase da próxima sugestão. Quando a memória de insumo vence e o item ficou
 * fora do cadastro, diz o tipo certo e onde desligar essa memória.
 */
function nextSuggestionText(next: MemoryRef | null | undefined, after: ItemSnapshot): string {
  if (!next) return 'a próxima nota chega sem sugestão e quem importa escolhe'
  if (next.kind === 'insumo') {
    const product = next.product_name || 'um produto'
    const outside = after.mapping_status === 'nao_aplicavel'
      ? `; para ela vir como ${nonCatalogKindLabel(after.non_catalog_kind)}, desligue essa memória em Memórias de vínculo, na página do produto`
      : ''
    return `a próxima nota sugere ${product}${factorText(next)}${outside}`
  }
  return `a próxima nota sugere ${nonCatalogKindLabel(next.non_catalog_kind)}`
}

/** O que a correção faz com uma memória de fora do cadastro, dito por item. */
function memoryChangeText(change: MemoryChange): string {
  const before = nonCatalogKindLabel(change.before?.non_catalog_kind ?? null)
  const after = nonCatalogKindLabel(change.after?.non_catalog_kind ?? null)
  switch (change.action) {
    case 'desligar': return `a memória de ${before} deste item será desligada`
    case 'trocar_tipo': return `a memória deste item passa de ${before} para ${after}`
    case 'restaurar': return change.after?.active === false
      ? 'a memória deste item volta a ficar desligada, como era antes da correção'
      : `a memória deste item volta a ${after}, como era antes da correção`
    default: break
  }
  switch (change.reason) {
    case 'ja_certa': return `a memória deste item já sugere ${before}`
    case 'decisao_posterior': return `a memória deste item foi decidida depois desta nota${change.newer_at ? `, em ${utcDateLabel(change.newer_at)}` : ''}, e fica como está: corrigir esta nota não muda a sugestão das próximas`
    case 'data_desconhecida': return 'esta nota não tem a data da decisão para comparar com a memória deste item, então a memória fica como está; para mudar a sugestão das próximas notas, corrija a nota mais recente deste item'
    case 'mudou_depois': return 'a memória deste item mudou depois da correção e fica com a escolha mais nova'
    case 'memoria_apagada': return 'a memória deste item não existe mais'
    default: return 'a memória deste item fica como está'
  }
}

/**
 * Prévia gravada desde a revenda sem cadastro: o banco diz o que acontece com
 * cada memória atingida e o que a próxima nota sugere.
 */
function describeMemoryChanges(impact: ItemCorrectionImpact, changes: readonly MemoryChange[]): string[] {
  const lines: string[] = []
  for (const item of impact.items) {
    const parts = changes.filter(change => change.item_ids.includes(item.item_id)).map(memoryChangeText)
    const line = `${itemName(item)}: ${parts.map(part => `${part}; `).join('')}${nextSuggestionText(item.next_suggestion, item.after)}.`
    if (!lines.includes(line)) lines.push(line)
  }
  if (changes.some(change => change.reason === 'correcao_antiga')) {
    lines.push('Desfazer não religa a memória que esta correção antiga desligou: a próxima nota pergunta de novo.')
  }
  return lines
}

/**
 * O que a próxima nota do fornecedor vai sugerir para cada item, depois da
 * correção. Uma linha por item; itens com a mesma descrição e o mesmo efeito
 * não repetem a frase, mas efeitos diferentes nunca se escondem.
 */
export function describeMemories(impact: ItemCorrectionImpact): string[] {
  if (impact.memory_changes !== null) return describeMemoryChanges(impact, impact.memory_changes)
  // Correção gravada antes da revenda sem cadastro: a tela deduz pelas listas.
  const lines: string[] = []
  for (const item of impact.items) {
    const switchedOff = item.memories_before.filter(memory => impact.memories_off.includes(memory.mapping_id))
    // O mesmo desempate da importação (XmlPayableImport): entre as memórias que
    // casam, vale a gravada por último; empate fica com a de fora do cadastro.
    const productMemory = latestMemory(item.memories_after.filter(memory => memory.kind === 'insumo'))
    const outside = latestMemory(item.memories_after.filter(memory => memory.kind === 'uso_despesa'))
    const product = outside && (!productMemory || (outside.version ?? '') >= (productMemory.version ?? '')) ? undefined : productMemory
    const next = nextSuggestionText(product ?? outside ?? null, item.after)
    const offKinds = [...new Set(switchedOff.map(memory => nonCatalogKindLabel(memory.non_catalog_kind)))]
    const off = offKinds.length === 0 ? ''
      : offKinds.length === 1 ? `a memória de ${offKinds[0]} deste item será desligada; `
        : `as memórias de ${offKinds.join(' e de ')} deste item serão desligadas; `
    const line = `${itemName(item)}: ${off}${next}.`
    if (!lines.includes(line)) lines.push(line)
  }
  if (impact.action === 'desfazer') lines.push('Desfazer não religa memória desligada: a próxima nota pergunta de novo.')
  return lines
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** Busca na lista de fora do cadastro por fornecedor, descrição ou número da nota. */
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

/** Itens de fora do cadastro separados por tipo, na ordem em que chegaram. */
export function groupByNonCatalogKind<T extends { non_catalog_kind: NfeNonCatalogKind }>(items: readonly T[]): Record<NfeNonCatalogKind, T[]> {
  return {
    uso_despesa: items.filter(item => item.non_catalog_kind === 'uso_despesa'),
    revenda: items.filter(item => item.non_catalog_kind === 'revenda'),
  }
}

/** O outro tipo de fora do cadastro. */
export function otherNonCatalogKind(kind: NfeNonCatalogKind): NfeNonCatalogKind {
  return kind === 'revenda' ? 'uso_despesa' : 'revenda'
}

export const MIXED_KINDS_REASON = 'Para trocar o tipo, marque itens de um tipo só.'

/**
 * Para que tipo a seleção pode ser trocada. Nulo com o motivo quando não pode:
 * nada marcado, ou itens dos dois tipos juntos.
 */
export function kindSwapTarget(items: readonly { non_catalog_kind: NfeNonCatalogKind }[]): { target: NfeNonCatalogKind | null; reason: string } {
  if (items.length === 0) return { target: null, reason: 'Marque os itens que entraram com o tipo errado.' }
  const kinds = new Set(items.map(item => item.non_catalog_kind))
  if (kinds.size > 1) return { target: null, reason: MIXED_KINDS_REASON }
  return { target: otherNonCatalogKind(items[0].non_catalog_kind), reason: '' }
}
