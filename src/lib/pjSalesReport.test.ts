import { describe, expect, it } from 'vitest'

import { pjLineUnits, pjLineValue } from './pjSalesReport'

describe('pjLineValue', () => {
  it('cobra preço × quantidade quando o produto é vendido por unidade', () => {
    expect(pjLineValue({ quantity: 20, unit_price: 3.45, pricing_unit: 'un' })).toBeCloseTo(69, 2)
  })

  it('cobra preço × quantidade quando o produto é vendido por quilo', () => {
    expect(pjLineValue({ quantity: 4.5, unit_price: 32, pricing_unit: 'kg' })).toBeCloseTo(144, 2)
  })

  // Casos reais de produção que o relatório antigo inflava por multiplicar o
  // pacote duas vezes. Ver lessons.md 2026-07-21 (validar-tambem-na-saida).
  it('não multiplica o pacote de novo: BECO DUDE, 12 packs de 21 brioches', () => {
    expect(pjLineValue({ quantity: 252, unit_price: 1.6, pricing_unit: 'un' })).toBeCloseTo(403.2, 2)
  })

  it('não multiplica o pacote de novo: LA BRASA PATIO, 1 pack de 100 hambúrgueres', () => {
    expect(pjLineValue({ quantity: 100, unit_price: 2.2, pricing_unit: 'un' })).toBeCloseTo(220, 2)
  })

  it('trata linha sem preço ou quantidade como zero', () => {
    expect(pjLineValue({ quantity: null, unit_price: null, pricing_unit: null })).toBe(0)
    expect(pjLineValue({ quantity: 10, unit_price: 'abc', pricing_unit: 'un' })).toBe(0)
  })

  it('aceita número em texto, como o Supabase devolve numeric', () => {
    expect(pjLineValue({ quantity: '252.000', unit_price: '1.6', pricing_unit: 'un' })).toBeCloseTo(403.2, 2)
  })
})

describe('pjLineUnits', () => {
  it('devolve a quantidade já final em unidades, sem repetir o pacote', () => {
    expect(pjLineUnits({ quantity: 252, unit_price: 1.6, pricing_unit: 'un' })).toEqual({ qty: 252, unit: 'un' })
  })

  it('devolve quilos quando o preço é por quilo', () => {
    expect(pjLineUnits({ quantity: 4.5, unit_price: 32, pricing_unit: 'kg' })).toEqual({ qty: 4.5, unit: 'kg' })
  })

  it('assume unidade quando a linha antiga não informa a unidade de preço', () => {
    expect(pjLineUnits({ quantity: 3, unit_price: 5, pricing_unit: null })).toEqual({ qty: 3, unit: 'un' })
  })
})
