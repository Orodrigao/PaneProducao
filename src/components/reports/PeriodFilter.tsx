'use client'
import { useState, useEffect } from 'react'
import { readCustomPeriod, type CustomPeriodIssue } from '@/lib/periodFilter'

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

const ISSUE_MESSAGES: Record<CustomPeriodIssue, string> = {
  incomplete: 'Data incompleta: o relatório segue no último período válido.',
  inverted: 'A data inicial é depois da final: o relatório segue no último período válido.',
}

interface Props {
  defaultPreset?: Preset
  onChange: (range: { from: Date; to: Date }) => void
}

export default function PeriodFilter({ defaultPreset = '30d', onChange }: Props) {
  const [preset, setPreset] = useState<Preset>(defaultPreset)
  const [customFrom, setCustomFrom] = useState(() => toISODate(new Date(Date.now() - 30 * 86400000)))
  const [customTo, setCustomTo] = useState(() => toISODate(new Date()))

  const customIssue = preset === 'custom' ? readCustomPeriod(customFrom, customTo).issue : null

  useEffect(() => {
    if (preset === 'custom') {
      // Data apagada, incompleta ou início depois do fim: não emite período novo; a tela segue no último válido.
      const { period } = readCustomPeriod(customFrom, customTo)
      if (period) onChange(period)
    } else {
      onChange(rangeFor(preset))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, customFrom, customTo])

  return (
    // Sobras e descartes trava a linha dos botões em tela larga; o aviso precisa quebrar linha.
    <div className="ps-presets" style={customIssue ? { flexWrap: 'wrap' } : undefined}>
      {(['hoje','7d','30d','mes','custom'] as Preset[]).map(p => (
        <button key={p} onClick={() => setPreset(p)} className={`ps-preset ${preset === p ? 'active' : ''}`}>
          {PRESET_LABELS[p]}
        </button>
      ))}
      {preset === 'custom' && (
        <>
          <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
            className="ps-input" style={{padding:'6px 10px', fontSize:13}}/>
          <span style={{color:'var(--ink-soft)', fontSize:13}}>até</span>
          <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
            className="ps-input" style={{padding:'6px 10px', fontSize:13}}/>
        </>
      )}
      {customIssue && (
        <span role="status" className="ps-help" style={{flexBasis:'100%', marginTop:0}}>
          {ISSUE_MESSAGES[customIssue]}
        </span>
      )}
    </div>
  )
}
