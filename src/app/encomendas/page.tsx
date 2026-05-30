'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { User, Phone, Trash2, Plus, Save, Calendar } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, roleColor, type AppUser } from '@/lib/auth'
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
  contact:string|null
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
  const [lines, setLines]         = useState<OrderLine[]>([])
  const [search, setSearch]       = useState('')
  const [saving, setSaving]       = useState(false)

  // Visualização
  const [viewing, setViewing] = useState<EncomendaGroup|null>(null)
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

  const groupStatus = (g:EncomendaGroup): { label:string; cls:string; border:string } => {
    const t = todayISO()
    if (!g.delivery_date) return { label:'sem data', cls:'separado', border:'var(--ps-line)' }
    if (g.delivery_date < t)  return { label:'atrasada', cls:'com_divergencia', border:'var(--berry)' }
    if (g.delivery_date === t) return { label:'pra hoje', cls:'enviado', border:'var(--honey-deep)' }
    return { label:'agendada', cls:'conferido', border:'var(--sage)' }
  }

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
          {loading ? (
            <div className="ps-empty">Carregando...</div>
          ) : tab === 'novo' ? (
            <>
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
                <button onClick={()=>{ setUseWalkin(false); setCustId(''); setWalkinName(''); setWalkinPhone(''); setLines([]); setObs(''); setSearch('') }} disabled={saving} className="ps-btn ghost">
                  Limpar
                </button>
                <button onClick={saveEncomenda} disabled={saving || lines.length===0} className="ps-btn primary">
                  <Save size={14}/> {saving ? 'Salvando...' : 'Salvar encomenda'}
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
                    return (
                      <div key={g.key} onClick={()=>setViewing(g)} className="ps-card" style={{borderLeft:`4px solid ${st.border}`, cursor:'pointer'}}>
                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8, flexWrap:'wrap'}}>
                          <div style={{flex:1, minWidth:0}}>
                            <div className="ps-pname" style={{fontSize:15}}>
                              {g.customerLabel}
                              {g.isWalkin && <span className="ps-store-chip" style={{marginLeft:6, background:'var(--line-soft)', color:'var(--ink-soft)'}}>AVULSO</span>}
                            </div>
                            <div style={{fontSize:12, color:'var(--ink-faint)', marginTop:2}}>
                              Retirada {fmtBR(g.delivery_date)}
                              {g.contact && ` · 📞 ${g.contact}`}
                            </div>
                          </div>
                          <span className={`ps-status ${st.cls}`}>{st.label}</span>
                        </div>
                        <div style={{display:'flex', justifyContent:'space-between', fontSize:13, marginTop:4}}>
                          <span style={{color:'var(--ink-faint)'}}>{g.rows.length} item(ns)</span>
                          <span style={{fontWeight:700, color:'var(--crust)', fontVariantNumeric:'tabular-nums'}}>R$ {g.total.toFixed(2)}</span>
                        </div>
                      </div>
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
        <div className="ps-sheet-overlay" style={{alignItems:'center'}} onClick={e=>e.target===e.currentTarget&&setViewing(null)}>
          <div className="ps-sheet confirm" style={{maxWidth:540, borderRadius:'var(--r-card)'}}>
            <h3>
              {viewing.customerLabel}
              {viewing.isWalkin && <span className="ps-store-chip" style={{marginLeft:8, background:'var(--line-soft)', color:'var(--ink-soft)'}}>AVULSO</span>}
            </h3>
            <p style={{fontSize:12.5, color:'var(--ink-soft)', margin:'0 0 14px'}}>
              Implantada {fmtBR(viewing.order_date)} · Produção {fmtBR(viewing.production_date)} · Retirada {fmtBR(viewing.delivery_date)}
              {viewing.contact && <><br/>📞 {viewing.contact}</>}
            </p>

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

            <div className="actions">
              <button onClick={()=>setViewing(null)} className="ps-btn ghost">Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
