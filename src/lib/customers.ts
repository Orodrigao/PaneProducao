/**
 * Regras de cadastro de cliente que o contas a receber depende.
 *
 * O prazo de pagamento vive aqui porque e dele que sai o vencimento de toda
 * cobranca. Cliente sem prazo nao gera cobranca: nenhum numero e inventado.
 */

export const PAYMENT_TERM_MIN_DAYS = 0
export const PAYMENT_TERM_MAX_DAYS = 180

/** Nome do indice que impede dois clientes ativos com o mesmo CNPJ. */
export const CUSTOMER_DOC_UNIQUE_INDEX = 'customers_doc_numerico_ativo_unico'

export const DUPLICATE_CUSTOMER_DOC_MESSAGE =
  'Já existe um cliente ativo com este CNPJ/CPF. Procure por ele na lista — se estiver inativo, marque "Mostrar inativos" e reative em vez de cadastrar de novo.'

/** Só os dígitos, para comparar CNPJ digitado com e sem pontuação. */
export function normalizeCustomerDoc(doc: string | null | undefined): string {
  return (doc ?? '').replace(/\D/g, '')
}

export function sameCustomerDoc(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = normalizeCustomerDoc(a)
  const right = normalizeCustomerDoc(b)
  return left.length > 0 && left === right
}

type DbErrorLike = { code?: string | null; message?: string | null } | null | undefined

/** O banco recusou por CNPJ repetido entre clientes ativos. */
export function isDuplicateCustomerDocError(error: DbErrorLike): boolean {
  if (!error) return false
  const message = error.message ?? ''
  return error.code === '23505' && message.includes(CUSTOMER_DOC_UNIQUE_INDEX)
}

export interface PaymentTermParseResult {
  ok: boolean
  /** Dias combinados, ou null quando o prazo ainda nao foi definido. */
  days: number | null
  message?: string
}

/**
 * Lê o campo de prazo da tela. Vazio é resposta legítima e vira `null`:
 * significa "ainda não combinei", não "à vista".
 */
export function parsePaymentTermDays(input: string | number | null | undefined): PaymentTermParseResult {
  if (input === null || input === undefined) return { ok: true, days: null }

  const raw = typeof input === 'number' ? String(input) : input.trim()
  if (raw === '') return { ok: true, days: null }

  if (!/^\d+$/.test(raw)) {
    return { ok: false, days: null, message: 'O prazo de pagamento deve ser um número de dias inteiro.' }
  }

  const days = Number(raw)
  if (days < PAYMENT_TERM_MIN_DAYS || days > PAYMENT_TERM_MAX_DAYS) {
    return {
      ok: false,
      days: null,
      message: `O prazo de pagamento deve ficar entre ${PAYMENT_TERM_MIN_DAYS} e ${PAYMENT_TERM_MAX_DAYS} dias.`,
    }
  }

  return { ok: true, days }
}

/** Texto curto para o cartão do cliente. */
export function formatPaymentTerm(days: number | null | undefined): string {
  if (days === null || days === undefined) return 'sem prazo definido'
  if (days === 0) return 'à vista'
  if (days === 1) return '1 dia'
  return `${days} dias`
}

/** Cliente sem prazo combinado ainda não pode virar cobrança. */
export function canGenerateReceivable(days: number | null | undefined): boolean {
  return typeof days === 'number' && Number.isInteger(days) && days >= PAYMENT_TERM_MIN_DAYS && days <= PAYMENT_TERM_MAX_DAYS
}
