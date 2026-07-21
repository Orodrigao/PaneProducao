import type { Role } from '@/lib/auth'

export type CancellableOrderType = 'pj' | 'encomenda'

export interface CancellationSchedule {
  productionDate: string | null
  deliveryDate: string | null
  needsProduction?: boolean
}

export interface CancellationAvailability {
  allowed: boolean
  cutoffDate: string | null
  message: string | null
}

export interface CancellationSnapshot {
  cancelled_at: string
  cancelled_by: string | null
  cancel_reason: string | null
}

export type CancelOrderRowsResult =
  | { ok: true; cancellation: CancellationSnapshot }
  | { ok: false; message: string }

const MAX_REASON_LENGTH = 160

function formatDateBR(date: string): string {
  const [year, month, day] = date.split('-')
  return `${day}/${month}/${year}`
}

export function cancellationReferenceDate(
  orderType: CancellableOrderType,
  schedule: CancellationSchedule,
): string | null {
  if (orderType === 'encomenda' && !schedule.needsProduction) {
    return schedule.deliveryDate
  }

  return schedule.productionDate || schedule.deliveryDate
}

export function cancellationAvailability(
  orderType: CancellableOrderType,
  schedule: CancellationSchedule,
  now = new Date(),
): CancellationAvailability {
  const referenceDate = cancellationReferenceDate(orderType, schedule)
  if (!referenceDate) {
    return {
      allowed: false,
      cutoffDate: null,
      message: 'Pedido sem data de produção ou entrega. Fale com o Rodrigo.',
    }
  }

  const cutoff = new Date(`${referenceDate}T05:00:00`)
  if (Number.isNaN(cutoff.getTime())) {
    return {
      allowed: false,
      cutoffDate: referenceDate,
      message: 'Data do pedido inválida. Fale com o Rodrigo.',
    }
  }

  if (now.getTime() < cutoff.getTime()) {
    return { allowed: true, cutoffDate: referenceDate, message: null }
  }

  return {
    allowed: false,
    cutoffDate: referenceDate,
    message: `Produção deste pedido já iniciou. Cancelamento encerrou às 5h de ${formatDateBR(referenceDate)}. Fale com o Rodrigo.`,
  }
}

export function canCancelOrder(role: Role | null | undefined, orderType: CancellableOrderType): boolean {
  if (role === 'admin' || role === 'financeiro') return true
  return role === 'vendas' && orderType === 'encomenda'
}

export function normalizeCancellationReason(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_REASON_LENGTH)
}

export function allOrderRowsCancelled(
  rows: Array<{ id: string; cancelled_at: string | null }>,
  expectedIds: string[],
): boolean {
  if (rows.length !== expectedIds.length) return false
  const expected = new Set(expectedIds)
  return rows.every(row => expected.has(row.id) && Boolean(row.cancelled_at))
}

export function formatCancellationTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}
