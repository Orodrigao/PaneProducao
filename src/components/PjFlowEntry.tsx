'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { getCurrentUser } from '@/lib/auth'
import { resolvePjOrderAccess } from '@/lib/pjOrderDispatch'
import { discoverPjFlowPilot, readPjFlowActivationStatus, type PjFlow } from '@/lib/pjFlowPilot'
import { PjFlowPilot } from './PjFlowPilot'

export function PjFlowEntry({ legacy }: {
  legacy: (excluded: string[], managedFlowId: string | null) => ReactNode
}) {
  const [state, setState] = useState<{
    flows: PjFlow[]
    pilot: boolean
    managedFlowId: string | null
  } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    const params = new URLSearchParams(window.location.search)
    if (params.get('piloto') === '1') {
      setState({ flows: [], pilot: true, managedFlowId: null })
      return
    }
    void discoverPjFlowPilot().then(async flows => {
      if (!alive) return
      const target = params.get('pedido') || params.get('corrigir')
      const targetFlow = target ? flows.find(flow => flow.id === target) : undefined
      const targetIsFlow = Boolean(targetFlow)
      let managedFlowId: string | null = null
      if (
        target
        && targetFlow
        && params.get('gerenciar') === '1'
        && resolvePjOrderAccess(getCurrentUser()).canManage
        && targetFlow.version === 0
        && !targetFlow.checked_at
        && !targetFlow.released_at
        && !targetFlow.departed_at
      ) {
        const activation = await readPjFlowActivationStatus(target)
        if (!alive) return
        if (activation.mode === 'standard') managedFlowId = target
      }
      const pilot = target ? targetIsFlow && !managedFlowId
        : flows.length > 0 && params.get('legado') !== '1'
      if (pilot) {
        const url = new URL(window.location.href)
        url.searchParams.set('piloto', '1'); url.searchParams.delete('legado')
        window.history.replaceState(window.history.state, '', url)
      }
      setState({ flows, pilot, managedFlowId })
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Falha ao carregar os pedidos.') })
    return () => { alive = false }
  }, [])
  if (error) return <main className="ps-canvas"><div className="ps-shell ps-pad">
    <h1>Pedidos PJ</h1><p role="alert">{error}</p>
    <button className="ps-btn" onClick={() => window.location.reload()}>Recarregar pedidos</button>
  </div></main>
  if (!state) return <main className="ps-canvas"><p role="status" className="ps-pad">Carregando pedidos…</p></main>
  if (state.pilot) return <PjFlowPilot />
  const excluded = state.flows.filter(flow => flow.id !== state.managedFlowId).map(flow => flow.id)
  return <>{state.flows.length > 0 && <div className="ps-pad">
    <a href={state.managedFlowId ? `/pedidos-pj?pedido=${encodeURIComponent(state.managedFlowId)}` : '/pedidos-pj?piloto=1'}>
      Voltar à nova jornada PJ
    </a>
    <p>{state.managedFlowId
      ? 'Você está gerenciando um pedido da nova jornada antes da conferência.'
      : 'Esta lista contém somente pedidos da rotina anterior.'}</p>
  </div>}{legacy(excluded, state.managedFlowId)}</>
}
