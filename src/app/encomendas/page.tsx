'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser } from '@/lib/auth'
import { showToast } from '@/lib/utils'

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
  customer_id:string|null
  walkin_name:string|null; walkin_phone:string|null
  order_date:string; delivery_date:string|null; production_date:string|null
  bread_id:string; product_source:string|null; product_name:string|null
  quantity:number; unit_price:number|null; pack_size:number|null; pricing_unit:string|null
  obs:string|null
}

interface EncomendaGroup {
  key:string
  customerLabel:string
  contact:string|null  // walkin_phone ou — se cadastrado
  isWalkin:boolean
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
function fmtBR(dateStr:string|null): string {
  if (!dateStr) return '—'
  const [y,m,d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

// ===== Componente =====
export default function EncomendasPage() {
  const [user, setUser] = useState<{displayName:string}|null>(null)
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
  const [lines, setLines]         = useState<OrderLine[]>([])
  const [search, setSearch]       = useState('')
  const [saving, setSaving]       = useState(false)

  // Visualização
  const [viewing, setViewing] = useState<EncomendaGroup|null>(null)
  const [listDays, setListDays] = useState(14) // próximos 14 dias por default

  useEffect(() => {
    const u = getCurrentUser()
    if (u) setUser({ displayName: u.displayName })
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
    const used = new Set(lines.map(l => `${l.product_source}_${l.product_id}`))
    const avail = catalog.filter(c => !used.has(`${c._source}_${c.id}`))
    if (search.trim().length < 1) return avail.slice(0, 15)
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
    // Cliente
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
    const baseFields = {
      store: 'encomenda',
      order_type: 'encomenda',
      order_date: todayISO(),
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
    setSaving(false)
    if (error) { showToast('Erro: ' + error.message); return }
    showToast(`✅ Encomenda criada · R$ ${totalValue.toFixed(2)}`)
    // Reset
    setUseWalkin(false); setCustId(''); setWalkinName(''); setWalkinPhone('')
    setDelivery(nextNonSunday(addDays(todayISO(), 1))); setObs(''); setLines([]); setSearch('')
    setTab('lista')
    loadAll()
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
      const key = `${isWalkin ? 'w:'+(r.walkin_name||'') : 'c:'+r.customer_id}__${r.order_date}__${r.delivery_date||''}`
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          customerLabel,
          contact: isWalkin ? r.walkin_phone : null,
          isWalkin,
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
    return Array.from(groups.values())
  }, [orders, customersMap])

  const visibleGroups = useMemo(() => {
    const today = todayISO()
    const limite = addDays(today, listDays)
    return encomendasGrouped
      .filter(g => g.delivery_date && g.delivery_date >= today && g.delivery_date <= limite)
      .sort((a,b) => (a.delivery_date||'').localeCompare(b.delivery_date||''))
  }, [encomendasGrouped, listDays])

  const groupStatus = (g:EncomendaGroup): {label:string; color:string; bg:string} => {
    const t = todayISO()
    if (!g.delivery_date) return { label:'sem data', color:'#6b7280', bg:'#f3f4f6' }
    if (g.delivery_date < t)  return { label:'atrasada', color:'#b91c1c', bg:'#fee2e2' }
    if (g.delivery_date === t) return { label:'pra hoje', color:'#9a3412', bg:'#fed7aa' }
    return { label:'agendada', color:'#1e40af', bg:'#dbeafe' }
  }

  return (
    <div style={{maxWidth:900,margin:'0 auto'}}>
      <div style={{padding:'14px 16px',background:'var(--primary)',color:'white',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
        <span style={{fontWeight:700}}>🎂 Encomendas</span>
        {user && <span style={{fontSize:'.78rem',opacity:.85}}>{user.displayName}</span>}
      </div>

      <div style={{display:'flex',borderBottom:'2px solid var(--border)'}}>
        {(['novo','lista'] as const).map(t => (
          <button key={t} onClick={()=>setTab(t)}
            style={{flex:1,padding:'10px',border:'none',background:'none',cursor:'pointer',
              fontWeight:tab===t?700:400,color:tab===t?'var(--primary)':'var(--muted)',
              borderBottom:tab===t?'2px solid var(--primary)':'2px solid transparent',marginBottom:-2,fontSize:'.88rem'}}>
            {t==='novo' ? '+ Nova encomenda' : '📋 Lista'}
          </button>
        ))}
      </div>

      <div style={{padding:16}}>
        {loading ? (
          <div style={{padding:40,textAlign:'center',color:'var(--muted)'}}>Carregando...</div>
        ) : tab === 'novo' ? (
          <>
            {/* Cliente */}
            <div style={{background:'white',padding:14,borderRadius:10,border:'1px solid var(--border)',marginBottom:14}}>
              <div style={{display:'flex',gap:8,marginBottom:10,flexWrap:'wrap'}}>
                <button onClick={()=>{ setUseWalkin(false); setWalkinName(''); setWalkinPhone('') }}
                  style={{flex:'1 1 140px',padding:'8px 12px',borderRadius:6,border:`1.5px solid ${!useWalkin?'var(--primary)':'var(--border)'}`,background:!useWalkin?'var(--primary)':'white',color:!useWalkin?'white':'var(--text)',cursor:'pointer',fontWeight:600,fontSize:'.85rem'}}>
                  👤 Cliente cadastrado
                </button>
                <button onClick={()=>{ setUseWalkin(true); setCustId('') }}
                  style={{flex:'1 1 140px',padding:'8px 12px',borderRadius:6,border:`1.5px solid ${useWalkin?'var(--primary)':'var(--border)'}`,background:useWalkin?'var(--primary)':'white',color:useWalkin?'white':'var(--text)',cursor:'pointer',fontWeight:600,fontSize:'.85rem'}}>
                  📞 Cliente avulso
                </button>
              </div>

              {!useWalkin ? (
                <>
                  <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600}}>Cliente *</label>
                  <select value={custId} onChange={e=>setCustId(e.target.value)}
                    style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem',background:'white'}}>
                    <option value="">— selecionar —</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </>
              ) : (
                <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                  <div style={{flex:'2 1 200px'}}>
                    <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600}}>Nome *</label>
                    <input value={walkinName} onChange={e=>setWalkinName(e.target.value)}
                      placeholder="Ex: Maria Silva"
                      style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem'}}/>
                  </div>
                  <div style={{flex:'1 1 140px'}}>
                    <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600}}>Telefone</label>
                    <input value={walkinPhone} onChange={e=>setWalkinPhone(e.target.value)}
                      placeholder="(54) 9 9999-9999"
                      style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem'}}/>
                  </div>
                </div>
              )}
            </div>

            {/* Datas */}
            <div style={{background:'white',padding:14,borderRadius:10,border:'1px solid var(--border)',marginBottom:14}}>
              <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600}}>Data de retirada *</label>
              <input type="date" value={delivery} onChange={e=>changeDelivery(e.target.value)} min={todayISO()}
                style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem'}}/>
              {delivery && <div style={{fontSize:'.72rem',color:'var(--muted)',marginTop:3}}>{fmtBR(delivery)} · produção {fmtBR(addDays(delivery, -1))}</div>}

              <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600,marginTop:10}}>Observações</label>
              <textarea value={obs} onChange={e=>setObs(e.target.value)}
                placeholder="Decoração, mensagem, recheio especial..."
                style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem',minHeight:50,resize:'vertical'}}/>
            </div>

            {/* Itens */}
            <div style={{position:'relative',marginBottom:14}}>
              <label style={{display:'block',fontSize:'.78rem',color:'var(--muted)',marginBottom:4,fontWeight:600}}>+ Adicionar item</label>
              <input value={search} onChange={e=>setSearch(e.target.value)}
                placeholder="Buscar pão ou produto..."
                style={{width:'100%',padding:10,border:'1.5px solid var(--border)',borderRadius:8,fontSize:'.9rem'}}/>
              {filteredCatalog.length > 0 && (
                <div style={{position:'absolute',top:'100%',left:0,right:0,background:'white',border:'1px solid var(--border)',borderRadius:'0 0 8px 8px',zIndex:50,maxHeight:240,overflowY:'auto',boxShadow:'0 4px 12px rgba(0,0,0,.08)'}}>
                  {filteredCatalog.map(c => (
                    <div key={`${c._source}_${c.id}`} onClick={()=>addLine(c)}
                      style={{padding:'9px 12px',cursor:'pointer',fontSize:'.88rem',borderBottom:'1px solid var(--border)'}}>
                      {c.name}
                      {c._source === 'bread' && <span style={{marginLeft:6,background:'#fef3c7',color:'#92400e',padding:'1px 5px',borderRadius:3,fontSize:'.6rem',fontWeight:700}}>🥖 PÃO</span>}
                      {c.unit && <span style={{marginLeft:6,fontSize:'.72rem',color:'var(--muted)'}}>{c.unit}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {lines.length === 0 ? (
              <div style={{padding:30,textAlign:'center',color:'var(--muted)',background:'white',borderRadius:10,border:'1px dashed var(--border)'}}>
                Adicione itens da encomenda acima
              </div>
            ) : (
              <div style={{display:'grid',gap:10,marginBottom:14}}>
                {lines.map(l => {
                  const totalVal = l.qty * l.unit_price
                  return (
                    <div key={l.key} style={{background:'white',borderRadius:10,padding:'12px 14px',border:'1px solid var(--border)'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8,gap:8}}>
                        <div style={{flex:1,minWidth:0,fontWeight:700,fontSize:'.92rem'}}>
                          {l.product_name}
                          {l.product_source === 'bread' && <span style={{marginLeft:6,background:'#fef3c7',color:'#92400e',padding:'1px 5px',borderRadius:3,fontSize:'.6rem',fontWeight:700}}>🥖</span>}
                        </div>
                        <button onClick={()=>removeLine(l.key)} title="Remover"
                          style={{background:'none',border:'none',cursor:'pointer',fontSize:'1rem',color:'#dc2626',padding:0}}>🗑</button>
                      </div>
                      <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
                        <label style={{fontSize:'.78rem',color:'var(--muted)'}}>
                          Qtd: <input type="number" min={1} step={1} value={l.qty}
                            onChange={e=>updateLine(l.key, { qty: Math.max(1, Number(e.target.value)||1) })}
                            style={{width:70,padding:'4px 6px',border:'1px solid var(--border)',borderRadius:4,fontSize:'.85rem',textAlign:'center',marginLeft:4}}/>
                        </label>
                        <label style={{fontSize:'.78rem',color:'var(--muted)'}}>
                          Preço unit. R$: <input type="number" min={0} step={0.01} value={l.unit_price}
                            onChange={e=>updateLine(l.key, { unit_price: Math.max(0, Number(e.target.value)||0) })}
                            style={{width:90,padding:'4px 6px',border:'1px solid var(--border)',borderRadius:4,fontSize:'.85rem',textAlign:'right',marginLeft:4}}/>
                        </label>
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
                <span style={{fontWeight:700,fontSize:'.92rem'}}>Total</span>
                <span style={{fontWeight:700,fontSize:'1.2rem',color:'#0a6e52'}}>R$ {totalValue.toFixed(2)}</span>
              </div>
            )}

            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>{ setUseWalkin(false); setCustId(''); setWalkinName(''); setWalkinPhone(''); setLines([]); setObs(''); setSearch('') }} disabled={saving}
                style={{padding:'10px 16px',background:'white',border:'1.5px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:'.88rem',fontWeight:600}}>
                Limpar
              </button>
              <button onClick={saveEncomenda} disabled={saving || lines.length===0}
                style={{padding:'10px 20px',background:'var(--primary)',color:'white',border:'none',borderRadius:8,cursor:(saving||lines.length===0)?'default':'pointer',fontSize:'.9rem',fontWeight:700,opacity:(saving||lines.length===0)?0.6:1}}>
                {saving ? 'Salvando...' : 'Salvar encomenda'}
              </button>
            </div>
          </>
        ) : (
          // ===== LISTA =====
          <>
            <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:12,flexWrap:'wrap'}}>
              <span style={{fontSize:'.85rem',color:'var(--muted)'}}>Próximos</span>
              {[7,14,30,90].map(d => (
                <button key={d} onClick={()=>setListDays(d)}
                  style={{padding:'4px 10px',borderRadius:6,border:`1px solid ${listDays===d?'var(--primary)':'var(--border)'}`,background:listDays===d?'var(--primary)':'white',color:listDays===d?'white':'var(--text)',cursor:'pointer',fontSize:'.78rem',fontWeight:600}}>
                  {d}d
                </button>
              ))}
              <span style={{marginLeft:'auto',fontSize:'.85rem',color:'var(--muted)'}}>
                {visibleGroups.length} encomenda(s)
              </span>
            </div>
            {visibleGroups.length === 0 ? (
              <div style={{padding:40,textAlign:'center',color:'var(--muted)'}}>Nenhuma encomenda nos próximos {listDays} dias.</div>
            ) : (
              <div style={{display:'grid',gap:10}}>
                {visibleGroups.map(g => {
                  const st = groupStatus(g)
                  return (
                    <div key={g.key} onClick={()=>setViewing(g)}
                      style={{background:'white',borderRadius:10,padding:'12px 14px',border:'1px solid var(--border)',borderLeft:`4px solid ${st.color}`,cursor:'pointer'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6,gap:8,flexWrap:'wrap'}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:700,fontSize:'.95rem'}}>
                            {g.customerLabel}
                            {g.isWalkin && <span style={{marginLeft:6,fontSize:'.68rem',padding:'1px 6px',background:'#f3f4f6',color:'var(--muted)',borderRadius:3,fontWeight:600}}>AVULSO</span>}
                          </div>
                          <div style={{fontSize:'.75rem',color:'var(--muted)',marginTop:2}}>
                            Retirada {fmtBR(g.delivery_date)}
                            {g.contact && ` · 📞 ${g.contact}`}
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
            <div style={{fontWeight:700,fontSize:'1.05rem',marginBottom:6}}>
              {viewing.customerLabel}
              {viewing.isWalkin && <span style={{marginLeft:8,fontSize:'.7rem',padding:'1px 6px',background:'#f3f4f6',color:'var(--muted)',borderRadius:3,fontWeight:600}}>AVULSO</span>}
            </div>
            <div style={{fontSize:'.82rem',color:'var(--muted)',marginBottom:14}}>
              Implantada {fmtBR(viewing.order_date)} · Produção {fmtBR(viewing.production_date)} · Retirada {fmtBR(viewing.delivery_date)}
              {viewing.contact && <div style={{marginTop:2}}>📞 {viewing.contact}</div>}
            </div>

            <div style={{display:'grid',gap:6,marginBottom:14}}>
              {viewing.rows.map(r => (
                <div key={r.id} style={{display:'flex',justifyContent:'space-between',padding:'6px 10px',background:'#f9fafb',borderRadius:6,fontSize:'.85rem'}}>
                  <span>
                    {r.product_name || r.bread_id}
                    <span style={{marginLeft:6,fontSize:'.72rem',color:'var(--muted)'}}>×{r.quantity}</span>
                  </span>
                  <strong>R$ {((Number(r.unit_price)||0) * (Number(r.quantity)||0)).toFixed(2)}</strong>
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

            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setViewing(null)}
                style={{padding:'10px 16px',background:'white',border:'1.5px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:'.88rem',fontWeight:600}}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
