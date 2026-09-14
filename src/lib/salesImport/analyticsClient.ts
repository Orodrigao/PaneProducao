import { supabase } from '@/lib/supabase'
import {
  saleUnitsForProduct,
  type SalesAbcResult,
  type SalesCatalogProduct,
  type SalesMappingStatus,
  type SalesProductMappingRow,
} from './analytics'

function message(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const detail = (error as { message?: unknown }).message
    if (typeof detail === 'string' && detail) return detail
  }
  return fallback
}

export async function loadSalesProductMappingQueue(): Promise<SalesProductMappingRow[]> {
  const { data, error } = await supabase.rpc('get_sales_product_mapping_queue', {
    p_source_system: 'cnm', p_store: 'jc',
  })
  if (error) throw new Error(message(error, 'Não foi possível carregar os produtos vendidos.'))
  return (Array.isArray(data) ? data : []) as SalesProductMappingRow[]
}

export async function loadSalesCatalog(): Promise<SalesCatalogProduct[]> {
  const [productsResult, optionsResult] = await Promise.all([
    supabase.from('products')
      .select('id,name,unit,is_fabricacao_propria,is_revenda,kind,active')
      .eq('active', true).neq('kind', 'insumo').order('name'),
    supabase.from('product_sale_options')
      .select('product_id,sale_unit,active').eq('active', true),
  ])
  if (productsResult.error) throw new Error(message(productsResult.error, 'Não foi possível carregar o catálogo.'))
  if (optionsResult.error) throw new Error(message(optionsResult.error, 'Não foi possível carregar as formas de venda.'))
  const options = (optionsResult.data ?? []) as Array<{ product_id: string; sale_unit: string; active: boolean }>
  return (productsResult.data ?? []).map(product => ({
    id: product.id,
    name: product.name,
    unit: product.unit,
    is_fabricacao_propria: product.is_fabricacao_propria,
    is_revenda: product.is_revenda,
    saleUnits: saleUnitsForProduct(product.unit, options.filter(option => option.product_id === product.id)),
  }))
}

export async function saveSalesProductMapping(input: {
  externalProductKey: string
  decision: SalesMappingStatus
  productId?: string | null
  saleUnit?: 'un' | 'kg' | null
  reason?: string | null
}): Promise<void> {
  const { error } = await supabase.rpc('set_sales_product_mapping', {
    p_source_system: 'cnm', p_store: 'jc',
    p_external_product_key: input.externalProductKey,
    p_decision: input.decision,
    p_product_id: input.productId ?? null,
    p_sale_unit: input.saleUnit ?? null,
    p_reason: input.reason ?? null,
  })
  if (error) throw new Error(message(error, 'Não foi possível salvar o vínculo.'))
}

export async function loadSalesAbc(startDate: string, endDate: string): Promise<SalesAbcResult> {
  const { data, error } = await supabase.rpc('get_sales_abc', {
    p_source_system: 'cnm', p_store: 'jc', p_start_date: startDate, p_end_date: endDate,
  })
  if (error) throw new Error(message(error, 'Não foi possível calcular a curva ABC.'))
  return data as SalesAbcResult
}
