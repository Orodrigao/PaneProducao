import type { PricingUnit } from './saleOptions'

export interface PjPackRule {
  productId: string
  productVariantId: string | null
  packSizeUnits: number
  minOrderPacks: number
  orderMultiplePacks: number
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

// Regra por variante primeiro; sem regra específica, cai na regra do produto
// sem variante (fallback legado). Nunca ignora uma regra que exista para a
// variante pedida.
export function resolvePjPackRule(
  rules: ReadonlyArray<PjPackRule>,
  productId: string,
  productVariantId: string | null
): PjPackRule | null {
  const specific = rules.find(
    (rule) => rule.productId === productId && rule.productVariantId === productVariantId
  )
  if (specific) return specific
  if (productVariantId === null) return null
  return rules.find((rule) => rule.productId === productId && rule.productVariantId === null) ?? null
}

// Peso físico de um pacote fechado na unidade de cobrança da linha. Em 'un'
// é o próprio tamanho do pacote; em 'kg' multiplica pelo peso médio de uma
// unidade (Brioche Hamburguer: 12 x 0,08 kg = 0,96 kg). Sem peso cadastrado
// não há como fechar em kg: retorna null (trava fechada, nunca adivinha).
export function pjPackPhysicalSize(
  rule: PjPackRule,
  pricingUnit: PricingUnit,
  unitWeightKg: number | null
): number | null {
  if (pricingUnit === 'un') return rule.packSizeUnits
  if (unitWeightKg === null || !Number.isFinite(unitWeightKg) || unitWeightKg <= 0) return null
  return round3(rule.packSizeUnits * unitWeightKg)
}

// A pessoa informa o número de pacotes, não unidades nem peso. Fração,
// arredondamento ou preenchimento automático esconderiam uma mudança de valor
// comercial; por isso a entrada inválida é recusada, nunca ajustada.
export function parseWholePjPackCount(rawValue: string): number | null {
  const normalized = rawValue.trim()
  if (!/^[1-9][0-9]*$/.test(normalized)) return null
  const packs = Number(normalized)
  return Number.isSafeInteger(packs) && packs > 0 ? packs : null
}
