'use client'

import { useEffect, useRef, useState } from 'react'
import { authorName, dateTimeLabel } from '@/lib/vinculosNfe'
import { applyItemCorrection, ItemCorrectionConflictError, loadItemCorrections, previewItemCorrection, type ItemCorrectionHistory } from '@/lib/vinculosNfeClient'
import { describeItemImpact, describeProductImpact, type ItemCorrectionResult } from '@/lib/vinculosNfeNotas'
import VinculoNfeNotasPrevia from '@/components/VinculoNfeNotasPrevia'

interface Props {
  productId: string
  authors: ReadonlyMap<string, string>
  /** Muda quando a página relê o produto, para o histórico reler junto. */
  reloadKey: unknown
  onSaved: (message: string) => void
}

/** Correções de itens de notas que tiraram itens deste produto ou trouxeram para ele. */
export default function VinculoNfeNotasHistorico({ productId, authors, reloadKey, onSaved }: Props) {
  const [rows, setRows] = useState<ItemCorrectionHistory[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [undoing, setUndoing] = useState<string | null>(null)
  const [preview, setPreview] = useState<ItemCorrectionResult | null>(null)
  const [requestId, setRequestId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  // Resposta de desfazer que chega depois de trocar de produto ou fechar é descartada.
  const generation = useRef(0)

  // Outro produto: nada do histórico ou do desfazer anterior continua na tela.
  useEffect(() => {
    generation.current += 1
    setRows(null)
    setUndoing(null)
    setPreview(null)
    setRequestId('')
    setBusy(false)
    setError('')
    setConflict(false)
  }, [productId])

  useEffect(() => {
    let active = true
    setLoadError('')
    void loadItemCorrections(productId).then(result => {
      if (active) setRows(result)
    }).catch(cause => {
      if (active) setLoadError(cause instanceof Error ? cause.message : 'Não foi possível carregar as correções de notas.')
    })
    return () => { active = false }
  }, [productId, reloadKey, attempt])

  function close() {
    generation.current += 1
    setBusy(false)
    setUndoing(null)
    setPreview(null)
    setRequestId('')
    setError('')
    setConflict(false)
  }

  async function openUndo(correctionId: string) {
    if (busy) return
    const current = ++generation.current
    setBusy(true)
    setUndoing(correctionId)
    setPreview(null)
    setError('')
    setConflict(false)
    try {
      const result = await previewItemCorrection({ undoCorrectionId: correctionId })
      if (current !== generation.current) return
      setPreview(result)
      setRequestId(crypto.randomUUID())
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : 'Não foi possível calcular a prévia.')
    } finally {
      if (current === generation.current) setBusy(false)
    }
  }

  async function confirmUndo() {
    if (busy || !preview || !undoing) return
    const current = generation.current
    setBusy(true)
    setError('')
    try {
      await applyItemCorrection({ undoCorrectionId: undoing }, requestId, preview.impactHash)
      if (current !== generation.current) return
      close()
      onSaved('Correção desfeita. Os custos foram atualizados como na prévia.')
    } catch (cause) {
      if (current !== generation.current) return
      setConflict(cause instanceof ItemCorrectionConflictError)
      setError(cause instanceof Error ? cause.message : 'Não foi possível desfazer a correção.')
      setBusy(false)
    }
  }

  if (loadError) {
    return <p role="alert" style={{ color: 'var(--berry)' }}>{loadError}<button type="button" className="ps-btn ghost sm" style={{ marginLeft: 8 }} onClick={() => setAttempt(value => value + 1)}>Carregar de novo</button></p>
  }
  if (!rows) return <p role="status">Carregando correções de notas…</p>
  if (rows.length === 0) return <p>Nenhuma correção de nota registrada.</p>

  return (
    <>
      {rows.map(row => (
        <article key={row.id} style={{ borderTop: '1px solid var(--ps-line)', padding: '10px 0' }}>
          <b>{row.action === 'desfazer' ? 'Correção desfeita' : 'Itens corrigidos'}</b> · por {authorName(authors, row.corrected_by)} em {dateTimeLabel(row.corrected_at)}
          <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
            {row.impact.items.map(item => <li key={item.item_id}>{describeItemImpact(item)}</li>)}
            {row.impact.products.map(product => <li key={product.product_id}>{describeProductImpact(product, row.impact)}</li>)}
          </ul>
          {row.action === 'corrigir' && (row.undone
            ? <small style={{ color: 'var(--ink-soft)' }}>Esta correção já foi desfeita.</small>
            : undoing !== row.id && <button type="button" className="ps-btn ghost sm" disabled={busy || undoing !== null} onClick={() => void openUndo(row.id)}>Desfazer</button>)}
          {undoing === row.id && !preview && (
            <p role={error ? 'alert' : 'status'} style={{ color: error ? 'var(--berry)' : undefined, margin: '6px 0 0' }}>
              {error || 'Calculando a prévia…'}
              {error && <button type="button" className="ps-btn ghost sm" style={{ marginLeft: 8 }} onClick={close}>Fechar</button>}
            </p>
          )}
          {undoing === row.id && preview && (
            <VinculoNfeNotasPrevia
              title="Confira o efeito de desfazer antes de confirmar"
              result={preview}
              confirmLabel="Confirmar desfazer"
              saving={busy}
              error={error}
              conflict={conflict}
              onConfirm={() => void confirmUndo()}
              onBack={close}
              onRefreshPreview={() => void openUndo(row.id)}
            />
          )}
        </article>
      ))}
      {rows.length === 30 && <small>Mostrando as 30 correções mais recentes.</small>}
    </>
  )
}
