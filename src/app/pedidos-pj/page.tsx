'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser } from '@/lib/auth'
import { showToast } from '@/lib/utils'

// ===== Tipos =====
interface Customer {
  id:string; name:string; default_tier_id:string|null;
  discount_pct:number; delivery_hours:number; active:boolean
}
interface PriceTier { id:string; name:string }
interface TierItem {
  id:string; tier_id:string; product_id:string; product_source:'bread'|'product';
  product_name:string; unit_price:number; pricing_unit:'un'|'kg'; pack_size:number; active:boolean
}
interface Override {
  id:string; customer_id:string; product_id:string; product_source:'bread'|'product';
  product_name:string; unit_price:number; pricing_unit:'un'|'kg'; pack_size:number; active:boolean
}

// Item visível no autocomplete (já com preço efetivo do cliente)
interface CatalogItem {
  product_id:string; product_source:'bread'|'product'; product_name:string;
  unit_price:number; pricing_unit:'un'|'kg'; pack_size:number; isOverride:boolean
}

// Linha em montagem (no form do novo pedido)
interface OrderLine {
  key:string
  product_id:string; product_source:'bread'|'product'; product_name:string
  unit_price:number; pricing_unit:'un'|'kg'; pack_size:number
  packs:number  // input do user (pacotes)
}

// Pedido salvo agrupado (cliente+data_entrega+data_implantação = 1 pedido lógico)
interface OrderRow {
  id:string
  customer_id:string|null; pj_client:string|null
  order_date:string; delivery_date:string|null; production_date:string|null
  bread_id:string; product_source:string|null; product_name:string|null
  quantity:number; unit_price:number|null; pack_size:number|null; pricing_unit:string|null
  obs:string|null
}
interface PedidoGroup {
  key:string
  customer_id:string|null; customer_name:string
  order_date:string; delivery_date:string|null; production_date:string|null
  obs:string|null
  rows:OrderRow[]
  total:number
}

// ===== Helpers de data =====
function todayISO(): string {
  const d = new Date(); d.setHours(12,0,0,0)
  return d.toISOString().slice(0,10)
}
function addDays(dateStr:string, days:number): string {
  const d = new Date(dateStr + 'T12:00:00'); d.setDate(d.getDate()+days)
  return d.toISOString().slice(0,10)
}
function isSunday(dateStr:string): boolean {
  if (!dateStr) return false
  return new Date(dateStr + 'T12:00:00').getDay() === 0
}
function nextNonSunday(dateStr:string): string {
  let d = dateStr; while (isSunday(d)) d = addDays(d, 1); return d
}
function defaultDelivery(customerHours:number): string {
  const days = Math.ceil((customerHours || 48) / 24)
  return nextNonSunday(addDays(todayISO(), days))
}
function defaultProduction(deliveryDate:string): string {
  // 24h antes; produção pode cair em qualquer dia (inclusive domingo)
  return addDays(deliveryDate, -1)
}
function fmtBR(dateStr:string|null): string {
  if (!dateStr) return '—'
  const [y,m,d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

// ===== Componente =====
export default function PedidosPJPage() {
  const [user, setUser] = useState<{displayName:string}|null>(null)
  const [tab, setTab] = useState<'novo'|'lista'>('novo')

  // Dados base
  const [customers, setCustomers] = useState<Customer[]>([])
  const [tiers, setTiers]         = useState<PriceTier[]>([])
  const [items, setItems]         = useState<TierItem[]>([])
  const [overrides, setOverrides] = useState<Override[]>([])
  const [orders, setOrders]       = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)

  // Form novo pedido
  const [custId, setCustId]    = useState<string>('')
  const [delivery, setDelivery] = useState<string>('')
  const [production, setProduction] = useState<string>('')
  const [obs, setObs] = useState('')
  const [lines, setLines] = useState<OrderLine[]>([])
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)

  // Visualizando pedido na lista
  const [viewing, setViewing] = useState<PedidoGroup|null>(null)

  useEffect(() => {
    const u = getCurrentUser()
    if (u) setUser({ displayName: u.displayName })
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [cRes, tRes, iRes, oRes, ordRes] = await Promise.all([
      supabase.from('customers').select('*').eq('active',true).order('name'),
      supabase.from('price_tiers').select('id,name').eq('active',true),
      supabase.from('price_tier_items').select('*').eq('active',true),
      supabase.from('customer_price_overrides').select('*').eq('active',true),
      supabase.from('orders').select('*').eq('order_type','pj').order('order_date',{ascending:false}).limit(500),
    ])
    setCustomers((cRes.data||[]) as Customer[])
    setTiers((tRes.data||[]) as PriceTier[])
    setItems((iRes.data||[]) as TierItem[])
    setOverrides((oRes.data||[]) as Override[])
    setOrders((ordRes.data||[]) as OrderRow[])
    setLoading(false)
  }, [])
  useEffect(() => { loadAll() }, [loadAll])

  // ===== Catálogo do cliente selecionado =====
  const cust = customers.find(c => c.id === custId) || null
  const custTier = cust && tiers.find(t => t.id === cust.default_tier_id) || null

  const custCatalog = useMemo<CatalogItem[]>(() => {
    if (!cust) return []
    const ovMap = new Map<string, Override>()
    overrides.filter(o => o.customer_id === cust.id).forEach(o => ovMap.set(`${o.product_source}_${o.product_id}`, o))
    const tierItemsMap = new Map<string, TierItem>()
    if (custTier) items.filter(i => i.tier_id === custTier.id).forEach(i => tierItemsMap.set(`${i.product_source}_${i.product_id}`, i))

    const seen = new Set<string>()
    const result: CatalogItem[] = []
    // Override tem prioridade sobre tier
    ovMap.forEach((o, k) => {
      seen.add(k)
      result.push({
        product_id:o.product_id, product_source:o.product_source, product_name:o.product_name,
        unit_price:o.unit_price, pricing_unit:o.pricing_unit, pack_size:o.pack_size, isOverride:true,
      })
    })
    tierItemsMap.forEach((t, k) => {
      if (seen.has(k)) return
      const finalPrice = t.unit_price * (1 - (cust.discount_pct||0)/100)
      result.push({
        product_id:t.product_id, product_source:t.product_source, product_name:t.product_name,
        unit_price:Number(finalPrice.toFixed(2)), pricing_unit:t.pricing_unit, pack_size:t.pack_size, isOverride:false,
      })
    })
    return result.sort((a,b) => a.product_name.localeCompare(b.product_name))
  }, [cust, custTier, items, overrides])

  // ===== Seleção de cliente preenche datas =====
  const selectCustomer = (id:string) => {
    setCustId(id)
    const c = customers.find(x => x.id === id)
    if (!c) { setDelivery(''); setProduction(''); setLines([]); return }
    const d = defaultDelivery(c.delivery_hours)
    setDelivery(d)
    setProduction(defaultProduction(d))
    setLines([])  // reset linhas ao trocar cliente
    setSearch('')
  }

  const changeDelivery = (newDate:string) => {
    if (isSunday(newDate)) { showToast('⚠️ Entrega não pode cair em domingo'); return }
    if (newDate < todayISO()) { showToast('⚠️ Entrega não pode ser no passado'); return }
    setDelivery(newDate)
    setProduction(defaultProduction(newDate))
  }
  const changeProduction = (newDate:string) => {
    if (newDate < todayISO()) { showToast('⚠️ Produção não pode ser no passado'); return }
    setProduction(newDate)
  }

  // ===== Linhas do pedido =====
  const filteredCatalog = useMemo(() => {
    const used = new Set(lines.map(l => `${l.product_source}_${l.product_id}`))
    const avail = custCatalog.filter(c => !used.has(`${c.product_source}_${c.product_id}`))
    if (search.trim().length < 1) return avail.slice(0, 20)
    const q = search.toLowerCase()
    return avail.filter(c => c.product_name.toLowerCase().includes(q)).slice(0, 20)
  }, [custCatalog, lines, search])

  const addLine = (c:CatalogItem) => {
    setLines(prev => [...prev, {
      key: `${c.product_source}_${c.product_id}_${Date.now()}`,
      product_id:c.product_id, product_source:c.product_source, product_name:c.product_name,
      unit_price:c.unit_price, pricing_unit:c.pricing_unit, pack_size:c.pack_size,
      packs: 1,
    }])
    setSearch('')
  }
  const updateLine = (key:string, patch:Partial<OrderLine>) => {
    setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l))
  }
  const removeLine = (key:string) => setLines(prev => prev.filter(l => l.key !== key))

  const totalValue = useMemo(() => lines.reduce((sum,l) => sum + (l.unit_price * l.pack_size * l.packs), 0), [lines])

  // ===== Salvar pedido =====
  const savePedido = async () => {
    if (!cust) { showToast('Selecione cliente'); return }
    if (!delivery) { showToast('Data de entrega obrigatória'); return }
    if (isSunday(delivery)) { showToast('Entrega não pode ser em domingo'); return }
    if (lines.length === 0) { showToast('Adicione ao menos 1 produto'); return }
    if (lines.some(l => l.packs <= 0)) { showToast('Quantidade inválida'); return }

    setSaving(true)
    const rows = lines.map(l => ({
      store: 'pj',
      order_type: 'pj',
      bread_id: l.product_id,  // text genérico — aponta pra breads.id ou products.id
      product_source: l.product_source,
      product_name: l.product_name,
      quantity: l.packs * l.pack_size,  // total em unidades
      unit_price: l.unit_price,
      pack_size: l.pack_size,
      pricing_unit: l.pricing_unit,
      customer_id: cust.id,
      pj_client: cust.name,  // fallback de display
      order_date: todayISO(),
      delivery_date: delivery,
      production_date: production || defaultProduction(delivery),
      pj_delivery_date: delivery,  // compat com código antigo
      obs: obs.trim() || null,
    }))
    const { error } = await supabase.from('orders').insert(rows)
    setSaving(false)
    if (error) { showToast('Erro: ' + error.message); return }
    showToast(`✅ Pedido criado — ${lines.length} produto(s) · R$ ${totalValue.toFixed(2)}`)
    // Reset form
    setCustId(''); setDelivery(''); setProduction(''); setObs(''); setLines([]); setSearch('')
    setTab('lista')
    loadAll()
  }

  // ===== Lista de pedidos agrupada =====
  const pedidosGrouped = useMemo<PedidoGroup[]>(() => {
    const groups = new Map<string, PedidoGroup>()
    orders.forEach(r => {
      const key = `${r.customer_id || r.pj_client || '?'}__${r.order_date}__${r.delivery_date || ''}`
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          customer_id: r.customer_id,
          customer_name: r.customer_id ? (customers.find(c => c.id === r.customer_id)?.name || r.pj_client || '?') : (r.pj_client || '?'),
          order_date: r.order_date,
          delivery_date: r.delivery_date,
          production_date: r.production_date,
          obs: r.obs,
          rows: [],
          total: 0,
        })
      }
      const g = groups.get(key)!
      g.rows.push(r)
      g.total += (Number(r.unit_price)||0) * (Number(r.quantity)||0)
    })
    return Array.from(groups.values()).sort((a,b) => {
      if (a.delivery_date && b.delivery_date) return b.delivery_date.localeCompare(a.delivery_date)
      return b.order_date.localeCompare(a.order_date)
    })
  }, [orders, customers])

  const groupStatus = (g:PedidoGroup): {label:string; color:string; bg:string} => {
    const t = todayISO()
    if (!g.delivery_date) return { label:'sem data', color:'#6b7280', bg:'#f3f4f6' }
    if (g.delivery_date < t) return { label:'entregue', color:'#6b7280', bg:'#f3f4f6' }
    if (g.production_date && g.production_date <= t && g.delivery_date >= t) return { label:'em produção', color:'#0a6e52', bg:'#dcfce7' }
    return { label:'agendado', color:'#1e40af', bg:'#dbeafe' }
  }

  const adiantarHoje = async (g:PedidoGroup) => {
    if (!confirm(`Adiantar pedido de "${g.customer_name}" pra hoje?\n\nProdução e entrega serão movidas pra ${fmtBR(todayISO())}.`)) return
    const today = todayISO()
    if (isSunday(today)) { showToast('⚠️ Hoje é domingo, entrega não permitida'); return }
    const { error } = await supabase.from('orders').update({
      production_date: today,
      delivery_date: today,
      pj_delivery_date: today,
    }).in('id', g.rows.map(r => r.id))
    if (error) { showToast('Erro: ' + error.message); return }
    showToast('✅ Pedido adiantado pra hoje')
    setViewing(null)
    loadAll()
  }

  // ===== UI =====

  return (
    <div style={{maxWidth:900,margin:'0 auto'}}>
      <div style={{padding:'14px 16px',background:'var(--primary)',color:'white',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
        <span style={{fontWeight:700}}>📋 Pedidos PJ</span>
        {user && <span style={{fontSize:'.78rem',opacity:.85}}>{user.displayName}</span>}
      </div>

      <div style={{display:'flex',borderBottom:'2px solid var(--border)'}}>
        {(['novo','lista'] as const).map(t => (
          <button key={t} onClick={()=>setTab(t)}
            style={{flex:1,padding:'10px',border:'none',background:'none',cursor:'pointer',
              fontWeight:tab===t?700:400,color:tab===t?'var(--primary)':'var(--muted)',
              borderBottom:tab===t?'2px solid var(--primary)':'2px solid transparent',marginBottom:-2,fontSize:'.88rem'}}>
            {t==='novo' ? '+ Novo pedido' : '📋 Lista de pedidos'}
          </button>
        ))}
      </div>

      <div style={{padding:16}}>
        {loading ? (
          <div style={{padding:40,textAlign:'center',color:'var(--muted)'}}>Carregando...</div>
        ) : tab === 'novo' ? (
          // ===== ABA NOVO PEDIDO =====
          <>
            <div style={{background:'white',padding:14,borderRadius:10,border:'1px solid var(--border)',marginBottom:14}}>
              <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600}}>Cliente *</label>
              <select value={custId} onChange={e=>selectCustomer(e.target.value)}
                style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem',background:'white',marginBottom:10}}>
                <option value="">— selecionar cliente —</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>

              {cust && (
                <>
                  <div style={{fontSize:'.8rem',color:'var(--muted)',marginBottom:10,padding:'6px 10px',background:'#eff6ff',borderRadius:6}}>
                    Tabela: <strong>{custTier?.name || '— sem tabela —'}</strong>
                    {cust.discount_pct > 0 && <span style={{marginLeft:8,color:'#166534',fontWeight:600}}>· -{cust.discount_pct}% global</span>}
                    <span style={{marginLeft:8,color:'var(--muted)'}}>· entrega default {cust.delivery_hours}h</span>
                  </div>

                  <div style={{display:'flex',gap:10,marginBottom:10,flexWrap:'wrap'}}>
                    <div style={{flex:1,minWidth:160}}>
                      <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600}}>Data de entrega *</label>
                      <input type="date" value={delivery} onChange={e=>changeDelivery(e.target.value)}
                        min={todayISO()}
                        style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem'}}/>
                      {delivery && <div style={{fontSize:'.72rem',color:'var(--muted)',marginTop:3}}>{fmtBR(delivery)}</div>}
                    </div>
                    <div style={{flex:1,minWidth:160}}>
                      <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600}}>Data de produção</label>
                      <input type="date" value={production} onChange={e=>changeProduction(e.target.value)}
                        min={todayISO()}
                        style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem'}}/>
                      {production && <div style={{fontSize:'.72rem',color:'var(--muted)',marginTop:3}}>{fmtBR(production)}</div>}
                    </div>
                  </div>

                  <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600}}>Observações</label>
                  <textarea value={obs} onChange={e=>setObs(e.target.value)}
                    placeholder="Notas pro padeiro/expedição (opcional)"
                    style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem',minHeight:50,resize:'vertical'}}/>
                </>
              )}
            </div>

            {cust && !custTier && (
              <div style={{padding:14,background:'#fef3c7',color:'#92400e',borderRadius:8,marginBottom:14,fontSize:'.85rem'}}>
                ⚠️ Cliente sem tabela de preço. Vá em <strong>/clientes</strong> e atribua uma tabela.
              </div>
            )}

            {cust && custTier && custCatalog.length === 0 && (
              <div style={{padding:14,background:'#fef3c7',color:'#92400e',borderRadius:8,marginBottom:14,fontSize:'.85rem'}}>
                ⚠️ Tabela <strong>{custTier.name}</strong> sem produtos cadastrados. Vá em <strong>/tabelas-preco</strong>.
              </div>
            )}

            {cust && custCatalog.length > 0 && (
              <>
                <div style={{position:'relative',marginBottom:14}}>
                  <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600}}>+ Adicionar produto</label>
                  <input value={search} onChange={e=>setSearch(e.target.value)}
                    placeholder="Digite ou clique pra ver produtos da tabela"
                    onFocus={()=>setSearch(search)}
                    style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem'}}/>
                  {filteredCatalog.length > 0 && (
                    <div style={{position:'absolute',top:'100%',left:0,right:0,background:'white',border:'1px solid var(--border)',borderRadius:'0 0 8px 8px',zIndex:50,maxHeight:280,overflowY:'auto',boxShadow:'0 4px 12px rgba(0,0,0,.08)'}}>
                      {filteredCatalog.map(c => (
                        <div key={`${c.product_source}_${c.product_id}`} onClick={()=>addLine(c)}
                          style={{padding:'9px 12px',cursor:'pointer',fontSize:'.88rem',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                          <span>
                            {c.product_name}
                            {c.product_source === 'bread' && <span style={{marginLeft:6,background:'#fef3c7',color:'#92400e',padding:'1px 5px',borderRadius:3,fontSize:'.6rem',fontWeight:700}}>🥖</span>}
                            {c.isOverride && <span style={{marginLeft:6,background:'#fde68a',color:'#92400e',padding:'1px 5px',borderRadius:3,fontSize:'.6rem',fontWeight:700}}>override</span>}
                          </span>
                          <span style={{fontSize:'.78rem',color:'var(--muted)'}}>R$ {c.unit_price.toFixed(2)}/{c.pricing_unit} · pack {c.pack_size}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {lines.length === 0 ? (
                  <div style={{padding:30,textAlign:'center',color:'var(--muted)',background:'white',borderRadius:10,border:'1px dashed var(--border)'}}>
                    Adicione produtos da tabela do cliente
                  </div>
                ) : (
                  <div style={{display:'grid',gap:10,marginBottom:14}}>
                    {lines.map(l => {
                      const totalQty = l.packs * l.pack_size
                      const totalVal = l.unit_price * totalQty
                      return (
                        <div key={l.key} style={{background:'white',borderRadius:10,padding:'12px 14px',border:'1px solid var(--border)'}}>
                          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8,gap:8}}>
                            <div style={{flex:1,minWidth:0,fontWeight:700,fontSize:'.92rem'}}>
                              {l.product_name}
                              {l.product_source === 'bread' && <span style={{marginLeft:6,background:'#fef3c7',color:'#92400e',padding:'1px 5px',borderRadius:3,fontSize:'.6rem',fontWeight:700}}>🥖</span>}
                              <span style={{marginLeft:8,fontSize:'.75rem',color:'var(--muted)',fontWeight:400}}>R$ {l.unit_price.toFixed(2)}/{l.pricing_unit}</span>
                            </div>
                            <button onClick={()=>removeLine(l.key)} title="Remover"
                              style={{background:'none',border:'none',cursor:'pointer',fontSize:'1rem',color:'#dc2626',padding:0}}>🗑</button>
                          </div>
                          <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
                            <label style={{fontSize:'.78rem',color:'var(--muted)'}}>
                              Pack: <input type="number" min={1} step={1} value={l.pack_size}
                                onChange={e=>updateLine(l.key, { pack_size: Math.max(1, Number(e.target.value)||1) })}
                                style={{width:60,padding:'4px 6px',border:'1px solid var(--border)',borderRadius:4,fontSize:'.85rem',textAlign:'center',marginLeft:4}}/>
                            </label>
                            <label style={{fontSize:'.78rem',color:'var(--muted)'}}>
                              Qtd: <input type="number" min={1} step={1} value={l.packs}
                                onChange={e=>updateLine(l.key, { packs: Math.max(1, Number(e.target.value)||1) })}
                                style={{width:60,padding:'4px 6px',border:'1px solid var(--border)',borderRadius:4,fontSize:'.85rem',textAlign:'center',marginLeft:4}}/> pacotes
                            </label>
                            <span style={{fontSize:'.82rem',color:'var(--text)',fontWeight:600}}>
                              = {totalQty} {l.pricing_unit}
                            </span>
                            <span style={{marginLeft:'auto',fontSize:'.92rem',fontWeight:700,color:'var(--primary)'}}>
                              R$ {totalVal.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {lines.length > 0 && (
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 16px',background:'#f0fdf4',borderRadius:10,border:'1px solid #86efac',marginBottom:14}}>
                    <span style={{fontWeight:700,fontSize:'.92rem'}}>Total do pedido</span>
                    <span style={{fontWeight:700,fontSize:'1.2rem',color:'#0a6e52'}}>R$ {totalValue.toFixed(2)}</span>
                  </div>
                )}

                <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                  <button onClick={()=>{ setCustId(''); setLines([]); setObs(''); setSearch('') }} disabled={saving}
                    style={{padding:'10px 16px',background:'white',border:'1.5px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:'.88rem',fontWeight:600}}>
                    Limpar
                  </button>
                  <button onClick={savePedido} disabled={saving || lines.length===0}
                    style={{padding:'10px 20px',background:'var(--primary)',color:'white',border:'none',borderRadius:8,cursor:(saving||lines.length===0)?'default':'pointer',fontSize:'.9rem',fontWeight:700,opacity:(saving||lines.length===0)?0.6:1}}>
                    {saving ? 'Salvando...' : 'Salvar pedido'}
                  </button>
                </div>
              </>
            )}
          </>
        ) : (
          // ===== ABA LISTA =====
          <>
            <div style={{fontSize:'.85rem',color:'var(--muted)',marginBottom:12}}>
              {pedidosGrouped.length} pedido(s) PJ no histórico
            </div>
            {pedidosGrouped.length === 0 ? (
              <div style={{padding:40,textAlign:'center',color:'var(--muted)'}}>Nenhum pedido PJ ainda.</div>
            ) : (
              <div style={{display:'grid',gap:10}}>
                {pedidosGrouped.map(g => {
                  const st = groupStatus(g)
                  return (
                    <div key={g.key} onClick={()=>setViewing(g)}
                      style={{background:'white',borderRadius:10,padding:'12px 14px',border:'1px solid var(--border)',borderLeft:`4px solid ${st.color}`,cursor:'pointer'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6,gap:8,flexWrap:'wrap'}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:700,fontSize:'.95rem'}}>{g.customer_name}</div>
                          <div style={{fontSize:'.75rem',color:'var(--muted)',marginTop:2}}>
                            Implantado {fmtBR(g.order_date)} · Produção {fmtBR(g.production_date)} · Entrega {fmtBR(g.delivery_date)}
                          </div>
                        </div>
                        <span style={{padding:'3px 8px',background:st.bg,color:st.color,borderRadius:20,fontSize:'.7rem',fontWeight:700}}>
                          {st.label}
                        </span>
                      </div>
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:'.82rem'}}>
                        <span style={{color:'var(--muted)'}}>{g.rows.length} item(ns)</span>
                        <span style={{fontWeight:700,color:'var(--primary)'}}>R$ {g.total.toFixed(2)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal de visualização */}
      {viewing && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:16}}
             onClick={e=>e.target===e.currentTarget&&setViewing(null)}>
          <div style={{background:'white',borderRadius:12,padding:20,maxWidth:540,width:'100%',maxHeight:'90vh',overflowY:'auto'}}>
            <div style={{fontWeight:700,fontSize:'1.05rem',marginBottom:6}}>{viewing.customer_name}</div>
            <div style={{fontSize:'.82rem',color:'var(--muted)',marginBottom:14}}>
              Implantado {fmtBR(viewing.order_date)} · Produção {fmtBR(viewing.production_date)} · Entrega {fmtBR(viewing.delivery_date)}
            </div>

            <div style={{display:'grid',gap:6,marginBottom:14}}>
              {viewing.rows.map(r => (
                <div key={r.id} style={{display:'flex',justifyContent:'space-between',padding:'6px 10px',background:'#f9fafb',borderRadius:6,fontSize:'.85rem'}}>
                  <span>
                    {r.product_name || r.bread_id}
                    <span style={{marginLeft:6,fontSize:'.72rem',color:'var(--muted)'}}>
                      {r.pack_size && r.pack_size > 1 ? `${Math.round((r.quantity||0)/r.pack_size)}×pack${r.pack_size}` : ''}
                    </span>
                  </span>
                  <span>
                    <span style={{color:'var(--muted)',fontSize:'.78rem',marginRight:6}}>{r.quantity} {r.pricing_unit || 'un'}</span>
                    <strong>R$ {((Number(r.unit_price)||0) * (Number(r.quantity)||0)).toFixed(2)}</strong>
                  </span>
                </div>
              ))}
            </div>

            <div style={{display:'flex',justifyContent:'space-between',padding:'10px 14px',background:'#f0fdf4',borderRadius:8,marginBottom:14,fontWeight:700}}>
              <span>Total</span>
              <span style={{color:'#0a6e52'}}>R$ {viewing.total.toFixed(2)}</span>
            </div>

            {viewing.obs && (
              <div style={{padding:'8px 10px',background:'#fffbeb',borderRadius:6,fontSize:'.82rem',color:'#92400e',marginBottom:14}}>
                <strong>Obs:</strong> {viewing.obs}
              </div>
            )}

            <div style={{display:'flex',gap:8,justifyContent:'flex-end',flexWrap:'wrap'}}>
              <button onClick={()=>setViewing(null)}
                style={{padding:'10px 16px',background:'white',border:'1.5px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:'.88rem',fontWeight:600}}>
                Fechar
              </button>
              {viewing.production_date && viewing.production_date > todayISO() && (
                <button onClick={()=>adiantarHoje(viewing)}
                  style={{padding:'10px 18px',background:'#f59e0b',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:'.88rem',fontWeight:700}}>
                  ⚡ Adiantar pra hoje
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
