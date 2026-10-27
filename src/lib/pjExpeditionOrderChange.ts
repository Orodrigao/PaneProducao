import { supabase } from './supabase'
import {
  pjLaunchItemKey,
  pjLaunchItemLabel,
  pjLaunchPhysicalQuantity,
  PjLaunchRefusedError,
  type PjLaunchCatalog,
  type PjLaunchItem,
  type PjLaunchRequest,
} from './pjExpeditionLaunch'

// Correção e cancelamento, pela Expedição JC, do Pedido PJ que ela mesma
// lançou, enquanto a conferência não começou. Como no lançamento, a tela
// nunca recebe nem envia preço; o banco confere autoria, estado e versão na
// mesma transação e reprecifica pela tabela do cliente.

export interface PjOrderHistoryEntry {
  action: string
  byName: string
  byMe: boolean
  at: string
}

export interface PjExpeditionOrderLine {
  productSource: 'bread' | 'product'
  productId: string
  saleOptionId: string | null
  productName: string
  quantity: number
  unit: string
}

export interface PjExpeditionOrderRowVersion {
  id: string
  updated_at: string
}

export interface PjExpeditionOrder {
  customerId: string
  customerName: string
  deliveryDate: string
  obs: string
  expectedRows: PjExpeditionOrderRowVersion[]
  lines: PjExpeditionOrderLine[]
}

export interface PjExpeditionOrderState {
  orderGroupId: string
  history: PjOrderHistoryEntry[]
  canChange: boolean
  changeBlockedReason: string | null
  order: PjExpeditionOrder | null
}

export interface PjChangeAttempt {
  requestId: string
}

const INCOMPLETE = 'Resposta incompleta do pedido. Recarregue a página.'
const NOT_SAVED_HINT = 'pj-launch-not-saved'

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(INCOMPLETE)
  return value
}

export function parsePjExpeditionOrderState(data: unknown): PjExpeditionOrderState {
  if (!data || typeof data !== 'object') throw new Error(INCOMPLETE)
  const body = data as Record<string, unknown>
  if (!Array.isArray(body.history) || typeof body.can_change !== 'boolean') throw new Error(INCOMPLETE)
  const history = body.history.map((row): PjOrderHistoryEntry => {
    const value = row as Record<string, unknown>
    return { action: text(value.action), byName: text(value.by_name), byMe: value.by_me === true, at: text(value.at) }
  })
  let order: PjExpeditionOrder | null = null
  if (body.order !== null && body.order !== undefined) {
    const value = body.order as Record<string, unknown>
    if (!Array.isArray(value.lines) || !Array.isArray(value.expected_rows)) throw new Error(INCOMPLETE)
    order = {
      customerId: text(value.customer_id),
      customerName: text(value.customer_name),
      deliveryDate: text(value.delivery_date),
      obs: typeof value.obs === 'string' ? value.obs : '',
      expectedRows: value.expected_rows.map(row => {
        const version = row as Record<string, unknown>
        return { id: text(version.id), updated_at: text(version.updated_at) }
      }),
      lines: value.lines.map((row): PjExpeditionOrderLine => {
        const line = row as Record<string, unknown>
        if (line.product_source !== 'bread' && line.product_source !== 'product') throw new Error(INCOMPLETE)
        const quantity = Number(line.quantity)
        if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(INCOMPLETE)
        return {
          productSource: line.product_source,
          productId: text(line.product_id),
          saleOptionId: typeof line.sale_option_id === 'string' ? line.sale_option_id : null,
          productName: text(line.product_name),
          quantity,
          unit: text(line.unit),
        }
      }),
    }
  }
  if (body.can_change && !order) throw new Error(INCOMPLETE)
  return {
    orderGroupId: text(body.order_group_id),
    history,
    canChange: body.can_change,
    changeBlockedReason: typeof body.change_blocked_reason === 'string' ? body.change_blocked_reason : null,
    order,
  }
}

export async function readPjExpeditionOrder(orderGroupId: string): Promise<PjExpeditionOrderState> {
  const { data, error } = await supabase.rpc('read_pj_expedition_order', { p_order_group_id: orderGroupId })
  if (error?.code === '42501') throw new PjLaunchRefusedError('Seu acesso não permite consultar este pedido. Peça ao administrador.', false)
  if (error) throw new Error('Não foi possível carregar o pedido. Recarregue a página.')
  return parsePjExpeditionOrderState(data)
}

// Quem fez o quê, sem repetir o selo de origem da ficha ("Lançado pela
// Expedição · nome"). Ação nova no banco sem verbo aqui aparece pela chave,
// nunca some.
const HISTORY_VERBS: Record<string, string> = {
  create: 'criou o pedido',
  create_expedition: 'lançou pela Expedição',
  replace: 'alterou o pedido',
  replace_v2: 'alterou o pedido',
  replace_expedition: 'corrigiu pela Expedição',
  cancel: 'cancelou o pedido',
}

export function describePjOrderHistoryEntry(entry: PjOrderHistoryEntry): string {
  const verb = HISTORY_VERBS[entry.action] ?? entry.action
  return `${entry.byMe ? 'Você' : entry.byName} ${verb} · ${new Date(entry.at).toLocaleString('pt-BR')}`
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

// Caminho inverso do lançamento: quantos pacotes (ou unidades, ou quilos)
// a quantidade gravada representa pelo cadastro atual. Pacote que mudou no
// cadastro vira número quebrado, que o formulário marca para corrigir.
export function pjPacksFromQuantity(item: PjLaunchItem, quantity: number): number | null {
  let physical: number | null
  if (item.packRuleSize !== null) {
    physical = item.pricingUnit === 'un' ? item.packRuleSize
      : item.unitWeightKg === null ? null : round3(item.packRuleSize * item.unitWeightKg)
  } else {
    physical = item.packSize
  }
  if (!physical || physical <= 0) return null
  return round3(quantity / physical)
}

export interface RestoredPjLine {
  item: PjLaunchItem
  raw: string
}

// Reabre as linhas gravadas no formulário da fase 1. Produto que saiu da
// tabela, ficou bloqueado ou trocou de unidade não volta escondido: fica de
// fora com o aviso, e a correção só grava o que a Expedição revisar. A
// quantidade só volta preenchida quando os pacotes refazem exatamente a
// quantidade gravada; senão (1 kg com pacote novo de 3 kg viraria 0,999 kg)
// o campo volta vazio, com a quantidade anterior no aviso.
export function restorePjExpeditionLines(order: PjExpeditionOrder, catalog: PjLaunchCatalog): {
  lines: RestoredPjLine[]
  warnings: string[]
} {
  const lines: RestoredPjLine[] = []
  const warnings: string[] = []
  for (const line of order.lines) {
    const item = catalog.items.find(candidate => candidate.customerId === order.customerId
      && pjLaunchItemKey(candidate) === pjLaunchItemKey(line))
    if (!item || item.blockedReason) {
      warnings.push(`${line.productName} não está mais disponível na tabela do cliente e ficou fora da correção.`)
      continue
    }
    if (item.pricingUnit !== line.unit) {
      warnings.push(`A unidade de ${pjLaunchItemLabel(item)} mudou no cadastro. Informe a quantidade de novo.`)
      lines.push({ item, raw: '' })
      continue
    }
    const packs = pjPacksFromQuantity(item, line.quantity)
    if (packs === null || pjLaunchPhysicalQuantity(item, packs) !== round3(line.quantity)) {
      warnings.push(`O pacote de ${pjLaunchItemLabel(item)} mudou no cadastro e a quantidade anterior `
        + `(${line.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${line.unit}) não fecha com ele. `
        + 'Informe a quantidade de novo.')
      lines.push({ item, raw: '' })
      continue
    }
    lines.push({ item, raw: String(packs).replace('.', ',') })
  }
  return { lines, warnings }
}

export function newPjChangeAttempt(): PjChangeAttempt {
  return { requestId: crypto.randomUUID() }
}

function refusal(error: { code?: string; message: string; hint?: string }, accessMessage: string): PjLaunchRefusedError {
  return new PjLaunchRefusedError(error.code === '42501' ? accessMessage : error.message, error.hint === NOT_SAVED_HINT)
}

// Recusa com a dica do contrato prova que nada foi gravado. Sem a dica (rede,
// acesso, espera por trava), a mesma tentativa pode ser repetida: o banco
// devolve o resultado já gravado em vez de gravar de novo.
export async function replacePjOrderByExpedition(
  attempt: PjChangeAttempt,
  orderGroupId: string,
  request: Pick<PjLaunchRequest, 'deliveryDate' | 'obs' | 'lines'>,
  expectedRows: readonly PjExpeditionOrderRowVersion[],
): Promise<{ repeated: boolean }> {
  const unknown = 'Não foi possível confirmar a correção. Tente de novo: a mesma correção não é gravada duas vezes.'
  let response: Awaited<ReturnType<typeof callReplace>>
  try {
    response = await callReplace(attempt, orderGroupId, request, expectedRows)
  } catch {
    throw new Error(unknown)
  }
  const { data, error } = response
  if (error && error.code && /^[0-9A-Z]{5}$/.test(error.code)) {
    throw refusal(error, 'Seu acesso não permite corrigir Pedido PJ. Peça ao administrador.')
  }
  if (error) throw new Error(unknown)
  const body = data as Record<string, unknown> | null
  if (!body || body.order_group_id !== orderGroupId) throw new Error(unknown)
  return { repeated: body.repeated === true }
}

function callReplace(
  attempt: PjChangeAttempt,
  orderGroupId: string,
  request: Pick<PjLaunchRequest, 'deliveryDate' | 'obs' | 'lines'>,
  expectedRows: readonly PjExpeditionOrderRowVersion[],
) {
  return supabase.rpc('replace_pj_order_by_expedition', {
    p_request_id: attempt.requestId,
    p_order_group_id: orderGroupId,
    p_delivery_date: request.deliveryDate,
    p_obs: request.obs,
    p_lines: request.lines,
    p_expected_rows: expectedRows,
  })
}

export async function cancelPjOrderByExpedition(
  attempt: PjChangeAttempt,
  orderGroupId: string,
  reason: string,
): Promise<{ repeated: boolean }> {
  const unknown = 'Não foi possível confirmar o cancelamento. Tente de novo: o mesmo pedido não é cancelado duas vezes.'
  let response: Awaited<ReturnType<typeof callCancel>>
  try {
    response = await callCancel(attempt, orderGroupId, reason)
  } catch {
    throw new Error(unknown)
  }
  const { data, error } = response
  if (error && error.code && /^[0-9A-Z]{5}$/.test(error.code)) {
    throw refusal(error, 'Seu acesso não permite cancelar Pedido PJ. Peça ao administrador.')
  }
  if (error) throw new Error(unknown)
  const body = data as Record<string, unknown> | null
  if (!body || body.order_group_id !== orderGroupId) throw new Error(unknown)
  return { repeated: body.repeated === true }
}

function callCancel(attempt: PjChangeAttempt, orderGroupId: string, reason: string) {
  return supabase.rpc('cancel_pj_order_by_expedition', {
    p_request_id: attempt.requestId,
    p_order_group_id: orderGroupId,
    p_reason: reason,
  })
}

export function pjCancelReasonProblem(reason: string): string | null {
  const length = reason.trim().length
  if (length < 3) return 'Informe o motivo do cancelamento, com pelo menos 3 letras.'
  if (length > 500) return 'O motivo passa de 500 caracteres.'
  return null
}
