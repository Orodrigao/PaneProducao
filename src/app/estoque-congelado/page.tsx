'use client'
import { useState, useEffect, useCallback } from 'react'
import { Search, Plus, Pencil, Trash2, X, Save, Snowflake } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, roleColor } from '@/lib/auth'
import { showToast } from '@/lib/utils'

// Novo modelo: locais nomeados por loja. Cada loja tem suas próprias subdivisões.
const LOCATIONS_BY_STORE: Record<string, string[]> = {
  jc: ['jc-freezer', 'jc-camara', 'jc-freezer-loja'],
  ja: ['ja-freezer'],
  ex: ['ex-freezer-1', 'ex-freezer-2', 'ex-freezer-3', 'ex-freezer-4'],
}

const LOCATION_LABELS: Record<string, string> = {
  'jc-freezer':      '🧊 Freezer Horizontal',
  'jc-camara':       '🏪 Câmara Congelada',
  'jc-freezer-loja': '🛒 Freezer da Loja',
  'ja-freezer':      '🧊 Freezer JA',
  'ex-freezer-1':    '🧊 Freezer 1',
  'ex-freezer-2':    '🧊 Freezer 2',
  'ex-freezer-3':    '🧊 Freezer 3',
  'ex-freezer-4':    '🧊 Freezer 4',
}

const STORE_LABELS: Record<string, string> = { jc: 'JC', ja: 'JA', ex: 'EX' }
const ALL_CATEGORIES = 'Todas'
const UNCATEGORIZED_CATEGORY = 'Sem categoria'
const BREAD_CATEGORY = 'Pães'

// Extrai a loja de um id de location ('jc-freezer' → 'jc').
function locStoreKey(loc: string): string {
  return loc.split('-')[0]
}

const STORE_ORDER = ['jc', 'ja', 'ex'] as const

// Normaliza nomes antigos pra novos (transição até o UPDATE do DB rodar)
function normalizeLocation(loc: string): string {
  if (loc === 'freezer')       return 'jc-freezer'
  if (loc === 'camara')        return 'jc-camara'
  if (loc === 'freezer_loja')  return 'jc-freezer-loja'
  return loc
}

// Locais visíveis pro usuário: a loja dele OU todas se admin (store=null)
function visibleLocations(store: string | null): string[] {
  if (store && LOCATIONS_BY_STORE[store]) return LOCATIONS_BY_STORE[store]
  // Admin sem loja → vê todos
  return Object.values(LOCATIONS_BY_STORE).flat()
}

interface FrozenProduct { id:string; product_name:string; unit:string|null; min_stock:number|null; active:boolean; visible_stores: string[]|null; product_id?:string|null; product_source?:string|null }

// Normaliza visible_stores aceitando formato legacy (string única) durante transição.
function normalizeStores(s: unknown): string[] | null {
  if (s == null) return null
  if (Array.isArray(s)) return s.length > 0 ? s as string[] : null
  if (typeof s === 'string') return [s]
  return null
}
interface StockMap { [fpId: string]: Record<string, number> }

export default function EstoqueCongeladoPage() {
  const [user, setUser]         = useState<{displayName:string; store:string|null; pin:string; role:any}|null>(null)
  const [products, setProducts] = useState<FrozenProduct[]>([])
  const [stock, setStock]       = useState<StockMap>({})
  const [search, setSearch]     = useState('')
  const [categoryFilter, setCategoryFilter] = useState(ALL_CATEGORIES)
  const [tab, setTab]           = useState<'estoque'|'historico'|'admin'>('estoque')
  const [movFP, setMovFP]       = useState<FrozenProduct|null>(null)
  const [movType, setMovType]   = useState<'entrada'|'saida'|'inventario'>('entrada')
  const [movLoc, setMovLoc]     = useState<string>('')
  const [movQty, setMovQty]     = useState('')
  const [movObs, setMovObs]     = useState('')
  const [saving, setSaving]     = useState(false)
  const [historico, setHistorico] = useState<any[]>([])
  const [adminAuthed, setAdminAuthed] = useState(false)
  const [adminPwd, setAdminPwd] = useState('')
  // Catálogo unificado: products + breads (com tag _source pra inserir corretamente em frozen_products)
  type CatalogItem = { id: string; name: string; unit: string|null; category: string|null; _source: 'product'|'bread' }
  type CatalogProductRow = { id: string; name: string; unit: string|null; category: string|null }
  type CatalogBreadRow = { id: string; name: string; unit: string|null }
  const [allProducts, setAllProducts] = useState<CatalogItem[]>([])
  const [adminSearch, setAdminSearch] = useState('')
  const [adminResults, setAdminResults] = useState<CatalogItem[]>([])
  const [newProdName, setNewProdName] = useState('')
  // Bloqueia disparo concorrente de qualquer botão "Adicionar" (mata double-click).
  const [addingProduct, setAddingProduct] = useState(false)
  // Modal "+ Adicionar produto" pra qualquer user com store (sem senha admin)
  const [addOpen, setAddOpen]         = useState(false)
  const [addSearch, setAddSearch]     = useState('')
  const [addResults, setAddResults]   = useState<CatalogItem[]>([])
  const [addManualName, setAddManualName] = useState('')
  const [addStores, setAddStores] = useState<string[]|null>(null)
  // Editar produto cadastrado
  const [editFP, setEditFP] = useState<FrozenProduct|null>(null)
  const [editName, setEditName] = useState('')
  const [editUnit, setEditUnit] = useState('')
  const [editMinQty, setEditMinQty] = useState('')
  const [editStores, setEditStores] = useState<string[]|null>(null)

  useEffect(() => {
    const u = getCurrentUser()
    if (u) setUser({ displayName: u.displayName, store: u.store ?? null, pin: u.pin, role: u.role })
  }, [])

  const locsVisible = visibleLocations(user?.store ?? null)

  const load = useCallback(async () => {
    const [{ data: fps }, { data: ss }] = await Promise.all([
      supabase.from('frozen_products').select('*').eq('active', true).order('product_name'),
      supabase.from('frozen_stock').select('*'),
    ])
    const normalized = (fps||[]).map((p:any) => ({
      ...p,
      visible_stores: normalizeStores(p.visible_stores ?? p.store)
    }))
    setProducts(normalized)
    const sm: StockMap = {}
    ;(ss||[]).forEach((s:any) => {
      const loc = normalizeLocation(s.location)
      if (!sm[s.frozen_product_id]) sm[s.frozen_product_id] = {}
      sm[s.frozen_product_id][loc] = Number(s.quantity)
    })
    setStock(sm)
  }, [])

  const loadHistorico = useCallback(async () => {
    const { data } = await supabase.from('frozen_movements').select('*,frozen_products(product_name)').order('created_at',{ascending:false}).limit(100)
    setHistorico(data||[])
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (tab==='historico') loadHistorico() }, [tab, loadHistorico])
  useEffect(() => {
    Promise.all([
      supabase.from('products').select('id,name,unit,category').eq('active', true),
      supabase.from('breads').select('id,name,unit').eq('active', true),
    ]).then(([{data: ps}, {data: bs}]) => {
      const fromProducts: CatalogItem[] = ((ps||[]) as CatalogProductRow[]).map(p => ({ id: p.id, name: p.name, unit: p.unit, category: p.category, _source: 'product' }))
      const fromBreads:   CatalogItem[] = ((bs||[]) as CatalogBreadRow[]).map(b => ({ id: b.id, name: b.name, unit: b.unit, category: BREAD_CATEGORY, _source: 'bread' }))
      setAllProducts([...fromProducts, ...fromBreads].sort((a, b) => a.name.localeCompare(b.name)))
    })
  }, [])

  const openMov = (fp: FrozenProduct) => {
    // Default movLoc = primeiro local visível com saldo > 0 (não o primeiro da lista cego).
    // Isso evita o user dar saída de Freezer Horizontal quando o estoque está no Freezer da Loja.
    const s = stock[fp.id] || {}
    const locWithStock = locsVisible.find(l => (s[l] || 0) > 0)
    setMovFP(fp); setMovType('entrada'); setMovLoc(locWithStock || locsVisible[0] || ''); setMovQty(''); setMovObs('')
  }

  const saveMov = async () => {
    if (!movFP || !movQty || !movLoc) { showToast('Informe quantidade e local'); return }
    const qty = parseFloat(movQty)
    if (isNaN(qty) || qty <= 0) { showToast('Quantidade inválida'); return }
    setSaving(true)
    const cur = stock[movFP.id]?.[movLoc] || 0
    // Pra saída: validar que tem saldo no local selecionado. Sem isso, registrava o
    // movement mas o saldo continuava 0 (max(0, 0-qty)) e o user achava que tinha funcionado.
    if (movType === 'saida' && qty > cur) {
      setSaving(false)
      showToast(`Saldo insuficiente em ${LOCATION_LABELS[movLoc] || movLoc} (atual: ${cur})`)
      return
    }
    const newQty = movType==='inventario' ? qty : movType==='entrada' ? cur+qty : Math.max(0, cur-qty)
    try {
      const { data: ex } = await supabase.from('frozen_stock').select('id, location').eq('frozen_product_id', movFP.id)
      const matching = (ex||[]).find((r:any) => normalizeLocation(r.location) === movLoc)
      if (matching) {
        await supabase.from('frozen_stock').update({ quantity:newQty, location: movLoc, updated_at:new Date().toISOString() }).eq('id', matching.id)
      } else {
        await supabase.from('frozen_stock').insert({ frozen_product_id:movFP.id, location:movLoc, quantity:newQty })
      }
      await supabase.from('frozen_movements').insert({
        frozen_product_id: movFP.id,
        location: movLoc,
        movement_type: movType,
        quantity: movType==='inventario'?newQty:qty,
        previous_quantity: cur,
        obs: movObs||null,
        responsible: user?.displayName || 'desconhecido',
      })
      setStock(prev => ({ ...prev, [movFP.id]: { ...(prev[movFP.id]||{}), [movLoc]: newQty } }))
      showToast(`✅ ${movType==='entrada'?'Entrada':movType==='saida'?'Saída':'Inventário'} registrada`)
      setMovFP(null)
    } catch(e:any) { showToast('Erro: '+e.message) }
    setSaving(false)
  }

  const getTotal = (id: string) => {
    const s = stock[id] || {}
    return locsVisible.reduce((sum, loc) => sum + (s[loc] || 0), 0)
  }

  const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const PAO_KEYWORDS = new Set(['pao', 'paes', 'pão', 'pães'])

  const searchAdmin = (q: string) => {
    setAdminSearch(q)
    const qNorm = normalize(q.trim())
    if (qNorm.length < 2 || PAO_KEYWORDS.has(qNorm)) {
      const allBreads = allProducts.filter(p => p._source === 'bread')
      setAdminResults(allBreads)
      return
    }
    const matching = allProducts.filter(p => normalize(p.name).includes(qNorm))
    const breads = matching.filter(p => p._source === 'bread')
    const prods  = matching.filter(p => p._source === 'product').slice(0, 10)
    setAdminResults([...breads, ...prods])
  }

  async function upsertCatalogProduct(p: CatalogItem, visStores: string[]|null): Promise<string> {
    const { error } = await supabase.from('frozen_products').insert({
      product_id: p.id,
      product_source: p._source,
      product_name: p.name,
      unit: p.unit || 'un',
      active: true,
      visible_stores: visStores,
    })
    if (!error) return '✅ Produto adicionado'
    if ((error as { code?: string }).code !== '23505') return 'Erro: ' + error.message
    const { data: existing, error: selErr } = await supabase
      .from('frozen_products')
      .select('id, visible_stores')
      .eq('product_id', p.id)
      .eq('product_source', p._source)
      .eq('active', true)
      .maybeSingle()
    if (selErr || !existing) return 'Erro ao localizar produto existente'
    const cur = normalizeStores(existing.visible_stores)
    if (cur == null) return '✅ Já cadastrado (visível pra todas as lojas)'
    if (visStores == null) {
      const { error: upErr } = await supabase.from('frozen_products').update({ visible_stores: null }).eq('id', existing.id)
      if (upErr) return 'Erro: ' + upErr.message
      return '✅ Já cadastrado — agora visível pra todas as lojas'
    }
    const next = Array.from(new Set([...cur, ...visStores]))
    const unchanged = next.length === cur.length && next.every(s => cur.includes(s))
    if (unchanged) return '✅ Já cadastrado para sua loja'
    const { error: upErr } = await supabase.from('frozen_products').update({ visible_stores: next }).eq('id', existing.id)
    if (upErr) return 'Erro: ' + upErr.message
    return '✅ Já existia — agora também aparece na sua loja'
  }

  const addFromCatalog = async (p: CatalogItem) => {
    if (addingProduct) return
    setAddingProduct(true)
    const visStores = user?.store ? [user.store] : null
    const msg = await upsertCatalogProduct(p, visStores)
    showToast(msg)
    setAdminSearch(''); setAdminResults([])
    await load()
    setAddingProduct(false)
  }

  const addManual = async () => {
    if (addingProduct) return
    if (!newProdName.trim()) return
    setAddingProduct(true)
    const visStores = user?.store ? [user.store] : null
    const { error } = await supabase.from('frozen_products').insert({ product_name:newProdName, active:true, visible_stores: visStores })
    if (error) showToast('Erro: ' + error.message)
    else { setNewProdName(''); await load(); showToast('✅ Produto adicionado') }
    setAddingProduct(false)
  }

  const isAdmin = !user?.store
  const visibleByStore = (p: FrozenProduct) => isAdmin || !p.visible_stores || p.visible_stores.includes(user?.store ?? '')
  const categoryByCatalogKey = new Map(allProducts.map(p => [`${p._source}:${p.id}`, p.category || UNCATEGORIZED_CATEGORY]))
  const getFrozenCategory = (p: FrozenProduct) => {
    if (p.product_source === 'bread') return BREAD_CATEGORY
    if (!p.product_id || !p.product_source) return UNCATEGORIZED_CATEGORY
    return categoryByCatalogKey.get(`${p.product_source}:${p.product_id}`) || UNCATEGORIZED_CATEGORY
  }

  const canDeleteProduct = (p: FrozenProduct): boolean => {
    if (isAdmin) return true
    if (!user?.store) return false
    return !p.visible_stores || p.visible_stores.includes(user.store)
  }
  const canEditProduct = (p: FrozenProduct): boolean => canDeleteProduct(p)

  const openEdit = (p: FrozenProduct) => {
    setEditFP(p)
    setEditName(p.product_name)
    setEditUnit(p.unit || 'un')
    setEditMinQty(p.min_stock != null ? String(p.min_stock) : '')
    setEditStores(p.visible_stores)
  }

  const saveEdit = async () => {
    if (!editFP) return
    if (!editName.trim()) { showToast('Nome obrigatório'); return }
    const payload: Record<string, unknown> = {
      product_name: editName.trim(),
      unit: editUnit.trim() || 'un',
      min_stock: editMinQty.trim() === '' ? 0 : Number(editMinQty) || 0,
    }
    if (isAdmin) payload.visible_stores = editStores
    const { error } = await supabase.from('frozen_products').update(payload).eq('id', editFP.id)
    if (error) { showToast('Erro: ' + error.message); return }
    showToast('✅ Produto atualizado')
    setEditFP(null); load()
  }

  const deleteFrozenProduct = async (p: FrozenProduct) => {
    const total = getTotal(p.id)
    const isGlobal = !p.visible_stores
    const lines: string[] = []
    if (isGlobal && !isAdmin) {
      lines.push(`⚠️ "${p.product_name}" é GLOBAL — visível pra TODAS as lojas (JC, JA, EX).`)
      lines.push('Remover vai esconder pra todo mundo, não só pra sua loja.')
      lines.push('')
    }
    if (total > 0) {
      lines.push(`"${p.product_name}" ainda tem ${total} unidade(s) em estoque.`)
      lines.push('')
      lines.push('Desativar mesmo assim?')
    } else {
      lines.push(`Desativar "${p.product_name}"?`)
    }
    lines.push('')
    lines.push('(Histórico de movimentações fica preservado.)')
    if (!confirm(lines.join('\n'))) return
    const { error } = await supabase.from('frozen_products').update({ active: false }).eq('id', p.id)
    if (error) { showToast('Erro: ' + error.message); return }
    showToast(`✅ ${p.product_name} removido`)
    load()
  }
  const visibleProducts = products.filter(visibleByStore)
  const categoryOptions = Array.from(new Set(visibleProducts.map(getFrozenCategory)))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const filtered = visibleProducts
    .filter(p => categoryFilter === ALL_CATEGORIES || getFrozenCategory(p) === categoryFilter)
    .filter(p => !search || p.product_name.toLowerCase().includes(search.toLowerCase()))

  function catalogItemState(p: CatalogItem, targetStores: string[]|null): 'new' | 'already-here' | 'add-to-mine' {
    const fp = products.find(fp => fp.product_id === p.id && fp.product_source === p._source)
    if (!fp) return 'new'
    if (fp.visible_stores == null) return 'already-here'
    if (targetStores == null) return 'add-to-mine'
    const missing = targetStores.some(s => !fp.visible_stores!.includes(s))
    return missing ? 'add-to-mine' : 'already-here'
  }

  const canAdd = !!user
  function openAddModal() {
    setAddSearch(''); setAddResults([]); setAddManualName('')
    setAddStores(user?.store ? [user.store] : null)
    setAddOpen(true)
  }
  function toggleAddStore(s: string) {
    const cur = addStores ?? []
    const next = cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s]
    setAddStores(next.length === 0 ? null : next)
  }
  function searchAddCatalog(q: string) {
    setAddSearch(q)
    const qNorm = normalize(q.trim())
    if (qNorm.length < 2 || PAO_KEYWORDS.has(qNorm)) {
      const allBreads = allProducts.filter(p => p._source === 'bread')
      setAddResults(allBreads)
      return
    }
    const matching = allProducts.filter(p => normalize(p.name).includes(qNorm))
    const breads = matching.filter(p => p._source === 'bread')
    const prods  = matching.filter(p => p._source === 'product').slice(0, 10)
    setAddResults([...breads, ...prods])
  }
  async function submitAddFromCatalog(p: CatalogItem) {
    if (addingProduct) return
    setAddingProduct(true)
    const msg = await upsertCatalogProduct(p, addStores)
    showToast(msg)
    setAddOpen(false)
    await load()
    setAddingProduct(false)
  }
  async function submitAddManual() {
    if (addingProduct) return
    if (!addManualName.trim()) return
    setAddingProduct(true)
    const { error } = await supabase.from('frozen_products').insert({
      product_name: addManualName.trim(), active: true, visible_stores: addStores
    })
    if (error) showToast('Erro: '+error.message)
    else { showToast('✅ Produto adicionado'); setAddOpen(false); await load() }
    setAddingProduct(false)
  }

  const userDisplay = user?.displayName || ''
  const categoryChipStyle = (active: boolean) => ({
    padding: '6px 12px',
    background: active ? 'var(--ps-ink)' : 'transparent',
    color: active ? 'var(--cream)' : 'var(--ink-soft)',
    border: `1px solid ${active ? 'var(--ps-ink)' : 'var(--line-soft)'}`,
    borderRadius: 'var(--r-pill)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  })

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <div className="ps-mark">P</div>
            <div className="ps-brand">
              <b>Congelado</b>
              <span>{user?.store ? STORE_LABELS[user.store] || user.store.toUpperCase() : 'Admin · todas lojas'}</span>
            </div>
          </div>
          {user && (
            <div className="ps-userchip">
              <div className="ps-avatar" style={{background: roleColor(user.role)}}>{userDisplay.charAt(0).toUpperCase()}</div>
              <b>{userDisplay}</b>
            </div>
          )}
        </header>

        <div className="ps-pad" style={{marginTop:14}}>
          <div className="ps-tabs" role="tablist">
            {(['estoque','historico','admin'] as const).map(t=>(
              <button key={t} role="tab" aria-selected={tab===t} onClick={()=>setTab(t)} className="ps-tab">
                {t==='estoque'?'📦 Estoque':t==='historico'?'📋 Histórico':'⚙️ Admin'}
              </button>
            ))}
          </div>
        </div>

        <div className="ps-scroll ps-pad">
          {tab==='estoque' && (
            <>
              <div style={{display:'flex', gap:8, marginTop:12, marginBottom:8}}>
                <div style={{flex:1, position:'relative'}}>
                  <Search size={14} style={{position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--ink-faint)', pointerEvents:'none'}}/>
                  <input placeholder="Buscar produto..." value={search} onChange={e=>setSearch(e.target.value)}
                    className="ps-input" style={{width:'100%', padding:'8px 12px 8px 30px', fontSize:13}}/>
                </div>
                {canAdd && (
                  <button onClick={openAddModal} className="ps-btn primary">
                    <Plus size={14}/> Adicionar
                  </button>
                )}
              </div>

              {categoryOptions.length > 0 && (
                <div style={{display:'flex', flexWrap:'wrap', gap:6, marginBottom:14}}>
                  <button type="button" onClick={() => setCategoryFilter(ALL_CATEGORIES)} style={categoryChipStyle(categoryFilter === ALL_CATEGORIES)}>
                    {ALL_CATEGORIES}
                  </button>
                  {categoryOptions.map(category => (
                    <button key={category} type="button" onClick={() => setCategoryFilter(category)} style={categoryChipStyle(categoryFilter === category)}>
                      {category}
                    </button>
                  ))}
                </div>
              )}

              {filtered.length===0 ? (
                <div className="ps-empty">
                  <Snowflake size={36} style={{display:'block', margin:'0 auto 8px', opacity:.4}}/>
                  {products.length===0 ? 'Nenhum produto configurado. Use o Admin para adicionar.' : 'Nenhum resultado.'}
                </div>
              ) : (
                <div style={{display:'flex', flexDirection:'column', gap:10}}>
                  {filtered.map(fp=>{
                    const s = stock[fp.id] || {}
                    const total = getTotal(fp.id)
                    const low = fp.min_stock != null && fp.min_stock > 0 && total < fp.min_stock
                    return (
                      <div key={fp.id} className="ps-card" style={{borderLeft:`4px solid ${low ? 'var(--berry)' : 'var(--ps-line)'}`, cursor:'pointer'}} onClick={()=>openMov(fp)}>
                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10}}>
                          <div style={{flex:1, minWidth:0}}>
                            <div className="ps-pname">
                              {fp.product_name}
                              {fp.visible_stores && fp.visible_stores.length > 0 && fp.visible_stores.map(sk => (
                                <span key={sk} className={`ps-store-chip ${sk}`} style={{marginLeft:6}}>{sk.toUpperCase()}</span>
                              ))}
                            </div>
                            <div style={{display:'flex', gap:6, flexWrap:'wrap', marginTop:2, fontSize:11, color:'var(--ink-faint)'}}>
                              {fp.unit && <span>{fp.unit}</span>}
                              <span>{getFrozenCategory(fp)}</span>
                            </div>
                          </div>
                          <div style={{textAlign:'right'}}>
                            <div style={{fontSize:22, fontWeight:700, color:low?'var(--berry)':'var(--crust)', fontVariantNumeric:'tabular-nums', lineHeight:1.1}}>{total}</div>
                            {fp.min_stock != null && fp.min_stock > 0 && <div style={{fontSize:11, color:'var(--ink-faint)'}}>mín: {fp.min_stock}</div>}
                          </div>
                        </div>
                        <div style={{display:'flex', flexDirection:'column', gap:6, marginTop:4}}>
                          {STORE_ORDER.map(sk => {
                            const locs = locsVisible.filter(l => locStoreKey(l) === sk)
                            if (locs.length === 0) return null
                            return (
                              <div key={sk} style={{display:'flex', gap:5, alignItems:'center', flexWrap:'wrap'}}>
                                {isAdmin && <span className={`ps-store-chip ${sk}`}>{sk.toUpperCase()}</span>}
                                {locs.map(loc=>(
                                  <span key={loc} className={`ps-loc-chip ${sk}`} title={LOCATION_LABELS[loc] || loc}>
                                    {(LOCATION_LABELS[loc] || loc).split(' ')[0]} {s[loc] || 0}
                                  </span>
                                ))}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {tab==='historico' && (
            <div style={{marginTop:12}}>
              {historico.length===0 ? (
                <div className="ps-empty">Nenhuma movimentação.</div>
              ) : (
                <div style={{display:'flex', flexDirection:'column', gap:0}}>
                  {historico
                    .filter(m => {
                      if (!user?.store) return true
                      return locsVisible.includes(normalizeLocation(m.location))
                    })
                    .map(m=>(
                      <div key={m.id} style={{padding:'10px 0', borderBottom:'1px solid var(--line-soft)'}}>
                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:8}}>
                          <span style={{fontWeight:700, fontSize:14, color:'var(--ps-ink)'}}>{m.frozen_products?.product_name||'?'}</span>
                          <span className={`ps-status ${m.movement_type==='entrada'?'entrada':m.movement_type==='saida'?'saida':'ajuste'}`}>
                            {m.movement_type==='entrada'?'+':m.movement_type==='saida'?'−':'='} {m.quantity}
                          </span>
                        </div>
                        <div style={{fontSize:12, color:'var(--ink-faint)', marginTop:2}}>
                          {LOCATION_LABELS[normalizeLocation(m.location)] || m.location} · {new Date(m.created_at).toLocaleDateString('pt-BR')} {new Date(m.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}
                          {m.responsible && ` · ${m.responsible}`}
                          {m.obs && ` · ${m.obs}`}
                        </div>
                      </div>
                    ))
                  }
                </div>
              )}
            </div>
          )}

          {tab==='admin' && !adminAuthed && (
            <div style={{maxWidth:320, margin:'40px auto', textAlign:'center'}}>
              <div style={{fontSize:13, color:'var(--ink-soft)', marginBottom:14}}>
                Confirme seu PIN ({user?.displayName}) para acessar a gestão{user?.store ? ` da loja ${user.store.toUpperCase()}` : ''}.
              </div>
              <input type="password" inputMode="numeric" maxLength={4} placeholder="PIN (4 dígitos)" value={adminPwd}
                onChange={e=>setAdminPwd(e.target.value.replace(/\D/g,''))}
                onKeyDown={e=>e.key==='Enter'&&(adminPwd===user?.pin?setAdminAuthed(true):showToast('PIN incorreto'))}
                className="ps-input" style={{width:'100%', marginBottom:10, textAlign:'center', fontSize:16, padding:'10px 12px'}}/>
              <button className="ps-btn primary block" onClick={()=>adminPwd===user?.pin?setAdminAuthed(true):showToast('PIN incorreto')}>
                Entrar
              </button>
            </div>
          )}

          {tab==='admin' && adminAuthed && (
            <div style={{display:'flex', flexDirection:'column', gap:12, marginTop:12}}>
              <div className="ps-card">
                <div className="ps-flabel">Buscar produto do catálogo</div>
                <div style={{position:'relative'}}>
                  <input placeholder="Digite ou clique pra ver pães..." value={adminSearch}
                    onChange={e=>searchAdmin(e.target.value)} onFocus={()=>searchAdmin(adminSearch)}
                    className="ps-input" style={{width:'100%'}}/>
                  {adminResults.length>0 && (
                    <div style={{position:'absolute', top:'100%', left:0, right:0, background:'var(--cream-raise)', border:'1px solid var(--ps-line)', borderRadius:'0 0 var(--r-ctrl) var(--r-ctrl)', zIndex:50, maxHeight:240, overflowY:'auto', boxShadow:'var(--sh-2)'}}>
                      {adminResults.map(p=>{
                        const st = catalogItemState(p, user?.store ? [user.store] : null)
                        const dim = st === 'already-here'
                        return (
                          <div key={`${p._source}_${p.id}`}
                            onClick={()=>{ if (dim) showToast('Já cadastrado'); else addFromCatalog(p) }}
                            style={{padding:'10px 12px', cursor:dim?'default':'pointer', fontSize:13, borderBottom:'1px solid var(--line-soft)', opacity:dim?.55:1, fontFamily:'var(--font-ui)'}}>
                            {p.name}
                            {p._source === 'bread' && <span className="ps-store-chip jc" style={{marginLeft:6}}>🥖 PÃO</span>}
                            {st === 'already-here' && <span className="ps-store-chip" style={{marginLeft:6, background:'var(--line-soft)', color:'var(--ink-soft)'}}>✓ JÁ CADASTRADO</span>}
                            {st === 'add-to-mine' && <span className="ps-store-chip ex" style={{marginLeft:6}}>+ HABILITAR</span>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="ps-card">
                <div className="ps-flabel">Adicionar manualmente</div>
                <div style={{display:'flex', gap:8}}>
                  <input placeholder="Nome do produto" value={newProdName} onChange={e=>setNewProdName(e.target.value)}
                    className="ps-input" style={{flex:1}}/>
                  <button onClick={addManual} disabled={addingProduct || !newProdName.trim()} className="ps-btn primary">
                    <Plus size={14}/>
                  </button>
                </div>
              </div>

              <div className="ps-card">
                <div className="ps-flabel">Cadastrados ({products.filter(visibleByStore).length}{!isAdmin && user?.store ? ` · ${user.store.toUpperCase()}` : ''})</div>
                {products.filter(visibleByStore).map(p=>(
                  <div key={p.id} style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:'1px solid var(--line-soft)', fontSize:14, gap:8}}>
                    <span style={{flex:1, minWidth:0, fontWeight:600}}>
                      {p.product_name}
                      {p.visible_stores && p.visible_stores.length > 0 && p.visible_stores.map(sk => (
                        <span key={sk} className={`ps-store-chip ${sk}`} style={{marginLeft:6}}>{sk.toUpperCase()}</span>
                      ))}
                    </span>
                    <span style={{color:'var(--ink-faint)', whiteSpace:'nowrap', fontSize:13}}>{getTotal(p.id)} un</span>
                    {canEditProduct(p) && (
                      <button onClick={()=>openEdit(p)} title="Editar" className="ps-iconbtn" style={{width:30, height:30}}>
                        <Pencil size={14}/>
                      </button>
                    )}
                    {canDeleteProduct(p) && (
                      <button onClick={()=>deleteFrozenProduct(p)} title="Excluir" className="ps-iconbtn" style={{width:30, height:30, color:'var(--berry)'}}>
                        <Trash2 size={14}/>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal: Editar produto (centered) */}
      {editFP && (
        <div className="ps-sheet-overlay" style={{alignItems:'center'}} onClick={e=>e.target===e.currentTarget&&setEditFP(null)}>
          <div className="ps-sheet confirm" style={{maxWidth:480, borderRadius:'var(--r-card)'}}>
            <h3><Pencil size={16} style={{verticalAlign:-2, marginRight:6}}/>Editar produto</h3>

            <div className="ps-fieldgroup" style={{marginBottom:10}}>
              <div className="ps-fieldlabel">Nome *</div>
              <input value={editName} onChange={e=>setEditName(e.target.value)} className="ps-input"/>
            </div>

            <div className="ps-fieldrow" style={{marginBottom:10}}>
              <div className="ps-fieldgroup">
                <div className="ps-fieldlabel">Unidade</div>
                <input value={editUnit} onChange={e=>setEditUnit(e.target.value)} placeholder="un / kg / cx" className="ps-input"/>
              </div>
              <div className="ps-fieldgroup">
                <div className="ps-fieldlabel">Estoque mínimo</div>
                <input type="number" min={0} value={editMinQty} onChange={e=>setEditMinQty(e.target.value)} placeholder="0" className="ps-input"/>
              </div>
            </div>

            {isAdmin && (
              <div className="ps-fieldgroup" style={{marginBottom:14}}>
                <div className="ps-fieldlabel">
                  Lojas que veem {!editStores && <span style={{color:'var(--crust)', textTransform:'none', letterSpacing:0}}>(🌐 global)</span>}
                </div>
                <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                  {(['jc','ja','ex'] as const).map(s => {
                    const checked = editStores?.includes(s) ?? false
                    return (
                      <label key={s} style={{display:'flex', alignItems:'center', gap:6, padding:'6px 12px', border:'1px solid var(--ps-line)', borderRadius:8, cursor:'pointer', background: checked ? 'var(--honey-tint)' : 'var(--cream)'}}>
                        <input type="checkbox" checked={checked} onChange={()=>{
                          const cur = editStores ?? []
                          const next = checked ? cur.filter(x=>x!==s) : [...cur, s]
                          setEditStores(next.length === 0 ? null : next)
                        }}/>
                        <span style={{fontWeight:600, fontSize:13}}>{s.toUpperCase()}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="actions">
              <button onClick={saveEdit} className="ps-btn primary">
                <Save size={14}/> Salvar
              </button>
              <button onClick={()=>setEditFP(null)} className="ps-btn ghost">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Adicionar produto (bottom sheet) */}
      {addOpen && (
        <div className="ps-sheet-overlay" onClick={e=>e.target===e.currentTarget&&setAddOpen(false)}>
          <div className="ps-sheet">
            <div className="ps-sheet-grab"/>
            <h3>+ Adicionar produto congelado</h3>
            <p style={{fontSize:12.5, color:'var(--ink-soft)', margin:'0 0 12px'}}>
              {isAdmin
                ? 'Admin: marque as lojas que veem. Sem nenhuma marcada = visível pra todas (global).'
                : `Esse produto vai ser cadastrado para a loja ${(user?.store || '').toUpperCase()} (só vocês veem).`}
            </p>

            {isAdmin && (
              <div style={{marginBottom:12}}>
                <div className="ps-fieldlabel" style={{marginBottom:6}}>
                  Lojas que veem {!addStores && <span style={{color:'var(--crust)', textTransform:'none', letterSpacing:0}}>(🌐 global)</span>}
                </div>
                <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                  {(['jc','ja','ex'] as const).map(s => (
                    <label key={s} style={{display:'flex', alignItems:'center', gap:6, padding:'6px 12px', border:'1px solid var(--ps-line)', borderRadius:8, cursor:'pointer', background: addStores?.includes(s) ? 'var(--honey-tint)' : 'var(--cream)'}}>
                      <input type="checkbox" checked={addStores?.includes(s) ?? false} onChange={()=>toggleAddStore(s)}/>
                      <span style={{fontWeight:600, fontSize:13}}>{s.toUpperCase()}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="ps-fieldgroup" style={{marginBottom:12, position:'relative'}}>
              <div className="ps-fieldlabel">Buscar do catálogo de produtos</div>
              <input placeholder="Digite ou clique pra ver pães..." value={addSearch}
                onChange={e=>searchAddCatalog(e.target.value)} onFocus={()=>searchAddCatalog(addSearch)}
                className="ps-input"/>
              {addResults.length>0 && (
                <div style={{position:'absolute', top:'100%', left:0, right:0, background:'var(--cream-raise)', border:'1px solid var(--ps-line)', borderRadius:'0 0 var(--r-ctrl) var(--r-ctrl)', zIndex:50, maxHeight:240, overflowY:'auto', boxShadow:'var(--sh-2)'}}>
                  {addResults.map(p=>{
                    const st = catalogItemState(p, addStores)
                    const dim = st === 'already-here'
                    return (
                      <div key={`${p._source}_${p.id}`}
                        onClick={()=>{ if (dim) showToast('Já cadastrado'); else submitAddFromCatalog(p) }}
                        style={{padding:'10px 12px', cursor:dim?'default':'pointer', fontSize:13, borderBottom:'1px solid var(--line-soft)', opacity:dim?.55:1, fontFamily:'var(--font-ui)'}}>
                        {p.name}
                        {p._source === 'bread' && <span className="ps-store-chip jc" style={{marginLeft:6}}>🥖 PÃO</span>}
                        {st === 'already-here' && <span className="ps-store-chip" style={{marginLeft:6, background:'var(--line-soft)', color:'var(--ink-soft)'}}>✓ JÁ CADASTRADO</span>}
                        {st === 'add-to-mine' && <span className="ps-store-chip ex" style={{marginLeft:6}}>+ HABILITAR</span>}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div style={{borderTop:'1px dashed var(--ps-line)', paddingTop:12, marginBottom:14}}>
              <div className="ps-fieldlabel" style={{marginBottom:4}}>Ou adicionar manualmente</div>
              <div style={{display:'flex', gap:6}}>
                <input placeholder="Nome do produto" value={addManualName} onChange={e=>setAddManualName(e.target.value)}
                  className="ps-input" style={{flex:1}}/>
                <button onClick={submitAddManual} disabled={addingProduct || !addManualName.trim()} className="ps-btn primary">
                  <Plus size={14}/>
                </button>
              </div>
            </div>

            <button onClick={()=>setAddOpen(false)} className="ps-btn ghost block">Cancelar</button>
          </div>
        </div>
      )}

      {/* Modal: Movimentação (bottom sheet) */}
      {movFP && (
        <div className="ps-sheet-overlay" onClick={e=>e.target===e.currentTarget&&setMovFP(null)}>
          <div className="ps-sheet">
            <div className="ps-sheet-grab"/>
            <h3>{movFP.product_name}</h3>
            <p style={{color:'var(--ink-soft)', fontSize:13, margin:'0 0 16px'}}>Total: <b style={{color:'var(--ps-ink)'}}>{getTotal(movFP.id)}</b> {movFP.unit||''}</p>

            <div className="ps-segments" style={{marginBottom:12, width:'100%'}}>
              {(['entrada','saida','inventario'] as const).map(t=>(
                <button key={t} onClick={()=>setMovType(t)} className={`ps-seg ${movType===t?'active':''}`} style={{flex:1}}>
                  {t==='entrada'?'+ Entrada':t==='saida'?'− Saída':'= Inventário'}
                </button>
              ))}
            </div>

            <div className="ps-fieldgroup" style={{marginBottom:10}}>
              <div className="ps-fieldlabel">Local</div>
              <select value={movLoc} onChange={e=>setMovLoc(e.target.value)} className="ps-select">
                {locsVisible.map(loc=>{
                  const q = stock[movFP.id]?.[loc] || 0
                  return <option key={loc} value={loc}>{LOCATION_LABELS[loc] || loc} · {q}</option>
                })}
              </select>
              {movLoc && (
                <div style={{fontSize:12, color:'var(--ink-faint)', marginTop:4}}>
                  Saldo atual neste local: <b style={{color:'var(--ps-ink)'}}>{stock[movFP.id]?.[movLoc] || 0}</b>
                </div>
              )}
            </div>

            <div className="ps-fieldgroup" style={{marginBottom:10}}>
              <div className="ps-fieldlabel">Quantidade</div>
              <input type="number" min={0} step="any" value={movQty} onChange={e=>setMovQty(e.target.value)} placeholder="0"
                className="ps-input" style={{fontSize:16}}/>
            </div>

            <div className="ps-fieldgroup" style={{marginBottom:14}}>
              <div className="ps-fieldlabel">Observação (opcional)</div>
              <input type="text" value={movObs} onChange={e=>setMovObs(e.target.value)} placeholder="ex: validade próxima" className="ps-input"/>
            </div>

            <div className="actions" style={{display:'flex', gap:10}}>
              <button onClick={saveMov} disabled={saving} className="ps-btn success" style={{flex:1}}>
                {saving ? 'Salvando...' : (<><Save size={14}/> Salvar</>)}
              </button>
              <button onClick={()=>setMovFP(null)} className="ps-btn ghost">
                <X size={14}/> Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
