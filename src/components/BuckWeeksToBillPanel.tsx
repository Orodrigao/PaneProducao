'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarCheck, Plus, Trash2 } from 'lucide-react'
import {
  BUCK_ADJUSTMENT_KIND_HINTS,
  BUCK_ADJUSTMENT_KIND_LABELS,
  BUCK_MAX_ADJUSTMENTS,
  buckAdjustmentAmount,
  buckWeekBlock,
  buckWeekLabel,
  createBuckWeeklyReceivable,
  emptyBuckAdjustmentDraft,
  loadBuckWeekLines,
  summarizeBuckWeek,
  validateBuckAdjustments,
  type BuckAdjustmentDraft,
  type BuckAdjustmentKind,
  type BuckWeekLine,
  type BuckWeekToBillRow,
} from '@/lib/buckWeeklyBilling'
import { formatReceivableMoney, getReceivableErrorMessage } from '@/lib/receivables'
import { showToast } from '@/lib/utils'

interface BuckWeeksToBillPanelProps {
  weeks: BuckWeekToBillRow[]
  onBilled: () => Promise<void> | void
}

const KINDS: BuckAdjustmentKind[] = ['produto_sem_romaneio', 'preco_combinado', 'acerto']

function formatQuantity(value: number, unit: string): string {
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${unit}`
}

export default function BuckWeeksToBillPanel({ weeks, onBilled }: BuckWeeksToBillPanelProps) {
  const router = useRouter()
  const [openStart, setOpenStart] = useState<string | null>(null)
  const [lines, setLines] = useState<BuckWeekLine[]>([])
  const [linesState, setLinesState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [drafts, setDrafts] = useState<BuckAdjustmentDraft[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Um identificador por semana aberta: se a conexão cair depois de gravar, a
  // nova tentativa devolve a mesma cobrança em vez de criar outra.
  const requestIdRef = useRef<string>(crypto.randomUUID())
  // Número da carga de produtos que a tela está esperando. Cada carga ganha o
  // seu, e fechar a semana invalida o atual: resposta atrasada, inclusive de
  // uma abertura anterior da MESMA semana, é descartada.
  const loadSeqRef = useRef(0)

  const openWeek = weeks.find(week => week.period_start === openStart) ?? null
  const summary = useMemo(() => summarizeBuckWeek(openWeek?.amount ?? 0, drafts), [openWeek, drafts])
  const totalWeeks = useMemo(() => weeks.reduce((sum, week) => sum + week.amount, 0), [weeks])

  if (weeks.length === 0) return null

  async function loadLines(week: BuckWeekToBillRow) {
    loadSeqRef.current += 1
    const carga = loadSeqRef.current
    setLines([])
    setLinesState('loading')
    try {
      const rows = await loadBuckWeekLines(week)
      if (loadSeqRef.current !== carga) return
      setLines(rows)
      setLinesState('ready')
    } catch (loadError) {
      console.error(loadError)
      if (loadSeqRef.current !== carga) return
      setLinesState('error')
    }
  }

  async function openDetail(week: BuckWeekToBillRow) {
    if (saving) return
    setOpenStart(week.period_start)
    setDrafts([])
    setError(null)
    requestIdRef.current = crypto.randomUUID()
    await loadLines(week)
  }

  function closeDetail() {
    if (saving) return
    loadSeqRef.current += 1
    setOpenStart(null)
    setDrafts([])
    setError(null)
  }

  function updateDraft(index: number, patch: Partial<BuckAdjustmentDraft>) {
    setDrafts(current => current.map((draft, position) => (position === index ? { ...draft, ...patch } : draft)))
    setError(null)
  }

  function changeKind(index: number, kind: BuckAdjustmentKind) {
    // Trocar o tipo limpa os campos do tipo anterior e preserva o motivo já escrito.
    setDrafts(current => current.map((draft, position) => (
      position === index ? { ...emptyBuckAdjustmentDraft(kind), description: draft.description } : draft
    )))
    setError(null)
  }

  function addDraft() {
    setDrafts(current => (current.length >= BUCK_MAX_ADJUSTMENTS ? current : [...current, emptyBuckAdjustmentDraft()]))
    setError(null)
  }

  function removeDraft(index: number) {
    setDrafts(current => current.filter((_, position) => position !== index))
    setError(null)
  }

  async function confirmWeek() {
    if (!openWeek || saving) return
    // Conferir é ver os produtos: sem eles carregados, não há o que confirmar.
    if (linesState !== 'ready') {
      setError('Os produtos da semana precisam aparecer antes de confirmar a cobrança.')
      return
    }
    const problem = validateBuckAdjustments(drafts)
    if (problem) {
      setError(problem)
      return
    }
    if (summary.total <= 0) {
      setError('Com os ajustes, a cobrança ficaria em zero ou negativa. Confira os valores.')
      return
    }
    const label = buckWeekLabel(openWeek).toLowerCase()
    if (!window.confirm(`Gerar a cobrança da Buck da ${label} no valor de ${formatReceivableMoney(summary.total)}?`)) return

    setSaving(true)
    try {
      await createBuckWeeklyReceivable(openWeek, drafts, requestIdRef.current)
      showToast('Cobrança da Buck gerada. Ela está na lista de cobranças.')
      loadSeqRef.current += 1
      setOpenStart(null)
      setDrafts([])
      requestIdRef.current = crypto.randomUUID()
      await onBilled()
    } catch (billError) {
      console.error(billError)
      setError(getReceivableErrorMessage(billError, 'Não foi possível gerar a cobrança da Buck.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="ps-card" style={{ marginTop: 14, borderColor: 'var(--honey-deep)' }}>
      <div className="ps-card-head">
        <div>
          <b>Semanas da Buck a cobrar</b>
          <small>{weeks.length} semana(s) · {formatReceivableMoney(totalWeeks)} nos romaneios</small>
        </div>
        <CalendarCheck size={18} />
      </div>

      <div className="ps-list" style={{ marginTop: 10 }}>
        {weeks.map(week => {
          const block = buckWeekBlock(week)
          const isOpen = week.period_start === openStart
          return (
            <div key={week.period_start} style={{ padding: '10px 0', borderTop: '1px solid var(--line, rgba(0,0,0,.08))' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ flex: 1 }}>
                  <b>{buckWeekLabel(week)}</b>
                  <small style={{ display: 'block' }}>
                    {week.romaneios} romaneio(s)
                    {week.romaneios_sem_conferencia > 0 ? ` · ${week.romaneios_sem_conferencia} sem conferência, valor pelo enviado` : ''}
                  </small>
                </span>
                <b>{formatReceivableMoney(week.amount)}</b>
              </div>

              {/* O motivo do bloqueio fica fixo na linha e leva à tela que resolve
                  (lição bloqueio-com-saida). */}
              {block && (
                <div className="ps-alert error" role="alert" style={{ marginTop: 8 }}>
                  {block.message}{' '}
                  <button type="button" className="ps-link" onClick={() => router.push(block.href)}>{block.label}</button>
                </div>
              )}

              {week.lancamentos_diretos > 0 && (
                <div className="ps-alert error" role="alert" style={{ marginTop: 8 }}>
                  Há {week.lancamentos_diretos} lançamento(s) da Buck feito(s) direto no livro-caixa desde 10/09.
                  Confira no Financeiro se esta semana já foi recebida por fora antes de cobrar, para a receita não contar duas vezes.
                </div>
              )}

              {!isOpen && (
                <div className="ps-fieldrow" style={{ marginTop: 8 }}>
                  <button className="ps-btn ghost sm" onClick={() => void openDetail(week)} disabled={Boolean(block) || saving}>
                    Conferir e cobrar
                  </button>
                </div>
              )}

              {isOpen && (
                <div style={{ marginTop: 10 }}>
                  {linesState === 'loading' && <div className="ps-hint">Carregando os produtos da semana...</div>}
                  {linesState === 'error' && (
                    <div className="ps-alert error" role="alert">
                      Não foi possível carregar os produtos da semana. Sem eles a cobrança não pode ser conferida.{' '}
                      <button type="button" className="ps-link" onClick={() => void loadLines(week)} disabled={saving}>
                        Tentar de novo
                      </button>
                    </div>
                  )}
                  {linesState === 'ready' && lines.length > 0 && (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left' }}>Produto</th>
                            <th style={{ textAlign: 'right' }}>Quantidade</th>
                            <th style={{ textAlign: 'right' }}>Preço</th>
                            <th style={{ textAlign: 'right' }}>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map(line => (
                            <tr key={`${line.produto}:${line.unidade}`}>
                              <td>{line.produto}</td>
                              <td style={{ textAlign: 'right' }}>{formatQuantity(line.quantidade, line.unidade)}</td>
                              <td style={{ textAlign: 'right' }}>{line.preco_unitario === null ? '—' : formatReceivableMoney(line.preco_unitario)}</td>
                              <td style={{ textAlign: 'right' }}>{line.total === null ? '—' : formatReceivableMoney(line.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="ps-label" style={{ marginTop: 12 }}>Ajustes da semana</div>
                  {drafts.length === 0 && (
                    <div className="ps-hint">Sem ajuste, a cobrança sai com o valor dos romaneios.</div>
                  )}

                  {drafts.map((draft, index) => {
                    const amount = buckAdjustmentAmount(draft)
                    return (
                      <div key={index} className="ps-card" style={{ marginTop: 8 }}>
                        <div className="ps-fieldrow">
                          <div className="ps-fieldgroup" style={{ flex: 1 }}>
                            <label className="ps-fieldlabel" htmlFor={`buck-ajuste-tipo-${index}`}>Tipo</label>
                            <select
                              id={`buck-ajuste-tipo-${index}`}
                              className="ps-select"
                              value={draft.kind}
                              onChange={event => changeKind(index, event.target.value as BuckAdjustmentKind)}
                              disabled={saving}
                            >
                              {KINDS.map(kind => <option key={kind} value={kind}>{BUCK_ADJUSTMENT_KIND_LABELS[kind]}</option>)}
                            </select>
                          </div>
                          <button
                            type="button"
                            className="ps-iconbtn"
                            onClick={() => removeDraft(index)}
                            disabled={saving}
                            aria-label={`Remover ajuste ${index + 1}`}
                            title="Remover ajuste"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <div className="ps-hint">{BUCK_ADJUSTMENT_KIND_HINTS[draft.kind]}</div>

                        <div className="ps-fieldgroup">
                          <label className="ps-fieldlabel" htmlFor={`buck-ajuste-motivo-${index}`}>Motivo *</label>
                          <input
                            id={`buck-ajuste-motivo-${index}`}
                            className="ps-input"
                            value={draft.description}
                            maxLength={200}
                            onChange={event => updateDraft(index, { description: event.target.value })}
                            disabled={saving}
                          />
                        </div>

                        {draft.kind === 'produto_sem_romaneio' ? (
                          <>
                            <div className="ps-fieldgroup">
                              <label className="ps-fieldlabel" htmlFor={`buck-ajuste-produto-${index}`}>Produto *</label>
                              <input
                                id={`buck-ajuste-produto-${index}`}
                                className="ps-input"
                                value={draft.productName}
                                maxLength={120}
                                onChange={event => updateDraft(index, { productName: event.target.value })}
                                disabled={saving}
                              />
                            </div>
                            <div className="ps-fieldrow">
                              <div className="ps-fieldgroup" style={{ flex: 1 }}>
                                <label className="ps-fieldlabel" htmlFor={`buck-ajuste-qtd-${index}`}>Quantidade *</label>
                                <input
                                  id={`buck-ajuste-qtd-${index}`}
                                  className="ps-input"
                                  inputMode="decimal"
                                  value={draft.quantity}
                                  onChange={event => updateDraft(index, { quantity: event.target.value })}
                                  disabled={saving}
                                />
                              </div>
                              <div className="ps-fieldgroup" style={{ width: 90 }}>
                                <label className="ps-fieldlabel" htmlFor={`buck-ajuste-unidade-${index}`}>Unidade</label>
                                <select
                                  id={`buck-ajuste-unidade-${index}`}
                                  className="ps-select"
                                  value={draft.unit}
                                  onChange={event => updateDraft(index, { unit: event.target.value as 'un' | 'kg' })}
                                  disabled={saving}
                                >
                                  <option value="un">un</option>
                                  <option value="kg">kg</option>
                                </select>
                              </div>
                              <div className="ps-fieldgroup" style={{ flex: 1 }}>
                                <label className="ps-fieldlabel" htmlFor={`buck-ajuste-preco-${index}`}>Preço por {draft.unit} *</label>
                                <input
                                  id={`buck-ajuste-preco-${index}`}
                                  className="ps-input"
                                  inputMode="decimal"
                                  value={draft.unitPrice}
                                  onChange={event => updateDraft(index, { unitPrice: event.target.value })}
                                  disabled={saving}
                                />
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="ps-fieldgroup">
                            <label className="ps-fieldlabel" htmlFor={`buck-ajuste-valor-${index}`}>
                              Valor * (use sinal de menos para descontar)
                            </label>
                            <input
                              id={`buck-ajuste-valor-${index}`}
                              className="ps-input"
                              inputMode="decimal"
                              placeholder="Ex.: 12,50 ou -7,00"
                              value={draft.amount}
                              onChange={event => updateDraft(index, { amount: event.target.value })}
                              disabled={saving}
                            />
                          </div>
                        )}

                        <div className="ps-meta" style={{ marginTop: 6 }}>
                          <span>
                            Este ajuste: {amount === null ? 'preencha os valores' : `${amount > 0 ? '+' : ''}${formatReceivableMoney(amount)}`}
                          </span>
                        </div>
                      </div>
                    )
                  })}

                  <div className="ps-fieldrow" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="ps-btn ghost sm"
                      onClick={addDraft}
                      disabled={saving || drafts.length >= BUCK_MAX_ADJUSTMENTS}
                    >
                      <Plus size={14} /> Adicionar ajuste
                    </button>
                  </div>

                  <div className="ps-card" style={{ marginTop: 12 }}>
                    <div className="ps-meta"><span>Romaneios {formatReceivableMoney(summary.romaneios)}</span></div>
                    <div className="ps-meta"><span>Ajustes {summary.ajustes > 0 ? '+' : ''}{formatReceivableMoney(summary.ajustes)}</span></div>
                    <b style={{ display: 'block', marginTop: 4 }}>Cobrança {formatReceivableMoney(summary.total)}</b>
                    <div className="ps-hint">Vence pelo prazo da Buck e pesa no mês em que a semana fecha.</div>
                  </div>

                  {error && (
                    <div className="ps-alert error" role="alert" style={{ marginTop: 10 }}>
                      {error}{' '}
                      <button type="button" className="ps-link" onClick={() => void onBilled()} disabled={saving}>
                        Atualizar semanas
                      </button>
                    </div>
                  )}

                  <div className="ps-fieldrow" style={{ marginTop: 12 }}>
                    <button
                      className="ps-btn primary block"
                      onClick={() => void confirmWeek()}
                      disabled={saving || linesState !== 'ready'}
                    >
                      {saving ? 'Gerando...' : `Confirmar cobrança de ${formatReceivableMoney(summary.total)}`}
                    </button>
                    <button className="ps-btn ghost block" onClick={closeDetail} disabled={saving}>
                      Fechar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
