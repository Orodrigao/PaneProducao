export const OVEN_LOSS_REASONS = [
  'Queimou',
  'Fora do padrão',
  'Caiu ou contaminou',
  'Outro',
] as const

export type OvenLossReason = typeof OVEN_LOSS_REASONS[number]

export interface OvenPlanRow {
  bread_id?: string | null
  product_source?: string | null
  product_id?: string | null
  product_variant_id?: string | null
  quantity: number | null
}

export interface OvenConfirmationInput {
  quantityGood: string
  quantityLoss: string
  lossReason: string
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export function ovenLotCode(isoDate: string): string {
  const match = ISO_DATE_PATTERN.exec(isoDate)
  if (!match) throw new Error('Data de produção inválida.')

  const [, year, month, day] = match
  const parsed = new Date(`${year}-${month}-${day}T00:00:00Z`)
  const isSameDate = parsed.getUTCFullYear() === Number(year)
    && parsed.getUTCMonth() + 1 === Number(month)
    && parsed.getUTCDate() === Number(day)

  if (!isSameDate) throw new Error('Data de produção inválida.')
  return `L${month}${day}`
}

// productVariantId só se aplica a product_source = 'product'; pão legado
// nunca tem variante. Omitir o terceiro argumento reproduz a chave antiga,
// então consumidores que nunca lidam com variante não precisam mudar.
export function ovenProductKey(productSource: string, productId: string, productVariantId?: string | null): string {
  return productVariantId ? `${productSource}:${productId}:${productVariantId}` : `${productSource}:${productId}`
}

export function ovenPlanRowKey(row: OvenPlanRow): string | null {
  if (row.product_id) {
    return ovenProductKey(
      row.product_source === 'product' ? 'product' : 'bread',
      row.product_id,
      row.product_source === 'product' ? row.product_variant_id : null,
    )
  }
  // Consumidores antigos agregam apenas por bread_id. Manter essa forma evita
  // alterar relatórios que ainda não trabalham com duas origens de identidade.
  return row.bread_id || null
}

export function aggregateOvenPlan(rows: OvenPlanRow[]): Map<string, number> {
  const result = new Map<string, number>()

  for (const row of rows) {
    const quantity = Number(row.quantity ?? 0)
    const key = ovenPlanRowKey(row)
    if (!key || !Number.isFinite(quantity) || quantity <= 0) continue
    result.set(key, (result.get(key) ?? 0) + quantity)
  }

  return result
}

export interface OvenPjShortageWarning {
  pjQuantity: number | null
  totalShortage: number
}

// O Forno confirma o produto agregado, sem decidir qual canal recebeu cada
// unidade. Por isso o resultado avisa que existe PJ envolvido, mas não atribui
// automaticamente a falta a um cliente nem recria programação.
export function ovenPjShortageWarning(
  plannedQuantity: number,
  pjQuantity: number,
  quantityGood: number,
  hasPjInvolvement: boolean = pjQuantity > 0,
): OvenPjShortageWarning | null {
  if (![plannedQuantity, pjQuantity, quantityGood].every(Number.isFinite)) return null
  if (
    plannedQuantity <= 0
    || pjQuantity < 0
    || quantityGood < 0
    || !hasPjInvolvement
    || quantityGood >= plannedQuantity
  ) return null

  return {
    pjQuantity: pjQuantity > 0 ? pjQuantity : null,
    totalShortage: Math.round((plannedQuantity - quantityGood) * 1_000) / 1_000,
  }
}

export function formatOvenQuantity(quantity: number, unit: 'un' | 'kg'): string {
  const value = unit === 'kg'
    ? quantity.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
    : String(Math.trunc(quantity))
  return `${value} ${unit}`
}

export interface OvenPlanRowWithWeightFlag extends OvenPlanRow {
  needs_weight_setup?: boolean | null
}

// Pedido PJ cobrado por peso de um pão vendido por unidade só entra no
// previsto convertido por um peso médio cadastrado (breads.avg_unit_weight_kg).
// Sem esse peso, list_pj_production_for_oven_v2 deixa a parcela em kg fora da
// soma e marca needs_weight_setup — aqui só juntamos as chaves marcadas para
// o Forno avisar que o previsto daquele pão pode estar incompleto.
export function collectWeightSetupWarnings(rows: OvenPlanRowWithWeightFlag[]): Set<string> {
  const warnings = new Set<string>()

  for (const row of rows) {
    if (!row.needs_weight_setup) continue
    const key = ovenPlanRowKey(row)
    if (key) warnings.add(key)
  }

  return warnings
}

export function parseOvenQuantity(value: string, unit: string = 'un'): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) return null
  const quantity = Number(normalized)
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > 1_000_000) return null
  if (unit !== 'kg' && !Number.isSafeInteger(quantity)) return null
  return quantity
}

export function validateOvenConfirmation(input: OvenConfirmationInput, unit: string = 'un'): string | null {
  const quantityGood = parseOvenQuantity(input.quantityGood, unit)
  const quantityLoss = parseOvenQuantity(input.quantityLoss, unit)

  if (quantityGood === null) return unit === 'kg'
    ? 'Informe a saída boa com até 3 casas decimais.'
    : 'Informe a saída boa em unidades inteiras.'
  if (quantityLoss === null) return unit === 'kg'
    ? 'Informe a perda com até 3 casas decimais.'
    : 'Informe a perda em unidades inteiras.'
  if (quantityLoss > 0 && !OVEN_LOSS_REASONS.includes(input.lossReason as OvenLossReason)) {
    return 'Escolha o motivo da perda.'
  }
  return null
}
