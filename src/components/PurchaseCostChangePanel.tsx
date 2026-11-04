'use client'

import { useEffect, useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { formatDateBR, todayKey } from '@/lib/utils'
import { daysBefore, formatUnitCost, formatVariation, MINIMUM_INCREASE, type CostChange, type CostPoint } from '@/lib/purchaseCostChange'
import { loadRecentCostChanges } from '@/lib/purchaseCostChangeClient'

export const PANEL_DAYS = 30
const VISIBLE_ROWS = 8

export type RecentCostChange = CostChange & { point: CostPoint }

export type CostChangePanelState =
  | { status: 'carregando' }
  | { status: 'erro' }
  | { status: 'pronto'; changes: RecentCostChange[] }

/** De onde veio cada custo: esta nota e a anterior, com o fornecedor quando muda. */
function noteLine({ point, previous }: RecentCostChange): string {
  const current = `NF ${point.nfeNumber ?? 'sem número'} de ${formatDateBR(point.issueDate)}${point.supplierName ? ` · ${point.supplierName}` : ''}`
  if (!previous) return current
  const otherSupplier = previous.supplierName && previous.supplierName !== point.supplierName ? ` (${previous.supplierName})` : ''
  return `${current} · antes: NF ${previous.nfeNumber ?? 'sem número'} de ${formatDateBR(previous.issueDate)}${otherSupplier}`
}

function ChangeRow({ change }: { change: RecentCostChange }) {
  const { point, previous } = change
  const unit = point.productUnit
  const large = change.kind === 'muito_diferente'
  const variation = change.ratio === null ? 'muito diferente' : formatVariation(change.ratio)
  return (
    <li style={{ marginTop: 8, listStyle: 'none' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <b style={{ flex: 1 }}>{point.productName ?? 'Cadastro'}</b>
        <small style={{ color: large ? 'var(--berry)' : 'var(--honey-deep)', fontWeight: 650 }}>{large ? `${variation} · confira a quantidade por embalagem` : variation}</small>
      </div>
      <small style={{ display: 'block' }}>{`${previous ? `${formatUnitCost(previous.unitCost, unit)} → ` : ''}${formatUnitCost(point.unitCost, unit)}`}</small>
      <small className="ps-help" style={{ display: 'block' }}>{noteLine(change)}</small>
    </li>
  )
}

/** O quadro em si, sem leitura: a página e o teste montam o estado. */
export function CostChangePanelView({ state }: { state: CostChangePanelState }) {
  const [showAll, setShowAll] = useState(false)
  const minimum = `${Math.round(MINIMUM_INCREASE * 100)}%`
  return (
    <div className="ps-card" style={{ marginTop: 12 }}>
      <b><TrendingUp size={15} aria-hidden style={{ verticalAlign: '-2px' }} />{` Altas e variações grandes de custo, notas dos últimos ${PANEL_DAYS} dias`}</b>
      {state.status === 'carregando' && <small className="ps-help" style={{ display: 'block', marginTop: 4 }}>Conferindo as notas recentes...</small>}
      {state.status === 'erro' && <small role="alert" style={{ display: 'block', marginTop: 4, color: 'var(--berry)' }}>Não foi possível conferir as altas de custo agora. O restante do Contas a pagar segue normal; atualize a página para tentar de novo.</small>}
      {state.status === 'pronto' && state.changes.length === 0 && (
        <small className="ps-help" style={{ display: 'block', marginTop: 4 }}>{`Nenhum cadastro subiu ${minimum} ou mais, nem teve variação grande, sobre a compra anterior.`}</small>
      )}
      {state.status === 'pronto' && state.changes.length > 0 && (
        <>
          <small className="ps-help" style={{ display: 'block', marginTop: 4 }}>
            {`Alta de ${minimum} ou mais, ou variação grande para cima ou para baixo, sobre a compra anterior do mesmo cadastro, nas notas emitidas no período que trocaram o custo. O preço de venda não muda sozinho.`}
          </small>
          <ul style={{ margin: 0, padding: 0 }}>
            {(showAll ? state.changes : state.changes.slice(0, VISIBLE_ROWS)).map(change => <ChangeRow key={`${change.point.purchaseId}-${change.productId}`} change={change} />)}
          </ul>
          {state.changes.length > VISIBLE_ROWS && (
            <button type="button" className="ps-btn ghost sm" style={{ marginTop: 8 }} onClick={() => setShowAll(value => !value)}>
              {showAll ? 'Mostrar menos' : `Mostrar todas as ${state.changes.length}`}
            </button>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Altas de custo das notas recentes, para quem decide o preço não depender de
 * ter visto a importação: quase toda nota entra pela automação. Falha aqui não
 * derruba o resto da página.
 */
export default function PurchaseCostChangePanel({ refreshKey }: { refreshKey: unknown }) {
  const [state, setState] = useState<CostChangePanelState>({ status: 'carregando' })

  useEffect(() => {
    let cancelled = false
    setState(previous => previous.status === 'pronto' ? previous : { status: 'carregando' })
    void loadRecentCostChanges(daysBefore(todayKey(), PANEL_DAYS)).then(changes => {
      if (!cancelled) setState({ status: 'pronto', changes })
    }).catch(error => {
      console.error(error)
      if (!cancelled) setState({ status: 'erro' })
    })
    return () => { cancelled = true }
  }, [refreshKey])

  return <CostChangePanelView state={state} />
}
