import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }))

import { supabase } from '@/lib/supabase'
import {
  formatCoveragePercent,
  formatExpensePercent,
  formatIndicatorCurrency,
  formatIndicatorMonth,
  loadPricingIndicators,
} from './pricingIndicators'

const month = {
  month: '2026-09',
  counter_sales: 10000,
  ifood_sales: 600,
  pj_buck_revenue: 3000,
  revenue: 13600,
  fixed_expenses: 1360,
  fixed_expense_pct: 0.1,
  production_labor: 116.25,
  kilograms_with_known_weight: 31,
  production_quantity: 100,
  quantity_with_known_weight: 62,
  weight_coverage_pct: 62,
  labor_cost_per_kg: 3.75,
  is_provisional: true,
  provisional_reasons: ['cobertura de peso 62%'],
}

describe('pricingIndicators', () => {
  beforeEach(() => vi.clearAllMocks())

  it('carrega indicadores e transforma uma resposta sem meses no estado vazio', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { months: [], average: null }, error: null } as never)

    await expect(loadPricingIndicators()).resolves.toEqual({ status: 'empty' })
    expect(supabase.rpc).toHaveBeenCalledWith('get_pricing_financial_indicators')
  })

  it('entrega os meses e a média já validados', async () => {
    const average = { ...month, months_included: ['2026-09'], month_count: 1 }
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { months: [month], average }, error: null } as never)

    const result = await loadPricingIndicators()
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') throw new Error('Esperava indicadores carregados')
    expect(result.data.months[0]?.labor_cost_per_kg).toBe(3.75)
    expect(result.data.average?.months_included).toEqual(['2026-09'])
  })

  it('usa uma mensagem segura quando o RPC falha ou devolve dados inválidos', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error: { message: 'detalhe interno' } } as never)
    await expect(loadPricingIndicators()).resolves.toEqual({ status: 'error' })

    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { months: [{ month: 'inválido' }], average: null }, error: null } as never)
    await expect(loadPricingIndicators()).resolves.toEqual({ status: 'error' })
  })

  it('formata valores e meses no padrão brasileiro', () => {
    expect(formatIndicatorCurrency(3.75)).toContain('3,75')
    expect(formatExpensePercent(0.1)).toBe('10%')
    expect(formatCoveragePercent(62)).toBe('62%')
    expect(formatIndicatorMonth('2026-09')).toBe('setembro de 2026')
    expect(formatIndicatorCurrency(null)).toBe('—')
    expect(formatExpensePercent(null)).toBe('—')
  })
})
