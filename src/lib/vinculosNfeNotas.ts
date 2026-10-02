import { currencyLabel, dateLabel, factorLabel } from '@/lib/vinculosNfe'
import type { InvoiceLinkHistory } from '@/lib/vinculosNfeClient'

/**
 * Correção de itens de notas já gravadas (fase 4 dos Vínculos de NF-e). O banco
 * calcula o efeito (public.correct_payable_purchase_items); aqui só ficam as
 * regras de seleção da tela e a leitura do efeito que ele devolve.
 */

/** Limite da função do banco por pedido. */
export const MAX_ITEMS_PER_CORRECTION = 100

export interface ItemSnapshot {
  product_id: string
  product_name: string | null
  product_unit: string | null
  conversion_factor: number | null
  usable_quantity: number | null
  normalized_unit_cost: number | null
  cost_applied: boolean | null
}

export interface ItemImpact {
  item_id: string
  purchase_id: string
  supplier_name: string | null
  nfe_number: string | null
  issue_date: string | null
  source_description: string | null
  source_unit: string | null
  quantity: number
  item_value: number
  before: ItemSnapshot
  after: ItemSnapshot
}

export interface ProductImpact {
  product_id: string
  name: string
  unit: string | null
  active: boolean
  cost_before: number | null
  cost_after: number | null
}

export type CostDecisionKind = 'destino' | 'origem_recalculada' | 'origem_sem_nota'

export interface CostDecision {
  product_id: string
  kind: CostDecisionKind | string
  purchase_id: string | null
  cost_from_this_note: boolean
}

export interface ItemCorrectionImpact {
  action: 'corrigir' | 'desfazer' | string
  items: ItemImpact[]
  products: ProductImpact[]
  decisions: CostDecision[]
}

export interface ItemCorrectionResult {
  mode: 'previa' | 'aplicar'
  correctionId: string | null
  impact: ItemCorrectionImpact
  impactHash: string
  replayed: boolean
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : []
}

function snapshot(value: unknown): ItemSnapshot {
  const raw = record(value)
  return {
    product_id: text(raw.product_id) ?? '',
    product_name: text(raw.product_name),
    product_unit: text(raw.product_unit),
    conversion_factor: numberOrNull(raw.conversion_factor),
    usable_quantity: numberOrNull(raw.usable_quantity),
    normalized_unit_cost: numberOrNull(raw.normalized_unit_cost),
    cost_applied: typeof raw.cost_applied === 'boolean' ? raw.cost_applied : null,
  }
}

/** Lê o efeito em JSON do banco; números chegam como número ou texto. */
export function parseItemCorrectionImpact(value: unknown): ItemCorrectionImpact {
  const raw = record(value)
  return {
    action: text(raw.action) ?? '',
    items: list(raw.items).map(item => ({
      item_id: text(item.item_id) ?? '',
      purchase_id: text(item.purchase_id) ?? '',
      supplier_name: text(item.supplier_name),
      nfe_number: text(item.nfe_number),
      issue_date: text(item.issue_date),
      source_description: text(item.source_description),
      source_unit: text(item.source_unit),
      quantity: numberOrNull(item.quantity) ?? 0,
      item_value: numberOrNull(item.item_value) ?? 0,
      before: snapshot(item.before),
      after: snapshot(item.after),
    })),
    products: list(raw.products).map(product => ({
      product_id: text(product.product_id) ?? '',
      name: text(product.name) ?? 'Produto sem nome',
      unit: text(product.unit),
      active: product.active === true,
      cost_before: numberOrNull(product.cost_before),
      cost_after: numberOrNull(product.cost_after),
    })),
    decisions: list(raw.decisions).map(decision => ({
      product_id: text(decision.product_id) ?? '',
      kind: text(decision.kind) ?? '',
      purchase_id: text(decision.purchase_id),
      cost_from_this_note: decision.cost_from_this_note === true,
    })),
  }
}

export function parseItemCorrectionResult(value: unknown): ItemCorrectionResult {
  const raw = record(value)
  const hash = text(raw.impact_hash)
  if (!hash) throw new Error('O banco não devolveu o efeito da correção. Tente de novo.')
  return {
    mode: raw.mode === 'aplicar' ? 'aplicar' : 'previa',
    correctionId: text(raw.correction_id),
    impact: parseItemCorrectionImpact(raw.impact),
    impactHash: hash,
    replayed: raw.replayed === true,
  }
}

/** Por que um item gravado não pode ser escolhido; vazio quando pode. */
export function itemBlockReason(item: Pick<InvoiceLinkHistory, 'status' | 'mapping_status'>): string {
  if (item.status === 'cancelada') return 'Conta cancelada: não é corrigida.'
  if (item.mapping_status !== 'mapeado') return 'Item sem vínculo confirmado: classifique em Contas a pagar.'
  return ''
}

/**
 * Por que a seleção ainda não pode seguir. O fator diz quanto vem em uma
 * unidade da nota, então itens com unidades diferentes não dividem um fator.
 */
export function selectionBlockReason(items: readonly Pick<InvoiceLinkHistory, 'source_unit' | 'status' | 'mapping_status'>[]): string {
  if (items.length === 0) return 'Marque os itens que entraram errados.'
  if (items.length > MAX_ITEMS_PER_CORRECTION) return `Corrija no máximo ${MAX_ITEMS_PER_CORRECTION} itens de cada vez.`
  if (items.some(item => itemBlockReason(item))) return 'Há item marcado que não pode ser corrigido.'
  const units = new Set(items.map(item => (item.source_unit ?? '').trim().toUpperCase()))
  if (units.size > 1) return 'Os itens marcados vêm em unidades diferentes na nota; corrija um grupo de cada vez.'
  return ''
}

export interface ProductKindInfo {
  active: boolean
  kind?: string | null
  is_fabricacao_propria?: boolean | null
}

/** Produto que pode receber item de nota: ativo, insumo ou revenda, sem kit nem fabricação própria. */
export function canReceiveInvoiceItem(product: ProductKindInfo): boolean {
  return product.active
    && (product.kind === 'insumo' || product.kind === 'final')
    && !product.is_fabricacao_propria
}

function quantityLabel(value: number | null, unit: string | null): string {
  if (value === null) return 'sem quantidade útil'
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${unit || 'un'}`
}

function unitCostLabel(value: number | null, unit: string | null): string {
  if (value === null) return 'sem custo por unidade'
  return `${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value)} por ${unit || 'un'}`
}

function costLabel(value: number | null): string {
  return value === null ? 'sem custo' : currencyLabel(value)
}

/** Uma linha por item: de onde sai, para onde vai, com quantidade e custo. */
export function describeItemImpact(item: ItemImpact): string {
  const note = `NF ${item.nfe_number || 'sem número'} de ${dateLabel(item.issue_date)}`
  const source = `${item.source_description || 'Item sem descrição'} (${item.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${item.source_unit || ''})`.trim()
  const side = (state: ItemSnapshot) => `${state.product_name ?? 'produto sem nome'}, fator ${state.conversion_factor === null ? '?' : factorLabel(state.conversion_factor)}, ${quantityLabel(state.usable_quantity, state.product_unit)}, ${unitCostLabel(state.normalized_unit_cost, state.product_unit)}`
  return `${note} · ${source}: ${side(item.before)} → ${side(item.after)}.`
}

function noteOf(impact: ItemCorrectionImpact, purchaseId: string | null): string {
  const item = impact.items.find(candidate => candidate.purchase_id === purchaseId)
  if (item) return `NF ${item.nfe_number || 'sem número'} de ${dateLabel(item.issue_date)}`
  return 'outra nota do produto'
}

/** Uma linha por produto: custo antes e depois, e o motivo. */
export function describeProductImpact(product: ProductImpact, impact: ItemCorrectionImpact): string {
  const decisions = impact.decisions.filter(decision => decision.product_id === product.product_id)
  const from = costLabel(product.cost_before)
  const to = costLabel(product.cost_after)
  const changed = product.cost_before !== product.cost_after
  const head = changed ? `Custo de ${product.name}: ${from} → ${to}` : `Custo de ${product.name} continua ${from}`
  const origin = decisions.find(decision => decision.kind === 'origem_recalculada' || decision.kind === 'origem_sem_nota')
  if (origin?.kind === 'origem_sem_nota') return `${head}: não sobrou outra nota deste produto, então o custo fica como estava.`
  if (origin?.kind === 'origem_recalculada') {
    const note = impact.items.some(item => item.purchase_id === origin.purchase_id) ? noteOf(impact, origin.purchase_id) : 'a nota mais recente que sobrou'
    return `${head}: o item que saiu era o que dava o custo; vale agora ${note}.`
  }
  const destination = decisions.filter(decision => decision.kind === 'destino')
  if (destination.some(decision => decision.cost_from_this_note)) return `${head}: a nota corrigida é a mais recente deste produto.`
  if (destination.length > 0) return `${head}: há nota mais recente deste produto, que continua mandando no custo.`
  return `${head}: o item que saiu não era o que dava o custo.`
}

/** Linhas fixas da prévia: o que a correção nunca muda e o que muda junto. */
export const IMPACT_FOOTNOTES: readonly string[] = [
  'Contas, parcelas, pagamentos e o livro-caixa não mudam: o valor de cada item é o mesmo.',
  'O consumo semanal e o custo de referência da contagem passam a contar o item no produto e no fator corrigidos.',
  'Fichas de receita e memórias do fornecedor não mudam; a memória se corrige nas Memórias de vínculo, acima.',
]
