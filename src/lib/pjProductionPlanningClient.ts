import { supabase } from '@/lib/supabase'
import type {
  PjProductionQueueRow,
  PjProductionSelection,
} from '@/lib/pjProductionPlanning'

export interface SchedulePjProductionResult {
  scheduled_count: number
  idempotent: boolean
  production_date: string
}

function rpcRows<T>(data: unknown): T[] {
  return Array.isArray(data) ? data as T[] : []
}

export async function fetchPjProductionQueue(): Promise<PjProductionQueueRow[]> {
  const current = await supabase.rpc('list_pj_production_queue_v2')
  if (!current.error) return rpcRows<PjProductionQueueRow>(current.data)
  if (!['42883', 'PGRST202'].includes(current.error.code ?? '')) throw current.error

  const legacy = await supabase.rpc('list_pj_production_queue')
  if (legacy.error) throw legacy.error
  return rpcRows<PjProductionQueueRow>(legacy.data)
}

export async function schedulePjProduction(
  productionDate: string,
  selections: readonly PjProductionSelection[],
  requestId: string,
): Promise<SchedulePjProductionResult> {
  const { data, error } = await supabase.rpc('schedule_pj_production', {
    p_production_date: productionDate,
    p_items: selections.map(selection => ({
      order_id: selection.orderId,
      quantity: selection.quantity,
      frozen_quantity: selection.frozenQuantity,
    })),
    p_request_id: requestId,
  })
  if (error) throw error
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('O banco não confirmou a programação PJ.')
  }
  return data as unknown as SchedulePjProductionResult
}
