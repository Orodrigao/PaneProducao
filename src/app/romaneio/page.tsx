'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getCurrentUser, logout as authLogout, firstAllowedRoute } from '@/lib/auth'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const ADMIN_PASS = 'pane2025'
const H = { 'apikey':SB_KEY, 'Authorization':'Bearer '+SB_KEY, 'Content-Type':'application/json' }

type Screen = 'init'|'login'|'painel'|'detalhe'|'criar'|'conferencia'|'admin'
type Role = 'gustavo'|'cleo'|'marselle'|'rodrigo'
type AdminTab = 'painel-adm'|'divergencias'|'fechamento'|'precos'

interface Destination { id:string; name:string; code:string; active:boolean }
interface Bread { id:string; name:string; active:boolean; is_pj:boolean }
interface Romaneio { id:string; record_date:string; destination_id:string; trip_number:number; status:string; created_by:string; obs?:string; sent_by?:string; sent_at?:string; confirmed_by?:string; confirmed_at?:string; destinations?:{name:string;code:string} }
interface RomItem { id:string; romaneio_id:string; product_id:string; product_source:string; product_name:string; qty_sent:number; qty_received?:number; qty_accepted?:number; divergence_reason?:string; obs?:string; item_status?:string; unit_price?:number }
interface ConfEntry { rec:number; acc:number; motivo:string; itemObs:string; refused:boolean; refuseReason:string }

// ── utils ──────────────────────────────────────────────────────────
function nowBrasilia() { const n=new Date(); const o=-3*60-n.getTimezoneOffset(); return new Date(n.getTime()+o*60000) }
function todayKey() { const d=nowBrasilia(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
function fmtDate(s:string|null|undefined) { if(!s)return ''; const[y,m,d]=s.split('-'); return `${d}/${m}/${y}` }
function fmtDateTime(s:string|null|undefined) { if(!s)return ''; const d=new Date(s); const br=new Date(d.getTime()-3*60*60000); return `${String(br.getDate()).padStart(2,'0')}/${String(br.getMonth()+1).padStart(2,'0')} ${String(br.getHours()).padStart(2,'0')}:${String(br.getMinutes()).padStart(2,'0')}` }
function statusLabel(s:string) { return ({separado:'Separado',enviado:'Enviado',conferido:'Conferido',com_divergencia:'Divergência',aprovado:'Aprovado',fechado:'Fechado'} as Record<string,string>)[s]||s }
function slugExtra() { return 'extra_'+Date.now() }
function showToast(msg:string, dur=2800) {
  const el=document.getElementById('rom-toast'); if(!el)return;
  el.textContent=msg; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),dur)
}

// ── Supabase ────────────────────────────────────────────────────────
async function sbGet(table:string, params='') {
  const r=await fetch(`${SB_URL}/rest/v1/${table}?${params}`,{headers:H})
  if(!r.ok) throw new Error(await r.text())
  return r.json()
}
async function sbPost(table:string, data:any) {
  const r=await fetch(`${SB_URL}/rest/v1/${table}`,{
    method:'POST', headers:{...H,'Prefer':'return=representation'}, body:JSON.stringify(data)
  })
  if(!r.ok) throw new Error(await r.text())
  return r.json()
}
async function sbUpsert(table:string, data:any, onConflict?:string) {
  const qs=onConflict?`?on_conflict=${onConflict}`:''
  const r=await fetch(`${SB_URL}/rest/v1/${table}${qs}`,{
    method:'POST', headers:{...H,'Prefer':'resolution=merge-duplicates,return=representation'}, body:JSON.stringify(data)
  })
  if(!r.ok) throw new Error(await r.text())
  return r.json()
}
async function sbPatch(table:string, data:any, match:Record<string,string>) {
  const q=Object.entries(match).map(([k,v])=>`${k}=eq.${v}`).join('&')
  const r=await fetch(`${SB_URL}/rest/v1/${table}?${q}`,{
    method:'PATCH', headers:{...H,'Prefer':'return=representation'}, body:JSON.stringify(data)
  })
  if(!r.ok) throw new Error(await r.text())
  return r.json()
}
async function sbDel(table:string, match:Record<string,string>) {
  const q=Object.entries(match).map(([k,v])=>`${k}=eq.${v}`).join('&')
  const r=await fetch(`${SB_URL}/rest/v1/${table}?${q}`,{method:'DELETE',headers:H})
  if(!r.ok) throw new Error(await r.text())
}

// ── Main ──────────────────────────────────────────────────────────
export default function RomaneioPage() {
  const router = useRouter()
  const [screen, setScreen] = useState<Screen>('init')
  const [role, setRole] = useState<Role|null>(null)
  const [dests, setDests] = useState<Destination[]>([])
  const [breads, setBreads] = useState<Bread[]>([])
  const [prices, setPrices] = useState<Record<string,number>>({})
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('Carregando...')
  // painel
  const [romaneios, setRomaneios] = useState<Romaneio[]>([])
  // admin pass modal
  const [showPassModal, setShowPassModal] = useState(false)
  const [passInput, setPassInput] = useState('')
  // detalhe
  const [detailRom, setDetailRom] = useState<Romaneio|null>(null)
  const [detailItems, setDetailItems] = useState<RomItem[]>([])
  // criar
  const [criarDate, setCriarDate] = useState(todayKey())
  const [criarDestId, setCriarDestId] = useState('')
  const [criarBreads, setCriarBreads] = useState<Bread[]>([])
  const [criarQtys, setCriarQtys] = useState<Record<string,number>>({})
  const [criarExtras, setCriarExtras] = useState<Record<string,string>>({}) // id->name
  const [criarTrip, setCriarTrip] = useState(1)
  const [criarObs, setCriarObs] = useState('')
  const [criarExtraInput, setCriarExtraInput] = useState('')
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

  const loadPainel = useCallback(async () => {
    const date = todayKey()
    const roms = await sbGet('romaneios',`record_date=eq.${date}&order=created_at.desc&select=*,destinations(name,code)`)
    setRomaneios(roms)
  }, [])

  // ── login ──────────────────────────────────────────────────────
  const doLogin = async (r: Role) => {
    setRole(r)
    showLoad('Carregando...')
    try {
      await loadBase()
      await loadPainel()
      hideLoad()
      setScreen('painel')
    } catch(e) { hideLoad(); showToast('Erro de conexão') }
  }

  const tryAdminLogin = () => { setPassInput(''); setShowPassModal(true) }
  const checkPass = async () => {
    if (passInput !== ADMIN_PASS) { showToast('❌ Senha incorreta'); setPassInput(''); return }
    setShowPassModal(false)
    setRole('rodrigo')
    showLoad('Carregando...')
    try {
      await loadBase()
      await loadAdminPainel()
      hideLoad()
      setScreen('admin')
    } catch(e) { hideLoad(); showToast('Erro') }
  }

  const goHome = () => {
    setRole(null); setScreen('login')
    authLogout(); router.push('/login')
  }

  // Auto-resolve: usa o user globalmente autenticado (PIN) ao invés do seletor interno.
  // Admins vão direto pro screen='admin'. Demais entram via doLogin no screen='painel'.
  useEffect(() => {
    const globalUser = getCurrentUser()
    if (!globalUser) { router.replace('/login'); return }
    if (globalUser.role === 'admin') {
      setRole('rodrigo')
      showLoad('Carregando...')
      ;(async () => {
        try {
          await loadBase()
          await loadAdminPainel()
          hideLoad()
          setScreen('admin')
        } catch(e) { hideLoad(); showToast('Erro') }
      })()
      return
    }
    let internalRole: Role | null = null
    // Mapeamento por loja primeiro (mais robusto pra novos usuários):
    //   JC → gustavo (separa/cria romaneios)
    //   JA → cleo (motorista, marca enviado)
    //   EX → marselle (recebe, marca conferido)
    if (globalUser.role === 'expedicao' && globalUser.store === 'jc')      internalRole = 'gustavo'
    else if (globalUser.role === 'expedicao' && globalUser.store === 'ja') internalRole = 'cleo'
    else if (globalUser.role === 'expedicao' && globalUser.store === 'ex') internalRole = 'marselle'
    // Fallback por id pra usuários sem store ainda (defesa)
    else if (globalUser.id === 'gustavo')      internalRole = 'gustavo'
    else if (globalUser.id === 'marselle')     internalRole = 'marselle'
    else if (globalUser.id === 'cleo')         internalRole = 'cleo'
    else if (globalUser.role === 'expedicao')  internalRole = 'gustavo' // último fallback
    else if (globalUser.role === 'producao'
          || globalUser.role === 'financeiro') internalRole = 'marselle' // view-only proxy
    if (internalRole) doLogin(internalRole)
    else router.replace(firstAllowedRoute(globalUser))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  // ── painel ──────────────────────────────────────────────────────
  const refreshPainel = async () => {
    showLoad('Atualizando...')
    try { await loadPainel() } catch(e) { showToast('Erro ao atualizar') }
    finally { hideLoad(); setScreen('painel') }
  }

  // ── detalhe ──────────────────────────────────────────────────────
  const openDetalhe = async (romId: string) => {
    showLoad('Carregando...')
    try {
      const [roms, items] = await Promise.all([
        sbGet('romaneios',`id=eq.${romId}&select=*,destinations(name,code)`),
        sbGet('romaneio_items',`romaneio_id=eq.${romId}&order=product_name.asc`)
      ])
      setDetailRom(roms[0]); setDetailItems(items)
      setScreen('detalhe')
    } catch(e) { showToast('Erro ao carregar') }
    finally { hideLoad() }
  }

  // ── criar ──────────────────────────────────────────────────────
  const openCriar = () => {
    setCriarDate(todayKey()); setCriarDestId(''); setCriarBreads([])
    setCriarQtys({}); setCriarExtras({}); setCriarObs(''); setCriarExtraInput('')
    setScreen('criar')
  }

  const onDestChange = async (destId: string) => {
    setCriarDestId(destId)
    if (!destId) { setCriarBreads([]); return }
    showLoad('Verificando viagens...')
    try {
      const [existing, orders] = await Promise.all([
        sbGet('romaneios',`record_date=eq.${criarDate}&destination_id=eq.${destId}`),
        sbGet('orders',`order_date=eq.${criarDate}&quantity=gt.0&select=bread_id`)
      ])
      setCriarTrip(existing.length + 1)
      // Load breads ordered today, fallback to all
      let bds = breads
      if (orders.length) {
        const ids = [...new Set(orders.map((o:any)=>o.bread_id))].filter(Boolean)
        if (ids.length) {
          const byOrder = await sbGet('breads',`id=in.(${ids.join(',')})&active=eq.true&is_pj=eq.false&order=name.asc`)
          if (byOrder.length) bds = byOrder
        }
      }
      setCriarBreads(bds)
      setCriarQtys({})
    } catch(e) { showToast('Erro') }
    finally { hideLoad() }
  }

  const criarChangeQty = (id: string, delta: number) => {
    setCriarQtys(prev => ({ ...prev, [id]: Math.max(0, (prev[id]||0)+delta) }))
  }

  const addExtra = () => {
    const name = criarExtraInput.trim()
    if (!name) return
    const eid = slugExtra()
    setCriarExtras(prev => ({ ...prev, [eid]: name }))
    setCriarQtys(prev => ({ ...prev, [eid]: 0 }))
    setCriarExtraInput('')
    showToast('✅ '+name+' adicionado')
  }
  const removeExtra = (eid: string) => {
    setCriarExtras(prev => { const n={...prev}; delete n[eid]; return n })
    setCriarQtys(prev => { const n={...prev}; delete n[eid]; return n })
  }

  const saveRomaneio = async () => {
    const items = Object.entries(criarQtys).filter(([,v])=>v>0)
    if (!items.length) { showToast('⚠️ Adicione ao menos um produto'); return }
    if (!criarDestId) { showToast('⚠️ Selecione o destino'); return }
    showLoad('Salvando romaneio...')
    try {
      const rom = await sbPost('romaneios',[{
        record_date:criarDate, destination_id:criarDestId, trip_number:criarTrip,
        status:'separado', created_by:'Gustavo', obs:criarObs||null
      }])
      const romId = rom[0].id
      const itemRows = items.map(([pid,qty]) => {
        const isExtra = pid.startsWith('extra_')
        const b = isExtra ? null : criarBreads.find(x=>x.id===pid)
        const name = isExtra ? criarExtras[pid] : (b?.name||pid)
        const price = isExtra ? 0 : (prices[pid+'_'+criarDestId]||0)
        return { romaneio_id:romId, product_id:pid, product_source:isExtra?'extra':'bread', product_name:name, qty_sent:qty, unit_price:price, item_status:'pendente' }
      })
      try {
        await sbPost('romaneio_items', itemRows)
      } catch(itemErr) {
        try { await sbDel('romaneios',{id:romId}) } catch(_) {}
        throw itemErr
      }
      showToast('✅ Romaneio criado!')
      await loadPainel()
      setScreen('painel')
    } catch(e:any) {
      const msg = e.message||'Erro desconhecido'
      showToast('❌ Erro: '+(msg.length>100?msg.slice(0,100)+'...':msg), 5000)
    } finally { hideLoad() }
  }

  // ── envio ──────────────────────────────────────────────────────
  const confirmEnvio = async () => {
    if (!envioRomId) return
    const romId = envioRomId
    setEnvioRomId(null)
    showLoad('Confirmando envio...')
    try {
      const sentBy = role === 'cleo' ? 'Cléo' : 'Gustavo'
      await sbPatch('romaneios', { status: 'enviado', sent_by: sentBy, sent_at: new Date().toISOString() }, { id: romId })

      // Gera movimentações de estoque: -N em 'central', +N no destino.
      // Idempotente: se já existirem movements pra esse romaneio, pula (evita duplicata em re-envio).
      try {
        const existing = await sbGet('bread_movements', `reference_id=eq.${romId}&reference_type=eq.romaneio&select=id&limit=1`)
        if (!existing || existing.length === 0) {
          const [items, romData] = await Promise.all([
            sbGet('romaneio_items', `romaneio_id=eq.${romId}&product_source=eq.bread&qty_sent=gt.0&select=product_id,qty_sent`),
            sbGet('romaneios', `id=eq.${romId}&select=destination_id,destinations(code)`),
          ])
          const destCode: string | undefined = romData?.[0]?.destinations?.code
          if (destCode && items && items.length > 0) {
            const destLoc = destCode.toLowerCase()
            const movements: any[] = []
            items.forEach((it: any) => {
              const q = Number(it.qty_sent) || 0
              if (q <= 0) return
              movements.push(
                { movement_type: 'romaneio_envio', bread_id: it.product_id, location: 'central', quantity: -q, reference_id: romId, reference_type: 'romaneio', recorded_by: sentBy },
                { movement_type: 'romaneio_envio', bread_id: it.product_id, location: destLoc,   quantity:  q, reference_id: romId, reference_type: 'romaneio', recorded_by: sentBy },
              )
            })
            if (movements.length > 0) {
              await fetch(`${SB_URL}/rest/v1/bread_movements`, {
                method: 'POST',
                headers: { ...H, Prefer: 'return=minimal' },
                body: JSON.stringify(movements),
              })
            }
          }
        }
      } catch (movErr) {
        // Movimentações falharam mas o status já foi atualizado. Loga e segue —
        // melhor o romaneio ficar marcado como enviado do que travar a UI.
        // Retry manual via SQL se precisar.
        console.error('[romaneio] erro ao gerar bread_movements:', movErr)
      }

      showToast('✅ Romaneio marcado como enviado!')
      await loadPainel()
    } catch(e) { showToast('❌ Erro') }
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
    } catch(e) { showToast('Erro ao carregar') }
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
    showLoad('Salvando conferência...')
    try {
      let hasDiverg = false
      for (const it of confItems) {
        const cd = confData[it.id]
        if (!cd) continue
        const isDiverg = cd.rec!==it.qty_sent || cd.acc!==cd.rec
        if (isDiverg) hasDiverg = true
        const motivo = cd.refused ? ('Recusado: '+cd.refuseReason) : cd.motivo
        await sbPatch('romaneio_items',{
          qty_received:cd.rec, qty_accepted:cd.acc,
          divergence_reason:motivo||null, obs:cd.itemObs||null,
          item_status:isDiverg?'divergencia':'ok'
        },{id:it.id})
      }
      await sbPatch('romaneios',{
        status:hasDiverg?'com_divergencia':'conferido',
        confirmed_by:'Marselle', confirmed_at:new Date().toISOString()
      },{id:confRomId})
      showToast(hasDiverg?'⚠️ Conferência salva com divergência':'✅ Conferência confirmada!')
      await loadPainel()
      setScreen('painel')
    } catch(e) { showToast('❌ Erro ao salvar') }
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
      showToast('🗑 Deletado')
      await loadAdminPainel()
    } catch(e) { showToast('❌ Erro') }
    finally { hideLoad() }
  }

  const aprovarDiverg = async (romId: string) => {
    showLoad('Aprovando...')
    try {
      const items = await sbGet('romaneio_items',`romaneio_id=eq.${romId}&item_status=eq.divergencia`)
      for (const it of items) await sbPatch('romaneio_items',{item_status:'aprovado'},{id:it.id})
      await sbPatch('romaneios',{status:'aprovado'},{id:romId})
      showToast('✅ Divergências aprovadas')
      await loadPainel()
      setScreen('painel')
    } catch(e) { showToast('❌ Erro') }
    finally { hideLoad() }
  }

  const aprovarItem = async (itemId: string) => {
    showLoad('Aprovando...')
    try {
      await sbPatch('romaneio_items',{item_status:'aprovado'},{id:itemId})
      showToast('✅ Item aprovado')
      await loadDiverg()
    } catch(e) { showToast('❌ Erro') }
    finally { hideLoad() }
  }

  const calcFechamento = async () => {
    showLoad('Calculando...')
    try {
      const exDest = dests.find(d=>d.code==='EX')
      if (!exDest) { showToast('EX não encontrado'); return }
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
      setFechSummary(`${roms.length} romaneios · ${fmtDate(fechFrom)} a ${fmtDate(fechTo)}`)
    } catch(e) { showToast('Erro ao calcular') }
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
      showToast('✅ Preços salvos!')
    } catch(e) { showToast('❌ Erro') }
    finally { hideLoad() }
  }

  // ── derived ──────────────────────────────────────────────────────
  const criarTotalItems = Object.values(criarQtys).filter(v=>v>0).length
  const criarTotalQty = Object.values(criarQtys).reduce((a,c)=>a+c,0)

  const ordinals = ['1ª','2ª','3ª','4ª','5ª']

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div>
      {/* TOAST */}
      <div id="rom-toast" className="toast"/>
      {/* LOADING */}
      {loading && <div className="loading-overlay" style={{display:'flex'}}><div className="spinner"/><p>{loadingMsg}</p></div>}

      {/* ADMIN PASS MODAL */}
      {showPassModal && (
        <div className="modal-overlay open" onClick={e=>{if(e.target===e.currentTarget){setShowPassModal(false)}}}>
          <div className="modal-sheet">
            <div className="modal-handle"/>
            <div style={{padding:'20px 16px'}}>
              <h3 style={{marginBottom:16}}>Acesso Administrativo</h3>
              <input className="obs-area" style={{minHeight:'auto',padding:'8px 12px',marginBottom:14}} type="password"
                placeholder="Senha..." value={passInput} onChange={e=>setPassInput(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&checkPass()}/>
              <div style={{display:'flex',gap:10}}>
                <button className="btn-save" onClick={checkPass}>Entrar</button>
                <button className="btn-action" onClick={()=>setShowPassModal(false)}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ENVIO CONFIRM MODAL */}
      {envioRomId && (
        <div className="modal-overlay open" onClick={e=>{if(e.target===e.currentTarget)setEnvioRomId(null)}}>
          <div className="modal-sheet">
            <div className="modal-handle"/>
            <div style={{padding:'20px 16px'}}>
              <h3 style={{marginBottom:12}}>Confirmar Envio</h3>
              <p style={{color:'var(--text-muted)',fontSize:14,marginBottom:20}}>Confirmar que o romaneio foi enviado para a loja?</p>
              <div style={{display:'flex',gap:10}}>
                <button className="btn-save" onClick={confirmEnvio}>Confirmar Envio ✓</button>
                <button className="btn-action" onClick={()=>setEnvioRomId(null)}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── INIT / LOGIN (auto-resolvido via PIN global; seletor interno removido) ── */}
      {(screen==='init' || screen==='login') && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--muted)' }}>
          <p>Carregando...</p>
        </div>
      )}

      {/* ── PAINEL ── */}
      {screen==='painel' && (
        <div id="app">
          <div className="topbar">
            <div className="topbar-logo" onClick={goHome} style={{cursor:'pointer'}}>Pane &amp; Salute</div>
            <span className={`topbar-badge ${role==='gustavo'?'tb-amber':role==='cleo'?'tb-teal':role==='marselle'?'tb-coral':'tb-gray'}`}>
              {(getCurrentUser()?.displayName) || 'Rodrigo'}{role==='marselle' ? ' / EX' : ''}
            </span>
            <button className="btn-logout" onClick={goHome}>Sair</button>
          </div>
          <div style={{padding:'16px'}}>
            {role==='gustavo' && (
              <button className="btn-save" style={{width:'100%',marginBottom:16,padding:'12px'}} onClick={openCriar}>
                + Novo Romaneio
              </button>
            )}
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
              <div className="section-label" style={{margin:0}}>Hoje — {fmtDate(todayKey())}</div>
              <button className="btn-action" style={{fontSize:12,padding:'4px 10px'}} onClick={refreshPainel}>↻ Atualizar</button>
            </div>
            {romaneios.length===0 ? (
              <div style={{textAlign:'center',padding:'40px 20px',color:'var(--text-muted)'}}>
                <div style={{fontSize:48,marginBottom:12}}>📦</div>
                <div>Nenhum romaneio hoje.</div>
              </div>
            ) : romaneios.map(r=>(
              <div key={r.id} className="card" style={{marginBottom:12}}>
                <div className="card-header">
                  <div>
                    <div className="card-title">{r.destinations?.name} — Viagem {r.trip_number}</div>
                    <div className="card-meta">
                      Criado por {r.created_by}
                      {r.sent_at&&` · Saiu ${fmtDateTime(r.sent_at)}`}
                      {r.confirmed_at&&` · Conf. ${fmtDateTime(r.confirmed_at)}`}
                    </div>
                  </div>
                  <span className={`status s-${r.status}`}>{statusLabel(r.status)}</span>
                </div>
                {r.obs&&<div style={{fontSize:12,color:'var(--text-muted)',marginBottom:8}}>{r.obs}</div>}
                <div className="card-actions">
                  <button className="btn btn-secondary btn-sm" onClick={()=>openDetalhe(r.id)}>Ver itens</button>
                  {role==='cleo'&&r.status==='separado'&&(
                    <button className="btn btn-info btn-sm" onClick={()=>setEnvioRomId(r.id)}>Marcar Enviado ✓</button>
                  )}
                  {role==='marselle'&&r.status==='enviado'&&r.destinations?.code==='EX'&&(
                    <button className="btn btn-success btn-sm" onClick={()=>openConferencia(r.id)}>Conferir chegada</button>
                  )}
                  {role==='rodrigo'&&r.status==='com_divergencia'&&(
                    <button className="btn btn-success btn-sm" onClick={()=>aprovarDiverg(r.id)}>Aprovar diverg.</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── DETALHE ── */}
      {screen==='detalhe' && detailRom && (
        <div id="app">
          <div className="topbar">
            <div className="topbar-logo">Pane &amp; Salute</div>
            <span className={`status s-${detailRom.status}`}>{statusLabel(detailRom.status)}</span>
            <button className="btn-logout" onClick={()=>setScreen('painel')}>← Voltar</button>
          </div>
          <div style={{padding:'16px'}}>
            <div className="card" style={{marginBottom:16}}>
              <div className="card-title">{detailRom.destinations?.name} — Viagem {detailRom.trip_number}</div>
              <div className="card-meta">Data: {fmtDate(detailRom.record_date)} · Criado por: {detailRom.created_by}</div>
              {detailRom.sent_at&&<div className="card-meta">Enviado por {detailRom.sent_by} em {fmtDateTime(detailRom.sent_at)}</div>}
              {detailRom.confirmed_at&&<div className="card-meta">Conferido por {detailRom.confirmed_by} em {fmtDateTime(detailRom.confirmed_at)}</div>}
              {detailRom.obs&&<div style={{fontSize:12,color:'var(--text-muted)',marginTop:4}}>{detailRom.obs}</div>}
            </div>
            <div className="section-label">Itens</div>
            {detailItems.length===0&&<div style={{color:'var(--text-muted)',fontSize:13}}>Nenhum item.</div>}
            {detailItems.map(it=>(
              <div key={it.id} className="conf-row">
                <div className="conf-row-header">
                  <span style={{fontWeight:500}}>{it.product_name}</span>
                  <span className={`status s-${it.item_status||'pendente'}`}>{it.item_status||'pendente'}</span>
                </div>
                <div style={{fontSize:13,color:'var(--text-muted)',display:'flex',gap:16,flexWrap:'wrap'}}>
                  <span>Enviado: <strong>{it.qty_sent}</strong></span>
                  {it.qty_received!=null&&<span>Recebido: <strong>{it.qty_received}</strong></span>}
                  {it.qty_accepted!=null&&<span>Aceito: <strong>{it.qty_accepted}</strong></span>}
                  {it.unit_price!=null&&it.unit_price>0&&<span>R$ {Number(it.unit_price).toFixed(2)}/un</span>}
                </div>
                {it.divergence_reason&&<div style={{fontSize:12,color:'var(--red)',marginTop:4}}>Divergência: {it.divergence_reason}</div>}
                {it.obs&&<div style={{fontSize:12,color:'var(--text-muted)',marginTop:2}}>{it.obs}</div>}
              </div>
            ))}
            {role==='rodrigo'&&detailRom.status==='com_divergencia'&&(
              <div style={{marginTop:16}}>
                <button className="btn-save" style={{width:'100%'}} onClick={()=>aprovarDiverg(detailRom.id)}>Aprovar divergências ✓</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── CRIAR ── */}
      {screen==='criar' && (
        <div id="app">
          <div className="topbar">
            <div className="topbar-logo">Pane &amp; Salute</div>
            <span className="topbar-badge tb-amber">Gustavo</span>
            <button className="btn-logout" onClick={()=>setScreen('painel')}>← Voltar</button>
          </div>
          <div style={{padding:'16px'}}>
            <div className="section-label" style={{marginTop:0}}>Data</div>
            <input type="date" value={criarDate} className="obs-area" style={{minHeight:'auto',padding:'8px 12px',marginBottom:14}}
              onChange={e=>{ setCriarDate(e.target.value); if(criarDestId) onDestChange(criarDestId) }}/>

            <div className="section-label">Destino</div>
            <select className="obs-area" style={{minHeight:'auto',padding:'8px 12px',marginBottom:14}}
              value={criarDestId} onChange={e=>onDestChange(e.target.value)}>
              <option value="">Selecione o destino...</option>
              {dests.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
            </select>

            {criarDestId && (
              <div style={{background:'var(--teal-bg)',border:'1px solid var(--teal-border)',borderRadius:'var(--radius-sm)',padding:'8px 12px',marginBottom:14,fontSize:13,color:'var(--teal)'}}>
                {ordinals[criarTrip-1]||criarTrip+'ª'} viagem para este destino
              </div>
            )}

            {criarBreads.length > 0 && (
              <>
                <div className="section-label">Produtos</div>
                <div className="bread-list">
                  {criarBreads.map(b=>{
                    const qty = criarQtys[b.id]||0
                    return (
                      <div key={b.id} className={`bread-row${qty>0?' has-qty':''}`}>
                        <div className="bread-info"><div className="bread-name">{b.name}</div></div>
                        <div className="qty-wrap">
                          <button className="qty-btn" onClick={()=>criarChangeQty(b.id,-1)}>−</button>
                          <input className="qty-input" type="number" min={0} value={qty||''} placeholder="0"
                            onChange={e=>setCriarQtys(prev=>({...prev,[b.id]:parseInt(e.target.value)||0}))}/>
                          <button className="qty-btn" onClick={()=>criarChangeQty(b.id,1)}>+</button>
                        </div>
                      </div>
                    )
                  })}
                  {/* Extras */}
                  {Object.entries(criarExtras).map(([eid,name])=>{
                    const qty = criarQtys[eid]||0
                    return (
                      <div key={eid} className={`bread-row${qty>0?' has-qty':''}`}>
                        <div className="bread-info">
                          <div className="bread-name" style={{color:'var(--amber)',fontStyle:'italic'}}>{name} <span style={{fontSize:11,color:'var(--text-hint)'}}>(especial)</span></div>
                        </div>
                        <div className="qty-wrap">
                          <button className="qty-btn" onClick={()=>criarChangeQty(eid,-1)}>−</button>
                          <input className="qty-input" type="number" min={0} value={qty||''} placeholder="0"
                            onChange={e=>setCriarQtys(prev=>({...prev,[eid]:parseInt(e.target.value)||0}))}/>
                          <button className="qty-btn" onClick={()=>criarChangeQty(eid,1)}>+</button>
                          <button onClick={()=>removeExtra(eid)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-hint)',fontSize:16}}>✕</button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Add extra */}
                <div style={{marginTop:14,paddingTop:12,borderTop:'1px dashed var(--border)'}}>
                  <div className="section-label" style={{marginTop:0}}>+ Pão especial / avulso</div>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <input className="obs-area" style={{minHeight:'auto',padding:'8px 12px',flex:1,fontSize:13}}
                      placeholder="Nome do pão..." value={criarExtraInput}
                      onChange={e=>setCriarExtraInput(e.target.value)}
                      onKeyDown={e=>e.key==='Enter'&&addExtra()}/>
                    <button className="btn-action" style={{padding:'8px 14px',whiteSpace:'nowrap'}} onClick={addExtra}>Adicionar</button>
                  </div>
                </div>

                <div style={{marginTop:14}}>
                  <div className="section-label" style={{marginTop:0}}>Observações</div>
                  <textarea className="obs-area" placeholder="Observações sobre o romaneio..." value={criarObs} onChange={e=>setCriarObs(e.target.value)}/>
                </div>

                <div style={{position:'sticky',bottom:70,background:'var(--surface)',borderTop:'1px solid var(--border)',padding:'12px 0',display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:16}}>
                  <div style={{fontSize:13,color:'var(--text-muted)'}}>
                    {criarTotalItems ? <><strong>{criarTotalItems}</strong> produtos · <strong>{criarTotalQty}</strong> un</> : 'Nenhum item'}
                  </div>
                  <button className="btn-save" onClick={saveRomaneio}>Criar Romaneio</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── CONFERENCIA ── */}
      {screen==='conferencia' && confRom && (
        <div id="app">
          <div className="topbar">
            <div className="topbar-logo">Pane &amp; Salute</div>
            <span className="topbar-badge tb-coral">Marselle / EX</span>
            <button className="btn-logout" onClick={()=>setScreen('painel')}>← Voltar</button>
          </div>
          <div style={{padding:'16px'}}>
            <div className="card" style={{marginBottom:16}}>
              <div className="card-title">{confRom.destinations?.name} — Viagem {confRom.trip_number}</div>
              <div className="card-meta">Enviado por {confRom.sent_by||'?'} em {fmtDateTime(confRom.sent_at)}</div>
            </div>
            <div className="section-label">Confirme o que chegou ({confItems.length} itens)</div>
            {confItems.map(it=>{
              const cd = confData[it.id]
              if (!cd) return null
              const hasDiverg = cd.rec!==it.qty_sent || cd.acc!==cd.rec
              return (
                <div key={it.id} className="conf-row">
                  <div className="conf-row-header">
                    <span style={{fontWeight:500}}>{it.product_name}</span>
                    <span style={{fontSize:13,color:'var(--text-muted)'}}>Enviado: <strong>{it.qty_sent}</strong></span>
                  </div>
                  {cd.refused ? (
                    <div style={{background:'var(--red-bg)',border:'1px solid var(--red-border)',borderRadius:'var(--radius-sm)',padding:10,marginTop:4}}>
                      <div style={{fontSize:13,fontWeight:600,color:'var(--red)',marginBottom:8}}>✕ Item recusado</div>
                      <input className="obs-area" style={{minHeight:'auto',padding:'8px 12px',marginBottom:8,borderColor:'var(--red)'}}
                        placeholder="Motivo da recusa (obrigatório)..."
                        value={cd.refuseReason} onChange={e=>updateConf(it.id,'refuseReason',e.target.value)}/>
                      <div style={{display:'flex',gap:8}}>
                        <button className="btn-save" style={{flex:1,background:'var(--red)',fontSize:13,padding:'8px'}} onClick={()=>{}}>Confirmar recusa</button>
                        <button className="btn-action" onClick={()=>desfazerRecusa(it.id,it.qty_sent)}>Desfazer</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{display:'flex',gap:12,marginTop:8,flexWrap:'wrap'}}>
                        <div style={{flex:1,minWidth:120}}>
                          <div style={{fontSize:11,color:'var(--text-hint)',marginBottom:4}}>Recebido</div>
                          <input className="qty-input" style={{width:'100%'}} type="number" min={0}
                            value={cd.rec} onChange={e=>updateConf(it.id,'rec',parseInt(e.target.value)||0)}/>
                        </div>
                        <div style={{flex:1,minWidth:120}}>
                          <div style={{fontSize:11,color:'var(--text-hint)',marginBottom:4}}>Aceito/Cobrável</div>
                          <input className="qty-input" style={{width:'100%'}} type="number" min={0}
                            value={cd.acc} onChange={e=>updateConf(it.id,'acc',parseInt(e.target.value)||0)}/>
                        </div>
                      </div>
                      {hasDiverg && (
                        <div style={{marginTop:8}}>
                          <select className="obs-area" style={{minHeight:'auto',padding:'8px 12px',marginBottom:6}}
                            value={cd.motivo} onChange={e=>updateConf(it.id,'motivo',e.target.value)}>
                            <option value="">Motivo da divergência...</option>
                            {['Veio menos','Veio mais','Quebrado','Queimado','Cru','Torto','Fora do padrão','Erro de lançamento','Outro'].map(m=>(
                              <option key={m}>{m}</option>
                            ))}
                          </select>
                          <input className="obs-area" style={{minHeight:'auto',padding:'8px 12px'}}
                            placeholder="Observação (opcional)"
                            value={cd.itemObs} onChange={e=>updateConf(it.id,'itemObs',e.target.value)}/>
                        </div>
                      )}
                      <button className="btn-action" style={{marginTop:8,width:'100%',color:'var(--red)',borderColor:'var(--red)'}} onClick={()=>recusarItem(it.id)}>
                        ✕ Recusar item
                      </button>
                    </>
                  )}
                </div>
              )
            })}
            <div style={{position:'sticky',bottom:70,background:'var(--surface)',borderTop:'1px solid var(--border)',padding:'12px 0',marginTop:16}}>
              <button className="btn-save" style={{width:'100%'}} onClick={saveConferencia}>Salvar Conferência ✓</button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADMIN ── */}
      {screen==='admin' && (
        <div id="app">
          <div className="topbar">
            <div className="topbar-logo">Pane &amp; Salute</div>
            <span className="topbar-badge tb-gray">Admin</span>
            <button className="btn-logout" onClick={goHome}>Sair</button>
          </div>
          <div className="nav-tabs">
            {([['painel-adm','Painel'],['divergencias','Divergências'],['fechamento','Fechamento'],['precos','Preços']] as const).map(([tab,label])=>(
              <button key={tab} className={`nav-tab${adminTab===tab?' active':''}`} onClick={async()=>{
                if(tab==='painel-adm'){showLoad('...');try{await loadAdminPainel()}catch(e){}finally{hideLoad();setAdminTab('painel-adm')}}
                else if(tab==='divergencias'){showLoad('...');try{await loadDiverg()}catch(e){}finally{hideLoad()}}
                else if(tab==='precos'){showLoad('...');try{await loadPrecos()}catch(e){}finally{hideLoad()}}
                else setAdminTab(tab)
              }}>{label}</button>
            ))}
          </div>
          <div style={{padding:'16px'}}>
            {/* Painel admin */}
            {adminTab==='painel-adm' && (
              <>
                <div className="section-label" style={{marginTop:0}}>Hoje — {fmtDate(todayKey())}</div>
                {adminRoms.length===0&&<div style={{textAlign:'center',padding:'40px 20px',color:'var(--text-muted)'}}><div style={{fontSize:48}}>📦</div><div>Nenhum romaneio hoje.</div></div>}
                {adminRoms.map(r=>(
                  <div key={r.id} className="card" style={{marginBottom:12}}>
                    <div className="card-header">
                      <div>
                        <div className="card-title">{r.destinations?.name} — Viagem {r.trip_number}</div>
                        <div className="card-meta">{r.created_by}{r.sent_at&&` · Saiu ${fmtDateTime(r.sent_at)}`}{r.confirmed_at&&` · Conf. ${fmtDateTime(r.confirmed_at)}`}</div>
                      </div>
                      <span className={`status s-${r.status}`}>{statusLabel(r.status)}</span>
                    </div>
                    <div className="card-actions">
                      <button className="btn btn-secondary btn-sm" onClick={()=>openDetalhe(r.id)}>Ver detalhes</button>
                      {r.status==='com_divergencia'&&<button className="btn btn-success btn-sm" onClick={()=>aprovarDiverg(r.id)}>Aprovar diverg.</button>}
                      <button className="btn btn-danger btn-sm" onClick={()=>deleteRomaneio(r.id)}>🗑</button>
                    </div>
                  </div>
                ))}
              </>
            )}
            {/* Divergências */}
            {adminTab==='divergencias' && (
              <>
                <div className="section-label" style={{marginTop:0}}>Divergências pendentes ({divergItems.length})</div>
                {divergItems.length===0&&<div style={{textAlign:'center',padding:'40px 20px',color:'var(--text-muted)'}}><div style={{fontSize:48}}>✅</div><div>Nenhuma divergência pendente.</div></div>}
                {divergItems.map((it:any)=>(
                  <div key={it.id} className="card" style={{marginBottom:12}}>
                    <div style={{fontWeight:500,marginBottom:4}}>{it.product_name}</div>
                    <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:8}}>{it.romaneios?.destinations?.name} — Viagem {it.romaneios?.trip_number} — {fmtDate(it.romaneios?.record_date)}</div>
                    <div style={{fontSize:13,marginBottom:8}}>
                      Enviado: <strong>{it.qty_sent}</strong> · Recebido: <strong>{it.qty_received??'?'}</strong> · Aceito: <strong>{it.qty_accepted??'?'}</strong>
                      {it.divergence_reason&&<><br/><span style={{color:'var(--red)'}}>Motivo: {it.divergence_reason}</span></>}
                    </div>
                    <div style={{display:'flex',gap:8}}>
                      <button className="btn btn-success btn-sm" onClick={()=>aprovarItem(it.id)}>Aprovar</button>
                    </div>
                  </div>
                ))}
              </>
            )}
            {/* Fechamento */}
            {adminTab==='fechamento' && (
              <>
                <div className="section-label" style={{marginTop:0}}>Fechamento EX</div>
                <div style={{display:'flex',gap:10,marginBottom:16,flexWrap:'wrap'}}>
                  <div style={{flex:1,minWidth:130}}>
                    <div style={{fontSize:11,color:'var(--text-hint)',marginBottom:4}}>De</div>
                    <input type="date" value={fechFrom} className="obs-area" style={{minHeight:'auto',padding:'8px 12px'}} onChange={e=>setFechFrom(e.target.value)}/>
                  </div>
                  <div style={{flex:1,minWidth:130}}>
                    <div style={{fontSize:11,color:'var(--text-hint)',marginBottom:4}}>Até</div>
                    <input type="date" value={fechTo} className="obs-area" style={{minHeight:'auto',padding:'8px 12px'}} onChange={e=>setFechTo(e.target.value)}/>
                  </div>
                </div>
                <button className="btn-save" onClick={calcFechamento} style={{marginBottom:16}}>Calcular</button>
                {fechResult===null && <div style={{color:'var(--text-muted)',fontSize:13}}>Selecione o período e clique em Calcular.</div>}
                {fechResult!==null && fechResult.length===0 && <div style={{color:'var(--text-muted)',fontSize:13}}>{fechSummary||'Nenhum romaneio no período.'}</div>}
                {fechResult!==null && fechResult.length>0 && (
                  <>
                    <div style={{fontSize:13,color:'var(--text-muted)',marginBottom:12}}>{fechSummary}</div>
                    <table className="report-table">
                      <thead><tr><th>Produto</th><th className="num">Enviado</th><th className="num">Aceito</th><th className="num">Preço</th><th className="num">Total</th></tr></thead>
                      <tbody>
                        {fechResult.map((r:any,i:number)=>(
                          <tr key={i}><td>{r.name}</td><td className="num">{r.sent}</td><td className="num">{r.accepted}</td>
                            <td className="num">{r.price?`R$ ${Number(r.price).toFixed(2)}`:'—'}</td>
                            <td className="num">{r.price?`R$ ${(r.accepted*r.price).toFixed(2)}`:'—'}</td>
                          </tr>
                        ))}
                        <tr>
                          <td><strong>TOTAL</strong></td>
                          <td className="num"><strong>{fechResult.reduce((a:number,r:any)=>a+r.sent,0)}</strong></td>
                          <td className="num"><strong>{fechResult.reduce((a:number,r:any)=>a+r.accepted,0)}</strong></td>
                          <td/>
                          <td className="num"><strong>R$ {fechResult.reduce((a:number,r:any)=>a+(r.accepted*(r.price||0)),0).toFixed(2)}</strong></td>
                        </tr>
                      </tbody>
                    </table>
                  </>
                )}
              </>
            )}
            {/* Preços */}
            {adminTab==='precos' && (
              <>
                <div className="section-label" style={{marginTop:0}}>Preços EX por produto</div>
                <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:12}}>Valores que a EX paga por unidade. Usados no fechamento semanal.</div>
                {breads.map(b=>(
                  <div key={b.id} className="bread-row" style={{marginBottom:6}}>
                    <div className="bread-info"><div className="bread-name">{b.name}</div></div>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <span style={{fontSize:12,color:'var(--text-muted)'}}>R$</span>
                      <input className="qty-input" style={{width:80}} type="number" min={0} step={0.01} placeholder="0,00"
                        value={prodPrices[b.id]||''} onChange={e=>setProdPrices(prev=>({...prev,[b.id]:e.target.value}))}/>
                    </div>
                  </div>
                ))}
                <button className="btn-save" style={{marginTop:16,width:'100%'}} onClick={savePrecos}>Salvar preços</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
