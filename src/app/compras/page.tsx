'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { formatDate, showToast } from '@/lib/utils'

const TG_TOKEN  = '8765075650:AAH42hOI1M3BnYunUmczyOJUkUNaysah5v8'
const TG_CHAT_ID = '688149907'
const OWNER_PWD = 'pane2025'
const SECTOR_LABELS: Record<string,string> = { padaria:'🥖 Padaria', cozinha:'🍳 Cozinha', loja:'🏪 Loja' }
const USERS = [
  { name:'Geolar', sector:'padaria', icon:'👨‍🍳' },
  { name:'Fran',   sector:'cozinha', icon:'👩‍🍳' },
  { name:'Liara',  sector:'loja',    icon:'🏪'   },
  { name:'Elis',   sector:'loja',    icon:'🏪'   },
]

interface PurchaseList { id:string; sector:string; status:string; submitted_at:string|null; submitted_by:string|null; completed_at:string|null }
interface PurchaseItem { id:string; list_id:string; product_id:string|null; ad_hoc_name:string|null; unit:string|null; quantity:number|null; checked:boolean; is_adhoc:boolean; sort_order:number; products?: { name:string } }

export default function ComprasPage() {
  const [user, setUser]     = useState<string|null>(null)
  const [sector, setSector] = useState<string|null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [ownerPwd, setOwnerPwd] = useState('')
  const [showOwnerLogin, setShowOwnerLogin] = useState(false)
  const [list, setList]     = useState<PurchaseList|null>(null)
  const [items, setItems]   = useState<PurchaseItem[]>([])
  const [filter, setFilter] = useState<'all'|'pending'|'filled'>('all')
  const [adhocName, setAdhocName] = useState('')
  const [adhocUnit, setAdhocUnit] = useState('')
  const [saving, setSaving] = useState(false)
  const [allProducts, setAllProducts] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [ownerView, setOwnerView] = useState<'overview'|'detail'>('overview')
  const [ownerLists, setOwnerLists] = useState<any[]>([])
  const [ownerItems, setOwnerItems] = useState<PurchaseItem[]>([])
  const [ownerList, setOwnerList] = useState<PurchaseList|null>(null)
  const [ownerFilter, setOwnerFilter] = useState<'all'|'unchecked'|'checked'|'noqty'>('all')

  const loadList = useCallback(async () => {
    if (!sector) return
    const { data: lists } = await supabase.from('purchase_lists').select('*').eq('sector', sector)
    if (!lists?.length) return
    setList(lists[0])
    const { data: its } = await supabase.from('purchase_items')
      .select('*,products(name)').eq('list_id', lists[0].id).order('sort_order').order('created_at')
    setItems(its||[])
  }, [sector])

  useEffect(() => { if (sector) loadList() }, [sector, loadList])
  useEffect(() => {
    supabase.from('products').select('id,name,category,unit').eq('active',true).order('name')
      .then(({data})=>setAllProducts(data||[]))
  }, [])

  const updateQty = async (itemId: string, val: string) => {
    const qty = val === '' ? null : parseFloat(val)
    await supabase.from('purchase_items').update({ quantity: qty }).eq('id', itemId)
    setItems(prev => prev.map(i => i.id===itemId ? {...i,quantity:qty} : i))
  }

  const addAdhoc = async () => {
    if (!adhocName.trim() || !list) return
    const { data } = await supabase.from('purchase_items').insert({
      list_id: list.id, ad_hoc_name: adhocName, unit: adhocUnit||null, is_adhoc: true, sort_order: 9999
    }).select('*')
    if (data) { setItems(prev=>[...prev,...data]); setAdhocName(''); setAdhocUnit('') }
    showToast('✅ Item adicionado')
  }

  const deleteItem = async (id: string) => {
    if (!confirm('Remover?')) return
    await supabase.from('purchase_items').delete().eq('id', id)
    setItems(prev=>prev.filter(i=>i.id!==id))
  }

  const submit = async () => {
    const filled = items.filter(i=>i.quantity)
    if (!filled.length) { showToast('Nenhum item com quantidade'); return }
    if (!confirm(`Enviar lista com ${filled.length} item(s)?`)) return
    setSaving(true)
    await supabase.from('purchase_lists').update({ status:'submitted', submitted_at: new Date().toISOString(), submitted_by: user }).eq('id', list!.id)
    setList(prev => prev ? {...prev, status:'submitted'} : prev)
    await sendTelegram(filled)
    showToast('✅ Lista enviada!'); setSaving(false)
  }

  const editList = async () => {
    await supabase.from('purchase_lists').update({ status:'draft', submitted_at:null, submitted_by:null }).eq('id', list!.id)
    setList(prev => prev ? {...prev, status:'draft'} : prev)
    showToast('✏️ Lista aberta para edição')
  }

  const resetList = async () => {
    if (!confirm('Iniciar novo ciclo?')) return
    await supabase.from('purchase_items').update({ quantity:null, checked:false }).eq('list_id', list!.id)
    await supabase.from('purchase_lists').update({ status:'draft', submitted_at:null, submitted_by:null, completed_at:null }).eq('id', list!.id)
    setList(prev => prev ? {...prev, status:'draft'} : prev)
    setItems(prev => prev.map(i=>({...i,quantity:null,checked:false})))
    showToast('🔄 Novo ciclo iniciado')
  }

  const sendTelegram = async (filled: PurchaseItem[]) => {
    const lines = filled.map(i=>`• ${i.is_adhoc?i.ad_hoc_name:i.products?.name||'?'}: ${i.quantity} ${i.unit||''}`)
    const msg = `🛒 *Nova lista de compras!*\n\n👤 *${user}* — ${SECTOR_LABELS[sector!]}\n📋 ${filled.length} itens\n\n${lines.slice(0,25).join('\n')}${lines.length>25?`\n_...+${lines.length-25}_`:''}\n\n🔗 pane-producao.vercel.app/compras`
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ chat_id: TG_CHAT_ID, text: msg, parse_mode:'Markdown' }) }).catch(()=>{})
  }

  const addFromSearch = async (p: any) => {
    if (!list) return
    const { data } = await supabase.from('purchase_items').insert({ list_id:list.id, product_id:p.id, unit:p.unit||null, sort_order:9000 }).select('*,products(name)')
    if (data) setItems(prev=>[...prev,...data])
    setSearch(''); showToast('✅ Produto adicionado')
  }

  // OWNER
  const loadOwnerOverview = async () => {
    const { data: ls } = await supabase.from('purchase_lists').select('*').order('sector')
    const withCounts = await Promise.all((ls||[]).map(async l => {
      const { data: its } = await supabase.from('purchase_items').select('id,quantity,checked').eq('list_id',l.id)
      return { ...l, total:(its||[]).length, filled:(its||[]).filter((i:any)=>i.quantity).length, checked:(its||[]).filter((i:any)=>i.checked).length }
    }))
    setOwnerLists(withCounts)
  }

  const openOwnerDetail = async (l: PurchaseList) => {
    setOwnerList(l)
    const { data } = await supabase.from('purchase_items').select('*,products(name)').eq('list_id',l.id).order('sort_order').order('created_at')
    setOwnerItems(data||[]); setOwnerFilter('all'); setOwnerView('detail')
  }

  const toggleCheck = async (itemId: string, cur: boolean) => {
    await supabase.from('purchase_items').update({ checked: !cur }).eq('id', itemId)
    setOwnerItems(prev=>prev.map(i=>i.id===itemId?{...i,checked:!cur}:i))
  }

  const completeList = async () => {
    if (!confirm('Finalizar lista?')) return
    await supabase.from('purchase_lists').update({ status:'completed', completed_at:new Date().toISOString() }).eq('id', ownerList!.id)
    setOwnerList(prev=>prev?{...prev,status:'completed'}:prev)
    showToast('✅ Lista finalizada!')
  }

  const ownerReset = async () => {
    if (!confirm('Reiniciar ciclo?')) return
    await supabase.from('purchase_items').update({ quantity:null, checked:false }).eq('list_id', ownerList!.id)
    await supabase.from('purchase_lists').update({ status:'draft', submitted_at:null, submitted_by:null, completed_at:null }).eq('id', ownerList!.id)
    setOwnerList(prev=>prev?{...prev,status:'draft'}:prev)
    setOwnerItems(prev=>prev.map(i=>({...i,quantity:null,checked:false})))
    showToast('🔄 Ciclo reiniciado')
  }

  useEffect(()=>{ if(isOwner) loadOwnerOverview() },[isOwner])

  const filtered = items.filter(i => filter==='pending'?(!i.quantity&&!i.is_adhoc):filter==='filled'?!!i.quantity:true)
  const ownerFiltered = ownerItems.filter(i => ownerFilter==='unchecked'?(i.quantity&&!i.checked):ownerFilter==='checked'?i.checked:ownerFilter==='noqty'?!i.quantity:(!!i.quantity||i.is_adhoc))
  const filledCount = items.filter(i=>!!i.quantity).length
  const readonly = list?.status !== 'draft'
  const searchResults = search.length>1 ? allProducts.filter(p=>!items.find(i=>i.product_id===p.id)&&p.name.toLowerCase().includes(search.toLowerCase())).slice(0,8) : []

  // ── LOGIN ──
  if (!user && !isOwner) return (
    <div style={{padding:'20px',maxWidth:500,margin:'0 auto',textAlign:'center'}}>
      <div style={{fontSize:'2.5rem',marginBottom:8}}>🥐</div>
      <div style={{fontWeight:700,fontSize:'1.3rem',color:'var(--primary)',marginBottom:4}}>Pane & Salute</div>
      <div style={{color:'var(--muted)',marginBottom:30,fontSize:'.9rem'}}>Lista de Compras</div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,maxWidth:360,margin:'0 auto 20px'}}>
        {USERS.map(u=>(
          <button key={u.name} onClick={()=>{setUser(u.name);setSector(u.sector)}} style={{background:'white',border:'2px solid var(--border)',borderRadius:'var(--radius)',padding:'18px 12px',cursor:'pointer',textAlign:'center'}}>
            <div style={{fontSize:'1.8rem',marginBottom:4}}>{u.icon}</div>
            <div style={{fontWeight:700,color:'var(--primary)'}}>{u.name}</div>
            <div style={{fontSize:'.75rem',color:'var(--muted)'}}>{SECTOR_LABELS[u.sector]}</div>
          </button>
        ))}
      </div>
      <button onClick={()=>setShowOwnerLogin(!showOwnerLogin)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--muted)',fontSize:'.85rem',textDecoration:'underline'}}>🔑 Acesso do responsável</button>
      {showOwnerLogin && (
        <div style={{marginTop:16}}>
          <input type="password" placeholder="Senha" value={ownerPwd} onChange={e=>setOwnerPwd(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&(ownerPwd===OWNER_PWD?setIsOwner(true):showToast('Senha incorreta'))}
            style={{width:'100%',maxWidth:280,padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'1rem',marginBottom:8}}/>
          <br/>
          <button className="btn btn-primary" onClick={()=>ownerPwd===OWNER_PWD?setIsOwner(true):showToast('Senha incorreta')}>Entrar</button>
        </div>
      )}
    </div>
  )

  // ── OWNER OVERVIEW ──
  if (isOwner && ownerView==='overview') return (
    <div style={{padding:'20px',maxWidth:600,margin:'0 auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <span style={{fontWeight:700,color:'var(--primary)'}}>👑 Visão Geral — Compras</span>
        <button onClick={()=>{setIsOwner(false);setUser(null)}} style={{background:'none',border:'none',cursor:'pointer',color:'var(--muted)',fontSize:'.85rem'}}>Sair</button>
      </div>
      {ownerLists.map((l:any)=>(
        <div key={l.id} onClick={()=>openOwnerDetail(l)} style={{background:'white',borderRadius:'var(--radius)',border:`2px solid ${l.status==='submitted'?'var(--warning)':l.status==='completed'?'var(--success)':'var(--border)'}`,padding:16,marginBottom:12,cursor:'pointer'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontWeight:700,color:'var(--primary)'}}>{SECTOR_LABELS[l.sector]||l.sector}</span>
            <span style={{fontSize:'.72rem',fontWeight:700,padding:'3px 10px',borderRadius:20,background:l.status==='submitted'?'#fff3cd':l.status==='completed'?'#d4edda':'#f0f0f0',color:l.status==='submitted'?'#856404':l.status==='completed'?'var(--success)':'var(--muted)'}}>
              {l.status==='submitted'?'Enviada':l.status==='completed'?'Concluída':'Rascunho'}
            </span>
          </div>
          <div style={{fontSize:'.8rem',color:'var(--muted)',marginTop:4}}>{l.filled>0?`${l.filled} itens · ${l.checked} comprados`:'Nenhum item preenchido'}</div>
          {l.filled>0 && <div style={{height:4,background:'var(--border)',borderRadius:2,marginTop:8}}><div style={{height:'100%',background:'var(--success)',borderRadius:2,width:`${Math.round((l.checked/l.filled)*100)}%`}}/></div>}
        </div>
      ))}
    </div>
  )

  // ── OWNER DETAIL ──
  if (isOwner && ownerView==='detail' && ownerList) {
    const oFilled = ownerItems.filter(i=>i.quantity); const oChecked = ownerItems.filter(i=>i.checked)
    return (
      <div style={{padding:'16px',maxWidth:600,margin:'0 auto'}}>
        <button onClick={()=>{setOwnerView('overview');loadOwnerOverview()}} style={{background:'none',border:'none',cursor:'pointer',color:'var(--muted)',marginBottom:12,fontSize:'.9rem'}}>← Voltar</button>
        <div style={{fontWeight:700,color:'var(--primary)',marginBottom:4}}>{SECTOR_LABELS[ownerList.sector]}</div>
        <div style={{fontSize:'.85rem',color:'var(--muted)',marginBottom:12}}>{oChecked.length}/{oFilled.length} comprados</div>
        {ownerList.status==='submitted' && <div className="status-banner status-submitted">⏳ Enviado por <strong>{ownerList.submitted_by}</strong> em {formatDate(ownerList.submitted_at||'')}</div>}
        <div style={{display:'flex',gap:6,marginBottom:12,flexWrap:'wrap'}}>
          {(['all','unchecked','checked','noqty'] as const).map(f=>(
            <button key={f} onClick={()=>setOwnerFilter(f)} style={{padding:'5px 10px',borderRadius:20,border:'1.5px solid var(--border)',background:ownerFilter===f?'var(--primary)':'white',color:ownerFilter===f?'white':'var(--text)',fontSize:'.78rem',cursor:'pointer'}}>
              {f==='all'?'Todos':f==='unchecked'?'Pendentes':f==='checked'?'Comprados':'Sem qtd.'}
            </button>
          ))}
        </div>
        <div className="card">
          {ownerFiltered.map(i=>{
            const nm = i.is_adhoc?i.ad_hoc_name:(i.products?.name||'—')
            const qty = i.quantity?(i.quantity+' '+(i.unit||'')).trim():null
            return (
              <div key={i.id} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 0',borderBottom:'1px solid var(--border)'}}>
                <div onClick={()=>ownerList.status==='submitted'&&toggleCheck(i.id,i.checked)}
                  style={{width:24,height:24,border:'2px solid var(--border)',borderRadius:'50%',cursor:ownerList.status==='submitted'?'pointer':'default',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',background:i.checked?'var(--success)':'white',borderColor:i.checked?'var(--success)':'var(--border)',color:'white',fontSize:'.85rem'}}>
                  {i.checked?'✓':''}
                </div>
                <div style={{flex:1,fontSize:'.88rem',textDecoration:i.checked?'line-through':'none',color:i.checked?'var(--muted)':'inherit'}}>{nm}</div>
                <div style={{fontSize:'.88rem',fontWeight:700,color:qty?'var(--primary)':'var(--muted)',fontStyle:qty?'normal':'italic'}}>{qty||'sem qtd.'}</div>
              </div>
            )
          })}
        </div>
        <div style={{marginTop:16}}>
          {ownerList.status==='submitted' && <button className="btn btn-success btn-full" onClick={completeList}>✅ Finalizar lista ({oChecked.length}/{oFilled.length})</button>}
          {ownerList.status==='completed' && <button className="btn btn-outline btn-full" onClick={ownerReset}>🔄 Reiniciar ciclo</button>}
          {ownerList.status==='draft' && <div style={{textAlign:'center',color:'var(--muted)',fontSize:'.85rem'}}>Aguardando envio do setor {SECTOR_LABELS[ownerList.sector]}.</div>}
        </div>
      </div>
    )
  }

  // ── USER LIST ──
  return (
    <div style={{padding:'16px',maxWidth:600,margin:'0 auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <span style={{fontWeight:700,color:'var(--primary)'}}>{SECTOR_LABELS[sector!]} — {user}</span>
        <button onClick={()=>{setUser(null);setSector(null)}} style={{background:'none',border:'none',cursor:'pointer',color:'var(--muted)',fontSize:'.8rem'}}>Trocar</button>
      </div>
      {list?.status==='submitted' && <div className="status-banner status-submitted">⏳ Lista enviada em {formatDate(list.submitted_at||'')} por {list.submitted_by}. Aguardando compras.</div>}
      {list?.status==='completed' && <div className="status-banner status-completed">✅ Lista concluída!</div>}

      <div style={{fontSize:'.85rem',color:'var(--muted)',marginBottom:10}}>{filledCount}/{items.length} com quantidade</div>

      <div style={{display:'flex',gap:6,marginBottom:12}}>
        {(['all','pending','filled'] as const).map(f=>(
          <button key={f} onClick={()=>setFilter(f)} style={{padding:'5px 10px',borderRadius:20,border:'1.5px solid var(--border)',background:filter===f?'var(--primary)':'white',color:filter===f?'white':'var(--text)',fontSize:'.78rem',cursor:'pointer'}}>
            {f==='all'?'Todos':f==='pending'?'Sem qtd.':'Com qtd.'}
          </button>
        ))}
      </div>

      {!readonly && sector!=='padaria' && (
        <div className="card" style={{marginBottom:12}}>
          <div style={{position:'relative'}}>
            <input placeholder="🔍 Buscar produto para adicionar..." value={search} onChange={e=>setSearch(e.target.value)}
              style={{width:'100%',padding:'9px 12px',border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem'}}/>
            {searchResults.length>0 && (
              <div style={{position:'absolute',top:'100%',left:0,right:0,background:'white',border:'1px solid var(--border)',borderRadius:'0 0 8px 8px',zIndex:50,maxHeight:180,overflowY:'auto'}}>
                {searchResults.map((p:any)=>(
                  <div key={p.id} onClick={()=>addFromSearch(p)} style={{padding:'9px 12px',cursor:'pointer',fontSize:'.88rem',borderBottom:'1px solid var(--border)'}}>
                    <div>{p.name}</div><div style={{fontSize:'.72rem',color:'var(--muted)'}}>{p.category}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card">
        {filtered.length===0 ? <div style={{textAlign:'center',padding:30,color:'var(--muted)'}}>Nenhum item neste filtro.</div> :
          filtered.map(i=>{
            const nm = i.is_adhoc?i.ad_hoc_name:(i.products?.name||'—')
            return (
              <div key={i.id} style={{display:'flex',alignItems:'center',gap:8,padding:'9px 0',borderBottom:'1px solid var(--border)'}}>
                <div style={{flex:1,fontSize:'.9rem',fontWeight:600}}>
                  {nm}
                  {i.is_adhoc && <span style={{fontSize:'.7rem',background:'#e8f4fd',color:'#1a6fa3',borderRadius:4,padding:'1px 5px',marginLeft:4}}>avulso</span>}
                  {i.unit && <div style={{fontSize:'.72rem',color:'var(--muted)'}}>{i.unit}</div>}
                </div>
                <input type="number" defaultValue={i.quantity||''} placeholder="qtd" min={0} step={0.1} disabled={readonly}
                  onBlur={e=>updateQty(i.id,e.target.value)}
                  style={{width:70,textAlign:'center',padding:'6px',border:'1.5px solid var(--border)',borderRadius:6,fontSize:'.9rem',background:i.quantity?'#fff8f0':'white',borderColor:i.quantity?'var(--primary-light)':'var(--border)'}}/>
                {i.is_adhoc && !readonly && <button onClick={()=>deleteItem(i.id)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--muted)',fontSize:'.9rem'}}>✕</button>}
              </div>
            )
          })
        }
        {!readonly && (
          <div style={{borderTop:'1px dashed var(--border)',paddingTop:12,marginTop:12}}>
            <div style={{fontSize:'.75rem',fontWeight:700,color:'var(--muted)',textTransform:'uppercase',marginBottom:8}}>Adicionar item avulso</div>
            <div style={{display:'flex',gap:6}}>
              <input placeholder="Nome do item..." value={adhocName} onChange={e=>setAdhocName(e.target.value)}
                style={{flex:1,padding:'8px',border:'1.5px solid var(--border)',borderRadius:6,fontSize:'.85rem'}}/>
              <input placeholder="un." value={adhocUnit} onChange={e=>setAdhocUnit(e.target.value)}
                style={{width:55,padding:'8px',border:'1.5px solid var(--border)',borderRadius:6,fontSize:'.82rem',textAlign:'center'}}/>
              <button onClick={addAdhoc} style={{padding:'8px 12px',background:'var(--primary)',color:'white',border:'none',borderRadius:6,cursor:'pointer',fontSize:'.85rem'}}>+</button>
            </div>
          </div>
        )}
      </div>

      <div style={{marginTop:12}}>
        {!readonly ? (
          <>
            <button className="btn btn-success btn-full" onClick={submit} disabled={saving||filledCount===0}>
              {saving?<span className="spinner"/>:`📤 Enviar Lista (${filledCount} item${filledCount!==1?'s':''})`}
            </button>
            <button className="btn btn-ghost btn-full" onClick={async()=>{ await supabase.from('purchase_items').update({quantity:null}).eq('list_id',list!.id); setItems(prev=>prev.map(i=>({...i,quantity:null}))); showToast('Quantidades limpas') }}>🔄 Limpar quantidades</button>
          </>
        ) : list?.status==='submitted' ? (
          <>
            <button className="btn btn-outline btn-full" onClick={editList}>✏️ Editar / Corrigir lista</button>
            <button className="btn btn-ghost btn-full" onClick={resetList}>🔄 Novo ciclo (limpar tudo)</button>
          </>
        ) : (
          <button className="btn btn-outline btn-full" onClick={resetList}>🔄 Novo ciclo (limpar tudo)</button>
        )}
      </div>
    </div>
  )
}
