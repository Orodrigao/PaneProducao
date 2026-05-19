'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { todayKey, todayLabel, showToast } from '@/lib/utils'

const USERS = ['Suélen','Liara','Samuel','Rose','Fran']

interface Product { id: string; name: string; category: string; unit: string | null }
interface Bread   { id: string; name: string; unit: string | null }

export default function SobrasPage() {
  const [user, setUser]       = useState<string|null>(null)
  const [mode, setMode]       = useState<'sobra'|'descarte'|null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [breads, setBreads]   = useState<Bread[]>([])
  const [qtys, setQtys]       = useState<Record<string,number>>({})
  const [saving, setSaving]   = useState(false)

  const loadData = useCallback(async () => {
    const [{ data: prods }, { data: bds }, { data: orders }] = await Promise.all([
      supabase.from('products').select('id,name,category,unit').eq('active', true).neq('category','INSUMOS').order('category').order('name'),
      supabase.from('breads').select('id,name,unit').eq('active', true).eq('is_pj', false).order('name'),
      supabase.from('orders').select('bread_id').eq('order_date', todayKey()).gt('quantity', 0),
    ])
    const todayBreadIds = new Set((orders||[]).map((o:any)=>o.bread_id).filter(Boolean))
    setProducts(prods || [])
    setBreads((bds||[]).filter((b:any)=>todayBreadIds.has(b.id)))

    // Load existing saved values for today
    const table = mode === 'sobra' ? 'sobras' : 'descartes'
    const { data: saved } = await supabase.from(table).select('*')
      .eq('record_date', todayKey()).eq('responsible', user)
    const vals: Record<string,number> = {}
    ;(saved||[]).forEach((r:any)=>{ vals[r.product_id || ('bread_'+r.bread_id)] = r.quantity })
    setQtys(vals)
  }, [mode, user])

  useEffect(() => { if (user && mode) loadData() }, [user, mode, loadData])

  const setQty = (id: string, val: number) => setQtys(prev => ({ ...prev, [id]: Math.max(0, val) }))

  const save = async () => {
    const items = Object.entries(qtys).filter(([,v])=>v>0)
    if (!items.length) { showToast('Nenhuma quantidade preenchida'); return }
    setSaving(true)
    const table = mode === 'sobra' ? 'sobras' : 'descartes'
    const date = todayKey()
    try {
      await supabase.from(table).delete().eq('record_date', date).eq('responsible', user!)
      const rows = items.map(([id, quantity]) => {
        const isBread = id.startsWith('bread_')
        return {
          record_date: date, responsible: user,
          ...(isBread ? { bread_id: id.replace('bread_',''), product_source:'bread' } : { product_id: id, product_source:'catalog' }),
          quantity
        }
      })
      const { error } = await supabase.from(table).insert(rows)
      if (error) throw error
      showToast(`✅ ${mode==='sobra'?'Sobras':'Descartes'} salvo${mode==='sobra'?'s':'s'}!`)
      setMode(null); setQtys({})
    } catch(e:any) { showToast('Erro: '+e.message) }
    finally { setSaving(false) }
  }

  const grouped = products.reduce((acc:Record<string,Product[]>, p) => {
    ;(acc[p.category]??=[]).push(p); return acc
  }, {})
  const filled = Object.values(qtys).filter(v=>v>0).length

  // ── SELECT USER ──
  if (!user) return (
    <div style={{padding:'20px',maxWidth:500,margin:'0 auto'}}>
      <div style={{background:'var(--primary)',color:'white',padding:'14px 20px',marginBottom:20,borderRadius:'var(--radius)',fontWeight:700,fontSize:'1.1rem'}}>
        ♻️ Sobras & Descartes
      </div>
      <p style={{color:'var(--muted)',marginBottom:16,fontSize:'.9rem'}}>📅 {todayLabel()}</p>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        {USERS.map(u=>(
          <button key={u} onClick={()=>setUser(u)} style={{
            padding:'16px',border:'2px solid var(--border)',borderRadius:'var(--radius)',
            background:'white',cursor:'pointer',fontWeight:600,fontSize:'1rem',color:'var(--primary)'
          }}>{u}</button>
        ))}
      </div>
    </div>
  )

  // ── SELECT MODE ──
  if (!mode) return (
    <div style={{padding:'20px',maxWidth:500,margin:'0 auto'}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:20}}>
        <button onClick={()=>setUser(null)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--muted)',fontSize:'1.2rem'}}>←</button>
        <span style={{fontWeight:700,color:'var(--primary)'}}>👤 {user}</span>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <button onClick={()=>setMode('sobra')} className="card" style={{textAlign:'left',cursor:'pointer',border:'2px solid var(--border)'}}>
          <div style={{fontSize:'1.5rem',marginBottom:4}}>📦</div>
          <div style={{fontWeight:700,fontSize:'1rem'}}>Registrar Sobras</div>
          <div style={{color:'var(--muted)',fontSize:'.85rem'}}>O que sobrou no fechamento do dia</div>
        </button>
        <button onClick={()=>setMode('descarte')} className="card" style={{textAlign:'left',cursor:'pointer',border:'2px solid var(--border)'}}>
          <div style={{fontSize:'1.5rem',marginBottom:4}}>🗑️</div>
          <div style={{fontWeight:700,fontSize:'1rem'}}>Registrar Descarte</div>
          <div style={{color:'var(--muted)',fontSize:'.85rem'}}>O que foi descartado</div>
        </button>
      </div>
    </div>
  )

  // ── FORM ──
  return (
    <div style={{padding:'20px',maxWidth:600,margin:'0 auto'}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:4}}>
        <button onClick={()=>{setMode(null);setQtys({})}} style={{background:'none',border:'none',cursor:'pointer',color:'var(--muted)',fontSize:'1.2rem'}}>←</button>
        <span style={{fontWeight:700,color:'var(--primary)'}}>
          {mode==='sobra'?'📦 Sobras':'🗑️ Descartes'} — {user}
        </span>
      </div>
      <p style={{color:'var(--muted)',fontSize:'.8rem',marginBottom:16,paddingLeft:32}}>📅 {todayLabel()}</p>

      {breads.length>0 && (
        <div className="card">
          <div className="card-title">🍞 Pães do dia</div>
          {breads.map(b=>(
            <ItemRow key={'bread_'+b.id} id={'bread_'+b.id} name={b.name} unit={b.unit} qty={qtys['bread_'+b.id]||0} onChange={setQty}/>
          ))}
        </div>
      )}

      {Object.entries(grouped).map(([cat, items])=>(
        <div key={cat} className="card">
          <div className="card-title">{cat}</div>
          {items.map(p=>(
            <ItemRow key={p.id} id={p.id} name={p.name} unit={p.unit} qty={qtys[p.id]||0} onChange={setQty}/>
          ))}
        </div>
      ))}

      <button className="btn btn-success btn-full" onClick={save} disabled={saving||filled===0}>
        {saving ? <span className="spinner"/> : `💾 Salvar ${filled} item${filled!==1?'s':''}`}
      </button>
    </div>
  )
}

function ItemRow({ id, name, unit, qty, onChange }: { id:string; name:string; unit:string|null; qty:number; onChange:(id:string,v:number)=>void }) {
  return (
    <div style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
      <div style={{flex:1}}>
        <div style={{fontSize:'.9rem',fontWeight:600}}>{name}</div>
        {unit && <div style={{fontSize:'.75rem',color:'var(--muted)'}}>{unit}</div>}
      </div>
      <button onClick={()=>onChange(id,qty-1)} style={{width:28,height:28,border:'1px solid var(--border)',borderRadius:6,background:'white',cursor:'pointer',fontSize:'1rem'}}>−</button>
      <input type="number" value={qty||''} min={0} step={0.1} placeholder="0"
        onChange={e=>onChange(id,parseFloat(e.target.value)||0)}
        style={{width:60,textAlign:'center',padding:'4px',border:'1.5px solid var(--border)',borderRadius:6,fontSize:'.9rem'}}/>
      <button onClick={()=>onChange(id,qty+1)} style={{width:28,height:28,border:'1px solid var(--border)',borderRadius:6,background:'white',cursor:'pointer',fontSize:'1rem'}}>+</button>
    </div>
  )
}
