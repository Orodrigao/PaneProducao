'use client'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Trash2, Save, Zap, X, Calendar, Pencil } from 'lucide-react'
import OrderCancellationPanel from '@/components/OrderCancellationPanel'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, roleColor, type AppUser } from '@/lib/auth'
import { showToast } from '@/lib/utils'
import { saleOptionKey, type PricingUnit } from '@/lib/saleOptions'
import { ensureOrderGroupId, pjOrderGroupKey } from '@/lib/orderGrouping'
import {
  canCancelOrder,
  cancellationAvailability,
  formatCancellationTimestamp,
  normalizeCancellationReason,
} from '@/lib/orderCancellation'
import { cancelOrderRows } from '@/lib/orderCancellationClient'

// ===== Tipos =====
interface Customer {
  id:string; name:string; default_tier_id:string|null;
  discount_pct:number; delivery_hours:number; active:boolean
}
interface PriceTier { id:string; name:string }
interface TierItem {
  id:string; tier_id:string; product_id:string; product_source:'bread'|'product';
  product_name:string; unit_price:number; pricing_unit:PricingUnit; pack_size:number; active:boolean; sale_option_id?:string|null
}
interface Override {
  id:string; customer_id:string; product_id:string; product_source:'bread'|'product';
  product_name:string; unit_price:number; pricing_unit:PricingUnit; pack_size:number; active:boolean; sale_option_id?:string|null
}

interface CatalogItem {
  product_id:string; product_source:'bread'|'product'; product_name:string;
  unit_price:number; pricing_unit:PricingUnit; pack_size:number; isOverride:boolean; sale_option_id?:string|null
}

interface OrderLine {
  key:string
  product_id:string; product_source:'bread'|'product'; product_name:string
  unit_price:number; pricing_unit:PricingUnit; pack_size:number; sale_option_id?:string|null
  packs:number
}

interface OrderRow {
  id:string
  order_group_id:string|null
  customer_id:string|null; pj_client:string|null
  order_date:string; delivery_date:string|null; production_date:string|null
  bread_id:string; product_source:string|null; product_name:string|null
  quantity:number; unit_price:number|null; pack_size:number|null; pricing_unit:string|null; sale_option_id:string|null
  obs:string|null
  cancelled_at:string|null; cancelled_by:string|null; cancel_reason:string|null
}
interface PedidoGroup {
  key:string
  order_group_id:string|null
  customer_id:string|null; customer_name:string
  order_date:string; delivery_date:string|null; production_date:string|null
  obs:string|null
  cancelled_at:string|null; cancelled_by:string|null; cancel_reason:string|null
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
  return addDays(deliveryDate, -1)
}
function fmtBR(dateStr:string|null): string {
  if (!dateStr) return '—'
  const [y,m,d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

export default function PedidosPJPage() {
  const [user, setUser] = useState<AppUser | null>(null)
  const [tab, setTab] = useState<'novo'|'lista'>('novo')

  const [customers, setCustomers] = useState<Customer[]>([])
  const [tiers, setTiers]         = useState<PriceTier[]>([])
  const [items, setItems]         = useState<TierItem[]>([])
  const [overrides, setOverrides] = useState<Override[]>([])
  const [orders, setOrders]       = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)

  const [custId, setCustId]    = useState<string>('')
  const [delivery, setDelivery] = useState<string>('')
  const [production, setProduction] = useState<string>('')
  const [obs, setObs] = useState('')
  const [lines, setLines] = useState<OrderLine[]>([])
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const [viewing, setViewing] = useState<PedidoGroup|null>(null)
  const [editing, setEditing] = useState<{ids:string[]; order_date:string; order_group_id:string|null}|null>(null)
  const [cancelling, setCancelling] = useState(false)
  const cancellingRef = useRef(false)

  useEffect(() => { setUser(getCurrentUser()) }, [])

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

  const cust = customers.find(c => c.id === custId) || null
  const custTier = cust && tiers.find(t => t.id === cust.default_tier_id) || null

  const custCatalog = useMemo<CatalogItem[]>(() => {
    if (!cust) return []
    const ovMap = new Map<string, Override>()
    overrides.filter(o => o.customer_id === cust.id).forEach(o => ovMap.set(saleOptionKey(o.product_source, o.product_id, o.sale_option_id), o))
    const tierItemsMap = new Map<string, TierItem>()
    if (custTier) items.filter(i => i.tier_id === custTier.id).forEach(i => tierItemsMap.set(saleOptionKey(i.product_source, i.product_id, i.sale_option_id), i))

    const seen = new Set<string>()
    const result: CatalogItem[] = []
    ovMap.forEach((o, k) => {
      seen.add(k)
      result.push({
        product_id:o.product_id, product_source:o.product_source, product_name:o.product_name,
        unit_price:o.unit_price, pricing_unit:o.pricing_unit, pack_size:o.pack_size, isOverride:true, sale_option_id:o.sale_option_id,
      })
    })
    tierItemsMap.forEach((t, k) => {
      if (seen.has(k)) return
      const finalPrice = t.unit_price * (1 - (cust.discount_pct||0)/100)
      result.push({
        product_id:t.product_id, product_source:t.product_source, product_name:t.product_name,
        unit_price:Number(finalPrice.toFixed(2)), pricing_unit:t.pricing_unit, pack_size:t.pack_size, isOverride:false, sale_option_id:t.sale_option_id,
      })
    })
    return result.sort((a,b) => a.product_name.localeCompare(b.product_name))
  }, [cust, custTier, items, overrides])

  const selectCustomer = (id:string) => {
    setCustId(id)
    const c = customers.find(x => x.id === id)
    if (!c) { setDelivery(''); setProduction(''); setLines([]); return }
    const d = defaultDelivery(c.delivery_hours)
    setDelivery(d)
    setProduction(defaultProduction(d))
    setLines([])
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

  const filteredCatalog = useMemo(() => {
    const used = new Set(lines.map(l => saleOptionKey(l.product_source, l.product_id, l.sale_option_id)))
    const avail = custCatalog.filter(c => !used.has(saleOptionKey(c.product_source, c.product_id, c.sale_option_id)))
    if (search.trim().length < 1) return avail.slice(0, 20)
    const q = search.toLowerCase()
    return avail.filter(c => c.product_name.toLowerCase().includes(q)).slice(0, 20)
  }, [custCatalog, lines, search])

  const addLine = (c:CatalogItem) => {
    setLines(prev => [...prev, {
      key: `${c.product_source}_${c.product_id}_${Date.now()}`,
      product_id:c.product_id, product_source:c.product_source, product_name:c.product_name,
      unit_price:c.unit_price, pricing_unit:c.pricing_unit, pack_size:c.pack_size,
      sale_option_id:c.sale_option_id,
      packs: 1,
    }])
    setSearch('')
    setSearchOpen(false)
  }
  const updateLine = (key:string, patch:Partial<OrderLine>) => {
    setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l))
  }
  const removeLine = (key:string) => setLines(prev => prev.filter(l => l.key !== key))

  const totalValue = useMemo(() => lines.reduce((sum,l) => sum + (l.unit_price * l.pack_size * l.packs), 0), [lines])

  const savePedido = async () => {
    if (!cust) { showToast('Selecione cliente'); return }
    if (!delivery) { showToast('Data de entrega obrigatória'); return }
    if (isSunday(delivery)) { showToast('Entrega não pode ser em domingo'); return }
    if (lines.length === 0) { showToast('Adicione ao menos 1 produto'); return }
    if (lines.some(l => l.packs <= 0)) { showToast('Quantidade inválida'); return }

    setSaving(true)
    const orderGroupId = ensureOrderGroupId(editing?.order_group_id)
    const rows = lines.map(l => ({
      store: 'pj',
      order_type: 'pj',
      order_group_id: orderGroupId,
      bread_id: l.product_id,
      product_source: l.product_source,
      product_name: l.product_name,
      quantity: l.packs * l.pack_size,
      unit_price: l.unit_price,
      pack_size: l.pack_size,
      pricing_unit: l.pricing_unit,
      ...(l.sale_option_id ? { sale_option_id: l.sale_option_id } : {}),
      customer_id: cust.id,
      pj_client: cust.name,
      order_date: editing ? editing.order_date : todayISO(),
      delivery_date: delivery,
      production_date: production || defaultProduction(delivery),
      pj_delivery_date: delivery,
      obs: obs.trim() || null,
    }))
    const { error } = await supabase.from('orders').insert(rows)
    if (error) { setSaving(false); showToast('Erro: ' + error.message); return }
    if (editing) await supabase.from('orders').delete().in('id', editing.ids)
    setSaving(false)
    showToast(editing ? `✅ Pedido atualizado — ${lines.length} produto(s) · R$ ${totalValue.toFixed(2)}` : `✅ Pedido criado — ${lines.length} produto(s) · R$ ${totalValue.toFixed(2)}`)
    setCustId(''); setDelivery(''); setProduction(''); setObs(''); setLines([]); setSearch(''); setEditing(null)
    setTab('lista')
    loadAll()
  }

  const startEdit = (g: PedidoGroup) => {
    if (g.cancelled_at || cancellingRef.current) return
    setCustId(g.customer_id || '')
    setDelivery(g.delivery_date || '')
    setProduction(g.production_date || '')
    setObs(g.obs || '')
    setLines(g.rows.map((r, i) => {
      const pack = Number(r.pack_size) || 1
      const qty  = Number(r.quantity) || 1
      return {
        key: `${r.product_source}_${r.bread_id}_${i}`,
        product_id: r.bread_id,
        product_source: (r.product_source === 'bread' ? 'bread' : 'product') as 'bread'|'product',
        product_name: r.product_name || r.bread_id,
        unit_price: Number(r.unit_price) || 0,
        pricing_unit: (r.pricing_unit === 'kg' ? 'kg' : 'un') as PricingUnit,
        pack_size: pack,
        sale_option_id: r.sale_option_id,
        packs: Math.round(qty / pack) || 1,
      }
    }))
    setEditing({ ids: g.rows.map(r => r.id), order_date: g.order_date, order_group_id: g.order_group_id })
    setSearch('')
    setViewing(null)
    setTab('novo')
  }

  const pedidosGrouped = useMemo<PedidoGroup[]>(() => {
    const groups = new Map<string, PedidoGroup>()
    orders.forEach(r => {
      const key = pjOrderGroupKey(r)
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          order_group_id: r.order_group_id,
          customer_id: r.customer_id,
          customer_name: r.customer_id ? (customers.find(c => c.id === r.customer_id)?.name || r.pj_client || '?') : (r.pj_client || '?'),
          order_date: r.order_date,
          delivery_date: r.delivery_date,
          production_date: r.production_date,
          obs: r.obs,
          cancelled_at: r.cancelled_at,
          cancelled_by: r.cancelled_by,
          cancel_reason: r.cancel_reason,
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

  const groupStatus = (g:PedidoGroup): { label:string; cls:string; border:string } => {
    if (g.cancelled_at) return { label:'cancelado', cls:'separado', border:'var(--ink-faint)' }
    const t = todayISO()
    if (!g.delivery_date) return { label:'sem data', cls:'separado', border:'var(--ps-line)' }
    if (g.delivery_date < t) return { label:'entregue', cls:'separado', border:'var(--ink-faint)' }
    if (g.production_date && g.production_date <= t && g.delivery_date >= t) return { label:'em produção', cls:'conferido', border:'var(--sage)' }
    return { label:'agendado', cls:'enviado', border:'var(--honey-deep)' }
  }

  const adiantarHoje = async (g:PedidoGroup) => {
    if (g.cancelled_at || cancellingRef.current) return
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

  const cancelPedido = async (g: PedidoGroup, rawReason: string): Promise<boolean> => {
    if (cancellingRef.current) return false
    if (!user || !canCancelOrder(user.role, 'pj')) {
      showToast('Você não tem permissão para cancelar pedidos PJ')
      return false
    }

    const availability = cancellationAvailability('pj', {
      productionDate: g.production_date,
      deliveryDate: g.delivery_date,
    })
    if (!availability.allowed) {
      showToast(availability.message || 'Cancelamento indisponível')
      return false
    }

    const reason = normalizeCancellationReason(rawReason)
    if (!reason) {
      showToast('Informe o motivo do cancelamento')
      return false
    }

    const ids = g.rows.map(row => row.id)
    cancellingRef.current = true
    setCancelling(true)

    try {
      const result = await cancelOrderRows(ids, user.displayName, reason)
      if (!result.ok) {
        showToast(result.message)
        return false
      }

      const cancellation = result.cancellation
      setOrders(previous => previous.map(row => ids.includes(row.id) ? { ...row, ...cancellation } : row))
      setViewing(previous => previous?.key === g.key ? { ...previous, ...cancellation } : previous)
      showToast('✅ Pedido cancelado e retirado da operação')
      return true
    } catch {
      showToast('Erro inesperado ao cancelar. Recarregue a página e tente novamente.')
      return false
    } finally {
      cancellingRef.current = false
      setCancelling(false)
    }
  }

  const viewingCancellationAvailability = viewing
    ? cancellationAvailability('pj', {
        productionDate: viewing.production_date,
        deliveryDate: viewing.delivery_date,
      })
    : null

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <div className="ps-mark">P</div>
            <div className="ps-brand">
              <b>Pedidos PJ</b>
              <span>Clientes B2B</span>
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
            {(['novo','lista'] as const).map(t => (
              <button key={t} role="tab" aria-selected={tab===t} onClick={()=>setTab(t)} className="ps-tab">
                {t==='novo' ? '+ Novo pedido' : '📋 Lista'}
              </button>
            ))}
          </div>
        </div>

        <div className="ps-scroll ps-pad">
          {loading ? (
            <div className="ps-empty">Carregando...</div>
          ) : tab === 'novo' ? (
            <>
              {editing && (
                <div className="ps-banner crust no-print" style={{marginTop:14, display:'block'}}>
                  ✏️ <b>Editando pedido</b> — ao salvar, as alterações substituem o anterior. Use <b>Cancelar</b> pra desistir.
                </div>
              )}
              <div className="ps-card" style={{marginTop:14, gap:10}}>
                <div className="ps-fieldgroup">
                  <div className="ps-fieldlabel">Cliente *</div>
                  <select value={custId} onChange={e=>selectCustomer(e.target.value)} className="ps-select">
                    <option value="">— selecionar cliente —</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>

                {cust && (
                  <>
                    <div className="ps-banner honey" style={{margin:0}}>
                      <span>
                        Tabela: <b>{custTier?.name || '— sem tabela —'}</b>
                        {cust.discount_pct > 0 && <span className="ps-store-chip ja" style={{marginLeft:8}}>-{cust.discount_pct}%</span>}
                        <span style={{marginLeft:8, opacity:.8}}>· entrega default {cust.delivery_hours}h</span>
                      </span>
                    </div>

                    <div className="ps-fieldrow">
                      <div className="ps-fieldgroup">
                        <div className="ps-fieldlabel">Data de entrega *</div>
                        <input type="date" value={delivery} onChange={e=>changeDelivery(e.target.value)}
                          min={todayISO()} className="ps-input"/>
                        {delivery && <div style={{fontSize:11.5, color:'var(--ink-faint)', marginTop:3}}><Calendar size={11} style={{verticalAlign:-1, marginRight:3}}/>{fmtBR(delivery)}</div>}
                      </div>
                      <div className="ps-fieldgroup">
                        <div className="ps-fieldlabel">Data de produção</div>
                        <input type="date" value={production} onChange={e=>changeProduction(e.target.value)}
                          min={todayISO()} className="ps-input"/>
                        {production && <div style={{fontSize:11.5, color:'var(--ink-faint)', marginTop:3}}><Calendar size={11} style={{verticalAlign:-1, marginRight:3}}/>{fmtBR(production)}</div>}
                      </div>
                    </div>

                    <div className="ps-fieldgroup">
                      <div className="ps-fieldlabel">Observações</div>
                      <textarea value={obs} onChange={e=>setObs(e.target.value)}
                        placeholder="Notas pro padeiro/expedição (opcional)" className="ps-textarea"/>
                    </div>
                  </>
                )}
              </div>

              {cust && !custTier && (
                <div className="ps-warning" style={{marginTop:14}}>
                  ⚠️ Cliente sem tabela de preço. Vá em <strong>/clientes</strong> e atribua uma tabela.
                </div>
              )}

              {cust && custTier && custCatalog.length === 0 && (
                <div className="ps-warning" style={{marginTop:14}}>
                  ⚠️ Tabela <strong>{custTier.name}</strong> sem produtos cadastrados. Vá em <strong>/tabelas-preco</strong>.
                </div>
              )}

              {cust && custCatalog.length > 0 && (
                <>
                  <div className="ps-fieldgroup" style={{position:'relative', marginTop:14}}>
                    <div className="ps-fieldlabel">+ Adicionar produto</div>
                    <input value={search}
                      onChange={e=>{ setSearch(e.target.value); setSearchOpen(true) }}
                      placeholder="Digite ou clique pra ver produtos da tabela"
                      onFocus={()=>setSearchOpen(true)}
                      onBlur={()=>setTimeout(()=>setSearchOpen(false), 120)} className="ps-input"/>
                    {searchOpen && filteredCatalog.length > 0 && (
                      <div style={{position:'absolute', top:'100%', left:0, right:0, background:'var(--cream-raise)', border:'1px solid var(--ps-line)', borderRadius:'0 0 var(--r-ctrl) var(--r-ctrl)', zIndex:50, maxHeight:280, overflowY:'auto', boxShadow:'var(--sh-2)'}}>
                        {filteredCatalog.map(c => (
                          <div key={saleOptionKey(c.product_source, c.product_id, c.sale_option_id)} onClick={()=>addLine(c)}
                            style={{padding:'10px 12px', cursor:'pointer', fontSize:13, borderBottom:'1px solid var(--line-soft)', display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, fontFamily:'var(--font-ui)'}}>
                            <span>
                              {c.product_name}
                              {c.product_source === 'bread' && <span className="ps-store-chip jc" style={{marginLeft:6}}>🥖</span>}
                              {c.sale_option_id && <span className="ps-store-chip ja" style={{marginLeft:6}}>{c.pricing_unit}</span>}
                              {c.isOverride && <span className="ps-store-chip ex" style={{marginLeft:6}}>override</span>}
                            </span>
                            <span style={{fontSize:12, color:'var(--ink-faint)', whiteSpace:'nowrap'}}>R$ {c.unit_price.toFixed(2)}/{c.pricing_unit} · pack {c.pack_size}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {lines.length === 0 ? (
                    <div className="ps-empty" style={{borderTop:'1px dashed var(--ps-line)', marginTop:14, padding:'30px 0'}}>
                      Adicione produtos da tabela do cliente
                    </div>
                  ) : (
                    <div style={{display:'grid', gap:10, marginTop:14}}>
                      {lines.map(l => {
                        const totalQty = l.packs * l.pack_size
                        const totalVal = l.unit_price * totalQty
                        return (
                          <div key={l.key} className="ps-card" style={{padding:'12px 14px', gap:8}}>
                            <div className="ps-card-head" style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', gap:8}}>
                              <div className="ps-pname" style={{fontSize:14, flex:1, minWidth:0}}>
                                {l.product_name}
                                {l.product_source === 'bread' && <span className="ps-store-chip jc" style={{marginLeft:6}}>🥖</span>}
                                <span style={{marginLeft:8, fontSize:12, color:'var(--ink-faint)', fontWeight:500}}>R$ {l.unit_price.toFixed(2)}/{l.pricing_unit}</span>
                              </div>
                              <button onClick={()=>removeLine(l.key)} title="Remover" className="ps-iconbtn" style={{width:30, height:30, color:'var(--berry)'}}>
                                <Trash2 size={14}/>
                              </button>
                            </div>
                            <div style={{display:'flex', gap:10, alignItems:'center', flexWrap:'wrap'}}>
                              <label style={{fontSize:12, color:'var(--ink-soft)', display:'flex', alignItems:'center', gap:6}}>
                                Pack:
                                <input type="number" min={1} step={1} value={l.pack_size}
                                  onChange={e=>updateLine(l.key, { pack_size: Math.max(1, Number(e.target.value)||1) })}
                                  className="ps-input" style={{width:60, padding:'4px 8px', textAlign:'center', fontSize:13}}/>
                              </label>
                              <label style={{fontSize:12, color:'var(--ink-soft)', display:'flex', alignItems:'center', gap:6}}>
                                Qtd:
                                <input type="number" min={1} step={1} value={l.packs}
                                  onChange={e=>updateLine(l.key, { packs: Math.max(1, Number(e.target.value)||1) })}
                                  className="ps-input" style={{width:60, padding:'4px 8px', textAlign:'center', fontSize:13}}/>
                                pacotes
                              </label>
                              <span style={{fontSize:13, color:'var(--ps-ink)', fontWeight:700}}>
                                = {totalQty} {l.pricing_unit}
                              </span>
                              <span style={{marginLeft:'auto', fontSize:14, fontWeight:700, color:'var(--crust)', fontVariantNumeric:'tabular-nums'}}>
                                R$ {totalVal.toFixed(2)}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {lines.length > 0 && (
                    <div className="ps-banner honey" style={{marginTop:14, justifyContent:'space-between'}}>
                      <b>Total do pedido</b>
                      <b style={{fontFamily:'var(--font-display)', fontSize:18}}>R$ {totalValue.toFixed(2)}</b>
                    </div>
                  )}

                  <div style={{display:'flex', gap:8, justifyContent:'flex-end', marginTop:16}}>
                    <button onClick={()=>{ setEditing(null); setCustId(''); setLines([]); setObs(''); setSearch(''); setDelivery(''); setProduction(''); if (editing) setTab('lista') }} disabled={saving} className="ps-btn ghost">
                      {editing ? 'Cancelar' : 'Limpar'}
                    </button>
                    <button onClick={savePedido} disabled={saving || lines.length===0} className="ps-btn primary">
                      <Save size={14}/> {saving ? 'Salvando...' : editing ? 'Salvar alterações' : 'Salvar pedido'}
                    </button>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div style={{fontSize:13, color:'var(--ink-soft)', marginTop:14, marginBottom:12}}>
                {pedidosGrouped.length} pedido(s) PJ no histórico
              </div>
              {pedidosGrouped.length === 0 ? (
                <div className="ps-empty">Nenhum pedido PJ ainda.</div>
              ) : (
                <div style={{display:'grid', gap:10}}>
                  {pedidosGrouped.map(g => {
                    const st = groupStatus(g)
                    const cancelled = Boolean(g.cancelled_at)
                    return (
                      <button type="button" key={g.key} onClick={()=>setViewing(g)} className="ps-card" style={{borderLeft:`4px solid ${st.border}`, cursor:'pointer', background:cancelled?'var(--line-soft)':undefined, opacity:cancelled ? .72 : 1, textAlign:'left', width:'100%', font:'inherit', color:'inherit'}}>
                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8, flexWrap:'wrap'}}>
                          <div style={{flex:1, minWidth:0}}>
                            <div className="ps-pname" style={{textDecoration:cancelled?'line-through':undefined}}>{g.customer_name}</div>
                            <div style={{fontSize:12, color:'var(--ink-faint)', marginTop:2, textDecoration:cancelled?'line-through':undefined}}>
                              Impl. {fmtBR(g.order_date)} · Prod. {fmtBR(g.production_date)} · Entr. {fmtBR(g.delivery_date)}
                            </div>
                          </div>
                          <span className={`ps-status ${st.cls}`}>{st.label}</span>
                        </div>
                        <div style={{display:'flex', justifyContent:'space-between', fontSize:13, textDecoration:cancelled?'line-through':undefined}}>
                          <span style={{color:'var(--ink-faint)'}}>{g.rows.length} item(ns)</span>
                          <span style={{fontWeight:700, color:'var(--crust)', fontVariantNumeric:'tabular-nums'}}>R$ {g.total.toFixed(2)}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Modal de visualização */}
      {viewing && (
        <div className="ps-sheet-overlay" style={{alignItems:'center'}} onClick={e=>e.target===e.currentTarget&&setViewing(null)}>
          <div className="ps-sheet confirm" style={{maxWidth:540, borderRadius:'var(--r-card)'}}>
            <h3>
              {viewing.customer_name}
              {viewing.cancelled_at && <span className="ps-store-chip" style={{marginLeft:8, background:'var(--line-soft)', color:'var(--ink-soft)'}}>CANCELADO</span>}
            </h3>
            <p style={{fontSize:12.5, color:'var(--ink-soft)', margin:'0 0 14px'}}>
              Implantado {fmtBR(viewing.order_date)} · Produção {fmtBR(viewing.production_date)} · Entrega {fmtBR(viewing.delivery_date)}
            </p>

            <div style={{display:'grid', gap:6, marginBottom:14}}>
              {viewing.rows.map(r => (
                <div key={r.id} style={{display:'flex', justifyContent:'space-between', padding:'8px 12px', background:'var(--line-soft)', borderRadius:'var(--r-ctrl)', fontSize:13, gap:8}}>
                  <span style={{fontWeight:600}}>
                    {r.product_name || r.bread_id}
                    {r.pack_size && r.pack_size > 1 && (
                      <span style={{marginLeft:6, fontSize:11, color:'var(--ink-faint)', fontWeight:500}}>
                        {Math.round((r.quantity||0)/r.pack_size)}×pack{r.pack_size}
                      </span>
                    )}
                  </span>
                  <span style={{textAlign:'right'}}>
                    <span style={{color:'var(--ink-faint)', fontSize:12, marginRight:6}}>{r.quantity} {r.pricing_unit || 'un'}</span>
                    <strong style={{color:'var(--crust)', fontVariantNumeric:'tabular-nums'}}>R$ {((Number(r.unit_price)||0) * (Number(r.quantity)||0)).toFixed(2)}</strong>
                  </span>
                </div>
              ))}
            </div>

            <div className="ps-banner honey" style={{marginBottom:14, justifyContent:'space-between'}}>
              <b>Total</b>
              <b style={{fontFamily:'var(--font-display)', fontSize:18}}>R$ {viewing.total.toFixed(2)}</b>
            </div>

            {viewing.obs && (
              <div className="ps-warning" style={{marginBottom:14}}>
                <strong style={{marginRight:6}}>Obs:</strong> {viewing.obs}
              </div>
            )}

            {viewing.cancelled_at && (
              <div className="ps-warning" style={{marginBottom:14, display:'grid', gap:4}}>
                <strong>Pedido cancelado</strong>
                <span style={{fontSize:12.5}}>
                  Por {viewing.cancelled_by || 'usuário não identificado'} em {formatCancellationTimestamp(viewing.cancelled_at)}
                </span>
                <span style={{fontSize:12.5}}><strong>Motivo:</strong> {viewing.cancel_reason || 'não informado'}</span>
              </div>
            )}

            {!viewing.cancelled_at && viewingCancellationAvailability && (
              <OrderCancellationPanel
                canCancel={canCancelOrder(user?.role, 'pj')}
                availability={viewingCancellationAvailability}
                busy={cancelling}
                onConfirm={reason => cancelPedido(viewing, reason)}
              />
            )}

            <div className="actions">
              {!viewing.cancelled_at && (
                <button onClick={()=>startEdit(viewing)} disabled={cancelling} className="ps-btn ghost">
                  <Pencil size={14}/> Editar
                </button>
              )}
              {!viewing.cancelled_at && viewing.production_date && viewing.production_date > todayISO() && (
                <button onClick={()=>adiantarHoje(viewing)} disabled={cancelling} className="ps-btn info">
                  <Zap size={14}/> Adiantar pra hoje
                </button>
              )}
              <button onClick={()=>setViewing(null)} className="ps-btn ghost">
                <X size={14}/> Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
