'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Minus, Plus, Save, Package, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, roleColor, type AppUser } from '@/lib/auth'
import { todayKey, todayLabel, showToast } from '@/lib/utils'

interface Product { id: string; name: string; category: string; unit: string | null; kind: string | null }
interface Bread   { id: string; name: string; unit: string | null }
interface Component { parent_product_id: string; component_source: string; component_id: string; quantity: number }

export default function SobrasPage() {
  const router = useRouter()
  const [user, setUser]         = useState<AppUser | null>(null)
  const [mode, setMode]         = useState<'sobra'|'descarte'|null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [breads, setBreads]     = useState<Bread[]>([])
  const [qtys, setQtys]         = useState<Record<string,number>>({})
  const [saving, setSaving]     = useState(false)

  // Identidade vem do PIN global (não tem mais seletor interno paralelo)
  useEffect(() => {
    const u = getCurrentUser()
    if (!u) { router.replace('/login'); return }
    setUser(u)
  }, [router])

  const loadData = useCallback(async () => {
    if (!user) return
    const [{ data: prods }, { data: bds }, { data: orders }] = await Promise.all([
      supabase.from('products').select('id,name,category,unit,kind').eq('active', true).neq('category','INSUMOS').order('category').order('name'),
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
      // Idempotência: pra descarte, apaga bread_movements antigos (diretos + cascade de kit)
      // antes de re-inserir os descartes
      if (mode === 'descarte') {
        const { data: oldRecords } = await supabase.from('descartes').select('id')
          .eq('record_date', date).eq('responsible', user.displayName)
        const oldIds = (oldRecords||[]).map((r:any)=>r.id)
        if (oldIds.length > 0) {
          await supabase.from('bread_movements').delete()
            .in('reference_id', oldIds).in('reference_type', ['descarte','descarte_kit'])
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

      // Stock movements pra DESCARTE (precisa de loja atribuída ao user)
      let cascadeBreadCount = 0
      if (mode === 'descarte' && user.store && inserted) {
        // (a) Descarte direto de pão → debita o próprio pão
        const directMovements = (inserted as any[])
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
        if (directMovements.length > 0) {
          await supabase.from('bread_movements').insert(directMovements)
        }

        // (b) Descarte de KIT → cascade: debita pães-componentes (qty_componente × qty_kit)
        const kitRows = (inserted as any[]).filter(r => r.product_source === 'catalog' && Number(r.quantity) > 0)
        if (kitRows.length > 0) {
          const kitProductIds = kitRows.map(r => r.product_id)
          const { data: comps } = await supabase
            .from('product_components')
            .select('parent_product_id,component_source,component_id,quantity')
            .in('parent_product_id', kitProductIds)
            .eq('component_source', 'bread')
          const cascadeMovements: any[] = []
          for (const kit of kitRows) {
            const kitQty = Number(kit.quantity)
            const breadComps = (comps || []).filter((c: any) => c.parent_product_id === kit.product_id)
            for (const c of breadComps as any[]) {
              cascadeMovements.push({
                movement_type: 'descarte_loja',
                bread_id: c.component_id,
                location: user.store,
                quantity: -(Number(c.quantity) * kitQty),
                reference_id: kit.id,
                reference_type: 'descarte_kit',
                recorded_by: user.displayName,
              })
            }
          }
          if (cascadeMovements.length > 0) {
            await supabase.from('bread_movements').insert(cascadeMovements)
            cascadeBreadCount = cascadeMovements.length
          }
        }
      }

      const cascadeNote = cascadeBreadCount > 0 ? ` (+${cascadeBreadCount} pães debitados via kit)` : ''
      showToast(`✅ ${mode==='sobra'?'Sobras':'Descartes'} salvo${mode==='sobra'?'s':'s'}!${cascadeNote}`)
      setMode(null); setQtys({})
    } catch(e:any) { showToast('Erro: '+e.message) }
    finally { setSaving(false) }
  }

  const grouped = products.reduce((acc:Record<string,Product[]>, p) => {
    ;(acc[p.category]??=[]).push(p); return acc
  }, {})
  const filled = Object.values(qtys).filter(v=>v>0).length

  if (!user) return (
    <div className="ps-loading">
      <div className="ps-spinner"/>
      <p>Carregando...</p>
    </div>
  )

  const userDisplay = user.displayName

  // ── SELECT MODE ──
  if (!mode) return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <div className="ps-mark">P</div>
            <div className="ps-brand">
              <b>Sobras &amp; Descartes</b>
              <span>{todayLabel()}</span>
            </div>
          </div>
          <div className="ps-userchip">
            <div className="ps-avatar" style={{background: roleColor(user.role)}}>{userDisplay.charAt(0).toUpperCase()}</div>
            <b>{userDisplay}{user.store ? ` / ${user.store.toUpperCase()}` : ''}</b>
          </div>
        </header>

        <div className="ps-scroll ps-pad">
          <h1 className="ps-page-title">♻️ O que registrar?</h1>
          <p className="ps-page-lead">Escolha entre sobras (não move estoque) ou descarte (debita do estoque da loja).</p>

          <div style={{display:'flex', flexDirection:'column', gap:12}}>
            <button onClick={()=>setMode('sobra')} className="ps-report-card" style={{textAlign:'left'}}>
              <div className="icon"><Package size={28}/></div>
              <h3>Registrar Sobras</h3>
              <p>O que sobrou no fechamento. Não move estoque (sobras podem voltar à venda).</p>
            </button>
            <button onClick={()=>setMode('descarte')} className="ps-report-card" style={{textAlign:'left'}}>
              <div className="icon"><Trash2 size={26}/></div>
              <h3>Registrar Descarte</h3>
              <p>
                O que foi descartado. {user.store
                  ? `Pães debitam do estoque da loja ${user.store.toUpperCase()}.`
                  : 'Sem loja atribuída — não move estoque (admin/teste).'}
              </p>
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  // ── FORM ──
  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <button className="ps-iconbtn" onClick={()=>{setMode(null);setQtys({})}} aria-label="Voltar">
              <ChevronLeft size={20}/>
            </button>
            <div className="ps-mark">P</div>
            <div className="ps-brand">
              <b>{mode==='sobra' ? 'Sobras' : 'Descartes'}</b>
              <span>{todayLabel()}</span>
            </div>
          </div>
          <div className="ps-userchip">
            <div className="ps-avatar" style={{background: roleColor(user.role)}}>{userDisplay.charAt(0).toUpperCase()}</div>
            <b>{userDisplay}{user.store ? ` / ${user.store.toUpperCase()}` : ''}</b>
          </div>
        </header>

        <div className="ps-scroll ps-pad">
          {breads.length > 0 && (
            <>
              <div className="ps-label">🍞 Pães do dia</div>
              <div style={{display:'flex', flexDirection:'column', gap:8}}>
                {breads.map(b=>(
                  <ItemRow key={'bread_'+b.id} id={'bread_'+b.id} name={b.name} unit={b.unit} qty={qtys['bread_'+b.id]||0} onChange={setQty}/>
                ))}
              </div>
            </>
          )}

          {Object.entries(grouped).map(([cat, items])=>(
            <div key={cat}>
              <div className="ps-label">{cat}</div>
              <div style={{display:'flex', flexDirection:'column', gap:8}}>
                {items.map(p=>(
                  <ItemRow key={p.id} id={p.id} name={p.name} unit={p.unit} qty={qtys[p.id]||0} onChange={setQty}/>
                ))}
              </div>
            </div>
          ))}

          {breads.length === 0 && Object.keys(grouped).length === 0 && (
            <div className="ps-empty">Sem itens pra registrar hoje.</div>
          )}
        </div>

        <div className="ps-totalbar">
          <div className="ps-total-num">
            <b>{filled}</b>
            <span>item{filled!==1?'s':''} preenchido{filled!==1?'s':''}</span>
          </div>
          <button className="ps-save" onClick={save} disabled={saving || filled===0}>
            {saving ? <span className="ps-spinner" style={{width:16,height:16,borderWidth:2}}/> : <><Save size={16}/> Salvar</>}
          </button>
        </div>
      </div>
    </div>
  )
}

function ItemRow({ id, name, unit, qty, onChange }: { id:string; name:string; unit:string|null; qty:number; onChange:(id:string,v:number)=>void }) {
  return (
    <div className={`ps-card ${qty>0?'active':''}`} style={{padding:'12px 14px', gap:8}}>
      <div className="ps-card-head" style={{flexDirection:'row', alignItems:'center', justifyContent:'space-between', gap:10}}>
        <div style={{flex:1, minWidth:0}}>
          <div className="ps-pname" style={{fontSize:14.5}}>{name}</div>
          {unit && <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:2}}>{unit}</div>}
        </div>
        <div className="ps-stepper" style={{flex:'none'}}>
          <button className="ps-step" style={{width:36, height:36}} onClick={()=>onChange(id, qty-1)} disabled={qty<=0} aria-label="Diminuir">
            <Minus size={16}/>
          </button>
          <input className={`ps-qty ${qty===0?'zero':''}`} style={{width:64, height:36, fontSize:15}}
            type="number" value={qty||''} min={0} step={0.1} placeholder="0"
            onChange={e=>onChange(id, parseFloat(e.target.value)||0)}/>
          <button className="ps-step" style={{width:36, height:36}} onClick={()=>onChange(id, qty+1)} aria-label="Aumentar">
            <Plus size={16}/>
          </button>
        </div>
      </div>
    </div>
  )
}
