'use client'

import { useEffect, useState } from 'react'
import { Package } from 'lucide-react'
import { SupabaseRestError, supabaseRestFetch } from '@/lib/supabaseRest'
import { formatDateBR, todayKey } from '@/lib/utils'
import {
  buildSentSummary,
  catalogUnitFromBreadUnit,
  formatQty,
  type SentSummaryCatalogUnits,
  type SentSummary,
  type SentSummaryCell,
  type SentSummaryItem,
  type SentSummaryRomaneio,
} from '@/lib/romaneioSentSummary'
import type { RomaneioBillingUnit } from '@/lib/romaneioBilling'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'limit' }
  | { kind: 'ready'; summary: SentSummary }

async function fetchJson<T>(path: string): Promise<T> {
  const res = await supabaseRestFetch(path)
  return res.json() as Promise<T>
}

// Teto de linhas por consulta do Supabase (max_rows). Chegar nele significa
// que a lista pode ter vindo cortada: melhor avisar do que somar a menos.
const ROW_LIMIT = 1000

class RowLimitError extends Error {}

async function loadSummary(date: string): Promise<SentSummary> {
  const romaneios = await fetchJson<SentSummaryRomaneio[]>(
    `romaneios?record_date=eq.${date}&select=id,status,destinations(name,code)`,
  )
  if (romaneios.length === 0) return buildSentSummary([], [])
  const ids = romaneios.map(r => r.id).join(',')
  const items = await fetchJson<SentSummaryItem[]>(
    `romaneio_items?romaneio_id=in.(${ids})&select=romaneio_id,product_id,product_source,product_name,qty_sent&order=id.asc&limit=${ROW_LIMIT}`,
  )
  if (items.length >= ROW_LIMIT) throw new RowLimitError('lista de itens possivelmente incompleta')
  const breadIds = [...new Set(items.filter(i => i.product_source === 'bread' && i.product_id).map(i => i.product_id))]
  const catalogUnits: SentSummaryCatalogUnits = {}
  if (breadIds.length) {
    const breads = await fetchJson<{ id: string; unit: string | null }[]>(`breads?id=in.(${breadIds.join(',')})&select=id,unit`)
    for (const bread of breads) catalogUnits[bread.id] = catalogUnitFromBreadUnit(bread.unit)
  }
  return buildSentSummary(romaneios, items, catalogUnits)
}

function Cell({ cell, unit, strong }: { cell?: SentSummaryCell; unit: RomaneioBillingUnit; strong?: boolean }) {
  if (!cell || cell.total === 0) return <td className="num" style={{ color: 'var(--ink-faint)' }}>–</td>
  return (
    <td className="num" style={strong ? { fontWeight: 800 } : undefined}>
      {formatQty(cell.total)}{unit === 'kg' ? ' kg' : ''}
      {cell.pending > 0 && (
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--amber)' }} title="Ainda em romaneio separado, não saiu">
          {formatQty(cell.pending)}{unit === 'kg' ? ' kg' : ''} não saiu
        </div>
      )}
    </td>
  )
}

export default function RomaneioSentSummary({
  onOpenBilling,
  onSessionExpired,
}: {
  onOpenBilling: () => void
  onSessionExpired: () => void
}) {
  const [date, setDate] = useState(todayKey())
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    // Campo vazio no meio da digitação: espera a data completa.
    if (!date) return
    let cancelled = false
    setState({ kind: 'loading' })
    loadSummary(date)
      .then(summary => { if (!cancelled) setState({ kind: 'ready', summary }) })
      .catch(error => {
        if (cancelled) return
        if (error instanceof SupabaseRestError && error.status === 401) { onSessionExpired(); return }
        setState({ kind: error instanceof RowLimitError ? 'limit' : 'error' })
      })
    return () => { cancelled = true }
  }, [date, reloadKey, onSessionExpired])

  // Troca o dia já em "carregando" para nunca exibir números do dia anterior.
  const changeDate = (next: string) => {
    setState({ kind: 'loading' })
    setDate(next)
  }

  // Sem data completa no campo, não mostra números de outro dia.
  const shown: LoadState | null = date ? state : null
  const summary = shown?.kind === 'ready' ? shown.summary : null

  return (
    <>
      <div className="ps-label">Pães enviados às lojas</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="ps-fieldgroup" style={{ maxWidth: 220 }}>
          <span style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 600 }}>Dia</span>
          <input
            className="ps-input"
            type="date"
            value={date}
            max={todayKey()}
            onChange={e => changeDate(e.target.value)}
          />
        </label>
        {date !== todayKey() && date !== '' && (
          <button className="ps-btn ghost sm" onClick={() => changeDate(todayKey())}>Voltar para hoje</button>
        )}
      </div>

      {shown?.kind === 'loading' && (
        <div className="ps-empty" role="status">Somando os romaneios de {formatDateBR(date)}…</div>
      )}

      {shown?.kind === 'error' && (
        <div className="ps-warning" role="alert" style={{ marginTop: 12 }}>
          Não foi possível carregar os romaneios de {formatDateBR(date)}.{' '}
          <button className="ps-btn ghost sm" onClick={() => setReloadKey(k => k + 1)}>Tentar de novo</button>
        </div>
      )}

      {shown?.kind === 'limit' && (
        <div className="ps-warning" role="alert" style={{ marginTop: 12 }}>
          Os romaneios de {formatDateBR(date)} passam de {ROW_LIMIT.toLocaleString('pt-BR')} linhas de itens,
          acima do que esta tela consegue somar. Para não mostrar um total menor que o real, a soma não foi exibida.
        </div>
      )}

      {summary && summary.rows.length === 0 && (
        <div className="ps-empty">
          <Package size={36} style={{ display: 'block', margin: '0 auto 8px', opacity: .4 }} />
          Nenhum pão em romaneio em {formatDateBR(date)}.
        </div>
      )}

      {summary && summary.rows.length > 0 && (
        <>
          <div style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '12px 0 8px', lineHeight: 1.5 }}>
            {summary.romaneioCount} {summary.romaneioCount === 1 ? 'romaneio' : 'romaneios'} em {formatDateBR(date)}
            {summary.pendingRomaneioCount > 0 && (
              <> · <b style={{ color: 'var(--amber)' }}>{summary.pendingRomaneioCount} ainda separado{summary.pendingRomaneioCount === 1 ? '' : 's'}</b> (montado, não saiu)</>
            )}
          </div>
          <div className="ps-table-wrap" style={{ overflowX: 'auto' }}>
            <table className="ps-table">
              <thead>
                <tr>
                  <th>Produto</th>
                  {summary.stores.map(s => <th key={s.code} className="num" title={s.name}>{s.code}</th>)}
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map(row => (
                  <tr key={row.key}>
                    <td>
                      {row.productName}
                      {row.isExtra && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--ink-faint)', fontWeight: 600 }}>extra</span>}
                    </td>
                    {summary.stores.map(s => <Cell key={s.code} cell={row.byStore[s.code]} unit={row.unit} />)}
                    <Cell cell={row.total} unit={row.unit} strong />
                  </tr>
                ))}
                {summary.totals.map(t => (
                  <tr key={t.unit} className="total">
                    <td>{summary.totals.length > 1 ? (t.unit === 'kg' ? 'Total em kg' : 'Total em unidades') : 'Total'}</td>
                    {summary.stores.map(s => <Cell key={s.code} cell={t.byStore[s.code]} unit={t.unit} />)}
                    <Cell cell={t.total} unit={t.unit} strong />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-faint)', marginTop: 8, lineHeight: 1.5 }}>
            Quantidade que saiu da produção. O que a loja recusou na conferência aparece em Divergências.
          </div>
        </>
      )}

      <div className="ps-card" style={{ marginTop: 16 }}>
        <div className="ps-pname">Cobrança da EX</div>
        <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
          Esta tabela mostra só quantidades. O valor cobrado da EX continua em
          {' '}<b>Relatórios → Romaneios EX</b>, com os preços da Tabela Buck.
        </div>
        <button className="ps-btn ghost block" style={{ marginTop: 12 }} onClick={onOpenBilling}>
          Abrir fechamento da EX
        </button>
      </div>
    </>
  )
}
