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
  OVEN_LOSS_REASONS,
  parseOvenQuantity,
  validateOvenConfirmation,
} from '@/lib/ovenProduction'
import { supabase } from '@/lib/supabase'
import type { BreadOption as Bread } from '@/lib/types'
import { formatDateBR, showToast, todayKey } from '@/lib/utils'

interface OrderRow {
  id: string
  bread_id: string
  quantity: number | null
  production_date: string | null
  pj_delivery_date: string | null
  product_source: string | null
}

interface ProductionActualRow {
  id: string
  bread_id: string
  record_date: string
  lot_code?: string | null
  quantity_baked: number
  quantity_loss: number
  loss_reason: string | null
  obs: string | null
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

export default function FornoPage() {
  const [date, setDate] = useState(todayKey())
  const [breads, setBreads] = useState<Bread[]>([])
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
      const [regularResult, pjResult, customResult, actualsResult, reuseResult] = await Promise.all([
        supabase
          .from('orders')
          .select('id, bread_id, quantity, production_date, pj_delivery_date, product_source')
          .is('cancelled_at', null)
          .in('store', ['jc', 'ja', 'ex'])
          .eq('order_date', date)
          .gt('quantity', 0),
        supabase
          .from('orders')
          .select('id, bread_id, quantity, production_date, pj_delivery_date, product_source')
          .is('cancelled_at', null)
          .eq('store', 'pj')
          .or(`production_date.eq.${date},and(production_date.is.null,pj_delivery_date.eq.${date})`)
          .gt('quantity', 0),
        supabase
          .from('orders')
          .select('id, bread_id, quantity, production_date, pj_delivery_date, product_source')
          .is('cancelled_at', null)
          .eq('order_type', 'encomenda')
          .eq('production_date', date)
          .eq('product_source', 'bread')
          .gt('quantity', 0),
        supabase
          .from('production_actuals')
          .select('*')
          .eq('record_date', date),
        supabase
          .from('bread_reuse_plans')
          .select('bread_id, confirmed_quantity, status')
          .eq('target_production_date', date)
          .eq('status', 'confirmed'),
      ])

      const firstError = regularResult.error
        ?? pjResult.error
        ?? customResult.error
        ?? actualsResult.error
        ?? reuseResult.error
      if (firstError) throw firstError

      const regularRows = (regularResult.data ?? []) as OrderRow[]
      const pjRows = ((pjResult.data ?? []) as OrderRow[])
        .filter(row => row.product_source !== 'product')
      const customRows = (customResult.data ?? []) as OrderRow[]
      const actualRows = (actualsResult.data ?? []) as ProductionActualRow[]
      const originalPlan = aggregateOvenPlan([...regularRows, ...pjRows, ...customRows])
      const confirmedReuse = aggregateConfirmedReuse(
        (reuseResult.data ?? []) as ConfirmedReuseRow[],
      )
      const plan = subtractConfirmedReuse(originalPlan, confirmedReuse)
      const breadIds = Array.from(new Set([
        ...plan.keys(),
        ...actualRows.map(row => row.bread_id),
      ]))

      if (breadIds.length === 0) {
        setBreads([])
        setPlannedMap(new Map())
        setActuals({})
        setForms({})
        setEditing({})
        return
      }

      const breadsResult = await supabase
        .from('breads')
        .select('id, name, unit, is_pj, active')
        .in('id', breadIds)
      if (breadsResult.error) throw breadsResult.error

      const loadedBreads = ((breadsResult.data ?? []) as Bread[])
        .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'))
      const actualsByBread: Record<string, ProductionActualRow> = {}
      const initialForms: Record<string, OvenFormState> = {}

      for (const actual of actualRows) actualsByBread[actual.bread_id] = actual
      for (const bread of loadedBreads) {
        const actual = actualsByBread[bread.id]
        initialForms[bread.id] = {
          quantityGood: String(actual?.quantity_baked ?? plan.get(bread.id) ?? 0),
          quantityLoss: String(actual?.quantity_loss ?? 0),
          lossReason: actual?.loss_reason ?? OVEN_LOSS_REASONS[0],
        }
      }

      setBreads(loadedBreads)
      setPlannedMap(plan)
      setActuals(actualsByBread)
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

  function updateForm(breadId: string, patch: Partial<OvenFormState>) {
    setForms(current => ({
      ...current,
      [breadId]: { ...current[breadId], ...patch },
    }))
  }

  function adjustQuantity(
    breadId: string,
    field: 'quantityGood' | 'quantityLoss',
    delta: number,
  ) {
    const current = parseOvenQuantity(forms[breadId]?.[field] ?? '0') ?? 0
    updateForm(breadId, { [field]: String(Math.max(0, current + delta)) })
  }

  function startEditing(breadId: string) {
    setEditing(current => ({ ...current, [breadId]: true }))
  }

  function cancelEditing(breadId: string) {
    const actual = actuals[breadId]
    const planned = plannedMap.get(breadId) ?? 0
    setForms(current => ({
      ...current,
      [breadId]: {
        quantityGood: String(actual?.quantity_baked ?? planned),
        quantityLoss: String(actual?.quantity_loss ?? 0),
        lossReason: actual?.loss_reason ?? OVEN_LOSS_REASONS[0],
      },
    }))
    setEditing(current => ({ ...current, [breadId]: false }))
  }

  async function confirmBread(bread: Bread, quickConfirmation = false) {
    const planned = plannedMap.get(bread.id) ?? 0
    const form = quickConfirmation
      ? {
          quantityGood: String(planned),
          quantityLoss: '0',
          lossReason: OVEN_LOSS_REASONS[0],
        }
      : forms[bread.id]

    if (!form) return
    const validationError = validateOvenConfirmation(form)
    if (validationError) {
      showToast(validationError)
      return
    }

    const quantityGood = parseOvenQuantity(form.quantityGood)
    const quantityLoss = parseOvenQuantity(form.quantityLoss)
    if (quantityGood === null || quantityLoss === null) return

    setSaving(current => ({ ...current, [bread.id]: true }))
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      if (!sessionData.session) {
        throw new Error('Entre com seu e-mail para confirmar o forno com segurança.')
      }

      const { data, error } = await supabase.rpc('confirm_oven_output', {
        p_record_date: date,
        p_bread_id: bread.id,
        p_quantity_good: quantityGood,
        p_quantity_loss: quantityLoss,
        p_loss_reason: quantityLoss > 0 ? form.lossReason : null,
        p_obs: null,
      })
      if (error) throw error

      const rpcRows = (Array.isArray(data) ? data : [data]) as OvenRpcRow[]
      const result = rpcRows[0]
      if (!result) throw new Error('O banco não retornou a confirmação do lote.')

      const confirmed: ProductionActualRow = {
        id: result.production_actual_id,
        bread_id: bread.id,
        record_date: date,
        lot_code: result.returned_lot_code,
        quantity_baked: Number(result.returned_quantity_good),
        quantity_loss: Number(result.returned_quantity_loss),
        loss_reason: result.returned_loss_reason,
        obs: null,
      }

      setActuals(current => ({ ...current, [bread.id]: confirmed }))
      setForms(current => ({
        ...current,
        [bread.id]: {
          quantityGood: String(confirmed.quantity_baked),
          quantityLoss: String(confirmed.quantity_loss),
          lossReason: confirmed.loss_reason ?? OVEN_LOSS_REASONS[0],
        },
      }))
      setEditing(current => ({ ...current, [bread.id]: false }))
      showToast(`✓ ${bread.name}: ${confirmed.quantity_baked} confirmados`)
    } catch (error: unknown) {
      showToast(`Erro: ${errorMessage(error)}`)
    } finally {
      setSaving(current => ({ ...current, [bread.id]: false }))
    }
  }

  const dateOptions = Array.from({ length: 8 }, (_, index) => dateKeyOffset(index))
  const confirmedCount = breads.filter(bread => Boolean(actuals[bread.id])).length
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
          ) : breads.length === 0 ? (
            <div className="ps-empty">Nenhum pão previsto para {formatDateBR(date)}.</div>
          ) : (
            <>
              <div className="ps-section">
                <div className="bar" />
                <b>Saída do forno</b>
                <span className="meta">{confirmedCount}/{breads.length} confirmados</span>
              </div>

              <div className="ps-grid">
                {breads.map(bread => {
                  const planned = plannedMap.get(bread.id) ?? 0
                  const actual = actuals[bread.id]
                  const form = forms[bread.id]
                  const isEditing = Boolean(editing[bread.id])
                  const isSaving = Boolean(saving[bread.id])
                  const quantityGood = parseOvenQuantity(form?.quantityGood ?? '0') ?? 0
                  const quantityLoss = parseOvenQuantity(form?.quantityLoss ?? '0') ?? 0
                  const lotCode = actual?.lot_code ?? ovenLotCode(date)

                  return (
                    <article
                      key={bread.id}
                      className={`ps-card ps-oven-card${actual ? ' confirmed' : ''}`}
                    >
                      <div className="ps-oven-card-head">
                        <div>
                          <div className="ps-pname">{bread.name}</div>
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
                            onClick={() => void confirmBread(bread, true)}
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
                            onClick={() => startEditing(bread.id)}
                          >
                            <Pencil size={15} /> Ajustar ou informar perda
                          </button>
                        </div>
                      )}

                      {actual && !isEditing && (
                        <button
                          type="button"
                          className="ps-oven-adjust"
                          onClick={() => startEditing(bread.id)}
                        >
                          <Pencil size={15} /> Corrigir confirmação
                        </button>
                      )}

                      {isEditing && form && (
                        <div className="ps-oven-editor">
                          <div className="ps-oven-field">
                            <label htmlFor={`good-${bread.id}`}>Saída boa</label>
                            <div className="ps-stepper">
                              <button
                                type="button"
                                className="ps-step"
                                disabled={quantityGood <= 0 || isSaving}
                                onClick={() => adjustQuantity(bread.id, 'quantityGood', -1)}
                                aria-label={`Diminuir saída boa de ${bread.name}`}
                              >
                                <Minus size={21} />
                              </button>
                              <input
                                id={`good-${bread.id}`}
                                className="ps-qty"
                                type="number"
                                inputMode="numeric"
                                min={0}
                                step={1}
                                disabled={isSaving}
                                value={form.quantityGood}
                                onChange={event => updateForm(bread.id, { quantityGood: event.target.value })}
                              />
                              <button
                                type="button"
                                className="ps-step"
                                disabled={isSaving}
                                onClick={() => adjustQuantity(bread.id, 'quantityGood', 1)}
                                aria-label={`Aumentar saída boa de ${bread.name}`}
                              >
                                <Plus size={21} />
                              </button>
                            </div>
                          </div>

                          <div className="ps-oven-field loss">
                            <label htmlFor={`loss-${bread.id}`}>Perda no forno</label>
                            <div className="ps-stepper">
                              <button
                                type="button"
                                className="ps-step"
                                disabled={quantityLoss <= 0 || isSaving}
                                onClick={() => adjustQuantity(bread.id, 'quantityLoss', -1)}
                                aria-label={`Diminuir perda de ${bread.name}`}
                              >
                                <Minus size={21} />
                              </button>
                              <input
                                id={`loss-${bread.id}`}
                                className={`ps-qty${quantityLoss === 0 ? ' zero' : ''}`}
                                type="number"
                                inputMode="numeric"
                                min={0}
                                step={1}
                                disabled={isSaving}
                                value={form.quantityLoss}
                                onChange={event => updateForm(bread.id, { quantityLoss: event.target.value })}
                              />
                              <button
                                type="button"
                                className="ps-step"
                                disabled={isSaving}
                                onClick={() => adjustQuantity(bread.id, 'quantityLoss', 1)}
                                aria-label={`Aumentar perda de ${bread.name}`}
                              >
                                <Plus size={21} />
                              </button>
                            </div>
                          </div>

                          {quantityLoss > 0 && (
                            <select
                              className="ps-select"
                              aria-label={`Motivo da perda de ${bread.name}`}
                              disabled={isSaving}
                              value={form.lossReason}
                              onChange={event => updateForm(bread.id, { lossReason: event.target.value })}
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
                              onClick={() => cancelEditing(bread.id)}
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              className="ps-btn success"
                              disabled={isSaving}
                              onClick={() => void confirmBread(bread)}
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
