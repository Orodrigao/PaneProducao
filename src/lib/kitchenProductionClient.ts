// Acesso a dados da Produção da Cozinha. As regras puras ficam em
// kitchenProduction.ts; aqui só a conversa com o Supabase.

import { supabase } from '@/lib/supabase'
import {
  KITCHEN_PRODUCTION_AREA,
  KITCHEN_PRODUCTION_PERMISSION,
  type KitchenEntry,
  type KitchenItem,
  type KitchenPermission,
  type KitchenSavePlan,
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
    .select('id,product_id,quantity,recorded_by_name,updated_at')
    .eq('store', store)
    .eq('record_date', recordDate)

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

export async function applyKitchenSavePlan(plan: KitchenSavePlan): Promise<void> {
  if (plan.upserts.length > 0) {
    const { error } = await supabase
      .from('kitchen_production')
      .upsert(plan.upserts, { onConflict: 'store,product_id,record_date' })
    if (error) throw error
  }

  if (plan.deleteIds.length > 0) {
    const { error } = await supabase
      .from('kitchen_production')
      .delete()
      .in('id', plan.deleteIds)
    if (error) throw error
  }
}
