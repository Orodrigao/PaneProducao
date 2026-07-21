'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getCurrentUser, logout as authLogout, firstAllowedRoute } from '@/lib/auth'
import {
  resolveProductionHomeUserKey,
  type ProductionHomeUserKey,
} from '@/lib/productionHomeAccess'
import { aggregateWholePending, clampReuseProposal } from '@/lib/breadLeftovers'
import { supabase } from '@/lib/supabase'
import { SupabaseRestError, supabaseRestFetch } from '@/lib/supabaseRest'
import { nowBrasilia, todayKey, showToast } from '@/lib/utils'
import { LogOut, Clock, AlarmClock, Save, Minus, Plus, Check } from 'lucide-react'

const TG_TOKEN = process.env.NEXT_PUBLIC_TELEGRAM_BOT_TOKEN!
const TG_CHAT_ID = process.env.NEXT_PUBLIC_TELEGRAM_CHAT_ID!
const DAYS_PT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']
const DAY_FULL_PT: Record<number,string> = {1:'Segunda',2:'Terça',3:'Quarta',4:'Quinta',5:'Sexta',6:'Sábado'}
const DELIVERY_MAP: Record<number,number> = {0:1,1:2,2:3,3:4,4:6,5:6,6:1}

// Categorias de products que NAO entram em "Itens JC" (lista de producao nao-pao).
// INSUMOS = ingredientes; Paes* = ja tem fluxo em /forno via tabela breads.
const NON_PRODUCT_CATS = ['INSUMOS','Pães Branco','Pães Integ.','Pães Rech.','Pães Recheados']

type UserKey = ProductionHomeUserKey
type Store = 'jc'|'ja'|'ex'|'pj'
type Screen = 'init'|'login'|'main'|'geolar'

interface Bread { id:string; name:string; days:any; active:boolean; is_pj:boolean }
interface ProdItem { id:string; name:string; category:string; unit:string|null }
interface ProdProductionRow { product_id:string; quantity:number; obs:string|null }
interface OrderRow { store:string; bread_id:string; quantity:number; obs:string; pj_client?:string; pj_delivery_date?:string; order_date:string }
type OrderMap = Record<string, Record<string, OrderRow>>
type ModalMode = 'none'|'new-bread'|'edit-bread'|'confirm-delete'

interface BreadForm { name:string; days:number[]; is_pj:boolean }
interface ReusePlanSummary { status:string; proposedQuantity:number; confirmedQuantity:number }

// ── utils ──────────────────────────────────────────────────────────
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

// ── Supabase ────────────────────────────────────────────────────────
async function sbGet(table:string, params='') {
  const r = await supabaseRestFetch(`${table}?${params}`)
  return r.json()
}
async function sbUpsert(table:string, data:any, onConflict?:string) {
  const qs = onConflict ? `?on_conflict=${onConflict}` : ''
  const r = await supabaseRestFetch(`${table}${qs}`, {
    method:'POST', headers:{'Prefer':'resolution=merge-duplicates,return=representation'}, body:JSON.stringify(data)
  })
  return r.json()
}
async function sbInsert(table:string, data:any) {
  const r = await supabaseRestFetch(table, {
    method:'POST', headers:{'Prefer':'return=representation'}, body:JSON.stringify(data)
  })
  return r.json()
}
async function sbPatch(table:string, data:any, match:Record<string,string>) {
  const q = Object.entries(match).map(([k,v])=>`${k}=eq.${v}`).join('&')
  const r = await supabaseRestFetch(`${table}?${q}`, {
    method:'PATCH', headers:{'Prefer':'return=representation'}, body:JSON.stringify(data)
  })
  return r.json()
}
async function sbDel(table:string, match:Record<string,string>) {
  const q = Object.entries(match).map(([k,v])=>`${k}=eq.${v}`).join('&')
  await supabaseRestFetch(`${table}?${q}`, { method:'DELETE' })
}

// ── Main Component ──────────────────────────────────────────────────
export default function ProducaoPage() {
  const router = useRouter()
  const [screen, setScreen] = useState<Screen>('init')
  const [currentUser, setCurrentUser] = useState<UserKey|null>(null)
  const [breads, setBreads] = useState<Bread[]>([])
  const [orders, setOrders] = useState<OrderMap>({})
  const [orderDate, setOrderDate] = useState(todayKey())
  const [delivIdx, setDelivIdx] = useState(() => DELIVERY_MAP[nowBrasilia().getDay()] ?? 1)
  const [isLocked, setIsLocked] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('Carregando...')
  const [initialLoadError, setInitialLoadError] = useState('')
  const [activeTab, setActiveTab] = useState(0)
  const [syncState, setSyncState] = useState<''|'syncing'|'error'>('')
  // qty state per store: key = "store-breadId"
  const [qtys, setQtys] = useState<Record<string,number>>({})
  const [pendingLeftovers, setPendingLeftovers] = useState<Record<string,number>>({})
  const [reuseProposalQtys, setReuseProposalQtys] = useState<Record<string,number>>({})
  const [reusePlans, setReusePlans] = useState<Record<string,ReusePlanSummary>>({})
  const [obsMap, setObsMap] = useState<Record<string,string>>({})
  const [pjClient, setPjClient] = useState('')
  const [pjDate, setPjDate] = useState('')
  // report
  const [reportDate, setReportDate] = useState(todayKey())
  const [reportOrders, setReportOrders] = useState<OrderMap>({})
  const reportReqRef = useRef(0) // descarta respostas fora de ordem ao trocar de data rápido
  // admin modal
  const [modal, setModal] = useState<ModalMode>('none')
  const [editingBread, setEditingBread] = useState<Bread|null>(null)
  const [breadForm, setBreadForm] = useState<BreadForm>({ name:'', days:[1,2,3,4,5,6], is_pj:false })
  const [deletingBread, setDeletingBread] = useState<Bread|null>(null)
  const [saving, setSaving] = useState(false)
  // geolar date picker
  const [geolarDate, setGeolarDate] = useState(todayKey())
  const [geolarOrders, setGeolarOrders] = useState<OrderMap>({})
  const [geolarEnc, setGeolarEnc] = useState<{client:string;name:string;qty:number}[]>([])
  const [geolarPj, setGeolarPj]   = useState<{client:string;name:string;qty:number}[]>([])
  // Itens JC (producao de nao-paes — bolos, salgados, doces, etc)
  const [prodItems, setProdItems] = useState<ProdItem[]>([])
  const [prodQtys, setProdQtys]   = useState<Record<string,number>>({})
  const [prodObs, setProdObs]     = useState('')
  const [prodDate, setProdDate]   = useState(todayKey())
  const [prodSaving, setProdSaving] = useState(false)

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
      const rows: OrderRow[] = await sbGet('orders',`cancelled_at=is.null&order_date=eq.${dateKey}&select=store,bread_id,quantity,obs,pj_client,pj_delivery_date`)
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

  const loadReuseContext = useCallback(async (dateKey: string) => {
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) {
        setPendingLeftovers({})
        setReuseProposalQtys({})
        setReusePlans({})
        return
      }

      const [leftoversResult, plansResult] = await Promise.all([
        supabase
          .from('sobras')
          .select('store, product_id, pending_quantity')
          .in('store', ['jc', 'ja'])
          .eq('product_source', 'bread')
          .lt('record_date', dateKey)
          .gt('pending_quantity', 0),
        supabase
          .from('bread_reuse_plans')
          .select('store, bread_id, proposed_quantity, confirmed_quantity, status')
          .eq('target_production_date', dateKey),
      ])
      if (leftoversResult.error) throw leftoversResult.error
      if (plansResult.error) throw plansResult.error

      const pending = Object.fromEntries(
        aggregateWholePending(leftoversResult.data ?? []).entries(),
      )
      const proposals: Record<string,number> = {}
      const loadedPlans: Record<string,ReusePlanSummary> = {}
      for (const plan of plansResult.data ?? []) {
        if ((plan.store !== 'jc' && plan.store !== 'ja') || !plan.bread_id) continue
        const key = `${plan.store}-${plan.bread_id}`
        const proposedQuantity = Number(plan.proposed_quantity ?? 0)
        proposals[key] = plan.status === 'cancelled' ? 0 : proposedQuantity
        loadedPlans[key] = {
          status: String(plan.status),
          proposedQuantity,
          confirmedQuantity: Number(plan.confirmed_quantity ?? 0),
        }
      }
      setPendingLeftovers(pending)
      setReuseProposalQtys(proposals)
      setReusePlans(loadedPlans)
    } catch {
      setPendingLeftovers({})
      setReuseProposalQtys({})
      setReusePlans({})
    }
  }, [])

  // Geolar: encomendas marcadas "produção" + pedidos PJ que produzem nesta data.
  // Mesma lógica de data do /forno: encomenda/PJ por production_date (PJ legado cai no pj_delivery_date).
  const loadGeolarExtras = useCallback(async (dateKey: string) => {
    try {
      const [encRows, pjRaw] = await Promise.all([
        sbGet('orders', `cancelled_at=is.null&order_type=eq.encomenda&needs_production=eq.true&production_date=eq.${dateKey}&quantity=gt.0&select=product_name,bread_id,quantity,pj_client`),
        sbGet('orders', `cancelled_at=is.null&store=eq.pj&quantity=gt.0&or=(production_date.eq.${dateKey},pj_delivery_date.eq.${dateKey})&select=product_name,bread_id,quantity,pj_client,production_date,pj_delivery_date`),
      ])
      setGeolarEnc((encRows as any[]).map(r => ({ client: r.pj_client || 'Encomenda', name: r.product_name || r.bread_id, qty: Number(r.quantity)||0 })))
      const pjFiltered = (pjRaw as any[]).filter(o => o.production_date ? o.production_date === dateKey : o.pj_delivery_date === dateKey)
      setGeolarPj(pjFiltered.map(r => ({ client: r.pj_client || 'PJ', name: r.product_name || r.bread_id, qty: Number(r.quantity)||0 })))
    } catch { setGeolarEnc([]); setGeolarPj([]) }
  }, [])

  // Itens JC — carregar produtos elegiveis (uma vez) + producao do dia
  const loadProdItems = useCallback(async () => {
    const cats = NON_PRODUCT_CATS.map(c => `"${c}"`).join(',')
    const data: ProdItem[] = await sbGet('products', `active=eq.true&category=not.in.(${encodeURIComponent(cats)})&select=id,name,category,unit&order=category.asc,name.asc`)
    setProdItems(data)
    return data
  }, [])

  const loadProdProduction = useCallback(async (dateKey: string, items: ProdItem[]) => {
    const rows: ProdProductionRow[] = await sbGet('product_production', `store=eq.jc&production_date=eq.${dateKey}&select=product_id,quantity,obs`)
    const qs: Record<string,number> = {}
    items.forEach(p => { qs[p.id] = 0 })
    let firstObs = ''
    rows.forEach(r => {
      qs[r.product_id] = Number(r.quantity) || 0
      if (!firstObs && r.obs) firstObs = r.obs
    })
    setProdQtys(qs)
    setProdObs(firstObs)
  }, [])

  const saveItensJC = async () => {
    if (!prodItems.length) return
    setProdSaving(true)
    setSyncState('syncing')
    try {
      await sbDel('product_production', { store: 'jc', production_date: prodDate })
      const rows = prodItems
        .map(p => ({
          store: 'jc',
          product_id: p.id,
          quantity: prodQtys[p.id] || 0,
          production_date: prodDate,
          obs: prodObs || null,
        }))
        .filter(r => r.quantity > 0)
      if (rows.length > 0) {
        await sbUpsert('product_production', rows, 'store,product_id,production_date')
      }
      setSyncState('')
      showToast('Lista de itens salva!')
    } catch(e) {
      setSyncState('error')
      showToast('Erro ao salvar. Tente novamente.')
    } finally { setProdSaving(false) }
  }

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
    setInitialLoadError('')
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
        // Carrega Itens JC pra mesma data — Geolar precisa ver não-pães também
        try {
          const items = await loadProdItems()
          setProdDate(defDate)
          await loadProdProduction(defDate, items)
          await loadGeolarExtras(defDate)
        } catch(e) { /* não bloqueia login */ }
        hideLoad()
        setScreen('geolar')
        return
      }
      const defDate = deliveryDateKey(todayDelivIdx)
      const map = await loadOrders(defDate)
      setOrders(map)
      setOrderDate(defDate)
      initOrderState(map, bds)
      await loadReuseContext(defDate)
      setActiveTab(0)
      // Rodrigão: pré-carrega catálogo de Itens JC pra evitar lag ao clicar a aba
      if (user === 'rodrigo') {
        try {
          const items = await loadProdItems()
          await loadProdProduction(prodDate, items)
        } catch(e) { /* não bloqueia login */ }
      }
      hideLoad()
      setScreen('main')
    } catch(e) {
      hideLoad()
      if (e instanceof SupabaseRestError && e.status === 401) {
        showToast('Sua sessão expirou. Entre novamente.')
        authLogout()
        router.replace('/login?force=email&returnTo=/')
        return
      }
      setInitialLoadError('Não foi possível carregar a Produção. Verifique a internet e tente novamente.')
    }
  }

  const logout = () => {
    setCurrentUser(null)
    setBreads([]); setOrders({}); setQtys({}); setObsMap({})
    setPendingLeftovers({}); setReuseProposalQtys({}); setReusePlans({})
    setActiveTab(0)
    setScreen('login')
    authLogout()
    router.push('/login')
  }

  // Auto-resolve: usa o usuário autenticado globalmente em vez do seletor interno.
  useEffect(() => {
    const globalUser = getCurrentUser()
    if (!globalUser) {
      router.replace('/login')
      return
    }
    const userKey = resolveProductionHomeUserKey(globalUser)
    if (userKey) login(userKey)
    else router.replace(firstAllowedRoute(globalUser))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

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
      await loadReuseContext(newDate)
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
      order_date: date, order_type: 'producao', obs,
      ...(store==='pj' ? { pj_client: pjClient, pj_delivery_date: pjDate||null } : {})
    }))
    const isManagedStore = store === 'jc' || store === 'ja'
    const proposals = isManagedStore
      ? storeBreads.map(b => ({
          bread_id: b.id,
          quantity: reusePlans[`${store}-${b.id}`]?.status === 'confirmed'
            ? reusePlans[`${store}-${b.id}`].proposedQuantity
            : clampReuseProposal(
                reuseProposalQtys[`${store}-${b.id}`] ?? 0,
                qtys[`${store}-${b.id}`] ?? 0,
                pendingLeftovers[`${store}-${b.id}`] ?? 0,
              ),
        }))
      : []
    const hasReuseContext = isManagedStore && storeBreads.some(b => {
      const key = `${store}-${b.id}`
      return (reuseProposalQtys[key] ?? 0) > 0
        || (Boolean(reusePlans[key]) && reusePlans[key].status !== 'cancelled')
    })

    if (isManagedStore) {
      const invalidConfirmed = storeBreads.find(b => {
        const key = `${store}-${b.id}`
        const plan = reusePlans[key]
        return plan?.status === 'confirmed'
          && (qtys[key] ?? 0) < plan.confirmedQuantity
      })
      if (invalidConfirmed) {
        showToast('O pedido não pode ficar abaixo da sobra já confirmada para a vitrine.')
        return
      }
    }

    if (hasReuseContext) {
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) {
        showToast('Entre com e-mail para salvar o reaproveitamento junto com o pedido.')
        return
      }
    }
    setSaving(true)
    setSyncState('syncing')
    try {
      await sbDel('orders', { store, order_date: date })
      await sbInsert('orders', rows)
      if (hasReuseContext) {
        const { error } = await supabase.rpc('save_bread_reuse_proposals', {
          p_target_production_date: date,
          p_store: store,
          p_proposals: proposals,
        })
        if (error) throw error
      }
      const newMap = { ...orders, [store]: {} }
      rows.forEach(r => { (newMap[store] as any)[r.bread_id] = r })
      setOrders(newMap)
      setSyncState('')
      showToast(hasReuseContext ? 'Pedido e reaproveitamento salvos!' : 'Pedido salvo!')
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
    const userLabel: Record<string,string> = { gustavo:'Gustavo', marselle:'Marselle', elis:'Elis', rodrigo:'Rodrigo' }
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
  // Carrega o histórico de uma data ignorando respostas fora de ordem:
  // trocas rápidas de data disparam fetches concorrentes e só o último vale.
  const loadReport = useCallback(async (dateKey: string) => {
    const reqId = ++reportReqRef.current
    setLoadingMsg('Carregando...'); setLoading(true)
    try {
      const map = await loadOrders(dateKey)
      if (reqId === reportReqRef.current) setReportOrders(map)
    } catch(e) {
      if (reqId === reportReqRef.current) showToast('Erro ao carregar.')
    } finally {
      if (reqId === reportReqRef.current) setLoading(false)
    }
  }, [loadOrders])

  // Só troca a data; o carregamento é feito pelo efeito que observa reportDate.
  const changeReportDate = (dateKey: string) => setReportDate(dateKey)

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
      await Promise.all(stores.map(s => sbDel('orders', { store: s, order_date: date })))
      await sbInsert('orders', allRows)
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
    setProdDate(dateKey)
    showLoad('Carregando produção...')
    try {
      await loadBreads()
      const map = await loadOrders(dateKey)
      setGeolarOrders(map)
      setOrders(map)
      // Recarrega Itens JC pra mesma data
      const items = await loadProdItems()
      await loadProdProduction(dateKey, items)
      await loadGeolarExtras(dateKey)
    } catch(e) { showToast('Erro ao carregar.') }
    finally { hideLoad() }
  }

  const generateWhatsApp = (ordMap: OrderMap, scope: 'all'|'breads'|'itens' = 'all') => {
    const stores: Store[] = ['ex','jc','ja']
    const dLabel = deliveryDayLabel(delivIdx)
    const lines: string[] = []
    if (scope !== 'itens') {
      const bds = breads.filter(b=>!b.is_pj&&b.active)
      lines.push(`*Pane & Salute — Produção ${dLabel}*\n`)
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
    }
    // Itens JC (não-pães) — só inclui se algum tem qty > 0
    if (scope !== 'breads') {
      const itensWithQty = prodItems.filter(p => (prodQtys[p.id] || 0) > 0)
      if (itensWithQty.length) {
        const groupedJC: Record<string, ProdItem[]> = {}
        itensWithQty.forEach(p => { (groupedJC[p.category] ??= []).push(p) })
        if (lines.length) lines.push('')
        lines.push(`*Itens JC — Produção*`)
        Object.keys(groupedJC).forEach(cat => {
          lines.push(`_${cat}_`)
          groupedJC[cat].forEach(p => lines.push(`${p.name}: ${prodQtys[p.id]||0}`))
        })
        if (prodObs) lines.push(`📝 ${prodObs}`)
      }
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
    ? [{label:'JC',store:'jc'},{label:'JA',store:'ja'},{label:'Itens JC',store:null},{label:'Relatório',store:null},{label:'Admin',store:null}]
    : currentUser === 'marselle'
    ? [{label:'Loja EX',store:'ex'},{label:'Histórico',store:null}]
    : currentUser === 'gustavo'
    ? [{label:'Loja JC',store:'jc'},{label:'Histórico',store:null}]
    : [{label:'Histórico',store:null}]  // Elis: pedidos PJ migraram pro módulo dedicado /pedidos-pj

  const changeProdDate = async (newDate: string) => {
    setProdDate(newDate)
    showLoad('Carregando lista...')
    try {
      await loadProdProduction(newDate, prodItems)
    } catch(e) { showToast('Erro ao carregar.') }
    finally { hideLoad() }
  }
  const setProdQty = (id: string, val: number) => setProdQtys(prev => ({ ...prev, [id]: Math.max(0, val) }))
  const calcProdTotal = () => prodItems.reduce((a, p) => a + (prodQtys[p.id] || 0), 0)

  // ── histórico: carrega ao abrir a aba e a cada troca de data ──────
  const reportTabLabel = tabDefs[activeTab]?.label
  const reportTabActive = reportTabLabel === 'Relatório' || reportTabLabel === 'Histórico'
  useEffect(() => {
    if (reportTabActive) loadReport(reportDate)
  }, [reportTabActive, reportDate, loadReport])

  // ── render helpers ───────────────────────────────────────────────
  const setQty = (key: string, val: number) => {
    const quantity = Math.max(0, val)
    setQtys(prev=>({...prev,[key]:quantity}))
    if (key.startsWith('jc-') || key.startsWith('ja-')) {
      setReuseProposalQtys(prev => ({
        ...prev,
        [key]: reusePlans[key]?.status === 'confirmed'
          ? prev[key] ?? reusePlans[key].proposedQuantity
          : clampReuseProposal(prev[key] ?? 0, quantity, pendingLeftovers[key] ?? 0),
      }))
    }
  }

  const setReuseProposal = (key: string, val: number) => {
    if (reusePlans[key]?.status === 'confirmed') return
    setReuseProposalQtys(prev => ({
      ...prev,
      [key]: clampReuseProposal(val, qtys[key] ?? 0, pendingLeftovers[key] ?? 0),
    }))
  }

  // ── Render ───────────────────────────────────────────────────────
  if ((screen === 'init' || screen === 'login') && initialLoadError) return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <div className="ps-empty" style={{ margin:24 }}>
          <p>{initialLoadError}</p>
          <button className="ps-btn primary" onClick={() => currentUser && login(currentUser)}>Tentar novamente</button>
        </div>
      </div>
    </div>
  )
  if (screen === 'init' || screen === 'login') return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--muted)' }}>
      <p>Carregando...</p>
    </div>
  )
  if (screen === 'geolar') return (
    <GeolarScreen
      breads={breads} orders={geolarOrders} geolarDate={geolarDate}
      enc={geolarEnc} pj={geolarPj}
      delivIdx={delivIdx}
      prodItems={prodItems} prodQtys={prodQtys} prodObs={prodObs}
      onDateChange={loadGeolar}
      onWhatsApp={(scope)=>generateWhatsApp(geolarOrders, scope)}
      onOpenPending={()=>router.push('/sobras/pendencias')}
      onLogout={logout}
      loading={loading} loadingMsg={loadingMsg}
    />
  )

  // main screen
  const activeStore = (tabDefs[activeTab]?.store as Store|null)
  const isOrderTab = activeStore === 'jc' || activeStore === 'ja' || activeStore === 'ex' || activeStore === 'pj'
  const isReportTab = reportTabActive
  const isAdminTab = tabDefs[activeTab]?.label === 'Admin'
  const isItensTab = tabDefs[activeTab]?.label === 'Itens JC'

  const globalUser = getCurrentUser()
  const displayName = globalUser?.displayName ?? ''
  const userName = displayName || (currentUser === 'rodrigo' ? 'Rodrigo' : currentUser === 'gustavo' ? 'Gustavo' : currentUser === 'marselle' ? 'Marselle' : 'Elis')
  const avatarColor = currentUser === 'rodrigo' ? '#8E4E22' : currentUser === 'gustavo' ? '#8E4E22' : currentUser === 'marselle' ? '#2C7A8C' : '#A8392B'
  const userInitial = userName.trim().charAt(0).toUpperCase()

  const hoursLeft = getHoursLeft()
  const dlUrgent = isLocked || hoursLeft <= 2
  const dlTitle = isLocked ? 'Pedidos encerrados' : hoursLeft <= 2 ? 'Prazo encerrando' : 'Pedido aberto'
  const dlSub = isLocked ? 'Reabrem às 04h00'
    : hoursLeft <= 2 ? `Menos de ${hoursLeft}h — encerra às 04h00`
    : `Pães de ${deliveryDayLabel(delivIdx)} · até 04h00`

  return (
    <div className="ps-canvas">
      <div className="ps-shell ps-fadein">
        {/* Header */}
        <header className="ps-header">
          <div className="ps-wordmark" onClick={logout} style={{cursor:'pointer'}}>
            <div className="ps-mark">P</div>
            <div className="ps-brand">
              <b>Pane &amp; Salute</b>
              <span>Produção{syncState==='syncing'?' · sincronizando':syncState==='error'?' · erro':''}</span>
            </div>
          </div>
          <div className="ps-userwrap">
            <div className="ps-userchip">
              <div className="ps-avatar" style={{background:avatarColor}}>{userInitial}</div>
              <b>{userName}</b>
            </div>
            <button className="ps-iconbtn" onClick={logout} title="Sair" aria-label="Sair"><LogOut size={18} strokeWidth={1.85}/></button>
          </div>
        </header>

        {/* Banner de prazo */}
        <div className={'ps-deadline' + (dlUrgent ? ' urgent' : '')}>
          <div className="ps-dl-ic">{dlUrgent ? <AlarmClock size={19} strokeWidth={1.85}/> : <Clock size={19} strokeWidth={1.85}/>}</div>
          <div className="ps-dl-txt"><b>{dlTitle}</b><span>{dlSub}</span></div>
        </div>

        <div className="ps-pad" style={{paddingBottom:176}}>
          {/* Abas */}
          <div className="ps-tabs" role="tablist">
            {tabDefs.map((t,i) => (
              <button key={i} role="tab" aria-selected={i===activeTab} className="ps-tab" onClick={()=>setActiveTab(i)}>{t.label}</button>
            ))}
          </div>

          {isOrderTab && activeStore && (
            <OrderForm
              store={activeStore as Store}
              breads={activeStore==='pj'?pjBreads:todayBreads}
              isPJ={activeStore==='pj'}
              delivIdx={delivIdx}
              isLocked={isLocked}
              qtys={qtys}
              pendingLeftovers={pendingLeftovers}
              reuseProposalQtys={reuseProposalQtys}
              reusePlans={reusePlans}
              obs={obsMap[activeStore]||''}
              pjClient={pjClient}
              pjDate={pjDate}
              onDelivChange={changeDelivDay}
              onQtyChange={(key,val)=>setQty(key,val)}
              onReuseChange={(key,val)=>setReuseProposal(key,val)}
              onObsChange={(obs)=>setObsMap(prev=>({...prev,[activeStore]:obs}))}
              onPjClientChange={setPjClient}
              onPjDateChange={setPjDate}
            />
          )}
          {isReportTab && (
            <ReportView
              currentUser={currentUser!}
              storeFilter={currentUser==='marselle'?'ex':currentUser==='gustavo'?'jc':currentUser==='elis'?'pj':undefined}
              breads={breads}
              reportDate={reportDate}
              reportOrders={reportOrders}
              pjBreads={pjBreads}
              todayBds={todayBreads}
              onDateChange={changeReportDate}
              onDuplicate={duplicateOrders}
              onRefresh={()=>loadReport(reportDate)}
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
          {isItensTab && (
            <ItensJCForm
              prodItems={prodItems}
              prodQtys={prodQtys}
              prodObs={prodObs}
              prodDate={prodDate}
              onDateChange={changeProdDate}
              onQtyChange={setProdQty}
              onObsChange={setProdObs}
            />
          )}
        </div>

        {/* Barra de total */}
        {isOrderTab && !isLocked && activeStore && (
          <div className="ps-totalbar">
            <div className="ps-total-num"><b>{calcTotal(activeStore as Store)}</b><span>unidades</span></div>
            <button className="ps-save" disabled={saving} onClick={()=>saveOrder(activeStore as Store)}>
              <Save size={19} strokeWidth={1.85}/>{saving ? 'Salvando...' : activeStore==='pj'?'Salvar pedido PJ':'Salvar pedido'}
            </button>
          </div>
        )}
        {isItensTab && (
          <div className="ps-totalbar">
            <div className="ps-total-num"><b>{calcProdTotal()}</b><span>unidades</span></div>
            <button className="ps-save" disabled={prodSaving} onClick={saveItensJC}>
              <Save size={19} strokeWidth={1.85}/>{prodSaving ? 'Salvando...' : 'Salvar lista'}
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
      </div>
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
  pendingLeftovers:Record<string,number>
  reuseProposalQtys:Record<string,number>
  reusePlans:Record<string,ReusePlanSummary>
  onDelivChange:(idx:number)=>void
  onQtyChange:(key:string,val:number)=>void
  onReuseChange:(key:string,val:number)=>void
  onObsChange:(obs:string)=>void
  onPjClientChange:(v:string)=>void
  onPjDateChange:(v:string)=>void
}

function OrderForm({ store, breads, isPJ, delivIdx, isLocked, qtys, pendingLeftovers, reuseProposalQtys, reusePlans, obs, pjClient, pjDate, onDelivChange, onQtyChange, onReuseChange, onObsChange, onPjClientChange, onPjDateChange }:OrderFormProps) {
  const storeName = {jc:'Julio de Castilhos',ja:'Jardim América',ex:'Exposição',pj:'PJ'}[store]||store.toUpperCase()

  return (
    <div className="ps-fadein">
      {isPJ ? (
        <>
          <div className="ps-label">Cliente</div>
          <input className="ps-input" style={{width:'100%'}} type="text" placeholder="Nome do cliente" value={pjClient} onChange={e=>onPjClientChange(e.target.value)} disabled={isLocked}/>
          <div className="ps-label">Data de entrega</div>
          <input className="ps-input" style={{width:'100%'}} type="date" value={pjDate} onChange={e=>onPjDateChange(e.target.value)} disabled={isLocked}/>
        </>
      ) : (
        <>
          <div className="ps-label">Pães para qual dia?</div>
          <div className="ps-days" role="group">
            {[1,2,3,4,5,6].map(i=>(
              <button key={i} className="ps-day" aria-pressed={i===delivIdx} onClick={()=>onDelivChange(i)}>{DAYS_PT[i]}</button>
            ))}
          </div>
        </>
      )}

      <div className="ps-section">
        <div className="bar"/>
        <b>{isPJ ? 'Itens do pedido' : DAY_FULL_PT[delivIdx]}</b>
        <span className="meta">{storeName}</span>
      </div>

      {breads.length === 0 ? (
        <div className="ps-empty">Nenhum pão disponível para {DAY_FULL_PT[delivIdx]}.</div>
      ) : (
        <div className="ps-grid">
          {breads.map(b=>{
            const key = `${store}-${b.id}`
            const val = qtys[key]||0
            const bdays = parseDays(b.days)
            const pending = pendingLeftovers[key] || 0
            const proposal = reuseProposalQtys[key] || 0
            const reusePlan = reusePlans[key]
            const confirmed = reusePlan?.status === 'confirmed'
            const canPlanReuse = (store === 'jc' || store === 'ja') && (pending > 0 || Boolean(reusePlan))
            const reuseLimit = Math.min(val, pending)
            return (
              <div key={b.id} className={'ps-card'+(val>0?' active':'')}>
                <div className="ps-card-head">
                  <div className="ps-order-bread-title">
                    <div className="ps-pname">{b.name}</div>
                    {(store === 'jc' || store === 'ja') && pending > 0 && <span className="ps-leftover-chip">Sobra: {pending}</span>}
                  </div>
                  {!isPJ && (
                    <div className="ps-pdays">
                      {[1,2,3,4,5,6].map(i=>(
                        <span key={i} className={'ps-pday'+(bdays.includes(i)?' on':'')}>{DAYS_PT[i]}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="ps-stepper">
                  <button className="ps-step" disabled={isLocked||val<=0} onClick={()=>onQtyChange(key,val-1)} aria-label="Diminuir"><Minus size={20} strokeWidth={1.85}/></button>
                  <input className={'ps-qty'+(val===0?' zero':'')} type="number" inputMode="numeric" min={0} value={val||''} placeholder="0"
                    onChange={e=>onQtyChange(key,parseInt(e.target.value)||0)} disabled={isLocked}/>
                  <button className="ps-step" disabled={isLocked} onClick={()=>onQtyChange(key,val+1)} aria-label="Aumentar"><Plus size={20} strokeWidth={1.85}/></button>
                </div>
                {canPlanReuse && (
                  <div className="ps-order-reuse">
                    {confirmed ? (
                      <div className="ps-order-reuse-confirmed">
                        <Check size={16} />
                        <span><b>{reusePlan.confirmedQuantity} da sobra confirmados</b><small>Já descontados da produção nova.</small></span>
                      </div>
                    ) : (
                      <>
                        <div className="ps-order-reuse-label"><span>Pretendo usar da sobra</span><small>Geolar ainda vai conferir</small></div>
                        <div className="ps-stepper compact">
                          <button className="ps-step" disabled={isLocked||proposal<=0} onClick={()=>onReuseChange(key,proposal-1)} aria-label="Diminuir uso da sobra"><Minus size={18} strokeWidth={1.85}/></button>
                          <input className={'ps-qty'+(proposal===0?' zero':'')} type="number" inputMode="numeric" min={0} max={reuseLimit} value={proposal||''} placeholder="0"
                            onChange={e=>onReuseChange(key,parseInt(e.target.value)||0)} disabled={isLocked}/>
                          <button className="ps-step" disabled={isLocked||proposal>=reuseLimit} onClick={()=>onReuseChange(key,proposal+1)} aria-label="Aumentar uso da sobra"><Plus size={18} strokeWidth={1.85}/></button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="ps-label">Observações</div>
      <textarea className="ps-textarea" placeholder="Ex: reforçar baguete, pegar croissant do congelado..." value={obs} onChange={e=>onObsChange(e.target.value)} disabled={isLocked}/>

      {isLocked && <div style={{marginTop:12,padding:'10px 14px',background:'var(--berry-tint)',border:'1px solid #E6B5AC',borderRadius:'var(--r-ctrl)',fontSize:13,color:'var(--berry)',fontWeight:600}}>Pedidos encerrados. Reabrem às 04h00.</div>}
    </div>
  )
}

interface ReportProps {
  currentUser:string; storeFilter?:string; breads:Bread[]; reportDate:string
  reportOrders:OrderMap; pjBreads:Bread[]; todayBds:Bread[]
  onDateChange:(d:string)=>void; onDuplicate:(s?:string)=>void; onRefresh:()=>void
}

function ReportView({ currentUser, storeFilter, breads, reportDate, reportOrders, pjBreads, todayBds, onDateChange, onDuplicate, onRefresh }:ReportProps) {
  const isToday = reportDate === todayKey()
  const pjSv = reportOrders['pj'] || {}
  const pjItems = pjBreads.filter(b=>(pjSv[b.id]?.quantity||0)>0)

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:'1rem',flexWrap:'wrap'}}>
        <span style={{fontSize:12,color:'var(--text-muted)'}}>Data:</span>
        <input type="date" value={reportDate} className="obs-area" style={{width:'auto',padding:'6px 10px',fontSize:13,minHeight:'auto'}} onChange={e=>onDateChange(e.target.value)}/>
        {isToday&&<span style={{fontSize:11,color:'var(--teal)',background:'var(--teal-bg)',border:'1px solid var(--teal-border)',padding:'2px 8px',borderRadius:10}}>hoje</span>}
        <button type="button" onClick={onRefresh} className="obs-area" style={{width:'auto',padding:'6px 10px',fontSize:13,minHeight:'auto',cursor:'pointer'}}>↻ Atualizar</button>
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

      {/* Single store view */}
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
      {!regular.length&&<div style={{color:'var(--text-muted)',fontSize:13,marginBottom:12}}>Nenhum pão. Clique em &quot;+ Novo pão&quot;.</div>}
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

interface ItensJCFormProps {
  prodItems: ProdItem[]
  prodQtys: Record<string, number>
  prodObs: string
  prodDate: string
  onDateChange: (d: string) => void
  onQtyChange: (id: string, val: number) => void
  onObsChange: (obs: string) => void
}

function ItensJCForm({ prodItems, prodQtys, prodObs, prodDate, onDateChange, onQtyChange, onObsChange }: ItensJCFormProps) {
  // Agrupa por categoria preservando ordem alfabética (do query)
  const grouped = prodItems.reduce<Record<string, ProdItem[]>>((acc, p) => {
    (acc[p.category] ??= []).push(p)
    return acc
  }, {})
  const cats = Object.keys(grouped) // já ordenado pela query
  const isToday = prodDate === todayKey()

  return (
    <div className="ps-fadein">
      <div className="ps-label">Data de produção</div>
      <div style={{display:'flex',alignItems:'center',gap:8}}>
        <input type="date" value={prodDate} className="ps-input" onChange={e=>onDateChange(e.target.value)}/>
        {isToday && <span style={{fontSize:11,color:'var(--sage)',background:'var(--honey-tint)',border:'1px solid var(--honey-line)',padding:'3px 10px',borderRadius:999,fontWeight:700}}>hoje</span>}
      </div>

      {prodItems.length === 0 ? (
        <div className="ps-empty">Nenhum produto ativo no catálogo (categorias não-pão).</div>
      ) : cats.map(cat => (
        <div key={cat}>
          <div className="ps-section">
            <div className="bar"/>
            <b>{cat}</b>
            <span className="meta">{grouped[cat].length} {grouped[cat].length===1?'item':'itens'}</span>
          </div>
          <div className="ps-grid">
            {grouped[cat].map(p => {
              const val = prodQtys[p.id] || 0
              return (
                <div key={p.id} className={'ps-card'+(val>0?' active':'')}>
                  <div className="ps-card-head">
                    <div className="ps-pname">{p.name}</div>
                    {p.unit && <div className="ps-pdays"><span className="ps-pday">{p.unit}</span></div>}
                  </div>
                  <div className="ps-stepper">
                    <button className="ps-step" disabled={val<=0} onClick={()=>onQtyChange(p.id, val-1)} aria-label="Diminuir"><Minus size={20} strokeWidth={1.85}/></button>
                    <input className={'ps-qty'+(val===0?' zero':'')} type="number" inputMode="numeric" min={0} value={val || ''} placeholder="0"
                      onChange={e=>onQtyChange(p.id, parseInt(e.target.value) || 0)}/>
                    <button className="ps-step" onClick={()=>onQtyChange(p.id, val+1)} aria-label="Aumentar"><Plus size={20} strokeWidth={1.85}/></button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      <div className="ps-label">Observações</div>
      <textarea className="ps-textarea" placeholder="Notas para a equipe de produção..." value={prodObs} onChange={e=>onObsChange(e.target.value)}/>
    </div>
  )
}

interface GeolarProps {
  breads:Bread[]; orders:OrderMap; geolarDate:string; delivIdx:number
  enc:{client:string;name:string;qty:number}[]; pj:{client:string;name:string;qty:number}[]
  prodItems:ProdItem[]; prodQtys:Record<string,number>; prodObs:string
  onDateChange:(d:string)=>void; onWhatsApp:(scope:'all'|'breads'|'itens')=>void; onOpenPending:()=>void; onLogout:()=>void
  loading:boolean; loadingMsg:string
}

function GeolarScreen({ breads, orders, enc, pj, geolarDate, delivIdx, prodItems, prodQtys, prodObs, onDateChange, onWhatsApp, onOpenPending, onLogout, loading, loadingMsg }:GeolarProps) {
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

  const itensWithQty = prodItems.filter(p => (prodQtys[p.id] || 0) > 0)
  const hasBreads = printRows.length > 0 || pjBreads.length > 0

  // Impressão de listas separadas: aplica classe no #app que oculta o outro card via @media print
  const [printScope, setPrintScope] = useState<''|'breads'|'itens'>('')
  useEffect(() => {
    if (!printScope) return
    window.print()
    setPrintScope('')
  }, [printScope])

  return (
    <div id="app" className={printScope==='breads' ? 'print-only-breads' : printScope==='itens' ? 'print-only-itens' : ''}>
      <div className="topbar">
        <div className="topbar-logo" onClick={onLogout} style={{cursor:'pointer'}}>Pane &amp; Salute</div>
        <span className="topbar-badge tb-gray">Geolar</span>
        <button className="btn-logout" onClick={onLogout}>Sair</button>
      </div>
      <div style={{padding:'16px'}}>
        <div className="no-print" style={{display:'flex',alignItems:'center',gap:8,marginBottom:'1rem'}}>
          <span style={{fontSize:12,color:'var(--text-muted)'}}>Data dos pedidos:</span>
          <input type="date" value={geolarDate} className="obs-area" style={{width:'auto',padding:'6px 10px',fontSize:13,minHeight:'auto'}} onChange={e=>onDateChange(e.target.value)}/>
        </div>
        <button className="btn-action no-print" style={{width:'100%',marginBottom:12}} onClick={onOpenPending}>
          Conferir sobras e reaproveitamento
        </button>

        <div className="print-card print-breads">
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

        {/* Botões da lista de pães */}
        <div className="btn-row" style={{marginTop:10}}>
          <button className="btn-save" disabled={!hasBreads} onClick={()=>setPrintScope('breads')}>🖨 Imprimir pães</button>
          <button className="btn-action" disabled={!hasBreads} onClick={()=>onWhatsApp('breads')}>📋 Copiar texto</button>
        </div>

        {/* Encomendas marcadas pra produção neste dia */}
        {enc.length > 0 && (
          <div className="print-card print-breads" style={{marginTop:16}}>
            <h3>🎂 Encomendas a produzir</h3>
            <div className="pmeta">Para {dLabel}</div>
            {Array.from(new Set(enc.map(e=>e.client))).map(client => (
              <div key={client} style={{marginTop:8}}>
                <div style={{fontSize:12,fontWeight:600,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.04em'}}>{client}</div>
                {enc.filter(e=>e.client===client).map((e,i)=>(
                  <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'3px 0',fontSize:13}}>
                    <span>{e.name}</span><strong>{e.qty}</strong>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Pedidos PJ que produzem neste dia */}
        {pj.length > 0 && (
          <div className="print-card print-breads" style={{marginTop:16}}>
            <h3>🏢 Pedidos PJ a produzir</h3>
            <div className="pmeta">Para {dLabel}</div>
            {Array.from(new Set(pj.map(e=>e.client))).map(client => (
              <div key={client} style={{marginTop:8}}>
                <div style={{fontSize:12,fontWeight:600,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.04em'}}>{client}</div>
                {pj.filter(e=>e.client===client).map((e,i)=>(
                  <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'3px 0',fontSize:13}}>
                    <span>{e.name}</span><strong>{e.qty}</strong>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Print-card: Itens JC (não-pães) — só renderiza se há items planejados pra esta data */}
        {(() => {
          if (!itensWithQty.length) return null
          const grouped: Record<string, ProdItem[]> = {}
          itensWithQty.forEach(p => { (grouped[p.category] ??= []).push(p) })
          const cats = Object.keys(grouped)
          const totalQty = itensWithQty.reduce((a, p) => a + (prodQtys[p.id] || 0), 0)
          return (
            <div className="print-card print-itens" style={{marginTop:16}}>
              <h3>Itens JC — Produção</h3>
              <div className="pmeta">Para {dLabel} · {totalQty} unidades</div>
              {cats.map(cat => (
                <div key={cat} style={{marginTop:10}}>
                  <div style={{fontSize:12,fontWeight:600,color:'var(--text-muted)',marginBottom:4,textTransform:'uppercase',letterSpacing:'.04em'}}>{cat}</div>
                  {grouped[cat].map(p => (
                    <div key={p.id} style={{display:'flex',justifyContent:'space-between',padding:'3px 0',fontSize:13}}>
                      <span>{p.name}</span>
                      <strong>{prodQtys[p.id]}</strong>
                    </div>
                  ))}
                </div>
              ))}
              {prodObs && (
                <div style={{marginTop:10,fontSize:12,color:'var(--text-muted)',padding:'8px 10px',background:'var(--amber-bg)',borderRadius:'var(--radius-sm)'}}>
                  📝 {prodObs}
                </div>
              )}
            </div>
          )
        })()}

        {/* Botões da lista de Itens JC */}
        {itensWithQty.length > 0 && (
          <div className="btn-row" style={{marginTop:10}}>
            <button className="btn-save" onClick={()=>setPrintScope('itens')}>🖨 Imprimir Itens JC</button>
            <button className="btn-action" onClick={()=>onWhatsApp('itens')}>📋 Copiar texto</button>
          </div>
        )}

        <div className="btn-row" style={{marginTop:16}}>
          <button className="btn-action" onClick={()=>onDateChange(geolarDate)}>↻ Atualizar</button>
        </div>
      </div>

      {loading&&<div className="loading-overlay" style={{display:'flex'}}><div className="spinner"/><p>{loadingMsg}</p></div>}
    </div>
  )
}
