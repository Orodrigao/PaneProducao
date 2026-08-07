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
 */

export interface PjSalesLine {
  quantity: number | string | null | undefined
  unit_price: number | string | null | undefined
  pricing_unit: 'un' | 'kg' | string | null | undefined
}

export type PjSalesUnit = 'un' | 'kg'

function asNumber(value: number | string | null | undefined): number {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

/** Valor em reais da linha do pedido. */
export function pjLineValue(line: PjSalesLine): number {
  return asNumber(line.unit_price) * asNumber(line.quantity)
}

/** Quantidade física vendida na linha, na unidade em que foi precificada. */
export function pjLineUnits(line: PjSalesLine): { qty: number; unit: PjSalesUnit } {
  return {
    qty: asNumber(line.quantity),
    unit: line.pricing_unit === 'kg' ? 'kg' : 'un',
  }
}
