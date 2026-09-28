'use client'
import { useState } from 'react'
import { Lock, Unlock } from 'lucide-react'
import { formatDayMonth, type InventoryCountReopenAccess, type InventoryWeeklyCount } from '@/lib/inventoryCount'

interface Props {
  count: InventoryWeeklyCount
  /** A contagem fechada é a da semana de hoje: não existe outra para iniciar. */
  isCurrentWeek: boolean
  /** Segunda-feira da próxima semana, YYYY-MM-DD, para dizer quando começa a próxima. */
  nextWeekStart: string
  canStartNew: boolean
  reopenAccess: InventoryCountReopenAccess
  /** Domingo da semana da contagem, YYYY-MM-DD: fim do prazo de quem conta. */
  reopenDeadline: string
  opening: boolean
  reopening: boolean
  formatDateTime: (value: string | null) => string
  onStart: () => void
  onReopen: () => Promise<void>
}

// Contagem fechada: quem fechou, se dá para reabrir (e até quando) e se já dá
// para começar a da semana. O botão de iniciar some quando a contagem fechada
// é a desta semana, porque o banco recusaria (uma contagem por semana).
export function InventoryCountClosedPanel(props: Props) {
  const { count, isCurrentWeek, reopenAccess, reopenDeadline } = props
  const [confirmingReopen, setConfirmingReopen] = useState(false)
  const canReopen = reopenAccess === 'admin' || reopenAccess === 'counter-in-time'
  const deadlineLabel = formatDayMonth(reopenDeadline)

  const confirmReopen = async () => {
    await props.onReopen()
    setConfirmingReopen(false)
  }

  return (
    <div className="ps-card" style={{marginTop:14, padding:'12px 14px', background:'var(--cream)'}}>
      <div style={{display:'flex', alignItems:'center', gap:8, fontSize:13, fontWeight:600}}>
        <Lock size={16}/>
        <span>
          Contagem da semana de {formatDayMonth(count.week_start)} fechada em {props.formatDateTime(count.closed_at)}
          {count.closed_by_name ? ` por ${count.closed_by_name}` : ''}
        </span>
      </div>

      {isCurrentWeek && (
        <div style={{fontSize:13, color:'var(--ink-soft)', marginTop:8}}>
          Os números desta semana estão travados. A próxima contagem começa na segunda-feira, {formatDayMonth(props.nextWeekStart)}.
        </div>
      )}

      {reopenAccess === 'counter-in-time' && !confirmingReopen && (
        <div style={{fontSize:13, color:'var(--ink-soft)', marginTop:8}}>
          Fechou antes de terminar? Você pode reabrir até domingo, {deadlineLabel}, às 23:59.
        </div>
      )}

      {reopenAccess === 'counter-late' && (
        <div style={{fontSize:13, color:'var(--ink-soft)', marginTop:8}}>
          O prazo para reabrir esta contagem terminou no domingo, {deadlineLabel}. Agora só o admin reabre.
        </div>
      )}

      {canReopen && (
        <div style={{display:'flex', gap:8, marginTop:10, flexWrap:'wrap', alignItems:'center'}}>
          {!confirmingReopen ? (
            <button className="ps-btn ghost sm" onClick={() => setConfirmingReopen(true)}>
              <Unlock size={14}/> Reabrir esta contagem
            </button>
          ) : (
            <>
              <span style={{fontSize:12, color:'var(--ink-soft)'}}>
                Reabrir e liberar a edição dos números? Depois é só fechar de novo.
              </span>
              <button className="ps-btn sm" onClick={confirmReopen} disabled={props.reopening}>
                {props.reopening ? 'Reabrindo...' : 'Confirmar'}
              </button>
              <button className="ps-btn ghost sm" onClick={() => setConfirmingReopen(false)} disabled={props.reopening}>
                Cancelar
              </button>
            </>
          )}
        </div>
      )}

      {props.canStartNew && (
        <div style={{marginTop:12}}>
          <button className="ps-btn" onClick={props.onStart} disabled={props.opening}>
            {props.opening ? 'Abrindo...' : 'Iniciar contagem desta semana'}
          </button>
        </div>
      )}
    </div>
  )
}
