import { supabase } from './supabase'

export interface PjDispatchOrderRow {
  id: string
  order_group_id: string | null
  customer_id: string | null
  customer_name: string
  order_date: string
  delivery_date: string | null
  production_date: string | null
  bread_id: string
  product_source: string | null
  product_name: string | null
  quantity: number
  pack_size: number | null
  pricing_unit: string | null
  sale_option_id: string | null
  obs: string | null
  cancelled_at: string | null
  dispatched_at: string | null
  dispatched_by: string | null
  dispatched_by_name: string | null
  dispatched_quantity: number | null
  dispatched_quantity_reason: string | null
  dispatched_quantity_at: string | null
  dispatched_quantity_by_name: string | null
}

/** Um item indo para a conferência. `quantity` null limpa o que estava lá. */
export interface PjDispatchQuantityInput {
  order_id: string
  quantity: number | null
  reason: string | null
}

export interface PjDispatchCheckSummary {
  linhas: number
  conferidas: number
  pendentes: number
  nao_enviadas: number
  version: string | null
  itens: Array<{
    order_id: string
    quantity: number | null
    reason: string | null
    checked_at: string | null
    checked_by_name: string | null
  }>
}

export interface PjOrderDispatchResult {
  dispatched_at: string
  dispatched_by: string | null
  dispatched_by_name: string
  already_dispatched: boolean
}

type LoadDispatchOrdersResult =
  | { ok: true; orders: PjDispatchOrderRow[] }
  | { ok: false; message: string }

type ConfirmDispatchResult =
  | { ok: true; dispatch: PjOrderDispatchResult }
  | { ok: false; message: string }

type SaveCheckResult =
  | { ok: true; summary: PjDispatchCheckSummary }
  | { ok: false; message: string; stale?: boolean }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export async function loadPjOrdersForDispatch(): Promise<LoadDispatchOrdersResult> {
  const { data, error } = await supabase.rpc('list_pj_orders_for_dispatch')

  if (error) {
    return {
      ok: false,
      message: `Não foi possível carregar os pedidos para expedição: ${error.message}`,
    }
  }
  if (!Array.isArray(data)) {
    return { ok: false, message: 'A fila de expedição retornou um formato inválido.' }
  }

  return { ok: true, orders: data as PjDispatchOrderRow[] }
}

/**
 * Grava a conferência do pedido inteiro numa transação só.
 *
 * `expectedVersion` é o carimbo de conferência mais recente que a tela viu ao
 * abrir. Se alguém gravou no meio, o banco recusa e a tela recarrega: sem
 * isso, vence quem salvar por último, não quem está certo.
 */
export async function savePjOrderDispatchQuantities(
  orderGroupId: string,
  items: PjDispatchQuantityInput[],
  expectedVersion: string | null,
  requestId: string,
): Promise<SaveCheckResult> {
  if (!orderGroupId) return { ok: false, message: 'Pedido sem identificação para conferir.' }
  if (items.length === 0) return { ok: false, message: 'Nenhum item para conferir.' }

  const { data, error } = await supabase.rpc('save_pj_order_dispatch_quantities', {
    p_request_id: requestId,
    p_order_group_id: orderGroupId,
    p_items: items,
    p_expected_version: expectedVersion,
  })

  if (error) {
    // 40001 é a recusa por tela desatualizada: a saída é recarregar, não
    // tentar de novo com os mesmos números.
    const stale = error.code === '40001'
    return {
      ok: false,
      stale,
      message: stale
        ? 'Outra pessoa conferiu este pedido enquanto você preenchia. Recarregue para ver o que já foi gravado.'
        : `Não foi possível salvar a conferência: ${error.message}`,
    }
  }
  if (!isRecord(data) || typeof data.linhas !== 'number') {
    return { ok: false, message: 'O banco não confirmou a conferência.' }
  }

  return { ok: true, summary: data as unknown as PjDispatchCheckSummary }
}

export async function confirmPjOrderDispatch(orderGroupId: string): Promise<ConfirmDispatchResult> {
  if (!orderGroupId) return { ok: false, message: 'Pedido sem identificação para confirmar o envio.' }

  const { data, error } = await supabase.rpc('confirm_pj_order_dispatch', {
    p_order_group_id: orderGroupId,
  })

  if (error) {
    return {
      ok: false,
      message: `Não foi possível marcar o pedido como enviado: ${error.message}`,
    }
  }
  if (
    !isRecord(data)
    || typeof data.dispatched_at !== 'string'
    || (data.dispatched_by !== null && typeof data.dispatched_by !== 'string')
    || typeof data.dispatched_by_name !== 'string'
    || typeof data.already_dispatched !== 'boolean'
  ) {
    return { ok: false, message: 'O banco não confirmou os dados do envio.' }
  }

  return {
    ok: true,
    dispatch: {
      dispatched_at: data.dispatched_at,
      dispatched_by: data.dispatched_by,
      dispatched_by_name: data.dispatched_by_name,
      already_dispatched: data.already_dispatched,
    },
  }
}
