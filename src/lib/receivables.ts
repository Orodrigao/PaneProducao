// src/lib/receivables.ts — contas a receber (fase 2).
//
// Regras de negócio em docs/CONTAS_A_RECEBER.md. Valor, vencimento, autoria e
// permissão são validados no banco; o que existe aqui é a validação de tela,
// para o recado chegar antes do envio, e a leitura da lista.

import { supabase } from '@/lib/supabase'
import { parseMoneyInput } from '@/lib/cashClosing'
import { formatDateBR, todayKey } from '@/lib/utils'

export type ReceivableStatus = 'aberta' | 'parcial' | 'recebida' | 'cancelada'
export type ReceivableOrigin = 'avulso' | 'pedido_pj' | 'romaneio_ex'
export type ReceivableMethod = 'dinheiro' | 'pix' | 'transferencia' | 'boleto' | 'cartao' | 'outro'

export const RECEIVABLE_METHOD_LABELS: Record<ReceivableMethod, string> = {
  pix: 'Pix',
  transferencia: 'Transferência',
  boleto: 'Boleto',
  dinheiro: 'Dinheiro',
  cartao: 'Cartão',
  outro: 'Outro',
}

export const RECEIVABLE_ORIGIN_LABELS: Record<ReceivableOrigin, string> = {
  avulso: 'Lançamento avulso',
  pedido_pj: 'Pedido PJ',
  romaneio_ex: 'Romaneio da Buck',
}

export interface ReceivableRow {
  id: string
  customer_id: string
  origin: ReceivableOrigin
  origin_ref: string | null
  description: string
  invoice_date: string
  original_due_date: string
  due_date: string
  amount: number
  status: ReceivableStatus
  installment_number: number
  installment_count: number
  cancel_reason: string | null
  created_at: string
  customer?: { name: string } | null
  receipts?: ReceivableReceiptRow[]
}

/** Cada entrada de dinheiro de uma cobrança. Uma cobrança pode ter várias. */
export interface ReceivableReceiptRow {
  id: string
  receivable_id: string
  received_date: string
  /** Quanto deste pedaço abate a cobrança. */
  amount: number
  /** Quanto passou do saldo: juros e multa recebidos. O dinheiro que entrou é a soma. */
  interest_amount: number
  /** Motivo escrito quando veio a mais sem atraso. */
  excess_reason: string | null
  method: ReceivableMethod
  account_id: string
  reversed_at: string | null
  reversal_reason: string | null
}

/** O que já entrou, somando só os pedaços que não foram estornados. */
export function receivedTotal(receivable: Pick<ReceivableRow, 'receipts'>): number {
  return (receivable.receipts ?? [])
    .filter(receipt => receipt.reversed_at === null)
    .reduce((sum, receipt) => sum + receipt.amount, 0)
}

/**
 * O que falta para quitar. Nunca negativo: recebimentos anteriores a 14/09/2026
 * guardavam o valor cheio, juros incluídos, e podem ter passado do cobrado.
 */
export function remainingAmount(
  receivable: Pick<ReceivableRow, 'amount' | 'receipts'>,
): number {
  return Math.max(0, Math.round((receivable.amount - receivedTotal(receivable)) * 100) / 100)
}

export interface ReceiptExcess {
  /** Quanto o valor digitado passa do que falta; zero quando não passa. */
  excess: number
  /** Recebido depois do vencimento: o valor a mais é juros de atraso. */
  late: boolean
}

/**
 * A mesma conta que o banco faz na baixa: o que passa do que falta vira juros
 * recebidos. Até o vencimento, valor a mais pede justificativa.
 */
export function receiptExcess(
  receivable: Pick<ReceivableRow, 'amount' | 'receipts' | 'due_date'>,
  draft: Pick<ReceivablePaymentDraft, 'receivedAmount' | 'receivedDate'>,
): ReceiptExcess {
  const late = Boolean(draft.receivedDate) && draft.receivedDate > receivable.due_date
  const recebido = parseMoneyInput(draft.receivedAmount)
  if (!(recebido > 0)) return { excess: 0, late }
  return { excess: Math.max(0, Math.round((recebido - remainingAmount(receivable)) * 100) / 100), late }
}

/**
 * O que o banco faz com a sobra nesta cobrança (private.receivable_excess_rule):
 * a Buck recusa; nas demais, a parte até `orderExcessCap` é diferença da
 * conferência de pedido PJ corrigido depois de pagamento e fica no pedido, e o
 * que passar dela vira juros recebidos.
 */
export interface ReceivableExcessRule {
  mode: 'juros' | 'recusa_buck'
  orderExcessCap: number
}

/** Palpite pela origem, para quando o banco ainda não tem a regra. */
export function fallbackExcessRule(origin: ReceivableOrigin): ReceivableExcessRule {
  return { mode: origin === 'romaneio_ex' ? 'recusa_buck' : 'juros', orderExcessCap: 0 }
}

export type ReceiptExcessKind = 'sem_excesso' | 'recusa_buck' | 'so_pedido' | 'juros' | 'juros_com_motivo'

export interface ReceiptExcessSplit {
  kind: ReceiptExcessKind
  /** Parte da sobra que fica no pedido PJ, como valor recebido a mais. */
  orderPart: number
  /** Parte da sobra que vira juros recebidos. */
  interest: number
}

/** Divide a sobra digitada do mesmo jeito que o banco dividirá na gravação. */
export function splitReceiptExcess(excesso: ReceiptExcess, rule: ReceivableExcessRule): ReceiptExcessSplit {
  if (excesso.excess <= 0) return { kind: 'sem_excesso', orderPart: 0, interest: 0 }
  if (rule.mode === 'recusa_buck') return { kind: 'recusa_buck', orderPart: 0, interest: 0 }
  const orderPart = Math.min(excesso.excess, Math.max(0, rule.orderExcessCap))
  const interest = Math.round((excesso.excess - orderPart) * 100) / 100
  if (interest <= 0) return { kind: 'so_pedido', orderPart, interest: 0 }
  return { kind: excesso.late ? 'juros' : 'juros_com_motivo', orderPart, interest }
}

/** O motivo do valor a mais sem atraso, com os limites do banco. */
export function validateExcessReason(reason: string, excess: number | null): string | null {
  const motivo = reason.trim()
  if (!motivo) {
    return excess
      ? `O pagamento não está atrasado e passou ${formatReceivableMoney(excess)} do que falta. Confira o valor ou informe a justificativa.`
      : 'Escreva o motivo do valor a mais.'
  }
  if (motivo.length < 3) return 'Escreva a justificativa com pelo menos 3 letras.'
  if (motivo.length > 300) return 'A justificativa passou de 300 caracteres. Resuma o motivo.'
  return null
}

export interface ReceivableDraft {
  customerId: string
  invoiceDate: string
  amount: string
  description: string
  /** Em quantas vezes esta fatura cai. 1 = inteira. */
  parcelas: number
}

export function emptyReceivableDraft(): ReceivableDraft {
  return { customerId: '', invoiceDate: todayKey(), amount: '', description: '', parcelas: 1 }
}

/**
 * Os vencimentos de uma fatura dividida. O prazo do cliente é o TETO: a última
 * parcela cai nele, e as anteriores se distribuem até lá — cliente de 21 dias
 * em 3 vezes vence em 7, 14 e 21.
 */
export function vencimentosDaFatura(
  invoiceDate: string,
  prazoBasico: number | null,
  parcelas: number,
): string[] {
  if (!invoiceDate || prazoBasico === null) return []
  const total = Math.max(1, parcelas)
  return Array.from({ length: total }, (_, indice) => {
    const dias = Math.round((prazoBasico * (indice + 1)) / total)
    const base = new Date(`${invoiceDate}T00:00:00Z`)
    base.setUTCDate(base.getUTCDate() + dias)
    return base.toISOString().slice(0, 10)
  })
}

/** Prazo curto demais faz duas parcelas caírem no mesmo dia. */
export function podeDividirEm(prazoBasico: number | null, parcelas: number): boolean {
  if (prazoBasico === null) return false
  return parcelas === 1 || prazoBasico >= parcelas
}

export interface ReceivablePaymentDraft {
  receivedDate: string
  receivedAmount: string
  receivedMethod: ReceivableMethod
  accountKey: string
  /** Por que veio a mais sem atraso. Vazio quando não se aplica. */
  excessReason: string
}

/**
 * Padrões que permitem baixar em dois toques: hoje, o valor cobrado e Pix — a
 * forma mais comum na padaria. A conta continua sendo escolha consciente.
 */
export function defaultPaymentDraft(
  receivable: Pick<ReceivableRow, 'amount' | 'receipts'>,
): ReceivablePaymentDraft {
  return {
    receivedDate: todayKey(),
    // O que falta, e não o valor cheio: numa cobrança que já recebeu metade,
    // propor o total seria propor cobrar duas vezes.
    receivedAmount: remainingAmount(receivable).toFixed(2).replace('.', ','),
    receivedMethod: 'pix',
    accountKey: '',
    excessReason: '',
  }
}

export const RECEIVABLE_MAX_AMOUNT = 1_000_000

export function getReceivableErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return fallback
}

/**
 * A data como o Financeiro digita: 28/09/2026, 28-09-2026, 28.09.2026 e também
 * a chave 2026-09-28, que era o único formato aceito antes. Devolve sempre AAAA-MM-DD,
 * que é o que o banco espera, ou null quando o que foi digitado não é um dia
 * do calendário (31/02, mês 13, ano de dois dígitos).
 */
export function parseDueDateInput(value: string): string | null {
  const texto = value.trim()
  // O separador tem de se repetir: aceitar `28/09-2026` seria aceitar erro de
  // digitação como se fosse intenção.
  const iso = /^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})$/.exec(texto)
  const brasileiro = /^(\d{1,2})([-/.])(\d{1,2})\2(\d{4})$/.exec(texto)

  let ano: number
  let mes: number
  let dia: number
  if (iso) {
    ano = Number(iso[1]); mes = Number(iso[3]); dia = Number(iso[4])
  } else if (brasileiro) {
    dia = Number(brasileiro[1]); mes = Number(brasileiro[3]); ano = Number(brasileiro[4])
  } else {
    return null
  }

  const chave = `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
  // Quem decide se o dia existe é o calendário: conferir só o intervalo deixa
  // 31/04 e 29/02 fora de bissexto virarem outro dia em silêncio.
  const data = new Date(`${chave}T00:00:00Z`)
  if (Number.isNaN(data.getTime())) return null
  if (data.getUTCFullYear() !== ano || data.getUTCMonth() + 1 !== mes || data.getUTCDate() !== dia) return null
  return chave
}

/**
 * Mesmos limites da RPC correct_receivable_due_date, conferidos antes de pedir
 * o motivo: cobrança não vence antes do dia em que foi faturada, nem mais de um
 * ano depois. Quem decide continua sendo o banco; isto só evita fazer a pessoa
 * escrever o motivo para descobrir no fim que a data não servia.
 */
export function validateDueDateCorrection(
  dueDate: string,
  receivable: Pick<ReceivableRow, 'invoice_date'>,
): string | null {
  if (dueDate < receivable.invoice_date) {
    return `O vencimento não pode ser antes do faturamento, que foi em ${formatDateBR(receivable.invoice_date)}.`
  }
  const teto = new Date(`${receivable.invoice_date}T00:00:00Z`)
  teto.setUTCDate(teto.getUTCDate() + 365)
  if (dueDate > teto.toISOString().slice(0, 10)) {
    return 'Vencimento distante demais do faturamento. Confira a data.'
  }
  return null
}

/** Mesmos limites do banco: dinheiro validado na entrada E na saída. */
export function validateReceivableDraft(draft: ReceivableDraft, today = todayKey()): string | null {
  if (!draft.customerId) return 'Escolha o cliente que vai pagar.'

  const amount = parseMoneyInput(draft.amount)
  if (!(amount > 0)) return 'Informe um valor maior que zero.'
  if (amount > RECEIVABLE_MAX_AMOUNT) return 'Valor acima do limite permitido. Confira o que foi digitado.'

  if (!draft.invoiceDate) return 'Informe a data do faturamento.'
  if (draft.invoiceDate > today) return 'A data do faturamento não pode ser no futuro.'
  if (draft.invoiceDate < '2020-01-01') return 'Data do faturamento muito antiga. Confira o que foi digitado.'

  if (draft.description.trim().length < 3) return 'Descreva a cobrança com pelo menos 3 letras.'
  return null
}

export function validateReceivablePaymentDraft(
  draft: ReceivablePaymentDraft,
  receivable: Pick<ReceivableRow, 'invoice_date' | 'due_date' | 'amount' | 'receipts' | 'origin'>,
  today = todayKey(),
  rule: ReceivableExcessRule = fallbackExcessRule(receivable.origin),
): string | null {
  if (!draft.receivedDate) return 'Informe a data em que o dinheiro entrou.'
  if (draft.receivedDate > today) return 'A data do recebimento não pode ser no futuro.'
  if (draft.receivedDate < receivable.invoice_date) return 'O recebimento não pode ser anterior ao faturamento.'

  const amount = parseMoneyInput(draft.receivedAmount)
  if (!(amount > 0)) return 'Informe o valor recebido.'
  if (amount > RECEIVABLE_MAX_AMOUNT) return 'Valor acima do limite permitido. Confira o que foi digitado.'

  // Mesmas regras do banco. A Buck não aceita valor acima do saldo. Quando a
  // sobra vira juros, até o vencimento o boleto não cobra juros: valor a mais
  // quase sempre é digitação, então não impede, mas exige o porquê.
  const sobra = splitReceiptExcess(receiptExcess(receivable, draft), rule)
  if (sobra.kind === 'recusa_buck') {
    return `Esta cobrança da Buck tem ${formatReceivableMoney(remainingAmount(receivable))} em aberto. Registre no máximo esse valor; o que passar pertence a outra semana.`
  }
  if (sobra.kind === 'juros_com_motivo') {
    const motivoError = validateExcessReason(draft.excessReason, sobra.interest)
    if (motivoError) return motivoError
  }

  if (!draft.accountKey) return 'Escolha a conta em que o dinheiro entrou.'
  return null
}

/** O rótulo da situação, já contando os pedaços. */
export const RECEIVABLE_STATUS_LABELS: Record<ReceivableStatus, string> = {
  aberta: 'Em aberto',
  parcial: 'Recebida em parte',
  recebida: 'Recebida',
  cancelada: 'Cancelada',
}

/** Dias de atraso; zero ou negativo significa que ainda não venceu. */
export function daysOverdue(receivable: Pick<ReceivableRow, 'due_date'>, today = todayKey()): number {
  const due = Date.parse(`${receivable.due_date}T00:00:00Z`)
  const now = Date.parse(`${today}T00:00:00Z`)
  return Math.round((now - due) / 86_400_000)
}

export function isOverdue(receivable: Pick<ReceivableRow, 'due_date' | 'status'>, today = todayKey()): boolean {
  return (receivable.status === 'aberta' || receivable.status === 'parcial')
    && receivable.due_date < today
}

export interface ReceivableTotals {
  atrasado: number
  aVencer: number
  recebidoNoPeriodo: number
}

export type ReceivableSituationFilter =
  | 'todas'
  | 'em_aberto'
  | 'atrasadas'
  | 'vence_hoje'
  | 'a_vencer'
  | 'recebidas'
  | 'canceladas'

export type ReceivableInvoicePeriodFilter = 'todas' | 'hoje' | 'ultimos_7_dias' | 'este_mes'

export interface ReceivableFilters {
  search: string
  situation: ReceivableSituationFilter
  invoicePeriod: ReceivableInvoicePeriodFilter
}

function receivableSearchText(row: ReceivableRow): string {
  return [
    row.customer?.name,
    row.description,
    row.origin_ref,
    RECEIVABLE_ORIGIN_LABELS[row.origin],
  ]
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
}

function invoicePeriodStart(today: string, period: ReceivableInvoicePeriodFilter): string | null {
  if (period === 'todas') return null
  if (period === 'hoje') return today
  if (period === 'este_mes') return `${today.slice(0, 7)}-01`
  const start = new Date(`${today}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - 6)
  return start.toISOString().slice(0, 10)
}

/** Filtra somente a lista visível. Os totais do topo continuam mostrando o quadro completo. */
export function filterReceivables(
  rows: readonly ReceivableRow[],
  filters: ReceivableFilters,
  today = todayKey(),
): ReceivableRow[] {
  const search = filters.search
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
  const periodStart = invoicePeriodStart(today, filters.invoicePeriod)

  return rows.filter(row => {
    const open = row.status === 'aberta' || row.status === 'parcial'
    const matchesSituation = filters.situation === 'todas'
      || (filters.situation === 'em_aberto' && open)
      || (filters.situation === 'atrasadas' && open && row.due_date < today)
      || (filters.situation === 'vence_hoje' && open && row.due_date === today)
      || (filters.situation === 'a_vencer' && open && row.due_date > today)
      || (filters.situation === 'recebidas' && row.status === 'recebida')
      || (filters.situation === 'canceladas' && row.status === 'cancelada')
    const matchesPeriod = filters.invoicePeriod === 'todas'
      || (periodStart !== null && row.invoice_date >= periodStart && row.invoice_date <= today)
    return matchesSituation
      && matchesPeriod
      && (!search || receivableSearchText(row).includes(search))
  })
}

/**
 * Os três números do topo da tela. Cobrança cancelada não entra em nenhum
 * deles — ela existe só como história.
 */
export function summarizeReceivables(
  rows: readonly ReceivableRow[],
  today = todayKey(),
): ReceivableTotals {
  let atrasado = 0
  let aVencer = 0
  let recebidoNoPeriodo = 0
  for (const row of rows) {
    // Cobrança parcial conta pelo que FALTA nos totais de atrasado e a vencer:
    // o que já entrou não é mais dívida.
    if (row.status === 'aberta' || row.status === 'parcial') {
      const falta = remainingAmount(row)
      if (row.due_date < today) atrasado += falta
      else aVencer += falta
    }
    if (row.status !== 'cancelada') recebidoNoPeriodo += receivedTotal(row)
  }
  return { atrasado, aVencer, recebidoNoPeriodo }
}

/**
 * Atrasadas primeiro, da mais antiga para a mais nova — é a ordem em que a
 * cobrança precisa ser feita. Depois as a vencer, e por último o que já foi
 * resolvido.
 */
export function sortReceivables(
  rows: readonly ReceivableRow[],
  today = todayKey(),
): ReceivableRow[] {
  const rank = (row: ReceivableRow): number => {
    if (row.status === 'aberta' || row.status === 'parcial') return row.due_date < today ? 0 : 1
    return row.status === 'recebida' ? 2 : 3
  }
  return [...rows].sort((left, right) => {
    const byRank = rank(left) - rank(right)
    if (byRank !== 0) return byRank
    return left.due_date.localeCompare(right.due_date)
  })
}

/**
 * Aceita ausência de propósito.
 *
 * O smoke de 03/09 derrubou a tela inteira de Contas a receber com
 * "client-side exception" porque a lista respondeu sem uma coluna nova e este
 * formatador chamou `toLocaleString` em `undefined`. Isso é o estado normal da
 * JANELA DE DEPLOY: o site novo sobe e a migration ainda não aplicou. Formatar
 * dinheiro nunca pode ser o motivo de a página não abrir.
 */
export function formatReceivableMoney(value: number | null | undefined): string {
  const numero = Number(value ?? 0)
  return (Number.isFinite(numero) ? numero : 0)
    .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export interface ReceivableCustomerOption {
  id: string
  name: string
  paymentTermDays: number | null
}

export async function loadReceivableCustomers(): Promise<ReceivableCustomerOption[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('id,name,payment_term_days')
    .eq('active', true)
    .order('name')
  if (error) throw error
  return (data ?? []).map(row => ({
    id: row.id as string,
    name: row.name as string,
    paymentTermDays: (row.payment_term_days as number | null) ?? null,
  }))
}

export async function loadReceivables(): Promise<ReceivableRow[]> {
  const { data, error } = await supabase
    .from('receivables')
    .select('id,customer_id,origin,origin_ref,description,invoice_date,original_due_date,due_date,amount,status,installment_number,installment_count,cancel_reason,created_at,customer:customers(name),receipts:receivable_receipts(*)')
    // Os pedaços vêm inteiros de propósito: site e banco atualizam separados no
    // mesmo merge, e pedir as colunas novas pelo nome derrubaria a lista nos
    // minutos em que o site já estiver no ar e a migration ainda não.
    .order('due_date')
  if (error) throw error
  return (data ?? []).map(row => ({
    ...row,
    // O PostgREST devolve o relacionamento como lista quando não consegue
    // provar que é um-para-um; a tela precisa de um objeto só.
    customer: Array.isArray(row.customer) ? (row.customer[0] ?? null) : row.customer,
  })) as ReceivableRow[]
}

export async function createManualReceivable(draft: ReceivableDraft, requestId: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_manual_receivable', {
    p_request_id: requestId,
    p_customer_id: draft.customerId,
    p_invoice_date: draft.invoiceDate,
    p_amount: parseMoneyInput(draft.amount),
    p_description: draft.description.trim(),
    p_parcelas: draft.parcelas,
  })
  if (error) throw error
  return data as string
}

export async function recordReceivableReceipt(
  receivableId: string,
  draft: ReceivablePaymentDraft,
  requestId: string,
): Promise<string> {
  const motivo = draft.excessReason.trim()
  const { data, error } = await supabase.rpc('record_receivable_receipt', {
    p_request_id: requestId,
    p_receivable_id: receivableId,
    p_received_date: draft.receivedDate,
    p_amount: parseMoneyInput(draft.receivedAmount),
    p_method: draft.receivedMethod,
    p_account_key: draft.accountKey,
    // Só vai quando existe: sem justificativa a chamada fica igual à anterior e
    // funciona também com o banco que ainda não recebeu a migration.
    ...(motivo ? { p_excess_reason: motivo } : {}),
  })
  if (error) throw error
  return data as string
}

/**
 * Pergunta ao banco como ele dividirá a sobra nesta cobrança. O palpite pela
 * origem só vale quando o banco ainda não tem a regra (os minutos em que o site
 * novo já está no ar e a migration ainda não); qualquer outro erro sobe, para a
 * tela oferecer nova tentativa em vez de prometer juros que o banco não gravaria.
 */
export async function loadReceivableExcessRule(
  receivable: Pick<ReceivableRow, 'id' | 'origin'>,
): Promise<ReceivableExcessRule> {
  const { data, error } = await supabase.rpc('receivable_excess_rule', { p_receivable_id: receivable.id })
  if (error) {
    // PGRST202: a função não existe no banco.
    if (error.code === 'PGRST202') return fallbackExcessRule(receivable.origin)
    throw error
  }
  const regra = data as { modo?: unknown; sobra_do_pedido?: unknown } | null
  if (!regra || (regra.modo !== 'juros' && regra.modo !== 'recusa_buck')) {
    throw new Error('Resposta inesperada ao conferir a cobrança.')
  }
  return { mode: regra.modo, orderExcessCap: Math.max(0, Number(regra.sobra_do_pedido ?? 0) || 0) }
}

/** O estorno é de UM pedaço: errar o Pix de terça não desfaz o dinheiro de quinta. */
export async function reverseReceivableReceipt(
  receiptId: string,
  reason: string,
  requestId: string,
): Promise<void> {
  const { error } = await supabase.rpc('reverse_receivable_receipt', {
    p_request_id: requestId,
    p_receipt_id: receiptId,
    p_reason: reason.trim(),
  })
  if (error) throw error
}

export async function cancelReceivable(
  receivableId: string,
  reason: string,
  requestId: string,
): Promise<void> {
  const { error } = await supabase.rpc('cancel_receivable', {
    p_request_id: requestId,
    p_receivable_id: receivableId,
    p_reason: reason.trim(),
  })
  if (error) throw error
}

export async function correctReceivableDueDate(
  receivableId: string,
  dueDate: string,
  reason: string,
  requestId: string,
): Promise<void> {
  const { error } = await supabase.rpc('correct_receivable_due_date', {
    p_request_id: requestId,
    p_receivable_id: receivableId,
    p_due_date: dueDate,
    p_reason: reason.trim(),
  })
  if (error) throw error
}

export interface PjOrderToBillRow {
  order_group_id: string
  customer_id: string
  customer_name: string
  payment_term_days: number | null
  delivery_date: string
  dispatched_at: string | null
  items: number
  /** O que a cobrança vai usar: o que saiu, quando há conferência. */
  amount: number
  /** O que a cobrança usaria pela estimativa, para mostrar a diferença. */
  amount_estimado: number
  /**
   * Por que este pedido ainda não vira cobrança, ou `null` quando pode.
   *
   * O banco é quem decide, e a tela repete o motivo dele. Antes isto era um
   * booleano de "aguardando conferência", e cada motivo novo virava um campo
   * novo; agora é um motivo só, com nome.
   */
  motivo_bloqueio: PjOrderBillingBlock | null
}

/**
 * Pedidos PJ entregues e ainda não cobrados.
 *
 * O comentário anterior dizia que esta lista era "o caminho principal da
 * cobrança" porque a Expedição não tinha o hábito de confirmar o envio. Isso
 * descrevia julho. Medido em produção em 26/08: na semana de 20 a 26/08 foram
 * 24 cobranças com envio confirmado contra 1 sem. Ela voltou a ser a rede de
 * proteção que a decisão 11 previa.
 */
export async function loadPjOrdersToBill(): Promise<PjOrderToBillRow[]> {
  const { data, error } = await supabase.rpc('list_pj_orders_to_bill')
  if (error) throw error

  // Durante a janela do deploy o site novo conversa com a versão anterior da
  // função, que não tem `amount_estimado` nem `motivo_bloqueio`. A tela não
  // pode depender disso para abrir: sem esta normalização, a página inteira
  // caiu no smoke de 03/09.
  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...row,
    amount_estimado: typeof row.amount_estimado === 'number' ? row.amount_estimado : (row.amount as number),
    motivo_bloqueio: (row.motivo_bloqueio as PjOrderBillingBlock | null) ?? null,
  })) as PjOrderToBillRow[]
}

export async function createReceivableFromPjOrder(
  orderGroupId: string,
  requestId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('create_receivable_from_pj_order', {
    p_request_id: requestId,
    p_order_group_id: orderGroupId,
  })
  if (error) throw error
  return data as string
}

/** Divide uma cobrança que já existe — o caminho da que nasceu sozinha e saiu alta. */
export async function splitReceivable(
  receivableId: string,
  parcelas: number,
  requestId: string,
): Promise<void> {
  const { error } = await supabase.rpc('split_receivable', {
    p_request_id: requestId,
    p_receivable_id: receivableId,
    p_parcelas: parcelas,
  })
  if (error) throw error
}

/**
 * Por que um pedido entregue ainda não virou cobrança.
 *
 * A lista precisa cobrir TUDO o que `private.motivo_bloqueio_cobranca_pj`
 * devolve. Quando faltava `item-sem-preco`, a tela de Contas a receber quebrava
 * inteira num pedido misto (um item com preço, outro sem): o resumo indexava
 * um motivo que não existia no mapa e o navegador derrubava a página.
 * `motivo-desconhecido` é a rede embaixo disso: motivo novo no banco passa a
 * aparecer como bloqueio genérico, nunca como página em branco, e nunca como
 * cobrança liberada por engano.
 */
export type PjOrderBillingBlock =
  | 'aguardando-conferencia'
  | 'sem-prazo'
  | 'nada-enviado'
  | 'fora-da-trava'
  | 'sem-conferencia-depois-do-envio'
  | 'item-sem-preco'
  | 'motivo-desconhecido'

/** Os motivos que a tela sabe explicar, na forma exata que o banco devolve. */
const MOTIVOS_CONHECIDOS: readonly PjOrderBillingBlock[] = [
  'aguardando-conferencia',
  'sem-prazo',
  'nada-enviado',
  'fora-da-trava',
  'sem-conferencia-depois-do-envio',
  'item-sem-preco',
]

/**
 * Por que este pedido ainda não pode virar cobrança, ou `null` se pode.
 *
 * Devolve o MOTIVO e não um sim/não: uma mensagem só para causas diferentes é
 * o defeito que a conferência do Romaneio ensinou em 26/08 — quem lê não
 * descobre o que fazer.
 *
 * A conferência vem antes do prazo porque é a mais grave: sem prazo a cobrança
 * espera um cadastro; sem conferência ela sairia com o número errado.
 */
export function pjOrderBillingBlock(
  order: Pick<PjOrderToBillRow, 'motivo_bloqueio'>,
): PjOrderBillingBlock | null {
  const motivo = order.motivo_bloqueio ?? null
  if (motivo === null) return null
  // O banco pode saber de um motivo que esta versão da tela não conhece: basta
  // uma migration nova chegar antes do site, o que acontece em toda janela de
  // publicação. Bloquear com recado genérico é o lado seguro; devolver `null`
  // liberaria a cobrança de um pedido que o banco recusa.
  return MOTIVOS_CONHECIDOS.includes(motivo) ? motivo : 'motivo-desconhecido'
}

/** O recado que a Elis lê, e que sempre diz o que fazer em seguida. */
export const PJ_ORDER_BILLING_BLOCK_MESSAGES: Record<PjOrderBillingBlock, string> = {
  'aguardando-conferencia':
    'ainda não foi conferido pela Expedição. A cobrança libera sozinha depois da conferência.',
  'sem-prazo':
    'o cliente ainda não tem prazo de pagamento cadastrado. Cadastre em Clientes e o pedido libera.',
  'nada-enviado':
    'a Expedição conferiu e nada vai neste pedido. Se foi engano, corrija a quantidade; se nada saiu mesmo, não há o que cobrar e ele fica nesta lista.',
  'fora-da-trava':
    'a quantidade conferida está muito longe da pedida. Confira com a Expedição antes de cobrar.',
  'sem-conferencia-depois-do-envio':
    'foi fechado sem a conferência de algum item. Corrija a quantidade para registrar o que saiu.',
  'item-sem-preco':
    'tem item sem preço gravado no próprio pedido. Preço novo na tabela não muda pedido já lançado: abra o pedido para ver qual item é.',
  'motivo-desconhecido':
    'está bloqueado por um motivo que esta tela ainda não conhece. Abra o pedido para ver, e avise se ele continuar aqui depois de recarregar.',
}

/**
 * Onde a Elis resolve cada bloqueio, sem sair da tela procurando.
 *
 * O aviso dizia o que fazer e não dizia onde: ela lia "corrija a quantidade" e
 * tinha de ir a Pedidos PJ, abrir a aba dos fechados e caçar o pedido. O
 * atalho leva direto ao pedido certo, com o painel de correção já aberto
 * quando é ele que resolve.
 */
export function pjOrderBillingBlockLink(
  block: PjOrderBillingBlock,
  order: Pick<PjOrderToBillRow, 'order_group_id' | 'dispatched_at'>,
): { href: string; label: string } | null {
  const orderGroupId = order.order_group_id
  // O formulário de correção só existe em pedido já liberado para entrega.
  // "Nada vai" e "quantidade fora do esperado" também aparecem em pedido que a
  // Expedição conferiu e não liberou: mandar corrigir ali abriria a janela sem
  // o botão que o link prometeu.
  const podeCorrigir = Boolean(order.dispatched_at)
  switch (block) {
    case 'sem-prazo':
      return { href: '/clientes', label: 'Cadastrar o prazo' }
    case 'item-sem-preco':
      // A tabela de preço NÃO resolve este bloqueio: ele lê `unit_price` da
      // linha do pedido, congelada no lançamento, e a tela de tabelas mexe em
      // `price_tier_items` e `customer_price_overrides`. Mandar para lá era
      // prometer uma solução que devolveria o mesmo bloqueio.
      return {
        href: `/pedidos-pj?pedido=${encodeURIComponent(orderGroupId)}`,
        label: 'Ver o pedido',
      }
    case 'motivo-desconhecido':
      return {
        href: `/pedidos-pj?pedido=${encodeURIComponent(orderGroupId)}`,
        label: 'Ver o pedido',
      }
    case 'nada-enviado':
    case 'fora-da-trava':
    case 'sem-conferencia-depois-do-envio':
      return podeCorrigir
        ? {
            href: `/pedidos-pj?corrigir=${encodeURIComponent(orderGroupId)}`,
            label: 'Corrigir a quantidade',
          }
        : {
            href: `/pedidos-pj?pedido=${encodeURIComponent(orderGroupId)}`,
            label: 'Ver o pedido',
          }
    case 'aguardando-conferencia':
      // Quem resolve é a Expedição, na tela dela. Abrir o pedido ajuda a Elis
      // a saber de qual pedido falar, mas não existe botão dela aqui.
      return {
        href: `/pedidos-pj?pedido=${encodeURIComponent(orderGroupId)}`,
        label: 'Ver o pedido',
      }
    default:
      return null
  }
}

export function pjOrderCanBeBilled(
  order: Pick<PjOrderToBillRow, 'motivo_bloqueio'>,
): boolean {
  return pjOrderBillingBlock(order) === null
}

export interface PjOrdersToBillSummary {
  total: number
  bloqueados: number
  valorBloqueado: number
  /** Quantos pedidos, e quanto, por motivo. A tela conta o que precisa. */
  porMotivo: Record<PjOrderBillingBlock, { pedidos: number; valor: number }>
}

function motivosZerados(): Record<PjOrderBillingBlock, { pedidos: number; valor: number }> {
  return {
    'aguardando-conferencia': { pedidos: 0, valor: 0 },
    'sem-prazo': { pedidos: 0, valor: 0 },
    'nada-enviado': { pedidos: 0, valor: 0 },
    'fora-da-trava': { pedidos: 0, valor: 0 },
    'sem-conferencia-depois-do-envio': { pedidos: 0, valor: 0 },
    'item-sem-preco': { pedidos: 0, valor: 0 },
    'motivo-desconhecido': { pedidos: 0, valor: 0 },
  }
}

export function summarizePjOrdersToBill(
  orders: readonly PjOrderToBillRow[],
): PjOrdersToBillSummary {
  const resumo: PjOrdersToBillSummary = {
    total: 0,
    bloqueados: 0,
    valorBloqueado: 0,
    porMotivo: motivosZerados(),
  }
  for (const order of orders) {
    resumo.total += order.amount
    const motivo = pjOrderBillingBlock(order)
    if (motivo === null) continue
    resumo.bloqueados += 1
    resumo.valorBloqueado += order.amount
    resumo.porMotivo[motivo].pedidos += 1
    resumo.porMotivo[motivo].valor += order.amount
  }
  return resumo
}

export interface PjDispatchFixLine {
  orderId: string
  dispatchedQuantity: number
  reason?: string | null
}

export interface PjDispatchFixResult {
  order_group_id: string
  cobrancas_canceladas?: number
  cobranca_nova?: string | null
  parcelas?: number
  ja_aplicado?: boolean
}

/**
 * Corrige a quantidade enviada de um pedido já despachado e refaz a cobrança.
 *
 * O banco faz tudo numa transação só: cancela as cobranças vivas, grava o
 * número novo e regera. Aqui só se monta o pedido e se deixa o erro subir com
 * a mensagem que o banco escreveu, que é a que diz o que fazer.
 */
export async function corrigirQuantidadeEnviadaPj(
  orderGroupId: string,
  linhas: readonly PjDispatchFixLine[],
  motivo: string,
  requestId: string,
  expectedVersion: string | null,
): Promise<PjDispatchFixResult> {
  const { data, error } = await supabase.rpc('corrigir_quantidade_enviada_pj', {
    p_request_id: requestId,
    p_order_group_id: orderGroupId,
    p_linhas: linhas.map(linha => ({
      order_id: linha.orderId,
      dispatched_quantity: linha.dispatchedQuantity,
      reason: linha.reason?.trim() || null,
    })),
    p_motivo: motivo.trim(),
    // O carimbo que esta tela leu. Se alguém corrigiu no meio, o banco recusa
    // em vez de deixar vencer quem salvou por último.
    p_expected_version: expectedVersion,
  })
  if (error) throw error
  return data as PjDispatchFixResult
}
