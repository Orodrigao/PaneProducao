import { withTimeout } from '@/lib/supabaseRest'

// Com a conexão parada sem erro, a leitura do PJ pode não terminar. O botão de
// imprimir espera até este prazo e depois imprime com o que já está na tela.
export const PJ_PRINT_WAIT_MS = 5_000

export type PjPrintWaitResult = 'settled' | 'timeout'

export interface PjPrintLoadTracker {
  track: (load: Promise<void>) => Promise<void>
  waitForLatest: (timeoutMs?: number) => Promise<PjPrintWaitResult>
}

// Só a leitura mais recente do PJ vale: a tela descarta as anteriores. Por isso
// a impressão espera por ela, e não pela que o botão começou. Se uma nova
// programação PJ dispara outra leitura durante a espera, a folha sai assim que
// essa leitura chega, mesmo com a do botão parada. O prazo conta desde o pedido
// de espera e não recomeça a cada leitura nova.
export function createPjPrintLoadTracker(): PjPrintLoadTracker {
  let pending: Promise<void> | null = null
  let waiters: Array<() => void> = []

  const finish = (load: Promise<void>) => {
    if (load !== pending) return
    pending = null
    const ready = waiters
    waiters = []
    ready.forEach(resolve => resolve())
  }

  return {
    track(load) {
      pending = load
      // Falha da leitura já é tratada por quem leu; aqui só importa ter terminado.
      void load.then(() => finish(load), () => finish(load))
      return load
    },
    async waitForLatest(timeoutMs = PJ_PRINT_WAIT_MS) {
      if (!pending) return 'settled'
      let release: () => void = () => undefined
      const latestDone = new Promise<void>(resolve => {
        release = resolve
        waiters.push(resolve)
      })
      try {
        await withTimeout(latestDone, timeoutMs)
        return 'settled'
      } catch {
        // latestDone nunca rejeita: a única saída por aqui é o prazo.
        waiters = waiters.filter(waiter => waiter !== release)
        return 'timeout'
      }
    },
  }
}
