'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Search, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, roleColor, type AppUser } from '@/lib/auth'
import KPICard from '@/components/reports/KPICard'

interface Bread {
  id: string
  name: string
  unit: string | null
  is_pj: boolean
  active: boolean
}

interface BreadMovement {
  bread_id: string
  location: string
  quantity: number
}

interface SaldoRow {
  bread_id: string
  bread_name: string
  is_pj: boolean
  unit: string | null
  saldo: number
}

const LOCATIONS = ['central', 'jc', 'ja', 'ex', 'pj'] as const
const LOCATION_LABELS: Record<string, string> = {
  central: '🏭 Central (Forno)',
  jc:      '🏪 JC',
  ja:      '🏪 JA',
  ex:      '🏪 EX',
  pj:      '🏢 PJ',
}

export default function EstoquePaesPage() {
  const [user, setUser]         = useState<AppUser | null>(null)
  const [breads, setBreads]     = useState<Bread[]>([])
  const [movements, setMovements] = useState<BreadMovement[]>([])
  const [selectedLoc, setSelectedLoc] = useState<string>('central')
  const [search, setSearch]     = useState('')
  const [loading, setLoading]   = useState(true)
  const [ready, setReady]       = useState(false)

  useEffect(() => {
    const u = getCurrentUser()
    if (!u) return
    setUser(u)
    // Não-admin: filtro travado na loja dele. Admin (sem store): default 'central'.
    if (u.store) setSelectedLoc(u.store)
    else setSelectedLoc('central')
    setReady(true)
  }, [])

  const load = useCallback(async () => {
    if (!ready) return
    setLoading(true)
    const [{ data: bs }, { data: ms }] = await Promise.all([
      supabase.from('breads').select('id,name,unit,is_pj,active').eq('active', true).order('name'),
      supabase.from('bread_movements').select('bread_id,location,quantity'),
    ])
    setBreads(bs || [])
    setMovements((ms || []) as BreadMovement[])
    setLoading(false)
  }, [ready])

  useEffect(() => { load() }, [load])

  // Calcula saldo: filtra movements pela location selecionada, agrupa por bread_id, soma.
  const saldoRows = useMemo<SaldoRow[]>(() => {
    const map = new Map<string, number>()
    movements
      .filter(m => m.location === selectedLoc)
      .forEach(m => { map.set(m.bread_id, (map.get(m.bread_id) ?? 0) + Number(m.quantity)) })
    return breads
      .map(b => ({
        bread_id: b.id,
        bread_name: b.name,
        is_pj: b.is_pj,
        unit: b.unit,
        saldo: map.get(b.id) ?? 0,
      }))
      .filter(r => !search || r.bread_name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => a.bread_name.localeCompare(b.bread_name))
  }, [breads, movements, selectedLoc, search])

  const kpis = useMemo(() => {
    const withStock = saldoRows.filter(r => r.saldo > 0)
    const total = saldoRows.reduce((s, r) => s + r.saldo, 0)
    const top = saldoRows.reduce<SaldoRow|null>((max, r) => (r.saldo > (max?.saldo ?? -Infinity) ? r : max), null)
    return {
      total,
      variedades: withStock.length,
      top: top && top.saldo > 0 ? top.bread_name : '—',
      topSaldo: top?.saldo ?? 0,
    }
  }, [saldoRows])

  const isAdmin = !user?.store
  const hasNegative = saldoRows.some(r => r.saldo < 0)

  if (!ready) return (
    <div className="ps-loading">
      <div className="ps-spinner"/>
      <p>Carregando...</p>
    </div>
  )

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <div className="ps-mark">P</div>
            <div className="ps-brand">
              <b>Saldo de Pães</b>
              <span>{user?.store ? user.store.toUpperCase() : 'Admin'}</span>
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
          <h1 className="ps-page-title">📊 Saldo de Pães</h1>
          <p className="ps-page-lead">
            Saldo atual de pães por local. Calculado a partir das movimentações (forno + romaneio + descartes).
          </p>

          {/* Filtros */}
          <div className="ps-filters">
            <label className="ps-filter-lbl">Local:</label>
            {isAdmin ? (
              <select value={selectedLoc} onChange={e => setSelectedLoc(e.target.value)}
                className="ps-select" style={{padding:'6px 10px', fontSize:13, flex:'0 1 220px'}}>
                {LOCATIONS.map(loc => (
                  <option key={loc} value={loc}>{LOCATION_LABELS[loc]}</option>
                ))}
              </select>
            ) : (
              <span className="ps-status enviado">{LOCATION_LABELS[selectedLoc] || selectedLoc}</span>
            )}
            <div style={{flex:1, minWidth:180, position:'relative'}}>
              <Search size={14} style={{position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--ink-faint)', pointerEvents:'none'}}/>
              <input placeholder="Buscar pão..." value={search} onChange={e=>setSearch(e.target.value)}
                className="ps-input" style={{width:'100%', padding:'6px 10px 6px 30px', fontSize:13}}/>
            </div>
          </div>

          {/* KPIs */}
          <div style={{display:'flex', gap:12, marginBottom:14, flexWrap:'wrap'}}>
            <KPICard label="Total de unidades"   value={kpis.total} accent="sage" />
            <KPICard label="Variedades com saldo" value={kpis.variedades} />
            <KPICard label="Top variedade"       value={kpis.top} helper={kpis.topSaldo > 0 ? `${kpis.topSaldo} un` : '—'} />
          </div>

          {/* Aviso de saldos negativos */}
          {hasNegative && (
            <div className="ps-warning danger">
              <AlertTriangle size={16} style={{flexShrink:0, marginTop:1}}/>
              <span>Saldos negativos indicam descartes/saídas sem entrada correspondente (precisa investigar tracking).</span>
            </div>
          )}

          {/* Tabela */}
          {loading ? (
            <div className="ps-empty">Carregando saldos...</div>
          ) : saldoRows.length === 0 ? (
            <div className="ps-empty">
              {breads.length === 0 ? 'Nenhum pão cadastrado.' : 'Nenhum pão encontrado.'}
            </div>
          ) : (
            <div className="ps-table-wrap" style={{overflowX:'auto'}}>
              <table className="ps-table">
                <thead>
                  <tr>
                    <th>Pão</th>
                    <th className="right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {saldoRows.map(r => {
                    const neg = r.saldo < 0
                    const empty = r.saldo === 0
                    return (
                      <tr key={r.bread_id}>
                        <td>
                          {r.bread_name}
                          {r.is_pj && <span className="ps-pjbadge">PJ</span>}
                          {r.unit && <span style={{marginLeft:8, fontSize:11, color:'var(--ink-faint)'}}>{r.unit}</span>}
                        </td>
                        <td className="right" style={{fontWeight:700, color: neg ? 'var(--berry)' : empty ? 'var(--ink-faint)' : 'var(--ps-ink)', fontVariantNumeric:'tabular-nums'}}>
                          {r.saldo.toLocaleString('pt-BR')}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
