export type PriceBase = 'un' | 'kg'

export interface RecipeComponentLike {
  name?: string | null
  category?: string | null
  quantity?: number | string | null
  cost?: number | string | null
}

export interface RecipeTotals {
  ingredientCost: number
  packagingCost: number
  doughWeightKg: number | null
  flourBaseKg: number | null
}

function normalizeText(value: string | null | undefined): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function finiteNumber(value: number | string | null | undefined): number {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

export function isPackagingComponent(component: Pick<RecipeComponentLike, 'name' | 'category'>): boolean {
  const text = `${normalizeText(component.category)} ${normalizeText(component.name)}`
  return text.includes('embalag')
    || text.includes('saco')
    || text.includes('sacola')
    || text.includes('caixa')
    || text.includes('etiqueta')
    || text.includes('adesivo')
}

export function isFlourComponent(component: Pick<RecipeComponentLike, 'name' | 'category'>): boolean {
  const text = `${normalizeText(component.category)} ${normalizeText(component.name)}`
  return text.includes('farinha')
}

export function calculateRecipeTotals(components: RecipeComponentLike[]): RecipeTotals {
  let ingredientCost = 0
  let packagingCost = 0
  let doughWeightKg = 0
  let flourBaseKg = 0

  for (const component of components) {
    const quantity = finiteNumber(component.quantity)
    const cost = finiteNumber(component.cost)
    const lineCost = cost * quantity

    if (isPackagingComponent(component)) {
      packagingCost += lineCost
      continue
    }

    ingredientCost += lineCost
    doughWeightKg += quantity
    if (isFlourComponent(component)) flourBaseKg += quantity
  }

  return {
    ingredientCost,
    packagingCost,
    doughWeightKg: doughWeightKg > 0 ? doughWeightKg : null,
    flourBaseKg: flourBaseKg > 0 ? flourBaseKg : null,
  }
}

export function quantityFromBakersPercentage(percentage: number, flourBaseKg: number | null): number | null {
  if (!Number.isFinite(percentage) || percentage <= 0) return null
  if (flourBaseKg === null || !Number.isFinite(flourBaseKg) || flourBaseKg <= 0) return null
  return flourBaseKg * (percentage / 100)
}

export function quantityFromBakersPercentageForComponent(
  percentage: number,
  flourBaseKg: number | null,
  component: Pick<RecipeComponentLike, 'name' | 'category'>,
): number | null {
  if (!Number.isFinite(percentage) || percentage <= 0) return null
  if (isFlourComponent(component)) return percentage / 100
  return quantityFromBakersPercentage(percentage, flourBaseKg)
}

export function packagingCostForPriceBase(
  packagingCostPerUnit: number | null,
  priceBase: PriceBase,
  averageUnitWeightKg: number | null,
): number | null {
  if (packagingCostPerUnit === null || !Number.isFinite(packagingCostPerUnit) || packagingCostPerUnit < 0) return null
  if (priceBase === 'un') return packagingCostPerUnit
  if (packagingCostPerUnit === 0) return 0
  if (averageUnitWeightKg === null || !Number.isFinite(averageUnitWeightKg) || averageUnitWeightKg <= 0) return null
  return packagingCostPerUnit / averageUnitWeightKg
}
