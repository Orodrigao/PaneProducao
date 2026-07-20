'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Plus, RotateCw, Truck, CheckCheck, Check, X, Trash2, AlertTriangle, Save, Eye, Package, Printer } from 'lucide-react'
import { getCurrentUser, logout as authLogout, firstAllowedRoute } from '@/lib/auth'
import { todayKey, formatDateBR, showToastPS } from '@/lib/utils'
import { SupabaseRestError, supabaseRestFetch } from '@/lib/supabaseRest'
import {
  buildRomaneioProductOptions,
  exceedsRomaneioWeightLimit,
  filterCatalogBreadsForSearch,
  formatRomaneioQty,
  formatRomaneioWeightInGrams,
  isWeightControlledRomaneioProduct,
  nextRomaneioTripNumber,
  normalizeRomaneioQty,
  orderQuantitiesByBreadId,
  parseRomaneioQty,
  ROMANEIO_WEIGHT_LIMIT_KG,
  sentQuantitiesByProductId,
  type RomaneioOrderRow,
  type RomaneioSentItemRow,
  type RomaneioProductOption,
} from '@/lib/romaneioDraft'
import { canSeeRomaneio } from '@/lib/romaneioAccess'
import {
  canPerformRomaneioAction,
  loadCurrentRomaneioPermissions,
  type RomaneioAction,
  type RomaneioPermissions,
} from '@/lib/romaneioPermissions'

type Screen = 'init'|'login'|'painel'|'detalhe'|'criar'|'conferencia'|'admin'
type AdminTab = 'painel-adm'|'divergencias'|'fechamento'|'precos'

interface Destination { id:string; name:string; code:string; active:boolean }
interface Bread { id:string; name:string; active:boolean; is_pj:boolean; unit?:string|null }
interface Romaneio { id:string; record_date:string; destination_id:string; trip_number:number; status:string; created_by:string; created_at?:string|null; obs?:string; sent_by?:string; sent_at?:string; confirmed_by?:string; confirmed_at?:string; destinations?:{name:string;code:string} }
interface RomaneioTripRow { trip_number:number|null }
interface RomaneioDraftExistingRow extends RomaneioTripRow { id:string }
interface RomItem { id:string; romaneio_id:string; product_id:string; product_source:string; product_name:string; qty_sent:number; qty_received?:number; qty_accepted?:number; divergence_reason?:string; obs?:string; item_status?:string; unit_price?:number }
interface ConfEntry { rec:number; acc:number; motivo:string; itemObs:string; refused:boolean; refuseReason:string }
interface CriarDraft { destId:string; breads:Bread[]; qtys:Record<string,number>; orderQtys:Record<string,number>; previouslySentQtys:Record<string,number>; extras:Record<string,string>; trip:number; obs:string; extraInput:string }
interface CriarDraftStorage { date:string; activeDestId:string; drafts:Record<string,CriarDraft> }

const ROMANEIO_DRAFT_KEY = 'pane_romaneio_drafts_v1'

const ROMANEIO_SENDER = {
  store: 'Pane Julio',
  name: 'RGF PANE PIZZA LTDA',
  cnpj: '55.800.425/0001-77',
  ie: '0290735319',
}

const ROMANEIO_RECIPIENTS = {
  EX: {
    store: 'Exposicao',
    name: 'Buck Comercio de Alimentos LTDA - ME',
    location: 'Caxias do Sul, RS',
    cnpj: '28.994.014/0001-97',
  },
  JA: {
    store: 'Jardim',
    name: 'Sf & Salute Padaria e Cafeteria Ltda',
    cnpj: '58.286.372/0002-97',
  },
} as const

// ── utils ──────────────────────────────────────────────────────────
function fmtDateTime(s:string|null|undefined) { if(!s)return ''; const d=new Date(s); const br=new Date(d.getTime()-3*60*60000); return `${String(br.getDate()).padStart(2,'0')}/${String(br.getMonth()+1).padStart(2,'0')} ${String(br.getHours()).padStart(2,'0')}:${String(br.getMinutes()).padStart(2,'0')}` }
function fmtTime(s:string|null|undefined) { if(!s)return ''; const d=new Date(s); const br=new Date(d.getTime()-3*60*60000); return `${String(br.getHours()).padStart(2,'0')}:${String(br.getMinutes()).padStart(2,'0')}` }
function statusLabel(s:string) { return ({separado:'Separado',enviado:'Enviado',conferido:'Conferido',com_divergencia:'Divergência',aprovado:'Aprovado',fechado:'Fechado'} as Record<string,string>)[s]||s }
function slugExtra() { return 'extra_'+Date.now() }
function entregaLabel(trip: number) { return `${trip}ª entrega` }
function draftHasItems(draft: CriarDraft | undefined) { return !!draft && Object.values(draft.qtys).some(qty => Number(qty) > 0) }
function hasAnyDraftItems(drafts: Record<string, CriarDraft>) { return Object.values(drafts).some(draftHasItems) }
function isUniqueViolation(error: unknown) { return error instanceof Error && error.message.includes('"code":"23505"') }
function normalizeDestination(value: string | null | undefined) {
  return (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
}
function recipientForDestination(destination: Romaneio['destinations']) {
  const code = normalizeDestination(destination?.code)
  if (code === 'EX') return ROMANEIO_RECIPIENTS.EX
  if (code === 'JA') return ROMANEIO_RECIPIENTS.JA

  const name = normalizeDestination(destination?.name)
  if (name.includes('EXPOS')) return ROMANEIO_RECIPIENTS.EX
  if (name.includes('JARDIM')) return ROMANEIO_RECIPIENTS.JA

  return {
    store: destination?.name || 'Destino nao identificado',
    name: 'Dados fiscais do destino nao configurados',
    cnpj: '',
  }
}
function readDraftStorage(): CriarDraftStorage | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(ROMANEIO_DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CriarDraftStorage>
    if (!parsed.date || !parsed.drafts || typeof parsed.drafts !== 'object') return null
    return { date: parsed.date, activeDestId: parsed.activeDestId ?? '', drafts: parsed.drafts as Record<string, CriarDraft> }
  } catch {
    return null
  }
}
function writeDraftStorage(date: string, activeDestId: string, drafts: Record<string, CriarDraft>) {
  if (typeof window === 'undefined') return
  if (Object.keys(drafts).length === 0) {
    localStorage.removeItem(ROMANEIO_DRAFT_KEY)
    return
  }
  localStorage.setItem(ROMANEIO_DRAFT_KEY, JSON.stringify({ date, activeDestId, drafts }))
}
function formatDraftTotal(qtys: Record<string, number>, options: RomaneioProductOption[]) {
  const optionByKey = new Map(options.map(option => [option.key, option]))
  let units = 0
  let kg = 0
  Object.entries(qtys).forEach(([key, qty]) => {
    if (qty <= 0) return
    const unit = optionByKey.get(key)?.unit ?? 'un'
    if (unit === 'kg') kg += qty
    else units += qty
  })
  const parts: string[] = []
  if (units > 0) parts.push(`${formatRomaneioQty(units)} un`)
  if (kg > 0) parts.push(`${formatRomaneioQty(kg)} kg`)
  return parts.join(' · ') || '0 un'
}

function RomaneioQuantityInput({
  value,
  allowDecimal,
  className = 'ps-qty',
  onValueChange,
}: {
  value: number
  allowDecimal: boolean
  className?: string
  onValueChange: (value: number) => void
}) {
  const [draftValue, setDraftValue] = useState(value ? formatRomaneioQty(value) : '')

  useEffect(() => {
    setDraftValue(value ? formatRomaneioQty(value) : '')
  }, [value])

  const changeValue = (rawValue: string) => {
    const sanitized = allowDecimal
      ? rawValue.replace(/[^\d,.]/g, '').replace(/([,.].*)[,.]/g, '$1')
      : rawValue.replace(/\D/g, '')
    setDraftValue(sanitized)
    if (!sanitized.endsWith(',') && !sanitized.endsWith('.')) {
      onValueChange(normalizeRomaneioQty(parseRomaneioQty(sanitized)))
    }
  }

  const commitValue = () => {
    const quantity = normalizeRomaneioQty(parseRomaneioQty(draftValue))
    setDraftValue(quantity ? formatRomaneioQty(quantity) : '')
    onValueChange(quantity)
  }

  return (
    <input
      className={className}
      type="text"
      inputMode={allowDecimal ? 'decimal' : 'numeric'}
      value={draftValue}
      placeholder="0"
      onChange={event => changeValue(event.target.value)}
      onBlur={commitValue}
    />
  )
}
// ── Supabase ────────────────────────────────────────────────────────
function RomaneioPrint({ rom, items }: { rom: Romaneio; items: RomItem[] }) {
  const recipient = recipientForDestination(rom.destinations)
  const totalSent = items.reduce((sum, item) => sum + Number(item.qty_sent || 0), 0)

  return (
    <section id="romaneio-print" aria-hidden="true">
      <header className="rom-print-header">
        <div>
          <h1>Romaneio de envio</h1>
          <p>{rom.destinations?.name || recipient.store} - Viagem {rom.trip_number}</p>
        </div>
        <div className="rom-print-meta">
          <div><span>Data</span><b>{formatDateBR(rom.record_date)}</b></div>
          <div><span>Status</span><b>{statusLabel(rom.status)}</b></div>
        </div>
      </header>

      <div className="rom-print-parties">
        <section>
          <h2>De / Remetente</h2>
          <p className="rom-print-store">{ROMANEIO_SENDER.store}</p>
          <p><b>{ROMANEIO_SENDER.name}</b></p>
          <p>CNPJ: {ROMANEIO_SENDER.cnpj}</p>
          <p>I.E.: {ROMANEIO_SENDER.ie}</p>
        </section>
        <section>
          <h2>Para / Destinatario</h2>
          <p className="rom-print-store">{recipient.store}</p>
          <p><b>{recipient.name}</b></p>
          {'location' in recipient && recipient.location && <p>{recipient.location}</p>}
          {recipient.cnpj && <p>CNPJ: {recipient.cnpj}</p>}
        </section>
      </div>

      <section className="rom-print-box">
        <h2>Informacoes de envio</h2>
        <div className="rom-print-grid">
          <div><span>Criado por</span><b>{rom.created_by || '-'}</b></div>
          <div><span>Criado em</span><b>{rom.created_at ? fmtDateTime(rom.created_at) : '-'}</b></div>
          <div><span>Enviado por</span><b>{rom.sent_by || '-'}</b></div>
          <div><span>Enviado em</span><b>{rom.sent_at ? fmtDateTime(rom.sent_at) : '-'}</b></div>
          <div><span>Conferido por</span><b>{rom.confirmed_by || '-'}</b></div>
          <div><span>Conferido em</span><b>{rom.confirmed_at ? fmtDateTime(rom.confirmed_at) : '-'}</b></div>
        </div>
        {rom.obs && (
          <div className="rom-print-notes">
            <span>Observacoes</span>
            <p>{rom.obs}</p>
          </div>
        )}
      </section>

      <section className="rom-print-box">
        <h2>Itens enviados</h2>
        <table className="rom-print-table">
          <thead>
            <tr>
              <th>Produto</th>
              <th>Enviado</th>
              <th>Recebido</th>
              <th>Aceito</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id}>
                <td>{item.product_name}</td>
                <td>{formatRomaneioQty(Number(item.qty_sent || 0))}</td>
                <td>{item.qty_received != null ? formatRomaneioQty(Number(item.qty_received)) : '-'}</td>
                <td>{item.qty_accepted != null ? formatRomaneioQty(Number(item.qty_accepted)) : '-'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total enviado</td>
              <td>{formatRomaneioQty(totalSent)}</td>
              <td></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </section>

      <footer className="rom-print-signatures">
        <div>Responsavel pelo envio</div>
        <div>Responsavel pelo recebimento</div>
      </footer>
    </section>
  )
}

async function sbGet(table:string, params='') {
  const r=await supabaseRestFetch(`${table}?${params}`)
  return r.json()
}
async function sbPost(table:string, data:any) {
  const r=await supabaseRestFetch(table,{
    method:'POST', headers:{'Prefer':'return=representation'}, body:JSON.stringify(data)
  })
  return r.json()
}
async function sbUpsert(table:string, data:any, onConflict?:string) {
  const qs=onConflict?`?on_conflict=${onConflict}`:''
  const r=await supabaseRestFetch(`${table}${qs}`,{
    method:'POST', headers:{'Prefer':'resolution=merge-duplicates,return=representation'}, body:JSON.stringify(data)
  })
  return r.json()
}
async function sbPatch(table:string, data:any, match:Record<string,string>) {
  const q=Object.entries(match).map(([k,v])=>`${k}=eq.${v}`).join('&')
  const r=await supabaseRestFetch(`${table}?${q}`,{
    method:'PATCH', headers:{'Prefer':'return=representation'}, body:JSON.stringify(data)
  })
  return r.json()
}
async function sbDel(table:string, match:Record<string,string>) {
  const q=Object.entries(match).map(([k,v])=>`${k}=eq.${v}`).join('&')
  await supabaseRestFetch(`${table}?${q}`,{method:'DELETE'})
}

// ── Main ──────────────────────────────────────────────────────────
export default function RomaneioPage() {
  const router = useRouter()
  const savingRomaneioRef = useRef(false)
  const [screen, setScreen] = useState<Screen>('init')
  const [permissions, setPermissions] = useState<RomaneioPermissions>([])
  const [dests, setDests] = useState<Destination[]>([])
  const [breads, setBreads] = useState<Bread[]>([])
  const [prices, setPrices] = useState<Record<string,number>>({})
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('Carregando...')
  const [initialLoadError, setInitialLoadError] = useState('')
  // painel
  const [romaneios, setRomaneios] = useState<Romaneio[]>([])
  // detalhe
  const [detailRom, setDetailRom] = useState<Romaneio|null>(null)
  const [detailItems, setDetailItems] = useState<RomItem[]>([])
  const [printAfterOpen, setPrintAfterOpen] = useState(false)
  // criar
  const [criarDate, setCriarDate] = useState(todayKey())
  const [criarDestId, setCriarDestId] = useState('')
  const [criarDrafts, setCriarDrafts] = useState<Record<string,CriarDraft>>({})
  const [catalogSearch, setCatalogSearch] = useState('')
  // conferencia
  const [confRomId, setConfRomId] = useState('')
  const [confRom, setConfRom] = useState<Romaneio|null>(null)
  const [confItems, setConfItems] = useState<RomItem[]>([])
  const [confData, setConfData] = useState<Record<string,ConfEntry>>({})
  // admin
  const [adminTab, setAdminTab] = useState<AdminTab>('painel-adm')
  const [adminRoms, setAdminRoms] = useState<Romaneio[]>([])
  const [divergItems, setDivergItems] = useState<any[]>([])
  const [fechFrom, setFechFrom] = useState(todayKey())
  const [fechTo, setFechTo] = useState(todayKey())
  const [fechResult, setFechResult] = useState<any[]|null>(null)
  const [fechSummary, setFechSummary] = useState('')
  const [prodPrices, setProdPrices] = useState<Record<string,string>>({})
  // envio modal
  const [envioRomId, setEnvioRomId] = useState<string|null>(null)

  const showLoad = (msg='Carregando...') => { setLoadingMsg(msg); setLoading(true) }
  const hideLoad = () => setLoading(false)

  const handleInitialLoadError = (error: unknown) => {
    hideLoad()
    if (error instanceof SupabaseRestError && error.status === 401) {
      showToastPS('Sua sessão expirou. Entre novamente.')
      authLogout()
      router.replace('/login?force=email&returnTo=/romaneio')
      return
    }
    setInitialLoadError('Não foi possível carregar o Romaneio. Verifique a internet e tente novamente.')
  }

  const loadBase = useCallback(async () => {
    const [ds, bds, priceRows] = await Promise.all([
      sbGet('destinations','active=eq.true&order=name.asc'),
      sbGet('breads','active=eq.true&is_pj=eq.false&order=name.asc'),
      sbGet('product_prices','active=eq.true')
    ])
    setDests(ds); setBreads(bds)
    const pm: Record<string,number> = {}
    priceRows.forEach((r:any) => { pm[r.product_id+'_'+r.destination_id] = r.unit_price })
    setPrices(pm)
    return { ds, bds }
  }, [])

  const loadPainel = useCallback(async (activePermissions: RomaneioPermissions = permissions) => {
    const date = todayKey()
    const roms = await sbGet('romaneios',`record_date=eq.${date}&order=created_at.desc&select=*,destinations(name,code)`)
    setRomaneios((roms as Romaneio[]).filter(rom => canSeeRomaneio(activePermissions, rom.destinations)))
  }, [permissions])

  // ── login ──────────────────────────────────────────────────────
  const enterRomaneio = async (activePermissions: RomaneioPermissions) => {
    setPermissions(activePermissions)
    setInitialLoadError('')
    showLoad('Carregando...')
    try {
      await loadBase()
      const managesRomaneio = canPerformRomaneioAction(activePermissions, 'manage')
      if (managesRomaneio) await loadAdminPainel()
      else await loadPainel(activePermissions)
      hideLoad()
      setScreen(managesRomaneio ? 'admin' : 'painel')
    } catch(e) { handleInitialLoadError(e) }
  }

  const goHome = () => {
    setPermissions([]); setScreen('login')
    authLogout(); router.push('/login')
  }

  // Auto-resolve: usa o usuário autenticado globalmente em vez do seletor interno.
  // Admins vão direto pro screen='admin'. Demais entram via doLogin no screen='painel'.
  useEffect(() => {
    const globalUser = getCurrentUser()
    if (!globalUser) { router.replace('/login'); return }
    ;(async () => {
      try {
        const activePermissions = await loadCurrentRomaneioPermissions()
        if (activePermissions.length > 0) await enterRomaneio(activePermissions)
        else router.replace(firstAllowedRoute(globalUser))
      } catch(e) { handleInitialLoadError(e) }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  // ── painel ──────────────────────────────────────────────────────
  const refreshPainel = async () => {
    showLoad('Atualizando...')
    try { await loadPainel(permissions) } catch(e) { showToastPS('Erro ao atualizar') }
    finally { hideLoad(); setScreen('painel') }
  }

  // ── detalhe ──────────────────────────────────────────────────────
  const openDetalhe = async (romId: string, printAfterLoad = false) => {
    showLoad('Carregando...')
    try {
      const [roms, items] = await Promise.all([
        sbGet('romaneios',`id=eq.${romId}&select=*,destinations(name,code)`),
        sbGet('romaneio_items',`romaneio_id=eq.${romId}&order=product_name.asc`)
      ])
      setDetailRom(roms[0]); setDetailItems(items)
      setPrintAfterOpen(printAfterLoad)
      setScreen('detalhe')
    } catch(e) { showToastPS('Erro ao carregar') }
    finally { hideLoad() }
  }

  useEffect(() => {
    if (!printAfterOpen || screen !== 'detalhe' || !detailRom) return
    const timer = window.setTimeout(() => {
      window.print()
      setPrintAfterOpen(false)
    }, 150)
    return () => window.clearTimeout(timer)
  }, [detailItems.length, detailRom, printAfterOpen, screen])

  // ── criar ──────────────────────────────────────────────────────
  const openCriar = () => {
    const saved = readDraftStorage()
    if (saved && Object.keys(saved.drafts).length > 0) {
      const firstDest = saved.activeDestId || Object.keys(saved.drafts)[0] || ''
      setCriarDate(saved.date)
      setCriarDrafts(saved.drafts)
      setCriarDestId(firstDest)
      showToastPS('Rascunho recuperado')
    } else {
      setCriarDate(todayKey())
      setCriarDestId('')
      setCriarDrafts({})
    }
    setScreen('criar')
  }

  const buildDraftForDest = async (destId: string, date = criarDate): Promise<CriarDraft> => {
    const destinationCode = normalizeDestination(dests.find(destination => destination.id === destId)?.code)
    const orderStore = destinationCode.toLowerCase()
    const orderRequest = orderStore
      ? sbGet('orders',`order_date=eq.${date}&store=eq.${orderStore}&quantity=gt.0&select=bread_id,quantity`)
      : Promise.resolve([])
    const [existing, orders] = await Promise.all([
      sbGet('romaneios',`record_date=eq.${date}&destination_id=eq.${destId}&select=id,trip_number`),
      orderRequest,
    ])
    const existingRows = existing as RomaneioDraftExistingRow[]
    const previousItemRows = existingRows.length
      ? await sbGet('romaneio_items',`romaneio_id=in.(${existingRows.map(row => row.id).join(',')})&product_source=eq.bread&select=product_id,qty_sent`)
      : []
    let bds = breads
    const orderRows = orders as RomaneioOrderRow[]
    if (orderRows.length) {
      const ids = [...new Set(orderRows.map(o => o.bread_id).filter((id): id is string => Boolean(id)))]
      if (ids.length) {
        const byOrder = await sbGet('breads',`id=in.(${ids.join(',')})&active=eq.true&is_pj=eq.false&order=name.asc`) as Bread[]
        if (byOrder.length) bds = byOrder
      }
    }
    return {
      destId,
      breads: bds,
      qtys: {},
      orderQtys: orderQuantitiesByBreadId(orderRows),
      previouslySentQtys: sentQuantitiesByProductId(previousItemRows as RomaneioSentItemRow[]),
      extras: {},
      trip: nextRomaneioTripNumber(existingRows.map(row => row.trip_number)),
      obs: '',
      extraInput: '',
    }
  }

  const onDestChange = async (destId: string) => {
    setCriarDestId(destId)
    setCatalogSearch('')
    if (!destId || criarDrafts[destId]) return
    showLoad('Verificando viagens...')
    try {
      const draft = await buildDraftForDest(destId)
      setCriarDrafts(prev => ({ ...prev, [destId]: draft }))
    } catch(e) { showToastPS('Erro') }
    finally { hideLoad() }
  }

  const onCriarDateChange = (date: string) => {
    if (hasAnyDraftItems(criarDrafts) && !confirm('Trocar a data limpa os rascunhos abertos. Continuar?')) return
    setCriarDate(date)
    setCriarDestId('')
    setCriarDrafts({})
    writeDraftStorage(date, '', {})
  }

  const updateCriarDraft = (destId: string, updater: (draft: CriarDraft) => CriarDraft) => {
    setCriarDrafts(prev => {
      const current = prev[destId]
      if (!current) return prev
      return { ...prev, [destId]: updater(current) }
    })
  }

  const criarChangeQty = (id: string, delta: number) => {
    if (!criarDestId) return
    updateCriarDraft(criarDestId, draft => ({
      ...draft,
      qtys: { ...draft.qtys, [id]: normalizeRomaneioQty((draft.qtys[id] || 0) + delta) },
    }))
  }

  const setCriarQty = (id: string, value: string) => {
    if (!criarDestId) return
    const qty = normalizeRomaneioQty(parseRomaneioQty(value))
    updateCriarDraft(criarDestId, draft => ({ ...draft, qtys: { ...draft.qtys, [id]: qty } }))
  }

  const addCatalogBread = (bread: Bread) => {
    if (!criarDestId) return
    updateCriarDraft(criarDestId, draft => (
      draft.breads.some(b => b.id === bread.id)
        ? draft
        : { ...draft, breads: [...draft.breads, bread] }
    ))
    setCatalogSearch('')
    showToastPS('✅ '+bread.name+' adicionado')
  }

  const addExtra = () => {
    const draft = criarDrafts[criarDestId]
    if (!draft) return
    const name = draft.extraInput.trim()
    if (!name) return
    const eid = slugExtra()
    updateCriarDraft(criarDestId, current => ({
      ...current,
      extras: { ...current.extras, [eid]: name },
      qtys: { ...current.qtys, [eid]: 0 },
      extraInput: '',
    }))
    showToastPS('✅ '+name+' adicionado')
  }
  const removeExtra = (eid: string) => {
    if (!criarDestId) return
    updateCriarDraft(criarDestId, draft => {
      const extras = { ...draft.extras }
      const qtys = { ...draft.qtys }
      delete extras[eid]
      delete qtys[eid]
      return { ...draft, extras, qtys }
    })
  }

  const saveCriarDrafts = () => {
    if (Object.keys(criarDrafts).length === 0) { showToastPS('Nenhum rascunho aberto'); return }
    writeDraftStorage(criarDate, criarDestId, criarDrafts)
    showToastPS('Rascunho salvo neste aparelho')
  }

  const fetchNextTripNumber = async (date: string, destId: string) => {
    const existing = await sbGet('romaneios',`record_date=eq.${date}&destination_id=eq.${destId}&select=trip_number`) as RomaneioTripRow[]
    return nextRomaneioTripNumber(existing.map(row => row.trip_number))
  }

  const saveRomaneio = async () => {
    const draft = criarDrafts[criarDestId]
    if (!draft) { showToastPS('Selecione uma loja'); return }
    const items = Object.entries(draft.qtys).filter(([,v])=>v>0)
    if (!items.length) { showToastPS('⚠️ Adicione ao menos um produto'); return }
    if (!criarDestId) { showToastPS('⚠️ Selecione o destino'); return }
    if (savingRomaneioRef.current) return
    savingRomaneioRef.current = true
    const isExDestination = normalizeDestination(dests.find(destination => destination.id === criarDestId)?.code) === 'EX'
    const options = buildRomaneioProductOptions(draft.breads, { ciabattaOnlyKg: isExDestination })
    const optionByKey = new Map(options.map(option => [option.key, option]))
    const incompatibleDraftItem = items.find(([key]) => !key.startsWith('extra_') && !optionByKey.has(key))
    if (incompatibleDraftItem) {
      savingRomaneioRef.current = false
      showToastPS('⚠️ Para a EX, informe Ciabatta em kg antes de fechar o romaneio')
      return
    }
    const overweightItem = items.find(([key, quantity]) => {
      const option = optionByKey.get(key)
      return option && exceedsRomaneioWeightLimit(option.productName, quantity)
    })
    if (overweightItem) {
      savingRomaneioRef.current = false
      const option = optionByKey.get(overweightItem[0])
      showToastPS(`Quantidade de ${option?.displayName || 'produto'} acima do limite de 10 kg. Para 1.450 g, digite 1,450.`)
      return
    }
    showLoad('Fechando romaneio...')
    try {
      const insertHeader = (tripNumber: number) => sbPost('romaneios',[{
        record_date:criarDate, destination_id:criarDestId, trip_number:tripNumber,
        status:'separado', created_by:getCurrentUser()?.displayName || 'Usuário', obs:draft.obs||null
      }]) as Promise<{ id: string }[]>

      let tripNumber = await fetchNextTripNumber(criarDate, criarDestId)
      let rom: { id: string }[]
      try {
        rom = await insertHeader(tripNumber)
      } catch (headerErr) {
        if (!isUniqueViolation(headerErr)) throw headerErr
        tripNumber = await fetchNextTripNumber(criarDate, criarDestId)
        rom = await insertHeader(tripNumber)
      }
      const romId = rom[0].id
      const itemRows = items.map(([pid,qty]) => {
        const isExtra = pid.startsWith('extra_')
        const option = optionByKey.get(pid)
        const productId = isExtra ? pid : (option?.productId || pid)
        const name = isExtra ? draft.extras[pid] : (option?.productName || pid)
        const price = isExtra ? 0 : (prices[productId+'_'+criarDestId]||0)
        return { romaneio_id:romId, product_id:productId, product_source:isExtra?'extra':'bread', product_name:name, qty_sent:qty, unit_price:price, item_status:'pendente' }
      })
      try {
        await sbPost('romaneio_items', itemRows)
      } catch(itemErr) {
        try { await sbDel('romaneios',{id:romId}) } catch(_) {}
        throw itemErr
      }
      showToastPS(`✅ ${entregaLabel(tripNumber)} fechada!`)
      const nextDrafts = { ...criarDrafts }
      delete nextDrafts[criarDestId]
      const nextDest = Object.keys(nextDrafts)[0] || ''
      setCriarDrafts(nextDrafts)
      setCriarDestId(nextDest)
      writeDraftStorage(criarDate, nextDest, nextDrafts)
      await loadPainel()
      if (!nextDest) {
        if (canPerformRomaneioAction(permissions, 'manage')) {
          await loadAdminPainel()
          setScreen('admin')
        } else {
          setScreen('painel')
        }
      }
    } catch(e) {
      const msg = e instanceof Error ? e.message : 'Erro desconhecido'
      showToastPS('❌ Erro: '+(msg.length>100?msg.slice(0,100)+'...':msg), 5000)
    } finally {
      savingRomaneioRef.current = false
      hideLoad()
    }
  }

  // ── envio ──────────────────────────────────────────────────────
  const confirmEnvio = async () => {
    if (!envioRomId) return
    const romId = envioRomId
    setEnvioRomId(null)
    showLoad('Confirmando envio...')
    try {
      await supabaseRestFetch('rpc/confirm_romaneio_departure', {
        method: 'POST',
        body: JSON.stringify({ p_romaneio_id: romId }),
      })
      showToastPS('✅ Romaneio marcado como enviado!')
      await loadPainel()
    } catch(e) { showToastPS('❌ Erro') }
    finally { hideLoad() }
  }

  // ── conferencia ──────────────────────────────────────────────────
  const openConferencia = async (romId: string) => {
    setConfRomId(romId)
    showLoad('Carregando romaneio...')
    try {
      const [roms, items] = await Promise.all([
        sbGet('romaneios',`id=eq.${romId}&select=*,destinations(name,code)`),
        sbGet('romaneio_items',`romaneio_id=eq.${romId}&order=product_name.asc`)
      ])
      setConfRom(roms[0]); setConfItems(items)
      const data: Record<string,ConfEntry> = {}
      items.forEach((it:RomItem) => {
        data[it.id] = { rec:it.qty_sent, acc:it.qty_sent, motivo:'', itemObs:'', refused:false, refuseReason:'' }
      })
      setConfData(data)
      setScreen('conferencia')
    } catch(e) { showToastPS('Erro ao carregar') }
    finally { hideLoad() }
  }

  const updateConf = (id:string, field:keyof ConfEntry, val:any) => {
    setConfData(prev => ({ ...prev, [id]: {...prev[id],[field]:val} }))
  }

  const recusarItem = (id:string) => {
    setConfData(prev => ({ ...prev, [id]: {...prev[id],refused:true,rec:0,acc:0} }))
  }
  const desfazerRecusa = (id:string, qtySent:number) => {
    setConfData(prev => ({ ...prev, [id]: {...prev[id],refused:false,rec:qtySent,acc:qtySent,refuseReason:''} }))
  }

  const saveConferencia = async () => {
    const overweightItem = confItems.find(item => {
      const conference = confData[item.id]
      return conference
        && isWeightControlledRomaneioProduct(item.product_name)
        && (conference.rec > ROMANEIO_WEIGHT_LIMIT_KG || conference.acc > ROMANEIO_WEIGHT_LIMIT_KG)
    })
    if (overweightItem) {
      showToastPS(`Quantidade de ${overweightItem.product_name} acima do limite de 10 kg. Para 1.450 g, digite 1,450.`)
      return
    }
    showLoad('Salvando conferência...')
    try {
      const items = confItems.map(it => {
        const cd = confData[it.id]
        const motivo = cd.refused ? ('Recusado: '+cd.refuseReason) : cd.motivo
        return {
          id: it.id,
          qty_received: cd.rec,
          qty_accepted: cd.acc,
          divergence_reason: motivo || null,
          obs: cd.itemObs || null,
        }
      })
      const response = await supabaseRestFetch('rpc/confirm_romaneio_receipt', {
        method: 'POST',
        body: JSON.stringify({ p_romaneio_id: confRomId, p_items: items }),
      })
      const result = await response.json() as string
      const hasDiverg = result === 'com_divergencia'
      showToastPS(hasDiverg?'⚠️ Conferência salva com divergência':'✅ Conferência confirmada!')
      await loadPainel()
      setScreen('painel')
    } catch(e) { showToastPS('❌ Erro ao salvar') }
    finally { hideLoad() }
  }

  // ── admin ──────────────────────────────────────────────────────
  const loadAdminPainel = useCallback(async () => {
    const date = todayKey()
    const roms = await sbGet('romaneios',`record_date=eq.${date}&order=created_at.desc&select=*,destinations(name,code)`)
    setAdminRoms(roms)
    setAdminTab('painel-adm')
  }, [])

  const loadDiverg = async () => {
    const items = await sbGet('romaneio_items',`item_status=eq.divergencia&select=*,romaneios(record_date,trip_number,destinations(name,code))&order=created_at.desc`)
    setDivergItems(items)
    setAdminTab('divergencias')
  }

  const deleteRomaneio = async (romId: string) => {
    if (!confirm('Deletar este romaneio e todos os seus itens?')) return
    showLoad('Deletando...')
    try {
      await sbDel('romaneio_items',{romaneio_id:romId})
      await sbDel('romaneios',{id:romId})
      showToastPS('🗑 Deletado')
      await loadAdminPainel()
    } catch(e) { showToastPS('❌ Erro') }
    finally { hideLoad() }
  }

  const aprovarDiverg = async (romId: string) => {
    showLoad('Aprovando...')
    try {
      await supabaseRestFetch('rpc/approve_romaneio_divergence', {
        method: 'POST',
        body: JSON.stringify({ p_romaneio_id: romId, p_item_id: null }),
      })
      showToastPS('✅ Divergências aprovadas')
      await loadPainel()
      setScreen('painel')
    } catch(e) { showToastPS('❌ Erro') }
    finally { hideLoad() }
  }

  const aprovarItem = async (itemId: string) => {
    showLoad('Aprovando...')
    try {
      await supabaseRestFetch('rpc/approve_romaneio_divergence', {
        method: 'POST',
        body: JSON.stringify({ p_romaneio_id: null, p_item_id: itemId }),
      })
      showToastPS('✅ Item aprovado')
      await loadDiverg()
    } catch(e) { showToastPS('❌ Erro') }
    finally { hideLoad() }
  }

  const calcFechamento = async () => {
    showLoad('Calculando...')
    try {
      const exDest = dests.find(d=>d.code==='EX')
      if (!exDest) { showToastPS('EX não encontrado'); return }
      const roms = await sbGet('romaneios',`record_date=gte.${fechFrom}&record_date=lte.${fechTo}&destination_id=eq.${exDest.id}&status=neq.separado&select=id,record_date,trip_number,status`)
      if (!roms.length) { setFechResult([]); setFechSummary('Nenhum romaneio no período.'); return }
      const byProduct: Record<string,any> = {}
      for (const rom of roms) {
        const items = await sbGet('romaneio_items',`romaneio_id=eq.${rom.id}`)
        items.forEach((it:RomItem) => {
          if (!byProduct[it.product_name]) byProduct[it.product_name] = { name:it.product_name, sent:0, accepted:0, price:it.unit_price||0 }
          byProduct[it.product_name].sent += Number(it.qty_sent)||0
          byProduct[it.product_name].accepted += Number(it.qty_accepted ?? it.qty_sent)||0
        })
      }
      const rows = Object.values(byProduct).sort((a:any,b:any)=>a.name.localeCompare(b.name))
      setFechResult(rows)
      setFechSummary(`${roms.length} romaneios · ${formatDateBR(fechFrom)} a ${formatDateBR(fechTo)}`)
    } catch(e) { showToastPS('Erro ao calcular') }
    finally { hideLoad() }
  }

  const loadPrecos = async () => {
    const exDest = dests.find(d=>d.code==='EX')
    if (!exDest) return
    const rows = await sbGet('product_prices',`destination_id=eq.${exDest.id}&active=eq.true`)
    const pm: Record<string,string> = {}
    rows.forEach((r:any) => { pm[r.product_id] = r.unit_price })
    setProdPrices(pm)
    setAdminTab('precos')
  }

  const savePrecos = async () => {
    const exDest = dests.find(d=>d.code==='EX')
    if (!exDest) return
    showLoad('Salvando preços...')
    try {
      const rows: any[] = []
      breads.forEach(b => {
        const val = parseFloat(prodPrices[b.id]||'0')
        if (val > 0) rows.push({ product_id:b.id, product_source:'bread', product_name:b.name, destination_id:exDest.id, unit_price:val, active:true })
      })
      if (rows.length) await sbUpsert('product_prices', rows, 'product_id,product_source,destination_id')
      showToastPS('✅ Preços salvos!')
    } catch(e) { showToastPS('❌ Erro') }
    finally { hideLoad() }
  }

  // ── derived ──────────────────────────────────────────────────────
  const activeDraft = criarDestId ? criarDrafts[criarDestId] : undefined
  const activeDestinationIsEx = normalizeDestination(dests.find(destination => destination.id === criarDestId)?.code) === 'EX'
  const activeOptions = activeDraft ? buildRomaneioProductOptions(activeDraft.breads, { ciabattaOnlyKg: activeDestinationIsEx }) : []
  const catalogCandidates = activeDraft ? filterCatalogBreadsForSearch(breads, activeDraft.breads.map(b => b.id), catalogSearch) : []
  const criarTotalItems = activeDraft ? Object.values(activeDraft.qtys).filter(v=>v>0).length : 0
  const criarTotalQtyLabel = activeDraft ? formatDraftTotal(activeDraft.qtys, activeOptions) : '0 un'
  const criarDraftCount = Object.keys(criarDrafts).length
  const userDisplay = getCurrentUser()?.displayName || 'Usuário'
  const userColor = canPerformRomaneioAction(permissions, 'manage') ? '#2A2018' : '#8E4E22'
  const canAny = (action: RomaneioAction) =>
    canPerformRomaneioAction(permissions, action)
    || ['JC', 'JA', 'EX'].some(code => canPerformRomaneioAction(permissions, action, code))

  // ── Render: shell helpers ──────────────────────────────────────
  const Header = ({ subtitle, onBack }: { subtitle?: string; onBack?: () => void }) => (
    <header className="ps-header">
      <div className="ps-wordmark">
        {onBack && (
          <button className="ps-iconbtn" onClick={onBack} aria-label="Voltar">
            <ChevronLeft size={20}/>
          </button>
        )}
        <div className="ps-mark">P</div>
        <div className="ps-brand">
          <b>Romaneios</b>
          {subtitle && <span>{subtitle}</span>}
        </div>
      </div>
      <div className="ps-userchip">
        <div className="ps-avatar" style={{background: userColor}}>{userDisplay.charAt(0).toUpperCase()}</div>
        <b>{userDisplay}</b>
      </div>
    </header>
  )

  // ── Render ──────────────────────────────────────────────────────
  return (
    <>
      {/* TOAST */}

      {/* LOADING overlay */}
      {loading && (
        <div className="ps-loading-overlay">
          <div className="ps-spinner"/>
          <p>{loadingMsg}</p>
        </div>
      )}

      {/* ENVIO CONFIRM MODAL */}
      {envioRomId && (
        <div className="ps-sheet-overlay" onClick={e=>{if(e.target===e.currentTarget)setEnvioRomId(null)}}>
          <div className="ps-sheet confirm">
            <div className="ps-sheet-grab"/>
            <h3>Confirmar Envio</h3>
            <p>Confirmar que o romaneio foi enviado para a loja?</p>
            <div className="actions">
              <button className="ps-btn primary" onClick={confirmEnvio}>
                <Truck size={16}/> Confirmar Envio
              </button>
              <button className="ps-btn ghost" onClick={()=>setEnvioRomId(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* INIT / LOGIN (auto-resolvido pela sessão global; seletor interno removido) */}
      {(screen==='init' || screen==='login') && initialLoadError && (
        <div className="ps-canvas">
          <div className="ps-shell">
            <div className="ps-empty" style={{margin:24}}>
              <AlertTriangle size={30} style={{display:'block',margin:'0 auto 8px'}}/>
              <p>{initialLoadError}</p>
              <button className="ps-btn primary" onClick={() => window.location.reload()}>Tentar novamente</button>
            </div>
          </div>
        </div>
      )}
      {(screen==='init' || screen==='login') && !initialLoadError && (
        <div className="ps-loading">
          <div className="ps-spinner"/>
          <p>Carregando...</p>
        </div>
      )}

      {/* PAINEL */}
      {screen==='painel' && (
        <div className="ps-canvas">
          <div className="ps-shell">
            <Header subtitle={`Hoje · ${formatDateBR(todayKey())}`}/>
            <div className="ps-scroll ps-pad">
              {canAny('create') && (
                <button className="ps-btn primary block" style={{marginTop:16}} onClick={openCriar}>
                  <Plus size={18}/> Novo Romaneio
                </button>
              )}

              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',margin:'18px 0 12px'}}>
                <div className="ps-label" style={{margin:0}}>Hoje · {formatDateBR(todayKey())}</div>
                <button className="ps-btn ghost sm" onClick={refreshPainel}>
                  <RotateCw size={14}/> Atualizar
                </button>
              </div>

              {romaneios.length===0 ? (
                <div className="ps-empty">
                  <Package size={36} style={{display:'block',margin:'0 auto 8px',opacity:.4}}/>
                  Nenhum romaneio hoje.
                </div>
              ) : (
                <div style={{display:'flex',flexDirection:'column',gap:12}}>
                  {romaneios.map(r=>(
                    <div key={r.id} className="ps-card">
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div className="ps-pname">{r.destinations?.name} · Viagem {r.trip_number}</div>
                          <div className="ps-card-meta" style={{textAlign:'left',marginTop:4}}>
                            Criado por {r.created_by}{r.created_at ? ` às ${fmtTime(r.created_at)}` : ''}
                            {r.sent_at&&` · Saiu ${fmtDateTime(r.sent_at)}`}
                            {r.confirmed_at&&` · Conf. ${fmtDateTime(r.confirmed_at)}`}
                          </div>
                        </div>
                        <span className={`ps-status ${r.status}`}>{statusLabel(r.status)}</span>
                      </div>
                      {r.obs && <div style={{fontSize:12,color:'var(--ink-soft)'}}>{r.obs}</div>}
                      <div className="ps-item-actions">
                        <button className="ps-btn ghost sm" onClick={()=>openDetalhe(r.id)}>
                          <Eye size={14}/> Ver itens
                        </button>
                        <button className="ps-btn info sm" onClick={()=>openDetalhe(r.id, true)}>
                          <Printer size={14}/> Imprimir
                        </button>
                        {canPerformRomaneioAction(permissions, 'send', r.destinations?.code)&&r.status==='separado'&&(
                          <button className="ps-btn info sm" onClick={()=>setEnvioRomId(r.id)}>
                            <Truck size={14}/> Marcar Enviado
                          </button>
                        )}
                        {canPerformRomaneioAction(permissions, 'receive', r.destinations?.code)&&r.status==='enviado'&&(
                          <button className="ps-btn success sm" onClick={()=>openConferencia(r.id)}>
                            <CheckCheck size={14}/> Conferir chegada
                          </button>
                        )}
                        {canPerformRomaneioAction(permissions, 'approve', r.destinations?.code)&&r.status==='com_divergencia'&&(
                          <button className="ps-btn success sm" onClick={()=>aprovarDiverg(r.id)}>
                            <Check size={14}/> Aprovar diverg.
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* DETALHE */}
      {screen==='detalhe' && detailRom && (
        <>
        <div className="ps-canvas">
          <div className="ps-shell">
            <Header onBack={()=>setScreen('painel')} subtitle={statusLabel(detailRom.status)}/>
            <div className="ps-scroll ps-pad">
              <div className="ps-card" style={{marginTop:16}}>
                <div className="ps-pname">{detailRom.destinations?.name} · Viagem {detailRom.trip_number}</div>
                <div className="ps-card-meta" style={{textAlign:'left'}}>
                  Data: {formatDateBR(detailRom.record_date)} · Criado por: {detailRom.created_by}{detailRom.created_at ? ` às ${fmtTime(detailRom.created_at)}` : ''}
                  {detailRom.sent_at && <><br/>Enviado por {detailRom.sent_by} em {fmtDateTime(detailRom.sent_at)}</>}
                  {detailRom.confirmed_at && <><br/>Conferido por {detailRom.confirmed_by} em {fmtDateTime(detailRom.confirmed_at)}</>}
                </div>
                {detailRom.obs && <div style={{fontSize:13,color:'var(--ink-soft)',marginTop:4}}>{detailRom.obs}</div>}
                <span className={`ps-status ${detailRom.status}`} style={{alignSelf:'flex-start'}}>{statusLabel(detailRom.status)}</span>
              </div>

              <button className="ps-btn info block no-print" style={{marginTop:14}} onClick={()=>window.print()}>
                <Printer size={16}/> Imprimir romaneio
              </button>

              <div className="ps-label" style={{marginTop:20}}>Itens</div>
              {detailItems.length===0 && <div className="ps-empty">Nenhum item.</div>}
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {detailItems.map(it=>(
                  <div key={it.id} className="ps-item">
                    <div className="ps-item-head">
                      <div className="ps-item-name">{it.product_name}</div>
                      <span className={`ps-status ${it.item_status||'pendente'}`}>{it.item_status||'pendente'}</span>
                    </div>
                    <div className="ps-item-meta">
                      <span>Enviado: <b>{it.qty_sent}</b></span>
                      {it.qty_received!=null && <span>Recebido: <b>{it.qty_received}</b></span>}
                      {it.qty_accepted!=null && <span>Aceito: <b>{it.qty_accepted}</b></span>}
                    </div>
                    {it.divergence_reason && (
                      <div style={{fontSize:12,color:'var(--berry)',fontWeight:600}}>
                        <AlertTriangle size={12} style={{verticalAlign:-2,marginRight:4}}/>
                        {it.divergence_reason}
                      </div>
                    )}
                    {it.obs && <div style={{fontSize:12,color:'var(--ink-soft)'}}>{it.obs}</div>}
                  </div>
                ))}
              </div>

              {canPerformRomaneioAction(permissions, 'approve', detailRom.destinations?.code) && detailRom.status==='com_divergencia' && (
                <button className="ps-btn primary block" style={{marginTop:18}} onClick={()=>aprovarDiverg(detailRom.id)}>
                  <Check size={16}/> Aprovar divergências
                </button>
              )}
            </div>
          </div>
        </div>
        <RomaneioPrint rom={detailRom} items={detailItems}/>
        </>
      )}

      {/* CRIAR */}
      {screen==='criar' && (
        <div className="ps-canvas">
          <div className="ps-shell">
            <Header onBack={()=>setScreen(canPerformRomaneioAction(permissions, 'manage') ? 'admin' : 'painel')} subtitle="Novo romaneio"/>
            <div className="ps-scroll ps-pad">
              <div className="ps-label" style={{marginTop:16}}>Data</div>
              <input type="date" value={criarDate} className="ps-input" style={{width:'100%'}}
                onChange={e=>onCriarDateChange(e.target.value)}/>

              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,marginTop:14}}>
                <div className="ps-label" style={{margin:0}}>Lojas</div>
                <button className="ps-btn ghost sm" onClick={saveCriarDrafts} disabled={criarDraftCount===0}>
                  <Save size={14}/> Salvar rascunho
                </button>
              </div>
              <div className="ps-tabs" role="tablist" style={{marginTop:8, overflowX:'auto'}}>
                {dests.filter(d => canPerformRomaneioAction(permissions, 'create', d.code)).map(d=>{
                  const draft = criarDrafts[d.id]
                  const hasItems = draftHasItems(draft)
                  return (
                    <button key={d.id} className="ps-tab" role="tab" aria-selected={criarDestId===d.id} onClick={()=>onDestChange(d.id)}>
                      {d.name}{hasItems ? ' •' : ''}
                    </button>
                  )
                })}
              </div>

              {!activeDraft && (
                <div className="ps-empty" style={{marginTop:14}}>
                  Selecione uma loja para abrir o romaneio.
                </div>
              )}

              {activeDraft && (
                <div className="ps-banner honey" style={{marginTop:14}}>
                  <span>{entregaLabel(activeDraft.trip)} para {dests.find(d=>d.id===criarDestId)?.name || 'esta loja'}</span>
                </div>
              )}

              {activeDraft && (
                <>
                  <div className="ps-label">Produtos</div>
                  <div style={{display:'flex',flexDirection:'column',gap:10}}>
                    {activeOptions.map(option=>{
                      const qty = activeDraft.qtys[option.key]||0
                      const orderQty = activeDraft.orderQtys?.[option.productId] || 0
                      const previouslySentQty = activeDraft.previouslySentQtys?.[option.productId] || 0
                      const progressQty = previouslySentQty + qty
                      return (
                        <div key={option.key} className={`ps-card ${qty>0?'active':''}`}>
                          <div className="ps-card-head">
                            <div style={{display:'flex',alignItems:'baseline',gap:8,flexWrap:'wrap'}}>
                              <div className="ps-pname">{option.displayName}</div>
                              {orderQty > 0 && <span style={{fontSize:13,fontWeight:700,color:'var(--ink-soft)'}}>{formatRomaneioQty(progressQty)} de {formatRomaneioQty(orderQty)}</span>}
                            </div>
                            <span className="ps-store-chip" style={{alignSelf:'flex-start',background:'var(--line-soft)',color:'var(--ink-soft)'}}>{option.unit}</span>
                          </div>
                          <div className="ps-stepper">
                            <button className="ps-step" onClick={()=>criarChangeQty(option.key,-option.step)} disabled={qty<=0} aria-label="Diminuir">
                              <span style={{fontSize:20,fontWeight:700}}>−</span>
                            </button>
                            <RomaneioQuantityInput
                              className={`ps-qty ${qty===0?'zero':''}`}
                              value={qty}
                              allowDecimal={option.allowDecimal}
                              onValueChange={value=>setCriarQty(option.key, String(value))}
                            />
                            <button className="ps-step" onClick={()=>criarChangeQty(option.key,option.step)} aria-label="Aumentar">
                              <span style={{fontSize:20,fontWeight:700}}>+</span>
                            </button>
                          </div>
                          {isWeightControlledRomaneioProduct(option.productName) && (
                            <div style={{fontSize:12,color:'var(--ink-soft)',marginTop:8,lineHeight:1.4}}>
                              Peso enviado em kg. Ex.: <b>1,450</b> = 1.450 g. Máximo: 10 kg.
                              {qty > 0 && <div style={{fontWeight:700,color:'var(--ps-ink)'}}>{formatRomaneioQty(qty)} kg = {formatRomaneioWeightInGrams(qty)} g</div>}
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {/* Extras */}
                    {Object.entries(activeDraft.extras).map(([eid,name])=>{
                      const qty = activeDraft.qtys[eid]||0
                      return (
                        <div key={eid} className={`ps-card ${qty>0?'active':''}`}>
                          <div className="ps-card-head" style={{flexDirection:'row',alignItems:'flex-start',gap:8,justifyContent:'space-between'}}>
                            <div className="ps-pname" style={{fontStyle:'italic'}}>
                              {name} <span style={{fontSize:11,color:'var(--ink-faint)',fontStyle:'normal'}}>(especial)</span>
                            </div>
                            <button onClick={()=>removeExtra(eid)} className="ps-iconbtn" style={{width:30,height:30,fontSize:14}} aria-label="Remover">
                              <X size={14}/>
                            </button>
                          </div>
                          <div className="ps-stepper">
                            <button className="ps-step" onClick={()=>criarChangeQty(eid,-1)} disabled={qty<=0} aria-label="Diminuir">
                              <span style={{fontSize:20,fontWeight:700}}>−</span>
                            </button>
                            <input className={`ps-qty ${qty===0?'zero':''}`} type="text" inputMode="numeric" value={qty?formatRomaneioQty(qty):''} placeholder="0"
                              onChange={e=>setCriarQty(eid,e.target.value)}/>
                            <button className="ps-step" onClick={()=>criarChangeQty(eid,1)} aria-label="Aumentar">
                              <span style={{fontSize:20,fontWeight:700}}>+</span>
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Buscar produto no catálogo */}
                  <div style={{marginTop:18,paddingTop:14,borderTop:'1px dashed var(--ps-line)'}}>
                    <div className="ps-label" style={{marginTop:0}}>+ Adicionar produto do catálogo</div>
                    <input className="ps-input" style={{width:'100%'}}
                      placeholder="Buscar pão cadastrado (ex.: ciabatta)..." value={catalogSearch}
                      onChange={e=>setCatalogSearch(e.target.value)}/>
                    {catalogSearch.trim() && (
                      <div style={{display:'flex',flexDirection:'column',gap:6,marginTop:8}}>
                        {catalogCandidates.length===0 ? (
                          <div style={{fontSize:13,color:'var(--ink-soft)',lineHeight:1.4}}>
                            Nada novo com esse nome — pode já estar na lista acima. Se for um pão que ainda não existe, use “Pão especial / avulso” abaixo.
                          </div>
                        ) : catalogCandidates.map(bread=>(
                          <button key={bread.id} className="ps-btn ghost" style={{justifyContent:'space-between',width:'100%'}}
                            onClick={()=>addCatalogBread(bread)}>
                            <span>{bread.name}</span>
                            <Plus size={14}/>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Add extra */}
                  <div style={{marginTop:18,paddingTop:14,borderTop:'1px dashed var(--ps-line)'}}>
                    <div className="ps-label" style={{marginTop:0}}>+ Pão especial / avulso</div>
                    <div style={{display:'flex',gap:8,alignItems:'center'}}>
                      <input className="ps-input" style={{flex:1}}
                        placeholder="Nome do pão..." value={activeDraft.extraInput}
                        onChange={e=>updateCriarDraft(criarDestId, draft => ({ ...draft, extraInput: e.target.value }))}
                        onKeyDown={e=>e.key==='Enter'&&addExtra()}/>
                      <button className="ps-btn" onClick={addExtra}>
                        <Plus size={14}/> Adicionar
                      </button>
                    </div>
                  </div>

                  <div style={{marginTop:16}}>
                    <div className="ps-label" style={{marginTop:0}}>Observações</div>
                    <textarea className="ps-textarea" placeholder="Observações sobre o romaneio..."
                      value={activeDraft.obs} onChange={e=>updateCriarDraft(criarDestId, draft => ({ ...draft, obs: e.target.value }))}/>
                  </div>
                </>
              )}
            </div>

            {/* Total bar fixa */}
            {activeDraft && (
              <div className="ps-totalbar">
                <div className="ps-total-num">
                  <b>{criarTotalItems}</b>
                  <span>produtos · {criarTotalQtyLabel}</span>
                </div>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <button className="ps-btn ghost" onClick={saveCriarDrafts}>
                    <Save size={15}/> Salvar
                  </button>
                  <button className="ps-save" onClick={saveRomaneio} disabled={!criarTotalItems || loading}>
                    <Check size={16}/> Fechar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CONFERENCIA */}
      {screen==='conferencia' && confRom && (
        <div className="ps-canvas">
          <div className="ps-shell">
            <Header onBack={()=>setScreen('painel')} subtitle="Conferência"/>
            <div className="ps-scroll ps-pad">
              <div className="ps-card" style={{marginTop:16}}>
                <div className="ps-pname">{confRom.destinations?.name} · Viagem {confRom.trip_number}</div>
                <div className="ps-card-meta" style={{textAlign:'left'}}>
                  Enviado por {confRom.sent_by||'?'} em {fmtDateTime(confRom.sent_at)}
                </div>
              </div>

              <div className="ps-label">Confirme o que chegou ({confItems.length} itens)</div>
              <div style={{display:'flex',flexDirection:'column',gap:12}}>
                {confItems.map(it=>{
                  const cd = confData[it.id]
                  if (!cd) return null
                  const isWeightItem = isWeightControlledRomaneioProduct(it.product_name)
                  const hasDiverg = cd.rec!==it.qty_sent || cd.acc!==cd.rec
                  return (
                    <div key={it.id} className="ps-card">
                      <div className="ps-card-head" style={{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',gap:10}}>
                        <div className="ps-pname" style={{flex:1,minWidth:0}}>{it.product_name}</div>
                        <span style={{fontSize:12,color:'var(--ink-soft)',whiteSpace:'nowrap'}}>Enviado: <b style={{color:'var(--ps-ink)'}}>{formatRomaneioQty(Number(it.qty_sent))}{isWeightItem ? ' kg' : ''}</b></span>
                      </div>

                      {cd.refused ? (
                        <div className="ps-refuse">
                          <div className="ps-refuse-head">
                            <X size={14}/> Item recusado
                          </div>
                          <input className="ps-input"
                            placeholder="Motivo da recusa (obrigatório)..."
                            value={cd.refuseReason} onChange={e=>updateConf(it.id,'refuseReason',e.target.value)}/>
                          <div style={{display:'flex',gap:8}}>
                            <button className="ps-btn danger sm" style={{flex:1}}>Confirmar recusa</button>
                            <button className="ps-btn ghost sm" onClick={()=>desfazerRecusa(it.id,it.qty_sent)}>Desfazer</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="ps-fieldrow">
                            <div className="ps-fieldgroup">
                              <div className="ps-fieldlabel">Recebido</div>
                              <RomaneioQuantityInput value={cd.rec} allowDecimal={isWeightItem}
                                onValueChange={value=>updateConf(it.id,'rec',value)}/>
                              {isWeightItem && <div style={{fontSize:11,color:'var(--ink-soft)',marginTop:4}}>kg</div>}
                            </div>
                            <div className="ps-fieldgroup">
                              <div className="ps-fieldlabel">Aceito/Cobrável</div>
                              <RomaneioQuantityInput value={cd.acc} allowDecimal={isWeightItem}
                                onValueChange={value=>updateConf(it.id,'acc',value)}/>
                              {isWeightItem && <div style={{fontSize:11,color:'var(--ink-soft)',marginTop:4}}>kg</div>}
                            </div>
                          </div>
                          {hasDiverg && (
                            <>
                              <select className="ps-select"
                                value={cd.motivo} onChange={e=>updateConf(it.id,'motivo',e.target.value)}>
                                <option value="">Motivo da divergência...</option>
                                {['Veio menos','Veio mais','Quebrado','Queimado','Cru','Torto','Fora do padrão','Erro de lançamento','Outro'].map(m=>(
                                  <option key={m}>{m}</option>
                                ))}
                              </select>
                              <input className="ps-input"
                                placeholder="Observação (opcional)"
                                value={cd.itemObs} onChange={e=>updateConf(it.id,'itemObs',e.target.value)}/>
                            </>
                          )}
                          <button className="ps-btn danger sm" onClick={()=>recusarItem(it.id)}>
                            <X size={14}/> Recusar item
                          </button>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="ps-totalbar">
              <div className="ps-total-num">
                <b>{confItems.length}</b>
                <span>itens p/ conferir</span>
              </div>
              <button className="ps-save" onClick={saveConferencia}>
                <CheckCheck size={16}/> Salvar Conferência
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADMIN */}
      {screen==='admin' && (
        <div className="ps-canvas">
          <div className="ps-shell">
            <Header subtitle="Painel Admin"/>
            <div className="ps-pad" style={{marginTop:14}}>
              <div className="ps-tabs" role="tablist">
                {([['painel-adm','Painel'],['divergencias','Divergências'],['fechamento','Fechamento'],['precos','Preços']] as const).map(([tab,label])=>(
                  <button key={tab} className="ps-tab" role="tab" aria-selected={adminTab===tab} onClick={async()=>{
                    if(tab==='painel-adm'){showLoad('...');try{await loadAdminPainel()}catch(e){}finally{hideLoad();setAdminTab('painel-adm')}}
                    else if(tab==='divergencias'){showLoad('...');try{await loadDiverg()}catch(e){}finally{hideLoad()}}
                    else if(tab==='precos'){showLoad('...');try{await loadPrecos()}catch(e){}finally{hideLoad()}}
                    else setAdminTab(tab)
                  }}>{label}</button>
                ))}
              </div>
            </div>
            <div className="ps-scroll ps-pad">
              {/* Painel admin */}
              {adminTab==='painel-adm' && (
                <>
                  <button className="ps-btn primary block" style={{marginTop:16, marginBottom:14}} onClick={openCriar}>
                    <Plus size={18}/> Novo Romaneio
                  </button>
                  <div className="ps-label">Hoje · {formatDateBR(todayKey())}</div>
                  {adminRoms.length===0 && (
                    <div className="ps-empty">
                      <Package size={36} style={{display:'block',margin:'0 auto 8px',opacity:.4}}/>
                      Nenhum romaneio hoje.
                    </div>
                  )}
                  <div style={{display:'flex',flexDirection:'column',gap:12}}>
                    {adminRoms.map(r=>(
                      <div key={r.id} className="ps-card">
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10}}>
                          <div style={{flex:1,minWidth:0}}>
                            <div className="ps-pname">{r.destinations?.name} · Viagem {r.trip_number}</div>
                            <div className="ps-card-meta" style={{textAlign:'left',marginTop:4}}>
                              Criado por {r.created_by}{r.created_at ? ` às ${fmtTime(r.created_at)}` : ''}
                              {r.sent_at&&` · Saiu ${fmtDateTime(r.sent_at)}`}
                              {r.confirmed_at&&` · Conf. ${fmtDateTime(r.confirmed_at)}`}
                            </div>
                          </div>
                          <span className={`ps-status ${r.status}`}>{statusLabel(r.status)}</span>
                        </div>
                        <div className="ps-item-actions">
                          <button className="ps-btn ghost sm" onClick={()=>openDetalhe(r.id)}>
                            <Eye size={14}/> Ver detalhes
                          </button>
                          <button className="ps-btn info sm" onClick={()=>openDetalhe(r.id, true)}>
                            <Printer size={14}/> Imprimir
                          </button>
                          {r.status==='com_divergencia' && (
                            <button className="ps-btn success sm" onClick={()=>aprovarDiverg(r.id)}>
                              <Check size={14}/> Aprovar diverg.
                            </button>
                          )}
                          <button className="ps-btn danger sm" onClick={()=>deleteRomaneio(r.id)} aria-label="Deletar">
                            <Trash2 size={14}/>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Divergências */}
              {adminTab==='divergencias' && (
                <>
                  <div className="ps-label">Divergências pendentes ({divergItems.length})</div>
                  {divergItems.length===0 && (
                    <div className="ps-empty">
                      <Check size={36} style={{display:'block',margin:'0 auto 8px',opacity:.4}}/>
                      Nenhuma divergência pendente.
                    </div>
                  )}
                  <div style={{display:'flex',flexDirection:'column',gap:12}}>
                    {divergItems.map((it:any)=>(
                      <div key={it.id} className="ps-card">
                        <div className="ps-pname">{it.product_name}</div>
                        <div className="ps-card-meta" style={{textAlign:'left'}}>
                          {it.romaneios?.destinations?.name} · Viagem {it.romaneios?.trip_number} · {formatDateBR(it.romaneios?.record_date)}
                        </div>
                        <div className="ps-item-meta">
                          <span>Enviado: <b>{it.qty_sent}</b></span>
                          <span>Recebido: <b>{it.qty_received??'?'}</b></span>
                          <span>Aceito: <b>{it.qty_accepted??'?'}</b></span>
                        </div>
                        {it.divergence_reason && (
                          <div style={{fontSize:12,color:'var(--berry)',fontWeight:600}}>
                            <AlertTriangle size={12} style={{verticalAlign:-2,marginRight:4}}/>
                            {it.divergence_reason}
                          </div>
                        )}
                        <div className="ps-item-actions">
                          <button className="ps-btn success sm" onClick={()=>aprovarItem(it.id)}>
                            <Check size={14}/> Aprovar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Fechamento */}
              {adminTab==='fechamento' && (
                <>
                  <div className="ps-label">Fechamento EX</div>
                  <div className="ps-fieldrow">
                    <div className="ps-fieldgroup">
                      <div className="ps-fieldlabel">De</div>
                      <input type="date" value={fechFrom} className="ps-input" onChange={e=>setFechFrom(e.target.value)}/>
                    </div>
                    <div className="ps-fieldgroup">
                      <div className="ps-fieldlabel">Até</div>
                      <input type="date" value={fechTo} className="ps-input" onChange={e=>setFechTo(e.target.value)}/>
                    </div>
                  </div>
                  <button className="ps-btn primary block" style={{marginTop:14}} onClick={calcFechamento}>
                    Calcular
                  </button>

                  {fechResult===null && (
                    <div style={{color:'var(--ink-soft)',fontSize:13,marginTop:16}}>
                      Selecione o período e clique em Calcular.
                    </div>
                  )}
                  {fechResult!==null && fechResult.length===0 && (
                    <div style={{color:'var(--ink-soft)',fontSize:13,marginTop:16}}>
                      {fechSummary||'Nenhum romaneio no período.'}
                    </div>
                  )}
                  {fechResult!==null && fechResult.length>0 && (
                    <>
                      <div style={{fontSize:13,color:'var(--ink-soft)',margin:'16px 0 10px'}}>{fechSummary}</div>
                      <div className="ps-table-wrap">
                        <table className="ps-table">
                          <thead>
                            <tr>
                              <th>Produto</th>
                              <th className="num">Enviado</th>
                              <th className="num">Aceito</th>
                              <th className="num">Preço</th>
                              <th className="num">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {fechResult.map((r:any,i:number)=>(
                              <tr key={i}>
                                <td>{r.name}</td>
                                <td className="num">{r.sent}</td>
                                <td className="num">{r.accepted}</td>
                                <td className="num">{r.price?`R$ ${Number(r.price).toFixed(2)}`:'—'}</td>
                                <td className="num">{r.price?`R$ ${(r.accepted*r.price).toFixed(2)}`:'—'}</td>
                              </tr>
                            ))}
                            <tr className="total">
                              <td>TOTAL</td>
                              <td className="num">{fechResult.reduce((a:number,r:any)=>a+r.sent,0)}</td>
                              <td className="num">{fechResult.reduce((a:number,r:any)=>a+r.accepted,0)}</td>
                              <td/>
                              <td className="num">R$ {fechResult.reduce((a:number,r:any)=>a+(r.accepted*(r.price||0)),0).toFixed(2)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </>
              )}

              {/* Preços */}
              {adminTab==='precos' && (
                <>
                  <div className="ps-label">Preços EX por produto</div>
                  <div style={{fontSize:12,color:'var(--ink-soft)',marginBottom:12}}>
                    Valores que a EX paga por unidade. Usados no fechamento semanal.
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    {breads.map(b=>(
                      <div key={b.id} className="ps-item" style={{flexDirection:'row',alignItems:'center',padding:'12px 14px'}}>
                        <div className="ps-item-name" style={{fontSize:14}}>{b.name}</div>
                        <div style={{display:'flex',alignItems:'center',gap:8,flex:'none'}}>
                          <span style={{fontSize:12,color:'var(--ink-soft)'}}>R$</span>
                          <input className="ps-input" style={{width:90,textAlign:'right',padding:'8px 10px'}}
                            type="number" min={0} step={0.01} placeholder="0,00"
                            value={prodPrices[b.id]||''}
                            onChange={e=>setProdPrices(prev=>({...prev,[b.id]:e.target.value}))}/>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button className="ps-btn primary block" style={{marginTop:18}} onClick={savePrecos}>
                    <Save size={16}/> Salvar preços
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
