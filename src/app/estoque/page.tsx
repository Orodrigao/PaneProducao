'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, ClipboardList, Search, Settings2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, PAYABLES_PERMISSION, roleColor, type AppUser } from '@/lib/auth'
import KPICard from '@/components/reports/KPICard'
import {
  buildInventoryReadiness,
  summarizeInventoryReadiness,
  type InventoryPurchaseConversionRow,
  type InventoryReadinessItem,
  type InventoryProductRow,
} from '@/lib/inventoryReadiness'

interface StockBalance {
  id: string
  product_id: string
  quantity: number
  average_cost: number
  last_updated: string
  products: { name: string; unit: string; category: string }
}
interface Movement {
  id: string
  product_id: string
  movement_type: string
  quantity: number
  unit_cost: number | null
  notes: string | null
  created_by: string | null
  created_at: string
  products: { name: string; unit: string }
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
}

export default function EstoquePage() {
  const [user, setUser]         = useState<AppUser | null>(null)
  const [tab, setTab]           = useState<'preparacao'|'saldo'|'movimentos'>('preparacao')
  const [balances, setBalances] = useState<StockBalance[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [readiness, setReadiness] = useState<InventoryReadinessItem[]>([])
  const [readinessError, setReadinessError] = useState<string | null>(null)
  const [readinessLoading, setReadinessLoading] = useState(true)
  const [conversionCoverageKnown, setConversionCoverageKnown] = useState(false)
  const [search, setSearch]     = useState('')
  const [loading, setLoading]   = useState(false)
  const [filter, setFilter]     = useState<'todos'|'com_saldo'|'zerado'>('com_saldo')
  const [readinessFilter, setReadinessFilter] = useState<'todos'|'prontos'|'pendentes'>('pendentes')

  const loadBalances = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('stock_balance')
      .select('*, products(name, unit, category)')
    setBalances((data || []).sort((a: StockBalance, b: StockBalance) =>
      a.products?.name?.localeCompare(b.products?.name || '') || 0
    ))
    setLoading(false)
  }

  const loadMovements = async () => {
    const { data } = await supabase
      .from('stock_movements')
      .select('*, products(name, unit)')
      .order('created_at', { ascending: false })
      .limit(200)
    setMovements(data || [])
  }

  const loadReadiness = async (currentUser: AppUser | null) => {
    setReadinessError(null)
    setReadinessLoading(true)
    const canInspectConversions = Boolean(currentUser && (
      currentUser.permissions?.some(permission =>
        permission.permission_key === PAYABLES_PERMISSION
        && (permission.scope === '*' || permission.scope === 'jc'),
      )
      || ((currentUser.role === 'admin' || currentUser.role === 'financeiro') && currentUser.allowedRoutes.includes('/produtos'))
    ))
    setConversionCoverageKnown(canInspectConversions)
    try {
      const productsRequest = canInspectConversions
        ? supabase
          .from('products')
          .select('id,name,category,unit,cost_price,active,kind')
          .eq('active', true)
        : supabase
          .from('products')
          .select('id,name,category,unit,active,kind')
          .eq('active', true)
      const [productsResult, conversionsResult] = await Promise.all([
        productsRequest,
        canInspectConversions
          ? supabase
            .from('payable_product_mappings')
            .select('base_product_id,purchase_unit,base_unit,conversion_factor,factor_confirmed,active')
            .eq('active', true)
          : Promise.resolve({ data: [], error: null }),
      ])
      if (productsResult.error) throw productsResult.error
      if (canInspectConversions && conversionsResult.error) throw conversionsResult.error
      const coverageKnown = canInspectConversions
      setConversionCoverageKnown(coverageKnown)
      setReadiness(buildInventoryReadiness(
        (productsResult.data || []) as unknown as InventoryProductRow[],
        (conversionsResult.data || []) as InventoryPurchaseConversionRow[],
        { conversionCoverageKnown: coverageKnown, costCoverageKnown: canInspectConversions },
      ))
    } catch (error) {
      console.error(error)
      setReadinessError('Não foi possível conferir os insumos e suas conversões.')
      setReadiness([])
    } finally {
      setReadinessLoading(false)
    }
  }

  useEffect(() => {
    const currentUser = getCurrentUser()
    setUser(currentUser)
    loadBalances(); loadMovements(); loadReadiness(currentUser)
  }, [])

  const filtered = balances.filter(b => {
    const matchSearch = b.products?.name?.toLowerCase().includes(search.toLowerCase())
    const matchFilter = filter === 'todos' ? true : filter === 'com_saldo' ? b.quantity > 0 : b.quantity <= 0
    return matchSearch && matchFilter
  })

  const totalValue = balances.reduce((sum, b) => sum + (b.quantity * b.average_cost), 0)
  const inStock    = balances.filter(b => b.quantity > 0).length
  const total      = balances.length
  const readinessSummary = summarizeInventoryReadiness(readiness)
  const filteredReadiness = readiness.filter(item => {
    const matchesSearch = normalizeSearchText(item.product.name).includes(normalizeSearchText(search))
    const matchesStatus = readinessFilter === 'todos'
      || (readinessFilter === 'prontos' && item.ready)
      || (readinessFilter === 'pendentes' && !item.ready)
    return matchesSearch && matchesStatus
  })

  const mvTypeLabel: Record<string, string> = { entrada: 'Entrada', saida: 'Saída', ajuste: 'Ajuste', descarte: 'Descarte' }
  const mvSign: Record<string, string>      = { entrada: '+', saida: '−', ajuste: '±', descarte: '−' }

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <div className="ps-mark">P</div>
            <div className="ps-brand">
              <b>Estoque</b>
              <span>Insumos</span>
            </div>
          </div>
          {user && (
            <div className="ps-userchip">
              <div className="ps-avatar" style={{background: roleColor(user.role)}}>{user.displayName.charAt(0).toUpperCase()}</div>
              <b>{user.displayName}</b>
            </div>
          )}
        </header>

        <div className="ps-scroll ps-pad">
          {/* Aviso: esta fase não movimenta estoque */}
          <div className="ps-card" style={{marginTop:14, padding:'12px 14px', background:'var(--cream)', borderColor:'var(--border-soft)'}}>
            <div style={{fontSize:13, color:'var(--ps-ink)', fontWeight:600, marginBottom:4}}>Preparação para a primeira contagem</div>
            <div style={{fontSize:12, color:'var(--ink-soft)', lineHeight:1.5}}>
              Esta tela ainda não movimenta estoque. Primeiro ela confere quais insumos da JC têm unidade, custo e conversões confiáveis.
              A contagem semanal só será liberada quando essas pendências estiverem visíveis e corrigíveis.
            </div>
          </div>

          {/* Tabs */}
          <div className="ps-tabs" role="tablist" style={{marginTop:16}}>
            <button className="ps-tab" role="tab" aria-selected={tab==='preparacao'} onClick={() => setTab('preparacao')}>Preparação</button>
            <button className="ps-tab" role="tab" aria-selected={tab==='saldo'} onClick={() => setTab('saldo')}>Saldo atual</button>
            <button className="ps-tab" role="tab" aria-selected={tab==='movimentos'} onClick={() => setTab('movimentos')}>Movimentações</button>
          </div>

          {tab === 'preparacao' && (
            <>
              <div style={{display:'flex', justifyContent:'flex-end', marginTop:14}}>
                <Link href="/estoque/contagem" className="ps-btn ghost sm"><ClipboardList size={14}/> Contagem semanal</Link>
              </div>
              <div style={{display:'flex', gap:10, marginTop:10, flexWrap:'wrap'}}>
                <KPICard label="Insumos ativos" value={readinessSummary.total}/>
                <KPICard label="Prontos para contar" value={readinessSummary.ready} accent="sage"/>
                <KPICard label="Com pendência" value={readinessSummary.total - readinessSummary.ready} accent="honey"/>
              </div>

              {readinessLoading ? (
                <div className="ps-empty">Conferindo insumos, custos e conversões...</div>
              ) : readinessError ? (
                <div className="ps-warning" style={{marginTop:14}}>
                  <AlertTriangle size={18}/><span>{readinessError}</span>
                </div>
              ) : (
                <>
                  <div className="ps-card" style={{marginTop:14, padding:'12px 14px'}}>
                    <div style={{fontSize:12, color:'var(--ink-soft)', lineHeight:1.6}}>
                      <b>{readinessSummary.invalidUnit}</b> sem unidade reconhecida ·{' '}
                      <b>{readinessSummary.missingCost}</b> sem custo cadastrado ·{' '}
                      {conversionCoverageKnown
                        ? <><b>{readinessSummary.conversionIssues}</b> com conversão de compra pendente</>
                        : <>custos e conversões visíveis somente para perfis financeiros autorizados</>}
                    </div>
                  </div>

                  <div className="ps-filters" style={{marginTop:14}}>
                    <div style={{flex:1, minWidth:180, position:'relative'}}>
                      <Search size={14} style={{position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--ink-faint)', pointerEvents:'none'}}/>
                      <input type="text" placeholder="Buscar insumo..." value={search} onChange={event => setSearch(event.target.value)}
                        className="ps-input" style={{width:'100%', padding:'8px 12px 8px 30px', fontSize:13}}/>
                    </div>
                    <div className="ps-presets">
                      {(['pendentes', 'prontos', 'todos'] as const).map(status => (
                        <button key={status} onClick={() => setReadinessFilter(status)} className={`ps-preset ${readinessFilter === status ? 'active' : ''}`}>
                          {status === 'pendentes' ? 'Pendentes' : status === 'prontos' ? 'Prontos' : 'Todos'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {filteredReadiness.length === 0 ? (
                    <div className="ps-empty">
                      {readiness.length === 0 ? 'Nenhum insumo ativo foi classificado no catálogo.' : 'Nenhum insumo neste filtro.'}
                    </div>
                  ) : (
                    <div style={{display:'flex', flexDirection:'column', gap:8}}>
                      {filteredReadiness.map(item => (
                        <article key={item.product.id} className="ps-card" style={{padding:'12px 14px'}}>
                          <div style={{display:'flex', justifyContent:'space-between', gap:12, alignItems:'flex-start'}}>
                            <div style={{minWidth:0}}>
                              <div className="ps-pname" style={{fontSize:14.5}}>{item.product.name}</div>
                              <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:2}}>
                                {item.product.category || 'Sem categoria'} · unidade para contagem: {item.stockUnit || item.product.unit || 'não informada'} ·{' '}
                                {conversionCoverageKnown ? `${item.conversionCount} conversão(ões) de compra` : 'conversões restritas'}
                              </div>
                            </div>
                            <span className={`ps-status ${item.ready ? 'ok' : 'pendente'}`} style={{display:'inline-flex', alignItems:'center', gap:4, flexShrink:0}}>
                              {item.ready ? <CheckCircle2 size={13}/> : <AlertTriangle size={13}/>} {item.ready ? 'Pronto para contar' : 'Pendente'}
                            </span>
                          </div>
                          {item.blockingIssues.map(issue => (
                            <div key={issue} style={{fontSize:12, color:'var(--berry)', marginTop:7}}>• {issue}</div>
                          ))}
                          {item.warnings.map(warning => (
                            <div key={warning} style={{fontSize:12, color:'var(--ink-soft)', marginTop:7}}>• {warning}</div>
                          ))}
                        </article>
                      ))}
                    </div>
                  )}

                  <div style={{display:'flex', justifyContent:'flex-end', marginTop:14}}>
                    {user?.allowedRoutes.includes('/produtos')
                      ? <Link href="/produtos" className="ps-btn ghost"><Settings2 size={14}/> Corrigir no catálogo</Link>
                      : <span style={{fontSize:12, color:'var(--ink-soft)'}}>As correções devem ser feitas por Rodrigo ou por um perfil com acesso ao catálogo.</span>}
                  </div>
                </>
              )}
            </>
          )}

          {tab === 'saldo' && (
            <>
              <div style={{display:'flex', gap:10, marginTop:14, flexWrap:'wrap'}}>
                <KPICard label="Com saldo" value={inStock} accent="sage"/>
                <KPICard label="Zerados" value={total - inStock}/>
                <KPICard label="Est. custo" value={`R$ ${totalValue.toFixed(0)}`} accent="honey"/>
              </div>
              <div className="ps-filters" style={{marginTop:14}}>
                <div style={{flex:1, minWidth:180, position:'relative'}}>
                  <Search size={14} style={{position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--ink-faint)', pointerEvents:'none'}}/>
                  <input type="text" placeholder="Buscar insumo..." value={search} onChange={e => setSearch(e.target.value)}
                    className="ps-input" style={{width:'100%', padding:'8px 12px 8px 30px', fontSize:13}}/>
                </div>
                <div className="ps-presets">
                  {(['com_saldo', 'todos', 'zerado'] as const).map(f => (
                    <button key={f} onClick={() => setFilter(f)} className={`ps-preset ${filter === f ? 'active' : ''}`}>
                      {f === 'com_saldo' ? 'Com saldo' : f === 'todos' ? 'Todos' : 'Zerados'}
                    </button>
                  ))}
                </div>
              </div>

              {loading ? (
                <div className="ps-empty">Carregando...</div>
              ) : filtered.length === 0 ? (
                <div className="ps-empty">
                  {balances.length === 0 ? 'Nenhum saldo registrado ainda. Faça uma entrada para começar.' : 'Nenhum resultado.'}
                </div>
              ) : (
                <div style={{display:'flex', flexDirection:'column', gap:8}}>
                  {filtered.map(b => (
                    <div key={b.id} className="ps-card" style={{padding:'12px 14px'}}>
                      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:12}}>
                        <div style={{flex:1, minWidth:0}}>
                          <div className="ps-pname" style={{fontSize:14.5, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{b.products?.name}</div>
                          <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:2}}>
                            Custo médio: R$ {b.average_cost.toFixed(4)}/{b.products?.unit}
                          </div>
                        </div>
                        <div style={{textAlign:'right', flexShrink:0}}>
                          <div style={{fontSize:20, fontWeight:700, color: b.quantity > 0 ? 'var(--sage)' : 'var(--ink-faint)', fontVariantNumeric:'tabular-nums'}}>
                            {b.quantity % 1 === 0 ? b.quantity : b.quantity.toFixed(3)}
                          </div>
                          <div style={{fontSize:11, color:'var(--ink-faint)'}}>{b.products?.unit}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'movimentos' && (
            <>
              <div style={{height:14}}/>
              {movements.length === 0 ? (
                <div className="ps-empty">Nenhuma movimentação ainda.</div>
              ) : (
                <div style={{display:'flex', flexDirection:'column', gap:8}}>
                  {movements.map(m => (
                    <div key={m.id} className="ps-card" style={{padding:'12px 14px'}}>
                      <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10}}>
                        <div style={{flex:1, minWidth:0}}>
                          <div className="ps-pname" style={{fontSize:14, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{m.products?.name}</div>
                          <div style={{fontSize:11, color:'var(--ink-faint)', marginTop:2}}>
                            {new Date(m.created_at).toLocaleDateString('pt-BR')} · {m.created_by || '—'}
                          </div>
                        </div>
                        <div style={{textAlign:'right', flexShrink:0, display:'flex', flexDirection:'column', alignItems:'flex-end', gap:3}}>
                          <span className={`ps-status ${m.movement_type}`}>
                            {mvSign[m.movement_type]}{Math.abs(m.quantity)} {m.products?.unit}
                          </span>
                          <div style={{fontSize:10, color:'var(--ink-faint)', textTransform:'uppercase', letterSpacing:'.08em', fontWeight:600}}>{mvTypeLabel[m.movement_type]}</div>
                          {m.unit_cost && <div style={{fontSize:11, color:'var(--ink-faint)'}}>R$ {m.unit_cost.toFixed(4)}/un</div>}
                        </div>
                      </div>
                      {m.notes && <div style={{fontSize:12, color:'var(--ink-soft)', marginTop:6, fontStyle:'italic'}}>{m.notes}</div>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

      </div>
    </div>
  )
}
