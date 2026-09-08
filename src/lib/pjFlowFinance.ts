import { supabase } from './supabase'
import type { PjFlow } from './pjFlowPilot'

export interface PjFlowBill {
  id: string; number: number; count: number; amount: number; received: number
  due_date: string; original_due_date: string; invoice_date: string; status: string
}
export interface PjTermsInput {
  action: 'due' | 'split'; billId: string; dueDate: string | null; installments: number | null; reason: string
}
export interface PjFinancialEvent {
  action: 'due' | 'split'; at: string; actor: string; reason: string
  before: Pick<PjFlowBill, 'id' | 'number' | 'count' | 'amount' | 'due_date' | 'original_due_date'>[]
  after: PjFinancialEvent['before']
}
export interface PjExcessInput {
  kind: 'refund_pix' | 'credit'; reason: string; refundDate: string | null; accountKey: string | null
}
function day(value: string): number {
  const result = Date.parse(`${value}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(result)
    || new Date(result).toISOString().slice(0, 10) !== value) throw new Error('Informe uma data válida.')
  return result / 86400000
}
export function previewPjInstallments(amount: number, agreedDate: string, dueDate: string, count: number) {
  const start = day(agreedDate), days = day(dueDate) - start, cents = Math.round(amount * 100)
  if (!Number.isInteger(count) || count < 2 || count > 12 || days < count || !Number.isFinite(cents) || cents < count) {
    throw new Error('O prazo ou o valor não comporta essa quantidade de parcelas.')
  }
  const base = Math.floor(cents / count)
  return Array.from({ length: count }, (_, i) => ({ number: i + 1,
    amount: (base + (i === 0 ? cents - base * count : 0)) / 100,
    due_date: new Date((start + Math.round(days * (i + 1) / count)) * 86400000).toISOString().slice(0, 10),
  }))
}
export function validatePjDueDate(bill: PjFlowBill, dueDate: string): void {
  const next = day(dueDate)
  if (next < day(bill.original_due_date) || next > day(bill.invoice_date) + 365) {
    throw new Error('Use uma data a partir do vencimento original e até um ano do faturamento.')
  }
  if (dueDate === bill.due_date) throw new Error('Informe uma data diferente do vencimento atual.')
}
export async function changePjFlowTerms(flow: Pick<PjFlow, 'id' | 'version'>, requestId: string, input: PjTermsInput): Promise<void> {
  const { error } = await supabase.rpc('change_pj_flow_terms', {
    p_request_id: requestId, p_order_group_id: flow.id, p_expected_version: flow.version,
    p_action: input.action, p_receivable_id: input.billId, p_due_date: input.dueDate,
    p_installments: input.installments, p_reason: input.reason,
  })
  if (error) throw new Error(error.message)
}

export async function resolvePjFlowExcess(flow: Pick<PjFlow, 'id' | 'version'>,
  requestId: string, input: PjExcessInput): Promise<void> {
  const { error } = await supabase.rpc('resolve_pj_flow_excess', {
    p_request_id: requestId, p_order_group_id: flow.id, p_expected_version: flow.version,
    p_kind: input.kind, p_reason: input.reason, p_refund_date: input.refundDate,
    p_account_key: input.accountKey,
  })
  if (error) throw new Error(error.message)
}
