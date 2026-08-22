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
  /** Alguém já olhou o fator deste item nesta importação. */
  factorConfirmed: boolean
  /** O histórico do fornecedor reconheceu o item sozinho. */
  recognized: boolean
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

function searchKey(value: string): string {
  return value.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

/** Busca sem acento e por pedaços soltos: "acucar prod" acha "AÇÚCAR INSUMO PRODUÇÃO". */
export function matchesProductSearch(name: string, query: string): boolean {
  const terms = searchKey(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return false
  const target = searchKey(name)
  return terms.every(term => target.includes(term))
}

const NOISE_WORDS = new Set(['de', 'da', 'do', 'com', 'sem', 'para', 'p', 'e'])

/**
 * Primeira palavra útil da descrição da NF-e, para já abrir a busca em cima do
 * provável insumo. Foi a lista de 337 itens sem busca que fez açúcar mascavo
 * ser vinculado a damasco.
 */
export function initialSearchFromDescription(description: string): string {
  const words = description.split(/[^\p{L}]+/u).filter(Boolean)
  const word = words.find(candidate => candidate.length >= 3 && !NOISE_WORDS.has(candidate.toLocaleLowerCase('pt-BR')))
  return word ?? ''
}

export type UnitFamily = 'peso' | 'volume' | 'unidade' | 'desconhecida'

export function unitFamily(unit: string): UnitFamily {
  const normalized = normalizeUnit(unit)
  if (['KG', 'QUILO', 'QUILOS', 'K'].includes(normalized)) return 'peso'
  if (['G', 'GR', 'GRAMA', 'GRAMAS'].includes(normalized)) return 'peso'
  if (['L', 'LT', 'LITRO', 'LITROS'].includes(normalized)) return 'volume'
  if (['ML', 'MILILITRO'].includes(normalized)) return 'volume'
  if (['UN', 'UND', 'UNID', 'UNIDADE', 'UNIDADES', 'PC', 'PCT', 'PECA'].includes(normalized)) return 'unidade'
  return 'desconhecida'
}

function decimal(raw: string): number {
  return Number(raw.replace(/\./g, '').replace(',', '.'))
}

/** Converte "500" + "G" para 0,5 quando a receita cobra em kg. */
function inBaseUnit(amount: number, unitText: string, family: UnitFamily): number | null {
  const normalized = normalizeUnit(unitText)
  if (family === 'peso') {
    if (['KG'].includes(normalized)) return amount
    if (['G', 'GR'].includes(normalized)) return amount / 1000
    return null
  }
  if (family === 'volume') {
    if (['L', 'LT'].includes(normalized)) return amount
    if (['ML'].includes(normalized)) return amount / 1000
    return null
  }
  return null
}

export interface FactorSuggestion {
  factor: number
  /** Trecho da descrição que originou a sugestão, para a pessoa conferir. */
  evidence: string
}

/**
 * A embalagem quase sempre está escrita na própria descrição da NF-e
 * ("25KG", "C/100", "15 X 80G"). Ler dali evita o fator 1 silencioso, que já
 * gravou farinha a R$ 74,00/kg. É SUGESTÃO: quem confirma é a pessoa.
 */
export function suggestConversionFactor(description: string, baseUnit: string): FactorSuggestion | null {
  const text = description.replace(/\s+/g, ' ').trim()
  if (!text) return null
  const family = unitFamily(baseUnit)
  if (family === 'desconhecida') return null

  // "15 X 80G": contagem vezes tamanho. Só vale com unidade depois do segundo
  // número, senão "40X60" (medida da bobina) viraria fator 40.
  const multiple = text.match(/(\d+(?:[.,]\d+)?)\s*[xX]\s*(\d+(?:[.,]\d+)?)\s*(KG|G|GR|ML|LT|L)\b/i)
  if (multiple) {
    const count = decimal(multiple[1])
    const size = inBaseUnit(decimal(multiple[2]), multiple[3], family)
    if (family === 'unidade' && count > 0) return { factor: count, evidence: multiple[0].trim() }
    if (size !== null && count > 0) return { factor: round(count * size, 6), evidence: multiple[0].trim() }
  }

  // "C/100": quantas unidades vêm na embalagem. Só responde quando a receita
  // cobra por unidade; em kg não dá para saber quanto pesa cada uma.
  const perPack = text.match(/C\s*\/\s*(\d+)/i)
  if (perPack && family === 'unidade') {
    const count = decimal(perPack[1])
    if (count > 0) return { factor: count, evidence: perPack[0].trim() }
  }

  // "25KG", "0,8 KG", "5L": tamanho da embalagem.
  // Com "C/N" no texto o tamanho passa a ser de CADA peça, e juntar os dois é
  // chute: em "ACUCAR SACHE 4G C/1000" daria 4 kg (certo), mas em
  // "BOBINA 40X60 12KG C/500" o 12KG é a capacidade do saco, não o peso dele.
  // Preferimos não sugerir a sugerir errado.
  if ((family === 'peso' || family === 'volume') && !perPack) {
    const sizes = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(KG|GR|G|ML|LT|L)\b/gi)]
    for (const match of sizes.reverse()) {
      const size = inBaseUnit(decimal(match[1]), match[2], family)
      if (size !== null && size > 0) return { factor: round(size, 6), evidence: match[0].trim() }
    }
  }

  return null
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

/** tPag 90 é "sem pagamento": bonificação, brinde, remessa, amostra. */
const NO_PAYMENT_CODE = '90'

export function declaresNoPayment(codes: readonly string[]): boolean {
  return codes.length > 0 && codes.every(code => code.trim() === NO_PAYMENT_CODE)
}

const CASH_PAYMENT_METHODS: readonly NfePaymentMethod[] = ['dinheiro', 'pix']

/**
 * O bloco `dup` da NF-e é opcional: há emissor que imprime o vencimento na DANFE
 * e não o escreve no XML. Antes, a falta virava silenciosamente a data de emissão,
 * o que adianta o boleto sem ninguém perceber. Agora só assumimos a emissão quando
 * o pagamento é à vista; a prazo, a data fica vazia para ser digitada.
 *
 * A NF-e aceita vários `detPag`. Basta um deles ser a prazo para a nota deixar de
 * ser à vista — por isso a decisão olha todos, e não apenas o primeiro.
 */
export function resolveInstallments(
  duplicates: readonly NfeInstallmentDraft[],
  paymentMethods: readonly NfePaymentMethod[],
  issueDate: string,
  totalValue: number,
): { installments: NfeInstallmentDraft[]; dueDateSource: NfeDueDateSource } {
  if (duplicates.length > 0) {
    return {
      installments: duplicates.map((item, index) => ({ ...item, number: index + 1 })),
      dueDateSource: duplicates.every(item => Boolean(item.dueDate)) ? 'xml' : 'ausente',
    }
  }
  const cash = paymentMethods.length > 0 && paymentMethods.every(method => CASH_PAYMENT_METHODS.includes(method))
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
      factorConfirmed: false,
      recognized: false,
    }
  })

  // `nDup` é rótulo do emissor e pode repetir ou vir vazio; a posição é a única
  // identidade confiável, e é ela que o banco exige única dentro da compra.
  const duplicates = allElements(document, 'dup').map((duplicate, index) => ({
    number: index + 1,
    dueDate: childText(duplicate, 'dVenc'),
    amount: numberValue(childText(duplicate, 'vDup')),
  }))
  const totalValue = numberValue(childText(total, 'vNF'))
  const payments = allElements(document, 'detPag')
  const paymentCodes = payments.map(payment => childText(payment, 'tPag'))
  if (declaresNoPayment(paymentCodes)) {
    throw new Error('Esta NF-e declara "sem pagamento" (bonificação, brinde ou remessa). Ela não gera conta a pagar.')
  }
  const methods = paymentCodes.map(code => paymentMethod(code))
  const method = methods[0] ?? 'outro'
  const issueDay = issueDate.slice(0, 10)
  const { installments, dueDateSource } = resolveInstallments(duplicates, methods, issueDay, totalValue)

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
