'use client'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { User, Phone, Trash2, Save, Calendar, Printer, ChefHat, Store, Pencil } from 'lucide-react'
import OrderCancellationPanel from '@/components/OrderCancellationPanel'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, roleColor, type AppUser } from '@/lib/auth'
import { showToast } from '@/lib/utils'
import { encomendaOrderGroupKey, ensureOrderGroupId } from '@/lib/orderGrouping'
import {
  canCancelOrder,
  cancellationAvailability,
  formatCancellationTimestamp,
  normalizeCancellationReason,
} from '@/lib/orderCancellation'
import { cancelOrderRows } from '@/lib/orderCancellationClient'

// ===== Tipos =====
interface Customer { id:string; name:string; active:boolean }
interface CatalogItem { id:string; name:string; unit:string|null; _source:'bread'|'product' }

interface OrderLine {
  key:string
  product_id:string; product_source:'bread'|'product'; product_name:string
  qty:number; unit_price:number
}

interface OrderRow {
  id:string
  order_group_id:string|null
  customer_id:string|null
  walkin_name:string|null; walkin_phone:string|null
  order_date:string; delivery_date:string|null; production_date:string|null
  bread_id:string; product_source:string|null; product_name:string|null
  quantity:number; unit_price:number|null; pack_size:number|null; pricing_unit:string|null
  obs:string|null; needs_production:boolean
  cancelled_at:string|null; cancelled_by:string|null; cancel_reason:string|null
}

interface EncomendaGroup {
  key:string
  order_group_id:string|null
  customerLabel:string
  contact:string|null
  isWalkin:boolean
  needs_production:boolean
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
function fmtBR(dateStr:string|null): string {
  if (!dateStr) return '—'
  const [y,m,d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

// ===== Componente =====
export default function EncomendasPage() {
  const [user, setUser] = useState<AppUser | null>(null)
  const [tab, setTab]   = useState<'novo'|'lista'>('novo')

  // Dados base
  const [customers, setCustomers] = useState<Customer[]>([])
  const [catalog, setCatalog]     = useState<CatalogItem[]>([])
  const [orders, setOrders]       = useState<OrderRow[]>([])
  const [loading, setLoading]     = useState(true)

  // Form
  const [useWalkin, setUseWalkin] = useState(false)
  const [custId, setCustId]       = useState<string>('')
  const [walkinName, setWalkinName]   = useState('')
  const [walkinPhone, setWalkinPhone] = useState('')
  const [delivery, setDelivery]   = useState<string>(nextNonSunday(addDays(todayISO(), 1)))
  const [obs, setObs]             = useState('')
  const [needsProduction, setNeedsProduction] = useState(false)
  const [lines, setLines]         = useState<OrderLine[]>([])
  const [search, setSearch]       = useState('')
  const [saving, setSaving]       = useState(false)

  // Visualização
  const [viewing, setViewing] = useState<EncomendaGroup|null>(null)
  const [savingProd, setSavingProd] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const cancellingRef = useRef(false)
  // Edição: ids das linhas originais + data de criação a preservar (null = criando nova)
  const [editing, setEditing] = useState<{ids:string[]; order_date:string; order_group_id:string|null}|null>(null)
  const [listDays, setListDays] = useState(14)

  useEffect(() => {
    setUser(getCurrentUser())
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [cRes, bRes, pRes, ordRes] = await Promise.all([
      supabase.from('customers').select('id,name,active').eq('active', true).order('name'),
      supabase.from('breads').select('id,name,unit').eq('active', true),
      supabase.from('products').select('id,name,unit').eq('active', true),
      supabase.from('orders').select('*').eq('order_type', 'encomenda').order('delivery_date',{ascending:true}).limit(500),
    ])
    setCustomers((cRes.data||[]) as Customer[])
    const breads:   CatalogItem[] = (bRes.data||[]).map((b:{id:string;name:string;unit:string|null}) => ({ id:b.id, name:b.name, unit:b.unit, _source:'bread' }))
    const prods:    CatalogItem[] = (pRes.data||[]).map((p:{id:string;name:string;unit:string|null}) => ({ id:p.id, name:p.name, unit:p.unit, _source:'product' }))
    setCatalog([...breads, ...prods].sort((a,b) => a.name.localeCompare(b.name)))
    setOrders((ordRes.data||[]) as OrderRow[])
    setLoading(false)
  }, [])
  useEffect(() => { loadAll() }, [loadAll])

  // ===== Itens =====
  const filteredCatalog = useMemo(() => {
    if (search.trim().length < 1) return []
    const used = new Set(lines.map(l => `${l.product_source}_${l.product_id}`))
    const avail = catalog.filter(c => !used.has(`${c._source}_${c.id}`))
    const q = search.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
    return avail.filter(c => c.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').includes(q)).slice(0, 15)
  }, [catalog, lines, search])

  const addLine = (c:CatalogItem) => {
    setLines(prev => [...prev, {
      key: `${c._source}_${c.id}_${Date.now()}`,
      product_id: c.id, product_source: c._source, product_name: c.name,
      qty: 1, unit_price: 0,
    }])
    setSearch('')
  }
  const updateLine = (key:string, patch:Partial<OrderLine>) => {
    setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l))
  }
  const removeLine = (key:string) => setLines(prev => prev.filter(l => l.key !== key))

  const totalValue = useMemo(() => lines.reduce((sum,l) => sum + (l.qty * l.unit_price), 0), [lines])

  const changeDelivery = (newDate:string) => {
    if (!newDate) return
    if (isSunday(newDate)) { showToast('⚠️ Domingo é o dia fechado — escolha outra data'); return }
    if (newDate < todayISO()) { showToast('⚠️ Não pode ser no passado'); return }
    setDelivery(newDate)
  }

  // ===== Salvar =====
  const saveEncomenda = async () => {
    if (useWalkin) {
      if (!walkinName.trim()) { showToast('Nome do cliente obrigatório'); return }
    } else {
      if (!custId) { showToast('Selecione cliente ou marque avulso'); return }
    }
    if (!delivery) { showToast('Data de retirada obrigatória'); return }
    if (lines.length === 0) { showToast('Adicione ao menos 1 item'); return }
    if (lines.some(l => l.qty <= 0)) { showToast('Quantidade inválida'); return }
    if (lines.some(l => l.unit_price < 0)) { showToast('Preço inválido'); return }

    setSaving(true)
    const production = addDays(delivery, -1)
    const orderGroupId = ensureOrderGroupId(editing?.order_group_id)
    const baseFields = {
      store: 'encomenda',
      order_type: 'encomenda',
      order_group_id: orderGroupId,
      needs_production: needsProduction,
      order_date: editing ? editing.order_date : todayISO(),
      delivery_date: delivery,
      production_date: production,
      pack_size: 1,
      pricing_unit: 'un',
      obs: obs.trim() || null,
      ...(useWalkin
        ? { customer_id: null, walkin_name: walkinName.trim(), walkin_phone: walkinPhone.trim() || null, pj_client: walkinName.trim() }
        : { customer_id: custId, walkin_name: null, walkin_phone: null, pj_client: customers.find(c=>c.id===custId)?.name || null }
      ),
    }
    const rows = lines.map(l => ({
      ...baseFields,
      bread_id: l.product_id,
      product_source: l.product_source,
      product_name: l.product_name,
      quantity: l.qty,
      unit_price: l.unit_price,
    }))
    const { error } = await supabase.from('orders').insert(rows)
    if (error) { setSaving(false); showToast('Erro: ' + error.message); return }
    // Edição: remove as linhas antigas só DEPOIS de inserir as novas (não perde dados se algo falhar)
    if (editing) await supabase.from('orders').delete().in('id', editing.ids)
    setSaving(false)
    showToast(editing ? '✅ Encomenda atualizada' : `✅ Encomenda criada · R$ ${totalValue.toFixed(2)}`)
    setUseWalkin(false); setCustId(''); setWalkinName(''); setWalkinPhone('')
    setDelivery(nextNonSunday(addDays(todayISO(), 1))); setObs(''); setNeedsProduction(false); setLines([]); setSearch(''); setEditing(null)
    setTab('lista')
    loadAll()
  }

  // Carrega uma encomenda existente no formulário pra edição (ao salvar, substitui a anterior)
  const startEdit = (g:EncomendaGroup) => {
    if (g.cancelled_at || cancellingRef.current) return
    const first = g.rows[0]
    if (g.isWalkin) {
      setUseWalkin(true)
      setWalkinName(first?.walkin_name || (g.customerLabel==='(sem nome)' ? '' : g.customerLabel))
      setWalkinPhone(first?.walkin_phone || '')
      setCustId('')
    } else {
      setUseWalkin(false)
      setCustId(first?.customer_id || '')
      setWalkinName(''); setWalkinPhone('')
    }
    setDelivery(g.delivery_date || nextNonSunday(addDays(todayISO(),1)))
    setObs(g.obs || '')
    setNeedsProduction(g.needs_production)
    setLines(g.rows.map((r,i) => ({
      key: `${r.product_source}_${r.bread_id}_${i}`,
      product_id: r.bread_id,
      product_source: r.product_source === 'bread' ? 'bread' : 'product',
      product_name: r.product_name || r.bread_id,
      qty: Number(r.quantity) || 1,
      unit_price: Number(r.unit_price) || 0,
    })))
    setEditing({ ids: g.rows.map(r=>r.id), order_date: g.order_date, order_group_id: g.order_group_id })
    setSearch('')
    setViewing(null)
    setTab('novo')
  }

  // Alterna balcão⇄produção numa encomenda já criada (grava na hora, sem botão "salvar").
  // .select() confirma quantas linhas mudaram — se vier 0, avisa em vez de fingir sucesso.
  const toggleProducao = async (g:EncomendaGroup) => {
    if (g.cancelled_at || savingProd || cancellingRef.current) return
    const novo = !g.needs_production
    const ids = g.rows.map(r=>r.id)
    setSavingProd(true)
    const { data, error } = await supabase.from('orders').update({ needs_production: novo }).in('id', ids).select('id')
    setSavingProd(false)
    if (error) { showToast('Erro ao salvar: ' + error.message); return }
    if (!data || data.length === 0) { showToast('Nada foi alterado — recarregue a página e tente de novo'); return }
    setOrders(prev => prev.map(o => ids.includes(o.id) ? { ...o, needs_production: novo } : o))
    setViewing(prev => prev ? { ...prev, needs_production: novo } : prev)
    showToast(novo ? '✅ Salvo — vai pra produção do Geolar' : '✅ Salvo — separa no balcão')
  }

  // ===== Lista agrupada =====
  const customersMap = useMemo(() => new Map(customers.map(c => [c.id, c.name])), [customers])

  const encomendasGrouped = useMemo<EncomendaGroup[]>(() => {
    const groups = new Map<string, EncomendaGroup>()
    orders.forEach(r => {
      const isWalkin = !r.customer_id
      const customerLabel = isWalkin
        ? (r.walkin_name || '(sem nome)')
        : (customersMap.get(r.customer_id!) || '(cliente removido)')
      const key = encomendaOrderGroupKey(r)
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          order_group_id: r.order_group_id,
          customerLabel,
          contact: isWalkin ? r.walkin_phone : null,
          isWalkin,
          needs_production: !!r.needs_production,
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
    return Array.from(groups.values())
  }, [orders, customersMap])

  const visibleGroups = useMemo(() => {
    const today = todayISO()
    const limite = addDays(today, listDays)
    return encomendasGrouped
      .filter(g => g.delivery_date && g.delivery_date >= today && g.delivery_date <= limite)
      .sort((a,b) => (a.delivery_date||'').localeCompare(b.delivery_date||''))
  }, [encomendasGrouped, listDays])

  const encomendasHoje = useMemo(
    () => encomendasGrouped.filter(g => !g.cancelled_at && g.delivery_date === todayISO()),
    [encomendasGrouped]
  )

  const groupStatus = (g:EncomendaGroup): { label:string; cls:string; border:string } => {
    if (g.cancelled_at) return { label:'cancelado', cls:'separado', border:'var(--ink-faint)' }
    const t = todayISO()
    if (!g.delivery_date) return { label:'sem data', cls:'separado', border:'var(--ps-line)' }
    if (g.delivery_date < t)  return { label:'atrasada', cls:'com_divergencia', border:'var(--berry)' }
    if (g.delivery_date === t) return { label:'pra hoje', cls:'enviado', border:'var(--honey-deep)' }
    return { label:'agendada', cls:'conferido', border:'var(--sage)' }
  }

  const cancelEncomenda = async (g: EncomendaGroup, rawReason: string): Promise<boolean> => {
    if (cancellingRef.current) return false
    if (!user || !canCancelOrder(user.role, 'encomenda')) {
      showToast('Você não tem permissão para cancelar encomendas')
      return false
    }

    const availability = cancellationAvailability('encomenda', {
      productionDate: g.production_date,
      deliveryDate: g.delivery_date,
      needsProduction: g.needs_production,
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
      showToast('✅ Encomenda cancelada e retirada da operação')
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
    ? cancellationAvailability('encomenda', {
        productionDate: viewing.production_date,
        deliveryDate: viewing.delivery_date,
        needsProduction: viewing.needs_production,
      })
    : null

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <div className="ps-mark">P</div>
            <div className="ps-brand">
              <b>Encomendas</b>
              <span>Clientes PF</span>
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
                {t==='novo' ? '+ Nova encomenda' : '📋 Lista'}
              </button>
            ))}
          </div>
        </div>

        <div className="ps-scroll ps-pad">
          {!loading && encomendasHoje.length > 0 && (
            <div className="ps-banner honey no-print" style={{marginTop:14, display:'block'}}>
              <b>📦 Encomendas de hoje ({encomendasHoje.length})</b>
              <div style={{fontSize:13, marginTop:4, color:'var(--ink-soft)'}}>
                {encomendasHoje.map(g => `${g.customerLabel} (${g.rows.length})`).join(' · ')}
              </div>
            </div>
          )}
          {loading ? (
            <div className="ps-empty">Carregando...</div>
          ) : tab === 'novo' ? (
            <>
              {editing && (
                <div className="ps-banner crust no-print" style={{marginTop:14, display:'block'}}>
                  ✏️ <b>Editando encomenda</b> — ao salvar, as alterações substituem a anterior. Use <b>Cancelar</b> pra desistir.
                </div>
              )}
              {/* Cliente */}
              <div className="ps-card" style={{marginTop:14, gap:10}}>
                <div className="ps-segments" style={{width:'100%'}}>
                  <button onClick={()=>{ setUseWalkin(false); setWalkinName(''); setWalkinPhone('') }}
                    className={`ps-seg ${!useWalkin ? 'active' : ''}`} style={{flex:1}}>
                    <User size={14} style={{verticalAlign:-2, marginRight:4}}/> Cadastrado
                  </button>
                  <button onClick={()=>{ setUseWalkin(true); setCustId('') }}
                    className={`ps-seg ${useWalkin ? 'active' : ''}`} style={{flex:1}}>
                    <Phone size={14} style={{verticalAlign:-2, marginRight:4}}/> Avulso
                  </button>
                </div>

                {!useWalkin ? (
                  <div className="ps-fieldgroup">
                    <div className="ps-fieldlabel">Cliente *</div>
                    <select value={custId} onChange={e=>setCustId(e.target.value)} className="ps-select">
                      <option value="">— selecionar —</option>
                      {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                ) : (
                  <div className="ps-fieldrow">
                    <div className="ps-fieldgroup" style={{flex:'2 1 200px'}}>
                      <div className="ps-fieldlabel">Nome *</div>
                      <input value={walkinName} onChange={e=>setWalkinName(e.target.value)} placeholder="Ex: Maria Silva" className="ps-input"/>
                    </div>
                    <div className="ps-fieldgroup">
                      <div className="ps-fieldlabel">Telefone</div>
                      <input value={walkinPhone} onChange={e=>setWalkinPhone(e.target.value)} placeholder="(54) 9 9999-9999" className="ps-input"/>
                    </div>
                  </div>
                )}
              </div>

              {/* Datas */}
              <div className="ps-card" style={{marginTop:12, gap:10}}>
                <div className="ps-fieldgroup">
                  <div className="ps-fieldlabel">Data de retirada *</div>
                  <input type="date" value={delivery} onChange={e=>changeDelivery(e.target.value)} min={todayISO()} className="ps-input"/>
                  {delivery && (
                    <div style={{fontSize:11.5, color:'var(--ink-faint)', marginTop:3}}>
                      <Calendar size={11} style={{verticalAlign:-1, marginRight:3}}/>
                      {fmtBR(delivery)} · produção {fmtBR(addDays(delivery, -1))}
                    </div>
                  )}
                </div>
                <div className="ps-fieldgroup">
                  <div className="ps-fieldlabel">Observações</div>
                  <textarea value={obs} onChange={e=>setObs(e.target.value)}
                    placeholder="Decoração, mensagem, recheio especial..." className="ps-textarea"/>
                </div>
              </div>

              {/* Tipo: balcão ou produção */}
              <div className="ps-card" style={{marginTop:12, gap:8}}>
                <div className="ps-fieldlabel">Como vai ser preparada?</div>
                <div className="ps-segments" style={{width:'100%'}}>
                  <button type="button" onClick={()=>setNeedsProduction(false)}
                    className={`ps-seg ${!needsProduction ? 'active' : ''}`} style={{flex:1}}>
                    <Store size={14} style={{verticalAlign:-2, marginRight:4}}/> Balcão
                  </button>
                  <button type="button" onClick={()=>setNeedsProduction(true)}
                    className={`ps-seg ${needsProduction ? 'active' : ''}`} style={{flex:1}}>
                    <ChefHat size={14} style={{verticalAlign:-2, marginRight:4}}/> Produção
                  </button>
                </div>
                <div style={{fontSize:11.5, color:'var(--ink-faint)'}}>
                  {needsProduction
                    ? '👩‍🍳 O Geolar produz essa quantidade a mais — entra na lista de produção do dia.'
                    : '🛒 Separar do que a loja já tem em estoque.'}
                </div>
              </div>

              {/* Buscar item */}
              <div className="ps-fieldgroup" style={{position:'relative', marginTop:14}}>
                <div className="ps-fieldlabel">+ Adicionar item</div>
                <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar pão ou produto..." className="ps-input"/>
                {filteredCatalog.length > 0 && (
                  <div style={{position:'absolute', top:'100%', left:0, right:0, background:'var(--cream-raise)', border:'1px solid var(--ps-line)', borderRadius:'0 0 var(--r-ctrl) var(--r-ctrl)', zIndex:50, maxHeight:240, overflowY:'auto', boxShadow:'var(--sh-2)'}}>
                    {filteredCatalog.map(c => (
                      <div key={`${c._source}_${c.id}`} onClick={()=>addLine(c)}
                        style={{padding:'10px 12px', cursor:'pointer', fontSize:13, borderBottom:'1px solid var(--line-soft)', fontFamily:'var(--font-ui)'}}>
                        {c.name}
                        {c._source === 'bread' && <span className="ps-store-chip jc" style={{marginLeft:6}}>🥖 PÃO</span>}
                        {c.unit && <span style={{marginLeft:6, fontSize:11, color:'var(--ink-faint)'}}>{c.unit}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {lines.length === 0 ? (
                <div className="ps-empty" style={{padding:'30px 0', borderTop:'1px dashed var(--ps-line)', marginTop:14}}>
                  Adicione itens da encomenda acima
                </div>
              ) : (
                <div style={{display:'grid', gap:10, marginTop:14}}>
                  {lines.map(l => {
                    const totalVal = l.qty * l.unit_price
                    return (
                      <div key={l.key} className="ps-card" style={{padding:'12px 14px', gap:8}}>
                        <div className="ps-card-head" style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', gap:8}}>
                          <div className="ps-pname" style={{fontSize:14, flex:1, minWidth:0}}>
                            {l.product_name}
                            {l.product_source === 'bread' && <span className="ps-store-chip jc" style={{marginLeft:6}}>🥖</span>}
                          </div>
                          <button onClick={()=>removeLine(l.key)} title="Remover" className="ps-iconbtn" style={{width:30, height:30, color:'var(--berry)'}}>
                            <Trash2 size={14}/>
                          </button>
                        </div>
                        <div style={{display:'flex', gap:10, alignItems:'center', flexWrap:'wrap'}}>
                          <label style={{fontSize:12, color:'var(--ink-soft)', display:'flex', alignItems:'center', gap:6}}>
                            Qtd:
                            <input type="number" min={1} step={1} value={l.qty}
                              onChange={e=>updateLine(l.key, { qty: Math.max(1, Number(e.target.value)||1) })}
                              className="ps-input" style={{width:70, padding:'4px 8px', textAlign:'center', fontSize:13}}/>
                          </label>
                          <label style={{fontSize:12, color:'var(--ink-soft)', display:'flex', alignItems:'center', gap:6}}>
                            R$:
                            <input type="number" min={0} step={0.01} value={l.unit_price}
                              onChange={e=>updateLine(l.key, { unit_price: Math.max(0, Number(e.target.value)||0) })}
                              className="ps-input" style={{width:90, padding:'4px 8px', textAlign:'right', fontSize:13}}/>
                          </label>
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
                  <b>Total</b>
                  <b style={{fontFamily:'var(--font-display)', fontSize:18}}>R$ {totalValue.toFixed(2)}</b>
                </div>
              )}

              <div style={{display:'flex', gap:8, justifyContent:'flex-end', marginTop:16}}>
                <button onClick={()=>{ setEditing(null); setUseWalkin(false); setCustId(''); setWalkinName(''); setWalkinPhone(''); setLines([]); setObs(''); setNeedsProduction(false); setSearch(''); if(editing) setTab('lista') }} disabled={saving} className="ps-btn ghost">
                  {editing ? 'Cancelar' : 'Limpar'}
                </button>
                <button onClick={saveEncomenda} disabled={saving || lines.length===0} className="ps-btn primary">
                  <Save size={14}/> {saving ? 'Salvando...' : editing ? 'Salvar alterações' : 'Salvar encomenda'}
                </button>
              </div>
            </>
          ) : (
            // ===== LISTA =====
            <>
              <div style={{display:'flex', gap:8, alignItems:'center', marginTop:14, marginBottom:14, flexWrap:'wrap'}}>
                <span style={{fontSize:13, color:'var(--ink-soft)'}}>Próximos</span>
                <div className="ps-presets">
                  {[7,14,30,90].map(d => (
                    <button key={d} onClick={()=>setListDays(d)} className={`ps-preset ${listDays===d ? 'active' : ''}`}>
                      {d}d
                    </button>
                  ))}
                </div>
                <span style={{marginLeft:'auto', fontSize:13, color:'var(--ink-soft)'}}>
                  {visibleGroups.length} encomenda(s)
                </span>
              </div>

              {visibleGroups.length === 0 ? (
                <div className="ps-empty">Nenhuma encomenda nos próximos {listDays} dias.</div>
              ) : (
                <div style={{display:'grid', gap:10}}>
                  {visibleGroups.map(g => {
                    const st = groupStatus(g)
                    const cancelled = Boolean(g.cancelled_at)
                    return (
                      <button type="button" key={g.key} onClick={()=>setViewing(g)} className="ps-card" style={{borderLeft:`4px solid ${st.border}`, cursor:'pointer', background:cancelled?'var(--line-soft)':undefined, opacity:cancelled ? .72 : 1, textAlign:'left', width:'100%', font:'inherit', color:'inherit'}}>
                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8, flexWrap:'wrap'}}>
                          <div style={{flex:1, minWidth:0}}>
                            <div className="ps-pname" style={{fontSize:15, textDecoration:cancelled?'line-through':undefined}}>
                              {g.customerLabel}
                              {g.isWalkin && <span className="ps-store-chip" style={{marginLeft:6, background:'var(--line-soft)', color:'var(--ink-soft)'}}>AVULSO</span>}
                            </div>
                            <div style={{fontSize:12, color:'var(--ink-faint)', marginTop:2, textDecoration:cancelled?'line-through':undefined}}>
                              Retirada {fmtBR(g.delivery_date)}
                              {g.contact && ` · 📞 ${g.contact}`}
                            </div>
                          </div>
                          <span className={`ps-status ${st.cls}`}>{st.label}</span>
                        </div>
                        <div style={{display:'flex', justifyContent:'space-between', fontSize:13, marginTop:4, textDecoration:cancelled?'line-through':undefined}}>
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

      {/* Modal de visualização (centered) */}
      {viewing && (
        <>
        <div className="ps-sheet-overlay" style={{alignItems:'center'}} onClick={e=>e.target===e.currentTarget&&setViewing(null)}>
          <div className="ps-sheet confirm" style={{maxWidth:540, borderRadius:'var(--r-card)'}}>
            <h3>
              {viewing.customerLabel}
              {viewing.isWalkin && <span className="ps-store-chip" style={{marginLeft:8, background:'var(--line-soft)', color:'var(--ink-soft)'}}>AVULSO</span>}
              {viewing.cancelled_at && <span className="ps-store-chip" style={{marginLeft:8, background:'var(--line-soft)', color:'var(--ink-soft)'}}>CANCELADO</span>}
            </h3>
            <p style={{fontSize:12.5, color:'var(--ink-soft)', margin:'0 0 12px'}}>
              Implantada {fmtBR(viewing.order_date)} · Produção {fmtBR(viewing.production_date)} · Retirada {fmtBR(viewing.delivery_date)}
              {viewing.contact && <><br/>📞 {viewing.contact}</>}
            </p>

            <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:14, flexWrap:'wrap'}}>
              <span className="ps-store-chip" style={viewing.needs_production
                ? {background:'var(--honey-tint)', color:'var(--crust)'}
                : {background:'var(--line-soft)', color:'var(--ink-soft)'}}>
                {viewing.needs_production ? '👩‍🍳 Produção' : '🛒 Balcão'}
              </span>
              {!viewing.cancelled_at && (
                <button onClick={()=>toggleProducao(viewing)} disabled={savingProd || cancelling} className="ps-btn ghost" style={{padding:'4px 10px', fontSize:12, marginLeft:'auto'}}>
                  {savingProd ? 'Salvando…' : viewing.needs_production ? 'Mudar p/ balcão' : 'Mandar p/ produção'}
                </button>
              )}
            </div>

            <div style={{display:'grid', gap:6, marginBottom:14}}>
              {viewing.rows.map(r => (
                <div key={r.id} style={{display:'flex', justifyContent:'space-between', padding:'8px 12px', background:'var(--line-soft)', borderRadius:'var(--r-ctrl)', fontSize:13}}>
                  <span style={{fontWeight:600}}>
                    {r.product_name || r.bread_id}
                    <span style={{marginLeft:6, fontSize:12, color:'var(--ink-faint)', fontWeight:500}}>×{r.quantity}</span>
                  </span>
                  <strong style={{color:'var(--crust)', fontVariantNumeric:'tabular-nums'}}>R$ {((Number(r.unit_price)||0) * (Number(r.quantity)||0)).toFixed(2)}</strong>
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
                <strong>Encomenda cancelada</strong>
                <span style={{fontSize:12.5}}>
                  Por {viewing.cancelled_by || 'usuário não identificado'} em {formatCancellationTimestamp(viewing.cancelled_at)}
                </span>
                <span style={{fontSize:12.5}}><strong>Motivo:</strong> {viewing.cancel_reason || 'não informado'}</span>
              </div>
            )}

            {!viewing.cancelled_at && viewingCancellationAvailability && (
              <OrderCancellationPanel
                canCancel={canCancelOrder(user?.role, 'encomenda')}
                availability={viewingCancellationAvailability}
                busy={cancelling}
                onConfirm={reason => cancelEncomenda(viewing, reason)}
              />
            )}

            <div className="actions">
              {!viewing.cancelled_at && <button onClick={()=>startEdit(viewing)} disabled={cancelling} className="ps-btn ghost"><Pencil size={14}/> Editar</button>}
              <button onClick={()=>window.print()} className="ps-btn info"><Printer size={14}/> Imprimir</button>
              <button onClick={()=>setViewing(null)} className="ps-btn ghost">Fechar</button>
            </div>
          </div>
        </div>

        {/* Cupom térmico 80mm — escondido na tela, visível só na impressão (ver globals.css) */}
        <div id="cupom-enc">
          <div style={{textAlign:'center', fontWeight:700, fontSize:14}}>PANE &amp; SALUTE</div>
          <div style={{textAlign:'center', marginBottom:'2mm'}}>~ {viewing.cancelled_at ? 'ENCOMENDA CANCELADA' : 'ENCOMENDA'} ~</div>
          <div style={{borderTop:'1px dashed #000', margin:'1mm 0'}}/>
          <div><b>Cliente:</b> {viewing.customerLabel}{viewing.isWalkin ? ' (avulso)' : ''}</div>
          {viewing.contact && <div><b>Tel:</b> {viewing.contact}</div>}
          <div><b>Retirada:</b> {fmtBR(viewing.delivery_date)}</div>
          <div><b>Tipo:</b> {viewing.needs_production ? 'PRODUCAO' : 'BALCAO'}</div>
          <div style={{borderTop:'1px dashed #000', margin:'1mm 0'}}/>
          {viewing.rows.map(r => (
            <div key={r.id} style={{display:'flex', justifyContent:'space-between', gap:'2mm'}}>
              <span>{r.quantity}x {r.product_name || r.bread_id}</span>
              <span>{((Number(r.unit_price)||0)*(Number(r.quantity)||0)).toFixed(2)}</span>
            </div>
          ))}
          <div style={{borderTop:'1px dashed #000', margin:'1mm 0'}}/>
          <div style={{display:'flex', justifyContent:'space-between', fontWeight:700}}>
            <span>TOTAL</span><span>R$ {viewing.total.toFixed(2)}</span>
          </div>
          {viewing.obs && <div style={{marginTop:'2mm'}}><b>Obs:</b> {viewing.obs}</div>}
          {viewing.cancelled_at && <div style={{marginTop:'2mm'}}><b>Cancelada:</b> {viewing.cancel_reason || 'motivo não informado'}</div>}
          <div style={{textAlign:'center', marginTop:'3mm', fontSize:11}}>Pedido em {fmtBR(viewing.order_date)}</div>
        </div>
        </>
      )}
    </div>
  )
}
