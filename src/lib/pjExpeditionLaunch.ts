import { supabase } from './supabase'
import type { PricingUnit } from './saleOptions'

// Lançamento de Pedido PJ pela Expedição JC. A tela nunca recebe nem envia
// preço: o banco precifica cada linha pela tabela do cliente e o Financeiro
// revisa a cobrança antes da saída.

export interface PjLaunchCustomer {
  id: string
  name: string
  blockedReason: string | null
}

export interface PjLaunchItem {
  customerId: string
  productSource: 'bread' | 'product'
  productId: string
  saleOptionId: string | null
  productName: string
  saleOptionName: string | null
  pricingUnit: PricingUnit
  packSize: number
  packRuleSize: number | null
  packRuleMin: number | null
  packRuleMultiple: number | null
  unitWeightKg: number | null
  blockedReason: string | null
}

export interface PjLaunchCatalog {
  today: string
  customers: PjLaunchCustomer[]
  items: PjLaunchItem[]
}

export interface PjLaunchLine {
  item: PjLaunchItem
  packs: number
}

export interface PjLaunchAttempt {
  requestId: string
  orderGroupId: string
}

export interface PjLaunchRequest {
  customerId: string
  deliveryDate: string
  obs: string
  // `quantity`, `unit` e `pack_units` são o que a tela mostrou na revisão; o
  // banco recalcula pelo cadastro e recusa se não bater.
  lines: Array<{
    product_source: string
    product_id: string
    sale_option_id?: string
    packs: number
    quantity: number
    unit: PricingUnit
    pack_units: number | null
  }>
}

export interface PjLaunchPending {
  attempt: PjLaunchAttempt
  request: PjLaunchRequest
  customerName: string
}

export interface PjOrderLaunchOrigin {
  orderGroupId: string
  launchedByName: string
  launchedByMe: boolean
}

const NOT_SAVED_HINT = 'pj-launch-not-saved'

// Recusa do banco. Só a que traz a dica do contrato prova que nenhuma
// tentativa com aquele identificador foi gravada; qualquer outra (acesso,
// espera por trava, cancelamento) deixa a tentativa para ser repetida.
export class PjLaunchRefusedError extends Error {
  constructor(message: string, readonly notSaved: boolean) {
    super(message)
  }
}

const INCOMPLETE = 'Resposta incompleta da lista de produtos. Recarregue a página.'

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(INCOMPLETE)
  return value
}

function optionalText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return text(value)
}

function positive(value: unknown): number {
  const numeric = Number(value)
  if (value === null || value === undefined || !Number.isFinite(numeric) || numeric <= 0) throw new Error(INCOMPLETE)
  return numeric
}

function optionalPositive(value: unknown): number | null {
  if (value === null || value === undefined) return null
  return positive(value)
}

export function parsePjLaunchCatalog(data: unknown): PjLaunchCatalog {
  if (!data || typeof data !== 'object') throw new Error(INCOMPLETE)
  const body = data as Record<string, unknown>
  if (!Array.isArray(body.customers) || !Array.isArray(body.items)) throw new Error(INCOMPLETE)
  const customers = body.customers.map((row): PjLaunchCustomer => {
    const value = row as Record<string, unknown>
    return { id: text(value.id), name: text(value.name), blockedReason: optionalText(value.blocked_reason) }
  })
  const items = body.items.map((row): PjLaunchItem => {
    const value = row as Record<string, unknown>
    if (value.product_source !== 'bread' && value.product_source !== 'product') throw new Error(INCOMPLETE)
    if (value.pricing_unit !== 'un' && value.pricing_unit !== 'kg') throw new Error(INCOMPLETE)
    return {
      customerId: text(value.customer_id),
      productSource: value.product_source,
      productId: text(value.product_id),
      saleOptionId: optionalText(value.sale_option_id),
      productName: text(value.product_name),
      saleOptionName: optionalText(value.sale_option_name),
      pricingUnit: value.pricing_unit,
      packSize: positive(value.pack_size),
      packRuleSize: optionalPositive(value.pack_rule_size),
      packRuleMin: optionalPositive(value.pack_rule_min),
      packRuleMultiple: optionalPositive(value.pack_rule_multiple),
      unitWeightKg: optionalPositive(value.unit_weight_kg),
      blockedReason: optionalText(value.blocked_reason),
    }
  })
  return { today: text(body.today), customers, items }
}

export async function loadPjLaunchCatalog(): Promise<PjLaunchCatalog> {
  const { data, error } = await supabase.rpc('list_pj_launch_catalog')
  if (error?.code === '42501') throw new PjLaunchRefusedError('Seu acesso não permite lançar Pedido PJ. Peça ao administrador.', false)
  if (error) throw new Error('Não foi possível carregar clientes e produtos. Recarregue a página.')
  return parsePjLaunchCatalog(data)
}

export function pjLaunchItemKey(item: Pick<PjLaunchItem, 'productSource' | 'productId' | 'saleOptionId'>): string {
  return `${item.productSource}|${item.productId}|${item.saleOptionId ?? ''}`
}

export function pjLaunchItemLabel(item: Pick<PjLaunchItem, 'productName' | 'saleOptionName'>): string {
  return item.saleOptionName ? `${item.productName} · ${item.saleOptionName}` : item.productName
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function formatQuantity(value: number): string {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${formatQuantity(count)} ${count === 1 ? singular : pluralForm}`
}

// Pacote fechado em kg pesa o tamanho do pacote vezes o peso da unidade,
// com três casas, igual ao banco (12 x 0,08 kg = 0,96 kg).
function packPhysicalKg(item: PjLaunchItem): number | null {
  if (item.packRuleSize === null || item.unitWeightKg === null) return null
  return round3(item.packRuleSize * item.unitWeightKg)
}

// A quantidade digitada é sempre recusada se for inválida, nunca ajustada:
// arredondar esconderia uma mudança de quantidade cobrada.
export function parsePjLaunchQuantity(rawValue: string, item: PjLaunchItem): number | null {
  const normalized = rawValue.trim().replace(',', '.')
  if (item.packRuleSize !== null || item.pricingUnit === 'un') {
    if (!/^[1-9][0-9]{0,4}$/.test(normalized)) return null
    return Number(normalized)
  }
  if (!/^\d{1,5}(\.\d{1,3})?$/.test(normalized)) return null
  const quantity = Number(normalized)
  return quantity > 0 ? quantity : null
}

export function pjLaunchQuantityLabel(item: PjLaunchItem): string {
  if (item.packRuleSize !== null) return 'Pacotes'
  if (item.pricingUnit === 'kg') return item.packSize === 1 ? 'Quilos' : 'Pacotes'
  return item.packSize === 1 ? 'Unidades' : 'Pacotes'
}

export function pjLaunchQuantityHint(item: PjLaunchItem): string {
  if (item.packRuleSize !== null) {
    const parts = [`Pacote fechado de ${formatQuantity(item.packRuleSize)} unidades`]
    if (item.packRuleMin !== null && item.packRuleMin > 1) parts.push(`mínimo de ${formatQuantity(item.packRuleMin)} pacotes`)
    if (item.packRuleMultiple !== null && item.packRuleMultiple > 1) parts.push(`em múltiplos de ${formatQuantity(item.packRuleMultiple)}`)
    return `${parts.join(', ')}. Informe pacotes inteiros.`
  }
  if (item.pricingUnit === 'kg') {
    return item.packSize === 1 ? 'Em quilos, com até três casas (ex.: 2,5).' : `Pacotes de ${formatQuantity(item.packSize)} kg.`
  }
  return item.packSize === 1 ? 'Em unidades inteiras.' : `Pacotes de ${formatQuantity(item.packSize)} unidades.`
}

// Mesma conta do banco: pacote fechado em unidades, pacote fechado em kg com
// três casas por pacote, ou pacote da tabela.
export function pjLaunchPhysicalQuantity(item: PjLaunchItem, packs: number): number | null {
  if (item.packRuleSize !== null) {
    if (item.pricingUnit === 'un') return packs * item.packRuleSize
    const kg = packPhysicalKg(item)
    return kg === null ? null : round3(packs * kg)
  }
  return round3(packs * item.packSize)
}

export function describePjLaunchQuantity(item: PjLaunchItem, packs: number): string {
  if (item.packRuleSize !== null) {
    const units = packs * item.packRuleSize
    const base = `${plural(packs, 'pacote', 'pacotes')} = ${plural(units, 'unidade', 'unidades')}`
    const kg = packPhysicalKg(item)
    return item.pricingUnit === 'kg' && kg !== null ? `${base} = ${formatQuantity(round3(packs * kg))} kg` : base
  }
  const total = round3(packs * item.packSize)
  if (item.pricingUnit === 'kg') {
    return item.packSize === 1 ? `${formatQuantity(total)} kg` : `${plural(packs, 'pacote', 'pacotes')} = ${formatQuantity(total)} kg`
  }
  return item.packSize === 1 ? plural(total, 'unidade', 'unidades')
    : `${plural(packs, 'pacote', 'pacotes')} = ${plural(total, 'unidade', 'unidades')}`
}

// Antecipa na tela as regras de pacote que o banco confere; a decisão final
// continua no banco.
export function pjLaunchLineProblem(item: PjLaunchItem, packs: number | null): string | null {
  if (item.blockedReason) return item.blockedReason
  if (packs === null) {
    return item.packRuleSize !== null || item.pricingUnit === 'un'
      ? 'Informe um número inteiro maior que zero.'
      : 'Informe uma quantidade maior que zero, com até três casas.'
  }
  if (pjLaunchPhysicalQuantity(item, packs) === null) {
    return 'Falta o peso da unidade para fechar o pacote em kg. Avise o Financeiro.'
  }
  if (item.packRuleSize !== null) {
    if (item.packRuleMin !== null && packs < item.packRuleMin) {
      return `O mínimo deste produto é ${plural(item.packRuleMin, 'pacote', 'pacotes')}.`
    }
    if (item.packRuleMultiple !== null && packs % item.packRuleMultiple !== 0) {
      return `Este produto sai em múltiplos de ${plural(item.packRuleMultiple, 'pacote', 'pacotes')}.`
    }
  }
  return null
}

export function buildPjLaunchRequest(
  customerId: string,
  deliveryDate: string,
  obs: string,
  lines: readonly PjLaunchLine[],
): PjLaunchRequest {
  return {
    customerId,
    deliveryDate,
    obs: obs.trim(),
    lines: lines.map(line => ({
      product_source: line.item.productSource,
      product_id: line.item.productId,
      ...(line.item.saleOptionId ? { sale_option_id: line.item.saleOptionId } : {}),
      packs: line.packs,
      quantity: pjLaunchPhysicalQuantity(line.item, line.packs) ?? 0,
      unit: line.item.pricingUnit,
      pack_units: line.item.packRuleSize,
    })),
  }
}

export function newPjLaunchAttempt(): PjLaunchAttempt {
  return { requestId: crypto.randomUUID(), orderGroupId: crypto.randomUUID() }
}

// Recusa do banco com a dica do contrato libera uma tentativa nova depois da
// correção. Sem a dica, não dá para saber se o pedido foi gravado: a mesma
// tentativa precisa ser repetida, e o banco devolve o pedido já gravado em
// vez de gravar outro.
export async function createPjOrderByExpedition(
  attempt: PjLaunchAttempt,
  request: PjLaunchRequest,
): Promise<{ orderGroupId: string; repeated: boolean }> {
  let response: Awaited<ReturnType<typeof callCreate>>
  try {
    response = await callCreate(attempt, request)
  } catch {
    throw new Error('Não foi possível confirmar o lançamento. Tente de novo: o mesmo pedido não é gravado duas vezes.')
  }
  const { data, error } = response
  if (error && error.code && /^[0-9A-Z]{5}$/.test(error.code)) {
    throw new PjLaunchRefusedError(error.code === '42501'
      ? 'Seu acesso não permite lançar Pedido PJ. Peça ao administrador.'
      : error.message, error.hint === NOT_SAVED_HINT)
  }
  if (error) throw new Error('Não foi possível confirmar o lançamento. Tente de novo: o mesmo pedido não é gravado duas vezes.')
  const body = data as Record<string, unknown> | null
  if (!body || body.order_group_id !== attempt.orderGroupId) {
    throw new Error('Resposta incompleta do lançamento. Tente de novo: o mesmo pedido não é gravado duas vezes.')
  }
  return { orderGroupId: attempt.orderGroupId, repeated: body.repeated === true }
}

function callCreate(attempt: PjLaunchAttempt, request: PjLaunchRequest) {
  return supabase.rpc('create_pj_order_by_expedition', {
    p_request_id: attempt.requestId,
    p_order_group_id: attempt.orderGroupId,
    p_customer_id: request.customerId,
    p_delivery_date: request.deliveryDate,
    p_obs: request.obs,
    p_lines: request.lines,
  })
}

// Uma chave por tentativa: duas abas abertas guardam e confirmam cada uma a
// sua, sem apagar a da outra.
export const PJ_LAUNCH_PENDING_PREFIX = 'pane_pj_launch_pending:'

function pendingKey(userId: string, requestId: string): string {
  return `${PJ_LAUNCH_PENDING_PREFIX}${userId}:${requestId}`
}

function parsePending(raw: string | null): PjLaunchPending | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as PjLaunchPending
    if (!value?.attempt?.requestId || !value.attempt.orderGroupId || !value.request?.customerId
      || !value.request.deliveryDate || !Array.isArray(value.request.lines)
      || typeof value.customerName !== 'string') return null
    return value
  } catch {
    return null
  }
}

export function readPjLaunchPendings(userId: string): PjLaunchPending[] {
  try {
    const prefix = `${PJ_LAUNCH_PENDING_PREFIX}${userId}:`
    const pendings: PjLaunchPending[] = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key?.startsWith(prefix)) continue
      const pending = parsePending(localStorage.getItem(key))
      if (pending && key === pendingKey(userId, pending.attempt.requestId)) pendings.push(pending)
    }
    return pendings
  } catch {
    return []
  }
}

// Devolve se a tentativa ficou guardada no aparelho. Quando não fica (sem
// espaço, navegação privada), o pedido novo não deve ser enviado: uma
// resposta perdida não teria como ser repetida com o mesmo identificador.
export function savePjLaunchPending(userId: string, pending: PjLaunchPending): boolean {
  try {
    localStorage.setItem(pendingKey(userId, pending.attempt.requestId), JSON.stringify(pending))
    return true
  } catch {
    return false
  }
}

export function clearPjLaunchPending(userId: string, requestId: string): void {
  try { localStorage.removeItem(pendingKey(userId, requestId)) } catch { /* nada a limpar */ }
}

// Mesmo cliente e mesma entrega ainda em andamento: aviso, nunca bloqueio,
// porque dois pedidos no mesmo dia podem ser legítimos.
export function hasSimilarPjOrder(
  flows: ReadonlyArray<{ customer: string; delivery_date: string; departed_at: string | null }>,
  customerName: string,
  deliveryDate: string,
): boolean {
  const name = customerName.trim().toLocaleLowerCase('pt-BR')
  return flows.some(flow => !flow.departed_at
    && flow.delivery_date.slice(0, 10) === deliveryDate
    && flow.customer.trim().toLocaleLowerCase('pt-BR') === name)
}

const ORIGINS_TIMEOUT_MS = 8000

// Marca informativa: falha ou demora devolve a lista sem origem, nunca erro.
export async function loadPjOrderLaunchOrigins(orderGroupIds: readonly string[]): Promise<Map<string, PjOrderLaunchOrigin>> {
  const origins = new Map<string, PjOrderLaunchOrigin>()
  if (orderGroupIds.length === 0) return origins
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ORIGINS_TIMEOUT_MS)
  let response: { data: unknown; error: unknown }
  try {
    response = await supabase.rpc('list_pj_order_launch_origins', {
      p_order_group_ids: orderGroupIds.slice(0, 500),
    }).abortSignal(controller.signal)
  } catch {
    return origins
  } finally {
    clearTimeout(timer)
  }
  const { data, error } = response
  if (error || !Array.isArray(data)) return origins
  for (const row of data as Array<Record<string, unknown>>) {
    if (typeof row.order_group_id !== 'string') continue
    origins.set(row.order_group_id, {
      orderGroupId: row.order_group_id,
      launchedByName: typeof row.launched_by_name === 'string' ? row.launched_by_name : 'Expedição',
      launchedByMe: row.launched_by_me === true,
    })
  }
  return origins
}

export function describePjLaunchOrigin(origin: PjOrderLaunchOrigin): string {
  return origin.launchedByMe ? 'Lançado por você' : `Lançado pela Expedição · ${origin.launchedByName}`
}
