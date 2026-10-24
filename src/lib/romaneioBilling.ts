// Tipos e regras de nome da conta da Buck. A conta mesma mora no banco
// (`private.calcular_cobranca_buck_detalhada`); ver romaneioExBilling.ts.

import { isWeightControlledRomaneioProduct } from './romaneioDraft'

export type RomaneioBillingUnit = 'un' | 'kg'
export type RomaneioBillingIssue = 'missing_price' | 'unit_mismatch' | 'suspicious_quantity'

export interface RomaneioBillingRow {
  key: string
  itemIds: string[]
  productId: string
  productSource: string
  productName: string
  billingUnit: RomaneioBillingUnit
  sentQuantity: number
  billedQuantity: number
  tripCount: number
  unitPrice: number | null
  total: number | null
  issues: RomaneioBillingIssue[]
}

export interface RomaneioBillingResult {
  rows: RomaneioBillingRow[]
  total: number
  tripCount: number
  itemCount: number
  hasBlockingIssues: boolean
}

function normalizedText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

export function isBuckPriceTierName(name: string) {
  return normalizedText(name).trim() === 'buck'
}

export function billingUnitForRomaneioProduct(productName: string): RomaneioBillingUnit {
  return isWeightControlledRomaneioProduct(productName) ? 'kg' : 'un'
}

export function explicitUnitInRomaneioProduct(productName: string): RomaneioBillingUnit | null {
  const name = normalizedText(productName)
  if (/\(\s*kg\s*\)/.test(name)) return 'kg'
  if (/\(\s*un\s*\)/.test(name)) return 'un'
  return null
}
