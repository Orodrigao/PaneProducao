'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Plus, Search, Pencil, Save, AlertTriangle, RotateCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, roleColor, type AppUser } from '@/lib/auth'
import { showToast } from '@/lib/utils'

type Kind = 'kit' | 'insumo' | 'final'

interface Product {
  id: string; name: string; category: string; unit: string|null
  cost_price: number|null; active: boolean; sort_order: number
  kind: Kind | null
}

const KIND_LABELS: Record<Kind, string> = { kit: 'KIT', insumo: 'INSUMO', final: 'FINAL' }
// Mapeia pro chip ps-store-chip (jc=honey/kit, ja=sage/insumo). 'final' fica neutro.
const KIND_CHIP_CLS: Record<Kind, string> = { kit: 'jc', insumo: 'ja', final: '' }

interface Bread {
  id: string; name: string; unit: string|null
  cost_price: number|null; active: boolean; is_pj: boolean
}

interface Component {
  parent_product_id: string
  component_source: string
  component_id: string
  quantity: number
}

const CATEGORIES = ['Bolos','Brownie','Bruschettas','Confeitaria','Cookies','Croissant','Doce',
  'Focaccias','Folhados & Doces','Lanches','Muffins','Pastas & Pesto','Pizza Redonda',
  'Pizza Romana','Pães Branco','Pães Integ.','Pães Rech.','Pães Recheados','Salgados','Sopas & Cremes','INSUMOS']

export default function ProdutosPage() {
  const [user, setUser]         = useState<AppUser | null>(null)
  const [tab, setTab]           = useState<'produtos'|'paes'>('produtos')
  const [products, setProducts] = useState<Product[]>([])
  const [breads, setBreads]     = useState<Bread[]>([])
  const [components, setComponents] = useState<Component[]>([])
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState<string|null>(null)
  const [search, setSearch]     = useState('')
  const [catFilter, setCat]     = useState('Todos')
  const [kindFilter, setKindFilter] = useState<'all'|Kind>('all')
  const [editItem, setEditItem] = useState<Partial<Product>|null>(null)
  const [isNew, setIsNew]       = useState(false)
  const [breadCostEdits, setBreadCostEdits] = useState<Record<string, string>>({})
  const [newBread, setNewBread] = useState<Partial<Bread>|null>(null)

  useEffect(()=>{ setUser(getCurrentUser()); load() },[])

  async function load() {
    setLoading(true)
    setLoadError(null)
    try {
      const [pRes, bRes, cRes] = await Promise.all([
        supabase.from('products').select('*').order('category').order('name'),
        supabase.from('breads').select('*').order('name'),
        supabase.from('product_components').select('parent_product_id,component_source,component_id,quantity'),
      ])
      if (pRes.error) throw pRes.error
      if (bRes.error) throw bRes.error
      if (cRes.error) throw cRes.error
      setProducts(pRes.data||[])
      setBreads(bRes.data||[])
      setComponents((cRes.data||[]) as Component[])
    } catch(e:any) {
      setLoadError(e?.message || 'Falha ao carregar os dados.')
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    if (!editItem?.name?.trim()) { showToast('Nome obrigatório'); return }
    const body: any = { ...editItem }
    if (body.cost_price === '' || body.cost_price === undefined) body.cost_price = null
    else if (body.cost_price !== null) body.cost_price = Number(body.cost_price)
    try {
      if (isNew) {
        const { error } = await supabase.from('products').insert({ ...body, active: true })
        if (error) throw error
        showToast('✅ Produto criado')
      } else {
        const { error } = await supabase.from('products').update(body).eq('id', editItem.id!)
        if (error) throw error
        showToast('✅ Salvo')
      }
      setEditItem(null); load()
    } catch(e:any) { showToast('Erro: '+e.message) }
  }

  async function toggleActive(p: Product) {
    await supabase.from('products').update({ active: !p.active }).eq('id', p.id)
    setProducts(prev => prev.map(x => x.id===p.id ? {...x,active:!p.active} : x))
  }

  async function saveBreadCost(b: Bread) {
    const raw = breadCostEdits[b.id]
    if (raw === undefined) return
    const v = raw === '' ? null : Number(raw)
    if (v !== null && (!Number.isFinite(v) || v < 0)) { showToast('Valor inválido'); return }
    try {
      const { error } = await supabase.from('breads').update({ cost_price: v }).eq('id', b.id)
      if (error) throw error
      setBreads(prev => prev.map(x => x.id===b.id ? {...x, cost_price: v} : x))
      setBreadCostEdits(prev => { const c = { ...prev }; delete c[b.id]; return c })
      showToast('✅ Custo atualizado')
    } catch(e:any) { showToast('Erro: '+e.message) }
  }

  async function toggleBreadActive(b: Bread) {
    await supabase.from('breads').update({ active: !b.active }).eq('id', b.id)
    setBreads(prev => prev.map(x => x.id===b.id ? {...x,active:!b.active} : x))
  }

  function makeBreadId(name: string): string {
    const slug = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'')
    return `${slug}${Date.now()}`
  }

  async function saveNewBread() {
    if (!newBread?.name?.trim()) { showToast('Nome obrigatório'); return }
    const cost = newBread.cost_price === null || newBread.cost_price === undefined || (newBread.cost_price as any) === ''
      ? 0 : Number(newBread.cost_price)
    if (!Number.isFinite(cost) || cost < 0) { showToast('Custo inválido'); return }
    try {
      const { error } = await supabase.from('breads').insert({
        id: makeBreadId(newBread.name),
        name: newBread.name.trim(),
        unit: newBread.unit?.trim() || 'un',
        cost_price: cost,
        active: true,
        is_pj: !!newBread.is_pj,
      })
      if (error) throw error
      showToast('✅ Pão criado')
      setNewBread(null)
      load()
    } catch(e:any) { showToast('Erro: '+e.message) }
  }

  const cats = ['Todos',...new Set(products.map(p=>p.category).filter(Boolean))]
  const filtered = products.filter(p=>{
    const matchCat = catFilter==='Todos' || p.category===catFilter
    const matchKind = kindFilter==='all' || p.kind===kindFilter
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase())
    return matchCat && matchKind && matchSearch
  })
  // CMV computado por kit: soma (custo do componente × quantidade).
  // Se algum componente não tem custo cadastrado, marca como parcial.
  const cmvByKit: Record<string, { total: number; partial: boolean; count: number }> = {}
  for (const c of components) {
    const cost = c.component_source === 'bread'
      ? (breads.find(b => b.id === c.component_id)?.cost_price ?? null)
      : (products.find(p => p.id === c.component_id)?.cost_price ?? null)
    const entry = cmvByKit[c.parent_product_id] ??= { total: 0, partial: false, count: 0 }
    entry.count++
    if (cost === null || Number(cost) === 0) entry.partial = true
    else entry.total += Number(cost) * Number(c.quantity)
  }

  const kindCounts = { kit: 0, insumo: 0, final: 0 }
  for (const p of products) {
    if (p.kind === 'kit') kindCounts.kit++
    else if (p.kind === 'insumo') kindCounts.insumo++
    else if (p.kind === 'final') kindCounts.final++
  }
  const grouped = filtered.reduce((acc:Record<string,Product[]>,p)=>{ (acc[p.category]??=[]).push(p); return acc },{})

  const breadsFiltered = breads.filter(b => !search || b.name.toLowerCase().includes(search.toLowerCase()))
  const breadsWithoutCost = breads.filter(b => b.active && (b.cost_price === null || Number(b.cost_price) === 0)).length

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
            <button role="tab" aria-selected={tab==='produtos'} onClick={()=>setTab('produtos')} className="ps-tab">
              🥐 Produtos ({products.filter(p=>p.active).length})
            </button>
            <button role="tab" aria-selected={tab==='paes'} onClick={()=>setTab('paes')} className="ps-tab">
              🍞 Pães ({breads.filter(b=>b.active).length})
            </button>
          </div>
        </div>

        <div className="ps-scroll ps-pad">
          {/* Action row: search + new */}
          <div style={{display:'flex', gap:8, marginTop:14, marginBottom:12}}>
            <div style={{flex:1, position:'relative'}}>
              <Search size={14} style={{position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--ink-faint)', pointerEvents:'none'}}/>
              <input placeholder={tab==='produtos' ? "Buscar produto..." : "Buscar pão..."} value={search} onChange={e=>setSearch(e.target.value)}
                className="ps-input" style={{width:'100%', padding:'8px 12px 8px 30px', fontSize:13}}/>
            </div>
            {tab==='produtos' ? (
              <button onClick={()=>{setIsNew(true);setEditItem({active:true,category:CATEGORIES[0], kind:'final'})}} className="ps-btn primary">
                <Plus size={14}/> Novo
              </button>
            ) : (
              <button onClick={()=>setNewBread({name:'',unit:'un',cost_price:null,is_pj:false})} className="ps-btn primary">
                <Plus size={14}/> Novo pão
              </button>
            )}
          </div>

          {/* Kind filter — só Produtos */}
          {tab==='produtos' && (
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
            </div>
          )}

          {/* Category filter — só Produtos */}
          {tab==='produtos' && (
            <div className="ps-presets" style={{overflowX:'auto', paddingBottom:6, marginBottom:12, flexWrap:'nowrap'}}>
              {cats.map(c=>(
                <button key={c} onClick={()=>setCat(c)} className={`ps-preset ${catFilter===c?'active':''}`}>
                  {c}
                </button>
              ))}
            </div>
          )}

          {/* Alerta: pães sem custo */}
          {tab==='paes' && breadsWithoutCost > 0 && (
            <div className="ps-warning">
              <AlertTriangle size={16} style={{flexShrink:0, marginTop:1}}/>
              <span>
                <strong>{breadsWithoutCost}</strong> {breadsWithoutCost === 1 ? 'pão ativo sem custo cadastrado' : 'pães ativos sem custo cadastrado'}. Preencha pra aparecer com valor nos relatórios.
              </span>
            </div>
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
          ) : tab === 'produtos' ? (
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
                        </div>
                        <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:2}}>
                          {p.unit||''}{p.cost_price?` · R$ ${Number(p.cost_price).toFixed(2)}`:''}
                        </div>
                        {p.kind === 'kit' && cmvByKit[p.id] && (
                          <div style={{fontSize:11, color:'var(--sage)', marginTop:2, fontWeight:600}}>
                            CMV computado: R$ {cmvByKit[p.id].total.toFixed(2)}
                            {cmvByKit[p.id].partial && <span style={{color:'var(--berry)', fontWeight:500}}> (parcial)</span>}
                            <span style={{color:'var(--ink-faint)', fontWeight:400}}> · {cmvByKit[p.id].count} comp.</span>
                          </div>
                        )}
                      </div>
                      {p.kind === 'kit' && (
                        <Link href={`/produtos/composicao?id=${p.id}`} title="Cadastrar composição do kit" className="ps-iconbtn" style={{width:30, height:30, fontSize:14}}>
                          📋
                        </Link>
                      )}
                      <button onClick={()=>toggleActive(p)} className={`ps-status ${p.active?'conferido':'separado'}`} style={{border:'1px solid transparent', cursor:'pointer'}}>
                        {p.active?'✓ Ativo':'Inativo'}
                      </button>
                      <button onClick={()=>{setIsNew(false);setEditItem({...p})}} className="ps-iconbtn" style={{width:30, height:30}}>
                        <Pencil size={14}/>
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="ps-card" style={{padding:'4px 14px'}}>
              <div className="ps-flabel" style={{paddingTop:10}}>Pães ({breadsFiltered.length})</div>
              {breadsFiltered.map(b=>{
                const editing = breadCostEdits[b.id]
                const current = b.cost_price !== null && b.cost_price !== undefined ? String(b.cost_price) : ''
                const dirty = editing !== undefined && editing !== current
                return (
                  <div key={b.id} style={{display:'flex', alignItems:'center', gap:8, padding:'10px 0', borderBottom:'1px solid var(--line-soft)', opacity:b.active?1:0.5}}>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{fontSize:14, fontWeight:600, color:'var(--ps-ink)'}}>
                        {b.name}
                        {b.is_pj && <span className="ps-store-chip jc" style={{marginLeft:6}}>PJ</span>}
                      </div>
                      <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:2}}>{b.unit || 'un'}</div>
                    </div>
                    <div style={{display:'flex', alignItems:'center', gap:4}}>
                      <span style={{fontSize:12, color:'var(--ink-soft)'}}>R$</span>
                      <input type="number" step="0.01" min="0"
                        value={editing ?? current}
                        placeholder="0.00"
                        onChange={e=>setBreadCostEdits(prev=>({...prev,[b.id]:e.target.value}))}
                        className="ps-input" style={{width:84, padding:'5px 8px', fontSize:13, textAlign:'right'}}/>
                      <button onClick={()=>saveBreadCost(b)} disabled={!dirty} className={`ps-btn sm ${dirty?'primary':''}`} style={!dirty?{opacity:.5, background:'var(--line-soft)', color:'var(--ink-faint)', boxShadow:'none'}:undefined}>
                        <Save size={12}/>
                      </button>
                    </div>
                    <button onClick={()=>toggleBreadActive(b)} className={`ps-status ${b.active?'conferido':'separado'}`} style={{border:'1px solid transparent', cursor:'pointer', minWidth:28, justifyContent:'center'}}>
                      {b.active?'✓':'×'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* MODAL — Produto */}
      {editItem && (
        <div className="ps-sheet-overlay" onClick={e=>e.target===e.currentTarget&&setEditItem(null)}>
          <div className="ps-sheet">
            <div className="ps-sheet-grab"/>
            <h3>{isNew?'Novo Produto':'Editar Produto'}</h3>

            <div style={{display:'flex', flexDirection:'column', gap:10, marginBottom:14}}>
              {([
                ['Nome', 'name', 'text'],['Unidade', 'unit', 'text'],['Custo (R$)', 'cost_price', 'number']
              ] as [string,string,string][]).map(([label,field,type])=>(
                <div key={field} className="ps-fieldgroup">
                  <div className="ps-fieldlabel">{label}</div>
                  <input type={type} value={(editItem as any)[field]||''} onChange={e=>setEditItem(prev=>({...prev,[field]:e.target.value}))}
                    className="ps-input"/>
                </div>
              ))}
              <div className="ps-fieldgroup">
                <div className="ps-fieldlabel">Categoria</div>
                <select value={editItem.category||''} onChange={e=>setEditItem(prev=>({...prev,category:e.target.value}))} className="ps-select">
                  {CATEGORIES.map(c=><option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="ps-fieldgroup">
                <div className="ps-fieldlabel">Tipo</div>
                <select value={editItem.kind || 'final'} onChange={e=>setEditItem(prev=>({...prev, kind: e.target.value as Kind}))} className="ps-select">
                  <option value="final">✨ Produto final (venda direta)</option>
                  <option value="kit">🍞 Kit (composto por pães/insumos)</option>
                  <option value="insumo">🥚 Insumo (matéria-prima)</option>
                </select>
              </div>
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

      {/* MODAL — Novo pão */}
      {newBread && (
        <div className="ps-sheet-overlay" onClick={e=>e.target===e.currentTarget&&setNewBread(null)}>
          <div className="ps-sheet">
            <div className="ps-sheet-grab"/>
            <h3>🍞 Novo pão</h3>

            <div className="ps-fieldgroup" style={{marginBottom:10}}>
              <div className="ps-fieldlabel">Nome *</div>
              <input value={newBread.name||''} onChange={e=>setNewBread(prev=>({...prev,name:e.target.value}))}
                autoFocus placeholder="ex: Pão de Hotdog" className="ps-input"/>
            </div>

            <div className="ps-fieldrow" style={{marginBottom:10}}>
              <div className="ps-fieldgroup">
                <div className="ps-fieldlabel">Unidade</div>
                <input value={newBread.unit||''} onChange={e=>setNewBread(prev=>({...prev,unit:e.target.value}))}
                  placeholder="un / kg" className="ps-input"/>
              </div>
              <div className="ps-fieldgroup">
                <div className="ps-fieldlabel">Custo (R$)</div>
                <input type="number" step="0.01" min="0"
                  value={newBread.cost_price ?? ''}
                  onChange={e=>setNewBread(prev=>({...prev,cost_price: e.target.value === '' ? null : Number(e.target.value)}))}
                  placeholder="0.00" className="ps-input"/>
              </div>
            </div>

            <label style={{display:'flex', alignItems:'center', gap:8, fontSize:13, color:'var(--ink-soft)', cursor:'pointer', marginBottom:16, padding:'8px 10px', background:'var(--line-soft)', borderRadius:'var(--r-ctrl)'}}>
              <input type="checkbox" checked={!!newBread.is_pj}
                onChange={e=>setNewBread(prev=>({...prev,is_pj:e.target.checked}))}/>
              Pão exclusivo PJ (atacado / clientes específicos)
            </label>

            <div style={{display:'flex', gap:8}}>
              <button onClick={saveNewBread} className="ps-btn primary" style={{flex:1}}>
                <Save size={14}/> Criar pão
              </button>
              <button onClick={()=>setNewBread(null)} className="ps-btn ghost">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
