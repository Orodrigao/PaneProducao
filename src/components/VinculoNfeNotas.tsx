'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { authorName, currencyLabel, dateLabel, dateTimeLabel, factorInputText, factorLabel, invoiceMappingLabel, parseFactorInput } from '@/lib/vinculosNfe'
import { applyItemCorrection, ItemCorrectionConflictError, previewItemCorrection, searchLinkProducts, type InvoiceLinkHistory, type ItemCorrectionTarget, type ProductOption } from '@/lib/vinculosNfeClient'
import { canReceiveInvoiceItem, itemBlockReason, selectionBlockReason, type ItemCorrectionResult } from '@/lib/vinculosNfeNotas'
import VinculoNfeNotasPrevia from '@/components/VinculoNfeNotasPrevia'

const PRODUCT_CHOICES = 8

interface Props {
  product: ProductOption
  invoices: readonly InvoiceLinkHistory[]
  authors: ReadonlyMap<string, string>
  onSaved: (message: string) => void
}

/**
 * Itens de NF-e gravados neste produto, com a correção de itens que entraram no
 * produto ou no fator errado. Toda correção passa pela prévia calculada pelo
 * banco; a confirmação é recusada se o efeito mudou desde a prévia.
 */
export default function VinculoNfeNotas({ product, invoices, authors, onSaved }: Props) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [mode, setMode] = useState<'idle' | 'form' | 'preview'>('idle')
  const [search, setSearch] = useState('')
  const [options, setOptions] = useState<ProductOption[]>([])
  const [searching, setSearching] = useState(false)
  const [chosen, setChosen] = useState<ProductOption | null>(null)
  const [factorText, setFactorText] = useState('')
  // A prévia guarda o pedido exato que a gerou: a confirmação envia esse
  // pedido, nunca o formulário de agora.
  const [preview, setPreview] = useState<{ request: ItemCorrectionTarget; result: ItemCorrectionResult; requestId: string; count: number } | null>(null)
  const [busy, setBusy] = useState(false)
  // Resposta que chega depois de a seleção ou a lista mudar é descartada.
  const generation = useRef(0)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)

  // Lista nova (outro produto ou recarga): seleção antiga não vale mais.
  useEffect(() => {
    generation.current += 1
    setSelected(new Set())
    setMode('idle')
    setPreview(null)
    setBusy(false)
  }, [invoices])

  useEffect(() => {
    let active = true
    if (mode !== 'form') return () => { active = false }
    setSearching(true)
    void searchLinkProducts(search).then(result => {
      if (active) setOptions(result.filter(canReceiveInvoiceItem).filter(option => option.id !== product.id).slice(0, PRODUCT_CHOICES))
    }).catch(() => {
      if (active) setOptions([])
    }).finally(() => {
      if (active) setSearching(false)
    })
    return () => { active = false }
  }, [mode, search, product.id])

  const selectedItems = useMemo(() => invoices.filter(item => selected.has(item.id)), [invoices, selected])
  const selectionBlock = selectionBlockReason(selectedItems)
  const factor = parseFactorInput(factorText)
  const sourceUnit = selectedItems[0]?.source_unit || 'unidade da nota'
  const formBlock = !chosen ? 'Escolha o produto certo, ou mantenha este para corrigir só o fator.'
    : factor === null ? 'Informe quanto vem em cada unidade da nota: maior que zero, até seis casas, com vírgula para decimal (1.000 é recusado; escreva 1000).'
    : ''

  function target(): ItemCorrectionTarget {
    return { items: selectedItems.map(item => ({ itemId: item.id, productId: chosen?.id ?? '', conversionFactor: factor ?? 0 })) }
  }

  function toggle(itemId: string) {
    setSelected(previous => {
      const next = new Set(previous)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  function openForm() {
    setChosen(null)
    setSearch('')
    setFactorText(selectedItems[0]?.conversion_factor ? factorInputText(selectedItems[0].conversion_factor) : '')
    setError('')
    setMode('form')
  }

  function reset() {
    generation.current += 1
    setMode('idle')
    setPreview(null)
    setBusy(false)
    setError('')
    setConflict(false)
  }

  async function loadPreview(request: ItemCorrectionTarget, count: number) {
    if (busy) return
    const current = ++generation.current
    setBusy(true)
    setError('')
    setConflict(false)
    try {
      const result = await previewItemCorrection(request)
      if (current !== generation.current) return
      // Um identificador por prévia: reenviar depois de erro de rede não grava duas vezes.
      setPreview({ request, result, requestId: crypto.randomUUID(), count })
      setMode('preview')
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : 'Não foi possível calcular a prévia.')
    } finally {
      if (current === generation.current) setBusy(false)
    }
  }

  async function confirm() {
    if (busy || !preview) return
    const current = generation.current
    setBusy(true)
    setError('')
    try {
      await applyItemCorrection(preview.request, preview.requestId, preview.result.impactHash)
      if (current !== generation.current) return
      reset()
      setSelected(new Set())
      onSaved(`Correção gravada: ${preview.count} item(ns) de nota. Os custos foram atualizados como na prévia.`)
    } catch (cause) {
      if (current !== generation.current) return
      setConflict(cause instanceof ItemCorrectionConflictError)
      setError(cause instanceof Error ? cause.message : 'Não foi possível gravar a correção.')
      setBusy(false)
    }
  }

  return (
    <>
      {invoices.length === 0 ? <p>Nenhum item de NF-e encontrado para este produto.</p> : invoices.map(item => {
        const block = itemBlockReason(item)
        return (
          <article key={item.id} style={{ borderTop: '1px solid var(--ps-line)', padding: '10px 0' }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <input type="checkbox" checked={selected.has(item.id)} disabled={Boolean(block) || mode !== 'idle'} onChange={() => toggle(item.id)} aria-label={`Corrigir item ${item.source_description || item.id} da NF ${item.invoice_number || 'sem número'}`} style={{ marginTop: 4 }}/>
              <span>
                <b>{item.supplier_name}</b> · {invoiceMappingLabel(item)}
                <span style={{ display: 'block', margin: '4px 0' }}>NF {item.invoice_number || 'sem número'}{item.invoice_series ? `, série ${item.invoice_series}` : ''} · emissão {dateLabel(item.invoice_date)} · compra {dateLabel(item.purchase_date)}</span>
                <span style={{ display: 'block', margin: '4px 0' }}>{item.source_description || 'Descrição não registrada'} · código {item.source_code || 'não informado'} · EAN {item.source_ean || 'não informado'}</span>
                <span style={{ display: 'block', margin: '4px 0' }}>Na nota: {item.source_quantity ?? 'quantidade não registrada'} {item.source_unit || ''} · salvo como {item.quantity} {item.unit} · preço unitário {currencyLabel(item.unit_price)}</span>
                <span style={{ display: 'block', margin: '4px 0' }}>Conversão registrada: {item.conversion_factor === null ? 'sem fator' : factorLabel(item.conversion_factor)} {item.conversion_basis ? `(${item.conversion_basis})` : ''} · quantidade útil {item.usable_quantity === null ? 'não registrada' : `${factorLabel(item.usable_quantity)} ${product.unit || 'un'}`} · vínculo por {authorName(authors, item.mapping_confirmed_by)} em {dateTimeLabel(item.mapping_confirmed_at)}</span>
                <small>Fator {item.factor_confirmed ? 'marcado como confirmado' : 'não marcado como confirmado'} por {authorName(authors, item.factor_confirmed_by)} em {dateTimeLabel(item.factor_confirmed_at)}. Situação da compra: {item.status}.</small>
                {block && <small style={{ display: 'block', color: 'var(--ink-soft)' }}>{block}</small>}
              </span>
            </label>
          </article>
        )
      })}

      {invoices.length > 0 && mode === 'idle' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
          <button type="button" className="ps-btn primary sm" disabled={Boolean(selectionBlock)} onClick={openForm}>Corrigir itens marcados</button>
          {selectionBlock && <small style={{ color: 'var(--ink-soft)' }}>{selectionBlock}</small>}
        </div>
      )}

      {mode === 'form' && (
        <div className="ps-card" style={{ marginTop: 8, padding: 10, background: 'var(--cream-raise)' }}>
          <b>Corrigir {selectedItems.length} item(ns) de nota</b>
          <p style={{ margin: '6px 0 0', fontWeight: 600 }}>Produto certo</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            <button type="button" className={`ps-btn ${chosen?.id === product.id ? 'primary' : 'ghost'} sm`} aria-pressed={chosen?.id === product.id} disabled={busy} onClick={() => setChosen(product)}>
              Manter em {product.name}: corrigir só o fator
            </button>
          </div>
          <label htmlFor={`notas-busca-${product.id}`} style={{ display: 'block', marginTop: 8 }}>Ou buscar outro produto</label>
          <input id={`notas-busca-${product.id}`} className="ps-input" value={search} disabled={busy} onChange={event => { setSearch(event.target.value); if (chosen?.id !== product.id) setChosen(null) }} placeholder="Digite o nome do produto" style={{ width: '100%' }}/>
          {searching && <small role="status">Buscando…</small>}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {options.map(option => (
              <button key={option.id} type="button" className={`ps-btn ${chosen?.id === option.id ? 'primary' : 'ghost'} sm`} aria-pressed={chosen?.id === option.id} disabled={busy} onClick={() => setChosen(option)}>
                {option.name} ({option.unit || 'un'})
              </button>
            ))}
            {!searching && options.length === 0 && <small>Nenhum produto ativo de compra encontrado.</small>}
          </div>
          <label htmlFor={`notas-fator-${product.id}`} style={{ display: 'block', marginTop: 10, fontWeight: 600 }}>
            Quanto vem em 1 {sourceUnit} da nota, em {chosen?.unit || 'unidade do produto'}
          </label>
          <input id={`notas-fator-${product.id}`} className="ps-input" inputMode="decimal" value={factorText} disabled={busy} onChange={event => setFactorText(event.target.value)} style={{ width: 140 }}/>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
            <button type="button" className="ps-btn primary sm" disabled={Boolean(formBlock) || busy} onClick={() => void loadPreview(target(), selectedItems.length)}>{busy ? 'Calculando…' : 'Ver prévia'}</button>
            <button type="button" className="ps-btn ghost sm" disabled={busy} onClick={reset}>Cancelar</button>
            {formBlock && <small style={{ color: 'var(--ink-soft)' }}>{formBlock}</small>}
          </div>
          {error && <p role="alert" style={{ color: 'var(--berry)', margin: '8px 0 0' }}>{error}</p>}
        </div>
      )}

      {mode === 'preview' && preview && (
        <VinculoNfeNotasPrevia
          title="Confira o efeito antes de confirmar"
          result={preview.result}
          confirmLabel="Confirmar correção"
          saving={busy}
          error={error}
          conflict={conflict}
          onConfirm={() => void confirm()}
          onBack={() => { generation.current += 1; setBusy(false); setMode('form'); setPreview(null); setError(''); setConflict(false) }}
          onRefreshPreview={() => void loadPreview(preview.request, preview.count)}
        />
      )}
    </>
  )
}
