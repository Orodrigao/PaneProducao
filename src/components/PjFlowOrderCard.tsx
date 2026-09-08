'use client'

import { useEffect, useRef, useState } from 'react'
import { pjLineValue } from '@/lib/pjOrderValue'
import { parsePjFlowQuantity, pjFlowStatus, transitionPjFlowPilot,
  type PjFlow, type PjFlowAction, type PjFlowInput } from '@/lib/pjFlowPilot'
import styles from './PjFlowPilot.module.css'

const actionNames = { save: 'Conferência salva / corrigida', check: 'Conferência concluída',
  release: 'NF confirmada, cobrança revisada e saída liberada', depart: 'Saída física registrada' }
const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const date = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')

export function PjFlowOrderCard({ flow, reload, onLock }: { flow: PjFlow; reload: (message?: string) => Promise<void>; onLock: (locked: boolean) => void }) {
  const [quantities, setQuantities] = useState<Record<string, string>>(() => Object.fromEntries(
    flow.items.map(item => [item.id, item.quantity === null ? '' : String(item.quantity).replace('.', ',')]),
  ))
  const [reasons, setReasons] = useState<Record<string, string>>(() => Object.fromEntries(flow.items.map(item => [item.id, item.reason || ''])))
  const [nf, setNf] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<PjFlowAction | null>(null)
  const pending = useRef<{ action: PjFlowAction; requestId: string; items: PjFlowInput[]; nf: boolean } | null>(null)
  const running = useRef(false)
  const total = flow.items.every(item => typeof item.price === 'number' && item.quantity !== null)
    ? flow.items.reduce((sum, item) => sum + Math.round(pjLineValue({ quantity: item.ordered,
      dispatchedQuantity: item.quantity, unitPrice: item.price, dispatchedAt: null })! * 100), 0) / 100 : null
  const dirty = flow.items.some(item => quantities[item.id] !== (item.quantity === null ? '' : String(item.quantity).replace('.', ','))
    || reasons[item.id] !== (item.reason || ''))
  const locked = dirty || busy || Boolean(confirm) || Boolean(pending.current)
  useEffect(() => { onLock(locked) }, [locked, onLock])
  const step = flow.departed_at ? 3 : flow.released_at ? 2 : flow.checked_at ? 1 : 0
  const releaseBlocked = !flow.checked_at ? 'A Expedição JC precisa concluir a conferência antes da revisão.'
    : total === null ? 'Há quantidade ou preço pendente. A cobrança ainda não pode ser confirmada.'
      : total <= 0 ? 'Nenhum item para sair. O pedido continua pendente; não será cancelado automaticamente.'
        : flow.payment_term_days == null ? 'Defina o prazo do cliente antes de confirmar a cobrança.' : ''
  async function discard() {
    if (window.confirm('Recarregar a ficha e descartar as alterações locais? Uma tentativa sem resposta pode já ter sido registrada.')) await reload()
  }
  async function run(action: PjFlowAction) {
    if (running.current) return
    if ((action === 'check' || action === 'depart') && dirty) {
      setError('Salve a correção antes de confirmar esta ação.'); setConfirm(null); return
    }
    running.current = true; setBusy(true); setError('')
    try {
      // Após resposta perdida, repetir usa exatamente o mesmo conteúdo e ID.
      // Recarregar é o caminho explícito para descartar a tentativa local.
      if (!pending.current) pending.current = {
        action, requestId: crypto.randomUUID(), nf,
        items: action === 'save' ? flow.items.map(item => ({ id: item.id,
          quantity: parsePjFlowQuantity(quantities[item.id]), reason: reasons[item.id] || null })) : [],
      }
      const request = pending.current
      await transitionPjFlowPilot(flow, request.action, request.requestId, request.items, request.nf)
      pending.current = null
      await reload(actionNames[request.action])
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha na operação. Recarregue para conferir o estado.') }
    finally { running.current = false; setBusy(false); setConfirm(null) }
  }
  const frozen = busy || Boolean(pending.current) || Boolean(flow.departed_at) || Boolean(confirm)
  return <section className={styles.detail} aria-label={`Ficha de ${flow.customer}`}>
    <header className={styles.detailHeader}><span className={styles.eyebrow}>Ficha do pedido</span>
      <h2>{flow.customer}</h2><p>Entrega/coleta combinada: <strong>{date(flow.delivery_date)}</strong></p>
    </header>
    <ol className={styles.steps} aria-label="Etapas do pedido">{['Conferência', 'Revisão e NF', 'Saída'].map((label, i) =>
      <li key={label} className={i < step ? styles.done : i === step ? styles.current : ''} aria-current={i === step ? 'step' : undefined}>
        <span>{i < step ? '✓' : i + 1}</span>{label}</li>)}</ol>
    <div className={styles.next}><span className={styles.eyebrow}>{flow.departed_at ? 'Concluído' : 'Próxima etapa'}</span>
      <p><strong>{pjFlowStatus(flow)}</strong></p>
      {!flow.checked_at && <p>Salvar guarda as quantidades. Concluir a conferência envia o pedido para revisão.</p>}
      {flow.checked_at && !flow.released_at && <p>A saída aguarda a revisão da cobrança e a confirmação da NF.</p>}
    </div>
    <div className={styles.body}><h3>Quantidades</h3>
    {flow.items.map(item => <fieldset className={styles.item} key={item.id} disabled={frozen || !flow.can_check}>
      <legend>{item.name} <span>Pedido: {item.ordered.toLocaleString('pt-BR')} {item.unit}</span></legend>
      <div className={styles.fields}>
      <label>Quantidade conferida ({item.unit}) <input inputMode="decimal" value={quantities[item.id]}
        onChange={event => setQuantities({ ...quantities, [item.id]: event.target.value })} /></label>
      <label> Motivo da diferença <input value={reasons[item.id]}
        onChange={event => setReasons({ ...reasons, [item.id]: event.target.value })} /></label>
      </div>
      {item.price !== undefined && <p>Preço por {item.unit}: {item.price === null ? 'não definido' : money(item.price)}</p>}
    </fieldset>)}
    {flow.can_release && <div className={styles.finance}><h3>Revisão financeira</h3>
    {flow.payment_term_days !== undefined && <p>Prazo: {flow.payment_term_days ?? 'não definido'} dias a partir da entrega/coleta combinada.</p>}
    {total !== null && <p className={styles.amount}><strong>Valor conferido: {money(total)}</strong></p>}
    {flow.approved_amount != null && <p>Última cobrança: {money(flow.approved_amount)}{flow.due_date ? ` · vencimento ${date(flow.due_date)}` : ''}.
      {!flow.released_at && ' Aguarda nova revisão; esse valor ainda não libera a saída.'}</p>}
    <a href="/contas-receber" onClick={event => { if (locked) event.preventDefault() }} aria-disabled={locked}>Abrir contas a receber</a>
    </div>}
    {flow.can_check && !flow.departed_at && <div className={styles.actions}>
      <button className={styles.secondary} disabled={frozen} onClick={() => void run('save')}>Salvar conferência / correção</button>
      {!flow.released_at && <button className={styles.primary} disabled={frozen || dirty || Boolean(flow.checked_at)} onClick={() => setConfirm('check')}>Concluir conferência</button>}
      {flow.released_at && <button className={styles.primary} disabled={frozen || dirty} onClick={() => setConfirm('depart')}>Registrar saída física</button>}
      {dirty && <p>Salve as quantidades alteradas antes de concluir a conferência ou registrar a saída.</p>}
      {flow.released_at && <p>Salvar uma correção bloqueará novamente a saída e exigirá nova liberação de Elis ou Rodrigo.</p>}
    </div>}
    {flow.can_release && !flow.departed_at && !flow.released_at && <div className={styles.release}>
      {releaseBlocked && <p className={styles.warning}>{releaseBlocked}</p>}
      <label className={styles.checkbox}><input type="checkbox" checked={nf} disabled={frozen || Boolean(releaseBlocked)} onChange={event => setNf(event.target.checked)} />
        Confirmei os valores e emiti a NF no sistema externo; ela está disponível para acompanhar o pedido.</label>
      <button className={styles.primary} disabled={frozen || !nf || Boolean(releaseBlocked)} onClick={() => setConfirm('release')}>Confirmar cobrança e liberar entrega/coleta</button>
    </div>}
    {confirm && <div className={styles.confirm} role="alertdialog" aria-label="Confirmar ação no pedido">
      <p>Confirmar: {actionNames[confirm]}?</p>
      <button className={styles.primary} disabled={busy} onClick={() => void run(confirm)}>Sim, confirmar</button>{' '}
      <button className={styles.secondary} disabled={busy} onClick={() => setConfirm(null)}>Voltar</button>
    </div>}
    {error && <div className={styles.error} role="alert"><p>{error}</p>
      {pending.current && <button className={styles.secondary} disabled={busy} onClick={() => void run(pending.current!.action)}>Repetir a mesma tentativa</button>}
    </div>}
    {(dirty || Boolean(pending.current)) && <button className={styles.secondary} disabled={busy || Boolean(confirm)} onClick={() => void discard()}>Recarregar ficha e descartar alterações</button>}
    {busy && <p role="status">Salvando e conferindo o resultado…</p>}
    <details className={styles.history}><summary>Histórico registrado <span>{flow.history.length}</span></summary>
    {!flow.history.length && <p>Nenhuma etapa registrada ainda.</p>}
    <ul>{flow.history.map((event, i) => <li key={i}>{actionNames[event.action]} · {event.actor} · {new Date(event.at).toLocaleString('pt-BR')}</li>)}</ul>
    </details></div>
  </section>
}
