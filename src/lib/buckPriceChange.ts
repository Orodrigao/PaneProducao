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

// Uma semana em que este pão saiu para a EX: quanto ele soma na conta antes e
// depois da troca, e se a conta dele tem problema (sem preço, unidade, peso).
export interface BuckPriceWeekEffect {
  de: string
  ate: string
  quantidade: number
  unidade: string | null
  antes: number
  depois: number
  problema_antes: boolean
  problema_depois: boolean
}

export interface BuckPricePreview {
  hoje: string
  data_minima: string
  motivo_data_minima: string
  // Último registro do histórico do pão quando a prévia foi calculada. A troca
  // manda esta versão de volta e o banco recusa se o preço mudou desde então.
  versao: number
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
  if (/^\d{1,3}(\.\d{3})+$/.test(clean)) {
    return { value: null, error: 'Para milhar, use vírgula nos centavos: 1.000,00.' }
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

// O que pede a confirmação a mais antes de gravar. Unidade trocada vem
// primeiro: preço por quilo e por unidade não se comparam em porcentagem.
export function confirmationNeeded(
  current: BuckPriceInEffect | null,
  next: { price: number; unit: BuckPricingUnit },
): 'unidade' | 'variacao' | null {
  const currentPrice = current?.unit_price ?? null
  if (currentPrice !== null && Number(currentPrice) > 0 && current?.pricing_unit && current.pricing_unit !== next.unit) {
    return 'unidade'
  }
  return needsBigChangeConfirmation(currentPrice, next.price) ? 'variacao' : null
}

// Uma confirmação vale só para o preço em vigor que a pessoa viu: se outra
// pessoa trocou o preço (versão nova), a comparação é outra e precisa ser
// confirmada de novo.
export function confirmationKey(
  reference: BuckPricePreview | null,
  next: { price: number; unit: BuckPricingUnit },
): string | null {
  if (!reference) return null
  const kind = confirmationNeeded(reference.vigente, next)
  return kind ? `${reference.versao}|${kind}|${next.price}|${next.unit}` : null
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
  const confirmation = price.value === null ? null : confirmationNeeded(preview?.vigente ?? null, { price: price.value, unit: draft.unit })
  if (confirmation && !draft.bigChangeConfirmed) {
    return confirmation === 'unidade'
      ? 'Confirme a troca de unidade antes de gravar.'
      : 'Confirme a variação grande do preço antes de gravar.'
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

type BuckLineIdentity = { product_source: string; product_id: string }

// Mesmo pão para a conta da Buck: a mesma linha de catálogo (duas opções de
// venda) ou a ponte pão legado ↔ produto. Espelha private.buck_identidades.
export function sameBuckProduct(
  a: BuckLineIdentity,
  b: BuckLineIdentity,
  legacyBreadByProduct: ReadonlyMap<string, string>,
): boolean {
  if (a.product_source === b.product_source && a.product_id === b.product_id) return true
  const bridged = (product: BuckLineIdentity, bread: BuckLineIdentity) =>
    product.product_source === 'product' && bread.product_source === 'bread'
    && legacyBreadByProduct.get(product.product_id) === bread.product_id
  return bridged(a, b) || bridged(b, a)
}

// Na janela do deploy o site novo pode chegar antes da função no banco.
export const BUCK_PRICE_UPDATING_MESSAGE = 'O sistema está sendo atualizado. Tente de novo em alguns minutos.'
export const BUCK_PRICE_OFFLINE_MESSAGE = 'Sem conexão com o servidor. Confira a internet e tente de novo.'
// O banco recusou porque o preço mudou depois da prévia (public.trocar_preco_buck).
export const BUCK_PRICE_STALE_CODE = 'PZ002'

export function isStaleBuckPreviewError(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === BUCK_PRICE_STALE_CODE
}

export function buckPriceErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const { code, message } = error as { code?: unknown; message?: unknown }
    if (code === 'PGRST202' || code === '42883') return BUCK_PRICE_UPDATING_MESSAGE
    if (typeof message === 'string' && /failed to fetch|networkerror|load failed/i.test(message)) return BUCK_PRICE_OFFLINE_MESSAGE
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

// `versao` é a da prévia que a pessoa conferiu (BuckPricePreview.versao).
export async function changeBuckPrice(itemId: string, draft: BuckPriceDraft, versao: number): Promise<void> {
  const price = parseBuckPriceInput(draft.priceText)
  if (price.value === null) throw new Error(price.error ?? 'Informe o preço novo.')
  const { error } = await supabase.rpc('trocar_preco_buck', {
    p_item_id: itemId,
    p_preco: price.value,
    p_unidade: draft.unit,
    p_vale_a_partir: draft.validFrom,
    p_motivo: draft.reason,
    p_detalhe: draft.detail.trim() || null,
    p_versao: versao,
  })
  if (error) throw error
}

// A API corta cada leitura em 1.000 linhas sem avisar. Páginas menores que
// esse limite, em ordem estável, até uma vir incompleta.
export const BUCK_HISTORY_PAGE_SIZE = 500

export async function collectAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize = BUCK_HISTORY_PAGE_SIZE,
): Promise<T[]> {
  const all: T[] = []
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1)
    all.push(...page)
    if (page.length < pageSize) return all
  }
}

// Histórico inteiro de uma linha, do mais novo para o mais antigo.
export async function loadBuckItemHistory(itemId: string): Promise<BuckPriceHistoryEntry[]> {
  return collectAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('buck_price_history')
      .select(BUCK_PRICE_HISTORY_COLUMNS)
      .eq('price_tier_item_id', itemId)
      .order('seq', { ascending: false })
      .range(from, to)
    if (error) throw error
    return (data ?? []) as unknown as BuckPriceHistoryEntry[]
  })
}

export interface BuckPriceInEffectRow {
  price_tier_item_id: string
  seq: number
  valid_from: string
  unit_price: number | null
  pricing_unit: BuckPricingUnit | null
}

// O último registro de cada linha (public.buck_precos_em_vigor), para o
// "desde" de cada pão sem ler o histórico inteiro da tabela.
export async function loadBuckPricesInEffect(tierId: string): Promise<Map<string, BuckPriceInEffectRow>> {
  const rows = await collectAllPages(async (from, to) => {
    const { data, error } = await supabase
      .rpc('buck_precos_em_vigor', { p_tier_id: tierId })
      .order('price_tier_item_id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as BuckPriceInEffectRow[]
  })
  return new Map(rows.map(row => [row.price_tier_item_id, row]))
}
