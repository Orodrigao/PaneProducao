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
