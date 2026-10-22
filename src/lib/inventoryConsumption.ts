import { PAYABLES_PERMISSION, RECEIVABLES_PERMISSION, type AppUser } from '@/lib/auth'

// Consumo semanal de insumos (fase 3A) e CMV sobre a venda (fase 3B): o
// calculo vive no banco (inventory_consumption_periods / _items / _revenue /
// _outside_items). Aqui ficam so a leitura dos resultados para a tela:
// rotulos, resumo e quem pode ver.

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

// Venda que divide o consumo da JC: caixa da JC e da JA (uma contabilidade so)
// + cobrancas de pedido PJ + cobrancas da EX, que compra da JC como cliente PJ.
export type InventoryConsumptionRevenue = {
  period_end_count_id: string
  cash_jc: number | string
  cash_jc_days: number
  cash_ja: number | string
  cash_ja_days: number
  cash_ifood: number | string
  cash_jc_missing_days: number
  cash_ja_missing_days: number
  pj_orders: number | string
  pj_orders_lines: number
  ex_billed: number | string
  ex_days_billed: number
  revenue_total: number | string
}

export type InventoryConsumptionOutsideItem = {
  period_end_count_id: string
  product_id: string
  product_name: string
  product_category: string | null
  purchases_count: number
  value_purchased: number | string
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

// A venda expoe o faturamento dos clientes PJ: alem do Contas a pagar da JC,
// exige o Contas a receber, como a funcao do banco.
export function canViewConsumptionRevenue(user: AppUser | null): boolean {
  if (!canViewInventoryConsumption(user)) return false
  if (user?.role === 'admin') return true
  return Boolean(user?.permissions?.some(permission =>
    permission.permission_key === RECEIVABLES_PERMISSION
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

export type RevenueGap = 'cobranca_ex' | 'caixa_faltando' | 'sem_venda'

export type CmvOverRevenue = {
  revenueTotal: number
  // null quando nao ha venda para dividir: nunca "0%" nem "infinito".
  percent: number | null
  gaps: RevenueGap[]
  // Parcial quando o consumo ou a venda estao incompletos, ou quando ha insumo
  // para conferir (consumo negativo puxa o total para baixo): o % existe, mas
  // a tela avisa que ele nao fecha.
  isPartial: boolean
}

export function cmvOverRevenue(
  period: InventoryConsumptionPeriod,
  summary: ConsumptionSummary,
  revenue: InventoryConsumptionRevenue,
): CmvOverRevenue {
  const revenueTotal = toNumber(revenue.revenue_total) ?? 0
  const gaps: RevenueGap[] = []
  if (revenue.ex_days_billed < period.period_days) gaps.push('cobranca_ex')
  if (revenue.cash_jc_missing_days > 0 || revenue.cash_ja_missing_days > 0) gaps.push('caixa_faltando')
  if (revenueTotal <= 0) gaps.push('sem_venda')
  // Sem nenhum insumo com valor nao existe consumo: "0%" seria mentira.
  const percent = revenueTotal > 0 && summary.itemsWithValue > 0
    ? Math.round((summary.totalValue / revenueTotal) * 1000) / 10
    : null
  return {
    revenueTotal,
    percent,
    gaps,
    isPartial: summary.isPartial || summary.itemsToCheck > 0 || gaps.length > 0,
  }
}

export function formatPercent(value: number | null): string {
  if (value === null) return '—'
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

// Uma linha por semana para o quadro de evolucao, da mais recente para a mais
// antiga (a mesma ordem do banco). A venda falta quando a pessoa nao pode ve-la.
export type ConsumptionTrendRow = {
  period: InventoryConsumptionPeriod
  summary: ConsumptionSummary
  cmv: CmvOverRevenue | null
}

export function buildConsumptionTrend(
  periods: InventoryConsumptionPeriod[],
  items: InventoryConsumptionItem[],
  revenues: InventoryConsumptionRevenue[] | null,
): ConsumptionTrendRow[] {
  return periods.map(period => {
    const periodItems = items.filter(item => item.period_end_count_id === period.period_end_count_id)
    const summary = summarizeConsumption(period, periodItems)
    const revenue = revenues?.find(row => row.period_end_count_id === period.period_end_count_id)
    return { period, summary, cmv: revenue ? cmvOverRevenue(period, summary, revenue) : null }
  })
}

// Semana que nao se compara direto com as outras: consumo ou venda incompletos,
// ou periodo com mais (ou menos) de 7 dias entre as contagens.
export function isTrendRowFlagged(row: ConsumptionTrendRow): boolean {
  return row.summary.isPartial || row.summary.isIrregularPeriod || Boolean(row.cmv?.isPartial)
}
