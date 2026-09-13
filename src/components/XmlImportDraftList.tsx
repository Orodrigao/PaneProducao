'use client'

import { FileClock, Trash2 } from 'lucide-react'
import { formatBRL, formatDate } from '@/lib/payables'
import { formatDraftSavedAt, type XmlImportDraftRow } from '@/lib/xmlImportDrafts'

interface XmlImportDraftListProps {
  drafts: XmlImportDraftRow[]
  busyId: string | null
  onResume: (draft: XmlImportDraftRow) => void
  onDiscard: (draft: XmlImportDraftRow) => void
}

/**
 * Importações salvas pela metade. Nada aqui é dinheiro: enquanto a nota está
 * nesta lista, não existe conta a pagar, parcela nem custo atualizado. A lista
 * só some quando a pessoa confirma (e a nota vira conta) ou descarta.
 */
export default function XmlImportDraftList({ drafts, busyId, onResume, onDiscard }: XmlImportDraftListProps) {
  if (drafts.length === 0) return null
  return (
    <div className="ps-card" style={{ marginTop: 14, borderColor: 'var(--honey-deep)' }}>
      <div className="ps-card-head">
        <div>
          <b><FileClock size={15} style={{ verticalAlign: '-2px' }} /> Importações pendentes de conferência</b>
          <small>{drafts.length === 1 ? 'Uma NF-e salva' : `${drafts.length} NF-e salvas`} sem virar conta a pagar. Continue de onde parou ou descarte.</small>
        </div>
      </div>
      {drafts.map(draft => {
        const busy = busyId === draft.id
        return (
          <div key={draft.id} className="ps-card" data-testid="xml-import-draft" style={{ marginTop: 8, padding: 10, background: 'var(--cream-raise)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <b style={{ flex: 1 }}>{draft.supplier_name}</b>
              <small style={{ color: 'var(--honey-deep)', fontWeight: 650 }}>pendente de conferência</small>
            </div>
            <small style={{ display: 'block', marginTop: 3 }}>
              NF {draft.nfe_number ?? 'sem número'}{draft.nfe_series ? ` · série ${draft.nfe_series}` : ''} · emitida em {formatDate(draft.nfe_issued_at)} · {formatBRL(draft.total_value)}
            </small>
            <small style={{ display: 'block', marginTop: 2, color: 'var(--ink-soft)' }}>Salva em {formatDraftSavedAt(draft.updated_at)}</small>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <button type="button" className="ps-btn primary sm" disabled={busy} onClick={() => onResume(draft)}>
                {busy ? 'Abrindo...' : 'Continuar conferência'}
              </button>
              <button type="button" className="ps-btn ghost sm" disabled={busy} onClick={() => onDiscard(draft)}>
                <Trash2 size={14} /> Descartar
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
