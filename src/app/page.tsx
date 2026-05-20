'use client'
import { useState, useEffect, useCallback, useRef } from 'react'

const SB_URL = 'https://gohluceldchoitihrimw.supabase.co'
const SB_KEY = 'sb_publishable_Su-BxUMybE1ysGiLxqNilg_YhYgItOJ'
const TG_TOKEN = process.env.NEXT_PUBLIC_TELEGRAM_BOT_TOKEN!
const TG_CHAT_ID = process.env.NEXT_PUBLIC_TELEGRAM_CHAT_ID!
const DAYS_PT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']
const DELIVERY_MAP: Record<number,number> = {0:1,1:2,2:3,3:4,4:6,5:6,6:1}

type UserKey = 'rodrigo'|'marselle'|'elis'|'geolar'
type Store = 'jc'|'ja'|'ex'|'pj'
type Screen = 'login'|'main'|'geolar'

interface Bread { id:string; name:string; days:any; active:boolean; is_pj:boolean }
interface OrderRow { store:string; bread_id:string; quantity:number; obs:string; pj_client?:string; pj_delivery_date?:string; order_date:string }
type OrderMap = Record<string, Record<string, OrderRow>>
type ModalMode = 'none'|'new-bread'|'edit-bread'|'confirm-delete'

interface BreadForm { name:string; days:number[]; is_pj:boolean }

// ── utils ──────────────────────────────────────────────────────────
function nowBrasilia() {
  const now = new Date()
  const offset = -3 * 60 - now.getTimezoneOffset()
  return new Date(now.getTime() + offset * 60000)
}
function todayKey() {
  const d = nowBrasilia()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function deliveryDateKey(delivIdx: number) {
  const todayIdx = nowBrasilia().getDay()
  const d = nowBrasilia()
  let daysAhead = (delivIdx - todayIdx + 7) % 7
  if (daysAhead === 0) daysAhead = 7
  d.setDate(d.getDate() + daysAhead)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function parseDays(d: any): number[] {
  if (Array.isArray(d)) return d.map(Number)
  if (typeof d === 'string') return d.replace(/[{}\s]/g,'').split(',').map(Number).filter((n:number) => !isNaN(n))
  return []
}
function dateLabel(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'2-digit' })
}
function deliveryDayLabel(delivIdx: number) {
  const todayIdx = nowBrasilia().getDay()
  const d = nowBrasilia()
  let daysAhead = (delivIdx - todayIdx + 7) % 7
  if (daysAhead === 0) daysAhead = 7
  d.setDate(d.getDate() + daysAhead)
  return d.toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'2-digit' })
}
function checkDeadline() {
  const h = nowBrasilia().getHours()
  return false // pedidos sempre abertos
}
function getHoursLeft() {
  const h = nowBrasilia().getHours()
  if (h < 4) return 0
  const now = new Date()
  const t = new Date(now)
  t.setDate(t.getDate() + 1)
  t.setHours(4, 0, 0, 0)
  return Math.floor((t.getTime() - now.getTime()) / 3600000)
}
function slugify(str: string) {
  return str.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'') + Date.now()
}
function showToast(msg: string, duration = 2600) {
  const el = document.getElementById('prod-toast')
  if (!el) return
  el.textContent = msg
  el.classList.add('show')
  setTimeout(() => el.classList.remove('show'), duration)
}

// ── Supabase ────────────────────────────────────────────────────────
const H = { 'apikey': SB_KEY, 'Authorization': 'Bearer '+SB_KEY, 'Content-Type':'application/json' }
async function sbGet(table:string, params='') {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${params}`, { headers: H })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}
async function sbUpsert(table:string, data:any, onConflict?:string) {
  const qs = onConflict ? `?on_conflict=${onConflict}` : ''
  const r = await fetch(`${SB_URL}/rest/v1/${table}${qs}`, {
    method:'POST', headers:{...H,'Prefer':'resolution=merge-duplicates,return=representation'}, body:JSON.stringify(data)
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}
async function sbPatch(table:string, data:any, match:Record<string,string>) {
  const q = Object.entries(match).map(([k,v])=>`${k}=eq.${v}`).join('&')
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${q}`, {
    method:'PATCH', headers:{...H,'Prefer':'return=representation'}, body:JSON.stringify(data)
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}
async function sbDel(table:string, match:Record<string,string>) {
  const q = Object.entries(match).map(([k,v])=>`${k}=eq.${v}`).join('&')
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${q}`, { method:'DELETE', headers:H })
  if (!r.ok) throw new Error(await r.text())
}

// ── Main Component ──────────────────────────────────────────────────
export default function ProducaoPage() {
  const [screen, setScreen] = useState<Screen>('login')
  const [currentUser, setCurrentUser] = useState<UserKey|null>(null)
  const [breads, setBreads] = useState<Bread[]>([])
  const [orders, setOrders] = useState<OrderMap>({})
  const [orderDate, setOrderDate] = useState(todayKey())
  const [delivIdx, setDelivIdx] = useState(() => DELIVERY_MAP[nowBrasilia().getDay()] ?? 1)
  const [isLocked, setIsLocked] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('Carregando...')
  const [activeTab, setActiveTab] = useState(0)
  const [syncState, setSyncState] = useState<''|'syncing'|'error'>('')
  // qty state per store: key = "store-breadId"
  const [qtys, setQtys] = useState<Record<string,number>>({})
  const [obsMap, setObsMap] = useState<Record<string,string>>({})
  const [pjClient, setPjClient] = useState('')
  const [pjDate, setPjDate] = useState('')
  // report
  const [reportDate, setReportDate] = useState(todayKey())
  const [reportOrders, setReportOrders] = useState<OrderMap>({})
  // admin modal
  const [modal, setModal] = useState<ModalMode>('none')
  const [editingBread, setEditingBread] = useState<Bread|null>(null)
  const [breadForm, setBreadForm] = useState<BreadForm>({ name:'', days:[1,2,3,4,5,6], is_pj:false })
  const [deletingBread, setDeletingBread] = useState<Bread|null>(null)
  const [saving, setSaving] = useState(false)
  // geolar date picker
  const [geolarDate, setGeolarDate] = useState(todayKey())
  const [geolarOrders, setGeolarOrders] = useState<OrderMap>({})

  const showLoad = (msg='Carregando...') => { setLoadingMsg(msg); setLoading(true) }
  const hideLoad = () => setLoading(false)

  const loadBreads = useCallback(async () => {
    const data = await sbGet('breads','order=name.asc')
    setBreads(data)
    return data as Bread[]
  }, [])

  const loadOrders = useCallback(async (dateKey: string): Promise<OrderMap> => {
    setSyncState('syncing')
    try {
      const rows: OrderRow[] = await sbGet('orders',`order_date=eq.${dateKey}&select=store,bread_id,quantity,obs,pj_client,pj_delivery_date`)
      const map: OrderMap = {}
      rows.forEach(r => {
        if (!map[r.store]) map[r.store] = {}
        map[r.store][r.bread_id] = r
      })
      setSyncState('')
      return map
    } catch(e) {
      setSyncState('error')
      throw e
    }
  }, [])

  const initOrderState = useCallback((map: OrderMap, bds: Bread[]) => {
    const newQtys: Record<string,number> = {}
    const newObs: Record<string,string> = {}
    const stores = ['jc','ja','ex','pj']
    stores.forEach(store => {
      const sv = map[store] || {}
      bds.forEach(b => {
        newQtys[`${store}-${b.id}`] = sv[b.id]?.quantity || 0
      })
      const firstObs = Object.values(sv)[0]?.obs || ''
      newObs[store] = firstObs
    })
    setQtys(newQtys)
    setObsMap(newObs)
    const pjSv = map['pj'] || {}
    const firstPj = Object.values(pjSv)[0]
    if (firstPj) { setPjClient(firstPj.pj_client||''); setPjDate(firstPj.pj_delivery_date||'') }
  }, [])

  const login = async (user: UserKey) => {
    setCurrentUser(user)
    showLoad('Carregando cardápio...')
    try {
      const bds = await loadBreads()
      const todayDelivIdx = DELIVERY_MAP[nowBrasilia().getDay()] ?? 1
      setDelivIdx(todayDelivIdx)
      setIsLocked(checkDeadline())
      if (user === 'geolar') {
        const defDate = deliveryDateKey(todayDelivIdx)
        setGeolarDate(defDate)
        const map = await loadOrders(defDate)
        setGeolarOrders(map)
        setOrders(map)
        hideLoad()
        setScreen('geolar')
        return
      }
      const defDate = deliveryDateKey(todayDelivIdx)
      const map = await loadOrders(defDate)
      setOrders(map)
      setOrderDate(defDate)
      initOrderState(map, bds)
      setActiveTab(0)
      hideLoad()
      setScreen('main')
    } catch(e) {
      hideLoad()
      showToast('Erro de conexão. Tente novamente.')
    }
  }

  const logout = () => {
    setCurrentUser(null)
    setBreads([]); setOrders({}); setQtys({}); setObsMap({})
    setActiveTab(0)
    setScreen('login')
  }

  // ── day change ──────────────────────────────────────────────────
  const changeDelivDay = async (idx: number) => {
    setDelivIdx(idx)
    const newDate = deliveryDateKey(idx)
    setOrderDate(newDate)
    showLoad('Carregando pedidos...')
    try {
      const map = await loadOrders(newDate)
      setOrders(map)
      initOrderState(map, breads)
    } catch(e) { showToast('Erro ao carregar pedidos.') }
    finally { hideLoad() }
  }

  // ── save order ──────────────────────────────────────────────────
  const saveOrder = async (store: Store) => {
    const storeBreads = store === 'pj' ? breads.filter(b=>b.is_pj&&b.active) : breads.filter(b=>!b.is_pj&&b.active&&parseDays(b.days).includes(delivIdx))
    const date = deliveryDateKey(delivIdx)
    const obs = obsMap[store] || ''
    const rows: any[] = storeBreads.map(b => ({
      store, bread_id: b.id,
      quantity: qtys[`${store}-${b.id}`] || 0,
      order_date: date, obs,
      ...(store==='pj' ? { pj_client: pjClient, pj_delivery_date: pjDate||null } : {})
    }))
    setSaving(true)
    setSyncState('syncing')
    try {
      await sbDel('orders', { store, order_date: date })
      await sbUpsert('orders', rows, 'store,bread_id,order_date')
      const newMap = { ...orders, [store]: {} }
      rows.forEach(r => { (newMap[store] as any)[r.bread_id] = r })
      setOrders(newMap)
      setSyncState('')
      showToast('Pedido salvo!')
      if (currentUser !== 'rodrigo') {
        sendTelegram(store, rows, storeBreads)
      }
    } catch(e) {
      setSyncState('error')
      showToast('Erro ao salvar. Tente novamente.')
    } finally { setSaving(false) }
  }

  const sendTelegram = async (store: Store, rows: any[], storeBreads: Bread[]) => {
    const storeLabel: Record<string,string> = { jc:'JC', ja:'JA', ex:'EX', pj:'PJ' }
    const userLabel: Record<string,string> = { marselle:'Marselle', elis:'Elis', rodrigo:'Rodrigo' }
    const items = rows.filter((r:any) => r.quantity > 0)
    if (!items.length) return
    let msg = `🍞 *Pane & Salute — Novo pedido*\n`
    msg += `👤 ${userLabel[currentUser!]||currentUser} · Loja ${storeLabel[store]||store.toUpperCase()}\n`
    msg += `📅 Pães de ${DAYS_PT[delivIdx]}\n\n`
    items.forEach((r:any) => {
      const b = storeBreads.find(x=>x.id===r.bread_id)
      if (b) msg += `• ${b.name}: *${r.quantity}*\n`
    })
    if (obsMap[store]) msg += `\n📝 Obs: ${obsMap[store]}`
    try {
      await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ chat_id: TG_CHAT_ID, text: msg, parse_mode:'Markdown' })
      })
    } catch(e) { console.error('Telegram error:', e) }
  }

  // ── report ──────────────────────────────────────────────────────
  const changeReportDate = async (dateKey: string) => {
    setReportDate(dateKey)
    showLoad('Carregando...')
    try {
      const map = await loadOrders(dateKey)
      setReportOrders(map)
    } catch(e) { showToast('Erro ao carregar.') }
    finally { hideLoad() }
  }

  const duplicateOrders = async (storeFilter?: string) => {
    const src = reportOrders
    const stores = storeFilter ? [storeFilter] : ['ex','jc','ja','pj']
    const date = todayKey()
    const allRows: any[] = []
    stores.forEach(s => {
      const sv = src[s] || {}
      Object.values(sv).forEach((r:any) => {
        if ((r.quantity||0) > 0) {
          const row:any = { store:r.store, bread_id:r.bread_id, quantity:r.quantity, order_date:date, obs:r.obs||'' }
          if (s==='pj') { row.pj_client=r.pj_client||''; row.pj_delivery_date=r.pj_delivery_date||null }
          allRows.push(row)
        }
      })
    })
    if (!allRows.length) { showToast('Nenhum item para duplicar.'); return }
    setSyncState('syncing')
    try {
      await sbUpsert('orders', allRows, 'store,bread_id,order_date')
      const map = await loadOrders(todayKey())
      setOrders(map)
      initOrderState(map, breads)
      setOrderDate(todayKey())
      setSyncState('')
      showToast('Pedido duplicado para hoje!')
      setActiveTab(0)
    } catch(e) { setSyncState('error'); showToast('Erro ao duplicar.') }
  }

  // ── admin ────────────────────────────────────────────────────────
  const openNewBread = (isPJ: boolean) => {
    setEditingBread(null)
    setBreadForm({ name:'', days:[1,2,3,4,5,6], is_pj:isPJ })
    setModal('new-bread')
  }
  const openEditBread = (b: Bread) => {
    setEditingBread(b)
    setBreadForm({ name:b.name, days:parseDays(b.days), is_pj:b.is_pj })
    setModal('edit-bread')
  }
  const saveBreadForm = async () => {
    if (!breadForm.name.trim()) { showToast('Digite o nome.'); return }
    if (!breadForm.is_pj && !breadForm.days.length) { showToast('Selecione ao menos 1 dia.'); return }
    const id = editingBread?.id || slugify(breadForm.name)
    const days = breadForm.is_pj ? [0,1,2,3,4,5,6] : breadForm.days
    const data = { id, name:breadForm.name.trim(), days, active:true, is_pj:breadForm.is_pj }
    setSaving(true)
    try {
      await sbUpsert('breads', [data])
      await loadBreads()
      setModal('none')
      showToast(editingBread ? 'Atualizado!' : 'Cadastrado!')
    } catch(e) { showToast('Erro ao salvar.') }
    finally { setSaving(false) }
  }
  const confirmDelete = (b: Bread) => { setDeletingBread(b); setModal('confirm-delete') }
  const deleteBread = async () => {
    if (!deletingBread) return
    setSaving(true)
    try {
      await sbDel('breads', { id: deletingBread.id })
      await loadBreads()
      setModal('none')
      showToast('Excluído.')
    } catch(e) { showToast('Erro ao excluir.') }
    finally { setSaving(false) }
  }
  const toggleBread = async (b: Bread) => {
    const prev = b.active
    setBreads(bds => bds.map(x => x.id===b.id ? {...x,active:!prev} : x))
    try {
      await sbPatch('breads', { active:!prev }, { id:b.id })
      showToast((!prev ? b.name+' ativado' : b.name+' desativado'))
    } catch(e) {
      setBreads(bds => bds.map(x => x.id===b.id ? {...x,active:prev} : x))
      showToast('Erro ao salvar.')
    }
  }

  // ── geolar ───────────────────────────────────────────────────────
  const loadGeolar = async (dateKey: string) => {
    setGeolarDate(dateKey)
    showLoad('Carregando produção...')
    try {
      await loadBreads()
      const map = await loadOrders(dateKey)
      setGeolarOrders(map)
      setOrders(map)
    } catch(e) { showToast('Erro ao carregar.') }
    finally { hideLoad() }
  }

  const generateWhatsApp = (ordMap: OrderMap) => {
    const bds = breads.filter(b=>!b.is_pj&&b.active)
    const stores: Store[] = ['ex','jc','ja']
    const dLabel = deliveryDayLabel(delivIdx)
    let lines = [`*Pane & Salute — Produção ${dLabel}*\n`]
    bds.forEach(b => {
      const vals = stores.map(s => ordMap[s]?.[b.id]?.quantity || 0)
      if (vals.reduce((a,c)=>a+c,0) > 0) lines.push(`${b.name}  ${vals[0]}+${vals[1]}+${vals[2]}`)
    })
    const oEX = Object.values(ordMap['ex']||{})[0]?.obs
    const oJC = Object.values(ordMap['jc']||{})[0]?.obs
    const oJA = Object.values(ordMap['ja']||{})[0]?.obs
    if (oEX||oJC||oJA) { lines.push(''); if(oEX)lines.push(`_Obs EX: ${oEX}_`); if(oJC)lines.push(`_Obs JC: ${oJC}_`); if(oJA)lines.push(`_Obs JA: ${oJA}_`) }
    const pjSv = ordMap['pj'] || {}
    const pjItems = breads.filter(b=>b.is_pj&&b.active&&(pjSv[b.id]?.quantity||0)>0)
    if (pjItems.length) {
      const fr = Object.values(pjSv)[0] as any
      lines.push(''); lines.push(`*PJ — ${fr?.pj_client||'—'} · ${fr?.pj_delivery_date||'—'}*`)
      pjItems.forEach(p => lines.push(`${p.name}: ${pjSv[p.id]?.quantity||0}`))
    }
    const text = lines.join('\n')
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(()=>showToast('Copiado! Cole no WhatsApp.')).catch(()=>prompt('Copie:',text))
    else prompt('Copie:',text)
  }

  // ── derived ──────────────────────────────────────────────────────
  const todayBreads = breads.filter(b=>!b.is_pj&&b.active&&parseDays(b.days).includes(delivIdx))
  const pjBreads = breads.filter(b=>b.is_pj&&b.active)
  const calcTotal = (store: Store) => {
    const bds = store==='pj' ? pjBreads : todayBreads
    return bds.reduce((a,b) => a + (qtys[`${store}-${b.id}`]||0), 0)
  }

  const tabDefs = currentUser === 'rodrigo'
    ? [{label:'JC',store:'jc'},{label:'JA',store:'ja'},{label:'Relatório',store:null},{label:'Admin',store:null}]
    : currentUser === 'marselle'
    ? [{label:'Loja EX',store:'ex'},{label:'Histórico',store:null}]
    : [{label:'Pedido PJ',store:'pj'},{label:'Histórico',store:null}]

  // ── render helpers ───────────────────────────────────────────────
  const setQty = (key: string, val: number) => setQtys(prev=>({...prev,[key]:Math.max(0,val)}))

  // ── Render ───────────────────────────────────────────────────────
  if (screen === 'login') return <LoginScreen onLogin={login} />
  if (screen === 'geolar') return (
    <GeolarScreen
      breads={breads} orders={geolarOrders} geolarDate={geolarDate}
      delivIdx={delivIdx}
      onDateChange={loadGeolar}
      onWhatsApp={()=>generateWhatsApp(geolarOrders)}
      onLogout={logout}
      loading={loading} loadingMsg={loadingMsg}
    />
  )

  // main screen
  const activeStore = (tabDefs[activeTab]?.store as Store|null)
  const isOrderTab = activeStore === 'jc' || activeStore === 'ja' || activeStore === 'ex' || activeStore === 'pj'
  const isReportTab = tabDefs[activeTab]?.label === 'Relatório' || tabDefs[activeTab]?.label === 'Histórico'
  const isAdminTab = tabDefs[activeTab]?.label === 'Admin'

  const userBadge = currentUser === 'rodrigo' ? { cls:'tb-amber', lbl:'Rodrigo' }
    : currentUser === 'marselle' ? { cls:'tb-teal', lbl:'Marselle · EX' }
    : { cls:'tb-coral', lbl:'Elis · PJ' }

  const hoursLeft = getHoursLeft()
  const deadlineBar = isLocked
    ? <div className="deadline dl-locked"><span className="deadline-dot"/><span>Pedidos encerrados — reabrem às 04h00</span></div>
    : hoursLeft <= 2
    ? <div className="deadline dl-warn"><span className="deadline-dot"/><span>Menos de {hoursLeft}h para o prazo — encerra às 04h00</span></div>
    : <div className="deadline dl-ok"><span className="deadline-dot"/><span>Pedidos abertos · Pães de {deliveryDayLabel(delivIdx)}</span></div>

  return (
    <div id="app">
      {/* Topbar */}
      <div className="topbar">
        <div className="topbar-logo" onClick={logout} style={{cursor:'pointer'}}>
          Pane &amp; Salute{' '}
          {syncState==='syncing'&&<span style={{display:'inline-block',width:8,height:8,borderRadius:'50%',background:'#B8720A',marginLeft:4}}/>}
          {syncState==='error'&&<span style={{display:'inline-block',width:8,height:8,borderRadius:'50%',background:'#c00',marginLeft:4}}/>}
        </div>
        <span className={`topbar-badge ${userBadge.cls}`}>{userBadge.lbl}</span>
        <button className="btn-logout" onClick={logout}>Sair</button>
      </div>

      {/* Deadline bar */}
      <div style={{margin:'12px 16px 0'}}>{deadlineBar}</div>

      {/* Nav tabs */}
      <div className="nav-tabs">
        {tabDefs.map((t,i) => (
          <button key={i} className={`nav-tab${i===activeTab?' active':''}`} onClick={()=>setActiveTab(i)}>{t.label}</button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{padding:'16px'}}>
        {isOrderTab && activeStore && (
          <OrderForm
            store={activeStore as Store}
            breads={activeStore==='pj'?pjBreads:todayBreads}
            isPJ={activeStore==='pj'}
            delivIdx={delivIdx}
            isLocked={isLocked}
            qtys={qtys}
            obs={obsMap[activeStore]||''}
            pjClient={pjClient}
            pjDate={pjDate}
            onDelivChange={changeDelivDay}
            onQtyChange={(key,val)=>setQty(key,val)}
            onObsChange={(obs)=>setObsMap(prev=>({...prev,[activeStore]:obs}))}
            onPjClientChange={setPjClient}
            onPjDateChange={setPjDate}
          />
        )}
        {isReportTab && (
          <ReportView
            currentUser={currentUser!}
            storeFilter={currentUser==='marselle'?'ex':currentUser==='elis'?'pj':undefined}
            breads={breads}
            reportDate={reportDate}
            reportOrders={reportOrders}
            pjBreads={pjBreads}
            todayBds={todayBreads}
            onDateChange={changeReportDate}
            onDuplicate={duplicateOrders}
          />
        )}
        {isAdminTab && (
          <AdminView
            breads={breads}
            orders={orders}
            delivIdx={delivIdx}
            pjBreads={pjBreads}
            todayBds={todayBreads}
            onNewBread={openNewBread}
            onEditBread={openEditBread}
            onDeleteBread={confirmDelete}
            onToggleBread={toggleBread}
            onWhatsApp={()=>generateWhatsApp(orders)}
          />
        )}
      </div>

      {/* Bottom bar */}
      {isOrderTab && !isLocked && activeStore && (
        <div className="bottom-bar">
          <div className="total-info">Total: <strong>{calcTotal(activeStore as Store)}</strong> unidades</div>
          <button className="btn-save" disabled={saving} onClick={()=>saveOrder(activeStore as Store)}>
            {saving ? 'Salvando...' : activeStore==='pj'?'Salvar pedido PJ':'Salvar pedido'}
          </button>
        </div>
      )}

      {/* Modal */}
      {modal !== 'none' && (
        <div className="modal-overlay open" onClick={e=>{if(e.target===e.currentTarget)setModal('none')}}>
          <div className="modal-sheet">
            <div className="modal-handle"/>
            {(modal==='new-bread'||modal==='edit-bread') && (
              <BreadFormModal
                editingBread={editingBread}
                form={breadForm}
                onChange={setBreadForm}
                onSave={saveBreadForm}
                onCancel={()=>setModal('none')}
                saving={saving}
              />
            )}
            {modal==='confirm-delete' && deletingBread && (
              <div style={{padding:'20px 16px'}}>
                <h3 style={{marginBottom:12}}>Excluir {deletingBread.is_pj?'item PJ':'pão'}</h3>
                <p>Excluir <strong>{deletingBread.name}</strong>? Esta ação não pode ser desfeita.</p>
                <div style={{display:'flex',gap:10,marginTop:20}}>
                  <button className="btn btn-action danger" onClick={deleteBread} disabled={saving}>Excluir</button>
                  <button className="btn btn-action" onClick={()=>setModal('none')}>Cancelar</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Loading overlay */}
      {loading && (
        <div className="loading-overlay" style={{display:'flex'}}>
          <div className="spinner"/>
          <p>{loadingMsg}</p>
        </div>
      )}

      {/* Toast */}
      <div id="prod-toast" className="toast"/>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin:(u:UserKey)=>void }) {
  return (
    <div className="login-page">
      <div className="login-logo">
        <h1>Pane &amp; Salute</h1>
        <p>PRODUÇÃO</p>
        <div className="tagline">Cardápio do dia</div>
      </div>
      <div className="login-card">
        {[
          {key:'rodrigo',name:'Rodrigo',role:'Dono',cls:'av-amber'},
          {key:'marselle',name:'Marselle',role:'Expedição (EX)',cls:'av-teal'},
          {key:'elis',name:'Elis',role:'PJ',cls:'av-coral'},
          {key:'geolar',name:'Geolar',role:'Produção',cls:'av-gray'},
        ].map(u=>(
          <button key={u.key} className="login-btn" onClick={()=>onLogin(u.key as UserKey)}>
            <div className={`login-avatar ${u.cls}`}>{u.name[0]}</div>
            <div className="login-info">
              <div className="name">{u.name}</div>
              <div className="role">{u.role}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

interface OrderFormProps {
  store:Store; breads:Bread[]; isPJ:boolean; delivIdx:number; isLocked:boolean
  qtys:Record<string,number>; obs:string; pjClient:string; pjDate:string
  onDelivChange:(idx:number)=>void
  onQtyChange:(key:string,val:number)=>void
  onObsChange:(obs:string)=>void
  onPjClientChange:(v:string)=>void
  onPjDateChange:(v:string)=>void
}

function OrderForm({ store, breads, isPJ, delivIdx, isLocked, qtys, obs, pjClient, pjDate, onDelivChange, onQtyChange, onObsChange, onPjClientChange, onPjDateChange }:OrderFormProps) {
  const storeName = {jc:'Julio de Castilhos',ja:'Jardim América',ex:'Exposição',pj:'PJ'}[store]||store.toUpperCase()

  return (
    <div>
      {isPJ ? (
        <>
          <div style={{marginBottom:14}}>
            <div className="section-label" style={{marginBottom:6,marginTop:0}}>Cliente</div>
            <input className="obs-area" style={{minHeight:'auto',padding:'8px 12px'}} type="text" placeholder="Nome do cliente" value={pjClient} onChange={e=>onPjClientChange(e.target.value)} disabled={isLocked}/>
          </div>
          <div style={{marginBottom:14}}>
            <div className="section-label" style={{marginBottom:6,marginTop:0}}>Data de entrega</div>
            <input className="obs-area" style={{minHeight:'auto',padding:'8px 12px'}} type="date" value={pjDate} onChange={e=>onPjDateChange(e.target.value)} disabled={isLocked}/>
          </div>
        </>
      ) : (
        <div style={{marginBottom:14}}>
          <div className="section-label" style={{marginBottom:8,marginTop:0}}>Pães para qual dia?</div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            {[1,2,3,4,5,6].map(i=>(
              <button key={i} onClick={()=>onDelivChange(i)} style={{
                padding:'7px 14px',borderRadius:'var(--radius-sm)',fontSize:13,fontWeight:500,cursor:'pointer',fontFamily:'inherit',transition:'all 0.15s',
                border:`1px solid ${i===delivIdx?'var(--amber-border)':'var(--border)'}`,
                background:i===delivIdx?'var(--amber-bg)':'var(--surface)',
                color:i===delivIdx?'var(--amber)':'var(--text-muted)'
              }}>{DAYS_PT[i]}</button>
            ))}
          </div>
        </div>
      )}

      {!isPJ && <div className="section-label">{DAYS_PT[delivIdx]} — {storeName}</div>}
      {isPJ && <div className="section-label">Itens do pedido</div>}

      {breads.length === 0 ? (
        <div style={{color:'var(--text-muted)',fontSize:13,padding:'12px 0'}}>Nenhum pão disponível para {DAYS_PT[delivIdx]}.</div>
      ) : (
        <div className="bread-list">
          {breads.map(b=>{
            const key = `${store}-${b.id}`
            const val = qtys[key]||0
            return (
              <div key={b.id} className={`bread-row${val>0?' has-qty':''}`}>
                <div className="bread-info">
                  <div className="bread-name">{b.name}</div>
                  {!isPJ&&<div className="bread-days">{parseDays(b.days).length===7?'todos os dias':parseDays(b.days).map(d=>DAYS_PT[d]).join(' · ')}</div>}
                </div>
                <div className="qty-wrap">
                  <button className="qty-btn" onClick={()=>onQtyChange(key,val-1)} disabled={isLocked}>−</button>
                  <input className="qty-input" type="number" inputMode="numeric" min={0} value={val||''} placeholder="0"
                    onChange={e=>onQtyChange(key,parseInt(e.target.value)||0)} disabled={isLocked}/>
                  <button className="qty-btn" onClick={()=>onQtyChange(key,val+1)} disabled={isLocked}>+</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div style={{marginTop:14}}>
        <div className="section-label" style={{marginTop:0}}>Observações</div>
        <textarea className="obs-area" placeholder="Ex: reforçar baguete, pegar croissant do congelado..." value={obs} onChange={e=>onObsChange(e.target.value)} disabled={isLocked}/>
      </div>
      {isLocked&&<div style={{marginTop:12,padding:'10px 14px',background:'var(--red-bg)',border:'1px solid var(--red-border)',borderRadius:'var(--radius-sm)',fontSize:13,color:'var(--red)'}}>Pedidos encerrados. Reabrem às 04h00.</div>}
    </div>
  )
}

interface ReportProps {
  currentUser:string; storeFilter?:string; breads:Bread[]; reportDate:string
  reportOrders:OrderMap; pjBreads:Bread[]; todayBds:Bread[]
  onDateChange:(d:string)=>void; onDuplicate:(s?:string)=>void
}

function ReportView({ currentUser, storeFilter, breads, reportDate, reportOrders, pjBreads, todayBds, onDateChange, onDuplicate }:ReportProps) {
  const isToday = reportDate === todayKey()
  const pjSv = reportOrders['pj'] || {}
  const pjItems = pjBreads.filter(b=>(pjSv[b.id]?.quantity||0)>0)

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:'1rem',flexWrap:'wrap'}}>
        <span style={{fontSize:12,color:'var(--text-muted)'}}>Data:</span>
        <input type="date" value={reportDate} className="obs-area" style={{width:'auto',padding:'6px 10px',fontSize:13,minHeight:'auto'}} onChange={e=>onDateChange(e.target.value)}/>
        {isToday&&<span style={{fontSize:11,color:'var(--teal)',background:'var(--teal-bg)',border:'1px solid var(--teal-border)',padding:'2px 8px',borderRadius:10}}>hoje</span>}
      </div>

      {/* PJ view */}
      {storeFilter==='pj' && (
        <>
          <div className="stat-row">
            <div className="stat-card" style={{gridColumn:'1/-1'}}>
              <div className="lbl">Total PJ</div>
              <div className="val">{pjItems.reduce((a,p)=>a+(pjSv[p.id]?.quantity||0),0)}</div>
            </div>
          </div>
          {!pjItems.length ? <div style={{color:'var(--text-muted)',fontSize:13}}>Nenhum pedido PJ nesta data.</div> : (
            <>
              {Object.values(pjSv)[0] && <div style={{fontSize:13,color:'var(--text-muted)',marginBottom:8}}>
                Cliente: <strong>{(Object.values(pjSv)[0] as any)?.pj_client}</strong> · Entrega: {(Object.values(pjSv)[0] as any)?.pj_delivery_date||'—'}
              </div>}
              <table className="report-table"><thead><tr><th>Item</th><th className="num">Qtd</th></tr></thead>
                <tbody>{pjItems.map(p=><tr key={p.id}><td>{p.name}</td><td className="num">{pjSv[p.id]?.quantity||0}</td></tr>)}</tbody>
              </table>
            </>
          )}
          {!isToday&&<div style={{marginTop:'1rem',paddingTop:'1rem',borderTop:'1px solid var(--border)'}}>
            <div style={{fontSize:13,color:'var(--text-muted)',marginBottom:8}}>Repetir este pedido hoje?</div>
            <button className="btn-save" onClick={()=>onDuplicate('pj')}>Duplicar para hoje</button>
          </div>}
        </>
      )}

      {/* Single store view (marselle = EX) */}
      {storeFilter&&storeFilter!=='pj' && (() => {
        const sv = reportOrders[storeFilter] || {}
        const storeLabel = {ex:'Exposição',jc:'Julio de Castilhos',ja:'Jardim América'}[storeFilter]||storeFilter.toUpperCase()
        const rows = todayBds.filter(b=>(sv[b.id]?.quantity||0)>0)
        const total = rows.reduce((a,b)=>a+(sv[b.id]?.quantity||0),0)
        return (
          <>
            <div className="stat-row">
              <div className="stat-card" style={{gridColumn:'1/-1'}}>
                <div className="lbl">{storeLabel}</div><div className="val">{total}</div>
              </div>
            </div>
            {!rows.length ? <div style={{color:'var(--text-muted)',fontSize:13}}>Nenhum pedido nesta data.</div> : <>
              {Object.values(sv)[0] && (Object.values(sv)[0] as any).obs && <div style={{fontSize:13,color:'var(--text-muted)',marginBottom:8,padding:'8px 12px',background:'var(--amber-bg)',borderRadius:'var(--radius-sm)'}}>Obs: {(Object.values(sv)[0] as any).obs}</div>}
              <table className="report-table"><thead><tr><th>Pão</th><th className="num">Qtd</th></tr></thead>
                <tbody>
                  {rows.map(b=><tr key={b.id}><td>{b.name}</td><td className="num">{sv[b.id]?.quantity||0}</td></tr>)}
                  <tr><td>Total</td><td className="num">{total}</td></tr>
                </tbody>
              </table>
            </>}
            {!isToday&&<div style={{marginTop:'1rem',paddingTop:'1rem',borderTop:'1px solid var(--border)'}}>
              <div style={{fontSize:13,color:'var(--text-muted)',marginBottom:8}}>Repetir este pedido hoje?</div>
              <button className="btn-save" onClick={()=>onDuplicate(storeFilter)}>Duplicar para hoje</button>
            </div>}
          </>
        )
      })()}

      {/* Consolidated view (rodrigo) */}
      {!storeFilter && (() => {
        const stores: Store[] = ['ex','jc','ja']
        const regularBreads = breads.filter(b=>!b.is_pj&&b.active)
        const tots: Record<string,number> = { ex:0, jc:0, ja:0 }
        stores.forEach(s=>{ regularBreads.forEach(b=>{ tots[s]+=(reportOrders[s]?.[b.id]?.quantity||0) }) })
        const grand = Object.values(tots).reduce((a,c)=>a+c,0)
        return (
          <>
            <div className="stat-row">
              {stores.map(s=><div key={s} className="stat-card"><div className="lbl">{s.toUpperCase()}</div><div className="val">{tots[s]}</div></div>)}
            </div>
            {grand===0 ? <div style={{color:'var(--text-muted)',fontSize:13}}>Nenhum pedido nesta data.</div> : <>
              <div className="section-label">Pedidos de {dateLabel(reportDate)}</div>
              <table className="report-table">
                <thead><tr><th>Pão</th><th className="num">EX</th><th className="num">JC</th><th className="num">JA</th><th className="num">Total</th></tr></thead>
                <tbody>
                  {regularBreads.filter(b=>stores.some(s=>(reportOrders[s]?.[b.id]?.quantity||0)>0)).map(b=>{
                    const vals = stores.map(s=>reportOrders[s]?.[b.id]?.quantity||0)
                    return <tr key={b.id}><td>{b.name}</td>{vals.map((v,i)=><td key={i} className={`num${v===0?' zero':''}`}>{v===0?'—':v}</td>)}<td className="num">{vals.reduce((a,c)=>a+c,0)}</td></tr>
                  })}
                  <tr><td>Total</td>{stores.map(s=><td key={s} className="num">{tots[s]}</td>)}<td className="num">{grand}</td></tr>
                </tbody>
              </table>
              {pjItems.length>0&&<>
                <div className="section-label" style={{marginTop:20}}>PJ — {(Object.values(pjSv)[0] as any)?.pj_client||'—'} · {(Object.values(pjSv)[0] as any)?.pj_delivery_date||'—'}</div>
                <table className="report-table"><thead><tr><th>Item</th><th className="num">Qtd</th></tr></thead>
                  <tbody>{pjItems.map(p=><tr key={p.id}><td>{p.name}</td><td className="num">{pjSv[p.id]?.quantity||0}</td></tr>)}</tbody>
                </table>
              </>}
            </>}
            {!isToday&&<div style={{marginTop:'1rem',paddingTop:'1rem',borderTop:'1px solid var(--border)'}}>
              <div style={{fontSize:13,color:'var(--text-muted)',marginBottom:8}}>Repetir esta produção hoje?</div>
              <button className="btn-save" onClick={()=>onDuplicate()}>Duplicar para hoje</button>
            </div>}
          </>
        )
      })()}
    </div>
  )
}

interface AdminProps {
  breads:Bread[]; orders:OrderMap; delivIdx:number; pjBreads:Bread[]; todayBds:Bread[]
  onNewBread:(isPJ:boolean)=>void; onEditBread:(b:Bread)=>void
  onDeleteBread:(b:Bread)=>void; onToggleBread:(b:Bread)=>void; onWhatsApp:()=>void
}

function AdminView({ breads, orders, delivIdx, pjBreads, todayBds, onNewBread, onEditBread, onDeleteBread, onToggleBread, onWhatsApp }:AdminProps) {
  const regular = breads.filter(b=>!b.is_pj)
  const pj = breads.filter(b=>b.is_pj)
  const stores: Store[] = ['ex','jc','ja']

  // Print preview
  let grand = 0
  const printRows = todayBds.map(b=>{
    const vals = stores.map(s=>orders[s]?.[b.id]?.quantity||0)
    const tot = vals.reduce((a,c)=>a+c,0); grand+=tot
    return { ...b, vals, tot }
  }).filter(b=>b.tot>0)

  return (
    <div>
      {/* Regular breads */}
      <div className="section-header">
        <div className="section-label" style={{margin:0}}>Pães das lojas ({regular.length})</div>
        <button className="btn-save" style={{padding:'6px 14px',fontSize:12}} onClick={()=>onNewBread(false)}>+ Novo pão</button>
      </div>
      {!regular.length&&<div style={{color:'var(--text-muted)',fontSize:13,marginBottom:12}}>Nenhum pão. Clique em "+ Novo pão".</div>}
      {regular.map(b=>(
        <div key={b.id} className={`admin-item${b.active?'':' inactive'}`}>
          <div className="admin-info">
            <div className="admin-name">{b.name}</div>
            <div className="admin-meta">{parseDays(b.days).length===7?'todos os dias':parseDays(b.days).map(d=>DAYS_PT[d]).join(' · ')}</div>
          </div>
          <div className="admin-actions">
            <button className="icon-btn edit" onClick={()=>onEditBread(b)}>✎</button>
            <button className="icon-btn del" onClick={()=>onDeleteBread(b)}>✕</button>
            <button className={`toggle${b.active?' on':''}`} onClick={()=>onToggleBread(b)}/>
          </div>
        </div>
      ))}

      {/* PJ items */}
      <div className="section-header" style={{marginTop:24}}>
        <div className="section-label" style={{margin:0}}>Itens PJ ({pj.length})</div>
        <button className="btn-save" style={{padding:'6px 14px',fontSize:12}} onClick={()=>onNewBread(true)}>+ Novo item PJ</button>
      </div>
      {!pj.length&&<div style={{color:'var(--text-muted)',fontSize:13,marginBottom:12}}>Nenhum item PJ.</div>}
      {pj.map(b=>(
        <div key={b.id} className={`admin-item${b.active?'':' inactive'}`}>
          <div className="admin-info">
            <div className="admin-name">{b.name}</div>
            <div className="admin-meta">Item exclusivo PJ</div>
          </div>
          <div className="admin-actions">
            <button className="icon-btn edit" onClick={()=>onEditBread(b)}>✎</button>
            <button className="icon-btn del" onClick={()=>onDeleteBread(b)}>✕</button>
            <button className={`toggle${b.active?' on':''}`} onClick={()=>onToggleBread(b)}/>
          </div>
        </div>
      ))}

      {/* Print preview */}
      <div className="section-label" style={{marginTop:24}}>Pré-visualização — Geolar</div>
      <div className="print-card">
        <h3>Pane &amp; Salute — Produção</h3>
        <div className="pmeta">Para {DAYS_PT[delivIdx]} · Gerado {new Date().toLocaleString('pt-BR')}</div>
        <div className="print-row ph"><span>Pão</span><span>EX</span><span>JC</span><span>JA</span><span>Total</span></div>
        {printRows.map(b=>(
          <div key={b.id} className="print-row">
            <span className="pname">{b.name}</span>
            {b.vals.map((v,i)=><span key={i}>{v}</span>)}
            <span className="ptotal">{b.tot}</span>
          </div>
        ))}
        <div className="print-row" style={{fontWeight:500,marginTop:8,paddingTop:8,borderTop:'1px solid var(--border)'}}>
          <span>TOTAL GERAL</span><span/><span/><span/><span className="ptotal">{grand}</span>
        </div>
      </div>
      <div className="btn-row" style={{marginTop:12}}>
        <button className="btn-save" onClick={onWhatsApp}>Copiar para WhatsApp</button>
        <button className="btn-action" onClick={()=>window.print()}>Imprimir</button>
      </div>
    </div>
  )
}

interface BreadFormModalProps {
  editingBread:Bread|null; form:BreadForm
  onChange:(f:BreadForm)=>void; onSave:()=>void; onCancel:()=>void; saving:boolean
}

function BreadFormModal({ editingBread, form, onChange, onSave, onCancel, saving }:BreadFormModalProps) {
  const toggleDay = (day:number) => {
    const newDays = form.days.includes(day) ? form.days.filter(d=>d!==day) : [...form.days,day]
    onChange({...form,days:newDays})
  }
  return (
    <div style={{padding:'20px 16px'}}>
      <h3 style={{marginBottom:16}}>{editingBread?'Editar':'Cadastrar'} {form.is_pj?'item PJ':'pão'}</h3>
      <div style={{marginBottom:14}}>
        <div className="section-label" style={{marginTop:0}}>Nome</div>
        <input className="obs-area" style={{minHeight:'auto',padding:'8px 12px'}} type="text"
          placeholder={form.is_pj?'Ex: Pão Fatiado PJ...':'Ex: Ciabatta, Baguete integral...'}
          value={form.name} onChange={e=>onChange({...form,name:e.target.value})}/>
      </div>
      {!form.is_pj && (
        <div style={{marginBottom:14}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
            <div className="section-label" style={{margin:0}}>Dias disponíveis</div>
            <button type="button" className="btn-action sm" style={{fontSize:11,padding:'3px 10px'}}
              onClick={()=>onChange({...form,days:[1,2,3,4,5,6]})}>Seg–Sáb</button>
          </div>
          <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
            {DAYS_PT.map((d,i)=>(
              <button key={i} onClick={()=>i!==0&&toggleDay(i)} style={{
                padding:'6px 12px',borderRadius:'var(--radius-sm)',fontSize:12,fontWeight:500,cursor:i===0?'not-allowed':'pointer',
                opacity:i===0?0.35:1,fontFamily:'inherit',
                border:`1px solid ${form.days.includes(i)?'var(--amber-border)':'var(--border)'}`,
                background:form.days.includes(i)?'var(--amber-bg)':'var(--surface)',
                color:form.days.includes(i)?'var(--amber)':'var(--text-muted)'
              }}>{d}</button>
            ))}
          </div>
        </div>
      )}
      <div style={{display:'flex',gap:10,marginTop:20}}>
        <button className="btn-save" onClick={onSave} disabled={saving}>{saving?'Salvando...':editingBread?'Salvar':'Cadastrar'}</button>
        <button className="btn-action" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  )
}

interface GeolarProps {
  breads:Bread[]; orders:OrderMap; geolarDate:string; delivIdx:number
  onDateChange:(d:string)=>void; onWhatsApp:()=>void; onLogout:()=>void
  loading:boolean; loadingMsg:string
}

function GeolarScreen({ breads, orders, geolarDate, delivIdx, onDateChange, onWhatsApp, onLogout, loading, loadingMsg }:GeolarProps) {
  const todayBds = breads.filter(b=>!b.is_pj&&b.active)
  const stores: Store[] = ['ex','jc','ja']
  let grand = 0
  const printRows = todayBds.map(b=>{
    const vals = stores.map(s=>orders[s]?.[b.id]?.quantity||0)
    const tot = vals.reduce((a,c)=>a+c,0); grand+=tot
    return {...b,vals,tot}
  }).filter(b=>b.tot>0)

  const pjSv = orders['pj']||{}
  const pjBreads = breads.filter(b=>b.is_pj&&b.active&&(pjSv[b.id]?.quantity||0)>0)
  const dLabel = (() => { const d=new Date(geolarDate+'T12:00:00'); return d.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'2-digit'}) })()

  return (
    <div id="app">
      <div className="topbar">
        <div className="topbar-logo" onClick={onLogout} style={{cursor:'pointer'}}>Pane &amp; Salute</div>
        <span className="topbar-badge tb-gray">Geolar</span>
        <button className="btn-logout" onClick={onLogout}>Sair</button>
      </div>
      <div style={{padding:'16px'}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:'1rem'}}>
          <span style={{fontSize:12,color:'var(--text-muted)'}}>Data dos pedidos:</span>
          <input type="date" value={geolarDate} className="obs-area" style={{width:'auto',padding:'6px 10px',fontSize:13,minHeight:'auto'}} onChange={e=>onDateChange(e.target.value)}/>
        </div>

        <div className="print-card">
          <h3>Pane &amp; Salute — Produção</h3>
          <div className="pmeta">Para {dLabel} · Gerado {new Date().toLocaleString('pt-BR')}</div>
          <div className="print-row ph"><span>Pão</span><span>EX</span><span>JC</span><span>JA</span><span>Total</span></div>
          {!printRows.length && <div style={{color:'var(--text-muted)',fontSize:13,padding:'12px 0',textAlign:'center'}}>Nenhum pedido para esta data.</div>}
          {printRows.map(b=>(
            <div key={b.id} className="print-row">
              <span className="pname">{b.name}</span>
              {b.vals.map((v,i)=><span key={i}>{v}</span>)}
              <span className="ptotal">{b.tot}</span>
            </div>
          ))}
          {printRows.length>0&&<div className="print-row" style={{fontWeight:500,marginTop:8,paddingTop:8,borderTop:'1px solid var(--border)'}}>
            <span>TOTAL GERAL</span><span/><span/><span/><span className="ptotal">{grand}</span>
          </div>}
          {pjBreads.length>0&&<div style={{marginTop:12,paddingTop:10,borderTop:'1px solid var(--border)'}}>
            <div style={{fontSize:12,fontWeight:500,marginBottom:6}}>PJ — {(Object.values(pjSv)[0] as any)?.pj_client||'—'} · {(Object.values(pjSv)[0] as any)?.pj_delivery_date||'—'}</div>
            {pjBreads.map(p=><div key={p.id} style={{fontSize:12}}>{p.name}: {pjSv[p.id]?.quantity||0}</div>)}
          </div>}
        </div>

        <div className="btn-row" style={{marginTop:12}}>
          <button className="btn-save" onClick={()=>window.print()}>Imprimir</button>
          <button className="btn-action" onClick={onWhatsApp}>Copiar texto</button>
          <button className="btn-action" onClick={()=>onDateChange(geolarDate)}>↻ Atualizar</button>
        </div>
      </div>

      {loading&&<div className="loading-overlay" style={{display:'flex'}}><div className="spinner"/><p>{loadingMsg}</p></div>}
      <div id="prod-toast" className="toast"/>
    </div>
  )
}
