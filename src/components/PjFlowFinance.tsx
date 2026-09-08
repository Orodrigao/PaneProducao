'use client'

import { useEffect, useRef, useState } from 'react'
import type { PjFlow } from '@/lib/pjFlowPilot'
import { changePjFlowTerms, previewPjInstallments, validatePjDueDate, type PjFlowBill, type PjTermsInput } from '@/lib/pjFlowFinance'
import styles from './PjFlowPilot.module.css'

const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const date = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR')

export function PjFlowFinance({ flow, disabled, onLock, reload }: {
  flow: PjFlow; disabled: boolean; onLock: (locked: boolean) => void; reload: (message?: string) => Promise<void>
}) {
  const [editing, setEditing] = useState<{ action: 'due' | 'split'; bill: PjFlowBill } | null>(null)
  const [due, setDue] = useState(''), [count, setCount] = useState(2), [reason, setReason] = useState('')
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const pending = useRef<{ id: string; input: PjTermsInput } | null>(null)
  const running = useRef(false)
  useEffect(() => { onLock(Boolean(editing) || busy) }, [editing, busy, onLock])
  function open(action: 'due' | 'split', bill: PjFlowBill) {
    setEditing({ action, bill }); setDue(bill.due_date); setCount(2); setReason(''); setError(''); setConfirm(false)
  }
  let preview: ReturnType<typeof previewPjInstallments> = [], validation = ''
  if (editing) {
    try {
      if (editing.action === 'due') validatePjDueDate(editing.bill, due)
      else preview = previewPjInstallments(editing.bill.amount, flow.agreed_date || '', editing.bill.due_date, count)
    } catch (e) { validation = e instanceof Error ? e.message : 'Revise as condições.' }
    if (reason.trim().length < 3 || reason.trim().length > 500) validation ||= 'Informe uma justificativa de 3 a 500 caracteres.'
  }
  async function save() {
    if (running.current || !editing || (!pending.current && validation)) return
    running.current = true; setBusy(true); setError('')
    try {
      pending.current ||= { id: crypto.randomUUID(), input: { action: editing.action, billId: editing.bill.id,
        dueDate: editing.action === 'due' ? due : null, installments: editing.action === 'split' ? count : null, reason: reason.trim() } }
      await changePjFlowTerms(flow, pending.current.id, pending.current.input)
      await reload(editing.action === 'due' ? 'Novo vencimento registrado.' : 'Parcelas registradas.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível confirmar o resultado. Recarregue a ficha.') }
    finally { running.current = false; setBusy(false) }
  }
  const frozen = disabled || busy || Boolean(pending.current) || confirm
  if (!flow.bills?.length) return null
  return <section className={styles.finance} aria-label="Condições da cobrança">
    <h3>Vencimentos e parcelas</h3>
    <p>Alterar as condições mantém a situação atual da saída. Quantidades pendentes continuam exigindo nova liberação.</p>
    <ul className={styles.billList}>{flow.bills.map(bill => <li key={bill.id}>
      <strong>{bill.count > 1 ? `Parcela ${bill.number}/${bill.count}` : 'Cobrança inteira'} · {money(bill.amount)}</strong>
      <p>Vencimento: {date(bill.due_date)} · Recebido: {money(bill.received)}</p>
      {flow.can_correct_due && ['aberta', 'parcial'].includes(bill.status) && <button className={styles.secondary}
        disabled={disabled || Boolean(editing)} onClick={() => open('due', bill)}>Corrigir vencimento{bill.count > 1 ? ` da parcela ${bill.number}` : ''}</button>}
      {' '}{flow.can_split && flow.released_at && bill.count === 1 && bill.status === 'aberta' && bill.received === 0 &&
        <button className={styles.secondary} disabled={disabled || Boolean(editing)} onClick={() => open('split', bill)}>Dividir em parcelas</button>}
    </li>)}</ul>
    {editing && <div className={styles.termsForm}>
      <h4>{editing.action === 'due' ? `Corrigir vencimento${editing.bill.count > 1 ? ` da parcela ${editing.bill.number}` : ''}` : 'Dividir em parcelas'}</h4>
      <fieldset disabled={frozen} className={styles.fields}>
        {editing.action === 'due' ? <label>Novo vencimento<input type="date" value={due} min={editing.bill.original_due_date} onChange={e => setDue(e.target.value)} /></label>
          : <label>Quantidade de parcelas<select value={count} onChange={e => setCount(Number(e.target.value))}>
            {Array.from({ length: 11 }, (_, i) => <option key={i + 2} value={i + 2}>{i + 2} parcelas</option>)}
          </select></label>}
        <label>Justificativa do acordo<input value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></label>
      </fieldset>
      {editing.action === 'due' && <p>Vencimento atual: {date(editing.bill.due_date)}. Valor preservado: {money(editing.bill.amount)}.</p>}
      {preview.length > 0 && <ol>{preview.map(row => <li key={row.number}>{money(row.amount)} · {date(row.due_date)}</li>)}</ol>}
      {validation && <p>{validation}</p>}
      {!confirm && !pending.current && <button className={styles.primary} disabled={busy || disabled || Boolean(validation)} onClick={() => setConfirm(true)}>Revisar alteração</button>}
      {confirm && <div role="alertdialog" aria-label="Confirmar condições financeiras">
        <p>Confirmar as condições acima e registrar a justificativa?</p>
        {!pending.current && <><button className={styles.primary} disabled={busy || disabled} onClick={() => void save()}>Confirmar alteração financeira</button>{' '}
          <button className={styles.secondary} disabled={busy} onClick={() => setConfirm(false)}>Voltar à edição</button></>}
      </div>}
      {error && <div role="alert" className={styles.error}><p>{error}</p>
        {pending.current && <button className={styles.secondary} disabled={busy} onClick={() => void save()}>Repetir alteração financeira</button>}
      </div>}
      {pending.current ? <button className={styles.secondary} disabled={busy} onClick={() => {
        if (window.confirm('A alteração pode já ter sido registrada. Recarregar para conferir o resultado?')) void reload()
      }}>Recarregar condições</button> : <button className={styles.secondary} disabled={busy} onClick={() => {
        if (!reason && due === editing.bill.due_date && count === 2 || window.confirm('Descartar a edição das condições?')) setEditing(null)
      }}>Cancelar edição</button>}
      {busy && <p role="status">Registrando condições…</p>}
    </div>}
    {Boolean(flow.financial_history?.length) && <details className={styles.history}><summary>Acordos financeiros registrados</summary>
      <ul>{flow.financial_history?.map((event, i) => <li key={i}>
        <strong>{event.action === 'due' ? 'Vencimento alterado' : 'Cobrança parcelada'}</strong> · {event.actor} · {new Date(event.at).toLocaleString('pt-BR')}
        <p>{event.reason}</p><p>Antes: {event.before.map(b => `${money(b.amount)} em ${date(b.due_date)}`).join('; ')}.</p>
        <p>Depois: {event.after.map(b => `${money(b.amount)} em ${date(b.due_date)}`).join('; ')}.</p>
      </li>)}</ul>
    </details>}
  </section>
}
