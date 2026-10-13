// Usar um pedido antigo das lojas como base do pedido de outro dia.
//
// Até outubro de 2026 a tela inicial tinha "Duplicar para hoje": apagava o
// pedido de HOJE das lojas e gravava a cópia no lugar, sem confirmação. Em
// 26/09 e 29/09 isso trocou o pedido gerado pelo Planejamento pelo de outra
// semana (JC e JA juntas perderam 136 pães no primeiro dia e 59 no segundo).
// Quem apertava queria só começar o
// pedido do dia seguinte a partir de um antigo: salvava o dia seguinte logo
// depois. Agora a cópia só preenche o formulário do dia escolhido, e nada é
// gravado até a pessoa conferir e apertar Salvar.

export type OrderCopyStore = 'jc' | 'ja' | 'ex'

export interface OrderCopyBread {
  id: string
  name: string
}

export type OrderCopySourceRows = Readonly<Record<string, { quantity?: number | string | null } | undefined>>

export interface OrderCopyLeftOut {
  breadId: string
  name: string
  quantity: number
}

export interface OrderCopyResult {
  store: OrderCopyStore
  /** Quantidade por chave `${store}-${breadId}` para todo pão do dia de destino. */
  quantities: Record<string, number>
  copiedTotal: number
  /** Pães pedidos no dia de origem que não são feitos no dia de destino. */
  leftOut: OrderCopyLeftOut[]
}

function sourceQuantity(row: { quantity?: number | string | null } | undefined): number {
  const value = Number(row?.quantity ?? 0)
  return Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Monta as quantidades do formulário de `store` a partir do pedido de origem.
 * Todo pão do dia de destino recebe a quantidade da origem (zero se a origem
 * não pediu), como se a pessoa digitasse o pedido antigo de novo. O que a
 * origem pediu e o dia de destino não faz volta em `leftOut`, para a tela dizer.
 */
export function buildOrderCopy(
  store: OrderCopyStore,
  sourceRows: OrderCopySourceRows,
  targetBreads: readonly OrderCopyBread[],
  allBreads: readonly OrderCopyBread[],
): OrderCopyResult {
  const quantities: Record<string, number> = {}
  const targetIds = new Set<string>()
  let copiedTotal = 0
  for (const bread of targetBreads) {
    const quantity = sourceQuantity(sourceRows[bread.id])
    quantities[`${store}-${bread.id}`] = quantity
    targetIds.add(bread.id)
    copiedTotal += quantity
  }

  const names = new Map(allBreads.map(bread => [bread.id, bread.name]))
  const leftOut = Object.entries(sourceRows)
    .filter(([breadId, row]) => !targetIds.has(breadId) && sourceQuantity(row) > 0)
    .map(([breadId, row]) => ({ breadId, name: names.get(breadId) ?? breadId, quantity: sourceQuantity(row) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))

  return { store, quantities, copiedTotal, leftOut }
}

export interface OrderCopyTarget {
  store: OrderCopyStore
  /** O que o formulário do dia de destino tem agora, salvo ou digitado. */
  currentTotal: number
  copiedTotal: number
  /**
   * Esta data tem pedido gerado pelo Planejamento para a loja (pode ter sido
   * editado depois); null quando não deu para conferir.
   */
  fromPlanning: boolean | null
}

/**
 * Texto da confirmação antes de trocar o formulário. Só pergunta quando algum
 * formulário de destino já tem quantidade: copiar sobre um formulário vazio não
 * desfaz nada que a pessoa tenha feito.
 */
export function orderCopyConfirmation(
  sourceLabel: string,
  targetLabel: string,
  targets: readonly OrderCopyTarget[],
): string | null {
  if (!targets.some(target => target.currentTotal > 0)) return null
  const lines = targets.map(target => {
    const origin = target.fromPlanning === true
      ? ' (esta data tem pedido gerado pelo Planejamento)'
      : target.fromPlanning === null
        ? ' (não consegui conferir se esta data tem pedido do Planejamento)'
        : ''
    return `${target.store.toUpperCase()}: agora ${target.currentTotal}${origin}, cópia ${target.copiedTotal}`
  })
  return [
    `Trocar o pedido de ${targetLabel} pelas quantidades de ${sourceLabel}?`,
    '',
    ...lines,
    '',
    'Nada é salvo até você conferir e apertar Salvar pedido.',
  ].join('\n')
}
