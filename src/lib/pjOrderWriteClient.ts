import { supabase } from '@/lib/supabase'

export interface PjOrderWriteRow {
  bread_id: string
  product_source: 'bread' | 'product'
  product_name: string
  quantity: number
  unit_price: number
  pack_size: number
  pricing_unit: 'un' | 'kg'
  sale_option_id?: string | null
  customer_id: string
  pj_client: string
  order_date: string
  delivery_date: string
  production_date: null
  obs: string | null
}

export interface PjOrderWriteResult {
  repeated: boolean
  order_group_id: string
  row_count: number
  flow_enabled: boolean
}

export interface PjOrderCancelResult extends PjOrderWriteResult {
  cancelled_at: string
  cancelled_by: string | null
  cancel_reason: string
}

export type PjWriteOperation = 'create' | 'replace' | 'cancel'

export class PjOrderWriteError extends Error {
  constructor(message: string, readonly ambiguous: boolean, readonly code?: string) {
    super(message)
    this.name = 'PjOrderWriteError'
  }
}

export interface PjWriteAttempt {
  operation: PjWriteOperation
  subjectKey: string
  payloadKey: string
  requestId: string
  orderGroupId: string
}

export interface PjPendingCreate {
  userId: string
  requestId: string
  orderGroupId: string
  rows: readonly PjOrderWriteRow[]
}

function pendingCreateKey(userId: string): string {
  return `pane_pj_pending_create:${userId}`
}

function payloadKey(payload: unknown): string {
  return JSON.stringify(payload)
}

export function resolvePjWriteAttempt(
  current: PjWriteAttempt | null,
  operation: PjWriteOperation,
  existingOrderGroupId: string | null,
  payload: unknown,
  generateId: () => string = () => crypto.randomUUID(),
): PjWriteAttempt {
  const subjectKey = operation === 'create' ? 'new-order' : existingOrderGroupId ?? 'missing-order'
  const nextPayloadKey = payloadKey(payload)
  if (
    current?.operation === operation
    && current.subjectKey === subjectKey
    && current.payloadKey === nextPayloadKey
  ) return current

  if (operation !== 'create' && !existingOrderGroupId) {
    throw new Error('Pedido antigo sem identificação. Fale com o Rodrigo.')
  }

  return {
    operation,
    subjectKey,
    payloadKey: nextPayloadKey,
    requestId: generateId(),
    orderGroupId: existingOrderGroupId ?? generateId(),
  }
}

export function matchesPjWriteAttempt(
  attempt: PjWriteAttempt | null,
  operation: PjWriteOperation,
  existingOrderGroupId: string | null,
  payload: unknown,
): boolean {
  const subjectKey = operation === 'create' ? 'new-order' : existingOrderGroupId ?? 'missing-order'
  return attempt?.operation === operation
    && attempt.subjectKey === subjectKey
    && attempt.payloadKey === payloadKey(payload)
}

function browserStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage
}

export function rememberPendingPjCreate(
  userId: string,
  attempt: PjWriteAttempt,
  rows: readonly PjOrderWriteRow[],
  storage: Pick<Storage, 'setItem'> | null = browserStorage(),
): void {
  if (!storage) return
  storage.setItem(pendingCreateKey(userId), JSON.stringify({
    userId,
    requestId: attempt.requestId,
    orderGroupId: attempt.orderGroupId,
    rows,
  } satisfies PjPendingCreate))
}

export function readPendingPjCreate(
  userId: string,
  storage: Pick<Storage, 'getItem'> | null = browserStorage(),
): PjPendingCreate | null {
  if (!storage) return null
  try {
    const value = JSON.parse(storage.getItem(pendingCreateKey(userId)) ?? 'null') as Partial<PjPendingCreate> | null
    if (!value || value.userId !== userId || typeof value.requestId !== 'string'
      || typeof value.orderGroupId !== 'string' || !Array.isArray(value.rows)) return null
    return value as PjPendingCreate
  } catch {
    return null
  }
}

export function clearPendingPjCreate(
  userId: string,
  storage: Pick<Storage, 'removeItem'> | null = browserStorage(),
): void {
  storage?.removeItem(pendingCreateKey(userId))
}

export function pendingPjCreateAttempt(pending: PjPendingCreate): PjWriteAttempt {
  return {
    operation: 'create',
    subjectKey: 'new-order',
    payloadKey: payloadKey(pending.rows),
    requestId: pending.requestId,
    orderGroupId: pending.orderGroupId,
  }
}

function isWriteResult(data: unknown): data is PjOrderWriteResult {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  const result = data as Partial<PjOrderWriteResult>
  return typeof result.repeated === 'boolean'
    && typeof result.order_group_id === 'string'
    && typeof result.row_count === 'number'
    && typeof result.flow_enabled === 'boolean'
}

function parseWriteResult(data: unknown): PjOrderWriteResult {
  if (!isWriteResult(data)) {
    throw new PjOrderWriteError('O banco não confirmou a gravação do pedido PJ.', true)
  }
  return data
}

function parseCancelResult(data: unknown): PjOrderCancelResult {
  if (!isWriteResult(data)) {
    throw new PjOrderWriteError('O banco não confirmou o cancelamento do pedido PJ.', true)
  }
  const result = data as Partial<PjOrderCancelResult>
  if (
    typeof result.cancelled_at !== 'string'
    || (typeof result.cancelled_by !== 'string' && result.cancelled_by !== null)
    || typeof result.cancel_reason !== 'string'
  ) throw new PjOrderWriteError('O banco não confirmou o cancelamento do pedido PJ.', true)
  return result as PjOrderCancelResult
}

function rpcError(error: { message: string; code?: string }): PjOrderWriteError {
  // Somente as recusas que estes contratos levantam de propósito liberam outra
  // identidade. Há códigos SQL (08007 e 40003, por exemplo) cujo significado é
  // justamente "não sabemos se confirmou"; neles preservar é mais seguro.
  const code = typeof error.code === 'string' && error.code ? error.code : undefined
  const deterministicRefusals = new Set(['22023', '42501', 'P0002', '55000'])
  return new PjOrderWriteError(error.message, !code || !deterministicRefusals.has(code), code)
}

export async function createPjOrder(
  attempt: PjWriteAttempt,
  rows: readonly PjOrderWriteRow[],
): Promise<PjOrderWriteResult> {
  const { data, error } = await supabase.rpc('create_pj_order_atomic', {
    p_request_id: attempt.requestId,
    p_order_group_id: attempt.orderGroupId,
    p_rows: rows,
  })
  if (error) throw rpcError(error)
  return parseWriteResult(data)
}

export async function replacePjOrder(
  attempt: PjWriteAttempt,
  rows: readonly PjOrderWriteRow[],
): Promise<PjOrderWriteResult> {
  const { data, error } = await supabase.rpc('replace_pj_order_atomic', {
    p_request_id: attempt.requestId,
    p_order_group_id: attempt.orderGroupId,
    p_rows: rows,
  })
  if (error) throw rpcError(error)
  return parseWriteResult(data)
}

export async function cancelPjOrder(
  attempt: PjWriteAttempt,
  reason: string,
): Promise<PjOrderCancelResult> {
  const { data, error } = await supabase.rpc('cancel_pj_order_atomic', {
    p_request_id: attempt.requestId,
    p_order_group_id: attempt.orderGroupId,
    p_reason: reason,
  })
  if (error) throw rpcError(error)
  return parseCancelResult(data)
}
