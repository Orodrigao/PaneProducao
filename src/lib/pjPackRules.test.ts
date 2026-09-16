import { describe, expect, it } from 'vitest'
import { parseWholePjPackCount, pjPackPhysicalSize, resolvePjPackRule, type PjPackRule } from './pjPackRules'

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

describe('parseWholePjPackCount', () => {
  it('aceita somente pacotes inteiros positivos', () => {
    expect(parseWholePjPackCount('2')).toBe(2)
    expect(parseWholePjPackCount(' 12 ')).toBe(12)
  })

  it('recusa fração, peso, zero e texto sem arredondar silenciosamente', () => {
    expect(parseWholePjPackCount('1.5')).toBeNull()
    expect(parseWholePjPackCount('0,96')).toBeNull()
    expect(parseWholePjPackCount('0')).toBeNull()
    expect(parseWholePjPackCount('dois')).toBeNull()
  })
})
