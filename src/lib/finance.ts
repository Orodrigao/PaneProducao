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

export interface FinanceEntryRow {
  id: string
  entry_type: FinanceEntryType
  category_id: string
  account_id: string
  store: FinanceStore
  competence_month: string
  paid_date: string
  amount: number
  payment_method: FinancePaymentMethod
  description: string
  reversal_of: string | null
  reversal_reason: string | null
  reversed_at: string | null
  created_at: string
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
    .select('id,entry_type,category_id,account_id,store,competence_month,paid_date,amount,payment_method,description,reversal_of,reversal_reason,reversed_at,created_at')
    .gte('competence_month', start)
    .lt('competence_month', end)
    .order('paid_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as FinanceEntryRow[]
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
