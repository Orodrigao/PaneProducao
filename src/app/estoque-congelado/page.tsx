'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser } from '@/lib/auth'
import { showToast } from '@/lib/utils'

const LOC_LABELS: Record<string,string> = { freezer:'🧊 Freezer Horizontal', camara:'🏪 Câmara Congelada', freezer_loja:'🛒 Freezer da Loja' }
const LOCATIONS = ['freezer','camara','freezer_loja'] as const
const ADMIN_PWD = 'pane2025'
type Loc = typeof LOCATIONS[number]

interface FrozenProduct { id:string; product_name:string; unit:string|null; min_qty:number|null; active:boolean }
interface StockMap { [fpId: string]: { freezer:number; camara:number; freezer_loja:number } }

export default function EstoqueCongeladoPage() {
  const [user, setUser]         = useState<{displayName:string; store:string|null}|null>(null)
  const [products, setProducts] = useState<FrozenProduct[]>([])
  const [stock, setStock]       = useState<StockMap>({})
  const [search, setSearch]     = useState('')
  const [tab, setTab]           = useState<'estoque'|'historico'|'admin'>('estoque')
  const [movFP, setMovFP]       = useState<FrozenProduct|null>(null)
  const [movType, setMovType]   = useState<'entrada'|'saida'|'inventario'>('entrada')
  const [movLoc, setMovLoc]     = useState<Loc>('freezer')
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

  const load = useCallback(async () => {
    const [{ data: fps }, { data: ss }] = await Promise.all([
      supabase.from('frozen_products').select('*').eq('active', true).order('product_name'),
      supabase.from('frozen_stock').select('*'),
    ])
    setProducts(fps||[])
    const sm: StockMap = {}
    ;(ss||[]).forEach((s:any) => {
      if (!sm[s.frozen_product_id]) sm[s.frozen_product_id] = { freezer:0, camara:0, freezer_loja:0 }
      sm[s.frozen_product_id][s.location as Loc] = s.quantity
    })
    setStock(sm)
  }, [])

  const loadHistorico = useCallback(async () => {
    const { data } = await supabase.from('frozen_movements').select('*,frozen_products(product_name)').order('created_at',{ascending:false}).limit(100)
    setHistorico(data||[])
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const u = getCurrentUser()
    if (u) setUser({ displayName: u.displayName, store: u.store ?? null })
  }, [])
  useEffect(() => { if (tab==='historico') loadHistorico() }, [tab, loadHistorico])
  useEffect(() => {
    supabase.from('products').select('id,name,unit').eq('active',true).order('name').then(({data})=>setAllProducts(data||[]))
  }, [])

  const openMov = (fp: FrozenProduct) => {
    setMovFP(fp); setMovType('entrada'); setMovLoc('freezer'); setMovQty(''); setMovObs('')
  }

  const saveMov = async () => {
    if (!movFP || !movQty) { showToast('Informe a quantidade'); return }
    const qty = parseFloat(movQty)
    if (isNaN(qty) || qty <= 0) { showToast('Quantidade inválida'); return }
    setSaving(true)
    const cur = stock[movFP.id]?.[movLoc] || 0
    const newQty = movType==='inventario' ? qty : movType==='entrada' ? cur+qty : Math.max(0, cur-qty)
    try {
      const { data: ex } = await supabase.from('frozen_stock').select('id').eq('frozen_product_id', movFP.id).eq('location', movLoc)
      if (ex && ex.length > 0) {
        await supabase.from('frozen_stock').update({ quantity:newQty, updated_at:new Date().toISOString() }).eq('frozen_product_id', movFP.id).eq('location', movLoc)
      } else {
        await supabase.from('frozen_stock').insert({ frozen_product_id:movFP.id, location:movLoc, quantity:newQty })
      }
      await supabase.from('frozen_movements').insert({ frozen_product_id:movFP.id, location:movLoc, movement_type:movType, quantity:movType==='inventario'?newQty:qty, previous_quantity:cur, obs:movObs||null, responsible: user?.displayName || 'desconhecido' })
      setStock(prev => ({ ...prev, [movFP.id]: { ...(prev[movFP.id]||{freezer:0,camara:0,freezer_loja:0}), [movLoc]: newQty } }))
      showToast(`✅ ${movType==='entrada'?'Entrada':movType==='saida'?'Saída':'Inventário'} registrada`)
      setMovFP(null)
    } catch(e:any) { showToast('Erro: '+e.message) }
    setSaving(false)
  }

  const getTotal = (id: string) => { const s = stock[id]||{freezer:0,camara:0,freezer_loja:0}; return s.freezer+s.camara+s.freezer_loja }

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

  const filtered = products.filter(p => !search || p.product_name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div style={{maxWidth:600,margin:'0 auto'}}>
      <div style={{background:'var(--primary)',color:'white',padding:'14px 16px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <span style={{fontWeight:700}}>❄️ Estoque Congelado</span>
        <span style={{fontSize:'.85rem',opacity:.8}}>{user?.displayName || ''}{user?.store ? ` · ${user.store.toUpperCase()}` : ''}</span>
      </div>

      {user?.store && user.store !== 'jc' && (
        <div style={{background:'#fef3c7',border:'1px solid #fcd34d',color:'#92400e',padding:'10px 14px',fontSize:'.82rem'}}>
          ⚠️ Estoque congelado ainda é <strong>global</strong> (todos os freezers misturados). Você está vendo dados que incluem a JC. Loja-separation chega no PR-B5.
        </div>
      )}

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
            <input placeholder="🔍 Buscar produto..." value={search} onChange={e=>setSearch(e.target.value)}
              style={{width:'100%',padding:'9px 12px',border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem',marginBottom:12}}/>
            {filtered.length===0 ? (
              <div style={{textAlign:'center',padding:40,color:'var(--muted)'}}>
                {products.length===0?'Nenhum produto configurado. Use o Admin para adicionar.':'Nenhum resultado.'}
              </div>
            ) : filtered.map(fp=>{
              const s = stock[fp.id]||{freezer:0,camara:0,freezer_loja:0}
              const total = getTotal(fp.id)
              const low = fp.min_qty && total < fp.min_qty
              return (
                <div key={fp.id} className="card" style={{borderLeft:`4px solid ${low?'var(--danger)':'var(--border)'}`,cursor:'pointer'}} onClick={()=>openMov(fp)}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:'.95rem'}}>{fp.product_name}</div>
                      {fp.unit && <div style={{fontSize:'.75rem',color:'var(--muted)'}}>{fp.unit}</div>}
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontWeight:700,fontSize:'1.1rem',color:low?'var(--danger)':'var(--primary)'}}>{total}</div>
                      {fp.min_qty && <div style={{fontSize:'.72rem',color:'var(--muted)'}}>mín: {fp.min_qty}</div>}
                    </div>
                  </div>
                  <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                    {LOCATIONS.map(loc=>(
                      <span key={loc} style={{fontSize:'.75rem',padding:'2px 8px',background:'#f0f0f0',borderRadius:20}}>
                        {LOC_LABELS[loc].split(' ')[0]} {s[loc]||0}
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
              historico.map(m=>(
                <div key={m.id} style={{padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <span style={{fontWeight:600,fontSize:'.9rem'}}>{m.frozen_products?.product_name||'?'}</span>
                    <span style={{fontSize:'.78rem',fontWeight:700,color:m.movement_type==='entrada'?'var(--success)':m.movement_type==='saida'?'var(--danger)':'var(--primary)'}}>
                      {m.movement_type==='entrada'?'+ Entrada':m.movement_type==='saida'?'- Saída':'= Inventário'} {m.quantity}
                    </span>
                  </div>
                  <div style={{fontSize:'.75rem',color:'var(--muted)'}}>
                    {LOC_LABELS[m.location as Loc]} · {new Date(m.created_at).toLocaleDateString('pt-BR')} {new Date(m.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}
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
                  <div style={{position:'absolute',top:'100%',left:0,right:0,background:'white',border:'1px solid var(--border)',borderRadius:'0 0 8px 8px',zIndex:50}}>
                    {adminResults.map((p:any)=>(
                      <div key={p.id} onClick={()=>addFromCatalog(p)} style={{padding:'9px 12px',cursor:'pointer',fontSize:'.88rem',borderBottom:'1px solid var(--border)'}}>
                        {p.name} {p.unit?`(${p.unit})`:''}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="card">
              <div className="card-title">Adicionar produto manual</div>
              <div style={{display:'flex',gap:8}}>
                <input placeholder="Nome do produto" value={newProdName} onChange={e=>setNewProdName(e.target.value)}
                  style={{flex:1,padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem'}}/>
                <button className="btn btn-primary" onClick={addManual}>+ Add</button>
              </div>
            </div>
            <div className="card">
              <div className="card-title">Produtos configurados ({products.length})</div>
              {products.map(p=>(
                <div key={p.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid var(--border)',fontSize:'.88rem'}}>
                  <span>{p.product_name}</span>
                  <span style={{color:'var(--muted)'}}>{getTotal(p.id)} unid.</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* MOVIMENTO MODAL */}
      {movFP && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',display:'flex',alignItems:'flex-end',zIndex:200}}
          onClick={e=>e.target===e.currentTarget&&setMovFP(null)}>
          <div style={{background:'white',width:'100%',borderRadius:'12px 12px 0 0',padding:20,maxHeight:'85vh',overflowY:'auto'}}>
            <div style={{fontWeight:700,fontSize:'1rem',marginBottom:4}}>{movFP.product_name}</div>
            <div style={{color:'var(--muted)',fontSize:'.8rem',marginBottom:16}}>Total: {getTotal(movFP.id)} {movFP.unit||''}</div>

            <div style={{display:'flex',gap:8,marginBottom:16}}>
              {(['entrada','saida','inventario'] as const).map(t=>(
                <button key={t} onClick={()=>setMovType(t)}
                  style={{flex:1,padding:'8px',border:'1.5px solid var(--border)',borderRadius:8,background:movType===t?'var(--primary)':'white',color:movType===t?'white':'var(--text)',cursor:'pointer',fontSize:'.82rem',fontWeight:movType===t?700:400}}>
                  {t==='entrada'?'📥 Entrada':t==='saida'?'📤 Saída':'📊 Inventário'}
                </button>
              ))}
            </div>

            <div style={{marginBottom:12}}>
              <label style={{fontSize:'.8rem',fontWeight:600,color:'var(--muted)',display:'block',marginBottom:4}}>Local</label>
              <select value={movLoc} onChange={e=>setMovLoc(e.target.value as Loc)}
                style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem'}}>
                {LOCATIONS.map(l=><option key={l} value={l}>{LOC_LABELS[l]}</option>)}
              </select>
            </div>

            <div style={{marginBottom:12}}>
              <label style={{fontSize:'.8rem',fontWeight:600,color:'var(--muted)',display:'block',marginBottom:4}}>
                {movType==='inventario'?'Quantidade atual (inventário)':movType==='entrada'?'Quantidade de entrada':'Quantidade de saída'}
              </label>
              <input type="number" value={movQty} onChange={e=>setMovQty(e.target.value)} min={0} step={1}
                placeholder="0" autoFocus
                style={{width:'100%',padding:12,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'1.1rem',textAlign:'center'}}/>
            </div>

            <div style={{marginBottom:16}}>
              <label style={{fontSize:'.8rem',fontWeight:600,color:'var(--muted)',display:'block',marginBottom:4}}>Observação (opcional)</label>
              <input type="text" value={movObs} onChange={e=>setMovObs(e.target.value)} placeholder="Ex: Vencimento, motivo..."
                style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem'}}/>
            </div>

            <div style={{display:'flex',gap:8}}>
              <button className="btn btn-success" style={{flex:1}} onClick={saveMov} disabled={saving}>
                {saving?<span className="spinner"/>:'💾 Salvar'}
              </button>
              <button className="btn btn-ghost" onClick={()=>setMovFP(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
