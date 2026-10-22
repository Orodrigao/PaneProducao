'use client'
import {
  formatMoney,
  formatPercent,
  formatPeriodDate,
  isTrendRowFlagged,
  type ConsumptionTrendRow,
} from '@/lib/inventoryConsumption'

type Props = {
  rows: ConsumptionTrendRow[]
  showRevenue: boolean
}

// Evolucao semana a semana. Semana parcial ou fora dos 7 dias leva "*" e a legenda explica:
// numero incompleto nunca se passa por comparavel.
export default function ConsumptionTrend({ rows, showRevenue }: Props) {
  if (rows.length < 2) return null
  const anyPartial = rows.some(isTrendRowFlagged)

  return (
    <div className="ps-card" style={{marginTop:14, padding:'14px 16px'}}>
      <div style={{fontSize:12, color:'var(--ink-soft)', marginBottom:8}}>Semana a semana</div>
      <div style={{
        display:'grid',
        gridTemplateColumns: showRevenue ? 'auto 1fr 1fr auto' : 'auto 1fr',
        gap:'6px 12px',
        fontSize:12.5,
      }}>
        <span style={{color:'var(--ink-faint)'}}>Até</span>
        <span style={{color:'var(--ink-faint)', textAlign:'right'}}>Consumo</span>
        {showRevenue && <span style={{color:'var(--ink-faint)', textAlign:'right'}}>Venda</span>}
        {showRevenue && <span style={{color:'var(--ink-faint)', textAlign:'right'}}>CMV</span>}
        {rows.map(row => {
          const partial = isTrendRowFlagged(row)
          return (
            <div key={row.period.period_end_count_id} style={{display:'contents'}}>
              <span>sáb {formatPeriodDate(row.period.period_end_date)}</span>
              <span style={{textAlign:'right'}}>{formatMoney(row.summary.totalValue)}{partial ? '*' : ''}</span>
              {showRevenue && (
                <span style={{textAlign:'right'}}>{row.cmv ? formatMoney(row.cmv.revenueTotal) : '—'}</span>
              )}
              {showRevenue && (
                <b style={{textAlign:'right'}}>{formatPercent(row.cmv?.percent ?? null)}{partial ? '*' : ''}</b>
              )}
            </div>
          )
        })}
      </div>
      {anyPartial && (
        <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:8}}>
          * semana com consumo ou venda incompletos, insumo para conferir ou intervalo diferente de 7 dias entre as contagens: não compare direto com as outras.
        </div>
      )}
    </div>
  )
}
