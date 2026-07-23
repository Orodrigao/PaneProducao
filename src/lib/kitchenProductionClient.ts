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
  type KitchenStore,
} from '@/lib/kitchenProduction'

export async function loadKitchenItems(): Promise<KitchenItem[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id,name,category,unit')
    .eq('active', true)
    .eq('production_area', KITCHEN_PRODUCTION_AREA)
    .order('category', { ascending: true })
    .order('name', { ascending: true })

  if (error) throw error
  return (data ?? []) as KitchenItem[]
}

export async function loadKitchenEntries(
  store: KitchenStore,
  recordDate: string,
): Promise<KitchenEntry[]> {
  const { data, error } = await supabase
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
      cancelled_by
    `)
    .eq('store', store)
    .eq('record_date', recordDate)
    .order('produced_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as KitchenEntry[]
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
): Promise<void> {
  const { error } = await supabase.rpc('record_kitchen_batches', {
    p_store: store,
    p_batches: batches,
  })
  if (error) throw error
}

export async function correctKitchenBatch(batchId: string, quantity: number): Promise<void> {
  const { error } = await supabase.rpc('correct_kitchen_batch', {
    p_batch_id: batchId,
    p_quantity: quantity,
  })
  if (error) throw error
}

export async function cancelKitchenBatch(batchId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_kitchen_batch', {
    p_batch_id: batchId,
  })
  if (error) throw error
}
