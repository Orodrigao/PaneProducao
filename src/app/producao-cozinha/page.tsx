'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChefHat, Minus, Plus, Save } from 'lucide-react'
import { getCurrentUserAsync, roleColor, type AppUser } from '@/lib/auth'
import { formatDate, formatDateBR, showToastPS, todayKey } from '@/lib/utils'
import { KitchenDaySummary } from '@/components/kitchen/KitchenDaySummary'
import {
  KITCHEN_MAX_QUANTITY,
  buildKitchenBatchRequests,
  buildKitchenDaySummary,
  describeKitchenError,
  formatKitchenQuantity,
  groupKitchenItems,
  isEmptyKitchenBatchRequest,
  kitchenDaySummaryTotals,
  kitchenStoresForUser,
  normalizeKitchenStore,
  kitchenTotalsByUnit,
  normalizeKitchenPlanRow,
  sanitizeKitchenQuantity,
  type KitchenEntry,
  type KitchenItem,
  type KitchenPermission,
  type KitchenPlanItem,
  type KitchenStore,
} from '@/lib/kitchenProduction'
import {
  loadKitchenEntries,
  loadKitchenItems,
  loadKitchenProductionPlan,
  loadKitchenPermissions,
  recordKitchenBatches,
} from '@/lib/kitchenProductionClient'

const STORE_LABEL: Record<KitchenStore, string> = {
  jc: 'Júlio de Castilhos',
  ja: 'Jardim América',
  ex: 'Exposição',
}

function requestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const value = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
}

export default function ProducaoCozinhaPage() {
  const router = useRouter()
  const [user, setUser] = useState<AppUser | null>(null)
  const [permissions, setPermissions] = useState<KitchenPermission[]>([])
  const [ready, setReady] = useState(false)
  const [items, setItems] = useState<KitchenItem[]>([])
  const [entries, setEntries] = useState<KitchenEntry[]>([])
  const [plan, setPlan] = useState<KitchenPlanItem[]>([])
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [store, setStore] = useState<KitchenStore | null>(null)
  const [date, setDate] = useState(todayKey())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveRequestId, setSaveRequestId] = useState('')
  const [loadError, setLoadError] = useState('')

  const isAdmin = user?.role === 'admin'
  const allowedStores = useMemo(
    () => (user ? kitchenStoresForUser(permissions, isAdmin) : []),
    [user, permissions, isAdmin],
  )
  const today = todayKey()
  const dateIsOpen = date === today
  const allItems = useMemo(() => {
    const merged = new Map(items.map(item => [item.id, item]))
    for (const row of plan) {
      if (!merged.has(row.productId)) {
        merged.set(row.productId, {
          id: row.productId,
          name: row.productName,
          category: 'Planejados',
          unit: row.unit,
          production_process: row.process,
        })
      }
    }
    return Array.from(merged.values())
  }, [items, plan])
  const batchTotals = kitchenTotalsByUnit(quantities, allItems)
  const daySummary = buildKitchenDaySummary(allItems, entries)
  const dayTotals = kitchenDaySummaryTotals(daySummary)
  const groups = useMemo(() => groupKitchenItems(allItems), [allItems])
  const lastEntry = useMemo(
    () => entries.reduce<KitchenEntry | null>((latest, entry) => {
      return !latest || entry.produced_at > latest.produced_at ? entry : latest
    }, null),
    [entries],
  )

  useEffect(() => {
    let alive = true

    void (async () => {
      const current = await getCurrentUserAsync()
      if (!alive) return
      if (!current) { router.replace('/login'); return }

      setUser(current)
      try {
        const granted = await loadKitchenPermissions()
        if (!alive) return
        setPermissions(granted)
        const stores = kitchenStoresForUser(granted, current.role === 'admin')
        const preferred = normalizeKitchenStore(current.store)
        setStore(preferred && stores.includes(preferred) ? preferred : stores[0] ?? null)
      } catch {
        if (alive) setLoadError('Não foi possível conferir seu acesso. Tente de novo.')
      } finally {
        if (alive) setReady(true)
      }
    })()

    return () => { alive = false }
  }, [router])

  const loadDay = useCallback(async (targetStore: KitchenStore, targetDate: string) => {
    setLoading(true)
    setLoadError('')
    try {
      const [kitchenItems, dayEntries, planRows] = await Promise.all([
        loadKitchenItems(),
        loadKitchenEntries(targetStore, targetDate),
        loadKitchenProductionPlan(targetStore, targetDate),
      ])
      const normalizedPlan = planRows.map(normalizeKitchenPlanRow)
      const plannedOnly = normalizedPlan.filter(row => !kitchenItems.some(item => item.id === row.productId))
      const saved: Record<string, number> = {}
      kitchenItems.forEach(item => { saved[item.id] = 0 })
      plannedOnly.forEach(item => { saved[item.productId] = 0 })
      setItems(kitchenItems)
      setEntries(dayEntries)
      setPlan(normalizedPlan)
      setQuantities(saved)
    } catch (error) {
      setLoadError(describeKitchenError(error))
      setItems([])
      setEntries([])
      setPlan([])
      setQuantities({})
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!ready || !store) { setLoading(false); return }
    void loadDay(store, date)
  }, [ready, store, date, loadDay])

  const setQuantity = (productId: string, value: number) => {
    const item = allItems.find(candidate => candidate.id === productId)
    setSaveRequestId('')
    setQuantities(prev => ({
      ...prev,
      [productId]: sanitizeKitchenQuantity(value, item?.unit),
    }))
  }

  const handleSave = async () => {
    if (!store) return
    const batches = buildKitchenBatchRequests({
      quantities,
      items: allItems,
    })

    if (isEmptyKitchenBatchRequest(batches)) {
      showToastPS('Informe pelo menos uma quantidade para salvar.')
      return
    }

    setSaving(true)
    const stableRequestId = saveRequestId || requestId()
    setSaveRequestId(stableRequestId)
    try {
      await recordKitchenBatches(store, batches, stableRequestId)
      setSaveRequestId('')
      await loadDay(store, date)
      showToastPS('Novo lote salvo!')
    } catch (error) {
      showToastPS(describeKitchenError(error))
    } finally {
      setSaving(false)
    }
  }

  const shell = (children: React.ReactNode) => (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <div className="ps-mark">P</div>
            <div className="ps-brand">
              <b>Produção da Cozinha</b>
              <span>Registro do dia</span>
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

  if (!ready) return shell(<div className="ps-empty">Carregando...</div>)

  if (!store) {
    return shell(
      <>
        <h1 className="ps-page-title"><ChefHat size={23} /> Cozinha</h1>
        <div className="ps-card" style={{ marginTop: 16 }}>
          <b>Sem acesso ao lançamento</b>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.45 }}>
            Seu usuário ainda não tem permissão para lançar a produção da cozinha.
            Peça ao administrador para conceder <b>Produção da Cozinha</b> na sua loja.
          </p>
        </div>
      </>,
    )
  }

  return shell(
    <>
      <h1 className="ps-page-title"><ChefHat size={23} /> Cozinha</h1>
      <p className="ps-page-lead">
        Informe somente o que acabou de ficar pronto. Cada salvamento cria um novo lote.
      </p>

      <section className="ps-filters" style={{ alignItems: 'stretch' }}>
        <label className="ps-fieldgroup">
          <span className="ps-fieldlabel">Dia</span>
          {isAdmin ? (
            <input
              type="date"
              value={date}
              onChange={event => setDate(event.target.value || today)}
              className="ps-input"
            />
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="ps-btn primary"
                onClick={() => setDate(today)}
              >
                Hoje
              </button>
            </div>
          )}
        </label>
        {allowedStores.length > 1 && (
          <label className="ps-fieldgroup">
            <span className="ps-fieldlabel">Loja</span>
            <select
              value={store}
              onChange={event => setStore(event.target.value as KitchenStore)}
              className="ps-select"
            >
              {allowedStores.map(option => (
                <option key={option} value={option}>{STORE_LABEL[option]}</option>
              ))}
            </select>
          </label>
        )}
      </section>

      <p className="ps-page-lead" style={{ marginTop: 4 }}>
        {STORE_LABEL[store]} · {formatDateBR(date)}
        {lastEntry?.produced_at && (
          <> · último lote às {formatDate(lastEntry.produced_at)}
            {lastEntry.recorded_by_name ? ` por ${lastEntry.recorded_by_name}` : ''}</>
        )}
      </p>

      {!loading && store === 'jc' && plan.length > 0 && (
        <section className="ps-card" style={{ marginTop: 12, gap: 10 }}>
          <b>Necessidades programadas para hoje</b>
          <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: 0 }}>
            O planejamento orienta o trabalho, mas não limita o que a Cozinha pode produzir.
          </p>
          {plan.map(row => {
            const balanceLabel = row.balanceQuantity > 0
              ? `Faltam ${formatKitchenQuantity(row.balanceQuantity, row.unit)}`
              : row.balanceQuantity < 0
                ? `Excedente ${formatKitchenQuantity(Math.abs(row.balanceQuantity), row.unit)}`
                : 'Planejado concluído'
            return (
              <div key={row.productId} style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 8 }}>
                <b style={{ fontSize: 14 }}>{row.productName}</b>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 3 }}>
                  Planejado {formatKitchenQuantity(row.plannedQuantity, row.unit)} · feito {formatKitchenQuantity(row.producedQuantity, row.unit)} · {balanceLabel}
                </div>
              </div>
            )
          })}
        </section>
      )}

      {loadError && (
        <div className="ps-card" style={{ borderColor: '#E6B5AC', color: 'var(--berry)' }}>{loadError}</div>
      )}

      {!dateIsOpen && (
        <div className="ps-card" style={{ borderColor: '#E6B5AC' }}>
          <b>Consulta de dia anterior</b>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.45 }}>
            Novos lotes recebem automaticamente o horário de agora. Volte para hoje para lançar.
          </p>
        </div>
      )}

      {loading && <div className="ps-empty">Carregando itens...</div>}

      {!loading && allItems.length === 0 && !loadError && (
        <div className="ps-card">
          <b>Nenhum item de cozinha cadastrado</b>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.45 }}>
            Esta tela mostra produtos de montagem ou preparo liberados para produção sem ordem,
            além dos que foram programados para hoje.
          </p>
        </div>
      )}

      {!loading && groups.map(group => (
        <div key={group.category}>
          <div className="ps-label">{group.category}</div>
          <div className="ps-grid">
            {group.items.map(item => {
              const quantity = quantities[item.id] ?? 0
              const increment = item.unit === 'kg' ? 0.1 : 1
              return (
                <div className="ps-card" key={item.id} style={{ gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                    <b style={{ fontSize: 15 }}>{item.name}</b>
                    {item.unit && (
                      <span style={{ fontSize: 11, color: 'var(--ink-faint)', fontWeight: 600 }}>{item.unit}</span>
                    )}
                  </div>
                  <div className="ps-stepper">
                    <button
                      type="button"
                      className="ps-step"
                      onClick={() => setQuantity(item.id, quantity - increment)}
                      disabled={!dateIsOpen || quantity === 0}
                      aria-label={`Diminuir ${item.name}`}
                    >
                      <Minus size={18} />
                    </button>
                    <input
                      className={`ps-qty${quantity === 0 ? ' zero' : ''}`}
                      type="number"
                      inputMode={item.unit === 'kg' ? 'decimal' : 'numeric'}
                      step={item.unit === 'kg' ? '0.001' : '1'}
                      min={0}
                      max={KITCHEN_MAX_QUANTITY}
                      value={quantity}
                      disabled={!dateIsOpen}
                      onFocus={event => event.currentTarget.select()}
                      onChange={event => setQuantity(item.id, Number(event.target.value))}
                      aria-label={`Quantidade produzida de ${item.name}`}
                    />
                    <button
                      type="button"
                      className="ps-step"
                      onClick={() => setQuantity(item.id, quantity + increment)}
                      disabled={!dateIsOpen || quantity >= KITCHEN_MAX_QUANTITY}
                      aria-label={`Aumentar ${item.name}`}
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {!loading && allItems.length > 0 && (
        <div className="ps-card" style={{ marginTop: 18, gap: 12 }}>
          <KitchenDaySummary
            title={date === today ? 'Produção de hoje' : 'Produção deste dia'}
            rows={daySummary}
            totals={dayTotals}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Este novo lote</span>
            <b style={{ fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>
              {Object.entries(batchTotals).length === 0
                ? '0'
                : Object.entries(batchTotals).map(([unit, total]) => formatKitchenQuantity(total, unit)).join(' · ')}
            </b>
          </div>
          <button
            type="button"
            className="ps-btn primary block"
            onClick={handleSave}
            disabled={saving || !dateIsOpen}
          >
            <Save size={17} /> {saving ? 'Salvando...' : 'Salvar produção'}
          </button>
        </div>
      )}
    </>,
  )
}
