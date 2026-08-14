import { describe, expect, it } from 'vitest'
import { normalizeOrderLinePacksInput, orderLinePacksFromStoredQuantity } from './pjOrderQuantity'

describe('quantidades de Pedido PJ', () => {
  it('aceita 800 g como 0,800 kg no lançamento', () => {
    expect(normalizeOrderLinePacksInput('0.800', 'kg')).toBe(0.8)
  })

  it('preserva 800 g ao reabrir um pedido para edição', () => {
    expect(orderLinePacksFromStoredQuantity(0.8, 1, 'kg')).toBe(0.8)
  })

  it('continua arredondando quantidade por unidade', () => {
    expect(normalizeOrderLinePacksInput('1.6', 'un')).toBe(2)
    expect(orderLinePacksFromStoredQuantity(19, 12, 'un')).toBe(2)
  })
})
