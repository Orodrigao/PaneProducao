'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { formatCompetenceMonth, type FinanceAccountRow } from '@/lib/finance'
import {
  defaultPaymentDraft,
  fallbackExcessMode,
  formatReceivableMoney,
  getReceivableErrorMessage,
  loadReceivableExcessMode,
  receiptExcess,
  receiptExcessKind,
  recordReceivableReceipt,
  remainingAmount,
  RECEIVABLE_METHOD_LABELS,
  validateExcessReason,
  validateReceivablePaymentDraft,
  type ReceivableExcessMode,
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

// Começo da recusa do banco quando sobra valor sem atraso. Aparece mesmo com a
// tela achando que não sobra: outro recebimento pode ter entrado depois de a
// lista abrir.
const RECUSA_SEM_MOTIVO = 'O pagamento não está atrasado'

export default function ReceivablePaymentDialog({ receivable, accounts, onClose, onSaved }: ReceivablePaymentDialogProps) {
  const [draft, setDraft] = useState<ReceivablePaymentDraft>(defaultPaymentDraft(receivable))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modo, setModo] = useState<ReceivableExcessMode>(fallbackExcessMode(receivable.origin))
  const [modoConferido, setModoConferido] = useState(false)
  const [bancoPediuMotivo, setBancoPediuMotivo] = useState(false)
  const requestIdRef = useRef<string>(crypto.randomUUID())

  // O destino do valor a mais depende do estado do pedido PJ, que a lista não
  // traz: quem decide é o banco, antes do clique.
  useEffect(() => {
    let ativo = true
    void loadReceivableExcessMode(receivable).then(resposta => {
      if (!ativo) return
      setModo(resposta)
      setModoConferido(true)
    })
    return () => { ativo = false }
  }, [receivable])

  function update(patch: Partial<ReceivablePaymentDraft>) {
    setDraft(current => ({ ...current, ...patch }))
    setError(null)
    // Valor ou data novos invalidam a recusa anterior do banco.
    if (patch.receivedAmount !== undefined || patch.receivedDate !== undefined) setBancoPediuMotivo(false)
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

  // O que passa do que falta vira juros no livro, no mês em que o dinheiro
  // entrou, e não no mês da venda (docs/CONTAS_A_RECEBER.md, decisão 15).
  const excesso = useMemo(() => receiptExcess(receivable, draft), [receivable, draft])
  const destino = receiptExcessKind(excesso, modo)
  const pedeMotivo = destino === 'juros_com_motivo' || bancoPediuMotivo
  const viraJuros = destino === 'juros' || destino === 'juros_com_motivo' || bancoPediuMotivo
  const mesDoRecebimento = draft.receivedDate
    ? formatCompetenceMonth(draft.receivedDate.slice(0, 7))
    : mesDeCompetencia

  async function save() {
    const validationError = validateReceivablePaymentDraft(draft, receivable, todayKey(), modo)
      ?? (bancoPediuMotivo ? validateExcessReason(draft.excessReason, null) : null)
    if (validationError) {
      setError(validationError)
      return
    }
    setSaving(true)
    setError(null)
    try {
      // O motivo só viaja quando o campo está na tela: texto que sobrou de uma
      // digitação anterior não vai para o banco.
      await recordReceivableReceipt(
        receivable.id,
        { ...draft, excessReason: pedeMotivo ? draft.excessReason : '' },
        requestIdRef.current,
      )
      // Dizer em qual mês o dinheiro caiu no livro. Cliente que paga atrasado
      // é o caso normal, então a receita quase sempre pesa num mês anterior ao
      // de hoje — e o livro abre no mês corrente. Com juros, são dois meses.
      showToast(viraJuros && excesso.excess > 0
        ? `Recebimento registrado. A venda entrou no livro em ${mesDeCompetencia}; ${formatReceivableMoney(excesso.excess)} de juros em ${mesDoRecebimento}.`
        : `Recebimento registrado. Entrou no livro em ${mesDeCompetencia}.`)
      await onSaved()
    } catch (saveError) {
      console.error(saveError)
      const message = getReceivableErrorMessage(saveError, 'Não foi possível registrar o recebimento.')
      if (message.startsWith(RECUSA_SEM_MOTIVO)) setBancoPediuMotivo(true)
      setError(message)
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
        {diferenca < 0 && (
          <small className="ps-hint">
            Recebimento parcial: ainda faltarão {formatReceivableMoney(-diferenca)}.
          </small>
        )}
        {destino === 'juros' && (
          <small className="ps-hint">
            Passou {formatReceivableMoney(excesso.excess)} do que faltava: entra como juros recebidos
            em {mesDoRecebimento}. A venda continua em {mesDeCompetencia} e a cobrança fecha.
          </small>
        )}
        {destino === 'valor_do_pedido' && (
          <small className="ps-hint">
            Passou {formatReceivableMoney(excesso.excess)} do que faltava. O valor desta cobrança segue a
            conferência do pedido PJ, então a sobra fica no pedido e é tratada na ficha PJ, por devolução
            ou crédito.
          </small>
        )}
        {destino === 'recusa_buck' && (
          <small className="ps-hint">
            Esta cobrança da Buck tem {formatReceivableMoney(falta)} em aberto. O que passar pertence a outra semana.
          </small>
        )}
      </div>

      {pedeMotivo && (
        <div className="ps-fieldgroup" style={{ marginTop: 12 }}>
          <div className="ps-alert" role="status">
            {destino === 'juros_com_motivo'
              ? <>
                  O pagamento não está atrasado e passou {formatReceivableMoney(excesso.excess)} do que falta.
                  Confira o valor. Se estiver certo, escreva o motivo: o valor a mais entra como juros
                  recebidos em {mesDoRecebimento}.
                </>
              : <>
                  Outro recebimento pode ter entrado nesta cobrança depois de a lista abrir, e agora sobra
                  valor sem atraso. Confira o valor. Se estiver certo, escreva o motivo.
                </>}
          </div>
          <label className="ps-fieldlabel" htmlFor="receivable-excess-reason" style={{ marginTop: 10 }}>
            Motivo do valor a mais *
          </label>
          <textarea
            id="receivable-excess-reason"
            className="ps-textarea"
            rows={2}
            maxLength={300}
            value={draft.excessReason}
            onChange={event => update({ excessReason: event.target.value })}
          />
        </div>
      )}

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
        <button className="ps-btn primary block" onClick={() => void save()} disabled={saving || !modoConferido}>
          {saving ? 'Registrando...' : 'Confirmar recebimento'}
        </button>
        <button className="ps-btn ghost block" onClick={onClose} disabled={saving}>Cancelar</button>
      </div>
      {!modoConferido && (
        <small className="ps-hint" style={{ display: 'block', marginTop: 6 }}>
          Conferindo o que acontece com valor a mais nesta cobrança...
        </small>
      )}
    </section>
  )
}
