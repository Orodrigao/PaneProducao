'use client'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, X, Search, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, roleColor, type AppUser } from '@/lib/auth'
import { showToast } from '@/lib/utils'
import { formatDecimalPtBR, parsePositiveDecimalInput, type PricingUnit } from '@/lib/saleOptions'

interface ParentProduct {
  id: string
  name: string
  kind: string | null
  category: string | null
  unit: string | null
  cost_price: number | null
  is_revenda: boolean | null
  is_fabricacao_propria: boolean | null
}
interface Component {
  id: string
  parent_product_id: string
  component_source: 'bread' | 'product'
  component_id: string
  quantity: number
}
interface BreadLite   { id: string; name: string; cost_price: number | null; unit: string | null; active: boolean | null }
interface ProductLite {
  id: string
  name: string
  cost_price: number | null
  unit: string | null
  kind: string | null
  active: boolean | null
  is_fabricacao_propria: boolean | null
  legacy_bread_id: string | null
}
type RecipeYieldBasis = 'dough' | 'baked' | 'unit'
interface RecipeYield {
  id: string
  product_id: string
  basis: RecipeYieldBasis
  batch_name: string | null
  dough_weight_kg: number | null
  finished_weight_kg: number | null
  yield_units: number | null
  average_unit_weight_kg: number | null
  bake_loss_pct: number | null
  notes: string | null
}
interface SaleOption {
  id: string
  product_id: string
  name: string
  sale_unit: PricingUnit
  reference_quantity: number
  unit_weight_kg: number | null
  is_default: boolean
  active: boolean
}
interface YieldDraft {
  basis: RecipeYieldBasis
  dough_weight_kg: string
  finished_weight_kg: string
  yield_units: string
}

const RECIPE_BASIS_OPTIONS: Array<{ value: RecipeYieldBasis; label: string }> = [
  { value: 'dough', label: 'Massa crua' },
  { value: 'baked', label: 'Produto assado' },
  { value: 'unit', label: 'Unidade pronta' },
]

function parsePositiveDecimal(raw: string): number | null {
  return parsePositiveDecimalInput(raw)
}

function formatQty(value: number): string {
  return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function isFinitePositive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return fallback
}

function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as { code?: unknown; message?: unknown }
  const code = typeof err.code === 'string' ? err.code : ''
  const message = typeof err.message === 'string' ? err.message : ''
  const mentionsRecipeTables = message.includes('product_sale_options') || message.includes('product_recipe_yields')
  return code === '42P01'
    || code === 'PGRST205'
    || (mentionsRecipeTables && (message.includes('does not exist') || message.includes('Could not find')))
}

function isRecipeMetaAccessError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as { code?: unknown; message?: unknown; status?: unknown }
  const code = typeof err.code === 'string' ? err.code : ''
  const message = typeof err.message === 'string' ? err.message.toLowerCase() : ''
  const status = typeof err.status === 'number' ? err.status : null
  return code === '42501'
    || status === 401
    || status === 403
    || message.includes('permission denied')
    || message.includes('jwt')
}

function draftValue(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value)
}

function nullablePositiveDecimal(raw: string): number | null {
  if (!raw.trim()) return null
  return parsePositiveDecimalInput(raw)
}

function isRecipeYieldBasis(value: string | null | undefined): value is RecipeYieldBasis {
  return value === 'dough' || value === 'baked' || value === 'unit'
}

function costPerUnit(totalCost: number, basis: RecipeYieldBasis, yieldUnits: number | null): number | null {
  if (basis === 'unit') return totalCost
  return yieldUnits !== null ? totalCost / yieldUnits : null
}

function costPerBakedKg(totalCost: number, basis: RecipeYieldBasis, finishedWeight: number | null): number | null {
  if (finishedWeight !== null) return totalCost / finishedWeight
  return basis === 'baked' ? totalCost : null
}

function ComposicaoInner() {
  const sp = useSearchParams()
  const router = useRouter()
  const parentId = sp.get('id') || ''

  const [user, setUser]           = useState<AppUser | null>(null)
  const [parent, setParent]       = useState<ParentProduct | null>(null)
  const [components, setComponents] = useState<Component[]>([])
  const [breads, setBreads]       = useState<BreadLite[]>([])
  const [products, setProducts]   = useState<ProductLite[]>([])
  const [recipeYield, setRecipeYield] = useState<RecipeYield | null>(null)
  const [yieldDraft, setYieldDraft] = useState<YieldDraft>({ basis: 'dough', dough_weight_kg: '', finished_weight_kg: '', yield_units: '' })
  const [saleOptions, setSaleOptions] = useState<SaleOption[]>([])
  const [recipeMetaAvailable, setRecipeMetaAvailable] = useState(true)
  const [recipeMetaMessage, setRecipeMetaMessage] = useState('')
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [newQty, setNewQty]       = useState('1')
  const [qtyEdits, setQtyEdits]   = useState<Record<string, string>>({})
  const [savingProductCost, setSavingProductCost] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [pRes, cRes, bRes, prRes] = await Promise.all([
        supabase.from('products').select('id,name,kind,category,unit,cost_price,is_revenda,is_fabricacao_propria').eq('id', parentId).single(),
        supabase.from('product_components').select('*').eq('parent_product_id', parentId),
        supabase.from('breads').select('id,name,cost_price,unit,active').order('name'),
        supabase.from('products').select('id,name,cost_price,unit,kind,active,is_fabricacao_propria,legacy_bread_id').order('name'),
      ])
      if (pRes.error) throw pRes.error
      setParent(pRes.data as ParentProduct)
      setComponents((cRes.data || []) as Component[])
      setBreads((bRes.data || []) as BreadLite[])
      setProducts((prRes.data || []) as ProductLite[])
      const [yRes, soRes] = await Promise.all([
        supabase.from('product_recipe_yields').select('*').eq('product_id', parentId).maybeSingle(),
        supabase.from('product_sale_options').select('id,product_id,name,sale_unit,reference_quantity,unit_weight_kg,is_default,active').eq('product_id', parentId).order('sale_unit'),
      ])
      if (yRes.error || soRes.error) {
        const err = yRes.error || soRes.error
        if (isMissingRelationError(err)) {
          setRecipeMetaAvailable(false)
          setRecipeMetaMessage('Estrutura de rendimento ainda não aplicada no banco. A ficha continua disponível.')
          setRecipeYield(null)
          setYieldDraft({ basis: 'dough', dough_weight_kg: '', finished_weight_kg: '', yield_units: '' })
          setSaleOptions([])
        } else if (isRecipeMetaAccessError(err)) {
          setRecipeMetaAvailable(false)
          setRecipeMetaMessage('Entre com e-mail e senha para carregar rendimento e formas de venda. O PIN antigo não libera esta etapa.')
          setRecipeYield(null)
          setYieldDraft({ basis: 'dough', dough_weight_kg: '', finished_weight_kg: '', yield_units: '' })
          setSaleOptions([])
        } else {
          throw err
        }
      } else {
        const yieldRow = yRes.data as RecipeYield | null
        setRecipeMetaAvailable(true)
        setRecipeMetaMessage('')
        setRecipeYield(yieldRow)
        setYieldDraft({
          basis: isRecipeYieldBasis(yieldRow?.basis) ? yieldRow.basis : 'dough',
          dough_weight_kg: draftValue(yieldRow?.dough_weight_kg),
          finished_weight_kg: draftValue(yieldRow?.finished_weight_kg),
          yield_units: draftValue(yieldRow?.yield_units),
        })
        setSaleOptions((soRes.data || []) as SaleOption[])
      }
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Erro ao carregar'))
    } finally {
      setLoading(false)
    }
  }, [parentId])

  useEffect(() => { setUser(getCurrentUser()); if (parentId) load() }, [parentId, load])

  async function addComponent(source: 'bread' | 'product', componentId: string) {
    const qty = parsePositiveDecimal(newQty)
    if (qty === null) { showToast('Quantidade inválida'); return }
    try {
      const { data, error } = await supabase
        .from('product_components')
        .insert({ parent_product_id: parentId, component_source: source, component_id: componentId, quantity: qty })
        .select()
        .single()
      if (error) throw error
      setComponents(prev => [...prev, data as Component])
      setSearch('')
      setNewQty('1')
      showToast('Componente adicionado')
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Erro ao adicionar'))
    }
  }

  async function updateQty(componentId: string, raw: string) {
    const qty = parsePositiveDecimal(raw)
    if (qty === null) { showToast('Quantidade inválida'); return }
    try {
      const { error } = await supabase
        .from('product_components')
        .update({ quantity: qty })
        .eq('id', componentId)
      if (error) throw error
      setComponents(prev => prev.map(c => c.id === componentId ? { ...c, quantity: qty } : c))
      setQtyEdits(prev => { const next = { ...prev }; delete next[componentId]; return next })
      showToast('Quantidade atualizada')
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Erro ao atualizar'))
    }
  }

  async function removeComponent(componentId: string) {
    if (!confirm('Remover este componente?')) return
    try {
      const { error } = await supabase.from('product_components').delete().eq('id', componentId)
      if (error) throw error
      setComponents(prev => prev.filter(c => c.id !== componentId))
      showToast('Componente removido')
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Erro ao remover'))
    }
  }

  async function saveRecipeYield() {
    if (!parentId || !recipeMetaAvailable) return
    const dough = nullablePositiveDecimal(yieldDraft.dough_weight_kg)
    const finished = nullablePositiveDecimal(yieldDraft.finished_weight_kg)
    const units = nullablePositiveDecimal(yieldDraft.yield_units)
    if (yieldDraft.dough_weight_kg && dough === null) { showToast('Massa crua inválida'); return }
    if (yieldDraft.finished_weight_kg && finished === null) { showToast('Peso assado inválido'); return }
    if (yieldDraft.yield_units && units === null) { showToast('Rendimento em unidades inválido'); return }
    if (dough === null && finished === null && units === null) { showToast('Informe ao menos um rendimento'); return }

    try {
      const { data, error } = await supabase
        .from('product_recipe_yields')
        .upsert({
          product_id: parentId,
          basis: yieldDraft.basis,
          dough_weight_kg: dough,
          finished_weight_kg: finished,
          yield_units: units,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'product_id' })
        .select()
        .single()
      if (error) throw error
      const nextYield = data as RecipeYield
      setRecipeYield(nextYield)
      setYieldDraft({
        basis: isRecipeYieldBasis(nextYield.basis) ? nextYield.basis : yieldDraft.basis,
        dough_weight_kg: draftValue(nextYield.dough_weight_kg),
        finished_weight_kg: draftValue(nextYield.finished_weight_kg),
        yield_units: draftValue(nextYield.yield_units),
      })
      if (nextYield.average_unit_weight_kg !== null) {
        const { error: optionError } = await supabase
          .from('product_sale_options')
          .update({ unit_weight_kg: nextYield.average_unit_weight_kg, updated_at: new Date().toISOString() })
          .eq('product_id', parentId)
          .eq('sale_unit', 'un')
        if (optionError) throw optionError
        setSaleOptions(prev => prev.map(option =>
          option.sale_unit === 'un' ? { ...option, unit_weight_kg: nextYield.average_unit_weight_kg } : option
        ))
      }
      showToast('Rendimento salvo')
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Erro ao salvar rendimento'))
    }
  }

  async function createSaleOption(saleUnit: PricingUnit) {
    if (!parentId || !recipeMetaAvailable) return
    const alreadyExists = saleOptions.some(option => option.sale_unit === saleUnit)
    if (alreadyExists) { showToast('Essa forma de venda já existe'); return }
    const averageWeight = recipeYield?.average_unit_weight_kg ?? null
    try {
      const { data, error } = await supabase
        .from('product_sale_options')
        .insert({
          product_id: parentId,
          name: saleUnit === 'kg' ? 'Quilo' : 'Unidade',
          sale_unit: saleUnit,
          reference_quantity: 1,
          unit_weight_kg: saleUnit === 'un' ? averageWeight : null,
          is_default: saleOptions.length === 0,
          active: true,
        })
        .select()
        .single()
      if (error) throw error
      setSaleOptions(prev => [...prev, data as SaleOption].sort((a, b) => a.sale_unit.localeCompare(b.sale_unit)))
      showToast(saleUnit === 'kg' ? 'Venda por kg adicionada' : 'Venda por unidade adicionada')
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Erro ao adicionar forma de venda'))
    }
  }

  async function setDefaultSaleOption(option: SaleOption) {
    try {
      const { error: clearError } = await supabase
        .from('product_sale_options')
        .update({ is_default: false })
        .eq('product_id', option.product_id)
      if (clearError) throw clearError
      const { error } = await supabase.from('product_sale_options').update({ is_default: true }).eq('id', option.id)
      if (error) throw error
      setSaleOptions(prev => prev.map(item => ({ ...item, is_default: item.id === option.id })))
      showToast('Forma padrão atualizada')
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Erro ao atualizar forma padrão'))
    }
  }

  async function toggleSaleOption(option: SaleOption) {
    try {
      const nextActive = !option.active
      const { error } = await supabase
        .from('product_sale_options')
        .update({ active: nextActive, is_default: nextActive ? option.is_default : false })
        .eq('id', option.id)
      if (error) throw error
      setSaleOptions(prev => prev.map(item => item.id === option.id ? { ...item, active: nextActive, is_default: nextActive ? item.is_default : false } : item))
      showToast(nextActive ? 'Forma ativada' : 'Forma desativada')
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Erro ao atualizar forma de venda'))
    }
  }

  async function saveProductCostFromRecipe() {
    if (!parent || !productCostCandidate) { showToast('CMV da ficha indisponível'); return }
    if (partialCount > 0) { showToast('Há componente sem custo cadastrado'); return }

    const currentText = manualCost === null ? 'sem custo cadastrado' : formatBRL(manualCost)
    const diffText = productCostDiff === null ? '' : `\nDiferença: ${productCostDiff >= 0 ? '+' : ''}${formatBRL(productCostDiff)}`
    const confirmed = confirm(
      `Atualizar o custo cadastrado de ${parent.name}?\n\n` +
      `Atual: ${currentText}\n` +
      `CMV da ficha: ${formatBRL(productCostCandidate.value)} por ${productCostCandidate.label}` +
      diffText
    )
    if (!confirmed) return

    setSavingProductCost(true)
    try {
      const { error } = await supabase
        .from('products')
        .update({ cost_price: productCostCandidate.value })
        .eq('id', parent.id)
      if (error) throw error

      setParent(prev => prev ? { ...prev, cost_price: productCostCandidate.value } : prev)
      setProducts(prev => prev.map(product =>
        product.id === parent.id ? { ...product, cost_price: productCostCandidate.value } : product
      ))
      showToast('Custo do produto atualizado')
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Erro ao atualizar custo do produto'))
    } finally {
      setSavingProductCost(false)
    }
  }

  // Hidrata componentes com nome/custo/unidade do catalog
  const enriched = useMemo(() => components.map(c => {
    const item = c.component_source === 'bread'
      ? breads.find(b => b.id === c.component_id)
      : products.find(p => p.id === c.component_id)
    const cost = item?.cost_price ?? null
    return {
      ...c,
      name: item?.name ?? '(não encontrado)',
      cost: cost ?? 0,
      hasCost: cost !== null && Number(cost) > 0,
      unit: item?.unit ?? '',
    }
  }), [components, breads, products])

  const totalCMV = enriched.reduce((sum, e) => sum + Number(e.cost) * Number(e.quantity), 0)
  const partialCount = enriched.filter(e => !e.hasCost).length
  const manualCost = parent?.cost_price !== null && parent?.cost_price !== undefined ? Number(parent.cost_price) : null
  const manualDiff = manualCost !== null ? totalCMV - manualCost : null
  const canEditFicha = !!parent && parent.kind !== 'insumo' && !parent.is_revenda
  const yieldUnits = nullablePositiveDecimal(yieldDraft.yield_units)
  const finishedWeight = nullablePositiveDecimal(yieldDraft.finished_weight_kg)
  const doughWeight = nullablePositiveDecimal(yieldDraft.dough_weight_kg)
  const calculatedAverageWeight = finishedWeight !== null && yieldUnits !== null ? finishedWeight / yieldUnits : recipeYield?.average_unit_weight_kg ?? null
  const calculatedBakeLoss = doughWeight !== null && finishedWeight !== null ? ((doughWeight - finishedWeight) / doughWeight) * 100 : recipeYield?.bake_loss_pct ?? null
  const calculatedUnitCost = costPerUnit(totalCMV, yieldDraft.basis, yieldUnits)
  const calculatedBakedKgCost = costPerBakedKg(totalCMV, yieldDraft.basis, finishedWeight)
  const productUnit = (parent?.unit ?? '').trim().toLowerCase()
  const productCostCandidate = (() => {
    if (productUnit === 'kg' && isFinitePositive(calculatedBakedKgCost)) {
      return { value: roundCurrency(calculatedBakedKgCost), label: 'kg assado' }
    }
    if (isFinitePositive(calculatedUnitCost)) {
      return { value: roundCurrency(calculatedUnitCost), label: 'unidade' }
    }
    return null
  })()
  const productCostDiff = productCostCandidate && manualCost !== null ? productCostCandidate.value - manualCost : null
  const canSaveProductCost = canEditFicha && recipeMetaAvailable && partialCount === 0 && productCostCandidate !== null && !savingProductCost
  const hasUnitOption = saleOptions.some(option => option.sale_unit === 'un')
  const hasKgOption = saleOptions.some(option => option.sale_unit === 'kg')

  // Candidatos novos priorizam products. Breads legados só aparecem quando ainda não há produto migrado.
  const addedKeys = new Set(components.map(c => `${c.component_source}-${c.component_id}`))
  const migratedBreadIds = new Set(products.map(p => p.legacy_bread_id).filter(Boolean))
  const q = search.trim().toLowerCase()
  const candidates = q.length < 2 ? [] : [
    ...products
      .filter(p => p.active !== false && p.id !== parentId && p.kind !== 'kit' && !addedKeys.has(`product-${p.id}`) && p.name.toLowerCase().includes(q))
      .map(p => ({ source: 'product' as const, id: p.id, name: p.name, cost: p.cost_price, unit: p.unit, isFabricacao: !!p.is_fabricacao_propria })),
    ...breads
      .filter(b => b.active !== false && !migratedBreadIds.has(b.id) && !addedKeys.has(`bread-${b.id}`) && b.name.toLowerCase().includes(q))
      .map(b => ({ source: 'bread' as const, id: b.id, name: b.name, cost: b.cost_price, unit: b.unit, isFabricacao: false })),
  ].slice(0, 20)

  if (!parentId) {
    return (
      <div className="ps-canvas"><div className="ps-shell"><div className="ps-card" style={{padding:20, textAlign:'center'}}>
        <AlertTriangle size={28} style={{color:'var(--berry)', margin:'0 auto 8px', display:'block'}}/>
        <div style={{marginBottom:12, color:'var(--berry)'}}>Produto não especificado.</div>
        <Link href="/produtos" className="ps-btn primary">Voltar pra Produtos</Link>
      </div></div></div>
    )
  }

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <button onClick={() => router.push('/produtos')} className="ps-iconbtn" style={{marginRight:8}}>
              <ArrowLeft size={16}/>
            </button>
            <div className="ps-brand">
              <b>Ficha Técnica</b>
              <span>{parent?.name || '…'}</span>
            </div>
          </div>
          {user && (
            <div className="ps-userchip">
              <div className="ps-avatar" style={{background: roleColor(user.role)}}>{user.displayName.charAt(0).toUpperCase()}</div>
              <b>{user.displayName}</b>
            </div>
          )}
        </header>

        <div className="ps-body">
          {loading ? (
            <div className="ps-card" style={{padding:24, textAlign:'center', color:'var(--ink-faint)'}}>Carregando…</div>
          ) : (
            <>
              {!canEditFicha && parent && (
                <div className="ps-warning" style={{marginBottom:12}}>
                  <AlertTriangle size={16} style={{flexShrink:0, marginTop:1}}/>
                  <span>
                    <strong>{parent.name}</strong> usa custo direto. Para montar ficha técnica, ajuste o tipo para <strong>Produto final</strong> ou <strong>Kit</strong> em <Link href="/produtos" style={{textDecoration:'underline'}}>Catálogo</Link>.
                  </span>
                </div>
              )}

              <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(120px, 1fr))', gap:8, marginBottom:12}}>
                <div className="ps-card" style={{padding:12}}>
                  <div className="ps-flabel">CMV teórico</div>
                  <div style={{fontSize:20, fontWeight:800, color:'var(--ps-ink)'}}>{formatBRL(totalCMV)}</div>
                  <div style={{fontSize:11, color:partialCount > 0 ? 'var(--berry)' : 'var(--ink-faint)'}}>
                    {enriched.length === 0 ? 'sem ficha' : partialCount > 0 ? `${partialCount} sem custo` : 'custos completos'}
                  </div>
                </div>
                <div className="ps-card" style={{padding:12}}>
                  <div className="ps-flabel">Componentes</div>
                  <div style={{fontSize:20, fontWeight:800, color:'var(--ps-ink)'}}>{enriched.length}</div>
                  <div style={{fontSize:11, color:'var(--ink-faint)'}}>produtos ou insumos</div>
                </div>
                <div className="ps-card" style={{padding:12}}>
                  <div className="ps-flabel">Custo manual</div>
                  <div style={{fontSize:20, fontWeight:800, color:'var(--ps-ink)'}}>{manualCost === null ? '—' : formatBRL(manualCost)}</div>
                  <div style={{fontSize:11, color:'var(--ink-faint)'}}>
                    {manualDiff === null ? 'não cadastrado' : `${manualDiff >= 0 ? '+' : ''}${formatBRL(manualDiff)} vs ficha`}
                  </div>
                </div>
              </div>

              {canEditFicha && (
                <div className="ps-card" style={{padding:14, marginBottom:12}}>
                  <div className="ps-flabel" style={{marginBottom:8}}>Rendimento e venda</div>
                  {!recipeMetaAvailable ? (
                    <div className="ps-warning" style={{marginBottom:0}}>
                      <AlertTriangle size={16} style={{flexShrink:0, marginTop:1}}/>
                      <span>
                        {recipeMetaMessage || 'Rendimento indisponível no momento.'}
                        {recipeMetaMessage.includes('e-mail') && (
                          <>
                            {' '}
                            <Link
                              href={`/login?force=email&returnTo=${encodeURIComponent(`/produtos/composicao?id=${parentId}`)}`}
                              style={{textDecoration:'underline'}}
                            >
                              Ir para login
                            </Link>
                          </>
                        )}
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="ps-fieldgroup" style={{marginBottom:10}}>
                        <div className="ps-fieldlabel">Base da ficha</div>
                        <select
                          value={yieldDraft.basis}
                          onChange={e=>setYieldDraft(prev=>({...prev, basis: e.target.value as RecipeYieldBasis}))}
                          className="ps-select"
                        >
                          {RECIPE_BASIS_OPTIONS.map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="ps-fieldrow" style={{marginBottom:10}}>
                        <div className="ps-fieldgroup">
                          <div className="ps-fieldlabel">Massa crua (kg)</div>
                          <input
                            inputMode="decimal"
                            value={yieldDraft.dough_weight_kg}
                            onChange={e=>setYieldDraft(prev=>({...prev, dough_weight_kg:e.target.value.replace(/[^\d,.]/g, '')}))}
                            placeholder="ex: 8,5"
                            className="ps-input"
                          />
                        </div>
                        <div className="ps-fieldgroup">
                          <div className="ps-fieldlabel">Pão assado (kg)</div>
                          <input
                            inputMode="decimal"
                            value={yieldDraft.finished_weight_kg}
                            onChange={e=>setYieldDraft(prev=>({...prev, finished_weight_kg:e.target.value.replace(/[^\d,.]/g, '')}))}
                            placeholder="ex: 7,2"
                            className="ps-input"
                          />
                        </div>
                        <div className="ps-fieldgroup">
                          <div className="ps-fieldlabel">Rende (un)</div>
                          <input
                            inputMode="decimal"
                            value={yieldDraft.yield_units}
                            onChange={e=>setYieldDraft(prev=>({...prev, yield_units:e.target.value.replace(/[^\d,.]/g, '')}))}
                            placeholder="ex: 30"
                            className="ps-input"
                          />
                        </div>
                      </div>
                      <div style={{display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:12}}>
                        <span className="ps-store-chip">
                          peso médio: {calculatedAverageWeight ? `${formatDecimalPtBR(calculatedAverageWeight, 3)} kg/un` : '—'}
                        </span>
                        <span className="ps-store-chip">
                          perda forno: {calculatedBakeLoss !== null && Number.isFinite(calculatedBakeLoss) ? `${formatDecimalPtBR(calculatedBakeLoss, 1)}%` : '—'}
                        </span>
                        <span className="ps-store-chip">
                          CMV/un: {calculatedUnitCost !== null && Number.isFinite(calculatedUnitCost) ? formatBRL(calculatedUnitCost) : '—'}
                        </span>
                        <span className="ps-store-chip">
                          CMV/kg assado: {calculatedBakedKgCost !== null && Number.isFinite(calculatedBakedKgCost) ? formatBRL(calculatedBakedKgCost) : '—'}
                        </span>
                        <button onClick={saveRecipeYield} className="ps-btn sm primary" style={{marginLeft:'auto'}}>
                          Salvar rendimento
                        </button>
                      </div>
                      <div style={{borderTop:'1px solid var(--line-soft)', paddingTop:10, marginBottom:12, display:'flex', gap:10, alignItems:'center', justifyContent:'space-between', flexWrap:'wrap'}}>
                        <div style={{minWidth:220, flex:1}}>
                          <div className="ps-flabel" style={{marginBottom:2}}>Custo do produto</div>
                          <div style={{fontSize:13, color:'var(--ink-soft)'}}>
                            Atual: <strong style={{color:'var(--ps-ink)'}}>{manualCost === null ? '—' : formatBRL(manualCost)}</strong>
                            {' · '}
                            Ficha: <strong style={{color:'var(--ps-ink)'}}>{productCostCandidate ? formatBRL(productCostCandidate.value) : '—'}</strong>
                            {productCostCandidate && `/${productCostCandidate.label}`}
                          </div>
                          <div style={{fontSize:11, color:partialCount > 0 ? 'var(--berry)' : 'var(--ink-faint)', marginTop:2}}>
                            {partialCount > 0
                              ? 'Complete os custos dos componentes antes de atualizar.'
                              : productCostDiff === null
                                ? 'Salva o CMV calculado no cadastro do produto.'
                                : `${productCostDiff >= 0 ? '+' : ''}${formatBRL(productCostDiff)} vs custo atual`}
                          </div>
                        </div>
                        <button
                          onClick={saveProductCostFromRecipe}
                          disabled={!canSaveProductCost}
                          className="ps-btn sm ghost"
                          style={!canSaveProductCost ? {opacity:.5} : undefined}
                        >
                          {savingProductCost ? 'Salvando...' : 'Salvar CMV no produto'}
                        </button>
                      </div>

                      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, marginBottom:8}}>
                        <div className="ps-flabel" style={{marginBottom:0}}>Formas de venda</div>
                        <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
                          <button onClick={()=>createSaleOption('un')} disabled={hasUnitOption} className="ps-btn sm ghost" style={hasUnitOption?{opacity:.5}:undefined}>
                            + Unidade
                          </button>
                          <button onClick={()=>createSaleOption('kg')} disabled={hasKgOption} className="ps-btn sm ghost" style={hasKgOption?{opacity:.5}:undefined}>
                            + Quilo
                          </button>
                        </div>
                      </div>
                      {saleOptions.length === 0 ? (
                        <div style={{fontSize:13, color:'var(--ink-faint)'}}>
                          Nenhuma forma cadastrada ainda.
                        </div>
                      ) : (
                        <div style={{display:'grid', gap:8}}>
                          {saleOptions.map(option => (
                            <div key={option.id} style={{display:'flex', alignItems:'center', gap:8, padding:'8px 0', borderTop:'1px solid var(--line-soft)', opacity:option.active?1:.55}}>
                              <div style={{flex:1, minWidth:0}}>
                                <div style={{fontSize:14, fontWeight:700, color:'var(--ps-ink)'}}>
                                  {option.name} <span style={{color:'var(--ink-faint)', fontSize:12}}>/{option.sale_unit}</span>
                                  {option.is_default && <span className="ps-store-chip ja" style={{marginLeft:6}}>padrão</span>}
                                </div>
                                <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:2}}>
                                  {option.sale_unit === 'un'
                                    ? `peso médio ${option.unit_weight_kg ? `${formatDecimalPtBR(option.unit_weight_kg, 3)} kg` : 'não definido'}`
                                    : 'preço e venda por kg do produto assado'}
                                </div>
                              </div>
                              {!option.is_default && option.active && (
                                <button onClick={()=>setDefaultSaleOption(option)} className="ps-btn sm ghost">
                                  padrão
                                </button>
                              )}
                              <button onClick={()=>toggleSaleOption(option)} className={`ps-status ${option.active?'conferido':'separado'}`} style={{border:'1px solid transparent', cursor:'pointer'}}>
                                {option.active ? 'ativo' : 'inativo'}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Lista de componentes atuais */}
              <div className="ps-card" style={{padding:14, marginBottom:12}}>
                <div className="ps-flabel" style={{marginBottom:8}}>Componentes ({enriched.length})</div>
                {enriched.length === 0 ? (
                  <div style={{padding:'14px 4px', color:'var(--ink-faint)', fontSize:13, textAlign:'center'}}>
                    Nenhum componente cadastrado ainda.
                  </div>
                ) : (
                  enriched.map(e => (
                    <div key={e.id} style={{display:'flex', alignItems:'center', gap:8, padding:'10px 0', borderBottom:'1px solid var(--line-soft)'}}>
                      <div style={{flex:1, minWidth:0}}>
                        <div style={{fontSize:14, fontWeight:600, color:'var(--ps-ink)', display:'flex', alignItems:'center', gap:6, flexWrap:'wrap'}}>
                          {e.name}
                          <span className={`ps-store-chip ${e.component_source==='bread'?'jc':'ja'}`}>{e.component_source==='bread'?'PÃO':'PRODUTO'}</span>
                          {!e.hasCost && <span className="ps-store-chip" style={{background:'var(--berry-tint)', color:'var(--berry)'}}>SEM CUSTO</span>}
                        </div>
                        <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:2}}>
                          {e.hasCost
                            ? `${formatBRL(Number(e.cost))}${e.unit?`/${e.unit}`:''} × ${formatQty(Number(e.quantity))} = ${formatBRL(Number(e.cost)*Number(e.quantity))}`
                            : `× ${formatQty(Number(e.quantity))}${e.unit?` ${e.unit}`:''}`}
                        </div>
                      </div>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={qtyEdits[e.id] ?? formatQty(Number(e.quantity))}
                        onChange={ev => setQtyEdits(prev => ({...prev, [e.id]: ev.target.value.replace(/[^\d,.]/g, '')}))}
                        onBlur={ev => {
                          const v = ev.target.value
                          const parsed = parsePositiveDecimal(v)
                          if (parsed === null) {
                            showToast('Quantidade inválida')
                            setQtyEdits(prev => { const n = {...prev}; delete n[e.id]; return n })
                          } else if (parsed !== Number(e.quantity)) updateQty(e.id, v)
                          else setQtyEdits(prev => { const n = {...prev}; delete n[e.id]; return n })
                        }}
                        disabled={!canEditFicha}
                        className="ps-input"
                        style={{width:70, textAlign:'right', padding:'6px 8px'}}
                      />
                      {canEditFicha && (
                        <button onClick={() => removeComponent(e.id)} className="ps-iconbtn" style={{width:30, height:30}} title="Remover componente">
                          <X size={14}/>
                        </button>
                      )}
                    </div>
                  ))
                )}

                {/* Sumário CMV */}
                {enriched.length > 0 && (
                  <div style={{marginTop:12, paddingTop:10, borderTop:'1px solid var(--ps-line)', display:'flex', justifyContent:'space-between', alignItems:'baseline'}}>
                    <div style={{fontSize:12, color:'var(--ink-soft)'}}>
                      CMV teórico{partialCount > 0 && <span style={{color:'var(--berry)'}}> · {partialCount} sem custo</span>}
                    </div>
                    <div style={{fontSize:18, fontWeight:700, color:'var(--ps-ink)'}}>{formatBRL(totalCMV)}</div>
                  </div>
                )}

                {parent && parent.cost_price !== null && (
                  <div style={{marginTop:6, fontSize:11, color:'var(--ink-faint)', textAlign:'right'}}>
                    Custo manual cadastrado: {formatBRL(Number(parent.cost_price))}
                  </div>
                )}
              </div>

              {/* Adicionar componente */}
              {canEditFicha && (
                <div className="ps-card" style={{padding:14}}>
                  <div className="ps-flabel" style={{marginBottom:8}}>Adicionar componente</div>
                  <div style={{display:'flex', gap:8, marginBottom:8}}>
                    <div style={{flex:1, position:'relative'}}>
                      <Search size={14} style={{position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--ink-faint)'}}/>
                      <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Buscar pão ou produto…"
                        className="ps-input"
                        style={{paddingLeft:30}}
                      />
                    </div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={newQty}
                      onChange={e => setNewQty(e.target.value.replace(/[^\d,.]/g, ''))}
                      placeholder="Qtd"
                      className="ps-input"
                      style={{width:80, textAlign:'right'}}
                    />
                  </div>

                  {q.length >= 2 && (
                    <div style={{maxHeight:300, overflowY:'auto', border:'1px solid var(--line-soft)', borderRadius:8}}>
                      {candidates.length === 0 ? (
                        <div style={{padding:14, textAlign:'center', color:'var(--ink-faint)', fontSize:13}}>
                          Nenhum resultado. (Kits e itens já adicionados são filtrados.)
                        </div>
                      ) : candidates.map(c => (
                        <button
                          key={`${c.source}-${c.id}`}
                          onClick={() => addComponent(c.source, c.id)}
                          style={{display:'flex', alignItems:'center', gap:8, padding:'10px 12px', borderBottom:'1px solid var(--line-soft)', width:'100%', textAlign:'left', background:'transparent', border:'none', cursor:'pointer'}}
                        >
                          <div style={{flex:1, minWidth:0}}>
                            <div style={{fontSize:13, fontWeight:600, color:'var(--ps-ink)', display:'flex', alignItems:'center', gap:6}}>
                              {c.name}
                              <span className={`ps-store-chip ${c.source==='bread'?'jc':'ja'}`}>{c.source==='bread'?'PÃO':'PRODUTO'}</span>
                              {c.isFabricacao && <span className="ps-store-chip jc">FABRICAÇÃO</span>}
                            </div>
                            <div style={{fontSize:11, color:'var(--ink-faint)'}}>
                              {c.cost ? `${formatBRL(Number(c.cost))}${c.unit?`/${c.unit}`:''}` : 'sem custo cadastrado'}
                            </div>
                          </div>
                          <Plus size={14} style={{color:'var(--honey-deep)'}}/>
                        </button>
                      ))}
                    </div>
                  )}

                  {q.length > 0 && q.length < 2 && (
                    <div style={{padding:10, fontSize:12, color:'var(--ink-faint)'}}>Digite ao menos 2 caracteres…</div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ComposicaoPage() {
  return (
    <Suspense fallback={
      <div className="ps-canvas"><div className="ps-shell"><div style={{padding:24, color:'var(--ink-faint)'}}>Carregando…</div></div></div>
    }>
      <ComposicaoInner/>
    </Suspense>
  )
}
