'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser } from '@/lib/auth'
import { showToast } from '@/lib/utils'

const ADMIN_PWD = 'pane2025'

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

interface FrozenProduct { id:string; product_name:string; unit:string|null; min_qty:number|null; active:boolean; store: string|null }
interface StockMap { [fpId: string]: Record<string, number> }

export default function EstoqueCongeladoPage() {
  const [user, setUser]         = useState<{displayName:string; store:string|null}|null>(null)
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
  const [allProducts, setAllProducts] = useState<any[]>([])
  const [adminSearch, setAdminSearch] = useState('')
  const [adminResults, setAdminResults] = useState<any[]>([])
  const [newProdName, setNewProdName] = useState('')
  // Modal "+ Adicionar produto" pra qualquer user com store (sem senha admin)
  const [addOpen, setAddOpen]         = useState(false)
  const [addSearch, setAddSearch]     = useState('')
  const [addResults, setAddResults]   = useState<any[]>([])
  const [addManualName, setAddManualName] = useState('')
  const [addStoreChoice, setAddStoreChoice] = useState<string|null>(null) // null = global

  useEffect(() => {
    const u = getCurrentUser()
    if (u) setUser({ displayName: u.displayName, store: u.store ?? null })
  }, [])

  const locsVisible = visibleLocations(user?.store ?? null)

  const load = useCallback(async () => {
    const [{ data: fps }, { data: ss }] = await Promise.all([
      supabase.from('frozen_products').select('*').eq('active', true).order('product_name'),
      supabase.from('frozen_stock').select('*'),
    ])
    setProducts(fps||[])
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
    supabase.from('products').select('id,name,unit').eq('active',true).order('name').then(({data})=>setAllProducts(data||[]))
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

  const searchAdmin = (q: string) => {
    setAdminSearch(q)
    if (q.length < 2) { setAdminResults([]); return }
    const existing = new Set(products.map(p=>p.product_name.toLowerCase()))
    setAdminResults(allProducts.filter(p=>!existing.has(p.name.toLowerCase())&&p.name.toLowerCase().includes(q.toLowerCase())).slice(0,8))
  }

  const addFromCatalog = async (p: any) => {
    const { error } = await supabase.from('frozen_products').insert({ product_id:p.id, product_name:p.name, unit:p.unit||null, active:true })
    if (!error) { showToast('✅ Produto adicionado'); setAdminSearch(''); setAdminResults([]); load() }
    else showToast('Erro: '+error.message)
  }

  const addManual = async () => {
    if (!newProdName.trim()) return
    await supabase.from('frozen_products').insert({ product_name:newProdName, active:true })
    setNewProdName(''); load(); showToast('✅ Produto adicionado')
  }

  // Admin (sem store) vê tudo. Outros veem produtos globais + da loja deles.
  const isAdmin = !user?.store
  const visibleByStore = (p: FrozenProduct) => isAdmin || !p.store || p.store === user?.store
  const filtered = products
    .filter(visibleByStore)
    .filter(p => !search || p.product_name.toLowerCase().includes(search.toLowerCase()))

  // Quem pode adicionar produtos: qualquer user com store + admins
  const canAdd = !!user
  function openAddModal() {
    setAddSearch(''); setAddResults([]); setAddManualName('')
    setAddStoreChoice(user?.store ?? null) // user com store → pré-fixado; admin → "global" como default
    setAddOpen(true)
  }
  function searchAddCatalog(q: string) {
    setAddSearch(q)
    if (q.length < 2) { setAddResults([]); return }
    const existing = new Set(products.map(p => p.product_name.toLowerCase()))
    setAddResults(allProducts.filter(p => !existing.has(p.name.toLowerCase()) && p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8))
  }
  async function submitAddFromCatalog(p: any) {
    const { error } = await supabase.from('frozen_products').insert({
      product_id: p.id, product_name: p.name, unit: p.unit || null, active: true, store: addStoreChoice
    })
    if (error) { showToast('Erro: '+error.message); return }
    showToast('✅ Produto adicionado')
    setAddOpen(false); load()
  }
  async function submitAddManual() {
    if (!addManualName.trim()) return
    const { error } = await supabase.from('frozen_products').insert({
      product_name: addManualName.trim(), active: true, store: addStoreChoice
    })
    if (error) { showToast('Erro: '+error.message); return }
    showToast('✅ Produto adicionado')
    setAddOpen(false); load()
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
              const low = fp.min_qty && total < fp.min_qty
              return (
                <div key={fp.id} className="card" style={{borderLeft:`4px solid ${low?'var(--danger)':'var(--border)'}`,cursor:'pointer'}} onClick={()=>openMov(fp)}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:'.95rem'}}>
                        {fp.product_name}
                        {fp.store && (
                          <span style={{marginLeft:6,background:'#dbeafe',color:'#1e40af',padding:'2px 6px',borderRadius:4,fontSize:'.65rem',fontWeight:700}}>
                            🏪 {fp.store.toUpperCase()}
                          </span>
                        )}
                      </div>
                      {fp.unit && <div style={{fontSize:'.75rem',color:'var(--muted)'}}>{fp.unit}</div>}
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontWeight:700,fontSize:'1.1rem',color:low?'var(--danger)':'var(--primary)'}}>{total}</div>
                      {fp.min_qty && <div style={{fontSize:'.72rem',color:'var(--muted)'}}>mín: {fp.min_qty}</div>}
                    </div>
                  </div>
                  <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                    {locsVisible.map(loc=>(
                      <span key={loc} style={{fontSize:'.75rem',padding:'2px 8px',background:'#f0f0f0',borderRadius:20}}>
                        {(LOCATION_LABELS[loc] || loc).split(' ')[0]} {s[loc]||0}
                      </span>
                    ))}
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
            <input type="password" placeholder="Senha admin" value={adminPwd} onChange={e=>setAdminPwd(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&(adminPwd===ADMIN_PWD?setAdminAuthed(true):showToast('Senha incorreta'))}
              style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,marginBottom:8,fontSize:'1rem'}}/>
            <button className="btn btn-primary btn-full" onClick={()=>adminPwd===ADMIN_PWD?setAdminAuthed(true):showToast('Senha incorreta')}>Entrar</button>
          </div>
        )}

        {tab==='admin' && adminAuthed && (
          <>
            <div className="card">
              <div className="card-title">Buscar produto do catálogo</div>
              <div style={{position:'relative'}}>
                <input placeholder="Digite o nome..." value={adminSearch} onChange={e=>searchAdmin(e.target.value)}
                  style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem'}}/>
                {adminResults.length>0 && (
                  <div style={{position:'absolute',top:'100%',left:0,right:0,background:'white',border:'1px solid var(--border)',borderRadius:'0 0 8px 8px',zIndex:50,maxHeight:200,overflowY:'auto'}}>
                    {adminResults.map((p:any)=>(
                      <div key={p.id} onClick={()=>addFromCatalog(p)} style={{padding:'9px 12px',cursor:'pointer',fontSize:'.88rem',borderBottom:'1px solid var(--border)'}}>{p.name}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="card">
              <div className="card-title">Adicionar manualmente</div>
              <div style={{display:'flex',gap:6}}>
                <input placeholder="Nome do produto" value={newProdName} onChange={e=>setNewProdName(e.target.value)}
                  style={{flex:1,padding:8,border:'1.5px solid var(--border)',borderRadius:6,fontSize:'.85rem'}}/>
                <button onClick={addManual} style={{padding:'8px 12px',background:'var(--primary)',color:'white',border:'none',borderRadius:6,cursor:'pointer'}}>+</button>
              </div>
            </div>
            <div className="card">
              <div className="card-title">Cadastrados ({products.length})</div>
              {products.map(p=>(
                <div key={p.id} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid var(--border)',fontSize:'.88rem'}}>
                  <span>{p.product_name}</span>
                  <span style={{color:'var(--muted)'}}>{getTotal(p.id)} unid.</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Modal: Adicionar produto (qualquer user com store) */}
      {addOpen && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',display:'flex',alignItems:'flex-end',zIndex:200}} onClick={e=>e.target===e.currentTarget&&setAddOpen(false)}>
          <div style={{background:'white',width:'100%',borderRadius:'12px 12px 0 0',padding:20,maxHeight:'85vh',overflowY:'auto'}}>
            <div style={{fontWeight:700,marginBottom:4,fontSize:'1rem'}}>+ Adicionar produto congelado</div>
            <div style={{fontSize:'.78rem',color:'var(--muted)',marginBottom:12}}>
              {isAdmin
                ? 'Admin: escolha a loja (ou "global" pra todos verem).'
                : `Esse produto vai ser cadastrado para a loja ${(user?.store || '').toUpperCase()} (só vocês veem).`}
            </div>

            {isAdmin && (
              <>
                <label style={{fontSize:'.8rem',color:'var(--muted)',display:'block',marginBottom:4}}>Loja</label>
                <select value={addStoreChoice ?? ''} onChange={e=>setAddStoreChoice(e.target.value || null)}
                  style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,marginBottom:12,fontSize:'.9rem'}}>
                  <option value="">🌐 Global (todas as lojas veem)</option>
                  <option value="jc">JC — Júlio</option>
                  <option value="ja">JA — Jardim América</option>
                  <option value="ex">EX — Exposição</option>
                </select>
              </>
            )}

            <label style={{fontSize:'.8rem',color:'var(--muted)',display:'block',marginBottom:4}}>Buscar do catálogo de produtos</label>
            <div style={{position:'relative',marginBottom:12}}>
              <input placeholder="Digite o nome..." value={addSearch} onChange={e=>searchAddCatalog(e.target.value)}
                style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem'}}/>
              {addResults.length>0 && (
                <div style={{position:'absolute',top:'100%',left:0,right:0,background:'white',border:'1px solid var(--border)',borderRadius:'0 0 8px 8px',zIndex:50,maxHeight:200,overflowY:'auto'}}>
                  {addResults.map((p:any)=>(
                    <div key={p.id} onClick={()=>submitAddFromCatalog(p)} style={{padding:'9px 12px',cursor:'pointer',fontSize:'.88rem',borderBottom:'1px solid var(--border)'}}>{p.name}</div>
                  ))}
                </div>
              )}
            </div>

            <div style={{borderTop:'1px dashed var(--border)',paddingTop:12,marginBottom:14}}>
              <label style={{fontSize:'.8rem',color:'var(--muted)',display:'block',marginBottom:4}}>Ou adicionar manualmente</label>
              <div style={{display:'flex',gap:6}}>
                <input placeholder="Nome do produto" value={addManualName} onChange={e=>setAddManualName(e.target.value)}
                  style={{flex:1,padding:8,border:'1.5px solid var(--border)',borderRadius:6,fontSize:'.9rem'}}/>
                <button onClick={submitAddManual} disabled={!addManualName.trim()}
                  style={{padding:'8px 14px',background:'var(--primary)',color:'white',border:'none',borderRadius:6,cursor:addManualName.trim()?'pointer':'default',opacity:addManualName.trim()?1:.5,fontWeight:600}}>+</button>
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
