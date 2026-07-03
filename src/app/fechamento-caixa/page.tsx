'use client'

import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Calendar, Check, DollarSign, RefreshCw, Save } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUserAsync, roleColor, type AppUser } from '@/lib/auth'
import { formatDateBR, showToastPS, todayKey } from '@/lib/utils'
import {
  calculateCashClosingTotals,
  formatCurrencyBRL,
  parseMoneyInput,
  type CashClosingInput,
} from '@/lib/cashClosing'

type StoreKey = 'jc' | 'ja' | 'ex'
type MoneyField = keyof CashClosingInput

interface CashClosingRow {
  id: string
  closing_date: string
  weekday_label: string
  store: StoreKey
  sales_amount: number
  banri_amount: number
  sitef_amount: number
  pix_amount: number
  cash_amount: number
  site_sales_amount: number
  ifood_sales_amount: number
  total_amount: number
  cash_withdrawal_amount: number
  opening_cash_amount: number
  closing_cash_amount: number
  envelope_amount: number
  next_day_cash_amount: number
  notes: string | null
  created_by_name: string
  updated_by_name: string | null
  created_at: string
  updated_at: string
}

const STORE_OPTIONS: { key: StoreKey; label: string }[] = [
  { key: 'jc', label: 'Julio' },
  { key: 'ex', label: 'Exposicao' },
  { key: 'ja', label: 'Jardim America' },
]

const WEEKDAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']

const EMPTY_FORM: Record<MoneyField, string> = {
  salesAmount: '',
  banriAmount: '',
  sitefAmount: '',
  pixAmount: '',
  cashAmount: '',
  siteSalesAmount: '',
  ifoodSalesAmount: '',
  totalAmount: '',
  cashWithdrawalAmount: '',
  openingCashAmount: '',
  closingCashAmount: '',
  envelopeAmount: '',
  nextDayCashAmount: '',
}

const PAYMENT_FIELDS: { key: MoneyField; label: string; helper?: string }[] = [
  { key: 'banriAmount', label: 'Banri' },
  { key: 'sitefAmount', label: 'Sitef' },
  { key: 'pixAmount', label: 'Pix' },
  { key: 'cashAmount', label: 'Dinheiro' },
]

const CHANNEL_FIELDS: { key: MoneyField; label: string; helper?: string }[] = [
  { key: 'salesAmount', label: 'Vendas do dia', helper: 'balcao / loja' },
  { key: 'siteSalesAmount', label: 'Vendas site' },
  { key: 'ifoodSalesAmount', label: 'Vendas iFood' },
]

const CASH_FIELDS: { key: MoneyField; label: string; helper?: string }[] = [
  { key: 'openingCashAmount', label: 'Caixa anterior', helper: 'abertura' },
  { key: 'cashWithdrawalAmount', label: 'Sangria' },
  { key: 'closingCashAmount', label: 'Caixa final do dia' },
  { key: 'envelopeAmount', label: 'Envelope', helper: 'malote para deposito' },
  { key: 'nextDayCashAmount', label: 'Proximo dia', helper: 'abertura seguinte' },
]

function isStoreKey(value: string | null): value is StoreKey {
  return value === 'jc' || value === 'ja' || value === 'ex'
}

function weekdayFromDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) return ''
  const parsed = new Date(Date.UTC(year, month - 1, day, 12))
  return WEEKDAYS[parsed.getUTCDay()] ?? ''
}

function formToInput(form: Record<MoneyField, string>): CashClosingInput {
  return {
    salesAmount: parseMoneyInput(form.salesAmount),
    banriAmount: parseMoneyInput(form.banriAmount),
    sitefAmount: parseMoneyInput(form.sitefAmount),
    pixAmount: parseMoneyInput(form.pixAmount),
    cashAmount: parseMoneyInput(form.cashAmount),
    siteSalesAmount: parseMoneyInput(form.siteSalesAmount),
    ifoodSalesAmount: parseMoneyInput(form.ifoodSalesAmount),
    totalAmount: parseMoneyInput(form.totalAmount),
    cashWithdrawalAmount: parseMoneyInput(form.cashWithdrawalAmount),
    openingCashAmount: parseMoneyInput(form.openingCashAmount),
    closingCashAmount: parseMoneyInput(form.closingCashAmount),
    envelopeAmount: parseMoneyInput(form.envelopeAmount),
    nextDayCashAmount: parseMoneyInput(form.nextDayCashAmount),
  }
}

function moneyToInput(value: number): string {
  if (!value) return ''
  return value.toFixed(2).replace('.', ',')
}

function rowToForm(row: CashClosingRow): Record<MoneyField, string> {
  return {
    salesAmount: moneyToInput(row.sales_amount),
    banriAmount: moneyToInput(row.banri_amount),
    sitefAmount: moneyToInput(row.sitef_amount),
    pixAmount: moneyToInput(row.pix_amount),
    cashAmount: moneyToInput(row.cash_amount),
    siteSalesAmount: moneyToInput(row.site_sales_amount),
    ifoodSalesAmount: moneyToInput(row.ifood_sales_amount),
    totalAmount: moneyToInput(row.total_amount),
    cashWithdrawalAmount: moneyToInput(row.cash_withdrawal_amount),
    openingCashAmount: moneyToInput(row.opening_cash_amount),
    closingCashAmount: moneyToInput(row.closing_cash_amount),
    envelopeAmount: moneyToInput(row.envelope_amount),
    nextDayCashAmount: moneyToInput(row.next_day_cash_amount),
  }
}

function FieldGroup({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="ps-card" style={{ gap: 12 }}>
      <div className="ps-fieldlabel" style={{ color: 'var(--crust)' }}>{title}</div>
      <div className="ps-fieldrow">{children}</div>
    </section>
  )
}

function MoneyInput({
  label,
  helper,
  value,
  onChange,
}: {
  label: string
  helper?: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="ps-fieldgroup" style={{ minWidth: 142 }}>
      <span className="ps-fieldlabel">{label}</span>
      <input
        value={value}
        onChange={event => onChange(event.target.value)}
        inputMode="decimal"
        placeholder="0,00"
        className="ps-input"
        style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
      />
      {helper && <span style={{ fontSize: 11, color: 'var(--ink-faint)', lineHeight: 1.25 }}>{helper}</span>}
    </label>
  )
}

function CheckRow({
  label,
  value,
}: {
  label: string
  value: number
}) {
  const ok = Math.abs(value) < 0.01
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
      <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.25 }}>{label}</div>
      <span className={`ps-status ${ok ? 'ok' : 'divergencia'}`} style={{ flexShrink: 0 }}>
        {ok ? <Check size={12} /> : <AlertTriangle size={12} />}
        {ok ? 'OK' : formatCurrencyBRL(value)}
      </span>
    </div>
  )
}

export default function FechamentoCaixaPage() {
  const [user, setUser] = useState<AppUser | null>(null)
  const [store, setStore] = useState<StoreKey>('jc')
  const [date, setDate] = useState(todayKey())
  const [form, setForm] = useState<Record<MoneyField, string>>(EMPTY_FORM)
  const [notes, setNotes] = useState('')
  const [existing, setExisting] = useState<CashClosingRow | null>(null)
  const [history, setHistory] = useState<CashClosingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let alive = true
    getCurrentUserAsync().then(current => {
      if (!alive) return
      setUser(current)
      const currentStore = current?.store ?? null
      if (isStoreKey(currentStore)) setStore(currentStore)
    })
    return () => { alive = false }
  }, [])

  const canChangeStore = user?.role === 'admin' || user?.role === 'financeiro'
  const weekday = weekdayFromDate(date)
  const input = useMemo(() => formToInput(form), [form])
  const totals = useMemo(() => calculateCashClosingTotals(input), [input])

  const loadClosing = useCallback(async () => {
    setLoading(true)
    setLoadError('')

    const [selectedRes, historyRes] = await Promise.all([
      supabase
        .from('cash_closings')
        .select('*')
        .eq('store', store)
        .eq('closing_date', date)
        .maybeSingle(),
      supabase
        .from('cash_closings')
        .select('*')
        .eq('store', store)
        .order('closing_date', { ascending: false })
        .limit(8),
    ])

    if (selectedRes.error) {
      setExisting(null)
      setLoadError(selectedRes.error.message)
    } else if (selectedRes.data) {
      const row = selectedRes.data as CashClosingRow
      setExisting(row)
      setForm(rowToForm(row))
      setNotes(row.notes ?? '')
    } else {
      setExisting(null)
      setForm(EMPTY_FORM)
      setNotes('')
    }

    if (!historyRes.error) {
      setHistory((historyRes.data ?? []) as CashClosingRow[])
    }

    setLoading(false)
  }, [date, store])

  useEffect(() => {
    loadClosing()
  }, [loadClosing])

  function updateField(key: MoneyField, value: string) {
    setForm(current => ({ ...current, [key]: value }))
  }

  function usePaymentTotalAsTotal() {
    setForm(current => ({ ...current, totalAmount: moneyToInput(totals.paymentTotal) }))
  }

  async function saveClosing() {
    if (!user) return

    const { data: sessionData } = await supabase.auth.getSession()
    const authUser = sessionData.session?.user
    if (!authUser) {
      showToastPS('Entre com e-mail e senha para salvar o fechamento.')
      return
    }

    setSaving(true)

    const basePayload = {
      closing_date: date,
      weekday_label: weekday,
      store,
      sales_amount: input.salesAmount,
      banri_amount: input.banriAmount,
      sitef_amount: input.sitefAmount,
      pix_amount: input.pixAmount,
      cash_amount: input.cashAmount,
      site_sales_amount: input.siteSalesAmount,
      ifood_sales_amount: input.ifoodSalesAmount,
      total_amount: input.totalAmount,
      cash_withdrawal_amount: input.cashWithdrawalAmount,
      opening_cash_amount: input.openingCashAmount,
      closing_cash_amount: input.closingCashAmount,
      envelope_amount: input.envelopeAmount,
      next_day_cash_amount: input.nextDayCashAmount,
      notes: notes.trim() || null,
      updated_by: authUser.id,
      updated_by_name: user.displayName,
    }

    const result = existing
      ? await supabase
        .from('cash_closings')
        .update(basePayload)
        .eq('id', existing.id)
        .select('*')
        .single()
      : await supabase
        .from('cash_closings')
        .insert({
          ...basePayload,
          created_by: authUser.id,
          created_by_name: user.displayName,
          created_by_email: authUser.email ?? user.email ?? null,
        })
        .select('*')
        .single()

    setSaving(false)

    if (result.error) {
      showToastPS('Erro ao salvar: ' + result.error.message)
      return
    }

    const saved = result.data as CashClosingRow
    setExisting(saved)
    setForm(rowToForm(saved))
    setNotes(saved.notes ?? '')
    showToastPS(existing ? 'Fechamento atualizado.' : 'Fechamento salvo.')
    loadClosing()
  }

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <div className="ps-mark">P</div>
            <div className="ps-brand">
              <b>Fechamento de caixa</b>
              <span>Venda do dia</span>
            </div>
          </div>
          {user && (
            <div className="ps-userchip">
              <div className="ps-avatar" style={{ background: roleColor(user.role) }}>
                {user.displayName.charAt(0).toUpperCase()}
              </div>
              <b>{user.displayName}</b>
            </div>
          )}
        </header>

        <div className="ps-scroll ps-pad">
          <h1 className="ps-page-title"><DollarSign size={23} /> Caixa</h1>
          <p className="ps-page-lead">
            Lancamento diario de vendas, formas de pagamento e dinheiro fisico deixado para deposito e abertura do proximo dia.
          </p>

          <section className="ps-filters" style={{ alignItems: 'stretch' }}>
            <label className="ps-fieldgroup">
              <span className="ps-fieldlabel">Data</span>
              <input
                type="date"
                value={date}
                onChange={event => setDate(event.target.value)}
                className="ps-input"
              />
            </label>
            <label className="ps-fieldgroup">
              <span className="ps-fieldlabel">Dia da semana</span>
              <div className="ps-input" style={{ minHeight: 42, display: 'flex', alignItems: 'center', fontWeight: 700 }}>
                <Calendar size={15} style={{ marginRight: 7, color: 'var(--ink-faint)' }} />
                {weekday}
              </div>
            </label>
            <label className="ps-fieldgroup">
              <span className="ps-fieldlabel">Loja</span>
              <select
                value={store}
                onChange={event => setStore(event.target.value as StoreKey)}
                disabled={!canChangeStore}
                className="ps-select"
              >
                {STORE_OPTIONS.map(option => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </label>
          </section>

          {loadError && (
            <div className="ps-warning danger">
              <AlertTriangle size={16} />
              <span>{loadError.includes('cash_closings') ? 'A migration cash_closings ainda nao foi aplicada no Supabase.' : loadError}</span>
            </div>
          )}

          {existing && (
            <div className="ps-banner honey">
              <span>Editando fechamento ja salvo para {formatDateBR(existing.closing_date)}.</span>
              <span>Atualizado por {existing.updated_by_name || existing.created_by_name}</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '14px 0' }}>
            <div className="ps-kpi crust">
              <div className="ps-kpi-lbl">Total declarado</div>
              <div className="ps-kpi-val">{formatCurrencyBRL(totals.declaredTotal)}</div>
            </div>
            <div className="ps-kpi sage">
              <div className="ps-kpi-lbl">Meios de pagamento</div>
              <div className="ps-kpi-val">{formatCurrencyBRL(totals.paymentTotal)}</div>
            </div>
            <div className="ps-kpi honey">
              <div className="ps-kpi-lbl">Dinheiro esperado</div>
              <div className="ps-kpi-val">{formatCurrencyBRL(totals.expectedClosingCash)}</div>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 12 }}>
            <FieldGroup title="Vendas">
              {CHANNEL_FIELDS.map(field => (
                <MoneyInput
                  key={field.key}
                  label={field.label}
                  helper={field.helper}
                  value={form[field.key]}
                  onChange={value => updateField(field.key, value)}
                />
              ))}
            </FieldGroup>

            <FieldGroup title="Formas de pagamento">
              {PAYMENT_FIELDS.map(field => (
                <MoneyInput
                  key={field.key}
                  label={field.label}
                  helper={field.helper}
                  value={form[field.key]}
                  onChange={value => updateField(field.key, value)}
                />
              ))}
            </FieldGroup>

            <section className="ps-card" style={{ gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <div className="ps-fieldlabel" style={{ color: 'var(--crust)' }}>Total</div>
                <button type="button" onClick={usePaymentTotalAsTotal} className="ps-btn ghost sm">
                  <RefreshCw size={12} /> Usar soma dos meios
                </button>
              </div>
              <MoneyInput
                label="Total"
                helper="valor total anotado no papel"
                value={form.totalAmount}
                onChange={value => updateField('totalAmount', value)}
              />
            </section>

            <FieldGroup title="Dinheiro fisico">
              {CASH_FIELDS.map(field => (
                <MoneyInput
                  key={field.key}
                  label={field.label}
                  helper={field.helper}
                  value={form[field.key]}
                  onChange={value => updateField(field.key, value)}
                />
              ))}
            </FieldGroup>

            <section className="ps-card" style={{ gap: 12 }}>
              <div className="ps-fieldlabel" style={{ color: 'var(--crust)' }}>Conferencias</div>
              <CheckRow label="Total declarado - formas de pagamento" value={totals.paymentDifference} />
              <CheckRow label="Total declarado - vendas por canal" value={totals.channelDifference} />
              <CheckRow label="Caixa final - dinheiro esperado" value={totals.cashDifference} />
              <CheckRow label="Caixa final - envelope - proximo dia" value={totals.cashSplitDifference} />
            </section>

            <section className="ps-card" style={{ gap: 10 }}>
              <label className="ps-fieldgroup">
                <span className="ps-fieldlabel">Observacoes</span>
                <textarea
                  value={notes}
                  onChange={event => setNotes(event.target.value)}
                  className="ps-textarea"
                  placeholder="Opcional: explicar divergencia, problema de maquininha, deposito, etc."
                  style={{ minHeight: 88 }}
                />
              </label>
              <button type="button" onClick={saveClosing} disabled={saving || loading || !!loadError} className="ps-btn primary block">
                <Save size={16} />
                {saving ? 'Salvando...' : existing ? 'Atualizar fechamento' : 'Salvar fechamento'}
              </button>
            </section>
          </div>

          <div className="ps-section-row">
            <h2>Ultimos fechamentos</h2>
          </div>

          {history.length === 0 ? (
            <div className="ps-empty">{loading ? 'Carregando...' : 'Nenhum fechamento salvo para esta loja.'}</div>
          ) : (
            <div style={{ display: 'grid', gap: 8, marginBottom: 24 }}>
              {history.map(row => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setDate(row.closing_date)}
                  className="ps-item"
                  style={{ textAlign: 'left', cursor: 'pointer' }}
                >
                  <div className="ps-item-head">
                    <div className="ps-item-name">{formatDateBR(row.closing_date)} - {row.weekday_label}</div>
                    <span className="ps-status fechado">{formatCurrencyBRL(row.total_amount)}</span>
                  </div>
                  <div className="ps-item-meta">
                    <span><b>Loja</b> {STORE_OPTIONS.find(option => option.key === row.store)?.label ?? row.store}</span>
                    <span><b>Por</b> {row.updated_by_name || row.created_by_name}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
