'use client'

type Accent = 'sage' | 'berry' | 'honey' | 'crust'

interface Props {
  label: string
  value: string | number
  unit?: string
  helper?: string
  accent?: Accent
}

export default function KPICard({ label, value, unit, helper, accent }: Props) {
  return (
    <div className={`ps-kpi ${accent || ''}`}>
      <div className="ps-kpi-lbl">{label}</div>
      <div className="ps-kpi-val">
        {typeof value === 'number' ? value.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : value}
        {unit && <small>{unit}</small>}
      </div>
      {helper && <div className="ps-kpi-help">{helper}</div>}
    </div>
  )
}
