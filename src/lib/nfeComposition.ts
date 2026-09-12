import type { NfeDraft, NfeItemFiscal, NfeTotals } from '@/lib/nfeXml'

/**
 * Composição do total da NF-e, conforme a regra que a SEFAZ valida antes de
 * autorizar a nota (rejeição 610) e a evidência da fase 0 em
 * docs/COMPRAS_POR_XML.md:
 *
 *   vNF = vProd - vDesc + vST + vFCPST + vIPI + vIPIDevol
 *         + vFrete + vSeg + vOutro + vII - desoneração efetivamente deduzida
 *
 * Esta fase só LÊ e MOSTRA. Nada daqui muda custo, conta a pagar ou o que o
 * banco aceita. O resíduo nunca é distribuído: quando sobra valor, a tela
 * explica e bloqueia.
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

function cents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100)
}

function reais(centsValue: number): number {
  return centsValue / 100
}

function money(value: number): string {
  return `R$ ${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`
}

type NumericFiscalField = { [K in keyof NfeItemFiscal]: NfeItemFiscal[K] extends number ? K : never }[keyof NfeItemFiscal]

function sumItems(items: readonly { fiscal: NfeItemFiscal }[], field: NumericFiscalField): number {
  return items.reduce((sum, item) => sum + cents(item.fiscal[field]), 0)
}

export function composeNfe(draft: Pick<NfeDraft, 'items' | 'totals'>): NfeComposition {
  const totals: NfeTotals = draft.totals
  const items = draft.items
  const blockers: string[] = []

  if (totals.products === null) {
    blockers.push('A nota não informa o total dos produtos (vProd) no bloco de totais.')
  }
  if (totals.total === null) {
    blockers.push('A nota não informa o valor total (vNF) no bloco de totais.')
  }

  const products = cents(totals.products ?? 0)
  const discounts = cents(totals.discounts)
  const itemProducts = items.reduce((sum, item) => sum + cents(item.grossLineTotal), 0)
  const itemDiscounts = sumItems(items, 'discount')
  if (totals.products !== null && itemProducts !== products) {
    blockers.push(`Os itens somam ${money(reais(itemProducts))} em produtos, mas o total da nota informa ${money(reais(products))}.`)
  }
  if (itemDiscounts !== discounts) {
    blockers.push(`Os itens somam ${money(reais(itemDiscounts))} de desconto, mas o total da nota informa ${money(reais(discounts))}.`)
  }

  const surcharges: NfeCompositionLine[] = []
  let surchargesTotal = 0
  for (const { key, label } of SURCHARGE_ORDER) {
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
    // O total é o somatório dos itens; item cobrando mais que o total é divergência.
    // Valor só no total (sem item) é despesa comum, que a fase 3 vai ratear.
    if (inItems > amount) {
      blockers.push(`Os itens somam ${money(reais(inItems))} de ${label.toLocaleLowerCase('pt-BR')}, mas o total da nota informa ${money(reais(amount))}.`)
    }
  }

  if (cents(totals.services) !== 0) {
    blockers.push(`A nota traz serviços (${money(totals.services)}), um caso ainda sem evidência real na fase 0.`)
  }

  let exemptionDeducted = 0
  let itemExemption = 0
  for (const item of items) {
    const exemption = cents(item.fiscal.icmsExempt)
    itemExemption += exemption
    if (item.fiscal.composesTotal === '0') {
      blockers.push(`O item ${item.lineNumber} não compõe o total da nota (indTot 0), um caso ainda sem evidência real na fase 0.`)
    }
    if (exemption === 0) continue
    if (item.fiscal.deductsExemption === '1') {
      exemptionDeducted += exemption
      blockers.push(`O item ${item.lineNumber} manda abater ICMS desonerado do total (indDeduzDeson 1), um caso ainda sem evidência real na fase 0.`)
    } else if (item.fiscal.deductsExemption === null) {
      blockers.push(`O item ${item.lineNumber} tem ICMS desonerado sem o indicador de dedução (indDeduzDeson), um caso ainda não esclarecido.`)
    }
  }
  if (itemExemption !== cents(totals.icmsExempt)) {
    blockers.push(`Os itens somam ${money(reais(itemExemption))} de ICMS desonerado, mas o total da nota informa ${money(totals.icmsExempt)}.`)
  }

  const expectedTotal = products - discounts + surchargesTotal - exemptionDeducted
  const total = cents(totals.total ?? 0)

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
 * quando a nota pode seguir para o banco como hoje. A trava do banco
 * (`create_xml_payable` compara itens com o total) não muda nesta fase; o que
 * muda é a pessoa saber ANTES de clicar por que a nota não entra e o que fazer.
 */
export function compositionBlockReason(composition: NfeComposition): string | null {
  if (composition.blockers.length > 0) {
    return 'Esta nota traz um caso que o ERP ainda não sabe conferir. Lance esta compra à mão até esse caso ser liberado.'
  }
  if (composition.unexplained !== 0) {
    return `${money(Math.abs(composition.unexplained))} da nota ficaram sem explicação. Confira o arquivo com o fornecedor; se o XML estiver correto, a leitura do ERP está falhando e a equipe técnica precisa investigar.`
  }
  if (composition.surchargesTotal !== 0) {
    const names = composition.surcharges.map(line => line.label.toLocaleLowerCase('pt-BR')).join(', ')
    return `A nota tem ${money(composition.surchargesTotal)} de acréscimos (${names}). O ERP ainda não importa acréscimos pelo XML: lance esta compra à mão, somando o imposto e a despesa como itens.`
  }
  return null
}

export function formatCompositionMoney(value: number): string {
  return money(value)
}
