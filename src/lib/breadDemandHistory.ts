import { aggregateOvenPlan } from './ovenProduction'
import { createProductIdentityResolver, type ProductLegacyLink } from './productIdentity'
import { destinationCode } from './romaneioAccess'
import { isWeightControlledRomaneioProduct } from './romaneioDraft'
import { inferPricingUnit, isPricingUnit, type PricingUnit } from './saleOptions'

export type BreadDemandStore = 'jc' | 'ja'
export type BreadDemandConfidence = 'normal' | 'provisional' | 'insufficient'
export type FirmBreadDemandChannel = 'ex' | 'pj' | 'encomenda'

export const BREAD_DEMAND_STORES: readonly BreadDemandStore[] = ['jc', 'ja']
export const BREAD_DEMAND_MAX_WEEKS = 12
export const BREAD_DEMAND_SAMPLE_SIZE = 8

export interface BreadDemandBreadRow {
  id: string
  name: string
  days: number[] | null
  unit?: string | null
}

export interface BreadDemandDestinationRow {
  id: string
  code?: string | null
  name?: string | null
}

export interface BreadDemandRomaneioRow {
  id: string
  record_date: string
  destination_id: string | null
}

export interface BreadDemandRomaneioItemRow {
  romaneio_id: string | null
  product_id: string | null
  product_source: string | null
  product_name: string | null
  qty_sent: number | string | null
  qty_accepted: number | string | null
  pricing_unit?: string | null
  sale_unit?: string | null
}

export interface BreadDemandLeftoverRow {
  record_date: string
  store: string | null
  product_id: string | null
  product_source: string | null
  quantity: number | string | null
}

export interface FirmBreadOrderRow {
  bread_id: string | null
  product_source: string | null
  quantity: number | string | null
  pricing_unit: string | null
  store: string | null
  order_type: string | null
  order_date: string | null
  production_date: string | null
  pj_delivery_date: string | null
  cancelled_at: string | null
}

export interface BreadDemandHistoryInput {
  targetDate: string
  breads: readonly BreadDemandBreadRow[]
  productLinks: readonly ProductLegacyLink[]
  destinations: readonly BreadDemandDestinationRow[]
  romaneios: readonly BreadDemandRomaneioRow[]
  romaneioItems: readonly BreadDemandRomaneioItemRow[]
  leftovers: readonly BreadDemandLeftoverRow[]
  firmOrders: readonly FirmBreadOrderRow[]
}

export interface BreadDemandStoreSummary {
  confidence: BreadDemandConfidence
  validDays: number
  average: number | null
  minimum: number | null
  maximum: number | null
  noLeftoverDays: number
}

export interface FirmBreadDemandSummary {
  quantity: number | null
  unit: PricingUnit
  mixedUnits: boolean
}

export interface BreadDemandSummary {
  breadId: string
  weekday: number
  weekdayPlural: string
  unit: PricingUnit
  mixedUnits: boolean
  stores: Record<BreadDemandStore, BreadDemandStoreSummary>
  totalAverage: number | null
  firm: Record<FirmBreadDemandChannel, FirmBreadDemandSummary>
}

const WEEKDAY_PLURAL = [
  'domingos',
  'segundas',
  'terças',
  'quartas',
  'quintas',
  'sextas',
  'sábados',
] as const

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function parseDateKey(dateKey: string): Date | null {
  const match = DATE_KEY_PATTERN.exec(dateKey)
  if (!match) return null

  const [, year, month, day] = match
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  if (
    parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() + 1 !== Number(month)
    || parsed.getUTCDate() !== Number(day)
  ) return null

  return parsed
}

function dateKey(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-')
}

export function breadDemandCandidateDates(
  targetDate: string,
  maxWeeks = BREAD_DEMAND_MAX_WEEKS,
): string[] {
  const target = parseDateKey(targetDate)
  if (!target || maxWeeks <= 0) return []

  return Array.from({ length: Math.trunc(maxWeeks) }, (_, index) => {
    const candidate = new Date(target)
    candidate.setUTCDate(candidate.getUTCDate() - ((index + 1) * 7))
    return dateKey(candidate)
  })
}

function numericQuantity(value: number | string | null | undefined): number {
  const numeric = Number(value ?? 0)
  if (!Number.isFinite(numeric) || numeric < 0) return 0
  return numeric
}

function quantityKey(breadId: string, store: BreadDemandStore, recordDate: string): string {
  return `${breadId}:${store}:${recordDate}`
}

function closureKey(store: BreadDemandStore, recordDate: string): string {
  return `${store}:${recordDate}`
}

function confidenceForDays(validDays: number): BreadDemandConfidence {
  if (validDays >= BREAD_DEMAND_SAMPLE_SIZE) return 'normal'
  if (validDays >= 4) return 'provisional'
  return 'insufficient'
}

function emptyStoreSummary(): BreadDemandStoreSummary {
  return {
    confidence: 'insufficient',
    validDays: 0,
    average: null,
    minimum: null,
    maximum: null,
    noLeftoverDays: 0,
  }
}

function summarizeObservations(
  observations: Array<{ output: number; sent: number; leftover: number }>,
  hideNumbers: boolean,
): BreadDemandStoreSummary {
  const validDays = observations.length
  const confidence = confidenceForDays(validDays)
  const canShowNumbers = !hideNumbers && confidence !== 'insufficient'
  const outputs = observations.map(observation => observation.output)

  return {
    confidence,
    validDays,
    average: canShowNumbers
      ? outputs.reduce((total, output) => total + output, 0) / outputs.length
      : null,
    minimum: canShowNumbers ? Math.min(...outputs) : null,
    maximum: canShowNumbers ? Math.max(...outputs) : null,
    noLeftoverDays: observations.filter(observation =>
      observation.sent > 0 && observation.leftover === 0,
    ).length,
  }
}

function normalizedRomaneioStore(
  destination: BreadDemandDestinationRow | undefined,
): BreadDemandStore | null {
  const code = destinationCode(destination).toLowerCase()
  return code === 'jc' || code === 'ja' ? code : null
}

function explicitUnitInName(productName: string | null): PricingUnit | null {
  const normalized = (productName ?? '').trim().toLowerCase()
  if (/\(\s*kg\s*\)/.test(normalized)) return 'kg'
  if (/\(\s*un\s*\)/.test(normalized)) return 'un'
  return null
}

function romaneioItemUnit(
  item: BreadDemandRomaneioItemRow,
  bread: BreadDemandBreadRow,
): PricingUnit {
  if (isPricingUnit(item.pricing_unit)) return item.pricing_unit
  if (isPricingUnit(item.sale_unit)) return item.sale_unit

  const labeledUnit = explicitUnitInName(item.product_name)
  if (labeledUnit) return labeledUnit

  // romaneio_items ainda não tem coluna de unidade. Esta é a mesma regra
  // operacional usada ao gravar e conferir os itens antigos do Romaneio.
  if (isWeightControlledRomaneioProduct(item.product_name ?? bread.name)) return 'kg'
  return inferPricingUnit(bread.unit)
}

function firmOrderUnit(order: FirmBreadOrderRow, bread: BreadDemandBreadRow): PricingUnit {
  return isPricingUnit(order.pricing_unit)
    ? order.pricing_unit
    : inferPricingUnit(bread.unit)
}

function firmOrderChannel(
  order: FirmBreadOrderRow,
  targetDate: string,
): FirmBreadDemandChannel | null {
  if (order.cancelled_at) return null
  if (
    order.order_type === 'producao'
    && order.store?.toLowerCase() === 'ex'
    && order.order_date === targetDate
  ) return 'ex'
  if (
    order.order_type === 'pj'
    && (
      order.production_date === targetDate
      || (!order.production_date && order.pj_delivery_date === targetDate)
    )
  ) return 'pj'
  if (order.order_type === 'encomenda' && order.production_date === targetDate) return 'encomenda'
  return null
}

function buildBreadIdentityLookup(
  breads: readonly BreadDemandBreadRow[],
  productLinks: readonly ProductLegacyLink[],
) {
  const resolver = createProductIdentityResolver(productLinks)
  const breadByIdentity = new Map<string, string>()

  for (const bread of breads) {
    for (const identity of resolver.keysFor('bread', bread.id)) {
      breadByIdentity.set(identity, bread.id)
    }
  }

  return {
    resolve(productSource: string | null, productId: string | null): string | null {
      if (!productId) return null
      const source = productSource || 'bread'
      for (const identity of resolver.keysFor(source, productId)) {
        const breadId = breadByIdentity.get(identity)
        if (breadId) return breadId
      }
      return null
    },
  }
}

function aggregateFirmOrders(
  input: BreadDemandHistoryInput,
  resolveBreadId: (productSource: string | null, productId: string | null) => string | null,
): Map<string, Record<FirmBreadDemandChannel, FirmBreadDemandSummary>> {
  const breadsById = new Map(input.breads.map(bread => [bread.id, bread]))
  const groupedRows: Record<FirmBreadDemandChannel, Array<{ bread_id: string; quantity: number }>> = {
    ex: [],
    pj: [],
    encomenda: [],
  }
  const units = new Map<string, Set<PricingUnit>>()

  for (const order of input.firmOrders) {
    const channel = firmOrderChannel(order, input.targetDate)
    if (!channel) continue

    const breadId = resolveBreadId(order.product_source, order.bread_id)
    const bread = breadId ? breadsById.get(breadId) : null
    const quantity = numericQuantity(order.quantity)
    if (!breadId || !bread || quantity <= 0) continue

    groupedRows[channel].push({ bread_id: breadId, quantity })
    const key = `${breadId}:${channel}`
    const channelUnits = units.get(key) ?? new Set<PricingUnit>()
    channelUnits.add(firmOrderUnit(order, bread))
    units.set(key, channelUnits)
  }

  const totalsByChannel = {
    ex: aggregateOvenPlan(groupedRows.ex),
    pj: aggregateOvenPlan(groupedRows.pj),
    encomenda: aggregateOvenPlan(groupedRows.encomenda),
  }
  const result = new Map<string, Record<FirmBreadDemandChannel, FirmBreadDemandSummary>>()

  for (const bread of input.breads) {
    result.set(bread.id, Object.fromEntries(
      (Object.keys(totalsByChannel) as FirmBreadDemandChannel[]).map(channel => {
        const channelUnits = units.get(`${bread.id}:${channel}`) ?? new Set<PricingUnit>()
        const mixedUnits = channelUnits.size > 1
        const unit = channelUnits.values().next().value ?? inferPricingUnit(bread.unit)
        return [channel, {
          quantity: mixedUnits ? null : (totalsByChannel[channel].get(bread.id) ?? 0),
          unit,
          mixedUnits,
        }]
      }),
    ) as Record<FirmBreadDemandChannel, FirmBreadDemandSummary>)
  }

  return result
}

export function summarizeBreadDemandHistory(
  input: BreadDemandHistoryInput,
): Record<string, BreadDemandSummary> {
  const target = parseDateKey(input.targetDate)
  const weekday = target?.getUTCDay() ?? -1
  const weekdayPlural = weekday >= 0 ? WEEKDAY_PLURAL[weekday] : 'dias equivalentes'
  const candidateDates = breadDemandCandidateDates(input.targetDate)
  const candidateDateSet = new Set(candidateDates)
  const breadsById = new Map(input.breads.map(bread => [bread.id, bread]))
  const identityLookup = buildBreadIdentityLookup(input.breads, input.productLinks)
  const resolveBreadId = identityLookup.resolve
  const destinationsById = new Map(input.destinations.map(destination => [destination.id, destination]))
  const romaneioContext = new Map<string, { date: string; store: BreadDemandStore }>()
  const sentByBreadStoreDate = new Map<string, number>()
  const leftoverByBreadStoreDate = new Map<string, number>()
  const closureDays = new Set<string>()
  const unitsByBread = new Map<string, Set<PricingUnit>>()

  for (const romaneio of input.romaneios) {
    if (!candidateDateSet.has(romaneio.record_date) || !romaneio.destination_id) continue
    const store = normalizedRomaneioStore(destinationsById.get(romaneio.destination_id))
    if (store) romaneioContext.set(romaneio.id, { date: romaneio.record_date, store })
  }

  for (const item of input.romaneioItems) {
    const context = item.romaneio_id ? romaneioContext.get(item.romaneio_id) : null
    const breadId = resolveBreadId(item.product_source, item.product_id)
    const bread = breadId ? breadsById.get(breadId) : null
    if (!context || !breadId || !bread) continue

    const sentQuantity = numericQuantity(item.qty_sent)
    const quantity = item.qty_accepted == null
      ? sentQuantity
      : numericQuantity(item.qty_accepted)
    const unit = romaneioItemUnit(item, bread)
    if (sentQuantity > 0 || quantity > 0) {
      const breadUnits = unitsByBread.get(breadId) ?? new Set<PricingUnit>()
      breadUnits.add(unit)
      unitsByBread.set(breadId, breadUnits)
    }

    const key = quantityKey(breadId, context.store, context.date)
    sentByBreadStoreDate.set(key, (sentByBreadStoreDate.get(key) ?? 0) + quantity)
  }

  for (const leftover of input.leftovers) {
    const store = leftover.store?.toLowerCase()
    if (
      (store !== 'jc' && store !== 'ja')
      || leftover.product_source !== 'bread'
      || !candidateDateSet.has(leftover.record_date)
    ) continue

    closureDays.add(closureKey(store, leftover.record_date))
    const breadId = resolveBreadId(leftover.product_source, leftover.product_id)
    if (!breadId) continue
    const key = quantityKey(breadId, store, leftover.record_date)
    const quantity = numericQuantity(leftover.quantity)
    leftoverByBreadStoreDate.set(key, (leftoverByBreadStoreDate.get(key) ?? 0) + quantity)
  }

  const firmByBread = aggregateFirmOrders(input, resolveBreadId)
  const summaries: Record<string, BreadDemandSummary> = {}

  for (const bread of input.breads) {
    const breadUnits = unitsByBread.get(bread.id) ?? new Set<PricingUnit>()
    const mixedUnits = breadUnits.size > 1
    const unit = breadUnits.values().next().value ?? inferPricingUnit(bread.unit)
    const isScheduled = weekday >= 0 && Array.isArray(bread.days) && bread.days.includes(weekday)
    const stores = Object.fromEntries(BREAD_DEMAND_STORES.map(store => {
      if (!isScheduled) return [store, emptyStoreSummary()]

      const observations: Array<{ output: number; sent: number; leftover: number }> = []
      for (const candidateDate of candidateDates) {
        if (!closureDays.has(closureKey(store, candidateDate))) continue
        const key = quantityKey(bread.id, store, candidateDate)
        const sent = sentByBreadStoreDate.get(key) ?? 0
        const leftover = leftoverByBreadStoreDate.get(key) ?? 0

        // A loja fechou o dia, mas este pão não esteve lá: não chegou romaneio
        // e não havia estoque do dia anterior. Contar saída zero mediria
        // ausência de oferta, não falta de procura, e puxaria a média para
        // baixo justamente nos pães que não são feitos todo dia.
        if (sent === 0 && leftover === 0) continue

        const output = sent - leftover
        if (output < 0) continue

        observations.push({ output, sent, leftover })
        if (observations.length >= BREAD_DEMAND_SAMPLE_SIZE) break
      }

      return [store, summarizeObservations(observations, mixedUnits)]
    })) as Record<BreadDemandStore, BreadDemandStoreSummary>

    summaries[bread.id] = {
      breadId: bread.id,
      weekday,
      weekdayPlural,
      unit,
      mixedUnits,
      stores,
      totalAverage: !mixedUnits && stores.jc.average != null && stores.ja.average != null
        ? stores.jc.average + stores.ja.average
        : null,
      firm: firmByBread.get(bread.id) ?? {
        ex: { quantity: 0, unit, mixedUnits: false },
        pj: { quantity: 0, unit, mixedUnits: false },
        encomenda: { quantity: 0, unit, mixedUnits: false },
      },
    }
  }

  return summaries
}
