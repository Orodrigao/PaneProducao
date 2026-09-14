// src/lib/buckWeeklyBilling.ts — a semana da Buck a conferir no Contas a receber.
//
// Regras em docs/CONTAS_A_RECEBER.md (fase 4D). O banco recalcula o valor dos
// romaneios, valida cada ajuste e grava a foto da cobrança; o que existe aqui é
// a validação de tela, para o recado chegar antes do envio, e as chamadas.

import { supabase } from '@/lib/supabase'

export type BuckBillingProblem = 'missing_price' | 'unit_mismatch' | 'suspicious_quantity'
export type BuckAdjustmentKind = 'produto_sem_romaneio' | 'preco_combinado' | 'acerto'
export type BuckAdjustmentUnit = 'un' | 'kg'

/** Os mesmos limites de `public.create_buck_weekly_receivable`. */
export const BUCK_MAX_ADJUSTMENTS = 20
export const BUCK_MAX_ADJUSTMENT_AMOUNT = 5000

export const BUCK_ADJUSTMENT_KIND_LABELS: Record<BuckAdjustmentKind, string> = {
  produto_sem_romaneio: 'Pão que saiu sem romaneio',
  preco_combinado: 'Preço combinado',
  acerto: 'Acerto',
}

export const BUCK_ADJUSTMENT_KIND_HINTS: Record<BuckAdjustmentKind, string> = {
  produto_sem_romaneio: 'Produto, quantidade e preço do que foi entregue sem romaneio.',
  preco_combinado: 'Diferença para mais ou para menos do preço da Tabela BUCK.',
  acerto: 'Arredondamento, devolução ou reclamação. Resto de semana anterior fica na cobrança antiga.',
}

export interface BuckWeekToBillRow {
  period_start: string
  period_end: string
  romaneios: number
  romaneios_sem_conferencia: number
  linhas: number
  amount: number
  problemas: string[]
  lancamentos_diretos: number
}

export interface BuckWeekLine {
  produto: string
  unidade: string
  quantidade: number
  preco_unitario: number | null
  total: number | null
  problemas: string[]
}

export interface BuckAdjustmentDraft {
  kind: BuckAdjustmentKind
  description: string
  amount: string
  productName: string
  quantity: string
  unit: BuckAdjustmentUnit
  unitPrice: string
}

export interface BuckAdjustmentPayload {
  kind: BuckAdjustmentKind
  description: string
  amount?: number
  product_name?: string
  quantity?: number
  unit?: BuckAdjustmentUnit
  unit_price?: number
}

export function emptyBuckAdjustmentDraft(kind: BuckAdjustmentKind = 'acerto'): BuckAdjustmentDraft {
  return { kind, description: '', amount: '', productName: '', quantity: '', unit: 'un', unitPrice: '' }
}

/** Arredonda para centavos como o Postgres: meio centavo se afasta do zero. */
export function roundCents(value: number): number {
  const sinal = value < 0 ? -1 : 1
  return (sinal * Math.round((Math.abs(value) + Number.EPSILON) * 100)) / 100
}

/**
 * Lê número digitado no jeito brasileiro ("1.234,5", "0,333", "-7,34").
 * Não usa `parseMoneyInput`, que arredonda para centavos: 0,333 kg viraria
 * 0,33 e o ajuste da tela sairia diferente do que o banco calcula.
 */
export function parseDecimal(raw: string): number | null {
  const texto = raw.trim().replace(/\s/g, '').replace(/R\$/gi, '')
  if (!texto) return null
  const normalizado = texto.includes(',') ? texto.replace(/\./g, '').replace(',', '.') : texto
  if (!/^-?\d+(\.\d+)?$/.test(normalizado)) return null
  const valor = Number(normalizado)
  return Number.isFinite(valor) ? valor : null
}

/** O valor que o ajuste soma na cobrança, ou `null` enquanto está incompleto. */
export function buckAdjustmentAmount(draft: BuckAdjustmentDraft): number | null {
  if (draft.kind === 'produto_sem_romaneio') {
    const quantidade = parseDecimal(draft.quantity)
    const preco = parseDecimal(draft.unitPrice)
    if (quantidade === null || preco === null) return null
    return roundCents(quantidade * preco)
  }
  const valor = parseDecimal(draft.amount)
  return valor === null ? null : roundCents(valor)
}

/** Mesmas recusas do banco, com o mesmo texto, para a Elis ver antes de enviar. */
export function validateBuckAdjustment(draft: BuckAdjustmentDraft, position: number): string | null {
  const prefixo = `Ajuste ${position}:`
  const descricao = draft.description.trim()
  if (descricao.length < 3 || descricao.length > 200) return `${prefixo} descreva o motivo com 3 a 200 letras.`

  if (draft.kind === 'produto_sem_romaneio') {
    const produto = draft.productName.trim()
    if (produto.length < 2 || produto.length > 120) return `${prefixo} informe o produto que saiu sem romaneio.`
    const quantidade = parseDecimal(draft.quantity)
    if (quantidade === null || quantidade <= 0 || quantidade > 10000) return `${prefixo} quantidade precisa ser maior que zero.`
    if (draft.unit !== 'un' && draft.unit !== 'kg') return `${prefixo} unidade precisa ser un ou kg.`
    const preco = parseDecimal(draft.unitPrice)
    if (preco === null || preco <= 0 || preco > 10000) return `${prefixo} preço precisa ser maior que zero.`
    const valor = roundCents(quantidade * preco)
    if (valor <= 0 || valor > BUCK_MAX_ADJUSTMENT_AMOUNT) return `${prefixo} cada ajuste vai até R$ 5.000,00.`
    return null
  }

  const valor = buckAdjustmentAmount(draft)
  if (valor === null || valor === 0 || Math.abs(valor) > BUCK_MAX_ADJUSTMENT_AMOUNT) {
    return `${prefixo} informe um valor diferente de zero, até R$ 5.000,00 para mais ou para menos.`
  }
  return null
}

export function validateBuckAdjustments(drafts: readonly BuckAdjustmentDraft[]): string | null {
  if (drafts.length > BUCK_MAX_ADJUSTMENTS) return 'No máximo 20 ajustes por semana.'
  for (let index = 0; index < drafts.length; index += 1) {
    const erro = validateBuckAdjustment(drafts[index], index + 1)
    if (erro) return erro
  }
  return null
}

export interface BuckWeekSummary {
  romaneios: number
  ajustes: number
  total: number
}

/** Romaneios + ajustes já preenchidos. Ajuste incompleto ainda não soma. */
export function summarizeBuckWeek(romaneiosAmount: number, drafts: readonly BuckAdjustmentDraft[]): BuckWeekSummary {
  const ajustes = roundCents(drafts.reduce((soma, draft) => soma + (buckAdjustmentAmount(draft) ?? 0), 0))
  return { romaneios: roundCents(romaneiosAmount), ajustes, total: roundCents(romaneiosAmount + ajustes) }
}

export function buckAdjustmentsPayload(drafts: readonly BuckAdjustmentDraft[]): BuckAdjustmentPayload[] {
  return drafts.map(draft => {
    if (draft.kind === 'produto_sem_romaneio') {
      return {
        kind: draft.kind,
        description: draft.description.trim(),
        product_name: draft.productName.trim(),
        quantity: parseDecimal(draft.quantity) ?? 0,
        unit: draft.unit,
        unit_price: parseDecimal(draft.unitPrice) ?? 0,
      }
    }
    return { kind: draft.kind, description: draft.description.trim(), amount: buckAdjustmentAmount(draft) ?? 0 }
  })
}

export interface BuckWeekBlock {
  message: string
  href: string
  label: string
}

/**
 * Por que a semana ainda não pode ser cobrada, com o atalho de onde se resolve.
 * Problema desconhecido vindo do banco bloqueia com recado genérico: nunca vira
 * cobrança liberada por engano.
 */
export function buckWeekBlock(week: Pick<BuckWeekToBillRow, 'problemas' | 'amount' | 'linhas'>): BuckWeekBlock | null {
  const problemas = week.problemas ?? []
  if (problemas.includes('missing_price')) {
    return { message: 'Há produto sem preço na Tabela BUCK nesta semana.', href: '/tabelas-preco', label: 'Abrir Tabela Buck' }
  }
  if (problemas.includes('unit_mismatch')) {
    return { message: 'Há produto com unidade diferente entre o romaneio e a Tabela BUCK.', href: '/relatorios/romaneios', label: 'Abrir Fechamento EX' }
  }
  if (problemas.includes('suspicious_quantity')) {
    return { message: 'Há quantidade por peso acima de 10 kg num romaneio. Confira o lançamento.', href: '/relatorios/romaneios', label: 'Abrir Fechamento EX' }
  }
  if (problemas.length > 0) {
    return { message: 'O banco apontou um problema nesta semana.', href: '/relatorios/romaneios', label: 'Abrir Fechamento EX' }
  }
  if (week.linhas === 0 || week.amount <= 0) {
    return { message: 'Os romaneios desta semana fecharam em zero.', href: '/relatorios/romaneios', label: 'Abrir Fechamento EX' }
  }
  return null
}

function dayMonth(dateKey: string): string {
  const [, month, day] = dateKey.split('-')
  return `${day}/${month}`
}

export function buckWeekLabel(week: Pick<BuckWeekToBillRow, 'period_start' | 'period_end'>): string {
  return `Semana de ${dayMonth(week.period_start)} a ${dayMonth(week.period_end)}`
}

function isMissingFunction(error: { code?: string; message?: string } | null, name: string): boolean {
  if (!error) return false
  return error.code === 'PGRST202' || error.code === '42883' || (error.message ?? '').includes(name)
}

/**
 * Semanas fechadas da Buck que ainda não viraram cobrança.
 *
 * Durante a janela do deploy o site novo pode conversar com um banco que ainda
 * não tem a função. A tela de Contas a receber não pode cair por isso: sem a
 * função, não há semana a mostrar.
 */
export async function loadBuckWeeksToBill(): Promise<BuckWeekToBillRow[]> {
  const { data, error } = await supabase.rpc('list_buck_weeks_to_bill')
  if (error) {
    if (isMissingFunction(error, 'list_buck_weeks_to_bill')) return []
    throw error
  }
  return (data ?? []).map((row: Record<string, unknown>) => ({
    period_start: String(row.period_start),
    period_end: String(row.period_end),
    romaneios: Number(row.romaneios ?? 0),
    romaneios_sem_conferencia: Number(row.romaneios_sem_conferencia ?? 0),
    linhas: Number(row.linhas ?? 0),
    amount: Number(row.amount ?? 0),
    problemas: Array.isArray(row.problemas) ? (row.problemas as string[]) : [],
    lancamentos_diretos: Number(row.lancamentos_diretos ?? 0),
  }))
}

/** Os produtos da semana, pela mesma conta do banco que a cobrança vai usar. */
export async function loadBuckWeekLines(week: Pick<BuckWeekToBillRow, 'period_start' | 'period_end'>): Promise<BuckWeekLine[]> {
  const { data, error } = await supabase.rpc('preview_receivable_from_romaneio', {
    p_de: week.period_start,
    p_ate: week.period_end,
  })
  if (error) throw error
  return (data ?? []).map((row: Record<string, unknown>) => ({
    produto: String(row.produto),
    unidade: String(row.unidade),
    quantidade: Number(row.quantidade ?? 0),
    preco_unitario: row.preco_unitario === null || row.preco_unitario === undefined ? null : Number(row.preco_unitario),
    total: row.total === null || row.total === undefined ? null : Number(row.total),
    problemas: Array.isArray(row.problemas) ? (row.problemas as string[]) : [],
  }))
}

/**
 * Confirma a semana. `week.amount` vai como conferência: o banco soma de novo
 * e recusa se discordar.
 */
export async function createBuckWeeklyReceivable(
  week: Pick<BuckWeekToBillRow, 'period_start' | 'period_end' | 'amount'>,
  drafts: readonly BuckAdjustmentDraft[],
  requestId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('create_buck_weekly_receivable', {
    p_request_id: requestId,
    p_de: week.period_start,
    p_ate: week.period_end,
    p_total_romaneios_conferencia: week.amount,
    p_ajustes: buckAdjustmentsPayload(drafts),
  })
  if (error) throw error
  return data as string
}

export interface ReceivableAdjustmentRow {
  receivable_id: string
  position: number
  kind: BuckAdjustmentKind
  description: string
  product_name: string | null
  quantity: number | null
  unit: BuckAdjustmentUnit | null
  unit_price: number | null
  amount: number
}

export interface BuckReceivableDetail {
  romaneiosTotal: number
  adjustments: ReceivableAdjustmentRow[]
}

/**
 * Valor dos romaneios e ajustes de cada cobrança da Buck, para a lista mostrar
 * de onde saiu o número. Sem as tabelas (janela do deploy), a lista abre sem o
 * detalhe em vez de cair.
 */
export async function loadBuckReceivableDetails(receivableIds: readonly string[]): Promise<Map<string, BuckReceivableDetail>> {
  const detalhes = new Map<string, BuckReceivableDetail>()
  if (receivableIds.length === 0) return detalhes

  const [linhas, ajustes] = await Promise.all([
    supabase.from('receivable_romaneio_lines').select('receivable_id,total').in('receivable_id', [...receivableIds]),
    supabase
      .from('receivable_adjustments')
      .select('receivable_id,position,kind,description,product_name,quantity,unit,unit_price,amount')
      .in('receivable_id', [...receivableIds])
      .order('position'),
  ])
  if (linhas.error || ajustes.error) {
    console.error(linhas.error ?? ajustes.error)
    return detalhes
  }

  for (const linha of linhas.data ?? []) {
    const id = linha.receivable_id as string
    const atual = detalhes.get(id) ?? { romaneiosTotal: 0, adjustments: [] }
    atual.romaneiosTotal = roundCents(atual.romaneiosTotal + Number(linha.total ?? 0))
    detalhes.set(id, atual)
  }
  for (const ajuste of ajustes.data ?? []) {
    const id = ajuste.receivable_id as string
    const atual = detalhes.get(id) ?? { romaneiosTotal: 0, adjustments: [] }
    atual.adjustments.push({
      ...(ajuste as unknown as ReceivableAdjustmentRow),
      amount: Number(ajuste.amount),
      quantity: ajuste.quantity === null ? null : Number(ajuste.quantity),
      unit_price: ajuste.unit_price === null ? null : Number(ajuste.unit_price),
    })
    detalhes.set(id, atual)
  }
  return detalhes
}
