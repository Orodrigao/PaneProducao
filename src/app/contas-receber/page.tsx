'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { HandCoins, Plus, RefreshCw } from 'lucide-react'
import ReceivableForm from '@/components/ReceivableForm'
import ReceivableList from '@/components/ReceivableList'
import ReceivablePaymentDialog from '@/components/ReceivablePaymentDialog'
import PjOrdersToBillPanel from '@/components/PjOrdersToBillPanel'
import { loadFinanceAccounts, type FinanceAccountRow } from '@/lib/finance'
import {
  cancelReceivable,
  correctReceivableDueDate,
  formatReceivableMoney,
  loadReceivableCustomers,
  loadPjOrdersToBill,
  loadReceivables,
  reverseReceivablePayment,
  sortReceivables,
  summarizeReceivables,
  type PjOrderToBillRow,
  type ReceivableCustomerOption,
  type ReceivableRow,
} from '@/lib/receivables'
import { showToast } from '@/lib/utils'

export default function ContasReceberPage() {
  const [receivables, setReceivables] = useState<ReceivableRow[]>([])
  const [customers, setCustomers] = useState<ReceivableCustomerOption[]>([])
  const [accounts, setAccounts] = useState<FinanceAccountRow[]>([])
  const [pjOrdersToBill, setPjOrdersToBill] = useState<PjOrderToBillRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [paymentTarget, setPaymentTarget] = useState<ReceivableRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [rows, customerRows, accountRows, pjRows] = await Promise.all([
        loadReceivables(),
        loadReceivableCustomers(),
        loadFinanceAccounts(),
        loadPjOrdersToBill(),
      ])
      setReceivables(rows)
      setCustomers(customerRows)
      setAccounts(accountRows)
      setPjOrdersToBill(pjRows)
    } catch (loadError) {
      console.error(loadError)
      setError('Não foi possível carregar as cobranças. Confira sua permissão e tente novamente.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const totals = useMemo(() => summarizeReceivables(receivables), [receivables])
  const ordered = useMemo(() => sortReceivables(receivables), [receivables])

  async function handleReverse(receivable: ReceivableRow) {
    const reason = window.prompt('Por que este recebimento será estornado?')?.trim()
    if (!reason) return
    setBusyId(receivable.id)
    try {
      await reverseReceivablePayment(receivable.id, reason, crypto.randomUUID())
      showToast('Recebimento estornado e retirado do livro.')
      await load()
    } catch (actionError) {
      console.error(actionError)
      showToast(actionError instanceof Error ? actionError.message : 'Não foi possível estornar o recebimento.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleCancel(receivable: ReceivableRow) {
    const reason = window.prompt('Por que esta cobrança será cancelada?')?.trim()
    if (!reason) return
    setBusyId(receivable.id)
    try {
      await cancelReceivable(receivable.id, reason, crypto.randomUUID())
      showToast('Cobrança cancelada e preservada no histórico.')
      await load()
    } catch (actionError) {
      console.error(actionError)
      showToast(actionError instanceof Error ? actionError.message : 'Não foi possível cancelar a cobrança.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleCorrectDueDate(receivable: ReceivableRow) {
    const dueDate = window.prompt('Novo vencimento (AAAA-MM-DD):', receivable.due_date)?.trim()
    if (!dueDate) return
    const reason = window.prompt('Por que o vencimento está sendo alterado?')?.trim()
    if (!reason) return
    setBusyId(receivable.id)
    try {
      await correctReceivableDueDate(receivable.id, dueDate, reason, crypto.randomUUID())
      showToast('Vencimento corrigido.')
      await load()
    } catch (actionError) {
      console.error(actionError)
      showToast(actionError instanceof Error ? actionError.message : 'Não foi possível corrigir o vencimento.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <div className="ps-mark"><HandCoins size={18} /></div>
            <div className="ps-brand"><b>Contas a receber</b><span>Clientes PJ · quem deve e quanto</span></div>
          </div>
          <button className="ps-iconbtn" onClick={() => void load()} aria-label="Atualizar cobranças" title="Atualizar"><RefreshCw size={17} /></button>
        </header>

        <div className="ps-scroll ps-pad">
          <div className="ps-banner honey">
            <b>Quem deve para a padaria</b>
            <small>Ao registrar o recebimento, o dinheiro entra sozinho no livro-caixa, no mês do faturamento.</small>
          </div>

          <div className="ps-fieldrow" style={{ marginTop: 12 }}>
            <div className="ps-card" style={{ flex: 1, borderColor: totals.atrasado > 0 ? 'var(--berry)' : undefined }}>
              <small>Atrasado</small>
              <b style={{ display: 'block', marginTop: 4 }}>{formatReceivableMoney(totals.atrasado)}</b>
            </div>
            <div className="ps-card" style={{ flex: 1 }}>
              <small>A vencer</small>
              <b style={{ display: 'block', marginTop: 4 }}>{formatReceivableMoney(totals.aVencer)}</b>
            </div>
            <div className="ps-card" style={{ flex: 1 }}>
              <small>Já recebido</small>
              <b style={{ display: 'block', marginTop: 4 }}>{formatReceivableMoney(totals.recebidoNoPeriodo)}</b>
            </div>
          </div>

          <PjOrdersToBillPanel orders={pjOrdersToBill} onBilled={load} />

          {showForm ? (
            <ReceivableForm
              customers={customers}
              onCancel={() => setShowForm(false)}
              onSaved={async () => { setShowForm(false); await load() }}
            />
          ) : (
            <div className="ps-fieldrow" style={{ marginTop: 14 }}>
              <button className="ps-btn primary block" onClick={() => setShowForm(true)}><Plus size={16} /> Nova cobrança</button>
            </div>
          )}

          {error && (
            <div className="ps-card" style={{ marginTop: 14, borderColor: 'var(--berry)' }}>
              <b>Não carregou</b><p style={{ margin: '6px 0 10px' }}>{error}</p>
              <button className="ps-btn ghost sm" onClick={() => void load()}>Tentar novamente</button>
            </div>
          )}

          {paymentTarget && (
            <ReceivablePaymentDialog
              receivable={paymentTarget}
              accounts={accounts}
              onClose={() => setPaymentTarget(null)}
              onSaved={async () => { setPaymentTarget(null); await load() }}
            />
          )}

          <div className="ps-label">Cobranças</div>
          {loading ? <div className="ps-empty">Carregando cobranças...</div> : (
            <ReceivableList
              receivables={ordered}
              busyId={busyId}
              onPay={receivable => setPaymentTarget(receivable)}
              onReverse={receivable => void handleReverse(receivable)}
              onCancel={receivable => void handleCancel(receivable)}
              onCorrectDueDate={receivable => void handleCorrectDueDate(receivable)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
