import { supabase } from '@/lib/supabase'

export interface PricingIndicatorMonth {
  month: string
  counter_sales: number
  ifood_sales: number
  pj_buck_revenue: number
  revenue: number
  fixed_expenses: number
  fixed_expense_pct: number | null
  production_labor: number
  kilograms_with_known_weight: number
  production_quantity: number
  quantity_with_known_weight: number
  weight_coverage_pct: number
  labor_cost_per_kg: number | null
  is_provisional: boolean
  provisional_reasons: string[]
}

export interface PricingIndicatorsAverage extends Omit<PricingIndicatorMonth, 'month' | 'counter_sales' | 'ifood_sales' | 'pj_buck_revenue'> {
  months_included: string[]
  month_count: number
}

export interface PricingIndicatorsData {
  months: PricingIndicatorMonth[]
  average: PricingIndicatorsAverage | null
}

export type PricingIndicatorsState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error' }
  | { status: 'ready'; data: PricingIndicatorsData }

export const PRICING_INDICATORS_ERROR = 'Não foi possível carregar os indicadores de preço.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toMonth(value: unknown): PricingIndicatorMonth | null {
  if (!isRecord(value) || typeof value.month !== 'string' || !/^\d{4}-\d{2}$/.test(value.month)) return null
  const revenue = toNumber(value.revenue)
  const fixedExpenses = toNumber(value.fixed_expenses)
  const productionLabor = toNumber(value.production_labor)
  const kilogramsWithKnownWeight = toNumber(value.kilograms_with_known_weight)
  const productionQuantity = toNumber(value.production_quantity)
  const quantityWithKnownWeight = toNumber(value.quantity_with_known_weight)
  const weightCoveragePct = toNumber(value.weight_coverage_pct)
  const counterSales = toNumber(value.counter_sales)
  const ifoodSales = toNumber(value.ifood_sales)
  const pjBuckRevenue = toNumber(value.pj_buck_revenue)
  if ([revenue, fixedExpenses, productionLabor, kilogramsWithKnownWeight, productionQuantity, quantityWithKnownWeight, weightCoveragePct, counterSales, ifoodSales, pjBuckRevenue].some((item) => item === null)) return null
  const fixedExpensePct = value.fixed_expense_pct === null ? null : toNumber(value.fixed_expense_pct)
  const laborCostPerKg = value.labor_cost_per_kg === null ? null : toNumber(value.labor_cost_per_kg)
  if (fixedExpensePct === null && value.fixed_expense_pct !== null) return null
  if (laborCostPerKg === null && value.labor_cost_per_kg !== null) return null
  if (typeof value.is_provisional !== 'boolean' || !Array.isArray(value.provisional_reasons)) return null
  if (!value.provisional_reasons.every((reason): reason is string => typeof reason === 'string')) return null

  return {
    month: value.month,
    counter_sales: counterSales!,
    ifood_sales: ifoodSales!,
    pj_buck_revenue: pjBuckRevenue!,
    revenue: revenue!,
    fixed_expenses: fixedExpenses!,
    fixed_expense_pct: fixedExpensePct,
    production_labor: productionLabor!,
    kilograms_with_known_weight: kilogramsWithKnownWeight!,
    production_quantity: productionQuantity!,
    quantity_with_known_weight: quantityWithKnownWeight!,
    weight_coverage_pct: weightCoveragePct!,
    labor_cost_per_kg: laborCostPerKg,
    is_provisional: value.is_provisional,
    provisional_reasons: value.provisional_reasons,
  }
}

function toAverage(value: unknown): PricingIndicatorsAverage | null | undefined {
  if (value === null) return null
  if (!isRecord(value) || !Array.isArray(value.months_included) || !value.months_included.every((month) => typeof month === 'string')) return undefined
  const monthCount = toNumber(value.month_count)
  const revenue = toNumber(value.revenue)
  const fixedExpenses = toNumber(value.fixed_expenses)
  const productionLabor = toNumber(value.production_labor)
  const kilogramsWithKnownWeight = toNumber(value.kilograms_with_known_weight)
  const productionQuantity = toNumber(value.production_quantity)
  const quantityWithKnownWeight = toNumber(value.quantity_with_known_weight)
  const weightCoveragePct = toNumber(value.weight_coverage_pct)
  if ([monthCount, revenue, fixedExpenses, productionLabor, kilogramsWithKnownWeight, productionQuantity, quantityWithKnownWeight, weightCoveragePct].some((item) => item === null)) return undefined
  const fixedExpensePct = value.fixed_expense_pct === null ? null : toNumber(value.fixed_expense_pct)
  const laborCostPerKg = value.labor_cost_per_kg === null ? null : toNumber(value.labor_cost_per_kg)
  if ((fixedExpensePct === null && value.fixed_expense_pct !== null) || (laborCostPerKg === null && value.labor_cost_per_kg !== null)) return undefined
  if (typeof value.is_provisional !== 'boolean' || !Array.isArray(value.provisional_reasons)) return undefined
  if (!value.provisional_reasons.every((reason): reason is string => typeof reason === 'string')) return undefined

  return {
    months_included: value.months_included,
    month_count: monthCount!,
    revenue: revenue!,
    fixed_expenses: fixedExpenses!,
    fixed_expense_pct: fixedExpensePct,
    production_labor: productionLabor!,
    kilograms_with_known_weight: kilogramsWithKnownWeight!,
    production_quantity: productionQuantity!,
    quantity_with_known_weight: quantityWithKnownWeight!,
    weight_coverage_pct: weightCoveragePct!,
    labor_cost_per_kg: laborCostPerKg,
    is_provisional: value.is_provisional,
    provisional_reasons: value.provisional_reasons,
  }
}

function parseIndicators(value: unknown): PricingIndicatorsData | null {
  if (!isRecord(value) || !Array.isArray(value.months)) return null
  const months = value.months.map(toMonth)
  if (months.some((month) => month === null)) return null
  const average = toAverage(value.average)
  if (average === undefined) return null
  return { months: months as PricingIndicatorMonth[], average }
}

export async function loadPricingIndicators(): Promise<PricingIndicatorsState> {
  const { data, error } = await supabase.rpc('get_pricing_financial_indicators')
  if (error) return { status: 'error' }
  const parsed = parseIndicators(data)
  if (!parsed) return { status: 'error' }
  if (parsed.months.length === 0) return { status: 'empty' }
  return { status: 'ready', data: parsed }
}

export function formatIndicatorCurrency(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

export function formatExpensePercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 }).format(value)
}

export function formatCoveragePercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value)}%`
}

export function formatIndicatorMonth(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match) return month
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1, 12))
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)
}
