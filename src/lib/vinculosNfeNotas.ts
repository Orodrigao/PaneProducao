import { readNonCatalogKind, type NfeNonCatalogKind } from '@/lib/nfeXml'
import { currencyLabel, dateLabel, factorLabel } from '@/lib/vinculosNfe'
import type { InvoiceLinkHistory } from '@/lib/vinculosNfeClient'

/**
 * Correção de itens de notas já gravadas (fases 4 e 5 dos Vínculos de NF-e e
 * fase 3 da revenda sem cadastro). O banco calcula o efeito
 * (public.correct_payable_purchase_items); aqui só ficam as regras de seleção
 * da tela e a leitura do efeito que ele devolve. A parte financeira, o consumo
 * semanal e a memória do fornecedor são descritos em
 * src/lib/vinculosNfeUsoDespesa.ts.
 */

/** Limite da função do banco por pedido. */
export const MAX_ITEMS_PER_CORRECTION = 100

export interface ItemSnapshot {
  /** 'mapeado' (produto) ou 'nao_aplicavel' (fora do cadastro). Fotos da fase 4 não trazem: eram sempre produto. */
  mapping_status: string
  /**
   * Tipo do item fora do cadastro; nulo no item com produto. Foto sem o tipo
   * (antes da revenda sem cadastro) fora do cadastro era uso ou despesa.
   */
  non_catalog_kind: NfeNonCatalogKind | null
  /** Vazio quando o item está fora do cadastro. */
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
  /** Memórias ligadas que a importação usaria para este item, antes e depois. */
  memories_before: MemoryRef[]
  memories_after: MemoryRef[]
  /**
   * O que a próxima nota deste item vai sugerir depois da correção, calculado
   * pelo banco como a importação calcula. Ausente em correções antigas.
   */
  next_suggestion: MemoryRef | null
}

export interface MemoryRef {
  /** 'insumo' ou 'uso_despesa', que aqui quer dizer "fora do cadastro"; a correção desliga por ele. */
  kind: 'insumo' | 'uso_despesa' | string
  /** Tipo da memória fora do cadastro (uso_despesa ou revenda). Ausente antes da revenda sem cadastro. */
  non_catalog_kind?: string | null
  mapping_id: string
  product_name: string | null
  conversion_factor: number | null
  /** Última gravação da memória (UTC); decide entre memórias do mesmo item, como na importação. */
  version?: string | null
  /** A memória foi mexida por esta correção (a versão dela muda na gravação). */
  changed?: boolean
}

/** O que a correção faz com uma memória de fora do cadastro. */
export type MemoryChangeAction = 'desligar' | 'trocar_tipo' | 'confirmar' | 'restaurar' | 'manter'

export interface MemoryState {
  active: boolean | null
  non_catalog_kind: string | null
}

export interface MemoryChange {
  mapping_id: string
  item_ids: string[]
  action: MemoryChangeAction | string
  /** Por que fica como está: ja_certa, data_desconhecida, decisao_posterior, ordem_incerta, mudou_depois, memoria_apagada ou correcao_antiga. */
  reason: string | null
  before: MemoryState | null
  after: MemoryState | null
  /** Data (UTC) da decisão mais nova que a corrigida, quando houve. */
  newer_at: string | null
}

export interface FinanceSlice {
  key: string
  label: string
  group: string | null
  competence_month: string | null
  amount: number
}

/** Situação da conta da nota: a correção do item nunca muda nada disto. */
export interface PurchaseFinance {
  purchase_id: string
  status: string
  total_value: number
  competence_month: string | null
  installments: number
  installments_paid: number
  paid_total: number
  late_fees: number
  last_paid_date: string | null
  split: FinanceSlice[]
  ledger: FinanceSlice[]
}

export interface ConsumptionRow {
  qty_in: number | null
  qty_consumed: number | null
  unit_cost: number | null
  value_consumed: number | null
  status: string
}

export interface ConsumptionItemChange {
  period_end_count_id: string
  start_date: string | null
  end_date: string | null
  product_id: string
  product_name: string
  unit: string | null
  before: ConsumptionRow | null
  after: ConsumptionRow | null
}

export interface ConsumptionTotals {
  counted: number
  outside: number
  not_stock: number
  /** Parte de revenda sem cadastro dentro de "não é estoque". Nula em correções antigas. */
  resale: number | null
  unclassified: number
}

export interface ConsumptionPeriodChange {
  period_end_count_id: string
  start_date: string | null
  end_date: string | null
  before: ConsumptionTotals
  after: ConsumptionTotals
}

/** Consumo semanal (contagens fechadas) que muda com a correção. */
export interface ConsumptionImpact {
  closed_periods: number
  items: ConsumptionItemChange[]
  periods: ConsumptionPeriodChange[]
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
  /** Memórias de fora do cadastro desligadas pela correção. */
  memories_off: string[]
  /** O que a correção faz com cada memória atingida. Nulo em correções anteriores à revenda sem cadastro. */
  memory_changes: MemoryChange[] | null
  purchases: PurchaseFinance[]
  /** Nulo em correções gravadas antes da fase 5. */
  consumption: ConsumptionImpact | null
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

function memoryRef(raw: Record<string, unknown>): MemoryRef {
  return {
    kind: text(raw.kind) ?? '',
    non_catalog_kind: text(raw.non_catalog_kind),
    mapping_id: text(raw.mapping_id) ?? '',
    product_name: text(raw.product_name),
    conversion_factor: numberOrNull(raw.conversion_factor),
    version: text(raw.version),
    changed: raw.changed === true,
  }
}

function memories(value: unknown): MemoryRef[] {
  return list(value).map(memoryRef)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function memoryState(value: unknown): MemoryState | null {
  if (!isRecord(value)) return null
  return {
    active: typeof value.active === 'boolean' ? value.active : null,
    non_catalog_kind: text(value.non_catalog_kind),
  }
}

function memoryChanges(value: unknown): MemoryChange[] | null {
  if (!Array.isArray(value)) return null
  return list(value).map(change => ({
    mapping_id: text(change.mapping_id) ?? '',
    item_ids: Array.isArray(change.item_ids) ? change.item_ids.filter((id): id is string => typeof id === 'string') : [],
    action: text(change.action) ?? '',
    reason: text(change.reason),
    before: memoryState(change.before),
    after: memoryState(change.after),
    newer_at: text(change.newer_at),
  }))
}

function slices(value: unknown): FinanceSlice[] {
  return list(value).map(slice => ({
    key: text(slice.key) ?? '',
    label: text(slice.label) ?? 'Categoria sem nome',
    group: text(slice.group),
    competence_month: text(slice.competence_month),
    amount: numberOrNull(slice.amount) ?? 0,
  }))
}

function consumptionRow(value: unknown): ConsumptionRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = record(value)
  return {
    qty_in: numberOrNull(raw.qty_in),
    qty_consumed: numberOrNull(raw.qty_consumed),
    unit_cost: numberOrNull(raw.unit_cost),
    value_consumed: numberOrNull(raw.value_consumed),
    status: text(raw.status) ?? '',
  }
}

function totals(value: unknown): ConsumptionTotals {
  const raw = record(value)
  return {
    counted: numberOrNull(raw.counted) ?? 0,
    outside: numberOrNull(raw.outside) ?? 0,
    not_stock: numberOrNull(raw.not_stock) ?? 0,
    resale: numberOrNull(raw.resale),
    unclassified: numberOrNull(raw.unclassified) ?? 0,
  }
}

function consumption(value: unknown): ConsumptionImpact | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = record(value)
  return {
    closed_periods: numberOrNull(raw.closed_periods) ?? 0,
    items: list(raw.items).map(item => ({
      period_end_count_id: text(item.period_end_count_id) ?? '',
      start_date: text(item.start_date),
      end_date: text(item.end_date),
      product_id: text(item.product_id) ?? '',
      product_name: text(item.product_name) ?? 'Produto sem nome',
      unit: text(item.unit),
      before: consumptionRow(item.before),
      after: consumptionRow(item.after),
    })),
    periods: list(raw.periods).map(period => ({
      period_end_count_id: text(period.period_end_count_id) ?? '',
      start_date: text(period.start_date),
      end_date: text(period.end_date),
      before: totals(period.before),
      after: totals(period.after),
    })),
  }
}

function snapshot(value: unknown): ItemSnapshot {
  const raw = record(value)
  const mappingStatus = text(raw.mapping_status) ?? 'mapeado'
  return {
    mapping_status: mappingStatus,
    // Fora do cadastro sem o tipo é foto antiga, de uso ou despesa; item com
    // produto nunca tem tipo.
    non_catalog_kind: mappingStatus === 'nao_aplicavel' ? readNonCatalogKind(raw.non_catalog_kind) : null,
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
      memories_before: memories(item.memories_before),
      memories_after: memories(item.memories_after),
      next_suggestion: isRecord(item.next_suggestion) ? memoryRef(item.next_suggestion) : null,
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
    memories_off: Array.isArray(raw.memories_off) ? raw.memories_off.filter((id): id is string => typeof id === 'string') : [],
    memory_changes: memoryChanges(raw.memory_changes),
    purchases: list(raw.purchases).map(purchase => ({
      purchase_id: text(purchase.purchase_id) ?? '',
      status: text(purchase.status) ?? '',
      total_value: numberOrNull(purchase.total_value) ?? 0,
      competence_month: text(purchase.competence_month),
      installments: numberOrNull(purchase.installments) ?? 0,
      installments_paid: numberOrNull(purchase.installments_paid) ?? 0,
      paid_total: numberOrNull(purchase.paid_total) ?? 0,
      late_fees: numberOrNull(purchase.late_fees) ?? 0,
      last_paid_date: text(purchase.last_paid_date),
      split: slices(purchase.split),
      ledger: slices(purchase.ledger),
    })),
    consumption: consumption(raw.consumption),
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
  if (item.mapping_status === 'mapeado' || item.mapping_status === 'nao_aplicavel') return ''
  return 'Item sem vínculo confirmado: classifique em Contas a pagar.'
}

/** Os itens marcados vêm em unidades diferentes na nota (o fator vale por unidade). */
export function mixedUnits(items: readonly Pick<InvoiceLinkHistory, 'source_unit'>[]): boolean {
  return new Set(items.map(item => (item.source_unit ?? '').trim().toUpperCase())).size > 1
}

export const MIXED_UNITS_REASON = 'Os itens marcados vêm em unidades diferentes na nota; corrija um grupo de cada vez.'

/**
 * Por que a seleção ainda não pode seguir. O fator diz quanto vem em uma
 * unidade da nota, então itens com unidades diferentes não dividem um fator.
 */
export function selectionBlockReason(
  items: readonly Pick<InvoiceLinkHistory, 'source_unit' | 'status' | 'mapping_status'>[],
  options: { sameUnit?: boolean } = {},
): string {
  if (items.length === 0) return 'Marque os itens que entraram errados.'
  if (items.length > MAX_ITEMS_PER_CORRECTION) return `Corrija no máximo ${MAX_ITEMS_PER_CORRECTION} itens de cada vez.`
  if (items.some(item => itemBlockReason(item))) return 'Há item marcado que não pode ser corrigido.'
  // Virar uso ou despesa não tem fator, então unidades diferentes podem ir
  // juntas; quem chama confere a unidade quando o destino é um produto.
  if ((options.sameUnit ?? true) && mixedUnits(items)) return MIXED_UNITS_REASON
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

/** Rótulo de uso ou despesa nas linhas de efeito. */
export const NON_CATALOG_LABEL = 'uso ou despesa (fora da receita, do estoque e do custo)'

/**
 * Rótulo da revenda sem cadastro nas linhas de efeito. Sem produto, ela não
 * muda custo de cadastro; o valor de aquisição da nota continua o mesmo.
 */
export const RESALE_NO_CATALOG_LABEL = 'revenda sem cadastro (sem produto: fora do estoque, do custo de cadastro e do CMV %; o valor da compra continua o mesmo)'

/** Rótulo do lado fora do cadastro, pelo tipo. */
export function nonCatalogSideLabel(kind: string | null | undefined): string {
  return kind === 'revenda' ? RESALE_NO_CATALOG_LABEL : NON_CATALOG_LABEL
}

/** Uma linha por item: de onde sai, para onde vai, com quantidade e custo. */
export function describeItemImpact(item: ItemImpact): string {
  const note = `NF ${item.nfe_number || 'sem número'} de ${dateLabel(item.issue_date)}`
  const source = `${item.source_description || 'Item sem descrição'} (${item.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${item.source_unit || ''})`.trim()
  const side = (state: ItemSnapshot) => state.mapping_status === 'nao_aplicavel'
    ? nonCatalogSideLabel(state.non_catalog_kind)
    : `${state.product_name ?? 'produto sem nome'}, fator ${state.conversion_factor === null ? '?' : factorLabel(state.conversion_factor)}, ${quantityLabel(state.usable_quantity, state.product_unit)}, ${unitCostLabel(state.normalized_unit_cost, state.product_unit)}`
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
  if (origin?.kind === 'origem_sem_nota') return `${head}: não sobrou outra nota deste produto, então o custo fica como estava. Atenção: esse custo veio da nota que saiu; confira o cadastro até chegar uma compra nova.`
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
  'Contas, parcelas, pagamentos, rateio e o livro-caixa não mudam: o valor de cada item é o mesmo.',
  'O consumo semanal e o custo de referência da contagem passam a contar o item como ficou: no produto e no fator corrigidos, ou fora do cadastro (a revenda sem cadastro em linha própria, fora do CMV %).',
  'Fichas de receita não mudam. A memória de insumo do fornecedor se corrige em Memórias de vínculo, na página do produto.',
]
