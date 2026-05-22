'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser } from '@/lib/auth'

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
  const [user, setUser]         = useState<{displayName:string; store:string|null}|null>(null)
  const [breads, setBreads]     = useState<Bread[]>([])
  const [movements, setMovements] = useState<BreadMovement[]>([])
  const [selectedLoc, setSelectedLoc] = useState<string>('central')
  const [search, setSearch]     = useState('')
  const [loading, setLoading]   = useState(true)
  const [ready, setReady]       = useState(false)

  useEffect(() => {
    const u = getCurrentUser()
    if (!u) return
    setUser({ displayName: u.displayName, store: u.store ?? null })
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

  if (!ready) return (
    <div style={{padding:40,textAlign:'center',color:'var(--muted)'}}>Carregando...</div>
  )

  return (
    <div style={{padding:'20px',maxWidth:800,margin:'0 auto'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14,gap:10,flexWrap:'wrap'}}>
        <h1 style={{margin:0,fontSize:'1.3rem',fontWeight:700}}>📊 Saldo de Pães</h1>
        {user && (
          <span style={{fontSize:'.78rem',color:'var(--muted)'}}>
            {user.displayName}{user.store ? ` · ${user.store.toUpperCase()}` : ' · (admin)'}
          </span>
        )}
      </div>

      <p style={{margin:'0 0 16px',color:'var(--muted)',fontSize:'.85rem'}}>
        Saldo atual de pães por local. Calculado a partir das movimentações (forno + romaneio + descartes).
      </p>

      {/* Filtros */}
      <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:16,flexWrap:'wrap'}}>
        <label style={{fontSize:'.85rem',color:'var(--muted)',fontWeight:600}}>Local:</label>
        {isAdmin ? (
          <select value={selectedLoc} onChange={e => setSelectedLoc(e.target.value)}
            style={{padding:'6px 10px',borderRadius:6,border:'1px solid var(--border)',fontSize:'.85rem',background:'white'}}>
            {LOCATIONS.map(loc => (
              <option key={loc} value={loc}>{LOCATION_LABELS[loc]}</option>
            ))}
          </select>
        ) : (
          <span style={{padding:'4px 10px',background:'#dbeafe',color:'#1e40af',borderRadius:6,fontSize:'.85rem',fontWeight:600}}>
            {LOCATION_LABELS[selectedLoc] || selectedLoc}
          </span>
        )}
        <input placeholder="🔍 Buscar pão..." value={search} onChange={e=>setSearch(e.target.value)}
          style={{flex:1,minWidth:180,padding:'6px 10px',border:'1px solid var(--border)',borderRadius:6,fontSize:'.85rem'}}/>
      </div>

      {/* KPIs */}
      <div style={{display:'flex',gap:12,marginBottom:16,flexWrap:'wrap'}}>
        <div style={{flex:'1 1 140px',background:'white',borderRadius:12,padding:'14px 16px',border:'1px solid var(--border)',borderTop:'3px solid #0a6e52',minWidth:140}}>
          <div style={{fontSize:'.7rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.05em'}}>Total de unidades</div>
          <div style={{fontSize:'1.5rem',fontWeight:700,marginTop:4,color:'#0a6e52'}}>
            {kpis.total.toLocaleString('pt-BR')}
          </div>
        </div>
        <div style={{flex:'1 1 140px',background:'white',borderRadius:12,padding:'14px 16px',border:'1px solid var(--border)',minWidth:140}}>
          <div style={{fontSize:'.7rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.05em'}}>Variedades com saldo</div>
          <div style={{fontSize:'1.5rem',fontWeight:700,marginTop:4}}>
            {kpis.variedades}
          </div>
        </div>
        <div style={{flex:'1 1 180px',background:'white',borderRadius:12,padding:'14px 16px',border:'1px solid var(--border)',minWidth:140}}>
          <div style={{fontSize:'.7rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.05em'}}>Top variedade</div>
          <div style={{fontSize:'1rem',fontWeight:700,marginTop:4,lineHeight:1.2}}>
            {kpis.top}
            {kpis.topSaldo > 0 && <span style={{fontSize:'.75rem',color:'var(--muted)',marginLeft:6,fontWeight:400}}>({kpis.topSaldo})</span>}
          </div>
        </div>
      </div>

      {/* Tabela */}
      {loading ? (
        <div style={{padding:40,textAlign:'center',color:'var(--muted)'}}>Carregando saldos...</div>
      ) : saldoRows.length === 0 ? (
        <div style={{padding:40,textAlign:'center',color:'var(--muted)'}}>
          {breads.length === 0 ? 'Nenhum pão cadastrado.' : 'Nenhum pão encontrado.'}
        </div>
      ) : (
        <div style={{background:'white',borderRadius:12,border:'1px solid var(--border)',overflow:'hidden'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'.88rem'}}>
            <thead>
              <tr style={{background:'#f9f9f9',borderBottom:'1px solid var(--border)'}}>
                <th style={{textAlign:'left',padding:'10px 12px',fontSize:'.72rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.05em'}}>Pão</th>
                <th style={{textAlign:'right',padding:'10px 12px',fontSize:'.72rem',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.05em',whiteSpace:'nowrap'}}>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {saldoRows.map(r => {
                const neg = r.saldo < 0
                const empty = r.saldo === 0
                return (
                  <tr key={r.bread_id} style={{borderBottom:'1px solid #f0f0f0'}}>
                    <td style={{padding:'8px 12px'}}>
                      {r.bread_name}
                      {r.is_pj && <span style={{marginLeft:6,background:'#dbeafe',color:'#1e40af',padding:'2px 6px',borderRadius:4,fontSize:'.62rem',fontWeight:700}}>PJ</span>}
                      {r.unit && <span style={{marginLeft:8,fontSize:'.72rem',color:'var(--muted)'}}>{r.unit}</span>}
                    </td>
                    <td style={{padding:'8px 12px',textAlign:'right',fontWeight:600,color:neg?'#dc2626':empty?'var(--muted)':'inherit'}}>
                      {r.saldo.toLocaleString('pt-BR')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {saldoRows.some(r => r.saldo < 0) && (
            <div style={{padding:'8px 12px',background:'#fef2f2',color:'#dc2626',fontSize:'.78rem',borderTop:'1px solid #fecaca'}}>
              ⚠️ Saldos negativos indicam descartes/saídas sem entrada correspondente (precisa investigar tracking).
            </div>
          )}
        </div>
      )}
    </div>
  )
}
