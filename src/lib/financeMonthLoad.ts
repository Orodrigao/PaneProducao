// src/lib/financeMonthLoad.ts: leitura da tela Financeiro (livro do mês).

import {
  loadFinanceAccounts,
  loadFinanceCategories,
  loadFinanceEntries,
  loadFinanceRecurringRules,
  loadPayableDueReportStatus,
  type FinanceAccountRow,
  type FinanceCategoryRow,
  type FinanceEntryRow,
  type FinanceRecurringRuleRow,
  type PayableDueReportStatus,
} from '@/lib/finance'

export type FinanceMonthData = {
  categories: FinanceCategoryRow[]
  accounts: FinanceAccountRow[]
  entries: FinanceEntryRow[]
  recurringRules: FinanceRecurringRuleRow[]
  payableDueReportStatus: PayableDueReportStatus[]
}

export type FinanceMonthLoaders = {
  categories: () => Promise<FinanceCategoryRow[]>
  accounts: () => Promise<FinanceAccountRow[]>
  entries: (monthKey: string) => Promise<FinanceEntryRow[]>
  recurringRules: () => Promise<FinanceRecurringRuleRow[]>
  payableDueReportStatus: () => Promise<PayableDueReportStatus[]>
}

export type FinanceMonthView = {
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  apply: (data: FinanceMonthData) => void
}

export const FINANCE_MONTH_LOAD_ERROR = 'Não foi possível carregar o financeiro. Confira sua permissão e tente novamente.'

const FINANCE_MONTH_LOADERS: FinanceMonthLoaders = {
  categories: loadFinanceCategories,
  accounts: loadFinanceAccounts,
  entries: loadFinanceEntries,
  recurringRules: loadFinanceRecurringRules,
  payableDueReportStatus: loadPayableDueReportStatus,
}

// Cada troca de mês, Atualizar ou recarga depois de gravar dispara uma
// leitura; só a mais recente pode mexer na tela. Resposta do mês atual
// chegando por último mostrava os lançamentos de outubro sob setembro.
export async function loadFinanceMonth(
  monthKey: string,
  sequence: { current: number },
  view: FinanceMonthView,
  loaders: FinanceMonthLoaders = FINANCE_MONTH_LOADERS,
): Promise<void> {
  const seq = ++sequence.current
  view.setLoading(true)
  view.setError(null)
  try {
    const [categories, accounts, entries, recurringRules] = await Promise.all([
      loaders.categories(),
      loaders.accounts(),
      loaders.entries(monthKey),
      loaders.recurringRules(),
    ])
    if (seq !== sequence.current) return
    const payableDueReportStatus = await loaders.payableDueReportStatus().catch(reportError => {
      if (seq === sequence.current) console.warn('O status do relatório diário ainda não está disponível.', reportError)
      return [] as PayableDueReportStatus[]
    })
    if (seq !== sequence.current) return
    view.apply({ categories, accounts, entries, recurringRules, payableDueReportStatus })
  } catch (loadError) {
    if (seq !== sequence.current) return
    console.error(loadError)
    view.setError(FINANCE_MONTH_LOAD_ERROR)
  } finally {
    if (seq === sequence.current) view.setLoading(false)
  }
}

export type FinanceMonthLoader = {
  // Troca de mês: passa a ser o mês de todas as recargas seguintes.
  select: (monthKey: string) => Promise<void>
  // Atualizar, Tentar de novo e a recarga depois de lançar, estornar,
  // transferir ou mexer em recorrência e taxas: sempre o mês escolhido agora.
  // Um estorno começado em outubro que termina depois da troca para setembro
  // recarrega setembro, não o mês de quando o botão foi tocado.
  reload: () => Promise<void>
}

export function createFinanceMonthLoader(
  initialMonthKey: string,
  view: FinanceMonthView,
  loaders: FinanceMonthLoaders = FINANCE_MONTH_LOADERS,
): FinanceMonthLoader {
  const sequence = { current: 0 }
  let monthKey = initialMonthKey
  return {
    select: nextMonthKey => {
      monthKey = nextMonthKey
      return loadFinanceMonth(monthKey, sequence, view, loaders)
    },
    reload: () => loadFinanceMonth(monthKey, sequence, view, loaders),
  }
}
