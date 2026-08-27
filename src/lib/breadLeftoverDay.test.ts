import { describe, expect, it } from 'vitest'
import {
  DAY_DESTINATION_LABELS,
  summarizeLeftoverDay,
  type DayLeftoverEventRow,
  type DayLeftoverRow,
} from './breadLeftoverDay'

function lot(overrides: Partial<DayLeftoverRow> & { id: string }): DayLeftoverRow {
  return {
    product_id: 'croissant',
    quantity: 0,
    pending_quantity: 0,
    lot_code: 'L0826',
    record_date: '2026-08-26',
    ...overrides,
  }
}

describe('retrato do dia na Central de sobras', () => {
  // O caso real da JC em 2026-08-26: tudo lançado, tudo devolvido à vitrine
  // segundos depois. A Central antiga mostrava zero lotes e parecia que o
  // fechamento não tinha entrado.
  it('mostra o lote inteiramente resolvido, com o destino que recebeu', () => {
    const summary = summarizeLeftoverDay(
      [lot({ id: 'a', product_id: 'croissant', quantity: 23, pending_quantity: 0 })],
      [
        { sobra_id: 'a', action: 'registered', quantity: 23 },
        { sobra_id: 'a', action: 'display', quantity: 23 },
        { sobra_id: 'a', action: 'corrected', quantity: 23 },
      ],
    )

    expect(summary.lots).toHaveLength(1)
    expect(summary.lots[0].quantity).toBe(23)
    expect(summary.lots[0].pending).toBe(0)
    expect(summary.lots[0].destinations).toEqual([{ action: 'display', quantity: 23 }])
    expect(summary.totalQuantity).toBe(23)
    expect(summary.totalPending).toBe(0)
  })

  it('não conta registro, correção nem troca de local como destino', () => {
    const events: DayLeftoverEventRow[] = [
      { sobra_id: 'a', action: 'registered', quantity: 10 },
      { sobra_id: 'a', action: 'corrected', quantity: 10 },
      { sobra_id: 'a', action: 'location_changed', quantity: 10 },
    ]
    const summary = summarizeLeftoverDay(
      [lot({ id: 'a', quantity: 10, pending_quantity: 10 })],
      events,
    )

    expect(summary.lots[0].destinations).toEqual([])
    expect(summary.destinations).toEqual([])
    expect(summary.totalPending).toBe(10)
  })

  it('soma destinos parciais do mesmo lote e mantém o que ficou sem destino', () => {
    const summary = summarizeLeftoverDay(
      [lot({ id: 'a', quantity: 10, pending_quantity: 3 })],
      [
        { sobra_id: 'a', action: 'freeze', quantity: 4 },
        { sobra_id: 'a', action: 'donation', quantity: 2 },
        { sobra_id: 'a', action: 'discard', quantity: 1 },
      ],
    )

    expect(summary.lots[0].destinations).toEqual([
      { action: 'donation', quantity: 2 },
      { action: 'discard', quantity: 1 },
      { action: 'freeze', quantity: 4 },
    ])
    expect(summary.totalPending).toBe(3)
  })

  it('devolução de reaproveitamento abate a alocação anterior', () => {
    const summary = summarizeLeftoverDay(
      [lot({ id: 'a', quantity: 6, pending_quantity: 4 })],
      [
        { sobra_id: 'a', action: 'reuse_confirmed', quantity: 6 },
        { sobra_id: 'a', action: 'reuse_reversed', quantity: 4 },
      ],
    )

    expect(summary.lots[0].destinations).toEqual([{ action: 'reuse_confirmed', quantity: 2 }])
  })

  // O banco não promete ordem nenhuma na leitura dos eventos. Achado do Codex
  // na PR 277: aparar o saldo no meio do laço fazia o retrato mudar conforme o
  // plano de consulta, e devolução que chegasse primeiro sumia sem deixar
  // rastro. Estes três casos são a mesma história em ordens diferentes e
  // precisam dar o mesmo número.
  it('devolução não depende da ordem em que os eventos chegam', () => {
    const cronologica: DayLeftoverEventRow[] = [
      { sobra_id: 'a', action: 'reuse_confirmed', quantity: 6 },
      { sobra_id: 'a', action: 'reuse_reversed', quantity: 6 },
      { sobra_id: 'a', action: 'reuse_confirmed', quantity: 4 },
    ]
    const invertida = [...cronologica].reverse()
    const devolucaoPrimeiro = [cronologica[1], cronologica[0], cronologica[2]]

    for (const ordem of [cronologica, invertida, devolucaoPrimeiro]) {
      const summary = summarizeLeftoverDay(
        [lot({ id: 'a', quantity: 10, pending_quantity: 6 })],
        ordem,
      )
      expect(summary.lots[0].destinations).toEqual([{ action: 'reuse_confirmed', quantity: 4 }])
    }
  })

  it('devolução que chega antes da confirmação não é engolida', () => {
    const summary = summarizeLeftoverDay(
      [lot({ id: 'a', quantity: 10, pending_quantity: 8 })],
      [
        { sobra_id: 'a', action: 'reuse_reversed', quantity: 5 },
        { sobra_id: 'a', action: 'reuse_confirmed', quantity: 7 },
      ],
    )

    expect(summary.lots[0].destinations).toEqual([{ action: 'reuse_confirmed', quantity: 2 }])
  })

  it('devolução integral zera o destino em vez de deixar resto', () => {
    const summary = summarizeLeftoverDay(
      [lot({ id: 'a', quantity: 6, pending_quantity: 6 })],
      [
        { sobra_id: 'a', action: 'reuse_reversed', quantity: 6 },
        { sobra_id: 'a', action: 'reuse_confirmed', quantity: 6 },
      ],
    )

    expect(summary.lots[0].destinations).toEqual([])
    expect(summary.destinations).toEqual([])
  })

  it('agrega o dia inteiro por destino, somando lotes diferentes', () => {
    const summary = summarizeLeftoverDay(
      [
        lot({ id: 'a', product_id: 'croissant', quantity: 23, pending_quantity: 0 }),
        lot({ id: 'b', product_id: 'integral', quantity: 10, pending_quantity: 0 }),
        lot({ id: 'c', product_id: 'grande_arome', quantity: 2, pending_quantity: 2 }),
      ],
      [
        { sobra_id: 'a', action: 'display', quantity: 23 },
        { sobra_id: 'b', action: 'display', quantity: 10 },
      ],
    )

    expect(summary.totalQuantity).toBe(35)
    expect(summary.totalPending).toBe(2)
    expect(summary.destinations).toEqual([{ action: 'display', quantity: 33 }])
  })

  it('lote provisório sem Forno continua no retrato, marcado', () => {
    const summary = summarizeLeftoverDay(
      [lot({ id: 'a', quantity: 5, pending_quantity: 5, reconciliation_status: 'awaiting_oven' })],
      [],
    )

    expect(summary.lots[0].awaitingOven).toBe(true)
    expect(summary.lots[0].destinations).toEqual([])
  })

  it('contagem cancelada (zero, sem destino) sai do retrato', () => {
    const summary = summarizeLeftoverDay(
      [
        lot({ id: 'a', quantity: 0, pending_quantity: 0 }),
        lot({ id: 'b', product_id: 'integral', quantity: 4, pending_quantity: 4 }),
      ],
      [],
    )

    expect(summary.lots.map(entry => entry.sobraId)).toEqual(['b'])
  })

  it('lote zerado que já teve destino permanece visível', () => {
    const summary = summarizeLeftoverDay(
      [lot({ id: 'a', quantity: 0, pending_quantity: 0 })],
      [{ sobra_id: 'a', action: 'discard', quantity: 3 }],
    )

    expect(summary.lots).toHaveLength(1)
    expect(summary.lots[0].destinations).toEqual([{ action: 'discard', quantity: 3 }])
  })

  it('dia sem nenhum lote devolve retrato vazio, não quebra', () => {
    const summary = summarizeLeftoverDay([], [])

    expect(summary.lots).toEqual([])
    expect(summary.destinations).toEqual([])
    expect(summary.totalQuantity).toBe(0)
    expect(summary.totalPending).toBe(0)
  })

  it('evento órfão ou com quantidade inválida não derruba o retrato', () => {
    const summary = summarizeLeftoverDay(
      [lot({ id: 'a', quantity: 5, pending_quantity: 5 })],
      [
        { sobra_id: 'fantasma', action: 'display', quantity: 9 },
        { sobra_id: 'a', action: 'display', quantity: null },
        { sobra_id: 'a', action: 'discard', quantity: -2 },
      ],
    )

    expect(summary.lots[0].destinations).toEqual([])
    expect(summary.destinations).toEqual([])
  })

  it('todo destino que consome saldo tem rótulo em português', () => {
    const summary = summarizeLeftoverDay(
      [lot({ id: 'a', quantity: 5, pending_quantity: 0 })],
      [
        { sobra_id: 'a', action: 'display', quantity: 1 },
        { sobra_id: 'a', action: 'internal_use', quantity: 1 },
        { sobra_id: 'a', action: 'donation', quantity: 1 },
        { sobra_id: 'a', action: 'discard', quantity: 1 },
        { sobra_id: 'a', action: 'freeze', quantity: 1 },
        { sobra_id: 'a', action: 'reuse_confirmed', quantity: 1 },
      ],
    )

    for (const destination of summary.lots[0].destinations) {
      expect(DAY_DESTINATION_LABELS[destination.action]).toBeTruthy()
    }
    expect(summary.lots[0].destinations).toHaveLength(6)
  })
})
