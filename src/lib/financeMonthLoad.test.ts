import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))

import type { FinanceEntryRow, PayableDueReportStatus } from '@/lib/finance'
import {
  FINANCE_MONTH_LOAD_ERROR,
  createFinanceMonthLoader,
  loadFinanceMonth,
  type FinanceMonthData,
  type FinanceMonthLoaders,
} from '@/lib/financeMonthLoad'

const pageSource = readFileSync(new URL('../app/financeiro/page.tsx', import.meta.url), 'utf8')

type Pending<T> = { resolve: (rows: T) => void, reject: (error: unknown) => void }

function entry(id: string, paidDate: string): FinanceEntryRow {
  return { id, description: id, paid_date: paidDate } as FinanceEntryRow
}

const REPORT = [{ report_kind: 'vencida', status: 'enviado', report_date: '2026-09-15' }] as PayableDueReportStatus[]

// Cada leitura do livro fica pendurada até o teste decidir a ordem em que as
// respostas chegam, como acontece com a rede lenta da loja. Com holdReports,
// o status do relatório diário também espera.
function controlledLoaders({ holdReports = false } = {}) {
  const pending: Pending<FinanceEntryRow[]>[] = []
  const reports: Pending<PayableDueReportStatus[]>[] = []
  const requested: string[] = []
  const loaders: FinanceMonthLoaders = {
    categories: async () => [],
    accounts: async () => [],
    entries: monthKey => new Promise<FinanceEntryRow[]>((resolve, reject) => {
      requested.push(monthKey)
      pending.push({ resolve, reject })
    }),
    recurringRules: async () => [],
    payableDueReportStatus: () => holdReports
      ? new Promise<PayableDueReportStatus[]>((resolve, reject) => { reports.push({ resolve, reject }) })
      : Promise.resolve([]),
  }
  return { loaders, pending, reports, requested }
}

// Espelha o que a tela guarda no estado do React.
function screen() {
  const state = { loading: false, error: null as string | null, data: null as FinanceMonthData | null, applied: 0 }
  const view = {
    setLoading: (loading: boolean) => { state.loading = loading },
    setError: (error: string | null) => { state.error = error },
    apply: (data: FinanceMonthData) => { state.data = data; state.applied += 1 },
  }
  return { state, view }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const listed = (data: FinanceMonthData | null) => data?.entries.map(row => row.id)

afterEach(() => vi.restoreAllMocks())

describe('livro do mês na tela Financeiro', () => {
  it('resposta do mês atual chegando depois da do mês escolhido não troca a lista', async () => {
    const { loaders, pending, requested } = controlledLoaders()
    const { state, view } = screen()
    const sequence = { current: 0 }

    const opening = loadFinanceMonth('2026-10', sequence, view, loaders)
    const chosen = loadFinanceMonth('2026-09', sequence, view, loaders)
    await flush()
    expect(requested).toEqual(['2026-10', '2026-09'])

    pending[1].resolve([entry('Produção setembro', '2026-09-15')])
    await chosen
    expect(listed(state.data)).toEqual(['Produção setembro'])
    expect(state.loading).toBe(false)

    pending[0].resolve([entry('Produção outubro', '2026-10-02')])
    await opening
    expect(listed(state.data)).toEqual(['Produção setembro'])
    expect(state.applied).toBe(1)
    expect(state.loading).toBe(false)
  })

  it('resposta antiga chegando primeiro não aparece nem tira o carregando', async () => {
    const { loaders, pending } = controlledLoaders()
    const { state, view } = screen()
    const sequence = { current: 0 }

    const opening = loadFinanceMonth('2026-10', sequence, view, loaders)
    const chosen = loadFinanceMonth('2026-09', sequence, view, loaders)
    await flush()

    pending[0].resolve([entry('Produção outubro', '2026-10-02')])
    await opening
    expect(state.data).toBeNull()
    expect(state.loading).toBe(true)

    pending[1].resolve([entry('Produção setembro', '2026-09-15')])
    await chosen
    expect(listed(state.data)).toEqual(['Produção setembro'])
    expect(state.loading).toBe(false)
  })

  it('leitura antiga que já esperava o relatório diário não aparece quando ele chega', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { loaders, pending, reports } = controlledLoaders({ holdReports: true })
    const { state, view } = screen()
    const sequence = { current: 0 }

    const opening = loadFinanceMonth('2026-10', sequence, view, loaders)
    await flush()
    pending[0].resolve([entry('Produção outubro', '2026-10-02')])
    await flush()
    expect(reports).toHaveLength(1)

    const chosen = loadFinanceMonth('2026-09', sequence, view, loaders)
    await flush()
    pending[1].resolve([entry('Produção setembro', '2026-09-15')])
    await flush()
    reports[1].resolve(REPORT)
    await chosen
    expect(listed(state.data)).toEqual(['Produção setembro'])

    reports[0].reject(new Error('relatório da leitura antiga'))
    await opening
    expect(listed(state.data)).toEqual(['Produção setembro'])
    expect(state.data?.payableDueReportStatus).toEqual(REPORT)
    expect(state.applied).toBe(1)
    expect(state.loading).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it('falha de uma leitura superada não mostra erro sobre a lista certa', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { loaders, pending } = controlledLoaders()
    const { state, view } = screen()
    const sequence = { current: 0 }

    const opening = loadFinanceMonth('2026-10', sequence, view, loaders)
    const chosen = loadFinanceMonth('2026-09', sequence, view, loaders)
    await flush()

    pending[1].resolve([entry('Produção setembro', '2026-09-15')])
    await chosen
    pending[0].reject(new Error('rede caiu'))
    await opening
    expect(state.error).toBeNull()
    expect(listed(state.data)).toEqual(['Produção setembro'])
    expect(state.loading).toBe(false)
  })

  it('falha da leitura mais nova fica na tela mesmo se a antiga chegar depois', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { loaders, pending } = controlledLoaders()
    const { state, view } = screen()
    const sequence = { current: 0 }

    const opening = loadFinanceMonth('2026-10', sequence, view, loaders)
    const chosen = loadFinanceMonth('2026-09', sequence, view, loaders)
    await flush()
    pending[1].reject(new Error('sem permissão'))
    await chosen
    expect(state.error).toBe(FINANCE_MONTH_LOAD_ERROR)
    expect(state.loading).toBe(false)

    pending[0].resolve([entry('Produção outubro', '2026-10-02')])
    await opening
    expect(state.error).toBe(FINANCE_MONTH_LOAD_ERROR)
    expect(state.data).toBeNull()
    expect(state.loading).toBe(false)
  })

  it('Tentar de novo depois do erro limpa a mensagem e mostra a lista', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { loaders, pending } = controlledLoaders()
    const { state, view } = screen()
    const loader = createFinanceMonthLoader('2026-09', view, loaders)

    const first = loader.select('2026-09')
    await flush()
    pending[0].reject(new Error('rede caiu'))
    await first
    expect(state.error).toBe(FINANCE_MONTH_LOAD_ERROR)

    const retry = loader.reload()
    expect(state.error).toBeNull()
    expect(state.loading).toBe(true)
    await flush()
    pending[1].resolve([entry('Produção setembro', '2026-09-15')])
    await retry
    expect(state.error).toBeNull()
    expect(listed(state.data)).toEqual(['Produção setembro'])
    expect(state.loading).toBe(false)
  })

  it('recarga de um estorno começado em outubro e terminado depois da troca lê setembro', async () => {
    const { loaders, pending, requested } = controlledLoaders()
    const { state, view } = screen()
    const loader = createFinanceMonthLoader('2026-10', view, loaders)

    const opening = loader.select('2026-10')
    await flush()
    pending[0].resolve([entry('Aluguel outubro', '2026-10-05')])
    await opening

    // O estorno de outubro ainda espera o banco; a pessoa troca para setembro.
    const chosen = loader.select('2026-09')
    await flush()
    pending[1].resolve([entry('Produção setembro', '2026-09-15')])
    await chosen

    // O estorno termina e pede a recarga.
    const afterReverse = loader.reload()
    await flush()
    expect(requested).toEqual(['2026-10', '2026-09', '2026-09'])
    pending[2].resolve([entry('Produção setembro', '2026-09-15'), entry('Estorno de setembro', '2026-09-20')])
    await afterReverse
    expect(listed(state.data)).toEqual(['Produção setembro', 'Estorno de setembro'])
    expect(state.loading).toBe(false)
  })

  it('recarga depois de gravar vale a mais nova, mesmo no mesmo mês', async () => {
    const { loaders, pending } = controlledLoaders()
    const { state, view } = screen()
    const loader = createFinanceMonthLoader('2026-09', view, loaders)

    const beforeSave = loader.select('2026-09')
    const afterSave = loader.reload()
    await flush()

    pending[1].resolve([entry('Produção setembro', '2026-09-15'), entry('Estorno do aluguel', '2026-09-20')])
    await afterSave
    pending[0].resolve([entry('Produção setembro', '2026-09-15')])
    await beforeSave
    expect(listed(state.data)).toEqual(['Produção setembro', 'Estorno do aluguel'])
    expect(state.loading).toBe(false)
  })

  it('status do relatório diário indisponível não derruba o livro', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { loaders, pending } = controlledLoaders()
    loaders.payableDueReportStatus = async () => { throw new Error('função ainda não publicada') }
    const { state, view } = screen()

    const chosen = loadFinanceMonth('2026-09', { current: 0 }, view, loaders)
    await flush()
    pending[0].resolve([entry('Produção setembro', '2026-09-15')])
    await chosen
    expect(state.error).toBeNull()
    expect(state.data?.payableDueReportStatus).toEqual([])
    expect(listed(state.data)).toEqual(['Produção setembro'])
  })

  it('a tela lê o livro só por um carregador criado uma vez, que guarda o mês escolhido', () => {
    expect(pageSource).toContain('const [monthLoader] = useState(() => createFinanceMonthLoader(monthKey, {')
    expect(pageSource).toContain('const load = monthLoader.reload')
    expect(pageSource).toContain('useEffect(() => { void monthLoader.select(monthKey) }, [monthLoader, monthKey])')
    expect(pageSource).not.toContain('loadFinanceEntries(')
    expect(pageSource).not.toContain('loadFinanceMonth(')
    expect(pageSource).not.toContain('setLoading(false)')
  })
})
