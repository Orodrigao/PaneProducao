'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { currencyLabel, dateLabel, parseFactorInput } from '@/lib/vinculosNfe'
import { applyItemCorrection, ItemCorrectionConflictError, loadNonCatalogItems, previewItemCorrection, searchLinkProducts, type ItemCorrectionTarget, type NonCatalogItem, type ProductOption } from '@/lib/vinculosNfeClient'
import { canReceiveInvoiceItem, selectionBlockReason, type ItemCorrectionResult } from '@/lib/vinculosNfeNotas'
import { matchesNonCatalogSearch, NON_CATALOG_LIST_LIMIT, purchaseStatusLabel } from '@/lib/vinculosNfeUsoDespesa'
import VinculoNfeNotasPrevia from '@/components/VinculoNfeNotasPrevia'

const PRODUCT_CHOICES = 8

interface Props {
  /** Abre o produto de destino na página, onde ficam o histórico e o desfazer. */
  onOpenProduct: (product: ProductOption) => void
}

/**
 * Itens de NF-e lançados como uso ou despesa (fase 5 dos Vínculos). Quem
 * corrige marca os que eram insumo ou revenda, escolhe o produto e quanto vem em
 * cada unidade da nota, confere a prévia (custo, conta, livro-caixa, consumo
 * semanal e memória do fornecedor) e confirma.
 */
export default function VinculoNfeUsoDespesa({ onOpenProduct }: Props) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NonCatalogItem[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [mode, setMode] = useState<'idle' | 'form' | 'preview'>('idle')
  const [search, setSearch] = useState('')
  const [options, setOptions] = useState<ProductOption[]>([])
  const [searching, setSearching] = useState(false)
  const [chosen, setChosen] = useState<ProductOption | null>(null)
  const [factorText, setFactorText] = useState('')
  // A prévia guarda o pedido exato que a gerou: a confirmação envia esse pedido.
  const [preview, setPreview] = useState<{ request: ItemCorrectionTarget; result: ItemCorrectionResult; requestId: string; product: ProductOption; count: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [saved, setSaved] = useState<{ message: string; product: ProductOption } | null>(null)
  // Resposta que chega depois de a lista ou a seleção mudar é descartada.
  const generation = useRef(0)

  useEffect(() => {
    let active = true
    if (!open) return () => { active = false }
    setItems(null)
    setLoadError('')
    void loadNonCatalogItems().then(result => {
      if (!active) return
      setItems(result)
      setSelected(new Set())
    }).catch(cause => {
      if (active) setLoadError(cause instanceof Error ? cause.message : 'Não foi possível carregar os itens de uso ou despesa.')
    })
    return () => { active = false }
  }, [open, attempt])

  useEffect(() => {
    let active = true
    if (mode !== 'form') return () => { active = false }
    setSearching(true)
    void searchLinkProducts(search).then(result => {
      if (active) setOptions(result.filter(canReceiveInvoiceItem).slice(0, PRODUCT_CHOICES))
    }).catch(() => {
      if (active) setOptions([])
    }).finally(() => {
      if (active) setSearching(false)
    })
    return () => { active = false }
  }, [mode, search])

  const filtered = useMemo(() => (items ?? []).filter(item => matchesNonCatalogSearch(item, filter)), [items, filter])
  const shown = filtered.slice(0, NON_CATALOG_LIST_LIMIT)
  const selectedItems = useMemo(() => (items ?? []).filter(item => selected.has(item.id)), [items, selected])
  const selectionBlock = selectionBlockReason(selectedItems)
  const factor = parseFactorInput(factorText)
  const sourceUnit = selectedItems[0]?.source_unit || 'unidade da nota'
  const formBlock = !chosen ? 'Escolha o produto certo.'
    : factor === null ? 'Informe quanto vem em cada unidade da nota: maior que zero, até seis casas, com vírgula para decimal (1.000 é recusado; escreva 1000).'
    : ''

  function toggle(itemId: string) {
    setSelected(previous => {
      const next = new Set(previous)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  function reset() {
    generation.current += 1
    setMode('idle')
    setPreview(null)
    setBusy(false)
    setError('')
    setConflict(false)
  }

  function openForm() {
    setChosen(null)
    setSearch('')
    setFactorText('')
    setError('')
    setSaved(null)
    setMode('form')
  }

  async function loadPreview(request: ItemCorrectionTarget, product: ProductOption, count: number) {
    if (busy) return
    const current = ++generation.current
    setBusy(true)
    setError('')
    setConflict(false)
    try {
      const result = await previewItemCorrection(request)
      if (current !== generation.current) return
      // Um identificador por prévia: reenviar depois de erro de rede não grava duas vezes.
      setPreview({ request, result, requestId: crypto.randomUUID(), product, count })
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
      setSaved({
        message: `Correção gravada: ${preview.count} item(ns) saíram de uso ou despesa e entraram em ${preview.product.name}. Os custos foram atualizados como na prévia.`,
        product: preview.product,
      })
      setAttempt(value => value + 1)
    } catch (cause) {
      if (current !== generation.current) return
      setConflict(cause instanceof ItemCorrectionConflictError)
      setError(cause instanceof Error ? cause.message : 'Não foi possível gravar a correção.')
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div>
        <button type="button" className="ps-btn ghost sm" onClick={() => setOpen(true)}>Ver itens lançados como uso ou despesa</button>
      </div>
    )
  }

  return (
    <>
      {saved && (
        <p role="status" style={{ margin: '0 0 10px', color: 'var(--teal)', fontWeight: 600 }}>
          {saved.message}
          <button type="button" className="ps-btn ghost sm" style={{ marginLeft: 8 }} onClick={() => onOpenProduct(saved.product)}>Abrir {saved.product.name} (histórico e desfazer)</button>
        </p>
      )}
      {loadError && (
        <p role="alert" style={{ color: 'var(--berry)' }}>{loadError}<button type="button" className="ps-btn ghost sm" style={{ marginLeft: 8 }} onClick={() => setAttempt(value => value + 1)}>Carregar de novo</button></p>
      )}
      {!loadError && !items && <p role="status">Carregando itens de uso ou despesa…</p>}
      {items && (
        <>
          <label htmlFor="uso-despesa-busca" style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Filtrar por fornecedor, descrição ou número da nota</label>
          <input id="uso-despesa-busca" className="ps-input" value={filter} disabled={mode !== 'idle'} onChange={event => setFilter(event.target.value)} placeholder="Ex.: margarina, Bersaglio, 184062" style={{ width: '100%' }}/>
          {items.length === 0 && <p>Nenhum item de NF-e da JC está lançado como uso ou despesa.</p>}
          {items.length > 0 && filtered.length === 0 && <p>Nenhum item encontrado com esse filtro.</p>}
          {shown.map(item => (
            <article key={item.id} style={{ borderTop: '1px solid var(--ps-line)', padding: '10px 0' }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <input type="checkbox" checked={selected.has(item.id)} disabled={mode !== 'idle'} onChange={() => toggle(item.id)} aria-label={`Corrigir item ${item.source_description || item.id} da NF ${item.invoice_number || 'sem número'}`} style={{ marginTop: 4 }}/>
                <span>
                  <b>{item.supplier_name}</b> · {purchaseStatusLabel(item.status)}
                  <span style={{ display: 'block', margin: '4px 0' }}>NF {item.invoice_number || 'sem número'} · emissão {dateLabel(item.invoice_date)}</span>
                  <span style={{ display: 'block', margin: '4px 0' }}>{item.source_description || 'Descrição não registrada'} · código {item.source_code || 'não informado'}</span>
                  <small>Na nota: {item.source_quantity ?? item.quantity} {item.source_unit || ''} · valor do item {currencyLabel(item.item_value)}</small>
                </span>
              </label>
            </article>
          ))}
          {filtered.length > NON_CATALOG_LIST_LIMIT && <small style={{ display: 'block', marginTop: 6 }}>Mostrando {NON_CATALOG_LIST_LIMIT} de {filtered.length} itens. Use o filtro para achar os outros.</small>}

          {items.length > 0 && mode === 'idle' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
              <button type="button" className="ps-btn primary sm" disabled={Boolean(selectionBlock)} onClick={openForm}>Corrigir para um produto</button>
              {selectionBlock && <small style={{ color: 'var(--ink-soft)' }}>{selectionBlock === 'Marque os itens que entraram errados.' ? 'Marque os itens que eram insumo ou revenda.' : selectionBlock}</small>}
            </div>
          )}

          {mode === 'form' && (
            <div className="ps-card" style={{ marginTop: 8, padding: 10, background: 'var(--cream-raise)' }}>
              <b>Tirar {selectedItems.length} item(ns) de uso ou despesa</b>
              <label htmlFor="uso-despesa-produto" style={{ display: 'block', marginTop: 8, fontWeight: 600 }}>Produto certo</label>
              <input id="uso-despesa-produto" className="ps-input" value={search} disabled={busy} onChange={event => { setSearch(event.target.value); setChosen(null) }} placeholder="Digite o nome do produto" style={{ width: '100%' }}/>
              {searching && <small role="status">Buscando…</small>}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {options.map(option => (
                  <button key={option.id} type="button" className={`ps-btn ${chosen?.id === option.id ? 'primary' : 'ghost'} sm`} aria-pressed={chosen?.id === option.id} disabled={busy} onClick={() => setChosen(option)}>
                    {option.name} ({option.unit || 'un'})
                  </button>
                ))}
                {!searching && options.length === 0 && <small>Nenhum produto ativo de compra encontrado. Cadastre o produto no Catálogo antes.</small>}
              </div>
              <label htmlFor="uso-despesa-fator" style={{ display: 'block', marginTop: 10, fontWeight: 600 }}>
                Quanto vem em 1 {sourceUnit} da nota, em {chosen?.unit || 'unidade do produto'}
              </label>
              <input id="uso-despesa-fator" className="ps-input" inputMode="decimal" value={factorText} disabled={busy} onChange={event => setFactorText(event.target.value)} style={{ width: 140 }}/>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
                <button type="button" className="ps-btn primary sm" disabled={Boolean(formBlock) || busy}
                  onClick={() => chosen && factor !== null && void loadPreview({ items: selectedItems.map(item => ({ itemId: item.id, productId: chosen.id, conversionFactor: factor })) }, chosen, selectedItems.length)}>
                  {busy ? 'Calculando…' : 'Ver prévia'}
                </button>
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
              onRefreshPreview={() => void loadPreview(preview.request, preview.product, preview.count)}
            />
          )}
        </>
      )}
    </>
  )
}
