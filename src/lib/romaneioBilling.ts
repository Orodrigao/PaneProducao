export type RomaneioBillingUnit = 'un' | 'kg'
export type RomaneioBillingIssue = 'missing_price' | 'unit_mismatch'

export interface RomaneioBillingItem {
  id: string
  romaneioId: string
  productId: string
  productSource: string
  productName: string
  qtySent: number | string | null | undefined
  qtyAccepted?: number | string | null | undefined
}

export interface RomaneioBillingPrice {
  productId: string
  productSource: string
  unitPrice: number | string | null | undefined
  pricingUnit: string | null | undefined
  active?: boolean | null
}

export interface RomaneioBillingRow {
  key: string
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
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function asNonNegativeNumber(value: number | string | null | undefined) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0
}

function isBillingUnit(value: string | null | undefined): value is RomaneioBillingUnit {
  return value === 'un' || value === 'kg'
}

export function billingUnitForRomaneioProduct(productName: string): RomaneioBillingUnit {
  const name = normalizedText(productName)
  return name.includes('ciabatta') || (name.includes('mini') && name.includes('croissant'))
    ? 'kg'
    : 'un'
}

export function explicitUnitInRomaneioProduct(productName: string): RomaneioBillingUnit | null {
  const name = normalizedText(productName)
  if (/\(\s*kg\s*\)/.test(name)) return 'kg'
  if (/\(\s*un\s*\)/.test(name)) return 'un'
  return null
}

function priceKey(productSource: string, productId: string) {
  return `${productSource}:${productId}`
}

function itemKey(item: RomaneioBillingItem, unit: RomaneioBillingUnit) {
  return `${priceKey(item.productSource, item.productId)}:${item.productName}:${unit}`
}

function addIssue(current: RomaneioBillingIssue[], issue: RomaneioBillingIssue) {
  return current.includes(issue) ? current : [...current, issue]
}

export function calculateRomaneioBilling(
  items: RomaneioBillingItem[],
  prices: RomaneioBillingPrice[],
): RomaneioBillingResult {
  const pricesByProduct = new Map<string, RomaneioBillingPrice[]>()
  prices.filter(price => price.active !== false).forEach(price => {
    const key = priceKey(price.productSource, price.productId)
    pricesByProduct.set(key, [...(pricesByProduct.get(key) || []), price])
  })

  const rowsByKey = new Map<string, RomaneioBillingRow>()
  const trips = new Set<string>()

  items.forEach(item => {
    const billingUnit = billingUnitForRomaneioProduct(item.productName)
    const explicitUnit = explicitUnitInRomaneioProduct(item.productName)
    const rowKey = itemKey(item, billingUnit)
    const sentQuantity = asNonNegativeNumber(item.qtySent)
    const billedQuantity = item.qtyAccepted === null || item.qtyAccepted === undefined
      ? sentQuantity
      : asNonNegativeNumber(item.qtyAccepted)
    const priceLines = pricesByProduct.get(priceKey(item.productSource, item.productId)) || []
    const matchingPrice = priceLines.find(price => price.pricingUnit === billingUnit)
    const numericPrice = asNonNegativeNumber(matchingPrice?.unitPrice)
    const hasPriceForAnotherUnit = priceLines.some(price =>
      isBillingUnit(price.pricingUnit)
      && price.pricingUnit !== billingUnit
      && asNonNegativeNumber(price.unitPrice) > 0,
    )

    let issues: RomaneioBillingIssue[] = []
    if (explicitUnit && explicitUnit !== billingUnit) issues = addIssue(issues, 'unit_mismatch')
    if (!matchingPrice || !isBillingUnit(matchingPrice.pricingUnit) || numericPrice <= 0) {
      issues = addIssue(issues, hasPriceForAnotherUnit ? 'unit_mismatch' : 'missing_price')
    }

    const previous = rowsByKey.get(rowKey)
    if (previous) {
      previous.sentQuantity += sentQuantity
      previous.billedQuantity += billedQuantity
      previous.issues = issues.reduce(addIssue, previous.issues)
      if (!previous.issues.length && previous.unitPrice !== null) {
        previous.total = previous.billedQuantity * previous.unitPrice
      } else {
        previous.total = null
      }
    } else {
      const unitPrice = issues.length ? null : numericPrice
      rowsByKey.set(rowKey, {
        key: rowKey,
        productId: item.productId,
        productSource: item.productSource,
        productName: item.productName,
        billingUnit,
        sentQuantity,
        billedQuantity,
        tripCount: 0,
        unitPrice,
        total: unitPrice === null ? null : billedQuantity * unitPrice,
        issues,
      })
    }
    trips.add(item.romaneioId)
  })

  const tripRows = new Map<string, Set<string>>()
  items.forEach(item => {
    const unit = billingUnitForRomaneioProduct(item.productName)
    const rowKey = itemKey(item, unit)
    const rowTrips = tripRows.get(rowKey) || new Set<string>()
    rowTrips.add(item.romaneioId)
    tripRows.set(rowKey, rowTrips)
  })

  const rows = Array.from(rowsByKey.values())
    .map(row => ({ ...row, tripCount: tripRows.get(row.key)?.size || 0 }))
    .sort((a, b) => a.productName.localeCompare(b.productName, 'pt-BR'))
  const total = rows.reduce((sum, row) => sum + (row.total ?? 0), 0)

  return {
    rows,
    total,
    tripCount: trips.size,
    itemCount: items.length,
    hasBlockingIssues: rows.some(row => row.issues.length > 0),
  }
}
