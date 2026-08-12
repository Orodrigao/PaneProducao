'use client'

import { useMemo, useRef, useState } from 'react'
import { Save, X } from 'lucide-react'
import { showToast } from '@/lib/utils'
import {
  createFinanceEntry,
  emptyFinanceDraft,
  FINANCE_PAYMENT_LABELS,
  FINANCE_STORE_LABELS,
  formatCompetenceMonth,
  getFinanceErrorMessage,
  validateFinanceDraft,
  type FinanceAccountRow,
  type FinanceCategoryRow,
  type FinanceEntryDraft,
  type FinancePaymentMethod,
  type FinanceStore,
} from '@/lib/finance'
import { todayKey } from '@/lib/utils'

interface FinanceEntryFormProps {
  categories: readonly FinanceCategoryRow[]
  accounts: readonly FinanceAccountRow[]
  onCancel: () => void
  onSaved: () => Promise<void> | void
}

const GROUP_LABELS: Record<string, string> = {
  receita: 'Entradas',
  cmv: 'Mercadoria (CMV)',
  mao_de_obra: 'Gente',
  ocupacao: 'Ocupação',
  impostos: 'Impostos',
  taxas: 'Taxas',
  manutencao: 'Manutenção',
  servicos: 'Serviços',
  financeiras: 'Financeiras',
  outras: 'Outras',
  emprestimos: 'Empréstimos',
  investimento: 'Investimento',
  retiradas: 'Retiradas',
}

export default function FinanceEntryForm({ categories, accounts, onCancel, onSaved }: FinanceEntryFormProps) {
  const [draft, setDraft] = useState<FinanceEntryDraft>(emptyFinanceDraft())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // O mesmo identificador em toda tentativa deste formulário: toque duplo ou
  // reenvio devolve o lançamento já criado, nunca um segundo.
  const requestIdRef = useRef<string>(crypto.randomUUID())

  function update(patch: Partial<FinanceEntryDraft>) {
    setDraft(current => ({ ...current, ...patch }))
    setError(null)
  }

  const grouped = useMemo(() => {
    const groups = new Map<string, FinanceCategoryRow[]>()
    for (const category of categories) {
      if (category.nature === 'transferencia') continue
      const list = groups.get(category.dre_group) ?? []
      list.push(category)
      groups.set(category.dre_group, list)
    }
    return [...groups.entries()]
  }, [categories])

  const availableAccounts = useMemo(() => {
    if (!draft.store || draft.store === 'geral') return accounts.filter(account => account.kind === 'banco')
    return accounts.filter(account => account.kind === 'banco' || account.store === draft.store)
  }, [accounts, draft.store])

  const selectedCategory = categories.find(category => category.key === draft.categoryKey) ?? null

  async function save() {
    const validationError = validateFinanceDraft(draft, todayKey())
    if (validationError) {
      setError(validationError)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await createFinanceEntry(draft, requestIdRef.current)
      showToast('Lançamento registrado.')
      await onSaved()
    } catch (saveError) {
      console.error(saveError)
      setError(getFinanceErrorMessage(saveError, 'Não foi possível salvar o lançamento.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="ps-card" style={{ marginTop: 14 }}>
      <div className="ps-card-head">
        <div>
          <b>Novo lançamento</b>
          <small>{selectedCategory?.nature === 'receita' ? 'Entrada de dinheiro' : 'Saída de dinheiro'} · pesa em {formatCompetenceMonth(draft.paidDate.slice(0, 7))}</small>
        </div>
        <button type="button" className="ps-iconbtn" onClick={onCancel} aria-label="Fechar lançamento"><X size={16} /></button>
      </div>

      {error && <div className="ps-alert error" role="alert" style={{ marginTop: 12 }}>{error}</div>}

      <div className="ps-fieldgroup" style={{ marginTop: 14 }}>
        <label className="ps-fieldlabel" htmlFor="finance-category">Categoria *</label>
        <select
          id="finance-category"
          className="ps-select"
          value={draft.categoryKey}
          onChange={event => update({ categoryKey: event.target.value })}
        >
          <option value="">Escolha a categoria</option>
          {grouped.map(([group, items]) => (
            <optgroup key={group} label={GROUP_LABELS[group] ?? group}>
              {items.map(category => <option key={category.key} value={category.key}>{category.label}</option>)}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="ps-fieldrow">
        <div className="ps-fieldgroup">
          <label className="ps-fieldlabel" htmlFor="finance-amount">Valor *</label>
          <input
            id="finance-amount"
            className="ps-input"
            inputMode="decimal"
            placeholder="0,00"
            value={draft.amount}
            onChange={event => update({ amount: event.target.value })}
          />
        </div>
        <div className="ps-fieldgroup">
          <label className="ps-fieldlabel" htmlFor="finance-date">Data *</label>
          <input
            id="finance-date"
            className="ps-input"
            type="date"
            max={todayKey()}
            value={draft.paidDate}
            onChange={event => update({ paidDate: event.target.value })}
          />
        </div>
      </div>

      <div className="ps-fieldrow">
        <div className="ps-fieldgroup">
          <label className="ps-fieldlabel" htmlFor="finance-store">Loja *</label>
          <select
            id="finance-store"
            className="ps-select"
            value={draft.store}
            onChange={event => update({ store: event.target.value as FinanceStore | '', accountKey: '' })}
          >
            <option value="">Escolha a loja</option>
            {(['jc', 'ja', 'geral'] as FinanceStore[]).map(store => (
              <option key={store} value={store}>{FINANCE_STORE_LABELS[store]}</option>
            ))}
          </select>
        </div>
        <div className="ps-fieldgroup">
          <label className="ps-fieldlabel" htmlFor="finance-account">Saiu de *</label>
          <select
            id="finance-account"
            className="ps-select"
            value={draft.accountKey}
            onChange={event => update({ accountKey: event.target.value })}
            disabled={!draft.store}
          >
            <option value="">{draft.store ? 'Escolha a conta' : 'Escolha a loja antes'}</option>
            {availableAccounts.map(account => (
              <option key={account.key} value={account.key}>{account.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="ps-fieldrow">
        <div className="ps-fieldgroup">
          <label className="ps-fieldlabel" htmlFor="finance-method">Forma *</label>
          <select
            id="finance-method"
            className="ps-select"
            value={draft.paymentMethod}
            onChange={event => update({ paymentMethod: event.target.value as FinancePaymentMethod })}
          >
            {(Object.keys(FINANCE_PAYMENT_LABELS) as FinancePaymentMethod[]).map(method => (
              <option key={method} value={method}>{FINANCE_PAYMENT_LABELS[method]}</option>
            ))}
          </select>
        </div>
        <div className="ps-fieldgroup">
          <label className="ps-fieldlabel" htmlFor="finance-description">Descrição *</label>
          <input
            id="finance-description"
            className="ps-input"
            placeholder="Ex.: diária do Marcelo"
            value={draft.description}
            onChange={event => update({ description: event.target.value })}
          />
        </div>
      </div>

      <div className="ps-fieldrow" style={{ marginTop: 14 }}>
        <button type="button" className="ps-btn primary block" onClick={() => void save()} disabled={saving}>
          <Save size={16} /> {saving ? 'Salvando...' : 'Salvar lançamento'}
        </button>
        <button type="button" className="ps-btn ghost block" onClick={onCancel} disabled={saving}>Cancelar</button>
      </div>
    </section>
  )
}
