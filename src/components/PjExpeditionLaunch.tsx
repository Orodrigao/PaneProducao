'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getCurrentUser } from '@/lib/auth'
import { readPjFlowPilot, type PjFlow } from '@/lib/pjFlowPilot'
import { resolvePjOrderAccess } from '@/lib/pjOrderDispatch'
import {
  buildPjLaunchRequest,
  clearPjLaunchPending,
  createPjOrderByExpedition,
  describePjLaunchQuantity,
  hasSimilarPjOrder,
  loadPjLaunchCatalog,
  newPjLaunchAttempt,
  parsePjLaunchQuantity,
  PJ_LAUNCH_PENDING_PREFIX,
  pjLaunchItemKey,
  pjLaunchItemLabel,
  pjLaunchLineProblem,
  pjLaunchQuantityHint,
  pjLaunchQuantityLabel,
  PjLaunchRefusedError,
  readPjLaunchPendings,
  savePjLaunchPending,
  type PjLaunchCatalog,
  type PjLaunchItem,
  type PjLaunchPending,
  type PjLaunchRequest,
} from '@/lib/pjExpeditionLaunch'
import {
  newPjChangeAttempt,
  readPjExpeditionOrder,
  replacePjOrderByExpedition,
  restorePjExpeditionLines,
  type PjChangeAttempt,
  type PjExpeditionOrder,
} from '@/lib/pjExpeditionOrderChange'
import styles from './PjExpeditionLaunch.module.css'

interface DraftLine { key: string; item: PjLaunchItem; raw: string }
interface Launched { orderGroupId: string; customerName: string; deliveryDate: string; corrected?: boolean }
interface Editing { orderGroupId: string; order: PjExpeditionOrder }

const fullDate = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')
const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR')
const requestLineKey = (line: PjLaunchRequest['lines'][number]) =>
  `${line.product_source}|${line.product_id}|${line.sale_option_id ?? ''}`

const fichaUrl = (orderGroupId: string) => `/pedidos-pj?piloto=1&pedido=${encodeURIComponent(orderGroupId)}`

// Toda tentativa sem resposta do banco vira um cartão próprio, guardado no
// aparelho, separado do formulário: repetir a mesma tentativa nunca grava dois
// pedidos, e uma aba nunca esconde a tentativa da outra.
//
// Com `editOrderGroupId`, o mesmo formulário corrige o pedido que a Expedição
// lançou, até a conferência começar. O cliente fica fixo. A correção sem
// resposta repete a mesma tentativa enquanto o conteúdo não muda; conteúdo
// novo vai com a versão lida, que o banco recusa se a correção anterior já
// tiver sido gravada.
export function PjExpeditionLaunch({ editOrderGroupId = null }: { editOrderGroupId?: string | null }) {
  const [user] = useState(() => getCurrentUser())
  const canLaunch = resolvePjOrderAccess(user).canLaunch
  const [catalog, setCatalog] = useState<PjLaunchCatalog | null>(null)
  const [flows, setFlows] = useState<PjFlow[]>([])
  const [loadError, setLoadError] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [deliveryDate, setDeliveryDate] = useState('')
  const [search, setSearch] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [obs, setObs] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [pendings, setPendings] = useState<PjLaunchPending[]>([])
  const [launched, setLaunched] = useState<Launched | null>(null)
  // Sucesso de um cartão não tira da tela o pedido que está sendo preenchido.
  const [notice, setNotice] = useState<Launched | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [editBlocked, setEditBlocked] = useState('')
  const [editWarnings, setEditWarnings] = useState<string[]>([])
  const correctionAttempt = useRef<{ attempt: PjChangeAttempt; request: string } | null>(null)
  const editMode = editOrderGroupId !== null

  const refreshFlows = useCallback(() => {
    readPjFlowPilot().then(setFlows).catch(() => { /* sem aviso de pedido parecido */ })
  }, [])

  const syncPendings = useCallback(() => {
    if (user) setPendings(readPjLaunchPendings(user.id))
  }, [user])

  useEffect(() => {
    if (!user || !canLaunch) return
    let alive = true
    if (editOrderGroupId !== null) {
      Promise.all([loadPjLaunchCatalog(), readPjExpeditionOrder(editOrderGroupId)])
        .then(([result, state]) => {
          if (!alive) return
          setCatalog(result)
          if (!state.canChange || !state.order) {
            setEditBlocked(state.changeBlockedReason ?? 'Este pedido não pode ser corrigido por aqui.')
            return
          }
          const restored = restorePjExpeditionLines(state.order, result)
          setEditing({ orderGroupId: editOrderGroupId, order: state.order })
          setCustomerId(state.order.customerId)
          setDeliveryDate(state.order.deliveryDate.slice(0, 10))
          setObs(state.order.obs)
          setLines(restored.lines.map(line => ({ key: pjLaunchItemKey(line.item), item: line.item, raw: line.raw })))
          setEditWarnings(restored.warnings)
        })
        .catch(e => { if (alive) setLoadError(e instanceof Error ? e.message : 'Não foi possível carregar o pedido.') })
      return () => { alive = false }
    }
    syncPendings()
    loadPjLaunchCatalog()
      .then(result => { if (alive) setCatalog(result) })
      .catch(e => { if (alive) setLoadError(e instanceof Error ? e.message : 'Não foi possível carregar clientes e produtos.') })
    refreshFlows()
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith(PJ_LAUNCH_PENDING_PREFIX)) syncPendings()
    }
    window.addEventListener('storage', onStorage)
    return () => { alive = false; window.removeEventListener('storage', onStorage) }
  }, [user, canLaunch, refreshFlows, syncPendings, editOrderGroupId])

  const customer = catalog?.customers.find(row => row.id === customerId) ?? null
  const customerItems = useMemo(
    () => catalog?.items.filter(item => item.customerId === customerId) ?? [],
    [catalog, customerId],
  )
  const addedKeys = new Set(lines.map(line => line.key))
  const searchTerm = normalize(search.trim())
  const visibleItems = customerItems.filter(item => !addedKeys.has(pjLaunchItemKey(item))
    && (!searchTerm || normalize(pjLaunchItemLabel(item)).includes(searchTerm)))
  const parsedLines = lines.map(line => {
    const packs = parsePjLaunchQuantity(line.raw, line.item)
    return { ...line, packs, problem: pjLaunchLineProblem(line.item, packs) }
  })
  const similar = !editMode && customer && deliveryDate ? hasSimilarPjOrder(flows, customer.name, deliveryDate) : false
  const locked = saving || pendings.length > 0
  // Na correção, a entrega que já estava no passado pode ficar; a nova não.
  const originalDate = editing?.order.deliveryDate.slice(0, 10) ?? null
  const keptPastDate = originalDate !== null && deliveryDate === originalDate
  const minDate = catalog && originalDate && originalDate < catalog.today ? originalDate : catalog?.today

  const blockReason = pendings.length > 0 ? 'Resolva primeiro o lançamento sem confirmação.'
    : !customer ? 'Escolha o cliente.'
      : customer.blockedReason ? customer.blockedReason
        : !deliveryDate || (catalog && deliveryDate < catalog.today && !keptPastDate) ? 'Escolha a data de entrega, de hoje em diante.'
          : parsedLines.length === 0 ? 'Inclua ao menos um produto.'
            : parsedLines.some(line => line.problem) ? 'Corrija as quantidades marcadas.'
              : null

  function chooseCustomer(id: string) {
    setCustomerId(id)
    setLines([])
    setSearch('')
    setError('')
  }

  function addItem(item: PjLaunchItem) {
    setLines(current => [...current, { key: pjLaunchItemKey(item), item, raw: '' }])
    setSearch('')
  }

  function clearForm() {
    setCustomerId('')
    setDeliveryDate('')
    setLines([])
    setObs('')
    setSearch('')
    setReviewing(false)
  }

  function resetForm() {
    clearForm()
    setError('')
    setLaunched(null)
  }

  // Pedido recusado ou descartado volta ao formulário vazio, para corrigir
  // sem digitar tudo de novo. Formulário já preenchido não é sobrescrito.
  function restoreForm(request: PjLaunchRequest) {
    if (!catalog || customerId || lines.length > 0) return
    const restored = request.lines.flatMap(line => {
      const item = catalog.items.find(candidate => candidate.customerId === request.customerId
        && pjLaunchItemKey(candidate) === requestLineKey(line))
      return item ? [{ key: pjLaunchItemKey(item), item, raw: String(line.packs).replace('.', ',') }] : []
    })
    setCustomerId(request.customerId)
    setDeliveryDate(request.deliveryDate)
    setObs(request.obs)
    setLines(restored)
    setReviewing(false)
  }

  async function send(pending: PjLaunchPending, fromForm: boolean) {
    if (!user) return
    const requestId = pending.attempt.requestId
    setSaving(true)
    setError('')
    if (fromForm) setNotice(null)
    // Sem a tentativa guardada no aparelho, uma resposta perdida não teria
    // como ser repetida: o pedido novo nem sai. O cartão já veio do aparelho.
    if (!savePjLaunchPending(user.id, pending) && fromForm) {
      setError('Este aparelho não conseguiu guardar o pedido antes do envio (memória cheia ou navegação privada). Libere espaço ou use outro navegador e confirme de novo.')
      setSaving(false)
      return
    }
    const forget = () => {
      clearPjLaunchPending(user.id, requestId)
      setPendings(current => current.filter(row => row.attempt.requestId !== requestId))
    }
    try {
      const result = await createPjOrderByExpedition(pending.attempt, pending.request)
      forget()
      const done = {
        orderGroupId: result.orderGroupId,
        customerName: pending.customerName,
        deliveryDate: pending.request.deliveryDate,
      }
      if (fromForm) {
        setReviewing(false)
        setLaunched(done)
      } else {
        setNotice(done)
      }
      refreshFlows()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Não foi possível lançar o pedido.'
      if (e instanceof PjLaunchRefusedError && e.notSaved) {
        forget()
        if (!fromForm) restoreForm(pending.request)
        setError(fromForm ? message : `Pedido de ${pending.customerName} recusado: ${message}`)
      } else {
        syncPendings()
        if (fromForm) clearForm()
        setError(message)
      }
    } finally {
      setSaving(false)
    }
  }

  async function sendCorrection(target: Editing, request: PjLaunchRequest, customerName: string) {
    const serialized = JSON.stringify(request)
    // Mesmo conteúdo depois de uma resposta perdida: mesma tentativa.
    if (correctionAttempt.current?.request !== serialized) {
      correctionAttempt.current = { attempt: newPjChangeAttempt(), request: serialized }
    }
    const { attempt } = correctionAttempt.current
    setSaving(true)
    setError('')
    try {
      await replacePjOrderByExpedition(attempt, target.orderGroupId, request, target.order.expectedRows)
      correctionAttempt.current = null
      setReviewing(false)
      setLaunched({ orderGroupId: target.orderGroupId, customerName, deliveryDate: request.deliveryDate, corrected: true })
    } catch (e) {
      if (e instanceof PjLaunchRefusedError && e.notSaved) correctionAttempt.current = null
      setError(e instanceof Error ? e.message : 'Não foi possível corrigir o pedido.')
    } finally {
      setSaving(false)
    }
  }

  function confirm() {
    if (!customer || blockReason) return
    const request = buildPjLaunchRequest(customer.id, deliveryDate,
      obs, parsedLines.map(line => ({ item: line.item, packs: line.packs ?? 0 })))
    if (editing) {
      void sendCorrection(editing, request, customer.name)
      return
    }
    void send({ attempt: newPjLaunchAttempt(), request, customerName: customer.name }, true)
  }

  function discard(pending: PjLaunchPending) {
    if (!user) return
    clearPjLaunchPending(user.id, pending.attempt.requestId)
    setPendings(current => current.filter(row => row.attempt.requestId !== pending.attempt.requestId))
    setError('')
    restoreForm(pending.request)
    refreshFlows()
  }

  if (!user || !canLaunch) {
    return <main className={`ps-canvas ${styles.canvas}`}><div className={styles.shell}>
      <a className={styles.back} href="/pedidos-pj">Voltar aos Pedidos PJ</a>
      <p className={styles.error} role="alert">Seu acesso não permite lançar Pedido PJ. Peça ao administrador.</p>
    </div></main>
  }

  return <main className={`ps-canvas ${styles.canvas}`}><div className={styles.shell}>
    <a className={styles.back} href={editOrderGroupId ? fichaUrl(editOrderGroupId) : '/pedidos-pj?piloto=1'}>
      {editMode ? 'Voltar ao pedido' : 'Voltar aos Pedidos PJ'}</a>
    <header className={styles.header}>
      <span className={styles.eyebrow}>Expedição JC</span>
      <h1>{editMode ? 'Corrigir pedido PJ' : 'Novo pedido PJ'}</h1>
      <p>{editMode
        ? 'Corrija a entrega, a observação e as quantidades enquanto a conferência não começou. O cliente não muda: para outro cliente, cancele e lance de novo.'
        : 'Escolha o cliente, a entrega e as quantidades. O preço vem da tabela do cliente e o Financeiro revisa a cobrança antes da saída.'}</p>
    </header>

    {error && !reviewing && <p className={styles.error} role="alert">{error}</p>}

    {editBlocked && <div className={styles.card}>
      <p className={styles.warning} role="alert">{editBlocked}</p>
      {editOrderGroupId && <div className={styles.actions}>
        <a className={styles.link} href={fichaUrl(editOrderGroupId)}>Voltar ao pedido</a>
      </div>}
    </div>}

    {launched?.corrected ? <div className={styles.success} role="status">
      <p><strong>Pedido de {launched.customerName} corrigido</strong>, entrega em {fullDate(launched.deliveryDate)}.</p>
      <p>A conferência e a revisão da cobrança seguem com a versão corrigida.</p>
      <div className={styles.actions}>
        <a className={styles.link} href={fichaUrl(launched.orderGroupId)}>Ver o pedido</a>
      </div>
    </div> : launched ? <div className={styles.success} role="status">
      <p><strong>Pedido lançado para {launched.customerName}</strong>, entrega em {fullDate(launched.deliveryDate)}.</p>
      <p>Ele já aparece na jornada, em Conferência, marcado como lançado por você.</p>
      <div className={styles.actions}>
        <a className={styles.link} href={fichaUrl(launched.orderGroupId)}>Ver o pedido</a>
        <button type="button" className={styles.secondary} onClick={resetForm}>Lançar outro pedido</button>
      </div>
    </div> : !editBlocked && <>
      {notice && <div className={styles.success} role="status">
        <p><strong>Pedido de {notice.customerName} lançado</strong>, entrega em {fullDate(notice.deliveryDate)}.</p>
        <div className={styles.actions}>
          <a className={styles.link} href={`/pedidos-pj?piloto=1&pedido=${encodeURIComponent(notice.orderGroupId)}`}>Ver o pedido</a>
          <button type="button" className={styles.secondary} onClick={() => setNotice(null)}>Fechar aviso</button>
        </div>
      </div>}
      {pendings.map(pending => <div key={pending.attempt.requestId} className={styles.card}>
        <h2>Lançamento sem confirmação</h2>
        <p className={styles.warning}>O pedido de {pending.customerName}, entrega em {fullDate(pending.request.deliveryDate)},
          foi enviado mas o sistema não confirmou se gravou. Envie de novo: o mesmo pedido não é gravado duas vezes.</p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={saving || !catalog}
            onClick={() => void send(pending, false)}>Enviar de novo</button>
          <button type="button" className={styles.secondary} disabled={saving} onClick={() => discard(pending)}>Descartar</button>
          <p>Ao descartar, o pedido volta ao formulário; confira na lista de pedidos se ele já está lá antes de lançar de novo.</p>
        </div>
      </div>)}

      {loadError && <p className={styles.error} role="alert">{loadError}</p>}
      {!catalog && !loadError && <p className={styles.empty} role="status">Carregando clientes e produtos…</p>}

      {editWarnings.length > 0 && !reviewing && <div className={styles.card}>
        {editWarnings.map(warning => <p key={warning} className={styles.warning}>{warning}</p>)}
      </div>}

      {catalog && !reviewing && (!editMode || editing) && <>
        <section className={styles.card} aria-labelledby="lancar-cliente">
          <h2 id="lancar-cliente">Cliente e entrega</h2>
          <label className={styles.field}>Cliente
            <select aria-label="Cliente" value={customerId} disabled={locked || editMode} onChange={event => chooseCustomer(event.target.value)}>
              <option value="">Escolha o cliente</option>
              {catalog.customers.map(row => <option key={row.id} value={row.id}>
                {row.blockedReason ? `${row.name} (indisponível)` : row.name}
              </option>)}
            </select>
          </label>
          {customer?.blockedReason && <p className={styles.warning}>{customer.blockedReason}</p>}
          <label className={styles.field}>Entrega ou coleta
            <input type="date" aria-label="Entrega ou coleta" min={minDate} value={deliveryDate} disabled={locked}
              onChange={event => setDeliveryDate(event.target.value)} />
          </label>
          {similar && customer && <p className={styles.warning}>Já existe pedido de {customer.name} com entrega em {fullDate(deliveryDate)}.
            Confira na lista antes de lançar outro.</p>}
        </section>

        {customer && !customer.blockedReason && <section className={styles.card} aria-labelledby="lancar-produtos">
          <h2 id="lancar-produtos">Produtos</h2>
          {parsedLines.length > 0 && <div className={styles.lines}>{parsedLines.map(line => <div key={line.key} className={styles.line}>
            <div className={styles.lineHead}>
              <strong>{pjLaunchItemLabel(line.item)}</strong>
              <button type="button" className={`${styles.secondary} ${styles.small}`} disabled={locked}
                onClick={() => setLines(current => current.filter(row => row.key !== line.key))}>Remover</button>
            </div>
            <label className={styles.quantity}>{pjLaunchQuantityLabel(line.item)}
              <input type="text" inputMode={line.item.packRuleSize === null && line.item.pricingUnit === 'kg' ? 'decimal' : 'numeric'}
                value={line.raw} disabled={locked} aria-label={`${pjLaunchQuantityLabel(line.item)} de ${pjLaunchItemLabel(line.item)}`}
                onChange={event => setLines(current => current.map(row => row.key === line.key ? { ...row, raw: event.target.value } : row))} />
              {line.packs !== null && !line.problem && <span className={styles.total}>= {describePjLaunchQuantity(line.item, line.packs)}</span>}
            </label>
            <small>{pjLaunchQuantityHint(line.item)}</small>
            {line.raw.trim() !== '' && line.problem && <p className={styles.problem}>{line.problem}</p>}
          </div>)}</div>}

          <label className={styles.field}>Procurar produto da tabela do cliente
            <input type="search" aria-label="Procurar produto da tabela do cliente" value={search} disabled={locked} placeholder="Digite parte do nome"
              onChange={event => setSearch(event.target.value)} />
          </label>
          {visibleItems.length === 0
            ? <p className={styles.empty}>{customerItems.length === 0 ? 'Este cliente não tem produtos na tabela.' : 'Nenhum outro produto encontrado.'}</p>
            : <div className={styles.products}>{visibleItems.map(item => <div key={pjLaunchItemKey(item)} className={styles.product}>
              <span>{pjLaunchItemLabel(item)}<small>{item.blockedReason ?? pjLaunchQuantityHint(item)}</small></span>
              <button type="button" className={`${styles.secondary} ${styles.small}`} disabled={locked || Boolean(item.blockedReason)}
                onClick={() => addItem(item)}>Adicionar</button>
            </div>)}</div>}
        </section>}

        {customer && !customer.blockedReason && <section className={styles.card}>
          <label className={styles.field}>Observação (opcional)
            <textarea value={obs} maxLength={500} disabled={locked} onChange={event => setObs(event.target.value)} />
          </label>
        </section>}

        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={Boolean(blockReason) || locked}
            onClick={() => { setError(''); setReviewing(true) }}>Revisar pedido</button>
          {blockReason && <p>{blockReason}</p>}
        </div>
      </>}

      {catalog && reviewing && customer && <section className={styles.card} aria-labelledby="lancar-revisao">
        <h2 id="lancar-revisao">{editMode ? 'Confira antes de corrigir' : 'Confira antes de lançar'}</h2>
        <p><strong>{customer.name}</strong> · entrega em {fullDate(deliveryDate)}</p>
        <ul className={styles.review}>{parsedLines.map(line => <li key={line.key}>
          {pjLaunchItemLabel(line.item)}: {line.packs !== null ? describePjLaunchQuantity(line.item, line.packs) : ''}
        </li>)}</ul>
        {obs.trim() && <p>Observação: {obs.trim()}</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={saving} onClick={confirm}>
            {editMode ? (saving ? 'Corrigindo…' : 'Confirmar correção') : (saving ? 'Lançando…' : 'Confirmar lançamento')}</button>
          <button type="button" className={styles.secondary} disabled={saving} onClick={() => setReviewing(false)}>Voltar e corrigir</button>
        </div>
      </section>}
    </>}
  </div></main>
}
