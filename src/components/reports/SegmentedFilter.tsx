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
    <div className="ps-segments">
      {options.map(opt => (
        <button key={opt.value} onClick={() => onChange(opt.value)}
          className={`ps-seg ${value === opt.value ? 'active' : ''}`}>
          {opt.label}
        </button>
      ))}
    </div>
  )
}
