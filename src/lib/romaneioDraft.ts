export type RomaneioUnit = 'un' | 'kg'

export interface RomaneioBreadLite {
  id: string
  name: string
  unit?: string | null
}

export interface RomaneioProductOption {
  key: string
  productId: string
  productName: string
  displayName: string
  unit: RomaneioUnit
  step: number
  allowDecimal: boolean
}

export interface BuildRomaneioProductOptionsOptions {
  ciabattaOnlyKg?: boolean
}

export interface RomaneioOrderRow {
  bread_id: string | null
  quantity: number | string | null
}

export interface RomaneioSentItemRow {
  product_id: string | null
  qty_sent: number | string | null
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export function isCiabattaName(name: string): boolean {
  return normalizeText(name).includes('ciabatta')
}

export function isMiniCroissantName(name: string): boolean {
  const normalized = normalizeText(name)
  return normalized.includes('mini') && normalized.includes('croissant')
}

function unitFromCatalog(unit?: string | null): RomaneioUnit {
  return normalizeText(unit ?? '').includes('kg') ? 'kg' : 'un'
}

function withUnitLabel(name: string, unit: RomaneioUnit): string {
  const normalized = normalizeText(name)
  if (normalized.includes(`(${unit})`)) return name
  return `${name} (${unit})`
}

function makeOption(
  bread: RomaneioBreadLite,
  unit: RomaneioUnit,
  forceUnitLabel = false,
): RomaneioProductOption {
  const unitKey = unit === 'kg' ? '__kg' : ''
  return {
    key: `${bread.id}${unitKey}`,
    productId: bread.id,
    productName: forceUnitLabel ? withUnitLabel(bread.name, unit) : bread.name,
    displayName: forceUnitLabel ? withUnitLabel(bread.name, unit) : bread.name,
    unit,
    step: unit === 'kg' ? 0.1 : 1,
    allowDecimal: unit === 'kg',
  }
}

export function buildRomaneioProductOptions(
  breads: RomaneioBreadLite[],
  options: BuildRomaneioProductOptionsOptions = {},
): RomaneioProductOption[] {
  return breads.flatMap(bread => {
    if (isCiabattaName(bread.name)) {
      if (options.ciabattaOnlyKg) {
        return [
          {
            ...makeOption(bread, 'kg', true),
            key: `${bread.id}__kg`,
          },
        ]
      }
      return [
        makeOption(bread, 'un', true),
        {
          ...makeOption(bread, 'kg', true),
          key: `${bread.id}__kg`,
        },
      ]
    }

    const unit = isMiniCroissantName(bread.name) ? 'kg' : unitFromCatalog(bread.unit)
    return [makeOption(bread, unit, unit === 'kg' && isMiniCroissantName(bread.name))]
  })
}

export function nextRomaneioTripNumber(trips: Array<number | null | undefined>): number {
  const maxTrip = trips.reduce<number>((max, trip) => {
    const value = typeof trip === 'number' ? trip : Number(trip)
    if (!Number.isFinite(value) || value < 1) return max
    return Math.max(max, Math.trunc(value))
  }, 0)
  return maxTrip + 1
}

export function orderQuantitiesByBreadId(rows: RomaneioOrderRow[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((quantities, row) => {
    if (!row.bread_id) return quantities
    const quantity = Number(row.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) return quantities

    quantities[row.bread_id] = (quantities[row.bread_id] ?? 0) + quantity
    return quantities
  }, {})
}

export function sentQuantitiesByProductId(rows: RomaneioSentItemRow[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((quantities, row) => {
    if (!row.product_id) return quantities
    const quantity = Number(row.qty_sent)
    if (!Number.isFinite(quantity) || quantity <= 0) return quantities

    quantities[row.product_id] = (quantities[row.product_id] ?? 0) + quantity
    return quantities
  }, {})
}

export function parseRomaneioQty(value: string): number {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) return 0
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

export function normalizeRomaneioQty(value: number): number {
  return Math.max(0, Math.round(value * 1000) / 1000)
}

export function formatRomaneioQty(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}
