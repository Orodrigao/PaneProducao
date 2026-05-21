'use client'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import PeriodFilter from '@/components/reports/PeriodFilter'
import SegmentedFilter from '@/components/reports/SegmentedFilter'
import KPICard from '@/components/reports/KPICard'
import ReportTable, { ReportTableColumn } from '@/components/reports/ReportTable'
import { csvExport } from '@/components/reports/csvExport'

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
  obs: string
  _modoRaw: 'sobra' | 'descarte'
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function formatDateBR(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export default function SobrasDescartesReport() {
  const router = useRouter()
  const [range, setRange] = useState<{ from: Date; to: Date } | null>(null)
  const [modo, setModo] = useState<'sobra' | 'descarte' | 'ambos'>('ambos')
  const [responsible, setResponsible] = useState<string>('all')

  const [rows, setRows] = useState<MergedRow[]>([])
  const [breadsMap, setBreadsMap] = useState<Map<string, { name: string; category: string }>>(new Map())
  const [productsMap, setProductsMap] = useState<Map<string, { name: string; category: string }>>(new Map())
  const [loading, setLoading] = useState(true)

  // Lookups (pães e produtos) carregam uma vez
  useEffect(() => {
    Promise.all([
      supabase.from('breads').select('id,name'),
      supabase.from('products').select('id,name,category'),
    ]).then(([b, p]) => {
      const bm = new Map<string, { name: string; category: string }>()
      ;(b.data || []).forEach((x: any) => bm.set(x.id, { name: x.name, category: 'Pães' }))
      const pm = new Map<string, { name: string; category: string }>()
      ;(p.data || []).forEach((x: any) => pm.set(x.id, { name: x.name, category: x.category || '—' }))
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

  // Filtros locais + resolução de nome de produto + ordenação por data desc
  const filteredRows: DisplayRow[] = useMemo(() => {
    return rows
      .filter(r => modo === 'ambos' || r.modo === modo)
      .filter(r => responsible === 'all' || r.responsible === responsible)
      .map(r => {
        const lookup = r.product_source === 'bread' ? breadsMap.get(r.product_id) : productsMap.get(r.product_id)
        return {
          date: r.record_date,
          responsible: r.responsible,
          modo: r.modo === 'sobra' ? 'Sobra' : 'Descarte',
          product: lookup?.name ?? '(desconhecido)',
          category: lookup?.category ?? '—',
          quantity: r.quantity,
          obs: r.obs ?? '',
          _modoRaw: r.modo,
        }
      })
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  }, [rows, modo, responsible, breadsMap, productsMap])

  // KPIs
  const kpis = useMemo(() => {
    const sobras = filteredRows.filter(r => r._modoRaw === 'sobra')
    const descartes = filteredRows.filter(r => r._modoRaw === 'descarte')
    const sobrasTotal = sobras.reduce((s, r) => s + r.quantity, 0)
    const descartesTotal = descartes.reduce((s, r) => s + r.quantity, 0)
    const records = filteredRows.length

    const byProduct = new Map<string, number>()
    filteredRows.forEach(r => {
      byProduct.set(r.product, (byProduct.get(r.product) || 0) + r.quantity)
    })
    let topProduct = '—'; let topQty = 0
    byProduct.forEach((qty, name) => {
      if (qty > topQty) { topQty = qty; topProduct = name }
    })

    return { sobrasTotal, descartesTotal, records, topProduct, topQty }
  }, [filteredRows])

  function handleExport() {
    if (!range) return
    csvExport(
      filteredRows.map(r => ({
        Data: r.date,
        Responsavel: r.responsible,
        Modo: r.modo,
        Produto: r.product,
        Categoria: r.category,
        Quantidade: r.quantity,
        Obs: r.obs,
      })),
      `sobras-descartes-${toISODate(range.from)}-a-${toISODate(range.to)}.csv`
    )
  }

  const columns: ReportTableColumn<DisplayRow>[] = [
    { key: 'date',        label: 'Data',        format: (v) => formatDateBR(v as string) },
    { key: 'responsible', label: 'Responsável' },
    { key: 'modo',        label: 'Modo' },
    { key: 'product',     label: 'Produto' },
    { key: 'category',    label: 'Categoria' },
    { key: 'quantity',    label: 'Qtd', align: 'right', format: (v) => (v as number).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) },
    { key: 'obs',         label: 'Obs', sortable: false },
  ]

  return (
    <div style={{ padding: '20px', maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ marginBottom: '16px' }}>
        <button onClick={() => router.push('/relatorios')}
          style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.85rem', padding: 0 }}>
          ← Voltar
        </button>
      </div>

      <h1 style={{ margin: '0 0 4px', fontSize: '1.4rem', fontWeight: 700 }}>♻️ Sobras & Descartes</h1>
      <p style={{ margin: '0 0 20px', color: 'var(--muted)', fontSize: '0.9rem' }}>
        Histórico unificado com filtros por período, modo e responsável.
      </p>

      {/* Filtros */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
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
          style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '0.85rem' }}>
          <option value="all">Todos os responsáveis</option>
          {allResponsibles.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
        <KPICard label="Total Sobras"    value={kpis.sobrasTotal}    unit="un" accent="#0a6e52" />
        <KPICard label="Total Descartes" value={kpis.descartesTotal} unit="un" accent="#dc2626" />
        <KPICard label="Registros"       value={kpis.records} />
        <KPICard label="Top produto"     value={kpis.topProduct}     helper={`${kpis.topQty.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} un total`} />
      </div>

      {/* Export */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
        <button onClick={handleExport}
          disabled={filteredRows.length === 0}
          style={{
            padding: '8px 14px', borderRadius: '6px', border: '1px solid var(--border)',
            background: 'white', cursor: filteredRows.length === 0 ? 'not-allowed' : 'pointer',
            opacity: filteredRows.length === 0 ? 0.5 : 1,
            fontSize: '0.85rem', fontWeight: 600,
          }}>
          📥 Exportar CSV
        </button>
      </div>

      {/* Tabela */}
      <ReportTable
        columns={columns}
        rows={filteredRows}
        loading={loading}
        emptyMessage="Sem registros no período/filtros selecionados."
      />
    </div>
  )
}
