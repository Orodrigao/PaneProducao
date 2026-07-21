import { describe, expect, it } from 'vitest'
import {
  billingUnitForRomaneioProduct,
  calculateRomaneioBilling,
  explicitUnitInRomaneioProduct,
  isBuckPriceTierName,
} from './romaneioBilling'

describe('romaneioBilling', () => {
  it('aplica kg somente para ciabatta e mini croissant', () => {
    expect(billingUnitForRomaneioProduct('Ciabatta (kg)')).toBe('kg')
    expect(billingUnitForRomaneioProduct('Mini Croissant')).toBe('kg')
    expect(billingUnitForRomaneioProduct('Baguete')).toBe('un')
    expect(billingUnitForRomaneioProduct('Pão Italiano')).toBe('un')
  })

  it('identifica somente a tabela BUCK para a cobrança da EX', () => {
    expect(isBuckPriceTierName('BUCK')).toBe(true)
    expect(isBuckPriceTierName(' buck ')).toBe(true)
    expect(isBuckPriceTierName('Buck - Exposição')).toBe(false)
    expect(isBuckPriceTierName('Atacado BUCK')).toBe(false)
  })

  it('calcula cobrança pela quantidade aceita, ou enviada sem conferência', () => {
    const result = calculateRomaneioBilling([
      { id: 'i1', romaneioId: 'r1', productId: 'baguete', productSource: 'bread', productName: 'Baguete', qtySent: 10, qtyAccepted: 9 },
      { id: 'i2', romaneioId: 'r1', productId: 'ciabatta', productSource: 'bread', productName: 'Ciabatta (kg)', qtySent: 3.2, qtyAccepted: null },
      { id: 'i3', romaneioId: 'r2', productId: 'mini', productSource: 'bread', productName: 'Mini Croissant (kg)', qtySent: 1.5 },
    ], [
      { productId: 'baguete', productSource: 'bread', unitPrice: 4, pricingUnit: 'un' },
      { productId: 'ciabatta', productSource: 'bread', unitPrice: 20, pricingUnit: 'kg' },
      { productId: 'mini', productSource: 'bread', unitPrice: 30, pricingUnit: 'kg' },
    ])

    expect(result.hasBlockingIssues).toBe(false)
    expect(result.tripCount).toBe(2)
    expect(result.total).toBe(145)
    expect(result.rows.map(row => [row.productName, row.billedQuantity, row.total])).toEqual([
      ['Baguete', 9, 36],
      ['Ciabatta (kg)', 3.2, 64],
      ['Mini Croissant (kg)', 1.5, 45],
    ])
  })

  it('não inclui no total itens sem preço ou com unidade incompatível', () => {
    const result = calculateRomaneioBilling([
      { id: 'i1', romaneioId: 'r1', productId: 'italiano', productSource: 'bread', productName: 'Italiano', qtySent: 5 },
      { id: 'i2', romaneioId: 'r2', productId: 'ciabatta', productSource: 'bread', productName: 'Ciabatta (un)', qtySent: 3 },
    ], [
      { productId: 'ciabatta', productSource: 'bread', unitPrice: 20, pricingUnit: 'kg' },
    ])

    expect(result.total).toBe(0)
    expect(result.hasBlockingIssues).toBe(true)
    expect(result.rows.find(row => row.productName === 'Italiano')?.issues).toEqual(['missing_price'])
    expect(result.rows.find(row => row.productName === 'Ciabatta (un)')?.issues).toEqual(['unit_mismatch'])
  })

  it('bloqueia preço cadastrado em unidade diferente da cobrança', () => {
    const result = calculateRomaneioBilling([
      { id: 'i1', romaneioId: 'r1', productId: 'baguete', productSource: 'bread', productName: 'Baguete', qtySent: 5 },
    ], [
      { productId: 'baguete', productSource: 'bread', unitPrice: 18, pricingUnit: 'kg' },
    ])

    expect(result.rows[0].issues).toEqual(['unit_mismatch'])
    expect(result.total).toBe(0)
  })

  it('identifica a unidade explícita exibida no romaneio', () => {
    expect(explicitUnitInRomaneioProduct('Ciabatta (kg)')).toBe('kg')
    expect(explicitUnitInRomaneioProduct('Ciabatta (un)')).toBe('un')
    expect(explicitUnitInRomaneioProduct('Baguete')).toBeNull()
  })

  // Casos reais de produção (2026-07): romaneio grava o pão legado, mas a
  // Tabela Buck guarda o preço no produto unificado ligado por legacy_bread_id.
  it('encontra o preço salvo no produto unificado para item enviado como pão legado', () => {
    const result = calculateRomaneioBilling([
      { id: 'i1', romaneioId: 'r1', productId: 'b_brasil_legado', productSource: 'bread', productName: 'B.Brasil', qtySent: 24 },
      { id: 'i2', romaneioId: 'r1', productId: 'brioche_hamb_legado', productSource: 'bread', productName: 'Brioche Hamburguer', qtySent: 56 },
    ], [
      { productId: 'uuid-bbrasil', productSource: 'product', unitPrice: 1.44, pricingUnit: 'un' },
      { productId: 'uuid-brioche', productSource: 'product', unitPrice: 1.37, pricingUnit: 'un' },
    ], [
      { productId: 'uuid-bbrasil', legacyBreadId: 'b_brasil_legado' },
      { productId: 'uuid-brioche', legacyBreadId: 'brioche_hamb_legado' },
    ])

    expect(result.hasBlockingIssues).toBe(false)
    expect(result.rows.map(row => [row.productName, row.unitPrice, row.total])).toEqual([
      ['B.Brasil', 1.44, 24 * 1.44],
      ['Brioche Hamburguer', 1.37, 56 * 1.37],
    ])
  })

  it('preço direto do pão legado vence o preço do produto unificado', () => {
    const result = calculateRomaneioBilling([
      { id: 'i1', romaneioId: 'r1', productId: 'croissant_legado', productSource: 'bread', productName: 'Croissant', qtySent: 40 },
    ], [
      { productId: 'croissant_legado', productSource: 'bread', unitPrice: 4.65, pricingUnit: 'un' },
      { productId: 'uuid-croissant', productSource: 'product', unitPrice: 9.99, pricingUnit: 'un' },
    ], [
      { productId: 'uuid-croissant', legacyBreadId: 'croissant_legado' },
    ])

    expect(result.rows[0].unitPrice).toBe(4.65)
    expect(result.rows[0].issues).toEqual([])
  })

  it('produto de nome parecido sem vínculo não casa: item segue sem preço', () => {
    const result = calculateRomaneioBilling([
      { id: 'i1', romaneioId: 'r1', productId: 'baguete_legado', productSource: 'bread', productName: 'Baguete', qtySent: 15 },
    ], [
      { productId: 'uuid-baguete-francesa', productSource: 'product', unitPrice: 6.5, pricingUnit: 'un' },
    ], [
      { productId: 'uuid-baguete-francesa', legacyBreadId: null },
    ])

    expect(result.rows[0].issues).toEqual(['missing_price'])
    expect(result.total).toBe(0)
  })

  it('encontra pelo vínculo também na direção inversa (item unificado, preço no pão)', () => {
    const result = calculateRomaneioBilling([
      { id: 'i1', romaneioId: 'r1', productId: 'uuid-sarraceno', productSource: 'product', productName: 'Sarraceno', qtySent: 6 },
    ], [
      { productId: 'sarraceno_legado', productSource: 'bread', unitPrice: 12, pricingUnit: 'un' },
    ], [
      { productId: 'uuid-sarraceno', legacyBreadId: 'sarraceno_legado' },
    ])

    expect(result.rows[0].unitPrice).toBe(12)
    expect(result.total).toBe(72)
  })

  it('preço da ponte em unidade diferente vira unidade incompatível, não falta de preço', () => {
    const result = calculateRomaneioBilling([
      { id: 'i1', romaneioId: 'r1', productId: 'italiano_legado', productSource: 'bread', productName: 'Italiano', qtySent: 30 },
    ], [
      { productId: 'uuid-italiano', productSource: 'product', unitPrice: 18, pricingUnit: 'kg' },
    ], [
      { productId: 'uuid-italiano', legacyBreadId: 'italiano_legado' },
    ])

    expect(result.rows[0].issues).toEqual(['unit_mismatch'])
    expect(result.total).toBe(0)
  })

  it('preço zerado na identidade direta não esconde o preço válido da ponte', () => {
    const result = calculateRomaneioBilling([
      { id: 'i1', romaneioId: 'r1', productId: 'pizza_legado', productSource: 'bread', productName: 'Pizza Redonda', qtySent: 4 },
    ], [
      { productId: 'pizza_legado', productSource: 'bread', unitPrice: 0, pricingUnit: 'un' },
      { productId: 'uuid-pizza', productSource: 'product', unitPrice: 25, pricingUnit: 'un' },
    ], [
      { productId: 'uuid-pizza', legacyBreadId: 'pizza_legado' },
    ])

    expect(result.rows[0].unitPrice).toBe(25)
    expect(result.rows[0].issues).toEqual([])
    expect(result.total).toBe(100)
  })
})
