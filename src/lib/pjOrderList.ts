export interface PjOrderListItem {
  key: string
  customerName: string
  orderDate: string
  productionDate: string | null
  deliveryDate: string | null
  cancelledAt: string | null
  dispatchedAt: string | null
  /**
   * Há item ainda não conferido pela Expedição **e a conferência ainda é
   * possível**. Enquanto houver, o pedido não cai no Histórico pela virada do
   * dia: pedido entregue no sábado e conferido na segunda viraria órfão, sem
   * fila em que aparecer.
   *
   * Quem monta este campo precisa excluir o pedido que já virou cobrança: o
   * banco recusa conferência nele, e "Marcar como enviado" exige tudo
   * conferido. Sem essa exclusão o pedido fica preso na fila para sempre, sem
   * saída por nenhuma das duas portas.
   */
  hasPendingCheck?: boolean
}

export interface PjPendingCheckOrder {
  cancelledAt: string | null
  dispatchedAt: string | null
  rows: Array<{
    dispatchedQuantity: number | null
    /** O pedido já virou cobrança, então o banco recusa conferência nele. */
    alreadyBilled?: boolean
  }>
}

/**
 * Decide se o pedido ainda segura a fila da Expedição.
 *
 * Segura só quando conferir é possível E necessário. As três portas que
 * prenderam 65 pedidos até 2026-08-26:
 *
 * - cancelado ou já enviado: não há o que conferir;
 * - já virou cobrança: `save_pj_order_dispatch_quantities` recusa, e
 *   `confirm_pj_order_dispatch` exige tudo conferido, então o pedido não sai
 *   por porta nenhuma e a fila só cresce;
 * - nada pendente: já foi conferido.
 */
export function hasPendingDispatchCheck(order: PjPendingCheckOrder): boolean {
  if (order.cancelledAt || order.dispatchedAt) return false
  if (order.rows.some(row => row.alreadyBilled === true)) return false
  return order.rows.some(row => row.dispatchedQuantity === null)
}

export interface PjOrderListSection<T extends PjOrderListItem> {
  id: 'overdue' | 'today' | 'tomorrow' | `date:${string}`
  date: string | null
  orders: T[]
}

interface OrganizePjOrdersOptions {
  today: string
  query: string
}

export interface PjOrderSearchResult<T extends PjOrderListItem> {
  order: T
  stage: 'open' | 'history'
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00`)
  parsed.setDate(parsed.getDate() + days)
  return parsed.toISOString().slice(0, 10)
}

function priorityDate(order: PjOrderListItem): string {
  return order.productionDate || order.deliveryDate || order.orderDate
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim()
}

function openSectionId(
  order: PjOrderListItem,
  today: string,
  tomorrow: string,
): PjOrderListSection<PjOrderListItem>['id'] {
  const date = priorityDate(order)
  if (date < today) return 'overdue'
  if (date === today) return 'today'
  if (date === tomorrow) return 'tomorrow'
  return `date:${date}`
}

export function organizePjOrders<T extends PjOrderListItem>(
  orders: T[],
  options: OrganizePjOrdersOptions,
) {
  const tomorrow = addDays(options.today, 1)
  const stillOpen = (order: T) => (
    !order.cancelledAt
    && !order.dispatchedAt
    && (!order.deliveryDate || order.deliveryDate >= options.today || order.hasPendingCheck === true)
  )
  const open = orders
    .filter(stillOpen)
    .sort((a, b) => {
      const byDate = priorityDate(a).localeCompare(priorityDate(b))
      if (byDate !== 0) return byDate
      return a.customerName.localeCompare(b.customerName, 'pt-BR', { sensitivity: 'base' })
    })
  const history = orders
    .filter(order => !stillOpen(order))
    .sort((a, b) => (b.deliveryDate || b.orderDate).localeCompare(a.deliveryDate || a.orderDate))

  const sections = new Map<PjOrderListSection<T>['id'], PjOrderListSection<T>>()
  open.forEach(order => {
    const id = openSectionId(order, options.today, tomorrow) as PjOrderListSection<T>['id']
    const existing = sections.get(id)
    if (existing) {
      existing.orders.push(order)
      return
    }
    sections.set(id, {
      id,
      date: id.startsWith('date:') ? id.slice(5) : null,
      orders: [order],
    })
  })

  const query = normalizeSearchText(options.query)
  const searchResults: PjOrderSearchResult<T>[] = query
    ? [
        ...open
          .filter(order => normalizeSearchText(order.customerName).includes(query))
          .map(order => ({ order, stage: 'open' as const })),
        ...history
          .filter(order => normalizeSearchText(order.customerName).includes(query))
          .map(order => ({ order, stage: 'history' as const })),
      ]
    : []

  return {
    open,
    history,
    openSections: Array.from(sections.values()),
    searchResults,
  }
}

/**
 * O que o atalho do Contas a receber manda a tela de Pedidos PJ fazer.
 *
 * Isto era código solto dentro da página e quebrou duas vezes: primeiro
 * abrindo a aba errada, depois perdendo o alvo porque a limpeza do endereço
 * remontava a tela. Como função pura, a decisão passa a ter teste; o que fica
 * sem teste é só a ligação com a tela.
 *
 * **A aba não é decidida aqui, de propósito.** Quem sabe em qual aba um pedido
 * mora é `organizePjOrders`, e a regra dela é maior do que "foi liberado?":
 * pedido não liberado com entrega vencida mora em Fechados para o financeiro.
 * Reescrever esse critério aqui foi exatamente o defeito de 07/09, então o
 * chamador passa a aba já resolvida pela fonte única.
 *
 * `?corrigir=<pedido>` abre o pedido com o formulário de correção aberto e,
 * depois de salvar, devolve a pessoa ao Contas a receber. `?pedido=<pedido>`
 * apenas abre o pedido.
 */
export interface PjOrderShortcutCandidate {
  orderGroupId: string | null
  stage: 'open' | 'history'
  /** O formulário de correção só existe em pedido já liberado para entrega. */
  dispatched: boolean
}

export type PjOrderShortcut =
  | { tipo: 'nenhum' }
  | { tipo: 'nao-encontrado'; id: string }
  | { tipo: 'abrir'; id: string; stage: 'open' | 'history'; abrirCorrecao: boolean }

export function resolvePjOrderShortcut(
  search: string,
  candidatos: readonly PjOrderShortcutCandidate[],
): PjOrderShortcut {
  const parametros = new URLSearchParams(search)
  const paraCorrigir = parametros.get('corrigir')
  const alvoId = paraCorrigir || parametros.get('pedido')
  if (!alvoId) return { tipo: 'nenhum' }

  const alvo = candidatos.find(candidato => candidato.orderGroupId === alvoId)
  // Pedido fora da lista carregada (ela traz as 500 linhas mais recentes) não
  // é erro do atalho: a tela avisa em vez de ficar calada.
  if (!alvo) return { tipo: 'nao-encontrado', id: alvoId }

  return {
    tipo: 'abrir',
    id: alvoId,
    stage: alvo.stage,
    // Pedir correção num pedido que a Expedição ainda não liberou abriria a
    // janela sem o formulário, porque ele só existe depois da liberação. Aqui
    // isso vira "só abrir o pedido", e o Contas a receber já evita mandar.
    abrirCorrecao: Boolean(paraCorrigir) && alvo.dispatched,
  }
}
