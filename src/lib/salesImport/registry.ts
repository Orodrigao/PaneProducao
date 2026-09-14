import { parseCnmSalesFile } from '@/lib/cnmSalesImport'
import type { SalesImportAdapter } from './types'

export const cnmSalesImportAdapter: SalesImportAdapter = {
  id: 'cnm',
  accepts: fileName => /^CNM_(?:JC_\d{4}-\d{2}-\d{2}|\d{4}-\d{2}-\d{2}_JC)\.xls$/.test(fileName.trim()),
  parse(fileName, fileData) {
    const report = parseCnmSalesFile(fileName, fileData)
    return {
      source: 'cnm',
      store: report.store,
      reportType: 'sales_by_product',
      saleDate: report.saleDate,
      fileName,
      parserVersion: 'cnm-sales-v1',
      totalQuantity: report.totalQuantity,
      totalNet: report.calculatedNetTotal,
      reportedTotal: report.reportedNetTotal,
      items: report.items.map(item => ({
        sourceRow: item.sourceRow,
        externalProductKey: item.rawProductName.trim(),
        rawProductName: item.rawProductName,
        rawCategory: item.category,
        quantity: item.quantity,
        sourceCmv: item.cmv,
        takeAway: item.takeAway,
        netTotal: item.netTotal,
        rawRow: item.rawValues,
      })),
    }
  },
}

export const SALES_IMPORT_ADAPTERS: readonly SalesImportAdapter[] = [cnmSalesImportAdapter]

export function adapterForSalesFile(fileName: string): SalesImportAdapter | null {
  return SALES_IMPORT_ADAPTERS.find(adapter => adapter.accepts(fileName)) ?? null
}
