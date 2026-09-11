'use client'

import { useEffect, useRef, useState } from 'react'
import { getCurrentUser } from '@/lib/auth'
import { pjLineValue } from '@/lib/pjOrderValue'
import { resolvePjOrderAccess } from '@/lib/pjOrderDispatch'
import { parsePjFlowQuantity, pjFlowStatus, readPjFlowActivationStatus,
  rollbackPjFlowEnrollment, transitionPjFlowPilot,
  type PjFlow, type PjFlowAction, type PjFlowInput } from '@/lib/pjFlowPilot'
import styles from './PjFlowPilot.module.css'
import { PjFlowFinance } from './PjFlowFinance'
import { PjFlowReconciliation } from './PjFlowReconciliation'

const actionNames = { save: 'Conferência salva / corrigida', check: 'Conferência concluída',
  release: 'NF confirmada, cobrança revisada e saída liberada', depart: 'Saída física registrada' }
const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const date = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')

export function PjFlowOrderCard({ flow, reload, onLock }: { flow: PjFlow; reload: (message?: string) => Promise<void>; onLock: (locked: boolean) => void }) {
  const canManageOrder = resolvePjOrderAccess(getCurrentUser()).canManage
  const [quantities, setQuantities] = useState<Record<string, string>>(() => Object.fromEntries(
    flow.items.map(item => [item.id, item.quantity === null ? '' : String(item.quantity).replace('.', ',')]),
  ))
  const [reasons, setReasons] = useState<Record<string, string>>(() => Object.fromEntries(flow.items.map(item => [item.id, item.reason || ''])))
  const [nf, setNf] = useState(false)
  const [busy, setBusy] = useState(false)
  const [termsLocked, setTermsLocked] = useState(false)
  const [reconciliationLocked, setReconciliationLocked] = useState(false)
  const [creditSource, setCreditSource] = useState('')
  const [creditAmount, setCreditAmount] = useState('')
  const [creditReason, setCreditReason] = useState('')
  const [error, setError] = useState('')
  const [canReturn, setCanReturn] = useState(false)
  const [activationMode, setActivationMode] = useState<'test' | 'controlled_real' | 'standard' | null>(null)
  const [confirm, setConfirm] = useState<PjFlowAction | null>(null)
  const pending = useRef<{ action: PjFlowAction; requestId: string; items: PjFlowInput[]; nf: boolean
    credit: { amount: number; sourceGroupId: string | null; reason: string } } | null>(null)
  const running = useRef(false)
  const rollbackPending = useRef<{ requestId: string; reason: string } | null>(null)
  useEffect(() => {
    let alive = true
    void readPjFlowActivationStatus(flow.id).then(status => {
      if (!alive) return
      setCanReturn(status.can_return); setActivationMode(status.mode)
    }).catch(() => { if (alive) setCanReturn(false) })
    return () => { alive = false }
  }, [flow.id])
  const total = flow.items.every(item => typeof item.price === 'number' && item.quantity !== null)
    ? flow.items.reduce((sum, item) => sum + Math.round(pjLineValue({ quantity: item.ordered,
      dispatchedQuantity: item.quantity, unitPrice: item.price, dispatchedAt: null })! * 100), 0) / 100 : null
  const dirty = flow.items.some(item => quantities[item.id] !== (item.quantity === null ? '' : String(item.quantity).replace('.', ','))
    || reasons[item.id] !== (item.reason || ''))
  const normalizedCredit = creditAmount.trim().replace(',', '.')
  const credit = normalizedCredit && /^\d+(\.\d{1,2})?$/.test(normalizedCredit) ? Number(normalizedCredit) : 0
  const creditDirty = Boolean(creditSource || creditAmount || creditReason)
  const creditPreview = Boolean(creditSource && credit > 0 && (total === null || credit <= total))
  const creditError = creditDirty && (!creditSource ? 'Escolha o pedido que originou o crédito.'
    : !normalizedCredit || !/^\d+(\.\d{1,2})?$/.test(normalizedCredit) || credit <= 0 ? 'Informe um crédito válido, com até duas casas decimais.'
      : total !== null && credit > total ? 'O crédito não pode ser maior que o valor dos produtos.'
        : creditReason.trim().length < 3 ? 'Informe a justificativa do crédito.' : '')
  const operationalLocked = dirty || busy || Boolean(confirm) || Boolean(pending.current)
  const locked = operationalLocked || termsLocked || reconciliationLocked || creditDirty
  useEffect(() => { onLock(locked) }, [locked, onLock])
  const step = flow.departed_at ? 3 : flow.released_at ? 2 : flow.checked_at ? 1 : 0
  const releaseBlocked = !flow.checked_at ? 'A Expedição JC precisa concluir a conferência antes da revisão.'
    : total === null ? 'Há quantidade ou preço pendente. A cobrança ainda não pode ser confirmada.'
      : total <= 0 ? 'Nenhum item para sair. O pedido continua pendente; não será cancelado automaticamente.'
        : (flow.pending_excess || 0) > 0 && flow.excess_resolution_supported === false
          ? 'Este pedido foi parcelado e já recebeu dinheiro. Não faça a devolução por esta ficha; o Financeiro precisa tratar o caso manualmente.'
          : (flow.pending_excess || 0) > 0 ? 'Trate o valor recebido a mais antes de liberar novamente.'
          : flow.payment_term_days == null ? 'Defina o prazo do cliente antes de confirmar a cobrança.' : creditError
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
        credit: action === 'release' && creditDirty
          ? { amount: credit, sourceGroupId: creditSource, reason: creditReason.trim() }
          : { amount: 0, sourceGroupId: null, reason: '' },
      }
      const request = pending.current
      await transitionPjFlowPilot(flow, request.action, request.requestId, request.items, request.nf, request.credit)
      pending.current = null
      await reload(actionNames[request.action])
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha na operação. Recarregue para conferir o estado.') }
    finally { running.current = false; setBusy(false); setConfirm(null) }
  }
  async function returnToLegacy() {
    if (!rollbackPending.current) {
      const reason = window.prompt('Por que este pedido deve voltar à rotina anterior?')?.trim() || ''
      if (reason.length < 3) { if (reason) setError('Informe um motivo com pelo menos três caracteres.'); return }
      if (!window.confirm('Confirmar o retorno? O pedido deixará a nova jornada e reaparecerá na rotina anterior.')) return
      rollbackPending.current = { requestId: crypto.randomUUID(), reason }
    }
    const request = rollbackPending.current
    setBusy(true); setError('')
    try {
      await rollbackPjFlowEnrollment(flow.id, request.requestId, request.reason)
      rollbackPending.current = null
      window.location.assign(`/pedidos-pj?legado=1&pedido=${encodeURIComponent(flow.id)}`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível devolver o pedido.') }
    finally { setBusy(false) }
  }
  const frozen = termsLocked || reconciliationLocked || busy || Boolean(pending.current) || Boolean(flow.departed_at) || Boolean(confirm)
  const canManageBeforeConference = canManageOrder && activationMode === 'standard'
    && flow.version === 0 && !flow.checked_at && !flow.released_at && !flow.departed_at
  const manageUrl = `/pedidos-pj?legado=1&gerenciar=1&pedido=${encodeURIComponent(flow.id)}`
  return <section className={styles.detail} aria-label={`Ficha de ${flow.customer}`}>
    <header className={styles.detailHeader}><span className={styles.eyebrow}>Ficha do pedido</span>
      <h2>{flow.customer}</h2><p>Entrega/coleta combinada: <strong>{date(flow.delivery_date)}</strong></p>
      {activationMode === 'controlled_real' && <p>Primeira operação real em acompanhamento.</p>}
    </header>
    <ol className={styles.steps} aria-label="Etapas do pedido">{['Conferência', 'Revisão e NF', 'Saída'].map((label, i) =>
      <li key={label} className={i < step ? styles.done : i === step ? styles.current : ''} aria-current={i === step ? 'step' : undefined}>
        <span>{i < step ? '✓' : i + 1}</span>{label}</li>)}</ol>
    <div className={styles.next}><span className={styles.eyebrow}>{flow.departed_at ? 'Concluído' : 'Próxima etapa'}</span>
      <p><strong>{pjFlowStatus(flow)}</strong></p>
      {!flow.checked_at && <p>Salvar guarda as quantidades. Concluir a conferência envia o pedido para revisão.</p>}
      {flow.checked_at && !flow.released_at && <p>A saída aguarda a revisão da cobrança e a confirmação da NF.</p>}
    </div>
    {canManageBeforeConference && <div className={styles.actions} aria-label="Gerenciar pedido antes da conferência">
      <a className={styles.secondary} href={manageUrl} onClick={event => { if (locked) event.preventDefault() }} aria-disabled={locked}>
        Editar pedido
      </a>
      <a className={styles.secondary} href={manageUrl} onClick={event => { if (locked) event.preventDefault() }} aria-disabled={locked}>
        Cancelar pedido
      </a>
    </div>}
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
    {total !== null && <><p>Produtos conferidos: <strong>{money(total)}</strong></p>
      {creditPreview && <p>Crédito anterior: <strong>− {money(credit)}</strong></p>}
      <p className={styles.amount}><strong>Total a receber: {money(Math.max(total - (creditPreview ? credit : 0), 0))}</strong></p></>}
    {flow.approved_amount != null && <p>Última revisão: produtos {money(flow.approved_amount)}, crédito {money(flow.credit_applied_amount || 0)},
      total a receber {money(flow.net_amount ?? flow.approved_amount)}{flow.due_date ? ` · vencimento ${date(flow.due_date)}` : ''}.
      {!flow.released_at && ' Aguarda nova revisão; esse valor ainda não libera a saída.'}</p>}
    <a href="/contas-receber" onClick={event => { if (locked) event.preventDefault() }} aria-disabled={locked}>Abrir contas a receber</a>
    </div>}
    {flow.can_release && <PjFlowReconciliation flow={flow} disabled={operationalLocked || termsLocked} onLock={setReconciliationLocked} reload={reload} />}
    <PjFlowFinance flow={flow} disabled={operationalLocked || reconciliationLocked} onLock={setTermsLocked} reload={reload} />
    {flow.can_check && !flow.departed_at && <div className={styles.actions}>
      <button className={styles.secondary} disabled={frozen} onClick={() => void run('save')}>Salvar conferência / correção</button>
      {!flow.released_at && <button className={styles.primary} disabled={frozen || dirty || Boolean(flow.checked_at)} onClick={() => setConfirm('check')}>Concluir conferência</button>}
      {flow.released_at && <button className={styles.primary} disabled={frozen || dirty} onClick={() => setConfirm('depart')}>Registrar saída física</button>}
      {dirty && <p>Salve as quantidades alteradas antes de concluir a conferência ou registrar a saída.</p>}
      {flow.released_at && <p>Salvar uma correção bloqueará novamente a saída e exigirá nova liberação de Elis ou Rodrigo.</p>}
    </div>}
    {flow.can_release && !flow.departed_at && !flow.released_at && <div className={styles.release}>
      {releaseBlocked && <p className={styles.warning}>{releaseBlocked}</p>}
      {flow.checked_at && (flow.received_total || 0) === 0 && Boolean(flow.credit_sources?.length) && <fieldset className={styles.creditFields} disabled={frozen}>
        <legend>Crédito de pedido anterior (opcional)</legend>
        <label>Pedido de origem<select value={creditSource} onChange={event => {
          const source = flow.credit_sources?.find(item => item.id === event.target.value)
          setCreditSource(event.target.value); setCreditAmount(source ? String(Math.min(source.amount, total || 0)).replace('.', ',') : '')
          if (!source) setCreditReason('')
        }}><option value="">Não usar crédito</option>{flow.credit_sources?.map(source => <option key={source.id} value={source.id}>
          Entrega {date(source.delivery_date)} · até {money(source.amount)}</option>)}</select></label>
        {creditSource && <><label>Valor do crédito<input inputMode="decimal" value={creditAmount} onChange={event => setCreditAmount(event.target.value)} /></label>
          <label>Justificativa<input value={creditReason} maxLength={500} onChange={event => setCreditReason(event.target.value)} /></label></>}
        {creditError && <p className={styles.warning}>{creditError}</p>}
      </fieldset>}
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
      {rollbackPending.current && <button className={styles.secondary} disabled={busy} onClick={() => void returnToLegacy()}>
        Repetir o mesmo retorno
      </button>}
    </div>}
    {(dirty || Boolean(pending.current)) && <button className={styles.secondary} disabled={busy || Boolean(confirm)} onClick={() => void discard()}>Recarregar ficha e descartar alterações</button>}
    {canReturn && !rollbackPending.current && <button className={styles.secondary} disabled={busy || locked} onClick={() => void returnToLegacy()}>
      Voltar este pedido à rotina anterior
    </button>}
    {busy && <p role="status">Salvando e conferindo o resultado…</p>}
    <details className={styles.history}><summary>Histórico registrado <span>{flow.history.length}</span></summary>
    {!flow.history.length && <p>Nenhuma etapa registrada ainda.</p>}
    <ul>{flow.history.map((event, i) => <li key={i}>{actionNames[event.action]} · {event.actor} · {new Date(event.at).toLocaleString('pt-BR')}</li>)}</ul>
    </details></div>
  </section>
}
