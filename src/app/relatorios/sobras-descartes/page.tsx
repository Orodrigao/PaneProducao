'use client'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Download, ChevronLeft, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getCurrentUser, roleColor, type AppUser } from '@/lib/auth'
import PeriodFilter from '@/components/reports/PeriodFilter'
import SegmentedFilter from '@/components/reports/SegmentedFilter'
import KPICard from '@/components/reports/KPICard'
import ReportTable, { ReportTableColumn } from '@/components/reports/ReportTable'
import { csvExport } from '@/components/reports/csvExport'
import { formatDateBR } from '@/lib/utils'

interface DBRow {
  id: string
  record_date: string
  responsible: string
  product_id: string
  product_source: 'bread' | 'catalog'
  quantity: number
  obs?: string | null
}

interface MergedRow extends DBRow {
  modo: 'sobra' | 'descarte'
}

interface DisplayRow {
  date: string
  responsible: string
  modo: string
  product: string
  category: string
  quantity: number
  valor: number | null
  obs: string
  _modoRaw: 'sobra' | 'descarte'
  _hasCost: boolean
}

interface ProductInfo {
  name: string
  category: string
  cost: number | null
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function formatBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function SobrasDescartesReport() {
  const router = useRouter()
  const [user, setUser] = useState<AppUser | null>(null)
  const [range, setRange] = useState<{ from: Date; to: Date } | null>(null)
  const [modo, setModo] = useState<'sobra' | 'descarte' | 'ambos'>('ambos')
  const [responsible, setResponsible] = useState<string>('all')

  const [rows, setRows] = useState<MergedRow[]>([])
  const [breadsMap, setBreadsMap] = useState<Map<string, ProductInfo>>(new Map())
  const [productsMap, setProductsMap] = useState<Map<string, ProductInfo>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setUser(getCurrentUser())
  }, [])

  // Lookups (pães e produtos) carregam uma vez — incluindo cost_price
  useEffect(() => {
    Promise.all([
      supabase.from('breads').select('id,name,cost_price'),
      supabase.from('products').select('id,name,category,cost_price'),
    ]).then(([b, p]) => {
      const bm = new Map<string, ProductInfo>()
      ;(b.data || []).forEach((x: any) => bm.set(x.id, {
        name: x.name,
        category: 'Pães',
        cost: x.cost_price !== null && x.cost_price !== undefined ? Number(x.cost_price) : null,
      }))
      const pm = new Map<string, ProductInfo>()
      ;(p.data || []).forEach((x: any) => pm.set(x.id, {
        name: x.name,
        category: x.category || '—',
        cost: x.cost_price !== null && x.cost_price !== undefined ? Number(x.cost_price) : null,
      }))
      setBreadsMap(bm)
      setProductsMap(pm)
    })
  }, [])

  // Dados (sobras + descartes) sempre que o período muda
  useEffect(() => {
    if (!range) return
    setLoading(true)
    const fromStr = toISODate(range.from)
    const toStr = toISODate(range.to)
    Promise.all([
      supabase.from('sobras').select('*').gte('record_date', fromStr).lte('record_date', toStr),
      supabase.from('descartes').select('*').gte('record_date', fromStr).lte('record_date', toStr),
    ]).then(([s, d]) => {
      const merged: MergedRow[] = [
        ...(s.data || []).map((r: any) => ({ ...r, modo: 'sobra' as const })),
        ...(d.data || []).map((r: any) => ({ ...r, modo: 'descarte' as const })),
      ]
      setRows(merged)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [range])

  // Responsáveis disponíveis no período carregado (pra dropdown)
  const allResponsibles = useMemo(() => {
    const set = new Set(rows.map(r => r.responsible))
    return Array.from(set).sort()
  }, [rows])

  // Filtros locais + resolução de nome+custo + cálculo de valor + ordenação por data desc
  const filteredRows: DisplayRow[] = useMemo(() => {
    return rows
      .filter(r => modo === 'ambos' || r.modo === modo)
      .filter(r => responsible === 'all' || r.responsible === responsible)
      .map(r => {
        const lookup = r.product_source === 'bread' ? breadsMap.get(r.product_id) : productsMap.get(r.product_id)
        const cost = lookup?.cost ?? null
        const hasCost = cost !== null && cost > 0
        const valor = hasCost ? Number((r.quantity * (cost as number)).toFixed(2)) : null
        return {
          date: r.record_date,
          responsible: r.responsible,
          modo: r.modo === 'sobra' ? 'Sobra' : 'Descarte',
          product: lookup?.name ?? '(desconhecido)',
          category: lookup?.category ?? '—',
          quantity: r.quantity,
          valor,
          obs: r.obs ?? '',
          _modoRaw: r.modo,
          _hasCost: hasCost,
        }
      })
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  }, [rows, modo, responsible, breadsMap, productsMap])

  // KPIs (incluindo valores monetários)
  const kpis = useMemo(() => {
    const sobras = filteredRows.filter(r => r._modoRaw === 'sobra')
    const descartes = filteredRows.filter(r => r._modoRaw === 'descarte')
    const sobrasTotal = sobras.reduce((s, r) => s + r.quantity, 0)
    const descartesTotal = descartes.reduce((s, r) => s + r.quantity, 0)
    const sobrasValor = sobras.reduce((s, r) => s + (r.valor ?? 0), 0)
    const descartesValor = descartes.reduce((s, r) => s + (r.valor ?? 0), 0)
    const records = filteredRows.length
    const semCusto = filteredRows.filter(r => !r._hasCost).length

    // Top produto por VALOR (não por quantidade — alinhado com o objetivo do relatório)
    const byProduct = new Map<string, number>()
    filteredRows.forEach(r => {
      if (r.valor !== null) {
        byProduct.set(r.product, (byProduct.get(r.product) ?? 0) + r.valor)
      }
    })
    let topProduct = '—'; let topValor = 0
    byProduct.forEach((v, n) => {
      if (v > topValor) { topValor = v; topProduct = n }
    })

    const semCustoNames = [...new Set(filteredRows.filter(r => !r._hasCost).map(r => r.product))].sort()

    return { sobrasTotal, descartesTotal, sobrasValor, descartesValor, records, semCusto, semCustoNames, topProduct, topValor }
  }, [filteredRows])

  function handleExport() {
    if (!range) return
    // Formata números em locale BR (vírgula decimal) — alinhado com separador `;`
    const brNumber = (v: number, dec = 2) =>
      v.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
    csvExport(
      filteredRows.map(r => ({
        Data: formatDateBR(r.date),
        Responsavel: r.responsible,
        Modo: r.modo,
        Produto: r.product,
        Categoria: r.category,
        Quantidade: brNumber(r.quantity, Number.isInteger(r.quantity) ? 0 : 2),
        'Valor (R$)': r.valor !== null ? brNumber(r.valor) : '',
        Obs: r.obs,
      })),
      `sobras-descartes-${toISODate(range.from)}-a-${toISODate(range.to)}.csv`
    )
  }

  const columns: ReportTableColumn<DisplayRow>[] = [
    { key: 'product',     label: 'Produto' },
    { key: 'date',        label: 'Data',        format: (v) => formatDateBR(v as string) },
    { key: 'responsible', label: 'Responsável' },
    { key: 'modo',        label: 'Modo' },
    { key: 'category',    label: 'Categoria' },
    { key: 'quantity',    label: 'Qtd',   align: 'right', format: (v) => (v as number).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) },
    { key: 'valor',       label: 'Valor', align: 'right', format: (v) => v === null ? <span style={{color:'var(--ink-faint)'}}>—</span> : formatBRL(v as number) },
    { key: 'obs',         label: 'Obs',   sortable: false },
  ]

  function renderMobileCard(row: DisplayRow, index: number) {
    return (
      <div key={`${row.date}-${row.product}-${index}`} className="ps-report-row-card">
        <div className="ps-report-row-head">
          <div className="ps-report-row-title">{row.product}</div>
          <span className={`ps-status ${row._modoRaw === 'descarte' ? 'descarte' : 'conferido'}`}>{row.modo}</span>
        </div>
        <div className="ps-report-row-kicker">
          <span>{formatDateBR(row.date)}</span>
          <span>·</span>
          <strong>{row.responsible}</strong>
          <span>·</span>
          <span>{row.category}</span>
        </div>
        <div className="ps-report-row-grid">
          <div className="ps-report-row-metric">
            <span>Qtd</span>
            <b>{row.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</b>
          </div>
          <div className="ps-report-row-metric">
            <span>Valor</span>
            <b>{row.valor !== null ? formatBRL(row.valor) : 'Sem custo'}</b>
          </div>
        </div>
        {row.obs && <div className="ps-report-row-note">{row.obs}</div>}
      </div>
    )
  }

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <button className="ps-iconbtn" onClick={() => router.push('/relatorios')} aria-label="Voltar">
              <ChevronLeft size={20}/>
            </button>
            <div className="ps-mark">P</div>
            <div className="ps-brand">
              <b>Sobras & Descartes</b>
              <span>Relatório</span>
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
          <h1 className="ps-page-title">♻️ Sobras & Descartes</h1>
          <p className="ps-page-lead">
            Histórico unificado com filtros por período, modo e responsável.
            Valor monetário = <code>quantidade × custo cadastrado</code>.
          </p>

          {/* Filtros */}
          <div className="ps-filters">
            <PeriodFilter onChange={setRange} />
            <SegmentedFilter
              options={[
                { value: 'ambos',    label: 'Ambos' },
                { value: 'sobra',    label: 'Sobras' },
                { value: 'descarte', label: 'Descartes' },
              ]}
              value={modo}
              onChange={(v) => setModo(v as 'sobra' | 'descarte' | 'ambos')}
            />
            <select value={responsible} onChange={e => setResponsible(e.target.value)}
              className="ps-select" style={{padding:'6px 10px', fontSize:13, flex:'0 1 220px'}}>
              <option value="all">Todos os responsáveis</option>
              {allResponsibles.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          {/* Alerta de cobertura — quando há registros sem custo */}
          {kpis.semCusto > 0 && (
            <div className="ps-warning">
              <AlertTriangle size={16} style={{flexShrink:0, marginTop:1}}/>
              <div>
                <strong>{kpis.semCusto}</strong> {kpis.semCusto === 1 ? 'registro' : 'registros'} sem custo cadastrado — valor monetário pode estar subestimado. Atualize em{' '}
                <a href="/produtos">/produtos</a>.
                {kpis.semCustoNames.length > 0 && (
                  <div style={{marginTop:4, fontSize:12, color:'var(--ink-soft)'}}>
                    Sem custo: <strong>{kpis.semCustoNames.join(' · ')}</strong>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* KPIs */}
          <div style={{display:'flex', flexWrap:'wrap', gap:12, marginBottom:14}}>
            <KPICard label="Valor Sobras"    value={formatBRL(kpis.sobrasValor)}    accent="sage"  helper={`${kpis.sobrasTotal.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} un`} />
            <KPICard label="Valor Descartes" value={formatBRL(kpis.descartesValor)} accent="berry" helper={`${kpis.descartesTotal.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} un`} />
            <KPICard label="Registros"       value={kpis.records} />
            <KPICard label="Top produto"     value={kpis.topProduct} helper={kpis.topValor > 0 ? `${formatBRL(kpis.topValor)} no período` : '—'} />
          </div>

          {/* Export */}
          <div style={{display:'flex', justifyContent:'flex-end', marginBottom:8}}>
            <button onClick={handleExport} disabled={filteredRows.length === 0} className="ps-btn ghost sm">
              <Download size={14}/> Exportar CSV
            </button>
          </div>

          {/* Tabela */}
          <ReportTable
            columns={columns}
            rows={filteredRows}
            loading={loading}
            emptyMessage="Sem registros no período/filtros selecionados."
            renderMobileCard={renderMobileCard}
          />
        </div>
      </div>
    </div>
  )
}
