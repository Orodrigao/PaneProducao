import { describe, expect, it } from 'vitest'
import { isCatalogItemAlreadyPriced, isLegacyBreadUnified } from './catalog'

describe('catálogo das tabelas de preço', () => {
  it('esconde o pão legado quando ele já possui produto unificado', () => {
    expect(isLegacyBreadUnified('mini-croissant-legado', new Set(['mini-croissant-legado']))).toBe(true)
    expect(isLegacyBreadUnified('mini-croissant-legado', new Set(['brioche-legado']))).toBe(false)
  })

  it('reconhece o preço legado ativo do produto unificado pela unidade de venda', () => {
    const tierItems = [{
      product_id: 'mini-croissant-legado',
      product_source: 'bread' as const,
      pricing_unit: 'un' as const,
    }]

    expect(isCatalogItemAlreadyPriced({
      id: 'mini-croissant-produto',
      _source: 'product',
      pricing_unit: 'un',
      legacy_bread_id: 'mini-croissant-legado',
    }, tierItems)).toBe(true)

    expect(isCatalogItemAlreadyPriced({
      id: 'mini-croissant-produto',
      _source: 'product',
      pricing_unit: 'kg',
      legacy_bread_id: 'mini-croissant-legado',
    }, tierItems)).toBe(false)
  })

  it('reconhece a mesma forma de venda do produto atual', () => {
    const tierItems = [{
      product_id: 'mini-croissant-produto',
      product_source: 'product' as const,
      pricing_unit: 'kg' as const,
    }]

    expect(isCatalogItemAlreadyPriced({
      id: 'mini-croissant-produto',
      _source: 'product',
      pricing_unit: 'kg',
    }, tierItems)).toBe(true)
  })
})
