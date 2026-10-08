'use client'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, X, Search, AlertTriangle, Copy } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, roleColor, type AppUser } from '@/lib/auth'
import { showToast } from '@/lib/utils'
import {
  calculateSuggestedPrice,
  formatDecimalPtBR,
  parseNonNegativeDecimalInput,
  parsePositiveDecimalInput,
  type PricingUnit,
} from '@/lib/saleOptions'
import {
  calculateFlourMixAddition,
  calculateFlourMixRebalance,
  calculateFlourSharePercent,
  calculateRecipeTotals,
  isFlourComponent,
  isPackagingComponent,
  packagingCostForPriceBase,
  quantityFromBakersPercentage,
  quantityFromBakersPercentageForComponent,
  type PriceBase,
} from '@/lib/recipeMath'
import {
  calculatePortionYield,
  formatGrams,
  portionDraftFromYield,
  portionDraftsEqual,
  portionYieldDiffersFromStored,
  type PortionDraft,
  type PortionYieldResult,
} from '@/lib/recipePortions'

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
  component_variant_id: string | null
  quantity: number
}
interface BreadLite   { id: string; name: string; cost_price: number | null; unit: string | null; active: boolean | null }
interface ProductLite {
  id: string
  name: string
  cost_price: number | null
  unit: string | null
  category: string | null
  kind: string | null
  active: boolean | null
  is_fabricacao_propria: boolean | null
  legacy_bread_id: string | null
}
type RecipeYieldBasis = 'dough' | 'baked' | 'unit'
type QuantityInputMode = 'weight' | 'baker_pct'
interface RecipeYield {
  id: string
  product_id: string
  product_variant_id: string | null
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
  product_variant_id: string | null
  name: string
  sale_unit: PricingUnit
  reference_quantity: number
  unit_weight_kg: number | null
  is_default: boolean
  active: boolean
}
interface ProductVariant {
  id: string
  product_id: string
  name: string
  sort_order: number
  active: boolean
}
// Linha de rendimento: o produto sem variante (legado) ou uma variante.
interface YieldRow {
  key: string
  variantId: string | null
  label: string
  active: boolean
}
const LEGACY_YIELD_ROW_KEY = 'legacy'
type PriceFormationBase = PriceBase
interface PriceFormationDraft {
  packagingCost: string
  laborCost: string
  lossPct: string
  taxPct: string
  desiredMarginPct: string
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
  const mentionsRecipeTables = message.includes('product_sale_options') || message.includes('product_recipe_yields') || message.includes('product_variants')
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

function nonNegativeDecimal(raw: string): number | null {
  if (!raw.trim()) return 0
  return parseNonNegativeDecimalInput(raw)
}

function isRecipeYieldBasis(value: string | null | undefined): value is RecipeYieldBasis {
  return value === 'dough' || value === 'baked' || value === 'unit'
}

function isDuplicateVariantNameError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as { code?: unknown }
  return err.code === '23505'
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
  const [recipeYields, setRecipeYields] = useState<RecipeYield[]>([])
  const [portionEdits, setPortionEdits] = useState<Record<string, PortionDraft>>({})
  const [yieldBasisEdit, setYieldBasisEdit] = useState<RecipeYieldBasis | null>(null)
  const [manualDoughEdit, setManualDoughEdit] = useState<string | null>(null)
  const [savingYields, setSavingYields] = useState(false)
  const savingYieldsRef = useRef(false)
  // Linhas cujo rendimento gravou mas o peso de venda não: seguem pendentes.
  const [saleSyncPending, setSaleSyncPending] = useState<string[]>([])
  const [saleOptions, setSaleOptions] = useState<SaleOption[]>([])
  const [variants, setVariants] = useState<ProductVariant[]>([])
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null)
  const [newVariantName, setNewVariantName] = useState('')
  const [savingVariant, setSavingVariant] = useState(false)
  const [variantNameEdits, setVariantNameEdits] = useState<Record<string, string>>({})
  const [recipeMetaAvailable, setRecipeMetaAvailable] = useState(true)
  const [recipeMetaMessage, setRecipeMetaMessage] = useState('')
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [newQty, setNewQty]       = useState('1')
  const [newQtyMode, setNewQtyMode] = useState<QuantityInputMode>('weight')
  const [qtyEdits, setQtyEdits]   = useState<Record<string, string>>({})
  const [kitVariantChoice, setKitVariantChoice] = useState<{ componentId: string; name: string; qty: number; variants: ProductVariant[] } | null>(null)
  const [componentVariantNames, setComponentVariantNames] = useState<Record<string, string>>({})
  const [flourPctEdits, setFlourPctEdits] = useState<Record<string, string>>({})
  const [savingProductCost, setSavingProductCost] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importSearch, setImportSearch] = useState('')
  const [importingRecipe, setImportingRecipe] = useState(false)
  const [priceFormationBase, setPriceFormationBase] = useState<PriceFormationBase>('un')
  const [priceFormationDraft, setPriceFormationDraft] = useState<PriceFormationDraft>({
    packagingCost: '',
    laborCost: '',
    lossPct: '',
    taxPct: '',
    desiredMarginPct: '65',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [pRes, cRes, bRes, prRes] = await Promise.all([
        supabase.from('products').select('id,name,kind,category,unit,cost_price,is_revenda,is_fabricacao_propria').eq('id', parentId).single(),
        supabase.from('product_components').select('*').eq('parent_product_id', parentId),
        supabase.from('breads').select('id,name,cost_price,unit,active').order('name'),
        supabase.from('products').select('id,name,cost_price,unit,category,kind,active,is_fabricacao_propria,legacy_bread_id').order('name'),
      ])
      if (pRes.error) throw pRes.error
      setParent(pRes.data as ParentProduct)
      const loadedComponents = (cRes.data || []) as Component[]
      setComponents(loadedComponents)
      setBreads((bRes.data || []) as BreadLite[])
      setProducts((prRes.data || []) as ProductLite[])

      // Nome da variante do componente (pode pertencer a outro produto, fora
      // da lista de variantes do produto atual) — só pra exibir na lista.
      const componentVariantIds = Array.from(new Set(
        loadedComponents.map(c => c.component_variant_id).filter((id): id is string => !!id)
      ))
      if (componentVariantIds.length > 0) {
        const { data: variantNameRows } = await supabase
          .from('product_variants').select('id,name').in('id', componentVariantIds)
        setComponentVariantNames(Object.fromEntries((variantNameRows ?? []).map(v => [v.id as string, v.name as string])))
      } else {
        setComponentVariantNames({})
      }
      const [yRes, soRes, vRes] = await Promise.all([
        supabase.from('product_recipe_yields').select('*').eq('product_id', parentId),
        supabase.from('product_sale_options').select('id,product_id,product_variant_id,name,sale_unit,reference_quantity,unit_weight_kg,is_default,active').eq('product_id', parentId).order('sale_unit'),
        supabase.from('product_variants').select('id,product_id,name,sort_order,active').eq('product_id', parentId).order('sort_order').order('name'),
      ])
      if (yRes.error || soRes.error || vRes.error) {
        const err = yRes.error || soRes.error || vRes.error
        if (isMissingRelationError(err)) {
          setRecipeMetaAvailable(false)
          setRecipeMetaMessage('Estrutura de rendimento ainda não aplicada no banco. A ficha continua disponível.')
          setRecipeYields([])
          setSaleOptions([])
          setVariants([])
          setSelectedVariantId(null)
        } else if (isRecipeMetaAccessError(err)) {
          setRecipeMetaAvailable(false)
          setRecipeMetaMessage('Entre com e-mail e senha para carregar rendimento e formas de venda.')
          setRecipeYields([])
          setSaleOptions([])
          setVariants([])
          setSelectedVariantId(null)
        } else {
          throw err
        }
      } else {
        setRecipeMetaAvailable(true)
        setRecipeMetaMessage('')
        setRecipeYields((yRes.data || []) as RecipeYield[])
        setPortionEdits({})
        setYieldBasisEdit(null)
        setManualDoughEdit(null)
        setSaleSyncPending([])
        setSaleOptions((soRes.data || []) as SaleOption[])
        const loadedVariants = (vRes.data || []) as ProductVariant[]
        setVariants(loadedVariants)
        // Escolhido só aqui, uma vez por carregamento — nunca reage a criar,
        // renomear ou ativar/desativar variante depois, senão sobrescreveria
        // a escolha explícita de "produto (sem variante)" do usuário.
        setSelectedVariantId(loadedVariants.length === 0 ? null : (loadedVariants.find(v => v.active)?.id ?? loadedVariants[0].id))
      }
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Erro ao carregar'))
    } finally {
      setLoading(false)
    }
  }, [parentId])

  useEffect(() => { setUser(getCurrentUser()); if (parentId) load() }, [parentId, load])

  const recipeYield = useMemo(
    () => recipeYields.find(y => (y.product_variant_id ?? null) === selectedVariantId) ?? null,
    [recipeYields, selectedVariantId],
  )

  const saleOptionsForSelected = useMemo(
    () => saleOptions.filter(o => (o.product_variant_id ?? null) === selectedVariantId),
    [saleOptions, selectedVariantId],
  )

  // A receita é uma só; cada linha (produto sem variante e cada variante)
  // divide a mesma massa pela própria porção. Tudo é editado junto.
  const yieldRows = useMemo<YieldRow[]>(() => [
    { key: LEGACY_YIELD_ROW_KEY, variantId: null, label: variants.length === 0 ? 'Produto' : 'Produto (sem variante)', active: true },
    ...variants.map(v => ({ key: v.id, variantId: v.id, label: v.name, active: v.active })),
  ], [variants])

  const storedYieldByKey = useMemo(() => {
    const map = new Map<string, RecipeYield>()
    for (const row of recipeYields) map.set(row.product_variant_id ?? LEGACY_YIELD_ROW_KEY, row)
    return map
  }, [recipeYields])

  const storedYieldBasis: RecipeYieldBasis = useMemo(() => {
    const bases = recipeYields.map(y => y.basis).filter(isRecipeYieldBasis)
    if (bases.includes('unit')) return 'unit'
    if (bases.length > 0 && bases.every(b => b === 'baked')) return 'baked'
    return 'dough'
  }, [recipeYields])
  const yieldBasis = yieldBasisEdit ?? storedYieldBasis

  const storedManualDough = draftValue(recipeYields.find(y => y.dough_weight_kg !== null)?.dough_weight_kg)
  const manualDough = manualDoughEdit ?? storedManualDough

  function storedPortionDraft(key: string): PortionDraft {
    return portionDraftFromYield(storedYieldByKey.get(key) ?? null)
  }

  function portionDraftFor(key: string): PortionDraft {
    return portionEdits[key] ?? storedPortionDraft(key)
  }

  function editPortion(key: string, field: keyof PortionDraft, raw: string) {
    const value = raw.replace(/[^\d,.]/g, '')
    setPortionEdits(prev => ({ ...prev, [key]: { ...(prev[key] ?? storedPortionDraft(key)), [field]: value } }))
  }

  function selectVariant(variantId: string | null) {
    setSelectedVariantId(variantId)
  }

  async function createVariant() {
    const name = newVariantName.trim()
    if (!name) { showToast('Informe o nome da variante'); return }
    if (savingVariant) return
    setSavingVariant(true)
    try {
      const { data, error } = await supabase
        .from('product_variants')
        .insert({ product_id: parentId, name, sort_order: variants.length })
        .select()
        .single()
      if (error) throw error
      const created = data as ProductVariant
      setVariants(prev => [...prev, created])
      setSelectedVariantId(created.id)
      setNewVariantName('')
      showToast('Variante criada')
    } catch (error: unknown) {
      showToast(isDuplicateVariantNameError(error)
        ? 'Já existe uma variante com esse nome neste produto'
        : getErrorMessage(error, 'Erro ao criar variante'))
    } finally {
      setSavingVariant(false)
    }
  }

  async function renameVariant(variant: ProductVariant, rawName: string) {
    const name = rawName.trim()
    setVariantNameEdits(prev => { const next = { ...prev }; delete next[variant.id]; return next })
    if (!name || name === variant.name) return
    try {
      const { error } = await supabase
        .from('product_variants')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', variant.id)
      if (error) throw error
      setVariants(prev => prev.map(v => v.id === variant.id ? { ...v, name } : v))
      showToast('Variante renomeada')
    } catch (error: unknown) {
      showToast(isDuplicateVariantNameError(error)
        ? 'Já existe uma variante com esse nome neste produto'
        : getErrorMessage(error, 'Erro ao renomear variante'))
    }
  }

  async function toggleVariantActive(variant: ProductVariant) {
    try {
      const nextActive = !variant.active
      const { error } = await supabase
        .from('product_variants')
        .update({ active: nextActive, updated_at: new Date().toISOString() })
        .eq('id', variant.id)
      if (error) throw error
      setVariants(prev => prev.map(v => v.id === variant.id ? { ...v, active: nextActive } : v))
      showToast(nextActive ? 'Variante ativada' : 'Variante desativada')
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Erro ao atualizar variante'))
    }
  }

  async function addFlourComponentByShare(source: 'bread' | 'product', componentId: string, sharePct: number) {
    const isFirstFlour = flourComponents.length === 0
    const addition = calculateFlourMixAddition(
      flourComponents.map(component => ({ id: component.id, quantity: component.quantity })),
      sharePct,
    )
    if (addition === null) {
      showToast('Para misturar farinhas, use percentual maior que 0 e menor que 100')
      return
    }

    try {
      const { data, error } = await supabase
        .from('product_components')
        .insert({ parent_product_id: parentId, component_source: source, component_id: componentId, quantity: addition.addedQuantity })
        .select()
        .single()
      if (error) throw error

      const inserted = data as Component
      if (addition.existing.length > 0) {
        const updateResults = await Promise.all(addition.existing.map(update =>
          supabase
            .from('product_components')
            .update({ quantity: update.quantity })
            .eq('id', update.id)
        ))
        const updateError = updateResults.find(result => result.error)?.error
        if (updateError) {
          await supabase.from('product_components').delete().eq('id', inserted.id)
          throw updateError
        }
      }

      const quantityById = new Map(addition.existing.map(update => [update.id, update.quantity]))
      setComponents(prev => [
        ...prev.map(component => {
          const quantity = quantityById.get(component.id)
          return quantity === undefined ? component : { ...component, quantity }
        }),
        inserted,
      ])
      setSearch('')
      setNewQty('1')
      setFlourPctEdits({})
      showToast(isFirstFlour
        ? 'Primeira farinha adicionada como base 100%'
        : `Farinha adicionada: ${formatDecimalPtBR(sharePct, 1)}% da mistura`)
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Erro ao adicionar farinha'))
    }
  }

  async function insertComponent(source: 'bread' | 'product', componentId: string, qty: number, variantId: string | null) {
    try {
      const { data, error } = await supabase
        .from('product_components')
        .insert({ parent_product_id: parentId, component_source: source, component_id: componentId, component_variant_id: variantId, quantity: qty })
        .select()
        .single()
      if (error) throw error
      setComponents(prev => [...prev, data as Component])
      setSearch('')
      setNewQty('1')
      setKitVariantChoice(null)
      showToast(newQtyMode === 'baker_pct'
        ? `Componente adicionado: ${formatQty(qty)} kg`
        : 'Componente adicionado')
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Erro ao adicionar'))
    }
  }

  async function chooseKitComponentVariant(variantId: string | null) {
    if (!kitVariantChoice) return
    const variant = variantId ? kitVariantChoice.variants.find(v => v.id === variantId) : null
    if (variant) setComponentVariantNames(prev => ({ ...prev, [variant.id]: variant.name }))
    await insertComponent('product', kitVariantChoice.componentId, kitVariantChoice.qty, variantId)
  }

  async function addComponent(source: 'bread' | 'product', componentId: string) {
    const parsedQty = parsePositiveDecimal(newQty)
    if (parsedQty === null) {
      showToast(newQtyMode === 'baker_pct' ? 'Percentual inválido' : 'Quantidade inválida')
      return
    }
    const item = source === 'bread'
      ? breads.find(b => b.id === componentId)
      : products.find(p => p.id === componentId)
    const componentForMath = {
      name: item?.name ?? '',
      category: item && 'category' in item && typeof item.category === 'string' ? item.category : null,
    }
    const isFlourIngredient = parent?.kind !== 'kit' && isFlourComponent(componentForMath)
    if (newQtyMode === 'baker_pct' && isFlourIngredient) {
      await addFlourComponentByShare(source, componentId, parsedQty)
      return
    }

    const qty = parent?.kind === 'kit'
      ? parsedQty
      : newQtyMode === 'baker_pct'
      ? quantityFromBakersPercentageForComponent(parsedQty, recipeTotals.flourBaseKg, componentForMath)
      : parsedQty
    if (qty === null) {
      showToast('Adicione primeiro uma farinha ou pré-mistura, ou lance a própria farinha em %')
      return
    }

    // Kit apontando pra um produto com variantes precisa escolher qual — sem
    // isso, "Kit Brioche Hambúrguer" debitaria a receita genérica do Brioche,
    // não a variante Hambúrguer 80 g especificamente.
    if (source === 'product' && parent?.kind === 'kit') {
      const { data: productVariants, error: variantsError } = await supabase
        .from('product_variants')
        .select('id,product_id,name,sort_order,active')
        .eq('product_id', componentId)
        .eq('active', true)
        .order('sort_order')
        .order('name')
      if (variantsError) { showToast(getErrorMessage(variantsError, 'Erro ao conferir variantes do componente')); return }
      if ((productVariants ?? []).length > 0) {
        setKitVariantChoice({ componentId, name: item?.name ?? '', qty, variants: productVariants as ProductVariant[] })
        return
      }
    }

    await insertComponent(source, componentId, qty, null)
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
      setFlourPctEdits(prev => { const next = { ...prev }; delete next[componentId]; return next })
      showToast('Quantidade atualizada')
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Erro ao atualizar'))
    }
  }

  async function updateFlourShare(componentId: string, raw: string) {
    const sharePct = parsePositiveDecimal(raw)
    if (sharePct === null) {
      showToast('Percentual de farinha invalido')
      setFlourPctEdits(prev => { const next = { ...prev }; delete next[componentId]; return next })
      return
    }

    const updates = calculateFlourMixRebalance(
      flourComponents.map(component => ({ id: component.id, quantity: component.quantity })),
      componentId,
      sharePct,
    )
    if (updates === null) {
      showToast(flourComponents.length <= 1
        ? 'Com uma farinha, ela representa 100% da mistura'
        : 'A mistura precisa manter todas as farinhas acima de 0% e fechar 100%')
      setFlourPctEdits(prev => { const next = { ...prev }; delete next[componentId]; return next })
      return
    }

    try {
      const updateResults = await Promise.all(updates.map(update =>
        supabase
          .from('product_components')
          .update({ quantity: update.quantity })
          .eq('id', update.id)
      ))
      const updateError = updateResults.find(result => result.error)?.error
      if (updateError) throw updateError

      const quantityById = new Map(updates.map(update => [update.id, update.quantity]))
      setComponents(prev => prev.map(component => {
        const quantity = quantityById.get(component.id)
        return quantity === undefined ? component : { ...component, quantity }
      }))
      setFlourPctEdits(prev => { const next = { ...prev }; delete next[componentId]; return next })
      showToast('Mistura de farinhas atualizada')
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Erro ao atualizar mistura de farinhas'))
    }
  }

  async function removeComponent(componentId: string) {
    if (!confirm('Remover este componente?')) return
    try {
      const { error } = await supabase.from('product_components').delete().eq('id', componentId)
      if (error) throw error
      setComponents(prev => prev.filter(c => c.id !== componentId))
      setFlourPctEdits(prev => { const next = { ...prev }; delete next[componentId]; return next })
      showToast('Componente removido')
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Erro ao remover'))
    }
  }

  async function importRecipeFromProduct(sourceProduct: ProductLite) {
    if (!canEditFicha || importingRecipe) return
    if (sourceProduct.id === parentId) { showToast('Escolha outra receita'); return }

    setImportingRecipe(true)
    try {
      const { data, error } = await supabase
        .from('product_components')
        .select('component_source,component_id,component_variant_id,quantity')
        .eq('parent_product_id', sourceProduct.id)
      if (error) throw error

      const sourceComponents = (data || []) as Array<Pick<Component, 'component_source' | 'component_id' | 'component_variant_id' | 'quantity'>>
      if (sourceComponents.length === 0) {
        showToast('Essa receita ainda não tem componentes')
        return
      }

      const componentKey = (source: string, id: string, variantId: string | null) => `${source}-${id}-${variantId ?? ''}`
      const existingKeys = new Set(components.map(component => componentKey(component.component_source, component.component_id, component.component_variant_id)))
      const rowsToInsert = sourceComponents
        .filter(component => !existingKeys.has(componentKey(component.component_source, component.component_id, component.component_variant_id)))
        .map(component => ({
          parent_product_id: parentId,
          component_source: component.component_source,
          component_id: component.component_id,
          component_variant_id: component.component_variant_id,
          quantity: component.quantity,
        }))

      if (rowsToInsert.length === 0) {
        showToast('Todos os componentes dessa ficha já estão aqui')
        return
      }

      const duplicateCount = sourceComponents.length - rowsToInsert.length
      const confirmed = confirm(
        `Importar ficha de ${sourceProduct.name}?\n\n` +
        `${rowsToInsert.length} componente${rowsToInsert.length === 1 ? '' : 's'} será${rowsToInsert.length === 1 ? '' : 'o'} adicionado${rowsToInsert.length === 1 ? '' : 's'}.` +
        (duplicateCount > 0 ? `\n${duplicateCount} já existente${duplicateCount === 1 ? '' : 's'} não será${duplicateCount === 1 ? '' : 'o'} duplicado${duplicateCount === 1 ? '' : 's'}.` : '')
      )
      if (!confirmed) return

      const { data: inserted, error: insertError } = await supabase
        .from('product_components')
        .insert(rowsToInsert)
        .select()
      if (insertError) throw insertError

      const imported = (inserted || []) as Component[]
      setComponents(prev => [...prev, ...imported])
      setImportSearch('')
      setImportOpen(false)
      showToast(`Ficha importada: ${imported.length} componente${imported.length === 1 ? '' : 's'}`)
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Erro ao importar ficha'))
    } finally {
      setImportingRecipe(false)
    }
  }

  function changeYieldBasis(next: RecipeYieldBasis) {
    if (next === yieldBasis) return
    const affected = recipeYields.filter(y => y.basis !== next).length
    if (affected > 0 && !confirm(
      `Trocar a base da ficha muda o cálculo de ${affected} linha${affected === 1 ? '' : 's'} já gravada${affected === 1 ? '' : 's'} ao salvar.`
      + (next === 'unit' ? ' Em "Unidade pronta" a massa por unidade de cada variante deixa de valer.' : '')
      + ' Continuar?'
    )) return
    setYieldBasisEdit(next)
  }

  async function saveRecipeYields() {
    if (!parentId || !recipeMetaAvailable || savingYieldsRef.current) return
    if (recipeTotals.doughWeightKg === null && manualDough.trim() && recipeKg === null) {
      showToast('Massa da receita inválida')
      return
    }
    const pending = dirtyYieldRows
    if (pending.length === 0) { showToast('Nada para salvar'); return }
    for (const row of pending) {
      const result = yieldResults.get(row.key)
      if (!result || result.status === 'invalid') {
        showToast(`${row.label}: ${result?.status === 'invalid' ? result.message : 'rendimento inválido'}`)
        return
      }
      if (result.status === 'empty') {
        showToast(`${row.label}: informe a massa por unidade`)
        return
      }
    }

    savingYieldsRef.current = true
    setSavingYields(true)
    const savedKeys: string[] = []
    const saleSyncFailures: string[] = []
    try {
      for (const row of pending) {
        const result = yieldResults.get(row.key)
        if (!result || result.status !== 'ok') continue
        const stored = storedYieldByKey.get(row.key) ?? null
        const payload = {
          product_id: parentId,
          product_variant_id: row.variantId,
          basis: yieldBasis,
          ...result.values,
          updated_at: new Date().toISOString(),
        }
        // Os índices únicos de rendimento são parciais (com e sem variante):
        // upsert por onConflict não os encontra como árbitro. Grava por id.
        const { data, error } = stored
          ? await supabase.from('product_recipe_yields').update(payload).eq('id', stored.id).select().single()
          : await supabase.from('product_recipe_yields').insert(payload).select().single()
        if (error) throw new Error(`${row.label}: ${getErrorMessage(error, 'erro ao salvar rendimento')}`)
        const nextYield = data as RecipeYield
        setRecipeYields(prev => prev.some(y => y.id === nextYield.id)
          ? prev.map(y => y.id === nextYield.id ? nextYield : y)
          : [...prev, nextYield])
        savedKeys.push(row.key)

        // A venda por unidade usa o peso médio do pão pronto: o assado quando
        // informado, senão a massa da porção (como sempre foi).
        if (nextYield.average_unit_weight_kg !== null) {
          const optionUpdate = supabase
            .from('product_sale_options')
            .update({ unit_weight_kg: nextYield.average_unit_weight_kg, updated_at: new Date().toISOString() })
            .eq('product_id', parentId)
            .eq('sale_unit', 'un')
          const { error: optionError } = row.variantId
            ? await optionUpdate.eq('product_variant_id', row.variantId)
            : await optionUpdate.is('product_variant_id', null)
          if (optionError) {
            // O rendimento já gravou: segue para as próximas linhas e deixa
            // esta pendente, para o peso de venda ser tentado de novo.
            setSaleSyncPending(prev => prev.includes(row.key) ? prev : [...prev, row.key])
            saleSyncFailures.push(row.label)
            continue
          }
          setSaleOptions(prev => prev.map(option =>
            option.sale_unit === 'un' && (option.product_variant_id ?? null) === row.variantId
              ? { ...option, unit_weight_kg: nextYield.average_unit_weight_kg }
              : option
          ))
        }
        setSaleSyncPending(prev => prev.filter(key => key !== row.key))
      }
      setYieldBasisEdit(null)
      setManualDoughEdit(null)
      showToast(saleSyncFailures.length > 0
        ? `Rendimento salvo, mas o peso de venda não atualizou em: ${saleSyncFailures.join(', ')}. Salve de novo.`
        : savedKeys.length === 1 ? 'Rendimento salvo' : `Rendimento salvo em ${savedKeys.length} linhas`)
    } catch (error: unknown) {
      showToast(getErrorMessage(error, 'Erro ao salvar rendimento'))
    } finally {
      setPortionEdits(prev => {
        const next = { ...prev }
        for (const key of savedKeys) delete next[key]
        return next
      })
      savingYieldsRef.current = false
      setSavingYields(false)
    }
  }

  async function createSaleOption(saleUnit: PricingUnit) {
    if (!parentId || !recipeMetaAvailable) return
    if (parent?.kind === 'kit' && saleUnit === 'kg') { showToast('Kit deve ser vendido por unidade'); return }
    const alreadyExists = saleOptionsForSelected.some(option => option.sale_unit === saleUnit)
    if (alreadyExists) { showToast('Essa forma de venda já existe'); return }
    const averageWeight = recipeYield?.average_unit_weight_kg ?? null
    try {
      const { data, error } = await supabase
        .from('product_sale_options')
        .insert({
          product_id: parentId,
          product_variant_id: selectedVariantId,
          name: saleUnit === 'kg' ? 'Quilo' : 'Unidade',
          sale_unit: saleUnit,
          reference_quantity: 1,
          unit_weight_kg: saleUnit === 'un' ? averageWeight : null,
          is_default: saleOptionsForSelected.length === 0,
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
      const clearQuery = supabase
        .from('product_sale_options')
        .update({ is_default: false })
        .eq('product_id', option.product_id)
      const { error: clearError } = option.product_variant_id
        ? await clearQuery.eq('product_variant_id', option.product_variant_id)
        : await clearQuery.is('product_variant_id', null)
      if (clearError) throw clearError
      const { error } = await supabase.from('product_sale_options').update({ is_default: true }).eq('id', option.id)
      if (error) throw error
      setSaleOptions(prev => prev.map(item =>
        (item.product_variant_id ?? null) === (option.product_variant_id ?? null)
          ? { ...item, is_default: item.id === option.id }
          : item
      ))
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
    const category = item && 'category' in item && typeof item.category === 'string' ? item.category : null
    return {
      ...c,
      name: item?.name ?? '(não encontrado)',
      cost: cost ?? 0,
      hasCost: cost !== null && Number.isFinite(Number(cost)),
      unit: item?.unit ?? '',
      category,
      variantName: c.component_variant_id ? componentVariantNames[c.component_variant_id] ?? null : null,
    }
  }), [components, breads, products, componentVariantNames])

  const recipeTotals = useMemo(() => calculateRecipeTotals(enriched), [enriched])
  const isKit = parent?.kind === 'kit'
  const flourComponents = useMemo(
    () => enriched.filter(component => isFlourComponent(component) && !isPackagingComponent(component)),
    [enriched],
  )
  const totalCMV = isKit
    ? enriched.reduce((sum, component) => sum + (Number(component.cost) * Number(component.quantity)), 0)
    : recipeTotals.ingredientCost
  const packagingComponentsCost = isKit ? 0 : recipeTotals.packagingCost
  const manualCost = parent?.cost_price !== null && parent?.cost_price !== undefined ? Number(parent.cost_price) : null
  const manualDiff = manualCost !== null ? totalCMV - manualCost : null
  const canEditFicha = !!parent && parent.kind !== 'insumo' && !parent.is_revenda
  const partialCount = enriched.filter(e => (isKit || !isPackagingComponent(e)) && !e.hasCost).length
  const recipeKg = recipeTotals.doughWeightKg ?? nullablePositiveDecimal(manualDough)
  const yieldResults = new Map<string, PortionYieldResult>(yieldRows.map(row => [
    row.key,
    calculatePortionYield({ basis: yieldBasis, recipeKg, draft: portionDraftFor(row.key) }),
  ]))
  const selectedYieldKey = selectedVariantId ?? LEGACY_YIELD_ROW_KEY
  const dirtyYieldRows = yieldRows.filter(row => {
    const stored = storedYieldByKey.get(row.key) ?? null
    const draft = portionDraftFor(row.key)
    const draftChanged = !portionDraftsEqual(draft, storedPortionDraft(row.key))
    const hasContent = stored !== null || draft.portionG.trim() !== '' || draft.bakedG.trim() !== ''
    // Só a troca feita agora na tela conta: ficha antiga com base mista
    // (Brioche) não abre como "não salva".
    const basisChanged = yieldBasisEdit !== null && stored !== null && stored.basis !== yieldBasis
    const doughChanged = recipeTotals.doughWeightKg === null && manualDoughEdit !== null && manualDough !== storedManualDough
    const newReadyUnit = yieldBasis === 'unit' && yieldBasisEdit !== null && stored === null && row.key === selectedYieldKey
    // Peso de venda diferente do peso médio gravado (ex.: rendimento salvo e
    // venda falhou antes de recarregar) também fica pendente.
    const storedAverage = stored?.average_unit_weight_kg ?? null
    const saleWeightDiverges = storedAverage !== null && saleOptions.some(option =>
      option.sale_unit === 'un'
      && (option.product_variant_id ?? null) === row.variantId
      && (option.unit_weight_kg === null || Math.abs(Number(option.unit_weight_kg) - Number(storedAverage)) > 0.0000005)
    )
    const salePending = saleSyncPending.includes(row.key) || saleWeightDiverges
    if (yieldBasis === 'unit') return salePending || basisChanged || (stored !== null && doughChanged) || newReadyUnit
    // O rendimento calculado agora difere do gravado (receita mudou depois de
    // salvar, ou ficha gravada em outra base): as outras telas leem o gravado.
    const result = yieldResults.get(row.key)
    const storedDiffers = stored !== null && result?.status === 'ok'
      && portionYieldDiffersFromStored(stored, yieldBasis, result.values)
    return salePending || draftChanged || basisChanged || storedDiffers || (hasContent && doughChanged)
  })
  const selectedYieldResult = yieldResults.get(selectedYieldKey) ?? null
  const selectedYieldOk = selectedYieldResult?.status === 'ok' ? selectedYieldResult : null
  const yieldUnits = selectedYieldOk?.values.yield_units ?? null
  const calculatedFinishedWeight = selectedYieldOk?.values.finished_weight_kg ?? recipeYield?.finished_weight_kg ?? null
  const calculatedAverageWeight = selectedYieldOk?.averageUnitWeightKg ?? recipeYield?.average_unit_weight_kg ?? null
  const calculatedUnitCost = isKit && totalCMV > 0 ? totalCMV : costPerUnit(totalCMV, yieldBasis, yieldUnits)
  const calculatedBakedKgCost = isKit ? null : costPerBakedKg(totalCMV, yieldBasis, calculatedFinishedWeight)
  const availablePriceBases = [
    ...(isFinitePositive(calculatedUnitCost) ? [{ value: 'un' as const, label: 'Unidade', suffix: 'un', cmv: calculatedUnitCost }] : []),
    ...(!isKit && isFinitePositive(calculatedBakedKgCost) ? [{ value: 'kg' as const, label: 'Kg assado', suffix: 'kg', cmv: calculatedBakedKgCost }] : []),
  ]
  const selectedPriceBase = availablePriceBases.find(base => base.value === priceFormationBase) ?? availablePriceBases[0] ?? null
  const packagingCostPerUnit = nonNegativeDecimal(priceFormationDraft.packagingCost)
  const packagingCostForSelectedBase = selectedPriceBase
    ? packagingCostForPriceBase(packagingCostPerUnit, selectedPriceBase.value, calculatedAverageWeight)
    : null
  const priceFormationBlockedReason = selectedPriceBase && packagingCostForSelectedBase === null
    ? packagingCostPerUnit === null
      ? 'Embalagem inválida'
      : 'Embalagem por kg exige peso médio da unidade'
    : null
  const priceFormation = selectedPriceBase && !priceFormationBlockedReason ? calculateSuggestedPrice({
    cmv: selectedPriceBase.cmv,
    packagingCost: packagingCostForSelectedBase,
    laborCost: nonNegativeDecimal(priceFormationDraft.laborCost),
    lossPct: nonNegativeDecimal(priceFormationDraft.lossPct),
    taxPct: nonNegativeDecimal(priceFormationDraft.taxPct),
    desiredMarginPct: nonNegativeDecimal(priceFormationDraft.desiredMarginPct),
  }) : null
  const parsedNewQty = parsePositiveDecimal(newQty)
  const newQtyPreviewKg = newQtyMode === 'baker_pct' && parsedNewQty !== null
    ? quantityFromBakersPercentage(parsedNewQty, recipeTotals.flourBaseKg)
    : null
  const firstFlourPreviewKg = newQtyMode === 'baker_pct' && parsedNewQty !== null && recipeTotals.flourBaseKg === null
    ? 1
    : null
  const productUnit = (parent?.unit ?? '').trim().toLowerCase()
  const productCostCandidate = (() => {
    if (isKit && isFinitePositive(calculatedUnitCost)) {
      return { value: roundCurrency(calculatedUnitCost), label: 'unidade do kit' }
    }
    if (productUnit === 'kg' && isFinitePositive(calculatedBakedKgCost)) {
      return { value: roundCurrency(calculatedBakedKgCost), label: 'kg assado' }
    }
    if (isFinitePositive(calculatedUnitCost)) {
      return { value: roundCurrency(calculatedUnitCost), label: 'unidade' }
    }
    return null
  })()
  const productCostDiff = productCostCandidate && manualCost !== null ? productCostCandidate.value - manualCost : null
  const activeVariantCount = variants.filter(v => v.active).length
  const canSaveProductCost = canEditFicha && recipeMetaAvailable && partialCount === 0 && productCostCandidate !== null && !savingProductCost && activeVariantCount <= 1
  const hasUnitOption = saleOptionsForSelected.some(option => option.sale_unit === 'un')
  const hasKgOption = saleOptionsForSelected.some(option => option.sale_unit === 'kg')

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
  const importQ = importSearch.trim().toLowerCase()
  const recipeImportCandidates = importQ.length < 2 ? [] : products
    .filter(product =>
      product.active !== false
      && product.id !== parentId
      && product.kind !== 'insumo'
      && product.is_fabricacao_propria !== false
      && product.name.toLowerCase().includes(importQ)
    )
    .slice(0, 20)

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
                  <div className="ps-flabel">{isKit ? 'Itens do kit' : 'Componentes'}</div>
                  <div style={{fontSize:20, fontWeight:800, color:'var(--ps-ink)'}}>{enriched.length}</div>
                  <div style={{fontSize:11, color:'var(--ink-faint)'}}>{isKit ? 'produtos vinculados' : 'produtos ou insumos'}</div>
                </div>
                <div className="ps-card" style={{padding:12}}>
                  <div className="ps-flabel">Custo manual</div>
                  <div style={{fontSize:20, fontWeight:800, color:'var(--ps-ink)'}}>{manualCost === null ? '—' : formatBRL(manualCost)}</div>
                  <div style={{fontSize:11, color:'var(--ink-faint)'}}>
                    {manualDiff === null ? 'não cadastrado' : `${manualDiff >= 0 ? '+' : ''}${formatBRL(manualDiff)} vs ${isKit ? 'kit' : 'ficha'}`}
                  </div>
                </div>
              </div>

              {canEditFicha && (
                <div className="ps-card" style={{padding:14, marginBottom:12}}>
                  <div className="ps-flabel" style={{marginBottom:8}}>{isKit ? 'Composição e venda' : 'Rendimento e venda'}</div>
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
                      {isKit ? (
                        <>
                          <div className="ps-banner honey" style={{marginBottom:12}}>
                            <span>
                              Kit usa composição direta. Informe quais produtos entram no kit e a quantidade de cada um.
                            </span>
                          </div>
                          <div style={{display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:12}}>
                            <span className="ps-store-chip">
                              itens no kit: {enriched.length}
                            </span>
                            <span className="ps-store-chip">
                              CMV/un kit: {calculatedUnitCost !== null && Number.isFinite(calculatedUnitCost) ? formatBRL(calculatedUnitCost) : '—'}
                            </span>
                            <span className="ps-store-chip">
                              custo atual: {manualCost === null ? '—' : formatBRL(manualCost)}
                            </span>
                            {partialCount > 0 && (
                              <span className="ps-store-chip" style={{background:'var(--berry-tint)', color:'var(--berry)'}}>
                                {partialCount} sem custo
                              </span>
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{borderBottom:'1px solid var(--line-soft)', paddingBottom:12, marginBottom:12}}>
                            <div className="ps-flabel" style={{marginBottom:8}}>Variantes</div>
                            {variants.length === 0 ? (
                              <div style={{fontSize:12, color:'var(--ink-faint)', marginBottom:8}}>
                                Produto simples, sem variante. Rendimento e formas de venda abaixo valem para o produto inteiro.
                              </div>
                            ) : (
                              <div style={{display:'grid', gap:6, marginBottom:8}}>
                                <div style={{display:'flex', alignItems:'center', gap:8, padding:'6px 0', borderTop:'1px solid var(--line-soft)'}}>
                                  <div style={{flex:1, minWidth:0, fontSize:13, color:'var(--ink-soft)'}}>
                                    Produto (sem variante) — rendimento e formas de venda legados
                                  </div>
                                  {selectedVariantId === null ? (
                                    <span className="ps-store-chip ja">editando</span>
                                  ) : (
                                    <button onClick={() => selectVariant(null)} className="ps-btn sm ghost">
                                      editar
                                    </button>
                                  )}
                                </div>
                                {variants.map(variant => (
                                  <div key={variant.id} style={{display:'flex', alignItems:'center', gap:8, padding:'6px 0', borderTop:'1px solid var(--line-soft)', opacity:variant.active?1:.55}}>
                                    <input
                                      value={variantNameEdits[variant.id] ?? variant.name}
                                      onChange={e => setVariantNameEdits(prev => ({...prev, [variant.id]: e.target.value}))}
                                      onBlur={e => renameVariant(variant, e.target.value)}
                                      className="ps-input"
                                      style={{flex:1, minWidth:0, padding:'6px 8px', fontSize:13}}
                                    />
                                    {variant.id === selectedVariantId ? (
                                      <span className="ps-store-chip ja">editando</span>
                                    ) : (
                                      <button onClick={() => selectVariant(variant.id)} className="ps-btn sm ghost">
                                        editar
                                      </button>
                                    )}
                                    <button onClick={() => toggleVariantActive(variant)} className={`ps-status ${variant.active?'conferido':'separado'}`} style={{border:'1px solid transparent', cursor:'pointer'}}>
                                      {variant.active ? 'ativa' : 'inativa'}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div style={{display:'flex', gap:8}}>
                              <input
                                value={newVariantName}
                                onChange={e => setNewVariantName(e.target.value)}
                                placeholder="Nova variante (ex.: Forma, Hamburguer, Mini)"
                                className="ps-input"
                                style={{flex:1}}
                              />
                              <button onClick={createVariant} disabled={savingVariant} className="ps-btn sm ghost">
                                + Variante
                              </button>
                            </div>
                            {variants.length > 0 && (
                              <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:6}}>
                                Formas de venda abaixo são de: <strong>{variants.find(v => v.id === selectedVariantId)?.name ?? 'Produto (sem variante)'}</strong>
                              </div>
                            )}
                          </div>
                          <div className="ps-fieldrow" style={{marginBottom:10}}>
                            <div className="ps-fieldgroup">
                              <div className="ps-fieldlabel">Base da ficha</div>
                              <select
                                value={yieldBasis}
                                onChange={e=>changeYieldBasis(e.target.value as RecipeYieldBasis)}
                                disabled={savingYields}
                                className="ps-select"
                              >
                                {/* Com componentes, a massa somada é crua: "produto assado" dividiria massa crua por peso pronto. */}
                                {RECIPE_BASIS_OPTIONS.filter(option => option.value !== 'baked' || recipeTotals.doughWeightKg === null || yieldBasis === 'baked').map(option => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            </div>
                            <div className="ps-fieldgroup">
                              <div className="ps-fieldlabel">Massa da receita (kg)</div>
                              <input
                                inputMode="decimal"
                                value={recipeTotals.doughWeightKg !== null ? formatDecimalPtBR(recipeTotals.doughWeightKg, 3) : manualDough}
                                onChange={e=>{
                                  if (recipeTotals.doughWeightKg === null) setManualDoughEdit(e.target.value.replace(/[^\d,.]/g, ''))
                                }}
                                placeholder={recipeTotals.doughWeightKg !== null ? 'calculada' : 'ex: 8,5'}
                                className="ps-input"
                                readOnly={recipeTotals.doughWeightKg !== null}
                              />
                              <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:4}}>
                                {recipeTotals.doughWeightKg !== null ? 'soma automática dos componentes' : 'sem componentes para somar'}
                              </div>
                            </div>
                          </div>
                          {yieldBasis === 'unit' ? (
                            <div className="ps-banner honey" style={{marginBottom:12}}>
                              <span>Unidade pronta: a receita inteira vira uma unidade. O CMV da unidade é o CMV da receita.</span>
                            </div>
                          ) : (
                            <div style={{marginBottom:12}}>
                              <div style={{fontSize:12, color:'var(--ink-soft)', marginBottom:8}}>
                                {yieldBasis === 'baked'
                                  ? 'Peso por unidade: quanto pesa cada unidade pronta. Rende = peso da receita ÷ peso por unidade.'
                                  : 'Massa crua: o peso que a padeira divide. Rende = massa da receita ÷ massa crua. Assado é opcional: mostra a perda de forno e vira o peso de venda.'}
                              </div>
                              <div style={{display:'grid', gap:8}}>
                                {yieldRows.map(row => {
                                  const draft = portionDraftFor(row.key)
                                  const result = yieldResults.get(row.key)
                                  const ok = result?.status === 'ok' ? result : null
                                  const rowCost = ok ? costPerUnit(totalCMV, yieldBasis, ok.values.yield_units) : null
                                  const isDirty = dirtyYieldRows.some(dirty => dirty.key === row.key)
                                  return (
                                    <div key={row.key} role="group" aria-label={`Rendimento: ${row.label}`} style={{border:'1px solid var(--line-soft)', borderRadius:8, padding:10, opacity:row.active ? 1 : .6, background: isDirty ? 'var(--paper-soft)' : undefined}}>
                                      <div style={{fontSize:13, fontWeight:600, marginBottom:6}}>
                                        {row.label}{!row.active ? ' (inativa)' : ''}{isDirty ? ' · não salvo' : ''}
                                      </div>
                                      <div className="ps-fieldrow" style={{marginBottom:6}}>
                                        <div className="ps-fieldgroup">
                                          <div className="ps-fieldlabel">{yieldBasis === 'baked' ? 'Peso por unidade (g)' : 'Massa crua (g)'}</div>
                                          <input
                                            inputMode="decimal"
                                            aria-label={`${yieldBasis === 'baked' ? 'Peso por unidade' : 'Massa crua'} em gramas: ${row.label}`}
                                            value={draft.portionG}
                                            onChange={e=>editPortion(row.key, 'portionG', e.target.value)}
                                            disabled={savingYields}
                                            placeholder="ex: 80"
                                            className="ps-input"
                                          />
                                        </div>
                                        {yieldBasis === 'dough' && (
                                          <div className="ps-fieldgroup">
                                            <div className="ps-fieldlabel">Assado (g, opcional)</div>
                                            <input
                                              inputMode="decimal"
                                              aria-label={`Peso assado em gramas: ${row.label}`}
                                              value={draft.bakedG}
                                              onChange={e=>editPortion(row.key, 'bakedG', e.target.value)}
                                              disabled={savingYields}
                                              placeholder="ex: 72"
                                              className="ps-input"
                                            />
                                          </div>
                                        )}
                                      </div>
                                      {result?.status === 'invalid' ? (
                                        <div style={{fontSize:12, color:'var(--berry)'}}>{result.message}</div>
                                      ) : ok ? (
                                        <div style={{fontSize:12, color:'var(--ink-soft)'}}>
                                          rende {formatDecimalPtBR(ok.values.yield_units, 2)} un
                                          {ok.bakeLossPct !== null ? ` · perda de forno ${formatDecimalPtBR(ok.bakeLossPct, 1)}%` : ''}
                                          {ok.bakeLossPct === null && yieldBasis === 'dough' ? ' · sem peso assado' : ''}
                                          {` · pronto ${formatGrams(ok.averageUnitWeightKg)} g`}
                                          {` · CMV/un ${rowCost !== null && Number.isFinite(rowCost) ? formatBRL(rowCost) : '—'}`}
                                        </div>
                                      ) : (
                                        <div style={{fontSize:12, color:'var(--ink-faint)'}}>sem rendimento</div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                          <div style={{display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:12}}>
                            <span className="ps-store-chip">
                              massa crua: {recipeTotals.doughWeightKg !== null ? `${formatDecimalPtBR(recipeTotals.doughWeightKg, 3)} kg` : '—'}
                            </span>
                            <span className="ps-store-chip">
                              farinha base: {recipeTotals.flourBaseKg !== null ? `${formatDecimalPtBR(recipeTotals.flourBaseKg, 3)} kg` : '—'}
                            </span>
                            <span className="ps-store-chip">
                              CMV/kg de massa: {recipeKg !== null && totalCMV > 0 ? formatBRL(totalCMV / recipeKg) : '—'}
                            </span>
                            <button
                              onClick={saveRecipeYields}
                              disabled={savingYields || dirtyYieldRows.length === 0}
                              className="ps-btn sm primary"
                              style={{marginLeft:'auto'}}
                            >
                              {savingYields ? 'Salvando...' : dirtyYieldRows.length > 1 ? `Salvar rendimento (${dirtyYieldRows.length})` : 'Salvar rendimento'}
                            </button>
                          </div>
                          {dirtyYieldRows.length === 0 && (
                            <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:-8, marginBottom:12, textAlign:'right'}}>
                              nada alterado para salvar
                            </div>
                          )}
                          {flourComponents.length > 0 && recipeTotals.flourBaseKg !== null && (
                            <div style={{border:'1px solid var(--line-soft)', borderRadius:8, padding:10, marginBottom:12, background:'var(--paper-soft)'}}>
                              <div className="ps-flabel" style={{marginBottom:6}}>Mistura de farinhas</div>
                              <div style={{display:'flex', gap:6, flexWrap:'wrap', alignItems:'center'}}>
                                {flourComponents.map(component => {
                                  const sharePct = calculateFlourSharePercent(component.quantity, recipeTotals.flourBaseKg)
                                  return (
                                    <span key={component.id} className="ps-store-chip">
                                      {component.name}: {sharePct !== null ? `${formatDecimalPtBR(sharePct, 1)}%` : '-'}
                                    </span>
                                  )
                                })}
                                <span className="ps-store-chip ja">total 100%</span>
                              </div>
                            </div>
                          )}
                          {packagingComponentsCost > 0 && (
                            <div className="ps-warning" style={{marginBottom:12}}>
                              <AlertTriangle size={16} style={{flexShrink:0, marginTop:1}}/>
                              <span>
                                Embalagens na lista somam {formatBRL(packagingComponentsCost)} e não entram no CMV da receita. Informe embalagem por unidade na formação de preço.
                              </span>
                            </div>
                          )}
                        </>
                      )}
                      <div style={{borderTop:'1px solid var(--line-soft)', paddingTop:10, marginBottom:12, display:'flex', gap:10, alignItems:'center', justifyContent:'space-between', flexWrap:'wrap'}}>
                        <div style={{minWidth:220, flex:1}}>
                          <div className="ps-flabel" style={{marginBottom:2}}>Custo do produto</div>
                          <div style={{fontSize:13, color:'var(--ink-soft)'}}>
                            Atual: <strong style={{color:'var(--ps-ink)'}}>{manualCost === null ? '—' : formatBRL(manualCost)}</strong>
                            {' · '}
                            {isKit ? 'Composição' : 'Ficha'}: <strong style={{color:'var(--ps-ink)'}}>{productCostCandidate ? formatBRL(productCostCandidate.value) : '—'}</strong>
                            {productCostCandidate && `/${productCostCandidate.label}`}
                          </div>
                          <div style={{fontSize:11, color:partialCount > 0 || activeVariantCount > 1 ? 'var(--berry)' : 'var(--ink-faint)', marginTop:2}}>
                            {partialCount > 0
                              ? 'Complete os custos dos componentes antes de atualizar.'
                              : activeVariantCount > 1
                                ? 'Produto com mais de uma variante ativa: o custo de cada uma se ajusta pela tabela de preço, não por este botão único.'
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

                      <div style={{borderTop:'1px solid var(--line-soft)', paddingTop:12, marginBottom:12}}>
                        <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:10, marginBottom:10, flexWrap:'wrap'}}>
                          <div>
                            <div className="ps-flabel" style={{marginBottom:2}}>Formação de preço</div>
                            <div style={{fontSize:24, fontWeight:800, color:'var(--ps-ink)', lineHeight:1.1}}>
                              {priceFormation?.valid && priceFormation.suggestedPrice !== null ? formatBRL(priceFormation.suggestedPrice) : '—'}
                              {selectedPriceBase && <span style={{fontSize:13, color:'var(--ink-faint)', marginLeft:4}}>/{selectedPriceBase.suffix}</span>}
                            </div>
                            <div style={{fontSize:11, color:priceFormation?.valid ? 'var(--ink-faint)' : 'var(--berry)', marginTop:3}}>
                              {selectedPriceBase
                                ? priceFormation?.valid
                                  ? `CMV base ${formatBRL(selectedPriceBase.cmv)}/${selectedPriceBase.suffix}`
                                  : priceFormationBlockedReason || priceFormation?.reason || 'Preço indisponível'
                                : isKit ? 'Informe itens do kit para calcular preço' : 'Informe rendimento para calcular preço'}
                            </div>
                          </div>
                          {availablePriceBases.length > 0 && (
                            <div style={{minWidth:150}}>
                              <div className="ps-fieldlabel">Base do preço</div>
                              <select
                                value={selectedPriceBase?.value ?? priceFormationBase}
                                onChange={e => setPriceFormationBase(e.target.value as PriceFormationBase)}
                                className="ps-select"
                                style={{minHeight:38}}
                              >
                                {availablePriceBases.map(base => (
                                  <option key={base.value} value={base.value}>{base.label}</option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>

                        <div className="ps-fieldrow" style={{marginBottom:10}}>
                          <div className="ps-fieldgroup">
                            <div className="ps-fieldlabel">Embalagem por unidade (R$)</div>
                            <input
                              inputMode="decimal"
                              value={priceFormationDraft.packagingCost}
                              onChange={e => setPriceFormationDraft(prev => ({...prev, packagingCost: e.target.value.replace(/[^\d,.]/g, '')}))}
                              placeholder="0,00"
                              className="ps-input"
                            />
                            {selectedPriceBase?.value === 'kg' && packagingCostForSelectedBase !== null && packagingCostPerUnit !== null && packagingCostPerUnit > 0 && (
                              <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:4}}>
                                convertido: {formatBRL(packagingCostForSelectedBase)}/kg
                              </div>
                            )}
                          </div>
                          <div className="ps-fieldgroup">
                            <div className="ps-fieldlabel">Mão de obra (R$)</div>
                            <input
                              inputMode="decimal"
                              value={priceFormationDraft.laborCost}
                              onChange={e => setPriceFormationDraft(prev => ({...prev, laborCost: e.target.value.replace(/[^\d,.]/g, '')}))}
                              placeholder="0,00"
                              className="ps-input"
                            />
                          </div>
                          <div className="ps-fieldgroup">
                            <div className="ps-fieldlabel">Perda (%)</div>
                            <input
                              inputMode="decimal"
                              value={priceFormationDraft.lossPct}
                              onChange={e => setPriceFormationDraft(prev => ({...prev, lossPct: e.target.value.replace(/[^\d,.]/g, '')}))}
                              placeholder="0"
                              className="ps-input"
                            />
                          </div>
                        </div>
                        <div className="ps-fieldrow" style={{marginBottom:10}}>
                          <div className="ps-fieldgroup">
                            <div className="ps-fieldlabel">Impostos/taxas (%)</div>
                            <input
                              inputMode="decimal"
                              value={priceFormationDraft.taxPct}
                              onChange={e => setPriceFormationDraft(prev => ({...prev, taxPct: e.target.value.replace(/[^\d,.]/g, '')}))}
                              placeholder="0"
                              className="ps-input"
                            />
                          </div>
                          <div className="ps-fieldgroup">
                            <div className="ps-fieldlabel">Margem desejada (%)</div>
                            <input
                              inputMode="decimal"
                              value={priceFormationDraft.desiredMarginPct}
                              onChange={e => setPriceFormationDraft(prev => ({...prev, desiredMarginPct: e.target.value.replace(/[^\d,.]/g, '')}))}
                              placeholder="65"
                              className="ps-input"
                            />
                          </div>
                        </div>

                        {priceFormation?.valid && priceFormation.suggestedPrice !== null && (
                          <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                            <span className="ps-store-chip">
                              custo ajustado: {formatBRL(priceFormation.adjustedCost)}
                            </span>
                            <span className="ps-store-chip">
                              impostos: {formatBRL(priceFormation.taxAmount || 0)}
                            </span>
                            <span className="ps-store-chip">
                              lucro alvo: {formatBRL(priceFormation.targetMarginAmount || 0)}
                            </span>
                            <span className="ps-store-chip">
                              markup: {priceFormation.markupPct !== null ? `${formatDecimalPtBR(priceFormation.markupPct, 1)}%` : '—'}
                            </span>
                          </div>
                        )}
                      </div>

                      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, marginBottom:8}}>
                        <div className="ps-flabel" style={{marginBottom:0}}>Formas de venda</div>
                        <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
                          <button onClick={()=>createSaleOption('un')} disabled={hasUnitOption} className="ps-btn sm ghost" style={hasUnitOption?{opacity:.5}:undefined}>
                            + Unidade
                          </button>
                          {!isKit && (
                            <button onClick={()=>createSaleOption('kg')} disabled={hasKgOption} className="ps-btn sm ghost" style={hasKgOption?{opacity:.5}:undefined}>
                              + Quilo
                            </button>
                          )}
                        </div>
                      </div>
                      {saleOptionsForSelected.length === 0 ? (
                        <div style={{fontSize:13, color:'var(--ink-faint)'}}>
                          Nenhuma forma cadastrada ainda.
                        </div>
                      ) : (
                        <div style={{display:'grid', gap:8}}>
                          {saleOptionsForSelected.map(option => (
                            <div key={option.id} style={{display:'flex', alignItems:'center', gap:8, padding:'8px 0', borderTop:'1px solid var(--line-soft)', opacity:option.active?1:.55}}>
                              <div style={{flex:1, minWidth:0}}>
                                <div style={{fontSize:14, fontWeight:700, color:'var(--ps-ink)'}}>
                                  {option.name} <span style={{color:'var(--ink-faint)', fontSize:12}}>/{option.sale_unit}</span>
                                  {option.is_default && <span className="ps-store-chip ja" style={{marginLeft:6}}>padrão</span>}
                                </div>
                                <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:2}}>
                                  {isKit
                                    ? 'venda por unidade do kit'
                                    : option.sale_unit === 'un'
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
                <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginBottom:8}}>
                  <div className="ps-flabel" style={{marginBottom:0}}>{isKit ? 'Itens do kit' : 'Componentes'} ({enriched.length})</div>
                  {canEditFicha && !isKit && (
                    <button
                      type="button"
                      onClick={() => setImportOpen(prev => !prev)}
                      className="ps-btn sm ghost"
                      style={{display:'inline-flex', alignItems:'center', gap:6}}
                    >
                      <Copy size={14}/>
                      Importar ficha
                    </button>
                  )}
                </div>
                {canEditFicha && !isKit && importOpen && (
                  <div style={{border:'1px solid var(--line-soft)', borderRadius:8, padding:10, marginBottom:12, background:'var(--paper-soft)'}}>
                    <div style={{display:'flex', alignItems:'center', gap:8}}>
                      <div style={{flex:1, position:'relative'}}>
                        <Search size={14} style={{position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--ink-faint)'}}/>
                        <input
                          value={importSearch}
                          onChange={e => setImportSearch(e.target.value)}
                          placeholder="Buscar receita de origem…"
                          className="ps-input"
                          style={{paddingLeft:30}}
                        />
                      </div>
                      <button type="button" onClick={() => { setImportOpen(false); setImportSearch('') }} className="ps-iconbtn" style={{width:34, height:34}}>
                        <X size={14}/>
                      </button>
                    </div>
                    <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:6}}>
                      Copia apenas os componentes e quantidades. Rendimento e formas de venda continuam os desta ficha.
                    </div>

                    {importQ.length > 0 && importQ.length < 2 && (
                      <div style={{padding:'10px 0 0', fontSize:12, color:'var(--ink-faint)'}}>Digite ao menos 2 caracteres…</div>
                    )}

                    {importQ.length >= 2 && (
                      <div style={{marginTop:8, maxHeight:260, overflowY:'auto', border:'1px solid var(--line-soft)', borderRadius:8, background:'var(--paper)'}}>
                        {recipeImportCandidates.length === 0 ? (
                          <div style={{padding:14, textAlign:'center', color:'var(--ink-faint)', fontSize:13}}>
                            Nenhuma receita encontrada.
                          </div>
                        ) : recipeImportCandidates.map(product => (
                          <button
                            key={product.id}
                            type="button"
                            onClick={() => importRecipeFromProduct(product)}
                            disabled={importingRecipe}
                            style={{display:'flex', alignItems:'center', gap:8, padding:'10px 12px', borderBottom:'1px solid var(--line-soft)', width:'100%', textAlign:'left', background:'transparent', border:'none', cursor:importingRecipe ? 'wait' : 'pointer', opacity:importingRecipe ? .6 : 1}}
                          >
                            <div style={{flex:1, minWidth:0}}>
                              <div style={{fontSize:13, fontWeight:600, color:'var(--ps-ink)', display:'flex', alignItems:'center', gap:6, flexWrap:'wrap'}}>
                                {product.name}
                                {product.is_fabricacao_propria && <span className="ps-store-chip jc">FABRICAÇÃO</span>}
                              </div>
                              <div style={{fontSize:11, color:'var(--ink-faint)'}}>
                                {product.cost_price ? `${formatBRL(Number(product.cost_price))}${product.unit?`/${product.unit}`:''}` : 'sem custo cadastrado'}
                              </div>
                            </div>
                            <Copy size={14} style={{color:'var(--honey-deep)'}}/>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {enriched.length === 0 ? (
                  <div style={{padding:'14px 4px', color:'var(--ink-faint)', fontSize:13, textAlign:'center'}}>
                    {isKit ? 'Nenhum item cadastrado neste kit ainda.' : 'Nenhum componente cadastrado ainda.'}
                  </div>
                ) : (
                  enriched.map(e => {
                    const isPackaging = isPackagingComponent(e)
                    const isFlour = !isKit && isFlourComponent(e)
                    const flourPct = !isKit && recipeTotals.flourBaseKg !== null && !isPackaging
                      ? calculateFlourSharePercent(e.quantity, recipeTotals.flourBaseKg)
                      : null
                    return (
                      <div key={e.id} style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', padding:'10px 0', borderBottom:'1px solid var(--line-soft)'}}>
                        <div style={{flex:1, minWidth:0}}>
                          <div style={{fontSize:14, fontWeight:600, color:'var(--ps-ink)', display:'flex', alignItems:'center', gap:6, flexWrap:'wrap'}}>
                            {e.name}
                            <span className={`ps-store-chip ${e.component_source==='bread'?'jc':'ja'}`}>{e.component_source==='bread'?'PÃO':'PRODUTO'}</span>
                            {e.variantName && <span className="ps-store-chip jc">{e.variantName}</span>}
                            {isFlour && <span className="ps-store-chip jc">FARINHA</span>}
                            {!isKit && isPackaging && <span className="ps-store-chip" style={{background:'var(--crust-tint)', color:'var(--crust)'}}>EMBALAGEM</span>}
                            {(isKit || !isPackaging) && !e.hasCost && <span className="ps-store-chip" style={{background:'var(--berry-tint)', color:'var(--berry)'}}>SEM CUSTO</span>}
                          </div>
                          <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:2}}>
                            {e.hasCost
                              ? `${formatBRL(Number(e.cost))}${e.unit?`/${e.unit}`:''} × ${formatQty(Number(e.quantity))} = ${formatBRL(Number(e.cost)*Number(e.quantity))}`
                              : `× ${formatQty(Number(e.quantity))}${e.unit?` ${e.unit}`:''}`}
                            {flourPct !== null && ` · ${formatDecimalPtBR(flourPct, 1)}% farinha`}
                            {!isKit && isPackaging && ' · fora da massa/CMV da receita'}
                          </div>
                        </div>
                        {isFlour && flourPct !== null && (
                          <div style={{display:'flex', alignItems:'center', gap:3}}>
                            <input
                              type="text"
                              inputMode="decimal"
                              title="% da mistura de farinhas"
                              value={flourPctEdits[e.id] ?? formatDecimalPtBR(flourPct, 1)}
                              onChange={ev => setFlourPctEdits(prev => ({...prev, [e.id]: ev.target.value.replace(/[^\d,.]/g, '')}))}
                              onBlur={ev => {
                                const v = ev.target.value
                                const parsed = parsePositiveDecimal(v)
                                if (parsed === null) {
                                  showToast('Percentual invalido')
                                  setFlourPctEdits(prev => { const n = {...prev}; delete n[e.id]; return n })
                                } else if (Math.abs(parsed - flourPct) > 0.0001) updateFlourShare(e.id, v)
                                else setFlourPctEdits(prev => { const n = {...prev}; delete n[e.id]; return n })
                              }}
                              disabled={!canEditFicha}
                              className="ps-input"
                              style={{width:58, textAlign:'right', padding:'6px 8px'}}
                            />
                            <span style={{fontSize:11, color:'var(--ink-faint)'}}>%</span>
                          </div>
                        )}
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
                    )
                  })
                )}

                {/* Sumário CMV */}
                {enriched.length > 0 && (
                  <div style={{marginTop:12, paddingTop:10, borderTop:'1px solid var(--ps-line)', display:'flex', justifyContent:'space-between', alignItems:'baseline'}}>
                    <div style={{fontSize:12, color:'var(--ink-soft)'}}>
                      {isKit ? 'CMV do kit' : 'CMV ingredientes'}{partialCount > 0 && <span style={{color:'var(--berry)'}}> · {partialCount} sem custo</span>}
                      {!isKit && packagingComponentsCost > 0 && <span> · embalagem fora: {formatBRL(packagingComponentsCost)}</span>}
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
                  <div className="ps-flabel" style={{marginBottom:8}}>{isKit ? 'Adicionar item ao kit' : 'Adicionar componente'}</div>
                  <div style={{display:'flex', gap:8, marginBottom:8}}>
                    <div style={{flex:1, position:'relative'}}>
                      <Search size={14} style={{position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--ink-faint)'}}/>
                      <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder={isKit ? 'Buscar produto para o kit…' : 'Buscar pão ou produto…'}
                        className="ps-input"
                        style={{paddingLeft:30}}
                      />
                    </div>
                    {!isKit && (
                      <select
                        value={newQtyMode}
                        onChange={e => setNewQtyMode(e.target.value as QuantityInputMode)}
                        className="ps-select"
                        style={{width:126}}
                      >
                        <option value="weight">Peso kg</option>
                        <option value="baker_pct">% farinha</option>
                      </select>
                    )}
                    <input
                      type="text"
                      inputMode="decimal"
                      value={newQty}
                      onChange={e => setNewQty(e.target.value.replace(/[^\d,.]/g, ''))}
                      placeholder={isKit ? 'un' : newQtyMode === 'baker_pct' ? '%' : 'Qtd'}
                      className="ps-input"
                      style={{width:80, textAlign:'right'}}
                    />
                  </div>
                  <div style={{display:'flex', gap:6, flexWrap:'wrap', marginBottom:8}}>
                    {isKit ? (
                      <span className="ps-store-chip">
                        quantidade = unidades do item dentro do kit
                      </span>
                    ) : (
                      <>
                        <span className="ps-store-chip">
                          farinha base: {recipeTotals.flourBaseKg !== null ? `${formatDecimalPtBR(recipeTotals.flourBaseKg, 3)} kg` : 'primeira farinha ou pré-mistura: 100% = 1 kg'}
                        </span>
                        {newQtyMode === 'baker_pct' && (
                          <span className="ps-store-chip ja">
                            peso calculado: {newQtyPreviewKg !== null
                              ? `${formatDecimalPtBR(newQtyPreviewKg, 3)} kg`
                              : firstFlourPreviewKg !== null
                                ? `${formatDecimalPtBR(firstFlourPreviewKg, 3)} kg se for farinha ou pré-mistura`
                                : '—'}
                          </span>
                        )}
                      </>
                    )}
                  </div>

                  {kitVariantChoice && (
                    <div className="ps-card" style={{padding:12, marginBottom:8, border:'1px solid var(--honey-deep)'}}>
                      <div style={{fontSize:13, fontWeight:600, marginBottom:8}}>
                        Qual variante de <strong>{kitVariantChoice.name}</strong> entra no kit?
                      </div>
                      <div style={{display:'flex', flexDirection:'column', gap:6}}>
                        {kitVariantChoice.variants.map(v => (
                          <button key={v.id} onClick={() => chooseKitComponentVariant(v.id)} className="ps-btn sm ghost" style={{justifyContent:'flex-start'}}>
                            {v.name}
                          </button>
                        ))}
                        <button onClick={() => chooseKitComponentVariant(null)} className="ps-btn sm ghost" style={{justifyContent:'flex-start', color:'var(--ink-faint)'}}>
                          Produto inteiro (não distinguir variante)
                        </button>
                        <button onClick={() => setKitVariantChoice(null)} className="ps-btn sm ghost" style={{justifyContent:'flex-start'}}>
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

                  {!kitVariantChoice && q.length >= 2 && (
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
                              {c.cost !== null && c.cost !== undefined ? `${formatBRL(Number(c.cost))}${c.unit?`/${c.unit}`:''}` : 'sem custo cadastrado'}
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
