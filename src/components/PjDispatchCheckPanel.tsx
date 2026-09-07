'use client'

import { useMemo, useState } from 'react'
import { ClipboardCheck, Ban, RotateCcw } from 'lucide-react'
import {
  confirmationQuestion,
  problemsBeforeSaving,
  verdictForLine,
  type CheckLineState,
} from '@/lib/pjDispatchCheck'

export interface DispatchCheckLine {
  orderId: string
  productLabel: string
  /** A estimativa lançada no pedido. */
  estimated: number
  pricingUnit: string | null
  packSize: number | null
  /** O que já está gravado no banco. `null` = ainda não conferido. */
  sent: number | null
  reason: string | null
  checkedAt: string | null
  checkedByName: string | null
}

interface Props {
  lines: DispatchCheckLine[]
  saving: boolean
  onSave: (items: Array<{ order_id: string; quantity: number | null; reason: string | null }>) => void
}

interface Draft {
  value: string
  reason: string
  notSent: boolean
}

function unitLabel(pricingUnit: string | null): string {
  return (pricingUnit || 'un') === 'kg' ? 'kg' : 'un'
}

function formatStored(value: number | null, pricingUnit: string | null): string {
  if (value === null) return ''
  return unitLabel(pricingUnit) === 'kg'
    ? String(value).replace('.', ',')
    : String(value)
}

/**
 * Aceita vírgula como o teclado do celular manda, e devolve exatamente o que
 * foi digitado.
 *
 * Nada de arredondar item por unidade aqui: truncar 1,9 para 1 gravaria um
 * número diferente do que a pessoa viu, em silêncio. Quem recusa fração em
 * item por unidade é o veredito, com mensagem escrita na tela.
 */
function parseTyped(raw: string): number | null {
  const limpo = raw.trim().replace(',', '.')
  if (!limpo) return null
  const numero = Number(limpo)
  return Number.isFinite(numero) ? numero : null
}

/**
 * A conferência item a item da Expedição.
 *
 * Regras que a tela precisa deixar visíveis, e não escondidas:
 *   - o que já foi gravado aparece com quem gravou e quando;
 *   - "não enviei este item" grava ZERO com motivo, nunca ausência;
 *   - o que impede o salvamento aparece escrito ao lado do campo.
 */
export function PjDispatchCheckPanel({ lines, saving, onSave }: Props) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => {
    const inicial: Record<string, Draft> = {}
    lines.forEach(line => {
      inicial[line.orderId] = {
        value: formatStored(line.sent, line.pricingUnit),
        reason: line.reason || '',
        notSent: line.sent === 0,
      }
    })
    return inicial
  })

  const estados = useMemo<CheckLineState[]>(() => lines.map(line => {
    const draft = drafts[line.orderId]
    const sent = draft?.notSent ? 0 : parseTyped(draft?.value ?? '')
    return {
      orderId: line.orderId,
      productLabel: line.productLabel,
      estimated: line.estimated,
      sent,
      pricingUnit: line.pricingUnit,
      reason: draft?.reason ?? '',
    }
  }), [lines, drafts])

  // Linha ainda em branco não é problema: é linha que a pessoa não mexeu.
  const problemas = useMemo(
    () => problemsBeforeSaving(estados.filter(estado => estado.sent !== null)),
    [estados],
  )
  const problemaPorLinha = useMemo(() => {
    const mapa: Record<string, string> = {}
    problemas.forEach(p => { mapa[p.orderId] = p.message })
    return mapa
  }, [problemas])

  /**
   * Só as linhas realmente alteradas viajam para o banco.
   *
   * Mandar todas faria duas coisas erradas: linha ainda em branco iria como
   * "sem valor" e desfaria a transação inteira, impedindo conferir um item por
   * vez; e cada gravação carimbaria de novo TODAS as linhas com o autor da
   * última correção, apagando quem realmente conferiu cada uma.
   */
  const alteradas = useMemo(() => estados.filter((estado, i) => {
    const original = lines[i]
    const motivoOriginal = original.reason || ''
    return estado.sent !== original.sent || estado.reason.trim() !== motivoOriginal.trim()
  }), [estados, lines])
  const alterou = alteradas.length > 0

  const atualiza = (orderId: string, patch: Partial<Draft>) => {
    setDrafts(anterior => ({
      ...anterior,
      [orderId]: { ...anterior[orderId], ...patch },
    }))
  }

  const salvar = () => {
    if (problemas.length > 0 || saving) return
    onSave(alteradas.map(estado => ({
      order_id: estado.orderId,
      quantity: estado.sent,
      reason: estado.reason.trim() || null,
    })))
  }

  return (
    <div style={{
      border: '1px solid var(--line-soft)',
      borderRadius: 'var(--r-card)',
      padding: '14px 14px 12px',
      marginBottom: 14,
      display: 'grid',
      gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <ClipboardCheck size={16} />
        <strong style={{ fontSize: 14 }}>Conferência do que vai sair</strong>
      </div>

      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-soft)' }}>
        Digite quanto vai de cada item. <strong>Este número é o que o cliente vai pagar</strong> e é
        o que a nota fiscal vai levar, então confira antes de salvar.
      </p>

      <div style={{ display: 'grid', gap: 10 }}>
        {lines.map(line => {
          const draft = drafts[line.orderId]
          const estado = estados.find(e => e.orderId === line.orderId)
          const problema = problemaPorLinha[line.orderId]
          const veredito = estado ? verdictForLine(estado) : 'ok'
          const precisaMotivo = veredito === 'exige_motivo'
          const unidade = unitLabel(line.pricingUnit)

          return (
            <div
              key={line.orderId}
              style={{
                display: 'grid',
                gap: 6,
                padding: '10px 12px',
                background: 'var(--line-soft)',
                borderRadius: 'var(--r-ctrl)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{line.productLabel}</span>
                <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>
                  pedido: {line.estimated} {unidade}
                  {line.packSize && line.packSize > 1 && (
                    <> · {Math.round(line.estimated / line.packSize)} cx × {line.packSize}</>
                  )}
                </span>
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  inputMode={unidade === 'kg' ? 'decimal' : 'numeric'}
                  className="ps-input"
                  style={{ maxWidth: 130 }}
                  placeholder={`quanto vai (${unidade})`}
                  value={draft?.notSent ? '' : (draft?.value ?? '')}
                  disabled={draft?.notSent || saving}
                  onChange={e => atualiza(line.orderId, { value: e.target.value })}
                />
                <button
                  type="button"
                  className={draft?.notSent ? 'ps-btn danger' : 'ps-btn ghost'}
                  style={{ fontSize: 12 }}
                  disabled={saving}
                  onClick={() => atualiza(line.orderId, {
                    notSent: !draft?.notSent,
                    value: draft?.notSent ? draft.value : '',
                  })}
                >
                  {draft?.notSent ? <RotateCcw size={13} /> : <Ban size={13} />}
                  {draft?.notSent ? 'Voltar a incluir' : 'Este item não vai'}
                </button>
              </div>

              {precisaMotivo && (
                <>
                  {!draft?.notSent && estado && (
                    <span style={{
                      fontSize: 12.5,
                      color: 'var(--crust)',
                      fontWeight: 600,
                      background: 'var(--honey-soft, #F5ECD2)',
                      padding: '6px 8px',
                      borderRadius: 'var(--r-ctrl)',
                    }}>
                      {confirmationQuestion(estado)}
                    </span>
                  )}
                  <input
                    type="text"
                    className="ps-input"
                    placeholder={draft?.notSent ? 'Por que este item não vai?' : 'Por que a quantidade mudou?'}
                    value={draft?.reason ?? ''}
                    disabled={saving}
                    onChange={e => atualiza(line.orderId, { reason: e.target.value })}
                  />
                </>
              )}

              {problema && (
                <span style={{ fontSize: 12, color: 'var(--tomato, #A93A2E)', fontWeight: 500 }}>
                  {problema}
                </span>
              )}

              {line.checkedAt && (
                <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
                  Já conferido por {line.checkedByName || 'expedição'} às{' '}
                  {new Date(line.checkedAt).toLocaleString('pt-BR', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              )}
            </div>
          )
        })}
      </div>

      <button
        type="button"
        className="ps-btn primary"
        style={{ width: '100%', justifyContent: 'center' }}
        disabled={saving || problemas.length > 0 || !alterou}
        onClick={salvar}
      >
        {saving ? 'Salvando conferência…' : 'Salvar conferência'}
      </button>

      {!saving && problemas.length === 0 && !alterou && (
        <span style={{ fontSize: 12, color: 'var(--ink-faint)', textAlign: 'center' }}>
          Nada mudou desde a última gravação.
        </span>
      )}
    </div>
  )
}
