'use client'

import { formatCompetenceMonth } from '@/lib/finance'
import { todayKey } from '@/lib/utils'
import {
  daysOverdue,
  receivedTotal,
  remainingAmount,
  RECEIVABLE_STATUS_LABELS,
  formatReceivableMoney,
  isOverdue,
  RECEIVABLE_METHOD_LABELS,
  RECEIVABLE_ORIGIN_LABELS,
  type ReceivableReceiptRow,
  type ReceivableRow,
} from '@/lib/receivables'

interface ReceivableListProps {
  receivables: ReceivableRow[]
  busyId: string | null
  onPay: (receivable: ReceivableRow) => void
  onReverseReceipt: (receipt: ReceivableReceiptRow) => void
  onCancel: (receivable: ReceivableRow) => void
  onCorrectDueDate: (receivable: ReceivableRow) => void
  onSplit: (receivable: ReceivableRow) => void
}

function formatDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-')
  return `${day}/${month}/${year}`
}

function statusLabel(receivable: ReceivableRow): string {
  if (receivable.status === 'cancelada') return RECEIVABLE_STATUS_LABELS.cancelada
  if (receivable.status === 'recebida') return RECEIVABLE_STATUS_LABELS.recebida
  const atraso = daysOverdue(receivable)
  if (atraso > 0) return `Atrasada ${atraso} dia${atraso > 1 ? 's' : ''}`
  if (atraso === 0) return 'Vence hoje'
  return `Vence em ${formatDate(receivable.due_date)}`
}

export default function ReceivableList({
  receivables, busyId, onPay, onReverseReceipt, onCancel, onCorrectDueDate, onSplit,
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
              {receivable.installment_count > 1 && (
                <>
                  <span>·</span>
                  <span>parcela {receivable.installment_number}/{receivable.installment_count}</span>
                </>
              )}
              {/* O mês em que a venda pesa no resultado só é evidente quando é
                  diferente do mês corrente — que é justamente o caso de todo
                  cliente que paga atrasado. */}
              {receivable.invoice_date.slice(0, 7) !== todayKey().slice(0, 7) && (
                <>
                  <span>·</span>
                  <span>pesa em {formatCompetenceMonth(receivable.invoice_date.slice(0, 7))}</span>
                </>
              )}
            </div>

            {receivable.status === 'parcial' && (
              <div className="ps-meta" style={{ marginTop: 6 }}>
                <b>
                  Recebido {formatReceivableMoney(receivedTotal(receivable))} ·
                  faltam {formatReceivableMoney(remainingAmount(receivable))}
                </b>
              </div>
            )}

            {/* Cada pedaco aparece com sua data, forma e valor: e assim que a
                Elis confere o Pix de terca contra o dinheiro de quinta. */}
            {(receivable.receipts ?? []).filter(receipt => receipt.reversed_at === null).map(receipt => (
              <div key={receipt.id} className="ps-meta" style={{ marginTop: 4 }}>
                <span>
                  {formatDate(receipt.received_date)} · {RECEIVABLE_METHOD_LABELS[receipt.method]} ·{' '}
                  {formatReceivableMoney(receipt.amount)}
                </span>
                <button
                  className="ps-link"
                  onClick={() => onReverseReceipt(receipt)}
                  disabled={ocupada}
                >
                  estornar
                </button>
              </div>
            ))}

            {receivable.status === 'cancelada' && receivable.cancel_reason && (
              <div className="ps-meta" style={{ marginTop: 6 }}>
                <span>Motivo: {receivable.cancel_reason}</span>
              </div>
            )}

            {(receivable.status === 'aberta' || receivable.status === 'parcial') && (
              <div className="ps-fieldrow" style={{ marginTop: 12 }}>
                <button className="ps-btn primary sm" onClick={() => onPay(receivable)} disabled={ocupada}>
                  {receivable.status === 'parcial' ? 'Registrar mais um recebimento' : 'Registrar recebimento'}
                </button>
                <button className="ps-btn ghost sm" onClick={() => onCorrectDueDate(receivable)} disabled={ocupada}>
                  Corrigir vencimento
                </button>
                {/* So a cobranca inteira e sem dinheiro dentro pode ser
                    dividida: e o caso da que nasceu sozinha e saiu alta. */}
                {receivable.installment_count === 1 && receivedTotal(receivable) === 0 && (
                  <button className="ps-btn ghost sm" onClick={() => onSplit(receivable)} disabled={ocupada}>
                    Dividir em parcelas
                  </button>
                )}
                {receivedTotal(receivable) === 0 && (
                  <button className="ps-btn ghost sm" onClick={() => onCancel(receivable)} disabled={ocupada}>
                    Cancelar
                  </button>
                )}
              </div>
            )}


          </article>
        )
      })}
    </div>
  )
}
