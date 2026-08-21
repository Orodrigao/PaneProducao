export type NfePaymentMethod = 'dinheiro' | 'pix' | 'transferencia' | 'boleto' | 'cartao' | 'outro'
export type NfeMappingStatus = 'pendente' | 'mapeado'
export type NfeConversionBasis = 'simple' | 'package' | 'usable'

/**
 * De onde veio o vencimento das parcelas:
 * - `xml`: a NF-e informou as duplicatas com data.
 * - `a-vista`: a NF-e não informou, mas o pagamento é dinheiro ou pix; vale a emissão.
 * - `ausente`: a NF-e não informou e o pagamento é a prazo; alguém precisa digitar.
 */
export type NfeDueDateSource = 'xml' | 'a-vista' | 'ausente'

export interface NfeItemDraft {
  lineNumber: number
  supplierCode: string | null
  ean: string | null
  description: string
  ncm: string | null
  quantity: number
  purchaseUnit: string
  taxQuantity: number | null
  taxUnit: string | null
  unitPrice: number
  grossLineTotal: number
  discountValue: number
  lineTotal: number
  baseProductId: string | null
  baseProductName: string | null
  baseUnit: string | null
  category: string | null
  conversionBasis: NfeConversionBasis
  conversionFactor: number | null
  usableQuantity: number | null
  mappingStatus: NfeMappingStatus
  rememberConversion: boolean
}

export interface NfeInstallmentDraft {
  number: number
  dueDate: string
  amount: number
}

export interface NfeDraft {
  accessKey: string
  number: string
  series: string
  issueDate: string
  supplierName: string
  supplierCnpj: string
  total: number
  paymentMethod: NfePaymentMethod
  dueDateSource: NfeDueDateSource
  items: NfeItemDraft[]
  installments: NfeInstallmentDraft[]
}

export interface ConversionExplanation {
  input: string
  operation: string
  output: string
  cost: string
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 }).format(value)
}

function formatCost(value: number, unit: string): string {
  return `R$ ${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(value)} por ${unit}`
}

export function calculateUsableQuantity(quantity: number, conversionFactor: number): number {
  return round(quantity * conversionFactor, 6)
}

export function calculateNetLineTotal(grossLineTotal: number, discountValue: number): number {
  return round(grossLineTotal - discountValue, 2)
}

export function conversionFactorFromUsableQuantity(quantity: number, usableQuantity: number): number {
  if (quantity <= 0 || usableQuantity <= 0) return 0
  return round(usableQuantity / quantity, 6)
}

export function calculateNormalizedUnitCost(lineTotal: number, usableQuantity: number): number {
  if (lineTotal < 0 || usableQuantity <= 0) return 0
  return round(lineTotal / usableQuantity, 6)
}

function normalizeUnit(value: string): string {
  return value.trim().toLocaleUpperCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function getConversionUnitWarning(purchaseUnit: string, baseUnit: string, factor: number): string | null {
  if (!purchaseUnit.trim() || !baseUnit.trim() || !Number.isFinite(factor) || factor <= 0) return null
  if (normalizeUnit(purchaseUnit) !== normalizeUnit(baseUnit) || Math.abs(factor - 1) < 0.000001) return null
  return `A NF-e informa ${purchaseUnit} e a receita usa ${baseUnit}. Quando as unidades são iguais, o fator 1 é o correto; o nome da embalagem não muda a unidade cobrada.`
}

export function formatConversionExplanation(item: NfeItemDraft): ConversionExplanation {
  const factor = item.conversionFactor ?? 0
  const usableQuantity = item.usableQuantity ?? calculateUsableQuantity(item.quantity, factor)
  const baseUnit = item.baseUnit ?? 'unidade'
  const baseName = item.baseProductName ?? 'item-base'
  const unitCost = calculateNormalizedUnitCost(item.lineTotal, usableQuantity)
  return {
    input: `${formatQuantity(item.quantity)} ${item.purchaseUnit}`,
    operation: `${formatQuantity(item.quantity)} × ${formatQuantity(factor)} = ${formatQuantity(usableQuantity)}`,
    output: `${formatQuantity(usableQuantity)} ${baseUnit} de ${baseName}`,
    cost: formatCost(unitCost, baseUnit),
  }
}

export function isClassificationComplete(items: NfeItemDraft[]): boolean {
  return items.length > 0 && items.every(item => (
    item.mappingStatus === 'mapeado'
    && item.baseProductId !== null
    && item.usableQuantity !== null
    && item.usableQuantity > 0
  ))
}

function firstElement(root: ParentNode, localName: string): Element | null {
  return Array.from(root.querySelectorAll('*')).find(node => node.localName === localName) ?? null
}

function allElements(root: ParentNode, localName: string): Element[] {
  return Array.from(root.querySelectorAll('*')).filter(node => node.localName === localName)
}

function childText(root: ParentNode, localName: string): string {
  return firstElement(root, localName)?.textContent?.trim() ?? ''
}

function numberValue(value: string): number {
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}

function paymentMethod(code: string): NfePaymentMethod {
  return ({
    '01': 'dinheiro',
    '03': 'cartao',
    '04': 'cartao',
    '05': 'outro',
    '10': 'outro',
    '15': 'boleto',
    '16': 'outro',
    '17': 'pix',
  } as Record<string, NfePaymentMethod>)[code] ?? 'outro'
}

const CASH_PAYMENT_METHODS: readonly NfePaymentMethod[] = ['dinheiro', 'pix']

/**
 * O bloco `dup` da NF-e é opcional: há emissor que imprime o vencimento na DANFE
 * e não o escreve no XML. Antes, a falta virava silenciosamente a data de emissão,
 * o que adianta o boleto sem ninguém perceber. Agora só assumimos a emissão quando
 * o pagamento é à vista; a prazo, a data fica vazia para ser digitada.
 */
export function resolveInstallments(
  duplicates: readonly NfeInstallmentDraft[],
  paymentMethod: NfePaymentMethod,
  issueDate: string,
  totalValue: number,
): { installments: NfeInstallmentDraft[]; dueDateSource: NfeDueDateSource } {
  if (duplicates.length > 0) {
    return {
      installments: duplicates.map(item => ({ ...item })),
      dueDateSource: duplicates.every(item => Boolean(item.dueDate)) ? 'xml' : 'ausente',
    }
  }
  const cash = CASH_PAYMENT_METHODS.includes(paymentMethod)
  return {
    installments: [{ number: 1, dueDate: cash ? issueDate : '', amount: totalValue }],
    dueDateSource: cash ? 'a-vista' : 'ausente',
  }
}

function conversionBasis(unit: string): NfeConversionBasis {
  return ['PACOTE', 'PCT', 'FD', 'FARDO', 'CX', 'CAIXA'].includes(unit.toUpperCase()) ? 'package' : 'simple'
}

export function parseNfeXml(xmlText: string): NfeDraft {
  if (typeof DOMParser === 'undefined') throw new Error('Este navegador não consegue ler XML.')
  const document = new DOMParser().parseFromString(xmlText, 'application/xml')
  if (document.querySelector('parsererror')) throw new Error('O arquivo não é um XML válido.')

  const infNfe = firstElement(document, 'infNFe')
  const ide = firstElement(document, 'ide')
  const emit = firstElement(document, 'emit')
  const total = firstElement(document, 'ICMSTot')
  if (!infNfe || !ide || !emit || !total) throw new Error('O XML não contém uma NF-e completa.')

  const accessKey = (infNfe.getAttribute('Id') ?? '').replace(/^NFe/, '')
  const issueDate = childText(ide, 'dhEmi') || childText(ide, 'dEmi')
  const supplierCnpj = childText(emit, 'CNPJ') || childText(emit, 'CPF')
  const details = allElements(document, 'det')
  if (!accessKey || !issueDate || !supplierCnpj || details.length === 0) {
    throw new Error('A NF-e não tem chave, emissão, fornecedor ou itens suficientes.')
  }

  const items = details.map(detail => {
    const prod = firstElement(detail, 'prod')
    if (!prod) throw new Error('Um item da NF-e não possui dados de produto.')
    const purchaseUnit = childText(prod, 'uCom') || childText(prod, 'uTrib') || 'un'
    const grossLineTotal = numberValue(childText(prod, 'vProd'))
    const discountValue = numberValue(childText(prod, 'vDesc'))
    return {
      lineNumber: numberValue(detail.getAttribute('nItem') ?? '0'),
      supplierCode: childText(prod, 'cProd') || null,
      ean: childText(prod, 'cEAN') || null,
      description: childText(prod, 'xProd'),
      ncm: childText(prod, 'NCM') || null,
      quantity: numberValue(childText(prod, 'qCom') || childText(prod, 'qTrib')),
      purchaseUnit,
      taxQuantity: childText(prod, 'qTrib') ? numberValue(childText(prod, 'qTrib')) : null,
      taxUnit: childText(prod, 'uTrib') || null,
      unitPrice: numberValue(childText(prod, 'vUnCom') || childText(prod, 'vUnTrib')),
      grossLineTotal,
      discountValue,
      lineTotal: calculateNetLineTotal(grossLineTotal, discountValue),
      baseProductId: null,
      baseProductName: null,
      baseUnit: null,
      category: null,
      conversionBasis: conversionBasis(purchaseUnit),
      conversionFactor: null,
      usableQuantity: null,
      mappingStatus: 'pendente' as const,
      rememberConversion: true,
    }
  })

  const duplicates = allElements(document, 'dup').map((duplicate, index) => ({
    number: numberValue(childText(duplicate, 'nDup')) || index + 1,
    dueDate: childText(duplicate, 'dVenc'),
    amount: numberValue(childText(duplicate, 'vDup')),
  }))
  const totalValue = numberValue(childText(total, 'vNF'))
  const payments = allElements(document, 'detPag')
  const paymentCode = payments.length > 0 ? childText(payments[0], 'tPag') : ''
  const method = paymentMethod(paymentCode)
  const issueDay = issueDate.slice(0, 10)
  const { installments, dueDateSource } = resolveInstallments(duplicates, method, issueDay, totalValue)

  return {
    accessKey,
    number: childText(ide, 'nNF'),
    series: childText(ide, 'serie'),
    issueDate: issueDay,
    supplierName: childText(emit, 'xNome'),
    supplierCnpj,
    total: totalValue,
    paymentMethod: method,
    dueDateSource,
    items,
    installments,
  }
}
