'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  entryDifference, entrySignedAmount, FINANCE_STORE_LABELS, financeSourceLabel, formatCompetenceMonth,
  formatFinanceMoney, loadFinanceAccounts, loadFinanceCategories, loadFirstFinanceDate,
  loadInstallmentFinanceEntries, loadLedgerPaymentPage, loadLedgerSearchIdentities, transferLegIsInflow,
  type FinanceAccountRow, type FinanceCategoryRow, type FinanceEntryRow, type LedgerPaymentResult,
} from '@/lib/finance'
import {
  createSearchSequence, ledgerMatchReasons, parsePaymentSearch, searchMonth, uniqueLedgerPayments,
  type LedgerSearchIdentity, type PaymentSearchCriteria,
} from '@/lib/financeSearch'
import { bakeryDayKey } from '@/lib/bakeryClock'
import { effectiveDueDate, formatDate, loadPayablePurchases, supplierNameOf } from '@/lib/payables'
import { searchPayableInstallments, type PayableSearchResult } from '@/lib/payablesSearch'

interface Props {
  canOpenPayables: boolean
  restrictedStores: boolean
  refresh: number
  onActive: (active: boolean) => void
  onOpenMonth: (month: string) => void
}
interface Part<T> { data: T; loading: boolean; error: boolean }
interface PayablesData { matches: PayableSearchResult[]; entries: FinanceEntryRow[] }
const emptyPayables = (): PayablesData => ({ matches: [], entries: [] })
const initialCriteria = (): PaymentSearchCriteria => ({ term: '', period: 'all', date: 'paid_date', month: bakeryDayKey().slice(0, 7) })

export default function FinanceSearchPanel({ canOpenPayables, restrictedStores, refresh, onActive, onOpenMonth }: Props) {
  const [draft, setDraft] = useState(initialCriteria)
  const [criteria, setCriteria] = useState<PaymentSearchCriteria | null>(null)
  const [payables, setPayables] = useState<Part<PayablesData>>({ data: emptyPayables(), loading: false, error: false })
  const [ledger, setLedger] = useState<Part<LedgerPaymentResult[]>>({ data: [], loading: false, error: false })
  const [identities, setIdentities] = useState<LedgerSearchIdentity[]>([])
  const [accounts, setAccounts] = useState<FinanceAccountRow[]>([])
  const [categories, setCategories] = useState<FinanceCategoryRow[]>([])
  const [firstDate, setFirstDate] = useState<string | null>(null)
  const [firstDateError, setFirstDateError] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [sequence] = useState(createSearchSequence)
  const latestDraft = useRef(draft)
  const hasSearch = useRef(false)

  const start = useCallback(async (next: PaymentSearchCriteria) => {
    if (next.term.trim().length < 2 || (next.period === 'chosen' && !/^\d{4}-\d{2}$/.test(next.month))) return
    const ticket = sequence.next()
    hasSearch.current = true
    onActive(true)
    setCriteria(next)
    setDirty(false)
    setIdentities([])
    setLedger({ data: [], loading: true, error: false })
    setPayables({ data: emptyPayables(), loading: canOpenPayables, error: false })
    setFirstDate(null)
    setFirstDateError(false)
    void loadFirstFinanceDate().then(date => {
      if (sequence.isCurrent(ticket)) setFirstDate(date)
    }).catch(() => { if (sequence.isCurrent(ticket)) setFirstDateError(true) })
    const labels = Promise.all([loadFinanceAccounts(true), loadFinanceCategories(true)]).then(([allAccounts, allCategories]) => {
      if (sequence.isCurrent(ticket)) { setAccounts(allAccounts); setCategories(allCategories) }
    })
    // Cada parte trata sua própria falha. A falha de parcelas não apaga o livro.
    const payableRead = canOpenPayables ? (async () => {
      const matches = searchPayableInstallments(await loadPayablePurchases(), next)
      const entries = await loadInstallmentFinanceEntries(matches.map(match => match.installment.id))
      await labels
      return { matches, entries }
    })() : Promise.resolve(emptyPayables())
    const payableOutcome = payableRead.then(data => {
      if (sequence.isCurrent(ticket)) setPayables({ data, loading: false, error: false })
      return data
    }).catch(() => {
      if (sequence.isCurrent(ticket)) setPayables({ data: emptyPayables(), loading: false, error: true })
      return emptyPayables()
    })
    try {
      const [rows, found] = await Promise.all([loadLedgerSearchIdentities(next), payableOutcome, labels])
      if (!sequence.isCurrent(ticket)) return
      const payments = uniqueLedgerPayments(rows, new Set(found.matches.map(match => match.installment.id)))
      const data = await loadLedgerPaymentPage(payments, 0)
      if (!sequence.isCurrent(ticket)) return
      setIdentities(payments)
      setLedger({ data, loading: false, error: false })
    } catch {
      if (sequence.isCurrent(ticket)) setLedger({ data: [], loading: false, error: true })
    }
  }, [canOpenPayables, onActive, sequence])

  useEffect(() => {
    const term = new URLSearchParams(window.location.search).get('busca') ?? ''
    if (term.trim().length >= 2) {
      const next = { ...initialCriteria(), term }
      latestDraft.current = next
      setDraft(next)
      void start(next)
    }
    return () => { sequence.next() }
  }, [start, sequence])

  useEffect(() => {
    if (refresh > 0 && hasSearch.current) void start(latestDraft.current)
  }, [refresh, start])

  function change(next: PaymentSearchCriteria, run = false) {
    latestDraft.current = next
    setDraft(next)
    sequence.next()
    setLedger({ data: [], loading: false, error: false })
    setPayables({ data: emptyPayables(), loading: false, error: false })
    setIdentities([])
    setDirty(hasSearch.current)
    if (run && hasSearch.current) void start(next)
  }

  function clear() {
    sequence.next()
    hasSearch.current = false
    setCriteria(null)
    change(initialCriteria())
    setDirty(false)
    onActive(false)
    const url = new URL(window.location.href)
    url.searchParams.delete('busca')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }

  async function more() {
    const ticket = sequence.next()
    const previous = ledger.data
    setLedger({ data: previous, loading: true, error: false })
    try {
      const page = await loadLedgerPaymentPage(identities, previous.length)
      if (sequence.isCurrent(ticket)) setLedger({ data: [...previous, ...page], loading: false, error: false })
    } catch {
      if (sequence.isCurrent(ticket)) setLedger({ data: previous, loading: false, error: true })
    }
  }

  const accountName = (id: string | null) => accounts.find(account => account.id === id)?.label ?? 'Banco não informado'
  const categoryOf = (entry: FinanceEntryRow) => categories.find(category => category.id === entry.category_id)
  const busy = ledger.loading || payables.loading
  const disabledReason = draft.term.trim().length < 2 ? 'Digite pelo menos 2 caracteres.'
    : draft.period === 'chosen' && !/^\d{4}-\d{2}$/.test(draft.month) ? 'Escolha o mês.'
      : busy ? 'Aguarde a busca ou altere os critérios.' : null
  const empty = criteria && !dirty && !busy && !ledger.error && !payables.error && !ledger.data.length && !payables.data.matches.length
  const reasonsTerm = parsePaymentSearch(criteria?.term ?? '')

  function entryDetails(entry: FinanceEntryRow) {
    const category = categoryOf(entry)
    const inflow = entry.transfer_id ? transferLegIsInflow(entry)
      : category ? entrySignedAmount(entry, category.nature) >= 0 : null
    return <div key={entry.id} style={{ marginTop: 8 }}>
      <b>{entry.description}</b>
      <div>Pago em {formatDate(entry.paid_date)} · {inflow === null ? 'Sinal não identificado: ' : inflow ? '+' : '−'}{formatFinanceMoney(Number(entry.amount))}</div>
      <small>{accountName(entry.account_id)} · {FINANCE_STORE_LABELS[entry.store] ?? entry.store} · {category?.label ?? 'Categoria não identificada'} · {financeSourceLabel(entry.source)}</small>
      {entry.competence_month.slice(0, 7) !== entry.paid_date.slice(0, 7) && <div>Conta do mês: {formatCompetenceMonth(entry.competence_month)}</div>}
      {entryDifference(entry) !== 0 && <div>Previsto {formatFinanceMoney(Number(entry.planned_amount))} · pago {formatFinanceMoney(Number(entry.amount))}</div>}
      {(entry.reversed_at || entry.entry_type === 'estorno') && <div className="ps-alert">{entry.entry_type === 'estorno' ? 'Estorno' : 'Estornado'} · motivo: {entry.reversal_reason ?? 'não informado'}</div>}
      <button type="button" className="ps-link" onClick={() => { clear(); onOpenMonth(entry.competence_month.slice(0, 7)) }}>Ver no livro de {formatCompetenceMonth(entry.competence_month)}</button>
    </div>
  }

  return <section className="ps-card" style={{ marginTop: 12 }} aria-label="Buscar pagamento">
    <form onSubmit={event => { event.preventDefault(); if (!disabledReason) void start(draft) }}>
      <label className="ps-fieldlabel" htmlFor="finance-search">Buscar pagamento</label>
      <input id="finance-search" className="ps-input" value={draft.term} onChange={event => change({ ...draft, term: event.target.value })}
        placeholder="Nome, descrição, nº ou chave da nota, ou valor (ex.: 1.250,00)" aria-describedby="finance-search-help" />
      <div className="ps-fieldrow" style={{ marginTop: 8 }}>
        <button className="ps-btn primary" disabled={!!disabledReason}>Buscar</button>
        {criteria && <button type="button" className="ps-btn ghost" onClick={clear}>Limpar busca</button>}
      </div>
      <small id="finance-search-help">{disabledReason}</small>
      <div className="ps-fieldrow" style={{ marginTop: 10, flexWrap: 'wrap' }}>
        <label className="ps-fieldgroup">Período
          <select className="ps-input" value={draft.period} onChange={event => change({ ...draft, period: event.target.value as PaymentSearchCriteria['period'] }, true)}>
            <option value="all">Tudo</option><option value="current">Este mês</option><option value="previous">Mês passado</option><option value="chosen">Escolher mês</option>
          </select>
        </label>
        {draft.period === 'chosen' && <label className="ps-fieldgroup">Mês da busca<input className="ps-input" type="month" value={draft.month} onChange={event => change({ ...draft, month: event.target.value }, true)} /></label>}
        <label className="ps-fieldgroup">Qual data vale
          <select className="ps-input" value={draft.date} onChange={event => change({ ...draft, date: event.target.value as PaymentSearchCriteria['date'] }, true)}>
            <option value="paid_date">Pago em</option><option value="competence_month">Conta do mês</option>
          </select>
        </label>
      </div>
    </form>
    {!canOpenPayables && <p>Busca nas parcelas do Contas a pagar disponível para quem acessa o Contas a pagar</p>}
    {dirty && <p role="status">Critérios alterados. Toque em Buscar.</p>}
    {criteria && !dirty && <div aria-live="polite">
      <p>Filtros ativos: “{criteria.term}” · {searchMonth(criteria) ? formatCompetenceMonth(searchMonth(criteria)!) : 'Tudo'} · {criteria.date === 'paid_date' ? 'Pago em' : 'Conta do mês'}{restrictedStores && ' · nas lojas que você acessa'}</p>
      <button type="button" className="ps-link" onClick={() => { const next = { ...initialCriteria(), term: draft.term }; change(next); void start(next) }}>Limpar filtros</button>
      {empty && <p><b>Nenhum registro encontrado com estes critérios{restrictedStores ? ', nas lojas que você acessa' : ''}. Isso não confirma que não foi pago.</b></p>}
      {firstDate && <p>Há lançamentos no livro a partir de {formatDate(firstDate)}</p>}
      {firstDateError && <p>Não foi possível consultar a data do primeiro lançamento.</p>}
      {empty && canOpenPayables && <a className="ps-link" href={`/contas-pagar?busca=${encodeURIComponent(criteria.term)}`}>Buscar “{criteria.term}” em Contas a pagar</a>}
      {canOpenPayables && <section aria-label="No Contas a pagar">
        <h3>No Contas a pagar{!payables.loading && !payables.error && ` (${payables.data.matches.length})`}</h3>
        {payables.loading && <p>Buscando...</p>}
        {payables.error && <p role="alert">Não foi possível buscar agora no Contas a pagar. <button className="ps-link" onClick={() => void start(draft)}>Tentar de novo</button></p>}
        {payables.data.matches.map(({ purchase, installment, reasons }) => {
          const entries = payables.data.entries.filter(entry => entry.source_ref === installment.id)
          const active = entries.filter(entry => entry.entry_type === 'lancamento' && !entry.reversed_at)
          const banks = [...new Set(active.map(entry => accountName(entry.account_id)))].join(', ') || 'Banco não informado'
          const due = effectiveDueDate(installment)
          return <article key={installment.id} className="ps-card" style={{ marginTop: 8 }}>
            <b>{supplierNameOf(purchase)} · {purchase.nfe_number ? `NF ${purchase.nfe_number}` : 'Sem nº de nota'} · parcela {installment.installment_number} de {purchase.payable_installments.length}</b>
            <p><strong>{installment.status === 'paga'
              ? `Paga em ${installment.paid_date ? formatDate(installment.paid_date) : 'data não informada'} · ${installment.paid_amount != null ? formatFinanceMoney(Number(installment.paid_amount)) : 'Valor pago não informado'} · ${banks}`
              : installment.status === 'cancelada' ? 'Cancelada'
                : `Em aberto · ${due < bakeryDayKey() ? 'venceu' : 'vence'} em ${formatDate(due)}`}</strong></p>
            {due !== installment.due_date && <p>Vencimento original: {formatDate(installment.due_date)}</p>}
            <small>Encontrado por: {reasons.join(', ')}</small>
            {installment.status === 'paga' && <div>
              <p>Composição no livro</p>
              {active.map(entry => <div key={entry.id}>{categoryOf(entry)?.label ?? 'Categoria não identificada'} · {formatFinanceMoney(Number(entry.amount))}</div>)}
              {!active.length && <p>Sem linhas ativas visíveis no livro; a situação acima vem da parcela.</p>}
              {entries.filter(entry => entry.entry_type === 'lancamento' && entry.reversed_at).map(entry => <div key={entry.id}>Histórico: classificação corrigida em {formatDate(bakeryDayKey(new Date(entry.reversed_at!)))} · {categoryOf(entry)?.label ?? 'Categoria não identificada'} · {formatFinanceMoney(Number(entry.amount))}{entry.reversal_reason && ` · ${entry.reversal_reason}`}</div>)}
            </div>}
            <a className="ps-btn ghost" href={`/contas-pagar?purchase=${encodeURIComponent(purchase.id)}&installment=${encodeURIComponent(installment.id)}`}>Ver a conta</a>
          </article>
        })}
      </section>}
      <section aria-label="No livro">
        <h3>No livro</h3>
        {ledger.loading && <p role="status">Buscando...</p>}
        {ledger.error && <p role="alert">Não foi possível buscar agora no livro. <button className="ps-link" onClick={() => ledger.data.length ? void more() : void start(draft)}>Tentar de novo</button></p>}
        {!ledger.error && !ledger.loading && <p>{ledger.data.length} de {identities.length} pagamento(s)</p>}
        {ledger.data.map(payment => {
          const grouped = payment.key.startsWith('payable:')
          const active = payment.entries.filter(entry => entry.entry_type === 'lancamento' && !entry.reversed_at)
          const cents = active.reduce((sum, entry) => sum + Math.round(Number(entry.amount) * 100), 0)
          const reasons = [...new Set(payment.entries.flatMap(entry => ledgerMatchReasons(entry, reasonsTerm)))]
          return <article className="ps-card" key={payment.key} style={{ marginTop: 8 }}>
            {grouped && <b>Pagamento do Contas a pagar · {active.length ? formatFinanceMoney(cents / 100) : 'Sem linhas ativas visíveis'} (soma das linhas ativas)</b>}
            <small style={{ display: 'block' }}>Encontrado por: {reasons.join(', ') || 'descrição'}</small>
            {payment.entries.map(entryDetails)}
          </article>
        })}
        {ledger.data.length < identities.length && !ledger.error && <button className="ps-btn ghost" disabled={ledger.loading} onClick={() => void more()}>Mostrar mais</button>}
      </section>
    </div>}
  </section>
}
