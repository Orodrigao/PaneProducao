'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpenCheck, Plus, RefreshCw, Undo2 } from 'lucide-react'
import FinanceEntryForm from '@/components/FinanceEntryForm'
import FinanceRecurringPanel from '@/components/FinanceRecurringPanel'
import {
  currentMonthKey,
  entryDifference,
  entrySignedAmount,
  FINANCE_SOURCE_LABELS,
  formatCompetenceMonth,
  formatFinanceMoney,
  getFinanceErrorMessage,
  loadFinanceAccounts,
  loadFinanceCategories,
  loadFinanceEntries,
  loadFinanceRecurringRules,
  reverseFinanceEntry,
  summarizeEntries,
  FINANCE_STORE_LABELS,
  type FinanceAccountRow,
  type FinanceCategoryRow,
  type FinanceEntryRow,
  type FinanceRecurringRuleRow,
} from '@/lib/finance'
import { showToast } from '@/lib/utils'

export default function FinanceiroPage() {
  const router = useRouter()
  const [monthKey, setMonthKey] = useState(currentMonthKey())
  const [categories, setCategories] = useState<FinanceCategoryRow[]>([])
  const [accounts, setAccounts] = useState<FinanceAccountRow[]>([])
  const [entries, setEntries] = useState<FinanceEntryRow[]>([])
  const [recurringRules, setRecurringRules] = useState<FinanceRecurringRuleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [categoryRows, accountRows, entryRows, recurringRuleRows] = await Promise.all([
        loadFinanceCategories(),
        loadFinanceAccounts(),
        loadFinanceEntries(monthKey),
        loadFinanceRecurringRules(),
      ])
      setCategories(categoryRows)
      setAccounts(accountRows)
      setEntries(entryRows)
      setRecurringRules(recurringRuleRows)
    } catch (loadError) {
      console.error(loadError)
      setError('Não foi possível carregar o financeiro. Confira sua permissão e tente novamente.')
    } finally {
      setLoading(false)
    }
  }, [monthKey])

  useEffect(() => { void load() }, [load])

  const categoriesById = useMemo(
    () => new Map(categories.map(category => [category.id, category])),
    [categories],
  )
  const accountsById = useMemo(
    () => new Map(accounts.map(account => [account.id, account])),
    [accounts],
  )
  const totals = useMemo(() => summarizeEntries(entries, categoriesById), [entries, categoriesById])

  async function handleReverse(entry: FinanceEntryRow) {
    const reason = window.prompt('Por que este lançamento será estornado?')?.trim()
    if (!reason) return
    if (reason.length < 3) {
      showToast('Escreva um motivo com pelo menos 3 letras.')
      return
    }
    setBusyId(entry.id)
    try {
      await reverseFinanceEntry(entry.id, reason, crypto.randomUUID())
      showToast('Lançamento estornado. O original continua no histórico.')
      await load()
    } catch (reverseError) {
      console.error(reverseError)
      showToast(getFinanceErrorMessage(reverseError, 'Não foi possível estornar o lançamento.'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <div className="ps-mark"><BookOpenCheck size={18} /></div>
            <div className="ps-brand"><b>Financeiro</b><span>livro de entradas e saídas</span></div>
          </div>
          <button className="ps-iconbtn" onClick={() => void load()} aria-label="Atualizar lançamentos" title="Atualizar"><RefreshCw size={17} /></button>
        </header>

        <div className="ps-scroll ps-pad">
          <div className="ps-banner honey">
            <b>{formatCompetenceMonth(monthKey)}</b>
            <small>Todo dinheiro que entra ou sai é registrado aqui, com categoria. Errou? Estorne — o lançamento original nunca é apagado.</small>
          </div>

          <div className="ps-card" style={{ marginTop: 12, background: 'var(--cream-raise)' }}>
            <small>
              <b>Compra de fornecedor não se lança aqui.</b> Ela entra em{' '}
              <button className="ps-link" onClick={() => router.push('/contas-pagar')}>Contas a pagar</button>
              {' '}e aparece neste livro sozinha quando o boleto é baixado. Lançar nos dois lugares conta o gasto duas vezes.
            </small>
          </div>

          <div className="ps-fieldgroup" style={{ marginTop: 12 }}>
            <label className="ps-fieldlabel" htmlFor="finance-month">Mês</label>
            <input
              id="finance-month"
              className="ps-input"
              type="month"
              value={monthKey}
              max={currentMonthKey()}
              onChange={event => setMonthKey(event.target.value || currentMonthKey())}
            />
          </div>

          {!loading && !error && entries.length > 0 && (
            <div className="ps-card" style={{ marginTop: 12 }}>
              <div className="ps-card-head"><div><b>Resumo do mês</b><small>{entries.length} lançamento(s)</small></div></div>
              <div className="ps-fieldrow" style={{ marginTop: 8 }}>
                <div className="ps-fieldgroup"><span className="ps-fieldlabel">Entrou</span><b>{formatFinanceMoney(totals.receita)}</b></div>
                <div className="ps-fieldgroup"><span className="ps-fieldlabel">Saiu</span><b>{formatFinanceMoney(totals.despesa)}</b></div>
                <div className="ps-fieldgroup"><span className="ps-fieldlabel">Diferença</span><b>{formatFinanceMoney(totals.saldo)}</b></div>
              </div>
              <small style={{ display: 'block', marginTop: 6, opacity: 0.75 }}>
                Ainda não é o DRE — hoje só aparece aqui o que foi lançado à mão.
              </small>
            </div>
          )}

          {showForm ? (
            <FinanceEntryForm
              categories={categories}
              accounts={accounts}
              onCancel={() => setShowForm(false)}
              onSaved={async () => { setShowForm(false); await load() }}
            />
          ) : (
            <div className="ps-fieldrow" style={{ marginTop: 14 }}>
              <button className="ps-btn primary block" onClick={() => setShowForm(true)} disabled={loading || categories.length === 0}>
                <Plus size={16} /> Novo lançamento
              </button>
            </div>
          )}

          {!loading && !error && (
            <FinanceRecurringPanel
              monthKey={monthKey}
              categories={categories}
              accounts={accounts}
              entries={entries}
              rules={recurringRules}
              onChanged={load}
            />
          )}

          {error && (
            <div className="ps-card" style={{ marginTop: 14, borderColor: 'var(--berry)' }}>
              <b>{error}</b>
              <div className="ps-fieldrow" style={{ marginTop: 10 }}>
                <button className="ps-btn ghost block" onClick={() => void load()}>Tentar de novo</button>
              </div>
            </div>
          )}

          {loading && <div className="ps-card" style={{ marginTop: 14 }}><b>Carregando lançamentos...</b></div>}

          {!loading && !error && entries.length === 0 && (
            <div className="ps-card" style={{ marginTop: 14 }}>
              <b>Nenhum lançamento em {formatCompetenceMonth(monthKey)}.</b>
              <small style={{ display: 'block', marginTop: 4 }}>Toque em “Novo lançamento” para registrar a primeira entrada ou saída do mês.</small>
            </div>
          )}

          {!loading && !error && entries.map(entry => {
            const category = categoriesById.get(entry.category_id)
            const account = entry.account_id ? accountsById.get(entry.account_id) : null
            const isReversal = entry.entry_type === 'estorno'
            const isReversed = entry.reversed_at !== null
            // O estorno devolve o dinheiro: o sinal é o do efeito no caixa,
            // não o da natureza da categoria.
            const signed = category ? entrySignedAmount(entry, category.nature) : 0
            const isInflow = signed >= 0
            const difference = entryDifference(entry)
            return (
              <article
                key={entry.id}
                className="ps-card"
                style={{ marginTop: 12, opacity: isReversed || isReversal ? 0.72 : 1 }}
              >
                <div className="ps-card-head">
                  <div>
                    <b>{entry.description}</b>
                    <small>
                      {category?.label ?? 'Categoria removida'} · {FINANCE_STORE_LABELS[entry.store]} · {account?.label ?? 'conta não informada'}
                    </small>
                  </div>
                  <b style={{ color: isInflow ? 'var(--basil)' : 'var(--berry)' }}>
                    {isInflow ? '+' : '−'} {formatFinanceMoney(entry.amount)}
                  </b>
                </div>

                <small style={{ display: 'block', marginTop: 6 }}>
                  {entry.paid_date}
                  {entry.source !== 'avulso' && ` · veio de ${FINANCE_SOURCE_LABELS[entry.source]}`}
                  {entry.competence_month.slice(0, 7) !== entry.paid_date.slice(0, 7)
                    && ` · pesa em ${formatCompetenceMonth(entry.competence_month.slice(0, 7))}`}
                </small>

                {difference !== 0 && !isReversal && (
                  <small style={{ display: 'block', marginTop: 4, color: 'var(--berry)' }}>
                    {difference > 0
                      ? `Pagou ${formatFinanceMoney(difference)} a mais que o previsto (juros ou multa).`
                      : `Pagou ${formatFinanceMoney(-difference)} a menos que o previsto.`}
                  </small>
                )}

                {isReversal && (
                  <div className="ps-alert" role="note" style={{ marginTop: 8 }}>
                    Estorno · motivo: {entry.reversal_reason}
                  </div>
                )}
                {isReversed && !isReversal && (
                  <div className="ps-alert" role="note" style={{ marginTop: 8 }}>
                    Estornado · motivo: {entry.reversal_reason}
                  </div>
                )}

                {!isReversal && !isReversed && (entry.source === 'avulso' || entry.source === 'recorrencia') && (
                  <div className="ps-fieldrow" style={{ marginTop: 10 }}>
                    <button
                      className="ps-btn ghost block"
                      onClick={() => void handleReverse(entry)}
                      disabled={busyId === entry.id}
                    >
                      <Undo2 size={15} /> {busyId === entry.id ? 'Estornando...' : entry.source === 'recorrencia' ? 'Estornar confirmação' : 'Estornar'}
                    </button>
                  </div>
                )}

                {/* Lançamento gerado por outra tela se corrige lá, senão o
                    livro e a origem passam a contar histórias diferentes. */}
                {!isReversal && !isReversed && entry.source === 'contas_pagar' && (
                  <div className="ps-fieldrow" style={{ marginTop: 10 }}>
                    <button className="ps-btn ghost block" onClick={() => router.push('/contas-pagar')}>
                      Corrigir em Contas a pagar
                    </button>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      </div>
    </div>
  )
}
