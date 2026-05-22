'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getCurrentUser } from '@/lib/auth'
import { todayKey, todayLabel, showToast } from '@/lib/utils'

interface Product { id: string; name: string; category: string; unit: string | null }
interface Bread   { id: string; name: string; unit: string | null }

interface CurrentUser {
  id: string
  displayName: string
  store: string | null
}

export default function SobrasPage() {
  const router = useRouter()
  const [user, setUser]         = useState<CurrentUser|null>(null)
  const [mode, setMode]         = useState<'sobra'|'descarte'|null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [breads, setBreads]     = useState<Bread[]>([])
  const [qtys, setQtys]         = useState<Record<string,number>>({})
  const [saving, setSaving]     = useState(false)

  // Identidade vem do PIN global (não tem mais seletor interno paralelo)
  useEffect(() => {
    const u = getCurrentUser()
    if (!u) { router.replace('/login'); return }
    setUser({ id: u.id, displayName: u.displayName, store: u.store ?? null })
  }, [router])

  const loadData = useCallback(async () => {
    if (!user) return
    const [{ data: prods }, { data: bds }, { data: orders }] = await Promise.all([
      supabase.from('products').select('id,name,category,unit').eq('active', true).neq('category','INSUMOS').order('category').order('name'),
      supabase.from('breads').select('id,name,unit').eq('active', true).eq('is_pj', false).order('name'),
      supabase.from('orders').select('bread_id').eq('order_date', todayKey()).gt('quantity', 0),
    ])
    const todayBreadIds = new Set((orders||[]).map((o:any)=>o.bread_id).filter(Boolean))
    setProducts(prods || [])
    setBreads((bds||[]).filter((b:any)=>todayBreadIds.has(b.id)))

    // Pré-carrega valores já salvos hoje pelo mesmo usuário
    const table = mode === 'sobra' ? 'sobras' : 'descartes'
    const { data: saved } = await supabase.from(table).select('*')
      .eq('record_date', todayKey()).eq('responsible', user.displayName)
    const vals: Record<string,number> = {}
    ;(saved||[]).forEach((r:any)=>{
      const key = r.product_source === 'bread' ? 'bread_'+r.product_id : r.product_id
      vals[key] = r.quantity
    })
    setQtys(vals)
  }, [mode, user])

  useEffect(() => { if (user && mode) loadData() }, [user, mode, loadData])

  const setQty = (id: string, val: number) => setQtys(prev => ({ ...prev, [id]: Math.max(0, val) }))

  const save = async () => {
    if (!user) return
    const items = Object.entries(qtys).filter(([,v])=>v>0)
    if (!items.length) { showToast('Nenhuma quantidade preenchida'); return }
    setSaving(true)
    const table = mode === 'sobra' ? 'sobras' : 'descartes'
    const date = todayKey()
    try {
      // Idempotência: pra descarte, apaga bread_movements antigos antes de re-inserir os descartes
      if (mode === 'descarte') {
        const { data: oldRecords } = await supabase.from('descartes').select('id')
          .eq('record_date', date).eq('responsible', user.displayName)
        const oldIds = (oldRecords||[]).map((r:any)=>r.id)
        if (oldIds.length > 0) {
          await supabase.from('bread_movements').delete()
            .in('reference_id', oldIds).eq('reference_type','descarte')
        }
      }
      await supabase.from(table).delete().eq('record_date', date).eq('responsible', user.displayName)

      const rows = items.map(([id, quantity]) => {
        const isBread = id.startsWith('bread_')
        return {
          record_date: date, responsible: user.displayName,
          product_id: isBread ? id.replace('bread_','') : id,
          product_source: isBread ? 'bread' : 'catalog',
          quantity
        }
      })
      const { data: inserted, error } = await supabase.from(table).insert(rows).select('id, product_id, product_source, quantity')
      if (error) throw error

      // Stock movements: só pra DESCARTE de PÃO e se user tem loja atribuída
      if (mode === 'descarte' && user.store && inserted) {
        const movements = (inserted as any[])
          .filter(r => r.product_source === 'bread' && Number(r.quantity) > 0)
          .map(r => ({
            movement_type: 'descarte_loja',
            bread_id: r.product_id,
            location: user.store,
            quantity: -Number(r.quantity),
            reference_id: r.id,
            reference_type: 'descarte',
            recorded_by: user.displayName,
          }))
        if (movements.length > 0) {
          await supabase.from('bread_movements').insert(movements)
        }
      }

      showToast(`✅ ${mode==='sobra'?'Sobras':'Descartes'} salvo${mode==='sobra'?'s':'s'}!`)
      setMode(null); setQtys({})
    } catch(e:any) { showToast('Erro: '+e.message) }
    finally { setSaving(false) }
  }

  const grouped = products.reduce((acc:Record<string,Product[]>, p) => {
    ;(acc[p.category]??=[]).push(p); return acc
  }, {})
  const filled = Object.values(qtys).filter(v=>v>0).length

  if (!user) return (
    <div style={{padding:'40px',textAlign:'center',color:'var(--muted)'}}>
      <p>Carregando...</p>
    </div>
  )

  // ── SELECT MODE ──
  if (!mode) return (
    <div style={{padding:'20px',maxWidth:500,margin:'0 auto'}}>
      <div style={{background:'var(--primary)',color:'white',padding:'14px 20px',marginBottom:16,borderRadius:'var(--radius)',fontWeight:700,fontSize:'1.1rem',display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        <span>♻️ Sobras &amp; Descartes</span>
        <span style={{fontSize:'.78rem',fontWeight:600,background:'rgba(255,255,255,.2)',padding:'4px 10px',borderRadius:8}}>
          {user.displayName}{user.store ? ` · ${user.store.toUpperCase()}` : ''}
        </span>
      </div>
      <p style={{color:'var(--muted)',marginBottom:16,fontSize:'.9rem'}}>📅 {todayLabel()}</p>
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <button onClick={()=>setMode('sobra')} className="card" style={{textAlign:'left',cursor:'pointer',border:'2px solid var(--border)'}}>
          <div style={{fontSize:'1.5rem',marginBottom:4}}>📦</div>
          <div style={{fontWeight:700,fontSize:'1rem'}}>Registrar Sobras</div>
          <div style={{color:'var(--muted)',fontSize:'.85rem'}}>O que sobrou no fechamento. Não move estoque (sobras podem voltar à venda).</div>
        </button>
        <button onClick={()=>setMode('descarte')} className="card" style={{textAlign:'left',cursor:'pointer',border:'2px solid var(--border)'}}>
          <div style={{fontSize:'1.5rem',marginBottom:4}}>🗑️</div>
          <div style={{fontWeight:700,fontSize:'1rem'}}>Registrar Descarte</div>
          <div style={{color:'var(--muted)',fontSize:'.85rem'}}>
            O que foi descartado. {user.store
              ? `Pães debitam do estoque da loja ${user.store.toUpperCase()}.`
              : 'Sem loja atribuída — não move estoque (admin/teste).'}
          </div>
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
          {mode==='sobra'?'📦 Sobras':'🗑️ Descartes'} — {user.displayName}
          {user.store && <span style={{fontSize:'.78rem',color:'var(--muted)',marginLeft:8,fontWeight:500}}>· {user.store.toUpperCase()}</span>}
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
