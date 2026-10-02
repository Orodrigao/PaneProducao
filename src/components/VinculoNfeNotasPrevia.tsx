'use client'

import { describeItemImpact, describeProductImpact, IMPACT_FOOTNOTES, type ItemCorrectionResult } from '@/lib/vinculosNfeNotas'

interface Props {
  title: string
  result: ItemCorrectionResult
  confirmLabel: string
  saving: boolean
  error: string
  /** O efeito mudou desde a prévia: o único caminho é ver a prévia de novo. */
  conflict: boolean
  onConfirm: () => void
  onBack: () => void
  onRefreshPreview: () => void
}

/** O efeito calculado pelo banco, dito antes do clique que confirma. */
export default function VinculoNfeNotasPrevia({ title, result, confirmLabel, saving, error, conflict, onConfirm, onBack, onRefreshPreview }: Props) {
  const { impact } = result
  return (
    <div role="region" aria-label={title} className="ps-card" style={{ marginTop: 8, padding: 10, background: 'var(--cream-raise)', borderLeft: '4px solid var(--teal)' }}>
      <b>{title}</b>
      <p style={{ margin: '6px 0 2px', fontWeight: 600 }}>Itens</p>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {impact.items.map(item => <li key={item.item_id}>{describeItemImpact(item)}</li>)}
      </ul>
      <p style={{ margin: '8px 0 2px', fontWeight: 600 }}>Custo dos produtos</p>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {impact.products.map(product => <li key={product.product_id}>{describeProductImpact(product, impact)}</li>)}
      </ul>
      <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--ink-soft)' }}>
        {IMPACT_FOOTNOTES.map(line => <li key={line}>{line}</li>)}
      </ul>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        {conflict
          ? <button type="button" className="ps-btn primary sm" disabled={saving} onClick={onRefreshPreview}>Ver a prévia de novo</button>
          : <button type="button" className="ps-btn primary sm" disabled={saving} onClick={onConfirm}>{saving ? 'Gravando…' : confirmLabel}</button>}
        <button type="button" className="ps-btn ghost sm" disabled={saving} onClick={onBack}>Voltar</button>
      </div>
      {error && <p role="alert" style={{ color: 'var(--berry)', margin: '8px 0 0' }}>{error}</p>}
    </div>
  )
}
