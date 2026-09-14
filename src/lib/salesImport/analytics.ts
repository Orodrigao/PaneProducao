export type SalesMappingStatus = 'pending' | 'mapped' | 'ignored'
export type SalesAbcClass = 'A' | 'B' | 'C' | null
export type SalesPeriodPreset = 'today' | '7' | '30' | 'month'

export interface SalesProductMappingRow {
  external_product_key: string
  raw_product_name: string
  raw_category: string
  raw_name_count: number
  first_sale_date: string
  last_sale_date: string
  sale_days: number
  total_quantity: number
  total_net: number
  mapping_status: SalesMappingStatus
  product_id: string | null
  product_name: string | null
  sale_unit: 'un' | 'kg' | null
  is_fabricacao_propria: boolean | null
  is_revenda: boolean | null
}

export interface SalesAbcItem {
  analysis_key: string
  display_name: string
  mapping_status: SalesMappingStatus
  product_id: string | null
  sale_unit: 'un' | 'kg' | null
  is_fabricacao_propria: boolean
  total_quantity: number | null
  total_net: number
  average_price: number | null
  quantity_by_unit: Array<{ sale_unit: 'un' | 'kg'; total_quantity: number }>
  share_pct: number | null
  cumulative_pct: number | null
  abc_class: SalesAbcClass
}

export interface SalesAbcResult {
  start_date: string
  end_date: string
  total_net: number
  items: SalesAbcItem[]
  coverage: {
    expected_days: number
    imported_days: number
    explained_days: number
    missing_dates: string[]
  }
}

export interface SalesCatalogProduct {
  id: string
  name: string
  unit: string | null
  is_fabricacao_propria: boolean
  is_revenda: boolean
  saleUnits: Array<'un' | 'kg'>
}

function isoDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(date)
}

function daysBefore(date: Date, amount: number): Date {
  const copy = new Date(date)
  copy.setDate(copy.getDate() - amount)
  return copy
}

export function salesPeriodForPreset(preset: SalesPeriodPreset, now = new Date()): { start: string; end: string } {
  const end = isoDate(now)
  if (preset === 'today') return { start: end, end }
  if (preset === '7') return { start: isoDate(daysBefore(now, 6)), end }
  if (preset === '30') return { start: isoDate(daysBefore(now, 29)), end }
  const [year, month] = end.split('-')
  return { start: `${year}-${month}-01`, end }
}

export function coverageLabel(coverage: SalesAbcResult['coverage']): string {
  const covered = coverage.imported_days + coverage.explained_days
  if (coverage.expected_days === 0) return 'Período sem dias esperados.'
  if (coverage.missing_dates.length === 0) return `${covered} de ${coverage.expected_days} dias explicados.`
  return `${covered} de ${coverage.expected_days} dias explicados · faltam ${coverage.missing_dates.length}.`
}

export function saleUnitsForProduct(
  unit: string | null,
  options: ReadonlyArray<{ sale_unit: string; active: boolean }>,
): Array<'un' | 'kg'> {
  const result = new Set<'un' | 'kg'>()
  result.add(unit?.trim().toLowerCase() === 'kg' ? 'kg' : 'un')
  options.forEach(option => {
    if (option.active && (option.sale_unit === 'un' || option.sale_unit === 'kg')) result.add(option.sale_unit)
  })
  return [...result]
}
