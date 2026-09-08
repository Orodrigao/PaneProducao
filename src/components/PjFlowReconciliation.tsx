'use client'

import { useEffect, useRef, useState } from 'react'
import { resolvePjFlowExcess, type PjExcessInput } from '@/lib/pjFlowFinance'
import type { PjFlow } from '@/lib/pjFlowPilot'
import styles from './PjFlowPilot.module.css'

const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const today = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function PjFlowReconciliation({ flow, disabled, onLock, reload }: {
  flow: PjFlow; disabled: boolean; onLock: (locked: boolean) => void; reload: (message?: string) => Promise<void>
}) {
  const [kind, setKind] = useState<'refund_pix' | 'credit'>('refund_pix')
  const [reason, setReason] = useState(''), [refundDate, setRefundDate] = useState(today())
  const [account, setAccount] = useState(flow.refund_accounts?.[0]?.key || '')
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const pending = useRef<{ id: string; input: PjExcessInput } | null>(null)
  const running = useRef(false)
  const excess = flow.pending_excess || 0
  const resolution = flow.excess_resolution
  const unsupported = excess > 0 && flow.excess_resolution_supported === false
  const editing = excess > 0 && !unsupported
  useEffect(() => { onLock(editing) }, [editing, onLock])
  if (excess <= 0 && !resolution) return null
  const invalid = reason.trim().length < 3 || reason.trim().length > 500
    || (kind === 'refund_pix' && (!refundDate || !account))
  async function save() {
    if (running.current || invalid) return
    running.current = true; setBusy(true); setError('')
    try {
      pending.current ||= { id: crypto.randomUUID(), input: { kind, reason: reason.trim(),
        refundDate: kind === 'refund_pix' ? refundDate : null, accountKey: kind === 'refund_pix' ? account : null } }
      await resolvePjFlowExcess(flow, pending.current.id, pending.current.input)
      await reload(kind === 'refund_pix' ? 'Devolução por Pix registrada' : 'Crédito aceito registrado')
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível confirmar o tratamento. Recarregue a ficha.') }
    finally { running.current = false; setBusy(false) }
  }
  return <section className={styles.reconciliation} aria-label="Tratamento do valor recebido a mais">
    <h3>Valor recebido a mais</h3>
    {unsupported ? <p><strong>Nenhum Pix deve ser devolvido por esta ficha.</strong> A cobrança tem parcelas e já recebeu dinheiro; o Financeiro precisa tratar o caso manualmente.</p>
      : resolution && !editing ? <>
      <p><strong>{resolution.kind === 'refund_pix' ? 'Devolvido por Pix' : 'Crédito aceito'}: {money(resolution.amount)}</strong></p>
      <p>{resolution.reason} · {resolution.actor}</p>
      {resolution.kind === 'refund_pix' && <p>Saída registrada em {resolution.account} no dia {new Date(`${resolution.refund_date}T12:00:00`).toLocaleDateString('pt-BR')}.</p>}
    </> : <>
      <p>Entrou {money(flow.received_total || 0)}, mas os produtos conferidos somam {money(flow.current_gross_amount || 0)}.
        Trate a diferença de <strong>{money(excess)}</strong> antes de liberar novamente.</p>
      <fieldset disabled={disabled || busy || Boolean(pending.current) || confirm} className={styles.reconciliationFields}>
        <legend>O que foi combinado com o cliente?</legend>
        <label><input type="radio" name="resolution" checked={kind === 'refund_pix'} onChange={() => setKind('refund_pix')} /> Devolver por Pix</label>
        <label><input type="radio" name="resolution" checked={kind === 'credit'} onChange={() => setKind('credit')} /> Guardar como crédito para o próximo pedido</label>
        {kind === 'refund_pix' && <div className={styles.fields}>
          <label>Data da devolução<input type="date" value={refundDate} max={today()} onChange={event => setRefundDate(event.target.value)} /></label>
          <label>Conta de saída<select value={account} onChange={event => setAccount(event.target.value)}>
            {flow.refund_accounts?.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select></label>
        </div>}
        <label>Justificativa e acordo com o cliente<input value={reason} maxLength={500} onChange={event => setReason(event.target.value)} /></label>
      </fieldset>
      {!confirm && !pending.current && <button className={styles.primary} disabled={disabled || busy || invalid} onClick={() => setConfirm(true)}>Revisar tratamento</button>}
      {confirm && <div role="alertdialog" aria-label="Confirmar tratamento do valor recebido a mais">
        <p>Confirmar {kind === 'refund_pix' ? `a devolução por Pix de ${money(excess)}` : `o crédito de ${money(excess)}`}? Esse registro não apaga o pagamento original.</p>
        <button className={styles.primary} disabled={busy} onClick={() => void save()}>Sim, registrar</button>{' '}
        <button className={styles.secondary} disabled={busy} onClick={() => setConfirm(false)}>Voltar</button>
      </div>}
      {error && <div role="alert" className={styles.error}><p>{error}</p>
        {pending.current && <button className={styles.secondary} disabled={busy} onClick={() => void save()}>Repetir a mesma tentativa</button>}</div>}
      {busy && <p role="status">Registrando o tratamento…</p>}
    </>}
  </section>
}
