// src/lib/receivables.ts — contas a receber (fase 2).
//
// Regras de negócio em docs/CONTAS_A_RECEBER.md. Valor, vencimento, autoria e
// permissão são validados no banco; o que existe aqui é a validação de tela,
// para o recado chegar antes do envio, e a leitura da lista.

import { supabase } from '@/lib/supabase'
import { parseMoneyInput } from '@/lib/cashClosing'
import { todayKey } from '@/lib/utils'

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
  amount: number
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

/** O que falta para quitar. Nunca negativo: quem paga a mais quita e pronto. */
export function remainingAmount(
  receivable: Pick<ReceivableRow, 'amount' | 'receipts'>,
): number {
  return Math.max(0, Math.round((receivable.amount - receivedTotal(receivable)) * 100) / 100)
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
  receivable: Pick<ReceivableRow, 'invoice_date'>,
  today = todayKey(),
): string | null {
  if (!draft.receivedDate) return 'Informe a data em que o dinheiro entrou.'
  if (draft.receivedDate > today) return 'A data do recebimento não pode ser no futuro.'
  if (draft.receivedDate < receivable.invoice_date) return 'O recebimento não pode ser anterior ao faturamento.'

  const amount = parseMoneyInput(draft.receivedAmount)
  if (!(amount > 0)) return 'Informe o valor recebido.'
  if (amount > RECEIVABLE_MAX_AMOUNT) return 'Valor acima do limite permitido. Confira o que foi digitado.'

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
    .select('id,customer_id,origin,origin_ref,description,invoice_date,original_due_date,due_date,amount,status,installment_number,installment_count,cancel_reason,created_at,customer:customers(name),receipts:receivable_receipts(id,receivable_id,received_date,amount,method,account_id,reversed_at,reversal_reason)')
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
  const { data, error } = await supabase.rpc('record_receivable_receipt', {
    p_request_id: requestId,
    p_receivable_id: receivableId,
    p_received_date: draft.receivedDate,
    p_amount: parseMoneyInput(draft.receivedAmount),
    p_method: draft.receivedMethod,
    p_account_key: draft.accountKey,
  })
  if (error) throw error
  return data as string
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

/** Pedido cujo cliente ainda não tem prazo combinado não pode ser cobrado. */
export type PjOrderBillingBlock =
  | 'aguardando-conferencia'
  | 'sem-prazo'
  | 'nada-enviado'
  | 'fora-da-trava'
  | 'sem-conferencia-depois-do-envio'

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
  return order.motivo_bloqueio ?? null
}

/** O recado que a Elis lê, e que sempre diz o que fazer em seguida. */
export const PJ_ORDER_BILLING_BLOCK_MESSAGES: Record<PjOrderBillingBlock, string> = {
  'aguardando-conferencia':
    'ainda não foi conferido pela Expedição. Peça a conferência do que saiu; a cobrança libera sozinha depois disso.',
  'sem-prazo':
    'o cliente ainda não tem prazo de pagamento cadastrado. Cadastre em Clientes e o pedido libera.',
  'nada-enviado':
    'a Expedição registrou que nada saiu neste pedido. Se foi recusa na porta, cancele o pedido; se foi engano, peça a correção.',
  'fora-da-trava':
    'a quantidade conferida está muito longe da pedida. Confira com a Expedição antes de cobrar.',
  'sem-conferencia-depois-do-envio':
    'o pedido saiu sem conferência de algum item. Use "Corrigir quantidade enviada" para registrar o que saiu.',
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

/**
 * Gera a conta do período da Buck a partir dos romaneios da EX.
 *
 * `totalNaTela` é conferência, não entrada: o banco soma de novo a partir dos
 * itens e da tabela BUCK e recusa se os dois números discordarem. Foi a conta
 * feita só no navegador que produziu o episódio dos R$ 190 mil.
 */
export async function createReceivableFromRomaneio(
  periodStart: string,
  periodEnd: string,
  totalNaTela: number,
  requestId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('create_receivable_from_romaneio', {
    p_request_id: requestId,
    p_de: periodStart,
    p_ate: periodEnd,
    p_total_conferencia: totalNaTela,
  })
  if (error) throw error
  return data as string
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
