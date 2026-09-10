'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, LoaderCircle, Minus, Pencil, Plus } from 'lucide-react'
import { getCurrentUserAsync, roleColor, type Role } from '@/lib/auth'
import {
  aggregateConfirmedReuse,
  subtractConfirmedReuse,
  type ConfirmedReuseRow,
} from '@/lib/breadLeftovers'
import {
  aggregateOvenPlan,
  ovenLotCode,
  ovenProductKey,
  OVEN_LOSS_REASONS,
  parseOvenQuantity,
  validateOvenConfirmation,
} from '@/lib/ovenProduction'
import { supabase } from '@/lib/supabase'
import { formatDateBR, showToast, todayKey } from '@/lib/utils'

interface OrderRow {
  id: string
  bread_id: string
  quantity: number | null
}

interface PjOvenPlanRow {
  product_source: 'bread' | 'product'
  product_id: string
  product_name: string
  production_unit: string | null
  quantity: number | null
}

interface ProductionActualRow {
  id: string
  bread_id: string | null
  product_source: 'bread' | 'product'
  product_id: string
  product_name: string
  production_unit: string | null
  record_date: string
  lot_code?: string | null
  quantity_baked: number
  quantity_loss: number
  loss_reason: string | null
  obs: string | null
}

interface OvenProduct {
  id: string
  source: 'bread' | 'product'
  name: string
  unit: string | null
}

interface OvenFormState {
  quantityGood: string
  quantityLoss: string
  lossReason: string
}

interface OvenRpcRow {
  production_actual_id: string
  returned_lot_code: string
  returned_quantity_good: number
  returned_quantity_loss: number
  returned_loss_reason: string | null
}

interface CurrentUserSummary {
  id: string
  displayName: string
  role: Role
}

function dateKeyOffset(daysBack: number): string {
  const date = new Date()
  date.setDate(date.getDate() - daysBack)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatDayShort(iso: string): string {
  const [, month, day] = iso.split('-')
  return `${day}/${month}`
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String(error.message)
  }
  return 'Não foi possível concluir a operação.'
}

function isMissingIdentityContract(error: unknown, identifier: string): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: string; message?: string }
  return ['PGRST202', 'PGRST204', '42703'].includes(candidate.code ?? '')
    && (candidate.message ?? '').includes(identifier)
}

export default function FornoPage() {
  const [date, setDate] = useState(todayKey())
  const [products, setProducts] = useState<OvenProduct[]>([])
  const [plannedMap, setPlannedMap] = useState<Map<string, number>>(new Map())
  const [actuals, setActuals] = useState<Record<string, ProductionActualRow>>({})
  const [forms, setForms] = useState<Record<string, OvenFormState>>({})
  const [editing, setEditing] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [user, setUser] = useState<CurrentUserSummary | null>(null)

  useEffect(() => {
    let active = true
    void getCurrentUserAsync().then(currentUser => {
      if (!active || !currentUser) return
      setUser({
        id: currentUser.id,
        displayName: currentUser.displayName,
        role: currentUser.role,
      })
    })
    return () => { active = false }
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError('')

    try {
      const [regularResult, customResult, reuseResult] = await Promise.all([
        supabase
          .from('orders')
          .select('id, bread_id, quantity')
          .is('cancelled_at', null)
          .in('store', ['jc', 'ja', 'ex'])
          .eq('order_type', 'producao')
          .eq('order_date', date)
          .gt('quantity', 0),
        supabase
          .from('orders')
          .select('id, bread_id, quantity')
          .is('cancelled_at', null)
          .eq('order_type', 'encomenda')
          .eq('production_date', date)
          .eq('product_source', 'bread')
          .gt('quantity', 0),
        supabase
          .from('bread_reuse_plans')
          .select('bread_id, confirmed_quantity, status')
          .eq('target_production_date', date)
          .eq('status', 'confirmed'),
      ])

      const pjResult = await supabase.rpc('list_pj_production_for_oven_v2', {
        p_production_date: date,
      })
      let pjError = pjResult.error
      let pjRows: PjOvenPlanRow[]
      if (pjResult.error && isMissingIdentityContract(pjResult.error, 'list_pj_production_for_oven_v2')) {
        const legacyPjResult = await supabase.rpc('list_pj_production_for_oven', {
          p_production_date: date,
        })
        if (legacyPjResult.error) throw legacyPjResult.error
        pjRows = ((legacyPjResult.data ?? []) as Array<{ bread_id: string; quantity: number | null }>).map(row => ({
          product_source: 'bread',
          product_id: row.bread_id,
          product_name: row.bread_id,
          production_unit: null,
          quantity: row.quantity,
        }))
        pjError = null
      } else {
        pjRows = (pjResult.data ?? []) as PjOvenPlanRow[]
      }

      const actualsResult = await supabase
        .from('production_actuals')
        .select('id,bread_id,product_source,product_id,product_name,production_unit,record_date,lot_code,quantity_baked,quantity_loss,loss_reason,obs')
        .eq('record_date', date)
      let actualsError = actualsResult.error
      let actualRows: ProductionActualRow[]
      if (actualsResult.error && isMissingIdentityContract(actualsResult.error, 'product_source')) {
        const legacyActualsResult = await supabase
          .from('production_actuals')
          .select('id,bread_id,record_date,lot_code,quantity_baked,quantity_loss,loss_reason,obs')
          .eq('record_date', date)
        if (legacyActualsResult.error) throw legacyActualsResult.error
        actualRows = ((legacyActualsResult.data ?? []) as Array<Omit<ProductionActualRow,
          'product_source' | 'product_id' | 'product_name' | 'production_unit'>>).map(row => ({
          ...row,
          product_source: 'bread',
          product_id: row.bread_id ?? '',
          product_name: row.bread_id ?? '',
          production_unit: null,
        }))
        actualsError = null
      } else {
        actualRows = (actualsResult.data ?? []) as ProductionActualRow[]
      }

      const firstError = regularResult.error
        ?? pjError
        ?? customResult.error
        ?? actualsError
        ?? reuseResult.error
      if (firstError) throw firstError

      const regularRows = ((regularResult.data ?? []) as OrderRow[]).map(row => ({
        ...row,
        product_source: 'bread',
        product_id: row.bread_id,
      }))
      const customRows = ((customResult.data ?? []) as OrderRow[]).map(row => ({
        ...row,
        product_source: 'bread',
        product_id: row.bread_id,
      }))
      const originalPlan = aggregateOvenPlan([...regularRows, ...pjRows, ...customRows])
      const confirmedReuse = new Map(Array.from(aggregateConfirmedReuse(
        (reuseResult.data ?? []) as ConfirmedReuseRow[],
      )).map(([breadId, quantity]) => [ovenProductKey('bread', breadId), quantity]))
      const plan = subtractConfirmedReuse(originalPlan, confirmedReuse)
      const identities = [
        ...Array.from(plan.keys()).map(key => {
          const separator = key.indexOf(':')
          return { source: key.slice(0, separator), id: key.slice(separator + 1) }
        }),
        ...actualRows.map(row => ({ source: row.product_source, id: row.product_id })),
      ]
      const breadIds = Array.from(new Set(identities.filter(item => item.source === 'bread').map(item => item.id)))
      const productIds = Array.from(new Set(identities.filter(item => item.source === 'product').map(item => item.id)))

      if (breadIds.length === 0 && productIds.length === 0) {
        setProducts([])
        setPlannedMap(new Map())
        setActuals({})
        setForms({})
        setEditing({})
        return
      }

      const [breadsResult, productsResult] = await Promise.all([
        breadIds.length > 0
          ? supabase.from('breads').select('id,name,unit').in('id', breadIds)
          : Promise.resolve({ data: [], error: null }),
        productIds.length > 0
          ? supabase.from('products').select('id,name,unit').in('id', productIds)
          : Promise.resolve({ data: [], error: null }),
      ])
      if (breadsResult.error) throw breadsResult.error
      if (productsResult.error) throw productsResult.error

      const loadedProducts: OvenProduct[] = [
        ...((breadsResult.data ?? []) as Array<{ id: string; name: string; unit: string | null }>).map(item => ({
          ...item,
          source: 'bread' as const,
        })),
        ...((productsResult.data ?? []) as Array<{ id: string; name: string; unit: string | null }>).map(item => ({
          ...item,
          source: 'product' as const,
        })),
      ].sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'))
      const actualsByProduct: Record<string, ProductionActualRow> = {}
      const initialForms: Record<string, OvenFormState> = {}

      for (const actual of actualRows) {
        actualsByProduct[ovenProductKey(actual.product_source, actual.product_id)] = actual
      }
      for (const product of loadedProducts) {
        const key = ovenProductKey(product.source, product.id)
        const actual = actualsByProduct[key]
        initialForms[key] = {
          quantityGood: String(actual?.quantity_baked ?? plan.get(key) ?? 0),
          quantityLoss: String(actual?.quantity_loss ?? 0),
          lossReason: actual?.loss_reason ?? OVEN_LOSS_REASONS[0],
        }
      }

      setProducts(loadedProducts)
      setPlannedMap(plan)
      setActuals(actualsByProduct)
      setForms(initialForms)
      setEditing({})
    } catch (error: unknown) {
      const message = errorMessage(error)
      setLoadError(message)
      showToast(`Erro ao carregar: ${message}`)
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => {
    void loadData()
  }, [loadData])

  function updateForm(productKey: string, patch: Partial<OvenFormState>) {
    setForms(current => ({
      ...current,
      [productKey]: { ...current[productKey], ...patch },
    }))
  }

  function adjustQuantity(
    productKey: string,
    field: 'quantityGood' | 'quantityLoss',
    delta: number,
  ) {
    const product = products.find(item => ovenProductKey(item.source, item.id) === productKey)
    const unit = product?.unit === 'kg' ? 'kg' : 'un'
    const current = parseOvenQuantity(forms[productKey]?.[field] ?? '0', unit) ?? 0
    updateForm(productKey, {
      [field]: String(Math.max(0, Math.round((current + delta) * 1000) / 1000)),
    })
  }

  function startEditing(productKey: string) {
    setEditing(current => ({ ...current, [productKey]: true }))
  }

  function cancelEditing(productKey: string) {
    const actual = actuals[productKey]
    const planned = plannedMap.get(productKey) ?? 0
    setForms(current => ({
      ...current,
      [productKey]: {
        quantityGood: String(actual?.quantity_baked ?? planned),
        quantityLoss: String(actual?.quantity_loss ?? 0),
        lossReason: actual?.loss_reason ?? OVEN_LOSS_REASONS[0],
      },
    }))
    setEditing(current => ({ ...current, [productKey]: false }))
  }

  async function confirmProduct(product: OvenProduct, quickConfirmation = false) {
    const productKey = ovenProductKey(product.source, product.id)
    const planned = plannedMap.get(productKey) ?? 0
    const form = quickConfirmation
      ? {
          quantityGood: String(planned),
          quantityLoss: '0',
          lossReason: OVEN_LOSS_REASONS[0],
        }
      : forms[productKey]

    if (!form) return
    const unit = product.unit === 'kg' ? 'kg' : 'un'
    const validationError = validateOvenConfirmation(form, unit)
    if (validationError) {
      showToast(validationError)
      return
    }

    const quantityGood = parseOvenQuantity(form.quantityGood, unit)
    const quantityLoss = parseOvenQuantity(form.quantityLoss, unit)
    if (quantityGood === null || quantityLoss === null) return

    setSaving(current => ({ ...current, [productKey]: true }))
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      if (!sessionData.session) {
        throw new Error('Entre com seu e-mail para confirmar o forno com segurança.')
      }

      let confirmationResult = await supabase.rpc('confirm_oven_product_output', {
        p_record_date: date,
        p_product_source: product.source,
        p_product_id: product.id,
        p_quantity_good: quantityGood,
        p_quantity_loss: quantityLoss,
        p_loss_reason: quantityLoss > 0 ? form.lossReason : null,
        p_obs: null,
      })
      if (confirmationResult.error
        && product.source === 'bread'
        && isMissingIdentityContract(confirmationResult.error, 'confirm_oven_product_output')) {
        confirmationResult = await supabase.rpc('confirm_oven_output', {
          p_record_date: date,
          p_bread_id: product.id,
          p_quantity_good: quantityGood,
          p_quantity_loss: quantityLoss,
          p_loss_reason: quantityLoss > 0 ? form.lossReason : null,
          p_obs: null,
        })
      }
      if (confirmationResult.error) throw confirmationResult.error

      const data = confirmationResult.data
      const rpcRows = (Array.isArray(data) ? data : [data]) as OvenRpcRow[]
      const result = rpcRows[0]
      if (!result) throw new Error('O banco não retornou a confirmação do lote.')

      const confirmed: ProductionActualRow = {
        id: result.production_actual_id,
        bread_id: product.source === 'bread' ? product.id : null,
        product_source: product.source,
        product_id: product.id,
        product_name: product.name,
        production_unit: product.unit,
        record_date: date,
        lot_code: result.returned_lot_code,
        quantity_baked: Number(result.returned_quantity_good),
        quantity_loss: Number(result.returned_quantity_loss),
        loss_reason: result.returned_loss_reason,
        obs: null,
      }

      setActuals(current => ({ ...current, [productKey]: confirmed }))
      setForms(current => ({
        ...current,
        [productKey]: {
          quantityGood: String(confirmed.quantity_baked),
          quantityLoss: String(confirmed.quantity_loss),
          lossReason: confirmed.loss_reason ?? OVEN_LOSS_REASONS[0],
        },
      }))
      setEditing(current => ({ ...current, [productKey]: false }))
      showToast(`✓ ${product.name}: ${confirmed.quantity_baked} confirmados`)
    } catch (error: unknown) {
      showToast(`Erro: ${errorMessage(error)}`)
    } finally {
      setSaving(current => ({ ...current, [productKey]: false }))
    }
  }

  const dateOptions = Array.from({ length: 8 }, (_, index) => dateKeyOffset(index))
  const confirmedCount = products.filter(product => Boolean(actuals[ovenProductKey(product.source, product.id)])).length
  const userInitial = user?.displayName.trim().charAt(0).toUpperCase() ?? ''
  const avatarColor = user ? roleColor(user.role) : 'var(--crust)'

  if (loading) {
    return (
      <div className="ps-loading">
        <div className="ps-spinner" />
        <p>Carregando...</p>
      </div>
    )
  }

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

        <main className="ps-pad ps-oven-page">
          <p className="ps-forno-intro">
            Confira o previsto e confirme somente o que saiu bom do forno.
          </p>

          <div className="ps-label">Dia</div>
          <div className="ps-days" role="group" aria-label="Data da produção">
            {dateOptions.map((option, index) => (
              <button
                type="button"
                key={option}
                className="ps-day"
                aria-pressed={option === date}
                onClick={() => setDate(option)}
              >
                {index === 0 ? 'Hoje' : index === 1 ? 'Ontem' : formatDayShort(option)}
              </button>
            ))}
          </div>

          {loadError ? (
            <div className="ps-oven-error" role="alert">
              <AlertTriangle size={19} />
              <span>Não foi possível carregar o forno.</span>
              <button type="button" onClick={() => void loadData()}>Tentar novamente</button>
            </div>
          ) : products.length === 0 ? (
            <div className="ps-empty">Nenhum produto de Forno previsto para {formatDateBR(date)}.</div>
          ) : (
            <>
              <div className="ps-section">
                <div className="bar" />
                <b>Saída do forno</b>
                <span className="meta">{confirmedCount}/{products.length} confirmados</span>
              </div>

              <div className="ps-grid">
                {products.map(product => {
                  const productKey = ovenProductKey(product.source, product.id)
                  const planned = plannedMap.get(productKey) ?? 0
                  const actual = actuals[productKey]
                  const form = forms[productKey]
                  const isEditing = Boolean(editing[productKey])
                  const isSaving = Boolean(saving[productKey])
                  const unit = product.unit === 'kg' ? 'kg' : 'un'
                  const step = unit === 'kg' ? 0.1 : 1
                  const quantityGood = parseOvenQuantity(form?.quantityGood ?? '0', unit) ?? 0
                  const quantityLoss = parseOvenQuantity(form?.quantityLoss ?? '0', unit) ?? 0
                  const lotCode = actual?.lot_code ?? ovenLotCode(date)

                  return (
                    <article
                      key={productKey}
                      className={`ps-card ps-oven-card${actual ? ' confirmed' : ''}`}
                    >
                      <div className="ps-oven-card-head">
                        <div>
                          <div className="ps-pname">{product.name}</div>
                          <div className="ps-oven-lot">Lote {lotCode}</div>
                        </div>
                        <div className="ps-oven-planned">
                          <span>Previsto</span>
                          <b>{planned}</b>
                        </div>
                      </div>

                      {actual && !isEditing && (
                        <div className="ps-oven-confirmed">
                          <Check size={19} strokeWidth={2.5} />
                          <div>
                            <b>{actual.quantity_baked} bons</b>
                            {actual.quantity_loss > 0 && (
                              <span>{actual.quantity_loss} de perda · {actual.loss_reason}</span>
                            )}
                          </div>
                        </div>
                      )}

                      {!actual && !isEditing && (
                        <div className="ps-oven-actions">
                          <button
                            type="button"
                            className="ps-oven-confirm"
                            disabled={isSaving}
                            onClick={() => void confirmProduct(product, true)}
                          >
                            {isSaving
                              ? <LoaderCircle className="ps-spin" size={21} />
                              : <Check size={21} strokeWidth={2.5} />}
                            Confirmar {planned}
                          </button>
                          <button
                            type="button"
                            className="ps-oven-adjust"
                            disabled={isSaving}
                            onClick={() => startEditing(productKey)}
                          >
                            <Pencil size={15} /> Ajustar ou informar perda
                          </button>
                        </div>
                      )}

                      {actual && !isEditing && (
                        <button
                          type="button"
                          className="ps-oven-adjust"
                          onClick={() => startEditing(productKey)}
                        >
                          <Pencil size={15} /> Corrigir confirmação
                        </button>
                      )}

                      {isEditing && form && (
                        <div className="ps-oven-editor">
                          <div className="ps-oven-field">
                            <label htmlFor={`good-${productKey}`}>Saída boa</label>
                            <div className="ps-stepper">
                              <button
                                type="button"
                                className="ps-step"
                                disabled={quantityGood <= 0 || isSaving}
                                onClick={() => adjustQuantity(productKey, 'quantityGood', -step)}
                                aria-label={`Diminuir saída boa de ${product.name}`}
                              >
                                <Minus size={21} />
                              </button>
                              <input
                                id={`good-${productKey}`}
                                className="ps-qty"
                                type="number"
                                inputMode={unit === 'kg' ? 'decimal' : 'numeric'}
                                min={0}
                                step={step}
                                disabled={isSaving}
                                value={form.quantityGood}
                                onChange={event => updateForm(productKey, { quantityGood: event.target.value })}
                              />
                              <button
                                type="button"
                                className="ps-step"
                                disabled={isSaving}
                                onClick={() => adjustQuantity(productKey, 'quantityGood', step)}
                                aria-label={`Aumentar saída boa de ${product.name}`}
                              >
                                <Plus size={21} />
                              </button>
                            </div>
                          </div>

                          <div className="ps-oven-field loss">
                            <label htmlFor={`loss-${productKey}`}>Perda no forno</label>
                            <div className="ps-stepper">
                              <button
                                type="button"
                                className="ps-step"
                                disabled={quantityLoss <= 0 || isSaving}
                                onClick={() => adjustQuantity(productKey, 'quantityLoss', -step)}
                                aria-label={`Diminuir perda de ${product.name}`}
                              >
                                <Minus size={21} />
                              </button>
                              <input
                                id={`loss-${productKey}`}
                                className={`ps-qty${quantityLoss === 0 ? ' zero' : ''}`}
                                type="number"
                                inputMode={unit === 'kg' ? 'decimal' : 'numeric'}
                                min={0}
                                step={step}
                                disabled={isSaving}
                                value={form.quantityLoss}
                                onChange={event => updateForm(productKey, { quantityLoss: event.target.value })}
                              />
                              <button
                                type="button"
                                className="ps-step"
                                disabled={isSaving}
                                onClick={() => adjustQuantity(productKey, 'quantityLoss', step)}
                                aria-label={`Aumentar perda de ${product.name}`}
                              >
                                <Plus size={21} />
                              </button>
                            </div>
                          </div>

                          {quantityLoss > 0 && (
                            <select
                              className="ps-select"
                              aria-label={`Motivo da perda de ${product.name}`}
                              disabled={isSaving}
                              value={form.lossReason}
                              onChange={event => updateForm(productKey, { lossReason: event.target.value })}
                            >
                              {OVEN_LOSS_REASONS.map(reason => (
                                <option key={reason} value={reason}>{reason}</option>
                              ))}
                            </select>
                          )}

                          <div className="ps-oven-editor-actions">
                            <button
                              type="button"
                              className="ps-btn ghost"
                              disabled={isSaving}
                              onClick={() => cancelEditing(productKey)}
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              className="ps-btn success"
                              disabled={isSaving}
                              onClick={() => void confirmProduct(product)}
                            >
                              {isSaving && <LoaderCircle className="ps-spin" size={18} />}
                              {actual ? 'Salvar correção' : 'Confirmar saída'}
                            </button>
                          </div>
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
