'use client'

import { useEffect, useRef, useState } from 'react'
import { PjLaunchRefusedError } from '@/lib/pjExpeditionLaunch'
import {
  cancelPjOrderByExpedition,
  describePjOrderHistoryEntry,
  newPjChangeAttempt,
  pjCancelReasonProblem,
  readPjExpeditionOrder,
  type PjChangeAttempt,
  type PjExpeditionOrderState,
} from '@/lib/pjExpeditionOrderChange'
import styles from './PjFlowPilot.module.css'

// Na ficha de um pedido lançado pela Expedição: quem lançou e quem corrigiu,
// para o Financeiro e para a Expedição, e Corrigir e Cancelar para quem o
// lançou, enquanto a conferência não começou. Quem decide é o banco; a tela
// mostra o motivo que ele devolve quando não dá mais.
export function PjExpeditionOrderActions({ orderGroupId, canLaunch, disabled, onLock, reload }: {
  orderGroupId: string
  canLaunch: boolean
  disabled: boolean
  onLock: (locked: boolean) => void
  reload: (message?: string) => Promise<void>
}) {
  const [state, setState] = useState<PjExpeditionOrderState | null>(null)
  const [loadError, setLoadError] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Resposta perdida: o motivo fica travado e o reenvio repete a mesma
  // tentativa; quem desiste recarrega a ficha para ver o que ficou gravado.
  const attempt = useRef<{ attempt: PjChangeAttempt; reason: string } | null>(null)
  const [unconfirmed, setUnconfirmed] = useState(false)

  useEffect(() => {
    let alive = true
    readPjExpeditionOrder(orderGroupId)
      .then(result => { if (alive) setState(result) })
      .catch(e => { if (alive) setLoadError(e instanceof Error ? e.message : 'Não foi possível carregar o histórico do pedido.') })
    return () => { alive = false }
  }, [orderGroupId])

  const locked = cancelling || busy
  useEffect(() => { onLock(locked) }, [locked, onLock])

  const reasonProblem = pjCancelReasonProblem(reason)

  function closeCancel() {
    setCancelling(false)
    setReason('')
    setError('')
    attempt.current = null
  }

  async function cancel() {
    if (reasonProblem || busy) return
    const trimmed = reason.trim()
    if (attempt.current?.reason !== trimmed) attempt.current = { attempt: newPjChangeAttempt(), reason: trimmed }
    const current = attempt.current.attempt
    setBusy(true)
    setError('')
    try {
      await cancelPjOrderByExpedition(current, orderGroupId, trimmed)
      attempt.current = null
      setCancelling(false)
      await reload('Pedido cancelado pela Expedição e retirado da jornada')
    } catch (e) {
      // Só a recusa com a dica prova que nada foi gravado e destrava o motivo.
      if (e instanceof PjLaunchRefusedError && e.notSaved) attempt.current = null
      setUnconfirmed(attempt.current !== null)
      setError(e instanceof Error ? e.message : 'Não foi possível cancelar o pedido.')
    } finally {
      setBusy(false)
    }
  }

  if (loadError) return <div className={styles.expedition}><p className={styles.hint}>{loadError}</p></div>
  if (!state) return <div className={styles.expedition}><p className={styles.hint} role="status">Carregando quem lançou o pedido…</p></div>

  const canChange = canLaunch && state.canChange
  return <div className={styles.expedition}>
    {state.history.length > 0 && <ul className={styles.changes} aria-label="Quem lançou e corrigiu o pedido">
      {state.history.map((entry, index) => <li key={`${entry.at}:${index}`}>{describePjOrderHistoryEntry(entry)}</li>)}
    </ul>}

    {canChange && !cancelling && <div className={styles.actions} aria-label="Corrigir ou cancelar o pedido que você lançou">
      <a className={styles.secondary} href={`/pedidos-pj?lancar=1&editar=${encodeURIComponent(orderGroupId)}`}
        onClick={event => { if (disabled) event.preventDefault() }} aria-disabled={disabled}>Corrigir pedido</a>
      <button type="button" className={styles.secondary} disabled={disabled}
        onClick={() => { setCancelling(true); setError('') }}>Cancelar pedido</button>
      <p>{disabled
        ? 'Salve ou descarte as alterações da ficha antes de corrigir ou cancelar.'
        : 'Você lançou este pedido: dá para corrigir ou cancelar até a conferência começar.'}</p>
    </div>}
    {canLaunch && !state.canChange && state.changeBlockedReason && <p className={styles.hint}>{state.changeBlockedReason}</p>}

    {cancelling && <div className={styles.confirm} role="group" aria-label="Cancelar o pedido">
      <label className={styles.reasonField}>Motivo do cancelamento
        <textarea value={reason} maxLength={500} disabled={busy} readOnly={unconfirmed}
          onChange={event => setReason(event.target.value)} />
      </label>
      <p>O pedido sai da jornada e não vai para a conferência. Quem cancelou e o motivo ficam registrados para o Financeiro.</p>
      <button type="button" className={styles.primary} disabled={busy || Boolean(reasonProblem)} onClick={() => void cancel()}>
        {busy ? 'Cancelando…' : unconfirmed ? 'Enviar o mesmo cancelamento' : 'Confirmar cancelamento'}</button>{' '}
      {unconfirmed
        ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => void reload()}>Recarregar a ficha</button>
        : <button type="button" className={styles.secondary} disabled={busy} onClick={closeCancel}>Voltar</button>}
      {reasonProblem && <p className={styles.hint}>{reasonProblem}</p>}
    </div>}
    {error && <div className={styles.error} role="alert"><p>{error}</p></div>}
  </div>
}
