import { pjLineValue as valorPeloQueSaiu } from './pjOrderValue'

/**
 * Conta do faturamento PJ a partir das linhas de `orders`.
 *
 * Regra única: a linha do pedido já guarda a quantidade final vendida.
 * Quando o produto é vendido em pacote, `/pedidos-pj` grava
 * `quantity = pacotes × pack_size` (12 packs de 21 → 252 unidades) e o total
 * do pedido é sempre `unit_price × quantity`. `pack_size` fica na linha apenas
 * para exibir "12×pack21" — multiplicar por ele de novo cobra o cliente a mais.
 *
 * Ver lessons.md 2026-07-21 (validar-tambem-na-saida): número que vira dinheiro
 * precisa da mesma conta na entrada e na saída.
 *
 * Desde a fase 2 do peso real (2026-09), a linha vale pelo que a Expedição
 * conferiu, e não pela estimativa. A regra mora em `pjOrderValue.ts`, um lugar
 * só, espelhando `private.valor_linha_pj` no banco: sem isso o relatório e o
 * Contas a receber davam números diferentes para a mesma pergunta.
 */

export interface PjSalesLine {
  quantity: number | string | null | undefined
  unit_price: number | string | null | undefined
  pricing_unit: 'un' | 'kg' | string | null | undefined
  dispatched_quantity?: number | string | null | undefined
  dispatched_at?: string | null | undefined
}

export type PjSalesUnit = 'un' | 'kg'

function asNumber(value: number | string | null | undefined): number {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

/**
 * Valor em reais da linha, pelo que saiu.
 *
 * Cai para a estimativa quando não há valor cobrável (pedido ainda não enviado,
 * ou enviado sem conferência depois do marco). O relatório precisa mostrar
 * alguma coisa; quem recusa cobrar é o motor, não a leitura.
 */
export function pjLineValue(line: PjSalesLine): number {
  const real = valorPeloQueSaiu({
    quantity: line.quantity,
    dispatchedQuantity: line.dispatched_quantity ?? null,
    unitPrice: line.unit_price,
    dispatchedAt: line.dispatched_at ?? null,
    pricingUnit: line.pricing_unit ?? null,
  })
  if (real !== null) return real
  return asNumber(line.unit_price) * asNumber(line.quantity)
}

/** Quantidade que a linha realmente entregou, para o relatório por produto. */
export function pjLineDispatchedQuantity(line: PjSalesLine): number {
  const conferido = line.dispatched_quantity
  if (conferido === null || conferido === undefined || conferido === '') {
    return asNumber(line.quantity)
  }
  const numeric = Number(conferido)
  return Number.isFinite(numeric) ? numeric : asNumber(line.quantity)
}

/** Quantidade física vendida na linha, na unidade em que foi precificada. */
export function pjLineUnits(line: PjSalesLine): { qty: number; unit: PjSalesUnit } {
  return {
    qty: pjLineDispatchedQuantity(line),
    unit: line.pricing_unit === 'kg' ? 'kg' : 'un',
  }
}
