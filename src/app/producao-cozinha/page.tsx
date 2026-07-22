'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChefHat, Minus, Plus, Save } from 'lucide-react'
import { getCurrentUserAsync, roleColor, type AppUser } from '@/lib/auth'
import { formatDate, formatDateBR, showToastPS, todayKey } from '@/lib/utils'
import {
  KITCHEN_MAX_QUANTITY,
  buildKitchenSavePlan,
  describeKitchenError,
  groupKitchenItems,
  isEmptyKitchenSavePlan,
  isKitchenDateOpen,
  kitchenStoresForUser,
  normalizeKitchenStore,
  sanitizeKitchenQuantity,
  shiftDateKey,
  totalKitchenQuantity,
  type KitchenEntry,
  type KitchenItem,
  type KitchenPermission,
  type KitchenStore,
} from '@/lib/kitchenProduction'
import {
  applyKitchenSavePlan,
  loadKitchenEntries,
  loadKitchenItems,
  loadKitchenPermissions,
} from '@/lib/kitchenProductionClient'

const STORE_LABEL: Record<KitchenStore, string> = {
  jc: 'Júlio de Castilhos',
  ja: 'Jardim América',
  ex: 'Exposição',
}

export default function ProducaoCozinhaPage() {
  const router = useRouter()
  const [user, setUser] = useState<AppUser | null>(null)
  const [permissions, setPermissions] = useState<KitchenPermission[]>([])
  const [ready, setReady] = useState(false)
  const [items, setItems] = useState<KitchenItem[]>([])
  const [entries, setEntries] = useState<KitchenEntry[]>([])
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [store, setStore] = useState<KitchenStore | null>(null)
  const [date, setDate] = useState(todayKey())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')

  const isAdmin = user?.role === 'admin'
  const allowedStores = useMemo(
    () => (user ? kitchenStoresForUser(permissions, isAdmin) : []),
    [user, permissions, isAdmin],
  )
  const today = todayKey()
  const dateIsOpen = isAdmin || isKitchenDateOpen(date, today)
  const total = totalKitchenQuantity(quantities)
  const groups = useMemo(() => groupKitchenItems(items), [items])
  const lastEntry = useMemo(
    () => entries.reduce<KitchenEntry | null>((latest, entry) => {
      if (!entry.updated_at) return latest
      return !latest?.updated_at || entry.updated_at > latest.updated_at ? entry : latest
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
      const [kitchenItems, dayEntries] = await Promise.all([
        loadKitchenItems(),
        loadKitchenEntries(targetStore, targetDate),
      ])
      const saved: Record<string, number> = {}
      kitchenItems.forEach(item => { saved[item.id] = 0 })
      dayEntries.forEach(entry => { saved[entry.product_id] = sanitizeKitchenQuantity(entry.quantity) })
      setItems(kitchenItems)
      setEntries(dayEntries)
      setQuantities(saved)
    } catch (error) {
      setLoadError(describeKitchenError(error))
      setItems([])
      setEntries([])
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
    setQuantities(prev => ({ ...prev, [productId]: sanitizeKitchenQuantity(value) }))
  }

  const handleSave = async () => {
    if (!store || !user) return
    const plan = buildKitchenSavePlan({
      store,
      recordDate: date,
      quantities,
      entries,
      recordedBy: user.id,
      recordedByName: user.displayName,
    })

    if (isEmptyKitchenSavePlan(plan)) {
      showToastPS('Nada mudou desde o último salvamento.')
      return
    }

    setSaving(true)
    try {
      await applyKitchenSavePlan(plan)
      await loadDay(store, date)
      showToastPS('Produção salva!')
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
        Informe quanto saiu de cada item hoje. Deixe em zero o que não foi produzido.
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
                className={`ps-btn${date === today ? ' primary' : ''}`}
                onClick={() => setDate(today)}
              >
                Hoje
              </button>
              <button
                type="button"
                className={`ps-btn${date !== today ? ' primary' : ''}`}
                onClick={() => setDate(shiftDateKey(today, -1))}
              >
                Ontem
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
        {lastEntry?.updated_at && (
          <> · salvo em {formatDate(lastEntry.updated_at)}
            {lastEntry.recorded_by_name ? ` por ${lastEntry.recorded_by_name}` : ''}</>
        )}
      </p>

      {loadError && (
        <div className="ps-card" style={{ borderColor: '#E6B5AC', color: 'var(--berry)' }}>{loadError}</div>
      )}

      {!dateIsOpen && (
        <div className="ps-card" style={{ borderColor: '#E6B5AC' }}>
          <b>Dia fechado para lançamento</b>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.45 }}>
            Você pode lançar hoje e ontem. Para corrigir um dia mais antigo, peça ao administrador.
          </p>
        </div>
      )}

      {loading && <div className="ps-empty">Carregando itens...</div>}

      {!loading && items.length === 0 && !loadError && (
        <div className="ps-card">
          <b>Nenhum item de cozinha cadastrado</b>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.45 }}>
            Os itens desta tela são os produtos com área de produção <b>cozinha</b>.
            Marque-os em Produtos → editar produto → Área.
          </p>
        </div>
      )}

      {!loading && groups.map(group => (
        <div key={group.category}>
          <div className="ps-label">{group.category}</div>
          <div className="ps-grid">
            {group.items.map(item => {
              const quantity = quantities[item.id] ?? 0
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
                      onClick={() => setQuantity(item.id, quantity - 1)}
                      disabled={!dateIsOpen || quantity === 0}
                      aria-label={`Diminuir ${item.name}`}
                    >
                      <Minus size={18} />
                    </button>
                    <input
                      className={`ps-qty${quantity === 0 ? ' zero' : ''}`}
                      type="number"
                      inputMode="numeric"
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
                      onClick={() => setQuantity(item.id, quantity + 1)}
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

      {!loading && items.length > 0 && (
        <div className="ps-card" style={{ marginTop: 18, gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Total do dia</span>
            <b style={{ fontSize: 22, fontVariantNumeric: 'tabular-nums' }}>{total}</b>
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
