import { PAYABLES_PERMISSION, type AppUser } from '@/lib/auth'

// Consumo semanal de insumos (fase 3A): o calculo vive no banco
// (inventory_consumption_periods / inventory_consumption_items). Aqui ficam so
// a leitura dos resultados para a tela: rotulos, resumo e quem pode ver.

export const CONSUMPTION_STORE = 'jc'

export type InventoryConsumptionPeriod = {
  period_start_count_id: string
  period_end_count_id: string
  period_start_date: string
  period_end_date: string
  period_days: number
  end_closed_at: string | null
  purchases_total: number | string
  purchases_counted: number | string
  purchases_outside_count: number | string
  purchases_unclassified: number | string
  purchases_not_stock: number | string
  unclassified_lines: number
  late_lines: number
}

export type InventoryConsumptionItem = {
  period_end_count_id: string
  product_id: string
  product_name: string
  product_category: string | null
  unit: string
  qty_start: number | string | null
  qty_in: number | string | null
  qty_end: number | string | null
  qty_consumed: number | string | null
  unit_cost: number | string | null
  value_consumed: number | string | null
  purchase_lines: number
  lines_without_quantity: number
  edge_lines: number
  late_lines: number
  status: string
}

export type ConsumptionStatusTone = 'ok' | 'warn' | 'blocked'

type StatusInfo = { label: string; hint: string; tone: ConsumptionStatusTone }

const STATUS_INFO: Record<string, StatusInfo> = {
  ok: { label: 'Ok', hint: '', tone: 'ok' },
  conferir: {
    label: 'Conferir',
    hint: 'Sobrou mais do que havia somado às compras: contagem errada ou nota faltando.',
    tone: 'warn',
  },
  sem_custo: {
    label: 'Sem custo',
    hint: 'Nenhuma nota nem custo no cadastro para dar valor ao consumo.',
    tone: 'warn',
  },
  incompleto: {
    label: 'Nota sem conversão',
    hint: 'Uma nota deste insumo ainda não tem a conversão para a unidade de estoque confirmada.',
    tone: 'blocked',
  },
  sem_par: {
    label: 'Contado só em uma semana',
    hint: 'O insumo entrou ou saiu da lista de contagem entre as duas semanas.',
    tone: 'blocked',
  },
  nao_contado: {
    label: 'Não contado',
    hint: 'Ficou sem quantidade em uma das duas contagens.',
    tone: 'blocked',
  },
  unidade_mudou: {
    label: 'Unidade mudou',
    hint: 'A unidade do cadastro mudou entre as duas contagens.',
    tone: 'blocked',
  },
}

// Valor novo vindo do banco nunca libera numero: cai como bloqueado com a
// chave crua visivel (licoes valor-novo-no-check e caso-padrao-na-fronteira).
export function consumptionStatusInfo(status: string): StatusInfo {
  return STATUS_INFO[status] ?? { label: status, hint: 'Situação desconhecida.', tone: 'blocked' }
}

export function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function canViewInventoryConsumption(user: AppUser | null): boolean {
  if (!user) return false
  if (user.role === 'admin') return true
  return Boolean(user.permissions?.some(permission =>
    permission.permission_key === PAYABLES_PERMISSION
    && (permission.scope === '*' || permission.scope === CONSUMPTION_STORE),
  ))
}

export type ConsumptionSummary = {
  totalValue: number
  itemsWithValue: number
  itemsBlocked: number
  itemsToCheck: number
  isPartial: boolean
  isIrregularPeriod: boolean
}

export function summarizeConsumption(
  period: InventoryConsumptionPeriod,
  items: InventoryConsumptionItem[],
): ConsumptionSummary {
  let totalValue = 0
  let itemsWithValue = 0
  let itemsBlocked = 0
  let itemsToCheck = 0
  let missingValue = false

  for (const item of items) {
    const info = consumptionStatusInfo(item.status)
    const value = toNumber(item.value_consumed)
    if (info.tone === 'blocked') itemsBlocked += 1
    if (item.status === 'conferir') itemsToCheck += 1
    if (info.tone !== 'blocked' && value !== null) {
      totalValue += value
      itemsWithValue += 1
    } else {
      missingValue = true
    }
  }

  return {
    totalValue: Math.round(totalValue * 100) / 100,
    itemsWithValue,
    itemsBlocked,
    itemsToCheck,
    isPartial: missingValue || period.unclassified_lines > 0,
    isIrregularPeriod: period.period_days !== 7,
  }
}

const TONE_ORDER: Record<ConsumptionStatusTone, number> = { blocked: 0, warn: 1, ok: 2 }

// Pendencias primeiro: o que impede o numero aparece no topo da lista.
export function sortConsumptionItems(items: InventoryConsumptionItem[]): InventoryConsumptionItem[] {
  return [...items].sort((a, b) => {
    const tone = TONE_ORDER[consumptionStatusInfo(a.status).tone] - TONE_ORDER[consumptionStatusInfo(b.status).tone]
    if (tone !== 0) return tone
    return (toNumber(b.value_consumed) ?? 0) - (toNumber(a.value_consumed) ?? 0)
  })
}

export function formatQuantity(value: number | string | null | undefined, unit: string): string {
  const parsed = toNumber(value)
  if (parsed === null) return '—'
  return `${parsed.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${unit}`
}

export function formatMoney(value: number | string | null | undefined): string {
  const parsed = toNumber(value)
  if (parsed === null) return '—'
  return parsed.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// Datas do banco chegam como 'YYYY-MM-DD'; montar pelo texto evita o
// deslocamento de fuso que new Date('YYYY-MM-DD') causa (meia-noite UTC).
export function formatPeriodDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-')
  if (!year || !month || !day) return isoDate
  return `${day}/${month}`
}
