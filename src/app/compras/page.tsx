'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, Plus, X, Send, Copy, Pencil, RotateCw, Check, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AppUser, getCurrentUser, firstAllowedRoute, roleColor } from '@/lib/auth'
import { formatDate, showToast } from '@/lib/utils'
import { ModulePaused } from '@/components/ModulePaused'
import { COMPRAS_COTACOES_PAUSADAS } from '@/lib/features'
import { resolvePurchaseAccess } from './access'

const TG_TOKEN = process.env.NEXT_PUBLIC_TELEGRAM_BOT_TOKEN!
const TG_CHAT_ID = process.env.NEXT_PUBLIC_TELEGRAM_CHAT_ID!
const SECTOR_LABELS: Record<string,string> = { padaria:'🥖 Padaria', cozinha:'🍳 Cozinha', loja:'🏪 Loja' }

interface PurchaseList { id:string; sector:string; status:string; submitted_at:string|null; submitted_by:string|null; completed_at:string|null }
interface PurchaseItem { id:string; list_id:string; product_id:string|null; ad_hoc_name:string|null; unit:string|null; quantity:number|null; checked:boolean; is_adhoc:boolean; sort_order:number; products?: { name:string } }

export default function ComprasPage() {
  return COMPRAS_COTACOES_PAUSADAS
    ? <ModulePaused/>
    : <ComprasAtivasPage/>
}

function ComprasAtivasPage() {
  const router = useRouter()
  const [authUser, setAuthUser] = useState<AppUser | null>(null)
  const [user, setUser]     = useState<{ name: string; id: string }|null>(null)
  const [sector, setSector] = useState<string|null>(null)
  const [isOwner, setIsOwner] = useState(false)
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

  useEffect(() => {
    const u = getCurrentUser()
    if (!u) { router.replace('/login'); return }
    setAuthUser(u)
    const r = resolvePurchaseAccess(u)
    if (r.isOwner) {
      setIsOwner(true)
      setUser({ name: u.displayName, id: u.id })
    } else if (r.sector) {
      setSector(r.sector)
      setUser({ name: u.displayName, id: u.id })
    } else {
      router.replace(firstAllowedRoute(u))
    }
  }, [router])

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
    // Só insumos + produtos marcados como revenda (Fase E). Kits e finais
    // não-revenda não aparecem na lista pra adicionar.
    supabase.from('products').select('id,name,category,unit').eq('active',true)
      .or('kind.eq.insumo,is_revenda.eq.true').order('name')
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
    if (!user) return
    const filled = items.filter(i=>i.quantity)
    if (!filled.length) { showToast('Nenhum item com quantidade'); return }
    if (!confirm(`Enviar lista com ${filled.length} item(s)?`)) return
    setSaving(true)
    await supabase.from('purchase_lists').update({ status:'submitted', submitted_at: new Date().toISOString(), submitted_by: user.name }).eq('id', list!.id)
    setList(prev => prev ? {...prev, status:'submitted'} : prev)
    const tgOk = await sendTelegram(filled)
    showToast(tgOk ? '✅ Lista enviada!' : '⚠️ Lista salva, mas notificação não foi')
    setSaving(false)
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

  const sendTelegram = async (filled: PurchaseItem[]): Promise<boolean> => {
    if (!user || !sector) return false
    const lines = filled.map(i=>`• ${i.is_adhoc?i.ad_hoc_name:i.products?.name||'?'}: ${i.quantity} ${i.unit||''}`)
    const msg = `🛒 *Nova lista de compras!*\n\n👤 *${user.name}* — ${SECTOR_LABELS[sector]}\n📋 ${filled.length} itens\n\n${lines.slice(0,25).join('\n')}${lines.length>25?`\n_...+${lines.length-25}_`:''}\n\n🔗 pane-producao.vercel.app/compras`
    try {
      const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ chat_id: TG_CHAT_ID, text: msg, parse_mode:'Markdown' }) })
      if (!res.ok) {
        console.error('[compras] Telegram retornou', res.status, await res.text().catch(()=>''))
        return false
      }
      return true
    } catch (e) {
      console.error('[compras] Telegram erro de rede:', e)
      return false
    }
  }

  const copyAsText = (sourceItems: PurchaseItem[], sec: string, submittedBy?: string|null) => {
    const filled = sourceItems.filter(i => i.quantity)
    if (!filled.length) { showToast('Nenhum item com quantidade'); return }
    const today = new Date().toLocaleDateString('pt-BR')
    const who = submittedBy || user?.name || '—'
    const header = `🛒 Lista de Compras — ${SECTOR_LABELS[sec] || sec}\n👤 ${who} · ${today}\n\n`
    const lines = filled.map(i => {
      const nm = i.is_adhoc ? i.ad_hoc_name : (i.products?.name || '?')
      const unit = i.unit ? ' ' + i.unit : ''
      return `• ${nm}: ${i.quantity}${unit}`
    })
    const footer = `\n\n${filled.length} ${filled.length === 1 ? 'item' : 'itens'}`
    const text = header + lines.join('\n') + footer
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(()=>showToast('📋 Copiado!')).catch(()=>prompt('Copie:', text))
    } else {
      prompt('Copie:', text)
    }
  }

  const addFromSearch = async (p: any) => {
    if (!list) return
    const { data } = await supabase.from('purchase_items').insert({ list_id:list.id, product_id:p.id, unit:p.unit||null, sort_order:9000 }).select('*,products(name)')
    if (data) setItems(prev=>[...prev,...data])
    setSearch(''); showToast('✅ Produto adicionado')
  }

  // OWNER
  const [generatingQuote, setGeneratingQuote] = useState(false)

  const loadOwnerOverview = async () => {
    const { data: ls } = await supabase.from('purchase_lists').select('*').order('sector')
    const withCounts = await Promise.all((ls||[]).map(async l => {
      const { data: its } = await supabase.from('purchase_items').select('id,quantity,checked').eq('list_id',l.id)
      return { ...l, total:(its||[]).length, filled:(its||[]).filter((i:any)=>i.quantity).length, checked:(its||[]).filter((i:any)=>i.checked).length }
    }))
    setOwnerLists(withCounts)
  }

  // Gera cotação agregando items das listas submitted+completed.
  // Itens são agrupados por product_id (mesmo produto pedido por +1 setor soma quantidades).
  // Fornecedores são populados via supplier_products (M:N). A mensagem por fornecedor
  // é gerada na F4 — aqui só prepara as rows.
  const gerarCotacao = async () => {
    if (!user) return
    setGeneratingQuote(true)
    try {
      const { data: lists } = await supabase.from('purchase_lists')
        .select('id').in('status', ['submitted','completed'])
      const listIds = (lists || []).map((l:any) => l.id)
      if (listIds.length === 0) { showToast('Nenhuma lista submetida pra cotar'); return }

      const { data: items } = await supabase.from('purchase_items')
        .select('product_id,quantity,unit')
        .in('list_id', listIds)
        .not('product_id', 'is', null)
        .gt('quantity', 0)
      if (!items || items.length === 0) { showToast('Sem itens preenchidos nas listas'); return }

      // Agrega por product_id
      const agg = new Map<string, { quantity: number; unit: string | null }>()
      for (const it of items as any[]) {
        const cur = agg.get(it.product_id) || { quantity: 0, unit: it.unit }
        cur.quantity += Number(it.quantity || 0)
        if (!cur.unit && it.unit) cur.unit = it.unit
        agg.set(it.product_id, cur)
      }

      const today = new Date().toISOString().slice(0, 10)
      const { data: q, error: qErr } = await supabase.from('quotations')
        .insert({ week_reference: today, created_by: user.name, status: 'draft' })
        .select().single()
      if (qErr || !q) { showToast('Erro: '+(qErr?.message||'sem id')); return }

      const itemRows = Array.from(agg.entries()).map(([product_id, info]) => ({
        quotation_id: q.id, product_id, quantity: info.quantity, unit: info.unit
      }))
      const { error: itErr } = await supabase.from('quotation_items').insert(itemRows)
      if (itErr) { showToast('Erro itens: '+itErr.message); return }

      const productIds = Array.from(agg.keys())
      // !inner garante que só vêm mapeamentos cujo supplier ainda está ativo.
      // toggleActive em /fornecedores só toca suppliers.active — supplier_products
      // ficam intactos (e devem mesmo, pra reativação preservar o mapeamento).
      const { data: maps } = await supabase.from('supplier_products')
        .select('supplier_id,product_id,suppliers!inner(active)')
        .in('product_id', productIds)
        .eq('active', true)
        .eq('suppliers.active', true)
      const supplierIds = Array.from(new Set((maps || []).map((m:any) => m.supplier_id)))
      if (supplierIds.length > 0) {
        const supRows = supplierIds.map(sid => ({
          quotation_id: q.id, supplier_id: sid, status: 'pending', channel: 'whatsapp'
        }))
        const { error: supErr } = await supabase.from('quotation_suppliers').insert(supRows)
        if (supErr) { showToast('Erro fornecedores: '+supErr.message); return }
      }

      const orphans = productIds.length - (new Set((maps || []).map((m:any) => m.product_id)).size)
      showToast(`✅ Cotação criada: ${itemRows.length} itens, ${supplierIds.length} fornecedores${orphans > 0 ? ` (${orphans} sem fornecedor)` : ''}`)
    } finally {
      setGeneratingQuote(false)
    }
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
  // 'all' mostra TODOS os itens da lista, inclusive os sem quantidade (ex: produto incluído
  // mas sem qtd) — pra compradora ver fielmente tudo que o setor colocou, não só o preenchido.
  const ownerFiltered = ownerItems.filter(i => ownerFilter==='unchecked'?(i.quantity&&!i.checked):ownerFilter==='checked'?i.checked:ownerFilter==='noqty'?!i.quantity:true)
  const filledCount = items.filter(i=>!!i.quantity).length
  const readonly = list?.status !== 'draft'
  const searchResults = search.length>1 ? allProducts.filter(p=>!items.find(i=>i.product_id===p.id)&&p.name.toLowerCase().includes(search.toLowerCase())).slice(0,8) : []

  if (!user) return (
    <div className="ps-loading">
      <div className="ps-spinner"/>
      <p>Carregando...</p>
    </div>
  )

  const statusCls = (status: string) => status==='submitted' ? 'enviado' : status==='completed' ? 'conferido' : 'separado'
  const statusLabel = (status: string) => status==='submitted' ? 'Enviada' : status==='completed' ? 'Concluída' : 'Rascunho'

  function PsHeader({ subtitle, onBack }: { subtitle?: string; onBack?: () => void }) {
    return (
      <header className="ps-header">
        <div className="ps-wordmark">
          {onBack && (
            <button className="ps-iconbtn" onClick={onBack} aria-label="Voltar">
              <ChevronLeft size={20}/>
            </button>
          )}
          <div className="ps-mark">P</div>
          <div className="ps-brand">
            <b>Compras</b>
            {subtitle && <span>{subtitle}</span>}
          </div>
        </div>
        {authUser && (
          <div className="ps-userchip">
            <div className="ps-avatar" style={{background: roleColor(authUser.role)}}>{authUser.displayName.charAt(0).toUpperCase()}</div>
            <b>{authUser.displayName}</b>
          </div>
        )}
      </header>
    )
  }

  // ── OWNER OVERVIEW ──
  if (isOwner && ownerView==='overview') return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <PsHeader subtitle="Visão geral"/>
        <div className="ps-scroll ps-pad">
          <h1 className="ps-page-title">👑 Listas por setor</h1>
          <p className="ps-page-lead">Aguardando rascunhos, enviadas pra comprar e concluídas.</p>

          <button onClick={gerarCotacao} disabled={generatingQuote} className="ps-btn primary block" style={{marginBottom:8}}>
            {generatingQuote ? '⏳ Gerando…' : '📋 Gerar cotação das listas enviadas'}
          </button>
          <Link href="/cotacoes" className="ps-btn ghost block" style={{marginBottom:14, textAlign:'center'}}>
            📑 Ver cotações criadas
          </Link>

          <div style={{display:'flex', flexDirection:'column', gap:12}}>
            {ownerLists.map((l:any)=>{
              const borderColor = l.status==='submitted' ? 'var(--honey-deep)'
                                : l.status==='completed' ? 'var(--sage)'
                                : 'var(--ps-line)'
              return (
                <div key={l.id} onClick={()=>openOwnerDetail(l)} className="ps-card" style={{borderLeft:`4px solid ${borderColor}`, cursor:'pointer'}}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:8}}>
                    <span className="ps-pname">{SECTOR_LABELS[l.sector]||l.sector}</span>
                    <span className={`ps-status ${statusCls(l.status)}`}>{statusLabel(l.status)}</span>
                  </div>
                  <div style={{fontSize:13, color:'var(--ink-soft)'}}>
                    {l.filled>0 ? `${l.filled} itens · ${l.checked} comprados` : 'Nenhum item preenchido'}
                  </div>
                  {l.filled>0 && (
                    <div style={{height:5, background:'var(--ps-line)', borderRadius:3, overflow:'hidden'}}>
                      <div style={{height:'100%', background:'var(--sage)', width:`${Math.round((l.checked/l.filled)*100)}%`}}/>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )

  // ── OWNER DETAIL ──
  if (isOwner && ownerView==='detail' && ownerList) {
    const oFilled = ownerItems.filter(i=>i.quantity); const oChecked = ownerItems.filter(i=>i.checked)
    return (
      <div className="ps-canvas">
        <div className="ps-shell">
          <PsHeader subtitle={SECTOR_LABELS[ownerList.sector]} onBack={()=>{setOwnerView('overview');loadOwnerOverview()}}/>
          <div className="ps-scroll ps-pad">
            <h1 className="ps-page-title">{SECTOR_LABELS[ownerList.sector]}</h1>
            <p className="ps-page-lead">{oChecked.length}/{oFilled.length} comprados</p>

            {ownerList.status==='submitted' && (
              <div className="ps-banner honey">
                ⏳ Enviado por <b>{ownerList.submitted_by}</b> em {formatDate(ownerList.submitted_at||'')}
              </div>
            )}
            {ownerList.status==='completed' && (
              <div className="ps-banner crust">✅ Lista concluída!</div>
            )}

            <div className="ps-presets" style={{marginTop:14, marginBottom:14}}>
              {(['all','unchecked','checked','noqty'] as const).map(f=>(
                <button key={f} onClick={()=>setOwnerFilter(f)} className={`ps-preset ${ownerFilter===f?'active':''}`}>
                  {f==='all'?'Todos':f==='unchecked'?'Pendentes':f==='checked'?'Comprados':'Sem qtd.'}
                </button>
              ))}
            </div>

            <div className="ps-card" style={{padding:'4px 14px'}}>
              {ownerFiltered.length === 0 ? (
                <div className="ps-empty">Nenhum item neste filtro.</div>
              ) : ownerFiltered.map(i=>{
                const nm = i.is_adhoc?i.ad_hoc_name:(i.products?.name||'—')
                const qty = i.quantity?(i.quantity+' '+(i.unit||'')).trim():null
                const canCheck = true  // marcar comprado em qualquer status — não depende do setor "Enviar"
                return (
                  <div key={i.id} style={{display:'flex', alignItems:'center', gap:10, padding:'10px 0', borderBottom:'1px solid var(--line-soft)'}}>
                    <button onClick={()=>canCheck && toggleCheck(i.id, i.checked)} disabled={!canCheck}
                      style={{width:26, height:26, border:'2px solid', borderRadius:'50%', cursor:canCheck?'pointer':'default', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', background:i.checked?'var(--sage)':'var(--cream-raise)', borderColor:i.checked?'var(--sage)':'var(--ps-line)', color:'#fff', padding:0}}>
                      {i.checked && <Check size={14}/>}
                    </button>
                    <div style={{flex:1, fontSize:14, textDecoration:i.checked?'line-through':'none', color:i.checked?'var(--ink-faint)':'var(--ps-ink)', fontWeight:600}}>{nm}</div>
                    <div style={{fontSize:13, fontWeight:700, color:qty?'var(--crust)':'var(--ink-faint)', fontStyle:qty?'normal':'italic', fontVariantNumeric:'tabular-nums'}}>{qty||'sem qtd.'}</div>
                  </div>
                )
              })}
            </div>

            <div style={{marginTop:16, display:'flex', flexDirection:'column', gap:8}}>
              <button className="ps-btn ghost block" onClick={()=>copyAsText(ownerItems, ownerList.sector, ownerList.submitted_by)} disabled={oFilled.length===0}>
                <Copy size={14}/> Copiar texto
              </button>
              {ownerList.status!=='completed' && (
                <button className="ps-btn success block" onClick={completeList}>
                  <Check size={16}/> Finalizar lista ({oChecked.length}/{oFilled.length})
                </button>
              )}
              {ownerList.status==='completed' && (
                <button className="ps-btn ghost block" onClick={ownerReset}>
                  <RotateCw size={14}/> Reiniciar ciclo
                </button>
              )}
              {ownerList.status==='draft' && (
                <div style={{textAlign:'center', color:'var(--ink-faint)', fontSize:12.5}}>
                  Setor ainda não enviou — você já pode marcar e comprar mesmo assim.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── USER LIST ──
  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <PsHeader subtitle={sector ? SECTOR_LABELS[sector] : ''}/>
        <div className="ps-scroll ps-pad">
          {list?.status==='submitted' && (
            <div className="ps-banner honey" style={{marginTop:14}}>
              ⏳ Lista enviada em {formatDate(list.submitted_at||'')} por <b>{list.submitted_by}</b>. Aguardando compras.
            </div>
          )}
          {list?.status==='completed' && (
            <div className="ps-banner crust" style={{marginTop:14}}>✅ Lista concluída!</div>
          )}

          <div style={{fontSize:13, color:'var(--ink-soft)', marginTop:14, marginBottom:10}}>
            <b style={{color:'var(--ps-ink)'}}>{filledCount}</b>/{items.length} com quantidade
          </div>

          <div className="ps-presets" style={{marginBottom:12}}>
            {(['all','pending','filled'] as const).map(f=>(
              <button key={f} onClick={()=>setFilter(f)} className={`ps-preset ${filter===f?'active':''}`}>
                {f==='all'?'Todos':f==='pending'?'Sem qtd.':'Com qtd.'}
              </button>
            ))}
          </div>

          {!readonly && sector!=='padaria' && (
            <div className="ps-fieldgroup" style={{position:'relative', marginBottom:12}}>
              <div className="ps-fieldlabel">+ Adicionar produto</div>
              <div style={{position:'relative'}}>
                <Search size={14} style={{position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--ink-faint)', pointerEvents:'none'}}/>
                <input placeholder="Buscar produto..." value={search} onChange={e=>setSearch(e.target.value)}
                  className="ps-input" style={{width:'100%', padding:'8px 12px 8px 30px', fontSize:13}}/>
              </div>
              {searchResults.length>0 && (
                <div style={{position:'absolute', top:'100%', left:0, right:0, background:'var(--cream-raise)', border:'1px solid var(--ps-line)', borderRadius:'0 0 var(--r-ctrl) var(--r-ctrl)', zIndex:50, maxHeight:200, overflowY:'auto', boxShadow:'var(--sh-2)'}}>
                  {searchResults.map((p:any)=>(
                    <div key={p.id} onClick={()=>addFromSearch(p)}
                      style={{padding:'10px 12px', cursor:'pointer', fontSize:13, borderBottom:'1px solid var(--line-soft)', fontFamily:'var(--font-ui)'}}>
                      <div style={{fontWeight:600}}>{p.name}</div>
                      <div style={{fontSize:11, color:'var(--ink-faint)'}}>{p.category}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="ps-card" style={{padding:'4px 14px'}}>
            {filtered.length===0 ? (
              <div className="ps-empty">Nenhum item neste filtro.</div>
            ) : filtered.map(i=>{
              const nm = i.is_adhoc?i.ad_hoc_name:(i.products?.name||'—')
              return (
                <div key={i.id} style={{display:'flex', alignItems:'center', gap:8, padding:'10px 0', borderBottom:'1px solid var(--line-soft)'}}>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontSize:14, fontWeight:600, color:'var(--ps-ink)'}}>
                      {nm}
                      {i.is_adhoc && <span className="ps-store-chip ja" style={{marginLeft:6}}>avulso</span>}
                    </div>
                    {i.unit && <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:2}}>{i.unit}</div>}
                  </div>
                  <input type="number" defaultValue={i.quantity||''} placeholder="qtd" min={0} step={0.1} disabled={readonly}
                    onBlur={e=>updateQty(i.id, e.target.value)}
                    className={`ps-input ${i.quantity ? 'has-value' : ''}`}
                    style={{width:74, padding:'6px 8px', textAlign:'center', fontSize:14, fontWeight:700, background:i.quantity?'var(--honey-tint)':'var(--cream-raise)', borderColor:i.quantity?'var(--honey-line)':'var(--ps-line)'}}/>
                  {i.is_adhoc && !readonly && (
                    <button onClick={()=>deleteItem(i.id)} className="ps-iconbtn" style={{width:28, height:28, color:'var(--berry)'}} aria-label="Remover">
                      <X size={14}/>
                    </button>
                  )}
                </div>
              )
            })}
            {!readonly && (
              <div style={{borderTop:'1px dashed var(--ps-line)', paddingTop:12, marginTop:8, paddingBottom:8}}>
                <div className="ps-flabel" style={{marginBottom:6}}>+ Adicionar item avulso</div>
                <div style={{display:'flex', gap:6}}>
                  <input placeholder="Nome do item..." value={adhocName} onChange={e=>setAdhocName(e.target.value)}
                    className="ps-input" style={{flex:1, fontSize:13}}/>
                  <input placeholder="un." value={adhocUnit} onChange={e=>setAdhocUnit(e.target.value)}
                    className="ps-input" style={{width:60, textAlign:'center', fontSize:12}}/>
                  <button onClick={addAdhoc} className="ps-btn primary" disabled={!adhocName.trim()}>
                    <Plus size={14}/>
                  </button>
                </div>
              </div>
            )}
          </div>

          <div style={{marginTop:14, display:'flex', flexDirection:'column', gap:8}}>
            {!readonly ? (
              <>
                <button className="ps-btn success block" onClick={submit} disabled={saving || filledCount===0}>
                  {saving ? <span className="ps-spinner" style={{width:14, height:14, borderWidth:2}}/> : <><Send size={14}/> Enviar Lista ({filledCount} item{filledCount!==1?'s':''})</>}
                </button>
                <button className="ps-btn ghost block" onClick={()=>copyAsText(items, sector!)} disabled={filledCount===0}>
                  <Copy size={14}/> Copiar texto
                </button>
                <button className="ps-btn ghost block" onClick={async()=>{ await supabase.from('purchase_items').update({quantity:null}).eq('list_id',list!.id); setItems(prev=>prev.map(i=>({...i,quantity:null}))); showToast('Quantidades limpas') }}>
                  <RotateCw size={14}/> Limpar quantidades
                </button>
              </>
            ) : list?.status==='submitted' ? (
              <>
                <button className="ps-btn ghost block" onClick={()=>copyAsText(items, sector!, list?.submitted_by)}>
                  <Copy size={14}/> Copiar texto
                </button>
                <button className="ps-btn ghost block" onClick={editList}>
                  <Pencil size={14}/> Editar / Corrigir lista
                </button>
                <button className="ps-btn ghost block" onClick={resetList}>
                  <RotateCw size={14}/> Novo ciclo (limpar tudo)
                </button>
              </>
            ) : (
              <>
                <button className="ps-btn ghost block" onClick={()=>copyAsText(items, sector!)}>
                  <Copy size={14}/> Copiar texto
                </button>
                <button className="ps-btn ghost block" onClick={resetList}>
                  <RotateCw size={14}/> Novo ciclo (limpar tudo)
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
