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

export interface FlourMixQuantityLike {
  id: string
  quantity?: number | string | null
}

export interface FlourMixUpdate {
  id: string
  quantity: number
}

export interface FlourMixAddition {
  existing: FlourMixUpdate[]
  addedQuantity: number
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
  if (isFlourComponent(component)) {
    if (flourBaseKg === null || !Number.isFinite(flourBaseKg) || flourBaseKg <= 0) return 1
    return quantityFromBakersPercentage(percentage, flourBaseKg)
  }
  return quantityFromBakersPercentage(percentage, flourBaseKg)
}

export function calculateFlourSharePercent(quantity: number | string | null | undefined, flourBaseKg: number | null): number | null {
  const numericQuantity = finiteNumber(quantity)
  if (numericQuantity <= 0) return null
  if (flourBaseKg === null || !Number.isFinite(flourBaseKg) || flourBaseKg <= 0) return null
  return (numericQuantity / flourBaseKg) * 100
}

function positiveFlourQuantities(components: FlourMixQuantityLike[]): FlourMixUpdate[] {
  return components
    .map(component => ({ id: component.id, quantity: finiteNumber(component.quantity) }))
    .filter(component => component.quantity > 0)
}

export function calculateFlourMixAddition(existingFlours: FlourMixQuantityLike[], addedSharePct: number): FlourMixAddition | null {
  if (!Number.isFinite(addedSharePct) || addedSharePct <= 0) return null
  if (addedSharePct > 100) return null

  const existing = positiveFlourQuantities(existingFlours)
  const flourBaseKg = existing.reduce((sum, component) => sum + component.quantity, 0)

  if (flourBaseKg <= 0) {
    return { existing: [], addedQuantity: 1 }
  }

  if (addedSharePct >= 100) return null

  const remainingShare = (100 - addedSharePct) / 100
  return {
    existing: existing.map(component => ({
      id: component.id,
      quantity: component.quantity * remainingShare,
    })),
    addedQuantity: flourBaseKg * (addedSharePct / 100),
  }
}

export function calculateFlourMixRebalance(
  flours: FlourMixQuantityLike[],
  editedId: string,
  editedSharePct: number,
): FlourMixUpdate[] | null {
  if (!Number.isFinite(editedSharePct) || editedSharePct <= 0) return null

  const currentFlours = positiveFlourQuantities(flours)
  const flourBaseKg = currentFlours.reduce((sum, component) => sum + component.quantity, 0)
  const edited = currentFlours.find(component => component.id === editedId)

  if (!edited || flourBaseKg <= 0) return null

  if (currentFlours.length === 1) {
    return editedSharePct === 100 ? [{ id: edited.id, quantity: flourBaseKg }] : null
  }

  if (editedSharePct >= 100) return null

  const targetQuantity = flourBaseKg * (editedSharePct / 100)
  const remainingQuantity = flourBaseKg - targetQuantity
  const otherFlours = currentFlours.filter(component => component.id !== editedId)
  const otherCurrentTotal = otherFlours.reduce((sum, component) => sum + component.quantity, 0)

  if (remainingQuantity <= 0 || otherFlours.length === 0) return null

  const adjustedOthers = otherCurrentTotal > 0
    ? otherFlours.map(component => ({
        id: component.id,
        quantity: component.quantity * (remainingQuantity / otherCurrentTotal),
      }))
    : otherFlours.map(component => ({
        id: component.id,
        quantity: remainingQuantity / otherFlours.length,
      }))

  return [
    { id: edited.id, quantity: targetQuantity },
    ...adjustedOthers,
  ]
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

export function calculateYieldUnitsFromRecipeWeight(recipeWeightKg: number | null, bakedUnitWeightKg: number | null): number | null {
  if (recipeWeightKg === null || bakedUnitWeightKg === null) return null
  if (!Number.isFinite(recipeWeightKg) || !Number.isFinite(bakedUnitWeightKg)) return null
  if (recipeWeightKg <= 0 || bakedUnitWeightKg <= 0) return null
  return recipeWeightKg / bakedUnitWeightKg
}
