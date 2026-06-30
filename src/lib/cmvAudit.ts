import { calculateRecipeTotals } from './recipeMath'
import { classifyGrossMargin, type MarginStatus, type PricingUnit } from './saleOptions'

export type RecipeYieldBasis = 'dough' | 'baked' | 'unit'
export type CmvAuditStatus =
  | 'sem_ficha'
  | 'sem_custo'
  | 'sem_rendimento'
  | 'sem_preco'
  | 'prejuizo'
  | 'ruim'
  | 'media'
  | 'boa'

export interface AuditProduct {
  id: string
  name: string
  category: string | null
  unit: string | null
  cost_price: number | null
  active: boolean | null
  kind: string | null
  is_revenda: boolean | null
  is_fabricacao_propria: boolean | null
  legacy_bread_id: string | null
}

export interface AuditComponent {
  parent_product_id: string
  component_source: 'bread' | 'product'
  component_id: string
  quantity: number | string | null
}

export interface AuditCatalogItem {
  id: string
  name: string
  category?: string | null
  unit: string | null
  cost_price: number | null
}

export interface AuditYield {
  product_id: string
  basis: string | null
  dough_weight_kg: number | null
  finished_weight_kg: number | null
  yield_units: number | null
  average_unit_weight_kg: number | null
}

export interface AuditPriceTier {
  id: string
  name: string
  active: boolean | null
}

export interface AuditPriceLine {
  tier_id: string
  product_source: 'bread' | 'product'
  product_id: string
  product_name: string
  unit_price: number
  pricing_unit: PricingUnit
  active: boolean | null
  sale_option_id?: string | null
}

export interface ProductPriceAudit {
  tierName: string
  unitPrice: number
  pricingUnit: PricingUnit
  marginStatus: MarginStatus
  marginLabel: string
  marginPct: number | null
  unitMargin: number | null
  unitCost: number | null
}

export interface ProductCmvAudit {
  product: AuditProduct
  status: CmvAuditStatus
  statusLabel: string
  componentCount: number
  missingCostCount: number
  cmvTotal: number | null
  cmvUnit: number | null
  cmvKgBaked: number | null
  savedCost: number | null
  yieldUnits: number | null
  averageUnitWeightKg: number | null
  priceCount: number
  worstPrice: ProductPriceAudit | null
}

export interface BuildCmvAuditInput {
  products: AuditProduct[]
  components: AuditComponent[]
  productCatalog: AuditCatalogItem[]
  breadCatalog: AuditCatalogItem[]
  yields: AuditYield[]
  priceTiers: AuditPriceTier[]
  priceLines: AuditPriceLine[]
}

const STATUS_LABELS: Record<CmvAuditStatus, string> = {
  sem_ficha: 'Sem ficha',
  sem_custo: 'Insumo sem custo',
  sem_rendimento: 'Sem rendimento',
  sem_preco: 'Sem preço',
  prejuizo: 'Prejuízo',
  ruim: 'Margem ruim',
  media: 'Margem média',
  boa: 'Boa margem',
}

const PRICE_STATUS_SCORE: Record<MarginStatus, number> = {
  prejuizo: 0,
  ruim: 1,
  media: 2,
  boa: 3,
  preco_zerado: 4,
  sem_custo: 5,
}

function numeric(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function nullablePositive(value: number | string | null | undefined): number | null {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function isRecipeBasis(value: string | null): value is RecipeYieldBasis {
  return value === 'dough' || value === 'baked' || value === 'unit'
}

function costPerUnit(totalCost: number, basis: RecipeYieldBasis, yieldUnits: number | null): number | null {
  if (basis === 'unit') return totalCost
  return yieldUnits !== null ? totalCost / yieldUnits : null
}

function costPerBakedKg(totalCost: number, basis: RecipeYieldBasis, finishedWeight: number | null): number | null {
  if (finishedWeight !== null) return totalCost / finishedWeight
  return basis === 'baked' ? totalCost : null
}

function lineMatchesProduct(line: AuditPriceLine, product: AuditProduct): boolean {
  if (line.product_source === 'product') return line.product_id === product.id
  return !!product.legacy_bread_id && line.product_id === product.legacy_bread_id
}

function chooseWorstPrice(prices: ProductPriceAudit[]): ProductPriceAudit | null {
  if (prices.length === 0) return null
  return [...prices].sort((a, b) => {
    const statusDiff = PRICE_STATUS_SCORE[a.marginStatus] - PRICE_STATUS_SCORE[b.marginStatus]
    if (statusDiff !== 0) return statusDiff
    const aPct = a.marginPct ?? Number.POSITIVE_INFINITY
    const bPct = b.marginPct ?? Number.POSITIVE_INFINITY
    return aPct - bPct
  })[0] ?? null
}

function statusFromAudit(
  componentCount: number,
  missingCostCount: number,
  cmvUnit: number | null,
  cmvKgBaked: number | null,
  priceCount: number,
  worstPrice: ProductPriceAudit | null,
): CmvAuditStatus {
  if (componentCount === 0) return 'sem_ficha'
  if (missingCostCount > 0) return 'sem_custo'
  if (cmvUnit === null && cmvKgBaked === null) return 'sem_rendimento'
  if (priceCount === 0) return 'sem_preco'
  if (worstPrice?.marginStatus === 'prejuizo') return 'prejuizo'
  if (worstPrice?.marginStatus === 'ruim') return 'ruim'
  if (worstPrice?.marginStatus === 'media') return 'media'
  if (worstPrice?.marginStatus === 'boa') return 'boa'
  return 'sem_preco'
}

export function buildProductCmvAudits(input: BuildCmvAuditInput): ProductCmvAudit[] {
  const productsById = new Map(input.productCatalog.map(product => [product.id, product]))
  const breadsById = new Map(input.breadCatalog.map(bread => [bread.id, bread]))
  const yieldsByProduct = new Map(input.yields.map(yieldRow => [yieldRow.product_id, yieldRow]))
  const tiersById = new Map(input.priceTiers.filter(tier => tier.active !== false).map(tier => [tier.id, tier]))
  const activePriceLines = input.priceLines.filter(line => line.active !== false && tiersById.has(line.tier_id))

  return input.products
    .filter(product =>
      product.active !== false
      && product.is_fabricacao_propria === true
      && product.is_revenda !== true
      && product.kind !== 'insumo'
    )
    .map(product => {
      const productComponents = input.components.filter(component => component.parent_product_id === product.id)
      let missingCostCount = 0
      const recipeComponents = productComponents.map(component => {
        const item = component.component_source === 'bread'
          ? breadsById.get(component.component_id)
          : productsById.get(component.component_id)
        const cost = nullablePositive(item?.cost_price)
        if (cost === null) missingCostCount++
        return {
          name: item?.name ?? '',
          category: item?.category ?? null,
          quantity: component.quantity,
          cost: cost ?? 0,
        }
      })
      const recipeTotals = calculateRecipeTotals(recipeComponents)
      const cmvTotal = productComponents.length > 0 ? recipeTotals.ingredientCost : null
      const yieldRow = yieldsByProduct.get(product.id)
      const basis = isRecipeBasis(yieldRow?.basis ?? null) ? yieldRow?.basis as RecipeYieldBasis : 'dough'
      const yieldUnits = nullablePositive(yieldRow?.yield_units)
      const finishedWeight = nullablePositive(yieldRow?.finished_weight_kg)
      const averageUnitWeightKg = nullablePositive(yieldRow?.average_unit_weight_kg)
      const cmvUnit = cmvTotal !== null ? costPerUnit(cmvTotal, basis, yieldUnits) : null
      const cmvKgBaked = cmvTotal !== null ? costPerBakedKg(cmvTotal, basis, finishedWeight) : null
      const productPriceLines = activePriceLines.filter(line => lineMatchesProduct(line, product))
      const priceAudits = productPriceLines.map(line => {
        const tier = tiersById.get(line.tier_id)
        const unitCost = line.pricing_unit === 'kg' ? cmvKgBaked : cmvUnit
        const margin = classifyGrossMargin(line.unit_price, unitCost)
        return {
          tierName: tier?.name ?? 'Tabela',
          unitPrice: numeric(line.unit_price),
          pricingUnit: line.pricing_unit,
          marginStatus: margin.status,
          marginLabel: margin.label,
          marginPct: margin.marginPct,
          unitMargin: margin.unitMargin,
          unitCost: margin.unitCost,
        }
      })
      const worstPrice = chooseWorstPrice(priceAudits)
      const status = statusFromAudit(
        productComponents.length,
        missingCostCount,
        cmvUnit,
        cmvKgBaked,
        productPriceLines.length,
        worstPrice,
      )

      return {
        product,
        status,
        statusLabel: STATUS_LABELS[status],
        componentCount: productComponents.length,
        missingCostCount,
        cmvTotal,
        cmvUnit,
        cmvKgBaked,
        savedCost: nullablePositive(product.cost_price),
        yieldUnits,
        averageUnitWeightKg,
        priceCount: productPriceLines.length,
        worstPrice,
      }
    })
    .sort((a, b) => a.product.name.localeCompare(b.product.name))
}
