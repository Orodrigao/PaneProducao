'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  CalendarCheck,
  Plus,
  RefreshCw,
  Save,
  Search,
} from 'lucide-react'
import { getCurrentUser, getCurrentUserAsync, roleColor, type AppUser } from '@/lib/auth'
import {
  PRODUCTION_PLAN_STATUS_LABELS,
  PRODUCTION_PLAN_STORES,
  calculateNewProductionQuantity,
  normalizePlannedQuantity,
  plannedBreadsForDate,
  statusAllowsDraftEditing,
  type PlanningBreadLite,
  type ProductionPlanStatus,
  type ProductionPlanStore,
} from '@/lib/productionPlanning'
import { supabase } from '@/lib/supabase'
import { formatDateBR, showToast as showToastPS, todayKey } from '@/lib/utils'

interface ProductionPlanRow {
  id: string
  production_date: string
  status: ProductionPlanStatus
  created_by_name: string | null
  reopened_reason: string | null
  created_at: string
  updated_at: string
}

interface ProductionPlanItemRow {
  id: string
  plan_id: string
  store: ProductionPlanStore
  bread_id: string
  planned_quantity: number
  frozen_quantity: number
  leftover_proposed_quantity: number
  leftover_confirmed_quantity: number | null
  is_extra: boolean
}

interface BreadRow extends PlanningBreadLite {
  days: number[]
}

type QuantityInputs = Record<string, number>

const STORE_LABEL: Record<ProductionPlanStore, string> = {
  jc: 'JC',
  ja: 'JA',
}

function itemKey(store: ProductionPlanStore, breadId: string) {
  return `${store}:${breadId}`
}

function dateLabel(dateKey: string) {
  return formatDateBR(dateKey)
}

export default function ProductionPlanningPage() {
  const router = useRouter()
  const [user, setUser] = useState<AppUser | null>(() => getCurrentUser())
  const [ready, setReady] = useState(false)
  const [date, setDate] = useState(todayKey())
  const [breads, setBreads] = useState<BreadRow[]>([])
  const [plan, setPlan] = useState<ProductionPlanRow | null>(null)
  const [items, setItems] = useState<ProductionPlanItemRow[]>([])
  const [quantities, setQuantities] = useState<QuantityInputs>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    let alive = true
    getCurrentUserAsync().then(current => {
      if (!alive) return
      setUser(current)
      setReady(true)
      if (!current || current.role !== 'admin') router.replace('/')
    })
    return () => { alive = false }
  }, [router])

  const loadBreads = useCallback(async () => {
    const { data, error: breadError } = await supabase
      .from('breads')
      .select('id,name,days,active,is_pj')
      .eq('active', true)
      .eq('is_pj', false)
      .order('name', { ascending: true })

    if (breadError) throw breadError
    setBreads((data ?? []) as BreadRow[])
  }, [])

  const loadPlan = useCallback(async (targetDate: string) => {
    setLoading(true)
    setError('')
    try {
      const { data: planData, error: planError } = await supabase
        .from('production_plans')
        .select('id,production_date,status,created_by_name,reopened_reason,created_at,updated_at')
        .eq('production_date', targetDate)
        .maybeSingle()

      if (planError) throw planError
      const loadedPlan = planData as ProductionPlanRow | null
      setPlan(loadedPlan)

      if (!loadedPlan) {
        setItems([])
        setQuantities({})
        return
      }

      const { data: itemData, error: itemError } = await supabase
        .from('production_plan_items')
        .select('id,plan_id,store,bread_id,planned_quantity,frozen_quantity,leftover_proposed_quantity,leftover_confirmed_quantity,is_extra')
        .eq('plan_id', loadedPlan.id)
        .order('store', { ascending: true })

      if (itemError) throw itemError
      const loadedItems = (itemData ?? []) as ProductionPlanItemRow[]
      setItems(loadedItems)
      setQuantities(Object.fromEntries(
        loadedItems.map(item => [
          itemKey(item.store, item.bread_id),
          normalizePlannedQuantity(item.planned_quantity),
        ]),
      ))
    } catch {
      setPlan(null)
      setItems([])
      setQuantities({})
      setError('Não foi possível carregar o planejamento agora.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!ready || user?.role !== 'admin') return
    let alive = true
    setLoading(true)
    Promise.all([loadBreads(), loadPlan(date)])
      .catch(() => {
        if (alive) setError('Não foi possível carregar o planejamento agora.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => { alive = false }
  }, [date, loadBreads, loadPlan, ready, user?.role])

  const expectedBreads = useMemo(() => plannedBreadsForDate(breads, date), [breads, date])
  const itemsByBread = useMemo(() => {
    const map = new Map<string, ProductionPlanItemRow[]>()
    for (const item of items) {
      const current = map.get(item.bread_id) ?? []
      current.push(item)
      map.set(item.bread_id, current)
    }
    return map
  }, [items])
  const breadsById = useMemo(() => new Map(breads.map(bread => [bread.id, bread])), [breads])

  const plannedBreadIds = useMemo(() => {
    const ids = new Set<string>()
    for (const item of items) ids.add(item.bread_id)
    return Array.from(ids)
  }, [items])

  const visibleBreads = plannedBreadIds
    .map(id => breadsById.get(id))
    .filter((bread): bread is BreadRow => Boolean(bread))
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'))

  const totalPlanned = PRODUCTION_PLAN_STORES.reduce((total, store) =>
    total + visibleBreads.reduce((storeTotal, bread) =>
      storeTotal + normalizePlannedQuantity(quantities[itemKey(store, bread.id)] ?? 0), 0), 0)

  const canEdit = Boolean(plan && statusAllowsDraftEditing(plan.status))
  const availableExtras = breads.filter(bread => {
    if (plannedBreadIds.includes(bread.id)) return false
    const query = search.trim().toLowerCase()
    return query.length >= 2 && bread.name.toLowerCase().includes(query)
  }).slice(0, 8)

  async function createPlan() {
    if (!user || creating) return
    setCreating(true)
    setError('')
    try {
      const { data: createdRows, error: createError } = await supabase
        .from('production_plans')
        .insert([{
          production_date: date,
          status: 'rascunho',
          created_by: user.id,
          created_by_name: user.displayName,
        }])
        .select('id,production_date,status,created_by_name,reopened_reason,created_at,updated_at')

      if (createError) throw createError
      const createdPlan = ((createdRows ?? [])[0] ?? null) as ProductionPlanRow | null
      if (!createdPlan) throw new Error('missing plan')

      const rows = expectedBreads.flatMap(bread =>
        PRODUCTION_PLAN_STORES.map(store => ({
          plan_id: createdPlan.id,
          store,
          bread_id: bread.id,
          planned_quantity: 0,
          is_extra: false,
        })),
      )

      if (rows.length > 0) {
        const { error: itemError } = await supabase
          .from('production_plan_items')
          .insert(rows)
        if (itemError) throw itemError
      }

      showToastPS('Planejamento criado.')
      await loadPlan(date)
    } catch {
      setError('Não foi possível criar o planejamento.')
    } finally {
      setCreating(false)
    }
  }

  function setQuantity(store: ProductionPlanStore, breadId: string, value: number) {
    setQuantities(prev => ({
      ...prev,
      [itemKey(store, breadId)]: normalizePlannedQuantity(value),
    }))
  }

  async function savePlan() {
    if (!plan || !canEdit || saving) return
    setSaving(true)
    setError('')
    try {
      const updates = items.map(item => supabase
        .from('production_plan_items')
        .update({
          planned_quantity: normalizePlannedQuantity(quantities[itemKey(item.store, item.bread_id)] ?? 0),
        })
        .eq('id', item.id))

      const results = await Promise.all(updates)
      const failed = results.find(result => result.error)
      if (failed?.error) throw failed.error

      showToastPS('Rascunho salvo.')
      await loadPlan(date)
    } catch {
      setError('Não foi possível salvar o rascunho.')
    } finally {
      setSaving(false)
    }
  }

  async function addExtraBread(breadId: string) {
    if (!plan || !canEdit) return
    try {
      const rows = PRODUCTION_PLAN_STORES.map(store => ({
        plan_id: plan.id,
        store,
        bread_id: breadId,
        planned_quantity: 0,
        is_extra: true,
      }))
      const { error: insertError } = await supabase
        .from('production_plan_items')
        .insert(rows)

      if (insertError) throw insertError
      setSearch('')
      showToastPS('Pão incluído.')
      await loadPlan(date)
    } catch {
      setError('Não foi possível incluir este pão.')
    }
  }

  const shell = (children: React.ReactNode) => (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <div className="ps-mark">P</div>
            <div className="ps-brand">
              <b>Planejamento</b>
              <span>JC e JA</span>
            </div>
          </div>
          {user && (
            <div className="ps-userchip">
              <div className="ps-avatar" style={{ background: roleColor(user.role) }}>
                {user.displayName.charAt(0).toUpperCase()}
              </div>
              <b>{user.displayName}</b>
            </div>
          )}
        </header>
        <div className="ps-scroll ps-pad">{children}</div>
      </div>
    </div>
  )

  if (!ready || user?.role !== 'admin') return shell(<div className="ps-empty">Carregando...</div>)

  return shell(
    <>
      <h1 className="ps-page-title"><CalendarCheck size={23} /> Planejamento</h1>

      <section className="ps-filters" style={{ alignItems: 'stretch' }}>
        <label className="ps-fieldgroup">
          <span className="ps-fieldlabel">Data de produção</span>
          <input
            type="date"
            value={date}
            onChange={event => setDate(event.target.value || todayKey())}
            className="ps-input"
          />
        </label>
        <button type="button" className="ps-btn ghost" onClick={() => loadPlan(date)} disabled={loading}>
          <RefreshCw size={16} /> Atualizar
        </button>
      </section>

      {error && (
        <div className="ps-card" style={{ borderColor: '#E6B5AC', color: 'var(--berry)', marginTop: 14 }}>
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {loading && <div className="ps-empty">Carregando planejamento...</div>}

      {!loading && !plan && (
        <div className="ps-card" style={{ marginTop: 16 }}>
          <div className="ps-card-head">
            <div>
              <b>{dateLabel(date)}</b>
              <p style={{ margin: '4px 0 0', color: 'var(--ink-soft)', fontSize: 13 }}>
                {expectedBreads.length} pães previstos para a data.
              </p>
            </div>
          </div>
          <button type="button" className="ps-btn primary block" onClick={createPlan} disabled={creating}>
            <Plus size={17} /> {creating ? 'Criando...' : 'Criar rascunho'}
          </button>
        </div>
      )}

      {!loading && plan && (
        <>
          <div className="ps-banner honey" style={{ marginTop: 14 }}>
            <span>{dateLabel(plan.production_date)} · {PRODUCTION_PLAN_STATUS_LABELS[plan.status]}</span>
          </div>

          <section className="ps-card" style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <div>
                <div className="ps-label" style={{ marginTop: 0 }}>Total planejado</div>
                <b style={{ fontSize: 28, fontVariantNumeric: 'tabular-nums' }}>{totalPlanned}</b>
              </div>
              <button type="button" className="ps-btn primary" onClick={savePlan} disabled={!canEdit || saving}>
                <Save size={17} /> {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </section>

          {!canEdit && (
            <div className="ps-card" style={{ marginTop: 14, borderColor: '#E6B5AC' }}>
              <AlertTriangle size={16} /> Planejamento travado.
            </div>
          )}

          <div className="ps-label">Pães</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {visibleBreads.map(bread => {
              const breadItems = itemsByBread.get(bread.id) ?? []
              const extra = breadItems.some(item => item.is_extra)
              const breadTotal = PRODUCTION_PLAN_STORES.reduce((total, store) =>
                total + normalizePlannedQuantity(quantities[itemKey(store, bread.id)] ?? 0), 0)

              return (
                <div key={bread.id} className={`ps-card ${breadTotal > 0 ? 'active' : ''}`}>
                  <div className="ps-card-head">
                    <div>
                      <div className="ps-pname">{bread.name}</div>
                      {extra && <span style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 700 }}>Avulso desta data</span>}
                    </div>
                    <span className="ps-store-chip">{breadTotal}</span>
                  </div>

                  <div className="ps-grid" style={{ marginTop: 8 }}>
                    {PRODUCTION_PLAN_STORES.map(store => {
                      const key = itemKey(store, bread.id)
                      const planned = normalizePlannedQuantity(quantities[key] ?? 0)
                      const item = breadItems.find(row => row.store === store)
                      const newProduction = calculateNewProductionQuantity({
                        plannedQuantity: planned,
                        frozenQuantity: item?.frozen_quantity ?? 0,
                        leftoverConfirmedQuantity: item?.leftover_confirmed_quantity ?? 0,
                      })

                      return (
                        <label key={store} className="ps-fieldgroup" style={{ margin: 0 }}>
                          <span className="ps-fieldlabel">{STORE_LABEL[store]}</span>
                          <input
                            className="ps-input"
                            type="number"
                            inputMode="numeric"
                            min={0}
                            value={planned}
                            disabled={!canEdit}
                            onFocus={event => event.currentTarget.select()}
                            onChange={event => setQuantity(store, bread.id, Number(event.target.value))}
                          />
                          <span style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 700 }}>
                            Novo previsto: {newProduction}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          {canEdit && (
            <section className="ps-card" style={{ marginTop: 16 }}>
              <label className="ps-fieldgroup" style={{ margin: 0 }}>
                <span className="ps-fieldlabel">Incluir pão avulso</span>
                <div style={{ position: 'relative' }}>
                  <Search size={16} style={{ position: 'absolute', left: 12, top: 13, color: 'var(--ink-faint)' }} />
                  <input
                    className="ps-input"
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    placeholder="Buscar pão"
                    style={{ paddingLeft: 36 }}
                  />
                </div>
              </label>

              {availableExtras.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                  {availableExtras.map(bread => (
                    <button
                      key={bread.id}
                      type="button"
                      className="ps-btn ghost"
                      onClick={() => addExtraBread(bread.id)}
                      style={{ justifyContent: 'space-between' }}
                    >
                      <span>{bread.name}</span>
                      <Plus size={16} />
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </>,
  )
}
