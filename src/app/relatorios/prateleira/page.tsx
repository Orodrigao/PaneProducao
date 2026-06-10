'use client'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Download, ChevronLeft } from 'lucide-react'
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
  store: string
  product_id: string
  product_source: string
  quantity: number
  counted_by: string
  created_at: string
}

interface DisplayRow {
  date: string
  store: string
  product: string
  quantity: number
  counted_by: string
}

interface ProductInfo {
  name: string
}

const STORE_LABELS: Record<string, string> = {
  jc: 'JC',
  ja: 'JA',
  ex: 'EX',
}

function storeLabel(s: string): string {
  return STORE_LABELS[s] ?? s.toUpperCase()
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

export default function PrateleiraReport() {
  const router = useRouter()
  const [user, setUser] = useState<AppUser | null>(null)
  const [range, setRange] = useState<{ from: Date; to: Date } | null>(null)
  const [store, setStore] = useState<string>('all')
  const [productFilter, setProductFilter] = useState<string>('all')

  const [rows, setRows] = useState<DBRow[]>([])
  const [breadsMap, setBreadsMap] = useState<Map<string, ProductInfo>>(new Map())
  const [productsMap, setProductsMap] = useState<Map<string, ProductInfo>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setUser(getCurrentUser())
  }, [])

  useEffect(() => {
    Promise.all([
      supabase.from('breads').select('id,name'),
      supabase.from('products').select('id,name'),
    ]).then(([b, p]) => {
      const bm = new Map<string, ProductInfo>()
      ;(b.data || []).forEach((x: any) => bm.set(x.id, { name: x.name }))
      const pm = new Map<string, ProductInfo>()
      ;(p.data || []).forEach((x: any) => pm.set(x.id, { name: x.name }))
      setBreadsMap(bm)
      setProductsMap(pm)
    })
  }, [])

  useEffect(() => {
    if (!range) return
    setLoading(true)
    const fromStr = toISODate(range.from)
    const toStr   = toISODate(range.to)
    supabase
      .from('shelf_counts')
      .select('*')
      .gte('record_date', fromStr)
      .lte('record_date', toStr)
      .order('record_date', { ascending: false })
      .then(
        ({ data }) => { setRows(data || []); setLoading(false) },
        () => setLoading(false)
      )
  }, [range])

  const displayRows: DisplayRow[] = useMemo(() => {
    return rows.map(r => {
      const lookup = r.product_source === 'bread' ? breadsMap.get(r.product_id) : productsMap.get(r.product_id)
      return {
        date:       r.record_date,
        store:      r.store,
        product:    lookup?.name ?? '(desconhecido)',
        quantity:   Number(r.quantity),
        counted_by: r.counted_by,
      }
    })
  }, [rows, breadsMap, productsMap])

  const allProducts = useMemo(() => {
    const set = new Set(displayRows.map(r => r.product))
    return Array.from(set).sort()
  }, [displayRows])

  const filteredRows = useMemo(() => {
    return displayRows
      .filter(r => store === 'all' || r.store === store)
      .filter(r => productFilter === 'all' || r.product === productFilter)
  }, [displayRows, store, productFilter])

  const kpis = useMemo(() => {
    const totalRegistros = filteredRows.length
    const totalUnidades  = filteredRows.reduce((s, r) => s + r.quantity, 0)
    const storesAtivas   = new Set(filteredRows.map(r => r.store)).size
    const byProduct = new Map<string, number>()
    filteredRows.forEach(r => {
      byProduct.set(r.product, (byProduct.get(r.product) ?? 0) + r.quantity)
    })
    let topProduct = '—'; let topQtd = 0
    byProduct.forEach((v, n) => { if (v > topQtd) { topQtd = v; topProduct = n } })
    return { totalRegistros, totalUnidades, storesAtivas, topProduct, topQtd }
  }, [filteredRows])

  function handleExport() {
    if (!range) return
    csvExport(
      filteredRows.map(r => ({
        Data:       formatDateBR(r.date),
        Loja:       storeLabel(r.store),
        Produto:    r.product,
        Quantidade: r.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 2 }),
        Contado_por: r.counted_by,
      })),
      `prateleira-${toISODate(range.from)}-a-${toISODate(range.to)}.csv`
    )
  }

  const columns: ReportTableColumn<DisplayRow>[] = [
    { key: 'date',       label: 'Data',     format: (v) => formatDateBR(v as string) },
    { key: 'store',      label: 'Loja',     format: (v) => storeLabel(v as string) },
    { key: 'product',    label: 'Produto' },
    { key: 'quantity',   label: 'Qtd', align: 'right', format: (v) => (v as number).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) },
    { key: 'counted_by', label: 'Contado por' },
  ]

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
              <b>Prateleira</b>
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
          <h1 className="ps-page-title">🗂️ Prateleira</h1>
          <p className="ps-page-lead">
            Histórico de contagens de prateleira por período, loja e produto.
          </p>

          <div className="ps-filters">
            <PeriodFilter onChange={setRange} />
            <SegmentedFilter
              options={[
                { value: 'all', label: 'Todas' },
                { value: 'jc',  label: 'JC' },
                { value: 'ja',  label: 'JA' },
                { value: 'ex',  label: 'EX' },
              ]}
              value={store}
              onChange={setStore}
            />
            <select
              value={productFilter}
              onChange={e => setProductFilter(e.target.value)}
              className="ps-select"
              style={{padding:'6px 10px', fontSize:13, flex:'0 1 220px'}}
            >
              <option value="all">Todos os produtos</option>
              {allProducts.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div style={{display:'flex', flexWrap:'wrap', gap:12, marginBottom:14}}>
            <KPICard label="Registros"     value={kpis.totalRegistros} />
            <KPICard label="Total unidades" value={kpis.totalUnidades.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} />
            <KPICard label="Lojas"         value={kpis.storesAtivas} />
            <KPICard label="Top produto"   value={kpis.topProduct} helper={kpis.topQtd > 0 ? `${kpis.topQtd.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} un` : '—'} />
          </div>

          <div style={{display:'flex', justifyContent:'flex-end', marginBottom:8}}>
            <button onClick={handleExport} disabled={filteredRows.length === 0} className="ps-btn ghost sm">
              <Download size={14}/> Exportar CSV
            </button>
          </div>

          <ReportTable
            columns={columns}
            rows={filteredRows}
            loading={loading}
            emptyMessage="Sem registros no período/filtros selecionados."
          />
        </div>
      </div>
    </div>
  )
}
