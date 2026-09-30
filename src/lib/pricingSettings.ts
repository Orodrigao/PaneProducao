// src/lib/pricingSettings.ts — Configuração do Sistema, fase 1 da formação de preço.
//
// Regras em docs/FORMACAO_DE_PRECO.md. O banco (migration
// 20260930012316_configuracao_sistema_preco.sql) guarda cada valor como versão
// nova, confere admin ativo e recusa percentual fora de 0 a 100. O que existe
// aqui é a validação de tela, para o recado chegar antes do envio, e as
// chamadas. Vazio é "não definido" e nunca vira zero.

import type { CatalogType, ProductCategory } from '@/lib/productCategories'

/** Mesmo conjunto do check `channel` da migration; mudar um exige mudar o outro. */
export const PRICING_CHANNELS = ['balcao', 'ifood', 'buck'] as const
export type PricingChannel = typeof PRICING_CHANNELS[number]

const CHANNEL_LABELS: Record<PricingChannel, string> = {
  balcao: 'Balcão',
  ifood: 'iFood',
  buck: 'Buck',
}

/** Mesmo conjunto do check `setting_key` da migration. */
export const PRICING_SETTING_KEYS = ['imposto_venda', 'taxa_canal', 'margem_desejada', 'margem_minima'] as const
export type PricingSettingKey = typeof PRICING_SETTING_KEYS[number]

const SETTING_LABELS: Record<PricingSettingKey, string> = {
  imposto_venda: 'Imposto sobre a venda',
  taxa_canal: 'Taxa do canal',
  margem_desejada: 'Margem desejada',
  margem_minima: 'Margem mínima',
}

/** Categorias que podem ter exceção de margem: as mesmas que o banco aceita. */
export const MARGIN_EXCEPTION_CATALOG_TYPES: readonly CatalogType[] = ['produto_fabricado', 'produto_revenda']

export function pricingChannelLabel(channel: string | null): string {
  if (!channel) return 'Todos os canais'
  return (CHANNEL_LABELS as Record<string, string>)[channel] ?? channel
}

export function pricingSettingLabel(key: string): string {
  return (SETTING_LABELS as Record<string, string>)[key] ?? key
}

export interface PricingSettingSlot {
  key: PricingSettingKey
  channel: PricingChannel | null
  categoryId: string | null
}

export interface PricingSettingValue extends PricingSettingSlot {
  value: number | null
  changedAt: string
  changedByName: string
}

export interface PricingHistoryEntry extends PricingSettingSlot {
  id: number
  categoryName: string | null
  previousValue: number | null
  value: number | null
  changedAt: string
  changedByName: string
}

export interface PricingSettingsData {
  current: PricingSettingValue[]
  history: PricingHistoryEntry[]
}

export interface PricingChange {
  setting_key: PricingSettingKey
  channel: PricingChannel | null
  category_id: string | null
  value: number | null
  previous_value: number | null
}

export function slotId(slot: PricingSettingSlot): string {
  return `${slot.key}|${slot.channel ?? ''}|${slot.categoryId ?? ''}`
}

/** As chaves que a tela sempre mostra, na ordem da página. */
export function baseSlots(): PricingSettingSlot[] {
  const slots: PricingSettingSlot[] = [{ key: 'imposto_venda', channel: null, categoryId: null }]
  for (const channel of PRICING_CHANNELS) {
    slots.push({ key: 'taxa_canal', channel, categoryId: null })
    slots.push({ key: 'margem_desejada', channel, categoryId: null })
    slots.push({ key: 'margem_minima', channel, categoryId: null })
  }
  return slots
}

export function categorySlots(categoryId: string): PricingSettingSlot[] {
  return PRICING_CHANNELS.flatMap(channel => [
    { key: 'margem_desejada' as const, channel, categoryId },
    { key: 'margem_minima' as const, channel, categoryId },
  ])
}

export type PercentParse = { ok: true; value: number | null } | { ok: false; error: string }

/**
 * Percentual digitado: aceita vírgula ou ponto e o sinal de %. Vazio é "não
 * definido" (null), nunca zero; por isso não usa parseMoneyInput, que devolve 0
 * para campo vazio.
 */
export function parsePercentInput(raw: string): PercentParse {
  const clean = raw.trim().replace(/\s/g, '').replace(/%$/, '')
  if (!clean) return { ok: true, value: null }
  if (!/^\d{1,3}([.,]\d+)?$/.test(clean)) {
    return { ok: false, error: 'Digite só o número, como 6 ou 2,5.' }
  }
  const [, decimals = ''] = clean.split(/[.,]/)
  if (decimals.length > 2) return { ok: false, error: 'Use no máximo duas casas decimais.' }
  const value = Number(clean.replace(',', '.'))
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return { ok: false, error: 'O percentual precisa ficar entre 0 e 100.' }
  }
  return { ok: true, value }
}

const PERCENT_FORMATTER = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

export function formatPercent(value: number | null): string {
  return value === null ? 'não definido' : `${PERCENT_FORMATTER.format(value)}%`
}

/** Valor para o campo de texto: vazio quando não definido. */
export function percentInputText(value: number | null): string {
  return value === null ? '' : PERCENT_FORMATTER.format(value)
}

export function currentValueMap(current: readonly PricingSettingValue[]): Map<string, PricingSettingValue> {
  return new Map(current.map(item => [slotId(item), item]))
}

export interface ChangesResult {
  changes: PricingChange[]
  errors: Record<string, string>
}

/**
 * Compara o rascunho da tela com o vigente e devolve só o que mudou, cada item
 * com o valor que a tela mostrava antes: o banco recusa se outro salvamento
 * entrou no meio.
 */
export function buildPricingChanges(
  slots: readonly PricingSettingSlot[],
  draft: Readonly<Record<string, string>>,
  current: ReadonlyMap<string, PricingSettingValue>,
): ChangesResult {
  const changes: PricingChange[] = []
  const errors: Record<string, string> = {}
  for (const slot of slots) {
    const id = slotId(slot)
    const text = draft[id]
    if (text === undefined) continue
    const parsed = parsePercentInput(text)
    if (!parsed.ok) {
      errors[id] = parsed.error
      continue
    }
    const previous = current.get(id)?.value ?? null
    if (parsed.value === previous) continue
    changes.push({
      setting_key: slot.key,
      channel: slot.channel,
      category_id: slot.categoryId,
      value: parsed.value,
      previous_value: previous,
    })
  }

  // Margem mínima acima da desejada, pelo valor que vale de fato: na exceção de
  // categoria, campo vazio herda o do canal. Mesma regra do banco.
  for (const channel of PRICING_CHANNELS) {
    const channelDesiredId = slotId({ key: 'margem_desejada', channel, categoryId: null })
    const channelMinimumId = slotId({ key: 'margem_minima', channel, categoryId: null })
    const channelDesired = effectiveDraftValue(channelDesiredId, draft, current)
    const channelMinimum = effectiveDraftValue(channelMinimumId, draft, current)
    if (channelDesired !== null && channelMinimum !== null && channelMinimum > channelDesired && !errors[channelMinimumId]) {
      errors[channelMinimumId] = 'A margem mínima não pode ser maior que a desejada.'
    }

    const categoryIds = new Set<string>()
    for (const slot of slots) if (slot.channel === channel && slot.categoryId) categoryIds.add(slot.categoryId)
    for (const categoryId of categoryIds) {
      const desiredId = slotId({ key: 'margem_desejada', channel, categoryId })
      const minimumId = slotId({ key: 'margem_minima', channel, categoryId })
      const ownDesired = effectiveDraftValue(desiredId, draft, current)
      const ownMinimum = effectiveDraftValue(minimumId, draft, current)
      const desired = ownDesired ?? channelDesired
      const minimum = ownMinimum ?? channelMinimum
      if (desired === null || minimum === null || minimum <= desired) continue
      if (ownMinimum !== null && !errors[minimumId]) {
        errors[minimumId] = ownDesired === null
          ? 'A margem mínima não pode ser maior que a desejada do canal, que vale aqui.'
          : 'A margem mínima não pode ser maior que a desejada.'
      } else if (ownDesired !== null && !errors[desiredId]) {
        errors[desiredId] = 'A margem desejada não pode ser menor que a mínima do canal, que vale aqui.'
      }
    }
  }
  return { changes, errors }
}

function effectiveDraftValue(
  id: string,
  draft: Readonly<Record<string, string>>,
  current: ReadonlyMap<string, PricingSettingValue>,
): number | null {
  const text = draft[id]
  if (text === undefined) return current.get(id)?.value ?? null
  const parsed = parsePercentInput(text)
  return parsed.ok ? parsed.value : null
}

/**
 * Canais em que imposto + taxa + margem já comem 100% do preço ou mais. Não
 * bloqueia (ainda entram as despesas fixas, da fase 2), só avisa.
 */
export function channelsOverHundred(
  slots: readonly PricingSettingSlot[],
  draft: Readonly<Record<string, string>>,
  current: ReadonlyMap<string, PricingSettingValue>,
): PricingChannel[] {
  const tax = effectiveDraftValue(slotId({ key: 'imposto_venda', channel: null, categoryId: null }), draft, current) ?? 0
  return PRICING_CHANNELS.filter(channel => {
    const fee = effectiveDraftValue(slotId({ key: 'taxa_canal', channel, categoryId: null }), draft, current) ?? 0
    const margins = slots
      .filter(slot => slot.channel === channel && (slot.key === 'margem_desejada' || slot.key === 'margem_minima'))
      .map(slot => effectiveDraftValue(slotId(slot), draft, current))
      .filter((value): value is number => value !== null)
    const highestMargin = margins.length > 0 ? Math.max(...margins) : 0
    return tax + fee + highestMargin >= 100
  })
}

/** Categorias oferecidas para exceção: ativas do tipo certo, mais as que já têm valor. */
export function marginExceptionCategories(
  categories: readonly ProductCategory[],
  current: readonly PricingSettingValue[],
): ProductCategory[] {
  const withValue = new Set(current.filter(item => item.categoryId).map(item => item.categoryId))
  return categories.filter(category =>
    MARGIN_EXCEPTION_CATALOG_TYPES.includes(category.catalog_type)
      && (category.active || withValue.has(category.id)))
}

function isKey(value: unknown): value is PricingSettingKey {
  return typeof value === 'string' && (PRICING_SETTING_KEYS as readonly string[]).includes(value)
}

function asChannel(value: unknown): PricingChannel | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && (PRICING_CHANNELS as readonly string[]).includes(value)) return value as PricingChannel
  throw new Error(`Canal desconhecido na configuração: ${String(value)}`)
}

function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error('Percentual inválido na configuração.')
  return parsed
}

/** Lê a resposta de `get_pricing_settings`, recusando formato inesperado. */
export function parsePricingSettingsResponse(raw: unknown): PricingSettingsData {
  if (!raw || typeof raw !== 'object') throw new Error('Resposta da configuração em formato inesperado.')
  const { current, history } = raw as { current?: unknown; history?: unknown }
  if (!Array.isArray(current) || !Array.isArray(history)) throw new Error('Resposta da configuração em formato inesperado.')

  return {
    current: current.flatMap((row: Record<string, unknown>) => isKey(row.setting_key) ? [{
      key: row.setting_key,
      channel: asChannel(row.channel),
      categoryId: typeof row.category_id === 'string' ? row.category_id : null,
      value: asNumberOrNull(row.value),
      changedAt: String(row.changed_at ?? ''),
      changedByName: String(row.changed_by_name ?? ''),
    }] : []),
    history: history.flatMap((row: Record<string, unknown>) => isKey(row.setting_key) ? [{
      id: Number(row.id),
      key: row.setting_key,
      channel: asChannel(row.channel),
      categoryId: typeof row.category_id === 'string' ? row.category_id : null,
      categoryName: typeof row.category_name === 'string' ? row.category_name : null,
      previousValue: asNumberOrNull(row.previous_value),
      value: asNumberOrNull(row.value),
      changedAt: String(row.changed_at ?? ''),
      changedByName: String(row.changed_by_name ?? ''),
    }] : []),
  }
}

export function describeHistoryEntry(entry: PricingHistoryEntry): string {
  const parts = [pricingSettingLabel(entry.key)]
  if (entry.channel) parts.push(pricingChannelLabel(entry.channel))
  if (entry.categoryId) parts.push(entry.categoryName ?? 'categoria removida')
  return `${parts.join(' · ')}: ${formatPercent(entry.previousValue)} → ${formatPercent(entry.value)}`
}

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatChangedAt(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : DATE_TIME_FORMATTER.format(date)
}

export async function loadPricingSettings(): Promise<PricingSettingsData> {
  const { supabase } = await import('@/lib/supabase')
  const { data, error } = await supabase.rpc('get_pricing_settings', { p_history_limit: 200 })
  if (error) throw error
  return parsePricingSettingsResponse(data)
}

export async function savePricingSettings(changes: readonly PricingChange[]): Promise<number> {
  const { supabase } = await import('@/lib/supabase')
  const { data, error } = await supabase.rpc('save_pricing_settings', { p_changes: changes })
  if (error) throw error
  return Number((data as { saved?: unknown } | null)?.saved ?? 0)
}

/** Mensagem fixa da recusa, pelo código do Postgres. */
export function pricingSaveErrorMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code
  // PT409, não 40001: o PostgREST repete a transação em 40001 e a tela travaria.
  if (code === 'PT409') return 'Outro salvamento mudou a configuração depois que a tela abriu. Recarregue a página para ver os valores atuais; o que você digitou continua na tela.'
  if (code === '42501') return 'Só administradores podem mudar a Configuração do Sistema.'
  if (code === '22023') {
    const message = (error as { message?: string }).message
    return message ? `Não foi possível salvar: ${message}` : 'Não foi possível salvar: algum valor foi recusado.'
  }
  return 'Não foi possível salvar. Nenhum valor foi alterado; o que você digitou continua na tela.'
}

export type PricingSaveOutcome =
  | { kind: 'saved'; message: string }
  | { kind: 'saved-reload-failed'; message: string }
  | { kind: 'error'; message: string }

/**
 * Grava e relê. Gravar e reler são falhas diferentes: se a gravação passou e
 * só a releitura falhou, a mensagem não pode dizer que nada foi salvo.
 */
export async function runPricingSave(
  changes: readonly PricingChange[],
  save: (changes: readonly PricingChange[]) => Promise<number>,
  reload: () => Promise<void>,
): Promise<PricingSaveOutcome> {
  let saved: number
  try {
    saved = await save(changes)
  } catch (error) {
    return { kind: 'error', message: pricingSaveErrorMessage(error) }
  }
  const summary = saved === 1 ? '1 valor mudou' : `${saved} valores mudaram`
  try {
    await reload()
  } catch {
    return {
      kind: 'saved-reload-failed',
      message: `Configuração salva (${summary}), mas a tela não conseguiu mostrar os valores novos. Recarregue a página; o que você digitou continua na tela.`,
    }
  }
  return { kind: 'saved', message: `Configuração salva: ${summary}.` }
}
