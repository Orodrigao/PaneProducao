import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }))

import { PricingIndicators } from './PricingIndicators'
import type { PricingIndicatorMonth, PricingIndicatorsState } from '@/lib/pricingIndicators'

const month: PricingIndicatorMonth = {
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

describe('PricingIndicators', () => {
  it('mostra carregando, vazio e erro com seus estados acessíveis', () => {
    const loading = renderToStaticMarkup(createElement(PricingIndicators, { state: { status: 'loading' } }))
    const empty = renderToStaticMarkup(createElement(PricingIndicators, { state: { status: 'empty' } }))
    const error = renderToStaticMarkup(createElement(PricingIndicators, { state: { status: 'error' } }))

    expect(loading).toContain('aria-busy="true"')
    expect(loading).toContain('Carregando indicadores do Financeiro')
    expect(empty).toContain('Ainda não há mês completo no Financeiro')
    expect(error).toContain('role="alert"')
    expect(error).toContain('Não foi possível carregar os indicadores de preço.')
  })

  it('mostra mês, média e motivos provisórios junto aos números', () => {
    const state: PricingIndicatorsState = {
      status: 'ready',
      data: {
        months: [month],
        average: {
          ...month,
          months_included: ['2026-09'],
          month_count: 1,
        },
      },
    }
    const html = renderToStaticMarkup(createElement(PricingIndicators, { state }))

    expect(html).toContain('setembro de 2026')
    expect(html).toContain('Média')
    expect(html).toContain('R$')
    expect(html).toContain('10% do faturamento')
    expect(html).toContain('62%')
    expect(html).toContain('cobertura de peso 62%')
  })
})
