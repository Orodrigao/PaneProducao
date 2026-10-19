interface HistoryBread {
  id: string
  name: string
}

interface HistoryOrder {
  quantity: number
  obs?: string
}

interface Props {
  storeLabel: string
  breads: HistoryBread[]
  orders: Record<string, HistoryOrder>
}

export function ProductionOrderHistory({ storeLabel, breads, orders }: Props) {
  const rows = breads.filter(b => (orders[b.id]?.quantity || 0) > 0)
  const total = rows.reduce((sum, b) => sum + (orders[b.id]?.quantity || 0), 0)
  const obs = Object.values(orders)[0]?.obs

  return <>
    <div className="stat-row">
      <div className="stat-card" style={{ gridColumn: '1/-1' }}>
        <div className="lbl">{storeLabel}</div><div className="val">{total}</div>
      </div>
    </div>
    {!rows.length ? <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Nenhum pedido nesta data.</div> : <>
      {obs && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8, padding: '8px 12px', background: 'var(--amber-bg)', borderRadius: 'var(--radius-sm)' }}>Obs: {obs}</div>}
      <table className="report-table"><thead><tr><th>Pão</th><th className="num">Qtd</th></tr></thead>
        <tbody>
          {rows.map(b => <tr key={b.id}><td>{b.name}</td><td className="num">{orders[b.id]?.quantity || 0}</td></tr>)}
          <tr><td>Total</td><td className="num">{total}</td></tr>
        </tbody>
      </table>
    </>}
  </>
}
