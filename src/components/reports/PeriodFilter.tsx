'use client'
import { useState, useEffect } from 'react'

type Preset = 'hoje' | '7d' | '30d' | 'mes' | 'custom'

function startOfDay(d: Date): Date {
  const x = new Date(d); x.setHours(0,0,0,0); return x
}
function endOfDay(d: Date): Date {
  const x = new Date(d); x.setHours(23,59,59,999); return x
}
function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function rangeFor(preset: Preset): { from: Date; to: Date } {
  const now = new Date()
  const to = endOfDay(now)
  switch (preset) {
    case 'hoje': return { from: startOfDay(now), to }
    case '7d':   { const f = new Date(now); f.setDate(f.getDate() - 6);  return { from: startOfDay(f), to } }
    case '30d':  { const f = new Date(now); f.setDate(f.getDate() - 29); return { from: startOfDay(f), to } }
    case 'mes':  { const f = new Date(now.getFullYear(), now.getMonth(), 1); return { from: startOfDay(f), to } }
    case 'custom': return { from: startOfDay(now), to }
  }
}

const PRESET_LABELS: Record<Preset, string> = {
  hoje: 'Hoje', '7d': '7 dias', '30d': '30 dias', mes: 'Mês', custom: 'Custom',
}

interface Props {
  defaultPreset?: Preset
  onChange: (range: { from: Date; to: Date }) => void
}

export default function PeriodFilter({ defaultPreset = '30d', onChange }: Props) {
  const [preset, setPreset] = useState<Preset>(defaultPreset)
  const [customFrom, setCustomFrom] = useState(() => toISODate(new Date(Date.now() - 30 * 86400000)))
  const [customTo, setCustomTo] = useState(() => toISODate(new Date()))

  useEffect(() => {
    if (preset === 'custom') {
      onChange({
        from: new Date(customFrom + 'T00:00:00'),
        to:   new Date(customTo + 'T23:59:59'),
      })
    } else {
      onChange(rangeFor(preset))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, customFrom, customTo])

  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
      {(['hoje','7d','30d','mes','custom'] as Preset[]).map(p => (
        <button key={p} onClick={() => setPreset(p)}
          style={{
            padding: '6px 12px', borderRadius: '6px',
            border: '1px solid var(--border)',
            background: preset === p ? 'var(--primary)' : 'white',
            color: preset === p ? 'white' : 'var(--text)',
            cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
          }}>
          {PRESET_LABELS[p]}
        </button>
      ))}
      {preset === 'custom' && (
        <>
          <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
            style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '0.85rem' }} />
          <span style={{ color: 'var(--muted)' }}>até</span>
          <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
            style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border)', fontSize: '0.85rem' }} />
        </>
      )}
    </div>
  )
}
