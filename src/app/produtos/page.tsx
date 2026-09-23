'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Plus, Search, Pencil, Save, AlertTriangle, RotateCw, ClipboardList, BarChart3, CheckCircle2, CircleAlert, Tags, Copy } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, roleColor, type AppUser } from '@/lib/auth'
import { showToast } from '@/lib/utils'
import BreadWeightManager from '@/components/BreadWeightManager'
import { formatSaleOptionLabel, type PricingUnit } from '@/lib/saleOptions'
import { getConversionUnitWarning } from '@/lib/nfeXml'
import {
  normalizeOperationalClassification,
  requiresCompleteOperationalClassification,
  type ProductionProcess,
} from '@/lib/productOperationalClassification'
import { canonicalInventoryUnit } from '@/lib/inventoryReadiness'
import {
  CATALOG_TYPE_LABELS,
  loadProductCategories,
  type CatalogType,
  type ProductCategory,
} from '@/lib/productCategories'
import {
  applyCategoryChoice,
  describeCategoryPickerProblem,
  groupCategoriesForPicker,
  needsCurrentCategoryFallback,
  pickProductSaveColumns,
  resolveIsRevenda,
  type ProductSaveColumn,
  resolveLegacyCategoryText,
  validateProductCatalogChoice,
} from '@/lib/productCatalogForm'

type Kind = 'kit' | 'insumo' | 'final'

interface Product {
  id: string; name: string; category: string; unit: string|null
  cost_price: number|null; active: boolean; sort_order: number
  kind: Kind | null
  is_revenda: boolean
  is_shelf: boolean
  weekly_count_enabled: boolean
  is_fabricacao_propria: boolean
  is_pj: boolean
  // Classificação controlada do catálogo (fase 2A). A tela escolhe os dois na
  // fase 2B; o texto legado em `category` continua gravado com o nome da
  // categoria até a fase 4 aposentá-lo.
  catalog_type: CatalogType | null
  category_id: string | null
  production_days: number[]
  production_area: string | null
  production_process: ProductionProcess | null
  allows_planned_production: boolean | null
  allows_unplanned_production: boolean | null
  legacy_bread_id: string | null
}

type PurchaseConversionBasis = 'simple' | 'package' | 'usable'

interface ProductPurchaseConversion {
  id: string
  supplier_id: string
  supplier_name: string
  supplier_product_code: string | null
  supplier_ean: string | null
  supplier_description: string
  purchase_unit: string
  base_product_id: string
  base_unit: string
  conversion_basis: PurchaseConversionBasis
  conversion_factor: number | string
  last_confirmed_at: string | null
  active: boolean
}

interface ProductPurchaseConversionRow extends Omit<ProductPurchaseConversion, 'supplier_name' | 'conversion_factor'> {
  conversion_factor: number
  suppliers: { name: string } | { name: string }[] | null
}

type EditableProduct = Partial<Omit<Product, 'cost_price'>> & {
  cost_price?: number | string | null
}

// Campo que a tela edita e não está em PRODUCT_SAVE_COLUMNS não viaja no
// salvamento, e o defeito é silencioso: a pessoa muda, salva e nada acontece.
// Se este tipo acusar erro, acrescente a coluna à lista do salvamento — ou, se
// ela realmente não deve ser gravada por aqui, à exceção abaixo, com o motivo.
// Fora do salvamento de propósito: `id` identifica a linha, `active` tem fluxo
// próprio (insert explícito e o botão da listagem), `sort_order` e
// `legacy_bread_id` não são editáveis nesta tela.
type ColunasEditaveisForaDoSalvamento = Exclude<
  keyof EditableProduct,
  ProductSaveColumn | 'id' | 'active' | 'sort_order' | 'legacy_bread_id'
>
const _todaColunaEditavelViajaNoSalvamento:
  ColunasEditaveisForaDoSalvamento extends never ? true : ColunasEditaveisForaDoSalvamento = true

const KIND_LABELS: Record<Kind, string> = { kit: 'KIT', insumo: 'INSUMO', final: 'FINAL' }
const CONVERSION_BASIS_LABELS: Record<PurchaseConversionBasis, string> = {
  simple: 'Direta',
  package: 'Embalagem',
  usable: 'Utilizável (drenado/real)',
}
// Mapeia pro chip ps-store-chip (jc=honey/kit, ja=sage/insumo). 'final' fica neutro.
const KIND_CHIP_CLS: Record<Kind, string> = { kit: 'jc', insumo: 'ja', final: '' }
const WEEK_DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const PRODUCTION_AREAS = [
  { value: '', label: 'Sem área' },
  { value: 'padaria', label: 'Padaria' },
  { value: 'cozinha', label: 'Cozinha' },
  { value: 'confeitaria', label: 'Confeitaria' },
  { value: 'expedicao', label: 'Expedição' },
  { value: 'outros', label: 'Outros' },
]
const PRODUCTION_PROCESSES: { value: ProductionProcess; label: string; description: string }[] = [
  { value: 'forno', label: 'Forno', description: 'O produto final sai do forno.' },
  { value: 'montagem', label: 'Montagem', description: 'O produto final é montado e não volta ao forno.' },
  { value: 'preparo', label: 'Preparo', description: 'O produto final é preparado pela área, como pastinhas e recheios.' },
]

// A mesma resposta que a gaveta de edição mostra e que o salvamento grava. Sem
// isto, os produtos que estão na categoria Revenda sem a marcação antiga ficavam
// sem o chip e fora do filtro, enquanto a gaveta dizia que eram revenda.
function isRevendaProduct(product: Product): boolean {
  return resolveIsRevenda(product.catalog_type, product.is_revenda)
}

function canUseTechnicalSheet(product: Product): boolean {
  return !isRevendaProduct(product) && product.kind !== 'insumo'
}

function formatProductionDays(days: number[] | null | undefined): string {
  if (!days || days.length === 0) return 'sem dias definidos'
  return [...days].sort((a, b) => a - b).map(day => WEEK_DAYS[day] ?? String(day)).join(', ')
}

function toggleDay(days: number[] | undefined, day: number): number[] {
  const current = new Set(days ?? [])
  if (current.has(day)) current.delete(day)
  else current.add(day)
  return [...current].sort((a, b) => a - b)
}

function normalizeCostPrice(value: number | string | null | undefined): number | null {
  if (value === '' || value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return fallback
}

interface Bread {
  id: string; name: string; unit: string|null
  cost_price: number|null; active: boolean; is_pj: boolean
  is_shelf: boolean
  avg_unit_weight_kg: number|null
}

interface Component {
  parent_product_id: string
  component_source: string
  component_id: string
  quantity: number
}
interface SaleOption {
  id: string
  product_id: string
  name: string
  sale_unit: PricingUnit
  is_default: boolean
  active: boolean
}

export default function ProdutosPage() {
  const [user, setUser]         = useState<AppUser | null>(null)
  const [tab, setTab]           = useState<'produtos'|'fabricacao'>('produtos')
  const [products, setProducts] = useState<Product[]>([])
  const [breads, setBreads]     = useState<Bread[]>([])
  const [components, setComponents] = useState<Component[]>([])
  const [saleOptions, setSaleOptions] = useState<SaleOption[]>([])
  const [purchaseConversions, setPurchaseConversions] = useState<ProductPurchaseConversion[]>([])
  const [conversionEdits, setConversionEdits] = useState<ProductPurchaseConversion[]>([])
  const [conversionLoadError, setConversionLoadError] = useState<string | null>(null)
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [categoryLoadError, setCategoryLoadError] = useState<string | null>(null)
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState<string|null>(null)
  const [search, setSearch]     = useState('')
  const [catFilter, setCat]     = useState('Todos')
  const [kindFilter, setKindFilter] = useState<'all'|Kind|'revenda'>('all')
  const [pendingReviewOnly, setPendingReviewOnly] = useState(false)
  const [editItem, setEditItem] = useState<EditableProduct|null>(null)
  const [isNew, setIsNew]       = useState(false)
  const [duplicateItem, setDuplicateItem] = useState<Product|null>(null)
  const [duplicateName, setDuplicateName] = useState('')
  const [duplicating, setDuplicating] = useState(false)

  useEffect(()=>{ setUser(getCurrentUser()); load() },[])

  async function load() {
    setLoading(true)
    setLoadError(null)
    try {
      const [pRes, bRes, cRes, mRes] = await Promise.all([
        supabase.from('products').select('*').order('category').order('name'),
        supabase.from('breads').select('*').order('name'),
        supabase.from('product_components').select('parent_product_id,component_source,component_id,quantity'),
        supabase
          .from('payable_product_mappings')
          .select('id,supplier_id,supplier_product_code,supplier_ean,supplier_description,purchase_unit,base_product_id,base_unit,conversion_basis,conversion_factor,last_confirmed_at,active,suppliers(name)')
          .eq('active', true)
          .order('supplier_description'),
      ])
      if (pRes.error) throw pRes.error
      if (bRes.error) throw bRes.error
      if (cRes.error) throw cRes.error
      setProducts(pRes.data||[])
      setBreads(bRes.data||[])
      setComponents((cRes.data||[]) as Component[])
      setConversionLoadError(mRes.error ? 'Não foi possível carregar as conversões de compra.' : null)
      const mappingRows = (mRes.data || []) as ProductPurchaseConversionRow[]
      setPurchaseConversions(mappingRows.map(row => {
        const supplier = Array.isArray(row.suppliers) ? row.suppliers[0] : row.suppliers
        return {
          ...row,
          supplier_name: supplier?.name || 'Fornecedor sem nome',
        }
      }))
      try {
        setCategories(await loadProductCategories())
        setCategoryLoadError(null)
      } catch (error: unknown) {
        setCategories([])
        setCategoryLoadError(getErrorMessage(error, 'Não foi possível carregar a lista de categorias.'))
      }
      const soRes = await supabase
        .from('product_sale_options')
        .select('id,product_id,name,sale_unit,is_default,active')
        .eq('active', true)
      setSaleOptions(soRes.error ? [] : (soRes.data || []) as SaleOption[])
    } catch(error: unknown) {
      setLoadError(getErrorMessage(error, 'Falha ao carregar os dados.'))
    } finally {
      setLoading(false)
    }
  }

  function switchTab(nextTab: 'produtos' | 'fabricacao') {
    setTab(nextTab)
    setCat('Todos')
    setKindFilter('all')
    setPendingReviewOnly(false)
  }

  async function save() {
    if (!editItem?.name?.trim()) { showToast('Nome obrigatório'); return }
    const catalogChoiceError = validateProductCatalogChoice({
      isNew,
      categoryId: editItem.category_id,
      catalogType: editItem.catalog_type,
    })
    if (catalogChoiceError) { showToast(catalogChoiceError); return }
    const originalProduct = isNew ? null : products.find(product => product.id === editItem.id) ?? null
    const operationalClassification = normalizeOperationalClassification(editItem, {
      requireComplete: requiresCompleteOperationalClassification(
        isNew,
        !!originalProduct?.is_fabricacao_propria,
        !!editItem.is_fabricacao_propria,
      ),
    })
    if (!operationalClassification.ok) {
      showToast(operationalClassification.error)
      return
    }
    const removesExistingClassification = !!originalProduct?.production_process
      && (!editItem.is_fabricacao_propria || !editItem.production_process)
    if (removesExistingClassification && !window.confirm(
      editItem.is_fabricacao_propria
        ? 'Este produto já tem uma classificação de produção. Deseja removê-la e deixá-lo como revisão pendente?'
        : 'Este produto já tem uma classificação de produção. Ela será removida porque o produto deixará de ser fabricação própria. Deseja continuar?',
    )) return
    const conversionPayload = conversionEdits.map(conversion => ({
      id: conversion.id,
      conversion_basis: conversion.conversion_basis,
      conversion_factor: Number(conversion.conversion_factor),
    }))
    if (conversionPayload.some(conversion => !Number.isFinite(conversion.conversion_factor) || conversion.conversion_factor <= 0)) {
      showToast('Todo fator de conversão deve ser maior que zero.')
      return
    }
    const { cost_price: rawCostPrice, ...rest } = editItem
    // Somente as colunas que esta tela edita viajam. Antes o corpo saía da
    // linha inteira lida com select('*'), então o tipo e a categoria antigos
    // voltavam ao banco enquanto o texto livre mudava.
    const body = pickProductSaveColumns({
      ...rest,
      ...operationalClassification.value,
      cost_price: normalizeCostPrice(rawCostPrice),
      category: resolveLegacyCategoryText(rest.category_id, categories, rest.category),
      // A trava do banco exige unidade reconhecida para contagem semanal; se a
      // pessoa mudou a unidade depois de marcar, desmarca em vez de deixar o
      // banco recusar o salvamento inteiro com um erro cru.
      weekly_count_enabled: Boolean(rest.weekly_count_enabled) && Boolean(canonicalInventoryUnit(rest.unit)),
    })
    try {
      if (isNew) {
        const { error } = await supabase.from('products').insert({ ...body, active: true }).select('id').single()
        if (error) throw error
        showToast('✅ Produto criado')
      } else {
        const { error } = await supabase.from('products').update(body).eq('id', editItem.id!).select('id').single()
        if (error) throw error
        if (conversionPayload.length > 0) {
          const { error: conversionError } = await supabase.rpc('update_payable_product_mappings', {
            p_product_id: editItem.id,
            p_mappings: conversionPayload,
          })
          if (conversionError) throw new Error(`Produto salvo, mas as conversões não foram atualizadas: ${conversionError.message}`)
        }
        showToast('✅ Salvo')
      }
      setEditItem(null); load()
    } catch(error: unknown) { showToast('Erro: '+getErrorMessage(error, 'não foi possível salvar')) }
  }

  async function toggleActive(p: Product) {
    const willActivate = !p.active
    // Insumo inativo não pode ficar marcado para a contagem semanal (regra do banco).
    const nextWeeklyCountEnabled = willActivate ? p.weekly_count_enabled : false
    try {
      const { error } = await supabase
        .from('products')
        .update({ active: willActivate, weekly_count_enabled: nextWeeklyCountEnabled })
        .eq('id', p.id)
        .select('id')
        .single()
      if (error) throw error
      setProducts(prev => prev.map(x => x.id===p.id ? {...x, active: willActivate, weekly_count_enabled: nextWeeklyCountEnabled} : x))
    } catch (error: unknown) {
      showToast('Erro: '+getErrorMessage(error, 'não foi possível alterar o produto'))
    }
  }

  function newProductDefaults(fabricacaoPropria: boolean): EditableProduct {
    return {
      active: true,
      category: '',
      category_id: null,
      catalog_type: null,
      unit: 'un',
      kind: 'final',
      is_revenda: false,
      is_shelf: false,
      weekly_count_enabled: false,
      is_fabricacao_propria: fabricacaoPropria,
      is_pj: false,
      production_days: [],
      production_area: fabricacaoPropria ? 'padaria' : null,
      production_process: null,
      allows_planned_production: null,
      allows_unplanned_production: null,
      legacy_bread_id: null,
    }
  }

  function openProductEditor(product: Product) {
    setIsNew(false)
    setEditItem({
      ...product,
      // A tela abre já mostrando o que o salvamento vai gravar: a marcação de
      // revenda que a categoria manda e o nome dela no texto legado. Sem isso a
      // frase explicativa citava um nome que o banco não teria mais.
      is_revenda: resolveIsRevenda(product.catalog_type, product.is_revenda),
      category: resolveLegacyCategoryText(product.category_id, categories, product.category),
    })
    setConversionEdits(purchaseConversions.filter(conversion => conversion.base_product_id === product.id).map(conversion => ({ ...conversion })))
  }

  function openDuplicateProduct(product: Product) {
    setDuplicateItem(product)
    setDuplicateName(`${product.name} - cópia`)
  }

  async function duplicateProduct() {
    if (!duplicateItem) return
    const name = duplicateName.trim()
    if (!name) { showToast('Informe o nome do novo produto.'); return }
    setDuplicating(true)
    try {
      const { error } = await supabase.rpc('duplicate_product_complete', {
        p_source_product_id: duplicateItem.id,
        p_new_name: name,
      })
      if (error) throw error
      setDuplicateItem(null)
      setDuplicateName('')
      await load()
      showToast(`✅ "${name}" foi duplicado com ficha técnica e preços.`)
    } catch (error: unknown) {
      showToast('Erro ao duplicar: ' + getErrorMessage(error, 'não foi possível criar a cópia'))
    } finally {
      setDuplicating(false)
    }
  }

  const productsForTab = tab === 'fabricacao'
    ? products.filter(p => p.is_fabricacao_propria)
    : products
  const cats = ['Todos',...new Set(productsForTab.map(p=>p.category).filter(Boolean))]
  const categoryGroups = groupCategoriesForPicker(categories, editItem?.category_id ?? null)
  const categoryPickerProblem = describeCategoryPickerProblem({
    loadError: categoryLoadError,
    categoryCount: categories.length,
  })
  const filtered = productsForTab.filter(p=>{
    const matchCat = catFilter==='Todos' || p.category===catFilter
    const matchKind = kindFilter==='all'
      || (kindFilter==='revenda' ? isRevendaProduct(p) : p.kind===kindFilter)
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase())
    const matchPendingReview = !pendingReviewOnly || (p.active && p.is_fabricacao_propria && !p.production_process)
    return matchCat && matchKind && matchSearch && matchPendingReview
  })
  // CMV teorico por produto com ficha tecnica: soma (custo do componente × quantidade).
  // Se algum componente não tem custo cadastrado, marca como parcial.
  const cmvByProduct: Record<string, { total: number; partial: boolean; count: number }> = {}
  for (const c of components) {
    const cost = c.component_source === 'bread'
      ? (breads.find(b => b.id === c.component_id)?.cost_price ?? null)
      : (products.find(p => p.id === c.component_id)?.cost_price ?? null)
    const entry = cmvByProduct[c.parent_product_id] ??= { total: 0, partial: false, count: 0 }
    entry.count++
    if (cost === null || Number(cost) === 0) entry.partial = true
    else entry.total += Number(cost) * Number(c.quantity)
  }

  const kindCounts = { kit: 0, insumo: 0, final: 0, revenda: 0 }
  for (const p of productsForTab) {
    if (p.kind === 'kit') kindCounts.kit++
    else if (p.kind === 'insumo') kindCounts.insumo++
    else if (p.kind === 'final') kindCounts.final++
    if (isRevendaProduct(p)) kindCounts.revenda++
  }
  const grouped = filtered.reduce((acc:Record<string,Product[]>,p)=>{ (acc[p.category]??=[]).push(p); return acc },{})

  const fabricacaoActiveCount = products.filter(p => p.is_fabricacao_propria && p.active).length
  const fabricacaoWithoutCost = products.filter(p =>
    p.is_fabricacao_propria && p.active && (p.cost_price === null || Number(p.cost_price) === 0)
  ).length
  const fabricacaoPendingReview = products.filter(p =>
    p.is_fabricacao_propria && p.active && !p.production_process
  ).length
  const saleOptionsByProduct = new Map<string, SaleOption[]>()
  saleOptions.forEach(option => {
    const current = saleOptionsByProduct.get(option.product_id) || []
    current.push(option)
    saleOptionsByProduct.set(option.product_id, current)
  })

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <div className="ps-mark">P</div>
            <div className="ps-brand">
              <b>Catálogo</b>
              <span>Produtos &amp; Pães</span>
            </div>
          </div>
          {user && (
            <div className="ps-userchip">
              <div className="ps-avatar" style={{background: roleColor(user.role)}}>{user.displayName.charAt(0).toUpperCase()}</div>
              <b>{user.displayName}</b>
            </div>
          )}
        </header>

        <div className="ps-pad" style={{marginTop:14}}>
          <div className="ps-tabs" role="tablist">
            <button role="tab" aria-selected={tab==='produtos'} onClick={()=>switchTab('produtos')} className="ps-tab">
              🥐 Produtos ({products.filter(p=>p.active).length})
            </button>
            <button role="tab" aria-selected={tab==='fabricacao'} onClick={()=>switchTab('fabricacao')} className="ps-tab">
              🍞 Fabricação própria ({fabricacaoActiveCount})
            </button>
          </div>
        </div>

        <div className="ps-scroll ps-pad">
          {/* Action row: search + new */}
          <div style={{display:'flex', gap:8, marginTop:14, marginBottom:12, flexWrap:'wrap'}}>
            <div style={{flex:'1 1 260px', position:'relative'}}>
              <Search size={14} style={{position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--ink-faint)', pointerEvents:'none'}}/>
              <input placeholder={tab==='produtos' ? "Buscar produto..." : "Buscar fabricação própria..."} value={search} onChange={e=>setSearch(e.target.value)}
                className="ps-input" style={{width:'100%', padding:'8px 12px 8px 30px', fontSize:13}}/>
            </div>
            <Link href="/produtos/cmv" className="ps-btn ghost">
              <BarChart3 size={14}/> CMV
            </Link>
            {user?.role === 'admin' && (
              <Link href="/produtos/categorias" className="ps-btn ghost">
                <Tags size={14}/> Categorias
              </Link>
            )}
            {tab==='produtos' ? (
              <button onClick={()=>{setIsNew(true);setConversionEdits([]);setEditItem(newProductDefaults(false))}} className="ps-btn primary">
                <Plus size={14}/> Novo
              </button>
            ) : (
              <button onClick={()=>{setIsNew(true);setConversionEdits([]);setEditItem(newProductDefaults(true))}} className="ps-btn primary">
                <Plus size={14}/> Novo
              </button>
            )}
          </div>

          {/* Kind filter */}
          <div className="ps-presets" style={{paddingBottom:6, marginBottom:8, flexWrap:'wrap'}}>
            <button onClick={()=>setKindFilter('all')} className={`ps-preset ${kindFilter==='all'?'active':''}`}>
              Todos
            </button>
            <button onClick={()=>setKindFilter('kit')} className={`ps-preset ${kindFilter==='kit'?'active':''}`}>
              🍞 Kits ({kindCounts.kit})
            </button>
            <button onClick={()=>setKindFilter('insumo')} className={`ps-preset ${kindFilter==='insumo'?'active':''}`}>
              🥚 Insumos ({kindCounts.insumo})
            </button>
            <button onClick={()=>setKindFilter('final')} className={`ps-preset ${kindFilter==='final'?'active':''}`}>
              ✨ Finais ({kindCounts.final})
            </button>
            <button onClick={()=>setKindFilter('revenda')} className={`ps-preset ${kindFilter==='revenda'?'active':''}`}>
              🛒 Revenda ({kindCounts.revenda})
            </button>
            {tab === 'fabricacao' && (
              <button
                onClick={() => setPendingReviewOnly(current => !current)}
                className={`ps-preset ${pendingReviewOnly ? 'active' : ''}`}
              >
                ⚠ Revisão pendente ({fabricacaoPendingReview})
              </button>
            )}
          </div>

          {/* Category filter */}
          <div className="ps-presets" style={{marginBottom:12}}>
            {cats.map(c=>(
              <button key={c} onClick={()=>setCat(c)} className={`ps-preset ${catFilter===c?'active':''}`}>
                {c}
              </button>
            ))}
          </div>

          {tab==='fabricacao' && fabricacaoWithoutCost > 0 && (
            <div className="ps-warning">
              <AlertTriangle size={16} style={{flexShrink:0, marginTop:1}}/>
              <span>
                <strong>{fabricacaoWithoutCost}</strong> {fabricacaoWithoutCost === 1 ? 'produto de fabricação própria ativo sem custo cadastrado' : 'produtos de fabricação própria ativos sem custo cadastrado'}.
              </span>
            </div>
          )}

          {tab==='fabricacao' && (user?.role === 'admin' || user?.role === 'financeiro') && (
            <BreadWeightManager />
          )}

          {loading ? (
            <div className="ps-empty">Carregando...</div>
          ) : loadError ? (
            <div className="ps-empty">
              <AlertTriangle size={36} style={{display:'block', margin:'0 auto 8px', color:'var(--berry)', opacity:.6}}/>
              <div style={{color:'var(--berry)', fontSize:14, fontWeight:600, marginBottom:8}}>Não foi possível carregar os dados.</div>
              <div style={{color:'var(--ink-faint)', fontSize:12, marginBottom:14}}>{loadError}</div>
              <button onClick={()=>load()} className="ps-btn primary">
                <RotateCw size={14}/> Tentar de novo
              </button>
            </div>
          ) : (
            <div style={{display:'flex', flexDirection:'column', gap:12}}>
              {Object.entries(grouped).map(([cat, items])=>(
                <div key={cat} className="ps-card" style={{padding:'4px 14px'}}>
                  <div className="ps-flabel" style={{paddingTop:10}}>{cat} ({items.length})</div>
                  {items.map(p=>(
                    <div key={p.id} style={{display:'flex', alignItems:'center', gap:8, padding:'10px 0', borderBottom:'1px solid var(--line-soft)', opacity:p.active?1:0.5}}>
                      <div style={{flex:1, minWidth:0}}>
                        <div style={{fontSize:14, fontWeight:600, color:'var(--ps-ink)', display:'flex', alignItems:'center', gap:6, flexWrap:'wrap'}}>
                          {p.name}
                          {p.kind && p.kind !== 'final' && (
                            <span className={`ps-store-chip ${KIND_CHIP_CLS[p.kind]}`}>{KIND_LABELS[p.kind]}</span>
                          )}
                          {isRevendaProduct(p) && (
                            <span className="ps-store-chip" style={{background:'var(--crust-tint)', color:'var(--crust)'}}>🛒 REVENDA</span>
                          )}
                          {p.is_fabricacao_propria && (
                            <span className="ps-store-chip jc">FABRICAÇÃO</span>
                          )}
                          {tab === 'fabricacao' && p.is_fabricacao_propria && !p.production_process && (
                            <span className="ps-store-chip" style={{background:'var(--berry-tint)', color:'var(--berry)'}}>
                              REVISÃO PENDENTE
                            </span>
                          )}
                          {p.is_pj && (
                            <span className="ps-store-chip ja">PJ</span>
                          )}
                          {p.is_shelf && (
                            <span className="ps-store-chip ex">📦 PRATELEIRA</span>
                          )}
                          {p.legacy_bread_id && (
                            <span className="ps-store-chip" style={{background:'var(--line-soft)', color:'var(--ink-soft)'}}>MIGRADO</span>
                          )}
                          {canUseTechnicalSheet(p) && (
                            <span
                              className="ps-store-chip"
                              title={cmvByProduct[p.id]?.count
                                ? `Ficha tecnica cadastrada (${cmvByProduct[p.id].count} componentes)`
                                : 'Sem ficha tecnica cadastrada'}
                              style={cmvByProduct[p.id]?.count
                                ? {background:'#E3F0E0', color:'var(--sage)', gap:3}
                                : {background:'var(--berry-tint)', color:'var(--berry)', gap:3}}
                            >
                              {cmvByProduct[p.id]?.count ? <CheckCircle2 size={11}/> : <CircleAlert size={11}/>}
                              {cmvByProduct[p.id]?.count ? 'FICHA OK' : 'SEM FICHA'}
                            </span>
                          )}
                        </div>
                        <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:2}}>
                          {p.unit||''}{p.cost_price?` · R$ ${Number(p.cost_price).toFixed(2)}`:''}
                        </div>
                        {(saleOptionsByProduct.get(p.id) || []).length > 0 && (
                          <div style={{display:'flex', gap:4, flexWrap:'wrap', marginTop:4}}>
                            {(saleOptionsByProduct.get(p.id) || []).map(option => (
                              <span key={option.id} className="ps-store-chip ja">
                                {formatSaleOptionLabel(option)}{option.is_default ? ' padrão' : ''}
                              </span>
                            ))}
                          </div>
                        )}
                        {p.is_fabricacao_propria && (
                          <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:2}}>
                            Área: {p.production_area || 'não definida'} · Processo: {p.production_process
                              ? PRODUCTION_PROCESSES.find(process => process.value === p.production_process)?.label.toLowerCase()
                              : 'não revisado'}
                            {p.production_process && (
                              <> · Formas: {[
                                p.allows_planned_production ? 'planejada' : null,
                                p.allows_unplanned_production ? 'sem ordem' : null,
                              ].filter(Boolean).join(' + ')}</>
                            )}
                            <br/>Dias: {formatProductionDays(p.production_days)}
                          </div>
                        )}
                        {canUseTechnicalSheet(p) && cmvByProduct[p.id] && (
                          <div style={{fontSize:11, color:'var(--sage)', marginTop:2, fontWeight:600}}>
                            CMV teórico: R$ {cmvByProduct[p.id].total.toFixed(2)}
                            {cmvByProduct[p.id].partial && <span style={{color:'var(--berry)', fontWeight:500}}> (parcial)</span>}
                            <span style={{color:'var(--ink-faint)', fontWeight:400}}> · {cmvByProduct[p.id].count} comp.</span>
                          </div>
                        )}
                      </div>
                      {canUseTechnicalSheet(p) && (
                        <Link href={`/produtos/composicao?id=${p.id}`} title="Ficha técnica / CMV teórico" className="ps-btn" style={{height:34, padding:'0 10px', fontSize:12, flexShrink:0}}>
                          <ClipboardList size={14}/>
                          Ficha
                        </Link>
                      )}
                      <button onClick={()=>toggleActive(p)} className={`ps-status ${p.active?'conferido':'separado'}`} style={{border:'1px solid transparent', cursor:'pointer'}}>
                        {p.active?'✓ Ativo':'Inativo'}
                      </button>
                      <button
                        onClick={()=>openDuplicateProduct(p)}
                        className="ps-iconbtn"
                        style={{width:30, height:30}}
                        title={`Duplicar ${p.name}`}
                        aria-label={`Duplicar ${p.name}`}
                      >
                        <Copy size={14}/>
                      </button>
                      <button onClick={()=>openProductEditor(p)} className="ps-iconbtn" style={{width:30, height:30}}>
                        <Pencil size={14}/>
                      </button>
                    </div>
                  ))}
                </div>
              ))}
              {filtered.length === 0 && (
                <div className="ps-empty">
                  Nenhum item encontrado.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* MODAL — Duplicar produto */}
      {duplicateItem && (
        <div className="ps-sheet-overlay" onClick={e=>e.target===e.currentTarget&&!duplicating&&setDuplicateItem(null)}>
          <div className="ps-sheet" role="dialog" aria-modal="true" aria-labelledby="duplicate-product-title">
            <div className="ps-sheet-grab"/>
            <h3 id="duplicate-product-title">Duplicar produto</h3>
            <p style={{fontSize:13, color:'var(--ink-soft)', lineHeight:1.5, margin:'0 0 14px'}}>
              A cópia leva a ficha técnica e os preços de venda, mas começa inativa para não entrar em operação ou na vitrine sem revisão. Estoque, pedidos, compras e histórico não são copiados.
            </p>
            <div className="ps-fieldgroup" style={{marginBottom:16}}>
              <div className="ps-fieldlabel">Novo nome</div>
              <input
                type="text"
                autoFocus
                value={duplicateName}
                onChange={e=>setDuplicateName(e.target.value)}
                onKeyDown={e=>{ if (e.key === 'Enter') void duplicateProduct() }}
                className="ps-input"
                disabled={duplicating}
              />
            </div>
            <div style={{display:'flex', justifyContent:'flex-end', gap:8}}>
              <button className="ps-btn" onClick={()=>setDuplicateItem(null)} disabled={duplicating}>Cancelar</button>
              <button className="ps-btn primary" onClick={()=>void duplicateProduct()} disabled={duplicating}>
                <Copy size={14}/>{duplicating ? 'Duplicando…' : 'Duplicar produto'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL — Produto */}
      {editItem && (
        <div className="ps-sheet-overlay" onClick={e=>e.target===e.currentTarget&&setEditItem(null)}>
          <div className="ps-sheet">
            <div className="ps-sheet-grab"/>
            <h3>{isNew?'Novo Produto':'Editar Produto'}</h3>

            <div style={{display:'flex', flexDirection:'column', gap:10, marginBottom:14}}>
              <div className="ps-fieldgroup">
                <div className="ps-fieldlabel">Nome</div>
                <input
                  type="text"
                  value={editItem.name || ''}
                  onChange={e=>setEditItem(prev=>({...prev, name:e.target.value}))}
                  className="ps-input"
                />
              </div>
              <div className="ps-fieldgroup">
                <div className="ps-fieldlabel">Unidade</div>
                <input
                  type="text"
                  value={editItem.unit || ''}
                  onChange={e=>setEditItem(prev=>({...prev, unit:e.target.value}))}
                  className="ps-input"
                />
              </div>
              <div className="ps-fieldgroup">
                <div className="ps-fieldlabel">Custo (R$)</div>
                <input
                  type="number"
                  value={editItem.cost_price ?? ''}
                  onChange={e=>setEditItem(prev=>({...prev, cost_price:e.target.value}))}
                  className="ps-input"
                />
              </div>
              <div className="ps-fieldgroup">
                <div className="ps-fieldlabel">Categoria</div>
                <select
                  value={editItem.category_id || ''}
                  disabled={!!categoryPickerProblem}
                  onChange={e => setEditItem(prev => ({ ...prev, ...applyCategoryChoice(e.target.value, categories, prev ?? {}) }))}
                  className="ps-select"
                >
                  {/* A escolha vazia existe só enquanto o produto não tem categoria.
                      Produto já classificado não oferece caminho para voltar a ficar
                      sem classificação: isso desfaria a classificação da fase 2A sem
                      ninguém notar. */}
                  {!editItem.category_id && <option value="">Escolha a categoria…</option>}
                  {needsCurrentCategoryFallback(categoryGroups, editItem.category_id) && (
                    <option value={editItem.category_id!}>{editItem.category || 'Categoria atual'}</option>
                  )}
                  {categoryGroups.map(group => (
                    <optgroup key={group.catalogType} label={group.label}>
                      {group.categories.map(category => (
                        <option key={category.id} value={category.id}>
                          {category.name}{category.active ? '' : ' (inativa)'}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {categoryPickerProblem && (
                  <small style={{ display: 'block', marginTop: 4, color: 'var(--berry)' }}>
                    {categoryPickerProblem}
                  </small>
                )}
                {editItem.catalog_type ? (
                  <small style={{ display: 'block', marginTop: 4 }}>
                    Tipo de item: <b>{CATALOG_TYPE_LABELS[editItem.catalog_type]}</b> — vem da categoria escolhida.
                    {editItem.catalog_type === 'produto_revenda' && editItem.is_fabricacao_propria && (
                      <><br/><span style={{ color: 'var(--berry)', fontWeight: 700 }}>
                        Este produto está marcado como fabricação própria. Categoria de revenda significa comprado
                        pronto, e com ela o produto perde a ficha técnica; se ele é feito aqui, escolha a categoria de
                        venda dele.
                      </span></>
                    )}
                  </small>
                ) : (
                  <small style={{ display: 'block', marginTop: 4, color: isNew ? 'var(--berry)' : 'var(--honey-deep)' }}>
                    {isNew
                        ? 'Obrigatório: a categoria escolhida define o tipo de item do produto.'
                        : editItem.category
                          ? `Hoje está como “${editItem.category}” em texto livre. Escolher a categoria da lista acerta o tipo de item.`
                          : 'Produto ainda sem categoria. Escolher uma da lista acerta o tipo de item.'}
                  </small>
                )}
              </div>
              {!isNew && (
                <div className="ps-banner" style={{ marginTop: 2 }}>
                  <div style={{ fontWeight: 700, color: 'var(--ps-ink)' }}>Conversões de compra</div>
                  <small style={{ display: 'block', marginTop: 3 }}>
                    O fator é específico por fornecedor e embalagem. Ele afeta as próximas importações; notas antigas permanecem como foram registradas.
                  </small>
                  {conversionLoadError ? (
                    <small style={{ display: 'block', marginTop: 8, color: 'var(--berry)' }}>{conversionLoadError}</small>
                  ) : conversionEdits.length === 0 ? (
                    <small style={{ display: 'block', marginTop: 8, color: 'var(--ink-faint)' }}>
                      Nenhuma conversão salva. Ela aparecerá aqui depois que uma NF-e deste fornecedor for confirmada.
                    </small>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                      {conversionEdits.map(conversion => {
                        const factor = Number(conversion.conversion_factor)
                        const unitWarning = getConversionUnitWarning(conversion.purchase_unit, conversion.base_unit, factor)
                        const supplierCode = conversion.supplier_product_code || conversion.supplier_ean
                        const confirmedAt = conversion.last_confirmed_at
                          ? new Date(conversion.last_confirmed_at).toLocaleDateString('pt-BR')
                          : null
                        return (
                          <div key={conversion.id} style={{ paddingTop: 9, borderTop: '1px solid var(--line-soft)' }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ps-ink)' }}>{conversion.supplier_name}</div>
                            <small style={{ display: 'block', marginTop: 2 }}>
                              {conversion.supplier_description} · compra em {conversion.purchase_unit} → receita em {conversion.base_unit}
                              {supplierCode ? ` · código ${supplierCode}` : ''}
                            </small>
                            <div className="ps-fieldrow" style={{ marginTop: 8 }}>
                              <div className="ps-fieldgroup">
                                <div className="ps-fieldlabel">Como calcular</div>
                                <select
                                  value={conversion.conversion_basis}
                                  onChange={event => setConversionEdits(previous => previous.map(item => item.id === conversion.id
                                    ? { ...item, conversion_basis: event.target.value as PurchaseConversionBasis }
                                    : item))}
                                  className="ps-select"
                                >
                                  {Object.entries(CONVERSION_BASIS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                </select>
                              </div>
                              <div className="ps-fieldgroup">
                                <div className="ps-fieldlabel">Fator de conversão</div>
                                <input
                                  type="number"
                                  min="0.000001"
                                  step="0.000001"
                                  value={conversion.conversion_factor}
                                  onChange={event => setConversionEdits(previous => previous.map(item => item.id === conversion.id
                                    ? { ...item, conversion_factor: event.target.value }
                                    : item))}
                                  className="ps-input"
                                />
                              </div>
                            </div>
                            <small style={{ display: 'block', marginTop: 5, color: 'var(--ink-faint)' }}>
                              Exemplo: 1 {conversion.purchase_unit} × {Number.isFinite(factor) ? factor.toLocaleString('pt-BR', { maximumFractionDigits: 6 }) : 'fator inválido'} = {Number.isFinite(factor) ? factor.toLocaleString('pt-BR', { maximumFractionDigits: 6 }) : '—'} {conversion.base_unit}
                              {confirmedAt ? ` · confirmado em ${confirmedAt}` : ''}
                            </small>
                            {unitWarning && <small role="alert" style={{ display: 'block', marginTop: 5, color: 'var(--berry)', fontWeight: 700 }}>{unitWarning}</small>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
              <div className="ps-fieldgroup">
                <div className="ps-fieldlabel">Uso na operação</div>
                <select value={editItem.kind || 'final'} onChange={e=>{
                  const nextKind = e.target.value as Kind
                  setEditItem(prev=>({...prev, kind: nextKind, weekly_count_enabled: nextKind === 'insumo' ? prev?.weekly_count_enabled : false}))
                }} className="ps-select">
                  <option value="final">✨ Produto final (venda direta)</option>
                  <option value="kit">🍞 Kit (composto por pães/insumos)</option>
                  <option value="insumo">🥚 Insumo (matéria-prima)</option>
                </select>
              </div>
              {editItem.kind === 'insumo' && (
                <label style={{display:'flex', alignItems:'center', gap:8, cursor: canonicalInventoryUnit(editItem.unit) ? 'pointer' : 'not-allowed', padding:'8px 4px'}}>
                  <input
                    type="checkbox"
                    checked={!!editItem.weekly_count_enabled}
                    disabled={!canonicalInventoryUnit(editItem.unit)}
                    onChange={e => setEditItem(prev => ({...prev, weekly_count_enabled: e.target.checked}))}
                    style={{width:18, height:18, cursor: canonicalInventoryUnit(editItem.unit) ? 'pointer' : 'not-allowed'}}
                  />
                  <span style={{fontSize:13, color:'var(--ps-ink)'}}>
                    📋 <b>Contagem semanal</b> — entra na contagem física de estoque da JC
                    {!canonicalInventoryUnit(editItem.unit) && (
                      <><br/><small style={{color:'var(--berry)'}}>Unidade não reconhecida para contagem; corrija antes de marcar.</small></>
                    )}
                    {canonicalInventoryUnit(editItem.unit) && !normalizeCostPrice(editItem.cost_price) && (
                      <><br/><small style={{color:'var(--honey-deep)'}}>Sem custo cadastrado ainda; pode marcar, mas o CMV só fecha depois de preencher.</small></>
                    )}
                  </span>
                </label>
              )}
              <label style={{display:'flex', alignItems:'center', gap:8, cursor: editItem.catalog_type ? 'not-allowed' : 'pointer', padding:'8px 4px'}}>
                <input
                  type="checkbox"
                  checked={!!editItem.is_revenda}
                  disabled={!!editItem.catalog_type}
                  onChange={e => setEditItem(prev => ({...prev, is_revenda: e.target.checked}))}
                  style={{width:18, height:18, cursor: editItem.catalog_type ? 'not-allowed' : 'pointer'}}
                />
                <span style={{fontSize:13, color:'var(--ps-ink)'}}>
                  🛒 <b>Revenda</b> — comprado pronto pra revender (aparece em /compras)
                  {editItem.catalog_type && (
                    <><br/><small style={{color:'var(--ink-faint)'}}>
                      {editItem.catalog_type === 'produto_revenda'
                        ? `Marcado pela categoria “${editItem.category}”, que é do tipo Produto de revenda.`
                        : `Desmarcado porque a categoria “${editItem.category}” é do tipo ${CATALOG_TYPE_LABELS[editItem.catalog_type]}. Para marcar, troque a categoria.`}
                    </small></>
                  )}
                </span>
              </label>
              <label style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer', padding:'8px 4px'}}>
                <input
                  type="checkbox"
                  checked={!!editItem.is_shelf}
                  onChange={e => setEditItem(prev => ({...prev, is_shelf: e.target.checked}))}
                  style={{width:18, height:18, cursor:'pointer'}}
                />
                <span style={{fontSize:13, color:'var(--ps-ink)'}}>
                  📦 <b>Prateleira</b> — produto durado (≥ 2 dias). Atendente conta o saldo no fim do dia em /sobras → Prateleira, em vez de lançar como sobra todo dia.
                </span>
              </label>
              <label style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer', padding:'8px 4px'}}>
                <input
                  type="checkbox"
                  checked={!!editItem.is_fabricacao_propria}
                  onChange={e => setEditItem(prev => ({
                    ...prev,
                    is_fabricacao_propria: e.target.checked,
                    production_area: e.target.checked ? (prev?.production_area || 'padaria') : prev?.production_area || null,
                  }))}
                  style={{width:18, height:18, cursor:'pointer'}}
                />
                <span style={{fontSize:13, color:'var(--ps-ink)'}}>
                  🍞 <b>Fabricação própria</b>
                </span>
              </label>
              {editItem.is_fabricacao_propria && (
                <>
                  <label style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer', padding:'8px 4px'}}>
                    <input
                      type="checkbox"
                      checked={!!editItem.is_pj}
                      onChange={e => setEditItem(prev => ({...prev, is_pj: e.target.checked}))}
                      style={{width:18, height:18, cursor:'pointer'}}
                    />
                    <span style={{fontSize:13, color:'var(--ps-ink)'}}>
                      PJ
                    </span>
                  </label>
                  <div className="ps-fieldgroup">
                    <div className="ps-fieldlabel">Área responsável</div>
                    <select
                      value={editItem.production_area || ''}
                      onChange={e=>setEditItem(prev=>({...prev, production_area: e.target.value || null}))}
                      className="ps-select"
                    >
                      {PRODUCTION_AREAS.map(area => <option key={area.value} value={area.value}>{area.label}</option>)}
                    </select>
                  </div>
                  <div style={{padding:'10px 12px', borderRadius:10, background:'var(--crust-tint)', color:'var(--ink-soft)', fontSize:12, lineHeight:1.5}}>
                    A categoria continua servindo para venda e organização. A classificação abaixo define como a produção deste produto será controlada; uma não altera a outra automaticamente.
                  </div>
                  <div className="ps-fieldgroup">
                    <div className="ps-fieldlabel">Como o produto final é produzido?</div>
                    <select
                      value={editItem.production_process || ''}
                      onChange={e => {
                        const process = e.target.value as ProductionProcess | ''
                        setEditItem(prev => ({
                          ...prev,
                          production_process: process || null,
                          allows_planned_production: process ? (prev?.allows_planned_production ?? false) : prev?.allows_planned_production ?? null,
                          allows_unplanned_production: process ? (prev?.allows_unplanned_production ?? false) : prev?.allows_unplanned_production ?? null,
                        }))
                      }}
                      className="ps-select"
                    >
                      <option value="">Ainda não revisado</option>
                      {PRODUCTION_PROCESSES.map(process => (
                        <option key={process.value} value={process.value}>{process.label}</option>
                      ))}
                    </select>
                    {editItem.production_process && (
                      <small style={{display:'block', marginTop:5, color:'var(--ink-faint)'}}>
                        {PRODUCTION_PROCESSES.find(process => process.value === editItem.production_process)?.description}
                      </small>
                    )}
                  </div>
                  {editItem.production_process && (
                    <div className="ps-fieldgroup">
                      <div className="ps-fieldlabel">Formas permitidas de produção</div>
                      <label style={{display:'flex', alignItems:'flex-start', gap:8, cursor:'pointer', padding:'6px 0'}}>
                        <input
                          type="checkbox"
                          checked={editItem.allows_planned_production === true}
                          onChange={e => setEditItem(prev => ({...prev, allows_planned_production: e.target.checked}))}
                          style={{width:18, height:18, cursor:'pointer', marginTop:1}}
                        />
                        <span style={{fontSize:13, color:'var(--ps-ink)'}}>
                          <b>Aceita quantidade planejada</b> — pode entrar em uma ordem de produção.
                        </span>
                      </label>
                      <label style={{display:'flex', alignItems:'flex-start', gap:8, cursor:'pointer', padding:'6px 0'}}>
                        <input
                          type="checkbox"
                          checked={editItem.allows_unplanned_production === true}
                          onChange={e => setEditItem(prev => ({...prev, allows_unplanned_production: e.target.checked}))}
                          style={{width:18, height:18, cursor:'pointer', marginTop:1}}
                        />
                        <span style={{fontSize:13, color:'var(--ps-ink)'}}>
                          <b>Permite lançar sem ordem</b> — a área pode registrar o que fez conforme a necessidade.
                        </span>
                      </label>
                    </div>
                  )}
                  <div className="ps-fieldgroup">
                    <div className="ps-fieldlabel">Dias de produção</div>
                    <div className="ps-presets" style={{flexWrap:'wrap', marginBottom:0}}>
                      {WEEK_DAYS.map((label, day) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => setEditItem(prev => ({...prev, production_days: toggleDay(prev?.production_days, day)}))}
                          className={`ps-preset ${(editItem.production_days || []).includes(day) ? 'active' : ''}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div style={{display:'flex', gap:8}}>
              <button onClick={save} className="ps-btn primary" style={{flex:1}}>
                <Save size={14}/> Salvar
              </button>
              <button onClick={()=>setEditItem(null)} className="ps-btn ghost">Cancelar</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
