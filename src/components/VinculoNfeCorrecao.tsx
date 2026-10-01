'use client'

import { useEffect, useMemo, useState } from 'react'
import { describeCorrectionEffect, factorInputText, invoiceMatchesMemory, parseFactorInput, type MemoryCorrectionAction } from '@/lib/vinculosNfe'
import { correctSupplierMapping, searchLinkProducts, type InvoiceLinkHistory, type ProductOption, type SupplierMapping } from '@/lib/vinculosNfeClient'
import { findCurrentRecipeUsage, type RecipeUsageIndex } from '@/lib/recipeUsage'

const PRODUCT_CHOICES = 8

const CONFIRM_LABELS: Record<MemoryCorrectionAction, string> = {
  corrigir: 'Confirmar correção',
  desligar: 'Confirmar desligamento',
  religar: 'Confirmar religação',
}

const SUCCESS_LABELS: Record<MemoryCorrectionAction, string> = {
  corrigir: 'Memória corrigida. Vale a partir da próxima NF-e deste fornecedor.',
  desligar: 'Memória desligada. A próxima NF-e deste item chega sem a sugestão desta memória.',
  religar: 'Memória religada. Vale a partir da próxima NF-e deste fornecedor.',
}

interface Props {
  memory: SupplierMapping
  currentProductName: string
  invoices: readonly InvoiceLinkHistory[]
  recipeUsageIndex: RecipeUsageIndex
  onSaved: (message: string) => void
  /** Relê os vínculos do produto, para conferir de novo o que mudou. */
  onReload: () => void
}

/**
 * Corrigir, desligar ou religar uma memória de vínculo. Sempre passa por uma
 * prévia que diz o que muda nas próximas notas e o que não muda nas antigas.
 */
export default function VinculoNfeCorrecao({ memory, currentProductName, invoices, recipeUsageIndex, onSaved, onReload }: Props) {
  const [mode, setMode] = useState<'idle' | 'form' | 'preview'>('idle')
  const [action, setAction] = useState<MemoryCorrectionAction>('corrigir')
  const [search, setSearch] = useState('')
  const [options, setOptions] = useState<ProductOption[]>([])
  const [searching, setSearching] = useState(false)
  const [chosen, setChosen] = useState<ProductOption | null>(null)
  const [factorText, setFactorText] = useState('')
  const [requestId, setRequestId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    if (mode !== 'form') return () => { active = false }
    setSearching(true)
    void searchLinkProducts(search).then(result => {
      if (active) setOptions(result.filter(product => product.active).slice(0, PRODUCT_CHOICES))
    }).catch(() => {
      if (active) setOptions([])
    }).finally(() => {
      if (active) setSearching(false)
    })
    return () => { active = false }
  }, [mode, search])

  const factor = parseFactorInput(factorText)
  const savedInvoices = useMemo(() => invoices.filter(invoice => invoiceMatchesMemory(memory, invoice)).length, [invoices, memory])

  const effect = useMemo(() => {
    const usage = chosen ? findCurrentRecipeUsage(recipeUsageIndex, chosen.id) : null
    return describeCorrectionEffect({
      action,
      memory,
      currentProductName,
      newProduct: chosen ? { name: chosen.name, unit: chosen.unit } : undefined,
      newFactor: factor ?? undefined,
      savedInvoices,
      recipeNames: usage?.usages.map(item => item.name) ?? [],
      recipesTruncated: usage?.truncated ?? false,
    })
  }, [action, memory, currentProductName, chosen, factor, savedInvoices, recipeUsageIndex])

  const unchanged = chosen !== null && memory.active && chosen.id === memory.base_product_id
    && factor === memory.conversion_factor && (chosen.unit || 'un') === memory.base_unit
  const formBlock = !chosen ? 'Escolha o produto certo do catálogo.'
    : factor === null ? 'Informe quanto vem em cada unidade da nota: maior que zero, até seis casas, com vírgula para decimal (1.000 é recusado; escreva 1000).'
    : unchanged ? 'Nada mudou: escolha outro produto ou outro fator.'
    : ''

  function reset() {
    setMode('idle')
    setChosen(null)
    setSearch('')
    setFactorText('')
    setRequestId('')
    setError('')
  }

  function openForm() {
    setAction('corrigir')
    setFactorText(factorInputText(memory.conversion_factor))
    setError('')
    setMode('form')
  }

  function openPreview(next: MemoryCorrectionAction) {
    setAction(next)
    // Um identificador por prévia: tentar de novo depois de um erro de rede
    // reenvia o mesmo pedido, e o banco não aplica duas vezes.
    setRequestId(crypto.randomUUID())
    setError('')
    setMode('preview')
  }

  async function confirm() {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      await correctSupplierMapping({
        requestId,
        mappingId: memory.id,
        expectedUpdatedAt: memory.updated_at,
        action,
        productId: action === 'corrigir' ? chosen?.id : undefined,
        conversionFactor: action === 'corrigir' ? factor ?? undefined : undefined,
      })
      reset()
      onSaved(SUCCESS_LABELS[action])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível gravar a correção.')
    } finally {
      setSaving(false)
    }
  }

  if (mode === 'idle') {
    return (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <button type="button" className="ps-btn ghost sm" onClick={openForm}>Corrigir</button>
        {memory.active
          ? <button type="button" className="ps-btn ghost sm" onClick={() => openPreview('desligar')}>Desligar</button>
          : <button type="button" className="ps-btn ghost sm" onClick={() => openPreview('religar')}>Religar</button>}
      </div>
    )
  }

  if (mode === 'form') {
    const unit = chosen?.unit || 'unidade do produto'
    return (
      <div className="ps-card" style={{ marginTop: 8, padding: 10, background: 'var(--cream-raise)' }}>
        <b>Corrigir a memória</b>
        <label htmlFor={`correcao-busca-${memory.id}`} style={{ display: 'block', marginTop: 8, fontWeight: 600 }}>Produto certo</label>
        <input id={`correcao-busca-${memory.id}`} className="ps-input" value={search} onChange={event => { setSearch(event.target.value); setChosen(null) }} placeholder="Digite o nome do produto" style={{ width: '100%' }}/>
        {searching && <small role="status">Buscando…</small>}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          {options.map(product => (
            <button key={product.id} type="button" className={`ps-btn ${chosen?.id === product.id ? 'primary' : 'ghost'} sm`} aria-pressed={chosen?.id === product.id} onClick={() => setChosen(product)}>
              {product.name} ({product.unit || 'un'})
            </button>
          ))}
          {!searching && options.length === 0 && <small>Nenhum produto ativo encontrado.</small>}
        </div>
        <label htmlFor={`correcao-fator-${memory.id}`} style={{ display: 'block', marginTop: 10, fontWeight: 600 }}>
          Quanto vem em 1 {memory.purchase_unit} da nota, em {unit}
        </label>
        <input id={`correcao-fator-${memory.id}`} className="ps-input" inputMode="decimal" value={factorText} onChange={event => setFactorText(event.target.value)} style={{ width: 140 }}/>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
          <button type="button" className="ps-btn primary sm" disabled={Boolean(formBlock)} onClick={() => openPreview('corrigir')}>Ver efeito</button>
          <button type="button" className="ps-btn ghost sm" onClick={reset}>Cancelar</button>
          {formBlock && <small style={{ color: 'var(--ink-soft)' }}>{formBlock}</small>}
        </div>
      </div>
    )
  }

  return (
    <div className="ps-card" style={{ marginTop: 8, padding: 10, background: 'var(--cream-raise)', borderLeft: '4px solid var(--teal)' }}>
      <b>Confira o efeito antes de confirmar</b>
      <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
        {effect.map(line => <li key={line}>{line}</li>)}
      </ul>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <button type="button" className="ps-btn primary sm" disabled={saving} onClick={() => void confirm()}>{saving ? 'Gravando…' : CONFIRM_LABELS[action]}</button>
        <button type="button" className="ps-btn ghost sm" disabled={saving} onClick={() => action === 'corrigir' ? setMode('form') : reset()}>Voltar</button>
      </div>
      {error && (
        <p role="alert" style={{ color: 'var(--berry)', margin: '8px 0 0' }}>
          {error}
          <button type="button" className="ps-btn ghost sm" style={{ marginLeft: 8 }} disabled={saving} onClick={() => { reset(); onReload() }}>Recarregar vínculos</button>
        </p>
      )}
    </div>
  )
}
