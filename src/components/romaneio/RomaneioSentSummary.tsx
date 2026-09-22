'use client'

import { useEffect, useState } from 'react'
import { Package } from 'lucide-react'
import { supabaseRestFetch } from '@/lib/supabaseRest'
import { formatDateBR, todayKey } from '@/lib/utils'
import {
  buildSentSummary,
  formatQty,
  type SentSummary,
  type SentSummaryCell,
  type SentSummaryItem,
  type SentSummaryRomaneio,
} from '@/lib/romaneioSentSummary'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; summary: SentSummary }

async function fetchJson<T>(path: string): Promise<T> {
  const res = await supabaseRestFetch(path)
  return res.json() as Promise<T>
}

async function loadSummary(date: string): Promise<SentSummary> {
  const romaneios = await fetchJson<SentSummaryRomaneio[]>(
    `romaneios?record_date=eq.${date}&select=id,status,destinations(name,code)`,
  )
  if (romaneios.length === 0) return buildSentSummary([], [])
  const ids = romaneios.map(r => r.id).join(',')
  const items = await fetchJson<SentSummaryItem[]>(
    `romaneio_items?romaneio_id=in.(${ids})&select=romaneio_id,product_id,product_source,product_name,qty_sent`,
  )
  return buildSentSummary(romaneios, items)
}

function Cell({ cell, strong }: { cell?: SentSummaryCell; strong?: boolean }) {
  if (!cell || cell.total === 0) return <td className="num" style={{ color: 'var(--ink-faint)' }}>–</td>
  return (
    <td className="num" style={strong ? { fontWeight: 800 } : undefined}>
      {formatQty(cell.total)}
      {cell.pending > 0 && (
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--amber)' }} title="Ainda em romaneio separado, não saiu">
          {formatQty(cell.pending)} não saiu
        </div>
      )}
    </td>
  )
}

export default function RomaneioSentSummary({ onOpenBilling }: { onOpenBilling: () => void }) {
  const [date, setDate] = useState(todayKey())
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!date) return
    let cancelled = false
    setState({ kind: 'loading' })
    loadSummary(date)
      .then(summary => { if (!cancelled) setState({ kind: 'ready', summary }) })
      .catch(() => { if (!cancelled) setState({ kind: 'error' }) })
    return () => { cancelled = true }
  }, [date, reloadKey])

  const summary = state.kind === 'ready' ? state.summary : null

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
            onChange={e => setDate(e.target.value || todayKey())}
          />
        </label>
        {date !== todayKey() && (
          <button className="ps-btn ghost sm" onClick={() => setDate(todayKey())}>Voltar para hoje</button>
        )}
      </div>

      {state.kind === 'loading' && (
        <div className="ps-empty" role="status">Somando os romaneios de {formatDateBR(date)}…</div>
      )}

      {state.kind === 'error' && (
        <div className="ps-warning" role="alert" style={{ marginTop: 12 }}>
          Não foi possível carregar os romaneios de {formatDateBR(date)}.{' '}
          <button className="ps-btn ghost sm" onClick={() => setReloadKey(k => k + 1)}>Tentar de novo</button>
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
                    <td>{row.productName}</td>
                    {summary.stores.map(s => <Cell key={s.code} cell={row.byStore[s.code]} />)}
                    <Cell cell={row.total} strong />
                  </tr>
                ))}
                <tr className="total">
                  <td>Total</td>
                  {summary.stores.map(s => <Cell key={s.code} cell={summary.storeTotals[s.code]} />)}
                  <Cell cell={summary.total} strong />
                </tr>
              </tbody>
            </table>
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
