import type { PricingUnit } from './saleOptions'

export interface PjPackRule {
  productId: string
  productVariantId: string | null
  packSizeUnits: number
  minOrderPacks: number
  orderMultiplePacks: number
}

export interface PjPackRounding {
  packs: number
  quantity: number
  packSizePhysical: number
  rounded: boolean
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6
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

// Arredonda a quantidade pedida para o pacote fechado imediatamente acima:
// nunca para baixo, nunca aceita fração de pacote. Quantidade inválida ou
// pacote sem peso cai no pedido mínimo, o menor pacote fechado que existe.
export function roundPjPackQuantity(requestedQuantity: number, rule: PjPackRule, packSizePhysical: number): PjPackRounding {
  const minPacks = Math.max(1, Math.ceil(rule.minOrderPacks))
  const multiple = Math.max(1, Math.ceil(rule.orderMultiplePacks))

  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0 || !Number.isFinite(packSizePhysical) || packSizePhysical <= 0) {
    const packs = roundUpToMultiple(minPacks, multiple)
    return { packs, quantity: round3(packs * packSizePhysical), packSizePhysical, rounded: true }
  }

  const rawPacks = round6(requestedQuantity / packSizePhysical)
  let packs = Math.ceil(rawPacks)
  if (packs < minPacks) packs = minPacks
  packs = roundUpToMultiple(packs, multiple)

  const quantity = round3(packs * packSizePhysical)
  const rounded = Math.abs(quantity - requestedQuantity) > 1e-9
  return { packs, quantity, packSizePhysical, rounded }
}

function roundUpToMultiple(packs: number, multiple: number): number {
  const remainder = packs % multiple
  return remainder === 0 ? packs : packs + (multiple - remainder)
}
