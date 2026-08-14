'use client'

import { useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import {
  createManualReceivable,
  emptyReceivableDraft,
  getReceivableErrorMessage,
  validateReceivableDraft,
  type ReceivableCustomerOption,
  type ReceivableDraft,
} from '@/lib/receivables'
import { showToast, todayKey } from '@/lib/utils'

interface ReceivableFormProps {
  customers: ReceivableCustomerOption[]
  onCancel: () => void
  onSaved: () => Promise<void> | void
}

/**
 * Os vencimentos não são digitados: saem do plano combinado com o cliente.
 * Plano de três prazos gera três cobranças, uma por vencimento.
 */
function previewDueDates(invoiceDate: string, terms: number[] | null): string[] {
  if (!invoiceDate || !terms || terms.length === 0) return []
  return terms.map(dias => {
    const base = new Date(`${invoiceDate}T00:00:00Z`)
    base.setUTCDate(base.getUTCDate() + dias)
    return base.toISOString().slice(0, 10)
  })
}

function formatDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-')
  return `${day}/${month}/${year}`
}

export default function ReceivableForm({ customers, onCancel, onSaved }: ReceivableFormProps) {
  const [draft, setDraft] = useState<ReceivableDraft>(emptyReceivableDraft())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // O mesmo identificador em toda tentativa deste formulário: toque duplo ou
  // reenvio devolve a cobrança já criada, nunca uma segunda.
  const requestIdRef = useRef<string>(crypto.randomUUID())

  function update(patch: Partial<ReceivableDraft>) {
    setDraft(current => ({ ...current, ...patch }))
    setError(null)
  }

  const selectedCustomer = useMemo(
    () => customers.find(customer => customer.id === draft.customerId) ?? null,
    [customers, draft.customerId],
  )

  const dueDates = previewDueDates(draft.invoiceDate, selectedCustomer?.paymentTerms ?? null)
  const semPrazo = selectedCustomer !== null
    && (selectedCustomer.paymentTerms === null || selectedCustomer.paymentTerms.length === 0)

  async function save() {
    const validationError = validateReceivableDraft(draft, todayKey())
    if (validationError) {
      setError(validationError)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await createManualReceivable(draft, requestIdRef.current)
      showToast('Cobrança lançada.')
      await onSaved()
    } catch (saveError) {
      console.error(saveError)
      setError(getReceivableErrorMessage(saveError, 'Não foi possível lançar a cobrança.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="ps-card" style={{ marginTop: 14 }}>
      <div className="ps-card-head">
        <div>
          <b>Nova cobrança</b>
          <small>
            {dueDates.length === 0
              ? 'O vencimento vem do prazo do cliente'
              : dueDates.length === 1
                ? `Vence em ${formatDate(dueDates[0])}`
                : `${dueDates.length} parcelas, vencendo em ${dueDates.map(formatDate).join(', ')}`}
          </small>
        </div>
        <button type="button" className="ps-iconbtn" onClick={onCancel} aria-label="Fechar cobrança"><X size={16} /></button>
      </div>

      {error && <div className="ps-alert error" role="alert" style={{ marginTop: 12 }}>{error}</div>}

      <div className="ps-fieldgroup" style={{ marginTop: 14 }}>
        <label className="ps-fieldlabel" htmlFor="receivable-customer">Cliente *</label>
        <select
          id="receivable-customer"
          className="ps-select"
          value={draft.customerId}
          onChange={event => update({ customerId: event.target.value })}
        >
          <option value="">Escolha o cliente</option>
          {customers.map(customer => (
            <option key={customer.id} value={customer.id}>{customer.name}</option>
          ))}
        </select>
      </div>

      {semPrazo && (
        <div className="ps-alert error" role="alert" style={{ marginTop: 10 }}>
          Este cliente ainda não tem prazo de pagamento cadastrado. Defina o prazo na tela de Clientes antes de cobrar.
        </div>
      )}

      <div className="ps-fieldgroup" style={{ marginTop: 12 }}>
        <label className="ps-fieldlabel" htmlFor="receivable-invoice-date">Data do faturamento *</label>
        <input
          id="receivable-invoice-date"
          className="ps-input"
          type="date"
          max={todayKey()}
          value={draft.invoiceDate}
          onChange={event => update({ invoiceDate: event.target.value })}
        />
        <small className="ps-hint">O dia em que a mercadoria saiu. É esta data que decide em que mês a venda pesa no resultado.</small>
      </div>

      <div className="ps-fieldgroup" style={{ marginTop: 12 }}>
        <label className="ps-fieldlabel" htmlFor="receivable-amount">Valor *</label>
        <input
          id="receivable-amount"
          className="ps-input"
          inputMode="decimal"
          placeholder="0,00"
          value={draft.amount}
          onChange={event => update({ amount: event.target.value })}
        />
      </div>

      <div className="ps-fieldgroup" style={{ marginTop: 12 }}>
        <label className="ps-fieldlabel" htmlFor="receivable-description">Descrição *</label>
        <input
          id="receivable-description"
          className="ps-input"
          placeholder="Ex.: pães da semana de 20 a 26/07"
          value={draft.description}
          onChange={event => update({ description: event.target.value })}
        />
      </div>

      <div className="ps-fieldrow" style={{ marginTop: 16 }}>
        <button className="ps-btn primary block" onClick={() => void save()} disabled={saving || semPrazo}>
          {saving ? 'Lançando...' : 'Lançar cobrança'}
        </button>
        <button className="ps-btn ghost block" onClick={onCancel} disabled={saving}>Cancelar</button>
      </div>
    </section>
  )
}
