// src/lib/finance.ts — livro-caixa do módulo Financeiro (fase 0).
//
// Regras de negócio em docs/FINANCEIRO.md. O valor e a autoria são validados
// no banco; o que existe aqui é a validação de tela, para o usuário receber o
// recado antes de mandar, e a leitura do livro.

import { supabase } from '@/lib/supabase'
import { parseMoneyInput } from '@/lib/cashClosing'
import { todayKey } from '@/lib/utils'

// A rota e a permissão vivem em src/lib/auth.ts, junto das demais — importar
// auth aqui só para reexportá-las carregaria a autenticação em toda tela que
// usa o livro.

export type FinanceStore = 'jc' | 'ja' | 'geral'
export type FinanceNature = 'receita' | 'despesa' | 'transferencia'
export type FinanceTier = 'operacional' | 'abaixo_da_linha' | 'transferencia'
export type FinanceEntryType = 'lancamento' | 'estorno'
export type FinancePaymentMethod =
  | 'dinheiro' | 'pix' | 'transferencia' | 'boleto' | 'cartao' | 'debito_automatico' | 'outro'

export const FINANCE_STORE_LABELS: Record<FinanceStore, string> = {
  jc: 'Júlio de Castilhos',
  ja: 'Jardim América',
  geral: 'Geral (as duas)',
}

export const FINANCE_PAYMENT_LABELS: Record<FinancePaymentMethod, string> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  transferencia: 'Transferência',
  boleto: 'Boleto',
  cartao: 'Cartão',
  debito_automatico: 'Débito automático',
  outro: 'Outro',
}

export interface FinanceCategoryRow {
  id: string
  key: string
  label: string
  dre_tier: FinanceTier
  dre_group: string
  nature: FinanceNature
  team: string | null
  sort_order: number
}

export interface FinanceAccountRow {
  id: string
  key: string
  label: string
  kind: 'banco' | 'caixa'
  store: string | null
  cnpj_label: string | null
  sort_order: number
}

/** Origem do lançamento. 'avulso' é digitado; o resto nasce de outra tela. */
export type FinanceSource = 'avulso' | 'contas_pagar' | 'recorrencia'

export const FINANCE_SOURCE_LABELS: Record<FinanceSource, string> = {
  avulso: 'Lançamento avulso',
  contas_pagar: 'Contas a pagar',
  recorrencia: 'Recorrência',
}

export interface FinanceEntryRow {
  id: string
  entry_type: FinanceEntryType
  category_id: string
  // Nulo quando a origem não sabe de qual conta o dinheiro saiu.
  account_id: string | null
  store: FinanceStore
  competence_month: string
  paid_date: string
  planned_amount: number
  amount: number
  payment_method: FinancePaymentMethod
  description: string
  source: FinanceSource
  source_ref: string | null
  recurrence_month: string | null
  reversal_of: string | null
  reversal_reason: string | null
  reversed_at: string | null
  created_at: string
}

export interface FinanceRecurringRuleRow {
  id: string
  name: string
  category_id: string
  store: FinanceStore
  planned_amount: number
  due_day: number
  start_month: string
  end_month: string | null
  default_account_id: string
  default_payment_method: FinancePaymentMethod
  active: boolean
}

export interface FinanceRecurringForecast {
  rule: FinanceRecurringRuleRow
  competenceMonth: string
  dueDate: string
  entry: FinanceEntryRow | null
}

export interface FinanceRecurringRuleDraft {
  name: string
  categoryKey: string
  store: FinanceStore | ''
  plannedAmount: string
  dueDay: string
  startMonth: string
  endMonth: string
  defaultAccountKey: string
  defaultPaymentMethod: FinancePaymentMethod
}

export function emptyFinanceRecurringRuleDraft(monthKey = currentMonthKey()): FinanceRecurringRuleDraft {
  return {
    name: '',
    categoryKey: '',
    store: '',
    plannedAmount: '',
    dueDay: '10',
    startMonth: monthKey,
    endMonth: '',
    defaultAccountKey: '',
    defaultPaymentMethod: 'boleto',
  }
}

/**
 * A diferença entre o previsto e o pago: juro, multa ou desconto.
 * O `+ 0` evita que uma sobra de arredondamento vire "-0" na tela.
 */
export function entryDifference(entry: Pick<FinanceEntryRow, 'planned_amount' | 'amount'>): number {
  return Math.round((entry.amount - entry.planned_amount) * 100) / 100 + 0
}

export interface FinanceEntryDraft {
  categoryKey: string
  accountKey: string
  store: FinanceStore | ''
  amount: string
  paidDate: string
  paymentMethod: FinancePaymentMethod
  description: string
}

export function emptyFinanceDraft(): FinanceEntryDraft {
  return {
    categoryKey: '',
    accountKey: '',
    store: '',
    amount: '',
    paidDate: todayKey(),
    paymentMethod: 'dinheiro',
    description: '',
  }
}

export function getFinanceErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return fallback
}

export const FINANCE_MAX_AMOUNT = 1_000_000

export function validateFinanceRecurringRuleDraft(draft: FinanceRecurringRuleDraft): string | null {
  if (draft.name.trim().length < 3) return 'Dê um nome à recorrência com pelo menos 3 letras.'
  if (!draft.categoryKey) return 'Escolha a categoria da recorrência.'
  if (!draft.store) return 'Escolha a loja da recorrência.'
  const amount = parseMoneyInput(draft.plannedAmount)
  if (!(amount > 0)) return 'Informe um valor previsto maior que zero.'
  if (amount > FINANCE_MAX_AMOUNT) return 'Valor acima do limite permitido. Confira o que foi digitado.'
  const dueDay = Number(draft.dueDay)
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return 'Informe um dia de vencimento entre 1 e 31.'
  if (!/^\d{4}-\d{2}$/.test(draft.startMonth)) return 'Informe o mês de início da recorrência.'
  if (draft.endMonth && (!/^\d{4}-\d{2}$/.test(draft.endMonth) || draft.endMonth < draft.startMonth)) {
    return 'O fim da vigência não pode ser antes do início.'
  }
  if (!draft.defaultAccountKey) return 'Escolha a conta habitual da recorrência.'
  return null
}

/** Mesmo limite do banco: dinheiro validado na entrada E na saída. */
export function validateFinanceDraft(draft: FinanceEntryDraft, today = todayKey()): string | null {
  if (!draft.categoryKey) return 'Escolha a categoria do lançamento.'
  if (!draft.store) return 'Escolha a loja do lançamento.'
  if (!draft.accountKey) return 'Escolha de qual conta ou caixa saiu o dinheiro.'

  const amount = parseMoneyInput(draft.amount)
  if (!(amount > 0)) return 'Informe um valor maior que zero.'
  if (amount > FINANCE_MAX_AMOUNT) return 'Valor acima do limite permitido. Confira o que foi digitado.'

  if (!draft.paidDate) return 'Informe a data do lançamento.'
  if (draft.paidDate > today) return 'A data do lançamento não pode ser no futuro.'
  if (draft.paidDate < '2020-01-01') return 'Data do lançamento muito antiga. Confira o que foi digitado.'

  if (draft.description.trim().length < 3) return 'Descreva o lançamento com pelo menos 3 letras.'
  return null
}

/** O mês em que o lançamento pesa no DRE (competência) — derivado da data. */
export function competenceMonthOf(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`
}

export function formatCompetenceMonth(monthKey: string): string {
  const [year, month] = monthKey.split('-')
  const names = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
  const name = names[Number(month) - 1] ?? month
  return `${name} de ${year}`
}

export function formatFinanceMoney(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/**
 * O efeito do lançamento no caixa: estorno inverte o sinal do original, e é
 * por isso que corrigir nunca precisa apagar nada.
 */
export function entrySignedAmount(entry: Pick<FinanceEntryRow, 'entry_type' | 'amount'>, nature: FinanceNature): number {
  const base = nature === 'receita' ? entry.amount : -entry.amount
  return entry.entry_type === 'estorno' ? -base : base
}

export interface FinanceMonthTotals {
  receita: number
  despesa: number
  saldo: number
}

export function summarizeEntries(
  entries: readonly FinanceEntryRow[],
  categoriesById: ReadonlyMap<string, FinanceCategoryRow>,
): FinanceMonthTotals {
  let receita = 0
  let despesa = 0
  for (const entry of entries) {
    const category = categoriesById.get(entry.category_id)
    if (!category) continue
    const signed = entrySignedAmount(entry, category.nature)
    if (signed >= 0) receita += signed
    else despesa += -signed
  }
  return { receita, despesa, saldo: receita - despesa }
}

export function monthRange(monthKey: string): { start: string; end: string } {
  const [year, month] = monthKey.split('-').map(Number)
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`
  return { start: `${monthKey}-01`, end: nextMonth }
}

export function currentMonthKey(today = todayKey()): string {
  return today.slice(0, 7)
}

function lastDayOfMonth(monthKey: string): number {
  const [year, month] = monthKey.split('-').map(Number)
  return new Date(year, month, 0).getDate()
}

export function recurringDueDate(monthKey: string, dueDay: number): string {
  return `${monthKey}-${String(Math.min(dueDay, lastDayOfMonth(monthKey))).padStart(2, '0')}`
}

export function buildFinanceRecurringForecasts(
  rules: readonly FinanceRecurringRuleRow[],
  entries: readonly FinanceEntryRow[],
  monthKey: string,
): FinanceRecurringForecast[] {
  const month = `${monthKey}-01`
  const entryByRule = new Map<string, FinanceEntryRow>()
  entries.forEach(entry => {
    if (entry.source === 'recorrencia' && entry.entry_type === 'lancamento' && entry.reversed_at === null
      && entry.source_ref && entry.recurrence_month === month) {
      entryByRule.set(entry.source_ref, entry)
    }
  })
  return rules
    .filter(rule => rule.active && rule.start_month <= month && (!rule.end_month || rule.end_month >= month))
    .map(rule => ({
      rule,
      competenceMonth: month,
      dueDate: recurringDueDate(monthKey, rule.due_day),
      entry: entryByRule.get(rule.id) ?? null,
    }))
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.rule.name.localeCompare(right.rule.name))
}

export async function loadFinanceCategories(): Promise<FinanceCategoryRow[]> {
  const { data, error } = await supabase
    .from('finance_categories')
    .select('id,key,label,dre_tier,dre_group,nature,team,sort_order')
    .eq('active', true)
    .order('sort_order')
  if (error) throw error
  return (data ?? []) as FinanceCategoryRow[]
}

export async function loadFinanceAccounts(): Promise<FinanceAccountRow[]> {
  const { data, error } = await supabase
    .from('finance_accounts')
    .select('id,key,label,kind,store,cnpj_label,sort_order')
    .eq('active', true)
    .order('sort_order')
  if (error) throw error
  return (data ?? []) as FinanceAccountRow[]
}

export async function loadFinanceEntries(monthKey: string): Promise<FinanceEntryRow[]> {
  const { start, end } = monthRange(monthKey)
  const { data, error } = await supabase
    .from('finance_entries')
    .select('id,entry_type,category_id,account_id,store,competence_month,paid_date,planned_amount,amount,payment_method,description,source,source_ref,recurrence_month,reversal_of,reversal_reason,reversed_at,created_at')
    .gte('competence_month', start)
    .lt('competence_month', end)
    .order('paid_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as FinanceEntryRow[]
}

export async function loadFinanceRecurringRules(): Promise<FinanceRecurringRuleRow[]> {
  const { data, error } = await supabase
    .from('finance_recurring_rules')
    .select('id,name,category_id,store,planned_amount,due_day,start_month,end_month,default_account_id,default_payment_method,active')
    .order('name')
  if (error) throw error
  return (data ?? []) as FinanceRecurringRuleRow[]
}

export async function createFinanceRecurringRule(draft: FinanceRecurringRuleDraft): Promise<string> {
  const { data, error } = await supabase.rpc('create_finance_recurring_rule', {
    p_name: draft.name.trim(),
    p_category_key: draft.categoryKey,
    p_store: draft.store,
    p_planned_amount: parseMoneyInput(draft.plannedAmount),
    p_due_day: Number(draft.dueDay),
    p_start_month: `${draft.startMonth}-01`,
    p_end_month: draft.endMonth ? `${draft.endMonth}-01` : null,
    p_default_account_key: draft.defaultAccountKey,
    p_default_payment_method: draft.defaultPaymentMethod,
  })
  if (error) throw error
  return data as string
}

export async function endFinanceRecurringRule(ruleId: string, endMonthKey: string): Promise<void> {
  const { error } = await supabase.rpc('end_finance_recurring_rule', {
    p_rule_id: ruleId,
    p_end_month: `${endMonthKey}-01`,
  })
  if (error) throw error
}

export async function confirmFinanceRecurringRule(
  ruleId: string,
  monthKey: string,
  paidDate: string,
  amount: string,
  paymentMethod: FinancePaymentMethod,
  accountKey: string,
  requestId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('confirm_finance_recurring_rule', {
    p_request_id: requestId,
    p_rule_id: ruleId,
    p_competence_month: `${monthKey}-01`,
    p_paid_date: paidDate,
    p_amount: parseMoneyInput(amount),
    p_payment_method: paymentMethod,
    p_account_key: accountKey,
  })
  if (error) throw error
  return data as string
}

export async function createFinanceEntry(draft: FinanceEntryDraft, requestId: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_finance_entry', {
    p_request_id: requestId,
    p_category_key: draft.categoryKey,
    p_account_key: draft.accountKey,
    p_store: draft.store,
    p_amount: parseMoneyInput(draft.amount),
    p_paid_date: draft.paidDate,
    p_payment_method: draft.paymentMethod,
    p_description: draft.description.trim(),
    p_competence_month: competenceMonthOf(draft.paidDate),
  })
  if (error) throw error
  return data as string
}

export async function reverseFinanceEntry(entryId: string, reason: string, requestId: string): Promise<string> {
  const { data, error } = await supabase.rpc('reverse_finance_entry', {
    p_request_id: requestId,
    p_entry_id: entryId,
    p_reason: reason.trim(),
  })
  if (error) throw error
  return data as string
}
