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
  history: { action: PjFlowAction; at: string; actor: string; version: number }[]
}
export type PjFlowAction = 'save' | 'check' | 'release' | 'depart'
export interface PjFlowInput { id: string; quantity: number | null; reason: string | null }

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
  requestId: string, items: PjFlowInput[], nfConfirmed: boolean): Promise<void> {
  const { error } = await supabase.rpc('transition_pj_flow_pilot', {
    p_request_id: requestId, p_order_group_id: flow.id, p_expected_version: flow.version,
    p_action: action, p_items: items, p_nf_confirmed: nfConfirmed,
    p_review_term_days: action === 'release' ? flow.payment_term_days : null,
  })
  if (error) throw new Error(error.message)
}
