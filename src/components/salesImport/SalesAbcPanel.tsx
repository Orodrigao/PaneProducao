'use client'

import { useCallback, useEffect, useState } from 'react'
import { coverageLabel, salesPeriodForPreset, type SalesAbcResult, type SalesPeriodPreset } from '@/lib/salesImport/analytics'
import { loadSalesAbc } from '@/lib/salesImport/analyticsClient'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const quantity = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 })
const percent = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })

function dateLabel(value: string): string {
  return value.split('-').reverse().join('/')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Não foi possível calcular a curva ABC.'
}

export function SalesAbcPanel() {
  const initial = salesPeriodForPreset('30')
  const [startDate, setStartDate] = useState(initial.start)
  const [endDate, setEndDate] = useState(initial.end)
  const [result, setResult] = useState<SalesAbcResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (start: string, end: string) => {
    setLoading(true)
    setError('')
    try {
      setResult(await loadSalesAbc(start, end))
    } catch (loadError) {
      setResult(null)
      setError(errorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(initial.start, initial.end) }, [initial.end, initial.start, load])

  function applyPreset(preset: SalesPeriodPreset) {
    const period = salesPeriodForPreset(preset)
    setStartDate(period.start)
    setEndDate(period.end)
    void load(period.start, period.end)
  }

  return <section className="ps-card" style={{ marginBottom: 16 }}>
    <h2>4. Curva ABC de vendas</h2>
    <p>Ordena os produtos pela receita líquida. A reúne os itens que levam o acumulado até 80%, B até 95% e C o restante. Quantidade é apoio, não uma segunda curva.</p>
    <div className="ps-tabs" style={{ marginBottom: 10 }}>
      <button type="button" className="ps-tab" onClick={() => applyPreset('today')}>Hoje</button>
      <button type="button" className="ps-tab" onClick={() => applyPreset('7')}>7 dias</button>
      <button type="button" className="ps-tab" onClick={() => applyPreset('30')}>30 dias</button>
      <button type="button" className="ps-tab" onClick={() => applyPreset('month')}>Este mês</button>
    </div>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginBottom: 12 }}>
      <label>De<input className="ps-input" type="date" value={startDate} onChange={event => setStartDate(event.target.value)} /></label>
      <label>Até<input className="ps-input" type="date" value={endDate} onChange={event => setEndDate(event.target.value)} /></label>
      <button type="button" className="ps-btn primary" disabled={loading || !startDate || !endDate} onClick={() => void load(startDate, endDate)}>Aplicar período</button>
    </div>
    {loading && <p>Calculando faturamento e cobertura…</p>}
    {error && <p role="alert" style={{ color: 'var(--berry)' }}>{error}</p>}
    {!loading && result && <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <span className="ps-badge"><b>{money.format(Number(result.total_net))}</b> no período</span>
        <span className="ps-badge">{coverageLabel(result.coverage)}</span>
      </div>
      {result.coverage.missing_dates.length > 0 && <p role="status" style={{ color: 'var(--berry)' }}>
        Dias sem arquivo nem explicação: {result.coverage.missing_dates.slice(0, 8).map(dateLabel).join(', ')}{result.coverage.missing_dates.length > 8 ? ` e mais ${result.coverage.missing_dates.length - 8}` : ''}. Esses dias não foram tratados como venda zero.
      </p>}
      {result.items.length === 0 ? <p>Nenhuma venda importada neste período.</p> : <div style={{ overflowX: 'auto' }}>
        <table className="ps-table"><thead><tr>
          <th>Classe</th><th>Produto</th><th>Receita líquida</th><th>Participação</th><th>Acumulado</th><th>Quantidade</th><th>Preço médio</th>
        </tr></thead><tbody>
          {result.items.map(item => <tr key={item.analysis_key} style={{ background: item.mapping_status === 'ignored' ? 'var(--cream-raise)' : undefined }}>
            <td><span className="ps-badge">{item.abc_class ?? 'Sem receita'}</span></td>
            <td><b>{item.display_name}</b><br /><small>{item.mapping_status === 'mapped'
              ? `Vinculado · ${item.sale_unit === 'kg' ? 'kg' : 'un'}`
              : item.mapping_status === 'ignored' ? 'Não mapear · nome do PDV' : 'Pendente · nome do PDV'}</small></td>
            <td>{money.format(Number(item.total_net))}</td>
            <td>{item.share_pct === null ? '—' : `${percent.format(Number(item.share_pct))}%`}</td>
            <td>{item.cumulative_pct === null ? '—' : `${percent.format(Number(item.cumulative_pct))}%`}</td>
            <td>{quantity.format(Number(item.total_quantity))} {item.sale_unit ?? 'do PDV'}</td>
            <td>{item.average_price === null ? '—' : `${money.format(Number(item.average_price))}/${item.sale_unit ?? 'quantidade do PDV'}`}</td>
          </tr>)}
        </tbody></table>
      </div>}
    </>}
  </section>
}
