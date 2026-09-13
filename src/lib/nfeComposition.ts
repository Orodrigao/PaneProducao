import type { NfeDraft, NfeItemFiscal, NfeTotals } from '@/lib/nfeXml'

/**
 * Composição do total da NF-e, conforme a regra que a SEFAZ valida antes de
 * autorizar a nota (rejeição 610) e a evidência da fase 0 em
 * docs/COMPRAS_POR_XML.md:
 *
 *   vNF = vProd - vDesc + vST + vFCPST + vIPI + vIPIDevol
 *         + vFrete + vSeg + vOutro + vII - desoneração efetivamente deduzida
 *
 * A composição decide o que a tela deixa confirmar, e `allocateItemCosts`
 * mostra o custo de cada item antes da confirmação. O banco refaz as mesmas
 * contas em `create_xml_payable` e é a autoridade sobre o que vira dinheiro.
 * O resíduo nunca é distribuído: quando sobra valor, a tela explica e bloqueia.
 */

export type NfeSurchargeKey = 'icmsSt' | 'fcpSt' | 'ipi' | 'ipiReturned' | 'freight' | 'insurance' | 'otherExpenses' | 'importTax'

export interface NfeCompositionLine {
  key: NfeSurchargeKey
  label: string
  amount: number
}

export interface NfeComposition {
  /** vProd do bloco de totais. */
  products: number
  /** vDesc do bloco de totais. */
  discounts: number
  /** Acréscimos com valor, na ordem da composição fiscal. */
  surcharges: NfeCompositionLine[]
  surchargesTotal: number
  /** ICMS desonerado que a nota manda abater (itens com indicador 1). */
  exemptionDeducted: number
  /** O que a composição lida soma. */
  expectedTotal: number
  /** vNF, o total que a nota declara. */
  total: number
  /** total - expectedTotal, em reais; zero quando a nota fecha. */
  unexplained: number
  /** Casos sem regra validada na fase 0 ou divergência entre itens e total. */
  blockers: string[]
}

const SURCHARGE_ORDER: readonly { key: NfeSurchargeKey; label: string }[] = [
  { key: 'icmsSt', label: 'ICMS substituição tributária' },
  { key: 'fcpSt', label: 'Fundo de combate à pobreza (ST)' },
  { key: 'ipi', label: 'IPI' },
  { key: 'ipiReturned', label: 'IPI devolvido' },
  { key: 'freight', label: 'Frete' },
  { key: 'insurance', label: 'Seguro' },
  { key: 'otherExpenses', label: 'Outras despesas' },
  { key: 'importTax', label: 'Imposto de importação' },
]

/** Campos que apareceram na amostra real da fase 0. Os demais ficam bloqueados. */
const VALIDATED_SURCHARGES: ReadonlySet<NfeSurchargeKey> = new Set(['icmsSt', 'ipi', 'freight', 'otherExpenses'])

/** Nome de cada campo do bloco de totais, como está no XML, para a pessoa achar. */
const TOTAL_TAGS: Record<Exclude<keyof NfeTotals, 'services'>, string> = {
  products: 'vProd',
  discounts: 'vDesc',
  icmsSt: 'vST',
  fcpSt: 'vFCPST',
  ipi: 'vIPI',
  ipiReturned: 'vIPIDevol',
  freight: 'vFrete',
  insurance: 'vSeg',
  otherExpenses: 'vOutro',
  importTax: 'vII',
  icmsExempt: 'vICMSDeson',
  total: 'vNF',
}

type NumericFiscalField = { [K in keyof NfeItemFiscal]: NfeItemFiscal[K] extends number ? K : never }[keyof NfeItemFiscal]

const ITEM_TAGS: Record<NumericFiscalField, string> = {
  discount: 'vDesc',
  freight: 'vFrete',
  insurance: 'vSeg',
  otherExpenses: 'vOutro',
  importTax: 'vII',
  icmsSt: 'vICMSST',
  fcpSt: 'vFCPST',
  ipi: 'vIPI',
  ipiReturned: 'vIPIDevol',
  icmsExempt: 'vICMSDeson',
}

function cents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100)
}

function isKnown(value: number | null): value is number {
  return value !== null && !Number.isNaN(value)
}

/** Depois da validação, ausente e ilegível já estão bloqueados; a conta segue com zero só para mostrar o resto. */
function known(value: number | null): number {
  return isKnown(value) ? value : 0
}

/**
 * Uma NF-e 4.00 autorizada traz o bloco de totais inteiro. Arquivo sem esses
 * campos, ou com valor que não é número, não é conferível: em vez de supor
 * zero, a composição diz o que falta.
 */
function validateFiscalFields(totals: NfeTotals, items: readonly { lineNumber: number; fiscal: NfeItemFiscal }[]): string[] {
  const blockers: string[] = []
  const totalKeys = Object.keys(TOTAL_TAGS) as (keyof typeof TOTAL_TAGS)[]
  const missing = totalKeys.filter(key => totals[key] === null).map(key => TOTAL_TAGS[key])
  const invalid = totalKeys.filter(key => totals[key] !== null && Number.isNaN(totals[key])).map(key => TOTAL_TAGS[key])
  if (missing.length > 0) {
    blockers.push(`O bloco de totais da nota não informa ${missing.join(', ')}. Uma NF-e autorizada sempre traz esses campos; confira se o arquivo está completo.`)
  }
  if (invalid.length > 0) {
    blockers.push(`O bloco de totais da nota traz valor ilegível em ${invalid.join(', ')}.`)
  }
  if (Number.isNaN(totals.services)) {
    blockers.push('O bloco de serviços da nota traz valor ilegível em vServ.')
  }
  for (const item of items) {
    const itemKeys = Object.keys(ITEM_TAGS) as NumericFiscalField[]
    const unreadable = itemKeys.filter(key => Number.isNaN(item.fiscal[key])).map(key => ITEM_TAGS[key])
    if (unreadable.length > 0) {
      blockers.push(`O item ${item.lineNumber} traz valor ilegível em ${unreadable.join(', ')}.`)
    }
  }
  return blockers
}

function reais(centsValue: number): number {
  return centsValue / 100
}

function money(value: number): string {
  return `R$ ${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`
}

function sumItems(items: readonly { fiscal: NfeItemFiscal }[], field: NumericFiscalField): number {
  return items.reduce((sum, item) => sum + cents(known(item.fiscal[field])), 0)
}

export function composeNfe(draft: Pick<NfeDraft, 'items' | 'totals'>): NfeComposition {
  const totals: NfeTotals = draft.totals
  const items = draft.items
  const blockers = validateFiscalFields(totals, items)

  const products = cents(known(totals.products))
  const discounts = cents(known(totals.discounts))
  const itemProducts = items.reduce((sum, item) => sum + cents(item.grossLineTotal), 0)
  const itemDiscounts = sumItems(items, 'discount')
  // Comparação só com o que a nota informou de forma legível: ausente e
  // ilegível já bloquearam acima, e comparar com zero geraria um segundo aviso
  // enganoso ("o total informa R$ 0,00").
  if (isKnown(totals.products) && itemProducts !== products) {
    blockers.push(`Os itens somam ${money(reais(itemProducts))} em produtos, mas o total da nota informa ${money(reais(products))}.`)
  }
  if (isKnown(totals.discounts) && itemDiscounts !== discounts) {
    blockers.push(`Os itens somam ${money(reais(itemDiscounts))} de desconto, mas o total da nota informa ${money(reais(discounts))}.`)
  }

  const surcharges: NfeCompositionLine[] = []
  let surchargesTotal = 0
  for (const { key, label } of SURCHARGE_ORDER) {
    if (!isKnown(totals[key])) continue
    const amount = cents(totals[key])
    const inItems = sumItems(items, key)
    if (amount === 0 && inItems === 0) continue
    if (amount !== 0) {
      surcharges.push({ key, label, amount: reais(amount) })
      surchargesTotal += amount
    }
    if (!VALIDATED_SURCHARGES.has(key)) {
      blockers.push(`A nota traz ${label} (${money(reais(Math.max(amount, inItems)))}), um caso ainda sem evidência real na fase 0.`)
    }
    // O total é o somatório dos itens: a SEFAZ recusa a nota quando difere
    // (rejeições 534, 535, 536, 538, 604 e 862), com tolerância de um centavo.
    // Por isso não existe despesa comum só no total para ratear: diferença
    // maior que um centavo, em qualquer sentido, é divergência e bloqueia.
    if (Math.abs(amount - inItems) > 1) {
      blockers.push(`Os itens somam ${money(reais(inItems))} de ${label.toLocaleLowerCase('pt-BR')}, mas o total da nota informa ${money(reais(amount))}.`)
    }
  }

  if (cents(known(totals.services)) !== 0) {
    blockers.push(`A nota traz serviços (${money(known(totals.services))}), um caso ainda sem evidência real na fase 0.`)
  }

  let exemptionDeducted = 0
  let itemExemption = 0
  for (const item of items) {
    const exemption = cents(known(item.fiscal.icmsExempt))
    itemExemption += exemption
    if (item.fiscal.composesTotal === '0') {
      blockers.push(`O item ${item.lineNumber} está marcado no XML como fora do total da nota (indTot 0), um caso ainda sem evidência real na fase 0.`)
    }
    if (exemption === 0) continue
    if (item.fiscal.deductsExemption === '1') {
      exemptionDeducted += exemption
      blockers.push(`O item ${item.lineNumber} tem ICMS desonerado e o XML manda abater do total (indDeduzDeson 1), um caso ainda sem evidência real na fase 0.`)
    } else if (item.fiscal.deductsExemption === null) {
      blockers.push(`O item ${item.lineNumber} tem ICMS desonerado e o XML não diz se ele abate do total (indDeduzDeson ausente), um caso ainda não esclarecido.`)
    }
  }
  if (isKnown(totals.icmsExempt) && itemExemption !== cents(totals.icmsExempt)) {
    blockers.push(`Os itens somam ${money(reais(itemExemption))} de ICMS desonerado, mas o total da nota informa ${money(totals.icmsExempt)}.`)
  }

  const expectedTotal = products - discounts + surchargesTotal - exemptionDeducted
  const total = cents(known(totals.total))

  return {
    products: reais(products),
    discounts: reais(discounts),
    surcharges,
    surchargesTotal: reais(surchargesTotal),
    exemptionDeducted: reais(exemptionDeducted),
    expectedTotal: reais(expectedTotal),
    total: reais(total),
    unexplained: reais(total - expectedTotal),
    blockers,
  }
}

export function compositionCloses(composition: NfeComposition): boolean {
  return composition.blockers.length === 0 && composition.unexplained === 0
}

/**
 * Motivo, em linguagem da operação, para a confirmação ficar travada. Nulo
 * quando a nota pode seguir para o banco. A pessoa sabe ANTES de clicar por que
 * a nota não entra e o que fazer; acréscimo comprovado e explicado entra.
 */
export function compositionBlockReason(composition: NfeComposition): string | null {
  if (composition.blockers.length > 0) {
    return 'Esta nota traz um caso que o ERP ainda não sabe conferir. Lance esta compra à mão até esse caso ser liberado.'
  }
  if (composition.unexplained !== 0) {
    return `${money(Math.abs(composition.unexplained))} da nota ficaram sem explicação. Confira o arquivo com o fornecedor; se o XML estiver correto, a leitura do ERP está falhando e a equipe técnica precisa investigar.`
  }
  return null
}

export function formatCompositionMoney(value: number): string {
  return money(value)
}

/** Acréscimos que entram no custo do item, na ordem da composição fiscal. */
export type NfeCostField = 'icmsSt' | 'ipi' | 'freight' | 'otherExpenses'

const COST_FIELDS: readonly NfeCostField[] = ['icmsSt', 'ipi', 'freight', 'otherExpenses']

export interface NfeItemCost {
  lineNumber: number
  /** vProd - vDesc do item. */
  netValue: number
  icmsSt: number
  ipi: number
  freight: number
  otherExpenses: number
  /** Centavos da tolerância da SEFAZ entre total e itens que caíram neste item. */
  centAdjustment: number
  surchargeTotal: number
  /** O que a padaria pagou por este item: líquido mais acréscimos. */
  acquisitionValue: number
}

/**
 * Custo de aquisição de cada item (docs/COMPRAS_POR_XML.md, fase 3A). Cada item
 * leva o que o XML atribuiu a ele; o total da nota nunca é somado de novo. A
 * única sobra aceita é a tolerância de um centavo por campo que a SEFAZ admite
 * entre o total e a soma dos itens: a mais, vai para o item de maior valor
 * líquido; a menos, sai do maior item que tem aquele acréscimo, para nenhum
 * acréscimo ficar negativo. Empate vence a menor linha. Um item pode receber
 * mais de um centavo quando vários campos têm essa diferença.
 *
 * Nulo quando a composição não fecha: nota que a tela bloqueia não tem custo.
 * `create_xml_payable` aplica a mesma regra no banco.
 */
export function allocateItemCosts(draft: Pick<NfeDraft, 'items' | 'totals'>): NfeItemCost[] | null {
  if (!compositionCloses(composeNfe(draft))) return null

  const lines = draft.items.map(item => ({
    lineNumber: item.lineNumber,
    net: cents(item.grossLineTotal) - cents(item.fiscal.discount),
    fields: {
      icmsSt: cents(item.fiscal.icmsSt),
      ipi: cents(item.fiscal.ipi),
      freight: cents(item.fiscal.freight),
      otherExpenses: cents(item.fiscal.otherExpenses),
    } satisfies Record<NfeCostField, number>,
    adjustment: 0,
  }))
  const largestFirst = [...lines].sort((a, b) => b.net - a.net || a.lineNumber - b.lineNumber)

  for (const field of COST_FIELDS) {
    const difference = cents(known(draft.totals[field])) - lines.reduce((sum, line) => sum + line.fields[field], 0)
    if (difference === 0) continue
    const recipient = largestFirst.find(line => difference > 0 || line.fields[field] > 0)
    if (!recipient) return null
    recipient.adjustment += difference
  }

  return lines.map(line => {
    const surcharge = COST_FIELDS.reduce((sum, field) => sum + line.fields[field], 0) + line.adjustment
    return {
      lineNumber: line.lineNumber,
      netValue: reais(line.net),
      icmsSt: reais(line.fields.icmsSt),
      ipi: reais(line.fields.ipi),
      freight: reais(line.fields.freight),
      otherExpenses: reais(line.fields.otherExpenses),
      centAdjustment: reais(line.adjustment),
      surchargeTotal: reais(surcharge),
      acquisitionValue: reais(line.net + surcharge),
    }
  })
}
