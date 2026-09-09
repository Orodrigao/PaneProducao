'use client'

import { useEffect, useRef, useState } from 'react'
import { enrollPjFlow, readPjFlowEnrollmentGate } from '@/lib/pjFlowPilot'

export function PjFlowActivation({ orderGroupId }: { orderGroupId: string }) {
  const [gate, setGate] = useState<{ can_enroll: boolean; slot_available: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef<string | null>(null)

  useEffect(() => {
    let alive = true
    void readPjFlowEnrollmentGate()
      .then(result => { if (alive) setGate(result) })
      .catch(() => { if (alive) setGate({ can_enroll: false, slot_available: false }) })
    return () => { alive = false }
  }, [])

  if (!gate?.can_enroll) return null
  if (!gate.slot_available) return <div className="ps-warning" style={{ marginBottom: 14 }}>
    A primeira operação real já está em acompanhamento. Os outros pedidos continuam nesta rotina.
  </div>

  async function activate() {
    if (!window.confirm('Iniciar este pedido na nova jornada? Ele sairá desta lista e seguirá por Conferência, Revisão e NF, e Saída.')) return
    if (!requestId.current) requestId.current = crypto.randomUUID()
    setBusy(true); setError('')
    try {
      await enrollPjFlow(orderGroupId, requestId.current)
      window.location.assign(`/pedidos-pj?piloto=1&pedido=${encodeURIComponent(orderGroupId)}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível iniciar a nova jornada.')
    } finally { setBusy(false) }
  }

  return <div style={{ marginBottom: 14, display: 'grid', gap: 6 }}>
    <button type="button" className="ps-btn primary" disabled={busy} onClick={() => void activate()}>
      {busy ? 'Iniciando…' : 'Iniciar nova jornada neste pedido'}
    </button>
    <span style={{ fontSize: 12.5, color: 'var(--ink-soft)', textAlign: 'center' }}>
      Nesta primeira rodada, apenas um pedido real pode ser acompanhado por vez.
    </span>
    {error && <p className="ps-warning" role="alert">{error}</p>}
  </div>
}
