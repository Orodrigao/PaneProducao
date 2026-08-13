'use client'

import {
  daysOverdue,
  formatReceivableMoney,
  isOverdue,
  RECEIVABLE_METHOD_LABELS,
  RECEIVABLE_ORIGIN_LABELS,
  type ReceivableRow,
} from '@/lib/receivables'

interface ReceivableListProps {
  receivables: ReceivableRow[]
  busyId: string | null
  onPay: (receivable: ReceivableRow) => void
  onReverse: (receivable: ReceivableRow) => void
  onCancel: (receivable: ReceivableRow) => void
  onCorrectDueDate: (receivable: ReceivableRow) => void
}

function formatDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-')
  return `${day}/${month}/${year}`
}

function statusLabel(receivable: ReceivableRow): string {
  if (receivable.status === 'cancelada') return 'Cancelada'
  if (receivable.status === 'recebida') return 'Recebida'
  const atraso = daysOverdue(receivable)
  if (atraso > 0) return `Atrasada ${atraso} dia${atraso > 1 ? 's' : ''}`
  if (atraso === 0) return 'Vence hoje'
  return `Vence em ${formatDate(receivable.due_date)}`
}

export default function ReceivableList({
  receivables, busyId, onPay, onReverse, onCancel, onCorrectDueDate,
}: ReceivableListProps) {
  if (receivables.length === 0) {
    return <div className="ps-empty">Nenhuma cobrança lançada ainda.</div>
  }

  return (
    <div className="ps-list">
      {receivables.map(receivable => {
        const atrasada = isOverdue(receivable)
        const ocupada = busyId === receivable.id
        return (
          <article
            key={receivable.id}
            className="ps-card"
            style={{
              marginTop: 10,
              borderColor: atrasada ? 'var(--berry)' : undefined,
              opacity: receivable.status === 'cancelada' ? 0.65 : 1,
            }}
          >
            <div className="ps-card-head">
              <div>
                <b>{receivable.customer?.name ?? 'Cliente'}</b>
                <small>{receivable.description}</small>
              </div>
              <b>{formatReceivableMoney(receivable.amount)}</b>
            </div>

            <div className="ps-meta" style={{ marginTop: 8 }}>
              <span>{statusLabel(receivable)}</span>
              <span>·</span>
              <span>Faturado em {formatDate(receivable.invoice_date)}</span>
              <span>·</span>
              <span>{RECEIVABLE_ORIGIN_LABELS[receivable.origin]}</span>
            </div>

            {receivable.status === 'recebida' && receivable.received_date && (
              <div className="ps-meta" style={{ marginTop: 6 }}>
                <span>
                  Recebido {formatReceivableMoney(receivable.received_amount ?? 0)} em{' '}
                  {formatDate(receivable.received_date)}
                  {receivable.received_method ? ` · ${RECEIVABLE_METHOD_LABELS[receivable.received_method]}` : ''}
                </span>
              </div>
            )}

            {receivable.status === 'cancelada' && receivable.cancel_reason && (
              <div className="ps-meta" style={{ marginTop: 6 }}>
                <span>Motivo: {receivable.cancel_reason}</span>
              </div>
            )}

            {receivable.status === 'aberta' && (
              <div className="ps-fieldrow" style={{ marginTop: 12 }}>
                <button className="ps-btn primary sm" onClick={() => onPay(receivable)} disabled={ocupada}>
                  Registrar recebimento
                </button>
                <button className="ps-btn ghost sm" onClick={() => onCorrectDueDate(receivable)} disabled={ocupada}>
                  Corrigir vencimento
                </button>
                <button className="ps-btn ghost sm" onClick={() => onCancel(receivable)} disabled={ocupada}>
                  Cancelar
                </button>
              </div>
            )}

            {receivable.status === 'recebida' && (
              <div className="ps-fieldrow" style={{ marginTop: 12 }}>
                <button className="ps-btn ghost sm" onClick={() => onReverse(receivable)} disabled={ocupada}>
                  Estornar recebimento
                </button>
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}
