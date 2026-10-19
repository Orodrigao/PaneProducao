'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { formatCurrencyBRL } from '@/lib/cashClosing'
import { showToast } from '@/lib/utils'
import {
  BUCK_PRICE_DETAIL_MAX,
  BUCK_PRICE_REASONS,
  buckPriceErrorMessage,
  changeBuckPrice,
  formatBuckPrice,
  formatDateBR,
  formatSince,
  loadBuckPricePreview,
  confirmationNeeded,
  minimumDateReason,
  parseBuckPriceInput,
  priceChangeRatio,
  validateBuckPriceDraft,
  type BuckPriceDraft,
  type BuckPricePreview,
  type BuckPricingUnit,
} from '@/lib/buckPriceChange'

interface BuckPriceChangeCardProps {
  item: { id: string; product_name: string; pricing_unit: BuckPricingUnit }
  onClose: () => void
  onSaved: () => Promise<void> | void
}

type BaseState = { status: 'carregando' } | { status: 'erro'; message: string } | { status: 'pronta'; preview: BuckPricePreview }

const errorText = buckPriceErrorMessage

function signedBRL(value: number): string {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatCurrencyBRL(Math.abs(value))}`
}

export default function BuckPriceChangeCard({ item, onClose, onSaved }: BuckPriceChangeCardProps) {
  const [base, setBase] = useState<BaseState>({ status: 'carregando' })
  const [attempt, setAttempt] = useState(0)
  const [draft, setDraft] = useState<BuckPriceDraft>({
    priceText: '', unit: item.pricing_unit, validFrom: '', reason: '', detail: '', bigChangeConfirmed: false,
  })
  const [effect, setEffect] = useState<BuckPricePreview | null>(null)
  const [effectLoading, setEffectLoading] = useState(false)
  const [effectError, setEffectError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const cardRef = useRef<HTMLElement>(null)

  useEffect(() => {
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  useEffect(() => {
    let active = true
    setBase({ status: 'carregando' })
    loadBuckPricePreview(item.id)
      .then(preview => {
        if (!active) return
        setBase({ status: 'pronta', preview })
        setDraft(current => current.validFrom ? current : { ...current, validFrom: preview.hoje })
      })
      .catch(error => {
        if (active) setBase({ status: 'erro', message: errorText(error, 'Não foi possível abrir a troca de preço.') })
      })
    return () => { active = false }
  }, [item.id, attempt])

  const preview = base.status === 'pronta' ? base.preview : null
  const parsed = parseBuckPriceInput(draft.priceText)
  const currentPrice = preview?.vigente?.unit_price ?? null
  const confirmation = parsed.value === null ? null : confirmationNeeded(preview?.vigente ?? null, { price: parsed.value, unit: draft.unit })

  // A prévia do banco (efeito em R$ e trocas que deixam de valer) só depende
  // de preço, unidade e data; o motivo não muda a conta.
  const effectKey = parsed.value !== null && draft.validFrom ? `${parsed.value}|${draft.unit}|${draft.validFrom}` : ''
  useEffect(() => {
    setEffect(null)
    setEffectError(null)
    if (!effectKey || base.status !== 'pronta') return
    let active = true
    const [price, unit, validFrom] = effectKey.split('|')
    setEffectLoading(true)
    const timer = setTimeout(() => {
      loadBuckPricePreview(item.id, { price: Number(price), unit: unit as BuckPricingUnit, validFrom })
        .then(result => { if (active) setEffect(result) })
        .catch(error => { if (active) setEffectError(errorText(error, 'Não foi possível calcular o efeito da troca.')) })
        .finally(() => { if (active) setEffectLoading(false) })
    }, 400)
    return () => { active = false; clearTimeout(timer); setEffectLoading(false) }
  }, [effectKey, item.id, base.status])

  const blocker = useMemo(() => {
    if (!preview) return 'Carregando o preço em vigor.'
    const local = validateBuckPriceDraft(draft, preview)
    if (local) return local
    if (effectLoading || (!effect && !effectError)) return 'Calculando o efeito da troca.'
    if (effectError) return effectError
    if (effect?.problema) return effect.problema
    return null
  }, [draft, preview, effect, effectLoading, effectError])

  const save = async () => {
    if (savingRef.current || blocker) return
    savingRef.current = true
    setSaving(true)
    setSaveError(null)
    try {
      await changeBuckPrice(item.id, draft)
      const price = parseBuckPriceInput(draft.priceText).value ?? 0
      showToast(`Preço trocado: ${formatBuckPrice(price, draft.unit)} a partir de ${formatDateBR(draft.validFrom)}. Semanas em aberto desde então já usam o preço novo.`, 5200)
      await onSaved()
    } catch (error) {
      setSaveError(errorText(error, 'Não foi possível trocar o preço.'))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const ratio = parsed.value !== null ? priceChangeRatio(currentPrice, parsed.value) : null

  return (
    <section ref={cardRef} className="ps-card" style={{ marginTop: 14, borderColor: 'var(--honey-deep)' }} aria-label={`Trocar preço de ${item.product_name}`}>
      <div className="ps-card-head">
        <div>
          <b>Trocar preço</b>
          <small>
            {item.product_name}
            {preview?.vigente && <> · em vigor {formatBuckPrice(preview.vigente.unit_price, preview.vigente.pricing_unit)} {formatSince(preview.vigente.valid_from)}</>}
          </small>
        </div>
        <button type="button" className="ps-iconbtn" onClick={onClose} disabled={saving} aria-label="Fechar troca de preço"><X size={16} /></button>
      </div>

      {base.status === 'carregando' && <div className="ps-hint" style={{ marginTop: 12 }}>Carregando o preço em vigor...</div>}
      {base.status === 'erro' && (
        <div className="ps-alert error" role="alert" style={{ marginTop: 12 }}>
          {base.message}
          <div className="ps-fieldrow" style={{ marginTop: 8 }}>
            <button type="button" className="ps-btn ghost sm" onClick={() => setAttempt(current => current + 1)}>Tentar de novo</button>
          </div>
        </div>
      )}

      {preview && (
        <>
          <div className="ps-fieldgroup" style={{ marginTop: 14 }}>
            <label className="ps-fieldlabel" htmlFor="buck-price-value">Preço novo (R$) *</label>
            <input
              id="buck-price-value"
              className="ps-input"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              value={draft.priceText}
              onChange={event => setDraft(current => ({ ...current, priceText: event.target.value, bigChangeConfirmed: false }))}
            />
            {draft.priceText.trim() && parsed.error && <small className="ps-hint" style={{ color: 'var(--berry)' }}>{parsed.error}</small>}
          </div>

          <div className="ps-fieldgroup" style={{ marginTop: 12 }}>
            <label className="ps-fieldlabel" htmlFor="buck-price-unit">Unidade</label>
            <select
              id="buck-price-unit"
              className="ps-select"
              value={draft.unit}
              onChange={event => setDraft(current => ({ ...current, unit: event.target.value as BuckPricingUnit, bigChangeConfirmed: false }))}
            >
              <option value="un">un</option>
              <option value="kg">kg</option>
            </select>
            {draft.unit !== item.pricing_unit && (
              <small className="ps-hint">A unidade muda junto com o preço, a partir da mesma data.</small>
            )}
          </div>

          <div className="ps-fieldgroup" style={{ marginTop: 12 }}>
            <label className="ps-fieldlabel" htmlFor="buck-price-valid-from">Vale a partir de *</label>
            <input
              id="buck-price-valid-from"
              type="date"
              className="ps-input"
              min={preview.data_minima}
              max={preview.hoje}
              value={draft.validFrom}
              onChange={event => setDraft(current => ({ ...current, validFrom: event.target.value }))}
            />
            <small className="ps-hint">
              Hoje ou um dia passado, a partir de {formatDateBR(preview.data_minima)}: {minimumDateReason(preview.motivo_data_minima)}.
            </small>
          </div>

          <fieldset className="ps-fieldgroup" style={{ marginTop: 12, border: 0, padding: 0 }}>
            <legend className="ps-fieldlabel">Motivo *</legend>
            {BUCK_PRICE_REASONS.map(option => (
              <label key={option.value} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, padding: '6px 0', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="buck-price-reason"
                  value={option.value}
                  checked={draft.reason === option.value}
                  onChange={() => setDraft(current => ({ ...current, reason: option.value }))}
                />
                {option.label}
              </label>
            ))}
            <textarea
              aria-label="Detalhe do motivo"
              className="ps-textarea"
              rows={2}
              maxLength={BUCK_PRICE_DETAIL_MAX}
              placeholder={draft.reason === 'outro' ? 'Escreva o motivo (obrigatório)' : 'Detalhe (opcional), ex.: combinado com o gerente da Buck por WhatsApp'}
              value={draft.detail}
              onChange={event => setDraft(current => ({ ...current, detail: event.target.value }))}
            />
          </fieldset>

          {confirmation && currentPrice !== null && parsed.value !== null && (
            <label className="ps-alert" style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={draft.bigChangeConfirmed}
                onChange={event => setDraft(current => ({ ...current, bigChangeConfirmed: event.target.checked }))}
              />
              <span>
                {confirmation === 'unidade' ? (
                  <>Confirmo: a unidade muda de {preview.vigente?.pricing_unit} para {draft.unit}; o preço passa a ser {formatBuckPrice(parsed.value, draft.unit)}.</>
                ) : (
                  <>
                    Confirmo: o preço {parsed.value > currentPrice ? 'sobe' : 'desce'} {Math.round((ratio ?? 0) * 100)}%,
                    de {formatBuckPrice(currentPrice, preview.vigente?.pricing_unit ?? draft.unit)} para {formatBuckPrice(parsed.value, draft.unit)}.
                  </>
                )}
              </span>
            </label>
          )}

          {effect && !effect.problema && (
            <div className="ps-alert" role="status" style={{ marginTop: 12 }}>
              {(effect.semanas ?? []).length === 0 ? (
                <div>Este pão não saiu para a EX de {formatDateBR(draft.validFrom)} até hoje: a troca vale para os próximos romaneios.</div>
              ) : (
                <>
                  <b>O que muda na cobrança da Buck, só deste pão</b>
                  {(effect.semanas ?? []).map(week => (
                    <div key={week.de} style={{ marginTop: 4 }}>
                      Semana de {formatDateBR(week.de)} a {formatDateBR(week.ate)}: {Number(week.quantidade).toLocaleString('pt-BR')} {week.unidade ?? ''}
                      {week.problema_depois ? (
                        <> · <span style={{ color: 'var(--berry)' }}>a conta deste pão na semana fica com problema (sem preço, unidade diferente ou peso) e não entra na cobrança até ser resolvida no Fechamento EX</span></>
                      ) : (
                        <> · {week.problema_antes ? 'antes sem conta' : formatCurrencyBRL(Number(week.antes))} → {formatCurrencyBRL(Number(week.depois))}
                          {!week.problema_antes && <> ({signedBRL(Number(week.depois) - Number(week.antes))})</>}</>
                      )}
                    </div>
                  ))}
                </>
              )}
              {(effect.deixam_de_valer ?? []).length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <b>Deixa de valer</b>, porque a data nova cobre o período:
                  {(effect.deixam_de_valer ?? []).map(previous => (
                    <div key={`${previous.valid_from}-${previous.unit_price}`}>
                      {formatBuckPrice(previous.unit_price, previous.pricing_unit)} a partir de {formatDateBR(previous.valid_from)}
                    </div>
                  ))}
                </div>
              )}
              <small className="ps-hint" style={{ display: 'block', marginTop: 6 }}>Semana já cobrada não muda.</small>
            </div>
          )}

          {saveError && <div className="ps-alert error" role="alert" style={{ marginTop: 12 }}>{saveError}</div>}

          <div className="ps-fieldrow" style={{ marginTop: 16 }}>
            <button type="button" className="ps-btn primary block" onClick={save} disabled={!!blocker || saving}>
              {saving ? 'Gravando...' : 'Trocar preço'}
            </button>
            <button type="button" className="ps-btn ghost block" onClick={onClose} disabled={saving}>Cancelar</button>
          </div>
          {blocker && !saving && (
            <small className="ps-hint" data-testid="buck-price-blocker" style={{ display: 'block', marginTop: 6 }}>{blocker}</small>
          )}
        </>
      )}
    </section>
  )
}
