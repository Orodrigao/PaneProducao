import { AlertTriangle } from 'lucide-react'
import { describeCashClosingConflict, formatCurrencyBRL, type CashClosingTotals } from '@/lib/cashClosing'
import { formatRomaneioTime } from '@/lib/romaneioDateTime'

export interface SavedCashClosingSummary {
  savedBy: string
  savedAt: string
  totalAmount: number
  cashAmount: number
}

function TotalsLine({ label, total, cash }: { label: string; total: number; cash: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
      <b>{label}</b>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
        Total do dia {formatCurrencyBRL(total)} · dinheiro {formatCurrencyBRL(cash)}
      </span>
    </div>
  )
}

// Aviso fixo (nao toast): explica quem gravou, compara com a tela e da as duas
// saidas. Nada e gravado sem a pessoa escolher.
export default function CashClosingConflictNotice({
  saved,
  mine,
  busy,
  onKeepSaved,
  onReplaceWithMine,
}: {
  saved: SavedCashClosingSummary
  mine: CashClosingTotals
  busy: boolean
  onKeepSaved: () => void
  onReplaceWithMine: () => void
}) {
  return (
    <div className="ps-warning danger" role="alert" style={{ flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>{describeCashClosingConflict(saved.savedBy, formatRomaneioTime(saved.savedAt))}</span>
      </div>
      <div style={{ display: 'grid', gap: 4, width: '100%' }}>
        <TotalsLine label={`Salvo por ${saved.savedBy || 'outra pessoa'}`} total={saved.totalAmount} cash={saved.cashAmount} />
        <TotalsLine label="Na sua tela" total={mine.declaredTotal} cash={mine.cashSalesAmount} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="ps-btn ghost" onClick={onKeepSaved} disabled={busy}>
          Ficar com o salvo
        </button>
        <button type="button" className="ps-btn danger" onClick={onReplaceWithMine} disabled={busy}>
          Substituir pelos meus números
        </button>
      </div>
    </div>
  )
}
