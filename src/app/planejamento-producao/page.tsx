'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  CalendarCheck,
  Croissant,
  PackageOpen,
  Plus,
  RefreshCw,
  Save,
  Search,
  Snowflake,
  Trash2,
} from 'lucide-react'
import {
  BreadDemandHistoryBlock,
  type BreadDemandHistoryLoadState,
} from '@/components/BreadDemandHistoryBlock'
import { getCurrentUser, getCurrentUserAsync, roleColor, type AppUser } from '@/lib/auth'
import {
  type BreadDemandSummary,
} from '@/lib/breadDemandHistory'
import { fetchBreadDemandHistory } from '@/lib/breadDemandHistoryClient'
import {
  PRODUCTION_PLAN_STATUS_LABELS,
  PRODUCTION_PLAN_STORES,
  aggregatePlanningLeftoverAvailability,
  calculateNewProductionQuantity,
  calculatePlannedTotalQuantity,
  defaultPlanningDayIndex,
  matchesPlanningBreadSearch,
  nextOccurrenceOfDay,
  normalizePlannedQuantity,
  planCanBeDiscarded,
  planDateIsExpiredForOrders,
  planHasOrderConversion,
  planIsFullyConvertedToOrders,
  planNeedsOrderConversion,
  planningAvailabilityKey,
  plannedBreadsForDate,
  readBakeryClock,
  statusAllowsDraftEditing,
  subtractPlanningReuseProposals,
  type PlanningPendingLeftoverRow,
  type PlanningReuseProposalRow,
  type PlanningBreadLite,
  type ProductionPlanStatus,
  type ProductionPlanStore,
} from '@/lib/productionPlanning'
import { supabase } from '@/lib/supabase'
import { formatDateBR, showToast as showToastPS } from '@/lib/utils'
import styles from './page.module.css'

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
  // Já virou pedido em parte (uma loja sim, outra não). Os totais acima são
  // sempre o que falta converter.
  partiallyConverted: boolean
}

interface BreadRow extends PlanningBreadLite {
  days: number[]
  unit: string | null
}

interface FrozenProductionAvailabilityRow {
  store: ProductionPlanStore
  bread_id: string
  available_quantity: number | string
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

// Rótulo com dia da semana por extenso, ex.: "quinta-feira, 24/09/2026".
// O ano entra porque nem sempre há botão aceso: quando o planejamento vem da
// lista de abertos, este rótulo é a única âncora, e 23/09 de dois anos
// diferentes se leem igual.
function dayDateLabel(dateKey: string) {
  const d = new Date(`${dateKey}T12:00:00`)
  if (Number.isNaN(d.getTime())) return dateKey
  return d.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

const DAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

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
  const [date, setDate] = useState(() => {
    const clock = readBakeryClock()
    const day = defaultPlanningDayIndex(clock.dayOfWeek, clock.hour)
    return nextOccurrenceOfDay(day, clock.dateKey)
  })
  const [breads, setBreads] = useState<BreadRow[]>([])
  // Sem a lista de pães, "Criar rascunho" gravaria o plano sem nenhum item: o
  // plano e a lista chegam por consultas separadas e em qualquer ordem.
  const [breadsState, setBreadsState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [plan, setPlan] = useState<ProductionPlanRow | null>(null)
  // Dia a que plan e items pertencem. Entre o toque num dia novo e a consulta
  // dele começar, a tela ainda tem o plano anterior; sem esta marca ele
  // apareceria por um instante sob o botão do dia novo.
  const [loadedPlanDate, setLoadedPlanDate] = useState<string | null>(null)
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
  const [discarding, setDiscarding] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [demandHistoryState, setDemandHistoryState] = useState<BreadDemandHistoryLoadState>('loading')
  const [demandHistory, setDemandHistory] = useState<Record<string, BreadDemandSummary>>({})
  const demandHistoryRequestId = useRef(0)
  // Trocar de dia com a consulta anterior no ar fazia a resposta atrasada
  // pintar o plano de outro dia sob o botão do dia novo. Só a consulta mais
  // recente, e do dia que está na tela, pode mexer no plano exibido.
  const planRequestId = useRef(0)
  const selectedDate = useRef(date)

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
      .select('id,name,days,active,is_pj,unit')
      .eq('active', true)
      .eq('is_pj', false)
      .order('name', { ascending: true })

    if (breadError) {
      // Uma lista já carregada continua valendo; só a falta dela trava o botão.
      setBreadsState(current => (current === 'ready' ? current : 'error'))
      throw breadError
    }
    const loadedBreads = (data ?? []) as BreadRow[]
    setBreads(loadedBreads)
    setBreadsState('ready')
    return loadedBreads
  }, [])

  const loadDemandHistory = useCallback(async (
    targetDate: string,
    targetBreads: BreadRow[],
  ) => {
    const requestId = demandHistoryRequestId.current + 1
    demandHistoryRequestId.current = requestId
    setDemandHistoryState('loading')
    setDemandHistory({})

    try {
      // Quando a falha anterior foi no próprio carregamento dos pães, repetir a
      // consulta com a lista vazia devolveria "sem histórico" para tudo e
      // esconderia o erro. Recarrega os pães antes de tentar de novo.
      const resolvedBreads = targetBreads.length > 0 ? targetBreads : await loadBreads()
      const summaries = await fetchBreadDemandHistory(targetDate, resolvedBreads)

      if (demandHistoryRequestId.current !== requestId) return
      setDemandHistory(summaries)
      setDemandHistoryState('ready')
    } catch {
      if (demandHistoryRequestId.current !== requestId) return
      setDemandHistory({})
      setDemandHistoryState('error')
    }
  }, [loadBreads])

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
      // O critério é só um: ainda falta virar pedido. Plano totalmente
      // convertido não tem pendência e cai fora sozinho. Excluir também quem
      // já converteu EM PARTE escondia o plano meio feito de toda a tela, e o
      // campo de data antigo era o único jeito de alcançá-lo.
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
        partiallyConverted: planHasOrderConversion(planItems),
      }]
    }))
  }, [])

  const loadAvailability = useCallback(async (targetDate: string) => {
    try {
      const [frozenResult, leftoversResult, reusePlansResult] = await Promise.all([
        supabase.rpc('list_frozen_production_availability', {
          p_target_plan_date: targetDate,
        }),
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

      if (frozenResult.error) throw frozenResult.error
      if (leftoversResult.error) throw leftoversResult.error
      if (reusePlansResult.error) throw reusePlansResult.error

      setFrozenAvailability(Object.fromEntries(
        ((frozenResult.data ?? []) as FrozenProductionAvailabilityRow[]).map(row => [
          planningAvailabilityKey(row.store, row.bread_id),
          normalizePlannedQuantity(row.available_quantity),
        ]),
      ))
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
    // Recarga pedida para um dia que já saiu da tela (ex.: salvar terminou
    // depois da troca de dia) não pode tomar a vez da consulta do dia atual.
    if (targetDate !== selectedDate.current) return
    const requestId = planRequestId.current + 1
    planRequestId.current = requestId
    const isCurrent = () => (
      planRequestId.current === requestId && selectedDate.current === targetDate
    )

    setLoading(true)
    setError('')
    try {
      const { data: planData, error: planError } = await supabase
        .from('production_plans')
        .select('id,production_date,status,created_by_name,reopened_reason,created_at,updated_at')
        .eq('production_date', targetDate)
        .maybeSingle()

      if (!isCurrent()) return
      if (planError) throw planError
      const loadedPlan = planData as ProductionPlanRow | null

      if (!loadedPlan) {
        setPlan(null)
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

      if (!isCurrent()) return
      if (itemError) throw itemError
      const loadedItems = (itemData ?? []) as ProductionPlanItemRow[]
      // Plano e itens entram juntos: o cabeçalho de um plano com os números
      // do anterior nunca chega a aparecer.
      setPlan(loadedPlan)
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
      if (!isCurrent()) return
      setPlan(null)
      setItems([])
      setQuantities({})
      setFrozenQuantities({})
      setLeftoverQuantities({})
      setFrozenEnabled({})
      setLeftoverEnabled({})
      setError('Não foi possível carregar o planejamento agora.')
    } finally {
      if (isCurrent()) {
        setLoadedPlanDate(targetDate)
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    selectedDate.current = date
    if (!ready || user?.role !== 'admin') return
    let alive = true
    setLoading(true)
    demandHistoryRequestId.current += 1
    setDemandHistoryState('loading')
    setDemandHistory({})

    const breadsRequest = loadBreads()
    void breadsRequest
      .then(loadedBreads => {
        if (alive) void loadDemandHistory(date, loadedBreads)
      })
      .catch(() => {
        if (alive) setDemandHistoryState('error')
      })

    // O "carregando" do plano é da própria loadPlan: encerrá-lo aqui quando uma
    // consulta vizinha falha cedo mostraria o plano do dia anterior sob o
    // botão do dia novo.
    Promise.all([breadsRequest, loadOpenPlans(), loadAvailability(date), loadPlan(date)])
      .catch(() => {
        if (alive) setError('Não foi possível carregar o planejamento agora.')
      })
    return () => {
      alive = false
      demandHistoryRequestId.current += 1
    }
  }, [date, loadAvailability, loadBreads, loadDemandHistory, loadOpenPlans, loadPlan, ready, user?.role])

  const planLoading = loading || loadedPlanDate !== date
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

  const planningHasOrderConversion = planHasOrderConversion(items)
  const planningFullyConvertedToOrder = planIsFullyConvertedToOrders(items)
  const canEdit = Boolean(plan && statusAllowsDraftEditing(plan.status) && !planningHasOrderConversion)
  // Hoje em São Paulo, lido uma vez para a tela inteira. Os botões de dia e o
  // aviso de data vencida precisam concordar, inclusive na madrugada: com dois
  // relógios diferentes a tela dizia duas coisas sobre o mesmo dia entre
  // meia-noite e 6 h.
  const todayDate = readBakeryClock().dateKey
  const planDateExpired = Boolean(plan && planDateIsExpiredForOrders(plan.production_date, todayDate))
  const canDiscard = Boolean(plan && planCanBeDiscarded(plan.status, items))
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
    if (!user || creating || breadsState !== 'ready') return
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
        if (itemError) {
          // Plano sem os pães do dia parece pronto e não é. Desfaz para a
          // pessoa tentar de novo. O select confirma a exclusão, porque RLS
          // bloqueada devolve zero linhas sem erro.
          const { data: undoneRows, error: undoError } = await supabase
            .from('production_plans')
            .delete()
            .eq('id', createdPlan.id)
            .select('id')
          if (undoError || (undoneRows ?? []).length === 0) {
            // Não deu para desfazer: mostra o plano vazio, que tem o botão
            // Descartar, e diz o que fazer.
            await loadPlan(date)
            if (selectedDate.current === date) {
              setError('O rascunho ficou sem os pães do dia. Descarte-o e crie de novo; se ele não aparecer, toque em Atualizar.')
            }
            return
          }
          throw itemError
        }
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

  async function discardPlan() {
    if (!plan || !canDiscard || discarding) return
    const confirmed = window.confirm(
      `Descartar o planejamento de ${dateLabel(plan.production_date)}?\n\n`
      + `${totalPlanned} pães planejados serão apagados. Não dá para desfazer.`,
    )
    if (!confirmed) return

    setDiscarding(true)
    setError('')
    try {
      // Os itens saem junto pelo ON DELETE CASCADE — apagar só o pai mantém a
      // operação atômica. O select confirma que a policy deixou apagar de fato,
      // porque RLS bloqueada devolve zero linhas sem erro.
      const { data: deletedRows, error: deleteError } = await supabase
        .from('production_plans')
        .delete()
        .eq('id', plan.id)
        .select('id')

      if (deleteError) throw deleteError
      if ((deletedRows ?? []).length === 0) throw new Error('plan not deleted')

      showToastPS('Planejamento descartado.')
      await loadPlan(date)
      void loadOpenPlans().catch(() => undefined)
    } catch {
      setError('Não foi possível descartar este planejamento.')
    } finally {
      setDiscarding(false)
    }
  }

  async function refreshPlanning() {
    setError('')
    try {
      await Promise.all([
        loadOpenPlans(),
        loadAvailability(date),
        loadPlan(date),
        loadDemandHistory(date, breads),
      ])
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
    <div className={`ps-canvas ${styles.canvas}`}>
      <div className={`ps-shell ${styles.shell}`}>
        <header className={`ps-header ${styles.header}`}>
          <div className="ps-wordmark">
            <div className="ps-mark">P</div>
            <div className="ps-brand">
              <b>Planejamento</b>
              <span>JC e JA</span>
            </div>
          </div>
          {user && (
            <div className={`ps-userchip ${styles.userChip}`}>
              <div className="ps-avatar" style={{ background: roleColor(user.role) }}>
                {user.displayName.charAt(0).toUpperCase()}
              </div>
              <b>{user.displayName}</b>
            </div>
          )}
        </header>
        <div className={`ps-scroll ps-pad ${styles.scroll}`}>{children}</div>
      </div>
    </div>
  )

  if (!ready || user?.role !== 'admin') return shell(<div className="ps-empty">Carregando...</div>)

  return shell(
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroMain}>
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>Produção · JC + JA</span>
            <h1 className={`ps-page-title ${styles.title}`}><CalendarCheck size={26} /> Planejamento</h1>
            <p className={styles.lead}>Escolha o dia, distribua a produção e acompanhe o total das lojas.</p>
          </div>
          <div className={styles.heroDate} aria-label={`Dia selecionado: ${dayDateLabel(date)}`}>
            <span>Dia selecionado</span>
            <strong>{dayDateLabel(date)}</strong>
          </div>
        </div>
      </section>

      {openPlans.length > 0 && (
        <section className={styles.openPlans}>
          <div className={styles.openPlansHead}>
            <div>
              <span className={styles.openPlansLabel}>Em andamento</span>
              <b>Outros planejamentos</b>
            </div>
            <span className={styles.countBadge}>{openPlans.length}</span>
          </div>

          <div className={styles.openPlanList}>
            {openPlans.map(openPlan => {
              const expired = planDateIsExpiredForOrders(openPlan.production_date, todayDate)

              return (
                <button
                  key={openPlan.id}
                  type="button"
                  className={`${styles.openPlanButton} ${openPlan.production_date === date ? styles.openPlanSelected : ''}`}
                  aria-pressed={openPlan.production_date === date}
                  onClick={() => openPlanDate(openPlan.production_date)}
                >
                  <span className={styles.openPlanCopy}>
                    <b>{dateLabel(openPlan.production_date)}</b>
                    <small className={expired ? styles.expiredPlan : ''}>
                      {expired
                        ? 'Data já passou — não vira mais pedido'
                        : PRODUCTION_PLAN_STATUS_LABELS[openPlan.status]}
                      {openPlan.partiallyConverted
                        && ' · parte já virou pedido; os números são o que falta'}
                    </small>
                  </span>
                  <span className={styles.openPlanTotals}>
                    <span>Total <b>{openPlan.total}</b></span>
                    <span>JC <b>{openPlan.storeTotals.jc}</b></span>
                    <span>JA <b>{openPlan.storeTotals.ja}</b></span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      <section className={styles.datePicker}>
        <div className={styles.datePickerHead}>
          <span className={styles.pickerLabel} id="ps-planejamento-dia">Planejar para</span>
          <button type="button" className={styles.refreshButton} onClick={() => void refreshPlanning()} disabled={planLoading}>
            <RefreshCw size={14} /> Atualizar
          </button>
        </div>
        <div className={styles.days} role="group" aria-labelledby="ps-planejamento-dia">
          {[1, 2, 3, 4, 5, 6].map(i => {
            // Compara a DATA, e não o dia da semana: ao abrir um planejamento
            // antigo pela lista, o botão daquele dia acenderia, e um toque nele
            // trocaria de plano sem aviso — a próxima segunda não é a segunda
            // que está aberta na tela.
            const dayDate = nextOccurrenceOfDay(i, todayDate)

            return (
              <button
                key={i}
                type="button"
                className={styles.dayButton}
                aria-pressed={date === dayDate}
                // Relê o relógio no toque: a tela do celular fica aberta a
                // noite inteira, e uma data calculada antes da meia-noite
                // mandaria o toque para o dia de hoje, que não vira pedido.
                onClick={() => setDate(nextOccurrenceOfDay(i, readBakeryClock().dateKey))}
              >
                <span>{DAYS_PT[i]}</span>
                <small>{dayDate.slice(8, 10)}</small>
              </button>
            )
          })}
        </div>
        <time className={styles.selectedDate} dateTime={date}>
          {dayDateLabel(date)}
        </time>
      </section>

      {error && (
        <div className={`ps-card ${styles.alert} ${styles.alertDanger}`} role="alert">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {planLoading && <div className={`ps-empty ${styles.loading}`}>Carregando planejamento...</div>}

      {!planLoading && !plan && (
        <div className={`ps-card ${styles.emptyPlan}`}>
          <div className="ps-card-head">
            <div>
              <b>{dateLabel(date)}</b>
              <p style={{ margin: '4px 0 0', color: 'var(--ink-soft)', fontSize: 13 }}>
                {breadsState === 'ready' && `${expectedBreads.length} pães previstos para a data.`}
                {breadsState === 'loading' && 'Carregando os pães previstos para a data.'}
                {breadsState === 'error' && 'Não foi possível carregar os pães. Toque em Atualizar para tentar de novo.'}
              </p>
            </div>
          </div>
          {planDateIsExpiredForOrders(date, todayDate) && (
            <p style={{ margin: '0 0 10px', color: 'var(--berry)', fontSize: 13, fontWeight: 700 }}>
              <AlertTriangle size={14} /> A Produção só oferece de amanhã em diante. Planejamento
              criado nesta data não vira pedido.
            </p>
          )}
          <button type="button" className="ps-btn primary block" onClick={createPlan} disabled={creating || breadsState !== 'ready'}>
            <Plus size={17} /> {creating ? 'Criando...' : 'Criar rascunho'}
          </button>
        </div>
      )}

      {!planLoading && plan && (
        <>
          <div className={`ps-banner honey ${styles.statusBanner}`}>
            <span>
              {dateLabel(plan.production_date)} {' - '} {planningHasOrderConversion ? 'Pedido gerado' : PRODUCTION_PLAN_STATUS_LABELS[plan.status]}
            </span>
          </div>

          <section className={`ps-card ${styles.summaryCard}`} data-plan-id={plan.id}>
            <div className={styles.summaryLayout}>
              <div className={styles.summaryStats}>
                <div className={`${styles.stat} ${styles.statPrimary}`}>
                  <span>Total planejado</span>
                  <strong>{totalPlanned}</strong>
                  <small>{filledBreadCount} {filledBreadCount === 1 ? 'pão preenchido' : 'pães preenchidos'}</small>
                </div>
                {storeTotals.map(row => (
                  <div key={row.store} className={styles.stat}>
                    <span>{STORE_LABEL[row.store]}</span>
                    <strong>{row.total}</strong>
                    <small>unidades</small>
                  </div>
                ))}
              </div>
              <div className={styles.summaryActions}>
                {canEdit && (
                  <button type="button" className="ps-btn primary" onClick={savePlan} disabled={saving}>
                    <Save size={17} /> {saving ? 'Salvando...' : 'Salvar'}
                  </button>
                )}
                {canDiscard && (
                  <button type="button" className="ps-btn danger" onClick={discardPlan} disabled={discarding}>
                    <Trash2 size={17} /> {discarding ? 'Descartando...' : 'Descartar'}
                  </button>
                )}
              </div>
            </div>
          </section>

          {planDateExpired && (
            <div className={`ps-card ${styles.alert} ${styles.alertDanger}`} role="alert">
              <AlertTriangle size={16} /> Essa data já passou. A Produção só oferece de amanhã em diante,
              então este planejamento não vira mais pedido — descarte e crie um na data certa.
            </div>
          )}

          {!canEdit && (
            <div className={`ps-card ${styles.alert} ${styles.alertWarning}`} role="status">
              <AlertTriangle size={16} /> {planningFullyConvertedToOrder
                ? 'Esse planejamento ja virou pedido e nao pode mais ser alterado aqui.'
                : planningHasOrderConversion
                  ? 'Parte deste planejamento ja virou pedido e nao pode mais ser alterada aqui.'
                : 'Planejamento travado.'}
            </div>
          )}

          <div className={styles.sectionHeading}>
            <div>
              <span>Produção</span>
              <h2><Croissant size={22} strokeWidth={1.8} aria-hidden="true" /> Pães</h2>
            </div>
            <strong>{visibleBreads.length}</strong>
          </div>
          <div className={styles.breadGrid}>
            {visibleBreads.map(bread => {
              const breadItems = itemsByBread.get(bread.id) ?? []
              const extra = breadItems.some(item => item.is_extra)
              const breadTotal = breadItems.reduce((total, item) => total + plannedTotalForItem(item), 0)
              const breadFrozenAvailable = PRODUCTION_PLAN_STORES
                .reduce((total, store) => total + (frozenAvailability[itemKey(store, bread.id)] ?? 0), 0)
              const breadLeftoverAvailable = PRODUCTION_PLAN_STORES
                .reduce((total, store) => total + (leftoverAvailability[itemKey(store, bread.id)] ?? 0), 0)

              return (
                <article key={bread.id} className={`ps-card ${styles.breadCard} ${breadTotal > 0 ? `active ${styles.breadCardActive}` : ''}`}>
                  <div className="ps-card-head">
                    <div>
                      <div className="ps-pname">{bread.name}</div>
                      {extra && <span style={{ fontSize: 12, color: 'var(--ink-soft)', fontWeight: 700 }}>Avulso desta data</span>}
                    </div>
                    <span className={styles.breadTotals}>
                      {breadFrozenAvailable > 0 && (
                        <span className="ps-store-chip"><Snowflake size={13} /> {breadFrozenAvailable}</span>
                      )}
                      {breadLeftoverAvailable > 0 && (
                        <span className="ps-store-chip"><PackageOpen size={13} /> {breadLeftoverAvailable}</span>
                      )}
                      <span className="ps-store-chip">Total {breadTotal}</span>
                    </span>
                  </div>

                  <BreadDemandHistoryBlock
                    state={demandHistoryState}
                    summary={demandHistory[bread.id]}
                    onRetry={() => void loadDemandHistory(date, breads)}
                  />

                  <div className={`ps-grid ${styles.storeGrid}`}>
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
                      const newProduction = item
                        ? calculateNewProductionQuantity({
                          newQuantity: fresh,
                          frozenQuantity: frozen,
                          leftoverProposedQuantity: leftoverProposal,
                          leftoverConfirmedQuantity: leftoverConfirmed,
                        })
                        : calculateNewProductionQuantity({
                          newQuantity: fresh,
                          frozenQuantity: frozen,
                          leftoverProposedQuantity: leftover,
                        })
                      const total = item
                        ? plannedTotalForItem(item)
                        : calculatePlannedTotalQuantity({ newQuantity: fresh })

                      return (
                        <div key={store} className={`ps-fieldgroup ${styles.storePanel}`}>
                          <label className="ps-fieldgroup" style={{ margin: 0 }}>
                            <span className="ps-fieldlabel">{STORE_LABEL[store]} total</span>
                            <input
                              className={`ps-input ${styles.quantityInput}`}
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
                            <label className={styles.optionRow} style={{ color: canToggleFrozen || useFrozen ? 'var(--ps-ink)' : 'var(--ink-faint)' }}>
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
                            <span className={styles.unavailableOption}>
                              <Snowflake size={13} /> Congelados: 0 disp.
                            </span>
                          )}
                          {useFrozen && (
                            <input
                              className={`ps-input ${styles.secondaryInput}`}
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
                            <label className={styles.optionRow} style={{ color: canToggleLeftover || useLeftover ? 'var(--ps-ink)' : 'var(--ink-faint)' }}>
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
                            <span className={styles.unavailableOption}>
                              <PackageOpen size={13} /> Sobra: 0 disp.
                            </span>
                          )}
                          {useLeftover && (
                            <input
                              className={`ps-input ${styles.secondaryInput}`}
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

                          <span className={styles.formula}>
                            Total: {total} = novo {newProduction} + congelado {frozen} + sobra {leftover}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </article>
              )
            })}
          </div>

          {canEdit && (
            <section className={`ps-card ${styles.extraCard}`}>
              <label className="ps-fieldgroup" style={{ margin: 0 }}>
                <span className="ps-fieldlabel">Incluir pão avulso</span>
                <div className={styles.searchField}>
                  <Search size={16} style={{ position: 'absolute', left: 12, top: 13, color: 'var(--ink-faint)' }} />
                  <input
                    className="ps-input"
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    placeholder="Buscar pão"
                    style={{ paddingLeft: 40 }}
                  />
                </div>
              </label>

              {availableExtras.length > 0 && (
                <div className={styles.extraList}>
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
    </main>,
  )
}
