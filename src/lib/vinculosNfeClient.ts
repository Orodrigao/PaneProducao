import { supabase } from '@/lib/supabase'
import type { RecipeUsageIndex } from '@/lib/recipeUsage'
import type { MemoryCorrectionAction } from '@/lib/vinculosNfe'
import { parseItemCorrectionImpact, parseItemCorrectionResult, type ItemCorrectionImpact, type ItemCorrectionResult } from '@/lib/vinculosNfeNotas'

const PAGE_SIZE = 500

export interface ProductOption {
  id: string
  name: string
  unit: string | null
  active: boolean
  kind?: string | null
  is_fabricacao_propria?: boolean | null
}

export interface LinkAuthor {
  author_id: string
  display_name: string
}

export interface SupplierMapping {
  id: string
  supplier_id: string
  supplier_name: string
  supplier_product_code: string | null
  supplier_ean: string | null
  supplier_description: string
  purchase_unit: string
  base_product_id: string
  base_unit: string
  conversion_basis: string
  conversion_factor: number
  factor_confirmed: boolean
  active: boolean
  last_confirmed_at: string
  last_confirmed_by: string
  /** Versão lida pela tela; a correção é recusada se a memória mudou depois. */
  updated_at: string
}

export interface InvoiceLinkHistory {
  id: string
  purchase_id: string
  supplier_id: string | null
  factor_confirmed: boolean
  supplier_name: string
  invoice_number: string | null
  invoice_series: string | null
  invoice_date: string | null
  purchase_date: string
  status: string
  source_description: string | null
  source_code: string | null
  source_ean: string | null
  source_unit: string | null
  source_quantity: number | null
  quantity: number
  unit: string
  unit_price: number
  conversion_basis: string | null
  conversion_factor: number | null
  usable_quantity: number | null
  normalized_unit_cost: number | null
  mapping_status: string
  mapping_confirmed_at: string | null
  mapping_confirmed_by: string | null
  factor_confirmed_at: string | null
  factor_confirmed_by: string | null
}

export interface MemoryCorrectionSnapshot {
  base_product_id: string
  base_product_name: string | null
  base_unit: string
  conversion_factor: number
  active: boolean
}

export interface MemoryCorrection {
  id: string
  mapping_id: string
  action: string
  previous: MemoryCorrectionSnapshot
  result: MemoryCorrectionSnapshot
  corrected_by: string
  corrected_at: string
  supplier_name: string
  supplier_description: string
  supplier_product_code: string | null
  purchase_unit: string
}

export interface LinkProductDetails {
  product: ProductOption
  authors: Map<string, string>
  memories: SupplierMapping[]
  invoices: InvoiceLinkHistory[]
  corrections: MemoryCorrection[]
  recipeUsageIndex: RecipeUsageIndex
}

type MappingRow = Omit<SupplierMapping, 'supplier_name'> & {
  supplier: { name: string } | { name: string }[] | null
}

type InvoiceRow = {
  id: string
  purchase_id: string
  item_name: string
  unit: string
  quantity: number
  unit_price: number
  source_product_code: string | null
  source_ean: string | null
  source_description: string | null
  source_unit: string | null
  source_quantity: number | null
  conversion_basis: string | null
  conversion_factor: number | null
  usable_quantity: number | null
  normalized_unit_cost: number | null
  mapping_status: string
  mapping_confirmed_at: string | null
  mapping_confirmed_by: string | null
  factor_confirmed_at: string | null
  factor_confirmed_by: string | null
  purchase: {
    purchase_date: string
    status: string
    nfe_number: string | null
    nfe_series: string | null
    nfe_issued_at: string | null
    supplier_id: string | null
    supplier: { name: string } | { name: string }[] | null
  } | null
}

type CorrectionMappingRow = {
  supplier_description: string
  supplier_product_code: string | null
  purchase_unit: string
  supplier: { name: string } | { name: string }[] | null
}

type CorrectionRow = Omit<MemoryCorrection, 'supplier_name' | 'supplier_description' | 'supplier_product_code' | 'purchase_unit'> & {
  mapping: CorrectionMappingRow | CorrectionMappingRow[] | null
}

/** Correções recentes que tiraram a memória deste produto ou a trouxeram para ele. */
const CORRECTION_LIMIT = 50

async function loadAll<T>(loadPage: (start: number, end: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = []
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await loadPage(start, start + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
}

function relationName(value: { name: string } | { name: string }[] | null): string {
  if (Array.isArray(value)) return value[0]?.name ?? 'Fornecedor não identificado'
  return value?.name ?? 'Fornecedor não identificado'
}

export async function searchLinkProducts(search: string): Promise<ProductOption[]> {
  let query = supabase.from('products').select('id,name,unit,active,kind,is_fabricacao_propria').order('name').limit(100)
  const term = search.trim()
  if (term) query = query.ilike('name', `%${term.replace(/[%_]/g, '\\$&')}%`)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as ProductOption[]
}

export async function loadLinkProduct(productId: string): Promise<ProductOption | null> {
  const { data, error } = await supabase.from('products').select('id,name,unit,active').eq('id', productId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data ?? null) as ProductOption | null
}

export async function loadLinkProductDetails(product: ProductOption, recipeUsageIndex: RecipeUsageIndex): Promise<LinkProductDetails> {
  const [mappingRows, invoiceRows, authorsResult, correctionsResult] = await Promise.all([
    loadAll<MappingRow>((start, end) => supabase.from('payable_product_mappings')
      .select('id,supplier_id,supplier:suppliers(name),supplier_product_code,supplier_ean,supplier_description,purchase_unit,base_product_id,base_unit,conversion_basis,conversion_factor,factor_confirmed,active,last_confirmed_at,last_confirmed_by,updated_at')
      .eq('base_product_id', product.id).order('last_confirmed_at', { ascending: false }).range(start, end)),
    loadAll<InvoiceRow>((start, end) => supabase.from('payable_purchase_items')
      .select('id,purchase_id,item_name,unit,quantity,unit_price,source_product_code,source_ean,source_description,source_unit,source_quantity,conversion_basis,conversion_factor,usable_quantity,normalized_unit_cost,mapping_status,mapping_confirmed_at,mapping_confirmed_by,factor_confirmed_at,factor_confirmed_by,purchase:payable_purchases!inner(purchase_date,status,nfe_number,nfe_series,nfe_issued_at,supplier_id,supplier:suppliers(name))')
      .eq('product_id', product.id).eq('purchase.origin', 'xml').eq('purchase.store', 'jc')
      .order('id').range(start, end)),
    supabase.rpc('list_vinculo_nfe_authors', { p_product_id: product.id }),
    supabase.from('payable_product_mapping_corrections')
      .select('id,mapping_id,action,previous,result,corrected_by,corrected_at,mapping:payable_product_mappings(supplier_description,supplier_product_code,purchase_unit,supplier:suppliers(name))')
      .or(`previous->>base_product_id.eq.${product.id},result->>base_product_id.eq.${product.id}`)
      .order('corrected_at', { ascending: false }).limit(CORRECTION_LIMIT),
  ])
  if (authorsResult.error) throw new Error(authorsResult.error.message)
  if (correctionsResult.error) throw new Error(correctionsResult.error.message)

  const authors = new Map<string, string>()
  for (const author of (authorsResult.data ?? []) as LinkAuthor[]) authors.set(author.author_id, author.display_name)

  const memories = mappingRows.map(({ supplier, ...mapping }) => ({
    ...mapping,
    conversion_factor: Number(mapping.conversion_factor),
    supplier_name: relationName(supplier),
  }))
  const invoices = invoiceRows.flatMap(row => {
    if (!row.purchase) return []
    return [{
      id: row.id,
      purchase_id: row.purchase_id,
      supplier_id: row.purchase.supplier_id,
      supplier_name: relationName(row.purchase.supplier),
      invoice_number: row.purchase.nfe_number,
      invoice_series: row.purchase.nfe_series,
      invoice_date: row.purchase.nfe_issued_at,
      purchase_date: row.purchase.purchase_date,
      status: row.purchase.status,
      source_description: row.source_description,
      source_code: row.source_product_code,
      source_ean: row.source_ean,
      source_unit: row.source_unit,
      source_quantity: row.source_quantity === null ? null : Number(row.source_quantity),
      quantity: Number(row.quantity),
      unit: row.unit,
      unit_price: Number(row.unit_price),
      conversion_basis: row.conversion_basis,
      conversion_factor: row.conversion_factor === null ? null : Number(row.conversion_factor),
      usable_quantity: row.usable_quantity === null ? null : Number(row.usable_quantity),
      normalized_unit_cost: row.normalized_unit_cost === null ? null : Number(row.normalized_unit_cost),
      mapping_status: row.mapping_status,
      mapping_confirmed_at: row.mapping_confirmed_at,
      mapping_confirmed_by: row.mapping_confirmed_by,
      factor_confirmed: row.factor_confirmed_at !== null,
      factor_confirmed_at: row.factor_confirmed_at,
      factor_confirmed_by: row.factor_confirmed_by,
    }]
  })

  const corrections = ((correctionsResult.data ?? []) as CorrectionRow[]).map(({ mapping, ...correction }) => {
    const memory = Array.isArray(mapping) ? mapping[0] : mapping
    return {
      ...correction,
      supplier_name: relationName(memory?.supplier ?? null),
      supplier_description: memory?.supplier_description ?? 'Item não identificado',
      supplier_product_code: memory?.supplier_product_code ?? null,
      purchase_unit: memory?.purchase_unit ?? '',
    }
  })

  return { product, authors, memories, invoices, corrections, recipeUsageIndex }
}

export interface MemoryCorrectionRequest {
  requestId: string
  mappingId: string
  expectedUpdatedAt: string
  action: MemoryCorrectionAction
  productId?: string
  conversionFactor?: number
}

/**
 * Grava pela função protegida do banco. O mesmo requestId pode ser reenviado
 * (rede que caiu, toque repetido): o banco devolve a correção já gravada.
 */
export async function correctSupplierMapping(request: MemoryCorrectionRequest): Promise<void> {
  const { error } = await supabase.rpc('correct_payable_product_mapping', {
    p_request_id: request.requestId,
    p_mapping_id: request.mappingId,
    p_expected_updated_at: request.expectedUpdatedAt,
    p_action: request.action,
    p_product_id: request.productId ?? null,
    p_conversion_factor: request.conversionFactor ?? null,
  })
  if (error) throw new Error(error.message || 'Não foi possível gravar a correção.')
}

export interface ItemCorrectionRequestItem {
  itemId: string
  productId: string
  conversionFactor: number
}

/** O efeito mudou entre a prévia e a confirmação (código PT409 do banco). */
export class ItemCorrectionConflictError extends Error {}

export type ItemCorrectionTarget = { items: readonly ItemCorrectionRequestItem[] } | { undoCorrectionId: string }

function itemCorrectionArgs(target: ItemCorrectionTarget) {
  if ('undoCorrectionId' in target) return { p_items: null, p_undo_correction_id: target.undoCorrectionId }
  return {
    p_items: target.items.map(item => ({ item_id: item.itemId, product_id: item.productId, conversion_factor: item.conversionFactor })),
    p_undo_correction_id: null,
  }
}

/**
 * Prévia: o banco aplica a correção, mede o efeito e desfaz tudo. Por isso é
 * sempre POST (supabase.rpc), nunca GET.
 */
export async function previewItemCorrection(target: ItemCorrectionTarget): Promise<ItemCorrectionResult> {
  const { data, error } = await supabase.rpc('correct_payable_purchase_items', {
    p_request_id: null,
    p_mode: 'previa',
    ...itemCorrectionArgs(target),
    p_expected_impact_hash: null,
  })
  if (error) throw new Error(error.message || 'Não foi possível calcular a prévia.')
  return parseItemCorrectionResult(data)
}

/**
 * Grava a correção conferida. O mesmo requestId pode ser reenviado (rede que
 * caiu, toque repetido): o banco devolve a correção já gravada.
 */
export async function applyItemCorrection(target: ItemCorrectionTarget, requestId: string, expectedImpactHash: string): Promise<ItemCorrectionResult> {
  const { data, error } = await supabase.rpc('correct_payable_purchase_items', {
    p_request_id: requestId,
    p_mode: 'aplicar',
    ...itemCorrectionArgs(target),
    p_expected_impact_hash: expectedImpactHash,
  })
  if (error) {
    if (error.code === 'PT409') throw new ItemCorrectionConflictError(error.message)
    throw new Error(error.message || 'Não foi possível gravar a correção.')
  }
  return parseItemCorrectionResult(data)
}

export interface ItemCorrectionHistory {
  id: string
  action: string
  undoes_correction_id: string | null
  corrected_by: string
  corrected_at: string
  impact: ItemCorrectionImpact
  /** Já desfeita por outra correção. */
  undone: boolean
}

/** Correções recentes de notas que tiraram itens deste produto ou trouxeram para ele. */
const ITEM_CORRECTION_LIMIT = 30

type ItemCorrectionRow = Omit<ItemCorrectionHistory, 'impact' | 'undone'> & { impact: unknown }

export async function loadItemCorrections(productId: string): Promise<ItemCorrectionHistory[]> {
  const { data, error } = await supabase.from('payable_purchase_item_corrections')
    .select('id,action,undoes_correction_id,corrected_by,corrected_at,impact')
    .contains('product_ids', [productId])
    .order('corrected_at', { ascending: false })
    .limit(ITEM_CORRECTION_LIMIT)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as ItemCorrectionRow[]
  const undoneIds = await loadUndoneCorrectionIds(rows.filter(row => row.action === 'corrigir').map(row => row.id))
  return rows.map(row => ({ ...row, impact: parseItemCorrectionImpact(row.impact), undone: undoneIds.has(row.id) }))
}

/** O desfazer pode ter saído da lista recente; a consulta confere direto. */
async function loadUndoneCorrectionIds(ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const { data, error } = await supabase.from('payable_purchase_item_corrections')
    .select('undoes_correction_id')
    .in('undoes_correction_id', ids)
  if (error) throw new Error(error.message)
  return new Set(((data ?? []) as { undoes_correction_id: string | null }[]).flatMap(row => row.undoes_correction_id ? [row.undoes_correction_id] : []))
}
