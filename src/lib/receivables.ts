// src/lib/receivables.ts — contas a receber (fase 2).
//
// Regras de negócio em docs/CONTAS_A_RECEBER.md. Valor, vencimento, autoria e
// permissão são validados no banco; o que existe aqui é a validação de tela,
// para o recado chegar antes do envio, e a leitura da lista.

import { supabase } from '@/lib/supabase'
import { parseMoneyInput } from '@/lib/cashClosing'
import { todayKey } from '@/lib/utils'

export type ReceivableStatus = 'aberta' | 'recebida' | 'cancelada'
export type ReceivableOrigin = 'avulso' | 'pedido_pj' | 'romaneio_ex'
export type ReceivableMethod = 'dinheiro' | 'pix' | 'transferencia' | 'boleto' | 'cartao' | 'outro'

export const RECEIVABLE_METHOD_LABELS: Record<ReceivableMethod, string> = {
  pix: 'Pix',
  transferencia: 'Transferência',
  boleto: 'Boleto',
  dinheiro: 'Dinheiro',
  cartao: 'Cartão',
  outro: 'Outro',
}

export const RECEIVABLE_ORIGIN_LABELS: Record<ReceivableOrigin, string> = {
  avulso: 'Lançamento avulso',
  pedido_pj: 'Pedido PJ',
  romaneio_ex: 'Romaneio da Buck',
}

export interface ReceivableRow {
  id: string
  customer_id: string
  origin: ReceivableOrigin
  origin_ref: string | null
  description: string
  invoice_date: string
  original_due_date: string
  due_date: string
  amount: number
  status: ReceivableStatus
  received_date: string | null
  received_amount: number | null
  received_method: ReceivableMethod | null
  received_account_id: string | null
  cancel_reason: string | null
  created_at: string
  customer?: { name: string } | null
}

export interface ReceivableDraft {
  customerId: string
  invoiceDate: string
  amount: string
  description: string
}

export function emptyReceivableDraft(): ReceivableDraft {
  return { customerId: '', invoiceDate: todayKey(), amount: '', description: '' }
}

export interface ReceivablePaymentDraft {
  receivedDate: string
  receivedAmount: string
  receivedMethod: ReceivableMethod
  accountKey: string
}

/**
 * Padrões que permitem baixar em dois toques: hoje, o valor cobrado e Pix — a
 * forma mais comum na padaria. A conta continua sendo escolha consciente.
 */
export function defaultPaymentDraft(receivable: Pick<ReceivableRow, 'amount'>): ReceivablePaymentDraft {
  return {
    receivedDate: todayKey(),
    receivedAmount: receivable.amount.toFixed(2).replace('.', ','),
    receivedMethod: 'pix',
    accountKey: '',
  }
}

export const RECEIVABLE_MAX_AMOUNT = 1_000_000

export function getReceivableErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return fallback
}

/** Mesmos limites do banco: dinheiro validado na entrada E na saída. */
export function validateReceivableDraft(draft: ReceivableDraft, today = todayKey()): string | null {
  if (!draft.customerId) return 'Escolha o cliente que vai pagar.'

  const amount = parseMoneyInput(draft.amount)
  if (!(amount > 0)) return 'Informe um valor maior que zero.'
  if (amount > RECEIVABLE_MAX_AMOUNT) return 'Valor acima do limite permitido. Confira o que foi digitado.'

  if (!draft.invoiceDate) return 'Informe a data do faturamento.'
  if (draft.invoiceDate > today) return 'A data do faturamento não pode ser no futuro.'
  if (draft.invoiceDate < '2020-01-01') return 'Data do faturamento muito antiga. Confira o que foi digitado.'

  if (draft.description.trim().length < 3) return 'Descreva a cobrança com pelo menos 3 letras.'
  return null
}

export function validateReceivablePaymentDraft(
  draft: ReceivablePaymentDraft,
  receivable: Pick<ReceivableRow, 'invoice_date'>,
  today = todayKey(),
): string | null {
  if (!draft.receivedDate) return 'Informe a data em que o dinheiro entrou.'
  if (draft.receivedDate > today) return 'A data do recebimento não pode ser no futuro.'
  if (draft.receivedDate < receivable.invoice_date) return 'O recebimento não pode ser anterior ao faturamento.'

  const amount = parseMoneyInput(draft.receivedAmount)
  if (!(amount > 0)) return 'Informe o valor recebido.'
  if (amount > RECEIVABLE_MAX_AMOUNT) return 'Valor acima do limite permitido. Confira o que foi digitado.'

  if (!draft.accountKey) return 'Escolha a conta em que o dinheiro entrou.'
  return null
}

/** Dias de atraso; zero ou negativo significa que ainda não venceu. */
export function daysOverdue(receivable: Pick<ReceivableRow, 'due_date'>, today = todayKey()): number {
  const due = Date.parse(`${receivable.due_date}T00:00:00Z`)
  const now = Date.parse(`${today}T00:00:00Z`)
  return Math.round((now - due) / 86_400_000)
}

export function isOverdue(receivable: Pick<ReceivableRow, 'due_date' | 'status'>, today = todayKey()): boolean {
  return receivable.status === 'aberta' && receivable.due_date < today
}

export interface ReceivableTotals {
  atrasado: number
  aVencer: number
  recebidoNoPeriodo: number
}

/**
 * Os três números do topo da tela. Cobrança cancelada não entra em nenhum
 * deles — ela existe só como história.
 */
export function summarizeReceivables(
  rows: readonly ReceivableRow[],
  today = todayKey(),
): ReceivableTotals {
  let atrasado = 0
  let aVencer = 0
  let recebidoNoPeriodo = 0
  for (const row of rows) {
    if (row.status === 'aberta') {
      if (row.due_date < today) atrasado += row.amount
      else aVencer += row.amount
    } else if (row.status === 'recebida') {
      recebidoNoPeriodo += row.received_amount ?? 0
    }
  }
  return { atrasado, aVencer, recebidoNoPeriodo }
}

/**
 * Atrasadas primeiro, da mais antiga para a mais nova — é a ordem em que a
 * cobrança precisa ser feita. Depois as a vencer, e por último o que já foi
 * resolvido.
 */
export function sortReceivables(
  rows: readonly ReceivableRow[],
  today = todayKey(),
): ReceivableRow[] {
  const rank = (row: ReceivableRow): number => {
    if (row.status === 'aberta') return row.due_date < today ? 0 : 1
    return row.status === 'recebida' ? 2 : 3
  }
  return [...rows].sort((left, right) => {
    const byRank = rank(left) - rank(right)
    if (byRank !== 0) return byRank
    return left.due_date.localeCompare(right.due_date)
  })
}

export function formatReceivableMoney(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export interface ReceivableCustomerOption {
  id: string
  name: string
  paymentTermDays: number | null
}

export async function loadReceivableCustomers(): Promise<ReceivableCustomerOption[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('id,name,payment_term_days')
    .eq('active', true)
    .order('name')
  if (error) throw error
  return (data ?? []).map(row => ({
    id: row.id as string,
    name: row.name as string,
    paymentTermDays: (row.payment_term_days as number | null) ?? null,
  }))
}

export async function loadReceivables(): Promise<ReceivableRow[]> {
  const { data, error } = await supabase
    .from('receivables')
    .select('id,customer_id,origin,origin_ref,description,invoice_date,original_due_date,due_date,amount,status,received_date,received_amount,received_method,received_account_id,cancel_reason,created_at,customer:customers(name)')
    .order('due_date')
  if (error) throw error
  return (data ?? []).map(row => ({
    ...row,
    // O PostgREST devolve o relacionamento como lista quando não consegue
    // provar que é um-para-um; a tela precisa de um objeto só.
    customer: Array.isArray(row.customer) ? (row.customer[0] ?? null) : row.customer,
  })) as ReceivableRow[]
}

export async function createManualReceivable(draft: ReceivableDraft, requestId: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_manual_receivable', {
    p_request_id: requestId,
    p_customer_id: draft.customerId,
    p_invoice_date: draft.invoiceDate,
    p_amount: parseMoneyInput(draft.amount),
    p_description: draft.description.trim(),
  })
  if (error) throw error
  return data as string
}

export async function recordReceivablePayment(
  receivableId: string,
  draft: ReceivablePaymentDraft,
  requestId: string,
): Promise<void> {
  const { error } = await supabase.rpc('record_receivable_payment', {
    p_request_id: requestId,
    p_receivable_id: receivableId,
    p_received_date: draft.receivedDate,
    p_received_amount: parseMoneyInput(draft.receivedAmount),
    p_received_method: draft.receivedMethod,
    p_account_key: draft.accountKey,
  })
  if (error) throw error
}

export async function reverseReceivablePayment(
  receivableId: string,
  reason: string,
  requestId: string,
): Promise<void> {
  const { error } = await supabase.rpc('reverse_receivable_payment', {
    p_request_id: requestId,
    p_receivable_id: receivableId,
    p_reason: reason.trim(),
  })
  if (error) throw error
}

export async function cancelReceivable(
  receivableId: string,
  reason: string,
  requestId: string,
): Promise<void> {
  const { error } = await supabase.rpc('cancel_receivable', {
    p_request_id: requestId,
    p_receivable_id: receivableId,
    p_reason: reason.trim(),
  })
  if (error) throw error
}

export async function correctReceivableDueDate(
  receivableId: string,
  dueDate: string,
  reason: string,
  requestId: string,
): Promise<void> {
  const { error } = await supabase.rpc('correct_receivable_due_date', {
    p_request_id: requestId,
    p_receivable_id: receivableId,
    p_due_date: dueDate,
    p_reason: reason.trim(),
  })
  if (error) throw error
}
