import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PJ_PRINT_WAIT_MS, createPjPrintLoadTracker } from './pjPrintWait'

function resolvesAfter(ms: number) {
  return new Promise<void>(resolve => globalThis.setTimeout(resolve, ms))
}

function neverResolves() {
  return new Promise<void>(() => undefined)
}

function settledFlag(promise: Promise<unknown>) {
  const state = { settled: false }
  void promise.then(() => { state.settled = true })
  return state
}

describe('espera da leitura PJ antes de imprimir a folha', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('imprime assim que a leitura responde dentro do prazo', async () => {
    const loads = createPjPrintLoadTracker()
    loads.track(resolvesAfter(300))
    const result = loads.waitForLatest()

    await vi.advanceTimersByTimeAsync(300)
    await expect(result).resolves.toBe('settled')
  })

  it('libera a impressão no prazo quando a conexão fica parada sem erro', async () => {
    const loads = createPjPrintLoadTracker()
    loads.track(neverResolves())
    const result = loads.waitForLatest()
    const state = settledFlag(result)

    await vi.advanceTimersByTimeAsync(PJ_PRINT_WAIT_MS - 1)
    expect(state.settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toBe('timeout')
  })

  it('espera a leitura nova que uma programação PJ dispara durante a espera', async () => {
    const loads = createPjPrintLoadTracker()
    loads.track(resolvesAfter(1_000))
    const result = loads.waitForLatest()
    const state = settledFlag(result)

    await vi.advanceTimersByTimeAsync(500)
    loads.track(resolvesAfter(1_500))

    await vi.advanceTimersByTimeAsync(1_000)
    expect(state.settled).toBe(false)

    await vi.advanceTimersByTimeAsync(500)
    await expect(result).resolves.toBe('settled')
  })

  it('imprime quando a leitura nova chega, sem esperar a do botão que ficou parada', async () => {
    const loads = createPjPrintLoadTracker()
    loads.track(neverResolves())
    const result = loads.waitForLatest()
    const state = settledFlag(result)

    await vi.advanceTimersByTimeAsync(500)
    loads.track(resolvesAfter(1_000))

    await vi.advanceTimersByTimeAsync(999)
    expect(state.settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toBe('settled')
  })

  it('conta o prazo desde o clique, sem recomeçar quando chega leitura nova', async () => {
    const loads = createPjPrintLoadTracker()
    loads.track(resolvesAfter(1_000))
    const result = loads.waitForLatest()
    const state = settledFlag(result)

    await vi.advanceTimersByTimeAsync(900)
    loads.track(neverResolves())

    await vi.advanceTimersByTimeAsync(PJ_PRINT_WAIT_MS - 901)
    expect(state.settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toBe('timeout')
  })

  it('não segura a impressão quando a leitura falha', async () => {
    const loads = createPjPrintLoadTracker()
    loads.track(Promise.reject(new Error('rede caiu')))

    await expect(loads.waitForLatest()).resolves.toBe('settled')
  })

  it('imprime direto quando a leitura mais recente já terminou', async () => {
    const loads = createPjPrintLoadTracker()
    loads.track(resolvesAfter(100))
    await vi.advanceTimersByTimeAsync(100)

    await expect(loads.waitForLatest()).resolves.toBe('settled')
  })

  it('imprime direto quando nenhuma leitura começou', async () => {
    await expect(createPjPrintLoadTracker().waitForLatest()).resolves.toBe('settled')
  })
})
