'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser } from '@/lib/auth'
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
  const [user, setUser] = useState<{ id: string; displayName: string } | null>(null)

  useEffect(() => {
    const u = getCurrentUser()
    if (u) setUser({ id: u.id, displayName: u.displayName })
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

  if (loading) return (
    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
      <p>Carregando...</p>
    </div>
  )

  return (
    <div style={{ padding: '20px', maxWidth: '700px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700 }}>🔥 Forno</h1>
        {user && (
          <span style={{ background: '#fef3c7', padding: '4px 12px', borderRadius: 12, fontSize: '0.78rem', fontWeight: 600, color: '#92400e' }}>
            {user.displayName}
          </span>
        )}
      </div>

      <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: '0.85rem' }}>
        Confirme o que foi assado e registre descartes do dia. Alimenta o estoque central de pães.
      </p>

      {/* Date picker */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ fontSize: '0.85rem', color: 'var(--muted)', fontWeight: 600 }}>Data:</label>
        <select value={date} onChange={e => setDate(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.85rem' }}>
          {dateOptions.map((d, i) => (
            <option key={d} value={d}>
              {formatDateBR(d)}{i === 0 ? ' (hoje)' : i === 1 ? ' (ontem)' : ''}
            </option>
          ))}
        </select>
      </div>

      {pjOrderCount > 0 && (
        <div style={{ marginBottom: 12, padding: '10px 12px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, fontSize: '0.82rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          <span style={{ color: '#1e40af' }}>
            🧾 <strong>{pjOrderCount}</strong> pedido(s) PJ produzindo neste dia
          </span>
          <a href="/pedidos-pj" style={{ color: '#1e40af', fontSize: '0.78rem', fontWeight: 600, textDecoration: 'none' }}>
            Ver detalhes →
          </a>
        </div>
      )}

      {encOrderCount > 0 && (
        <div style={{ marginBottom: 12, padding: '10px 12px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, fontSize: '0.82rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          <span style={{ color: '#9a3412' }}>
            🎂 <strong>{encOrderCount}</strong> encomenda(s) produzindo neste dia
          </span>
          <a href="/encomendas" style={{ color: '#9a3412', fontSize: '0.78rem', fontWeight: 600, textDecoration: 'none' }}>
            Ver detalhes →
          </a>
        </div>
      )}

      {breads.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
          <p>Nenhum pão com pedido para {formatDateBR(date)}.</p>
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 12, fontSize: '0.85rem', color: 'var(--muted)' }}>
            {breads.length} {breads.length === 1 ? 'pão' : 'pães'} para confirmar
          </div>

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

            return (
              <div key={b.id} style={{
                background: 'white', borderRadius: 12, padding: 14,
                border: '1px solid var(--border)', marginBottom: 10,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                    {b.name}
                    {b.is_pj && (
                      <span style={{ marginLeft: 6, background: '#dbeafe', color: '#1e40af', padding: '2px 6px', borderRadius: 4, fontSize: '0.65rem', fontWeight: 700 }}>
                        PJ
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)', textAlign: 'right' }}>
                    Planejado: <strong style={{ color: 'var(--text)' }}>{planned}</strong>
                    {breakdownParts.length > 1 && (
                      <div style={{ fontSize: '0.68rem', marginTop: 2, color: 'var(--muted)' }}>
                        {breakdownParts.join(' + ')}
                      </div>
                    )}
                  </div>
                </div>

                {/* Assado */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--muted)', minWidth: 60 }}>Assado:</span>
                  <button onClick={() => adjustField(b.id, 'baked', -1)}
                    style={{ width: 32, height: 32, border: '1px solid var(--border)', borderRadius: 6, background: 'white', cursor: 'pointer', fontSize: '1rem' }}>−</button>
                  <input type="number" min="0" step="1"
                    value={f?.baked || '0'}
                    onChange={e => updateForm(b.id, { baked: e.target.value })}
                    style={{ width: 70, textAlign: 'center', padding: '6px', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: '0.95rem' }} />
                  <button onClick={() => adjustField(b.id, 'baked', 1)}
                    style={{ width: 32, height: 32, border: '1px solid var(--border)', borderRadius: 6, background: 'white', cursor: 'pointer', fontSize: '1rem' }}>+</button>
                </div>

                {/* Descarte */}
                {!isExpanded ? (
                  <button onClick={() => toggleDescarte(b.id)}
                    style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '0.78rem', padding: '4px 0', fontWeight: 600 }}>
                    + Registrar descarte
                  </button>
                ) : (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 8, marginTop: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.85rem', color: '#dc2626', minWidth: 60, fontWeight: 600 }}>Descarte:</span>
                      <button onClick={() => adjustField(b.id, 'loss', -1)}
                        style={{ width: 30, height: 30, border: '1px solid var(--border)', borderRadius: 6, background: 'white', cursor: 'pointer', fontSize: '0.95rem' }}>−</button>
                      <input type="number" min="0" step="1"
                        value={f?.loss || '0'}
                        onChange={e => updateForm(b.id, { loss: e.target.value })}
                        style={{ width: 60, textAlign: 'center', padding: '6px', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: '0.85rem' }} />
                      <button onClick={() => adjustField(b.id, 'loss', 1)}
                        style={{ width: 30, height: 30, border: '1px solid var(--border)', borderRadius: 6, background: 'white', cursor: 'pointer', fontSize: '0.95rem' }}>+</button>
                      <select value={f?.lossReason || LOSS_REASONS[0]} onChange={e => updateForm(b.id, { lossReason: e.target.value })}
                        style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.8rem', flex: 1, minWidth: 120 }}>
                        {LOSS_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <button onClick={() => toggleDescarte(b.id)}
                      style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.72rem', padding: '4px 0', marginTop: 4 }}>
                      ✕ Cancelar descarte
                    </button>
                  </div>
                )}
              </div>
            )
          })}

          <button onClick={save} disabled={saving}
            style={{
              width: '100%', padding: '14px', borderRadius: 8, border: 'none',
              background: saving ? '#a3a3a3' : 'var(--primary)', color: 'white',
              cursor: saving ? 'not-allowed' : 'pointer',
              fontSize: '1rem', fontWeight: 700, marginTop: 8,
            }}>
            {saving ? 'Salvando...' : '💾 Salvar produção do dia'}
          </button>
        </>
      )}
    </div>
  )
}
