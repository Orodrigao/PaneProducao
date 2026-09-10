'use client'

import { useCallback, useEffect, useState } from 'react'
import { getCurrentUser } from '@/lib/auth'
import { readPjFlowPilot, type PjFlow } from '@/lib/pjFlowPilot'
import { resolvePjOrderAccess } from '@/lib/pjOrderDispatch'
import { PjFlowOrderCard } from './PjFlowOrderCard'
import styles from './PjFlowPilot.module.css'

const shortDate = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
const stage = (flow: PjFlow) => flow.departed_at ? 'Saiu' : flow.released_at ? 'Saída liberada' : flow.checked_at ? 'Revisão e NF' : 'Conferência'

export function PjFlowPilot() {
  const canManage = resolvePjOrderAccess(getCurrentUser()).canManage
  const [authorized, setAuthorized] = useState(false)
  const [flows, setFlows] = useState<PjFlow[]>([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [round, setRound] = useState(0)
  const [locked, setLocked] = useState(false)
  const [notice, setNotice] = useState('')
  const load = useCallback(async (message = '') => {
    setLoading(true); setError(''); setFlows([]); setNotice(''); setAuthorized(false)
    try {
      const result = await readPjFlowPilot()
      const params = new URLSearchParams(window.location.search)
      const target = params.get('pedido') || params.get('corrigir')
      const id = target || result.find(flow => !flow.departed_at)?.id || result[0]?.id || ''
      if (id) {
        const url = new URL(window.location.href)
        url.searchParams.set('pedido', id); url.searchParams.delete('corrigir')
        window.history.replaceState(window.history.state, '', url)
      }
      setFlows(result)
      setSelected(id)
      setNotice(message)
      setAuthorized(true)
      setRound(value => value + 1); setLocked(false)
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível carregar os pedidos.') }
    finally { setLoading(false); setLocked(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  function select(id: string) {
    if (locked) return
    const url = new URL(window.location.href)
    url.searchParams.set('pedido', id); url.searchParams.delete('corrigir')
    window.history.replaceState(window.history.state, '', url)
    setSelected(id)
  }
  const flow = flows.find(item => item.id === selected)
  return <main className={`ps-canvas ${styles.canvas}`}><div className={styles.shell}>
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>Nova jornada</span><h1>Pedidos PJ</h1>
        <p>Da conferência à saída, cada etapa no seu lugar.</p></div>
      <div className={styles.headerActions}>
        {authorized && canManage && <a className={styles.primary} href="/pedidos-pj?legado=1&novo=1"
          onClick={event => { if (locked) event.preventDefault() }} aria-disabled={locked}>Novo pedido</a>}
        <button className={styles.secondary} type="button" onClick={() => void load()} disabled={loading || locked}>Recarregar pedidos</button>
      </div>
    </header>
    {loading && <p className={styles.empty} role="status">Carregando pedidos…</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p className={styles.next} role="status">{notice}.</p>}
    {!loading && !error && !flows.length && <p className={styles.empty}>Não há pedidos nesta jornada.</p>}
    {!loading && !error && flows.length > 0 && <div className={styles.workspace}>
      <nav className={styles.orders} aria-label="Escolher pedido">
        <div className={styles.listHeading}><strong>Pedidos</strong><span>{flows.length}</span></div>
        <div className={styles.orderList}>{flows.map(item => <button key={item.id} type="button"
          className={`${styles.order} ${selected === item.id ? styles.selected : ''}`}
          aria-current={selected === item.id ? 'true' : undefined} disabled={locked && selected !== item.id}
          onClick={() => select(item.id)}>
          <span className={styles.orderMeta}>{shortDate(item.delivery_date)} · entrega/coleta</span>
          <strong>{item.customer}</strong><span className={styles.orderStage}>{stage(item)}</span>
        </button>)}</div>
        {locked && <p className={styles.hint}>Finalize ou descarte as alterações antes de trocar de pedido.</p>}
      </nav>
      {flow ? <PjFlowOrderCard key={`${flow.id}:${round}`} flow={flow} reload={load} onLock={setLocked} />
        : <p className={styles.empty} role="alert">O pedido deste link não está disponível nesta jornada. Escolha um pedido da lista.</p>}
    </div>}
    <footer className={styles.footer}><a href="/pedidos-pj?legado=1" onClick={event => { if (locked) event.preventDefault() }} aria-disabled={locked}>
      Ver pedidos da rotina anterior</a><span>Pedidos anteriores permanecem na rotina anterior.</span></footer>
  </div></main>
}
