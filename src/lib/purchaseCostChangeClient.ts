import { supabase } from '@/lib/supabase'
import { readAllPjPages } from '@/lib/pjOrderReadClient'
import { buildCostHistory, recentCostChanges, type CostHistoryRow, type CostPoint } from '@/lib/purchaseCostChange'

// Dezenas de cadastros por pedido cabem no endereço com folga.
const IDS_PER_REQUEST = 50

// Uma string só, sem concatenação: o supabase-js lê o tipo das colunas do texto literal.
const HISTORY_COLUMNS = 'id,product_id,acquisition_value,line_total,usable_quantity,source_unit,conversion_factor,cost_applied,product:products(name,unit),purchase:payable_purchases!inner(id,nfe_key,nfe_number,nfe_issued_at,nfe_issued_timestamp,created_at,status,origin,suppliers(name))'

type HistoryRow = CostHistoryRow & { id: string }

/**
 * Todas as compras por NF-e não canceladas destes cadastros. A leitura é
 * inteira ou falha: comparar com um histórico cortado pela paginação acharia
 * uma "última compra" que não é a última.
 */
export async function loadCostHistory(productIds: readonly string[]): Promise<Map<string, CostPoint[]>> {
  const ids = [...new Set(productIds.filter(Boolean))].sort()
  const rows: HistoryRow[] = []
  for (let offset = 0; offset < ids.length; offset += IDS_PER_REQUEST) {
    const group = ids.slice(offset, offset + IDS_PER_REQUEST)
    rows.push(...await readAllPjPages<HistoryRow>((from, to) => supabase
      .from('payable_purchase_items')
      .select(HISTORY_COLUMNS, { count: 'exact' })
      .in('product_id', group)
      .gt('usable_quantity', 0)
      .eq('purchase.origin', 'xml')
      .neq('purchase.status', 'cancelada')
      .order('id')
      .range(from, to)))
  }
  return buildCostHistory(rows)
}

/** Cadastros cujo custo foi trocado por nota emitida a partir de `since`, com a alta sobre a compra anterior. */
export async function loadRecentCostChanges(since: string) {
  const recent = await readAllPjPages<{ id: string; product_id: string | null }>((from, to) => supabase
    .from('payable_purchase_items')
    .select('id,product_id,purchase:payable_purchases!inner(nfe_issued_at,status,origin)', { count: 'exact' })
    .eq('cost_applied', true)
    .not('product_id', 'is', null)
    .gte('purchase.nfe_issued_at', since)
    .eq('purchase.origin', 'xml')
    .neq('purchase.status', 'cancelada')
    .order('id')
    .range(from, to))
  const ids = recent.map(row => row.product_id).filter((id): id is string => Boolean(id))
  if (ids.length === 0) return []
  return recentCostChanges(await loadCostHistory(ids), since)
}
