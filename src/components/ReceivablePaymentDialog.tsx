'use client'

import { useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { formatCompetenceMonth, type FinanceAccountRow } from '@/lib/finance'
import {
  defaultPaymentDraft,
  formatReceivableMoney,
  getReceivableErrorMessage,
  recordReceivableReceipt,
  remainingAmount,
  RECEIVABLE_METHOD_LABELS,
  validateReceivablePaymentDraft,
  type ReceivableMethod,
  type ReceivablePaymentDraft,
  type ReceivableRow,
} from '@/lib/receivables'
import { parseMoneyInput } from '@/lib/cashClosing'
import { showToast, todayKey } from '@/lib/utils'

interface ReceivablePaymentDialogProps {
  receivable: ReceivableRow
  accounts: FinanceAccountRow[]
  onClose: () => void
  onSaved: () => Promise<void> | void
}

const METHODS: ReceivableMethod[] = ['pix', 'transferencia', 'boleto', 'dinheiro', 'outro']

export default function ReceivablePaymentDialog({ receivable, accounts, onClose, onSaved }: ReceivablePaymentDialogProps) {
  const [draft, setDraft] = useState<ReceivablePaymentDraft>(defaultPaymentDraft(receivable))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef<string>(crypto.randomUUID())

  function update(patch: Partial<ReceivablePaymentDraft>) {
    setDraft(current => ({ ...current, ...patch }))
    setError(null)
  }

  // Cartão de crédito é conta de pagamento, não de recebimento — o banco
  // recusa, e a lista não oferece.
  const availableAccounts = useMemo(
    () => accounts.filter(account => account.kind !== 'cartao_credito'),
    [accounts],
  )

  const mesDeCompetencia = formatCompetenceMonth(receivable.invoice_date.slice(0, 7))

  const falta = remainingAmount(receivable)

  // A diferenca e medida contra o que FALTA, nao contra o valor cheio: numa
  // cobranca que ja recebeu metade, o que interessa e se este pedaco quita.
  const diferenca = useMemo(() => {
    const recebido = parseMoneyInput(draft.receivedAmount)
    if (!(recebido > 0)) return 0
    return Math.round((recebido - falta) * 100) / 100
  }, [draft.receivedAmount, falta])

  async function save() {
    const validationError = validateReceivablePaymentDraft(draft, receivable, todayKey())
    if (validationError) {
      setError(validationError)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await recordReceivableReceipt(receivable.id, draft, requestIdRef.current)
      // Dizer em qual mês o dinheiro caiu no livro. Cliente que paga atrasado
      // é o caso normal, então a receita quase sempre pesa num mês anterior ao
      // de hoje — e o livro abre no mês corrente. Sem este recado, quem baixa
      // vai procurar o valor no mês errado e achar que nada aconteceu.
      showToast(`Recebimento registrado. Entrou no livro em ${mesDeCompetencia}.`)
      await onSaved()
    } catch (saveError) {
      console.error(saveError)
      setError(getReceivableErrorMessage(saveError, 'Não foi possível registrar o recebimento.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="ps-card" style={{ marginTop: 14, borderColor: 'var(--honey-deep)' }}>
      <div className="ps-card-head">
        <div>
          <b>Registrar recebimento</b>
          <small>
            {receivable.customer?.name ?? 'Cliente'} · cobrado {formatReceivableMoney(receivable.amount)}
            {falta < receivable.amount && <> · faltam {formatReceivableMoney(falta)}</>}
            {' · '}pesa em {mesDeCompetencia}
          </small>
        </div>
        <button type="button" className="ps-iconbtn" onClick={onClose} aria-label="Fechar recebimento"><X size={16} /></button>
      </div>

      {error && <div className="ps-alert error" role="alert" style={{ marginTop: 12 }}>{error}</div>}

      <div className="ps-fieldgroup" style={{ marginTop: 14 }}>
        <label className="ps-fieldlabel" htmlFor="receivable-paid-date">Data em que o dinheiro entrou *</label>
        <input
          id="receivable-paid-date"
          className="ps-input"
          type="date"
          max={todayKey()}
          min={receivable.invoice_date}
          value={draft.receivedDate}
          onChange={event => update({ receivedDate: event.target.value })}
        />
      </div>

      <div className="ps-fieldgroup" style={{ marginTop: 12 }}>
        <label className="ps-fieldlabel" htmlFor="receivable-paid-amount">Valor recebido *</label>
        <input
          id="receivable-paid-amount"
          className="ps-input"
          inputMode="decimal"
          value={draft.receivedAmount}
          onChange={event => update({ receivedAmount: event.target.value })}
        />
        {diferenca !== 0 && (
          <small className="ps-hint">
            {diferenca > 0
              ? `Entrou ${formatReceivableMoney(diferenca)} a mais do que faltava. A cobrança fecha.`
              : `Recebimento parcial: ainda faltarão ${formatReceivableMoney(-diferenca)}.`}
          </small>
        )}
      </div>

      <div className="ps-fieldgroup" style={{ marginTop: 12 }}>
        <label className="ps-fieldlabel" htmlFor="receivable-method">Forma *</label>
        <select
          id="receivable-method"
          className="ps-select"
          value={draft.receivedMethod}
          onChange={event => update({ receivedMethod: event.target.value as ReceivableMethod })}
        >
          {METHODS.map(method => (
            <option key={method} value={method}>{RECEIVABLE_METHOD_LABELS[method]}</option>
          ))}
        </select>
      </div>

      <div className="ps-fieldgroup" style={{ marginTop: 12 }}>
        <label className="ps-fieldlabel" htmlFor="receivable-account">Conta que recebeu *</label>
        <select
          id="receivable-account"
          className="ps-select"
          value={draft.accountKey}
          onChange={event => update({ accountKey: event.target.value })}
        >
          <option value="">Escolha a conta</option>
          {availableAccounts.map(account => (
            <option key={account.id} value={account.key}>{account.label}</option>
          ))}
        </select>
        <small className="ps-hint">É esta conta que recebe a entrada no livro-caixa.</small>
      </div>

      <div className="ps-fieldrow" style={{ marginTop: 16 }}>
        <button className="ps-btn primary block" onClick={() => void save()} disabled={saving}>
          {saving ? 'Registrando...' : 'Confirmar recebimento'}
        </button>
        <button className="ps-btn ghost block" onClick={onClose} disabled={saving}>Cancelar</button>
      </div>
    </section>
  )
}
