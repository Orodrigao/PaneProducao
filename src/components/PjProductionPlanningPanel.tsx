'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, RefreshCw, Snowflake } from 'lucide-react'
import {
  formatPjProductionQuantity,
  groupPjProductionQueue,
  validatePjProductionSelection,
  type PjProductionQueueItem,
  type PjProductionQueueRow,
  type PjProductionSelection,
} from '@/lib/pjProductionPlanning'
import {
  fetchPjProductionQueue,
  schedulePjProduction,
} from '@/lib/pjProductionPlanningClient'
import { formatDateBR, todayKey } from '@/lib/utils'

interface ItemDraft {
  selected: boolean
  quantity: string
  frozenQuantity: string
}

type Drafts = Record<string, ItemDraft>

function requestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
}

function operationalMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return 'Não foi possível atualizar a produção PJ.'
}

function draftFor(item: PjProductionQueueItem, current?: ItemDraft): ItemDraft {
  return current ?? {
    selected: false,
    quantity: String(item.pendingQuantity),
    frozenQuantity: '0',
  }
}

export function PjProductionPlanningPanel() {
  const productionDate = todayKey()
  const [rows, setRows] = useState<PjProductionQueueRow[]>([])
  const [drafts, setDrafts] = useState<Drafts>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [programmingKey, setProgrammingKey] = useState('')
  const [requestIds, setRequestIds] = useState<Record<string, string>>({})

  const groups = useMemo(() => groupPjProductionQueue(rows), [rows])

  const loadQueue = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const loaded = await fetchPjProductionQueue()
      setRows(loaded)
      setDrafts(current => {
        const next: Drafts = {}
        for (const group of groupPjProductionQueue(loaded)) {
          for (const item of group.items) {
            const draft = draftFor(item, current[item.orderId])
            next[item.orderId] = item.lastScheduledDate === productionDate
              ? { ...draft, selected: false }
              : draft
          }
        }
        return next
      })
    } catch (loadError) {
      setError(operationalMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [productionDate])

  useEffect(() => {
    void loadQueue()
  }, [loadQueue])

  function updateDraft(orderId: string, patch: Partial<ItemDraft>) {
    setDrafts(current => ({
      ...current,
      [orderId]: { ...current[orderId], ...patch },
    }))
    setSuccess('')
  }

  function selectAll(groupKey: string) {
    const group = groups.find(item => item.key === groupKey)
    if (!group) return
    setDrafts(current => {
      const next = { ...current }
      for (const item of group.items) {
        if (item.mappingError || !item.breadId) continue
        next[item.orderId] = {
          ...draftFor(item, current[item.orderId]),
          selected: true,
          quantity: String(item.pendingQuantity),
        }
      }
      return next
    })
  }

  async function programGroup(groupKey: string) {
    const group = groups.find(item => item.key === groupKey)
    if (!group || programmingKey) return

    const selected = group.items.filter(item =>
      drafts[item.orderId]?.selected
      && !item.mappingError
      && Boolean(item.breadId))
    if (selected.length === 0) {
      setError('Marque ao menos um produto deste pedido.')
      return
    }

    const selections: PjProductionSelection[] = []
    for (const item of selected) {
      const draft = draftFor(item, drafts[item.orderId])
      const validation = validatePjProductionSelection(
        item,
        draft.quantity,
        draft.frozenQuantity,
      )
      if (typeof validation === 'string') {
        setError(`${item.productName}: ${validation}`)
        return
      }
      selections.push(validation)
    }

    const confirmation = selected.map((item, index) => {
      const selection = selections[index]
      const frozen = selection.frozenQuantity > 0
        ? `, sendo ${formatPjProductionQuantity(selection.frozenQuantity, 'un')} congelados`
        : ''
      return `${item.productName}: ${formatPjProductionQuantity(selection.quantity, item.pricingUnit)}${frozen}`
    }).join('\n')
    if (!window.confirm(
      `Confira a programação de hoje:\n\n${confirmation}\n\nIsto entra na produção e no Forno agora. Depois dá para programar mais, mas não dá para desfazer o que entrou.`,
    )) return

    const stableRequestId = requestIds[groupKey] ?? requestId()
    setRequestIds(current => ({ ...current, [groupKey]: stableRequestId }))
    setProgrammingKey(groupKey)
    setError('')
    setSuccess('')
    try {
      await schedulePjProduction(productionDate, selections, stableRequestId)
      setRequestIds(current => {
        const { [groupKey]: _done, ...rest } = current
        return rest
      })
      setSuccess(`${selections.length} produto(s) entraram na produção e no Forno de hoje.`)
      await loadQueue()
    } catch (scheduleError) {
      setError(operationalMessage(scheduleError))
    } finally {
      setProgrammingKey('')
    }
  }

  return (
    <section className="print-card print-breads" style={{ marginTop: 20 }} aria-labelledby="pj-production-title">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <h3 id="pj-production-title">🏢 Produção PJ de hoje</h3>
          <div className="pmeta">{formatDateBR(productionDate)} · pedidos por entrega mais próxima</div>
        </div>
        <button
          type="button"
          className="btn-action no-print"
          onClick={() => void loadQueue()}
          disabled={loading || Boolean(programmingKey)}
        >
          <RefreshCw size={14} /> Atualizar
        </button>
      </div>

      <div className="ps-warning no-print" style={{ marginTop: 12, fontSize: 12.5 }}>
        Sobras das lojas não atendem PJ. Congelados só entram quando você informar a quantidade abaixo.
      </div>

      {loading && <div className="ps-empty" style={{ padding: 24 }}>Carregando pedidos PJ...</div>}

      {!loading && error && (
        <div className="ps-card" role="alert" style={{ marginTop: 12, borderColor: '#E6B5AC', color: 'var(--berry)' }}>
          <AlertTriangle size={16} />
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="btn-action" onClick={() => void loadQueue()}>Tentar novamente</button>
        </div>
      )}

      {!loading && success && (
        <div className="ps-card" role="status" style={{ marginTop: 12, borderColor: '#C5D5BA', color: 'var(--sage)' }}>
          <Check size={16} /> {success}
        </div>
      )}

      {!loading && !error && groups.length === 0 && (
        <div className="ps-empty" style={{ padding: 28 }}>
          Nenhum pedido PJ pendente de programação.
        </div>
      )}

      {!loading && groups.map(group => (
        <article key={group.key} className="ps-card" style={{ marginTop: 12, padding: 14 }}>
          <div className="ps-card-head" style={{ alignItems: 'flex-start' }}>
            <div>
              <div className="ps-pname">{group.customerName}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>
                Entrega {group.deliveryDate ? formatDateBR(group.deliveryDate) : 'sem data'}
              </div>
            </div>
            <button
              type="button"
              className="btn-action no-print"
              onClick={() => selectAll(group.key)}
              disabled={Boolean(programmingKey)}
            >
              Produzir tudo
            </button>
          </div>

          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            {group.items.map(item => {
              const draft = draftFor(item, drafts[item.orderId])
              const scheduledToday = item.lastScheduledDate === productionDate
              // Ja ter programado hoje NAO trava a linha. A Geolar decide produzir
              // mais quando o forno rende, e o banco ja limita pelo total do pedido.
              // A linha some sozinha quando nao falta nada, porque a fila so traz
              // pedido com quantidade pendente.
              const blocked = Boolean(item.mappingError || !item.breadId)
              return (
                <div
                  key={item.orderId}
                  style={{
                    border: '1px solid var(--line-soft)',
                    borderRadius: 'var(--r-ctrl)',
                    padding: '10px 12px',
                    display: 'grid',
                    gap: 8,
                  }}
                >
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, cursor: blocked ? 'not-allowed' : 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={draft.selected}
                      disabled={blocked || Boolean(programmingKey)}
                      onChange={event => updateDraft(item.orderId, { selected: event.target.checked })}
                      aria-label={`Selecionar ${item.productName}`}
                      style={{ marginTop: 3 }}
                    />
                    <span style={{ flex: 1 }}>
                      <strong>{item.productName}</strong>
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>
                        Pedido {formatPjProductionQuantity(item.orderedQuantity, item.pricingUnit)}
                        {item.scheduledQuantity > 0 && ` · já programado ${formatPjProductionQuantity(item.scheduledQuantity, item.pricingUnit)}`}
                        {' · '}falta {formatPjProductionQuantity(item.pendingQuantity, item.pricingUnit)}
                      </span>
                    </span>
                  </label>

                  {item.mappingError && (
                    <div className="ps-warning" role="alert" style={{ fontSize: 12 }}>{item.mappingError}</div>
                  )}

                  {scheduledToday && (
                    <div className="ps-warning" style={{ fontSize: 12 }}>
                      Você já programou este item hoje. Dá para programar mais, até o que falta.
                    </div>
                  )}

                  {!blocked && draft.selected && (
                    <div className="no-print" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                      <label style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                        Produzir hoje
                        <input
                          className="ps-input"
                          type="text"
                          inputMode={item.pricingUnit === 'kg' ? 'decimal' : 'numeric'}
                          value={draft.quantity}
                          onChange={event => updateDraft(item.orderId, { quantity: event.target.value })}
                          aria-label={`Quantidade para produzir de ${item.productName}`}
                          style={{ marginTop: 4 }}
                        />
                      </label>
                      <label style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                        <Snowflake size={12} /> Usar congelados
                        <input
                          className="ps-input"
                          type="text"
                          inputMode="numeric"
                          value={draft.frozenQuantity}
                          onChange={event => updateDraft(item.orderId, { frozenQuantity: event.target.value })}
                          aria-label={`Congelados para ${item.productName}`}
                          style={{ marginTop: 4 }}
                        />
                        <span style={{ display: 'block', marginTop: 3 }}>
                          {formatPjProductionQuantity(item.frozenAvailable, 'un')} em estoque
                        </span>
                      </label>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <button
            type="button"
            className="btn-save no-print"
            style={{ width: '100%', marginTop: 12 }}
            onClick={() => void programGroup(group.key)}
            disabled={Boolean(programmingKey) || !group.items.some(item => drafts[item.orderId]?.selected)}
          >
            <Check size={15} /> {programmingKey === group.key ? 'Programando...' : 'Programar selecionados para hoje'}
          </button>
        </article>
      ))}
    </section>
  )
}
