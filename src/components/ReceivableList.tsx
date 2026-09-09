'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { formatCompetenceMonth } from '@/lib/finance'
import { todayKey } from '@/lib/utils'
import {
  daysOverdue,
  filterReceivables,
  receivedTotal,
  remainingAmount,
  RECEIVABLE_STATUS_LABELS,
  formatReceivableMoney,
  isOverdue,
  RECEIVABLE_METHOD_LABELS,
  RECEIVABLE_ORIGIN_LABELS,
  type ReceivableReceiptRow,
  type ReceivableInvoicePeriodFilter,
  type ReceivableRow,
  type ReceivableSituationFilter,
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
  const [search, setSearch] = useState('')
  const [situation, setSituation] = useState<ReceivableSituationFilter>('todas')
  const [invoicePeriod, setInvoicePeriod] = useState<ReceivableInvoicePeriodFilter>('todas')
  const filteredReceivables = useMemo(() => filterReceivables(receivables, {
    search, situation, invoicePeriod,
  }), [invoicePeriod, receivables, search, situation])
  const hasFilters = Boolean(search.trim()) || situation !== 'todas' || invoicePeriod !== 'todas'

  if (receivables.length === 0) {
    return <div className="ps-empty">Nenhuma cobrança lançada ainda.</div>
  }

  return (
    <>
      <div className="ps-card" style={{ marginTop: 10, padding: 10 }}>
        <div style={{ position: 'relative' }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-faint)', pointerEvents: 'none' }} />
          <input
            id="receivables-search"
            className="ps-input"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Buscar cliente, pedido ou descrição"
            aria-label="Buscar contas a receber"
            style={{ width: '100%', paddingLeft: 32 }}
          />
        </div>

        <div className="ps-fieldrow" style={{ marginTop: 8, alignItems: 'end' }}>
          <div className="ps-fieldgroup" style={{ flex: '1 1 180px' }}>
            <label className="ps-fieldlabel" htmlFor="receivables-situation-filter">Situação</label>
            <select
              id="receivables-situation-filter"
              className="ps-select"
              value={situation}
              onChange={event => setSituation(event.target.value as ReceivableSituationFilter)}
            >
              <option value="todas">Todas</option>
              <option value="em_aberto">Em aberto</option>
              <option value="atrasadas">Atrasadas</option>
              <option value="vence_hoje">Vence hoje</option>
              <option value="a_vencer">A vencer</option>
              <option value="recebidas">Recebidas</option>
              <option value="canceladas">Canceladas</option>
            </select>
          </div>

          <div className="ps-fieldgroup" style={{ flex: '1 1 180px' }}>
            <label className="ps-fieldlabel" htmlFor="receivables-invoice-period-filter">Faturamento</label>
            <select
              id="receivables-invoice-period-filter"
              className="ps-select"
              value={invoicePeriod}
              onChange={event => setInvoicePeriod(event.target.value as ReceivableInvoicePeriodFilter)}
            >
              <option value="todas">Qualquer data</option>
              <option value="hoje">Hoje</option>
              <option value="ultimos_7_dias">Últimos 7 dias</option>
              <option value="este_mes">Este mês</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
          <small aria-live="polite" style={{ color: 'var(--ink-soft)' }}>
            {filteredReceivables.length} de {receivables.length} cobrança(s)
          </small>
          {hasFilters && (
            <button
              type="button"
              className="ps-btn ghost sm"
              style={{ marginLeft: 'auto', minHeight: 36 }}
              onClick={() => { setSearch(''); setSituation('todas'); setInvoicePeriod('todas') }}
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {filteredReceivables.length === 0 ? (
        <div className="ps-empty" style={{ marginTop: 12 }}>Nenhuma cobrança encontrada com esses filtros.</div>
      ) : (
        <div className="ps-list">
          {filteredReceivables.map(receivable => {
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
      )}
    </>
  )
}
