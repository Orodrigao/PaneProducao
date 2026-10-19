import { supabase } from '@/lib/supabase'
import { formatCurrencyBRL, parseMoneyInput } from '@/lib/cashClosing'

// Troca de preço da Tabela Buck com data e motivo (fase 2 da Tabela Buck com
// data de validade). Quem decide é o banco (public.trocar_preco_buck); a tela
// confere antes só para avisar cedo e não perder o que a pessoa digitou.

export type BuckPriceReason = 'reajuste_combinado' | 'correcao_digitacao' | 'outro'
export type BuckPricingUnit = 'un' | 'kg'

export const BUCK_PRICE_REASONS: ReadonlyArray<{ value: BuckPriceReason; label: string }> = [
  { value: 'reajuste_combinado', label: 'Reajuste combinado com a Buck' },
  { value: 'correcao_digitacao', label: 'Correção de digitação' },
  { value: 'outro', label: 'Outro motivo' },
]

export const BUCK_PRICE_DETAIL_MAX = 150
export const BUCK_PRICE_MAX = 10000
// Acima disso a tela pede uma confirmação a mais: "589" no lugar de "5,89".
export const BUCK_BIG_CHANGE_RATIO = 0.3
// "Desde sempre" no histórico: primeiro preço de um pão que nunca teve outro.
export const BUCK_SINCE_ALWAYS = '2000-01-01'

export interface BuckPriceHistoryEntry {
  seq: number
  price_tier_item_id: string
  unit_price: number | null
  pricing_unit: BuckPricingUnit | null
  valid_from: string
  previous_unit_price: number | null
  previous_pricing_unit: BuckPricingUnit | null
  event: string
  origin: string
  reason: string | null
  created_by_name: string | null
  created_at: string
}

export const BUCK_PRICE_HISTORY_COLUMNS =
  'seq,price_tier_item_id,unit_price,pricing_unit,valid_from,previous_unit_price,previous_pricing_unit,event,origin,reason,created_by_name,created_at'

export interface BuckPriceInEffect {
  unit_price: number | null
  pricing_unit: BuckPricingUnit | null
  valid_from: string
}

export interface BuckPriceWeekEffect {
  de: string
  ate: string
  antes: number
  depois: number
}

export interface BuckPricePreview {
  hoje: string
  data_minima: string
  motivo_data_minima: string
  vigente: BuckPriceInEffect | null
  problema?: string | null
  deixam_de_valer?: BuckPriceInEffect[]
  semanas?: BuckPriceWeekEffect[]
}

export interface BuckPriceDraft {
  priceText: string
  unit: BuckPricingUnit
  validFrom: string
  reason: BuckPriceReason | ''
  detail: string
  bigChangeConfirmed: boolean
}

const EVENT_LABELS: Record<string, string> = {
  carga_inicial: 'Preço inicial',
  cadastro: 'Entrou na tabela',
  troca_de_preco: 'Troca de preço',
  primeiro_preco: 'Primeiro preço',
  troca_de_unidade: 'Troca de unidade',
  remocao: 'Saiu da tabela',
  exclusao: 'Excluído da tabela',
}

export function buckPriceEventLabel(event: string): string {
  return EVENT_LABELS[event] ?? event
}

const MINIMUM_DATE_REASONS: Record<string, string> = {
  semana_cobrada: 'antes disso este pão já entrou numa cobrança da Buck confirmada',
  outra_linha: 'antes disso o preço deste pão estava em outra linha da Tabela Buck',
  acerto_fora: 'antes disso a Buck foi acertada fora do Contas a receber',
}

export function minimumDateReason(code: string): string {
  return MINIMUM_DATE_REASONS[code] ?? code
}

export function formatDateBR(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

export function formatSince(validFrom: string): string {
  return validFrom === BUCK_SINCE_ALWAYS ? 'desde o início da tabela' : `desde ${formatDateBR(validFrom)}`
}

export function formatBuckPrice(value: number | null, unit: string | null): string {
  if (value === null || unit === null || Number(value) <= 0) return 'sem preço'
  return `${formatCurrencyBRL(Number(value))}/${unit}`
}

// Preço digitado em formato brasileiro. Casas a mais são recusadas, não
// arredondadas: quem digitou "5,899" errou alguma coisa.
export function parseBuckPriceInput(raw: string): { value: number | null; error: string | null } {
  const clean = raw.trim().replace(/\s/g, '').replace(/R\$/gi, '')
  if (!clean) return { value: null, error: 'Informe o preço novo.' }
  if (!/^\d[\d.]*(,\d*)?$/.test(clean) && !/^\d+(\.\d*)?$/.test(clean)) {
    return { value: null, error: 'Digite só números, com vírgula nos centavos.' }
  }
  const decimals = clean.includes(',') ? clean.split(',')[1] : (clean.match(/\.(\d*)$/)?.[1] ?? '')
  if (decimals.length > 2) return { value: null, error: 'Use no máximo duas casas depois da vírgula.' }
  const value = parseMoneyInput(clean)
  if (value <= 0) return { value: null, error: 'Informe um preço maior que zero.' }
  if (value > BUCK_PRICE_MAX) return { value: null, error: 'Preço acima de R$ 10.000,00. Confira o valor.' }
  return { value, error: null }
}

export function priceChangeRatio(current: number | null, next: number): number | null {
  if (current === null || !(Number(current) > 0)) return null
  return Math.abs(next - Number(current)) / Number(current)
}

export function needsBigChangeConfirmation(current: number | null, next: number): boolean {
  const ratio = priceChangeRatio(current, next)
  return ratio !== null && ratio > BUCK_BIG_CHANGE_RATIO
}

// O que impede gravar, na mesma ordem em que a pessoa preenche. O banco
// confere tudo de novo; isto só evita a viagem quando o erro é óbvio.
export function validateBuckPriceDraft(draft: BuckPriceDraft, preview: BuckPricePreview | null): string | null {
  const price = parseBuckPriceInput(draft.priceText)
  if (price.error) return price.error
  if (!draft.validFrom) return 'Informe a partir de quando o preço vale.'
  if (preview) {
    if (draft.validFrom > preview.hoje) return 'O preço novo não pode valer a partir de uma data futura.'
    if (draft.validFrom < preview.data_minima) {
      return `Escolha ${formatDateBR(preview.data_minima)} ou depois: ${minimumDateReason(preview.motivo_data_minima)}.`
    }
  }
  if (!draft.reason) return 'Escolha o motivo da troca.'
  const detail = draft.detail.trim()
  if (draft.reason === 'outro' && detail.length < 3) return 'Escreva o motivo da troca.'
  if (detail.length > BUCK_PRICE_DETAIL_MAX) return `Escreva o motivo em até ${BUCK_PRICE_DETAIL_MAX} caracteres.`
  const current = preview?.vigente?.unit_price ?? null
  if (price.value !== null && needsBigChangeConfirmation(current, price.value) && !draft.bigChangeConfirmed) {
    return 'Confirme a variação grande do preço antes de gravar.'
  }
  return null
}

// Registros do histórico que ainda valem para algum dia: nenhum registro
// gravado depois cobre a data deles.
export function effectiveHistorySeqs(entries: BuckPriceHistoryEntry[]): Set<number> {
  const effective = new Set<number>()
  for (const entry of entries) {
    const covered = entries.some(other =>
      other.price_tier_item_id === entry.price_tier_item_id
      && other.seq > entry.seq
      && other.valid_from <= entry.valid_from)
    if (!covered) effective.add(entry.seq)
  }
  return effective
}

export function latestHistoryByItem(entries: BuckPriceHistoryEntry[]): Map<string, BuckPriceHistoryEntry> {
  const latest = new Map<string, BuckPriceHistoryEntry>()
  for (const entry of entries) {
    const current = latest.get(entry.price_tier_item_id)
    if (!current || entry.seq > current.seq) latest.set(entry.price_tier_item_id, entry)
  }
  return latest
}

// Na janela do deploy o site novo pode chegar antes da função no banco.
export const BUCK_PRICE_UPDATING_MESSAGE = 'O sistema está sendo atualizado. Tente de novo em alguns minutos.'

export function buckPriceErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const { code, message } = error as { code?: unknown; message?: unknown }
    if (code === 'PGRST202' || code === '42883') return BUCK_PRICE_UPDATING_MESSAGE
    if (typeof message === 'string' && message) return message
  }
  return fallback
}

export async function loadBuckPricePreview(
  itemId: string,
  change?: { price: number; unit: BuckPricingUnit; validFrom: string },
): Promise<BuckPricePreview> {
  const { data, error } = await supabase.rpc('previa_troca_preco_buck', {
    p_item_id: itemId,
    p_preco: change?.price ?? null,
    p_unidade: change?.unit ?? null,
    p_vale_a_partir: change?.validFrom ?? null,
  })
  if (error) throw error
  return data as BuckPricePreview
}

export async function changeBuckPrice(itemId: string, draft: BuckPriceDraft): Promise<void> {
  const price = parseBuckPriceInput(draft.priceText)
  if (price.value === null) throw new Error(price.error ?? 'Informe o preço novo.')
  const { error } = await supabase.rpc('trocar_preco_buck', {
    p_item_id: itemId,
    p_preco: price.value,
    p_unidade: draft.unit,
    p_vale_a_partir: draft.validFrom,
    p_motivo: draft.reason,
    p_detalhe: draft.detail.trim() || null,
  })
  if (error) throw error
}
