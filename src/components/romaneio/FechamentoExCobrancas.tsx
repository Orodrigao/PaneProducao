'use client'

// As semanas já cobradas no Fechamento EX (Tabela Buck, fase 3): o que foi
// cobrado, pela foto da confirmação no Contas a receber, e o que mudou nos
// romaneios depois, fora do valor cobrado.

import { AlertTriangle } from 'lucide-react'
import { BUCK_ADJUSTMENT_KIND_LABELS, type BuckAdjustmentKind } from '@/lib/buckWeeklyBilling'
import {
  billedPeriodLabel,
  changeLabel,
  formatBRL,
  formatDayMonth,
  formatQuantity,
  type FechamentoExAjuste,
  type FechamentoExCobranca,
  type FechamentoExMudanca,
} from '@/lib/romaneioExFechamento'

export function adjustmentText(ajuste: FechamentoExAjuste): string {
  const kind = BUCK_ADJUSTMENT_KIND_LABELS[ajuste.kind as BuckAdjustmentKind] ?? ajuste.kind
  const product = ajuste.productName && ajuste.quantity !== null
    ? ` (${ajuste.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${ajuste.unit ?? ''} de ${ajuste.productName})`
    : ''
  return `${kind} · ${ajuste.description}${product}`
}

export function signedBRL(value: number): string {
  return value > 0 ? `+${formatBRL(value)}` : formatBRL(value)
}

export function changeText(mudanca: FechamentoExMudanca): string {
  const quantity = `${mudanca.quantity > 0 ? '+' : ''}${formatQuantity(mudanca.quantity, mudanca.unit)}`
  const days = mudanca.dates.length ? ` · ${mudanca.dates.map(formatDayMonth).join(', ')}` : ''
  return `${quantity} ${mudanca.productName} · ${changeLabel(mudanca.kind)}${days}`
}

function changeValue(mudanca: FechamentoExMudanca): string {
  if (mudanca.total !== null) return signedBRL(mudanca.total)
  return mudanca.issues.includes('missing_price') ? 'sem preço na Tabela Buck' : 'sem valor: confira o lançamento'
}

function BilledWeek({ cobranca, rangeFrom }: { cobranca: FechamentoExCobranca; rangeFrom: string }) {
  const label = billedPeriodLabel(cobranca.periodStart, cobranca.periodEnd)
  return (
    <article className="ps-card" aria-label={label} style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <b>{label}</b>
        <b data-testid="fechamento-ex-cobrado">Cobrado {formatBRL(cobranca.amount)}</b>
      </div>
      {cobranca.periodStart < rangeFrom && (
        <span className="ps-help" style={{ marginTop: -6 }}>
          Começa antes do período escolhido: a semana aparece inteira aqui, no período que contém o domingo dela.
        </span>
      )}

      {cobranca.withPhoto ? (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 13 }}>
            Romaneios {formatBRL(cobranca.lines.total)} · {cobranca.lines.tripCount} viagem(ns) · {cobranca.lines.rows.length} produto(s)
          </summary>
          <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 6 }} aria-label={`Linhas cobradas na ${label.toLowerCase()}`}>
            {cobranca.lines.rows.map(row => (
              <li key={row.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
                <span>
                  {row.productName}
                  <span style={{ display: 'block', color: 'var(--ink-soft)', fontSize: 11 }}>
                    {formatQuantity(row.billedQuantity, row.billingUnit)} × {row.unitPrice === null ? '—' : `${formatBRL(row.unitPrice)}/${row.billingUnit}`}
                  </span>
                </span>
                <b>{row.total === null ? '—' : formatBRL(row.total)}</b>
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <span className="ps-help">
          Cobrança feita pelo botão antigo do Fechamento EX: o sistema não guardou as linhas, então mostra só o valor e não confere o que mudou depois.
        </span>
      )}

      {cobranca.adjustments.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }} aria-label={`Ajustes da ${label.toLowerCase()}`}>
          {cobranca.adjustments.map(ajuste => (
            <li key={ajuste.position} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
              <span>{adjustmentText(ajuste)}</span>
              <b>{signedBRL(ajuste.amount)}</b>
            </li>
          ))}
        </ul>
      )}

      {cobranca.changes.length > 0 && (
        <div className="ps-warning" role="note" aria-label={`Mudou depois da cobrança da ${label.toLowerCase()}`} style={{ display: 'grid', gap: 6 }}>
          <b style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={16}/> Mudou nos romaneios depois da cobrança, fora do valor cobrado
          </b>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
            {cobranca.changes.map(mudanca => (
              <li key={mudanca.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
                <span>{changeText(mudanca)}</span>
                <b>{changeValue(mudanca)}</b>
              </li>
            ))}
          </ul>
          <span style={{ fontSize: 12 }}>
            {cobranca.changesWithoutValue ? 'Diferença com valor' : 'Diferença'}: {signedBRL(cobranca.changesTotal)}.
            {' '}Se for cobrar ou devolver, entra como acerto na próxima cobrança da Buck.
          </span>
        </div>
      )}
    </article>
  )
}

export default function FechamentoExCobrancas({
  cobrancas,
  rangeFrom,
}: {
  cobrancas: FechamentoExCobranca[]
  rangeFrom: string
}) {
  if (cobrancas.length === 0) return null
  return (
    <section aria-labelledby="fechamento-ex-ja-cobrado" style={{ marginTop: 14 }}>
      <div className="ps-section-row">
        <h2 id="fechamento-ex-ja-cobrado">Já cobrado</h2>
      </div>
      <p className="ps-help" style={{ marginTop: 0 }}>
        O que foi cobrado da Buck em cada semana, como ficou na confirmação do Contas a receber. Cobrado não quer dizer pago.
      </p>
      {cobrancas.map(cobranca => (
        <BilledWeek key={cobranca.receivableId} cobranca={cobranca} rangeFrom={rangeFrom}/>
      ))}
    </section>
  )
}
