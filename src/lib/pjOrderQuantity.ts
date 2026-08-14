import type { PricingUnit } from './saleOptions'

export const MINIMUM_KG_ORDER_QUANTITY = 0.001

export function orderLineQuantityStep(pricingUnit: PricingUnit): number {
  return pricingUnit === 'kg' ? MINIMUM_KG_ORDER_QUANTITY : 1
}

export function normalizeOrderLinePacksInput(rawValue: string, pricingUnit: PricingUnit): number {
  const minimum = orderLineQuantityStep(pricingUnit)
  const numeric = Number(rawValue)

  if (!Number.isFinite(numeric) || numeric <= 0) return minimum
  return pricingUnit === 'kg' ? numeric : Math.max(1, Math.round(numeric))
}

export function orderLinePacksFromStoredQuantity(quantity: number, packSize: number, pricingUnit: PricingUnit): number {
  const validPackSize = Number.isFinite(packSize) && packSize > 0 ? packSize : 1
  return normalizeOrderLinePacksInput(String(quantity / validPackSize), pricingUnit)
}
