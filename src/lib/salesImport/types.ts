export type SalesSource = 'cnm'
export type SalesStore = 'jc'

export interface NormalizedSalesItem {
  sourceRow: number
  externalProductKey: string
  rawProductName: string
  rawCategory: string
  quantity: number
  sourceCmv: number | null
  takeAway: boolean | null
  netTotal: number
  rawRow: ReadonlyArray<string | number | boolean | null>
}

export interface NormalizedSalesReport {
  source: SalesSource
  store: SalesStore
  reportType: 'sales_by_product'
  saleDate: string
  fileName: string
  parserVersion: string
  items: NormalizedSalesItem[]
  totalQuantity: number
  totalNet: number
  reportedTotal: number | null
}

export interface SalesImportAdapter {
  id: SalesSource
  accepts(fileName: string): boolean
  parse(fileName: string, fileData: ArrayBuffer): NormalizedSalesReport
}
