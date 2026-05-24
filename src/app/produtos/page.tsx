'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { showToast } from '@/lib/utils'

interface Product {
  id: string; name: string; category: string; unit: string|null
  cost_price: number|null; active: boolean; sort_order: number
}

interface Bread {
  id: string; name: string; unit: string|null
  cost_price: number|null; active: boolean; is_pj: boolean
}

const CATEGORIES = ['Bolos','Brownie','Bruschettas','Confeitaria','Cookies','Croissant','Doce',
  'Focaccias','Folhados & Doces','Lanches','Muffins','Pastas & Pesto','Pizza Redonda',
  'Pizza Romana','Pães Branco','Pães Integ.','Pães Rech.','Pães Recheados','Salgados','Sopas & Cremes','INSUMOS']

export default function ProdutosPage() {
  const [tab, setTab]           = useState<'produtos'|'paes'>('produtos')
  const [products, setProducts] = useState<Product[]>([])
  const [breads, setBreads]     = useState<Bread[]>([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [catFilter, setCat]     = useState('Todos')
  const [editItem, setEditItem] = useState<Partial<Product>|null>(null)
  const [isNew, setIsNew]       = useState(false)
  const [breadCostEdits, setBreadCostEdits] = useState<Record<string, string>>({})

  useEffect(()=>{ load() },[])

  async function load() {
    setLoading(true)
    const [{ data: ps }, { data: bs }] = await Promise.all([
      supabase.from('products').select('*').order('category').order('name'),
      supabase.from('breads').select('*').order('name'),
    ])
    setProducts(ps||[])
    setBreads(bs||[])
    setLoading(false)
  }

  async function save() {
    if (!editItem?.name?.trim()) { showToast('Nome obrigatório'); return }
    const body: any = { ...editItem }
    // normaliza cost_price (string do input -> number ou null)
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

  const cats = ['Todos',...new Set(products.map(p=>p.category).filter(Boolean))]
  const filtered = products.filter(p=>{
    const matchCat = catFilter==='Todos' || p.category===catFilter
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase())
    return matchCat && matchSearch
  })
  const grouped = filtered.reduce((acc:Record<string,Product[]>,p)=>{ (acc[p.category]??=[]).push(p); return acc },{})

  const breadsFiltered = breads.filter(b => !search || b.name.toLowerCase().includes(search.toLowerCase()))
  const breadsWithoutCost = breads.filter(b => b.active && (b.cost_price === null || Number(b.cost_price) === 0)).length

  return (
    <div style={{padding:'16px',maxWidth:700,margin:'0 auto'}}>
      {/* Header */}
      <div style={{background:'var(--primary)',color:'white',padding:'14px 16px',borderRadius:'var(--radius)',marginBottom:12,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span style={{fontWeight:700}}>📦 Catálogo</span>
        {tab==='produtos' && (
          <button onClick={()=>{setIsNew(true);setEditItem({active:true,category:CATEGORIES[0]})}}
            style={{background:'white',color:'var(--primary)',border:'none',borderRadius:6,padding:'6px 12px',fontWeight:700,cursor:'pointer'}}>
            + Novo
          </button>
        )}
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:6,marginBottom:12}}>
        <button onClick={()=>setTab('produtos')}
          style={{flex:1,padding:'10px',borderRadius:8,border:'1.5px solid var(--border)',background:tab==='produtos'?'var(--primary)':'white',color:tab==='produtos'?'white':'var(--text)',fontWeight:700,cursor:'pointer',fontSize:'.9rem'}}>
          🥐 Produtos ({products.filter(p=>p.active).length})
        </button>
        <button onClick={()=>setTab('paes')}
          style={{flex:1,padding:'10px',borderRadius:8,border:'1.5px solid var(--border)',background:tab==='paes'?'var(--primary)':'white',color:tab==='paes'?'white':'var(--text)',fontWeight:700,cursor:'pointer',fontSize:'.9rem'}}>
          🍞 Pães ({breads.filter(b=>b.active).length})
        </button>
      </div>

      {/* Search */}
      <input placeholder={tab==='produtos' ? "🔍 Buscar produto..." : "🔍 Buscar pão..."} value={search} onChange={e=>setSearch(e.target.value)}
        style={{width:'100%',padding:'10px 12px',border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem',marginBottom:10}}/>

      {/* Category filter — só Produtos */}
      {tab==='produtos' && (
        <div style={{display:'flex',gap:6,overflowX:'auto',paddingBottom:6,marginBottom:12}}>
          {cats.map(c=>(
            <button key={c} onClick={()=>setCat(c)}
              style={{padding:'5px 12px',borderRadius:20,border:'1.5px solid var(--border)',background:catFilter===c?'var(--primary)':'white',color:catFilter===c?'white':'var(--text)',fontSize:'.78rem',whiteSpace:'nowrap',cursor:'pointer'}}>
              {c}
            </button>
          ))}
        </div>
      )}

      {/* Alerta: pães sem custo */}
      {tab==='paes' && breadsWithoutCost > 0 && (
        <div style={{background:'#fef3c7',border:'1px solid #fcd34d',color:'#92400e',padding:'10px 14px',borderRadius:8,fontSize:'.82rem',marginBottom:12}}>
          ⚠️ <strong>{breadsWithoutCost}</strong> {breadsWithoutCost === 1 ? 'pão ativo sem custo cadastrado' : 'pães ativos sem custo cadastrado'}. Preencha pra aparecer com valor nos relatórios.
        </div>
      )}

      {loading ? <div style={{textAlign:'center',padding:40,color:'var(--muted)'}}>Carregando...</div> : (
        tab === 'produtos' ? (
          Object.entries(grouped).map(([cat, items])=>(
            <div key={cat} className="card">
              <div className="card-title">{cat} ({items.length})</div>
              {items.map(p=>(
                <div key={p.id} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 0',borderBottom:'1px solid var(--border)',opacity:p.active?1:0.5}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:'.9rem',fontWeight:600}}>{p.name}</div>
                    <div style={{fontSize:'.75rem',color:'var(--muted)'}}>{p.unit||''}{p.cost_price?` · R$ ${Number(p.cost_price).toFixed(2)}`:''}</div>
                  </div>
                  <button onClick={()=>toggleActive(p)} style={{fontSize:'.75rem',padding:'3px 8px',borderRadius:20,border:'1px solid var(--border)',background:'white',cursor:'pointer',color:p.active?'var(--success)':'var(--muted)'}}>
                    {p.active?'✓ Ativo':'Inativo'}
                  </button>
                  <button onClick={()=>{setIsNew(false);setEditItem({...p})}} style={{background:'none',border:'none',cursor:'pointer',fontSize:'1rem',color:'var(--muted)'}}>✏️</button>
                </div>
              ))}
            </div>
          ))
        ) : (
          <div className="card">
            <div className="card-title">Pães ({breadsFiltered.length})</div>
            {breadsFiltered.map(b=>{
              const editing = breadCostEdits[b.id]
              const current = b.cost_price !== null && b.cost_price !== undefined ? String(b.cost_price) : ''
              const dirty = editing !== undefined && editing !== current
              return (
                <div key={b.id} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 0',borderBottom:'1px solid var(--border)',opacity:b.active?1:0.5}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:'.9rem',fontWeight:600}}>
                      {b.name}
                      {b.is_pj && <span style={{marginLeft:6,color:'var(--muted)',fontSize:'.72rem'}}>(PJ)</span>}
                    </div>
                    <div style={{fontSize:'.72rem',color:'var(--muted)'}}>{b.unit || 'un'}</div>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:4}}>
                    <span style={{fontSize:'.78rem',color:'var(--muted)'}}>R$</span>
                    <input type="number" step="0.01" min="0"
                      value={editing ?? current}
                      placeholder="0.00"
                      onChange={e=>setBreadCostEdits(prev=>({...prev,[b.id]:e.target.value}))}
                      style={{width:80,padding:'5px 8px',border:'1.5px solid var(--border)',borderRadius:6,fontSize:'.85rem',textAlign:'right'}}/>
                    <button onClick={()=>saveBreadCost(b)} disabled={!dirty}
                      style={{padding:'5px 10px',borderRadius:6,border:'none',background:dirty?'var(--primary)':'#e5e5e5',color:dirty?'white':'var(--muted)',cursor:dirty?'pointer':'default',fontSize:'.75rem',fontWeight:600}}>
                      💾
                    </button>
                  </div>
                  <button onClick={()=>toggleBreadActive(b)} style={{fontSize:'.75rem',padding:'3px 8px',borderRadius:20,border:'1px solid var(--border)',background:'white',cursor:'pointer',color:b.active?'var(--success)':'var(--muted)'}}>
                    {b.active?'✓':'×'}
                  </button>
                </div>
              )
            })}
          </div>
        )
      )}

      {/* MODAL — só pra Produtos */}
      {editItem && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',display:'flex',alignItems:'flex-end',zIndex:200}}
          onClick={e=>e.target===e.currentTarget&&setEditItem(null)}>
          <div style={{background:'white',width:'100%',borderRadius:'12px 12px 0 0',padding:20,maxHeight:'80vh',overflowY:'auto'}}>
            <div style={{fontWeight:700,marginBottom:16,fontSize:'1rem'}}>{isNew?'Novo Produto':'Editar Produto'}</div>
            {([
              ['Nome', 'name', 'text'],['Unidade', 'unit', 'text'],['Custo (R$)', 'cost_price', 'number']
            ] as [string,string,string][]).map(([label,field,type])=>(
              <div key={field} style={{marginBottom:12}}>
                <label style={{fontSize:'.8rem',fontWeight:600,color:'var(--muted)',display:'block',marginBottom:4}}>{label}</label>
                <input type={type} value={(editItem as any)[field]||''} onChange={e=>setEditItem(prev=>({...prev,[field]:e.target.value}))}
                  style={{width:'100%',padding:'10px',border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem'}}/>
              </div>
            ))}
            <div style={{marginBottom:16}}>
              <label style={{fontSize:'.8rem',fontWeight:600,color:'var(--muted)',display:'block',marginBottom:4}}>Categoria</label>
              <select value={editItem.category||''} onChange={e=>setEditItem(prev=>({...prev,category:e.target.value}))}
                style={{width:'100%',padding:'10px',border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem'}}>
                {CATEGORIES.map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
            <div style={{display:'flex',gap:8}}>
              <button className="btn btn-success" style={{flex:1}} onClick={save}>💾 Salvar</button>
              <button className="btn btn-ghost" onClick={()=>setEditItem(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
