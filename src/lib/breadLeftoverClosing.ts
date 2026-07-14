export interface ClosingBreadSourceRow {
  bread_id: string | null
}

export interface SavedClosingBreadRow {
  product_id: string | null
}

export function closingBreadIds(
  ordered: ClosingBreadSourceRow[],
  produced: ClosingBreadSourceRow[],
  saved: SavedClosingBreadRow[],
  included: string[],
): Set<string> {
  const ids = new Set<string>()

  for (const row of ordered) if (row.bread_id) ids.add(row.bread_id)
  for (const row of produced) if (row.bread_id) ids.add(row.bread_id)
  for (const row of saved) if (row.product_id) ids.add(row.product_id)
  for (const breadId of included) if (breadId) ids.add(breadId)

  return ids
}

export function leftoverPendingPath(store: 'jc' | 'ja', recordDate: string): string {
  return `/sobras/pendencias?store=${store}&date=${encodeURIComponent(recordDate)}`
}

export function isValidClosingDate(recordDate: string, today: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(recordDate) && recordDate <= today
}
