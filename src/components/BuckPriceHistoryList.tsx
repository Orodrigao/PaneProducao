'use client'

import {
  buckPriceEventLabel,
  effectiveHistorySeqs,
  formatBuckPrice,
  formatDateBR,
  BUCK_SINCE_ALWAYS,
  type BuckPriceHistoryEntry,
} from '@/lib/buckPriceChange'

function formatRecordedAt(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// Histórico de preço de uma linha da Tabela Buck, do mais novo para o mais
// antigo. Registro coberto por outro gravado depois aparece riscado.
export default function BuckPriceHistoryList({ entries }: { entries: BuckPriceHistoryEntry[] }) {
  if (entries.length === 0) {
    return <div className="ps-hint">Sem histórico registrado para este produto.</div>
  }
  const effective = effectiveHistorySeqs(entries)
  const ordered = [...entries].sort((a, b) => b.seq - a.seq)
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }} aria-label="Histórico de preço">
      {ordered.map(entry => {
        const stillValid = effective.has(entry.seq)
        return (
          <li key={entry.seq} style={{ fontSize: 13, lineHeight: 1.4, opacity: stillValid ? 1 : 0.6 }}>
            <div style={{ textDecoration: stillValid ? 'none' : 'line-through' }}>
              <b>{entry.valid_from === BUCK_SINCE_ALWAYS ? 'Desde o início' : `A partir de ${formatDateBR(entry.valid_from)}`}</b>
              {' · '}{formatBuckPrice(entry.unit_price, entry.pricing_unit)}
              {entry.previous_unit_price !== null && Number(entry.previous_unit_price) > 0 && (
                <> (antes {formatBuckPrice(entry.previous_unit_price, entry.previous_pricing_unit)})</>
              )}
            </div>
            <div style={{ color: 'var(--ink-soft)' }}>
              {buckPriceEventLabel(entry.event)}
              {entry.reason && <> · {entry.reason}</>}
              {' · '}{entry.created_by_name ?? 'sem autor'} em {formatRecordedAt(entry.created_at)}
              {!stillValid && <> · não vale mais: coberto por troca gravada depois</>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
