import { conversionNeedsConfirmation, type NfeDraft } from '@/lib/nfeXml'

/**
 * Compras fase 3B: o custo de um cadastro nesta nota contra o da última compra
 * do mesmo cadastro, para avisar quando subiu. O preço de venda não muda
 * sozinho: a decisão segue com o Rodrigo, com o número na mão
 * (docs/COMPRAS_POR_XML.md e docs/FORMACAO_DE_PRECO.md).
 *
 * A comparação segue a regra que o banco usa para trocar o custo
 * (`private.apply_xml_purchase_cost`, fase 3A): só NF-e, conta não cancelada,
 * quantidade útil maior que zero, custo da nota = valor pago dividido pela
 * quantidade útil, somando as linhas do mesmo cadastro, em centavos como o
 * cadastro guarda; a ordem entre notas é a data de emissão e, no mesmo dia, a
 * hora de emissão ou, sem a hora de uma das duas, a ordem em que as contas
 * foram lançadas.
 *
 * "Última compra" é a nota mais recente antes desta que não ficou de fora do
 * custo: nota que entrou atrasada, com emissão anterior a outra já lançada,
 * não trocou o custo (`cost_applied` falso) e não serve de comparação. Assim a
 * importação e o quadro do Contas a pagar dizem a mesma coisa: de quanto para
 * quanto o custo do cadastro foi.
 */

/** Alta a partir de 5%: metade das altas entre notas seguidas do mesmo insumo (ago a nov/2026) ficou abaixo de 6%. */
export const MINIMUM_INCREASE = 0.05
/**
 * Variação de 50% para cima, ou de um terço para baixo (dividir por 1,5),
 * costuma ser quantidade por embalagem lida errada: um fator trocado
 * multiplica ou divide o custo inteiro. Dos 9 saltos acima de 50% no mesmo
 * período, a maioria tinha fator diferente entre as duas notas.
 */
export const LARGE_VARIATION = 1.5

export interface CostPointPackaging {
  sourceUnit: string | null
  factor: number | null
}

/** O custo de um cadastro numa nota já lançada. */
export interface CostPoint {
  purchaseId: string
  productId: string
  productName: string | null
  productUnit: string | null
  nfeKey: string | null
  nfeNumber: string | null
  issueDate: string
  issuedAt: string | null
  createdAt: string | null
  supplierName: string | null
  unitCost: number
  /**
   * Esta nota trocou o custo do cadastro quando entrou (`cost_applied`). Nulo
   * nas compras anteriores à fase 3A, que não guardavam a informação.
   */
  costApplied: boolean | null
  packaging: CostPointPackaging[]
}

type Embedded<T> = T | T[] | null | undefined

function first<T>(value: Embedded<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export interface CostHistoryRow {
  product_id: string | null
  acquisition_value: number | string | null
  line_total: number | string | null
  usable_quantity: number | string | null
  source_unit: string | null
  conversion_factor: number | string | null
  cost_applied: boolean | null
  product?: Embedded<{ name: string | null; unit: string | null }>
  purchase: Embedded<{
    id: string
    nfe_key: string | null
    nfe_number: string | null
    nfe_issued_at: string | null
    nfe_issued_timestamp: string | null
    created_at: string | null
    status: string | null
    origin: string | null
    suppliers?: Embedded<{ name: string | null }>
  }>
}

function toNumber(value: number | string | null | undefined): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Centavos, como `round(valor / quantidade, 2)` do banco. */
export function toCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function mergeApplied(current: boolean | null | undefined, next: boolean | null): boolean | null {
  if (current === undefined) return next
  if (current === true || next === true) return true
  if (current === null || next === null) return null
  return false
}

/** Agrupa os itens por nota e cadastro, como o banco faz ao trocar o custo. */
export function buildCostHistory(rows: readonly CostHistoryRow[]): Map<string, CostPoint[]> {
  const groups = new Map<string, { point: CostPoint; value: number; quantity: number; applied: boolean | null | undefined }>()
  for (const row of rows) {
    const purchase = first(row.purchase)
    const quantity = toNumber(row.usable_quantity)
    if (!row.product_id || !purchase || !purchase.nfe_issued_at) continue
    if (purchase.origin !== 'xml' || purchase.status === 'cancelada' || quantity <= 0) continue
    const key = `${purchase.id}|${row.product_id}`
    let group = groups.get(key)
    if (!group) {
      const product = first(row.product)
      group = {
        value: 0,
        quantity: 0,
        applied: undefined,
        point: {
          purchaseId: purchase.id,
          productId: row.product_id,
          productName: product?.name ?? null,
          productUnit: product?.unit ?? null,
          nfeKey: purchase.nfe_key,
          nfeNumber: purchase.nfe_number,
          issueDate: purchase.nfe_issued_at,
          issuedAt: purchase.nfe_issued_timestamp,
          createdAt: purchase.created_at,
          supplierName: first(purchase.suppliers)?.name ?? null,
          unitCost: 0,
          costApplied: false,
          packaging: [],
        },
      }
      groups.set(key, group)
    }
    // Valor pago com impostos e despesas (fase 3A); compra anterior a ela só tem o valor do item.
    group.value += row.acquisition_value === null || row.acquisition_value === undefined ? toNumber(row.line_total) : toNumber(row.acquisition_value)
    group.quantity += quantity
    group.applied = mergeApplied(group.applied, row.cost_applied ?? null)
    const factor = row.conversion_factor === null ? null : toNumber(row.conversion_factor)
    if (!group.point.packaging.some(entry => entry.sourceUnit === row.source_unit && entry.factor === factor)) {
      group.point.packaging.push({ sourceUnit: row.source_unit, factor })
    }
  }
  const history = new Map<string, CostPoint[]>()
  for (const { point, value, quantity, applied } of groups.values()) {
    point.unitCost = toCents(value / quantity)
    point.costApplied = applied ?? null
    const list = history.get(point.productId) ?? []
    list.push(point)
    history.set(point.productId, list)
  }
  return history
}

/** Posição de uma nota na fila do custo. `createdAt` nulo é a nota que ainda vai ser lançada. */
export interface NoteOrder {
  issueDate: string
  issuedAt: string | null
  createdAt: string | null
}

function time(value: string): number {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

/** A nota `a` vem depois da nota `b`, pela mesma regra do banco. */
export function isLaterNote(a: NoteOrder, b: NoteOrder): boolean {
  if (a.issueDate !== b.issueDate) return a.issueDate > b.issueDate
  if (a.issuedAt && b.issuedAt) return time(a.issuedAt) > time(b.issuedAt)
  // Sem a hora de uma das duas, vale a ordem de lançamento; a nota que ainda
  // vai ser lançada é a última de todas.
  if (b.createdAt === null) return false
  if (a.createdAt === null) return true
  return time(a.createdAt) > time(b.createdAt)
}

/**
 * Ordem para escolher a última compra: a do banco onde ela decide e, no
 * empate (mesma hora, ou a mesma data sem a hora de uma das duas), a ordem de
 * lançamento e por fim a identidade da nota. Sem o desempate, duas notas com a
 * mesma hora ficariam sem compra anterior uma da outra.
 */
export function compareNotes(a: NoteOrder & { purchaseId?: string | null }, b: NoteOrder & { purchaseId?: string | null }): number {
  if (a.issueDate !== b.issueDate) return a.issueDate < b.issueDate ? -1 : 1
  if (a.issuedAt && b.issuedAt && time(a.issuedAt) !== time(b.issuedAt)) return time(a.issuedAt) - time(b.issuedAt)
  if (a.createdAt !== b.createdAt) {
    if (a.createdAt === null) return 1
    if (b.createdAt === null) return -1
    const difference = time(a.createdAt) - time(b.createdAt)
    if (difference !== 0) return difference
  }
  return (a.purchaseId ?? '').localeCompare(b.purchaseId ?? '')
}

function latest(points: readonly CostPoint[]): CostPoint | null {
  return points.reduce<CostPoint | null>((best, point) => (!best || compareNotes(point, best) > 0 ? point : best), null)
}

export type CostChangeKind = 'primeira' | 'nota_antiga' | 'muito_diferente' | 'subiu' | 'sem_alta'

export interface CostChange {
  kind: CostChangeKind
  productId: string
  unitCost: number
  /** Última compra do cadastro antes desta nota. */
  previous: CostPoint | null
  /** Nota mais recente que esta: com ela, esta nota não troca o custo. */
  newer: CostPoint | null
  /** Custo desta nota dividido pelo da última compra; nulo sem custo anterior ou com custo zero. */
  ratio: number | null
}

export interface NoteIdentity extends NoteOrder {
  purchaseId?: string | null
  nfeKey?: string | null
}

export function classifyRatio(ratio: number): Exclude<CostChangeKind, 'primeira' | 'nota_antiga'> {
  if (ratio >= LARGE_VARIATION - 1e-9 || ratio <= 1 / LARGE_VARIATION + 1e-9) return 'muito_diferente'
  if (ratio >= 1 + MINIMUM_INCREASE - 1e-9) return 'subiu'
  return 'sem_alta'
}

function againstPrevious(previous: CostPoint | null, productId: string, unitCost: number): CostChange {
  const base = { productId, unitCost, previous, newer: null }
  if (!previous) return { ...base, kind: 'primeira', ratio: null }
  if (previous.unitCost <= 0 || unitCost <= 0) {
    // Item de brinde (custo zero) de um lado só zera ou cria o custo inteiro.
    return { ...base, kind: previous.unitCost <= 0 && unitCost <= 0 ? 'sem_alta' : 'muito_diferente', ratio: null }
  }
  const ratio = unitCost / previous.unitCost
  return { ...base, kind: classifyRatio(ratio), ratio }
}

function otherNotes(points: readonly CostPoint[] | undefined, note: NoteIdentity, productId: string): CostPoint[] {
  return (points ?? []).filter(point =>
    point.productId === productId
    && !(note.purchaseId && point.purchaseId === note.purchaseId)
    && !(note.nfeKey && point.nfeKey === note.nfeKey))
}

/** A última compra antes da nota, sem as que entraram atrasadas e não trocaram o custo. */
function previousPurchase(others: readonly CostPoint[], note: NoteIdentity): CostPoint | null {
  return latest(others.filter(point => point.costApplied !== false && compareNotes(point, note) < 0))
}

/**
 * A nota que está entrando contra a última compra antes dela. Se já existe nota
 * mais recente do cadastro, esta não troca o custo (fase 3A) e não acusa alta.
 */
export function compareWithLastPurchase(points: readonly CostPoint[] | undefined, note: NoteIdentity, productId: string, unitCost: number): CostChange {
  const others = otherNotes(points, note, productId)
  const previous = previousPurchase(others, note)
  // A nota mais recente que impede trocar o custo segue a regra estrita do
  // banco, inclusive para nota que também ficou de fora do custo.
  const newer = latest(others.filter(point => isLaterNote(point, note)))
  if (!newer) return againstPrevious(previous, productId, unitCost)
  return { productId, unitCost, previous, newer, kind: 'nota_antiga', ratio: previous && previous.unitCost > 0 ? unitCost / previous.unitCost : null }
}

/** Custo de cada cadastro nesta nota, ainda não lançada. */
export interface NoteProductCost {
  productId: string
  /** Nulo enquanto alguma linha do cadastro espera a conferência da embalagem. */
  unitCost: number | null
  lineNumbers: number[]
}

export function noteProductCosts(draft: NfeDraft | null, acquisitionByLine: ReadonlyMap<number, number> | null): Map<string, NoteProductCost> {
  const result = new Map<string, NoteProductCost & { value: number; quantity: number; waiting: boolean }>()
  if (!draft || !acquisitionByLine) return new Map()
  for (const item of draft.items) {
    const quantity = item.usableQuantity ?? 0
    if (item.mappingStatus !== 'mapeado' || !item.baseProductId || quantity <= 0) continue
    const acquisition = acquisitionByLine.get(item.lineNumber)
    if (acquisition === undefined) continue
    const entry = result.get(item.baseProductId) ?? { productId: item.baseProductId, unitCost: null, lineNumbers: [], value: 0, quantity: 0, waiting: false }
    entry.value += acquisition
    entry.quantity += quantity
    entry.lineNumbers.push(item.lineNumber)
    entry.waiting = entry.waiting || conversionNeedsConfirmation(item.purchaseUnit, item.baseUnit ?? '', item.factorConfirmed)
    result.set(item.baseProductId, entry)
  }
  return new Map([...result].map(([id, { value, quantity, waiting, ...entry }]) => [id, { ...entry, unitCost: waiting ? null : toCents(value / quantity) }]))
}

/** Altas e diferenças grandes das notas que trocaram o custo a partir de `since` (AAAA-MM-DD). */
export function recentCostChanges(history: ReadonlyMap<string, readonly CostPoint[]>, since: string): Array<CostChange & { point: CostPoint }> {
  const changes: Array<CostChange & { point: CostPoint }> = []
  for (const points of history.values()) {
    for (const point of points) {
      if (point.costApplied !== true || point.issueDate < since) continue
      // Contra a compra anterior a ela, pela mesma regra da importação; as que
      // vieram depois não contam.
      const change = againstPrevious(previousPurchase(otherNotes(points, point, point.productId), point), point.productId, point.unitCost)
      if (change.kind === 'subiu' || change.kind === 'muito_diferente') changes.push({ ...change, point })
    }
  }
  return changes.sort((left, right) => compareNotes(right.point, left.point)
    || (left.point.productName ?? '').localeCompare(right.point.productName ?? '', 'pt-BR'))
}

/** Em centavos, como o cadastro guarda o custo. */
export function formatUnitCost(value: number, unit: string | null): string {
  const money = value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return unit ? `${money} por ${unit}` : money
}

/** Tamanho da variação, sem sinal: "20%" para 1,2 e "60%" para 0,4. */
export function formatPercent(ratio: number): string {
  return `${Math.round(Math.abs(ratio - 1) * 100)}%`
}

/** "+12%", "−8%", "0%". */
export function formatVariation(ratio: number): string {
  const percent = Math.round((ratio - 1) * 100)
  if (percent > 0) return `+${percent}%`
  if (percent < 0) return `−${Math.abs(percent)}%`
  return '0%'
}

export function packagingLabel(packaging: readonly CostPointPackaging[], unit: string | null): string | null {
  const labels = packaging
    .filter(entry => entry.sourceUnit)
    .map(entry => entry.factor !== null && entry.factor !== 1
      ? `${entry.sourceUnit} com ${entry.factor.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${unit ?? ''}`.trim()
      : `${entry.sourceUnit}`)
  return labels.length > 0 ? labels.join(' e ') : null
}

/** Data AAAA-MM-DD menos `days` dias, sem passar por fuso. */
export function daysBefore(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day - days))
  return date.toISOString().slice(0, 10)
}
