'use client'

interface Option {
  value: string
  label: string
}

interface Props {
  options: Option[]
  value: string
  onChange: (value: string) => void
}

export default function SegmentedFilter({ options, value, onChange }: Props) {
  return (
    <div style={{ display: 'inline-flex', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden' }}>
      {options.map((opt, i) => (
        <button key={opt.value} onClick={() => onChange(opt.value)}
          style={{
            padding: '6px 14px',
            background: value === opt.value ? 'var(--primary)' : 'white',
            color: value === opt.value ? 'white' : 'var(--text)',
            border: 'none',
            borderLeft: i > 0 ? '1px solid var(--border)' : 'none',
            cursor: 'pointer',
            fontSize: '0.85rem', fontWeight: 600,
          }}>
          {opt.label}
        </button>
      ))}
    </div>
  )
}
