'use client'
import { useState, useEffect } from 'react'
import { Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, roleColor, type AppUser } from '@/lib/auth'
import KPICard from '@/components/reports/KPICard'

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

export default function EstoquePage() {
  const [user, setUser]         = useState<AppUser | null>(null)
  const [tab, setTab]           = useState<'saldo'|'movimentos'>('saldo')
  const [balances, setBalances] = useState<StockBalance[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [search, setSearch]     = useState('')
  const [loading, setLoading]   = useState(false)
  const [filter, setFilter]     = useState<'todos'|'com_saldo'|'zerado'>('com_saldo')

  useEffect(() => { setUser(getCurrentUser()) }, [])

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

  useEffect(() => {
    loadBalances(); loadMovements()
  }, [])

  const filtered = balances.filter(b => {
    const matchSearch = b.products?.name?.toLowerCase().includes(search.toLowerCase())
    const matchFilter = filter === 'todos' ? true : filter === 'com_saldo' ? b.quantity > 0 : b.quantity <= 0
    return matchSearch && matchFilter
  })

  const totalValue = balances.reduce((sum, b) => sum + (b.quantity * b.average_cost), 0)
  const inStock    = balances.filter(b => b.quantity > 0).length
  const total      = balances.length

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
          {/* KPIs */}
          <div style={{display:'flex', gap:10, marginTop:14, flexWrap:'wrap'}}>
            <KPICard label="Com saldo" value={inStock} accent="sage"/>
            <KPICard label="Zerados"   value={total - inStock}/>
            <KPICard label="Est. custo" value={`R$ ${totalValue.toFixed(0)}`} accent="honey"/>
          </div>

          {/* Aviso: entrada de matéria-prima ainda não disponível */}
          <div className="ps-card" style={{marginTop:14, padding:'12px 14px', background:'var(--cream)', borderColor:'var(--border-soft)'}}>
            <div style={{fontSize:13, color:'var(--ps-ink)', fontWeight:600, marginBottom:4}}>📸 Entrada de matéria-prima — em breve</div>
            <div style={{fontSize:12, color:'var(--ink-soft)', lineHeight:1.5}}>
              O registro de entrada será feito tirando foto da nota fiscal — a IA lê os itens, quantidades e custos.
              Enquanto não está pronto, os saldos abaixo ficam zerados.
            </div>
          </div>

          {/* Tabs */}
          <div className="ps-tabs" role="tablist" style={{marginTop:16}}>
            <button className="ps-tab" role="tab" aria-selected={tab==='saldo'} onClick={() => setTab('saldo')}>Saldo atual</button>
            <button className="ps-tab" role="tab" aria-selected={tab==='movimentos'} onClick={() => setTab('movimentos')}>Movimentações</button>
          </div>

          {tab === 'saldo' && (
            <>
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
