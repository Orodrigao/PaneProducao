import { supabase } from './supabase'
import type { PjFlowBill, PjFinancialEvent } from './pjFlowFinance'

export interface PjFlowItem {
  id: string; name: string; ordered: number; quantity: number | null
  unit: string; reason: string | null; price?: number | null
}
export interface PjFlow {
  id: string; version: number; customer: string; delivery_date: string
  checked_at: string | null; released_at: string | null; departed_at: string | null
  can_check: boolean; can_release: boolean; items: PjFlowItem[]
  approved_amount?: number | null; due_date?: string | null; payment_term_days?: number | null
  agreed_date?: string | null; can_correct_due?: boolean; can_split?: boolean
  bills?: PjFlowBill[]; financial_history?: PjFinancialEvent[]
  current_gross_amount?: number | null; net_amount?: number | null; received_total?: number
  pending_excess?: number; credit_applied_amount?: number; credit_source_group_id?: string | null
  credit_reason?: string | null; can_resolve_excess?: boolean; excess_resolution_supported?: boolean
  refund_accounts?: { key: string; label: string }[]
  credit_sources?: { id: string; delivery_date: string; amount: number; reason: string }[]
  excess_resolution?: { id: string; kind: 'refund_pix' | 'credit'; amount: number; reason: string
    refund_date: string | null; account: string | null; at: string; actor: string } | null
  history: { action: PjFlowAction; at: string; actor: string; version: number }[]
}
export type PjFlowAction = 'save' | 'check' | 'release' | 'depart'
export interface PjFlowInput { id: string; quantity: number | null; reason: string | null }
export interface PjFlowCreditInput { amount: number; sourceGroupId: string | null; reason: string }
export interface PjFlowEnrollmentGate { can_enroll: boolean; slot_available: boolean }
export interface PjFlowActivationStatus { mode: 'test' | 'controlled_real' | null; can_return: boolean }

export function parsePjFlowQuantity(value: string): number | null {
  if (!value.trim()) return null
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,3})?$/.test(normalized)) throw new Error('Use uma quantidade positiva ou zero, com até três casas decimais.')
  const quantity = Number(normalized)
  if (!Number.isFinite(quantity)) throw new Error('Quantidade inválida.')
  return quantity
}

export function pjFlowStatus(flow: Pick<PjFlow, 'departed_at' | 'released_at' | 'checked_at'>): string {
  if (flow.departed_at) return 'Saída física registrada'
  if (flow.released_at) return 'Liberado · Expedição JC pode registrar a saída'
  if (flow.checked_at) return 'Elis ou Rodrigo: revisar cobrança e confirmar NF · saída bloqueada'
  return 'Expedição JC: conferir quantidades · saída bloqueada'
}

export async function readPjFlowPilot(): Promise<PjFlow[]> {
  const { data, error } = await supabase.rpc('read_pj_flow_pilot')
  if (error) throw new Error(`Piloto indisponível: ${error.message}. Nenhuma ação do fluxo antigo será usada.`)
  return validatePjFlows(data)
}

// Descoberta da entrada: somente contrato ausente ou perfil fora da nova
// jornada deixam a rotina anterior disponível. Falha inesperada não escolhe fluxo.
export async function discoverPjFlowPilot(): Promise<PjFlow[]> {
  const { data, error } = await supabase.rpc('read_pj_flow_pilot')
  if (error?.code === 'PGRST202' || error?.code === '42501') return []
  if (error) throw new Error('Não foi possível identificar a jornada dos pedidos. Recarregue para tentar novamente.')
  return validatePjFlows(data)
}

function validatePjFlows(data: unknown): PjFlow[] {
  if (!Array.isArray(data) || data.some(row => !row || typeof row.id !== 'string'
    || !Number.isInteger(row.version) || !Array.isArray(row.items) || !Array.isArray(row.history))) {
    throw new Error('Resposta incompleta do piloto. Recarregue antes de agir.')
  }
  return data as PjFlow[]
}

export async function transitionPjFlowPilot(flow: PjFlow, action: PjFlowAction,
  requestId: string, items: PjFlowInput[], nfConfirmed: boolean,
  credit: PjFlowCreditInput = { amount: 0, sourceGroupId: null, reason: '' }): Promise<void> {
  const { error } = await supabase.rpc('transition_pj_flow_pilot', {
    p_request_id: requestId, p_order_group_id: flow.id, p_expected_version: flow.version,
    p_action: action, p_items: items, p_nf_confirmed: nfConfirmed,
    p_review_term_days: action === 'release' ? flow.payment_term_days : null,
    p_credit_amount: action === 'release' ? credit.amount : 0,
    p_credit_source_group_id: action === 'release' ? credit.sourceGroupId : null,
    p_credit_reason: action === 'release' && credit.amount > 0 ? credit.reason : null,
  })
  if (error) throw new Error(error.message)
}

export async function readPjFlowEnrollmentGate(): Promise<PjFlowEnrollmentGate> {
  const { data, error } = await supabase.rpc('read_pj_flow_enrollment_gate')
  if (error) throw new Error(error.message)
  if (!data || typeof data.can_enroll !== 'boolean' || typeof data.slot_available !== 'boolean') {
    throw new Error('Não foi possível confirmar se a nova jornada pode ser iniciada.')
  }
  return data as PjFlowEnrollmentGate
}

export async function enrollPjFlow(orderGroupId: string, requestId: string): Promise<void> {
  const { error } = await supabase.rpc('enroll_pj_flow', {
    p_request_id: requestId,
    p_order_group_id: orderGroupId,
  })
  if (error) throw new Error(error.message)
}

export async function readPjFlowActivationStatus(orderGroupId: string): Promise<PjFlowActivationStatus> {
  const { data, error } = await supabase.rpc('read_pj_flow_activation_status', {
    p_order_group_id: orderGroupId,
  })
  if (error) throw new Error(error.message)
  if (!data || !['test', 'controlled_real', null].includes(data.mode)
    || typeof data.can_return !== 'boolean') {
    throw new Error('Não foi possível confirmar o estado de ativação deste pedido.')
  }
  return data as PjFlowActivationStatus
}

export async function rollbackPjFlowEnrollment(orderGroupId: string, requestId: string,
  reason: string): Promise<void> {
  const { error } = await supabase.rpc('rollback_pj_flow_enrollment', {
    p_request_id: requestId,
    p_order_group_id: orderGroupId,
    p_reason: reason,
  })
  if (error) throw new Error(error.message)
}
