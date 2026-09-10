// Acesso a dados da Produção da Cozinha. As regras puras ficam em
// kitchenProduction.ts; aqui só a conversa com o Supabase.

import { supabase } from '@/lib/supabase'
import {
  KITCHEN_PRODUCTION_AREA,
  KITCHEN_PRODUCTION_PERMISSION,
  type KitchenBatchRequest,
  type KitchenEntry,
  type KitchenItem,
  type KitchenPermission,
  type KitchenPlanRow,
  type KitchenStore,
} from '@/lib/kitchenProduction'

export async function loadKitchenItems(): Promise<KitchenItem[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id,name,category,unit,production_process')
    .eq('active', true)
    .eq('is_fabricacao_propria', true)
    .eq('production_area', KITCHEN_PRODUCTION_AREA)
    .in('production_process', ['montagem', 'preparo'])
    .eq('allows_unplanned_production', true)
    .order('category', { ascending: true })
    .order('name', { ascending: true })

  if (error) throw error
  return (data ?? []) as KitchenItem[]
}

export async function loadKitchenEntries(
  store: KitchenStore,
  recordDate: string,
): Promise<KitchenEntry[]> {
  const current = await supabase
    .from('kitchen_production')
    .select(`
      id,
      product_id,
      quantity,
      recorded_by,
      recorded_by_name,
      produced_at,
      corrected_at,
      corrected_by,
      cancelled_at,
      cancelled_by,
      product_name,
      production_unit,
      production_process,
      production_area
    `)
    .eq('store', store)
    .eq('record_date', recordDate)
    .order('produced_at', { ascending: false })

  if (!current.error) return (current.data ?? []) as KitchenEntry[]
  if (!['42703', 'PGRST204'].includes(current.error.code ?? '')) throw current.error

  const legacy = await supabase
    .from('kitchen_production')
    .select('id,product_id,quantity,recorded_by,recorded_by_name,produced_at,corrected_at,corrected_by,cancelled_at,cancelled_by')
    .eq('store', store)
    .eq('record_date', recordDate)
    .order('produced_at', { ascending: false })
  if (legacy.error) throw legacy.error
  return (legacy.data ?? []).map(entry => ({
    ...entry,
    product_name: null,
    production_unit: null,
    production_process: null,
    production_area: null,
  })) as KitchenEntry[]
}

export async function loadKitchenPermissions(): Promise<KitchenPermission[]> {
  const { data, error } = await supabase
    .from('app_user_permissions')
    .select('permission_key,scope')
    .eq('permission_key', KITCHEN_PRODUCTION_PERMISSION)

  if (error) throw error
  return (data ?? []) as KitchenPermission[]
}

export async function recordKitchenBatches(
  store: KitchenStore,
  batches: readonly KitchenBatchRequest[],
  requestId: string,
): Promise<void> {
  const current = await supabase.rpc('record_kitchen_batches_v2', {
    p_store: store,
    p_batches: batches,
    p_request_id: requestId,
  })
  if (!current.error) return
  if (!['42883', 'PGRST202'].includes(current.error.code ?? '')) throw current.error

  const legacy = await supabase.rpc('record_kitchen_batches', {
    p_store: store,
    p_batches: batches,
  })
  if (legacy.error) throw legacy.error
}

export async function loadKitchenProductionPlan(
  store: KitchenStore,
  recordDate: string,
): Promise<KitchenPlanRow[]> {
  const { data, error } = await supabase.rpc('list_kitchen_production_plan', {
    p_store: store,
    p_production_date: recordDate,
  })
  if (error && ['42883', 'PGRST202'].includes(error.code ?? '')) return []
  if (error) throw error
  return (Array.isArray(data) ? data : []) as KitchenPlanRow[]
}

export async function correctKitchenBatch(batchId: string, quantity: number): Promise<void> {
  const current = await supabase.rpc('correct_kitchen_batch_v2', {
    p_batch_id: batchId,
    p_quantity: quantity,
  })
  if (!current.error) return
  if (!['42883', 'PGRST202'].includes(current.error.code ?? '')) throw current.error

  const legacy = await supabase.rpc('correct_kitchen_batch', {
    p_batch_id: batchId,
    p_quantity: quantity,
  })
  if (legacy.error) throw legacy.error
}

export async function cancelKitchenBatch(batchId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_kitchen_batch', {
    p_batch_id: batchId,
  })
  if (error) throw error
}
