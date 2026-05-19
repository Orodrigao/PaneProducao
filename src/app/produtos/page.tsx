'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { showToast } from '@/lib/utils'

interface Product {
  id: string; name: string; category: string; unit: string|null
  cost: number|null; active: boolean; sort_order: number
}

const ADMIN_PWD = 'pane2025'
const CATEGORIES = ['Bolos','Brownie','Bruschettas','Confeitaria','Cookies','Croissant','Doce',
  'Focaccias','Folhados & Doces','Lanches','Muffins','Pastas & Pesto','Pizza Redonda',
  'Pizza Romana','Pães Branco','Pães Integ.','Pães Rech.','Pães Recheados','Salgados','Sopas & Cremes','INSUMOS']

export default function ProdutosPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [catFilter, setCat]     = useState('Todos')
  const [editItem, setEditItem] = useState<Partial<Product>|null>(null)
  const [isNew, setIsNew]       = useState(false)
  const [authed, setAuthed]     = useState(false)
  const [pwd, setPwd]           = useState('')

  useEffect(()=>{ load() },[])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('products').select('*').order('category').order('name')
    setProducts(data||[])
    setLoading(false)
  }

  async function save() {
    if (!editItem?.name?.trim()) { showToast('Nome obrigatório'); return }
    try {
      if (isNew) {
        const { error } = await supabase.from('products').insert({ ...editItem, active: true })
        if (error) throw error
        showToast('✅ Produto criado')
      } else {
        const { error } = await supabase.from('products').update(editItem).eq('id', editItem.id!)
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

  const cats = ['Todos',...new Set(products.map(p=>p.category).filter(Boolean))]
  const filtered = products.filter(p=>{
    const matchCat = catFilter==='Todos' || p.category===catFilter
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase())
    return matchCat && matchSearch
  })
  const grouped = filtered.reduce((acc:Record<string,Product[]>,p)=>{ (acc[p.category]??=[]).push(p); return acc },{})

  if (!authed) return (
    <div style={{padding:'20px',maxWidth:400,margin:'40px auto',textAlign:'center'}}>
      <div style={{fontSize:'2rem',marginBottom:10}}>📦</div>
      <div style={{fontWeight:700,fontSize:'1.2rem',color:'var(--primary)',marginBottom:20}}>Catálogo de Produtos</div>
      <input type="password" placeholder="Senha de acesso" value={pwd} onChange={e=>setPwd(e.target.value)}
        onKeyDown={e=>e.key==='Enter'&&(pwd===ADMIN_PWD?setAuthed(true):showToast('Senha incorreta'))}
        style={{width:'100%',padding:12,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'1rem',marginBottom:10}}/>
      <button className="btn btn-primary btn-full" onClick={()=>pwd===ADMIN_PWD?setAuthed(true):showToast('Senha incorreta')}>
        Entrar
      </button>
    </div>
  )

  return (
    <div style={{padding:'16px',maxWidth:700,margin:'0 auto'}}>
      <div style={{background:'var(--primary)',color:'white',padding:'14px 16px',borderRadius:'var(--radius)',marginBottom:16,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span style={{fontWeight:700}}>📦 Produtos ({products.filter(p=>p.active).length} ativos)</span>
        <button onClick={()=>{setIsNew(true);setEditItem({active:true,category:CATEGORIES[0]})}}
          style={{background:'white',color:'var(--primary)',border:'none',borderRadius:6,padding:'6px 12px',fontWeight:700,cursor:'pointer'}}>
          + Novo
        </button>
      </div>

      <input placeholder="🔍 Buscar produto..." value={search} onChange={e=>setSearch(e.target.value)}
        style={{width:'100%',padding:'10px 12px',border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem',marginBottom:10}}/>

      <div style={{display:'flex',gap:6,overflowX:'auto',paddingBottom:6,marginBottom:12}}>
        {cats.map(c=>(
          <button key={c} onClick={()=>setCat(c)}
            style={{padding:'5px 12px',borderRadius:20,border:'1.5px solid var(--border)',background:catFilter===c?'var(--primary)':'white',color:catFilter===c?'white':'var(--text)',fontSize:'.78rem',whiteSpace:'nowrap',cursor:'pointer'}}>
            {c}
          </button>
        ))}
      </div>

      {loading ? <div style={{textAlign:'center',padding:40,color:'var(--muted)'}}>Carregando...</div> : (
        Object.entries(grouped).map(([cat, items])=>(
          <div key={cat} className="card">
            <div className="card-title">{cat} ({items.length})</div>
            {items.map(p=>(
              <div key={p.id} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 0',borderBottom:'1px solid var(--border)',opacity:p.active?1:0.5}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:'.9rem',fontWeight:600}}>{p.name}</div>
                  <div style={{fontSize:'.75rem',color:'var(--muted)'}}>{p.unit||''}{p.cost?` · R$ ${Number(p.cost).toFixed(2)}`:''}</div>
                </div>
                <button onClick={()=>toggleActive(p)} style={{fontSize:'.75rem',padding:'3px 8px',borderRadius:20,border:'1px solid var(--border)',background:'white',cursor:'pointer',color:p.active?'var(--success)':'var(--muted)'}}>
                  {p.active?'✓ Ativo':'Inativo'}
                </button>
                <button onClick={()=>{setIsNew(false);setEditItem({...p})}} style={{background:'none',border:'none',cursor:'pointer',fontSize:'1rem',color:'var(--muted)'}}>✏️</button>
              </div>
            ))}
          </div>
        ))
      )}

      {/* MODAL */}
      {editItem && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',display:'flex',alignItems:'flex-end',zIndex:200}}
          onClick={e=>e.target===e.currentTarget&&setEditItem(null)}>
          <div style={{background:'white',width:'100%',borderRadius:'12px 12px 0 0',padding:20,maxHeight:'80vh',overflowY:'auto'}}>
            <div style={{fontWeight:700,marginBottom:16,fontSize:'1rem'}}>{isNew?'Novo Produto':'Editar Produto'}</div>
            {([
              ['Nome', 'name', 'text'],['Unidade', 'unit', 'text'],['Custo (R$)', 'cost', 'number']
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
