'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Clock3,
  LoaderCircle,
  MapPin,
  PackageOpen,
  Snowflake,
} from 'lucide-react'
import { getCurrentUserAsync, type AppUser } from '@/lib/auth'
import {
  leftoverAgeDays,
  validateDestinationQuantity,
  type LeftoverDestination,
  type ManagedStore,
} from '@/lib/breadLeftovers'
import { isValidClosingDate } from '@/lib/breadLeftoverClosing'
import { supabase } from '@/lib/supabase'
import { formatDateBR, showToast, todayKey } from '@/lib/utils'

interface BreadRow {
  id: string
  name: string
  unit: string | null
}

interface LeftoverRow {
  id: string
  store: ManagedStore
  product_id: string
  quantity: number
  pending_quantity: number
  record_date: string
  lot_code: string
  physical_location: PhysicalLocation
  reconciliation_status: 'awaiting_oven' | 'confirmed' | 'not_required'
}

interface ReusePlanRow {
  id: string
  bread_id: string
  proposed_quantity: number
  confirmed_quantity: number | null
  status: 'proposed' | 'confirmed' | 'cancelled'
}

interface OrderRow {
  bread_id: string
  quantity: number | null
}

type PhysicalLocation = 'balcao_fechamento' | 'mesa_separacao' | 'padaria_cozinha'

const STORE_LABELS: Record<ManagedStore, string> = {
  jc: 'Júlio de Castilhos',
  ja: 'Jardim América',
}

const LOCATION_LABELS: Record<PhysicalLocation, string> = {
  balcao_fechamento: 'Balcão de fechamento',
  mesa_separacao: 'Mesa de separação',
  padaria_cozinha: 'Padaria / cozinha',
}

const DESTINATIONS: { value: LeftoverDestination; label: string }[] = [
  { value: 'display', label: 'Volta à vitrine' },
  { value: 'internal_use', label: 'Consumo interno' },
  { value: 'donation', label: 'Doação' },
  { value: 'discard', label: 'Descarte' },
  { value: 'freeze', label: 'Congelar' },
]

const FREEZER_LABELS: Record<string, string> = {
  'jc-freezer': 'Freezer da produção JC',
  'jc-camara': 'Câmara fria JC',
  'jc-freezer-loja': 'Freezer da loja JC',
  'ja-freezer': 'Freezer JA',
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String(error.message)
  }
  return 'Não foi possível concluir a operação.'
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(value)
}

export default function BreadLeftoverPendingPage() {
  const [user, setUser] = useState<AppUser | null>(null)
  const [store, setStore] = useState<ManagedStore>('jc')
  const [targetDate, setTargetDate] = useState(todayKey())
  const [breads, setBreads] = useState<Record<string, BreadRow>>({})
  const [leftovers, setLeftovers] = useState<LeftoverRow[]>([])
  const [plans, setPlans] = useState<ReusePlanRow[]>([])
  const [orders, setOrders] = useState<Record<string, number>>({})
  const [confirmedInputs, setConfirmedInputs] = useState<Record<string, string>>({})
  const [destinationInputs, setDestinationInputs] = useState<Record<string, string>>({})
  const [destinations, setDestinations] = useState<Record<string, LeftoverDestination>>({})
  const [freezerInputs, setFreezerInputs] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState('')
  const [loadError, setLoadError] = useState('')
  const [emailRequired, setEmailRequired] = useState(false)

  useEffect(() => {
    let active = true
    void getCurrentUserAsync().then(current => {
      if (!active) return
      setUser(current)
      const params = new URLSearchParams(window.location.search)
      const requestedStore = params.get('store')
      const requestedDate = params.get('date')

      if (current?.store === 'ja' || current?.store === 'jc') {
        setStore(current.store)
      } else if (requestedStore === 'ja' || requestedStore === 'jc') {
        setStore(requestedStore)
      }
      if (requestedDate && isValidClosingDate(requestedDate, todayKey())) {
        setTargetDate(requestedDate)
      }
    })
    return () => { active = false }
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const sessionResult = await supabase.auth.getSession()
      if (sessionResult.error) throw sessionResult.error
      if (!sessionResult.data.session) {
        setEmailRequired(true)
        setLeftovers([])
        setPlans([])
        return
      }
      setEmailRequired(false)

      const [leftoversResult, plansResult, ordersResult] = await Promise.all([
        supabase
          .from('sobras')
          .select('id, store, product_id, quantity, pending_quantity, record_date, lot_code, physical_location, reconciliation_status')
          .eq('store', store)
          .eq('product_source', 'bread')
          .or('pending_quantity.gt.0,reconciliation_status.eq.awaiting_oven')
          .order('record_date', { ascending: true })
          .order('created_at', { ascending: true }),
        supabase
          .from('bread_reuse_plans')
          .select('id, bread_id, proposed_quantity, confirmed_quantity, status')
          .eq('target_production_date', targetDate)
          .eq('store', store)
          .neq('status', 'cancelled')
          .order('proposed_at', { ascending: true }),
        supabase
          .from('orders')
          .select('bread_id, quantity')
          .eq('order_date', targetDate)
          .eq('store', store),
      ])

      const firstError = leftoversResult.error ?? plansResult.error ?? ordersResult.error
      if (firstError) throw firstError

      const loadedLeftovers = (leftoversResult.data ?? []) as LeftoverRow[]
      const loadedPlans = (plansResult.data ?? []) as ReusePlanRow[]
      const loadedOrders = (ordersResult.data ?? []) as OrderRow[]
      const breadIds = Array.from(new Set([
        ...loadedLeftovers.map(row => row.product_id),
        ...loadedPlans.map(row => row.bread_id),
      ]))

      const breadMap: Record<string, BreadRow> = {}
      if (breadIds.length > 0) {
        const breadResult = await supabase
          .from('breads')
          .select('id, name, unit')
          .in('id', breadIds)
        if (breadResult.error) throw breadResult.error
        for (const bread of (breadResult.data ?? []) as BreadRow[]) breadMap[bread.id] = bread
      }

      const orderMap: Record<string, number> = {}
      for (const order of loadedOrders) {
        orderMap[order.bread_id] = (orderMap[order.bread_id] ?? 0) + Number(order.quantity ?? 0)
      }

      setBreads(breadMap)
      setLeftovers(loadedLeftovers)
      setPlans(loadedPlans)
      setOrders(orderMap)
      setConfirmedInputs(Object.fromEntries(
        loadedPlans.map(plan => [plan.id, String(plan.confirmed_quantity ?? plan.proposed_quantity)]),
      ))
      setDestinationInputs(Object.fromEntries(
        loadedLeftovers.map(leftover => [leftover.id, String(leftover.pending_quantity)]),
      ))
      setDestinations(Object.fromEntries(
        loadedLeftovers.map(leftover => [leftover.id, 'display' as LeftoverDestination]),
      ))
      setFreezerInputs(Object.fromEntries(
        loadedLeftovers.map(leftover => [leftover.id, leftover.store === 'jc' ? 'jc-freezer' : 'ja-freezer']),
      ))
    } catch (error: unknown) {
      setLoadError(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [store, targetDate])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const overdueCount = useMemo(
    () => leftovers.filter(leftover => leftover.pending_quantity > 0 && leftoverAgeDays(leftover.record_date, todayKey()) >= 1).length,
    [leftovers],
  )
  const pendingLeftovers = useMemo(
    () => leftovers.filter(leftover => leftover.pending_quantity > 0),
    [leftovers],
  )
  const awaitingOven = useMemo(
    () => leftovers.filter(leftover => leftover.reconciliation_status === 'awaiting_oven'),
    [leftovers],
  )

  async function confirmReuse(plan: ReusePlanRow) {
    const rawQuantity = confirmedInputs[plan.id]?.trim() ?? ''
    if (!/^\d+$/.test(rawQuantity)) {
      showToast('Informe uma quantidade inteira para confirmar.')
      return
    }
    const quantity = Number(rawQuantity)
    if (quantity > plan.proposed_quantity) {
      showToast('A confirmação não pode superar a proposta.')
      return
    }

    setSavingId(`plan-${plan.id}`)
    try {
      const { error } = await supabase.rpc('confirm_bread_reuse_plan', {
        p_plan_id: plan.id,
        p_confirmed_quantity: quantity,
      })
      if (error) throw error
      showToast('Reaproveitamento confirmado. O previsto do Forno foi atualizado.')
      await loadData()
    } catch (error: unknown) {
      showToast(`Erro: ${errorMessage(error)}`)
    } finally {
      setSavingId('')
    }
  }

  async function resolveLeftover(leftover: LeftoverRow) {
    const quantity = validateDestinationQuantity(
      destinationInputs[leftover.id] ?? '',
      Number(leftover.pending_quantity),
    )
    if (quantity === null) {
      showToast('Informe uma quantidade válida, até o saldo pendente.')
      return
    }
    const action = destinations[leftover.id] ?? 'display'
    if (action === 'freeze' && !Number.isInteger(quantity)) {
      showToast('O estoque congelado aceita somente unidades inteiras.')
      return
    }
    const freezerLocation = action === 'freeze'
      ? freezerInputs[leftover.id] ?? (store === 'jc' ? 'jc-freezer' : 'ja-freezer')
      : null

    setSavingId(`leftover-${leftover.id}`)
    try {
      const { error } = await supabase.rpc('resolve_bread_leftover', {
        p_sobra_id: leftover.id,
        p_action: action,
        p_quantity: quantity,
        p_freezer_location: freezerLocation,
      })
      if (error) throw error
      showToast('Destino registrado e saldo atualizado.')
      await loadData()
    } catch (error: unknown) {
      showToast(`Erro: ${errorMessage(error)}`)
    } finally {
      setSavingId('')
    }
  }

  async function updateLocation(leftover: LeftoverRow, location: PhysicalLocation) {
    setSavingId(`location-${leftover.id}`)
    try {
      const { error } = await supabase.rpc('update_bread_leftover_location', {
        p_sobra_id: leftover.id,
        p_physical_location: location,
      })
      if (error) throw error
      showToast('Local físico atualizado.')
      await loadData()
    } catch (error: unknown) {
      showToast(`Erro: ${errorMessage(error)}`)
    } finally {
      setSavingId('')
    }
  }

  const storeLocked = user?.role === 'vendas' && (user.store === 'jc' || user.store === 'ja')
  const notApplicable = user?.role === 'vendas' && user.store === 'ex'

  if (loading) {
    return <div className="ps-loading"><div className="ps-spinner" /><p>Carregando pendências...</p></div>
  }

  return (
    <div className="ps-canvas">
      <div className="ps-shell ps-fadein">
        <header className="ps-header">
          <div className="ps-wordmark">
            <div className="ps-mark">P</div>
            <div className="ps-brand"><b>Pane &amp; Salute</b><span>Central de sobras</span></div>
          </div>
          <Link href="/sobras" className="ps-iconbtn" aria-label="Voltar para lançamentos">
            <ArrowLeft size={19} />
          </Link>
        </header>

        <main className="ps-pad ps-leftover-page">
          <p className="ps-leftover-intro">
            Tudo que ainda está esperando uso, congelamento, doação ou descarte.
          </p>

          {notApplicable ? (
            <div className="ps-leftover-alert">
              <PackageOpen size={21} />
              <div><b>EX não participa deste fluxo</b><span>A produção enviada para a Exposição é venda por romaneio; a sobra da loja não afeta o CMV da produção.</span></div>
            </div>
          ) : emailRequired ? (
            <div className="ps-leftover-alert" role="alert">
              <AlertTriangle size={21} />
              <div><b>Entrada por e-mail necessária</b><span>Saia e entre com e-mail para movimentar estoque com identificação.</span></div>
            </div>
          ) : loadError ? (
            <div className="ps-leftover-alert" role="alert">
              <AlertTriangle size={21} />
              <div><b>Não foi possível carregar</b><span>{loadError}</span></div>
              <button type="button" className="ps-btn sm" onClick={() => void loadData()}>Tentar novamente</button>
            </div>
          ) : (
            <>
              <div className="ps-leftover-filters">
                <div>
                  <label className="ps-label" htmlFor="leftover-store">Loja</label>
                  <select
                    id="leftover-store"
                    className="ps-select"
                    value={store}
                    disabled={storeLocked}
                    onChange={event => setStore(event.target.value as ManagedStore)}
                  >
                    <option value="jc">Júlio de Castilhos</option>
                    <option value="ja">Jardim América</option>
                  </select>
                </div>
                <div>
                  <label className="ps-label" htmlFor="reuse-date">Produção planejada</label>
                  <input
                    id="reuse-date"
                    className="ps-input"
                    type="date"
                    value={targetDate}
                    onChange={event => setTargetDate(event.target.value)}
                  />
                </div>
              </div>

              {overdueCount > 0 && (
                <div className="ps-leftover-overdue">
                  <Clock3 size={19} />
                  <div><b>{overdueCount} {overdueCount === 1 ? 'lote precisa' : 'lotes precisam'} de resolução hoje</b><span>Sobra do dia anterior não pode seguir pendente no próximo fechamento.</span></div>
                </div>
              )}

              {awaitingOven.length > 0 && (
                <div className="ps-leftover-alert">
                  <Clock3 size={19} />
                  <div>
                    <b>{awaitingOven.length} {awaitingOven.length === 1 ? 'pão aguarda' : 'pães aguardam'} o Forno</b>
                    <span>
                      {awaitingOven.map(leftover => breads[leftover.product_id]?.name ?? leftover.product_id).join(', ')}.
                      {' '}A contagem e os destinos estão preservados; o lote será ligado automaticamente.
                    </span>
                  </div>
                </div>
              )}

              <section>
                <div className="ps-section">
                  <div className="bar" />
                  <b>Conferir reaproveitamento</b>
                  <span className="meta">{STORE_LABELS[store]}</span>
                </div>

                {plans.length === 0 ? (
                  <div className="ps-empty ps-leftover-empty">Nenhuma proposta para {formatDateBR(targetDate)}.</div>
                ) : (
                  <div className="ps-grid">
                    {plans.map(plan => {
                      const bread = breads[plan.bread_id]
                      const isSaving = savingId === `plan-${plan.id}`
                      const confirmed = plan.status === 'confirmed'
                      return (
                        <article key={plan.id} className={`ps-card ps-reuse-card${confirmed ? ' confirmed' : ''}`}>
                          <div className="ps-leftover-card-head">
                            <div><div className="ps-pname">{bread?.name ?? plan.bread_id}</div><span>Pedido da loja: {orders[plan.bread_id] ?? 0}</span></div>
                            <div className="ps-reuse-proposed"><span>Rodrigo propôs</span><b>{plan.proposed_quantity}</b></div>
                          </div>
                          {confirmed ? (
                            <div className="ps-reuse-confirmed"><Check size={19} /><b>{plan.confirmed_quantity ?? 0} confirmados</b><span>Já reduziu o previsto do Forno.</span></div>
                          ) : (
                            <>
                              <label className="ps-label" htmlFor={`confirmed-${plan.id}`}>Quantos estão aptos a voltar?</label>
                              <input
                                id={`confirmed-${plan.id}`}
                                className="ps-qty ps-leftover-qty"
                                type="number"
                                inputMode="numeric"
                                min={0}
                                max={plan.proposed_quantity}
                                step={1}
                                value={confirmedInputs[plan.id] ?? ''}
                                onChange={event => setConfirmedInputs(current => ({ ...current, [plan.id]: event.target.value }))}
                              />
                              <button type="button" className="ps-btn success block" disabled={isSaving} onClick={() => void confirmReuse(plan)}>
                                {isSaving ? <LoaderCircle className="ps-spin" size={19} /> : <Check size={19} />}
                                Confirmar para a vitrine
                              </button>
                            </>
                          )}
                        </article>
                      )
                    })}
                  </div>
                )}
              </section>

              <section>
                <div className="ps-section">
                  <div className="bar" />
                  <b>Sem destino</b>
                  <span className="meta">{pendingLeftovers.length} {pendingLeftovers.length === 1 ? 'lote' : 'lotes'}</span>
                </div>

                {pendingLeftovers.length === 0 ? (
                  <div className="ps-empty ps-leftover-empty"><PackageOpen size={30} /><span>Nenhuma sobra pendente nesta loja.</span></div>
                ) : (
                  <div className="ps-grid">
                    {pendingLeftovers.map(leftover => {
                      const bread = breads[leftover.product_id]
                      const age = leftoverAgeDays(leftover.record_date, todayKey())
                      const destination = destinations[leftover.id] ?? 'display'
                      const isSaving = savingId === `leftover-${leftover.id}`
                      const locationSaving = savingId === `location-${leftover.id}`
                      return (
                        <article key={leftover.id} className={`ps-card ps-leftover-card${age >= 1 ? ' overdue' : ''}`}>
                          <div className="ps-leftover-card-head">
                            <div>
                              <div className="ps-pname">{bread?.name ?? leftover.product_id}</div>
                              <span>Lote {leftover.lot_code} · {formatDateBR(leftover.record_date)}</span>
                            </div>
                            <div className="ps-leftover-balance"><span>Sem destino</span><b>{formatQuantity(leftover.pending_quantity)}</b><small>{bread?.unit ?? 'un'}</small></div>
                          </div>

                          {age >= 1 && <div className="ps-leftover-age"><Clock3 size={15} /> Pendente desde ontem</div>}
                          {leftover.reconciliation_status === 'awaiting_oven' && (
                            <div className="ps-leftover-age"><Clock3 size={15} /> Lote provisório · aguardando Forno</div>
                          )}

                          <label className="ps-label" htmlFor={`location-${leftover.id}`}><MapPin size={14} /> Onde está?</label>
                          <select
                            id={`location-${leftover.id}`}
                            className="ps-select"
                            value={leftover.physical_location}
                            disabled={locationSaving || Boolean(savingId)}
                            onChange={event => void updateLocation(leftover, event.target.value as PhysicalLocation)}
                          >
                            {Object.entries(LOCATION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </select>

                          <div className="ps-leftover-destination-row">
                            <div>
                              <label className="ps-label" htmlFor={`destination-${leftover.id}`}>Destino</label>
                              <select
                                id={`destination-${leftover.id}`}
                                className="ps-select"
                                value={destination}
                                onChange={event => setDestinations(current => ({ ...current, [leftover.id]: event.target.value as LeftoverDestination }))}
                              >
                                {DESTINATIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="ps-label" htmlFor={`quantity-${leftover.id}`}>Quantidade</label>
                              <input
                                id={`quantity-${leftover.id}`}
                                className="ps-input"
                                type="text"
                                inputMode="decimal"
                                value={destinationInputs[leftover.id] ?? ''}
                                onChange={event => setDestinationInputs(current => ({ ...current, [leftover.id]: event.target.value }))}
                              />
                            </div>
                          </div>

                          {destination === 'freeze' && (
                            <div>
                              <label className="ps-label" htmlFor={`freezer-${leftover.id}`}>Em qual freezer?</label>
                              <select
                                id={`freezer-${leftover.id}`}
                                className="ps-select"
                                value={freezerInputs[leftover.id] ?? (store === 'jc' ? 'jc-freezer' : 'ja-freezer')}
                                onChange={event => setFreezerInputs(current => ({ ...current, [leftover.id]: event.target.value }))}
                              >
                                {(store === 'jc'
                                  ? ['jc-freezer', 'jc-camara', 'jc-freezer-loja']
                                  : ['ja-freezer']
                                ).map(value => <option key={value} value={value}>{FREEZER_LABELS[value]}</option>)}
                              </select>
                            </div>
                          )}

                          <button type="button" className="ps-btn primary block" disabled={isSaving || Boolean(savingId && !isSaving)} onClick={() => void resolveLeftover(leftover)}>
                            {isSaving
                              ? <LoaderCircle className="ps-spin" size={19} />
                              : destination === 'freeze' ? <Snowflake size={18} /> : <Check size={18} />}
                            Registrar destino
                          </button>
                        </article>
                      )
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
