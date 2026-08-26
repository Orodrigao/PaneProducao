'use client'

import type {
  BreadDemandStore,
  BreadDemandStoreSummary,
  BreadDemandSummary,
  FirmBreadDemandSummary,
} from '@/lib/breadDemandHistory'

export type BreadDemandHistoryLoadState = 'loading' | 'ready' | 'error'

interface BreadDemandHistoryBlockProps {
  state: BreadDemandHistoryLoadState
  summary?: BreadDemandSummary
  onRetry: () => void
}

const STORE_LABEL: Record<BreadDemandStore, string> = {
  jc: 'JC',
  ja: 'JA',
}

function formatQuantity(value: number | null): string {
  if (value == null) return '—'
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
}

function historyValue(
  store: BreadDemandStore,
  storeSummary: BreadDemandStoreSummary,
  unit: BreadDemandSummary['unit'],
): string {
  if (storeSummary.average == null) return `${STORE_LABEL[store]} sem histórico`
  const provisional = storeSummary.confidence === 'provisional' ? ' (provisório)' : ''
  const unitLabel = unit === 'kg' ? ' kg' : ''
  return `${STORE_LABEL[store]} ${formatQuantity(storeSummary.average)}${unitLabel}${provisional}`
}

function historyDetail(
  store: BreadDemandStore,
  storeSummary: BreadDemandStoreSummary,
  weekdayPlural: string,
): string {
  if (storeSummary.confidence === 'insufficient') {
    const daysLabel = storeSummary.validDays === 1 ? 'dia encontrado' : 'dias encontrados'
    return `${STORE_LABEL[store]}: sem histórico suficiente · ${storeSummary.validDays} ${daysLabel}`
  }

  const noLeftoverLabel = storeSummary.noLeftoverDays === 1
    ? '1 dia sem sobrar nada'
    : `${storeSummary.noLeftoverDays} dias sem sobrar nada`
  return `${STORE_LABEL[store]}: ${storeSummary.validDays} ${weekdayPlural} válidas · faixa ${formatQuantity(storeSummary.minimum)} a ${formatQuantity(storeSummary.maximum)} · ${noLeftoverLabel}`
}

function firmValue(summary: FirmBreadDemandSummary): string {
  if (summary.mixedUnits) return 'lançamento misto'
  const unitLabel = summary.unit === 'kg' && summary.quantity !== 0 ? ' kg' : ''
  return `${formatQuantity(summary.quantity)}${unitLabel}`
}

function LoadingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Carregando média de saída" style={{ display: 'grid', gap: 7 }}>
      {[86, 72, 64].map(width => (
        <span
          key={width}
          style={{
            display: 'block',
            width: `${width}%`,
            height: 12,
            borderRadius: 999,
            background: 'var(--line-soft)',
          }}
        />
      ))}
    </div>
  )
}

export function BreadDemandHistoryBlock({
  state,
  summary,
  onRetry,
}: BreadDemandHistoryBlockProps) {
  return (
    <div
      style={{
        marginTop: 10,
        padding: '10px 12px',
        borderRadius: 12,
        background: 'var(--honey-tint)',
        color: 'var(--ink-soft)',
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1.45,
      }}
    >
      {state === 'loading' && <LoadingSkeleton />}

      {state === 'error' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span>Não foi possível carregar a média de saída.</span>
          <button type="button" className="ps-btn ghost" onClick={onRetry} style={{ minHeight: 32, padding: '6px 10px' }}>
            Tentar de novo
          </button>
        </div>
      )}

      {state === 'ready' && !summary && (
        <span>Sem histórico suficiente.</span>
      )}

      {state === 'ready' && summary && (
        <div style={{ display: 'grid', gap: 4 }}>
          {summary.mixedUnits ? (
            <b style={{ color: 'var(--berry)' }}>Lançamento misto (un e kg) — média não calculada.</b>
          ) : (
            <b style={{ color: 'var(--ps-ink)' }}>
              Saiu nas {summary.weekdayPlural}: {' '}
              {historyValue('jc', summary.stores.jc, summary.unit)} · {' '}
              {historyValue('ja', summary.stores.ja, summary.unit)}
              {summary.totalAverage != null && (
                <>
                  {' '}· total {formatQuantity(summary.totalAverage)}{summary.unit === 'kg' ? ' kg' : ''}
                  {(summary.stores.jc.confidence === 'provisional' || summary.stores.ja.confidence === 'provisional')
                    ? ' (provisório)'
                    : ''}
                </>
              )}
            </b>
          )}

          {!summary.mixedUnits && (
            <>
              <span>{historyDetail('jc', summary.stores.jc, summary.weekdayPlural)}</span>
              <span>{historyDetail('ja', summary.stores.ja, summary.weekdayPlural)}</span>
            </>
          )}

          <span style={{ color: 'var(--ps-ink)' }}>
            Firme: EX {firmValue(summary.firm.ex)} · PJ {firmValue(summary.firm.pj)} · encomenda {firmValue(summary.firm.encomenda)}
          </span>
        </div>
      )}
    </div>
  )
}
