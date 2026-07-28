'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  CalendarCheck,
  PackageOpen,
  Plus,
  RefreshCw,
  Save,
  Search,
  Snowflake,
} from 'lucide-react'
import { getCurrentUser, getCurrentUserAsync, roleColor, type AppUser } from '@/lib/auth'
import {
  PRODUCTION_PLAN_STATUS_LABELS,
  PRODUCTION_PLAN_STORES,
  aggregateFrozenBreadAvailability,
  aggregatePlanningLeftoverAvailability,
  calculatePlannedTotalQuantity,
  matchesPlanningBreadSearch,
  normalizePlannedQuantity,
  planNeedsOrderConversion,
  planningAvailabilityKey,
  plannedBreadsForDate,
  statusAllowsDraftEditing,
  subtractPlanningReuseProposals,
  type PlanningFrozenProductRow,
  type PlanningFrozenStockRow,
  type PlanningPendingLeftoverRow,
  type PlanningReuseProposalRow,
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
  order_created_at: string | null
  order_created_by_name: string | null
}

interface ProductionPlanItemSummaryRow {
  plan_id: string
  store: ProductionPlanStore
  bread_id: string
  planned_quantity: number
  frozen_quantity: number
  leftover_proposed_quantity: number
  leftover_confirmed_quantity: number | null
  order_created_at: string | null
}

interface ProductionPlanSummary {
  id: string
  production_date: string
  status: ProductionPlanStatus
  total: number
  storeTotals: Record<ProductionPlanStore, number>
}

interface BreadRow extends PlanningBreadLite {
  days: number[]
}

type QuantityInputs = Record<string, number>
type ToggleInputs = Record<string, boolean>

const STORE_LABEL: Record<ProductionPlanStore, string> = {
  jc: 'JC',
  ja: 'JA',
}

function itemKey(store: ProductionPlanStore, breadId: string) {
  return planningAvailabilityKey(store, breadId)
}

function dateLabel(dateKey: string) {
  return formatDateBR(dateKey)
}

function storedItemTotal(item: ProductionPlanItemSummaryRow) {
  return calculatePlannedTotalQuantity({
    newQuantity: item.planned_quantity,
    frozenQuantity: item.frozen_quantity,
    leftoverProposedQuantity: item.leftover_proposed_quantity,
    leftoverConfirmedQuantity: item.leftover_confirmed_quantity,
  })
}

export default function ProductionPlanningPage() {
  const router = useRouter()
  const [user, setUser] = useState<AppUser | null>(() => getCurrentUser())
  const [ready, setReady] = useState(false)
  const [date, setDate] = useState(todayKey())
  const [breads, setBreads] = useState<BreadRow[]>([])
  const [plan, setPlan] = useState<ProductionPlanRow | null>(null)
  const [items, setItems] = useState<ProductionPlanItemRow[]>([])
  const [openPlans, setOpenPlans] = useState<ProductionPlanSummary[]>([])
  const [quantities, setQuantities] = useState<QuantityInputs>({})
  const [frozenQuantities, setFrozenQuantities] = useState<QuantityInputs>({})
  const [leftoverQuantities, setLeftoverQuantities] = useState<QuantityInputs>({})
  const [frozenEnabled, setFrozenEnabled] = useState<ToggleInputs>({})
  const [leftoverEnabled, setLeftoverEnabled] = useState<ToggleInputs>({})
  const [frozenAvailability, setFrozenAvailability] = useState<QuantityInputs>({})
  const [leftoverAvailability, setLeftoverAvailability] = useState<QuantityInputs>({})
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

  const loadOpenPlans = useCallback(async () => {
    const { data: planRows, error: planError } = await supabase
      .from('production_plans')
      .select('id,production_date,status,created_by_name,reopened_reason,created_at,updated_at')
      .neq('status', 'fechado')
      .order('production_date', { ascending: true })
      .limit(20)

    if (planError) throw planError
    const plans = (planRows ?? []) as ProductionPlanRow[]
    const planIds = plans.map(openPlan => openPlan.id)

    if (planIds.length === 0) {
      setOpenPlans([])
      return
    }

    const { data: itemRows, error: itemError } = await supabase
      .from('production_plan_items')
      .select('plan_id,store,bread_id,planned_quantity,frozen_quantity,leftover_proposed_quantity,leftover_confirmed_quantity,order_created_at')
      .in('plan_id', planIds)

    if (itemError) throw itemError
    const summaryItems = (itemRows ?? []) as ProductionPlanItemSummaryRow[]
    const itemsByPlan = new Map<string, ProductionPlanItemSummaryRow[]>()

    for (const item of summaryItems) {
      const current = itemsByPlan.get(item.plan_id) ?? []
      current.push(item)
      itemsByPlan.set(item.plan_id, current)
    }

    setOpenPlans(plans.flatMap(openPlan => {
      const planItems = itemsByPlan.get(openPlan.id) ?? []
      if (!planNeedsOrderConversion(planItems)) return []
      const pendingItems = planItems.filter(item => !item.order_created_at)
      const storeTotals = Object.fromEntries(
        PRODUCTION_PLAN_STORES.map(store => [
          store,
          pendingItems
            .filter(item => item.store === store)
            .reduce((total, item) => total + storedItemTotal(item), 0),
        ]),
      ) as Record<ProductionPlanStore, number>

      return [{
        id: openPlan.id,
        production_date: openPlan.production_date,
        status: openPlan.status,
        total: pendingItems.reduce((total, item) => total + storedItemTotal(item), 0),
        storeTotals,
      }]
    }))
  }, [])

  const loadAvailability = useCallback(async (targetDate: string) => {
    try {
      const [frozenProductsResult, frozenStockResult, leftoversResult, reusePlansResult] = await Promise.all([
        supabase
          .from('frozen_products')
          .select('id,product_id,product_source,visible_stores,store')
          .eq('active', true)
          .eq('product_source', 'bread'),
        supabase
          .from('frozen_stock')
          .select('frozen_product_id,location,quantity'),
        supabase
          .from('sobras')
          .select('store,product_id,pending_quantity')
          .in('store', ['jc', 'ja'])
          .eq('product_source', 'bread')
          .lt('record_date', targetDate)
          .gt('pending_quantity', 0),
        supabase
          .from('bread_reuse_plans')
          .select('store,bread_id,proposed_quantity,status')
          .eq('status', 'proposed'),
      ])

      if (frozenProductsResult.error) throw frozenProductsResult.error
      if (frozenStockResult.error) throw frozenStockResult.error
      if (leftoversResult.error) throw leftoversResult.error
      if (reusePlansResult.error) throw reusePlansResult.error

      setFrozenAvailability(Object.fromEntries(aggregateFrozenBreadAvailability(
        (frozenProductsResult.data ?? []) as PlanningFrozenProductRow[],
        (frozenStockResult.data ?? []) as PlanningFrozenStockRow[],
      )))
      const rawLeftovers = aggregatePlanningLeftoverAvailability(
        (leftoversResult.data ?? []) as PlanningPendingLeftoverRow[],
      )
      setLeftoverAvailability(Object.fromEntries(subtractPlanningReuseProposals(
        rawLeftovers,
        (reusePlansResult.data ?? []) as PlanningReuseProposalRow[],
      )))
    } catch (availabilityError) {
      setFrozenAvailability({})
      setLeftoverAvailability({})
      throw availabilityError
    }
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
        setFrozenQuantities({})
        setLeftoverQuantities({})
        setFrozenEnabled({})
        setLeftoverEnabled({})
        return
      }

      const { data: itemData, error: itemError } = await supabase
        .from('production_plan_items')
        .select('id,plan_id,store,bread_id,planned_quantity,frozen_quantity,leftover_proposed_quantity,leftover_confirmed_quantity,is_extra,order_created_at,order_created_by_name')
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
      setFrozenQuantities(Object.fromEntries(
        loadedItems.map(item => [
          itemKey(item.store, item.bread_id),
          normalizePlannedQuantity(item.frozen_quantity),
        ]),
      ))
      setLeftoverQuantities(Object.fromEntries(
        loadedItems.map(item => [
          itemKey(item.store, item.bread_id),
          normalizePlannedQuantity(item.leftover_proposed_quantity),
        ]),
      ))
      setFrozenEnabled(Object.fromEntries(
        loadedItems.map(item => [
          itemKey(item.store, item.bread_id),
          normalizePlannedQuantity(item.frozen_quantity) > 0,
        ]),
      ))
      setLeftoverEnabled(Object.fromEntries(
        loadedItems.map(item => [
          itemKey(item.store, item.bread_id),
          normalizePlannedQuantity(item.leftover_proposed_quantity) > 0
            || item.leftover_confirmed_quantity !== null,
        ]),
      ))
    } catch {
      setPlan(null)
      setItems([])
      setQuantities({})
      setFrozenQuantities({})
      setLeftoverQuantities({})
      setFrozenEnabled({})
      setLeftoverEnabled({})
      setError('Não foi possível carregar o planejamento agora.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!ready || user?.role !== 'admin') return
    let alive = true
    setLoading(true)
    Promise.all([loadBreads(), loadOpenPlans(), loadAvailability(date), loadPlan(date)])
      .catch(() => {
        if (alive) setError('Não foi possível carregar o planejamento agora.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => { alive = false }
  }, [date, loadAvailability, loadBreads, loadOpenPlans, loadPlan, ready, user?.role])

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

  const plannedTotalForItem = (item: ProductionPlanItemRow) => calculatePlannedTotalQuantity({
    newQuantity: quantities[itemKey(item.store, item.bread_id)] ?? item.planned_quantity,
    frozenQuantity: frozenQuantities[itemKey(item.store, item.bread_id)] ?? item.frozen_quantity,
    leftoverProposedQuantity: leftoverQuantities[itemKey(item.store, item.bread_id)] ?? item.leftover_proposed_quantity,
    leftoverConfirmedQuantity: item.leftover_confirmed_quantity,
  })

  const totalPlanned = items.reduce((total, item) => total + plannedTotalForItem(item), 0)
  const storeTotals = PRODUCTION_PLAN_STORES.map(store => ({
    store,
    total: items
      .filter(item => item.store === store)
      .reduce((storeTotal, item) => storeTotal + plannedTotalForItem(item), 0),
  }))
  const filledBreadCount = visibleBreads.filter(bread =>
    (itemsByBread.get(bread.id) ?? []).some(item => plannedTotalForItem(item) > 0),
  ).length

  const canEdit = Boolean(plan && statusAllowsDraftEditing(plan.status))
  const searchQuery = search.trim()
  const searchIsActive = searchQuery.length >= 2
  const matchingCatalogBreads = searchIsActive
    ? breads.filter(bread => matchesPlanningBreadSearch(bread.name, searchQuery))
    : []
  const matchingPlannedCount = matchingCatalogBreads
    .filter(bread => plannedBreadIds.includes(bread.id))
    .length
  const availableExtras = breads.filter(bread => {
    if (plannedBreadIds.includes(bread.id)) return false
    return matchesPlanningBreadSearch(bread.name, searchQuery)
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
          frozen_quantity: 0,
          leftover_proposed_quantity: 0,
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
      void loadOpenPlans().catch(() => undefined)
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

  function setFrozenQuantity(store: ProductionPlanStore, breadId: string, value: number) {
    const key = itemKey(store, breadId)
    setFrozenQuantities(prev => ({
      ...prev,
      [key]: normalizePlannedQuantity(value),
    }))
    setFrozenEnabled(prev => ({ ...prev, [key]: true }))
  }

  function setLeftoverQuantity(store: ProductionPlanStore, breadId: string, value: number) {
    const key = itemKey(store, breadId)
    setLeftoverQuantities(prev => ({
      ...prev,
      [key]: normalizePlannedQuantity(value),
    }))
    setLeftoverEnabled(prev => ({ ...prev, [key]: true }))
  }

  function setFrozenUse(store: ProductionPlanStore, breadId: string, enabled: boolean) {
    const key = itemKey(store, breadId)
    setFrozenEnabled(prev => ({ ...prev, [key]: enabled }))
    if (!enabled) setFrozenQuantities(prev => ({ ...prev, [key]: 0 }))
  }

  function setLeftoverUse(store: ProductionPlanStore, breadId: string, enabled: boolean) {
    const key = itemKey(store, breadId)
    setLeftoverEnabled(prev => ({ ...prev, [key]: enabled }))
    if (!enabled) setLeftoverQuantities(prev => ({ ...prev, [key]: 0 }))
  }

  async function savePlan() {
    if (!plan || !canEdit || saving) return
    setSaving(true)
    setError('')
    try {
      const updates = items.filter(item => !item.order_created_at).map(item => supabase
        .from('production_plan_items')
        .update({
          planned_quantity: normalizePlannedQuantity(quantities[itemKey(item.store, item.bread_id)] ?? 0),
          frozen_quantity: frozenEnabled[itemKey(item.store, item.bread_id)]
            ? normalizePlannedQuantity(frozenQuantities[itemKey(item.store, item.bread_id)] ?? 0)
            : 0,
          leftover_proposed_quantity: leftoverEnabled[itemKey(item.store, item.bread_id)]
            ? normalizePlannedQuantity(leftoverQuantities[itemKey(item.store, item.bread_id)] ?? 0)
            : 0,
        })
        .eq('id', item.id))

      const results = await Promise.all(updates)
      const failed = results.find(result => result.error)
      if (failed?.error) throw failed.error

      showToastPS('Rascunho salvo.')
      await loadPlan(date)
      void loadOpenPlans().catch(() => undefined)
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
          frozen_quantity: 0,
          leftover_proposed_quantity: 0,
          is_extra: true,
        }))
      const { error: insertError } = await supabase
        .from('production_plan_items')
        .insert(rows)

      if (insertError) throw insertError
      setSearch('')
      showToastPS('Pão incluído.')
      await loadPlan(date)
      void loadOpenPlans().catch(() => undefined)
    } catch {
      setError('Não foi possível incluir este pão.')
    }
  }

  async function refreshPlanning() {
    setError('')
    try {
      await Promise.all([loadOpenPlans(), loadAvailability(date), loadPlan(date)])
    } catch {
      setError('Não foi possível carregar os planejamentos agora.')
    }
  }

  function openPlanDate(planDate: string) {
    if (planDate === date) {
      void loadPlan(planDate)
      return
    }
    setDate(planDate)
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

      <section className="ps-card" style={{ marginTop: 14 }}>
        <div className="ps-card-head">
          <div>
            <b>Planejamentos em aberto</b>
            <p style={{ margin: '4px 0 0', color: 'var(--ink-soft)', fontSize: 13 }}>
              Toque em uma data para abrir o planejamento.
            </p>
          </div>
          <span className="ps-store-chip">{openPlans.length}</span>
        </div>

        {openPlans.length === 0 ? (
          <div className="ps-empty" style={{ padding: '12px 10px', marginTop: 10 }}>
            Nenhum planejamento em aberto.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {openPlans.map(openPlan => (
              <button
                key={openPlan.id}
                type="button"
                className="ps-btn ghost"
                onClick={() => openPlanDate(openPlan.production_date)}
                style={{
                  justifyContent: 'space-between',
                  borderColor: openPlan.production_date === date ? 'var(--honey)' : undefined,
                  background: openPlan.production_date === date ? 'var(--honey-tint)' : undefined,
                }}
              >
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                  <b>{dateLabel(openPlan.production_date)}</b>
                  <small style={{ color: 'var(--ink-soft)', fontWeight: 700 }}>
                    {PRODUCTION_PLAN_STATUS_LABELS[openPlan.status]}
                  </small>
                </span>
                <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <span className="ps-store-chip">Total {openPlan.total}</span>
                  <span className="ps-store-chip">JC {openPlan.storeTotals.jc}</span>
                  <span className="ps-store-chip">JA {openPlan.storeTotals.ja}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

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
        <button type="button" className="ps-btn ghost" onClick={() => void refreshPlanning()} disabled={loading}>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div>
                <div className="ps-label" style={{ marginTop: 0 }}>Total planejado</div>
                <b style={{ fontSize: 28, fontVariantNumeric: 'tabular-nums' }}>{totalPlanned}</b>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                  {storeTotals.map(row => (
                    <span key={row.store} className="ps-store-chip">
                      {STORE_LABEL[row.store]} {row.total}
                    </span>
                  ))}
                  <span className="ps-store-chip" style={{ background: 'var(--line-soft)', color: 'var(--ink-soft)' }}>
                    {filledBreadCount} {filledBreadCount === 1 ? 'pão' : 'pães'} com quantidade
                  </span>
                </div>
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
              const breadTotal = breadItems.reduce((total, item) => total + plannedTotalForItem(item), 0)
              const breadFrozenAvailable = PRODUCTION_PLAN_STORES
                .reduce((total, store) => total + (frozenAvailability[itemKey(store, bread.id)] ?? 0), 0)
              const breadLeftoverAvailable = PRODUCTION_PLAN_STORES
                .reduce((total, store) => total + (leftoverAvailability[itemKey(store, bread.id)] ?? 0), 0)

              return (
                <div key={bread.id} className={`ps-card ${breadTotal > 0 ? 'active' : ''}`}>
                  <div className="ps-card-head">
                    <div>
                      <div className="ps-pname">{bread.name}</div>
                      {extra && <span style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 700 }}>Avulso desta data</span>}
                    </div>
                    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {breadFrozenAvailable > 0 && (
                        <span className="ps-store-chip"><Snowflake size={13} /> {breadFrozenAvailable}</span>
                      )}
                      {breadLeftoverAvailable > 0 && (
                        <span className="ps-store-chip"><PackageOpen size={13} /> {breadLeftoverAvailable}</span>
                      )}
                      <span className="ps-store-chip">Total {breadTotal}</span>
                    </span>
                  </div>

                  <div className="ps-grid" style={{ marginTop: 8 }}>
                    {PRODUCTION_PLAN_STORES.map(store => {
                      const key = itemKey(store, bread.id)
                      const fresh = normalizePlannedQuantity(quantities[key] ?? 0)
                      const item = breadItems.find(row => row.store === store)
                      const convertedToOrder = Boolean(item?.order_created_at)
                      const canEditItem = canEdit && !convertedToOrder
                      const frozen = normalizePlannedQuantity(frozenQuantities[key] ?? item?.frozen_quantity ?? 0)
                      const leftoverProposal = normalizePlannedQuantity(
                        leftoverQuantities[key] ?? item?.leftover_proposed_quantity ?? 0,
                      )
                      const leftoverConfirmed = item?.leftover_confirmed_quantity ?? null
                      const leftover = normalizePlannedQuantity(leftoverConfirmed ?? leftoverProposal)
                      const frozenAvailable = frozenAvailability[key] ?? 0
                      const leftoverAvailable = leftoverAvailability[key] ?? 0
                      const useFrozen = frozenEnabled[key] ?? frozen > 0
                      const useLeftover = leftoverEnabled[key] ?? leftover > 0
                      const hasFrozenOption = frozenAvailable > 0 || frozen > 0 || useFrozen
                      const hasLeftoverOption = leftoverAvailable > 0 || leftoverProposal > 0 || leftoverConfirmed !== null || useLeftover
                      const canToggleFrozen = canEditItem && (frozenAvailable > 0 || frozen > 0)
                      const canToggleLeftover = canEditItem && (leftoverAvailable > 0 || leftoverProposal > 0)
                      const total = item
                        ? plannedTotalForItem(item)
                        : calculatePlannedTotalQuantity({ newQuantity: fresh, frozenQuantity: frozen, leftoverProposedQuantity: leftover })

                      return (
                        <div key={store} className="ps-fieldgroup" style={{ margin: 0 }}>
                          <label className="ps-fieldgroup" style={{ margin: 0 }}>
                            <span className="ps-fieldlabel">{STORE_LABEL[store]} novos</span>
                            <input
                              className="ps-input"
                              type="number"
                              inputMode="numeric"
                              min={0}
                              value={fresh}
                              disabled={!canEditItem}
                              onFocus={event => event.currentTarget.select()}
                              onChange={event => setQuantity(store, bread.id, Number(event.target.value))}
                            />
                          </label>
                          {convertedToOrder && (
                            <span style={{ display: 'block', marginTop: 6, fontSize: 12, color: 'var(--ink-soft)', fontWeight: 800 }}>
                              Pedido já gerado.
                            </span>
                          )}

                          {hasFrozenOption && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 13, fontWeight: 800, color: canToggleFrozen || useFrozen ? 'var(--ps-ink)' : 'var(--ink-faint)' }}>
                              <input
                                type="checkbox"
                                checked={useFrozen}
                                disabled={!canEditItem || (!canToggleFrozen && !useFrozen)}
                                onChange={event => setFrozenUse(store, bread.id, event.target.checked)}
                              />
                              <Snowflake size={14} />
                              <span>Usar congelados</span>
                              <small style={{ marginLeft: 'auto', color: 'var(--ink-soft)', fontWeight: 700 }}>
                                {frozenAvailable} disp.
                              </small>
                            </label>
                          )}
                          {!hasFrozenOption && canEditItem && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12, color: 'var(--ink-soft)', fontWeight: 700 }}>
                              <Snowflake size={13} /> Congelados: 0 disp.
                            </span>
                          )}
                          {useFrozen && (
                            <input
                              className="ps-input"
                              type="number"
                              inputMode="numeric"
                              min={0}
                              max={frozenAvailable > 0 ? frozenAvailable : undefined}
                              value={frozen || ''}
                              placeholder="0"
                              disabled={!canEditItem}
                              onFocus={event => event.currentTarget.select()}
                              onChange={event => setFrozenQuantity(store, bread.id, Number(event.target.value))}
                              style={{ marginTop: 6 }}
                            />
                          )}

                          {hasLeftoverOption && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 13, fontWeight: 800, color: canToggleLeftover || useLeftover ? 'var(--ps-ink)' : 'var(--ink-faint)' }}>
                              <input
                                type="checkbox"
                                checked={useLeftover}
                                disabled={!canEditItem || leftoverConfirmed !== null || (!canToggleLeftover && !useLeftover)}
                                onChange={event => setLeftoverUse(store, bread.id, event.target.checked)}
                              />
                              <PackageOpen size={14} />
                              <span>Usar sobra</span>
                              <small style={{ marginLeft: 'auto', color: 'var(--ink-soft)', fontWeight: 700 }}>
                                {leftoverAvailable} disp.
                              </small>
                            </label>
                          )}
                          {!hasLeftoverOption && canEditItem && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12, color: 'var(--ink-soft)', fontWeight: 700 }}>
                              <PackageOpen size={13} /> Sobra: 0 disp.
                            </span>
                          )}
                          {useLeftover && (
                            <input
                              className="ps-input"
                              type="number"
                              inputMode="numeric"
                              min={0}
                              max={leftoverAvailable > 0 ? leftoverAvailable : undefined}
                              value={leftoverProposal || ''}
                              placeholder="0"
                              disabled={!canEditItem || leftoverConfirmed !== null}
                              onFocus={event => event.currentTarget.select()}
                              onChange={event => setLeftoverQuantity(store, bread.id, Number(event.target.value))}
                              style={{ marginTop: 6 }}
                            />
                          )}
                          {leftoverConfirmed !== null && (
                            <span style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 700 }}>
                              Geolar confirmou {leftover} da sobra.
                            </span>
                          )}

                          <span style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 700 }}>
                            Total: {total} = novo {fresh} + congelado {frozen} + sobra {leftover}
                          </span>
                        </div>
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
              {searchIsActive && availableExtras.length === 0 && (
                <div className="ps-empty" style={{ marginTop: 10, padding: '12px 10px' }}>
                  {matchingPlannedCount > 0
                    ? 'Esse pão já está neste planejamento.'
                    : 'Nenhum pão ativo encontrado fora deste planejamento.'}
                </div>
              )}
              {!searchIsActive && search.length > 0 && (
                <div style={{ marginTop: 10, color: 'var(--ink-soft)', fontSize: 13, fontWeight: 700 }}>
                  Digite pelo menos 2 letras para buscar.
                </div>
              )}
            </section>
          )}
        </>
      )}
    </>,
  )
}
