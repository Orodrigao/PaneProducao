'use client'

import { useState } from 'react'
import { Ban, X } from 'lucide-react'
import type { CancellationAvailability } from '@/lib/orderCancellation'
import { normalizeCancellationReason } from '@/lib/orderCancellation'

interface OrderCancellationPanelProps {
  canCancel: boolean
  availability: CancellationAvailability
  busy: boolean
  onConfirm: (reason: string) => Promise<boolean>
}

export default function OrderCancellationPanel({
  canCancel,
  availability,
  busy,
  onConfirm,
}: OrderCancellationPanelProps) {
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')
  const normalizedReason = normalizeCancellationReason(reason)

  if (!canCancel) return null

  if (!availability.allowed) {
    return (
      <div style={{display:'grid', gap:8, marginBottom:14}}>
        <button type="button" disabled className="ps-btn danger" style={{justifyContent:'center'}}>
          <Ban size={14}/> Cancelar pedido
        </button>
        <div className="ps-warning" style={{margin:0}}>{availability.message}</div>
      </div>
    )
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={busy}
        className="ps-btn danger"
        style={{width:'100%', justifyContent:'center', marginBottom:14}}
      >
        <Ban size={14}/> Cancelar pedido
      </button>
    )
  }

  const submit = async () => {
    if (!normalizedReason || busy) return
    const success = await onConfirm(normalizedReason)
    if (success) {
      setConfirming(false)
      setReason('')
    }
  }

  return (
    <div className="ps-discard" style={{marginBottom:14}}>
      <div className="ps-refuse-head"><Ban size={15}/> Confirmar cancelamento</div>
      <div style={{fontSize:12.5, color:'var(--ink-soft)'}}>
        O pedido continuará no histórico, mas sairá da produção e dos totais operacionais.
      </div>
      <label className="ps-fieldgroup">
        <span className="ps-fieldlabel">Motivo obrigatório *</span>
        <input
          type="text"
          value={reason}
          onChange={event => setReason(event.target.value)}
          maxLength={160}
          disabled={busy}
          autoFocus
          placeholder="Ex.: cliente desistiu"
          className="ps-input"
        />
      </label>
      <div style={{display:'flex', gap:8, justifyContent:'flex-end', flexWrap:'wrap'}}>
        <button type="button" onClick={() => { setConfirming(false); setReason('') }} disabled={busy} className="ps-btn ghost">
          <X size={14}/> Voltar
        </button>
        <button type="button" onClick={submit} disabled={busy || !normalizedReason} className="ps-btn danger">
          <Ban size={14}/> {busy ? 'Cancelando…' : 'Confirmar cancelamento'}
        </button>
      </div>
    </div>
  )
}
