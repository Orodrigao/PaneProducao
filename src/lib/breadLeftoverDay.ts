// Retrato do dia na Central de sobras.
//
// Existe por um motivo só: a Central sempre mostrou apenas o que continua sem
// destino. Quando a equipe lança a contagem e em seguida dá destino a tudo, a
// tela fica vazia e quem chega depois conclui que a sobra não foi lançada — foi
// o que aconteceu na JC em 2026-08-26, com 58 pães mandados de volta à vitrine
// segundos após o fechamento. O lançamento existia; a tela é que não contava.
//
// Aqui não há decisão nova: só a leitura dos lotes do dia somada ao histórico
// de destinos que o banco já grava em bread_leftover_events.

export interface DayLeftoverRow {
  id: string
  product_id: string
  quantity: number | string | null
  pending_quantity: number | string | null
  lot_code: string | null
  record_date: string
  reconciliation_status?: string | null
}

export interface DayLeftoverEventRow {
  sobra_id: string
  action: string
  quantity: number | string | null
}

export interface DayDestinationTotal {
  action: DayDestinationAction
  quantity: number
}

export interface DayLeftoverLot {
  sobraId: string
  breadId: string
  lotCode: string
  recordDate: string
  quantity: number
  pending: number
  awaitingOven: boolean
  destinations: DayDestinationTotal[]
}

export interface DaySummary {
  lots: DayLeftoverLot[]
  totalQuantity: number
  totalPending: number
  destinations: DayDestinationTotal[]
}

export type DayDestinationAction =
  | 'display'
  | 'internal_use'
  | 'donation'
  | 'discard'
  | 'freeze'
  | 'reuse_confirmed'

// Ações que realmente consomem saldo do lote. 'registered', 'corrected' e
// 'location_changed' só narram o lote e nunca dão destino a nada.
const CONSUMING_ACTIONS: DayDestinationAction[] = [
  'display',
  'internal_use',
  'donation',
  'discard',
  'freeze',
  'reuse_confirmed',
]

// Devolução de alocação de reaproveitamento: o banco emite quando a proposta é
// corrigida e o saldo volta para o lote. Abater aqui evita o retrato somar duas
// vezes o mesmo pão.
const REVERSING_ACTION = 'reuse_reversed'

export const DAY_DESTINATION_LABELS: Record<DayDestinationAction, string> = {
  display: 'Voltou à vitrine',
  internal_use: 'Consumo interno',
  donation: 'Doação',
  discard: 'Descarte',
  freeze: 'Congelado',
  reuse_confirmed: 'Reaproveitado na produção',
}

function toQuantity(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function isConsumingAction(action: string): action is DayDestinationAction {
  return (CONSUMING_ACTIONS as string[]).includes(action)
}

function sortedTotals(totals: Map<DayDestinationAction, number>): DayDestinationTotal[] {
  return CONSUMING_ACTIONS
    .filter(action => (totals.get(action) ?? 0) > 0)
    .map(action => ({ action, quantity: totals.get(action) as number }))
}

// Monta o retrato de um dia: cada lote com o que recebeu de destino e o que
// ainda está sem. Lote sem evento de destino aparece do mesmo jeito — com a
// lista de destinos vazia — porque some da tela é justamente o defeito.
export function summarizeLeftoverDay(
  rows: DayLeftoverRow[],
  events: DayLeftoverEventRow[],
): DaySummary {
  const byLot = new Map<string, Map<DayDestinationAction, number>>()

  // Soma com sinal, sem aparar no meio do caminho: o banco não promete ordem
  // nenhuma para os eventos, e uma devolução que chegasse antes da confirmação
  // ou seria descartada, ou zeraria um total que ainda ia crescer. O saldo só
  // é aparado no fim, em sortedTotals, onde a ordem já não importa.
  for (const event of events) {
    if (!event.sobra_id) continue

    const quantity = toQuantity(event.quantity)
    if (quantity <= 0) continue

    let action: DayDestinationAction
    let delta: number
    if (event.action === REVERSING_ACTION) {
      action = 'reuse_confirmed'
      delta = -quantity
    } else if (isConsumingAction(event.action)) {
      action = event.action
      delta = quantity
    } else {
      continue
    }

    let totals = byLot.get(event.sobra_id)
    if (!totals) {
      totals = new Map<DayDestinationAction, number>()
      byLot.set(event.sobra_id, totals)
    }
    totals.set(action, (totals.get(action) ?? 0) + delta)
  }

  const dayTotals = new Map<DayDestinationAction, number>()
  const lots: DayLeftoverLot[] = []
  let totalQuantity = 0
  let totalPending = 0

  for (const row of rows) {
    if (!row.id || !row.product_id) continue

    const quantity = toQuantity(row.quantity)
    const pending = toQuantity(row.pending_quantity)
    const destinations = sortedTotals(byLot.get(row.id) ?? new Map())

    // Lote zerado e sem destino nenhum é contagem cancelada ("na verdade não
    // sobrou"): mostrar vira ruído no fim do expediente.
    if (quantity <= 0 && destinations.length === 0) continue

    for (const destination of destinations) {
      dayTotals.set(
        destination.action,
        (dayTotals.get(destination.action) ?? 0) + destination.quantity,
      )
    }

    totalQuantity += quantity
    totalPending += pending

    lots.push({
      sobraId: row.id,
      breadId: row.product_id,
      lotCode: row.lot_code ?? '',
      recordDate: row.record_date,
      quantity,
      pending,
      awaitingOven: row.reconciliation_status === 'awaiting_oven',
      destinations,
    })
  }

  return {
    lots,
    totalQuantity,
    totalPending,
    destinations: sortedTotals(dayTotals),
  }
}
