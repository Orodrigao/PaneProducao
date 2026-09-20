export interface InventoryProductRow {
  id: string
  name: string
  category: string | null
  unit: string | null
  cost_price: number | string | null
  active: boolean
  kind: string | null
}

export interface InventoryPurchaseConversionRow {
  base_product_id: string
  purchase_unit: string | null
  base_unit: string | null
  conversion_factor: number | string | null
  factor_confirmed?: boolean | null
  active?: boolean | null
}

export type CanonicalInventoryUnit = 'kg' | 'g' | 'l' | 'ml' | 'un' | 'pct' | 'cx' | 'fardo'

export interface InventoryReadinessItem {
  product: InventoryProductRow
  stockUnit: CanonicalInventoryUnit | null
  blockingIssues: string[]
  warnings: string[]
  conversionCount: number
  ready: boolean
}

export interface InventoryReadinessSummary {
  total: number
  ready: number
  missingCost: number
  invalidUnit: number
  conversionIssues: number
}

const UNIT_ALIASES: Record<string, CanonicalInventoryUnit> = {
  kg: 'kg',
  kilo: 'kg',
  quilo: 'kg',
  quilos: 'kg',
  quilograma: 'kg',
  quilogramas: 'kg',
  g: 'g',
  gr: 'g',
  grama: 'g',
  gramas: 'g',
  l: 'l',
  lt: 'l',
  litro: 'l',
  litros: 'l',
  ml: 'ml',
  mililitro: 'ml',
  mililitros: 'ml',
  un: 'un',
  und: 'un',
  unidade: 'un',
  unidades: 'un',
  pc: 'un',
  peca: 'un',
  pecas: 'un',
  pct: 'pct',
  pacote: 'pct',
  pacotes: 'pct',
  cx: 'cx',
  caixa: 'cx',
  caixas: 'cx',
  fd: 'fardo',
  fardo: 'fardo',
  fardos: 'fardo',
}

function normalizeUnitText(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '')
}

function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function isInventoryInputCandidate(product: InventoryProductRow): boolean {
  const category = normalizeSearchText(product.category)
  return product.kind === null
    || product.kind === 'insumo'
    || category.includes('insumo')
    || category.includes('embalag')
}

export function canonicalInventoryUnit(value: string | null | undefined): CanonicalInventoryUnit | null {
  const normalized = normalizeUnitText(value)
  return normalized ? UNIT_ALIASES[normalized] ?? null : null
}

function positiveNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function buildInventoryReadiness(
  products: InventoryProductRow[],
  conversions: InventoryPurchaseConversionRow[],
  options: { conversionCoverageKnown?: boolean } = {},
): InventoryReadinessItem[] {
  const conversionCoverageKnown = options.conversionCoverageKnown !== false
  return products
    .filter(product => product.active && isInventoryInputCandidate(product))
    .map(product => {
      const stockUnit = canonicalInventoryUnit(product.unit)
      const blockingIssues: string[] = []
      const warnings: string[] = []

      if (product.kind !== 'insumo') blockingIssues.push('Classificação de insumo pendente no catálogo')
      if (!stockUnit) blockingIssues.push('Unidade de estoque ausente ou não reconhecida')
      if (positiveNumber(product.cost_price) === null) blockingIssues.push('Sem custo unitário cadastrado')
      if (!conversionCoverageKnown) blockingIssues.push('Conversões de compra não conferidas neste perfil')

      const productConversions = conversions.filter(conversion =>
        conversion.base_product_id === product.id && conversion.active !== false,
      )
      if (conversionCoverageKnown && productConversions.length === 0) warnings.push('Sem compra XML mapeada ainda')

      for (const conversion of productConversions) {
        const baseUnit = canonicalInventoryUnit(conversion.base_unit)
        const purchaseUnit = canonicalInventoryUnit(conversion.purchase_unit)
        if (!baseUnit || !stockUnit || baseUnit !== stockUnit) {
          blockingIssues.push(`Conversão de ${conversion.purchase_unit || 'compra'} aponta para outra unidade-base`)
          continue
        }
        if (positiveNumber(conversion.conversion_factor) === null) {
          blockingIssues.push(`Conversão de ${conversion.purchase_unit || 'compra'} sem fator válido`)
          continue
        }
        if (purchaseUnit !== stockUnit && conversion.factor_confirmed !== true) {
          blockingIssues.push(`Conversão de ${conversion.purchase_unit || 'compra'} ainda não foi confirmada`)
        }
      }

      return {
        product,
        stockUnit,
        blockingIssues: [...new Set(blockingIssues)],
        warnings: [...new Set(warnings)],
        conversionCount: productConversions.length,
        ready: blockingIssues.length === 0,
      }
    })
    .sort((a, b) => a.product.name.localeCompare(b.product.name, 'pt-BR'))
}

export function summarizeInventoryReadiness(items: InventoryReadinessItem[]): InventoryReadinessSummary {
  return {
    total: items.length,
    ready: items.filter(item => item.ready).length,
    missingCost: items.filter(item => item.blockingIssues.includes('Sem custo unitário cadastrado')).length,
    invalidUnit: items.filter(item => item.blockingIssues.includes('Unidade de estoque ausente ou não reconhecida')).length,
    conversionIssues: items.filter(item => item.blockingIssues.some(issue => issue.startsWith('Conversão de '))).length,
  }
}
