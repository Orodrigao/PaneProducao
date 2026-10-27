// Observação que a loja escreve no pedido de produção. O Salvar grava o mesmo
// texto em todas as linhas da loja, mas o banco escreve por cima a marca do
// Planejamento: a importação em todas as linhas e a confirmação da sobra só na
// linha do pão confirmado. Por isso o texto da loja vem da primeira linha que
// o tiver, nunca da primeira linha qualquer.

export const PLANNING_ORDER_OBS = 'Gerado pelo Planejamento'

export interface OrderNoteRow {
  obs?: string | null
}

export type StoreOrderNoteMap = Record<string, Record<string, OrderNoteRow> | undefined>

export interface StoreOrderNoteEntry {
  store: string
  note: string
}

function trimmedObs(row: OrderNoteRow): string {
  return (row.obs ?? '').trim()
}

// O recado da loja para a produção. A marca do Planejamento não é recado.
export function storeOrderNote(rows: readonly OrderNoteRow[]): string {
  for (const row of rows) {
    const text = trimmedObs(row)
    if (text && text !== PLANNING_ORDER_OBS) return text
  }
  return ''
}

// O formulário reabre o recado da loja; sem recado, o que estiver gravado
// (a marca do Planejamento), que o Salvar regrava como antes.
export function storeOrderFormObs(rows: readonly OrderNoteRow[]): string {
  return storeOrderNote(rows) || rows.map(trimmedObs).find(Boolean) || ''
}

// Recados das lojas na ordem pedida, só das que escreveram algo.
export function storeOrderNotes(orders: StoreOrderNoteMap, stores: readonly string[]): StoreOrderNoteEntry[] {
  return stores.flatMap(store => {
    const note = storeOrderNote(Object.values(orders[store] ?? {}))
    return note ? [{ store, note }] : []
  })
}
