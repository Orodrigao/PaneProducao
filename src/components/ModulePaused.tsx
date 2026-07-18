import Link from 'next/link'
import { PauseCircle } from 'lucide-react'

interface ModulePausedProps {
  title?: string
}

export function ModulePaused({ title = 'Compras e cotações' }: ModulePausedProps) {
  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <div className="ps-scroll ps-pad">
          <div className="ps-card" style={{ marginTop: 24, padding: 24, textAlign: 'center' }}>
            <PauseCircle
              size={40}
              strokeWidth={1.7}
              style={{ color: 'var(--honey-deep)', margin: '0 auto 12px' }}
            />
            <h1 className="ps-page-title" style={{ marginBottom: 8 }}>{title}</h1>
            <p className="ps-page-lead" style={{ marginBottom: 16 }}>
              Este módulo está temporariamente pausado enquanto o fluxo e a real
              necessidade da operação são reavaliados.
            </p>
            <p style={{ color: 'var(--ink-soft)', fontSize: 13, marginBottom: 20 }}>
              Os dados históricos foram preservados.
            </p>
            <Link href="/" className="ps-btn primary">
              Voltar para Produção
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
