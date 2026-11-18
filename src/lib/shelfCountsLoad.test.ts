import { describe, expect, it, vi } from 'vitest'
import { loadShelfCounts } from '@/lib/shelfCountsLoad'

type Row = { id: string }
type Result = { data: Row[] | null }

function pendingRead() {
  let resolve!: (result: Result) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Result>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { read: () => promise, resolve, reject }
}

function screen() {
  const state = { rows: [{ id: 'lista anterior' }], loading: false }
  const view = {
    setRows: vi.fn((rows: Row[]) => { state.rows = rows }),
    setLoading: vi.fn((loading: boolean) => { state.loading = loading }),
  }
  return { state, view }
}

describe('contagens de prateleira do período escolhido', () => {
  it('resposta antiga chegando depois da nova não sobrescreve a lista nem altera o carregamento', async () => {
    const oldRead = pendingRead()
    const newRead = pendingRead()
    const { state, view } = screen()
    const sequence = { current: 0 }

    const opening = loadShelfCounts(sequence, view, oldRead.read)
    const chosen = loadShelfCounts(sequence, view, newRead.read)
    newRead.resolve({ data: [{ id: 'período escolhido' }] })
    await chosen
    expect(state.rows).toEqual([{ id: 'período escolhido' }])
    expect(state.loading).toBe(false)
    view.setRows.mockClear()
    view.setLoading.mockClear()

    oldRead.resolve({ data: [{ id: 'período antigo' }] })
    await opening
    expect(state.rows).toEqual([{ id: 'período escolhido' }])
    expect(view.setRows).not.toHaveBeenCalled()
    expect(view.setLoading).not.toHaveBeenCalled()
  })

  it('resposta antiga chegando antes da nova não troca a lista nem desliga o carregando', async () => {
    const oldRead = pendingRead()
    const newRead = pendingRead()
    const { state, view } = screen()
    const sequence = { current: 0 }

    const opening = loadShelfCounts(sequence, view, oldRead.read)
    const chosen = loadShelfCounts(sequence, view, newRead.read)
    view.setLoading.mockClear()
    oldRead.resolve({ data: [{ id: 'período antigo' }] })
    await opening
    expect(state.rows).toEqual([{ id: 'lista anterior' }])
    expect(state.loading).toBe(true)
    expect(view.setRows).not.toHaveBeenCalled()
    expect(view.setLoading).not.toHaveBeenCalled()

    newRead.resolve({ data: [{ id: 'período escolhido' }] })
    await chosen
    expect(state.rows).toEqual([{ id: 'período escolhido' }])
    expect(state.loading).toBe(false)
  })

  it('uma leitura normal preenche a lista e desliga o carregando', async () => {
    const pending = pendingRead()
    const { state, view } = screen()

    const loading = loadShelfCounts({ current: 0 }, view, pending.read)
    expect(state.loading).toBe(true)
    pending.resolve({ data: [{ id: 'contagem' }] })
    await loading
    expect(state.rows).toEqual([{ id: 'contagem' }])
    expect(view.setRows).toHaveBeenCalledTimes(1)
    expect(view.setLoading.mock.calls).toEqual([[true], [false]])
  })

  it('resposta sem dados esvazia a lista e desliga o carregando, como antes', async () => {
    const { state, view } = screen()

    await loadShelfCounts({ current: 0 }, view, async () => ({ data: null }))
    expect(state.rows).toEqual([])
    expect(state.loading).toBe(false)
  })

  it('falha da leitura mais recente mantém a lista anterior e desliga o carregando', async () => {
    const oldRead = pendingRead()
    const newRead = pendingRead()
    const { state, view } = screen()
    const sequence = { current: 0 }

    const opening = loadShelfCounts(sequence, view, oldRead.read)
    const chosen = loadShelfCounts(sequence, view, newRead.read)
    newRead.reject(new Error('falha da leitura atual'))
    await chosen
    expect(state.rows).toEqual([{ id: 'lista anterior' }])
    expect(state.loading).toBe(false)
    view.setLoading.mockClear()

    oldRead.resolve({ data: [{ id: 'período antigo' }] })
    await opening
    expect(state.rows).toEqual([{ id: 'lista anterior' }])
    expect(view.setRows).not.toHaveBeenCalled()
    expect(view.setLoading).not.toHaveBeenCalled()
  })

  it('falha superada não mexe na tela enquanto a leitura nova está pendente', async () => {
    const oldRead = pendingRead()
    const newRead = pendingRead()
    const { state, view } = screen()
    const sequence = { current: 0 }

    const opening = loadShelfCounts(sequence, view, oldRead.read)
    const chosen = loadShelfCounts(sequence, view, newRead.read)
    view.setLoading.mockClear()
    oldRead.reject(new Error('falha da leitura antiga'))
    await opening
    expect(state.rows).toEqual([{ id: 'lista anterior' }])
    expect(state.loading).toBe(true)
    expect(view.setRows).not.toHaveBeenCalled()
    expect(view.setLoading).not.toHaveBeenCalled()

    newRead.resolve({ data: [{ id: 'período escolhido' }] })
    await chosen
    expect(state.rows).toEqual([{ id: 'período escolhido' }])
    expect(state.loading).toBe(false)
  })

  it('falha superada depois do sucesso novo não mexe na tela', async () => {
    const oldRead = pendingRead()
    const newRead = pendingRead()
    const { state, view } = screen()
    const sequence = { current: 0 }

    const opening = loadShelfCounts(sequence, view, oldRead.read)
    const chosen = loadShelfCounts(sequence, view, newRead.read)
    newRead.resolve({ data: [{ id: 'período escolhido' }] })
    await chosen
    view.setRows.mockClear()
    view.setLoading.mockClear()

    oldRead.reject(new Error('falha da leitura antiga'))
    await opening
    expect(state.rows).toEqual([{ id: 'período escolhido' }])
    expect(state.loading).toBe(false)
    expect(view.setRows).not.toHaveBeenCalled()
    expect(view.setLoading).not.toHaveBeenCalled()
  })

  it.each(['sucesso', 'falha'])('invalidar a leitura ao sair da tela descarta %s pendente', async outcome => {
    const pending = pendingRead()
    const { state, view } = screen()
    const sequence = { current: 0 }

    const loading = loadShelfCounts(sequence, view, pending.read)
    sequence.current += 1
    view.setLoading.mockClear()
    if (outcome === 'sucesso') pending.resolve({ data: [{ id: 'contagem' }] })
    else pending.reject(new Error('falha após sair da tela'))
    await loading
    expect(state.rows).toEqual([{ id: 'lista anterior' }])
    expect(view.setRows).not.toHaveBeenCalled()
    expect(view.setLoading).not.toHaveBeenCalled()
  })
})
