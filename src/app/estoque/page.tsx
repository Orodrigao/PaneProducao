'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { showToast } from '@/lib/utils'
import Link from 'next/link'

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
  const [tab, setTab]           = useState<'saldo'|'movimentos'>('saldo')
  const [balances, setBalances] = useState<StockBalance[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [search, setSearch]     = useState('')
  const [loading, setLoading]   = useState(false)
  const [filter, setFilter]     = useState<'todos'|'com_saldo'|'zerado'>('com_saldo')

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
  const mvColor: Record<string, string>     = { entrada: 'var(--teal)', saida: 'var(--coral)', ajuste: 'var(--amber)', descarte: 'var(--red)' }
  const mvBg: Record<string, string>        = { entrada: 'var(--teal-bg)', saida: 'var(--coral-bg)', ajuste: 'var(--amber-bg)', descarte: 'var(--red-bg)' }
  const mvSign: Record<string, string>      = { entrada: '+', saida: '−', ajuste: '±', descarte: '−' }

  return (
    <div id="app">
      <div className="topbar">
        <span className="topbar-logo">Pane &amp; Salute</span>
        <Link href="/fornecedores" style={{ fontSize: '12px', padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', textDecoration: 'none', marginRight: '4px' }}>
          Fornecedores
        </Link>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', padding: '14px 16px 0' }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 10px', textAlign: 'center' }}>
          <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--teal)' }}>{inStock}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>com saldo</div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 10px', textAlign: 'center' }}>
          <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-muted)' }}>{total - inStock}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>zerados</div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--amber-border)', borderRadius: 'var(--radius)', padding: '12px 10px', textAlign: 'center' }}>
          <div style={{ fontSize: '17px', fontWeight: 700, color: 'var(--amber)' }}>R${totalValue.toFixed(0)}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>est. custo</div>
        </div>
      </div>
      <div className="nav-tabs" style={{ marginTop: '14px' }}>
        <button className={`nav-tab ${tab === 'saldo' ? 'active' : ''}`} onClick={() => setTab('saldo')}>Saldo atual</button>
        <button className={`nav-tab ${tab === 'movimentos' ? 'active' : ''}`} onClick={() => setTab('movimentos')}>Movimentações</button>
      </div>
      {tab === 'saldo' && (
        <div style={{ padding: '12px 16px' }}>
          <input type="text" placeholder="🔍 Buscar insumo..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '14px', background: 'var(--surface)', marginBottom: '10px', outline: 'none' }} />
          <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
            {(['com_saldo', 'todos', 'zerado'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: '5px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 500, cursor: 'pointer', border: '1px solid',
                background: filter === f ? 'var(--amber)' : 'transparent',
                color: filter === f ? 'white' : 'var(--text-muted)',
                borderColor: filter === f ? 'var(--amber)' : 'var(--border)',
              }}>
                {f === 'com_saldo' ? 'Com saldo' : f === 'todos' ? 'Todos' : 'Zerados'}
              </button>
            ))}
          </div>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Carregando...</div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted)' }}>
              {balances.length === 0 ? 'Nenhum saldo registrado ainda. Faça uma entrada para começar.' : 'Nenhum resultado.'}
            </div>
          ) : (
            filtered.map(b => (
              <div key={b.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '13px 14px', marginBottom: '7px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: 0, marginRight: '12px' }}>
                  <div style={{ fontWeight: 500, fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.products?.name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Custo médio: R$ {b.average_cost.toFixed(4)}/{b.products?.unit}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: b.quantity > 0 ? 'var(--teal)' : 'var(--text-hint)' }}>
                    {b.quantity % 1 === 0 ? b.quantity : b.quantity.toFixed(3)}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{b.products?.unit}</div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
      {tab === 'movimentos' && (
        <div style={{ padding: '12px 16px' }}>
          {movements.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>Nenhuma movimentação ainda.</div>
          ) : movements.map(m => (
            <div key={m.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: '7px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0, marginRight: '10px' }}>
                  <div style={{ fontWeight: 500, fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.products?.name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{new Date(m.created_at).toLocaleDateString('pt-BR')} · {m.created_by || '—'}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, padding: '2px 8px', borderRadius: '12px', background: mvBg[m.movement_type] || 'var(--bg)', color: mvColor[m.movement_type] || 'var(--text)' }}>
                    {mvSign[m.movement_type]}{Math.abs(m.quantity)} {m.products?.unit}
                  </span>
                  <div style={{ fontSize: '10px', color: 'var(--text-hint)', marginTop: '3px' }}>{mvTypeLabel[m.movement_type]}</div>
                  {m.unit_cost && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>R$ {m.unit_cost.toFixed(4)}/un</div>}
                </div>
              </div>
              {m.notes && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '5px', fontStyle: 'italic' }}>{m.notes}</div>}
            </div>
          ))}
        </div>
      )}
      <Link href="/estoque/entrada" style={{ position: 'fixed', bottom: '90px', right: '20px', background: 'var(--amber)', color: 'white', borderRadius: '50px', padding: '13px 20px', fontWeight: 600, fontSize: '14px', textDecoration: 'none', boxShadow: '0 4px 14px rgba(184,114,10,0.45)', display: 'flex', alignItems: 'center', gap: '6px', zIndex: 90 }}>
        + Entrada
      </Link>
    </div>
  )
}
