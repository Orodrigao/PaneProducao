import { AlertTriangle } from 'lucide-react'
import { describeCashClosingConflict, formatCurrencyBRL } from '@/lib/cashClosing'
import { formatRomaneioTime } from '@/lib/romaneioDateTime'

export interface CashClosingComparison {
  label: string
  saved: number
  mine: number
}

function ComparisonLine({ item, savedBy }: { item: CashClosingComparison; savedBy: string }) {
  return (
    <div style={{ lineHeight: 1.35 }}>
      <b>{item.label}</b>
      <div style={{ fontVariantNumeric: 'tabular-nums' }}>
        {savedBy}: {formatCurrencyBRL(item.saved)} · sua tela: {formatCurrencyBRL(item.mine)}
      </div>
    </div>
  )
}

// Aviso fixo (nao toast): explica quem gravou, compara com a tela campo a
// campo e da as duas saidas. Nada e gravado nem descartado sem a pessoa
// escolher. So a frase principal e anunciada ao leitor de tela: os numeros
// mudam a cada tecla.
export default function CashClosingConflictNotice({
  savedBy,
  savedAt,
  comparisons,
  busy,
  onKeepSaved,
  onReplaceWithMine,
}: {
  savedBy: string
  savedAt: string
  comparisons: CashClosingComparison[]
  busy: boolean
  onKeepSaved: () => void
  onReplaceWithMine: () => void
}) {
  const who = savedBy.trim() || 'Outra pessoa'
  return (
    <section
      aria-label="Fechamento salvo por outra pessoa"
      className="ps-warning danger"
      style={{ flexDirection: 'column', gap: 10 }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
        <span role="alert">{describeCashClosingConflict(savedBy, formatRomaneioTime(savedAt))}</span>
      </div>
      <div style={{ display: 'grid', gap: 6, width: '100%' }}>
        {comparisons.map(item => <ComparisonLine key={item.label} item={item} savedBy={who} />)}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="ps-btn ghost" onClick={onKeepSaved} disabled={busy}>
          Ficar com o salvo
        </button>
        <button type="button" className="ps-btn danger" onClick={onReplaceWithMine} disabled={busy}>
          {busy ? 'Gravando...' : 'Substituir pelos meus números'}
        </button>
      </div>
    </section>
  )
}
