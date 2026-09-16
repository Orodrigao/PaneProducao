import { describe, expect, it } from 'vitest'
import { pjPackPhysicalSize, resolvePjPackRule, roundPjPackQuantity, type PjPackRule } from './pjPackRules'

const hamburguer: PjPackRule = {
  productId: 'brioche',
  productVariantId: 'hamburguer',
  packSizeUnits: 12,
  minOrderPacks: 1,
  orderMultiplePacks: 1,
}

const semVariante: PjPackRule = {
  productId: 'baguete',
  productVariantId: null,
  packSizeUnits: 6,
  minOrderPacks: 2,
  orderMultiplePacks: 1,
}

describe('resolvePjPackRule', () => {
  it('encontra a regra específica da variante', () => {
    expect(resolvePjPackRule([hamburguer], 'brioche', 'hamburguer')).toEqual(hamburguer)
  })

  it('não confunde variantes diferentes do mesmo produto', () => {
    expect(resolvePjPackRule([hamburguer], 'brioche', 'forma')).toBeNull()
  })

  it('cai na regra do produto sem variante quando não há regra específica', () => {
    expect(resolvePjPackRule([semVariante], 'baguete', 'alguma-variante-futura')).toEqual(semVariante)
  })

  it('produto sem qualquer regra cadastrada não aplica pacote', () => {
    expect(resolvePjPackRule([hamburguer, semVariante], 'foccacia', null)).toBeNull()
  })
})

describe('pjPackPhysicalSize', () => {
  it('em un usa o tamanho do pacote direto', () => {
    expect(pjPackPhysicalSize(hamburguer, 'un', null)).toBe(12)
  })

  it('em kg converte pelo peso unitário: 12 x 80g = 0,96kg', () => {
    expect(pjPackPhysicalSize(hamburguer, 'kg', 0.08)).toBe(0.96)
  })

  it('em kg sem peso cadastrado falha fechado (null, nunca adivinha)', () => {
    expect(pjPackPhysicalSize(hamburguer, 'kg', null)).toBeNull()
    expect(pjPackPhysicalSize(hamburguer, 'kg', 0)).toBeNull()
  })
})

describe('roundPjPackQuantity', () => {
  it('quantidade já em pacote fechado não muda (12 un)', () => {
    const result = roundPjPackQuantity(12, hamburguer, 12)
    expect(result).toEqual({ packs: 1, quantity: 12, packSizePhysical: 12, rounded: false })
  })

  it('quantidade não múltipla arredonda para cima, nunca para baixo (10 -> 12 un)', () => {
    const result = roundPjPackQuantity(10, hamburguer, 12)
    expect(result.packs).toBe(1)
    expect(result.quantity).toBe(12)
    expect(result.rounded).toBe(true)
  })

  it('conversão 12 unidades x 80g fecha em 0,96kg quando o preço é por kg', () => {
    const physical = pjPackPhysicalSize(hamburguer, 'kg', 0.08) as number
    const result = roundPjPackQuantity(0.5, hamburguer, physical)
    expect(result.packs).toBe(1)
    expect(result.quantity).toBe(0.96)
    expect(result.rounded).toBe(true)
  })

  it('quantidade exatamente igual ao pacote em kg não arredonda', () => {
    const physical = pjPackPhysicalSize(hamburguer, 'kg', 0.08) as number
    const result = roundPjPackQuantity(0.96, hamburguer, physical)
    expect(result.quantity).toBe(0.96)
    expect(result.rounded).toBe(false)
  })

  it('abaixo do pedido mínimo sobe até o mínimo em pacotes', () => {
    const result = roundPjPackQuantity(3, semVariante, 6)
    expect(result.packs).toBe(2)
    expect(result.quantity).toBe(12)
    expect(result.rounded).toBe(true)
  })

  it('respeita o múltiplo comercial de pacotes', () => {
    const rule: PjPackRule = { ...hamburguer, orderMultiplePacks: 2 }
    const result = roundPjPackQuantity(12, rule, 12)
    expect(result.packs).toBe(2)
    expect(result.quantity).toBe(24)
    expect(result.rounded).toBe(true)
  })

  it('quantidade inválida cai no pedido mínimo', () => {
    const result = roundPjPackQuantity(0, hamburguer, 12)
    expect(result.packs).toBe(1)
    expect(result.quantity).toBe(12)
    expect(result.rounded).toBe(true)
  })
})
