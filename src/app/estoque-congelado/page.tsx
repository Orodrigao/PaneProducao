'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser } from '@/lib/auth'
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

// Cor por loja pra distinguir os badges de freezer quando admin vê os 8 locais juntos.
const STORE_COLORS: Record<string, { chipBg:string, chipFg:string, locBg:string }> = {
  jc: { chipBg:'#dbeafe', chipFg:'#1e40af', locBg:'#eff6ff' }, // azul
  ja: { chipBg:'#d1fae5', chipFg:'#065f46', locBg:'#ecfdf5' }, // verde
  ex: { chipBg:'#fed7aa', chipFg:'#9a3412', locBg:'#fff7ed' }, // laranja
}

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
  const [user, setUser]         = useState<{displayName:string; store:string|null; pin:string}|null>(null)
  const [products, setProducts] = useState<FrozenProduct[]>([])
  const [stock, setStock]       = useState<StockMap>({})
  const [search, setSearch]     = useState('')
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
  type CatalogItem = { id: string; name: string; unit: string|null; _source: 'product'|'bread' }
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
  const [addStores, setAddStores] = useState<string[]|null>(null) // null = global; ['jc','ja'] = múltiplas
  // Editar produto cadastrado (nome, unit, min_stock, visible_stores se admin)
  const [editFP, setEditFP] = useState<FrozenProduct|null>(null)
  const [editName, setEditName] = useState('')
  const [editUnit, setEditUnit] = useState('')
  const [editMinQty, setEditMinQty] = useState('')
  const [editStores, setEditStores] = useState<string[]|null>(null)

  useEffect(() => {
    const u = getCurrentUser()
    if (u) setUser({ displayName: u.displayName, store: u.store ?? null, pin: u.pin })
  }, [])

  const locsVisible = visibleLocations(user?.store ?? null)

  const load = useCallback(async () => {
    const [{ data: fps }, { data: ss }] = await Promise.all([
      supabase.from('frozen_products').select('*').eq('active', true).order('product_name'),
      supabase.from('frozen_stock').select('*'),
    ])
    // Normaliza visible_stores (aceita legacy string ou novo array)
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
    // Catálogo = products + breads (eles congelam pão também). Source vira product_source no insert.
    Promise.all([
      supabase.from('products').select('id,name,unit').eq('active', true),
      supabase.from('breads').select('id,name,unit').eq('active', true),
    ]).then(([{data: ps}, {data: bs}]) => {
      const fromProducts: CatalogItem[] = (ps||[]).map((p:any) => ({ id: p.id, name: p.name, unit: p.unit, _source: 'product' }))
      const fromBreads:   CatalogItem[] = (bs||[]).map((b:any) => ({ id: b.id, name: b.name, unit: b.unit, _source: 'bread' }))
      setAllProducts([...fromProducts, ...fromBreads].sort((a, b) => a.name.localeCompare(b.name)))
    })
  }, [])

  const openMov = (fp: FrozenProduct) => {
    setMovFP(fp); setMovType('entrada'); setMovLoc(locsVisible[0] || ''); setMovQty(''); setMovObs('')
  }

  const saveMov = async () => {
    if (!movFP || !movQty || !movLoc) { showToast('Informe quantidade e local'); return }
    const qty = parseFloat(movQty)
    if (isNaN(qty) || qty <= 0) { showToast('Quantidade inválida'); return }
    setSaving(true)
    const cur = stock[movFP.id]?.[movLoc] || 0
    const newQty = movType==='inventario' ? qty : movType==='entrada' ? cur+qty : Math.max(0, cur-qty)
    try {
      // Sempre escreve no NOME NOVO; busca ambos os formatos pra UPDATE retro-compat
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
    // Total visível pro usuário (não conta lojas que ele não vê)
    return locsVisible.reduce((sum, loc) => sum + (s[loc] || 0), 0)
  }

  // Normaliza removendo acentos pra busca "pao" casar com "Pão"
  const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  // Categoria conceitual: 'pao'/'pães'/etc → mostra TODOS os breads (Ciabatta, Brioche são pão tb)
  const PAO_KEYWORDS = new Set(['pao', 'paes', 'pão', 'pães'])

  const searchAdmin = (q: string) => {
    setAdminSearch(q)
    const qNorm = normalize(q.trim())
    // Vazio ou termo de categoria "pão" → todos breads ativos
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

  // Tenta inserir produto do catálogo. Se já existir (índice único product_id+product_source ativo)
  // mescla a loja em visible_stores ao invés de criar duplicata.
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
    // Já existe ativo: busca a linha e mescla visible_stores
    const { data: existing, error: selErr } = await supabase
      .from('frozen_products')
      .select('id, visible_stores')
      .eq('product_id', p.id)
      .eq('product_source', p._source)
      .eq('active', true)
      .maybeSingle()
    if (selErr || !existing) return 'Erro ao localizar produto existente'
    const cur = normalizeStores(existing.visible_stores)
    // Já global → não muda nada
    if (cur == null) return '✅ Já cadastrado (visível pra todas as lojas)'
    // Novo cadastro pede global → torna global
    if (visStores == null) {
      const { error: upErr } = await supabase.from('frozen_products').update({ visible_stores: null }).eq('id', existing.id)
      if (upErr) return 'Erro: ' + upErr.message
      return '✅ Já cadastrado — agora visível pra todas as lojas'
    }
    // Mescla
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
    // user com store → produto fica visível só pra loja dele; admin → global
    const visStores = user?.store ? [user.store] : null
    const { error } = await supabase.from('frozen_products').insert({ product_name:newProdName, active:true, visible_stores: visStores })
    if (error) showToast('Erro: ' + error.message)
    else { setNewProdName(''); await load(); showToast('✅ Produto adicionado') }
    setAddingProduct(false)
  }

  // Admin (sem store) vê tudo. Outros veem produtos globais + onde a loja deles aparece em visible_stores.
  const isAdmin = !user?.store
  const visibleByStore = (p: FrozenProduct) => isAdmin || !p.visible_stores || p.visible_stores.includes(user?.store ?? '')

  // Permissão de excluir: admin pode tudo; user com store pode excluir qualquer
  // produto que ele enxerga (incluindo globais). Globais ganham confirm extra
  // em deleteFrozenProduct avisando que afeta todas as lojas. Soft delete = recuperável.
  const canDeleteProduct = (p: FrozenProduct): boolean => {
    if (isAdmin) return true
    if (!user?.store) return false
    return !p.visible_stores || p.visible_stores.includes(user.store)
  }

  // Editar: admin pode tudo; user com store pode editar produtos da loja DELE (single-store)
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
    // Só admin pode mexer em visible_stores (user com store fica travado na loja dele)
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
  const filtered = products
    .filter(visibleByStore)
    .filter(p => !search || p.product_name.toLowerCase().includes(search.toLowerCase()))

  // Estado de cada item do catálogo (na busca) frente ao que já está cadastrado.
  // 'new' = ainda não existe; 'add-to-mine' = existe mas não pra esta loja-alvo;
  // 'already-here' = já existe pra esta loja-alvo (ou é global).
  function catalogItemState(p: CatalogItem, targetStores: string[]|null): 'new' | 'already-here' | 'add-to-mine' {
    const fp = products.find(fp => fp.product_id === p.id && fp.product_source === p._source)
    if (!fp) return 'new'
    if (fp.visible_stores == null) return 'already-here' // global
    if (targetStores == null) return 'add-to-mine' // admin tornando global
    const missing = targetStores.some(s => !fp.visible_stores!.includes(s))
    return missing ? 'add-to-mine' : 'already-here'
  }

  // Quem pode adicionar produtos: qualquer user com store + admins
  const canAdd = !!user
  function openAddModal() {
    setAddSearch(''); setAddResults([]); setAddManualName('')
    setAddStores(user?.store ? [user.store] : null) // user com store → só a loja dele; admin → global por default
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

  return (
    <div style={{maxWidth:600,margin:'0 auto'}}>
      <div style={{background:'var(--primary)',color:'white',padding:'14px 16px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <span style={{fontWeight:700}}>❄️ Estoque Congelado</span>
        <span style={{fontSize:'.85rem',opacity:.8}}>
          {user?.displayName || ''}
          {user?.store ? ` · ${STORE_LABELS[user.store] || user.store.toUpperCase()}` : ' · (admin: todas lojas)'}
        </span>
      </div>

      <div style={{display:'flex',borderBottom:'2px solid var(--border)'}}>
        {(['estoque','historico','admin'] as const).map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:'10px',border:'none',background:'none',cursor:'pointer',fontWeight:tab===t?700:400,color:tab===t?'var(--primary)':'var(--muted)',borderBottom:tab===t?'2px solid var(--primary)':'2px solid transparent',marginBottom:-2,fontSize:'.88rem'}}>
            {t==='estoque'?'📦 Estoque':t==='historico'?'📋 Histórico':'⚙️ Admin'}
          </button>
        ))}
      </div>

      <div style={{padding:16}}>
        {tab==='estoque' && (
          <>
            <div style={{display:'flex',gap:8,marginBottom:12}}>
              <input placeholder="🔍 Buscar produto..." value={search} onChange={e=>setSearch(e.target.value)}
                style={{flex:1,padding:'9px 12px',border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem'}}/>
              {canAdd && (
                <button onClick={openAddModal}
                  style={{padding:'9px 14px',background:'var(--primary)',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:'.85rem',fontWeight:700,whiteSpace:'nowrap'}}>
                  + Adicionar
                </button>
              )}
            </div>
            {filtered.length===0 ? (
              <div style={{textAlign:'center',padding:40,color:'var(--muted)'}}>
                {products.length===0?'Nenhum produto configurado. Use o Admin para adicionar.':'Nenhum resultado.'}
              </div>
            ) : filtered.map(fp=>{
              const s = stock[fp.id] || {}
              const total = getTotal(fp.id)
              const low = fp.min_stock && total < fp.min_stock
              return (
                <div key={fp.id} className="card" style={{borderLeft:`4px solid ${low?'var(--danger)':'var(--border)'}`,cursor:'pointer'}} onClick={()=>openMov(fp)}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:'.95rem'}}>
                        {fp.product_name}
                        {fp.visible_stores && fp.visible_stores.length > 0 && (
                          <span style={{marginLeft:6,background:'#dbeafe',color:'#1e40af',padding:'2px 6px',borderRadius:4,fontSize:'.65rem',fontWeight:700}}>
                            🏪 {fp.visible_stores.map(s => s.toUpperCase()).join(', ')}
                          </span>
                        )}
                      </div>
                      {fp.unit && <div style={{fontSize:'.75rem',color:'var(--muted)'}}>{fp.unit}</div>}
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontWeight:700,fontSize:'1.1rem',color:low?'var(--danger)':'var(--primary)'}}>{total}</div>
                      {fp.min_stock != null && fp.min_stock > 0 && <div style={{fontSize:'.72rem',color:'var(--muted)'}}>mín: {fp.min_stock}</div>}
                    </div>
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:4}}>
                    {STORE_ORDER.map(sk => {
                      const locs = locsVisible.filter(l => locStoreKey(l) === sk)
                      if (locs.length === 0) return null
                      const c = STORE_COLORS[sk]
                      return (
                        <div key={sk} style={{display:'flex',gap:4,alignItems:'center',flexWrap:'wrap'}}>
                          {isAdmin && (
                            <span style={{fontSize:'.62rem',fontWeight:700,padding:'2px 6px',background:c.chipBg,color:c.chipFg,borderRadius:4,letterSpacing:'.5px'}}>
                              {sk.toUpperCase()}
                            </span>
                          )}
                          {locs.map(loc=>(
                            <span key={loc} title={LOCATION_LABELS[loc] || loc} style={{fontSize:'.75rem',padding:'2px 8px',background:c.locBg,borderRadius:20,border:`1px solid ${c.chipBg}`}}>
                              {(LOCATION_LABELS[loc] || loc).split(' ')[0]} {s[loc]||0}
                            </span>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </>
        )}

        {tab==='historico' && (
          <>
            {historico.length===0 ? <div style={{textAlign:'center',padding:40,color:'var(--muted)'}}>Nenhuma movimentação.</div> :
              historico
                .filter(m => {
                  // Filtra histórico pra mostrar só locais visíveis (admin vê tudo)
                  if (!user?.store) return true
                  return locsVisible.includes(normalizeLocation(m.location))
                })
                .map(m=>(
                <div key={m.id} style={{padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <span style={{fontWeight:600,fontSize:'.9rem'}}>{m.frozen_products?.product_name||'?'}</span>
                    <span style={{fontSize:'.78rem',fontWeight:700,color:m.movement_type==='entrada'?'var(--success)':m.movement_type==='saida'?'var(--danger)':'var(--primary)'}}>
                      {m.movement_type==='entrada'?'+ Entrada':m.movement_type==='saida'?'- Saída':'= Inventário'} {m.quantity}
                    </span>
                  </div>
                  <div style={{fontSize:'.75rem',color:'var(--muted)'}}>
                    {LOCATION_LABELS[normalizeLocation(m.location)] || m.location} · {new Date(m.created_at).toLocaleDateString('pt-BR')} {new Date(m.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}
                    {m.responsible && ` · ${m.responsible}`}
                    {m.obs && ` · ${m.obs}`}
                  </div>
                </div>
              ))
            }
          </>
        )}

        {tab==='admin' && !adminAuthed && (
          <div style={{maxWidth:300,margin:'40px auto',textAlign:'center'}}>
            <div style={{fontSize:'.85rem',color:'var(--muted)',marginBottom:10}}>
              Confirme seu PIN ({user?.displayName}) para acessar a gestão{user?.store ? ` da loja ${user.store.toUpperCase()}` : ''}.
            </div>
            <input type="password" inputMode="numeric" maxLength={4} placeholder="PIN (4 dígitos)" value={adminPwd}
              onChange={e=>setAdminPwd(e.target.value.replace(/\D/g,''))}
              onKeyDown={e=>e.key==='Enter'&&(adminPwd===user?.pin?setAdminAuthed(true):showToast('PIN incorreto'))}
              style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,marginBottom:8,fontSize:'1rem',textAlign:'center'}}/>
            <button className="btn btn-primary btn-full" onClick={()=>adminPwd===user?.pin?setAdminAuthed(true):showToast('PIN incorreto')}>Entrar</button>
          </div>
        )}

        {tab==='admin' && adminAuthed && (
          <>
            <div className="card">
              <div className="card-title">Buscar produto do catálogo</div>
              <div style={{position:'relative'}}>
                <input placeholder="Digite ou clique pra ver pães..." value={adminSearch}
                  onChange={e=>searchAdmin(e.target.value)} onFocus={()=>searchAdmin(adminSearch)}
                  style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem'}}/>
                {adminResults.length>0 && (
                  <div style={{position:'absolute',top:'100%',left:0,right:0,background:'white',border:'1px solid var(--border)',borderRadius:'0 0 8px 8px',zIndex:50,maxHeight:200,overflowY:'auto'}}>
                    {adminResults.map(p=>{
                      const st = catalogItemState(p, user?.store ? [user.store] : null)
                      const dim = st === 'already-here'
                      return (
                        <div key={`${p._source}_${p.id}`}
                          onClick={()=>{ if (dim) showToast('Já cadastrado'); else addFromCatalog(p) }}
                          style={{padding:'9px 12px',cursor:dim?'default':'pointer',fontSize:'.88rem',borderBottom:'1px solid var(--border)',opacity:dim?.55:1}}>
                          {p.name}
                          {p._source === 'bread' && <span style={{marginLeft:6,background:'#fef3c7',color:'#92400e',padding:'1px 6px',borderRadius:3,fontSize:'.62rem',fontWeight:700}}>🥖 PÃO</span>}
                          {st === 'already-here' && <span style={{marginLeft:6,background:'#e5e7eb',color:'#374151',padding:'1px 6px',borderRadius:3,fontSize:'.62rem',fontWeight:700}}>✓ JÁ CADASTRADO</span>}
                          {st === 'add-to-mine' && <span style={{marginLeft:6,background:'#fed7aa',color:'#9a3412',padding:'1px 6px',borderRadius:3,fontSize:'.62rem',fontWeight:700}}>+ HABILITAR</span>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="card">
              <div className="card-title">Adicionar manualmente</div>
              <div style={{display:'flex',gap:6}}>
                <input placeholder="Nome do produto" value={newProdName} onChange={e=>setNewProdName(e.target.value)}
                  style={{flex:1,padding:8,border:'1.5px solid var(--border)',borderRadius:6,fontSize:'.85rem'}}/>
                <button onClick={addManual} disabled={addingProduct || !newProdName.trim()} style={{padding:'8px 12px',background:'var(--primary)',color:'white',border:'none',borderRadius:6,cursor:addingProduct?'wait':'pointer',opacity:(addingProduct||!newProdName.trim())?.5:1}}>+</button>
              </div>
            </div>
            <div className="card">
              <div className="card-title">Cadastrados ({products.filter(visibleByStore).length}{!isAdmin && user?.store ? ` · ${user.store.toUpperCase()}` : ''})</div>
              {products.filter(visibleByStore).map(p=>(
                <div key={p.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 0',borderBottom:'1px solid var(--border)',fontSize:'.88rem',gap:8}}>
                  <span style={{flex:1,minWidth:0}}>
                    {p.product_name}
                    {p.visible_stores && p.visible_stores.length > 0 && (
                      <span style={{marginLeft:6,background:'#dbeafe',color:'#1e40af',padding:'1px 5px',borderRadius:3,fontSize:'.62rem',fontWeight:700}}>
                        {p.visible_stores.map(s => s.toUpperCase()).join(', ')}
                      </span>
                    )}
                  </span>
                  <span style={{color:'var(--muted)',whiteSpace:'nowrap'}}>{getTotal(p.id)} unid.</span>
                  {canEditProduct(p) && (
                    <button onClick={()=>openEdit(p)} title="Editar"
                      style={{background:'none',border:'none',cursor:'pointer',padding:'4px 6px',fontSize:'1rem',lineHeight:1}}>
                      ✏️
                    </button>
                  )}
                  {canDeleteProduct(p) && (
                    <button onClick={()=>deleteFrozenProduct(p)} title="Excluir"
                      style={{background:'none',border:'none',cursor:'pointer',padding:'4px 6px',fontSize:'1rem',color:'#dc2626',lineHeight:1}}>
                      🗑
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Modal: Editar produto */}
      {editFP && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:16}}
             onClick={e=>e.target===e.currentTarget&&setEditFP(null)}>
          <div style={{background:'white',borderRadius:12,padding:20,maxWidth:480,width:'100%',maxHeight:'90vh',overflowY:'auto'}}>
            <div style={{fontWeight:700,fontSize:'1.05rem',marginBottom:14}}>✏️ Editar produto</div>

            <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600}}>Nome *</label>
            <input value={editName} onChange={e=>setEditName(e.target.value)}
              style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem',marginBottom:10}}/>

            <div style={{display:'flex',gap:10,marginBottom:10}}>
              <div style={{flex:1}}>
                <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600}}>Unidade</label>
                <input value={editUnit} onChange={e=>setEditUnit(e.target.value)}
                  placeholder="un / kg / cx"
                  style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem'}}/>
              </div>
              <div style={{flex:1}}>
                <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600}}>Estoque mínimo</label>
                <input type="number" min={0} value={editMinQty} onChange={e=>setEditMinQty(e.target.value)}
                  placeholder="0"
                  style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem'}}/>
              </div>
            </div>

            {isAdmin && (
              <>
                <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:6,fontWeight:600}}>
                  Lojas que veem {!editStores && <span style={{color:'var(--primary)'}}>(🌐 global)</span>}
                </label>
                <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
                  {(['jc','ja','ex'] as const).map(s => {
                    const checked = editStores?.includes(s) ?? false
                    return (
                      <label key={s} style={{display:'flex',alignItems:'center',gap:6,padding:'6px 12px',border:'1.5px solid var(--border)',borderRadius:8,cursor:'pointer',background: checked ? '#dbeafe' : 'white'}}>
                        <input type="checkbox" checked={checked} onChange={()=>{
                          const cur = editStores ?? []
                          const next = checked ? cur.filter(x=>x!==s) : [...cur, s]
                          setEditStores(next.length === 0 ? null : next)
                        }}/>
                        <span style={{fontWeight:600,fontSize:'.85rem'}}>{s.toUpperCase()}</span>
                      </label>
                    )
                  })}
                </div>
              </>
            )}

            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setEditFP(null)}
                style={{padding:'10px 16px',background:'white',border:'1.5px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:'.88rem',fontWeight:600}}>
                Cancelar
              </button>
              <button onClick={saveEdit}
                style={{padding:'10px 18px',background:'var(--primary)',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:'.88rem',fontWeight:700}}>
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Adicionar produto (qualquer user com store) */}
      {addOpen && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',display:'flex',alignItems:'flex-end',zIndex:200}} onClick={e=>e.target===e.currentTarget&&setAddOpen(false)}>
          <div style={{background:'white',width:'100%',borderRadius:'12px 12px 0 0',padding:20,maxHeight:'85vh',overflowY:'auto'}}>
            <div style={{fontWeight:700,marginBottom:4,fontSize:'1rem'}}>+ Adicionar produto congelado</div>
            <div style={{fontSize:'.78rem',color:'var(--muted)',marginBottom:12}}>
              {isAdmin
                ? 'Admin: marque as lojas que veem. Sem nenhuma marcada = visível pra todas (global).'
                : `Esse produto vai ser cadastrado para a loja ${(user?.store || '').toUpperCase()} (só vocês veem).`}
            </div>

            {isAdmin && (
              <>
                <label style={{fontSize:'.8rem',color:'var(--muted)',display:'block',marginBottom:6}}>
                  Lojas que veem {!addStores && <span style={{color:'var(--primary)'}}>(🌐 global)</span>}
                </label>
                <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
                  {(['jc','ja','ex'] as const).map(s => (
                    <label key={s} style={{display:'flex',alignItems:'center',gap:6,padding:'6px 12px',border:'1.5px solid var(--border)',borderRadius:8,cursor:'pointer',background: (addStores?.includes(s) ? '#dbeafe' : 'white')}}>
                      <input type="checkbox" checked={addStores?.includes(s) ?? false} onChange={()=>toggleAddStore(s)}/>
                      <span style={{fontWeight:600,fontSize:'.85rem'}}>{s.toUpperCase()}</span>
                    </label>
                  ))}
                </div>
              </>
            )}

            <label style={{fontSize:'.8rem',color:'var(--muted)',display:'block',marginBottom:4}}>Buscar do catálogo de produtos</label>
            <div style={{position:'relative',marginBottom:12}}>
              <input placeholder="Digite ou clique pra ver pães..." value={addSearch}
                onChange={e=>searchAddCatalog(e.target.value)} onFocus={()=>searchAddCatalog(addSearch)}
                style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem'}}/>
              {addResults.length>0 && (
                <div style={{position:'absolute',top:'100%',left:0,right:0,background:'white',border:'1px solid var(--border)',borderRadius:'0 0 8px 8px',zIndex:50,maxHeight:200,overflowY:'auto'}}>
                  {addResults.map(p=>{
                    const st = catalogItemState(p, addStores)
                    const dim = st === 'already-here'
                    return (
                      <div key={`${p._source}_${p.id}`}
                        onClick={()=>{ if (dim) showToast('Já cadastrado'); else submitAddFromCatalog(p) }}
                        style={{padding:'9px 12px',cursor:dim?'default':'pointer',fontSize:'.88rem',borderBottom:'1px solid var(--border)',opacity:dim?.55:1}}>
                        {p.name}
                        {p._source === 'bread' && <span style={{marginLeft:6,background:'#fef3c7',color:'#92400e',padding:'1px 6px',borderRadius:3,fontSize:'.62rem',fontWeight:700}}>🥖 PÃO</span>}
                        {st === 'already-here' && <span style={{marginLeft:6,background:'#e5e7eb',color:'#374151',padding:'1px 6px',borderRadius:3,fontSize:'.62rem',fontWeight:700}}>✓ JÁ CADASTRADO</span>}
                        {st === 'add-to-mine' && <span style={{marginLeft:6,background:'#fed7aa',color:'#9a3412',padding:'1px 6px',borderRadius:3,fontSize:'.62rem',fontWeight:700}}>+ HABILITAR</span>}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div style={{borderTop:'1px dashed var(--border)',paddingTop:12,marginBottom:14}}>
              <label style={{fontSize:'.8rem',color:'var(--muted)',display:'block',marginBottom:4}}>Ou adicionar manualmente</label>
              <div style={{display:'flex',gap:6}}>
                <input placeholder="Nome do produto" value={addManualName} onChange={e=>setAddManualName(e.target.value)}
                  style={{flex:1,padding:8,border:'1.5px solid var(--border)',borderRadius:6,fontSize:'.9rem'}}/>
                <button onClick={submitAddManual} disabled={addingProduct || !addManualName.trim()}
                  style={{padding:'8px 14px',background:'var(--primary)',color:'white',border:'none',borderRadius:6,cursor:addingProduct?'wait':(addManualName.trim()?'pointer':'default'),opacity:(addingProduct||!addManualName.trim())?.5:1,fontWeight:600}}>+</button>
              </div>
            </div>

            <button className="btn btn-ghost btn-full" onClick={()=>setAddOpen(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {movFP && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',display:'flex',alignItems:'flex-end',zIndex:200}} onClick={e=>e.target===e.currentTarget&&setMovFP(null)}>
          <div style={{background:'white',width:'100%',borderRadius:'12px 12px 0 0',padding:20,maxHeight:'80vh',overflowY:'auto'}}>
            <div style={{fontWeight:700,marginBottom:4,fontSize:'1rem'}}>{movFP.product_name}</div>
            <div style={{color:'var(--muted)',fontSize:'.8rem',marginBottom:16}}>Total: {getTotal(movFP.id)} {movFP.unit||''}</div>

            <div style={{display:'flex',gap:6,marginBottom:12}}>
              {(['entrada','saida','inventario'] as const).map(t=>(
                <button key={t} onClick={()=>setMovType(t)} style={{flex:1,padding:'8px',borderRadius:6,border:`1.5px solid ${movType===t?'var(--primary)':'var(--border)'}`,background:movType===t?'var(--primary)':'white',color:movType===t?'white':'var(--text)',fontWeight:600,cursor:'pointer',fontSize:'.85rem'}}>
                  {t==='entrada'?'+ Entrada':t==='saida'?'- Saída':'= Inventário'}
                </button>
              ))}
            </div>

            <label style={{fontSize:'.8rem',color:'var(--muted)',display:'block',marginBottom:4}}>Local</label>
            <select value={movLoc} onChange={e=>setMovLoc(e.target.value)} style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,marginBottom:12,fontSize:'.9rem'}}>
              {locsVisible.map(loc=><option key={loc} value={loc}>{LOCATION_LABELS[loc] || loc}</option>)}
            </select>

            <label style={{fontSize:'.8rem',color:'var(--muted)',display:'block',marginBottom:4}}>Quantidade</label>
            <input type="number" min={0} step="any" value={movQty} onChange={e=>setMovQty(e.target.value)} placeholder="0"
              style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,marginBottom:12,fontSize:'.95rem'}}/>

            <label style={{fontSize:'.8rem',color:'var(--muted)',display:'block',marginBottom:4}}>Observação (opcional)</label>
            <input type="text" value={movObs} onChange={e=>setMovObs(e.target.value)} placeholder="ex: validade próxima"
              style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,marginBottom:16,fontSize:'.9rem'}}/>

            <div style={{display:'flex',gap:8}}>
              <button className="btn btn-success" style={{flex:1}} onClick={saveMov} disabled={saving}>{saving?'Salvando...':'💾 Salvar'}</button>
              <button className="btn btn-ghost" onClick={()=>setMovFP(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
