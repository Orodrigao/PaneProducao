import { formatKitchenQuantity, type KitchenDaySummaryItem } from '@/lib/kitchenProduction'

interface KitchenDaySummaryProps {
  title: string
  rows: readonly KitchenDaySummaryItem[]
  totals: Readonly<Record<string, number>>
}

export function KitchenDaySummary({ title, rows, totals }: KitchenDaySummaryProps) {
  return (
    <div style={{ display: 'grid', gap: 9 }}>
      <b style={{ fontSize: 14 }}>{title}</b>

      {rows.length === 0 ? (
        <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
          Nenhuma produção salva neste dia.
        </span>
      ) : (
        <div style={{ display: 'grid', gap: 7 }}>
          {rows.map(row => (
            <div
              key={row.product_id}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                {row.name}
              </span>
              <b style={{ fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>
                {formatKitchenQuantity(row.quantity, row.unit)}
              </b>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          borderTop: '1px solid var(--ps-line)',
          display: 'flex',
          justifyContent: 'space-between',
          paddingTop: 9,
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--ink-faint)', fontWeight: 700 }}>
          Total
        </span>
        <b style={{ fontSize: 16, fontVariantNumeric: 'tabular-nums' }}>
          {Object.entries(totals).map(([unit, total]) => formatKitchenQuantity(total, unit)).join(' · ') || '0'}
        </b>
      </div>
    </div>
  )
}
