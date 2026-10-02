import { PAYABLES_PERMISSION, type AppUser } from '@/lib/auth'
import { normalizeGtin } from '@/lib/nfeXml'
import type { InvoiceLinkHistory, SupplierMapping } from '@/lib/vinculosNfeClient'

export function canViewNfeLinks(user: AppUser): boolean {
  if (!user.active) return false
  if (user.role === 'admin') return true
  return user.role === 'financeiro'
    && user.allowedRoutes.some(route => route === '*' || route === '/produtos')
    && (user.permissions ?? []).some(permission => permission.permission_key === PAYABLES_PERMISSION
      && (permission.scope === '*' || permission.scope === 'jc'))
}

const VINCULOS_ROUTE = '/produtos/vinculos'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Atalho da tela Produtos para a correção da memória daquele produto. */
export function nfeLinksHref(productId: string | null | undefined): string {
  return productId ? `${VINCULOS_ROUTE}?produto=${encodeURIComponent(productId)}` : VINCULOS_ROUTE
}

/** Produto pedido pelo atalho; valor que não é identificador vira busca vazia. */
export function productIdFromNfeLinksSearch(search: string): string | null {
  const productId = new URLSearchParams(search).get('produto')?.trim() ?? ''
  return UUID_PATTERN.test(productId) ? productId.toLowerCase() : null
}

export function authorName(authors: ReadonlyMap<string, string>, id: string | null | undefined): string {
  return id ? (authors.get(id) ?? 'Nome indisponível') : 'Não registrado'
}

export function dateTimeLabel(value: string | null | undefined): string {
  if (!value) return 'Data não registrada'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Data não registrada'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

export function dateLabel(value: string | null | undefined): string {
  if (!value) return 'Data não registrada'
  const date = new Date(`${value.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return 'Data não registrada'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(date)
}

export function currencyLabel(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

export function mappingStatusLabel(mapping: Pick<SupplierMapping, 'active'>): string {
  return mapping.active ? 'Ligada: sugerida nas próximas notas' : 'Desligada: não é sugerida nas próximas notas'
}

export function invoiceMappingLabel(item: Pick<InvoiceLinkHistory, 'mapping_status'>): string {
  if (item.mapping_status === 'mapeado') return 'Vínculo registrado na nota'
  return 'Sem vínculo confirmado na nota'
}

export type MemoryCorrectionAction = 'corrigir' | 'desligar' | 'religar'

const CORRECTION_ACTION_LABELS: Record<MemoryCorrectionAction, string> = {
  corrigir: 'Memória corrigida',
  desligar: 'Memória desligada',
  religar: 'Memória religada',
}

/** Ação vinda do banco; valor desconhecido aparece cru, sem rótulo inventado. */
export function correctionActionLabel(action: string): string {
  return CORRECTION_ACTION_LABELS[action as MemoryCorrectionAction] ?? action
}

/**
 * Fator digitado, em um de três formatos e nada além deles:
 * - inteiro ou decimal sem milhar: "12", "1000", "0,5", "2.5";
 * - milhar brasileiro completo com vírgula: "1.000,5", "12.500,25".
 * Ponto com três dígitos e sem vírgula ("1.000", "25.000") é recusado, porque
 * na tela 1.000 é mil. Espaço no meio, agrupamento torto, zero, negativo, mais
 * de seis casas (o banco guarda numeric(14,6)) e valor que não cabe na coluna
 * também são recusados: erro de digitação vira recusa, nunca outro número.
 */
export function parseFactorInput(raw: string): number | null {
  const text = raw.trim()
  let normalized: string
  if (/^\d+([.,]\d{1,6})?$/.test(text)) {
    if (/^[1-9]\d{0,2}\.\d{3}$/.test(text)) return null
    normalized = text.replace(',', '.')
  } else if (/^[1-9]\d{0,2}(\.\d{3})+,\d{1,6}$/.test(text)) {
    normalized = text.replace(/\./g, '').replace(',', '.')
  } else {
    return null
  }
  const value = Number(normalized)
  if (!Number.isFinite(value) || value <= 0 || value >= 100_000_000) return null
  return value
}

/** Fator para exibir, com milhar. */
export function factorLabel(value: number): string {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 6 })
}

/** Fator para o campo editável: sem milhar, para o próprio leitor aceitar de volta. */
export function factorInputText(value: number): string {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 6, useGrouping: false })
}

type MemoryIdentity = Pick<SupplierMapping, 'supplier_id' | 'supplier_product_code' | 'supplier_ean' | 'supplier_description' | 'purchase_unit'>
type InvoiceIdentity = Pick<InvoiceLinkHistory, 'supplier_id' | 'source_code' | 'source_ean' | 'source_description' | 'source_unit'>

/**
 * O item da nota é o mesmo item lembrado pela regra das funções que gravam a
 * memória: mesmo fornecedor e unidade, e mesmo código, ou mesmo código de
 * barras válido, ou, sem os dois, mesma descrição.
 */
export function invoiceMatchesMemory(memory: MemoryIdentity, invoice: InvoiceIdentity): boolean {
  if (invoice.supplier_id !== memory.supplier_id || invoice.source_unit !== memory.purchase_unit) return false
  const memoryGtin = normalizeGtin(memory.supplier_ean)
  if (memory.supplier_product_code && invoice.source_code === memory.supplier_product_code) return true
  if (memoryGtin && normalizeGtin(invoice.source_ean) === memoryGtin) return true
  if (!memory.supplier_product_code && !memoryGtin) {
    return (invoice.source_description ?? '').trim().toLowerCase() === memory.supplier_description.trim().toLowerCase()
  }
  return false
}

export interface CorrectionEffectInput {
  action: MemoryCorrectionAction
  memory: Pick<SupplierMapping, 'supplier_name' | 'supplier_description' | 'supplier_product_code' | 'purchase_unit' | 'conversion_factor' | 'base_unit' | 'active'>
  currentProductName: string
  newProduct?: { name: string; unit: string | null }
  newFactor?: number
  savedInvoices: number
  recipeNames: readonly string[]
  recipesTruncated: boolean
}

/** O que muda e o que não muda, dito antes do clique que confirma. */
export function describeCorrectionEffect(input: CorrectionEffectInput): string[] {
  const { memory } = input
  const item = `${memory.supplier_description} (código ${memory.supplier_product_code || 'não informado'}, ${memory.purchase_unit})`
  const lines: string[] = []
  if (input.action === 'desligar') {
    lines.push(`A próxima NF-e de ${memory.supplier_name} com ${item} chega sem a sugestão desta memória: quem importar escolhe o produto.`)
    lines.push('Quando alguém confirmar esse item numa nota, a memória volta a ser gravada com a escolha feita.')
  } else if (input.action === 'religar') {
    lines.push(`A próxima NF-e de ${memory.supplier_name} com ${item} volta a sugerir ${input.currentProductName}, 1 ${memory.purchase_unit} = ${factorLabel(memory.conversion_factor)} ${memory.base_unit}.`)
  } else {
    const unit = input.newProduct?.unit || 'un'
    lines.push(`A próxima NF-e de ${memory.supplier_name} com ${item} vai sugerir ${input.newProduct?.name ?? 'o produto escolhido'}, 1 ${memory.purchase_unit} = ${input.newFactor === undefined ? '?' : factorLabel(input.newFactor)} ${unit}.`)
    const current = `${input.currentProductName}, 1 ${memory.purchase_unit} = ${factorLabel(memory.conversion_factor)} ${memory.base_unit}`
    lines.push(memory.active ? `Hoje sugere ${current}.` : `Hoje está desligada (sugeria ${current}); a correção também a religa.`)
    if (input.recipeNames.length === 0) lines.push(`${input.newProduct?.name ?? 'O produto escolhido'} não aparece em fichas de receita atuais.`)
    else lines.push(`${input.newProduct?.name ?? 'O produto escolhido'} aparece em ${input.recipeNames.length}${input.recipesTruncated ? ' ou mais' : ''} ficha(s) atual(is): ${input.recipeNames.slice(0, 5).join(', ')}${input.recipeNames.length > 5 ? '…' : ''}.`)
  }
  lines.push(`Quem estiver com uma NF-e de ${memory.supplier_name} aberta normalmente precisará reabrir a importação antes de confirmar; quem confirmar ao mesmo tempo grava a escolha que fez na nota.`)
  lines.push(input.savedInvoices === 0
    ? 'Nenhuma nota já gravada muda.'
    : `${input.savedInvoices} item(ns) deste fornecedor já gravado(s) em notas com ${input.currentProductName} continuam como estão: custo, fichas e contas não mudam.`)
  return lines
}
