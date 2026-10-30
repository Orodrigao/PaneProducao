'use client'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { RECEIVABLES_ROUTE } from '@/lib/auth'
import {
  formatMoney,
  formatPercent,
  toNumber,
  type CmvOverRevenue,
  type InventoryConsumptionPeriod,
  type InventoryConsumptionRevenue,
} from '@/lib/inventoryConsumption'

type Props = {
  period: InventoryConsumptionPeriod
  consumptionPartial: boolean
  itemsToCheck: number
  // null com allowed=false: a pessoa nao acessa o Contas a receber.
  revenue: InventoryConsumptionRevenue | null
  cmv: CmvOverRevenue | null
  allowed: boolean
  loading: boolean
  error: string | null
  onRetry: () => void
}

// CMV real da semana sobre a venda (JC + JA + PJ + EX), decisao do Rodrigo em
// 2026-10-22. O numero so aparece com a venda carregada: erro ou carregamento
// nunca viram "0%".
export default function ConsumptionRevenuePanel({
  period, consumptionPartial, itemsToCheck, revenue, cmv, allowed, loading, error, onRetry,
}: Props) {
  if (!allowed) {
    return (
      <div style={{fontSize:12, color:'var(--ink-soft)', marginTop:12}}>
        O CMV em % sobre a venda aparece para quem também acessa o Contas a receber.
      </div>
    )
  }
  if (loading) return <div className="ps-empty" style={{padding:'12px 0'}}>Calculando a venda da semana...</div>
  if (error) {
    return (
      <div className="ps-warning" style={{marginTop:12}}>
        <AlertTriangle size={16}/>
        <span>{error}</span>
        <button className="ps-btn ghost sm" onClick={onRetry}>Tentar de novo</button>
      </div>
    )
  }
  if (!revenue || !cmv) return null

  const exMissing = cmv.gaps.includes('cobranca_ex')
  const cashMissing = cmv.gaps.includes('caixa_faltando')

  return (
    <div style={{borderTop:'1px solid var(--line-soft)', marginTop:12, paddingTop:12}}>
      <div style={{fontSize:12, color:'var(--ink-soft)'}}>CMV sobre a venda</div>
      <div style={{fontSize:24, fontWeight:700, marginTop:2}}>
        {formatPercent(cmv.percent)}
      </div>
      <div style={{fontSize:12, color:'var(--ink-soft)'}}>
        de {formatMoney(cmv.revenueTotal)} vendidos{cmv.isPartial ? ' · parcial' : ''}
      </div>

      <div style={{fontSize:11.5, color:'var(--ink-faint)', marginTop:6}}>
        O % conta só os insumos da contagem semanal. O que foi comprado fora dela não entra.
      </div>
      {cmv.resaleExcluded > 0 && (
        <div style={{fontSize:11.5, color:'var(--ink-soft)', marginTop:4}}>
          Revenda sem cadastro desta semana ({formatMoney(cmv.resaleExcluded)}) também fica fora do %: sem contagem, não há como saber quanto foi vendido.
        </div>
      )}

      {consumptionPartial && cmv.percent !== null && (
        <div className="ps-warning" style={{marginTop:10}}>
          <AlertTriangle size={16}/>
          <span>O consumo desta semana está parcial (insumo sem número ou nota sem insumo definido, acima), então o % real é maior que este.</span>
        </div>
      )}
      {itemsToCheck > 0 && cmv.percent !== null && (
        <div className="ps-warning" style={{marginTop:10}}>
          <AlertTriangle size={16}/>
          <span>
            {itemsToCheck === 1 ? '1 insumo está' : `${itemsToCheck} insumos estão`} para conferir (consumo negativo, acima):
            o consumo sai menor do que é e o % não fecha até a contagem ou a nota ser corrigida.
          </span>
        </div>
      )}
      {cashMissing && (
        <div className="ps-warning" style={{marginTop:10}}>
          <AlertTriangle size={16}/>
          <span>
            Falta fechamento de caixa em {missingLabel(revenue.cash_jc_missing_days, 'JC')}
            {revenue.cash_jc_missing_days > 0 && revenue.cash_ja_missing_days > 0 ? ' e ' : ''}
            {missingLabel(revenue.cash_ja_missing_days, 'JA')}: a venda está incompleta e o % sai maior do que é.
          </span>
        </div>
      )}
      {exMissing && (
        <div className="ps-warning" style={{marginTop:10}}>
          <AlertTriangle size={16}/>
          <span>
            A EX tem {revenue.ex_days_billed} de {period.period_days} dias cobrados nesta semana: a venda está incompleta
            e o % sai maior do que é. <Link href={RECEIVABLES_ROUTE}>Gerar a cobrança no Contas a receber</Link>.
          </span>
        </div>
      )}

      <div style={{display:'grid', gridTemplateColumns:'1fr auto', gap:'4px 12px', marginTop:12, fontSize:12.5}}>
        <span>Venda da semana</span><b style={{textAlign:'right'}}>{formatMoney(revenue.revenue_total)}</b>
        <span style={{color:'var(--ink-soft)'}}>caixa da JC · {daysLabel(revenue.cash_jc_days)}</span>
        <span style={{textAlign:'right'}}>{formatMoney(revenue.cash_jc)}</span>
        <span style={{color:'var(--ink-soft)'}}>caixa da JA · {daysLabel(revenue.cash_ja_days)}</span>
        <span style={{textAlign:'right'}}>{formatMoney(revenue.cash_ja)}</span>
        <span style={{color:'var(--ink-soft)'}}>iFood (JC e JA)</span>
        <span style={{textAlign:'right'}}>{formatMoney(revenue.cash_ifood)}</span>
        <span style={{color:'var(--ink-soft)'}}>pedidos PJ · {revenue.pj_orders_lines} cobrança(s)</span>
        <span style={{textAlign:'right'}}>{formatMoney(revenue.pj_orders)}</span>
        <span style={{color:'var(--ink-soft)'}}>EX · {revenue.ex_days_billed} de {period.period_days} dias cobrados</span>
        <span style={{textAlign:'right'}}>{formatMoney(toNumber(revenue.ex_billed))}</span>
      </div>
    </div>
  )
}

function missingLabel(days: number, store: string): string {
  if (days <= 0) return ''
  return days === 1 ? `1 dia da ${store}` : `${days} dias da ${store}`
}

function daysLabel(days: number): string {
  return days === 1 ? '1 dia com fechamento' : `${days} dias com fechamento`
}
