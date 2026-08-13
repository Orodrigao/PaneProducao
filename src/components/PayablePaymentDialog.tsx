'use client'

import { useMemo, useState } from 'react'
import { Save, X } from 'lucide-react'
import { showToast, todayKey } from '@/lib/utils'
import PayableCategoryPicker from '@/components/PayableCategoryPicker'
import {
  actualPaymentMethodLabel,
  correctPayablePaymentAndClassification,
  formatBRL,
  recordPayableInstallmentPayment,
  roundMoney,
  setPayableFinanceClassification,
  validateCategorySlices,
  type PayableActualPaymentMethod,
  type PayableCategorySlice,
  type PayableInstallmentPaymentDetails,
  type PayableInstallmentRow,
} from '@/lib/payables'
import type { FinanceAccountRow, FinanceCategoryRow } from '@/lib/finance'

interface PayablePaymentDialogProps {
  installment: PayableInstallmentRow
  purchaseId: string
  purchaseDate: string
  purchaseTotal: number
  supplierName: string
  mode: 'baixar' | 'corrigir'
  financeCategories: readonly FinanceCategoryRow[]
  financeAccounts: readonly FinanceAccountRow[]
  initialSlices: PayableCategorySlice[]
  initialAccountKey: string
  onClose: () => void
  onSaved: () => Promise<void> | void
}

function defaultMethod(installment: PayableInstallmentRow): PayableActualPaymentMethod {
  return installment.paid_method ?? 'boleto'
}

export default function PayablePaymentDialog({
  installment,
  purchaseId,
  purchaseDate,
  purchaseTotal,
  supplierName,
  mode,
  financeCategories,
  financeAccounts,
  initialSlices,
  initialAccountKey,
  onClose,
  onSaved,
}: PayablePaymentDialogProps) {
  const originalAmount = Number(installment.amount)
  const [paidDate, setPaidDate] = useState(installment.paid_date ?? todayKey())
  const [paidAmount, setPaidAmount] = useState(String(installment.paid_amount ?? originalAmount.toFixed(2)))
  const [paidMethod, setPaidMethod] = useState<PayableActualPaymentMethod>(defaultMethod(installment))
  const [currentDueDate, setCurrentDueDate] = useState(installment.current_due_date ?? '')
  const [slices, setSlices] = useState<PayableCategorySlice[]>(
    initialSlices.length > 0 ? initialSlices : [{ categoryKey: '', amount: purchaseTotal.toFixed(2) }],
  )
  const [accountKey, setAccountKey] = useState(initialAccountKey)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const difference = useMemo(() => roundMoney(Math.max(0, Number(paidAmount) - originalAmount)), [paidAmount, originalAmount])
  const title = mode === 'baixar' ? 'Baixar boleto' : 'Corrigir baixa'

  function validate(): string | null {
    const numericAmount = Number(paidAmount)
    if (paidMethod === 'cartao' && !accountKey) return 'Escolha o cartao usado.'
    if (!paidDate) return 'Informe a data real do pagamento.'
    if (paidDate < purchaseDate || paidDate > todayKey()) return 'A data do pagamento precisa estar entre a compra e hoje.'
    if (!Number.isFinite(numericAmount) || numericAmount < originalAmount) return 'O valor pago não pode ser menor que o valor original.'
    if (currentDueDate && currentDueDate < installment.due_date) return 'O vencimento atualizado não pode ser anterior ao vencimento original.'
    return validateCategorySlices(slices, purchaseTotal)
  }

  async function save() {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    const details: PayableInstallmentPaymentDetails = {
      paidDate,
      paidAmount: Number(paidAmount),
      paidMethod,
      currentDueDate: currentDueDate || null,
    }
    const confirmation = mode === 'baixar'
      ? `Confirmar baixa de ${formatBRL(details.paidAmount)} para ${supplierName}?`
      : `Confirmar correção da baixa para ${formatBRL(details.paidAmount)}?`
    if (!window.confirm(confirmation)) return

    setSaving(true)
    setError(null)
    try {
      // A classificação vai antes: a baixa lê o rateio para repartir o valor
      // pago entre as categorias. Se ela falhar, o pagamento não acontece.
      if (mode === 'baixar') {
        await setPayableFinanceClassification(purchaseId, accountKey || null, slices)
        await recordPayableInstallmentPayment(installment.id, details)
      } else {
        await correctPayablePaymentAndClassification(installment.id, details, accountKey, slices)
      }
      showToast(mode === 'baixar' ? 'Boleto baixado.' : 'Baixa corrigida e registrada no histórico.')
      await onSaved()
    } catch (saveError) {
      console.error(saveError)
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar a baixa.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ps-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="ps-dialog" role="dialog" aria-modal="true" aria-labelledby="payable-payment-title">
        <div className="ps-card-head">
          <div>
            <b id="payable-payment-title">{title}</b>
            <small>{supplierName} · parcela {installment.installment_number}</small>
          </div>
          <button type="button" className="ps-iconbtn" onClick={onClose} aria-label="Fechar baixa"><X size={16} /></button>
        </div>

        <div className="ps-banner honey" style={{ marginTop: 12 }}>
          <b>Valor original · {formatBRL(originalAmount)}</b>
          <small>Vencimento original: {installment.due_date}</small>
        </div>

        {error && <div className="ps-alert error" role="alert" style={{ marginTop: 12 }}>{error}</div>}

        <div className="ps-fieldrow" style={{ marginTop: 14 }}>
          <div className="ps-fieldgroup">
            <label className="ps-fieldlabel" htmlFor="payable-paid-date">Data do pagamento *</label>
            <input id="payable-paid-date" className="ps-input" type="date" value={paidDate} min={purchaseDate} max={todayKey()} onChange={event => setPaidDate(event.target.value)} />
          </div>
          <div className="ps-fieldgroup">
            <label className="ps-fieldlabel" htmlFor="payable-paid-amount">Valor realmente pago *</label>
            <input id="payable-paid-amount" className="ps-input" type="number" min={originalAmount} step="0.01" inputMode="decimal" value={paidAmount} onChange={event => setPaidAmount(event.target.value)} />
          </div>
        </div>

        <div className="ps-fieldrow">
          <div className="ps-fieldgroup">
            <label className="ps-fieldlabel" htmlFor="payable-paid-method">Forma real de pagamento *</label>
            <select id="payable-paid-method" className="ps-select" value={paidMethod} onChange={event => { setPaidMethod(event.target.value as PayableActualPaymentMethod); setAccountKey('') }}>
              {(['boleto', 'pix', 'dinheiro', 'transferencia', 'cartao'] as PayableActualPaymentMethod[]).map(method => <option key={method} value={method}>{actualPaymentMethodLabel(method)}</option>)}
            </select>
          </div>
          <div className="ps-fieldgroup">
            <label className="ps-fieldlabel" htmlFor="payable-current-due-date">Vencimento atualizado</label>
            <input id="payable-current-due-date" className="ps-input" type="date" min={installment.due_date} value={currentDueDate} onChange={event => setCurrentDueDate(event.target.value)} />
            <small className="ps-help">Preencha só se a empresa mandou outro boleto.</small>
          </div>
        </div>

        <PayableCategoryPicker
          categories={financeCategories}
          accounts={financeAccounts}
          slices={slices}
          accountKey={accountKey}
          total={purchaseTotal}
          disabled={saving}
          onChangeSlices={next => { setSlices(next); setError(null) }}
          onChangeAccount={next => { setAccountKey(next); setError(null) }}
          paymentMethod={paidMethod}
        />
        <small className="ps-help" style={{ display: 'block', marginTop: 4 }}>
          A conta entra no DRE pelo mês da compra ({purchaseDate.slice(0, 7).split('-').reverse().join('/')}),
          mesmo sendo paga hoje.
        </small>

        <div className="ps-card" style={{ marginTop: 12, padding: 10, background: 'var(--cream-raise)' }}>
          <small>Acréscimo registrado como juros/multa</small>
          <b style={{ display: 'block', marginTop: 3 }}>{formatBRL(difference)}</b>
          <small className="ps-help">O ERP não calcula juros; apenas registra a diferença informada no pagamento.</small>
        </div>

        <div className="ps-totalbar">
          <div className="ps-total-num"><b>{formatBRL(Number(paidAmount) || 0)}</b><span>{mode === 'baixar' ? 'valor da baixa' : 'novo valor da baixa'}</span></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="ps-btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
            <button type="button" className="ps-save" onClick={() => void save()} disabled={saving}><Save size={16} /> {saving ? 'Salvando...' : 'Confirmar'}</button>
          </div>
        </div>
      </section>
    </div>
  )
}
