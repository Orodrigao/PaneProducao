import { supabase } from '@/lib/supabase'
import type { NormalizedSalesReport } from './types'

export type SalesImportOutcome = 'created' | 'unchanged' | 'replaced'
export interface SalesImportResult { id: string; outcome: SalesImportOutcome }

export async function sha256Hex(fileData: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', fileData)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export function salesImportStoragePath(report: NormalizedSalesReport, fileHash: string): string {
  return `${report.source}/${report.store}/${report.saleDate}/${fileHash}.xls`
}

export async function confirmSalesImport(
  report: NormalizedSalesReport,
  fileData: ArrayBuffer,
  replacementReason?: string,
): Promise<SalesImportResult> {
  const fileHash = await sha256Hex(fileData)
  const storagePath = salesImportStoragePath(report, fileHash)
  const uploaded = await supabase.storage
    .from('sales-imports')
    .upload(storagePath, fileData, { contentType: 'application/vnd.ms-excel', upsert: false })

  if (uploaded.error && !/already exists|duplicate/i.test(uploaded.error.message)) {
    throw new Error(`Não foi possível guardar o arquivo original: ${uploaded.error.message}`)
  }

  const { data, error } = await supabase.rpc('confirm_sales_import', {
    p_source_system: report.source,
    p_store: report.store,
    p_report_type: report.reportType,
    p_sale_date: report.saleDate,
    p_file_name: report.fileName,
    p_file_hash: fileHash,
    p_storage_path: storagePath,
    p_parser_version: report.parserVersion,
    p_reported_total: report.reportedTotal,
    p_replacement_reason: replacementReason?.trim() || null,
    p_items: report.items.map(item => ({
      line_number: item.sourceRow,
      external_product_key: item.externalProductKey,
      raw_product_name: item.rawProductName,
      raw_category: item.rawCategory,
      quantity: item.quantity,
      source_cmv: item.sourceCmv,
      take_away: item.takeAway,
      net_total: item.netTotal,
      raw_row: item.rawRow,
    })),
  })
  if (error) {
    await supabase.rpc('discard_unconfirmed_sales_file', { p_storage_path: storagePath })
    throw new Error(error.message)
  }
  if (!data || typeof data !== 'object' || !('id' in data) || !('outcome' in data)) {
    throw new Error('O banco não confirmou a importação.')
  }
  const result = data as { id: unknown; outcome: unknown }
  if (typeof result.id !== 'string' || !['created', 'unchanged', 'replaced'].includes(String(result.outcome))) {
    throw new Error('O banco devolveu um resultado de importação inválido.')
  }
  return { id: result.id, outcome: result.outcome as SalesImportOutcome }
}
