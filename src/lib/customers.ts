/**
 * Regras de cadastro de cliente que o contas a receber depende.
 *
 * O prazo de pagamento vive aqui porque e dele que sai o vencimento de toda
 * cobranca. Cliente sem prazo nao gera cobranca: nenhum numero e inventado.
 */

export const PAYMENT_TERM_MIN_DAYS = 0
export const PAYMENT_TERM_MAX_DAYS = 180
/** Teto de parcelas de um plano. Doze cobre o pior acordo plausível. */
export const PAYMENT_TERM_MAX_PARCELS = 12

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
  /** Plano de prazos, ou null quando ainda não foi combinado. */
  terms: number[] | null
  message?: string
}

/**
 * Lê o campo de prazo da tela, que aceita um plano: "7" é uma parcela, "0" é à
 * vista, "7, 14, 21" são três. Vazio é resposta legítima e vira `null` —
 * significa "ainda não combinei", não "à vista".
 */
export function parsePaymentTerms(input: string | number | null | undefined): PaymentTermParseResult {
  if (input === null || input === undefined) return { ok: true, terms: null }

  const raw = typeof input === 'number' ? String(input) : input.trim()
  if (raw === '') return { ok: true, terms: null }

  // Aceita vírgula, ponto e vírgula, barra ou espaço como separador: a Elis
  // escreve "7/14/21" com a mesma naturalidade que "7, 14, 21".
  const partes = raw.split(/[,;/\s]+/).filter(parte => parte !== '')

  if (partes.some(parte => !/^\d+$/.test(parte))) {
    return { ok: false, terms: null, message: 'Use apenas números de dias, separados por vírgula. Ex.: 7, 14, 21.' }
  }
  if (partes.length > PAYMENT_TERM_MAX_PARCELS) {
    return { ok: false, terms: null, message: `No máximo ${PAYMENT_TERM_MAX_PARCELS} parcelas.` }
  }

  const dias = partes.map(Number)
  if (dias.some(dia => dia < PAYMENT_TERM_MIN_DAYS || dia > PAYMENT_TERM_MAX_DAYS)) {
    return {
      ok: false,
      terms: null,
      message: `Cada prazo deve ficar entre ${PAYMENT_TERM_MIN_DAYS} e ${PAYMENT_TERM_MAX_DAYS} dias.`,
    }
  }

  const ordenados = [...dias].sort((a, b) => a - b)
  if (new Set(ordenados).size !== ordenados.length) {
    return { ok: false, terms: null, message: 'Prazo repetido: duas parcelas no mesmo dia são uma parcela só.' }
  }

  return { ok: true, terms: ordenados }
}

/** Texto curto para o cartão do cliente. */
export function formatPaymentTerms(terms: number[] | null | undefined): string {
  if (!terms || terms.length === 0) return 'sem prazo definido'
  if (terms.length === 1) {
    const [dia] = terms
    if (dia === 0) return 'à vista'
    return dia === 1 ? '1 dia' : `${dia} dias`
  }
  return `${terms.length}x — ${terms.join('/')} dias`
}

/** O que a tela mostra dentro do campo ao abrir a edição. */
export function paymentTermsToInput(terms: number[] | null | undefined): string {
  return terms && terms.length > 0 ? terms.join(', ') : ''
}

/** Cliente sem prazo combinado ainda não pode virar cobrança. */
export function canGenerateReceivable(terms: number[] | null | undefined): boolean {
  return Array.isArray(terms) && terms.length > 0
}
