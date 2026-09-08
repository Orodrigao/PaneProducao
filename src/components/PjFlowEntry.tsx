'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { discoverPjFlowPilot, type PjFlow } from '@/lib/pjFlowPilot'
import { PjFlowPilot } from './PjFlowPilot'

export function PjFlowEntry({ legacy }: { legacy: (excluded: string[]) => ReactNode }) {
  const [state, setState] = useState<{ flows: PjFlow[]; pilot: boolean } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    const params = new URLSearchParams(window.location.search)
    if (params.get('piloto') === '1') {
      setState({ flows: [], pilot: true })
      return
    }
    void discoverPjFlowPilot().then(flows => {
      if (!alive) return
      const target = params.get('pedido') || params.get('corrigir')
      const pilot = target ? flows.some(flow => flow.id === target)
        : flows.length > 0 && params.get('legado') !== '1'
      if (pilot) {
        const url = new URL(window.location.href)
        url.searchParams.set('piloto', '1'); url.searchParams.delete('legado')
        window.history.replaceState(window.history.state, '', url)
      }
      setState({ flows, pilot })
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Falha ao carregar os pedidos.') })
    return () => { alive = false }
  }, [])
  if (error) return <main className="ps-canvas"><div className="ps-shell ps-pad">
    <h1>Pedidos PJ</h1><p role="alert">{error}</p>
    <button className="ps-btn" onClick={() => window.location.reload()}>Recarregar pedidos</button>
  </div></main>
  if (!state) return <main className="ps-canvas"><p role="status" className="ps-pad">Carregando pedidos…</p></main>
  if (state.pilot) return <PjFlowPilot />
  return <>{state.flows.length > 0 && <div className="ps-pad"><a href="/pedidos-pj?piloto=1">Voltar à nova jornada PJ</a>
    <p>Esta lista contém somente pedidos da rotina anterior.</p></div>}{legacy(state.flows.map(flow => flow.id))}</>
}
