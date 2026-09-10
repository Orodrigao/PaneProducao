'use client'

import { useCallback, useEffect, useState } from 'react'
import { getCurrentUser } from '@/lib/auth'
import { readPjFlowPilot, type PjFlow } from '@/lib/pjFlowPilot'
import { resolvePjOrderAccess } from '@/lib/pjOrderDispatch'
import { PjFlowOrderCard } from './PjFlowOrderCard'
import styles from './PjFlowPilot.module.css'

const shortDate = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
const stage = (flow: PjFlow) => flow.departed_at ? 'Saiu' : flow.released_at ? 'Saída liberada' : flow.checked_at ? 'Revisão e NF' : 'Conferência'
type OrderTab = 'active' | 'completed'
type ActiveStage = 'all' | 'conference' | 'review' | 'released'
const activeStage = (flow: PjFlow): Exclude<ActiveStage, 'all'> => flow.released_at ? 'released' : flow.checked_at ? 'review' : 'conference'
const stageFilters: { key: ActiveStage; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'conference', label: 'Conferência' },
  { key: 'review', label: 'Revisão e NF' },
  { key: 'released', label: 'Saída liberada' },
]
const matchesStage = (flow: PjFlow, filter: ActiveStage) => filter === 'all' || activeStage(flow) === filter

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
  const [tab, setTab] = useState<OrderTab>('active')
  const [filter, setFilter] = useState<ActiveStage>('all')
  const load = useCallback(async (message = '') => {
    setLoading(true); setError(''); setFlows([]); setNotice(''); setAuthorized(false)
    try {
      const result = await readPjFlowPilot()
      const params = new URLSearchParams(window.location.search)
      const target = params.get('pedido') || params.get('corrigir')
      const targetFlow = result.find(flow => flow.id === target)
      const defaultFlow = result.find(flow => !flow.departed_at)
      const selectedFlow = targetFlow || defaultFlow
      const id = selectedFlow?.id || ''
      setTab(targetFlow?.departed_at ? 'completed' : 'active')
      setFilter(current => selectedFlow && !selectedFlow.departed_at && !matchesStage(selectedFlow, current) ? 'all' : current)
      if (id) {
        const url = new URL(window.location.href)
        url.searchParams.set('pedido', id); url.searchParams.delete('corrigir')
        window.history.replaceState(window.history.state, '', url)
      } else {
        const url = new URL(window.location.href)
        url.searchParams.delete('pedido'); url.searchParams.delete('corrigir')
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
  const activeFlows = flows.filter(item => !item.departed_at)
  const completedFlows = flows.filter(item => Boolean(item.departed_at))
  const visibleFlows = tab === 'completed' ? completedFlows : activeFlows.filter(item => matchesStage(item, filter))
  function updateSelection(id: string) {
    const url = new URL(window.location.href)
    if (id) url.searchParams.set('pedido', id)
    else url.searchParams.delete('pedido')
    url.searchParams.delete('corrigir')
    window.history.replaceState(window.history.state, '', url)
    setSelected(id)
  }
  function changeTab(next: OrderTab) {
    if (locked) return
    const candidates = next === 'completed' ? completedFlows : activeFlows
    setTab(next)
    if (next === 'active') setFilter('all')
    updateSelection(candidates[0]?.id || '')
  }
  function changeFilter(next: ActiveStage) {
    if (locked) return
    const candidates = activeFlows.filter(item => matchesStage(item, next))
    setFilter(next)
    updateSelection(candidates[0]?.id || '')
  }
  function select(id: string) {
    if (locked) return
    updateSelection(id)
  }
  const flow = visibleFlows.find(item => item.id === selected)
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
        <div className={styles.tabs} aria-label="Situação dos pedidos">
          <button type="button" aria-pressed={tab === 'active'} disabled={locked}
            className={tab === 'active' ? styles.activeTab : ''} onClick={() => changeTab('active')}>
            Em andamento <span>{activeFlows.length}</span>
          </button>
          <button type="button" aria-pressed={tab === 'completed'} disabled={locked}
            className={tab === 'completed' ? styles.activeTab : ''} onClick={() => changeTab('completed')}>
            Concluídos <span>{completedFlows.length}</span>
          </button>
        </div>
        {tab === 'active' && <div className={styles.filters} aria-label="Filtrar pedidos em andamento por status">
          {stageFilters.map(option => {
            const count = option.key === 'all' ? activeFlows.length : activeFlows.filter(item => matchesStage(item, option.key)).length
            return <button key={option.key} type="button" aria-pressed={filter === option.key} disabled={locked}
              onClick={() => changeFilter(option.key)}>{option.label} <span>{count}</span></button>
          })}
        </div>}
        <div className={styles.listHeading}><strong>{tab === 'active' ? 'Pedidos em andamento' : 'Pedidos concluídos'}</strong><span>{visibleFlows.length}</span></div>
        {visibleFlows.length === 0 && <p className={styles.emptyList}>{tab === 'completed'
          ? 'Não há pedidos concluídos.' : filter === 'all' ? 'Não há pedidos em andamento.' : 'Não há pedidos neste status.'}</p>}
        <div className={styles.orderList}>{visibleFlows.map(item => <button key={item.id} type="button"
          className={`${styles.order} ${selected === item.id ? styles.selected : ''}`}
          aria-current={selected === item.id ? 'true' : undefined} disabled={locked && selected !== item.id}
          onClick={() => select(item.id)}>
          <span className={styles.orderMeta}>{shortDate(item.delivery_date)} · entrega/coleta</span>
          <strong>{item.customer}</strong><span className={styles.orderStage}>{stage(item)}</span>
        </button>)}</div>
        {locked && <p className={styles.hint}>Finalize ou descarte as alterações antes de trocar de pedido.</p>}
      </nav>
      {flow ? <PjFlowOrderCard key={`${flow.id}:${round}`} flow={flow} reload={load} onLock={setLocked} />
        : <p className={styles.empty}>Escolha uma aba ou um status com pedidos para abrir a ficha.</p>}
    </div>}
    <footer className={styles.footer}><a href="/pedidos-pj?legado=1" onClick={event => { if (locked) event.preventDefault() }} aria-disabled={locked}>
      Ver pedidos da rotina anterior</a><span>Pedidos anteriores permanecem na rotina anterior.</span></footer>
  </div></main>
}
