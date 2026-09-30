import {
  formatCoveragePercent,
  formatExpensePercent,
  formatIndicatorCurrency,
  formatIndicatorMonth,
  PRICING_INDICATORS_ERROR,
  type PricingIndicatorMonth,
  type PricingIndicatorsAverage,
  type PricingIndicatorsState,
} from '@/lib/pricingIndicators'

interface PricingIndicatorsProps {
  state: PricingIndicatorsState
}

function ProvisionalNotice({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null
  return (
    <ul aria-label="Motivos de valor provisório" style={{ margin: '6px 0 0', paddingLeft: 18, color: 'var(--ink-soft)', fontSize: 12 }}>
      {reasons.map((reason) => <li key={reason}>{reason}</li>)}
    </ul>
  )
}

function IndicatorCells({ row }: { row: PricingIndicatorMonth | PricingIndicatorsAverage }) {
  return (
    <>
      <td>{formatIndicatorCurrency(row.revenue)}</td>
      <td>
        {formatIndicatorCurrency(row.fixed_expenses)}
        <small style={{ display: 'block' }}>{formatExpensePercent(row.fixed_expense_pct)} do faturamento</small>
        {row.is_provisional && <ProvisionalNotice reasons={row.provisional_reasons} />}
      </td>
      <td>{formatIndicatorCurrency(row.production_labor)}</td>
      <td>{new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(row.kilograms_with_known_weight)} kg</td>
      <td>
        {formatCoveragePercent(row.weight_coverage_pct)}
      </td>
      <td>{formatIndicatorCurrency(row.labor_cost_per_kg)} / kg</td>
    </>
  )
}

export function PricingIndicators({ state }: PricingIndicatorsProps) {
  if (state.status === 'loading') {
    return <p className="ps-pad" role="status" aria-busy="true">Carregando indicadores do Financeiro…</p>
  }

  if (state.status === 'empty') {
    return <p className="ps-pad" role="status">Ainda não há mês completo no Financeiro.</p>
  }

  if (state.status === 'error') {
    return <p className="ps-pad" role="alert">{PRICING_INDICATORS_ERROR}</p>
  }

  return (
    <section className="ps-card" aria-labelledby="pricing-indicators-title" style={{ marginTop: 14 }}>
      <div className="ps-card-head">
        <div>
          <b id="pricing-indicators-title">Números recentes do Financeiro</b>
          <small>Meses fechados desde setembro de 2026. Valores provisórios mostram o motivo ao lado.</small>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 760, fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: 'left' }}>Mês</th>
              <th scope="col" style={{ textAlign: 'left' }}>Faturamento</th>
              <th scope="col" style={{ textAlign: 'left' }}>Despesas fixas</th>
              <th scope="col" style={{ textAlign: 'left' }}>Mão de obra</th>
              <th scope="col" style={{ textAlign: 'left' }}>Quilos com peso</th>
              <th scope="col" style={{ textAlign: 'left' }}>Cobertura do peso</th>
              <th scope="col" style={{ textAlign: 'left' }}>Mão de obra por quilo</th>
            </tr>
          </thead>
          <tbody>
            {state.data.months.map((month) => (
              <tr key={month.month}>
                <th scope="row" style={{ textAlign: 'left', verticalAlign: 'top' }}>{formatIndicatorMonth(month.month)}</th>
                <IndicatorCells row={month} />
              </tr>
            ))}
            {state.data.average && (
              <tr>
                <th scope="row" style={{ textAlign: 'left', verticalAlign: 'top' }}>
                  Média
                  <small style={{ display: 'block' }}> {state.data.average.months_included.map(formatIndicatorMonth).join(', ')}</small>
                </th>
                <IndicatorCells row={state.data.average} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
