'use client'

import { useMemo, useRef, useState } from 'react'
import { CalendarCheck, Save, X } from 'lucide-react'
import {
  buildFinanceRecurringForecasts,
  confirmFinanceRecurringRule,
  createFinanceRecurringRule,
  currentMonthKey,
  emptyFinanceRecurringRuleDraft,
  endFinanceRecurringRule,
  FINANCE_PAYMENT_LABELS,
  FINANCE_STORE_LABELS,
  formatFinanceMoney,
  getFinanceErrorMessage,
  validateFinanceRecurringRuleDraft,
  type FinanceAccountRow,
  type FinanceCategoryRow,
  type FinanceEntryRow,
  type FinancePaymentMethod,
  type FinanceRecurringForecast,
  type FinanceRecurringRuleDraft,
  type FinanceRecurringRuleRow,
  type FinanceStore,
} from '@/lib/finance'
import { showToast, todayKey } from '@/lib/utils'

interface FinanceRecurringPanelProps {
  monthKey: string
  categories: readonly FinanceCategoryRow[]
  accounts: readonly FinanceAccountRow[]
  entries: readonly FinanceEntryRow[]
  rules: readonly FinanceRecurringRuleRow[]
  disabled?: boolean
  onChanged: () => Promise<void> | void
}

function accountOptions(accounts: readonly FinanceAccountRow[], store: FinanceStore | '') {
  if (!store || store === 'geral') return accounts.filter(account => account.kind === 'banco')
  return accounts.filter(account => account.kind === 'banco' || account.store === store)
}

function moneyInput(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function FinanceRecurringPanel({
  monthKey, categories, accounts, entries, rules, disabled = false, onChanged,
}: FinanceRecurringPanelProps) {
  const [showCreate, setShowCreate] = useState(false)
  const [draft, setDraft] = useState<FinanceRecurringRuleDraft>(() => emptyFinanceRecurringRuleDraft(monthKey))
  const [confirming, setConfirming] = useState<FinanceRecurringForecast | null>(null)
  const [paidDate, setPaidDate] = useState(todayKey())
  const [paidAmount, setPaidAmount] = useState('')
  const [accountKey, setAccountKey] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<FinancePaymentMethod>('boleto')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef<string>(crypto.randomUUID())

  const forecasts = useMemo(
    () => buildFinanceRecurringForecasts(rules, entries, monthKey),
    [rules, entries, monthKey],
  )
  const availableDraftAccounts = useMemo(
    () => accountOptions(accounts, draft.store),
    [accounts, draft.store],
  )
  const availableConfirmAccounts = useMemo(
    () => accountOptions(accounts, confirming?.rule.store ?? ''),
    [accounts, confirming],
  )

  function updateDraft(patch: Partial<FinanceRecurringRuleDraft>) {
    setDraft(current => ({ ...current, ...patch }))
    setError(null)
  }

  async function saveRule() {
    const validation = validateFinanceRecurringRuleDraft(draft)
    if (validation) {
      setError(validation)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await createFinanceRecurringRule(draft)
      showToast('Recorrência criada. Ela aparecerá como pendência a cada mês da vigência.')
      setShowCreate(false)
      setDraft(emptyFinanceRecurringRuleDraft(monthKey))
      await onChanged()
    } catch (saveError) {
      console.error(saveError)
      setError(getFinanceErrorMessage(saveError, 'Não foi possível salvar a recorrência.'))
    } finally {
      setSaving(false)
    }
  }

  function openConfirmation(forecast: FinanceRecurringForecast) {
    const defaultAccount = accounts.find(account => account.id === forecast.rule.default_account_id)
    setConfirming(forecast)
    setPaidDate(todayKey())
    setPaidAmount(moneyInput(forecast.rule.planned_amount))
    setAccountKey(defaultAccount?.key ?? '')
    setPaymentMethod(forecast.rule.default_payment_method)
    setError(null)
    requestIdRef.current = crypto.randomUUID()
  }

  async function confirmPayment() {
    if (!confirming) return
    if (!accountKey) {
      setError('Escolha a conta real usada no pagamento.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await confirmFinanceRecurringRule(
        confirming.rule.id,
        monthKey,
        paidDate,
        paidAmount,
        paymentMethod,
        accountKey,
        requestIdRef.current,
      )
      showToast('Pagamento confirmado no livro financeiro.')
      setConfirming(null)
      await onChanged()
    } catch (confirmError) {
      console.error(confirmError)
      setError(getFinanceErrorMessage(confirmError, 'Não foi possível confirmar o pagamento.'))
    } finally {
      setSaving(false)
    }
  }

  async function endRule(forecast: FinanceRecurringForecast) {
    if (!window.confirm(`Encerrar “${forecast.rule.name}” depois de ${monthKey}? Os meses passados continuam no histórico.`)) return
    setSaving(true)
    setError(null)
    try {
      await endFinanceRecurringRule(forecast.rule.id, monthKey)
      showToast('A recorrência não aparecerá nos próximos meses.')
      await onChanged()
    } catch (endError) {
      console.error(endError)
      setError(getFinanceErrorMessage(endError, 'Não foi possível encerrar a recorrência.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="ps-card" style={{ marginTop: 14 }}>
      <div className="ps-card-head">
        <div>
          <b>Contas recorrentes</b>
          <small>Elas viram pendência no mês. Só entram no livro quando o pagamento é confirmado.</small>
        </div>
        <CalendarCheck size={20} aria-hidden="true" />
      </div>

      {error && <div className="ps-alert error" role="alert" style={{ marginTop: 12 }}>{error}</div>}

      {showCreate ? (
        <div style={{ marginTop: 14 }}>
          <div className="ps-fieldgroup">
            <label className="ps-fieldlabel" htmlFor="recurring-name">O que é pago todo mês? *</label>
            <input id="recurring-name" className="ps-input" placeholder="Ex.: aluguel da JC" value={draft.name}
              onChange={event => updateDraft({ name: event.target.value })} />
          </div>
          <div className="ps-fieldrow">
            <div className="ps-fieldgroup">
              <label className="ps-fieldlabel" htmlFor="recurring-category">Categoria *</label>
              <select id="recurring-category" className="ps-select" value={draft.categoryKey}
                onChange={event => updateDraft({ categoryKey: event.target.value })}>
                <option value="">Escolha a categoria</option>
                {categories.filter(category => category.nature !== 'transferencia').map(category => (
                  <option key={category.key} value={category.key}>{category.label}</option>
                ))}
              </select>
            </div>
            <div className="ps-fieldgroup">
              <label className="ps-fieldlabel" htmlFor="recurring-store">Loja *</label>
              <select id="recurring-store" className="ps-select" value={draft.store}
                onChange={event => updateDraft({ store: event.target.value as FinanceStore | '', defaultAccountKey: '' })}>
                <option value="">Escolha a loja</option>
                {(['jc', 'ja', 'geral'] as FinanceStore[]).map(store => (
                  <option key={store} value={store}>{FINANCE_STORE_LABELS[store]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="ps-fieldrow">
            <div className="ps-fieldgroup">
              <label className="ps-fieldlabel" htmlFor="recurring-amount">Valor previsto *</label>
              <input id="recurring-amount" className="ps-input" inputMode="decimal" placeholder="0,00" value={draft.plannedAmount}
                onChange={event => updateDraft({ plannedAmount: event.target.value })} />
            </div>
            <div className="ps-fieldgroup">
              <label className="ps-fieldlabel" htmlFor="recurring-day">Dia do mês *</label>
              <input id="recurring-day" className="ps-input" inputMode="numeric" type="number" min="1" max="31" value={draft.dueDay}
                onChange={event => updateDraft({ dueDay: event.target.value })} />
            </div>
          </div>
          <div className="ps-fieldrow">
            <div className="ps-fieldgroup">
              <label className="ps-fieldlabel" htmlFor="recurring-start">Começa em *</label>
              <input id="recurring-start" className="ps-input" type="month" value={draft.startMonth}
                onChange={event => updateDraft({ startMonth: event.target.value })} />
            </div>
            <div className="ps-fieldgroup">
              <label className="ps-fieldlabel" htmlFor="recurring-end">Termina em</label>
              <input id="recurring-end" className="ps-input" type="month" value={draft.endMonth}
                onChange={event => updateDraft({ endMonth: event.target.value })} />
            </div>
          </div>
          <div className="ps-fieldrow">
            <div className="ps-fieldgroup">
              <label className="ps-fieldlabel" htmlFor="recurring-account">Conta habitual *</label>
              <select id="recurring-account" className="ps-select" value={draft.defaultAccountKey} disabled={!draft.store}
                onChange={event => updateDraft({ defaultAccountKey: event.target.value })}>
                <option value="">{draft.store ? 'Escolha a conta' : 'Escolha a loja antes'}</option>
                {availableDraftAccounts.map(account => <option key={account.key} value={account.key}>{account.label}</option>)}
              </select>
            </div>
            <div className="ps-fieldgroup">
              <label className="ps-fieldlabel" htmlFor="recurring-method">Forma habitual *</label>
              <select id="recurring-method" className="ps-select" value={draft.defaultPaymentMethod}
                onChange={event => updateDraft({ defaultPaymentMethod: event.target.value as FinancePaymentMethod })}>
                {(Object.keys(FINANCE_PAYMENT_LABELS) as FinancePaymentMethod[]).map(method => (
                  <option key={method} value={method}>{FINANCE_PAYMENT_LABELS[method]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="ps-fieldrow" style={{ marginTop: 14 }}>
            <button type="button" className="ps-btn primary block" disabled={saving || disabled} onClick={() => void saveRule()}>
              <Save size={16} /> {saving ? 'Salvando...' : 'Criar recorrência'}
            </button>
            <button type="button" className="ps-btn ghost block" disabled={saving} onClick={() => { setShowCreate(false); setError(null) }}>
              <X size={16} /> Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="ps-btn ghost block" style={{ marginTop: 12 }} disabled={disabled}
          onClick={() => { setDraft(emptyFinanceRecurringRuleDraft(monthKey)); setShowCreate(true); setError(null) }}>
          Nova recorrência
        </button>
      )}

      {forecasts.length === 0 ? (
        <small style={{ display: 'block', marginTop: 14 }}>Nenhuma recorrência pendente neste mês.</small>
      ) : forecasts.map(forecast => {
        const category = categories.find(item => item.id === forecast.rule.category_id)
        const paidEntry = forecast.entry?.entry_type === 'lancamento' && forecast.entry.reversed_at === null
        return (
          <article key={forecast.rule.id} className="ps-card" style={{ marginTop: 12, background: paidEntry ? 'var(--cream-raise)' : undefined }}>
            <div className="ps-card-head">
              <div>
                <b>{forecast.rule.name}</b>
                <small>{category?.label ?? 'Categoria removida'} · vence dia {forecast.rule.due_day} · {FINANCE_STORE_LABELS[forecast.rule.store]}</small>
              </div>
              <b>{formatFinanceMoney(paidEntry && forecast.entry ? forecast.entry.amount : forecast.rule.planned_amount)}</b>
            </div>
            {paidEntry && forecast.entry ? (
              <small style={{ display: 'block', marginTop: 7, color: 'var(--basil)' }}>Pago em {forecast.entry.paid_date}. Já está no livro.</small>
            ) : (
              <>
                <small style={{ display: 'block', marginTop: 7, color: 'var(--berry)' }}>Pendente · previsto para {forecast.dueDate}.</small>
                <div className="ps-fieldrow" style={{ marginTop: 10 }}>
                  <button type="button" className="ps-btn primary block" disabled={saving || disabled} onClick={() => openConfirmation(forecast)}>Confirmar pago</button>
                  <button type="button" className="ps-btn ghost block" disabled={saving || disabled || monthKey < currentMonthKey()}
                    onClick={() => void endRule(forecast)}>Encerrar depois deste mês</button>
                </div>
              </>
            )}
          </article>
        )
      })}

      {confirming && (
        <div className="ps-card" style={{ marginTop: 14, borderColor: 'var(--honey)' }}>
          <div className="ps-card-head"><div><b>Confirmar {confirming.rule.name}</b><small>Confira só o que mudou do padrão.</small></div></div>
          <div className="ps-fieldrow">
            <div className="ps-fieldgroup"><label className="ps-fieldlabel" htmlFor="recurring-paid-date">Pago em *</label>
              <input id="recurring-paid-date" className="ps-input" type="date" max={todayKey()} value={paidDate} onChange={event => setPaidDate(event.target.value)} /></div>
            <div className="ps-fieldgroup"><label className="ps-fieldlabel" htmlFor="recurring-paid-amount">Valor pago *</label>
              <input id="recurring-paid-amount" className="ps-input" inputMode="decimal" value={paidAmount} onChange={event => setPaidAmount(event.target.value)} /></div>
          </div>
          <div className="ps-fieldrow">
            <div className="ps-fieldgroup"><label className="ps-fieldlabel" htmlFor="recurring-paid-account">Saiu de *</label>
              <select id="recurring-paid-account" className="ps-select" value={accountKey} onChange={event => setAccountKey(event.target.value)}>
                <option value="">Escolha a conta</option>
                {availableConfirmAccounts.map(account => <option key={account.key} value={account.key}>{account.label}</option>)}
              </select></div>
            <div className="ps-fieldgroup"><label className="ps-fieldlabel" htmlFor="recurring-paid-method">Forma *</label>
              <select id="recurring-paid-method" className="ps-select" value={paymentMethod} onChange={event => setPaymentMethod(event.target.value as FinancePaymentMethod)}>
                {(Object.keys(FINANCE_PAYMENT_LABELS) as FinancePaymentMethod[]).map(method => <option key={method} value={method}>{FINANCE_PAYMENT_LABELS[method]}</option>)}
              </select></div>
          </div>
          <div className="ps-fieldrow" style={{ marginTop: 14 }}>
            <button type="button" className="ps-btn primary block" disabled={saving} onClick={() => void confirmPayment()}>
              <Save size={16} /> {saving ? 'Confirmando...' : 'Confirmar no livro'}
            </button>
            <button type="button" className="ps-btn ghost block" disabled={saving} onClick={() => { setConfirming(null); setError(null) }}>Cancelar</button>
          </div>
        </div>
      )}
    </section>
  )
}
