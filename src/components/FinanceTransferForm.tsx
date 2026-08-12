'use client'

import { useMemo, useRef, useState } from 'react'
import { ArrowRightLeft, Save, X } from 'lucide-react'
import { showToast, todayKey } from '@/lib/utils'
import {
  createFinanceTransfer,
  emptyFinanceTransferDraft,
  getFinanceErrorMessage,
  validateFinanceTransferDraft,
  type FinanceAccountRow,
  type FinanceTransferDraft,
} from '@/lib/finance'

interface FinanceTransferFormProps {
  accounts: readonly FinanceAccountRow[]
  onCancel: () => void
  onSaved: () => Promise<void> | void
}

function accountLabel(account: FinanceAccountRow): string {
  return account.kind === 'caixa' ? `${account.label} (caixa)` : account.label
}

export default function FinanceTransferForm({ accounts, onCancel, onSaved }: FinanceTransferFormProps) {
  const transferableAccounts = accounts.filter(account => account.kind !== 'cartao_credito')
  const [draft, setDraft] = useState<FinanceTransferDraft>(emptyFinanceTransferDraft())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // O mesmo identificador em toda tentativa deste formulário: toque duplo ou
  // reenvio devolve a transferência já criada, nunca uma segunda.
  const requestIdRef = useRef<string>(crypto.randomUUID())

  function update(patch: Partial<FinanceTransferDraft>) {
    setDraft(current => ({ ...current, ...patch }))
    setError(null)
  }

  // O destino nunca oferece a conta já escolhida como origem: o erro mais
  // fácil de cometer é o que a tela não deixa acontecer.
  const destinations = useMemo(
    () => transferableAccounts.filter(account => account.key !== draft.originAccountKey),
    [transferableAccounts, draft.originAccountKey],
  )

  async function save() {
    const validationError = validateFinanceTransferDraft(draft, todayKey())
    if (validationError) {
      setError(validationError)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await createFinanceTransfer(draft, requestIdRef.current)
      showToast('Transferência registrada nas duas contas.')
      await onSaved()
    } catch (saveError) {
      console.error(saveError)
      // A mensagem fica na própria tela e o que foi digitado permanece:
      // encaminhar o erro sem preservar o trabalho já custou um fechamento
      // inteiro recontado (lição bloqueio-nao-pode-apagar-o-trabalho).
      setError(getFinanceErrorMessage(saveError, 'Não foi possível registrar a transferência.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="ps-card" style={{ marginTop: 14 }}>
      <div className="ps-card-head">
        <div>
          <b>Transferir entre contas</b>
          <small>O dinheiro muda de lugar — não é receita nem despesa.</small>
        </div>
        <button type="button" className="ps-iconbtn" onClick={onCancel} aria-label="Fechar transferência"><X size={16} /></button>
      </div>

      {error && <div className="ps-alert error" role="alert" style={{ marginTop: 12 }}>{error}</div>}

      <div className="ps-fieldgroup" style={{ marginTop: 14 }}>
        <label className="ps-fieldlabel" htmlFor="transfer-origin">Saiu de *</label>
        <select
          id="transfer-origin"
          className="ps-select"
          value={draft.originAccountKey}
          onChange={event => update({ originAccountKey: event.target.value })}
        >
          <option value="">Escolha a conta de origem</option>
          {transferableAccounts.map(account => (
            <option key={account.key} value={account.key}>{accountLabel(account)}</option>
          ))}
        </select>
      </div>

      <div className="ps-fieldgroup">
        <label className="ps-fieldlabel" htmlFor="transfer-destination">Entrou em *</label>
        <select
          id="transfer-destination"
          className="ps-select"
          value={draft.destinationAccountKey}
          onChange={event => update({ destinationAccountKey: event.target.value })}
        >
          <option value="">Escolha a conta de destino</option>
          {destinations.map(account => (
            <option key={account.key} value={account.key}>{accountLabel(account)}</option>
          ))}
        </select>
      </div>

      <div className="ps-fieldrow">
        <div className="ps-fieldgroup">
          <label className="ps-fieldlabel" htmlFor="transfer-amount">Valor *</label>
          <input
            id="transfer-amount"
            className="ps-input"
            inputMode="decimal"
            placeholder="0,00"
            value={draft.amount}
            onChange={event => update({ amount: event.target.value })}
          />
        </div>
        <div className="ps-fieldgroup">
          <label className="ps-fieldlabel" htmlFor="transfer-date">Data *</label>
          <input
            id="transfer-date"
            className="ps-input"
            type="date"
            max={todayKey()}
            value={draft.transferDate}
            onChange={event => update({ transferDate: event.target.value })}
          />
        </div>
      </div>

      <div className="ps-fieldgroup">
        <label className="ps-fieldlabel" htmlFor="transfer-note">Observação</label>
        <input
          id="transfer-note"
          className="ps-input"
          placeholder="Ex.: sangria do turno da tarde"
          value={draft.note}
          onChange={event => update({ note: event.target.value })}
        />
        <small style={{ opacity: 0.75 }}>Opcional. As contas já aparecem sozinhas na descrição.</small>
      </div>

      <div className="ps-fieldrow" style={{ marginTop: 14 }}>
        <button type="button" className="ps-btn ghost block" onClick={onCancel} disabled={saving}>Cancelar</button>
        <button type="button" className="ps-btn primary block" onClick={() => void save()} disabled={saving}>
          {saving ? <>Registrando...</> : <><Save size={16} /> Registrar</>}
        </button>
      </div>

      <small style={{ display: 'block', marginTop: 10, opacity: 0.75 }}>
        <ArrowRightLeft size={13} style={{ verticalAlign: '-2px' }} /> Vão aparecer duas linhas ligadas no livro: a saída de uma conta e a entrada na outra. O total de entradas e saídas do mês não muda.
      </small>
    </section>
  )
}
