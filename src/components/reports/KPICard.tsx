'use client'

interface Props {
  label: string
  value: string | number
  unit?: string
  helper?: string
  accent?: string
}

export default function KPICard({ label, value, unit, helper, accent }: Props) {
  return (
    <div style={{
      background: 'white', borderRadius: '12px', padding: '14px 16px',
      border: '1px solid var(--border)',
      borderTop: accent ? `3px solid ${accent}` : '1px solid var(--border)',
      flex: '1 1 140px', minWidth: '140px',
    }}>
      <div style={{ fontSize: '0.72rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '4px', color: accent ?? 'var(--text)', lineHeight: 1.2 }}>
        {typeof value === 'number' ? value.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : value}
        {unit && <span style={{ fontSize: '0.85rem', fontWeight: 400, color: 'var(--muted)', marginLeft: '4px' }}>{unit}</span>}
      </div>
      {helper && <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '4px' }}>{helper}</div>}
    </div>
  )
}
