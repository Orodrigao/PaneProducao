'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { nonCatalogKindLabel, type NfeNonCatalogKind } from '@/lib/nfeXml'
import { currencyLabel, dateLabel, parseFactorInput } from '@/lib/vinculosNfe'
import { applyItemCorrection, ItemCorrectionConflictError, loadNonCatalogItems, previewItemCorrection, searchLinkProducts, type ItemCorrectionTarget, type NonCatalogItem, type ProductOption } from '@/lib/vinculosNfeClient'
import { canReceiveInvoiceItem, selectionBlockReason, type ItemCorrectionResult } from '@/lib/vinculosNfeNotas'
import { groupByNonCatalogKind, kindSwapTarget, matchesNonCatalogSearch, NON_CATALOG_LIST_LIMIT, purchaseStatusLabel } from '@/lib/vinculosNfeUsoDespesa'
import VinculoNfeNotasHistorico from '@/components/VinculoNfeNotasHistorico'
import VinculoNfeNotasPrevia from '@/components/VinculoNfeNotasPrevia'

const PRODUCT_CHOICES = 8

const GROUP_TITLES: Record<NfeNonCatalogKind, string> = {
  uso_despesa: 'Uso ou despesa',
  revenda: 'Revenda sem cadastro',
}

const GROUP_HINTS: Record<NfeNonCatalogKind, string> = {
  uso_despesa: 'Fora da receita, do estoque e do custo (limpeza, manutenção, serviços).',
  revenda: 'Mercadoria comprada para revender sem produto no cadastro: fora do estoque e do CMV %, com linha própria no consumo semanal.',
}

type Destination = { kind: 'produto'; product: ProductOption } | { kind: NfeNonCatalogKind }

interface Props {
  /** Abre o produto de destino na página, onde ficam o histórico e o desfazer. */
  onOpenProduct: (product: ProductOption) => void
  /** Muda quando a página relê o produto (correção ou desfazer na lista dele), para esta lista reler junto. */
  reloadKey?: unknown
  /** Quem está na tela, para dar nome às correções feitas por essa pessoa no histórico do item. */
  authors: ReadonlyMap<string, string>
}

/**
 * Itens de NF-e fora do cadastro, separados por tipo: uso ou despesa e
 * revenda sem cadastro (fase 5 dos Vínculos e fase 3 da revenda sem cadastro).
 * Quem corrige marca os itens e escolhe: ir para um produto (com quanto vem em
 * cada unidade da nota) ou trocar o tipo. Sempre com a prévia do banco (custo,
 * conta, livro-caixa, consumo semanal e memória do fornecedor) antes de
 * confirmar. A troca de tipo não tem produto em nenhum dos lados: o histórico e
 * o desfazer dela ficam no próprio item.
 */
export default function VinculoNfeUsoDespesa({ onOpenProduct, reloadKey, authors }: Props) {
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
  const [preview, setPreview] = useState<{ request: ItemCorrectionTarget; result: ItemCorrectionResult; requestId: string; destination: Destination; count: number; firstItemId: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [saved, setSaved] = useState<{ message: string; product?: ProductOption; itemId?: string } | null>(null)
  // Item com o histórico aberto (correções e desfazer).
  const [historyItem, setHistoryItem] = useState<string | null>(null)
  // Resposta que chega depois de a lista ou a seleção mudar é descartada.
  const generation = useRef(0)
  // Última lista lida, para saber se um item marcado trocou de tipo na releitura.
  const itemsRef = useRef<NonCatalogItem[] | null>(null)

  // Lê ao abrir, depois de corrigir aqui (attempt) e quando a página relê o
  // produto (reloadKey): uma correção ou um desfazer na lista do produto muda o
  // que está fora do cadastro. A lista anterior fica na tela até a nova chegar,
  // e só continuam marcados os itens que seguem fora do cadastro e com o mesmo
  // tipo (o que trocou de tipo mudou de grupo).
  useEffect(() => {
    let active = true
    if (!open) return () => { active = false }
    setLoadError('')
    void loadNonCatalogItems().then(result => {
      if (!active) return
      const previous = itemsRef.current
      itemsRef.current = result
      setItems(result)
      setSelected(current => new Set([...current].filter(id => {
        const now = result.find(item => item.id === id)
        const before = previous?.find(item => item.id === id)
        return now !== undefined && (!before || before.non_catalog_kind === now.non_catalog_kind)
      })))
    }).catch(cause => {
      if (active) setLoadError(cause instanceof Error ? cause.message : 'Não foi possível carregar os itens fora do cadastro.')
    })
    return () => { active = false }
  }, [open, attempt, reloadKey])

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
  const groups = useMemo(() => groupByNonCatalogKind(filtered), [filtered])
  const selectedItems = useMemo(() => (items ?? []).filter(item => selected.has(item.id)), [items, selected])
  const selectionBlock = selectionBlockReason(selectedItems)
  // Trocar o tipo não tem fator: unidades diferentes podem ir juntas.
  const swapBlock = selectionBlockReason(selectedItems, { sameUnit: false })
  const swap = kindSwapTarget(selectedItems)
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

  async function loadPreview(request: ItemCorrectionTarget, destination: Destination, count: number, firstItemId: string) {
    if (busy) return
    const current = ++generation.current
    setBusy(true)
    setError('')
    setConflict(false)
    try {
      const result = await previewItemCorrection(request)
      if (current !== generation.current) return
      // Um identificador por prévia: reenviar depois de erro de rede não grava duas vezes.
      setPreview({ request, result, requestId: crypto.randomUUID(), destination, count, firstItemId })
      setMode('preview')
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : 'Não foi possível calcular a prévia.')
    } finally {
      if (current === generation.current) setBusy(false)
    }
  }

  function previewSwap() {
    if (!swap.target || swapBlock || selectedItems.length === 0) return
    const target = swap.target
    setSaved(null)
    setHistoryItem(null)
    void loadPreview(
      { items: selectedItems.map(item => ({ itemId: item.id, productId: null, conversionFactor: null, nonCatalogKind: target })) },
      { kind: target }, selectedItems.length, selectedItems[0].id,
    )
  }

  async function confirm() {
    if (busy || !preview) return
    const current = generation.current
    setBusy(true)
    setError('')
    try {
      await applyItemCorrection(preview.request, preview.requestId, preview.result.impactHash)
      if (current !== generation.current) return
      const { destination, count, firstItemId } = preview
      reset()
      setSelected(new Set())
      setSaved(destination.kind === 'produto'
        ? {
            message: `Correção gravada: ${count} item(ns) saíram de fora do cadastro e entraram em ${destination.product.name}. Os custos foram atualizados como na prévia.`,
            product: destination.product,
          }
        : {
            message: `Troca gravada: ${count} item(ns) passaram a ${nonCatalogKindLabel(destination.kind)}. Conta, parcelas e livro-caixa não mudaram.`,
            itemId: firstItemId,
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
        <button type="button" className="ps-btn ghost sm" onClick={() => setOpen(true)}>Ver itens fora do cadastro</button>
      </div>
    )
  }

  function renderItem(item: NonCatalogItem) {
    return (
      <article key={item.id} style={{ borderTop: '1px solid var(--ps-line)', padding: '10px 0' }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <input type="checkbox" checked={selected.has(item.id)} disabled={mode !== 'idle'} onChange={() => toggle(item.id)} aria-label={`Corrigir item ${item.source_description || item.id} da NF ${item.invoice_number || 'sem número'}`} style={{ marginTop: 4 }}/>
          <span>
            <b>{item.supplier_name}</b> · {purchaseStatusLabel(item.status)} · {nonCatalogKindLabel(item.non_catalog_kind)}
            <span style={{ display: 'block', margin: '4px 0' }}>NF {item.invoice_number || 'sem número'} · emissão {dateLabel(item.invoice_date)}</span>
            <span style={{ display: 'block', margin: '4px 0' }}>{item.source_description || 'Descrição não registrada'} · código {item.source_code || 'não informado'}</span>
            <small>Na nota: {item.source_quantity ?? item.quantity} {item.source_unit || ''} · valor do item {currencyLabel(item.item_value)}</small>
          </span>
        </label>
        <button type="button" className="ps-btn ghost sm" style={{ marginTop: 6 }} aria-expanded={historyItem === item.id}
          onClick={() => setHistoryItem(current => current === item.id ? null : item.id)}>
          {historyItem === item.id ? 'Fechar histórico deste item' : `Histórico deste item (${item.source_description || 'item'})`}
        </button>
        {historyItem === item.id && (
          <div role="region" aria-label={`Correções do item ${item.source_description || item.id}`} style={{ marginTop: 6 }}>
            <VinculoNfeNotasHistorico
              filter={{ itemId: item.id }}
              authors={authors}
              reloadKey={attempt}
              onSaved={message => { setSaved({ message }); setHistoryItem(null); setAttempt(value => value + 1) }}
            />
          </div>
        )}
      </article>
    )
  }

  return (
    <>
      {saved && (
        <p role="status" style={{ margin: '0 0 10px', color: 'var(--teal)', fontWeight: 600 }}>
          {saved.message}
          {saved.product && (
            <button type="button" className="ps-btn ghost sm" style={{ marginLeft: 8 }} onClick={() => saved.product && onOpenProduct(saved.product)}>Abrir {saved.product.name} (histórico e desfazer)</button>
          )}
          {saved.itemId && (
            <button type="button" className="ps-btn ghost sm" style={{ marginLeft: 8 }} onClick={() => setHistoryItem(saved.itemId ?? null)}>Ver histórico e desfazer</button>
          )}
        </p>
      )}
      {loadError && (
        <p role="alert" style={{ color: 'var(--berry)' }}>{loadError}<button type="button" className="ps-btn ghost sm" style={{ marginLeft: 8 }} onClick={() => setAttempt(value => value + 1)}>Carregar de novo</button></p>
      )}
      {!loadError && !items && <p role="status">Carregando itens fora do cadastro…</p>}
      {items && (
        <>
          <label htmlFor="uso-despesa-busca" style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Filtrar por fornecedor, descrição ou número da nota</label>
          <input id="uso-despesa-busca" className="ps-input" value={filter} disabled={mode !== 'idle'} onChange={event => setFilter(event.target.value)} placeholder="Ex.: margarina, Bersaglio, 184062" style={{ width: '100%' }}/>
          {items.length === 0 && <p>Nenhum item de NF-e da JC está fora do cadastro.</p>}
          {items.length > 0 && filtered.length === 0 && <p>Nenhum item encontrado com esse filtro.</p>}
          {(['uso_despesa', 'revenda'] as const).map(kind => {
            const group = groups[kind]
            if (items.length === 0) return null
            return (
              <section key={kind} aria-label={GROUP_TITLES[kind]} style={{ marginTop: 12 }}>
                <h3 style={{ margin: '0 0 2px', fontSize: 15 }}>{GROUP_TITLES[kind]} ({group.length})</h3>
                <small style={{ display: 'block', color: 'var(--ink-soft)' }}>{GROUP_HINTS[kind]}</small>
                {group.length === 0 && <p style={{ margin: '6px 0 0' }}>Nenhum item {kind === 'revenda' ? 'de revenda sem cadastro' : 'de uso ou despesa'}{filter.trim() ? ' com esse filtro' : ''}.</p>}
                {group.slice(0, NON_CATALOG_LIST_LIMIT).map(renderItem)}
                {group.length > NON_CATALOG_LIST_LIMIT && <small style={{ display: 'block', marginTop: 6 }}>Mostrando {NON_CATALOG_LIST_LIMIT} de {group.length} itens. Use o filtro para achar os outros.</small>}
              </section>
            )
          })}

          {items.length > 0 && mode === 'idle' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
              <button type="button" className="ps-btn primary sm" disabled={Boolean(selectionBlock) || busy} onClick={openForm}>Corrigir para um produto</button>
              <button type="button" className="ps-btn ghost sm" disabled={Boolean(swapBlock) || !swap.target || busy} onClick={previewSwap}>
                {swap.target ? `Passar para ${nonCatalogKindLabel(swap.target)}` : 'Trocar o tipo'}
              </button>
              {busy && <small role="status">Calculando…</small>}
              {selectedItems.length === 0
                ? <small style={{ color: 'var(--ink-soft)' }}>Marque os itens que eram insumo ou revenda com cadastro, ou que entraram com o tipo errado.</small>
                : (selectionBlock || swapBlock || swap.reason) && (
                  <small style={{ color: 'var(--ink-soft)' }}>
                    {[selectionBlock && `Para um produto: ${selectionBlock}`, (swapBlock || swap.reason) && `Para trocar o tipo: ${swapBlock || swap.reason}`].filter(Boolean).join(' ')}
                  </small>
                )}
            </div>
          )}
          {mode === 'idle' && error && <p role="alert" style={{ color: 'var(--berry)', margin: '8px 0 0' }}>{error}</p>}

          {mode === 'form' && (
            <div className="ps-card" style={{ marginTop: 8, padding: 10, background: 'var(--cream-raise)' }}>
              <b>Tirar {selectedItems.length} item(ns) de fora do cadastro</b>
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
                  onClick={() => chosen && factor !== null && selectedItems.length > 0 && void loadPreview(
                    { items: selectedItems.map(item => ({ itemId: item.id, productId: chosen.id, conversionFactor: factor })) },
                    { kind: 'produto', product: chosen }, selectedItems.length, selectedItems[0].id,
                  )}>
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
              confirmLabel={preview.destination.kind === 'produto' ? 'Confirmar correção' : `Confirmar troca para ${nonCatalogKindLabel(preview.destination.kind)}`}
              saving={busy}
              error={error}
              conflict={conflict}
              onConfirm={() => void confirm()}
              onBack={() => {
                generation.current += 1
                setBusy(false)
                setMode(preview.destination.kind === 'produto' ? 'form' : 'idle')
                setPreview(null)
                setError('')
                setConflict(false)
              }}
              onRefreshPreview={() => void loadPreview(preview.request, preview.destination, preview.count, preview.firstItemId)}
            />
          )}
        </>
      )}
    </>
  )
}
