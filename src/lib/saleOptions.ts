export type PricingUnit = 'un' | 'kg'
export type MarginStatus = 'preco_zerado' | 'sem_custo' | 'prejuizo' | 'ruim' | 'media' | 'boa'

export interface SaleOptionLike {
  id?: string | null
  name?: string | null
  sale_unit?: string | null
  unit_weight_kg?: number | string | null
}

export interface GrossMarginResult {
  status: MarginStatus
  label: string
  unitCost: number | null
  unitMargin: number | null
  marginPct: number | null
}

export function saleOptionKey(productSource: string, productId: string, saleOptionId?: string | null): string {
  return `${productSource}_${productId}_${saleOptionId || 'legacy'}`
}

export function isPricingUnit(value: string | null | undefined): value is PricingUnit {
  return value === 'un' || value === 'kg'
}

export function inferPricingUnit(unit: string | null | undefined, option?: SaleOptionLike | null): PricingUnit {
  if (isPricingUnit(option?.sale_unit)) return option.sale_unit
  return unit?.trim().toLowerCase() === 'kg' ? 'kg' : 'un'
}

export function saleUnitLabel(unit: string | null | undefined): string {
  return unit === 'kg' ? 'kg' : 'un'
}

export function formatSaleOptionLabel(option?: SaleOptionLike | null): string {
  if (!option) return 'Venda padrão'
  const name = option.name?.trim() || (option.sale_unit === 'kg' ? 'Quilo' : 'Unidade')
  return `${name} (${saleUnitLabel(option.sale_unit)})`
}

export function cmvForSaleOption(baseCost: number | string | null | undefined, unit: string | null | undefined, option?: SaleOptionLike | null): number {
  const cost = Number(baseCost || 0)
  if (!Number.isFinite(cost) || cost <= 0) return 0

  const baseUnit = unit?.trim().toLowerCase() === 'kg' ? 'kg' : 'un'
  const saleUnit = inferPricingUnit(unit, option)
  const weight = Number(option?.unit_weight_kg || 0)
  const hasWeight = Number.isFinite(weight) && weight > 0

  if (baseUnit === 'kg' && saleUnit === 'un' && hasWeight) return cost * weight
  if (baseUnit === 'un' && saleUnit === 'kg' && hasWeight) return cost / weight
  return cost
}

export function classifyGrossMargin(unitPrice: number | string | null | undefined, unitCost: number | string | null | undefined): GrossMarginResult {
  const price = Number(unitPrice || 0)
  const cost = unitCost === null || unitCost === undefined || unitCost === '' ? null : Number(unitCost)

  if (!Number.isFinite(price) || price <= 0) {
    return { status: 'preco_zerado', label: 'Preço zerado', unitCost: cost && Number.isFinite(cost) ? cost : null, unitMargin: null, marginPct: null }
  }

  if (cost === null || !Number.isFinite(cost) || cost <= 0) {
    return { status: 'sem_custo', label: 'Sem custo', unitCost: null, unitMargin: null, marginPct: null }
  }

  const unitMargin = price - cost
  const marginPct = (unitMargin / price) * 100
  if (unitMargin <= 0) return { status: 'prejuizo', label: 'Prejuízo', unitCost: cost, unitMargin, marginPct }
  if (marginPct < 50) return { status: 'ruim', label: 'Margem ruim', unitCost: cost, unitMargin, marginPct }
  if (marginPct < 65) return { status: 'media', label: 'Margem média', unitCost: cost, unitMargin, marginPct }
  return { status: 'boa', label: 'Boa margem', unitCost: cost, unitMargin, marginPct }
}

export function parsePositiveDecimalInput(raw: string): number | null {
  const value = Number(raw.trim().replace(',', '.'))
  if (!Number.isFinite(value) || value <= 0) return null
  return value
}

export function formatDecimalPtBR(value: number | string | null | undefined, maximumFractionDigits = 3): string {
  if (value === null || value === undefined || value === '') return ''
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return ''
  return numeric.toLocaleString('pt-BR', { maximumFractionDigits })
}
