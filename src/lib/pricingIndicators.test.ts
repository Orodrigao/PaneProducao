import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }))

import { supabase } from '@/lib/supabase'
import {
  formatCoveragePercent,
  formatExpensePercent,
  formatIndicatorCurrency,
  formatIndicatorMonth,
  loadPricingIndicators,
  loadPricingIndicatorsInto,
  type PricingIndicatorsState,
} from './pricingIndicators'

const month = {
  month: '2026-09',
  counter_sales: 10000,
  ifood_sales: 600,
  pj_buck_revenue: 3000,
  revenue: 13600,
  fixed_expenses: 1360,
  fixed_expense_pct: 0.1,
  owner_salary: null,
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

  it('lê o salário dos donos e recusa mostrar a conta do banco antigo, que não o manda', async () => {
    const withSalary = { ...month, fixed_expenses: 21360, owner_salary: 20000 }
    const average = { ...withSalary, months_included: ['2026-09'], month_count: 1 }
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { months: [withSalary], average }, error: null } as never)
    const result = await loadPricingIndicators()
    if (result.status !== 'ready') throw new Error('Esperava indicadores carregados')
    expect(result.data.months[0]?.owner_salary).toBe(20000)
    expect(result.data.average?.owner_salary).toBe(20000)

    // Site novo com banco ainda sem a migration: a resposta não tem o campo e
    // conta o peso pela regra antiga. Mesmo um mês sem ressalva não aparece.
    const { owner_salary: _semCampo, ...oldMonth } = { ...month, is_provisional: false, provisional_reasons: [] }
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { months: [oldMonth], average: null }, error: null } as never)
    await expect(loadPricingIndicators()).resolves.toEqual({ status: 'outdated' })

    // Valor que não é número continua recusado.
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { months: [{ ...month, owner_salary: 'muito' }], average: null }, error: null } as never)
    await expect(loadPricingIndicators()).resolves.toEqual({ status: 'error' })
  })

  it('só a leitura mais recente mexe no quadro', async () => {
    const applied: PricingIndicatorsState[] = []
    const sequence = { current: 0 }
    let resolveOld: (state: PricingIndicatorsState) => void = () => {}
    const old = new Promise<PricingIndicatorsState>((resolve) => { resolveOld = resolve })
    const first = loadPricingIndicatorsInto(sequence, (state) => applied.push(state), () => old)
    // Salvar dispara outra leitura, que volta antes da primeira.
    const fresh: PricingIndicatorsState = { status: 'empty' }
    await loadPricingIndicatorsInto(sequence, (state) => applied.push(state), async () => fresh)
    resolveOld({ status: 'error' })
    await first
    expect(applied).toEqual([{ status: 'loading' }, { status: 'loading' }, fresh])

    // Leitura que lança erro vira o estado de erro, sem deixar o quadro carregando.
    const later: PricingIndicatorsState[] = []
    await loadPricingIndicatorsInto(sequence, (state) => later.push(state), async () => { throw new Error('rede') })
    expect(later).toEqual([{ status: 'loading' }, { status: 'error' }])
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
