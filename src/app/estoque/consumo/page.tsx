'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, AlertTriangle, Clock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, PAYABLES_ROUTE, type AppUser } from '@/lib/auth'
import {
  CONSUMPTION_STORE,
  canViewInventoryConsumption,
  consumptionStatusInfo,
  formatMoney,
  formatPeriodDate,
  formatQuantity,
  sortConsumptionItems,
  summarizeConsumption,
  type ConsumptionStatusTone,
  type InventoryConsumptionItem,
  type InventoryConsumptionPeriod,
} from '@/lib/inventoryConsumption'

const TONE_COLOR: Record<ConsumptionStatusTone, string> = {
  ok: 'var(--success)',
  warn: 'var(--amber)',
  blocked: 'var(--red)',
}

function periodLabel(period: InventoryConsumptionPeriod): string {
  return `Sáb ${formatPeriodDate(period.period_start_date)} → sáb ${formatPeriodDate(period.period_end_date)}`
}

export default function ConsumoSemanalPage() {
  const router = useRouter()
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [periods, setPeriods] = useState<InventoryConsumptionPeriod[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [items, setItems] = useState<InventoryConsumptionItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [itemsError, setItemsError] = useState<string | null>(null)
  // Troca rapida de semana dispara leituras concorrentes; so a resposta do
  // ultimo pedido pode ocupar a tela (achado da revisao do Sol).
  const itemsRequest = useRef(0)

  const allowed = canViewInventoryConsumption(user)

  const loadItems = async (endCountId: string) => {
    const requestId = ++itemsRequest.current
    setItemsLoading(true)
    setItemsError(null)
    setItems([])
    try {
      const { data, error: rpcError } = await supabase.rpc('inventory_consumption_items', {
        p_store: CONSUMPTION_STORE,
        p_end_count_id: endCountId,
      })
      if (requestId !== itemsRequest.current) return
      if (rpcError) throw rpcError
      setItems((data || []) as InventoryConsumptionItem[])
    } catch {
      if (requestId !== itemsRequest.current) return
      setItemsError('Não foi possível carregar o consumo desta semana.')
    } finally {
      if (requestId === itemsRequest.current) setItemsLoading(false)
    }
  }

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: rpcError } = await supabase.rpc('inventory_consumption_periods', { p_store: CONSUMPTION_STORE })
      if (rpcError) throw rpcError
      const rows = (data || []) as InventoryConsumptionPeriod[]
      setPeriods(rows)
      const latest = rows[0]?.period_end_count_id ?? null
      setSelectedId(latest)
      if (latest) await loadItems(latest)
    } catch {
      setError('Não foi possível carregar o consumo semanal.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const currentUser = getCurrentUser()
    setUser(currentUser)
    if (canViewInventoryConsumption(currentUser)) load()
    else setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const period = periods.find(row => row.period_end_count_id === selectedId) ?? null
  // Sem os itens carregados nao existe total: erro ou carregamento nunca
  // viram "R$ 0,00" na tela.
  const itemsReady = !itemsLoading && !itemsError
  const summary = useMemo(
    () => (period && itemsReady ? summarizeConsumption(period, items) : null),
    [period, items, itemsReady],
  )
  const sortedItems = useMemo(() => sortConsumptionItems(items), [items])

  const selectPeriod = (endCountId: string) => {
    if (endCountId === selectedId) return
    setSelectedId(endCountId)
    loadItems(endCountId)
  }

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <button className="ps-iconbtn" onClick={() => router.push('/estoque')} aria-label="Voltar">
              <ChevronLeft size={20}/>
            </button>
            <div className="ps-mark">P</div>
            <div className="ps-brand">
              <b>Consumo semanal</b>
              <span>Estoque · JC</span>
            </div>
          </div>
        </header>

        <div className="ps-scroll ps-pad">
          {!user ? null : !allowed ? (
            <div className="ps-warning" style={{marginTop:14}}>
              <AlertTriangle size={18}/>
              <span>O consumo mostra custos de compra. Só o admin e quem acessa o Contas a pagar da JC podem ver.</span>
            </div>
          ) : loading ? (
            <div className="ps-empty">Carregando consumo...</div>
          ) : periods.length === 0 ? (
            error ? (
              <div className="ps-warning" style={{marginTop:14}}><AlertTriangle size={18}/><span>{error}</span></div>
            ) : (
              <div className="ps-empty" style={{padding:'24px 0'}}>
                O consumo aparece depois de duas contagens semanais fechadas: a primeira é o ponto de partida,
                a segunda fecha a primeira semana. Acompanhe em <Link href="/estoque/contagem">Contagem semanal</Link>.
              </div>
            )
          ) : (
            <>
              <div style={{display:'flex', gap:8, marginTop:14, overflowX:'auto', paddingBottom:4}}>
                {periods.map(row => (
                  <button
                    key={row.period_end_count_id}
                    className={row.period_end_count_id === selectedId ? 'ps-btn sm' : 'ps-btn ghost sm'}
                    onClick={() => selectPeriod(row.period_end_count_id)}
                    style={{flexShrink:0}}
                  >
                    {periodLabel(row)}
                  </button>
                ))}
              </div>

              {period && itemsLoading && (
                <div className="ps-empty">Calculando o consumo da semana...</div>
              )}

              {period && itemsError && (
                <div className="ps-warning" style={{marginTop:14}}>
                  <AlertTriangle size={18}/>
                  <span>{itemsError}</span>
                  <button className="ps-btn ghost sm" onClick={() => loadItems(period.period_end_count_id)}>Tentar de novo</button>
                </div>
              )}

              {period && summary && (
                <div className="ps-card" style={{marginTop:14, padding:'14px 16px'}}>
                  <div style={{fontSize:12, color:'var(--ink-soft)'}}>{periodLabel(period)} · {period.period_days} dias</div>
                  <div style={{fontSize:24, fontWeight:700, marginTop:4}}>
                    {formatMoney(summary.totalValue)}
                  </div>
                  <div style={{fontSize:12, color:'var(--ink-soft)'}}>
                    consumidos em {summary.itemsWithValue} insumo(s) contado(s){summary.isPartial ? ' · total parcial' : ''}
                  </div>

                  {summary.isIrregularPeriod && (
                    <div className="ps-warning" style={{marginTop:10}}>
                      <AlertTriangle size={16}/>
                      <span>Este intervalo tem {period.period_days} dias: faltou contagem em alguma semana, então o consumo não é de uma semana só.</span>
                    </div>
                  )}
                  {period.unclassified_lines > 0 && (
                    <div className="ps-warning" style={{marginTop:10}}>
                      <AlertTriangle size={16}/>
                      <span>
                        {period.unclassified_lines} item(ns) de nota sem insumo definido ({formatMoney(period.purchases_unclassified)}).
                        Pode ser de um insumo contado. <Link href={PAYABLES_ROUTE}>Classificar no Contas a pagar</Link>.
                      </span>
                    </div>
                  )}
                  {period.late_lines > 0 && (
                    <div className="ps-warning" style={{marginTop:10}}>
                      <Clock size={16}/>
                      <span>{period.late_lines} item(ns) de nota lançado(s) depois do fechamento da contagem: o número desta semana mudou desde então.</span>
                    </div>
                  )}

                  <div style={{display:'grid', gridTemplateColumns:'1fr auto', gap:'4px 12px', marginTop:12, fontSize:12.5}}>
                    <span>Compras da semana</span><b style={{textAlign:'right'}}>{formatMoney(period.purchases_total)}</b>
                    <span style={{color:'var(--ink-soft)'}}>de insumos contados</span><span style={{textAlign:'right'}}>{formatMoney(period.purchases_counted)}</span>
                    <span style={{color:'var(--ink-soft)'}}>de itens fora da contagem</span><span style={{textAlign:'right'}}>{formatMoney(period.purchases_outside_count)}</span>
                    <span style={{color:'var(--ink-soft)'}}>sem insumo definido</span><span style={{textAlign:'right'}}>{formatMoney(period.purchases_unclassified)}</span>
                    <span style={{color:'var(--ink-soft)'}}>que não é estoque (frete, serviço)</span><span style={{textAlign:'right'}}>{formatMoney(period.purchases_not_stock)}</span>
                  </div>
                </div>
              )}

              {itemsReady && sortedItems.length === 0 && (
                <div className="ps-empty" style={{padding:'24px 0'}}>Nenhum insumo nas contagens desta semana.</div>
              )}

              <div style={{display:'flex', flexDirection:'column', gap:8, marginTop:14, marginBottom:20}}>
                {itemsReady && sortedItems.map(row => {
                  const info = consumptionStatusInfo(row.status)
                  return (
                    <div key={row.product_id} className="ps-card" style={{padding:'12px 14px'}}>
                      <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12}}>
                        <div style={{flex:1, minWidth:0}}>
                          <div className="ps-pname" style={{fontSize:14.5}}>{row.product_name}</div>
                          <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:2}}>
                            tinha {formatQuantity(row.qty_start, row.unit)} + chegou {formatQuantity(row.qty_in, row.unit)} − sobrou {formatQuantity(row.qty_end, row.unit)}
                          </div>
                        </div>
                        <div style={{textAlign:'right', flexShrink:0}}>
                          <div style={{fontWeight:700}}>{formatQuantity(row.qty_consumed, row.unit)}</div>
                          <div style={{fontSize:12, color:'var(--ink-soft)'}}>{formatMoney(row.value_consumed)}</div>
                        </div>
                      </div>
                      {info.tone !== 'ok' && (
                        <div style={{fontSize:12, marginTop:8, color:TONE_COLOR[info.tone]}}>
                          <b>{info.label}.</b> {info.hint}
                          {row.status === 'incompleto' && (
                            <>
                              {' '}{row.lines_without_quantity} item(ns) de nota. Nota XML: <Link href={PAYABLES_ROUTE}>confirmar a conversão no Contas a pagar</Link>.
                              {' '}Lançamento à mão em outra unidade não tem conversão: relance pela nota XML.
                            </>
                          )}
                        </div>
                      )}
                      {(row.edge_lines > 0 || row.late_lines > 0) && (
                        <div style={{fontSize:11, marginTop:6, color:'var(--ink-faint)'}}>
                          {row.edge_lines > 0 && `${row.edge_lines} nota(s) emitida(s) na sexta ou no sábado do corte: confira se chegou antes da contagem. `}
                          {row.late_lines > 0 && `${row.late_lines} nota(s) lançada(s) depois do fechamento.`}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
