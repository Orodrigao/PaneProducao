export const OVEN_LOSS_REASONS = [
  'Queimou',
  'Fora do padrão',
  'Caiu ou contaminou',
  'Outro',
] as const

export type OvenLossReason = typeof OVEN_LOSS_REASONS[number]

export interface OvenPlanRow {
  bread_id: string
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

export function aggregateOvenPlan(rows: OvenPlanRow[]): Map<string, number> {
  const result = new Map<string, number>()

  for (const row of rows) {
    const quantity = Number(row.quantity ?? 0)
    if (!row.bread_id || !Number.isFinite(quantity) || quantity <= 0) continue
    result.set(row.bread_id, (result.get(row.bread_id) ?? 0) + quantity)
  }

  return result
}

export function parseOvenQuantity(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null
  const quantity = Number(value)
  return Number.isSafeInteger(quantity) && quantity >= 0 ? quantity : null
}

export function validateOvenConfirmation(input: OvenConfirmationInput): string | null {
  const quantityGood = parseOvenQuantity(input.quantityGood)
  const quantityLoss = parseOvenQuantity(input.quantityLoss)

  if (quantityGood === null) return 'Informe a saída boa em unidades inteiras.'
  if (quantityLoss === null) return 'Informe a perda em unidades inteiras.'
  if (quantityLoss > 0 && !OVEN_LOSS_REASONS.includes(input.lossReason as OvenLossReason)) {
    return 'Escolha o motivo da perda.'
  }
  return null
}
