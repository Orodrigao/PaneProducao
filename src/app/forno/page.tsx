'use client'
import { useState, useEffect, useCallback } from 'react'
import { Minus, Plus, Save, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, roleColor, type Role } from '@/lib/auth'
import { showToast } from '@/lib/utils'

interface Bread {
  id: string
  name: string
  unit: string | null
  is_pj: boolean
  active: boolean
}

interface FormState {
  baked: string
  loss: string
  lossReason: string
  obs: string
}

const LOSS_REASONS = ['Queimou', 'Fora do padrão', 'Outros']

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function dateKeyOffset(daysBack: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysBack)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function formatDateBR(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function formatDayShort(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

export default function FornoPage() {
  const [date, setDate] = useState(todayKey())
  const [breads, setBreads] = useState<Bread[]>([])
  const [plannedMap, setPlannedMap] = useState<Map<string, number>>(new Map())
  const [pjMap, setPjMap]           = useState<Map<string, number>>(new Map())  // qtd PJ por bread_id
  const [pjOrderCount, setPjOrderCount] = useState(0)  // qtd de pedidos PJ no dia
  const [encMap, setEncMap]         = useState<Map<string, number>>(new Map())  // qtd encomendas por bread_id
  const [encOrderCount, setEncOrderCount] = useState(0)
  const [forms, setForms] = useState<Record<string, FormState>>({})
  const [expandedDescarte, setExpandedDescarte] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [user, setUser] = useState<{ id: string; displayName: string; role: Role } | null>(null)

  useEffect(() => {
    const u = getCurrentUser()
    if (u) setUser({ id: u.id, displayName: u.displayName, role: u.role })
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [resLojas, resPj, resEnc, resActuals] = await Promise.all([
        // Pedidos das lojas: store != 'pj' e != 'encomenda' + order_date = date
        supabase.from('orders').select('bread_id, quantity').not('store', 'in', '("pj","encomenda")').eq('order_date', date).gt('quantity', 0),
        // TODOS pedidos PJ — filtra JS por production_date (novos) OU pj_delivery_date (legados)
        supabase.from('orders').select('id, bread_id, quantity, production_date, pj_delivery_date').eq('store', 'pj').gt('quantity', 0),
        // Encomendas — só product_source='bread' entra no forno (products não passam por aqui)
        supabase.from('orders').select('id, bread_id, quantity, product_source').eq('order_type', 'encomenda').eq('production_date', date).gt('quantity', 0),
        supabase.from('production_actuals').select('*').eq('record_date', date),
      ])

      // PJ filtrado pela data correta:
      //   - se tem production_date: usa ele (pedido novo do /pedidos-pj)
      //   - senão: cai no pj_delivery_date (pedidos legados feitos em /)
      const pjRowsFiltered = (resPj.data || []).filter((o: any) =>
        o.production_date ? o.production_date === date : o.pj_delivery_date === date
      )
      const pjOrderIds = new Set(pjRowsFiltered.map((r: any) => r.id))

      // Encomendas: só linhas com produto que existe em breads (product_source='bread')
      const encRows = (resEnc.data || []).filter((o: any) => o.product_source === 'bread')

      const lojasRows = resLojas.data || []
      const ordersAll = [...lojasRows, ...pjRowsFiltered, ...encRows]
      const breadIds = Array.from(new Set(ordersAll.map((o: any) => o.bread_id)))

      if (breadIds.length === 0) {
        setBreads([]); setPlannedMap(new Map()); setPjMap(new Map()); setPjOrderCount(0)
        setEncMap(new Map()); setEncOrderCount(0)
        setForms({}); setExpandedDescarte({})
        setLoading(false)
        return
      }

      const { data: breadsData } = await supabase
        .from('breads').select('*').in('id', breadIds).eq('active', true)

      const sortedBreads = (breadsData || []).sort((a: Bread, b: Bread) => {
        if (a.is_pj !== b.is_pj) return a.is_pj ? 1 : -1 // regulares primeiro
        return a.name.localeCompare(b.name)
      })
      setBreads(sortedBreads)

      const planned = new Map<string, number>()
      const pj      = new Map<string, number>()
      const enc     = new Map<string, number>()
      ordersAll.forEach((o: any) => {
        planned.set(o.bread_id, (planned.get(o.bread_id) || 0) + Number(o.quantity))
      })
      pjRowsFiltered.forEach((o: any) => {
        pj.set(o.bread_id, (pj.get(o.bread_id) || 0) + Number(o.quantity))
      })
      encRows.forEach((o: any) => {
        enc.set(o.bread_id, (enc.get(o.bread_id) || 0) + Number(o.quantity))
      })
      setPlannedMap(planned)
      setPjMap(pj)
      setPjOrderCount(pjOrderIds.size)
      setEncMap(enc)
      setEncOrderCount(encRows.length)

      const initial: Record<string, FormState> = {}
      const expanded: Record<string, boolean> = {}
      sortedBreads.forEach((b: Bread) => {
        const existing = (resActuals.data || []).find((x: any) => x.bread_id === b.id)
        if (existing) {
          initial[b.id] = {
            baked: String(existing.quantity_baked || 0),
            loss: String(existing.quantity_loss || 0),
            lossReason: existing.loss_reason || LOSS_REASONS[0],
            obs: existing.obs || '',
          }
          if (Number(existing.quantity_loss) > 0) expanded[b.id] = true
        } else {
          initial[b.id] = {
            baked: String(planned.get(b.id) || 0),
            loss: '0',
            lossReason: LOSS_REASONS[0],
            obs: '',
          }
        }
      })
      setForms(initial)
      setExpandedDescarte(expanded)
      setLoading(false)
    } catch (e: any) {
      showToast('Erro ao carregar: ' + e.message)
      setLoading(false)
    }
  }, [date])

  useEffect(() => { loadData() }, [loadData])

  function updateForm(breadId: string, patch: Partial<FormState>) {
    setForms(prev => ({ ...prev, [breadId]: { ...prev[breadId], ...patch } }))
  }

  function adjustField(breadId: string, field: 'baked' | 'loss', delta: number) {
    const current = Number(forms[breadId]?.[field] || 0)
    const next = Math.max(0, current + delta)
    updateForm(breadId, { [field]: String(next) })
  }

  function toggleDescarte(breadId: string) {
    const wasExpanded = expandedDescarte[breadId]
    setExpandedDescarte(prev => ({ ...prev, [breadId]: !wasExpanded }))
    if (wasExpanded) {
      updateForm(breadId, { loss: '0', lossReason: LOSS_REASONS[0] })
    }
  }

  async function save() {
    if (!user) { showToast('Sem usuário'); return }
    setSaving(true)
    try {
      // 1. Idempotência — limpa registros antigos da data
      const { data: oldActuals } = await supabase
        .from('production_actuals').select('id').eq('record_date', date)
      const oldIds = (oldActuals || []).map((x: any) => x.id)
      if (oldIds.length > 0) {
        await supabase.from('bread_movements')
          .delete()
          .in('reference_id', oldIds)
          .eq('reference_type', 'production_actual')
        await supabase.from('production_actuals').delete().eq('record_date', date)
      }

      // 2. Monta inserts
      const recordedBy = user.displayName || user.id
      const actualsToInsert: any[] = []
      for (const b of breads) {
        const f = forms[b.id]
        if (!f) continue
        const baked = Number(f.baked) || 0
        const loss = Number(f.loss) || 0
        if (baked === 0 && loss === 0) continue

        actualsToInsert.push({
          record_date: date,
          bread_id: b.id,
          quantity_baked: baked,
          quantity_loss: loss,
          loss_reason: loss > 0 ? (f.lossReason || LOSS_REASONS[0]) : null,
          recorded_by: recordedBy,
          obs: f.obs || null,
        })
      }

      if (actualsToInsert.length === 0) {
        showToast('Nenhuma produção para salvar')
        setSaving(false)
        return
      }

      const { data: inserted, error: actualsErr } = await supabase
        .from('production_actuals')
        .insert(actualsToInsert)
        .select('id, bread_id, quantity_baked, quantity_loss, loss_reason')

      if (actualsErr) throw actualsErr

      // 3. Cria movements correspondentes
      const movementsToInsert: any[] = []
      ;(inserted || []).forEach((a: any) => {
        if (Number(a.quantity_baked) > 0) {
          movementsToInsert.push({
            movement_type: 'forno_entrada',
            bread_id: a.bread_id,
            location: 'central',
            quantity: Number(a.quantity_baked),
            reference_id: a.id,
            reference_type: 'production_actual',
            recorded_by: recordedBy,
          })
        }
        if (Number(a.quantity_loss) > 0) {
          movementsToInsert.push({
            movement_type: 'forno_descarte',
            bread_id: a.bread_id,
            location: 'central',
            quantity: -Number(a.quantity_loss),
            reference_id: a.id,
            reference_type: 'production_actual',
            recorded_by: recordedBy,
            obs: a.loss_reason,
          })
        }
      })

      if (movementsToInsert.length > 0) {
        const { error: movErr } = await supabase.from('bread_movements').insert(movementsToInsert)
        if (movErr) throw movErr
      }

      showToast('✅ Produção salva')
      loadData()
    } catch (e: any) {
      showToast('Erro: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const dateOptions = Array.from({ length: 8 }, (_, i) => dateKeyOffset(i))
  const totalBaked = breads.reduce((s, b) => s + (Number(forms[b.id]?.baked) || 0), 0)
  const totalLoss  = breads.reduce((s, b) => s + (Number(forms[b.id]?.loss) || 0), 0)
  const userInitial = user ? user.displayName.trim().charAt(0).toUpperCase() : ''
  const avatarColor = user ? roleColor(user.role) : 'var(--crust)'

  if (loading) return (
    <div className="ps-loading">
      <div className="ps-spinner" />
      <p>Carregando...</p>
    </div>
  )

  return (
    <div className="ps-canvas">
      <div className="ps-shell ps-fadein">
        <header className="ps-header">
          <div className="ps-wordmark">
            <div className="ps-mark">P</div>
            <div className="ps-brand"><b>Pane &amp; Salute</b><span>Forno</span></div>
          </div>
          {user && (
            <div className="ps-userwrap">
              <div className="ps-userchip">
                <div className="ps-avatar" style={{ background: avatarColor }}>{userInitial}</div>
                <b>{user.displayName}</b>
              </div>
            </div>
          )}
        </header>

        <div className="ps-pad" style={{ paddingBottom: 176 }}>
          <p className="ps-forno-intro">
            Confirme o que foi assado e registre descartes do dia. Alimenta o estoque central de pães.
          </p>

          <div className="ps-label">Dia</div>
          <div className="ps-days" role="group">
            {dateOptions.map((d, i) => (
              <button key={d} className="ps-day" aria-pressed={d === date} onClick={() => setDate(d)}>
                {i === 0 ? 'Hoje' : i === 1 ? 'Ontem' : formatDayShort(d)}
              </button>
            ))}
          </div>

          {pjOrderCount > 0 && (
            <div className="ps-banner honey">
              <span>🧾 {pjOrderCount} pedido(s) PJ produzindo neste dia</span>
              <a href="/pedidos-pj">Ver detalhes →</a>
            </div>
          )}
          {encOrderCount > 0 && (
            <div className="ps-banner crust">
              <span>🎂 {encOrderCount} encomenda(s) produzindo neste dia</span>
              <a href="/encomendas">Ver detalhes →</a>
            </div>
          )}

          {breads.length === 0 ? (
            <div className="ps-empty">Nenhum pão com pedido para {formatDateBR(date)}.</div>
          ) : (
            <>
              <div className="ps-section">
                <div className="bar" />
                <b>Confirmar produção</b>
                <span className="meta">{breads.length} {breads.length === 1 ? 'pão' : 'pães'}</span>
              </div>

              <div className="ps-grid">
                {breads.map(b => {
                  const f = forms[b.id]
                  const planned = plannedMap.get(b.id) || 0
                  const pjQty  = pjMap.get(b.id) || 0
                  const encQty = encMap.get(b.id) || 0
                  const lojaQty = planned - pjQty - encQty
                  const isExpanded = expandedDescarte[b.id]
                  // Só mostra breakdown quando misto (2+ fontes contribuem)
                  const breakdownParts: string[] = []
                  if (lojaQty > 0) breakdownParts.push(`${lojaQty} lojas`)
                  if (pjQty > 0)   breakdownParts.push(`${pjQty} PJ`)
                  if (encQty > 0)  breakdownParts.push(`${encQty} encomenda${encQty > 1 ? 's' : ''}`)
                  const bakedNum = Number(f?.baked) || 0
                  const lossNum  = Number(f?.loss) || 0

                  return (
                    <div key={b.id} className="ps-card">
                      <div className="ps-card-head" style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                        <div className="ps-pname">
                          {b.name}
                          {b.is_pj && <span className="ps-pjbadge">PJ</span>}
                        </div>
                        <div className="ps-card-meta">
                          Planejado <b>{planned}</b>
                          {breakdownParts.length > 1 && <small>{breakdownParts.join(' + ')}</small>}
                        </div>
                      </div>

                      <div>
                        <div className="ps-flabel">Assado</div>
                        <div className="ps-stepper">
                          <button className="ps-step" onClick={() => adjustField(b.id, 'baked', -1)} disabled={bakedNum <= 0} aria-label="Diminuir"><Minus size={20} strokeWidth={1.85} /></button>
                          <input className={'ps-qty' + (bakedNum === 0 ? ' zero' : '')} type="number" inputMode="numeric" min={0}
                            value={f?.baked ?? '0'} onChange={e => updateForm(b.id, { baked: e.target.value })} />
                          <button className="ps-step" onClick={() => adjustField(b.id, 'baked', 1)} aria-label="Aumentar"><Plus size={20} strokeWidth={1.85} /></button>
                        </div>
                      </div>

                      {!isExpanded ? (
                        <button className="ps-discard-btn" onClick={() => toggleDescarte(b.id)}>
                          <Trash2 size={14} strokeWidth={2} style={{ verticalAlign: '-2px', marginRight: 5 }} />
                          Registrar descarte
                        </button>
                      ) : (
                        <div className="ps-discard">
                          <div className="ps-flabel">Descarte</div>
                          <div className="ps-stepper">
                            <button className="ps-step" onClick={() => adjustField(b.id, 'loss', -1)} disabled={lossNum <= 0} aria-label="Diminuir"><Minus size={20} strokeWidth={1.85} /></button>
                            <input className={'ps-qty' + (lossNum === 0 ? ' zero' : '')} type="number" inputMode="numeric" min={0}
                              value={f?.loss ?? '0'} onChange={e => updateForm(b.id, { loss: e.target.value })} />
                            <button className="ps-step" onClick={() => adjustField(b.id, 'loss', 1)} aria-label="Aumentar"><Plus size={20} strokeWidth={1.85} /></button>
                          </div>
                          <select className="ps-select" value={f?.lossReason || LOSS_REASONS[0]} onChange={e => updateForm(b.id, { lossReason: e.target.value })}>
                            {LOSS_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                          <button className="ps-discard-cancel" onClick={() => toggleDescarte(b.id)}>✕ Cancelar descarte</button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {breads.length > 0 && (
          <div className="ps-totalbar">
            <div className="ps-total-num">
              <b>{totalBaked}</b>
              <span>{totalLoss > 0 ? `assados · ${totalLoss} descarte` : 'assados'}</span>
            </div>
            <button className="ps-save" onClick={save} disabled={saving}>
              <Save size={18} strokeWidth={2} />
              {saving ? 'Salvando...' : 'Salvar produção'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
