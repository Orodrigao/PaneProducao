import { formatDateBR } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { CASH_CLOSING_METHOD_LABELS, type CashClosingMethod } from '@/lib/finance'

export const FEE_METHODS = ['banrisul', 'stone', 'sitef', 'pix', 'ifood', 'food99'] as const
export type FeeMethod = typeof FEE_METHODS[number]
export { CASH_CLOSING_METHOD_LABELS }

export interface FeeRateVersion {
  id: string
  method: FeeMethod
  rate: number | null
  valid_from: string
  author_name: string
  created_at: string
}

export interface FinanceFeeRates {
  can_edit: boolean
  bridge: {
    enabled: boolean
    start_date: string
  }
  methods: {
    method: FeeMethod
    latest: FeeRateVersion | null
    current: FeeRateVersion | null
  }[]
  history: FeeRateVersion[]
  pending: {
    method: FeeMethod
    store: 'jc' | 'ja'
    competence_month: string
    amount: number
    quantity: number
  }[]
}

export interface FeeRateDraft {
  method: FeeMethod
  rate: string
  validFrom: string
  expectedLatestId: string | null
}

export function parseFeeRate(raw: string): number | null {
  const clean = raw.trim().replace(/%$/, '').trim()
  // Vazio mantém a pendência; zero declara que o meio não cobra taxa.
  if (!clean) return null
  if (!/^\d{1,3}([.,]\d{1,4})?$/.test(clean)) {
    throw new Error('Informe uma taxa de 0 a 100 com até quatro casas decimais, como 3,5125.')
  }
  const rate = Number(clean.replace(',', '.'))
  if (rate > 100) throw new Error('A taxa precisa ficar entre 0 e 100.')
  return rate
}

export function formatFeeRate(rate: number | null): string {
  return rate === null ? 'Não informada' : rate.toLocaleString('pt-BR', { maximumFractionDigits: 4 }) + '%'
}

export function buildFeeRateRequest(draft: FeeRateDraft, requestId: string, startDate: string) {
  if (!FEE_METHODS.includes(draft.method)) throw new Error('Escolha um meio de pagamento válido.')
  const parsedDate = new Date(draft.validFrom + 'T12:00:00Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.validFrom) || !Number.isFinite(parsedDate.getTime())
    || parsedDate.toISOString().slice(0, 10) !== draft.validFrom || draft.validFrom < startDate) {
    throw new Error('Informe uma vigência válida a partir de ' + formatDateBR(startDate) + '.')
  }
  return {
    p_request_id: requestId,
    p_method: draft.method,
    p_rate: parseFeeRate(draft.rate),
    p_valid_from: draft.validFrom,
    p_expected_latest_id: draft.expectedLatestId,
  }
}

function finishSentence(message: string): string {
  return /[.!?]$/.test(message) ? message : message + '.'
}

export function feeRateErrorMessage(error: unknown): string {
  const e = error as {
    code?: string
    status?: number
    message?: string
  } | null
  if (e?.code === 'PGRST202' || e?.status === 404) return 'O painel de taxas aparece quando a atualização do sistema terminar.'
  if (e?.code === 'PT409') return 'Outra pessoa mudou esta taxa. Recarregue para ver a atual.'
  if (e?.code === '42501') return finishSentence(e.message || 'Sem permissão para mudar as taxas dos meios de pagamento.')
  return finishSentence(e?.message || 'Não foi possível carregar ou gravar as taxas. Tente de novo.')
}

export async function loadFinanceFeeRates(): Promise<FinanceFeeRates> {
  const { data, error, status } = await supabase.rpc('get_finance_fee_rates')
  if (error) throw { ...error, status }
  if (!data || !Array.isArray(data.methods) || !Array.isArray(data.history) || !Array.isArray(data.pending)) {
    throw new Error('O banco não devolveu o painel de taxas completo.')
  }
  return data as FinanceFeeRates
}

export async function saveFinanceFeeRate(
  draft: FeeRateDraft,
  requestId: string,
  startDate: string,
): Promise<{ version: FeeRateVersion; fees_created: number }> {
  const { data, error, status } = await supabase.rpc('save_finance_fee_rate', buildFeeRateRequest(draft, requestId, startDate))
  if (error) throw { ...error, status }
  return data as { version: FeeRateVersion; fees_created: number }
}

export function feeMethodLabel(method: CashClosingMethod): string {
  return CASH_CLOSING_METHOD_LABELS[method]
}

export function feeRateImpact(data: FinanceFeeRates, method: FeeMethod, validFrom: string) {
  // A vigência pode alcançar vendas de outros meses além da janela do livro.
  const rows = data.pending.filter(row => row.method === method
    && row.competence_month.slice(0, 7) >= validFrom.slice(0, 7))
  const months = [...new Set(rows.map(row => row.competence_month))].sort()
  const stores = [...new Set(rows.map(row => row.store.toUpperCase()))].sort()
  return {
    amount: rows.reduce((total, row) => total + Number(row.amount), 0),
    stores: stores.join(' e '),
    months: months.map(month => new Date(month.slice(0, 7) + '-01T12:00:00Z')
      .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })).join(' e '),
  }
}
