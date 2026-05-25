'use client'
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import PeriodFilter from '@/components/reports/PeriodFilter'
import KPICard from '@/components/reports/KPICard'
import ReportTable, { ReportTableColumn } from '@/components/reports/ReportTable'
import { csvExport } from '@/components/reports/csvExport'

interface Order {
  id: string
  customer_id: string | null
  product_name: string | null
  product_source: 'bread' | 'product' | null
  quantity: number
  unit_price: number | string | null
  pack_size: number | null
  pricing_unit: 'un' | 'kg' | null
  order_date: string
  delivery_date: string | null
}

interface Customer { id: string; name: string }

const formatBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const toISODate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`

// Valor monetário da linha: kg => price*qty; un => price*pack*qty (pack é múltiplo).
function rowValue(o: Order): number {
  const price = Number(o.unit_price ?? 0)
  const qty = Number(o.quantity ?? 0)
  const pack = Number(o.pack_size ?? 1) || 1
  return o.pricing_unit === 'kg' ? price * qty : price * pack * qty
}
// Quantidade física vendida (un ou kg).
function rowUnits(o: Order): { qty: number; unit: 'un' | 'kg' } {
  const q = Number(o.quantity ?? 0)
  const pack = Number(o.pack_size ?? 1) || 1
  return o.pricing_unit === 'kg' ? { qty: q, unit: 'kg' } : { qty: q * pack, unit: 'un' }
}

export default function RelatorioPJ() {
  const [range, setRange]           = useState<{ from: Date; to: Date } | null>(null)
  const [customerId, setCustomerId] = useState<string>('all')
  const [orders, setOrders]         = useState<Order[]>([])
  const [customers, setCustomers]   = useState<Customer[]>([])
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    supabase.from('customers').select('id,name').eq('active', true).order('name').then(({ data }) => {
      setCustomers((data || []) as Customer[])
    })
  }, [])

  useEffect(() => {
    if (!range) return
    setLoading(true)
    const fromISO = toISODate(range.from)
    const toISO   = toISODate(range.to)
    // Período sobre delivery_date (faturamento real) com fallback pra order_date
    // quando o pedido foi gravado sem delivery (pré-PR-C3a).
    const orFilter = `and(delivery_date.gte.${fromISO},delivery_date.lte.${toISO}),and(delivery_date.is.null,order_date.gte.${fromISO},order_date.lte.${toISO})`
    supabase.from('orders')
      .select('id,customer_id,product_name,product_source,quantity,unit_price,pack_size,pricing_unit,order_date,delivery_date')
      .eq('order_type', 'pj')
      .or(orFilter)
      .then(({ data, error }) => {
        if (error) { console.error(error); setOrders([]) }
        else setOrders((data || []) as Order[])
        setLoading(false)
      })
  }, [range])

  const filteredOrders = useMemo(() =>
    customerId === 'all' ? orders : orders.filter(o => o.customer_id === customerId),
    [orders, customerId]
  )

  // KPIs. Um "pedido" = (customer_id, data) — várias linhas no mesmo dia/cliente
  // foram parte do mesmo carrinho em /pedidos-pj.
  const kpis = useMemo(() => {
    const total = filteredOrders.reduce((s, o) => s + rowValue(o), 0)
    const pedidoKeys = new Set<string>()
    filteredOrders.forEach(o => {
      const dateKey = o.delivery_date ?? o.order_date
      pedidoKeys.add(`${o.customer_id ?? 'null'}_${dateKey}`)
    })
    const nPedidos = pedidoKeys.size
    const clientes = new Set(filteredOrders.map(o => o.customer_id).filter(Boolean)).size
    const ticket = nPedidos > 0 ? total / nPedidos : 0
    return { total, nPedidos, clientes, ticket }
  }, [filteredOrders])

  const customersMap = useMemo(() => new Map(customers.map(c => [c.id, c.name])), [customers])

  interface RowCliente { cliente: string; pedidos: number; total: number; ticketMedio: number }
  const vendasPorCliente: RowCliente[] = useMemo(() => {
    const acc = new Map<string, { cliente: string; pedidos: Set<string>; total: number }>()
    filteredOrders.forEach(o => {
      const id = o.customer_id ?? 'sem-cliente'
      const nome = o.customer_id ? (customersMap.get(o.customer_id) ?? '(cliente removido)') : '(sem cliente)'
      const cur = acc.get(id) ?? { cliente: nome, pedidos: new Set<string>(), total: 0 }
      cur.total += rowValue(o)
      cur.pedidos.add(`${o.delivery_date ?? o.order_date}`)
      acc.set(id, cur)
    })
    return Array.from(acc.values()).map(x => ({
      cliente: x.cliente,
      pedidos: x.pedidos.size,
      total: x.total,
      ticketMedio: x.pedidos.size > 0 ? x.total / x.pedidos.size : 0,
    }))
  }, [filteredOrders, customersMap])

  interface RowProduto { produto: string; qtd: string; total: number }
  const topProdutos: RowProduto[] = useMemo(() => {
    const acc = new Map<string, { produto: string; qtdUn: number; qtdKg: number; total: number }>()
    filteredOrders.forEach(o => {
      const nome = o.product_name ?? '(sem nome)'
      const cur = acc.get(nome) ?? { produto: nome, qtdUn: 0, qtdKg: 0, total: 0 }
      const u = rowUnits(o)
      if (u.unit === 'kg') cur.qtdKg += u.qty
      else cur.qtdUn += u.qty
      cur.total += rowValue(o)
      acc.set(nome, cur)
    })
    return Array.from(acc.values()).map(x => ({
      produto: x.produto,
      qtd: x.qtdUn > 0 && x.qtdKg > 0
        ? `${x.qtdUn} un + ${x.qtdKg.toLocaleString('pt-BR')} kg`
        : x.qtdKg > 0
          ? `${x.qtdKg.toLocaleString('pt-BR')} kg`
          : `${x.qtdUn} un`,
      total: x.total,
    }))
  }, [filteredOrders])

  const colsCliente: ReportTableColumn<RowCliente>[] = [
    { key: 'cliente',     label: 'Cliente' },
    { key: 'pedidos',     label: 'Pedidos', align: 'right' },
    { key: 'total',       label: 'Total',         align: 'right', format: v => formatBRL(v as number) },
    { key: 'ticketMedio', label: 'Ticket médio',  align: 'right', format: v => formatBRL(v as number) },
  ]
  const colsProduto: ReportTableColumn<RowProduto>[] = [
    { key: 'produto', label: 'Produto' },
    { key: 'qtd',     label: 'Quantidade', align: 'right', sortable: false },
    { key: 'total',   label: 'Vendas', align: 'right', format: v => formatBRL(v as number) },
  ]

  function exportClientes() {
    csvExport(vendasPorCliente.map(r => ({
      Cliente: r.cliente,
      Pedidos: r.pedidos,
      'Total (R$)': r.total.toFixed(2).replace('.', ','),
      'Ticket médio (R$)': r.ticketMedio.toFixed(2).replace('.', ','),
    })), `vendas-pj-por-cliente_${toISODate(new Date())}.csv`)
  }
  function exportProdutos() {
    csvExport(topProdutos.map(r => ({
      Produto: r.produto,
      Quantidade: r.qtd,
      'Vendas (R$)': r.total.toFixed(2).replace('.', ','),
    })), `vendas-pj-top-produtos_${toISODate(new Date())}.csv`)
  }

  return (
    <div style={{ padding: 20, maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700 }}>🤝 Vendas PJ</h1>
        <span style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
          {loading ? 'carregando...' : `${filteredOrders.length} linha(s) no período`}
        </span>
      </div>

      <div style={{ background: 'white', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <PeriodFilter defaultPreset="30d" onChange={setRange} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: '.8rem', color: 'var(--muted)', fontWeight: 600 }}>Cliente:</label>
          <select value={customerId} onChange={e => setCustomerId(e.target.value)}
            style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: '.85rem', flex: '0 1 260px' }}>
            <option value="all">Todos</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <KPICard label="Vendas totais" value={formatBRL(kpis.total)} accent="#16a34a" />
        <KPICard label="Pedidos"        value={kpis.nPedidos} />
        <KPICard label="Ticket médio"   value={formatBRL(kpis.ticket)} />
        <KPICard label="Clientes únicos" value={kpis.clientes} />
      </div>

      <div style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Por cliente</h2>
          <button onClick={exportClientes} disabled={vendasPorCliente.length === 0}
            style={{ padding: '6px 12px', background: vendasPorCliente.length === 0 ? '#e5e7eb' : '#f3f4f6', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, fontSize: '.8rem', fontWeight: 600, cursor: vendasPorCliente.length === 0 ? 'default' : 'pointer' }}>
            📥 CSV
          </button>
        </div>
        <ReportTable columns={colsCliente} rows={vendasPorCliente} loading={loading}
          initialSortKey="total" initialSortDir="desc"
          emptyMessage="Nenhum pedido PJ no período." />
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Top produtos</h2>
          <button onClick={exportProdutos} disabled={topProdutos.length === 0}
            style={{ padding: '6px 12px', background: topProdutos.length === 0 ? '#e5e7eb' : '#f3f4f6', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, fontSize: '.8rem', fontWeight: 600, cursor: topProdutos.length === 0 ? 'default' : 'pointer' }}>
            📥 CSV
          </button>
        </div>
        <ReportTable columns={colsProduto} rows={topProdutos} loading={loading}
          initialSortKey="total" initialSortDir="desc"
          emptyMessage="Nenhum produto vendido no período." />
      </div>
    </div>
  )
}
