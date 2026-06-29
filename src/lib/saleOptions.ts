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

export interface PriceFormationInput {
  cmv: number | string | null | undefined
  packagingCost?: number | string | null
  laborCost?: number | string | null
  lossPct?: number | string | null
  taxPct?: number | string | null
  desiredMarginPct?: number | string | null
}

export interface PriceFormationResult {
  valid: boolean
  reason: string | null
  directCost: number
  adjustedCost: number
  taxAmount: number | null
  targetMarginAmount: number | null
  suggestedPrice: number | null
  markupPct: number | null
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

function nonNegativeNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return 0
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) return null
  return numeric
}

export function calculateSuggestedPrice(input: PriceFormationInput): PriceFormationResult {
  const cmv = Number(input.cmv || 0)
  const packagingCost = nonNegativeNumber(input.packagingCost)
  const laborCost = nonNegativeNumber(input.laborCost)
  const lossPct = nonNegativeNumber(input.lossPct)
  const taxPct = nonNegativeNumber(input.taxPct)
  const desiredMarginPct = nonNegativeNumber(input.desiredMarginPct)

  const invalidResult: PriceFormationResult = {
    valid: false,
    reason: null,
    directCost: 0,
    adjustedCost: 0,
    taxAmount: null,
    targetMarginAmount: null,
    suggestedPrice: null,
    markupPct: null,
  }

  if (!Number.isFinite(cmv) || cmv <= 0) {
    return { ...invalidResult, reason: 'CMV indisponível' }
  }
  if (packagingCost === null || laborCost === null || lossPct === null || taxPct === null || desiredMarginPct === null) {
    return { ...invalidResult, reason: 'Parâmetro inválido' }
  }
  if (lossPct >= 100) {
    return { ...invalidResult, reason: 'Perda precisa ser menor que 100%' }
  }
  if (taxPct + desiredMarginPct >= 100) {
    return { ...invalidResult, reason: 'Impostos + margem precisam ficar abaixo de 100%' }
  }

  const directCost = cmv + packagingCost + laborCost
  const adjustedCost = directCost / (1 - (lossPct / 100))
  const denominator = 1 - ((taxPct + desiredMarginPct) / 100)
  const suggestedPrice = adjustedCost / denominator
  const taxAmount = suggestedPrice * (taxPct / 100)
  const targetMarginAmount = suggestedPrice * (desiredMarginPct / 100)
  const markupPct = ((suggestedPrice / directCost) - 1) * 100

  return {
    valid: true,
    reason: null,
    directCost,
    adjustedCost,
    taxAmount,
    targetMarginAmount,
    suggestedPrice,
    markupPct,
  }
}

export function parsePositiveDecimalInput(raw: string): number | null {
  const value = Number(raw.trim().replace(',', '.'))
  if (!Number.isFinite(value) || value <= 0) return null
  return value
}

export function parseNonNegativeDecimalInput(raw: string): number | null {
  const value = Number(raw.trim().replace(',', '.'))
  if (!Number.isFinite(value) || value < 0) return null
  return value
}

export function formatDecimalPtBR(value: number | string | null | undefined, maximumFractionDigits = 3): string {
  if (value === null || value === undefined || value === '') return ''
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return ''
  return numeric.toLocaleString('pt-BR', { maximumFractionDigits })
}
